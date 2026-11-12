import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { Effect } from "effect";
import { Database, record } from "../../../backend/src/platform/db.ts";
import { migrateSites, rewriteSites, SitesStore } from "./store.ts";
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
  const store = new SitesStore(db, record);
  const start = { org, world: "town1", host: `${org}-town1.localhost`, bench: "bench-test", trace: "trace-begin" };
  await Promise.all([store.begin(start), store.begin(start)]);
  const creating = await store.site(org);
  assert.equal(creating?.state, "creating");
  assert.equal(typeof creating?.created_at, "number");
  const featureRows = (await admin.query("select feature,state,wanted from app.site_features where org_id=$1 order by feature", [org])).rows;
  assert.equal(featureRows.length, 11);
  assert.deepEqual(featureRows.filter((r) => r.wanted).map((r) => r.feature), ["accounts", "crm", "people", "projects"]);
  await store.begin(start); assert.deepEqual(await store.site(org), creating);
  const observed: SiteObservation = { company: "Site test", version: "1", map_version: "hash",
    apps: ["frappe", "erpnext", "hrms", "crm", "frappe_whatsapp", "capxul"],
    features: { accounts: "on", people: "on", projects: "on", crm: "on", payroll: "off", whatsapp: "off",
      attendance: "off", recruitment: "off", reviews: "off", stock: "off", manufacturing: "off" },
    sign_in: { mode: "assertion", configured: true, oauth: false } };
  const lifecycle = { world: "town1", bench: "bench-test", store, readSite: () => Effect.succeed(observed) };
  const info = { slug: org, site: start.host, name: "Site test" };
  for (const bad of [{ ...observed, company: "Other Company" }, { ...observed, apps: ["frappe", "erpnext"] },
    { ...observed, sign_in: { ...observed.sign_in, oauth: true } }, { ...observed, features: { ...observed.features, payroll: "on" as const } }]) {
    await assert.rejects(settleSite({ ...lifecycle, readSite: () => Effect.succeed(bad) }, info, "bad-native-state"),
      { code: "PROVIDER_RESPONSE_INVALID" });
    assert.equal((await store.site(org))?.state, "creating");
  }
  await assert.rejects(store.transition(org, "ready", "not-acked", { appVersion: "1", mapVersion: "hash" }), { code: "WRONG_STATE" });
  await store.transition(org, "fail", "trace-fail", { failure: "PROVIDER_ERROR" });
  assert.equal((await store.site(org))?.failure, "PROVIDER_ERROR");
  await new SitesStore(db, record).begin(start);
  await admin.query("update app.organizations set released=true,next_seq=2,last_ack=1 where org_id=$1", [org]);
  await settleSite(lifecycle, info, "trace-ready");
  const ready = await store.site(org); assert.equal(ready?.state, "ready"); assert.ok(ready?.ready_at);
  await store.begin(start); assert.deepEqual(await store.site(org), ready);
  const call = { org, callId: "create-1", person: "director@example.invalid", verb: "create", doctype: "Supplier", name: "SUP-1",
    outcome: "ok" as const, refusal: null, trace: "trace-create" };
  await Promise.all([store.logCall(call), store.logCall(call)]);
  await store.logCall({ ...call, outcome: "refused", refusal: "ROLE_PERMISSION_DENIED" });
  assert.equal((await admin.query("select outcome from app.door_calls where org_id=$1", [org])).rows[0].outcome, "ok");
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
  const events = (await admin.query("select kind,data from app.records where org_id=$1 order by id", [org])).rows;
  assert.deepEqual(events.filter((e) => e.kind === "site_transitioned").map((e) => e.data.transition), ["begin", "fail", "retry", "ready"]);
  assert.equal(events.filter((e) => e.kind === "site_feature_transitioned").length, 11);
  assert.equal(events.filter((e) => e.kind === "document_door_call").length, 1);
  const broken = new SitesStore(db, async (...args) => { await record(...args); throw new Error("record unavailable"); });
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
