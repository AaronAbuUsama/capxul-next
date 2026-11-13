import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import pg from "pg";
import { Database, type Sql } from "../src/platform/db.ts";
import { migrateOutbox } from "../src/platform/outbox.ts";
import { readPrincipal } from "../src/access/door.ts";
import { eligibility } from "../src/accounts/door.ts";
import { advance, begin, migrate, onApprovalEnded, onApprovalTransitioned, readAdmittedDeployment, resume, type MoneyDeploymentFact,
  type SetupProcessServices, type SetupServices } from "../src/organizations/door.ts";

// The setup's durable process on a dedicated loopback PG, built from the concept migrations alone. begin, Parties, the
// outbox and RLS are real; the signer, indexing, the FDE host and Approvals are scripted stand-ins, not chain proof.
const url = process.env.SETUP_PROCESS_TEST_ADMIN_URL;
if (!url || new URL(url).pathname !== "/setup_process_test" || !["localhost", "127.0.0.1"].includes(new URL(url).hostname))
  throw new Error("SETUP_PROCESS_TEST_ADMIN_URL must name a dedicated loopback setup_process_test database");
const admin = new pg.Client({ connectionString: url });
const role = (name: string) => { const u = new URL(url); u.username = name; u.password = "setups"; return u.href; };
let db: Database;
const t0 = 1_767_225_600_000, trace = "trace-setup-process-4417", hex = (n: number, len = 40) => `0x${n.toString(16).padStart(len, "0")}`;
const founder = { id: "person_founder", email: "founder@process.test", safe: hex(0xf0), party: "party_founder" };

/** One scripted chain: sends, receipts, facts and outside answers, each overridable per test. */
function world() {
  const w = {
    sent: [] as string[], hashes: new Map<string, string>(), opened: [] as any[], landedAt: [] as any[], receipts: new Map<string, "success" | "reverted" | null>(),
    minted: new Map<string, { safe: string; owner: string }>(), deployed: new Map<string, MoneyDeploymentFact>(),
    installed: null as boolean | null, fail: {} as Record<string, string>, seq: 0,
  };
  const failing = (what: string) => { if (w.fail[what]) throw new Error(`${w.fail[what]}: ${what}`); };
  // Like shared/service-signer.ts: a key it has seen answers its stored hash and sends nothing.
  const signed = (key: string) => {
    if (!w.hashes.has(key)) { w.sent.push(key); w.hashes.set(key, hex(++w.seq, 64)); }
    return { hash: w.hashes.get(key)! };
  };
  const services: SetupProcessServices = {
    chainId: 84532, finality: 0, installWindowMs: 86_400_000,
    async mint(i) { failing("mint"); return signed(i.key); },
    async deployMoney(i) { failing("deploy"); return signed(i.key); },
    async receipt({ hash }) { failing("receipt"); return w.receipts.has(hash) ? w.receipts.get(hash)! : "success"; },
    facts: {
      async safeMinted(_sql, q) { return w.minted.get(q.txHash) ?? null; },
      async moneyDeployed(_sql, q) { return w.deployed.get(q.txHash) ?? null; },
      async installed(_sql, q) { w.landedAt.push([q.txHash, q.blockNumber]); return w.installed; },
    },
    async installCalls(i) { failing("buildMoney"); return [{ to: i.deployment.safe, value: "0", data: `0xbatch${i.fdeSigner ? "fde" : ""}` }]; },
    fdeHost: { async provision({ orgId }) { failing("fde"); return { agentId: `fde:${orgId}`, signer: hex(0xfde1), safe: hex(0xfde5) }; } },
    async open(sql, who, terms, tr) {
      const approval_id = `apr_${w.opened.length + 1}`;
      // Same transaction as the setup's move: an approval row written here rolls back with it.
      await sql.query("select 1");
      w.opened.push({ who, terms, tr, approval_id }); return { approval_id };
    },
  };
  const fact = (safe: string, log: string): MoneyDeploymentFact => ({ log_id: log, chain_id: 84532, block_number: "4417", tx_hash: "", safe,
    founder_safe: founder.safe, board_top_hat: "11", shareholders_top_hat: "12", director_hat: "13", officer_hats: ["16", "14", "15"],
    roles: hex(0x7a), gate: hex(0x9a) });
  return { w, services, fact };
}
const setupServices: SetupServices = {
  chainId: 84532, companySafe: { companiesHouse: hex(0xc4a11) as `0x${string}`, namespace: "capxul:test:company:v1" }, pricedCurrencies: [],
  async eligibility(sql) {
    const p = await readPrincipal(sql, (await sql.query("select current_setting('app.person_id',true) as id")).rows[0].id);
    return eligibility(sql, p!, { "beta-access": { target: "person", money: false } }, t0);
  },
  async requireImage() { return {}; }, async board() { return null; },
};
const asFounder = <T>(run: (sql: Sql) => Promise<T>) => db.transaction("", async (sql) => {
  await sql.query("select set_config('app.person_id',$1,true),set_config('app.email',$2,true),set_config('app.safe_address',$3,true)", [founder.id, founder.email, founder.safe]);
  return run(sql);
}, true);
const setup = async (orgId: string) => (await admin.query("select * from app.org_setups s join app.organizations o using(org_id) where org_id=$1", [orgId])).rows[0];
const state = async (party: string) => (await admin.query("select state from app.parties where party_id=$1", [party])).rows[0].state;
const transitions = async (orgId: string) => (await admin.query(`select event from app.transition_outbox where event->>'name'='org_setup_transitioned'
  and event->'props'->>'org_id'=$1 order by seq`, [orgId])).rows.map((r) => r.event.props.transition);
