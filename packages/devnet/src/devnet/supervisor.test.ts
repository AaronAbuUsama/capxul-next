import assert from "node:assert/strict";
import { createServer, request, type Server } from "node:http";
import { createHmac } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { gateway } from "./gateway.ts";
import { verifyRun } from "./gate.ts";
import { bench, delivered, sitesEnvironment } from "./fixture.ts";
import { prepareSlice } from "./preparation.ts";
import { command, supervised } from "./processes.ts";
import { runtimeEnv } from "./service.ts";
import { databaseUrl, loopback, readConfig, signedCore, up, writeConfig, type Config } from "./supervisor.ts";

async function listen(server: Server): Promise<number> {
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  return (server.address() as { port: number }).port;
}
async function freePort() { const server = createServer(); const port = await listen(server); await new Promise<void>((done) => server.close(() => done())); return port; }
function config(directory: string): Config {
  return { version: 1, root: directory, controlDir: join(directory, "control"), snapshots: join(directory, "snapshots"), codeVersion: "fixture-version",
    world: { id: "slice0", kind: "local", database: "world_slice0", stateDir: directory, sites: [], epoch: 3 },
    database: { admin: "postgres://operator:admin-secret@localhost:5432/postgres", tenant: "postgres://capxul_core:tenant-secret@localhost:5432/old",
      worker: "postgres://capxul_worker:worker-secret@localhost:5432/old", ponder: "postgres://capxul_ponder:ponder-secret@localhost:5432/old" },
    ports: { anvil: 20100, ponder: 20101, core: 20102, siteService: 20103, bench: 20104, socket: 20105, publicCore: 20106, publicRpc: 20107, publicBench: 20108, publicBundler: 20109 },
    secret: "private-core-secret", siteToken: "private-site-token", finality: 0, chainId: 84532,
    bench: { composeArgs: [], env: {}, dbPassword: "private-db", adminPassword: "private-admin", baseDomain: "localhost" } };
}

test("runtime children receive only their restricted world credentials, never operator authority", async () => {
  const c = config("/private/world");
  process.env.PG_ADMIN_URL = "operator-can-delete-databases";
  process.env.CAPXUL_PRIVATE_KEY = "operator-signing-key";
  try {
    const core = runtimeEnv(c, "core"), ponder = runtimeEnv(c, "ponder"), anvil = runtimeEnv(c, "anvil");
    assert.equal(new URL(core.DATABASE_URL!).pathname, "/world_slice0");
    assert.equal(new URL(core.WORKER_DATABASE_URL!).username, "capxul_worker");
    assert.equal(core.CORE_START_PAUSED, "true");
    assert.equal(core.SITE_SERVICE_TOKEN, c.siteToken);
    assert.equal(ponder.PONDER_DATABASE_URL, databaseUrl(c.database.ponder, c.world));
    for (const env of [core, ponder, anvil]) {
      assert.equal(env.PG_ADMIN_URL, undefined); assert.equal(env.CAPXUL_PRIVATE_KEY, undefined);
    }
    assert.equal(ponder.DATABASE_URL, undefined); assert.equal(anvil.CAPXUL_SECRET, undefined);
    const caller = sitesEnvironment(c);
    assert.match(caller.CAPXUL_PRIVATE_KEY!, /^0x[0-9a-f]{64}$/);
    assert.notEqual(caller.CAPXUL_PRIVATE_KEY, process.env.CAPXUL_PRIVATE_KEY);
    assert.equal(caller.CAPXUL_CORE_URL, loopback(c.ports.publicCore));
    assert.equal(caller.CAPXUL_SITES_ACTORS, join(c.controlDir, "sites-actors.json"));
  } finally { delete process.env.PG_ADMIN_URL; delete process.env.CAPXUL_PRIVATE_KEY; }
});

