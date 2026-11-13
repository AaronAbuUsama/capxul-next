import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import pg from "pg";
import { proposeChange, settleChange, type ChangeBirth } from "../src/budgets/door.ts";
import { Database } from "../src/platform/db.ts";
import { migrateOutbox } from "../src/platform/outbox.ts";

// Component control on a dedicated loopback budgets_test database. app.chain_logs is a stand-in table with the
// indexer view's columns; this is not Ponder, v4, Board or Approvals proof.
const url = process.env.BUDGETS_TEST_ADMIN_URL;
if (!url || new URL(url).pathname !== "/budgets_test" || !["localhost", "127.0.0.1"].includes(new URL(url).hostname))
  throw new Error("dedicated loopback budgets_test PG required");
const role = (name: string) => { const u = new URL(url); u.username = name; u.password = `${name}-local`; return u.href; };
const admin = new pg.Client({ connectionString: url });
let db: Database;
const org = `north-${randomUUID()}`, safe = `0x${"ab".repeat(20)}`, token = `0x${"cd".repeat(20)}`, tx = `0x${"12".repeat(32)}`;
const hat = (n: number) => `0x${n.toString(16).padStart(64, "0")}`;
let at = 1_700_000_000_000;
const context = () => ({ at: ++at, traceId: "budgets-component", actor: "director-1" });

test.before(async () => {
  await admin.connect();
  for (const name of ["capxul_core", "capxul_worker"]) {
    if (!(await admin.query("select 1 from pg_roles where rolname=$1", [name])).rowCount)
      await admin.query(`create role ${name} login nosuperuser nobypassrls noinherit`);
    await admin.query(`alter role ${name} password '${name}-local'`);
  }
  await admin.query(readFileSync(new URL("../src/schema.sql", import.meta.url), "utf8"));
  await admin.query("grant usage on schema app to capxul_core,capxul_worker; grant select on app.organizations to capxul_core,capxul_worker");
  await admin.query(readFileSync(new URL("../src/budgets/schema.sql", import.meta.url), "utf8"));
  await migrateOutbox(admin);
  await admin.query(`create table app.chain_logs (chain_id integer, tx_hash text, tx_log_ordinal integer, contract text, event text, args jsonb);
    grant select on app.chain_logs to capxul_core,capxul_worker`);
  await admin.query("insert into app.organizations(org_id,name,safe,site,admin_email,token) values($1,$1,$2,$1,'o@example.test',$3)", [org, safe, token]);
  db = new Database(role("capxul_core"), role("capxul_worker"));
});
test.after(async () => { await db?.close(); await admin.end(); });

const birth = (key: string, admin_hat: number, planned: number, request = randomUUID()): ChangeBirth => ({
  org_id: org, change_id: `change_${randomUUID()}`, request_key: request, kind: "create", budget_ref: `dep_${key}`,
  ceiling_token: null, signer: "board", proposer_principal_id: "director-1",
  terms: { amount: "500000000", holders: [], ceiling: null, leave: null, restore: null, note: null },
  budget: { kind: "department", key, name: key, parent_budget_id: null, token, period: "month", hat_id: hat(planned), admin_hat_id: hat(admin_hat) },
});
let carried = 0;
const carry = async () => { carried++; return { approval_id: `approval_${randomUUID()}`, proposal_id: `proposal_${randomUUID()}` }; };
const rows = () => db.transaction(org, async (sql) => ({
  budgets: (await sql.query("select * from app.budgets order by budget_ref")).rows,
  changes: (await sql.query("select * from app.budget_changes order by created_at")).rows,
  events: (await sql.query("select event from app.transition_outbox order by seq")).rows.map((r) => r.event),
}));
const logs = async (n: number, entries: [string, string, Record<string, string>][]) => {
  for (const [i, [contract, event, args]] of entries.entries())
    await admin.query("insert into app.chain_logs values (84532,$1,$2,$3,$4,$5)", [`${tx.slice(0, -2)}${n.toString(16).padStart(2, "0")}`, i, contract, event, args]);
  return `${tx.slice(0, -2)}${n.toString(16).padStart(2, "0")}`;
};

