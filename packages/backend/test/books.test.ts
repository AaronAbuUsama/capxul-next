import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { recordMoneyFact, reverseMoneyFact, type MoneySide } from "../src/books/door.ts";
import { Database } from "../src/platform/db.ts";

const tenant = process.env.BOOKS_TEST_DATABASE_URL, worker = process.env.BOOKS_TEST_WORKER_DATABASE_URL;
if (!tenant || !worker || !new URL(tenant).pathname.endsWith("_test")) {
  throw new Error("books tests require explicit restricted URLs on a migrated disposable *_test database");
}
const db = new Database(tenant, worker);
test.after(() => db.close());
const at = 1_600_123_456_789, context = { at, traceId: "books-transaction-contract" };
function side(org: string, key = "payment:17"): MoneySide {
  return { org_id: org, kind: "payment_settled", direction: "out", money_key: key,
    reference: { kind: "payment", id: "payment_17" }, source: { kind: "payment", id: "payment_17" },
    asset_id: "84532:token", symbol: "USDC", decimals: 6, amount_raw: "12340000", fee_raw: "27000", priced: true,
    usd: { value: "12.303108", rate: "0.99701", source: "captured-block-round:48" },
    counterparty: "0xrecipient", party_id: null, chain_id: 84532, block_number: 71,
    block_time: at - 32_000, tx_hash: "0xblock71", log_index: 3, safe_address: "0xcompany",
    actor: { kind: "system", id: null } };
}
const rows = (org: string, table = "book_facts") => db.transaction(org,
  async (sql) => (await sql.query(`select * from app.${table} where ${table === "book_annotations" ? "owner_id" : "org_id"}=$1`, [org])).rows);

test("a side with no against is still born waiting, once, with no account fact", async () => {
  const org = `books-${randomUUID()}`, input = side(org);
  const committed = await db.transaction(org, (sql) => recordMoneyFact(sql, { sides: [input] }, context));
  assert.equal(committed.recorded.length, 1);
  assert.deepEqual((await rows(org)).map((r) => r.kind), ["payment_settled"], "saying nothing assigns no account");
  const [row, ...more] = await rows(org, "book_annotations");
  assert.deepEqual(more, []);
  assert.equal(row!.status, "waiting"); assert.equal(row!.account, null); assert.equal(row!.last_editor_kind, "system");
  const events = () => db.ownerTransaction({ kind: "organization", id: org }, async (sql) =>
    (await sql.query("select event from app.transition_outbox where event->>'owner_id'=$1", [org])).rows.map((r) => r.event), true);
  const born = await events();
  assert.equal(born.length, 1);
  assert.deepEqual(born[0].props, { from: null, to: "waiting", transition: "queue", owner_kind: "organization",
    owner_id: org, reference_kind: "payment", reference_id: "payment_17", account: null });
  assert.equal(born[0].trace_id, context.traceId);
  await db.transaction(org, (sql) => recordMoneyFact(sql, { sides: [input] }, context));
  assert.deepEqual(await events(), born, "a replay births nothing more");
});

