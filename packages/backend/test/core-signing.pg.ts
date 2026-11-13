import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import pg from "pg";
import { digest, migrateAccess } from "../src/access/door.ts";
import { open, type ApprovalContext, type Open } from "../src/approvals/door.ts";
import { Database } from "../src/platform/db.ts";
import { signature } from "../src/plugs/door.ts";
import { createCore, type CarrierChain } from "../src/server.ts";

const url = process.env.APPROVALS_TEST_DATABASE;
if (!url || process.env.CAPXUL_DISPOSABLE !== "true" || new URL(url).pathname !== "/approvals_requests_test" ||
    !["localhost", "127.0.0.1"].includes(new URL(url).hostname)) throw new Error("dedicated loopback approvals_requests_test required");
const role = (name: string) => { const u = new URL(url!); u.username = name; u.password = `${name}-password`; return u.href; };
const world = "core-signing-test", secret = "core-signing-secret";
const sender = `0x${"21".repeat(20)}`, recipient = `0x${"4a".repeat(20)}`;
const now = new Date("2026-11-13T06:00:00Z");
const bearer = "s".repeat(43), otherBearer = "o".repeat(43);
const terms: Open = { org_id: "org-a", opener: "payments", subject_kind: "payment", subject_id: "payment-1", chain_id: 84532,
  calls: [{ to: recipient, value: "0", data: "0x1234" }], deadline: new Date(now.getTime() + 600_000).toISOString(),
  summary: { title: "Supplier", from: { label: "Signer", address: sender }, to: { label: "Supplier" }, amount: { asset: "USDC", value: "12.34" }, recipients: [], warnings: [] } };
// Sponsorship always answers expired, so the approval stays `sponsoring` until its lapse and only the signer ends it.
const chain: CarrierChain = () => ({
  sponsor: async () => ({ expired: true as const }),
  send: async () => { throw new Error("send must not run"); },
  lookup: async () => { throw new Error("lookup must not run"); },
  nonce: async () => { throw new Error("nonce must not run"); },
  needsAndGate: async () => false,
});

