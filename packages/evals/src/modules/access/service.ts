import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { Database, readSnapshotCut } from "../../../../backend/src/devnet/door.ts";
import type { Sql } from "../../../../backend/src/platform/db.ts";
import { fixtureFrom } from "../acceptance/fixture.ts";

export type SchemaSpec = {
  fields: Record<string, readonly [type: string, nullable: boolean]>;
  indexes: readonly { columns: string[]; unique: boolean; primary?: boolean }[];
  /** The blueprint's literal sets, each enforced by a validated check constraint. */
  enums: Record<string, readonly string[]>;
};

/** Read-only selected-world connection. No provisioning, admin fallback or actor fabrication. */
export async function selected(slug: string): Promise<Database> {
  const run = process.env.CAPXUL_EVAL_RUN_DIR, path = process.env.CAPXUL_WORLD_CONFIG;
  assert(run && path && process.env.CAPXUL_ACCEPTANCE_FIXTURE, "running receipt, world config and actual fixture required");
  const receipt = JSON.parse(readFileSync(join(run, "receipt.json"), "utf8"));
  assert.equal(receipt.state, "running");
  assert.equal(receipt.environment.world, "slice-zero");
  assert.equal(receipt.environment.stack, "postgres-ponder-erpnext-v4");
  assert.equal(receipt.environment.storage, "postgres"); assert.equal(receipt.environment.indexer, "ponder");
  assert.equal(statSync(path).mode & 0o077, 0, "world config must be private");
  const config = JSON.parse(readFileSync(path, "utf8"));
  assert.equal(config.version, 1); assert(config.world?.id && config.world.id !== "main");
  assert(/^[a-z][a-z0-9_]{0,62}$/.test(config.world.database));
  assert(Number.isSafeInteger(config.world.epoch) && config.world.epoch > 0);
  assert.equal(receipt.commit, config.codeVersion);
  assert.equal(receipt.environment.components.core, config.codeVersion);
  const fixture = fixtureFrom(process.env.CAPXUL_ACCEPTANCE_FIXTURE!, slug);
  assert.equal(fixture.world, receipt.environment.world);
  const ready = await fetch(new URL("/ready", fixture.coreUrl), { signal: AbortSignal.timeout(10_000) });
  assert(ready.ok, "actual Core/Ponder readiness required");
  const readiness = await ready.json() as { ok: boolean; world: string; storage: string; indexer: string };
  assert.equal(readiness.ok, true); assert.equal(readiness.world, config.world.id);
  assert.equal(readiness.storage, "postgres"); assert.equal(readiness.indexer, "ponder");
  const url = (value: string, role: string) => {
    const u = new URL(value);
    assert.equal(decodeURIComponent(u.username), role); assert(u.password);
    assert(["127.0.0.1", "localhost", "[::1]"].includes(u.hostname), "local selected database required");
    u.pathname = `/${config.world.database}`;
    return u.href;
  };
  const db = new Database(url(config.database.tenant, "capxul_core"), url(config.database.worker, "capxul_worker"));
  try {
    const cut = await readSnapshotCut(db);
    assert.equal(cut.world_id, config.world.id); assert.equal(cut.epoch, config.world.epoch);
    await db.transaction("", async (sql) => {
      const row = (await sql.query("select current_database() as database,r.rolsuper,r.rolbypassrls from pg_roles r where rolname=current_user")).rows[0];
      assert.equal(row.database, config.world.database); assert.equal(row.rolsuper, false); assert.equal(row.rolbypassrls, false);
    });
    return db;
  } catch (error) { await db.close(); throw error; }
}

/** Independent expectation describes fields and index semantics, not the migration's own SQL. */
export async function inspectSchema(sql: Sql, table: string, expected: SchemaSpec) {
  const rows = (await sql.query(`select a.attname as name,format_type(a.atttypid,a.atttypmod) as type,not a.attnotnull as nullable
    from pg_attribute a where a.attrelid=to_regclass($1) and a.attnum>0 and not a.attisdropped order by a.attnum`, [`app.${table}`])).rows;
  assert.deepEqual(Object.fromEntries(rows.map((r) => [r.name, [r.type, r.nullable]])), expected.fields, `${table}: exact fields/types/nullability`);
  const indexes = (await sql.query(`select i.indisprimary as primary,i.indisunique as unique,i.indpred is not null as partial,
    array(select a.attname::text from unnest(i.indkey) with ordinality k(n,pos)
      join pg_attribute a on a.attrelid=i.indrelid and a.attnum=k.n order by k.pos) as columns
    from pg_index i where i.indrelid=to_regclass($1)`, [`app.${table}`])).rows;
  const canonical = (items: unknown[]) => items.map((v) => JSON.stringify(v)).sort();
  assert.deepEqual(canonical(indexes.map((r) => ({ columns: r.columns, unique: r.unique, primary: r.primary, partial: r.partial }))),
    canonical(expected.indexes.map((r) => ({ columns: r.columns, unique: r.unique, primary: r.primary ?? false, partial: false }))), `${table}: exact key/index semantics`);
  const rls = (await sql.query("select relrowsecurity,relforcerowsecurity from pg_class where oid=to_regclass($1)", [`app.${table}`])).rows[0];
  assert(rls.relrowsecurity && rls.relforcerowsecurity, `${table}: forced restricted-role RLS`);
  const checks = (await sql.query("select pg_get_constraintdef(oid) as def from pg_constraint where conrelid=to_regclass($1) and contype='c' and convalidated",
    [`app.${table}`])).rows.map((r) => r.def as string);
  for (const [field, values] of Object.entries(expected.enums)) {
    // Each declared literal set is one validated `field = ANY (ARRAY[...])` constraint with exactly these values.
    const found = checks.flatMap((def) => [...def.matchAll(new RegExp(`\\(${field} = ANY \\(ARRAY\\[([^\\]]*)\\]\\)\\)`, "g"))].map((m) =>
      [...m[1]!.matchAll(/'([^']*)'::text/g)].map((v) => v[1]).sort()));
    assert.deepEqual(found, [[...values].sort()], `${table}.${field}: exactly one validated enum constraint with the declared values`);
  }
}

export async function runSchemaChecks(checks: Record<string, { table: string; spec: SchemaSpec }>) {
  const names = Object.keys(checks);
  if (process.argv.includes("--list")) { for (const name of names) console.log(`${name}\tcheck`); return; }
  let db: Database | undefined, failure = false;
  try { db = await selected(process.argv[2]!); } catch { failure = true; }
  for (const [name, value] of Object.entries(checks)) {
    const start = Date.now(); let pass = false;
    if (db) {
      try { await db.transaction("", (sql) => inspectSchema(sql, value.table, value.spec)); pass = true; }
      catch { failure = true; }
    }
    console.log(`@check\t${name}\t${pass ? "pass" : "fail"}\t${Date.now() - start}\t${pass ? "exact fields/types/key/indexes and forced RLS observed" : "selected-world prerequisite or schema assertion failed; no credential output"}`);
  }
  await db?.close(); process.exitCode = failure ? 1 : 0;
}