test("native bench reads preserve raw scalars, structured JSON and empty None results", async () => {
  const root = await mkdtemp(join(tmpdir(), "world-bench-output-")), c = config(root);
  const previous = { PATH: process.env.PATH, BENCH_RESULT: process.env.BENCH_RESULT };
  try {
    await writeFile(join(root, "docker"), `#!${process.execPath}\nprocess.stdout.write(process.env.BENCH_RESULT);\n`, { mode: 0o700 });
    process.env.PATH = `${root}:${process.env.PATH}`;
    for (const [output, expected] of [["harbourlineproof\n", "harbourlineproof"], ["0xc97056edb98c2dce657fdd1ab7928035745fde51\n", "0xc97056edb98c2dce657fdd1ab7928035745fde51"],
      ['["Company",125.5]\n', ["Company", 125.5]], ["", null], ['diagnostic\nJSON:{"posted":true}\n', { posted: true }]] as const) {
      process.env.BENCH_RESULT = output;
      assert.deepEqual(await bench(c, "fixture.localhost", "fixture.read"), expected);
    }
  } finally {
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    await rm(root, { recursive: true });
  }
});

test("delivery readback converges when a new acknowledged event arrives between Core and native site reads", async () => {
  const root = await mkdtemp(join(tmpdir(), "world-delivery-readback-")), c = config(root);
  const previous = process.env.PATH;
  let sequence = 0;
  const core = createServer((_req, res) => {
    sequence = Math.min(sequence + 1, 2);
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ released: true, last_seq: String(sequence), last_ack: String(sequence), pending: [],
      events: [{ event_key: "hat", seq: "1", state: "applied" }] }));
  });
  c.ports.core = await listen(core);
  try {
    await writeFile(join(root, "docker"), `#!${process.execPath}\nconst args=process.argv;process.stdout.write(args.includes("frappe.db.get_single_value")?"2":args.includes("frappe.db.exists")?"hat-grant":"1");\n`, { mode: 0o700 });
    process.env.PATH = `${root}:${previous}`;
    await delivered(c, { slug: "harbourline", site: "fixture.localhost", email: "director@example.invalid" } as any);
  } finally {
    if (previous === undefined) delete process.env.PATH; else process.env.PATH = previous;
    await new Promise<void>((done) => core.close(() => done()));
    await rm(root, { recursive: true });
  }
});

test("ingress blocks Core admin, drains a real in-flight mutation, and closes RPC and bench together", async () => {
  const c = config("/private/world");
  let release!: () => void, entered!: () => void;
  const held = new Promise<void>((done) => { release = done; });
  const received = new Promise<void>((done) => { entered = done; });
  const upstream = createServer(async (req, res) => {
    if (req.url === "/mutate") { entered(); await held; }
    res.end(req.headers.host);
  });
  c.ports.core = c.ports.anvil = c.ports.bench = await listen(upstream);
  [c.ports.publicCore, c.ports.publicRpc, c.ports.publicBench] = await Promise.all([freePort(), freePort(), freePort()]);
  const close = await gateway(c);
  try {
    assert.equal((await fetch(`${loopback(c.ports.publicCore)}/admin/snapshot/resume`, { method: "POST" })).status, 404);
    const host = await new Promise<string>((done) => {
      request(loopback(c.ports.publicBench), { headers: { host: "harbourline-slice0.localhost" } }, (res) => {
        let text = ""; res.on("data", (chunk) => { text += chunk; }); res.on("end", () => done(text));
      }).end();
    });
    assert.equal(host, "harbourline-slice0.localhost");
    const mutation = fetch(`${loopback(c.ports.publicCore)}/mutate`, { method: "POST" });
    await received;
    let closed = false;
    const stopping = close().then(() => { closed = true; });
    await new Promise((done) => setImmediate(done));
    assert.equal(closed, false);
    release(); assert.equal((await mutation).status, 200); await stopping;
    for (const port of [c.ports.publicCore, c.ports.publicRpc, c.ports.publicBench]) await assert.rejects(fetch(loopback(port)));
  } finally { release(); await close(); await new Promise<void>((done) => upstream.close(() => done())); }
});

test("recovery config is private, role checked, and a pending restore cannot restart", async () => {
  const directory = await mkdtemp(join(tmpdir(), "world-supervisor-"));
  try {
    const c = config(directory), file = join(directory, "world.json");
    await writeConfig(file, c); assert.deepEqual(await readConfig(file), c);
    await writeFile(join(directory, "restore-pending.json"), "{}");
    const unexpected = async () => { throw new Error("must not reach a service"); };
    await assert.rejects(up(c, { start: unexpected, stop: unexpected, benchUp: unexpected, benchStop: unexpected }), /restore-pending/);
    c.database.tenant = c.database.admin; await writeConfig(file, c);
    await assert.rejects(readConfig(file), /restricted runtime/);
  } finally { await rm(directory, { recursive: true }); }
});

