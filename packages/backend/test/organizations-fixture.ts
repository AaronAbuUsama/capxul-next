import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { after, before } from "node:test";
import pg from "pg";
import { Database } from "../src/platform/db.ts";
import { migrateOutbox } from "../src/platform/outbox.ts";
import { migrate } from "../src/organizations/door.ts";

// Component regression on a disposable database: the outbox, Access, Accounts, Parties and Organizations
// migrations in their composition order. Not selected-stack acceptance.
const url = process.env.ORGANIZATIONS_TEST_ADMIN_URL;
if (!url || process.env.CAPXUL_DISPOSABLE !== "true" || !new URL(url).pathname.startsWith("/organizations_"))
  throw new Error("ORGANIZATIONS_TEST_ADMIN_URL must name a disposable /organizations_* Postgres database");
const adminUrl: string = url;
const admin = new pg.Client({ connectionString: adminUrl });
export let db: Database;
let settle!: { resolve: () => void; reject: (error: unknown) => void };
/** Root before hooks start without awaiting earlier async hooks: a test's own setup awaits this first. */
export const ready = new Promise<void>((resolve, reject) => { settle = { resolve, reject }; });
ready.catch(() => {});

before(async () => { try { await provision(); settle.resolve(); } catch (error) { settle.reject(error); throw error; } });
async function provision() {
  await admin.connect();
  const roles = [{ role: "capxul_core", env: "ORGANIZATIONS_TEST_TENANT" }, { role: "capxul_worker", env: "ORGANIZATIONS_TEST_WORKER" }];
  const existing = (await admin.query("select rolname from pg_roles where rolname=any($1)", [roles.map(({ role }) => role)])).rows;
  // Roles are cluster-wide: never reset another database's password; an existing role needs supplied credentials.
  for (const { role, env } of roles)
    if (existing.some((row) => row.rolname === role) && !process.env[env])
      throw new Error(`${env} must supply existing ${role} credentials for the disposable database`);
  for (const { role, env } of roles) {
    if (!existing.some((row) => row.rolname === role)) {
      const password = randomBytes(24).toString("hex");
      await admin.query(`create role ${role} login nosuperuser nocreatedb nocreaterole noinherit nobypassrls password '${password}'`);
      const target = new URL(adminUrl); target.username = role; target.password = password;
      process.env[env] = target.href;
    }
    const target = new URL(process.env[env]!), origin = new URL(adminUrl);
    assert.equal(target.host, origin.host, `${env} must use the disposable Postgres instance`);
    assert.equal(target.pathname, origin.pathname, `${env} must use the disposable database`);
    const client = new pg.Client({ connectionString: target.href });
    try {
      await client.connect();
      assert.deepEqual((await client.query("select current_user as role,rolsuper,rolbypassrls from pg_roles where rolname=current_user")).rows[0],
        { role, rolsuper: false, rolbypassrls: false });
    } finally { await client.end(); }
  }
  const sql = (path: string) => readFile(new URL(path, import.meta.url), "utf8");
  await admin.query("begin");
  try {
    // The target organizations table replaces the legacy Core one, which its migration refuses to sit beside.
    await admin.query("create schema app; grant usage on schema app to capxul_core,capxul_worker");
    await migrateOutbox(admin);
    for (const path of ["../src/access/schema.sql", "../src/accounts/schema.sql", "../src/parties/schema.sql"]) await admin.query(await sql(path));
    await migrate(admin);
    await admin.query("commit");
  } catch (error) { await admin.query("rollback"); throw error; }
  db = new Database(process.env.ORGANIZATIONS_TEST_TENANT!, process.env.ORGANIZATIONS_TEST_WORKER!);
}
after(async () => { if (db) await db.close(); await admin.end(); });