test("money and annotation birth roll back with their invoker; reversal preserves captured evidence and replay is inert", async () => {
  const org = `books-${randomUUID()}`, input = side(org);
  input.against = { account: "6100 - Site cleaning", party: { type: "Supplier", id: "party_supplier" } };
  await assert.rejects(db.transaction(org, async (sql) => {
    await recordMoneyFact(sql, { sides: [input] }, context);
    assert.equal((await sql.query("select count(*)::int as n from app.book_facts where org_id=$1", [org])).rows[0]!.n, 2);
    throw new Error("invoker failed after book writes");
  }), /invoker failed/);
  assert.deepEqual(await rows(org), []);
  assert.deepEqual(await rows(org, "book_feeds"), []);
  assert.deepEqual(await rows(org, "book_annotations"), []);
  const events = () => db.ownerTransaction({ kind: "organization", id: org }, async (sql) =>
    (await sql.query("select event from app.transition_outbox where event->>'owner_kind'='organization' and event->>'owner_id'=$1", [org])).rows.map((r) => r.event), true);
  assert.deepEqual(await events(), [], "the caller rollback must also discard the annotation's outbox event");
  const committed = await db.transaction(org, (sql) => recordMoneyFact(sql, { sides: [input] }, context));
  assert.equal(committed.recorded.length, 1);
  const born = await events();
  assert.equal(born.length, 1);
  assert.deepEqual(born[0].props, { from: null, to: "decided", transition: "assign", owner_kind: "organization",
    owner_id: org, reference_kind: "payment", reference_id: "payment_17", account: input.against.account });
  assert.equal(born[0].at, at);
  assert.equal(born[0].trace_id, context.traceId);
  const before = (await rows(org)).sort((a, b) => a.seq - b.seq);
  assert.deepEqual(before.map((r) => r.seq), [1, 2]);
  assert.equal(before[0]!.account, null, "a money fact must not become a chart/accounting replica");
  assert.equal(before[0]!.recorded_at, at, "host time cannot replace authoritative world time");
  assert.equal(before[0]!.occurred_at, at - 32_000);
  assert.equal((await rows(org, "book_annotations"))[0]!.account, input.against.account);
  const changedReplay = { ...input, usd: { value: "999", rate: "99", source: "later" } };
  assert.deepEqual(await db.transaction(org, (sql) => recordMoneyFact(sql, { sides: [changedReplay] }, context)),
    { recorded: [], unchanged: committed.recorded, superseded: [] });
  assert.deepEqual((await rows(org)).sort((a, b) => a.seq - b.seq), before);
  assert.deepEqual(await events(), born, "money replay must not emit another annotation birth");
  const reversal = { money_key: input.money_key, org_ids: [org], seen_at: at + 99, reason: "reorganized" as const };
  await assert.rejects(db.transaction(org, async (sql) => {
    await reverseMoneyFact(sql, reversal, { ...context, at: at + 101 });
    throw new Error("reverse invoker failed");
  }), /reverse invoker failed/);
  assert.deepEqual((await rows(org)).sort((a, b) => a.seq - b.seq), before);
  const reversed = await db.transaction(org, (sql) => reverseMoneyFact(sql, reversal, { ...context, at: at + 101 }));
  assert.equal(reversed.reversed.length, 1);
  const rev = (await rows(org)).find((r) => r.kind === "reversed")!;
  assert.equal(rev.reverses_fact_id, committed.recorded[0]);
  for (const key of ["amount_raw", "fee_raw", "usd_value", "usd_rate", "usd_source", "asset_id"]) assert.equal(rev[key], before[0]![key]);
  assert.equal(rev.occurred_at, at + 99); assert.equal(rev.recorded_at, at + 101);
  assert.deepEqual(await db.transaction(org, (sql) => reverseMoneyFact(sql, reversal, context)), { reversed: [] });
  await db.transaction(org, (sql) => recordMoneyFact(sql, { sides: [input] }, { ...context, at: at + 201 }));
  const after = (await rows(org)).sort((a, b) => a.seq - b.seq);
  assert.deepEqual(after.map((r) => r.seq), [1, 2, 3, 4]);
  assert.equal(after[3]!.generation, 2);
  assert.equal((await rows(org, "book_feeds"))[0]!.last_seq, 4);
  const source = side(org, "payment:source");
  source.reference = { kind: "payment", id: "source" };
  source.against = { account: "6100" };
  await db.transaction(org, (sql) => recordMoneyFact(sql, { sides: [source] }, context));
  const copied = side(org, "payment:copy");
  copied.reference = { kind: "payment", id: "copy" };
  copied.against = { same_as: source.reference };
  const overridden = side(org, "payment:override");
  overridden.reference = { kind: "payment", id: "override" };
  overridden.against = { same_as: source.reference, account: "7200 - Native services" };
  await db.transaction(org, (sql) => recordMoneyFact(sql, { sides: [copied, overridden] }, context));
  const annotations = await rows(org, "book_annotations");
  assert.equal(annotations.find((r) => r.reference_id === "copy")!.account_number, "6100");
  const override = annotations.find((r) => r.reference_id === "override")!;
  assert.equal(override.account, "7200 - Native services");
  assert.equal(override.account_number, null, "an explicit different account cannot inherit the source account's number");
});

test("oppositely ordered multi-company writers serialize, duplicate keys count once, Movement cannot reclaim attributed money", async () => {
  const a = `a-${randomUUID()}`, b = `b-${randomUUID()}`;
  const movement = { ...side(a), source: { kind: "movement" as const, id: "movement_17" }, kind: "payment_sent_outside" as const };
  await db.transaction(a, (sql) => recordMoneyFact(sql, { sides: [movement] }, context));
  const results = await Promise.all(Array.from({ length: 12 }, (_, i) => db.transaction(i % 2 ? a : b,
    (sql) => recordMoneyFact(sql, { sides: i % 2 ? [side(b), side(a)] : [side(a), side(b)] }, context))));
  assert.equal(results.flatMap((r) => r.recorded).length, 2);
  assert.equal(results.flatMap((r) => r.superseded).length, 1);
  const before = (await rows(a)).sort((x, y) => x.seq - y.seq);
  assert.deepEqual(before.map((r) => [r.seq, r.kind]), [[1, "payment_sent_outside"], [2, "reversed"], [3, "payment_settled"]]);
  await db.transaction(a, (sql) => recordMoneyFact(sql, { sides: [movement] }, context));
  assert.deepEqual((await rows(a)).sort((x, y) => x.seq - y.seq), before);
  assert.equal((await rows(b)).length, 1);
  assert.deepEqual(await db.transaction(a, async (sql) => (await sql.query("select * from app.book_facts where org_id=$1", [b])).rows), []);
  await assert.rejects(db.transaction(a, (sql) => sql.query("update app.book_facts set amount_raw='1' where org_id=$1", [a])), /permission denied/);
  await assert.rejects(db.transaction(a, (sql) => sql.query("delete from app.book_facts where org_id=$1", [a])), /permission denied/);
  const noUsd = side(`unvalued-${randomUUID()}`); delete noUsd.usd;
  await db.transaction(noUsd.org_id, (sql) => recordMoneyFact(sql, { sides: [noUsd] }, context));
  const unvalued = (await rows(noUsd.org_id))[0]!;
  assert.equal(unvalued.usd_value, null); assert.equal(unvalued.usd_rate, null); assert.equal(unvalued.usd_source, null);
  const unknown = `unknown-${randomUUID()}`;
  await db.transaction(unknown, (sql) => reverseMoneyFact(sql, { money_key: "missing", org_ids: [unknown], seen_at: at, reason: "reorganized" }, context));
  assert.deepEqual(await rows(unknown, "book_feeds"), [], "a nonexistent reversal is a write-free no-op");
});
