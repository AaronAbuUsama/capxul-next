import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import pg from "pg";
import { Database } from "../src/platform/db.ts";
import { get, open, prepare, settleSitePayment, submitted, type ApprovalContext, type Open } from "../src/approvals/door.ts";

const url = process.env.APPROVALS_TEST_DATABASE;
if (!url || process.env.CAPXUL_DISPOSABLE !== "true" || new URL(url).pathname !== "/approvals_requests_test" ||
    !["localhost", "127.0.0.1"].includes(new URL(url).hostname)) throw new Error("dedicated loopback approvals_requests_test required");
const role = (name: string) => { const u = new URL(url!); u.username = name; u.password = `${name}-password`; return u.href; };
const migrate = () => {
  const run = spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", fileURLToPath(new URL("../src/migrate.ts", import.meta.url))], {
    encoding: "utf8", env: { ...process.env, PG_ADMIN_URL: url, DATABASE_URL: role("capxul_core"), WORKER_DATABASE_URL: role("capxul_worker"),
      PONDER_DATABASE_URL: role("capxul_ponder"), CAPXUL_WORLD: "migrate-test" } });
  assert.equal(run.status, 0, run.stderr);
};
const sender = `0x${"21".repeat(20)}`, recipient = `0x${"4a".repeat(20)}`;
const now = new Date("2026-11-13T06:00:00Z");
const legacy = { org: "org-a", request_id: "legacy-request", site: "a.test", doctype: "Purchase Invoice", name: "PINV-1",
  document_hash: `0x${"6b".repeat(32)}`, requested_by: "signer@test", to_party: "supplier", to_address: recipient, amount: "12.34", asset: "USDC" };
const terms: Open = { org_id: "org-a", opener: "payments", subject_kind: "payment", subject_id: "payment-1", chain_id: 84532,
  calls: [{ to: recipient, value: "0", data: "0x1234" }], deadline: new Date(now.getTime() + 600_000).toISOString(),
  summary: { title: "Supplier", from: { label: "Signer", address: sender }, to: { label: "Supplier" }, amount: { asset: "USDC", value: "12.34" }, recipients: [], warnings: [] } };

test("the shared migration keeps site payments org-scoped and approvals signer-scoped, fresh and repeated", { timeout: 60_000 }, async () => {
  const admin = new pg.Client({ connectionString: url }); await admin.connect();
  const db = new Database(role("capxul_core"), role("capxul_worker"));
  const as = <T>(org: string, person: string, fn: (sql: pg.PoolClient) => Promise<T>) => db.transaction(org, async (sql) => {
    await sql.query(`select set_config('app.person_id',$1,true),set_config('app.owner_kind','person',true),
      set_config('app.owner_id',$1,true),set_config('app.safe_address',$2,true)`, [person, sender]);
    return fn(sql as pg.PoolClient);
  });
  try {
    await admin.query("drop schema if exists app cascade; drop schema if exists ponder cascade");
    // A world from before the rename: the org-scoped legacy table already holds a committed site payment.
    await admin.query(readFileSync(new URL("../src/schema.sql", import.meta.url), "utf8"));
    await admin.query("insert into app.organizations(org_id,name,safe,site,admin_email,token) values ('org-a','A','safe-a','a.test','signer@test','token-a')");
    // Worlds created before the time item kept a host-clock default on created_at.
    await admin.query("alter table app.approvals alter column created_at set default now()");
    await admin.query("insert into app.approvals(org_id,id,request_id,request,trace,created_at) values ('org-a','apr_kept','legacy-request',$1,'legacy-trace',$2)",
      [{ ...legacy, to_address: recipient.toLowerCase() }, now]);
    migrate(); migrate();
    await admin.query("update app.world set clock=$1", [{ nowMs: now.getTime(), clockMode: "stopped", rate: 1 }]);
    assert.equal((await admin.query(`select column_default from information_schema.columns
      where table_schema='app' and table_name='site_payment_approvals' and column_name='created_at'`)).rows[0].column_default, null);
    const policies = (await admin.query(`select tablename,policyname,qual from pg_policies
      where schemaname='app' and tablename in ('approvals','site_payment_approvals') order by tablename,policyname`)).rows;
    assert.deepEqual(policies.map((p) => [p.tablename, p.policyname]), [["approvals", "tenant"], ["site_payment_approvals", "tenant"]]);
    assert.match(policies[0].qual, /person_id/); assert.doesNotMatch(policies[0].qual, /org_id/);
    assert.match(policies[1].qual, /org_id/);

    await admin.query("insert into app.people(org_id,address,email,name) values ('org-a',$1,'signer@test','Signer')", [sender]);
    // The legacy site-payment routes work through the restricted login and stay org-scoped.
    assert.equal((await as("org-a", "", (sql) => get(sql, "org-a", "apr_kept"))).status, "pending");
    await assert.rejects(as("org-b", "", (sql) => get(sql, "org-a", "apr_kept")), /NOT_FOUND/);
    assert.equal((await as("org-a", "", (sql) => prepare(sql, legacy, "replay"))).id, "apr_kept");
    const hash = `0x${"87".repeat(32)}`;
    assert.equal((await as("org-a", "", (sql) => submitted(sql, "org-a", "apr_kept", hash, "signer@test"))).status, "submitted");
    // An indexed fact may carry checksummed case; prepare stored lowercase.
    assert.equal((await as("org-a", "", (sql) => settleSitePayment(sql, { org: "org-a", document_hash: legacy.document_hash.toUpperCase().replace("0X", "0x"),
      recipient: recipient.toUpperCase().replace("0X", "0x"), amount_raw: "12340000", tx_hash: hash }))).matched, true);

    // approvals.tenant-is-signer: another member of the same organization sees none of a signer's approvals.
    const ctx: ApprovalContext = { person_id: "signer-a", sender, site_url: "https://core.test", now };
    const opened = await as("org-a", "signer-a", (sql) => open(sql, ctx, terms, "open-trace"));
    assert.equal((await as("org-a", "signer-a", (sql) => sql.query("select approval_id from app.approvals"))).rows[0].approval_id, opened.approval_id);
    assert.equal((await as("org-a", "member-b", (sql) => sql.query("select 1 from app.approvals"))).rowCount, 0);
    assert.equal((await as("org-a", "member-b", (sql) => sql.query("select 1 from app.approval_carriers"))).rowCount, 0);
  } finally {
    await db.close();
    await admin.query("drop schema if exists app cascade; drop schema if exists ponder cascade");
    await admin.end();
  }
});
