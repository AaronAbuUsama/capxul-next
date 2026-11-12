import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:http";
import { readFile, appendFile } from "node:fs/promises";
import { setTimeout as wait } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import test from "node:test";
import { Server } from "socket.io";
import { encodeFunctionData } from "viem";
import { signature } from "../src/plugs/door.ts";
import { Database } from "../src/platform/db.ts";
import { connect, send } from "../../devnet/src/modules/chain/service.ts";
import { board, ERC20, HATS, pay, type Protocol } from "../../devnet/src/modules/company/service.ts";
import { THIRD_PARTY } from "../../devnet/src/modules/protocol/service.ts";
import { testKey } from "../../devnet/src/modules/test-keys/service.ts";

const dir = process.env.CORE_PROOF_DIR;
if (!dir || process.env.CAPXUL_DISPOSABLE !== "true" || process.env.CAPXUL_WORLD === "main") throw new Error("CORE_PROOF_DIR and named disposable migrated Postgres/Ponder/v4 world required");
const fixture = JSON.parse(await readFile(`${dir}/fixture.json`, "utf8"));
const secret = "core-protocol-proof-only";
const coreUrl = "http://127.0.0.1:18787";
const db = new Database(process.env.DATABASE_URL!, process.env.WORKER_DATABASE_URL!);
async function until<T>(read: () => Promise<T>, accepts: (v: T) => boolean, label: string, timeout = 30_000): Promise<T> {
  const end = Date.now() + timeout;
  do { const v = await read(); if (accepts(v)) return v; await wait(100); } while (Date.now() < end);
  throw new Error(`timed out: ${label}`);
}
async function post(path: string, value: unknown, expected = 200) {
  const raw = JSON.stringify(value);
  const r = await fetch(`${coreUrl}${path}`, { method: "POST", body: raw, headers: { "x-capxul-signature": signature(raw, secret), "x-capxul-trace": "trace-supplier-12.34" } });
  const b: any = await r.json(); assert.equal(r.status, expected, JSON.stringify(b)); return b;
}

