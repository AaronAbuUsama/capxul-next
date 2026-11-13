import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import pg from "pg";
import { Database, type Sql } from "../src/platform/db.ts";
import { migrateOutbox } from "../src/platform/outbox.ts";
import { companySafeAddress } from "../src/platform/safe.ts";
import { readPrincipal } from "../src/access/door.ts";
import { eligibility } from "../src/accounts/door.ts";
import { addBoughtSeats, begin, get, migrate, readDeployment, readSetupFounder, resume, returnBoughtSeats, type SetupServices } from "../src/organizations/door.ts";

// Standalone PG control on a dedicated loopback database, built from the concept migrations alone (no legacy schema).
// Eligibility is the real Accounts door; the image and Board services are stand-ins, not Media or indexing proof.
const url = process.env.SETUPS_TEST_ADMIN_URL;
if (!url || new URL(url).pathname !== "/setups_test" || !["localhost", "127.0.0.1"].includes(new URL(url).hostname))
  throw new Error("SETUPS_TEST_ADMIN_URL must name a dedicated loopback setups_test database");
const sqlFile = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const admin = new pg.Client({ connectionString: url });
const role = (name: string) => { const u = new URL(url); u.username = name; u.password = "setups"; return u.href; };
let db: Database;
const now = 1_767_225_600_000, trace = "trace-setups-4417";
const config = { companiesHouse: "0x00000000000000000000000000000000000c4a11" as const, namespace: "capxul:test:company:v1" };
const people = Object.fromEntries(["founder", "waiting", "unclaimed", "other"].map((name, n) => [name, {
  id: `person_${name}`, email: `${name}@setups.test`, safe: `0x${(0xabc000 + n).toString(16).padStart(40, "0")}`, party: `party_${name}`,
}]));
const services: SetupServices = {
  chainId: 84532, companySafe: config, pricedCurrencies: ["GHS", "EUR"],
  async eligibility(sql) {
    const principal = await readPrincipal(sql, (await sql.query("select current_setting('app.person_id',true) as id")).rows[0].id);
    return eligibility(sql, principal!, { "beta-access": { target: "person", money: false } }, now);
  },
  async requireImage(_sql, fileId) { if (fileId !== "file_kept_image") throw new Error("INVALID_INPUT: not your kept image"); return {}; },
  async board() { return null; },
};
const as = <T>(name: string, run: (sql: Sql) => Promise<T>) => db.transaction("", async (sql) => {
  const p = people[name]!;
  await sql.query("select set_config('app.person_id',$1,true),set_config('app.email',$2,true),set_config('app.safe_address',$3,true)", [p.id, p.email, p.safe]);
  return run(sql);
}, true);
const count = async (table: string) => Number((await admin.query(`select count(*) from app.${table}`)).rows[0].count);
const events = async (name: string) => (await admin.query("select event from app.transition_outbox where event->>'name'=$1 order by seq", [name])).rows.map((r) => r.event);
const acme = { name: "  Ñandú Holdings  co ", handle: "@Acme-Labs", country: "gh", bio: "  We build.  ", size: "   ", apps: ["wiki", "helpdesk", "wiki"] };

test.before(async () => {
  await admin.connect();
  await admin.query(`create role capxul_core login password 'setups' nosuperuser nobypassrls;
    create role capxul_worker login password 'setups' nosuperuser nobypassrls; create schema app;
    grant usage on schema app to capxul_core,capxul_worker`);
  await migrateOutbox(admin);
  for (const path of ["../src/access/schema.sql", "../src/accounts/schema.sql", "../src/parties/schema.sql"]) await admin.query(sqlFile(path));
  await migrate(admin);
  db = new Database(role("capxul_core"), role("capxul_worker"));
  for (const [name, p] of Object.entries(people)) {
    await admin.query("insert into app.principals(person_id,kind,email,safe_address,created_at) values($1,'person',$2,$3,now())", [p.id, p.email, p.safe]);
    await admin.query(`insert into app.admissions(email,person_id,status,joined_via,admitted_at,admitted_by,updated_at)
      values($1,$2,$3,'operator',$4,$5,1)`, [p.email, p.id, name === "waiting" ? "waiting" : "admitted", name === "waiting" ? null : 1, name === "waiting" ? null : "operator"]);
    await admin.query(`insert into app.personal_safes(person_id,email,safe_address,signer_address,status,attempt,collected,created_at,updated_at)
      values($1,$2,$3,'0x00000000000000000000000000000000000051e1',$4,1,0,1,1)`, [p.id, p.email, p.safe, name === "unclaimed" ? "claiming" : "ready"]);
    await admin.query(`insert into app.parties(party_id,kind,state,safe_address,owner_kind,owner_id,created_at,updated_at)
      values($1,'person','active',$2,'person',$3,1,1)`, [p.party, p.safe, p.id]);
  }
});
test.after(async () => { await db?.close(); await admin.end(); });