test("Core mounts the signer's routes with the carrier, and the carrier, not the route, tells the opener", { timeout: 60_000 }, async () => {
  const admin = new pg.Client({ connectionString: url }); await admin.connect();
  const db = new Database(role("capxul_core"), role("capxul_worker"));
  const config = { database: role("capxul_core"), workerDatabase: role("capxul_worker"), secret, port: 0, host: "127.0.0.1",
    url: "http://127.0.0.1", frappe: "http://127.0.0.1:1", ponder: "http://127.0.0.1:1", rpc: "http://127.0.0.1:1", chainId: 84532,
    socket: "http://127.0.0.1:1", startPaused: false, finality: 0, world };
  const core = createCore(config, undefined, chain, { siteUrl: "https://site.test", network: { name: "Control net", explorerUrl: "https://explorer.test" } });
  let started = false;
  try {
    await admin.query("drop schema if exists app cascade; drop schema if exists ponder cascade");
    const run = spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", fileURLToPath(new URL("../src/migrate.ts", import.meta.url))], {
      encoding: "utf8", env: { ...process.env, PG_ADMIN_URL: url, DATABASE_URL: role("capxul_core"), WORKER_DATABASE_URL: role("capxul_worker"),
        PONDER_DATABASE_URL: role("capxul_ponder"), CAPXUL_WORLD: world } });
    assert.equal(run.status, 0, run.stderr);
    await migrateAccess(admin);
    await admin.query("update app.world set clock=$1", [{ nowMs: now.getTime(), clockMode: "stopped", rate: 1 }]);
    for (const [person, token] of [["signer-a", bearer], ["member-b", otherBearer]] as const) {
      await admin.query("insert into app.principals(person_id,kind,email,safe_address,created_at) values ($1,'person',$2,$3,$4)",
        [person, `${person}@test`, person === "signer-a" ? sender : `0x${"35".repeat(20)}`, now]);
      await admin.query(`insert into app.sessions(person_id,session_id,token_hash,method,status,client,created_at,expires_at)
        values ($1,$2,$3,'code','active','test',$4,$5)`, [person, `session-${person}`, digest(token), now, new Date(now.getTime() + 3_600_000)]);
    }
    const ctx: ApprovalContext = { person_id: "signer-a", sender, site_url: "https://site.test", now };
    const opened = await db.transaction("org-a", async (sql) => {
      await sql.query(`select set_config('app.person_id',$1,true),set_config('app.owner_kind','person',true),
        set_config('app.owner_id',$1,true),set_config('app.safe_address',$2,true)`, [ctx.person_id, sender]);
      return open(sql, ctx, terms, "open-trace");
    });

    const address = await core.start(); started = true;
    assert(address && typeof address === "object");
    const base = `http://127.0.0.1:${address.port}`;
    const call = (path: string, init: RequestInit = {}, token = bearer) =>
      fetch(`${base}${path}`, { ...init, headers: { authorization: `Bearer ${token}`, ...init.headers }, signal: AbortSignal.timeout(5000) });
    const post = (name: string, id: string, token = bearer) => call(`/approvals/signing/${name}`, { method: "POST", body: JSON.stringify({ approvalId: id }),
      headers: { "content-type": "application/json", "x-capxul-trace": `trace-${name}`, "x-capxul-call-id": `call-${name}-${token[0]}` } }, token);

    const view: any = await (await call(`/approvals/signing/get?approvalId=${opened.approval_id}`)).json();
    assert.equal(view.state, "sponsoring");
    assert.equal(view.url, `https://site.test/approve/${opened.approval_id}`);
    assert.deepEqual(view.network, { chainId: 84532, name: "Control net", explorerUrl: "https://explorer.test" });
    // Authenticated through Access' sessions: no bearer, and another principal's bearer, reach nothing.
    assert.equal((await fetch(`${base}/approvals/signing/get?approvalId=${opened.approval_id}`)).status, 401);
    assert.equal((await call(`/approvals/signing/get?approvalId=${opened.approval_id}`, {}, otherBearer)).status, 400);

    // A paused world refuses the signer's writes but still answers reads.
    const pause = "{}";
    assert.equal((await fetch(`${base}/admin/snapshot/pause`, { method: "POST", body: pause, headers: { "x-capxul-signature": signature(pause, secret) } })).status, 200);
    assert.equal((await post("decline", opened.approval_id)).status, 503);
    assert.equal((await call(`/approvals/signing/get?approvalId=${opened.approval_id}`)).status, 200);
    assert.equal((await fetch(`${base}/admin/snapshot/resume`, { method: "POST", body: pause, headers: { "x-capxul-signature": signature(pause, secret) } })).status, 200);

    const declined = await post("decline", opened.approval_id);
    assert.equal(declined.status, 200);
    assert.equal(((await declined.json()) as any).state, "declined");
    const row = (await admin.query("select state,ended_at from app.approvals where approval_id=$1", [opened.approval_id])).rows[0];
    assert.equal(row.state, "declined"); assert.equal(row.ended_at.getTime(), now.getTime());
    // The route called no opener: the carrier row it woke is delivered and removed by the carrier's next tick.
    let carried = true;
    for (let i = 0; i < 50 && carried; i++) {
      carried = !!(await admin.query("select 1 from app.approval_carriers where approval_id=$1", [opened.approval_id])).rowCount;
      if (carried) await new Promise((done) => setTimeout(done, 100));
    }
    assert.equal(carried, false, "the carrier delivers the decline to its opener");
    const events = (await admin.query("select event->'props'->>'to' as to from app.transition_outbox where event->>'name'='approval_transitioned' order by seq")).rows;
    assert.deepEqual(events.map((e) => e.to), ["sponsoring", "declined"]);
  } finally {
    if (started) await core.stop();
    await db.close();
    await admin.query("drop schema if exists app cascade; drop schema if exists ponder cascade");
    await admin.end();
  }
});
