import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import pg from "pg";
import { Database } from "../src/platform/db.ts";
import { migrateOutbox } from "../src/platform/outbox.ts";
import { accessError, authenticate, digest, feature, readPrincipal, readPrincipalByEmail, requireFeature, revoke, routeAccess,
  sendCode, syncFlags, verifyCode, type GateCatalogue, type Principal, type SignIn } from "../src/access/door.ts";
import { admit, eligibility, personalSafe, readAdmission, readAdmissionForEvent } from "../src/accounts/door.ts";
import { startSetup } from "../src/accounts/setup.ts";

// Component regression, not selected-stack acceptance or live Mail-provider conformance.
const url = process.env.ACCESS_TEST_ADMIN_URL;
if (!url || process.env.CAPXUL_DISPOSABLE !== "true" || !new URL(url).pathname.startsWith("/access_"))
  throw new Error("ACCESS_TEST_ADMIN_URL must name a disposable /access_* Postgres database");
const admin = new pg.Client({ connectionString: url });
let db: Database;
const now = 1_772_442_000_000, run = randomUUID().slice(0, 8);
const config = { companiesHouse: "0x1234567890123456789012345678901234567890" as const, namespace: "capxul:devnet:email:v1" };
const catalogue: GateCatalogue = { "beta-access": { target: "person", money: false }, books: { target: "organization", money: true } };

before(async () => {
  await admin.connect();
  for (const role of ["capxul_core", "capxul_worker"]) {
    if (!(await admin.query("select 1 from pg_roles where rolname=$1", [role])).rowCount)
      await admin.query(`create role ${role} login nosuperuser nocreatedb nocreaterole noinherit nobypassrls`);
    const password = randomBytes(24).toString("hex");
    await admin.query(`alter role ${role} password '${password}'`);
    const target = new URL(url!); target.username = role; target.password = password;
    if (role === "capxul_core") process.env.ACCESS_TEST_TENANT = target.href;
    else process.env.ACCESS_TEST_WORKER = target.href;
  }
  await admin.query("begin");
  try {
    await admin.query(await readFile(new URL("../src/schema.sql", import.meta.url), "utf8"));
    await admin.query("grant usage on schema app to capxul_core,capxul_worker");
    await migrateOutbox(admin);
    for (const name of ["access", "accounts"]) await admin.query(await readFile(new URL(`../src/${name}/schema.sql`, import.meta.url), "utf8"));
    await admin.query("commit");
  } catch (error) { await admin.query("rollback"); throw error; }
  db = new Database(process.env.ACCESS_TEST_TENANT!, process.env.ACCESS_TEST_WORKER!);
});
after(async () => { if (db) await db.close(); await admin.end(); });

async function signIn(email: string): Promise<SignIn> {
  let code = "";
  await db.transaction("", (sql) => sendCode(sql, { email }, {
    async send(message) { code = message.text!.match(/\b\d{6}\b/)![0]; return { id: randomUUID() }; },
  }, now), true);
  const result = await db.transaction("", (sql) => verifyCode(sql, { email, code, client: "authority-component-test" }, config, now + 1), true);
  assert(result.ok); return result.value;
}

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