test("real v4/Ponder payment survives Core death, lost site ACK and replay without a second posting", { timeout: 150_000 }, async () => {
  let core: ChildProcess | undefined;
  let generic200 = true, dropDelivery = false, dropAnswer = false, parked = false;
  let lastSeq = 0, answerCalls = 0, deliveryCalls = 0;
  const effects = new Map<string, any>(), received = new Map<string, any>(), answers: any[] = [], requests: any[] = [];
  const receiver = createServer(async (req, res) => {
    const chunks = []; for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks).toString();
    assert.equal(req.headers["x-capxul-signature"], signature(raw, secret));
    const b = JSON.parse(raw);
    const reply = (body: unknown, status = 200) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify({ message: body })); };
    if (req.url?.endsWith("payment_request_listener")) return reply({ authorization: "CapxulListener fixture", namespace: "/core.test", event: "capxul_payment_request", expires_at: Math.floor(Date.now() / 1000) + 60 });
    if (req.url?.endsWith("collect_payment_requests")) return reply({ requests: requests.filter((r) => r.cursor > b.after), cursor: requests.length });
    if (req.url?.endsWith("answer_payment_request")) {
      if (answers.length && !isDeepStrictEqual(b, answers[0])) return reply({ error: "Conflicting answer for payment request" }, 409);
      answerCalls++; answers.push(b);
      if (dropAnswer) { req.socket.destroy(); return; }
      return reply({ request_id: b.request_id, status: "Waiting for signature", duplicate: answerCalls > 1 });
    }
    if (req.url?.endsWith("retry_parked_event")) {
      if (parked) return reply({ applied: false, duplicate: false, parked: true, last_seq: lastSeq, error: "voucher is still invalid" });
      assert.ok(received.has(b.event_key));
      effects.set(b.event_key, received.get(b.event_key));
      return reply({ applied: true, duplicate: false, parked: false, last_seq: lastSeq });
    }
    deliveryCalls++;
    if (generic200) return reply({ ok: true });
    const duplicate = effects.has(b.event_key);
    if (!received.has(b.event_key)) {
      if (b.seq !== lastSeq + 1) return reply({ expected: lastSeq + 1 }, 409);
      received.set(b.event_key, b); lastSeq = b.seq;
    }
    if (!parked) effects.set(b.event_key, b);
    if (dropDelivery && b.kind === "payment_sent") { req.socket.destroy(); return; }
    reply({ applied: !duplicate && !parked, duplicate, parked: parked && !duplicate, last_seq: lastSeq, ...(parked && !duplicate ? { error: "voucher is invalid" } : {}), ...(b.kind.startsWith("hat_") ? { map_version: "immutable-map-v1" } : {}) });
  });
  const realtime = new Server(receiver);
  realtime.of("/core.test").use((socket, next) => {
    assert.equal(socket.handshake.headers.authorization, "CapxulListener fixture");
    assert.equal(socket.handshake.headers.origin, siteUrl); next();
  });
  await new Promise<void>((done) => receiver.listen(0, "127.0.0.1", done));
  const siteUrl = `http://127.0.0.1:${(receiver.address() as any).port}`;
  async function start(paused = false, origin = coreUrl) {
    core = spawn(process.execPath, ["--experimental-strip-types", fileURLToPath(new URL("../src/main.ts", import.meta.url))], {
      env: { ...process.env, CAPXUL_SECRET: secret, CORE_URL: origin, CORE_PORT: "18787", CORE_HOST: "127.0.0.1", FRAPPE_URL: siteUrl, FRAPPE_SOCKET_URL: siteUrl, SITE_SERVICE_URL: siteUrl, SITE_SERVICE_TOKEN: "fixture-only", FINALITY_DEPTH: "0", CORE_START_PAUSED: String(paused) }, stdio: ["ignore", "pipe", "pipe"],
    });
    for (const stream of [core.stdout, core.stderr]) stream?.on("data", (c) => { void appendFile(`${dir}/core.log`, c); });
    await until(() => fetch(`${coreUrl}/${paused ? "health" : "ready"}`).then((r) => r.status, () => 0), (status) => status === 200, "Core and real Ponder readiness");
  }
  async function kill() {
    if (core?.exitCode === null) { const exited = new Promise<void>((done) => core!.once("exit", () => done())); core.kill("SIGKILL"); await exited; }
  }
  try {
    await start();
    await post("/org/site/provision", {}, 401);
    const registration = { slug: fixture.slug, name: fixture.companyName, safe: fixture.safe, site: "core.test", adminEmail: "founder@core.test", token: fixture.token,
      hats: { [fixture.hat]: { name: "budget-holder", department: "Finance" } },
      people: [{ email: "founder@core.test", name: "Founder", address: testKey("founder").address, personalSafe: fixture.founderSafe }, { email: "payer@core.test", name: "Finance Payer", address: testKey("second").address }] };
    await post("/admin/org", registration);
    const founderInfo = (await post("/admin/org-info", { org: fixture.slug })).people.find((p: any) => p.email === "founder@core.test");
    assert.equal(founderInfo.address, testKey("founder").address.toLowerCase());
    assert.equal(founderInfo.personalSafe, fixture.founderSafe.toLowerCase());
    await post("/admin/release", { org: fixture.slug });
    await until(() => post("/admin/status", { org: fixture.slug }), (s) => s.pending.length >= 2 && s.pending[0].attempts > 0, "generic HTTP 200 did not ACK");
    assert.equal((await post("/admin/status", { org: fixture.slug })).last_ack, "0");
    generic200 = false;
    await until(() => post("/admin/status", { org: fixture.slug }), (s) => s.pending.length === 0, "hat and capital delivery");
    const payment = { request_id: "site-request-1", org: fixture.slug, site: "core.test", doctype: "Payment Entry", name: "ACC-PAY-12-34", document_hash: fixture.documentHash,
      requested_by: "payer@core.test", to_party: "Real Supplier", to_address: testKey("payee").address, amount: "12.34", asset: "USDC", department: "Finance" };
    const a = await post("/prepare", payment);
    assert.equal((await post("/prepare", payment)).approval_id, a.approval_id);
    await post("/prepare", { ...payment, amount: "12.35" }, 400);
    requests.push({ ...payment, trace_id: "trace-supplier-12.34", idempotency_key: "site-request-1", cursor: 1 });
    dropAnswer = true; realtime.of("/core.test").emit("capxul_payment_request", { org: fixture.slug, cursor: 1 });
    await until(async () => answerCalls, (n) => n > 0, "committed approval answered over scoped listener");
    await kill();
    assert.equal((await db.worker.query("select request_cursor from app.organizations where org_id=$1", [fixture.slug])).rows[0].request_cursor, "0");
    dropAnswer = false; await start(false, "http://localhost:18787");
    await until(() => db.worker.query("select request_cursor from app.organizations where org_id=$1", [fixture.slug]), (r) => r.rows[0].request_cursor === "1", "lost request answer ACK recovered");
    assert.ok(answers.length >= 2); assert.ok(answers.every((answer) => answer.approval_id === a.approval_id));
    assert.ok(answers.every((answer) => answer.approval_url === `${coreUrl}/approve/${a.approval_id}`));
    assert.equal((await post("/approvals/get", { org: fixture.slug, id: a.approval_id })).status, "pending");
    const chain = await connect(process.env.RPC_URL!);
    const record = JSON.parse(await readFile(new URL("../../contracts/deployments/devnet.json", import.meta.url), "utf8"));
    const protocol: Protocol = { chain, record, installerAbi: [] };
    dropDelivery = true;
    const sent = await pay(protocol, { key: testKey("second").key, budget: BigInt(fixture.department), to: testKey("payee").address, amount: 12_340_000n, kind: 1, documentHash: fixture.documentHash, jobNonce: fixture.documentHash });
    if (!sent.ok) assert.fail(`${sent.reason}: ${sent.detail}`);
    await until(async () => [...effects.values()].filter((e) => e.kind === "payment_sent"), (es) => es.length === 1, "real indexed PaymentSent reached site");
    await kill();
    const paymentEvent = [...effects.values()].find((e) => e.kind === "payment_sent");
    assert.equal(paymentEvent.data.amount, "12.34"); assert.equal(paymentEvent.data.tx_hash, sent.txHash);
    assert.equal(paymentEvent.data.document_hash, fixture.documentHash);
    assert.equal((await db.worker.query("select state from app.site_events where org_id=$1 and kind='payment_sent'", [fixture.slug])).rows[0].state, "pending");
    dropDelivery = false; await start();
    await until(() => post("/admin/status", { org: fixture.slug }), (s) => s.pending.length === 0, "lost delivery ACK recovered");
    const settled = await post("/approvals/get", { org: fixture.slug, id: a.approval_id });
    assert.equal(settled.status, "settled"); assert.equal(settled.txHash, sent.txHash);
    assert.equal([...effects.values()].filter((e) => e.kind === "payment_sent").length, 1);
    await post("/admin/resend", { org: fixture.slug, from: 1 });
    await until(() => post("/admin/status", { org: fixture.slug }), (s) => s.pending.length === 0, "full company stream replay");
    assert.equal([...effects.values()].filter((e) => e.kind === "payment_sent").length, 1);
    const cut = await post("/admin/snapshot/pause", {});
    assert.equal(cut.paused, true); assert.equal(cut.activeDeliveries, 0); assert.equal(cut.activeRequests, 0);
    await post("/prepare", { ...payment, request_id: "paused-request" }, 503);
    assert.equal((await fetch(`${coreUrl}/ready`)).status, 503);
    await post("/admin/snapshot/resume", {}); await post("/admin/snapshot/resume", {});
    // App RLS, view scope and pool-local tenant state are tested with the real restricted login.
    assert.equal((await db.tenant.query("select count(*)::int as n from app.approvals")).rows[0].n, 0);
    assert.equal((await db.transaction(fixture.slug, (sql) => sql.query("select count(*)::int as n from app.chain_payments"))).rows[0].n, 1);
    assert.equal((await db.transaction("other-company", (sql) => sql.query("select count(*)::int as n from app.chain_payments"))).rows[0].n, 0);
    await assert.rejects(db.tenant.query("select * from ponder.chain_payments"), /permission denied/);
    await assert.rejects(db.worker.query("update app.records set trace='changed'"), /permission denied/);
    assert.equal((await db.worker.query("select count(*)::int as n from app.approvals where org_id=$1", [fixture.slug])).rows[0].n, 1);
    const records = await post("/admin/record", { org: fixture.slug });
    const queued = records.filter((r: any) => r.kind === "site_event_queued");
    assert.equal(queued.length, effects.size);
    const healthy = await post("/admin/alerts", { slug: fixture.slug });
    assert.ok(healthy.alerts.every((a: any) => !a.active));
    // A second real movement exercises the pending/parked repair contract without changing the first payment.
    generic200 = true;
    const faultHash = (fixture.documentHash.slice(0, -1) + (fixture.documentHash.endsWith("0") ? "1" : "0")) as `0x${string}`;
    const fault = await pay(protocol, { key: testKey("second").key, budget: BigInt(fixture.department), to: testKey("payee").address, amount: 4_560_000n, kind: 1, documentHash: faultHash, jobNonce: faultHash });
    if (!fault.ok) assert.fail(`${fault.reason}: ${fault.detail}`);
    const pending = await until(() => post("/admin/status", { org: fixture.slug }), (s) => s.pending.length === 1 && s.pending[0].attempts > 0, "unacknowledged fault payment");
    const key = pending.pending[0].event_key;
    await db.worker.query("update app.site_events set created_at=now()-interval '299 seconds' where org_id=$1 and event_key=$2", [fixture.slug, key]);
    assert.ok((await post("/admin/alerts", { org: fixture.slug })).alerts.every((a: any) => !a.active));
    await db.worker.query("update app.site_events set created_at=now()-interval '301 seconds' where org_id=$1 and event_key=$2", [fixture.slug, key]);
    for (let poll = 0; poll < 2; poll++) {
      const issues = (await post("/admin/alerts", { org: fixture.slug })).alerts;
      assert.deepEqual(issues.filter((a: any) => a.active).map((a: any) => a.id), ["delivery_stuck"]);
      assert.equal(issues[1].pending, 1); assert.equal(issues[1].events[0].event_key, key);
    }
    parked = true; generic200 = false;
    await until(() => post("/admin/status", { org: fixture.slug }), (s) => s.events.some((e: any) => e.event_key === key && e.state === "parked"), "site parked the fault payment");
    await post("/admin/retry-parked", { org: fixture.slug, event_key: key }, 500);
    for (let poll = 0; poll < 2; poll++) {
      const issues = (await post("/admin/alerts", { org: fixture.slug })).alerts;
      assert.deepEqual(issues.filter((a: any) => a.active).map((a: any) => a.id), ["money_event_parked"]);
      assert.deepEqual(issues[2].events, [{ event_key: key, kind: "payment_sent", reason: "voucher is invalid" }]);
    }
    await kill(); await start(true);
    assert.equal((await fetch(`${coreUrl}/ready`)).status, 503);
    const beforeResume = deliveryCalls; await wait(350); assert.equal(deliveryCalls, beforeResume);
    await post("/admin/retry-parked", { org: fixture.slug, event_key: key }, 503);
    await post("/admin/snapshot/resume", {});
    parked = false;
    await post("/admin/retry-parked", { org: fixture.slug, event_key: key });
    await post("/admin/retry-parked", { org: fixture.slug, event_key: key });
    assert.ok((await post("/admin/alerts", { org: fixture.slug })).alerts.every((a: any) => !a.active));
    assert.equal([...effects.values()].filter((e) => e.kind === "payment_sent" && e.data.tx_hash === sent.txHash).length, 1);
    assert.equal([...effects.values()].filter((e) => e.kind === "payment_sent" && e.data.tx_hash === fault.txHash).length, 1);
    await board(protocol, { companySafe: fixture.safe, founderSafe: fixture.founderSafe, founderKey: testKey("founder").key, relayerKey: testKey("deployer").key }, [{
      to: THIRD_PARTY.hats, data: encodeFunctionData({ abi: HATS, functionName: "mintHat", args: [BigInt(fixture.hat), fixture.founderSafe] }),
    }]);
    const grant = await until(async () => [...effects.values()].find((e) => e.kind === "hat_granted" && e.data.address === fixture.founderSafe.toLowerCase()), (event) => !!event, "personal Safe hat resolves to signing person's email");
    assert.equal(grant.data.person_email, "founder@core.test");
    await send(chain, { from: testKey("deployer").key, to: fixture.token, data: encodeFunctionData({ abi: ERC20, functionName: "mint", args: [fixture.safe, 1_230_000n] }) });
    const deposit = await until(async () => [...effects.values()].find((e) => e.kind === "deposit_received"), (event) => !!event, "later deposit is not founder capital");
    assert.equal(deposit.data.amount, "1.23"); assert.equal(deposit.data.founder_email, undefined);
    assert.equal([...effects.values()].filter((e) => e.kind === "founder_capital").length, 1);
    console.log(JSON.stringify({ proof: "real-postgres-ponder-v4-with-site-protocol-receiver", approval: a.approval_id, txHash: sent.txHash, paymentPosts: 1, faultTxHash: fault.txHash, repairedPosts: 1, durableEvents: received.size, deliveryCalls, answerCalls, recordHead: cut.recordHead }));
  } finally { await kill(); await db.close(); await new Promise<void>((done) => realtime.close(() => done())); }
});

