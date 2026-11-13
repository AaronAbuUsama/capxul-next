import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import pg from "pg";
import { Effect } from "effect";
import { Database, record, type Sql } from "../../../backend/src/platform/door.ts";
import { migrateSites, readSiteHosts, rewriteSites, SitesStore } from "./store.ts";
import { settleSite, type SiteObservation } from "./lifecycle.ts";

test("Postgres sites survive retries, enforce RLS and retain atomic transition/call records", { skip: process.env.CAPXUL_SITES_PG_TEST !== "1" }, async (t) => {
  const adminUrl = process.env.PG_ADMIN_URL!;
  assert.ok(["localhost", "127.0.0.1"].includes(new URL(adminUrl).hostname), "only a disposable orb database may run this test");
  const admin = new pg.Client({ connectionString: adminUrl }); await admin.connect();
  const db = new Database(process.env.DATABASE_URL!, process.env.WORKER_DATABASE_URL!);
  const org = `sites${randomUUID().replaceAll("-", "").slice(0, 12)}`, other = `${org}b`;
  t.after(async () => {
    for (const table of ["door_calls", "site_features", "sites", "site_events", "records", "organizations"])
      await admin.query(`delete from app.${table} where org_id=any($1)`, [[org, other]]);
    await db.close(); await admin.end();
  });
  await admin.query("BEGIN"); await migrateSites(admin); await admin.query("COMMIT");
  for (const [i, id] of [org, other].entries()) await admin.query(`insert into app.organizations(org_id,name,safe,site,admin_email,token)
    values($1,'Site test',$2,$3,'director@example.invalid',$4)`, [id, `0x${randomUUID().replaceAll("-", "").padEnd(40, String(i))}`, `${id}-town1.localhost`, `0x${"9".repeat(40)}`]);
  let now = 1_767_225_600_123, clockUnavailable = false;
  const frozenAt = now;
  const worldNow = async (sql: Sql) => {
    assert([org, other].includes((await sql.query("select current_setting('app.org_id') as org")).rows[0].org));
    if (clockUnavailable) throw new Error("INVALID_CLOCK");
    return now;
  };
  const writeRecord: ConstructorParameters<typeof SitesStore>[1] = record;
  const store = new SitesStore(db, writeRecord, worldNow);
  const start = { org, world: "town1", host: `${org}-town1.localhost`, bench: "bench-test", trace: "trace-begin" };
  await Promise.all([store.begin(start), store.begin(start)]);
  const creating = await store.site(org);
  assert.equal(creating?.state, "creating");
  assert.equal(creating?.created_at, frozenAt); assert.equal(creating?.updated_at, frozenAt);
  assert.deepEqual((await admin.query("select distinct updated_at from app.site_features where org_id=$1", [org])).rows, [{ updated_at: frozenAt }]);
  const featureRows = (await admin.query("select feature,state,wanted from app.site_features where org_id=$1 order by feature", [org])).rows;
  assert.equal(featureRows.length, 11);
  assert.deepEqual(featureRows.filter((r) => r.wanted).map((r) => r.feature), ["accounts", "crm", "people", "projects"]);
  await store.begin(start); assert.deepEqual(await store.site(org), creating);
  // Hosts come from the Sites store under the caller's scope; another company's row stays invisible, worker included.
  for (const worker of [false, true]) {
    assert.deepEqual(await db.transaction(org, (sql) => readSiteHosts(sql), worker), { [org]: start.host });
    assert.deepEqual(await db.transaction(other, (sql) => readSiteHosts(sql, [org, other]), worker), {});
  }
  const observed: SiteObservation = { company: "Site test", version: "1", map_version: "hash",
    apps: ["frappe", "erpnext", "hrms", "crm", "frappe_whatsapp", "capxul"],
    features: { accounts: "on", people: "on", projects: "on", crm: "on", payroll: "off", whatsapp: "off",
      attendance: "off", recruitment: "off", reviews: "off", stock: "off", manufacturing: "off" },
    sign_in: { mode: "assertion", configured: true, oauth: false } };
  // Optional source is captured from capxul.features.state on a disposable native site, never reconstructed here.
  const nativeFeatures = process.env.CAPXUL_SITES_NATIVE_FEATURES
    ? JSON.parse(readFileSync(process.env.CAPXUL_SITES_NATIVE_FEATURES, "utf8")) : observed.features;
  const driftFeatures = process.env.CAPXUL_SITES_NATIVE_DRIFT_FEATURES
    ? JSON.parse(readFileSync(process.env.CAPXUL_SITES_NATIVE_DRIFT_FEATURES, "utf8")) : { ...observed.features, payroll: "on" };
  const lifecycle = { world: "town1", bench: "bench-test", store,
    readSite: () => Effect.succeed({ ...observed, features: nativeFeatures }) };
  const info = { slug: org, site: start.host, name: "Site test" };
  await t.test("native configuration drift refuses readiness without changing saved state", async () => {
    for (const bad of [{ ...observed, company: "Other Company" }, { ...observed, apps: ["frappe", "erpnext"] },
      { ...observed, sign_in: { ...observed.sign_in, oauth: true } }, { ...observed, features: driftFeatures }]) {
      await assert.rejects(settleSite({ ...lifecycle, readSite: () => Effect.succeed(bad) }, info, "bad-native-state"),
        { code: "PROVIDER_RESPONSE_INVALID" });
      assert.equal((await store.site(org))?.state, "creating");
    }
  });
  await assert.rejects(store.transition(org, "ready", "not-acked", { appVersion: "1", mapVersion: "hash" }), { code: "WRONG_STATE" });
  await store.transition(org, "fail", "trace-fail", { failure: "PROVIDER_ERROR" });
  assert.equal((await store.site(org))?.failure, "PROVIDER_ERROR");
  assert.equal((await store.site(org))?.updated_at, frozenAt);
  now += 61_000;
  await new SitesStore(db, writeRecord, worldNow).begin(start);
  await admin.query("update app.organizations set released=true,next_seq=2,last_ack=1 where org_id=$1", [org]);
  await t.test("observed feature defaults and released ACK permit readiness", async () => {
    await settleSite(lifecycle, info, "trace-ready");
  });
  const ready = await store.site(org); assert.equal(ready?.state, "ready"); assert.equal(ready?.ready_at, now);
  assert.equal(ready?.created_at, frozenAt); assert.equal(ready?.updated_at, now);
  await store.begin(start); assert.deepEqual(await store.site(org), ready);
  const call = { org, callId: "create-1", person: "director@example.invalid", verb: "create", doctype: "Supplier", name: "SUP-1",
    outcome: "ok" as const, refusal: null, trace: "trace-create" };
  await Promise.all([store.logCall(call), store.logCall(call)]);
  const callAt = now; now += 73_000;
  await store.logCall({ ...call, outcome: "refused", refusal: "ROLE_PERMISSION_DENIED" });
  assert.deepEqual((await admin.query("select outcome,created_at from app.door_calls where org_id=$1", [org])).rows,
    [{ outcome: "ok", created_at: callAt }]);
  clockUnavailable = true;
  await assert.rejects(store.logCall({ ...call, callId: "clock-failure" }), /INVALID_CLOCK/);
  assert.equal((await admin.query("select count(*)::int n from app.door_calls where org_id=$1", [org])).rows[0].n, 1);
  clockUnavailable = false;
  await assert.rejects(store.logCall({ ...call, person: "intruder@example.invalid" }), { code: "INVALID_INPUT" });
  for (const system of [false, true]) {
    for (const table of ["sites", "site_features", "door_calls"]) {
      await db.transaction(other, async (sql) => {
        assert.equal((await sql.query(`select * from app.${table}`)).rows.some((r) => r.org_id === org), false);
        assert.equal((await sql.query(`update app.${table} set org_id=org_id where org_id=$1`, [org])).rowCount, 0);
      }, system);
    }
  }
  assert.deepEqual(await db.transaction(other, async (sql) => (await sql.query("select * from app.site_by_host($1)", [start.host])).rows, true), [{ org_id: org, site_id: org }]);
  const events = (await admin.query("select kind,data,extract(epoch from at)*1000 as at from app.records where org_id=$1 order by id", [org])).rows;
  assert.deepEqual(events.filter((e) => e.kind === "site_transitioned").map((e) => e.data.transition), ["begin", "fail", "retry", "ready"]);
  assert.deepEqual(events.filter((e) => e.kind === "site_transitioned").map((e) => Number(e.at)), [frozenAt, frozenAt, callAt, callAt]);
  assert.equal(events.filter((e) => e.kind === "site_feature_transitioned").length, 11);
  assert(events.filter((e) => e.kind === "site_feature_transitioned").every((e) => Number(e.at) === frozenAt));
  assert.equal(events.filter((e) => e.kind === "document_door_call").length, 1);
  assert.equal(Number(events.find((e) => e.kind === "document_door_call").at), callAt);
  const broken = new SitesStore(db, async (...args) => { await writeRecord(...args); throw new Error("record unavailable"); }, worldNow);
  await assert.rejects(broken.begin({ ...start, org: other, host: `${other}-town1.localhost` }), /record unavailable/);
  for (const table of ["sites", "site_features", "records"])
    assert.equal((await admin.query(`select count(*)::int as n from app.${table} where org_id=$1`, [other])).rows[0].n, 0);
  await store.transition(org, "archive", "trace-archive");
  await assert.rejects(store.begin(start), { code: "ROLE_PERMISSION_DENIED" });
  await assert.rejects(store.transition(org, "resume", "trace-invalid"), { code: "WRONG_STATE" });
  const archived = await store.site(org);
  const savedCalls = (await admin.query("select * from app.door_calls where org_id=$1", [org])).rows;
  const cut = (await admin.query("select * from app.records where org_id=$1 order by id", [org])).rows;
  const target = { world: "clone1", bench: "clone-bench", sites: { [org]: `${org}-clone1.localhost` } };
  await admin.query("BEGIN");
  await assert.rejects(rewriteSites(admin, { ...target, sites: {} }), { code: "INVALID_INPUT" });
  await admin.query("ROLLBACK");
  assert.deepEqual(await store.site(org), archived);
  await admin.query("BEGIN"); await rewriteSites(admin, target); await admin.query("COMMIT");
  assert.deepEqual(await store.site(org), { ...archived, host: target.sites[org], world_id: target.world, bench: target.bench });
  assert.deepEqual((await admin.query("select * from app.door_calls where org_id=$1", [org])).rows, savedCalls);
  assert.deepEqual((await admin.query("select * from app.records where org_id=$1 order by id", [org])).rows, cut);
  assert.deepEqual((await admin.query("select feature,state,wanted from app.site_features where org_id=$1 order by feature", [org])).rows, featureRows);
});