test("a different checkout or already-running build cannot be reused as this world's runtime", async () => {
  const directory = await mkdtemp(join(tmpdir(), "world-version-"));
  try {
    const c = config(directory), file = join(directory, "world.json");
    c.root = resolve(import.meta.dirname, "../../../..");
    const host = supervised(c, file);
    await assert.rejects(host.start("core"), /world code version differs/);
    c.codeVersion = await command(["git", "rev-parse", "HEAD"], c.root);
    await mkdir(c.controlDir);
    const proc = await readFile(`/proc/${process.pid}/stat`, "utf8");
    await writeFile(join(c.controlDir, "core.json"), JSON.stringify({ pid: process.pid,
      birth: proc.slice(proc.lastIndexOf(")") + 2).split(" ")[19], codeVersion: "earlier-build", state: "running" }));
    await assert.rejects(host.start("core"), /running another code version/);
  } finally { await rm(directory, { recursive: true }); }
});

test("Core recovery uses HMAC over the exact raw body on the private port", async () => {
  const c = config("/private/world");
  const server = createServer(async (req, res) => {
    let body = ""; for await (const chunk of req) body += chunk;
    assert.equal(req.headers["x-capxul-signature"], createHmac("sha256", c.secret).update(body).digest("hex"));
    assert.equal(req.url, "/admin/snapshot/pause");
    assert.deepEqual(JSON.parse(body), { world: "slice0", epoch: 3 });
    res.setHeader("content-type", "application/json"); res.end('{"paused":true}');
  });
  c.ports.core = await listen(server);
  try { assert.deepEqual(await signedCore(c, "/admin/snapshot/pause", { world: "slice0", epoch: 3 }), { paused: true }); }
  finally { await new Promise<void>((done) => server.close(() => done())); }
});

test("slice acceptance requires the full fresh same-run contract and every source-equal screen", async () => {
  const root = await mkdtemp(join(tmpdir(), "world-receipt-")), directory = join(root, "status/runs/run-test");
  await mkdir(directory, { recursive: true });
  const at = new Date().toISOString(), started = Date.parse(at);
  const environment = { world: "slice-zero", stack: "postgres-ponder-erpnext-v4", storage: "postgres", indexer: "ponder", components: { core: "fixture" } } as const;
  const required = ["opaque-b", "opaque-a"];
  const receipt = { version: 1, id: "run-test", state: "complete", commit: "fixture", at, finishedAt: at, environment,
    requested: required, evals: required.map((id) => ({ id, claim: `claim ${id}` })), scripts: [],
    prepare: { argv: ["actual-prepare"], exitCode: 0, signal: null, log: "prepare.log" },
    screens: ["supplier-invoice", "payment-entry", "general-ledger", "trial-balance"].map((screen) => ({ screen, path: `${screen}.png`, source: "source.json", assertion: "source-equality" })) };
  const summary = { version: 1, run: receipt.id, runDir: "status/runs/run-test", state: "complete", passed: true, counts: { pass: 2, fail: 0, not_run: 0 }, exitCode: 0 };
  const status = { version: 1, evals: Object.fromEntries(required.map((id) => [id, { verdict: "pass", commit: "fixture", at, run: receipt.id, claim: `claim ${id}` }])) };
  const save = async () => { await writeFile(join(directory, "receipt.json"), JSON.stringify(receipt)); await writeFile(join(directory, "status.json"), JSON.stringify(status)); };
  try {
    for (const screen of receipt.screens) await writeFile(join(directory, screen.path), "capture");
    await writeFile(join(directory, "prepare.log"), "prepared");
    const preparation = { run: { id: receipt.id, at, commit: "fixture" } };
    await writeFile(join(directory, "preparation.json"), JSON.stringify(preparation));
    await writeFile(join(directory, "source.json"), "{}");
    await save(); assert.equal(await verifyRun(root, summary, required, environment, started), true);
    receipt.prepare.exitCode = 1; await save();
    await assert.rejects(verifyRun(root, summary, required, environment, started), /preparation|invalid/);
    receipt.prepare.exitCode = 0; await save();
    preparation.run.id = "earlier-run"; await writeFile(join(directory, "preparation.json"), JSON.stringify(preparation));
    await assert.rejects(verifyRun(root, summary, required, environment, started), /another run/);
    preparation.run.id = receipt.id; await writeFile(join(directory, "preparation.json"), JSON.stringify(preparation));
    receipt.screens[0]!.source = "../older-source.json"; await save();
    await assert.rejects(verifyRun(root, summary, required, environment, started), /belong to this run/);
    receipt.screens[0]!.source = "source.json"; await save();
    await writeFile(join(directory, "source.json"), "");
    await assert.rejects(verifyRun(root, summary, required, environment, started), /source evidence/);
    await writeFile(join(directory, "source.json"), "{}");
    await assert.rejects(verifyRun(root, summary, required.slice(0, 1), environment, started));
    await assert.rejects(verifyRun(root, summary, required, { ...environment, storage: "json" }, started));
    await assert.rejects(verifyRun(root, summary, required, environment, started + 1), /predates/);
    receipt.commit = "another-build"; await save();
    await assert.rejects(verifyRun(root, summary, required, environment, started), /running Core/);
    receipt.commit = "fixture"; await save();
    status.evals["opaque-a"]!.run = "previous-run"; await save();
    await assert.rejects(verifyRun(root, summary, required, environment, started), /fresh/);
    status.evals["opaque-a"]!.run = receipt.id; receipt.screens.pop(); await save();
    await assert.rejects(verifyRun(root, summary, required, environment, started), /trial-balance/);
    status.evals["opaque-a"]!.verdict = "not_run"; await save();
    assert.equal(await verifyRun(root, { ...summary, passed: false, exitCode: 1 }, required, environment, started), false);
  } finally { await rm(root, { recursive: true }); }
});

