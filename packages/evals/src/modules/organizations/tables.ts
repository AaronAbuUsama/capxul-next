import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { Schema } from "effect";
import * as org from "../../../../../blueprint/organizations/data.ts";
import { table_parties } from "../../../../../blueprint/parties/data.ts";
import type { Database, Sql } from "../../../../backend/src/platform/db.ts";

/** The expected shape is read from the blueprint record itself, never from the migration under test. */
type TableRecord = { id: string; key: readonly string[]; fields: { fields: Record<string, Schema.Top> };
  indexes: readonly { name: string; fields: readonly string[]; unique?: boolean }[] };
export const ORG_TABLES = [org.table_organizations, org.table_org_setups, org.table_org_deployments, org.table_org_members,
  org.table_org_seat_purchases, org.table_org_apps, org.table_org_fdes] as unknown as readonly TableRecord[];
export const PARTY_TABLES = [table_parties] as unknown as readonly TableRecord[];
const RUNTIME = ["capxul_core", "capxul_ponder", "capxul_worker"];
const relation = (t: TableRecord) => `app.${t.id.replaceAll("-", "_")}`;

async function refused(sql: Sql, attempt: string, values: unknown[], code: string) {
  await sql.query("savepoint organizations_probe");
  try {
    await sql.query(attempt, values);
    assert.fail(`accepted: ${attempt.split(" ").slice(0, 3).join(" ")}`);
  } catch (error) { assert.equal((error as { code?: string }).code, code); }
  finally { await sql.query("rollback to savepoint organizations_probe"); }
  return { attempt: attempt.split(" ").slice(0, 3).join(" "), code };
}

/** tbl:<id>/schema: exactly the record's fields (names, order, nullability), its key and its indexes; admin-owned. */
export async function schema(database: Database, dir: string, t: TableRecord) {
  const name = t.id.replaceAll("-", "_");
  const columns = (await database.worker.query(`select column_name as name,is_nullable='YES' as nullable from information_schema.columns
    where table_schema='app' and table_name=$1 order by ordinal_position`, [name])).rows;
  assert.deepEqual(columns, Object.entries(t.fields.fields).map(([field, s]) => ({ name: field, nullable: Schema.is(s as Schema.Codec<unknown>)(null) })));
  const indexes = (await database.worker.query(`select i.indisprimary as primary,i.indisunique as unique,
    array(select a.attname::text from unnest(i.indkey) with ordinality k(attnum,n)
      join pg_attribute a on a.attrelid=i.indrelid and a.attnum=k.attnum order by k.n) as fields
    from pg_index i where i.indrelid=$1::regclass and i.indexprs is null`, [relation(t)])).rows;
  const shape = (rows: { primary: boolean; unique: boolean; fields: readonly string[] }[]) => rows.map((r) => JSON.stringify(r)).sort();
  assert.equal(indexes.length, (await database.worker.query("select count(*)::int as n from pg_index where indrelid=$1::regclass", [relation(t)])).rows[0].n,
    "no expression index the record cannot name (a partial one is named by its fields; its `for` says the predicate)");
  assert.deepEqual(shape(indexes), shape([{ primary: true, unique: true, fields: t.key },
    ...t.indexes.map((i) => ({ primary: false, unique: !!i.unique, fields: i.fields }))]));
  const owner = (await database.worker.query("select pg_get_userbyid(relowner) as name from pg_class where oid=$1::regclass", [relation(t)])).rows[0].name;
  assert(!RUNTIME.includes(owner), "a runtime role must not own (and so alter) the table");
  writeFileSync(join(dir, `${t.id}.schema.json`), JSON.stringify({ columns, indexes, runtimeOwned: false }) + "\n");
}

/** tbl:<id>/writers: Core reads only; the worker, which runs the procedures and workflows that list the table in writes,
 * inserts and updates; nothing deletes or truncates, by grant and by actual attempt. */
