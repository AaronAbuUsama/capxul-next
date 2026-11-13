import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { Database, Sql } from "../../../../backend/src/platform/db.ts";
import type { MoneySide } from "../../../../backend/src/books/door.ts";
import { assertWriters } from "./source.ts";

/** inv:books.facts-append-only (static): no source writer, no grant, and the restricted roles are refused. */
export async function appendOnly(db: Database, org: string) {
  const source = assertWriters("books", "book_facts");
  const edits = source.inspected.filter((file) => /\b(?:update|delete\s+from|truncate(?:\s+table)?)\s+app\.book_facts\b/i
    .test(readFileSync(file, "utf8")));
  assert.deepEqual(edits, [], "no statement updates, deletes or truncates book_facts");
  const privileges = (await db.worker.query(`select r.role, p.privilege, has_table_privilege(r.role,'app.book_facts',p.privilege) as granted
    from unnest(array['capxul_core','capxul_worker']) r(role), unnest(array['UPDATE','DELETE','TRUNCATE']) p(privilege)`)).rows;
  assert(privileges.length === 6 && privileges.every((p) => p.granted === false), "no runtime role may edit facts");
  for (const pool of ["tenant", "worker"] as const) for (const statement of ["update app.book_facts set amount_raw=amount_raw where org_id=$1",
    "delete from app.book_facts where org_id=$1"]) {
    await assert.rejects(db.transaction(org, (sql) => sql.query(statement, [org]), pool === "worker"),
      (error: { code?: string }) => error.code === "42501", `${pool}: ${statement}`);
  }
  return { inspected: source.inspected.length, privileges };
}

const standingSql = `select f.money_key, count(*)::int as n from app.book_facts f where f.org_id=$1 and f.money_key is not null
  and f.kind<>'reversed' and not exists (select 1 from app.book_facts r where r.org_id=f.org_id and r.reverses_fact_id=f.fact_id)
  group by f.money_key having count(*)>1`;

/** Control on the live world as committed: every Organization's seq is exactly 1…last_seq and each money key stands once. */
export async function committedWorld(db: Database) {
  const orgs = (await db.worker.query("select org_id from app.organizations order by org_id")).rows.map((r) => String(r.org_id));
  const seen = [];
  for (const org of orgs) seen.push(await db.transaction(org, async (sql) => {
    const last = Number((await sql.query("select last_seq from app.book_feeds where org_id=$1", [org])).rows[0]?.last_seq ?? 0);
    const seqs = (await sql.query("select seq from app.book_facts where org_id=$1 order by seq", [org])).rows.map((r) => Number(r.seq));
    assert.deepEqual(seqs, Array.from({ length: last }, (_, i) => i + 1), `${org}: facts are 1…last_seq`);
    assert.deepEqual((await sql.query(standingSql, [org])).rows, [], `${org}: one live money fact per key`);
    return { org, last };
  }));
  assert(seen.some((s) => s.last > 0), "the world must hold real facts for this control to say anything");
  return seen;
}

const random = (seed: number) => () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
type Op = { kind: "payment" | "movement" | "reverse"; key: string; i: number; abort: boolean };
const plan = (seed: number, keys: readonly string[], count: number, aborts: number): Op[] => {
  const next = random(seed);
  return Array.from({ length: count }, (_, i) => ({ i, key: keys[Math.floor(next() * keys.length)]!, abort: next() < aborts,
    kind: (["payment", "payment", "movement", "movement", "reverse"] as const)[Math.floor(next() * 5)]! }));
};
const sideFor = ({ against: _, ...template }: MoneySide, org: string, op: Op, tag: string): MoneySide => ({ ...template, org_id: org, money_key: op.key,
  kind: "payment_settled", reference: { kind: op.kind === "movement" ? "movement" : "payment", id: `${tag}-${op.i}` },
  source: { kind: op.kind === "movement" ? "movement" : "payment", id: `${tag}-${op.i}` }, actor: { kind: "system", id: null } });

async function apply(sql: Sql, org: string, op: Op, template: MoneySide, tag: string, context: { at: number; traceId: string }) {
  const { recordMoneyFact, reverseMoneyFact } = await import("../../../../backend/src/books/door.ts");
  const result = op.kind === "reverse"
    ? { recorded: [], unchanged: [], superseded: [], ...(await reverseMoneyFact(sql, { money_key: op.key, org_ids: [org], seen_at: context.at, reason: "reorganized" }, context)) }
    : { reversed: [], ...(await recordMoneyFact(sql, { sides: [sideFor(template, org, op, tag)] }, context)) };
  // Read under the feed lock this transaction still holds: the exact point it serialized at.
  const end = Number((await sql.query("select last_seq from app.book_feeds where org_id=$1", [org])).rows[0]?.last_seq ?? 0);
  return { ...result, end };
}

/** Run ops with `width` concurrent transactions; a reader polls throughout and must only ever see a gap-free prefix. */
async function interleave(db: Database, org: string, ops: readonly Op[], width: number, run: (op: Op) => Promise<unknown>) {
  let done = false; const views: number[] = [];
  const reader = (async () => { while (!done) {
    const { n, max } = (await db.transaction(org, (sql) => sql.query("select count(*)::int as n, coalesce(max(seq),0)::int as max from app.book_facts where org_id=$1", [org]))).rows[0]!;
    assert.equal(n, max, "a reader saw a later number before an earlier one"); views.push(max);
  } })();
  const queue = [...ops], results = new Map<number, unknown>();
  await Promise.all(Array.from({ length: width }, async () => { for (let op = queue.shift(); op; op = queue.shift()) results.set(op.i, await run(op)); }));
  done = true; await reader;
  return { results, views };
}

