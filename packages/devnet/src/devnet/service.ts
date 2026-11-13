import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { gateway } from "./gateway.ts";
import { databaseUrl, loopback, readConfig, stateFile, type Component, type Config } from "./supervisor.ts";

/** Explicit allowlist: PG_ADMIN_URL and the operator's signing keys never enter runtime children. */
export function runtimeEnv(c: Config, component: Component): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of ["PATH", "HOME", "LANG", "NODE_EXTRA_CA_CERTS", "SSL_CERT_FILE", "TMPDIR"]) if (process.env[key]) env[key] = process.env[key];
  if (component === "ponder") Object.assign(env, {
    PONDER_DATABASE_URL: databaseUrl(c.database.ponder, c.world), RPC_URL: loopback(c.ports.anvil),
    DEPLOYMENT_FILE: join(c.world.stateDir, "deployment.json"), ENTRY_POINT_ADDRESS: "0x0000000071727De22E5E9d8BAf0edAc6f37da032",
  });
  // The patched finality search stays above the seeded genesis: a frozen chain dates every block alike (devnet.one-world-clock).
  // Before the chain is deployed there is no file and no Ponder to start: ponder.config.ts refuses without DEPLOYMENT_FILE.
  const deployment = join(c.world.stateDir, "deployment.json");
  if (component === "ponder" && existsSync(deployment)) env.PONDER_FIRST_BLOCK = String(JSON.parse(readFileSync(deployment, "utf8")).deployedBlock);
  if (component === "core") Object.assign(env, {
    DATABASE_URL: databaseUrl(c.database.tenant, c.world), WORKER_DATABASE_URL: databaseUrl(c.database.worker, c.world),
    CAPXUL_SECRET: c.secret, CAPXUL_WORLD: c.world.id, RPC_URL: loopback(c.ports.anvil), CHAIN_ID: String(c.chainId), FINALITY_DEPTH: String(c.finality),
    CORE_HOST: "127.0.0.1", CORE_PORT: String(c.ports.core), CORE_URL: loopback(c.ports.publicCore), CORE_START_PAUSED: "true",
    FRAPPE_URL: loopback(c.ports.bench), FRAPPE_SOCKET_URL: loopback(c.ports.socket), PONDER_URL: loopback(c.ports.ponder),
    SITE_SERVICE_URL: loopback(c.ports.siteService), SITE_SERVICE_TOKEN: c.siteToken,
  });
  if (component === "site-service") Object.assign(env, c.bench.env, {
    SITE_SERVICE_TOKEN: c.siteToken, CAPXUL_SECRET: c.secret, SITE_SERVICE_STATE_DIR: join(c.world.stateDir, "site-service"),
    CAPXUL_WORLD: c.world.id, SITE_BASE_DOMAIN: c.bench.baseDomain, SITE_SCHEME: "http", SITE_PORT: String(c.ports.publicBench),
    BENCH_DB_ROOT_PASSWORD: c.bench.dbPassword, CAPXUL_ADMIN_PASSWORD: c.bench.adminPassword, PORT: String(c.ports.siteService),
    BENCH_COMMAND_JSON: JSON.stringify(["docker", "compose", ...c.bench.composeArgs, "run", "--rm", "-T", "--no-deps", "site-admin", "bench"]),
  });
  if (component === "bundler") Object.assign(env, c.bundler?.env);
  return env;
}

