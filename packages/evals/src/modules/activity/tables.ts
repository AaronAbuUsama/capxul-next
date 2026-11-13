import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Database, Owner, Sql } from "../../../../backend/src/platform/db.ts";

type Feed = { owner_kind: Owner["kind"]; owner_id: string };
const COLUMNS = "owner_id,owner_kind,seq,row_kind,row_id,change,transition,\"from\",\"to\",event_id,changed_at";

/** Runs `attempt` in a savepoint and expects Postgres to refuse it with `code` (and `constraint`, when named). */
async function refused(sql: Sql, attempt: string, values: unknown[], code: string, constraint?: string) {
  await sql.query("savepoint activity_probe");
  try {
    await sql.query(attempt, values);
    assert.fail(`accepted: ${attempt.split(" ").slice(0, 3).join(" ")}`);
  } catch (error) {
    const e = error as { code?: string; constraint?: string };
    assert.equal(e.code, code);
    if (constraint) assert.equal(e.constraint, constraint);
  } finally { await sql.query("rollback to savepoint activity_probe"); }
  return { attempt: attempt.split(" ").slice(0, 3).join(" "), code, constraint: constraint ?? null };
}

export async function schema(database: Database, dir: string) {
  const columns = (await database.worker.query(`select column_name,data_type,is_nullable from information_schema.columns
    where table_schema='app' and table_name='activity_changes' order by ordinal_position`)).rows;
  assert.deepEqual(columns, [
    ["owner_id", "text", "NO"], ["owner_kind", "text", "NO"], ["seq", "bigint", "NO"],
    ["row_kind", "text", "NO"], ["row_id", "text", "NO"], ["change", "text", "NO"],
    ["transition", "text", "NO"], ["from", "text", "YES"], ["to", "text", "NO"],
    ["event_id", "text", "NO"], ["changed_at", "double precision", "NO"],
  ].map(([column_name, data_type, is_nullable]) => ({ column_name, data_type, is_nullable })));
  const indexes = (await database.worker.query(`select i.indisprimary as primary,i.indisunique as unique,
    array(select a.attname::text from unnest(i.indkey) with ordinality k(attnum,n)
      join pg_attribute a on a.attrelid=i.indrelid and a.attnum=k.attnum order by k.n) as fields
    from pg_index i where i.indrelid='app.activity_changes'::regclass order by i.indisprimary desc,i.indisunique`)).rows;
  assert.deepEqual(indexes, [
    { primary: true, unique: true, fields: ["owner_id", "owner_kind", "seq"] },
    { primary: false, unique: false, fields: ["owner_id", "owner_kind", "row_kind", "row_id", "seq"] },
    { primary: false, unique: true, fields: ["owner_id", "owner_kind", "event_id"] },
  ]);
  // World creation migrates as the admin owner; no runtime role created (or can alter) the table at startup.
  const owner = (await database.worker.query("select pg_get_userbyid(relowner) as name from pg_class where oid='app.activity_changes'::regclass")).rows[0].name;
  assert(!["capxul_core", "capxul_worker", "capxul_ponder"].includes(owner));
  writeFileSync(join(dir, "schema.json"), JSON.stringify({ columns, indexes, runtimeOwned: false }) + "\n");
}

/** The declared checks, NOT NULLs and both unique keys refuse bad rows. Every attempt rolls back. */
export async function constraints(database: Database, dir: string, run: string) {
  const client = await database.worker.connect();
  const owner = `activity-eval-${run}`;
  try {
    await client.query("begin");
    const row = (over: Record<string, unknown>) => {
      const base: Record<string, unknown> = { owner_id: owner, owner_kind: "person", seq: 1, row_kind: "payment", row_id: "probe",
        change: "new", transition: "open", from: null, to: "prepared", event_id: `${owner}:1`, changed_at: 0 };
      return Object.values({ ...base, ...over });
    };
    const insert = `insert into app.activity_changes (${COLUMNS}) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`;
    await client.query(insert, row({})); // A valid row (with a null `from`) is accepted.
    const cases = [
      await refused(client, insert, row({ seq: 2, event_id: "x2", owner_kind: "agent" }), "23514", "activity_changes_owner_kind_check"),
      await refused(client, insert, row({ seq: 0, event_id: "x3" }), "23514", "activity_changes_seq_check"),
      await refused(client, insert, row({ seq: 2, event_id: "x4", row_kind: "invoice" }), "23514", "activity_changes_row_kind_check"),
      await refused(client, insert, row({ seq: 2, event_id: "x5", change: "deleted" }), "23514", "activity_changes_change_check"),
      await refused(client, insert, row({ event_id: "other" }), "23505", "activity_changes_pkey"),
      await refused(client, insert, row({ seq: 2 }), "23505", "activity_changes_by_owner_event"),
    ];
    for (const column of ["owner_id", "owner_kind", "seq", "row_kind", "row_id", "change", "transition", "to", "event_id", "changed_at"]) {
      cases.push(await refused(client, insert, row({ seq: 2, event_id: `null-${column}`, [column]: null }), "23502"));
    }
    await client.query("rollback");
    assert.equal((await database.worker.query("select count(*)::int as n from app.activity_changes where owner_id=$1", [owner])).rows[0].n, 0);
    writeFileSync(join(dir, "constraints.json"), JSON.stringify(cases) + "\n");
  } finally { await client.query("rollback"); client.release(); }
}