test("the target tables have exactly the blueprint fields, and a legacy table refuses the migration", async () => {
  const columns = async (t: string) => (await admin.query("select column_name from information_schema.columns where table_schema='app' and table_name=$1 order by ordinal_position", [t])).rows.map((r) => r.column_name);
  assert.deepEqual(await columns("organizations"), ["org_id", "party_id", "name", "country", "bio", "size", "logo_file_id", "chain_id", "safe_address",
    "founder_party_id", "founder_safe", "seat_limit", "seat_limit_raised_by", "seat_limit_raised_at", "abbr", "default_currency", "time_zone",
    "fiscal_year_start", "created_at", "updated_at"]);
  assert.deepEqual(await columns("org_setups"), ["org_id", "founder_principal_id", "intent_hash", "with_fde", "status", "steps", "mint_tx_hash",
    "deploy_tx_hash", "install_approval_id", "issue", "fde_signer", "fde_safe", "fde_party_id", "checked_at", "ready_at", "created_at", "updated_at"]);
  const legacy = new pg.Client({ connectionString: url });
  await legacy.connect();
  try {
    await legacy.query("begin; alter table app.organizations rename to organizations_target");
    await legacy.query("create table app.organizations (org_id text primary key, site text not null)");
    await assert.rejects(migrate(legacy), /LEGACY_ORGANIZATIONS/);
  } finally { await legacy.query("rollback"); await legacy.end(); }
});

test("begin refuses the waitlisted, the unclaimed and invalid input before any write", async () => {
  const before = await Promise.all(["organizations", "org_setups", "org_apps", "parties", "transition_outbox"].map(count));
  await assert.rejects(as("waiting", (sql) => begin(sql, acme, services, now, trace)), /^Error: FEATURE_NOT_AVAILABLE/);
  await assert.rejects(as("unclaimed", (sql) => begin(sql, acme, services, now, trace)), /^Error: WRONG_STATE/);
  await assert.rejects(db.transaction("", (sql) => begin(sql, acme, services, now, trace), true), /^Error: NOT_AUTHENTICATED/);
  for (const bad of [{ ...acme, logoFileId: "file_someone_elses" }, { ...acme, bio: ` ${"b".repeat(281)} ` }, { ...acme, handle: "ab" },
    { ...acme, country: "XX" }, { ...acme, currency: "JPY" }, { ...acme, timeZone: "Mars/Olympus" }, { ...acme, fiscalYearStart: "02-30" },
    { ...acme, apps: ["erpnext"] }, { ...acme, country: "KR" }])
    await assert.rejects(as("founder", (sql) => begin(sql, bad, services, now, trace)), /^Error: INVALID_INPUT/, JSON.stringify(bad));
  assert.deepEqual(await Promise.all(["organizations", "org_setups", "org_apps", "parties", "transition_outbox"].map(count)), before);
  assert.equal((await admin.query("select count(*) from app.parties where handle='acme-labs'")).rows[0].count, "0");
});