test("a create is born with its carrier, once per request, and refuses a waiting conflict; a failed carry leaves nothing", async () => {
  await assert.rejects(db.transaction(org, (sql) => proposeChange(sql, birth("ops", 1, 10), async () => { throw new Error("carrier refused"); }, context())), /carrier refused/);
  assert.deepEqual(await rows(), { budgets: [], changes: [], events: [] });
  const first = birth("ops", 1, 10);
  const born = await db.transaction(org, (sql) => proposeChange(sql, first, carry, context()));
  assert.equal(born.repeated, false); assert.equal(carried, 1);
  const state = await rows();
  assert.equal(state.budgets[0].status, "proposed"); assert.equal(state.budgets[0].key_claim, "ops"); assert.equal(state.budgets[0].budget_id, null);
  assert.deepEqual(state.events.map((e) => [e.name, e.props.transition, e.props.from]), [["budget_transitioned", "propose", null], ["budget_change_transitioned", "propose", null]]);
  const again = await db.transaction(org, (sql) => proposeChange(sql, { ...first, change_id: "change_other" }, carry, context()));
  assert.equal(again.repeated, true); assert.equal(again.change.change_id, first.change_id); assert.equal(carried, 1);
  assert.deepEqual((await rows()).events.length, 2, "a repeat births nothing");
  await assert.rejects(db.transaction(org, (sql) => proposeChange(sql, { ...first, terms: { ...first.terms, amount: "1" } }, carry, context())), /^Error: INVALID_INPUT/);
  await assert.rejects(db.transaction(org, (sql) => proposeChange(sql, birth("ops2", 1, 11), carry, context())), /^Error: WRONG_STATE.*waiting/, "same admin hat waits");
  await assert.rejects(db.transaction(org, (sql) => proposeChange(sql, { ...birth("ops", 2, 20), budget_ref: "dep_ops_b" }, carry, context())), /^Error: WRONG_STATE.*key ops/, "a proposed key is held");
  assert.equal(carried, 1, "a refusal opens no carrier");
});

test("an executed create without its own effect abandons and frees the key; with it, activates and binds; replay is inert", async () => {
  const [wrong] = (await rows()).changes;
  const hash = await logs(1, [["budgets", "BudgetCreated", { safe, id: "7", parent: "0", token, period: "0", amount: "500000000", hat: "11" }]]);
  const failed = await db.transaction(org, (sql) => settleChange(sql, { org_id: org, change_id: wrong.change_id, chain_id: 84532, transaction_hash: hash, outcome: "executed" }, context()));
  assert.deepEqual(failed, { state: "abandoned", outcome: "failed", repeated: false }, "another hat is not this change's effect");
  let state = await rows();
  assert.equal(state.budgets[0].status, "abandoned"); assert.equal(state.budgets[0].key_claim, null); assert.equal(state.budgets[0].budget_id, null);
  const second = birth("ops", 1, 10);
  await db.transaction(org, (sql) => proposeChange(sql, { ...second, budget_ref: "dep_ops_2" }, carry, context()));
  const change = (await rows()).changes.at(-1)!;
  const good = await logs(2, [["hats", "TransferSingle", { id: "10", from: `0x${"0".repeat(40)}`, to: safe }],
    ["budgets", "BudgetCreated", { safe, id: "8", parent: "0", token, period: "0", amount: "500000000", hat: "10" }]]);
  const end = { org_id: org, change_id: change.change_id, chain_id: 84532, transaction_hash: good, outcome: "landed" } as const;
  assert.deepEqual(await db.transaction(org, (sql) => settleChange(sql, end, context())), { state: "applied", outcome: null, repeated: false });
  state = await rows();
  const active = state.budgets.find((b) => b.budget_ref === "dep_ops_2")!;
  assert.equal(active.status, "active"); assert.equal(active.budget_id, "8"); assert.equal(active.key_claim, "ops");
  const count = state.events.length;
  assert.equal((await db.transaction(org, (sql) => settleChange(sql, end, context()))).repeated, true);
  assert.equal((await rows()).events.length, count, "a second delivery of the same end is a no-op");
});

test("amount changes need their own amount; an unexecuted carrier abandons with its outcome", async () => {
  const set = async (amount: string) => {
    const b: ChangeBirth = { ...birth("x", 9, 99), kind: "set_amount", budget_ref: "dep_ops_2", terms: { ...birth("x", 9, 99).terms, amount } };
    delete b.budget;
    await db.transaction(org, (sql) => proposeChange(sql, b, carry, context()));
    return (await rows()).changes.at(-1)!.change_id as string;
  };
  const hash = await logs(3, [["budgets", "BudgetAmountSet", { safe, id: "8", amount: "700000000" }]]);
  const wrong = await set("600000000");
  assert.equal((await db.transaction(org, (sql) => settleChange(sql, { org_id: org, change_id: wrong, chain_id: 84532, transaction_hash: hash, outcome: "landed" }, context()))).outcome, "failed");
  const right = await set("700000000");
  assert.equal((await db.transaction(org, (sql) => settleChange(sql, { org_id: org, change_id: right, chain_id: 84532, transaction_hash: hash, outcome: "landed" }, context()))).state, "applied");
  for (const [outcome, expected] of [["declined", "declined"], ["displaced", "replaced"], ["refused", "failed"]] as const) {
    const id = await set("1");
    assert.equal((await db.transaction(org, (sql) => settleChange(sql, { org_id: org, change_id: id, chain_id: null, transaction_hash: null, outcome }, context()))).outcome, expected);
  }
  assert.equal((await rows()).budgets.find((b) => b.budget_ref === "dep_ops_2")!.status, "active", "a change of an active budget never abandons it");
});