let n = 0;
const created = async (fde = true) => (await asFounder((sql) => begin(sql, { name: `Acme ${++n}`, handle: `acme-${n}`, country: "GB", fde },
  setupServices, t0, trace))).orgId;
const step = (orgId: string, s: SetupProcessServices, at = t0 + 1) => advance(db, orgId, s, at, trace);
/** Another run lands between this run's snapshot (its first transaction) and its step's transaction. */
const interleaved = (other: () => Promise<unknown>) => {
  let n = 0;
  return new Proxy(db, { get: (target, key) => key !== "transaction" ? Reflect.get(target, key) :
    async (...args: Parameters<Database["transaction"]>) => {
      const result = await target.transaction(...args);
      if (++n === 1) await other();
      return result;
    } }) as Database;
};

test.before(async () => {
  await admin.connect();
  await admin.query(`create role capxul_core login password 'setups' nosuperuser nobypassrls;
    create role capxul_worker login password 'setups' nosuperuser nobypassrls; create schema app;
    grant usage on schema app to capxul_core,capxul_worker`);
  await migrateOutbox(admin);
  for (const path of ["../src/access/schema.sql", "../src/accounts/schema.sql", "../src/parties/schema.sql"])
    await admin.query(readFileSync(new URL(path, import.meta.url), "utf8"));
  await migrate(admin);
  db = new Database(role("capxul_core"), role("capxul_worker"));
  await admin.query("insert into app.principals(person_id,kind,email,safe_address,created_at) values($1,'person',$2,$3,now())", [founder.id, founder.email, founder.safe]);
  await admin.query(`insert into app.admissions(email,person_id,status,joined_via,admitted_at,admitted_by,updated_at) values($1,$2,'admitted','operator',1,'operator',1)`, [founder.email, founder.id]);
  await admin.query(`insert into app.personal_safes(person_id,email,safe_address,signer_address,status,attempt,collected,created_at,updated_at)
    values($1,$2,$3,$4,'ready',1,0,1,1)`, [founder.id, founder.email, founder.safe, hex(0x51e1)]);
  await admin.query(`insert into app.parties(party_id,kind,state,safe_address,owner_kind,owner_id,created_at,updated_at) values($1,'person','active',$2,'person',$3,1,1)`,
    [founder.party, founder.safe, founder.id]);
});
test.after(async () => { await db?.close(); await admin.end(); });