/** Feeds at one MVCC cut; each owner's scoped read equals exactly its rows, and resets with its transaction. */
export async function tenancy(database: Database, dir: string): Promise<Feed[]> {
  const rls = (await database.worker.query("select relrowsecurity,relforcerowsecurity from pg_class where oid='app.activity_changes'::regclass")).rows[0];
  assert.deepEqual(rls, { relrowsecurity: true, relforcerowsecurity: true });
  const observer = await database.worker.connect();
  try {
    // Compare roles at one actual MVCC cut, even if the background relay appends during inspection.
    await observer.query("begin isolation level repeatable read read only");
    const snapshot = (await observer.query("select pg_export_snapshot() as snapshot")).rows[0].snapshot as string;
    assert(/^[0-9A-F-]+$/.test(snapshot));
    const all = (await observer.query("select * from app.activity_changes order by owner_kind,owner_id,seq")).rows;
    const feeds: Feed[] = [...new Map(all.map((r) => [JSON.stringify([r.owner_kind, r.owner_id]), { owner_kind: r.owner_kind, owner_id: r.owner_id }])).values()];
    assert(feeds.length >= 2 && feeds.some((r) => r.owner_kind === "person") && feeds.some((r) => r.owner_kind === "organization"));
    const evidence = [];
    for (const feed of feeds) {
      const client = await database.tenant.connect();
      try {
        await client.query("begin isolation level repeatable read read only");
        await client.query(`set transaction snapshot '${snapshot}'`);
        await client.query("select set_config('app.owner_kind',$1,true),set_config('app.owner_id',$2,true)", [feed.owner_kind, feed.owner_id]);
        const actual = (await client.query("select * from app.activity_changes order by owner_kind,owner_id,seq")).rows;
        assert.deepEqual(actual, all.filter((r) => r.owner_kind === feed.owner_kind && r.owner_id === feed.owner_id));
        await client.query("commit");
        assert.equal((await client.query("select * from app.activity_changes")).rowCount, 0);
        evidence.push({ ...feed, rows: actual.length });
      } finally { await client.query("rollback"); client.release(); }
    }
    writeFileSync(join(dir, "tenancy.json"), JSON.stringify(evidence) + "\n");
    return feeds;
  } finally { await observer.query("rollback"); observer.release(); }
}

/** A second owner, scoped by Core's own owner transaction, reads none of the first's rows and writes no row at all. */
export async function crossOwner(database: Database, dir: string, feeds: Feed[]) {
  const evidence = [];
  // Every feed is attacked by one other, of the other owner kind where the world has one.
  const pairs = feeds.map((a) => [a, feeds.find((b) => b.owner_kind !== a.owner_kind) ?? feeds.find((b) => b !== a)!] as const);
  for (const [first, second] of pairs) {
    const target = [first.owner_id, first.owner_kind];
    const cases = await database.ownerTransaction({ kind: second.owner_kind, id: second.owner_id }, async (sql) => {
      assert.equal((await sql.query("select count(*)::int as n from app.activity_changes where owner_id=$1 and owner_kind=$2", target)).rows[0].n, 0);
      const own = (await sql.query("select count(*)::int as n from app.activity_changes")).rows[0].n;
      const self = [second.owner_id, second.owner_kind];
      const attempts = [
        await refused(sql, `insert into app.activity_changes (${COLUMNS}) values ($1,$2,1000000,'payment','x','new','open',null,'prepared','x',0)`, target, "42501"),
        await refused(sql, `insert into app.activity_changes (${COLUMNS}) values ($1,$2,1000000,'payment','x','new','open',null,'prepared','x',0)`, self, "42501"),
        await refused(sql, `update app.activity_changes set "to"='forged' where owner_id=$1 and owner_kind=$2`, target, "42501"),
        await refused(sql, `update app.activity_changes set "to"='forged' where owner_id=$1 and owner_kind=$2`, self, "42501"),
        await refused(sql, "delete from app.activity_changes where owner_id=$1 and owner_kind=$2", target, "42501"),
        await refused(sql, "delete from app.activity_changes where owner_id=$1 and owner_kind=$2", self, "42501"),
        await refused(sql, "truncate app.activity_changes", [], "42501"),
      ];
      return { own, attempts };
    });
    evidence.push({ reader: second, target: first, ...cases });
  }
  assert(evidence.length >= 2);
  writeFileSync(join(dir, "cross-owner.json"), JSON.stringify(evidence) + "\n");
}

/** Only the worker appends; no runtime role may change or remove a row, by grant and by actual attempt. */
export async function writerAcl(database: Database, dir: string) {
  const privileges = (await database.worker.query(`select r as role,
    has_table_privilege(r,'app.activity_changes','SELECT') as read,
    has_table_privilege(r,'app.activity_changes','INSERT') as insert,
    has_table_privilege(r,'app.activity_changes','UPDATE') as update,
    has_table_privilege(r,'app.activity_changes','DELETE') as delete,
    has_table_privilege(r,'app.activity_changes','TRUNCATE') as truncate
    from unnest(array['capxul_core','capxul_worker','capxul_ponder']) r order by r`)).rows;
  assert.deepEqual(privileges, [
    { role: "capxul_core", read: true, insert: false, update: false, delete: false, truncate: false },
    { role: "capxul_ponder", read: false, insert: false, update: false, delete: false, truncate: false },
    { role: "capxul_worker", read: true, insert: true, update: false, delete: false, truncate: false },
  ]);
  const client = await database.worker.connect();
  try {
    await client.query("begin");
    const attempts = [
      await refused(client, `update app.activity_changes set "to"="to" where false`, [], "42501"),
      await refused(client, "delete from app.activity_changes where false", [], "42501"),
      await refused(client, "truncate app.activity_changes", [], "42501"),
    ];
    writeFileSync(join(dir, "writer-acl.json"), JSON.stringify({ privileges, workerAttempts: attempts }) + "\n");
  } finally { await client.query("rollback"); client.release(); }
}