/** Control on real money, all rolled back: each transaction takes last_seq+1 under the lock and leaves no hole. */
export async function rolledBack(db: Database, org: string, key: string, template: MoneySide, at: number, seed: number) {
  const snapshot = () => db.transaction(org, async (sql) => ({
    feed: (await sql.query("select last_seq from app.book_feeds where org_id=$1", [org])).rows[0]?.last_seq ?? 0,
    facts: (await sql.query("select fact_id,seq from app.book_facts where org_id=$1 order by seq", [org])).rows }));
  const before = await snapshot(), abort = new Error("control rollback");
  const ops = plan(seed, [key], 16, 1).map((op) => ({ ...op, abort: true }));
  const { results, views } = await interleave(db, org, ops, 4, (op) => db.transaction(org, async (sql) => {
    const r = await apply(sql, org, op, template, `ctl-${seed}`, { at, traceId: `inv-control-${seed}` });
    const written = (await sql.query("select seq from app.book_facts where org_id=$1 and seq>$2 order by seq", [org, before.feed])).rows.map((x) => Number(x.seq));
    assert.deepEqual(written, Array.from({ length: written.length }, (_, i) => Number(before.feed) + 1 + i), "a rolled back neighbour left no hole");
    throw Object.assign(abort, { result: r });
  }).catch((error) => { assert.equal(error, abort); return "rolled-back"; }));
  assert.equal(results.size, ops.length);
  assert.deepEqual(await snapshot(), before, "every interleaving rolled back without trace");
  return { ops: ops.length, views: views.length };
}

type Model = Map<string, "payment" | "movement" | null>;
/** The procedures' rule (books.money-key): a payment claims a standing Movement; anything else standing is unchanged. */
const step = (model: Model, op: Op) => {
  const old = model.get(op.key) ?? null;
  if (op.kind === "reverse") { model.set(op.key, null); return { recorded: 0, superseded: 0, reversed: old ? 1 : 0 }; }
  if (old && !(old === "movement" && op.kind === "payment")) return { recorded: 0, superseded: 0, reversed: 0 };
  model.set(op.key, op.kind); return { recorded: 1, superseded: old ? 1 : 0, reversed: 0 };
};

/** inv:books.feed-gap-free and inv:books.one-live-money-fact: committed concurrent writers on a throwaway Organization. */
export async function committedProperty(db: Database, org: string, template: MoneySide, at: number, seed: number, count = 48) {
  const tag = `inv-${seed}`, keys = [0, 1, 2, 3].map((k) => `${tag}:key:${k}`);
  const ops = plan(seed, keys, count, 0.15), abort = new Error("intended abort");
  const { results, views } = await interleave(db, org, ops, 6, (op) => db.transaction(org, async (sql) => {
    const r = await apply(sql, org, op, template, tag, { at, traceId: `${tag}-${op.i}` });
    if (op.abort) throw abort;
    return r;
  }).catch((error) => { if (error !== abort) throw error; return null; }));
  return db.transaction(org, async (sql) => {
    const last = Number((await sql.query("select last_seq from app.book_feeds where org_id=$1", [org])).rows[0]!.last_seq);
    const facts = (await sql.query("select fact_id,seq,money_key,source_kind,kind,reverses_fact_id from app.book_facts where org_id=$1 order by seq", [org])).rows;
    assert.deepEqual(facts.map((f) => Number(f.seq)), Array.from({ length: last }, (_, i) => i + 1), "committed facts are 1…last_seq");
    const seqOf = new Map(facts.map((f) => [String(f.fact_id), Number(f.seq)]));
    // Serialize committed transactions where they held the lock: a writer just before its first number, a no-op at its end.
    const committed = ops.flatMap((op) => {
      const r = results.get(op.i) as null | { recorded: string[]; superseded: string[]; reversed: string[]; end: number };
      if (!r) return [];
      const seqs = [...r.recorded, ...r.superseded, ...r.reversed].map((id) => seqOf.get(id)!);
      return [{ op, r, at: seqs.length ? Math.min(...seqs) - 1 : r.end, writer: seqs.length ? 1 : 0 }];
    }).sort((a, b) => a.at - b.at || a.writer - b.writer);
    const model: Model = new Map();
    for (const { op, r } of committed) assert.deepEqual({ recorded: r.recorded.length, superseded: r.superseded.length, reversed: r.reversed.length },
      step(model, op), `op ${op.i} (${op.kind} ${op.key}) differs from the reference model in commit order`);
    assert.deepEqual((await sql.query(standingSql, [org])).rows, [], "at most one standing money fact per key");
    for (const key of keys) {
      const standing = facts.filter((f) => f.money_key === key && f.kind !== "reversed" && !facts.some((r) => r.reverses_fact_id === f.fact_id));
      assert.deepEqual(standing.map((f) => f.source_kind), model.get(key) ? [model.get(key)] : [], `${key} stands as the model says`);
    }
    return { seed, ops: ops.length, committed: committed.length, aborted: ops.length - committed.length, last, readerViews: views.length };
  });
}
