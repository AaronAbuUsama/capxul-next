import { after, test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { createHmac } from "node:crypto";
import { watch } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import { encodeAbiParameters, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { createSitesClient, PROVISION_PATH, provisioningMessage } from "@capxul/sdk";
import { createProvisioningHandler, createSiteService } from "./door.ts";

const exec = promisify(execFile);
const key = `0x${"11".repeat(32)}` as Hex;
const founder = privateKeyToAccount(key);
const other = privateKeyToAccount(`0x${"22".repeat(32)}`);
const safe = `0x${"33".repeat(20)}` as Address;
const personal = `0x${"44".repeat(20)}` as Address;
const servers: Server[] = [];
const directories: string[] = [];
after(async () => {
  await Promise.all(servers.map((server) => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); })));
  await Promise.all(directories.map((path) => rm(path, { recursive: true, force: true })));
});
async function listen(server: Server): Promise<string> {
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as { port: number }).port}`;
}
async function setup() {
  const root = await mkdtemp(join(tmpdir(), "capxul-provision-")); directories.push(root);
  const bench = join(root, "bench");
  const options = {
    command: [process.execPath, fileURLToPath(new URL("./fixtures/bench.mjs", import.meta.url)), bench],
    stateDir: join(root, "intents"), token: "private-site-token", secret: "private-hmac", dbRootPassword: "private-db-password",
    adminPassword: "private-admin-password", world: "town1", baseDomain: "localhost", siteScheme: "http" as const, sitePort: 8000,
  };
  await import("node:fs/promises").then(({ mkdir }) => mkdir(bench));
  let siteService = createSiteService(options);
  let siteServiceUrl = await listen(siteService);
  const info = { slug: "acme", name: "Acme '$(touch NEVER)' Ltd", safe, site: "acme-town1.localhost", adminEmail: "founder@example.test",
    people: [{ email: "founder@example.test", name: "Founder", address: founder.address }], released: false };
  let founderOwns = true;
  const rpcUrl = await listen(createServer(async (req, res) => {
    let raw = ""; for await (const chunk of req) raw += chunk;
    const call = JSON.parse(raw);
    const address = call.params?.[0]?.to?.toLowerCase();
    let result: string;
    if (call.method === "eth_getCode") result = "0x6000";
    else if (call.method === "eth_call") result = encodeAbiParameters([{ type: "address[]" }], [address === safe.toLowerCase() ? [personal] : [founderOwns ? founder.address : other.address]]);
    else throw new Error(`Unexpected RPC ${call.method}`);
    res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ jsonrpc: "2.0", id: call.id, result }));
  }));
  let handler: ReturnType<typeof createProvisioningHandler>;
  const coreUrl = await listen(createServer(async (req, res) => {
    if (await handler(req, res)) return;
    let raw = ""; for await (const chunk of req) raw += chunk;
    assert.equal(req.headers["x-capxul-signature"], createHmac("sha256", options.secret).update(raw).digest("hex"));
    assert.ok(req.headers["x-capxul-trace"]);
    assert.deepEqual(JSON.parse(raw), { slug: "acme" });
    if (req.url === "/admin/release") {
      const state = JSON.parse(await readFile(join(bench, info.site, "site.json"), "utf8"));
      assert.equal(state.settings.safe_address, safe.toLowerCase()); assert.equal(state.world, "town1");
      info.released = true;
    }
    res.setHeader("content-type", "application/json"); res.end(JSON.stringify(info));
  }));
  const mount = () => { handler = createProvisioningHandler({ publicOrigin: coreUrl, rpcUrl, coreUrl, coreSecret: options.secret, siteServiceUrl, siteServiceToken: options.token }); };
  mount();
  return { root, bench, info, options, coreUrl, sites: createSitesClient({ coreUrl, account: founder }),
    siteUrl: () => siteServiceUrl, removeFounder: () => { founderOwns = false; },
    async restart() { await new Promise<void>((resolve) => siteService.close(() => resolve())); siteService = createSiteService(options); siteServiceUrl = await listen(siteService); mount(); },
  };
}

test("public SDK/CLI retries an interrupted bench creation and preserves identity after service restart", async () => {
  const s = await setup();
  await writeFile(join(s.bench, "fail-configure"), "fault");
  await assert.rejects(s.sites.provision({ org: "acme" }), { code: "PROVIDER_ERROR" });
  assert.equal(s.info.released, false);
  await rm(join(s.bench, "fail-configure"));
  const cli = fileURLToPath(new URL("../../../cli/src/main.ts", import.meta.url));
  const { stdout } = await exec(process.execPath, ["--experimental-strip-types", "--no-warnings", cli, "org", "site", "provision", "--org", "acme", "--confirm", "--json"], {
    env: { PATH: process.env.PATH, CAPXUL_CORE_URL: s.coreUrl, CAPXUL_PRIVATE_KEY: key },
  });
  const expected = { org: "acme", safe: safe.toLowerCase(), site: "acme-town1.localhost", url: "http://acme-town1.localhost:8000", state: "provisioned" };
  assert.deepEqual(JSON.parse(stdout), expected);
  assert.equal(s.info.released, true);
  const repeat = await Promise.all([s.sites.provision({ org: "acme" }), s.sites.provision({ org: "acme" })]);
  assert.deepEqual(repeat, [expected, expected]);
  await s.restart();
  assert.deepEqual(await s.sites.provision({ org: "acme" }), expected);
  const data = JSON.parse(await readFile(join(s.bench, expected.site, "site.json"), "utf8"));
  assert.equal(data.company, s.info.name); assert.equal(data.core_url, "");
  assert.deepEqual(data.apps, ["frappe", "erpnext", "hrms", "crm", "frappe_whatsapp", "capxul"]);
  for (const change of [{ name: "Another company" }, { safe: personal }, { adminEmail: "someone@example.test" }]) {
    const changed = await fetch(`${s.siteUrl()}/sites/create`, { method: "POST", headers: { authorization: `Bearer ${s.options.token}` },
      body: JSON.stringify({ org: "acme", name: s.info.name, safe, adminEmail: s.info.adminEmail, ...change }) });
    assert.equal(changed.status, 409);
  }
  assert.equal(JSON.parse(await readFile(join(s.bench, expected.site, "site.json"), "utf8")).company, s.info.name);
  // An intent alone is not proof of the actual site's identity, including after a restore.
  data.settings.safe_address = personal;
  await writeFile(join(s.bench, expected.site, "site.json"), JSON.stringify(data));
  await assert.rejects(s.sites.provision({ org: "acme" }), { code: "INVALID_INPUT" });
  assert.equal(JSON.parse(await readFile(join(s.bench, expected.site, "site.json"), "utf8")).settings.safe_address, personal);
});

test("public provisioning rejects wrong callers, altered bodies, wrong origins, expired requests and removed Safe ownership", async () => {
  const s = await setup();
  await assert.rejects(createSitesClient({ coreUrl: s.coreUrl, account: other }).provision({ org: "acme" }), { code: "ROLE_PERMISSION_DENIED" });
  const send = async (raw: string, signature?: Hex) => fetch(`${s.coreUrl}${PROVISION_PATH}`, {
    method: "POST", body: raw, headers: signature ? { "x-capxul-signature": signature } : {},
  });
  const raw = JSON.stringify({ org: "acme", caller: founder.address, expiresAt: Date.now() + 30_000 });
  const signature = await founder.signMessage({ message: provisioningMessage(s.coreUrl, raw) });
  assert.equal((await send(raw)).status, 401);
  assert.equal((await send(raw.replace("acme", "other"), signature)).status, 401);
  assert.equal((await send(raw, await founder.signMessage({ message: provisioningMessage("https://another.test", raw) }))).status, 401);
  const expired = JSON.stringify({ org: "acme", caller: founder.address, expiresAt: Date.now() - 1 });
  assert.equal((await send(expired, await founder.signMessage({ message: provisioningMessage(s.coreUrl, expired) }))).status, 401);
  s.removeFounder();
  await assert.rejects(s.sites.provision({ org: "acme" }), { code: "ROLE_PERMISSION_DENIED" });
  assert.equal(s.info.released, false);
  await assert.rejects(readFile(join(s.bench, s.info.site, "site.json")), { code: "ENOENT" });
});

test("private service refuses unsigned, malformed and path-injecting requests before bench", async () => {
  const s = await setup();
  const url = `${s.siteUrl()}/sites/create`;
  assert.equal((await fetch(url, { method: "POST", body: "{}" })).status, 401);
  for (const body of ["null", "{", JSON.stringify({ org: "../escape", name: "Bad", safe, adminEmail: s.info.adminEmail })]) {
    assert.equal((await fetch(url, { method: "POST", headers: { authorization: `Bearer ${s.options.token}` }, body })).status, 400);
  }
  await assert.rejects(readFile(join(s.bench, s.info.site, "site.json")), { code: "ENOENT" });
});

async function startServiceProcess(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), "capxul-service-stop-")); directories.push(root);
  const bench = join(root, "bench"); await mkdir(bench);
  const reservation = createServer();
  const url = await listen(reservation);
  await new Promise<void>((resolve) => reservation.close(() => resolve()));
  const child = spawn(process.execPath, ["--experimental-strip-types", "--no-warnings", fileURLToPath(new URL("../main.ts", import.meta.url))], {
    stdio: ["ignore", "pipe", "pipe"], env: {
      PATH: process.env.PATH, PORT: new URL(url).port,
      BENCH_COMMAND_JSON: JSON.stringify([process.execPath, fileURLToPath(new URL("./fixtures/bench.mjs", import.meta.url)), bench]),
      SITE_SERVICE_TOKEN: "private-site-token", CAPXUL_SECRET: "private-hmac", SITE_SERVICE_STATE_DIR: join(root, "intents"),
      CAPXUL_WORLD: "town1", SITE_BASE_DOMAIN: "localhost", SITE_SCHEME: "http", SITE_PORT: "8000",
      BENCH_DB_ROOT_PASSWORD: "private-db-password", CAPXUL_ADMIN_PASSWORD: "private-admin-password",
    },
  });
  let stderr = ""; child.stderr.on("data", (chunk) => { stderr += chunk; });
  const exited = once(child, "exit").then(([code, signal]) => ({ code, signal }));
  t.after(async () => { if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); await exited; });
  await Promise.race([once(child.stdout, "data"), exited.then(() => { throw new Error(`Site service exited before listening: ${stderr}`); })]);
  assert.equal((await fetch(`${url}/health`)).status, 200);
  return { child, exited, root, bench, url };
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  test(`idle site service exits cleanly on ${signal}`, { timeout: 10_000 }, async (t) => {
    const s = await startServiceProcess(t);
    s.child.kill(signal);
    assert.deepEqual(await s.exited, { code: 0, signal: null });
  });

  test(`site service drains active creation before exiting on ${signal}`, { timeout: 10_000 }, async (t) => {
    const s = await startServiceProcess(t);
    const gate = join(s.bench, "block-configure"); await writeFile(gate, "blocked");
    t.after(() => rm(gate, { force: true }));
    const configuring = new Promise<void>((resolve) => {
      const watcher = watch(s.bench, (_event, name) => { if (name === "configure-started") { watcher.close(); resolve(); } });
      t.after(() => watcher.close());
    });
    const response = fetch(`${s.url}/sites/create`, {
      method: "POST", headers: { authorization: "Bearer private-site-token" },
      body: JSON.stringify({ org: "acme", name: "Acme", safe, adminEmail: "founder@example.test" }),
    }).then(async (res) => ({ status: res.status, body: await res.json() })).catch((error) => ({ error: String(error) }));
    await configuring;
    s.child.kill(signal);
    assert.equal(await Promise.race([s.exited.then(() => true), delay(100).then(() => false)]), false, "creation must finish before exit");
    await assert.rejects(fetch(`${s.url}/health`, { signal: AbortSignal.timeout(1000) }));
    await rm(gate);
    assert.deepEqual(await response, { status: 200, body: { org: "acme", safe: safe.toLowerCase(), site: "acme-town1.localhost", url: "http://acme-town1.localhost:8000", state: "provisioned" } });
    assert.deepEqual(await s.exited, { code: 0, signal: null });
    const site = JSON.parse(await readFile(join(s.bench, "acme-town1.localhost", "site.json"), "utf8"));
    assert.equal(site.settings.safe_address, safe.toLowerCase()); assert.equal(site.world, "town1");
  });
}