export async function writers(database: Database, dir: string, t: TableRecord) {
  const privileges = (await database.worker.query(`select r as role,
    has_table_privilege(r,$1,'SELECT') as read, has_table_privilege(r,$1,'INSERT') as insert,
    has_table_privilege(r,$1,'UPDATE') as update, has_table_privilege(r,$1,'DELETE') as delete,
    has_table_privilege(r,$1,'TRUNCATE') as truncate from unnest($2::text[]) r order by r`, [relation(t), RUNTIME])).rows;
  assert.deepEqual(privileges, [
    { role: "capxul_core", read: true, insert: false, update: false, delete: false, truncate: false },
    { role: "capxul_ponder", read: false, insert: false, update: false, delete: false, truncate: false },
    { role: "capxul_worker", read: true, insert: true, update: true, delete: false, truncate: false },
  ]);
  const attempts = [];
  for (const [pool, statements] of [
    [database.tenant, [`insert into ${relation(t)} default values`, `update ${relation(t)} set ${t.key[0]}=${t.key[0]} where false`]],
    [database.worker, [`delete from ${relation(t)} where false`, `truncate ${relation(t)}`]],
  ] as const) {
    const client = await pool.connect();
    try {
      await client.query("begin");
      for (const statement of statements) attempts.push(await refused(client, statement, [], "42501"));
    } finally { await client.query("rollback"); client.release(); }
  }
  writeFileSync(join(dir, `${t.id}.writers.json`), JSON.stringify({ privileges, attempts }) + "\n");
}

export type Member = { org_id: string; person_id: string };
/** Organizations with a member who holds a Seat in no other Organization and founded no other setup, at one cut. */
export type Cut = { snapshot: string; observe: Sql; release: () => Promise<void>; members: Member[] };
export async function members(database: Database): Promise<Cut> {
  const observer = await database.worker.connect();
  await observer.query("begin isolation level repeatable read read only");
  const snapshot = (await observer.query("select pg_export_snapshot() as snapshot")).rows[0].snapshot as string;
  assert(/^[0-9A-F-]+$/.test(snapshot));
  const rows = (await observer.query(`select distinct on (m.org_id) m.org_id,m.principal_id as person_id from app.org_members m
    where m.status='active' and m.kind='human' and m.principal_id is not null
    and not exists (select 1 from app.org_members o where o.principal_id=m.principal_id and o.org_id<>m.org_id)
    and not exists (select 1 from app.org_setups s where s.founder_principal_id=m.principal_id and s.org_id<>m.org_id)
    order by m.org_id,m.joined_at,m.member_id`)).rows as Member[];
  assert(rows.length >= 2, "the selected world needs two Organizations, each with a member of it alone");
  return { snapshot, observe: observer, members: rows, release: async () => { await observer.query("rollback"); observer.release(); } };
}

/** tbl:<id>/tenancy: RLS is forced; at one cut, each Organization's member reads every row of its own Organization and
 * none of another's, and is refused every write to either. */
export async function tenancy(database: Database, dir: string, t: TableRecord, cut: Cut) {
  const rls = (await database.worker.query("select relrowsecurity,relforcerowsecurity from pg_class where oid=$1::regclass", [relation(t)])).rows[0];
  assert.deepEqual(rls, { relrowsecurity: true, relforcerowsecurity: true });
  const owners = (await cut.observe.query(`select count(distinct org_id)::int as n from ${relation(t)} where org_id=any($1)`,
    [cut.members.map((m) => m.org_id)])).rows[0].n;
  assert(owners >= 2, "rows of at least two of the Organizations, or nothing is separated");
  const evidence = [];
  for (const member of cut.members) {
    const client = await database.tenant.connect();
    try {
      await client.query("begin isolation level repeatable read");
      await client.query(`set transaction snapshot '${cut.snapshot}'`);
      await client.query("select set_config('app.person_id',$1,true)", [member.person_id]);
      const seen = (await client.query(`select org_id,count(*)::int as n from ${relation(t)} group by org_id order by org_id`)).rows;
      const own = (await cut.observe.query(`select count(*)::int as n from ${relation(t)} where org_id=$1`, [member.org_id])).rows[0].n;
      const others = cut.members.filter((m) => m.org_id !== member.org_id).map((m) => m.org_id);
      assert.deepEqual(seen, own ? [{ org_id: member.org_id, n: own }] : [], "every row of its own Organization and none of another's");
      const attempts = [];
      for (const target of [member.org_id, others[0]!]) {
        attempts.push(await refused(client, `update ${relation(t)} set org_id=org_id where org_id=$1`, [target], "42501"));
        attempts.push(await refused(client, `delete from ${relation(t)} where org_id=$1`, [target], "42501"));
      }
      evidence.push({ org: member.org_id, seen, attempts });
    } finally { await client.query("rollback"); client.release(); }
  }
  writeFileSync(join(dir, `${t.id}.tenancy.json`), JSON.stringify(evidence) + "\n");
  return evidence;
}