test("concurrent collectors drain outstanding answers across reconnect without starving readiness", { timeout: 30_000 }, async () => {
  const database = new Database(process.env.DATABASE_URL!, process.env.WORKER_DATABASE_URL!);
  const run = Date.now();
  const sites = Array.from({ length: 4 }, (_, i) => ({ org: `collect-proof-${run}-${i}`, site: `collect-${run}-${i}.core.test` }));
  const released = (await database.worker.query("update app.organizations set released=false where released returning org_id")).rows.map((r) => r.org_id);
  const authorizations = new Map<string, number>(), answered = new Set<string>();
  let releaseAnswers!: () => void;
  const heldAnswers = new Promise<void>((done) => { releaseAnswers = done; });
  let releasePeers!: () => void;
  const heldPeers = new Promise<void>((done) => { releasePeers = done; });
  let collects = 0;
  const receiver = createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString();
    assert.equal(req.headers["x-capxul-signature"], signature(raw, secret));
    const b = JSON.parse(raw), site = sites.find((s) => s.org === b.org)!;
    const reply = (message: unknown) => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ message })); };
    if (req.url?.endsWith("payment_request_listener")) {
      authorizations.set(b.org, (authorizations.get(b.org) ?? 0) + 1);
      return reply({ authorization: "CapxulListener fixture", namespace: `/${site.site}`, event: "capxul_payment_request", expires_at: Math.floor(Date.now() / 1000) + 60 });
    }
    if (req.url?.endsWith("collect_payment_requests")) {
      collects++;
      // The transport shape is valid; the invalid document hash produces a durable business refusal.
      return reply({ cursor: 1, requests: b.after ? [] : [{ org: b.org, site: site.site, request_id: "collect-refusal", idempotency_key: "collect-refusal", cursor: 1,
        trace_id: "", doctype: "Payment Entry", name: "PE-refused", document_hash: "not-a-hash", requested_by: "collector@core.test",
        to_party: "Supplier", to_address: "0x" + "1".repeat(40), amount: "12.34", asset: "USDC", department: "" }] });
    }
    assert.ok(req.url?.endsWith("answer_payment_request"));
    assert.equal(b.error.code, "INVALID_INPUT");
    answered.add(b.org); await (b.org === sites[0]!.org ? heldAnswers : heldPeers);
    reply({ request_id: b.request_id, status: "Failed", duplicate: false });
  });
  const realtime = new Server(receiver);
  for (const site of sites) realtime.of(`/${site.site}`);
  await new Promise<void>((done) => receiver.listen(0, "127.0.0.1", done));
  const siteUrl = `http://127.0.0.1:${(receiver.address() as any).port}`;
  const core = spawn(process.execPath, ["--experimental-strip-types", fileURLToPath(new URL("../src/main.ts", import.meta.url))], {
    env: { ...process.env, CAPXUL_SECRET: secret, CORE_URL: coreUrl, CORE_PORT: "18787", CORE_HOST: "127.0.0.1", FRAPPE_URL: siteUrl, FRAPPE_SOCKET_URL: siteUrl, SITE_SERVICE_URL: siteUrl, SITE_SERVICE_TOKEN: "fixture-only", FINALITY_DEPTH: "0", CORE_START_PAUSED: "true" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  core.stdout?.on("data", () => {}); core.stderr?.on("data", () => {});
  try {
    await until(() => fetch(`${coreUrl}/health`).then((r) => r.status, () => 0), (s) => s === 200, "paused Core health");
    for (const [i, site] of sites.entries()) await database.worker.query(`insert into app.organizations (org_id,name,safe,site,admin_email,token,released)
      values ($1,$1,$2,$3,'collector@core.test',$4,true)`, [site.org, `0x${String(run + i).padStart(40, "0")}`, site.site, fixture.token]);
    await post("/admin/snapshot/resume", {});
    await until(async () => answered.size, (n) => n === sites.length, "four concurrent collectors saved and answered requests", 5000);
    releasePeers();
    await until(() => database.worker.query("select count(*)::int as n from app.organizations where org_id=any($1::text[]) and request_cursor=1", [sites.map((s) => s.org)]), (r) => r.rows[0].n === 3, "three ACKs committed while one answer remains outstanding");
    for (const site of sites) realtime.of(`/${site.site}`).disconnectSockets(true);
    await until(async () => sites.every((s) => (authorizations.get(s.org) ?? 0) >= 2), Boolean, "fresh authorization on every reconnect", 5000);
    let paused = false;
    const ready = fetch(`${coreUrl}/ready`).then((r) => r.json());
    const pause = post("/admin/snapshot/pause", {}).then((cut) => { paused = true; return cut; });
    await wait(200); assert.equal(paused, false, "pause must wait for all outstanding answer ACKs");
    releaseAnswers();
    const cut = await Promise.race([pause, wait(5000).then(() => { throw new Error("snapshot drain deadlocked"); })]);
    await ready;
    assert.equal(cut.activeRequests, 0); assert.equal(cut.activeDeliveries, 0);
    const rows = (await database.worker.query("select request_cursor from app.organizations where org_id=any($1::text[])", [sites.map((s) => s.org)])).rows;
    assert.deepEqual(rows.map((r) => r.request_cursor), ["1", "1", "1", "1"]);
    const stopped = collects; await wait(350); assert.equal(collects, stopped);
    assert.equal((await fetch(`${coreUrl}/ready`)).status, 503);
    await post("/admin/snapshot/resume", {});
    await until(async () => collects, (n) => n >= stopped + sites.length, "all collectors resume from durable cursors");
    const raw = JSON.stringify({ org: sites[0]!.org });
    const polls = await Promise.all(Array.from({ length: 8 }, async () => {
      const response = await fetch(`${coreUrl}/admin/alerts`, { method: "POST", body: raw, signal: AbortSignal.timeout(5000), headers: { "x-capxul-signature": signature(raw, secret) } });
      assert.equal(response.status, 200);
      const value: any = await response.json();
      assert.deepEqual(value.alerts.map((a: any) => a.id), ["indexer_unready", "delivery_stuck", "money_event_parked"]);
      assert.ok(value.alerts.every((a: any) => !a.active));
      return value;
    }));
    assert.equal((await fetch(`${coreUrl}/health`)).status, 200);
    await post("/admin/snapshot/pause", {});
    console.log(JSON.stringify({ proof: "four-concurrent-collectors-and-reconnect-drain", answered: answered.size, cursors: rows.map((r) => r.request_cursor), alertPolls: polls.length, activeRequests: cut.activeRequests, activeDeliveries: cut.activeDeliveries }));
  } finally {
    releaseAnswers(); releasePeers();
    core.kill("SIGKILL"); await new Promise<void>((done) => { if (core.exitCode !== null || core.signalCode !== null) done(); else core.once("exit", () => done()); });
    await new Promise<void>((done) => realtime.close(() => done()));
    await database.worker.query("update app.organizations set released=false where org_id=any($1::text[])", [sites.map((s) => s.org)]);
    await database.worker.query("update app.organizations set released=true where org_id=any($1::text[])", [released]);
    await database.close();
  }
});