async function serve(c: Config, component: Component): Promise<() => Promise<void>> {
  if (component === "ingress") return gateway(c);
  const argv = component === "anvil" ? ["anvil", "--host", "127.0.0.1", "--port", String(c.ports.anvil), "--chain-id", String(c.chainId), "--preserve-historical-states", "--state", join(c.world.stateDir, "anvil-state.json")] :
    component === "ponder" ? [join(c.root, "packages/indexer/node_modules/.bin/ponder"), "start", "--schema", "ponder", "--port", String(c.ports.ponder), "--hostname", "127.0.0.1"] :
    component === "core" ? [process.execPath, "--experimental-strip-types", "--no-warnings", join(c.root, "packages/backend/src/main.ts")] :
    component === "bundler" ? c.bundler!.argv : [process.execPath, "--experimental-strip-types", "--no-warnings", join(c.root, "packages/site-service/src/main.ts")];
  // Launch Ponder itself: pnpm exits on signal before its indexer has drained.
  const child = spawn(argv[0]!, argv.slice(1), { cwd: component === "ponder" ? join(c.root, "packages/indexer") : c.root,
    env: runtimeEnv(c, component), stdio: "inherit", detached: true });
  return watchChild(child, component, (code) => finish(code), { asked: () => stopAsked });
}

/** The service manager's stop timeout for a world component (systemd TimeoutStopSec, measured 90 s) before it kills the group. */
export const SERVICE_STOP_TIMEOUT_MS = 90_000;
/**
 * A child's exit stops the wrapper too, so no stale running receipt survives it. Exit 0 is clean only when a stop was asked:
 * systemd signals the whole control group at once, so a fast child can exit 0 before the wrapper handles its own signal, and an
 * exit is judged only after `settleMs`. An unasked exit 0 is unclean, because Restart=always would rerun the wrapper mid-snapshot.
 * The child usually got the stop signal itself, and a second signal during its teardown runs its stop handler twice or kills it,
 * so the wrapper signals only a child still running after `graceMs`, just inside the service manager's own stop timeout.
 */
export function watchChild(child: ChildProcess, name: string, finish: (code: number) => unknown,
  { asked, graceMs = SERVICE_STOP_TIMEOUT_MS - 10_000, settleMs = 1000 }: { asked: () => boolean; graceMs?: number; settleMs?: number }): () => Promise<void> {
  const exited = new Promise<void>((done, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => code === 0 && !signal ? done() : reject(new Error(`${name} exited ${code ?? signal}`)));
  });
  void exited.then(() => setTimeout(() => finish(asked() ? 0 : 1), settleMs), (error) => { console.error(error.message); return finish(1); });
  return async () => {
    const running = () => !!child.pid && child.exitCode === null && child.signalCode === null;
    if (running()) await Promise.race([exited.catch(() => {}), new Promise((done) => setTimeout(done, graceMs))]);
    if (running()) process.kill(-child.pid!, "SIGINT");
    await exited;
  };
}

let finish: (code?: number) => Promise<void> = async () => {}, stopAsked = false;
if (process.argv[1] === import.meta.filename) {
  const c = await readConfig(process.argv[2]!);
  const component = process.argv[3] as Component;
  if (!["anvil", "ponder", "core", "bundler", "site-service", "ingress"].includes(component)) throw new Error("unknown world component");
  const proc = await readFile(`/proc/${process.pid}/stat`, "utf8");
  const identity = { pid: process.pid, birth: proc.slice(proc.lastIndexOf(")") + 2).split(" ")[19], codeVersion: c.codeVersion };
  await mkdir(c.controlDir, { recursive: true, mode: 0o700 });
  const file = stateFile(c, component);
  let close: (() => Promise<void>) | undefined, finishing = false;
  const receipt = async (state: "running" | "exited", code?: number) => {
    await writeFile(`${file}.tmp`, JSON.stringify({ ...identity, state, code, signal: null }), { mode: 0o600 });
    await rename(`${file}.tmp`, file);
  };
  finish = async (code = 0) => {
    if (finishing) return; finishing = true;
    try { await close?.(); } catch { code = 1; }
    await receipt("exited", code);
    process.exit(code);
  };
  for (const signal of ["SIGTERM", "SIGINT"] as const) process.once(signal, () => { stopAsked = true; void finish(); });
  try {
    close = await serve(c, component);
    await receipt("running");
  } catch { await finish(1); }
}
