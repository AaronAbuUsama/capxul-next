import assert from "node:assert/strict";
import test from "node:test";
import type { Sql } from "../src/platform/db.ts";
import { advance, onApprovalEnded, onApprovalTransitioned, readAdmittedDeployment, resume, setupRunner } from "../src/organizations/door.ts";
import { ServiceSignerError } from "../src/shared/door.ts";
import { admin, asFounder, created, db, founder, hex, interleaved, n, setup, setupServices, state, step, t0, trace, transitions, world } from "./setup-process-world.ts";

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
  assert.deepEqual(w.fdeSafeOf, [[hex(0xfde1), org.safe_address]], "the FDE's Safe is AgentOwner's for the host's key and the company Safe");
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

test("a lost send moves to its next attempt; a signer error is matched by its code; a final install mismatch fails", async () => {
  const { w, services, fact } = world(), orgId = await created(false);
  await step(orgId, services);
  const lost = (await setup(orgId)).mint_tx_hash;
  w.receipts.set(lost, "lost");
  assert.deepEqual(await step(orgId, services), { status: "needs_attention", step: "confirm-mint", moved: true });
  assert.deepEqual([(await setup(orgId)).issue.reason, (await setup(orgId)).mint_tx_hash, (await setup(orgId)).mint_attempt], ["send_lost", null, 2]);
  await asFounder((sql) => resume(sql, { orgId }, setupServices, t0 + 5, "trace-retry"));
  await step(orgId, services);
  const row = await setup(orgId);
  assert.deepEqual(w.sent, [`org-setup:${orgId}:mint:1`, `org-setup:${orgId}:mint:2`]);
  w.minted.set(row.mint_tx_hash, { safe: row.safe_address, owner: founder.safe });
  await step(orgId, services);
  // shared/service-signer.ts's ServiceSignerError: the code is on `code`, the message does not start with it.
  const signerDown = { ...services, async deployMoney() { throw Object.assign(new Error("Service signer refused: PROVIDER_ERROR"), { code: "PROVIDER_ERROR" }); } };
  await assert.rejects(step(orgId, signerDown), /Service signer refused/, "retried by the workflow first");
  assert.deepEqual(await advance(db, orgId, signerDown, t0 + 6, trace, { lastTry: true }), { status: "needs_attention", step: "deploy", moved: true });
  assert.deepEqual((await setup(orgId)).issue, { reason: "provider_unavailable", code: "PROVIDER_ERROR", at: t0 + 6 });
  await asFounder((sql) => resume(sql, { orgId }, setupServices, t0 + 7, "trace-retry"));
  await step(orgId, services);
  w.deployed.set((await setup(orgId)).deploy_tx_hash, fact(row.safe_address, "84532:0xa:1"));
  await step(orgId, services);
  await db.transaction(orgId, (sql) => onApprovalEnded(sql, { opener: "organizations", subject_kind: "setup", subject_id: orgId, approval_id: "apr_1",
    outcome: "landed", refusal: null, transaction_hash: hex(0x1a58, 64), block_number: 4600, observedAt: new Date(t0 + 8).toISOString(), trace_id: trace }), true);
  w.installed = false;
  assert.deepEqual(await step(orgId, services, t0 + 9), { status: "failed", step: "complete", moved: true }, "its batch ran: no second one");
  assert.deepEqual([(await setup(orgId)).issue.reason, await state(row.party_id), w.opened.length], ["install_mismatch", "active", 1]);
  await assert.rejects(asFounder((sql) => resume(sql, { orgId }, setupServices, t0 + 10, "trace-retry")), /^Error: WRONG_STATE/);
});

test("a MoneyDeployed that changes to another founder by commit fails like the first check", async () => {
  const { w, services, fact } = world(), orgId = await created(false);
  await step(orgId, services);
  const row = await setup(orgId);
  w.minted.set(row.mint_tx_hash, { safe: row.safe_address, owner: founder.safe });
  await step(orgId, services); await step(orgId, services);
  const good = fact(row.safe_address, "84532:0xb:1");
  let reads = 0;
  const changing = { ...services, facts: { ...services.facts, async moneyDeployed() { return ++reads === 1 ? good : { ...good, founder_safe: hex(0xbad) }; } } };
  assert.deepEqual(await step(orgId, changing), { status: "failed", step: "confirm-deploy", moved: true });
  assert.deepEqual([(await setup(orgId)).issue.reason, w.opened.length, reads], ["provider_answer_invalid", 0, 2]);
});

test("the runner retries an outage with backoff and stalls on the last try; a busy key waits; work carries the setup's trace", async () => {
  const { w, services } = world(), orgId = await created(false);
  let clock = 0;
  const busy = { on: false };
  const runner = setupRunner(db, { ...services, async mint(i) { if (busy.on) throw new ServiceSignerError("WRONG_STATE"); return services.mint(i); } },
    { now: () => t0 + 7, elapsed: () => clock, retries: 3, backoffMs: 100 });
  const tick = async (at: number) => { clock = at; return (await runner.tick())[orgId] as any; };
  w.fail.mint = "PROVIDER_ERROR";
  assert.match((await tick(0)).error, /^PROVIDER_ERROR/);
  assert.equal(await tick(99), undefined, "backing off 100 ms");
  assert.match((await tick(100)).error, /^PROVIDER_ERROR/);
  assert.equal(await tick(299), undefined, "then 200 ms");
  assert.deepEqual(await tick(300), { status: "needs_attention", step: "mint", moved: true }, "the third try is the last");
  const stalled = await admin.query(`select event from app.transition_outbox where event->>'name'='org_setup_transitioned'
    and event->>'entity_id'=$1 order by seq desc limit 1`, [orgId]);
  assert.deepEqual([stalled.rows[0].event.trace_id, (await setup(orgId)).issue.reason], [trace, "provider_unavailable"], "begin's trace");
  delete w.fail.mint;
  await asFounder((sql) => resume(sql, { orgId }, setupServices, t0 + 8, "trace-runner-retry"));
  busy.on = true;
  assert.match((await tick(301)).error, /WRONG_STATE/);
  busy.on = false;
  assert.deepEqual(await tick(301), { status: "processing", step: "confirm-mint", moved: false }, "a busy key is no failed try");
  assert.deepEqual(w.sent, [`org-setup:${orgId}:mint:1`]);
  w.receipts.set((await setup(orgId)).mint_tx_hash, "reverted");
  assert.deepEqual(await tick(302), { status: "needs_attention", step: "confirm-mint", moved: true });
  const last = await admin.query(`select event from app.transition_outbox where event->>'name'='org_setup_transitioned'
    and event->>'entity_id'=$1 order by seq desc limit 1`, [orgId]);
  assert.equal(last.rows[0].event.trace_id, "trace-runner-retry", "after org retry, its caller's trace");
  assert.deepEqual(await transitions(orgId), ["begin", "stall", "resume", "stall"]);
});