test("mint → FDE → deploy → install approval → signed → final install: ready, the founder and the FDE seated", async () => {
  const { w, services, fact } = world(), orgId = await created();
  const org = await setup(orgId);
  assert.deepEqual(await step(orgId, services), { status: "processing", step: "mint", moved: true });
  const mint = (await setup(orgId)).mint_tx_hash;
  w.receipts.set(mint, null);
  assert.deepEqual(await step(orgId, services), { status: "processing", step: "confirm-mint", moved: false }, "unmined: nothing moves");
  w.receipts.delete(mint);
  assert.equal((await step(orgId, services)).moved, false, "mined but not final: nothing moves");
  w.minted.set(mint, { safe: org.safe_address.toUpperCase().replace("0X", "0x"), owner: founder.safe });
  let inner: unknown;
  const outer = await advance(interleaved(async () => { inner = await step(orgId, services); }), orgId, services, t0 + 1, trace);
  assert.deepEqual([inner, outer.moved], [{ status: "processing", step: "confirm-mint", moved: true }, false], "a stale run confirms nothing twice");
  assert.deepEqual([(await setup(orgId)).steps, await state(org.party_id)], [["safe_minted"], "active"]);
  assert.deepEqual(await step(orgId, services), { status: "processing", step: "host-fde", moved: true });
  const fde = await setup(orgId);
  assert.deepEqual([fde.fde_signer, fde.fde_safe, await state(fde.fde_party_id)], [hex(0xfde1), hex(0xfde5), "pending"]);
  assert.equal((await admin.query("select handle from app.parties where party_id=$1", [fde.fde_party_id])).rows[0].handle, `acme-${n}-fde`);
  assert.deepEqual(await step(orgId, services), { status: "processing", step: "deploy", moved: true });
  const deploy = (await setup(orgId)).deploy_tx_hash;
  assert.equal((await step(orgId, services)).moved, false, "MoneyDeployed not final yet");
  assert.equal(await readAdmittedDeployment(db.worker as unknown as Sql, { orgId, chainId: 84532 }), null);
  w.deployed.set(deploy, fact(org.safe_address, `84532:${deploy}:2`));
  assert.deepEqual(await step(orgId, services), { status: "awaiting_authorization", step: "open-install", moved: true });
  const admitted = await db.transaction(orgId, (sql) => readAdmittedDeployment(sql, { orgId, chainId: 84532 }), true);
  assert.deepEqual([admitted?.log_id, admitted?.officer_hats, admitted?.gate_address, admitted?.deploy_tx_hash], [`84532:${deploy}:2`, ["16", "14", "15"], hex(0x9a), deploy]);
  assert.equal((await admin.query("select books_hat from app.org_deployments where org_id=$1", [orgId])).rows[0].books_hat, null, "officer hats stay unnamed");
  assert.deepEqual(w.opened.map((o) => [o.who, o.terms.opener, o.terms.subject_kind, o.terms.subject_id, o.terms.calls[0].data, o.tr]),
    [[{ personId: founder.id, safe: founder.safe }, "organizations", "setup", orgId, "0xbatchfde", trace]]);
  assert.equal((await setup(orgId)).install_approval_id, "apr_1");
  assert.equal((await step(orgId, services)).moved, false, "awaiting the founder moves nothing");
  const signed = (to: string, approval_id = "apr_1") => db.transaction(orgId, (sql) => onApprovalTransitioned(sql, { at: t0 + 2, trace_id: "trace-signed",
    props: { to, approval_id, opener: "organizations", subject_kind: "setup", subject_id: orgId } }), true);
  await signed("signed", "apr_other");
  assert.equal((await setup(orgId)).status, "awaiting_authorization", "another approval does not authorize it");
  await signed("signed");
  assert.equal((await setup(orgId)).status, "processing");
  w.installed = false;
  assert.deepEqual(await step(orgId, services), { status: "processing", step: "complete", moved: false }, "signed but not landed: not judged");
  assert.deepEqual(w.landedAt, [], "the install's facts are not read before it landed");
  const installTx = hex(0x1a57, 64);
  await db.transaction(orgId, (sql) => onApprovalEnded(sql, { opener: "organizations", subject_kind: "setup", subject_id: orgId, approval_id: "apr_1",
    outcome: "landed", refusal: null, transaction_hash: installTx, block_number: 4500, observedAt: new Date(t0 + 2).toISOString(), trace_id: "trace-signed" }), true);
  assert.deepEqual([(await setup(orgId)).install_tx_hash, Number((await setup(orgId)).install_block)], [installTx, 4500]);
  w.installed = null;
  assert.deepEqual(await step(orgId, services), { status: "processing", step: "complete", moved: false }, "landed, not final");
  assert.deepEqual(w.landedAt.at(-1), [installTx, 4500], "judged at the landed block");
  w.installed = true;
  const late = await advance(interleaved(async () => { inner = await step(orgId, services, t0 + 3); }), orgId, services, t0 + 3, trace);
  assert.deepEqual([inner, late.moved], [{ status: "ready", step: "complete", moved: true }, false], "a stale run completes nothing twice");
  const done = await setup(orgId);
  assert.deepEqual([done.steps, Number(done.ready_at), await state(done.fde_party_id)], [["safe_minted", "money_deployed", "installed"], t0 + 3, "active"]);
  const seats = (await admin.query("select party_id,principal_id,kind,safe_address,seat_use,status from app.org_members where org_id=$1 order by kind", [orgId])).rows;
  assert.deepEqual(seats, [
    { party_id: done.fde_party_id, principal_id: null, kind: "agent", safe_address: hex(0xfde5), seat_use: "organization", status: "active" },
    { party_id: founder.party, principal_id: founder.id, kind: "human", safe_address: founder.safe, seat_use: "seat", status: "active" }]);
  assert.deepEqual(await transitions(orgId), ["begin", "request_authorization", "authorize", "complete"]);
  const traces = (await admin.query(`select distinct event->>'trace_id' as t from app.transition_outbox where event->>'name' in
    ('org_setup_transitioned','org_member_transitioned','org_fde_transitioned') and event->>'owner_id'=$1`, [orgId])).rows.map((r) => r.t).sort();
  assert.deepEqual(traces, ["trace-setup-process-4417", "trace-signed"]);
  assert.deepEqual(w.sent.filter((s) => s.includes(":deploy:")), [`org-setup:${orgId}:deploy:1`], "deployMoney sent once");
  assert.deepEqual(await step(orgId, services), { status: "ready", step: "none", moved: false });
});

