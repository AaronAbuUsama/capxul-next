// Proves the Core half without the Frappe half. Run by bin/test-core.sh, which sets the isolated ports/state.
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { promisify } from "node:util";
import type { Address } from "viem";
import { abis, deployment, orgId, publicClient } from "../src/chain.ts";
import { config, coreDir } from "../src/config.ts";
import { sign } from "../src/hmac.ts";
import { byEmail } from "../src/people.ts";

const exec = promisify(execFile);
const FAKE = `http://127.0.0.1:${process.env.FAKE_PORT}`;
const CORE = config.coreUrl;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const cli = (...a: string[]) => exec("node", ["--experimental-strip-types", "--no-warnings", `${coreDir}/src/main.ts`, ...a], { env: process.env });
const fake = async (path: string) => (await fetch(FAKE + path)).json() as Promise<any>;

async function waitFor<T>(what: string, fn: () => Promise<T | undefined | false>, ms = 20000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn().catch(() => undefined);
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(250);
  }
}

const procs: Record<string, ChildProcess> = {};
function start(name: "fake" | "core") {
  const [script, args] = name === "fake" ? [`${coreDir}/test/fake-frappe.ts`, []] : [`${coreDir}/src/main.ts`, ["serve"]];
  procs[name] = spawn("node", ["--experimental-strip-types", "--no-warnings", script, ...args], { env: process.env, stdio: ["ignore", "inherit", "inherit"] });
}
async function stop(name: string) {
  const p = procs[name]; if (!p) return;
  const done = new Promise((r) => p.once("exit", r)); p.kill("SIGKILL"); await done; // a hard kill: no clean shutdown
}
const up = (url: string) => waitFor(url, () => fetch(url).then((r) => r.ok || r.status < 500));

let failed = 0;
async function check(name: string, fn: () => Promise<void>) {
  try { await fn(); console.log(`PASS  ${name}`); }
  catch (e) { failed++; console.log(`FAIL  ${name}: ${(e as Error).message}`); }
}
const ok = (c: unknown, msg: string) => { if (!c) throw new Error(msg); };
const js = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x));
const eq = (a: unknown, b: unknown, msg: string) => ok(js(a) === js(b), `${msg}: got ${js(a)}, want ${js(b)}`);

async function prepare(requestedBy: string, amount: string, docHash = `0x${randomBytes(32).toString("hex")}`) {
  const body = JSON.stringify({ org: "acme", site: "acme.localhost", doctype: "Payment Entry", name: `ACC-PAY-${randomBytes(2).toString("hex")}`,
    document_hash: docHash, requested_by: requestedBy, to_party: "Brightside Cleaning Ltd", to_address: byEmail("elena@brightside.test")!.address,
    amount, asset: "USDC", department: "Finance" });
  const r = await fetch(`${CORE}/prepare`, { method: "POST", headers: { "x-capxul-signature": sign(body) }, body });
  return { status: r.status, json: await r.json() as any, docHash };
}
const signApproval = async (id: string) =>
  (await fetch(`${CORE}/approve/${id}/sign`, { method: "POST", headers: { accept: "application/json" } })).json() as Promise<any>;
const applied = async (org = "acme") => (await fake("/_applied") as any[]).filter((e) => e.org === org).sort((a, b) => a.seq - b.seq);
const lastSeq = async () => ((await applied()).at(-1)?.seq ?? 0) as number;

const d = deployment();
const usdc = (a: string) => publicClient.readContract({ address: d.usdc, abi: abis.usdc, functionName: "balanceOf", args: [a as Address] }) as Promise<bigint>;
const vendor = byEmail("elena@brightside.test")!.address;

start("fake"); start("core");
await up(`${FAKE}/_calls`); await up(`${CORE}/health`);
let safe = "";

await check("org create: the Frappe script missing gives a clear error and creates nothing", async () => {
  const r = await exec("node", ["--experimental-strip-types", "--no-warnings", `${coreDir}/src/main.ts`, "org", "create", "ghost", "Ghost Ltd", "--admin", "hannah@acme.test"],
    { env: { ...process.env, NEW_SITE_SCRIPT: "/nonexistent/new-site.sh" } }).then(() => ({ code: 0, err: "" }), (e) => ({ code: e.code, err: String(e.stderr) }));
  ok(r.code === 1 && /does not exist yet/.test(r.err), `expected a clear error, got ${r.code} ${r.err}`);
  const s = await publicClient.readContract({ address: d.payments, abi: abis.payments, functionName: "safeOf", args: [orgId("ghost")] });
  ok(/^0x0+$/.test(String(s)), "ghost org must not exist on the chain");
});

await check("org create: a failing Frappe script is reported with its exit code", async () => {
  const r = await exec("node", ["--experimental-strip-types", "--no-warnings", `${coreDir}/src/main.ts`, "org", "create", "failco", "Fail Co", "--admin", "hannah@acme.test"],
    { env: { ...process.env, NEW_SITE_SCRIPT: "/usr/bin/false" } }).then(() => ({ code: 0, err: "" }), (e) => ({ code: e.code, err: String(e.stderr) }));
  ok(r.code === 1 && /new-site.sh failed \(exit 1\)/.test(r.err), `got ${r.code} ${r.err}`);
});

