import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { createPublicClient, createWalletClient, encodeFunctionData, http, pad, parseAbi, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { db, now, run, config, catalogue, signIn, publicAccess } from "./access-fixture.ts";
import { createAccessClient, signInByKey } from "../../sdk/src/access/door.ts";
import { accessError, authenticate, digest, feature, readPrincipal, readPrincipalByEmail, requireFeature, revoke, routeAccess,
  gatedNeeds, gates, sendCode, syncFlags, verifyCode, type Principal, type SignIn } from "../src/access/door.ts";
import { admit, eligibility, personalSafe, readAdmission, readAdmissionForEvent, routeAccounts } from "../src/accounts/door.ts";
import { startSetup } from "../src/accounts/setup.ts";

test("opaque sessions establish only the verified person and immediately reject revocation/expiry", async () => {
  const a = await signIn(`sam-${run}@example.test`), b = await signIn(`other-${run}@elsewhere.test`);
  await db.transaction("forged-company", async (sql) => {
    const p = await authenticate(sql, a.token, now + 2);
    assert.equal(p.personId, a.personId); assert.equal(p.safeAddress, a.safe);
    const context = (await sql.query(`select current_setting('app.person_id') as person,current_setting('app.email') as email,
      current_setting('app.safe_address') as safe,current_setting('app.org_id') as org`)).rows[0];
    assert.deepEqual(context, { person: a.personId, email: `sam-${run}@example.test`, safe: a.safe, org: "" });
    assert.equal(await readPrincipal(sql, b.personId), null);
    assert.equal((await sql.query("select count(*)::int as n from app.principals")).rows[0].n, 1);
    await assert.rejects(authenticate(sql, "forged", now + 2), /NOT_AUTHENTICATED/);
    assert.equal((await sql.query("select current_setting('app.person_id') as id")).rows[0].id, "");
  });
  await assert.rejects(db.transaction("", (sql) => sql.query("update app.principals set safe_address=$1 where person_id=$2", [b.safe, a.personId])), /permission denied/);
  await db.transaction("", (sql) => revoke(sql, a.token, now + 3), true);
  await assert.rejects(db.transaction("", (sql) => authenticate(sql, a.token, now + 4)), /NOT_AUTHENTICATED/);
  await assert.rejects(db.transaction("", (sql) => authenticate(sql, b.token, now + 30 * 86_400_000 + 1)), /NOT_AUTHENTICATED/);
  await db.transaction("", async (sql) => {
    assert.equal((await sql.query("select token_hash from app.sessions where person_id=$1", [a.personId])).rows[0].token_hash, digest(a.token));
    assert.equal((await readPrincipalByEmail(sql, ` SAM-${run}@EXAMPLE.TEST `))!.personId, a.personId);
  }, true);
});

test("wrong-code attempts commit; exhausted/replayed codes and failed sends cannot create principals", async () => {
  const email = `tries-${run}@example.test`;
  let actual = "";
  const mail = { async send(message: { text?: string }) { actual = message.text!.match(/\b\d{6}\b/)![0]; return { id: "test-transport" }; } };
  await db.transaction("", (sql) => sendCode(sql, { email }, mail, now), true);
  const wrong = actual === "000000" ? "111111" : "000000";
  for (let tries = 2; tries >= 0; tries--) {
    assert.deepEqual(await db.transaction("", (sql) => verifyCode(sql, { email, code: wrong, client: "test" }, config, now + 1), true),
      { ok: false, error: "INVALID_INPUT", triesLeft: tries });
  }
  assert.deepEqual(await db.transaction("", (sql) => verifyCode(sql, { email, code: actual, client: "test" }, config, now + 1), true), { ok: false, error: "RATE_LIMITED" });
  await db.transaction("", (sql) => sendCode(sql, { email }, mail, now + 60_000), true);
  const good = await db.transaction("", (sql) => verifyCode(sql, { email, code: actual, client: "test" }, config, now + 60_001), true);
  assert(good.ok);
  assert.deepEqual(await db.transaction("", (sql) => verifyCode(sql, { email, code: actual, client: "test" }, config, now + 60_002), true), { ok: false, error: "INVALID_INPUT" });
  const failed = `unsent-${run}@example.test`;
  await assert.rejects(db.transaction("", (sql) => sendCode(sql, { email: failed }, { async send() { throw new Error("PROVIDER_ERROR"); } }, now), true), /PROVIDER_ERROR/);
  assert.equal((await db.worker.query("select 1 from app.sign_in_codes where email=$1", [failed])).rowCount, 0);
  for (const invalid of ["two@@example.test", "one@example.test/path", "one@-bad.test", ".leading@example.test"])
    await assert.rejects(db.transaction("", (sql) => sendCode(sql, { email: invalid }, mail, now), true), /INVALID_INPUT/);
  assert.equal((await db.transaction("", (sql) => sendCode(sql, { email: ` Élodie+${run}@example.test ` }, mail, now), true)).email, `élodie+${run}@example.test`);
});

test("public route adapter commits wrong-code results and renders safe error/identity shapes", async () => {
  const email = `route-${run}@example.test`;
  let code = "";
  const services = { personalSafe: config, agent: { secret: "component-only", domain: "access-component", rpc: "http://127.0.0.1:1", agentOwner: config.companiesHouse },
    mail: { async send(message: { text?: string }) { code = message.text!.match(/\b\d{6}\b/)![0]; return { id: "component-mail" }; } } };
  const call = (path: string, input: Record<string, unknown>, token = "") => db.transaction("", (sql) => routeAccess(sql, path, input, token, services, now), true);
  assert.equal((await call("/access/sign-in/send-code", { email }))!.status, 200);
  try { await call("/access/sign-in/send-code", { email }); assert.fail("cooldown must refuse"); }
  catch (error) { assert.deepEqual(accessError(error), { status: 429, body: { error: "RATE_LIMITED", retryAfterMs: 60_000 } }); }
  assert.deepEqual(await call("/access/sign-in/verify-code", { email, code: code === "999999" ? "888888" : "999999", client: "public-component" }),
    { status: 400, body: { error: "INVALID_INPUT", triesLeft: 2 } });
  assert.equal((await db.worker.query("select attempts_left from app.sign_in_codes where email=$1", [email])).rows[0].attempts_left, 2);
  const signed = (await call("/access/sign-in/verify-code", { email, code, client: "public-component" }))!;
  assert.equal(signed.status, 200);
  const value = signed.body as SignIn & { email: string };
  assert.deepEqual(Object.keys(value).sort(), ["email", "expiresAt", "personId", "safe", "token"]);
  const ended = (await call("/access/sessions/revoke", {}, value.token))!.body as { sessionId: string; endedAt: string };
  assert.equal(ended.endedAt, new Date(now).toISOString()); assert(ended.sessionId);
  await assert.rejects(call("/access/sessions/current", {}, value.token), /NOT_AUTHENTICATED/);
  assert.deepEqual(accessError(new Error("SQL internal secret database URL")), { status: 500, body: { error: "INTERNAL_ERROR" } });
});

test("flags use target IDs and strict rollout, fail closed on unsupported rules and stale money gates", async () => {
  const stamp = new Date(now), actor = { personId: "person-asymmetric", orgId: "company-asymmetric" };
  await db.transaction("", (sql) => syncFlags(sql, [
    { key: "beta-access", active: true, target: "person", rules: [{ ids: [actor.personId], rollout: 100 }], unsupported: null, checked_at: stamp },
    { key: "books", active: true, target: "organization", rules: [{ ids: [actor.orgId], rollout: 100 }], unsupported: null, checked_at: stamp },
  ], catalogue, now), true);
  await db.transaction("", async (sql) => {
    assert(await feature(sql, "books", actor, catalogue, now + 600_000));
    assert(!await feature(sql, "books", actor, catalogue, now + 600_001));
    assert(await feature(sql, "beta-access", actor, catalogue, now + 600_001));
    assert(!await feature(sql, "beta-access", { personId: actor.orgId }, catalogue, now));
    await assert.rejects(requireFeature(sql, "books", { personId: actor.personId, orgId: "another" }, catalogue, now), /FEATURE_NOT_AVAILABLE/);
  });
  await db.transaction("", (sql) => syncFlags(sql, [{ key: "books", active: true, target: "organization", rules: [], unsupported: "cohort", checked_at: stamp }], catalogue, now + 1), true);
  await db.transaction("", async (sql) => {
    assert(!await feature(sql, "books", actor, catalogue, now + 1));
    assert(!await feature(sql, "beta-access", actor, catalogue, now + 1), "a removed provider flag must be deleted");
  });
  await assert.rejects(db.transaction("", (sql) => sql.query("update app.feature_flags set active=true")), /permission denied/);
});

test("the carrier reads an approval's gate through Core's catalogue, then its needs without the gate", async () => {
  type A = { gate: string | null; person_id: string; org_id: string | null };
  const org = `org-${run}`, seen: (string | null)[] = [], at = (ms: number) => async () => new Date(now + ms);
  const on = (key: string) => ({ key, active: true, target: "organization" as const, rules: [{ ids: [org], rollout: 100 }], unsupported: null, checked_at: new Date(now) });
  await db.transaction("", (sql) => syncFlags(sql, [on("owner-safe-proposals"), on("books")], gates, now), true);
  const check = (clock: () => Promise<Date>, needs = true) => gatedNeeds(db, clock, async (a: A) => { seen.push(a.gate); return needs; });
  const approval = (gate: string | null, org_id: string | null = org): A => ({ gate, person_id: `person-${run}`, org_id });
  assert.equal(await check(at(1))(approval("owner-safe-proposals")), true);
  assert.equal(await check(at(1))(approval("owner-safe-proposals", "another-org")), false);
  assert.equal(await check(at(1))(approval("owner-safe-proposals", null)), false, "an Organization gate needs the approval's Organization");
  assert.equal(await check(at(600_001))(approval("owner-safe-proposals")), false, "a money gate closes on a stale sync");
  assert.equal(await check(at(600_001))(approval("books")), true, "books is no money gate: it keeps its synced value");
  for (const key of ["payment-departments", "__proto__", "toString"]) assert.equal(await check(at(1))(approval(key)), false, key);
  assert.equal(await check(at(1), false)(approval("owner-safe-proposals")), false);
  assert.equal(await check(at(1))(approval(null, null)), true);
  assert.deepEqual(seen, [null, null, null, null], "needs run only once the gate is open, and never see the gate");
});

test("admission, referral and privacy-safe source events roll back with the caller and serialize retries", async () => {
  const email = `waiting-${run}@example.test`, referrer = `referrer-${run}@example.test`, trace = randomUUID();
  await db.worker.query(`insert into app.admissions(email,status,note,joined_via,requested_at,updated_at)
    values($1,'waiting','keep my note','waitlist',17,17)`, [email]);
  await db.worker.query("insert into app.referrals(referrer_email,referee_email,via,stage,attributed_at) values($1,$2,'link','attributed',13)", [referrer, email]);
  await assert.rejects(db.transaction("", async (sql) => {
    await admit(sql, { email, via: "invitation", ref: "company-a" }, trace, now);
    throw new Error("caller authority fact failed");
  }, true), /caller authority fact failed/);
  assert.equal((await db.transaction("", (sql) => readAdmission(sql, email), true))!.status, "waiting");
  assert.equal((await db.worker.query("select 1 from app.transition_outbox where event->>'trace_id'=$1", [trace])).rowCount, 0);
  const answers = await Promise.all(["invitation", "escrow"].map((via) => db.transaction("", (sql) =>
    admit(sql, { email: ` ${email.toUpperCase()} `, via: via as "invitation" | "escrow", ref: "source-a" }, trace, now + 1), true)));
  assert.equal(answers.filter((a) => a.admitted).length, 1);
  const events = (await db.worker.query("select event from app.transition_outbox where event->>'trace_id'=$1 order by seq", [trace])).rows.map((r) => r.event);
  assert.equal(events.length, 2); assert.equal(events[0].props.transition, "admit"); assert.equal(events[1].props.transition, "admit");
  assert.equal(JSON.stringify(events).includes(email), false); assert.equal(JSON.stringify(events).includes(referrer), false);
  const row = await db.transaction("", (sql) => readAdmissionForEvent(sql, events[0].entity_id), true);
  assert.equal(row.mailbox, email); assert.equal(row.referrer_email, referrer); assert.equal(row.note, "keep my note");
  assert.equal(row.requested_at, 17); assert.equal(row.admitted_at, now + 1);
  const before = await db.transaction("", (sql) => readAdmission(sql, email), true);
  assert.deepEqual(await db.transaction("", (sql) => admit(sql, { email, via: "fde-guest", ref: "later" }, "later", now + 100), true), { email, admitted: false });
  assert.deepEqual(await db.transaction("", (sql) => readAdmission(sql, email), true), before);
  const unlisted = `unlisted-${run}@example.test`, unlistedTrace = randomUUID();
  await db.transaction("", (sql) => admit(sql, { email: unlisted, via: "escrow", ref: "payment-one" }, unlistedTrace, now + 2), true);
  const event = (await db.worker.query("select event from app.transition_outbox where event->>'trace_id'=$1", [unlistedTrace])).rows[0].event;
  assert.equal(event.props.transition, "admit_unlisted"); assert.equal(event.owner_kind, null); assert.equal(event.owner_id, null);
  const source = await db.transaction("", (sql) => readAdmissionForEvent(sql, event.entity_id), true);
  assert.equal(source.mailbox, unlisted); assert.equal(source.requested_at, null); assert.equal(source.admitted_by, "escrow:payment-one");
  await assert.rejects(db.transaction("", (sql) => admit(sql, { email: "not-mail", via: "escrow", ref: "bad" }, "bad", now), true), /INVALID_INPUT/);
});

test("mailbox/person RLS isolates two real session actors and only guarded setup start writes its own immutable Safe", async () => {
  const email = `setup-${run}@example.test`, login = await signIn(email), other = await signIn(`other-setup-${run}@example.test`);
  let p: Principal;
  p = await db.transaction("", (sql) => authenticate(sql, login.token, now + 1), true);
  const options = { ...config, catalogue, async requireProfile() {} }; // Test guard, not proof of the parties profile workflow.
  await assert.rejects(db.transaction("", (sql) => startSetup(sql, p, "0x1111111111111111111111111111111111111111", options, "setup", now), true), /FEATURE_NOT_AVAILABLE/);
  await db.transaction("", (sql) => admit(sql, { email, via: "invitation", ref: "org" }, "admit-setup", now), true);
  const setup = await db.transaction("", (sql) => startSetup(sql, p, "0x1111111111111111111111111111111111111111", options, "setup", now), true);
  assert.equal(setup.safe_address, login.safe); assert.equal(setup.status, "claiming");
  assert.deepEqual(await db.transaction("", (sql) => startSetup(sql, p, setup.signer_address, options, "retry-same", now + 100), true), setup);
  await assert.rejects(db.transaction("", (sql) => startSetup(sql, p, "0x2222222222222222222222222222222222222222", options, "different", now), true), /WRONG_STATE/);
  await db.transaction("", async (sql) => {
    await authenticate(sql, other.token, now + 2);
    assert.equal(await personalSafe(sql, p.personId), null); assert.equal(await readAdmission(sql, email), null);
    assert.equal((await eligibility(sql, await authenticate(sql, other.token, now + 2), catalogue, now)).access, "waiting");
  });
  await assert.rejects(db.transaction("", async (sql) => { await authenticate(sql, login.token, now + 2); await sql.query("update app.personal_safes set status='ready' where person_id=$1", [p.personId]); }), /permission denied/);
});

test("public setup reads project lifecycle/refusal states without starting work and authenticate the caller", async () => {
  const email = `setup-read-${run}@example.test`, login = await signIn(email);
  let profile = false;
  const services = { ...config, catalogue, setupUrl: "https://component.invalid/setup",
    async requireProfile() { if (!profile) throw new Error("PROFILE_NOT_FOUND"); } };
  const call = (path: string, input: Record<string, unknown> = {}, bearer = login.token) =>
    db.transaction("", (sql) => routeAccounts(sql, `/accounts/setup/${path}`, input, bearer, services, now + 2), true);
  const required = { setupState: "setup-required", setupUrl: services.setupUrl,
    next: { argv: ["capxul", "account", "retry"] }, safe: login.safe, claimed: false, collected: 0 };
  await assert.rejects(call("check", {}, "forged"), /NOT_AUTHENTICATED/);
  assert.deepEqual((await call("check"))!.body, required);
  await assert.rejects(call("lifecycle"), /PROFILE_NOT_FOUND/);
  profile = true; // Profile guard control, not proof of the Parties public workflow.
  await assert.rejects(call("lifecycle"), /SMART_ACCOUNT_MISSING/);
  await assert.rejects(call("start", { signer: "0x1111111111111111111111111111111111111111" }), /FEATURE_NOT_AVAILABLE/);
  await db.transaction("", (sql) => admit(sql, { email, via: "invitation", ref: "setup-read" }, "setup-read", now), true);
  const started = await call("start", { signer: "0x1111111111111111111111111111111111111111" });
  assert.deepEqual(started!.body, { safe: login.safe, status: "claiming", attempt: 1 });
  assert.deepEqual((await call("lifecycle"))!.body, { lifecycle: { status: "settingUp", step: "claiming" } });
  assert.deepEqual((await call("check"))!.body, required);
  await assert.rejects(call("lifecycle", { personId: "another-person" }), /NOT_AUTHENTICATED/);
  // Storage fixtures cover the public read projection only, never claim/receipt acceptance.
  for (const status of ["collecting", "ready"] as const) {
    await db.worker.query("update app.personal_safes set status=$2,collected=3 where person_id=$1", [login.personId, status]);
    assert.deepEqual((await call("lifecycle"))!.body, { lifecycle: { status: "ready", safe: login.safe, canTransact: true, collecting: status === "collecting" } });
    assert.deepEqual((await call("check"))!.body, { setupState: "ready", setupUrl: null, next: null, safe: login.safe, claimed: true, collected: 3 });
  }
  for (const code of ["WRONG_STATE", "INVALID_INPUT", "TRANSACTION_FAILED", "PROVIDER_ERROR"] as const) {
    await db.worker.query("update app.personal_safes set status='failed',failure_code=$2,collected=0 where person_id=$1", [login.personId, code]);
    const before = await db.transaction("", (sql) => personalSafe(sql, login.personId), true);
    const body = (await call("lifecycle"))!.body as { lifecycle: { status: string; at: string; error: { code: string; message: string } } };
    assert.equal(body.lifecycle.status, "failed"); assert.equal(body.lifecycle.at, "claiming"); assert.equal(body.lifecycle.error.code, code);
    assert(body.lifecycle.error.message.length > 0); assert(!body.lifecycle.error.message.includes("stack"));
    if (code === "WRONG_STATE" || code === "INVALID_INPUT") await assert.rejects(call("check"), new RegExp(code));
    else assert.deepEqual((await call("check"))!.body, required);
    assert.deepEqual(await db.transaction("", (sql) => personalSafe(sql, login.personId), true), before);
  }
});

test("agent challenge proves actual v4 AgentOwner and sole Safe signer, refusing mismatches, frozen agents and replay", async () => {
  const rpc = process.env.ACCESS_TEST_RPC_URL;
  assert(rpc, "ACCESS_TEST_RPC_URL must name an isolated Anvil loaded from committed v4 core state");
  assert(["127.0.0.1", "localhost"].includes(new URL(rpc).hostname), "component chain must be local");
  const deployment = JSON.parse(await readFile(new URL("../../contracts/deployments/devnet.json", import.meta.url), "utf8"));
  const agentOwner = deployment.contracts.AgentOwner.address as Address;
  const client = createPublicClient({ transport: http(rpc) });
  const controller = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" as const;
  const wallet = createWalletClient({ account: controller, transport: http(rpc) });
  const safeAbi = parseAbi(["function setup(address[],uint256,address,bytes,address,address,uint256,address)",
    "function execTransaction(address,uint256,bytes,uint8,uint256,uint256,uint256,address,address,bytes) returns (bool)"]);
  const zero = "0x0000000000000000000000000000000000000000" as const;
  const factory = { address: "0x14F2982D601c9458F93bd70B218933A6f8165e7b" as const,
    abi: parseAbi(["function createProxyWithNonce(address,bytes,uint256) returns (address)"]) };
  const initializer = encodeFunctionData({ abi: safeAbi, functionName: "setup", args: [[controller], 1n, zero, "0x", zero, zero, 0n, zero] });
  const deploy = await client.simulateContract({ ...factory, functionName: "createProxyWithNonce", account: controller,
    args: ["0xEdd160fEBBD92E350D4D398fb636302fccd67C7e", initializer, BigInt(`0x${randomBytes(16).toString("hex")}`)] });
  assert.equal((await client.waitForTransactionReceipt({ hash: await wallet.writeContract({ ...deploy.request, chain: null }) })).status, "success");
  const owner = deploy.result, signer = privateKeyToAccount(generatePrivateKey());
  const abi = parseAbi(["function create(address,address) returns (address)", "function safeAddressFor(address,address) view returns (address)", "function freeze(address)", "function unfreeze(address)"]);
  const safe = await client.readContract({ address: agentOwner, abi, functionName: "safeAddressFor", args: [signer.address, owner] });
  const execute = async (data: Hex) => {
    const signature = `${pad(controller, { size: 32 })}${"0".repeat(64)}01` as Hex;
    const args = [agentOwner, 0n, data, 0, 0n, 0n, 0n, zero, zero, signature] as const;
    const simulated = await client.simulateContract({ address: owner, abi: safeAbi, functionName: "execTransaction", args, account: controller });
    assert.equal(simulated.result, true);
    assert.equal((await client.waitForTransactionReceipt({ hash: await wallet.writeContract({ ...simulated.request, chain: null }) })).status, "success");
  };
  await execute(encodeFunctionData({ abi, functionName: "create", args: [signer.address, owner] }));
  const services = { personalSafe: config, mail: { async send() { throw new Error("not used"); } }, agent: { secret: "component-domain-secret", domain: "component.invalid", rpc, agentOwner } };
  const call = (path: string, input: Record<string, unknown>, bearer = "") => db.transaction("", (sql) => routeAccess(sql, path, input, bearer, services, now), true);
  const prove = async () => {
    const body = (await call("/access/sign-in/challenge", { safe }))!.body as { challenge: string };
    return { safe, challenge: body.challenge, signature: await signer.signMessage({ message: body.challenge }), client: "agent-component" };
  };
  const input = await prove();
  await assert.rejects(call("/access/sign-in/with-key", { ...input, safe: owner }), /NOT_AUTHENTICATED/);
  const outsider = privateKeyToAccount(generatePrivateKey());
  await assert.rejects(call("/access/sign-in/with-key", { ...input, signature: await outsider.signMessage({ message: input.challenge }) }), /NOT_AUTHENTICATED/);
  const result = (await call("/access/sign-in/with-key", input))!.body as SignIn & { owner: string; signer: string };
  assert.equal(result.owner, owner.toLowerCase()); assert.equal(result.signer, signer.address.toLowerCase());
  const p = await db.transaction("", (sql) => authenticate(sql, result.token, now), true);
  assert.equal(p.kind, "agent"); assert.equal(p.email, null); assert.equal(p.safeAddress, safe.toLowerCase());
  await assert.rejects(db.transaction("", (sql) => routeAccounts(sql, "/accounts/setup/check", {}, result.token,
    { ...config, catalogue, setupUrl: "https://component.invalid/setup", async requireProfile() { throw new Error("agent must be refused first"); } }, now), true), /NOT_AUTHENTICATED/);
  assert.deepEqual((await call("/access/sessions/current", {}, result.token))!.body, { personId: result.personId, kind: "agent", email: null,
    safe: safe.toLowerCase(), expiresAt: result.expiresAt, setupState: "ready" });
  const human = await signIn(`chain-human-${run}@example.test`);
  assert.equal(((await call("/access/sessions/current", {}, human.token))!.body as { setupState: string }).setupState, "setup-required");
  await assert.rejects(call("/access/sign-in/with-key", input), /NOT_AUTHENTICATED/);
  const frozenProof = await prove();
  await execute(encodeFunctionData({ abi, functionName: "freeze", args: [safe] }));
  await assert.rejects(call("/access/sign-in/with-key", frozenProof), /NOT_AUTHENTICATED/);
  await execute(encodeFunctionData({ abi, functionName: "unfreeze", args: [safe] }));
  // Actor preparation's public path: the SDK helper signs in over HTTP and reads the session back; a second call is a new session.
  const actorServer = await publicAccess(services, () => now + 1);
  try {
    const http = createAccessClient({ coreUrl: actorServer.url }), sign = (message: string) => signer.signMessage({ message });
    const first = await signInByKey(http, { safe, client: "actor-prep", signMessage: sign });
    assert.deepEqual([first.session.kind, first.session.safe, first.signIn.signer], ["agent", safe.toLowerCase(), signer.address.toLowerCase()]);
    const again = await signInByKey(http, { safe, client: "actor-prep-restored", signMessage: sign });
    assert.notEqual(again.signIn.token, first.signIn.token); assert.equal(again.session.personId, first.session.personId);
    await assert.rejects(signInByKey(http, { safe, client: "outsider", signMessage: (message) => outsider.signMessage({ message }) }), /NOT_AUTHENTICATED/);
  } finally { await actorServer.close(); }
  assert.equal(((await call("/access/sign-in/with-key", frozenProof))!.body as SignIn).personId, result.personId);
  const server = await publicAccess(services, () => now);
  try {
    const remote = createAccessClient({ coreUrl: server.url });
    const challenge = await remote.challenge({ safe });
    const signed = await remote.withKey({ safe, challenge: challenge.challenge,
      signature: await signer.signMessage({ message: challenge.challenge }), client: "public-agent" });
    assert.equal(signed.owner, owner.toLowerCase()); assert.equal(signed.signer, signer.address.toLowerCase());
    assert.deepEqual(await remote.current(signed.token), { personId: result.personId, kind: "agent", email: null,
      safe: safe.toLowerCase(), expiresAt: signed.expiresAt, setupState: "ready" });
    await remote.revoke(signed.token);
    await assert.rejects(remote.current(signed.token), /NOT_AUTHENTICATED/);
    const renewedChallenge = await remote.challenge({ safe });
    const renewed = await remote.withKey({ safe, challenge: renewedChallenge.challenge,
      signature: await signer.signMessage({ message: renewedChallenge.challenge }), client: "fresh-public-agent" });
    assert.notEqual(renewed.token, signed.token); assert.equal(renewed.personId, signed.personId);
    assert.equal((await remote.current(renewed.token)).safe, safe.toLowerCase());
  } finally { await server.close(); }
});