test("preparation cannot retrofit an earlier fixture or use a finished/wrong-build receipt", async () => {
  const root = await mkdtemp(join(tmpdir(), "world-prepare-")), c = config(root);
  const directory = join(root, "status/runs/run-prepare"), configFile = join(root, "world.json");
  const previous = { CAPXUL_EVAL_RUN_DIR: process.env.CAPXUL_EVAL_RUN_DIR, CAPXUL_WORLD_CONFIG: process.env.CAPXUL_WORLD_CONFIG,
    CAPXUL_ACCEPTANCE_FIXTURE: process.env.CAPXUL_ACCEPTANCE_FIXTURE };
  const receipt = { version: 1, id: "run-prepare", at: new Date().toISOString(), state: "running", commit: c.codeVersion,
    environment: { world: "slice-zero", stack: "postgres-ponder-erpnext-v4", storage: "postgres", indexer: "ponder", components: { core: c.codeVersion } },
    requested: ["an-eval"], evals: [{ id: "an-eval", claim: "a claim" }], scripts: [], screens: [] };
  const save = () => writeFile(join(directory, "receipt.json"), JSON.stringify(receipt));
  // Every case must reject before network/chain/site work; this intentionally supplies no runtime methods.
  const stack = { c } as Parameters<typeof prepareSlice>[0];
  try {
    await mkdir(directory, { recursive: true }); await mkdir(c.controlDir); await save();
    delete process.env.CAPXUL_EVAL_RUN_DIR;
    await assert.rejects(prepareSlice(stack, configFile, "harbourline"), /running receipt/);
    Object.assign(process.env, { CAPXUL_EVAL_RUN_DIR: directory, CAPXUL_WORLD_CONFIG: configFile, CAPXUL_ACCEPTANCE_FIXTURE: join(c.controlDir, "acceptance.json") });
    receipt.state = "complete"; await save();
    await assert.rejects(prepareSlice(stack, configFile, "harbourline"), /running|invalid/);
    receipt.state = "running"; receipt.commit = "previous-build"; await save();
    await assert.rejects(prepareSlice(stack, configFile, "harbourline"), /build differs/);
    receipt.commit = c.codeVersion; await save();
    await writeFile(join(c.controlDir, "fixture.json"), "{}");
    await assert.rejects(prepareSlice(stack, configFile, "harbourline"), /fresh fixture/);
    await rm(join(c.controlDir, "fixture.json"));
    await assert.rejects(prepareSlice(stack, configFile, "harbourline"), /real bundler/);
    await assert.rejects(readFile(join(directory, "preparation.json")), { code: "ENOENT" });
  } finally {
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    await rm(root, { recursive: true });
  }
});