await check("an org is created on the chain (Safe stand-in funded, admin wears admin)", async () => {
  const r = await cli("org", "create", "acme", "Acme Trading Ltd", "--admin", "hannah@acme.test");
  safe = JSON.parse(r.stdout.trim().split("\n").pop()!).safe;
  const onChain = await publicClient.readContract({ address: d.payments, abi: abis.payments, functionName: "safeOf", args: [orgId("acme")] });
  eq(String(onChain).toLowerCase(), safe.toLowerCase(), "safeOf");
  eq(await usdc(safe), 50_000_000_000n, "Safe USDC balance");
  const wears = await publicClient.readContract({ address: d.hats, abi: abis.hats, functionName: "wears", args: [orgId("acme"), byEmail("hannah@acme.test")!.address as Address, "admin"] });
  ok(wears === true, "hannah does not wear admin");
});

await check("an org's events are held until its site exists, then arrive from seq 1", async () => {
  eq(readFileSync(`${process.env.STATE_DIR}/calls-at-site-time-acme`, "utf8").trim(), "0", "events received before the site existed");
  const first = await waitFor("seq 1", async () => (await applied())[0]);
  ok(first.seq === 1 && first.kind === "hat_granted" && first.data.hat === "admin" && first.data.person_email === "hannah@acme.test", `bad first event ${JSON.stringify(first)}`);
});

await check("a hat grant produces one signed event with the right seq", async () => {
  await cli("hat", "grant", "acme", "budget-holder", "marcus@acme.test", "--department", "Finance");
  const e = await waitFor("seq 2", async () => (await applied()).find((x) => x.seq === 2));
  ok(e.sigOk === true, "event was not validly signed");
  ok(e.kind === "hat_granted" && e.data.hat === "budget-holder" && e.data.person_email === "marcus@acme.test" && e.data.department === "Finance", `bad data ${JSON.stringify(e.data)}`);
  eq((await applied()).filter((x) => x.kind === "hat_granted" && x.data.person_email === "marcus@acme.test").length, 1, "events for the grant");
  eq(e.site, "acme.localhost", "X-Frappe-Site-Name");
});

await check("a payment by a hat wearer produces payment_sent with the document hash", async () => {
  const p = await prepare("marcus@acme.test", "125.50");
  ok(p.status === 200 && /\/approve\/apr_/.test(p.json.approval_url), `prepare: ${p.status} ${JSON.stringify(p.json)}`);
  const page = await (await fetch(p.json.approval_url.replace("localhost", "127.0.0.1"))).text();
  ok(/125\.50 USDC/.test(page) && /Brightside Cleaning Ltd/.test(page) && /Payment Entry/.test(page) && /<button>Sign<\/button>/.test(page), "approval page is missing who/whom/how much/what/Sign");
  const before = await usdc(vendor);
  await signApproval(p.json.approval_id);
  const e = await waitFor("payment_sent", async () => (await applied()).find((x) => x.kind === "payment_sent"));
  ok(e.data.document_hash === p.docHash && e.data.amount === "125.50" && e.data.asset === "USDC" && /^0x[0-9a-f]{64}$/.test(e.data.tx_hash)
    && e.data.from_safe.toLowerCase() === safe.toLowerCase() && /Z$/.test(e.data.block_time) && /^0x[0-9a-f]{64}$/.test(e.data.payment_id), `bad payment_sent ${JSON.stringify(e.data)}`);
  eq(e.seq, 3, "seq"); eq((await usdc(vendor)) - before, 125_500_000n, "vendor received");
});

await check("a payment by someone without the hat produces payment_failed NOT_AUTHORISED", async () => {
  const p = await prepare("priya@acme.test", "10.00");
  const before = await usdc(safe);
  await signApproval(p.json.approval_id);
  const e = await waitFor("payment_failed", async () => (await applied()).find((x) => x.kind === "payment_failed" && x.data.approval_id === p.json.approval_id));
  eq(e.data.reason, "NOT_AUTHORISED", "reason"); eq(e.event_key, `approval:${p.json.approval_id}:failed`, "event_key");
  ok(e.data.document_hash === p.docHash, "document hash missing"); eq(await usdc(safe), before, "Safe balance");
});

await check("a payment over budget gives payment_failed OVER_BUDGET", async () => {
  const p = await prepare("marcus@acme.test", "20000.00");
  await signApproval(p.json.approval_id);
  const e = await waitFor("payment_failed", async () => (await applied()).find((x) => x.kind === "payment_failed" && x.data.approval_id === p.json.approval_id));
  eq(e.data.reason, "OVER_BUDGET", "reason");
});

await check("the same approval signed twice moves money once", async () => {
  const p = await prepare("marcus@acme.test", "1.00");
  const before = await usdc(vendor);
  await Promise.all([signApproval(p.json.approval_id), signApproval(p.json.approval_id)]);
  await waitFor("payment_sent for 1.00", async () => (await applied()).find((x) => x.kind === "payment_sent" && x.data.document_hash === p.docHash));
  eq((await usdc(vendor)) - before, 1_000_000n, "vendor received");
});