test("begin births the Organization, setup, apps and pending Party in one transaction; the same intent resumes", async () => {
  const [first, second] = await Promise.all([0, 1].map(() => as("founder", (sql) => begin(sql, { ...acme, logoFileId: "file_kept_image" }, services, now, trace))));
  assert.equal(first!.orgId, second!.orgId);
  assert.deepEqual([first!.resumed, second!.resumed].sort(), [false, true]);
  const org = (await admin.query("select * from app.organizations where org_id=$1", [first!.orgId])).rows[0];
  const safe = companySafeAddress(config, "acme-labs", people.founder!.safe as `0x${string}`);
  assert.deepEqual({ ...org, created_at: Number(org.created_at), updated_at: Number(org.updated_at), chain_id: Number(org.chain_id) }, {
    org_id: first!.orgId, party_id: org.party_id, name: "Ñandú Holdings  co", country: "GH", bio: "We build.", size: null,
    logo_file_id: "file_kept_image", chain_id: 84532, safe_address: safe, founder_party_id: "party_founder", founder_safe: people.founder!.safe,
    seat_limit: 10, seat_limit_raised_by: null, seat_limit_raised_at: null, abbr: "NHC", default_currency: "GHS", time_zone: "Africa/Accra",
    fiscal_year_start: "01-01", created_at: now, updated_at: now });
  const party = (await admin.query("select * from app.parties where party_id=$1", [org.party_id])).rows[0];
  assert.deepEqual([party.kind, party.state, party.handle, party.safe_address, party.owner_kind, party.owner_id],
    ["organization", "pending", "acme-labs", safe, "organization", first!.orgId]);
  assert.deepEqual(first!.setup, { orgId: first!.orgId, safe, setup: "processing", steps: [], issue: null, recovery: "none", approvalId: null,
    checkedAt: now, board: null, fde: null });
  const apps = (await admin.query("select app,modules,native,status,added_by from app.org_apps where org_id=$1 order by app", [first!.orgId])).rows;
  assert.deepEqual(apps.map((a) => [a.app, a.native, a.status, a.added_by]), [["crm", true, "installed", null], ["erpnext", true, "installed", null],
    ["frappe", true, "installed", null], ["helpdesk", false, "wanted", "person_founder"], ["hrms", true, "installed", null], ["wiki", false, "wanted", "person_founder"]]);
  const all = await events("party_transitioned").then(async (p) => [...p, ...await events("org_setup_transitioned"), ...await events("org_app_transitioned")]);
  assert.equal(all.length, 1 + 1 + 6, "one birth's events, none from the resumed replay");
  for (const e of all) assert.equal(e.trace_id, trace);
  assert.deepEqual((await events("org_setup_transitioned"))[0].props, { from: null, to: "processing", transition: "begin", org_id: first!.orgId, person_id: "person_founder", issue_reason: null });
  await assert.rejects(as("founder", (sql) => begin(sql, { ...acme, logoFileId: "file_kept_image", bio: "Changed" }, services, now, trace)), /^Error: WRONG_STATE/);
  await assert.rejects(as("other", (sql) => begin(sql, { ...acme, logoFileId: "file_kept_image" }, services, now, trace)), /^Error: INVALID_INPUT: handle is taken/);
  const india = await as("other", (sql) => begin(sql, { name: "Desi Works", handle: "desi", country: "IN", fde: false }, services, now, trace));
  const row = (await admin.query("select default_currency,time_zone,fiscal_year_start,abbr from app.organizations where org_id=$1", [india.orgId])).rows[0];
  assert.deepEqual(row, { default_currency: "USD", time_zone: "Asia/Kolkata", fiscal_year_start: "04-01", abbr: "DW" });
});

test("get and resume answer the founder and refuse everyone else alike; RLS keeps tenants to their own setups", async () => {
  const orgId = (await admin.query("select org_id from app.organizations where abbr='NHC'")).rows[0].org_id;
  assert.equal((await as("founder", (sql) => get(sql, { orgId }, services))).setup, "processing");
  assert.deepEqual(await readSetupFounder(db.worker, orgId), { orgId, founderPrincipalId: "person_founder", founderSafe: people.founder!.safe,
    safe: companySafeAddress(config, "acme-labs", people.founder!.safe as `0x${string}`), status: "processing", steps: [] });
  assert.equal(await readSetupFounder(db.worker, "org_unknown"), null);
  assert.equal(await readDeployment(db.worker, orgId), null, "no deployment before MoneyDeployed");
  await admin.query(`insert into app.org_deployments values($1,$2,'11','12','13','14','15','16',$3,$4,$5,4417,$6)`,
    [orgId, `0x${"5a".repeat(20)}`, `0x${"7a".repeat(20)}`, `0x${"9a".repeat(20)}`, `0x${"ee".repeat(32)}`, now]);
  const deployed = await readDeployment(db.worker, orgId);
  assert.deepEqual([deployed?.director_hat, deployed?.books_hat, deployed?.gate_address, deployed?.block_number], ["13", "14", `0x${"9a".repeat(20)}`, 4417]);
  const tenantRead = (name: string) => db.transaction("", async (sql) => {
    await sql.query("select set_config('app.person_id',$1,true)", [people[name]!.id]);
    return readDeployment(sql, orgId);
  });
  assert.equal(await tenantRead("founder"), null, "the founder is not yet a member: the deployment stays hidden from tenants");
  for (const id of [orgId, "org_unknown"]) await assert.rejects(as("other", (sql) => get(sql, { orgId: id }, services)), /^Error: ROLE_PERMISSION_DENIED/);
  await assert.rejects(as("other", (sql) => resume(sql, { orgId }, services, now, trace)), /^Error: INVALID_INPUT/);
  assert.equal((await as("founder", (sql) => resume(sql, { orgId }, services, now + 1, trace))).setup, "processing");
  await admin.query("update app.org_setups set status='needs_attention',issue=$2 where org_id=$1", [orgId, { reason: "provider_unavailable", code: "PROVIDER_ERROR", at: now }]);
  const resumed = await as("founder", (sql) => resume(sql, { orgId }, services, now + 2, trace));
  assert.deepEqual([resumed.setup, resumed.issue, resumed.recovery], ["processing", null, "none"]);
  assert.deepEqual((await events("org_setup_transitioned")).at(-1).props.transition, "resume");
  await admin.query("update app.org_setups set status='failed' where org_id=$1", [orgId]);
  await assert.rejects(as("founder", (sql) => resume(sql, { orgId }, services, now + 3, trace)), /^Error: WRONG_STATE/);
  const tenant = async (name: string) => db.transaction("", async (sql) => {
    const p = people[name]!;
    await sql.query("select set_config('app.person_id',$1,true)", [p.id]);
    return (await sql.query("select org_id from app.org_setups order by org_id")).rows.length;
  });
  assert.equal(await tenant("founder"), 1); assert.equal(await tenant("waiting"), 0);
  for (const q of ["update app.org_setups set status='ready'", "insert into app.org_apps(org_id,app,modules,native,status,created_at,updated_at) values('x','x','{}',false,'wanted',0,0)",
    "update app.organizations set seat_limit=99"]) await assert.rejects(db.transaction("", (sql) => sql.query(q)), /permission denied/);
  await assert.rejects(db.worker.query("delete from app.organizations"), /permission denied/);
});

