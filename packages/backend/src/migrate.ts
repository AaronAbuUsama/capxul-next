import { readFileSync } from "node:fs";
import pg from "pg";
import { migrateSites } from "@capxul/site-service";
import { migrateAccess } from "./access/door.ts";
import { migrateAccounts } from "./accounts/door.ts";
import { migrateActivity } from "./activity/door.ts";
import { migrateApprovals } from "./approvals/migrate.ts";
import { migratePayments } from "./payments/door.ts";
import { required } from "./platform/config.ts";
import { migrateOutbox } from "./platform/outbox.ts";

const admin = new URL(required("PG_ADMIN_URL"));
const connections = ["DATABASE_URL", "WORKER_DATABASE_URL", "PONDER_DATABASE_URL"].map((name) => new URL(required(name)));
const roles = ["capxul_core", "capxul_worker", "capxul_ponder"];
const quote = (s: string) => `'${s.replaceAll("'", "''")}'`;
admin.pathname = connections[0]!.pathname;
const db = new pg.Client({ connectionString: admin.href });
await db.connect();
try {
  await db.query("BEGIN");
  await db.query("select pg_advisory_xact_lock(68402317)");
  for (const [i, url] of connections.entries()) {
    if (url.pathname !== admin.pathname || url.hostname !== admin.hostname || url.port !== admin.port || decodeURIComponent(url.username) !== roles[i]) {
      throw new Error(`runtime URL ${i} must use role ${roles[i]} on the admin URL's database`);
    }
    if (!url.password) throw new Error(`runtime role ${roles[i]} needs a password`);
    const role = roles[i]!;
    const exists = await db.query("select 1 from pg_roles where rolname=$1", [role]);
    if (!exists.rowCount) await db.query(`create role ${role} login nosuperuser nocreatedb nocreaterole noinherit nobypassrls`);
    await db.query(`alter role ${role} nosuperuser nocreatedb nocreaterole noinherit nobypassrls password ${quote(decodeURIComponent(url.password))}`);
  }
  await db.query(readFileSync(new URL("./schema.sql", import.meta.url), "utf8"));
  await db.query(readFileSync(new URL("./parties/schema.sql", import.meta.url), "utf8"));
  await db.query("create schema if not exists ponder authorization capxul_ponder");
  // Ponder creates its versioned ponder_sync schema itself; it cannot alter/write the admin-owned app schema.
  await db.query((await db.query("select format('grant create on database %I to capxul_ponder',current_database()) as sql")).rows[0].sql);
  await db.query("grant usage on schema app to capxul_core, capxul_worker");
  await db.query("grant select on app.schema_version to capxul_core, capxul_worker");
  const tables = ["organizations", "people", "hats", "approvals", "site_events", "consumed_facts", "site_request_answers", "transaction_traces", "records"];
  for (const table of tables) {
    await db.query(`alter table app.${table} enable row level security; alter table app.${table} force row level security`);
    await db.query(`drop policy if exists tenant on app.${table}`);
    await db.query(`create policy tenant on app.${table} to capxul_core, capxul_worker
      using (org_id=current_setting('app.org_id', true) or current_user='capxul_worker')
      with check (org_id=current_setting('app.org_id', true) or current_user='capxul_worker')`);
    await db.query(`grant select, insert, update on app.${table} to capxul_core, capxul_worker`);
  }
  // Records are append-only even to the system worker.
  await db.query("revoke update on app.records from capxul_core, capxul_worker");
  await db.query("grant select on app.world, app.world_record to capxul_core");
  await db.query("grant select,update on app.world to capxul_worker; grant select,insert on app.world_record to capxul_worker");
  await db.query("grant select,insert,update on app.indexer_observation to capxul_worker");
  await db.query("insert into app.world (world_id) values ($1) on conflict do nothing", [process.env.CAPXUL_WORLD ?? "main"]);
  await db.query("grant usage on all sequences in schema app to capxul_core, capxul_worker");
  await db.query("grant usage on schema ponder to capxul_worker");
  await db.query("alter default privileges for role capxul_ponder in schema ponder grant select on tables to capxul_worker");
  await db.query("grant select on all tables in schema ponder to capxul_worker");
  // Concept schemas, in dependency order: payments emit through the outbox and read approvals; Activity follows payments.
  // Access emits sign-in events through the outbox; Accounts references principals; later concepts read both.
  await migrateApprovals(db); await migrateOutbox(db); await migrateAccess(db); await migrateAccounts(db);
  await migratePayments(db); await migrateActivity(db);
  // Sites' rows, features and document-call receipts reference organizations, so they follow every organizations schema.
  await migrateSites(db);
  // The world's one durable Mail sink (Access sign-in and Notices) is created here, once, with the world; never on up or restore.
  if (process.env.CAPXUL_MAIL_SINK === "devnet") {
    const { migrateMailSink } = await import("../../devnet/src/devnet/door.ts");
    await migrateMailSink(async (text) => (([] as pg.QueryResult[]).concat(await db.query(text) as unknown as pg.QueryResult)).flatMap((r) => r.rows));
  }
  await db.query("COMMIT");
  console.log("Core schema v1 migrated; separate non-superuser tenant, worker and Ponder roles");
} catch (error) { await db.query("ROLLBACK"); throw error; }
finally { await db.end(); }