await check("the fake answering 409 makes Core resend in order", async () => {
  const before = await lastSeq();                       // simulate Frappe restored from an older backup
  await fetch(`${FAKE}/_restore?org=acme&to=${before - 3}`, { method: "POST" });
  const mark = (await fake("/_calls")).length;
  await cli("hat", "grant", "acme", "member", "tomas@acme.test");
  await waitFor("caught up", async () => (await lastSeq()) === before + 1);
  const calls = (await fake("/_calls")).slice(mark).map((c: any) => `${c.seq}:${c.status}`);
  eq(calls, [`${before + 1}:409`, `${before - 2}:200`, `${before - 1}:200`, `${before}:200`, `${before + 1}:200`], "calls after restore");
});

let heldKeys: string[] = [];
await check("fake down, Core restarted, fake back: every event delivered once, in order", async () => {
  await stop("fake");
  await cli("hat", "grant", "acme", "payroll-approver", "priya@acme.test");
  await cli("pay", "direct", "acme", vendor, "10.00");
  const st = await cli("events", "status", "acme");
  ok(/pending=2/.test(st.stdout) && /network/.test(st.stdout), `status should show 2 pending with a network error: ${st.stdout}`);
  await stop("core"); start("core"); await up(`${CORE}/health`);   // both sides have now been killed hard
  start("fake"); await up(`${FAKE}/_calls`);
  await waitFor("outbox drained", async () => /pending=0/.test((await cli("events", "resend", "acme")).stdout));
  const all = await applied(); heldKeys = all.map((e) => e.event_key);
  eq(all.map((e) => e.seq), all.map((_, i) => i + 1), "seq gap-free from 1");
  eq(new Set(heldKeys).size, heldKeys.length, "duplicate event_key applied");
  ok(all.some((e) => e.kind === "hat_granted" && e.data.hat === "payroll-approver") && all.some((e) => e.kind === "payment_sent" && e.data.amount === "10.00"), "missing events");
});

await check("Core restarted again re-reads nothing twice (no new events, same keys)", async () => {
  await stop("core"); start("core"); await up(`${CORE}/health`); await sleep(2500);
  eq((await applied()).map((e) => e.event_key), heldKeys, "keys after restart");
});

await check("a bad signature on /prepare is refused", async () => {
  const body = JSON.stringify({ org: "acme" });
  const bad = await fetch(`${CORE}/prepare`, { method: "POST", headers: { "x-capxul-signature": "00".repeat(32) }, body });
  const none = await fetch(`${CORE}/prepare`, { method: "POST", body });
  eq([bad.status, none.status], [401, 401], "statuses");
});

await check("sign-in endpoints complete an authorization-code exchange", async () => {
  const q = new URLSearchParams({ client_id: "capxul-skeleton", redirect_uri: "http://acme.localhost:8000/cb", response_type: "code", state: "xyz", scope: "openid" });
  const pick = await (await fetch(`${CORE}/oauth/authorize?${q}`)).text();
  ok(/Hannah Okafor/.test(pick) && /Priya Raman/.test(pick), "person picker missing people");
  const r = await fetch(`${CORE}/oauth/authorize`, { method: "POST", redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ ...Object.fromEntries(q), email: "hannah@acme.test" }) });
  const loc = new URL(r.headers.get("location")!);
  ok(r.status === 302 && loc.searchParams.get("state") === "xyz" && loc.origin === "http://acme.localhost:8000", `redirect ${r.status} ${loc}`);
  const tok = (code: string, secret = config.secret) => fetch(`${CORE}/oauth/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: "http://acme.localhost:8000/cb", client_id: "capxul-skeleton", client_secret: secret }) });
  eq((await tok(loc.searchParams.get("code")!, "wrong")).status, 401, "wrong secret");
  const code2 = new URL((await fetch(`${CORE}/oauth/authorize`, { method: "POST", redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ ...Object.fromEntries(q), email: "hannah@acme.test" }) })).headers.get("location")!).searchParams.get("code")!;
  const t = await tok(code2); ok(t.status === 200, `token ${t.status}`);
  const access = ((await t.json()) as any).access_token;
  eq((await tok(code2)).status, 400, "code reuse");
  const info = await (await fetch(`${CORE}/oauth/userinfo`, { headers: { authorization: `Bearer ${access}` } })).json() as any;
  ok(info.email === "hannah@acme.test" && info.name === "Hannah Okafor" && info.given_name === "Hannah" && info.family_name === "Okafor" && info.sub, `userinfo ${JSON.stringify(info)}`);
  eq((await fetch(`${CORE}/oauth/userinfo`, { headers: { authorization: "Bearer nope" } })).status, 401, "bad token");
});

await stop("fake"); await stop("core");
console.log(failed ? `\n${failed} check(s) FAILED` : "\nall checks passed");
process.exit(failed ? 1 : 0);