test("a company Safe minted to anyone else fails the setup and releases its Party", async () => {
  const { w, services } = world(), orgId = await created(false);
  await step(orgId, services);
  const row = await setup(orgId);
  w.minted.set(row.mint_tx_hash, { safe: row.safe_address, owner: hex(0xbad) });
  assert.deepEqual(await step(orgId, services), { status: "failed", step: "confirm-mint", moved: true });
  assert.deepEqual([(await setup(orgId)).issue.reason, (await setup(orgId)).issue.code, await state(row.party_id)], ["safe_owner_mismatch", "WRONG_STATE", "released"]);
  assert.deepEqual(await transitions(orgId), ["begin", "fail"]);
});

test("a crash after a send, a reverted mint, a provider outage and an invalid answer", async () => {
  const { w, services, fact } = world(), orgId = await created(false);
  const crash = { ...services, async mint(i: Parameters<typeof services.mint>[0]) { await services.mint(i); throw new Error("crashed after the send"); } };
  await assert.rejects(step(orgId, crash), /crashed after the send/);
  assert.equal((await setup(orgId)).mint_tx_hash, null);
  await step(orgId, services);
  const first = (await setup(orgId)).mint_tx_hash;
  assert.deepEqual([w.sent, first], [[`org-setup:${orgId}:mint:1`], w.hashes.get(`org-setup:${orgId}:mint:1`)], "the crash's send is the recorded one");
  w.receipts.set(first, "reverted");
  assert.deepEqual(await step(orgId, services), { status: "needs_attention", step: "confirm-mint", moved: true });
  assert.deepEqual([(await setup(orgId)).issue.reason, (await setup(orgId)).mint_tx_hash], ["mint_reverted", null]);
  assert.equal((await step(orgId, services)).moved, false, "needs_attention waits for org retry");
  await asFounder((sql) => resume(sql, { orgId }, setupServices, t0 + 5, "trace-retry"));
  assert.deepEqual(await step(orgId, services), { status: "processing", step: "mint", moved: true }, "retry sends the mint again");
  assert.deepEqual(w.sent, [`org-setup:${orgId}:mint:1`, `org-setup:${orgId}:mint:2`]);
  assert.notEqual((await setup(orgId)).mint_tx_hash, first);
  const row = await setup(orgId);
  w.minted.set(row.mint_tx_hash, { safe: row.safe_address, owner: founder.safe });
  await step(orgId, services);
  w.fail.deploy = "PROVIDER_ERROR";
  await assert.rejects(step(orgId, services), /^Error: PROVIDER_ERROR/, "an outage goes back to the workflow's retries");
  assert.equal((await setup(orgId)).status, "processing");
  assert.deepEqual(await advance(db, orgId, services, t0 + 1, trace, { lastTry: true }), { status: "needs_attention", step: "deploy", moved: true });
  assert.deepEqual((await setup(orgId)).issue, { reason: "provider_unavailable", code: "PROVIDER_ERROR", at: t0 + 1 });
  delete w.fail.deploy;
  await asFounder((sql) => resume(sql, { orgId }, setupServices, t0 + 6, "trace-retry"));
  await step(orgId, services);
  w.deployed.set((await setup(orgId)).deploy_tx_hash, fact(row.safe_address, "84532:0xd:1"));
  w.fail.buildMoney = "PROVIDER_RESPONSE_INVALID";
  assert.deepEqual(await step(orgId, services), { status: "failed", step: "confirm-deploy", moved: true });
  assert.deepEqual([(await setup(orgId)).issue.reason, await readAdmittedDeployment(db.worker as unknown as Sql, { orgId, chainId: 84532 })], ["provider_answer_invalid", null]);
});