test("bought seats raise and lower the limit exactly while the Payment stands, once each", async () => {
  const orgId = (await admin.query("select org_id from app.organizations where abbr='DW'")).rows[0].org_id;
  const buy = { org_id: orgId, payment_id: "pay_7", command_id: "cmd_7", seats: 3, chain_id: 84532, token_address: `0x${"ab".repeat(20)}`,
    asset: "USDC", amount_raw: "30000000", bought_by_party_id: "party_other", tx_hash: `0x${"1f".repeat(32)}`, block_number: 77 };
  for (const bad of [{ ...buy, seats: 0 }, { ...buy, seats: 1001 }, { ...buy, seats: 2.5 }, { ...buy, org_id: "org_none" }])
    await assert.rejects(db.transaction("", (sql) => addBoughtSeats(sql, bad, now, trace), true), /^Error: INVALID_INPUT/);
  await assert.rejects(db.transaction("", async (sql) => { await addBoughtSeats(sql, buy, now, trace); throw new Error("abort-settle"); }, true), /abort-settle/);
  const limit = async () => (await admin.query("select seat_limit,seat_limit_raised_by from app.organizations where org_id=$1", [orgId])).rows[0];
  assert.deepEqual(await limit(), { seat_limit: 10, seat_limit_raised_by: null });
  const step = (run: (sql: Sql) => Promise<unknown>) => db.transaction("", run, true);
  assert.deepEqual(await step((sql) => addBoughtSeats(sql, buy, now, trace)), { org_id: orgId, payment_id: "pay_7", seat_limit: 13, added: true });
  assert.deepEqual(await step((sql) => addBoughtSeats(sql, buy, now + 1, trace)), { org_id: orgId, payment_id: "pay_7", seat_limit: 13, added: false });
  assert.deepEqual(await step((sql) => returnBoughtSeats(sql, { org_id: orgId, payment_id: "pay_7" }, now + 2, trace)), { org_id: orgId, payment_id: "pay_7", seat_limit: 10, returned: true });
  assert.deepEqual(await step((sql) => returnBoughtSeats(sql, { org_id: orgId, payment_id: "pay_7" }, now + 3, trace)), { org_id: orgId, payment_id: "pay_7", seat_limit: 10, returned: false });
  assert.deepEqual(await step((sql) => addBoughtSeats(sql, { ...buy, seats: 3 }, now + 4, trace)), { org_id: orgId, payment_id: "pay_7", seat_limit: 13, added: true });
  assert.deepEqual(await limit(), { seat_limit: 13, seat_limit_raised_by: "purchase" });
  assert.deepEqual((await events("seat_purchase_transitioned")).map((e) => [e.props.transition, e.props.from, e.props.to]),
    [["add", null, "counted"], ["take_back", "counted", "returned"], ["add_again", "returned", "counted"]]);
});
