import { execFile } from "node:child_process";
import { promisify } from "node:util";

/** A maintenance connection to postgres, never to the database being copied. */
export type Admin = (sql: string) => Promise<Record<string, unknown>[]>;
export type Database = { name: string; oid: string };
const exec = promisify(execFile);
export const identifier = (s: string): string => `"${s.replaceAll('"', '""')}"`;
const literal = (s: string): string => `'${s.replaceAll("'", "''")}'`;

/** Keep credentials out of argv and error output. psql 17 is supplied by the host. */
export function psqlAdmin(url: string): Admin {
  const connection = new URL(url);
  const env = { ...process.env, PGHOST: connection.hostname, PGPORT: connection.port || "5432",
    PGDATABASE: decodeURIComponent(connection.pathname.slice(1)), PGUSER: decodeURIComponent(connection.username),
    PGPASSWORD: decodeURIComponent(connection.password), PGSSLMODE: connection.searchParams.get("sslmode") ?? "prefer" };
  return async (sql) => {
    try {
      const { stdout } = await exec("psql", ["-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-c", sql], {
        env, maxBuffer: 16 * 1024 * 1024,
      });
      return stdout.trim() ? stdout.trim().split("\n").map((s) => JSON.parse(s) as Record<string, unknown>) : [];
    } catch { throw new Error("Postgres snapshot operation failed; check maintenance connectivity and database sessions"); }
  };
}

async function metadata(admin: Admin, name: string) {
  const [row] = await admin(`SELECT row_to_json(d) FROM (SELECT oid::text, datallowconn, pg_get_userbyid(datdba) AS owner FROM pg_database WHERE datname=${literal(name)}) d`);
  if (!row) throw new Error(`database ${name} is missing`);
  return row;
}

export async function connections(admin: Admin, name: string, allowed: boolean): Promise<void> {
  await admin(`ALTER DATABASE ${identifier(name)} ALLOW_CONNECTIONS ${allowed ? "true" : "false"}`);
}

export async function checkTemplate(admin: Admin, database: Database): Promise<void> {
  const m = await metadata(admin, database.name);
  if (m.oid !== database.oid || m.datallowconn !== false) throw new Error("snapshot database identity or connection fence changed");
}

/** Caller has drained and stopped every writer. Never terminate an unknown session to make a copy succeed. */
export async function cloneDatabase(admin: Admin, source: string, target: string): Promise<Database> {
  if (source === target) throw new Error("source and target databases must differ");
  const m = await metadata(admin, source);
  await connections(admin, source, false);
  let created = false;
  try {
    const [sessions] = await admin(`SELECT row_to_json(s) FROM (SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=${literal(source)}) s`);
    if (sessions?.n !== 0) throw new Error(`database ${source} still has sessions; stop Core and Ponder before snapshotting`);
    await admin(`CREATE DATABASE ${identifier(target)} WITH TEMPLATE ${identifier(source)} OWNER ${identifier(String(m.owner))} ALLOW_CONNECTIONS false`);
    created = true;
    // CREATE DATABASE copies schema/table ACLs, but NOT database CONNECT/CREATE/TEMP ACLs.
    await admin(`REVOKE ALL ON DATABASE ${identifier(target)} FROM PUBLIC, ${identifier(String(m.owner))}`);
    const grants = await admin(`SELECT row_to_json(g) FROM (SELECT CASE WHEN a.grantee=0 THEN NULL ELSE pg_get_userbyid(a.grantee) END AS role, a.privilege_type AS privilege, a.is_grantable AS grantable FROM pg_database d, LATERAL aclexplode(coalesce(d.datacl,acldefault('d',d.datdba))) a WHERE d.datname=${literal(source)}) g`);
    for (const grant of grants) {
      if (!["CONNECT", "CREATE", "TEMPORARY"].includes(String(grant.privilege))) throw new Error("unexpected database privilege");
      await admin(`GRANT ${grant.privilege} ON DATABASE ${identifier(target)} TO ${grant.role === null ? "PUBLIC" : identifier(String(grant.role))}${grant.grantable ? " WITH GRANT OPTION" : ""}`);
    }
    return { name: target, oid: String((await metadata(admin, target)).oid) };
  } catch (error) {
    if (created) await dropDatabase(admin, target);
    throw error;
  } finally {
    if (m.datallowconn === true) await connections(admin, source, true);
  }
}

export async function dropDatabase(admin: Admin, name: string): Promise<void> {
  await admin(`DROP DATABASE ${identifier(name)}`);
}

export async function renameDatabase(admin: Admin, from: string, to: string): Promise<void> {
  await connections(admin, from, false);
  await admin(`ALTER DATABASE ${identifier(from)} RENAME TO ${identifier(to)}`);
}