test("an ended install approval stalls with approvals' code, and retry reopens it without deploying again", async () => {
  const { w, services, fact } = world(), orgId = await created(false);
  await step(orgId, services);
  const row = await setup(orgId);
  w.minted.set(row.mint_tx_hash, { safe: row.safe_address, owner: founder.safe });
  await step(orgId, services); await step(orgId, services);
  w.deployed.set((await setup(orgId)).deploy_tx_hash, fact(row.safe_address, "84532:0xe:1"));
  assert.equal((await step(orgId, services)).status, "awaiting_authorization");
  const ended = (outcome: string, approval_id: string, refusal: { code: string } | null = null) => db.transaction(orgId, (sql) => onApprovalEnded(sql, {
    opener: "organizations", subject_kind: "setup", subject_id: orgId, approval_id, outcome, refusal, transaction_hash: null, block_number: null,
    observedAt: new Date(t0 + 9).toISOString(), trace_id: "trace-ended" }), true);
  await ended("refused", "apr_1", { code: "INSUFFICIENT_FUNDS" });
  assert.deepEqual([(await setup(orgId)).status, (await setup(orgId)).issue, (await setup(orgId)).install_approval_id],
    ["needs_attention", { reason: "install_refused", code: "INSUFFICIENT_FUNDS", at: t0 + 9 }, null]);
  await asFounder((sql) => resume(sql, { orgId }, setupServices, t0 + 10, "trace-retry"));
  assert.deepEqual(await step(orgId, services), { status: "awaiting_authorization", step: "open-install", moved: true });
  assert.deepEqual([w.opened.length, w.sent.filter((s) => s.includes(":deploy:")).length, (await setup(orgId)).install_approval_id], [2, 1, "apr_2"]);
  await ended("declined", "apr_1");
  assert.equal((await setup(orgId)).status, "awaiting_authorization", "a stale approval's ending changes nothing");
  await ended("expired", "apr_2");
  assert.deepEqual((await setup(orgId)).issue, { reason: "approval_expired", code: "WRONG_STATE", at: t0 + 9 });
});

test("a MoneyDeployed for another founder or chain is an invalid answer, never admitted", async () => {
  const { w, services, fact } = world(), orgId = await created(false);
  await step(orgId, services);
  const row = await setup(orgId);
  w.minted.set(row.mint_tx_hash, { safe: row.safe_address, owner: founder.safe });
  await step(orgId, services); await step(orgId, services);
  w.deployed.set((await setup(orgId)).deploy_tx_hash, { ...fact(row.safe_address, "84532:0xf:1"), founder_safe: hex(0xbad) });
  assert.deepEqual(await step(orgId, services), { status: "failed", step: "confirm-deploy", moved: true });
  assert.deepEqual([(await setup(orgId)).issue.reason, w.opened.length, (await admin.query("select count(*) from app.org_deployments where org_id=$1", [orgId])).rows[0].count],
    ["provider_answer_invalid", 0, "0"]);
});
