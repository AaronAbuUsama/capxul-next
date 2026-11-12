import { createHmac } from "node:crypto";
import { access, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { World } from "./door.ts";

export type Component = "anvil" | "ponder" | "bundler" | "core" | "site-service" | "ingress";
export type Config = {
  version: 1; root: string; controlDir: string; snapshots: string; codeVersion: string; world: World;
  database: { admin: string; tenant: string; worker: string; ponder: string };
  ports: { anvil: number; ponder: number; core: number; siteService: number; bench: number; socket: number;
    publicCore: number; publicRpc: number; publicBench: number; publicBundler: number };
  secret: string; siteToken: string; finality: number; chainId: number;
  bench: { composeArgs: string[]; env: Record<string, string>; dbPassword: string; adminPassword: string; baseDomain: string };
  bundler?: { argv: string[]; url: string; env: Record<string, string>; paymaster?: string };
};
export const loopback = (port: number) => `http://127.0.0.1:${port}`;
export const stateFile = (config: Config, component: Component) => join(config.controlDir, `${component}.json`);
export const databaseUrl = (url: string, world: World): string => {
  const connection = new URL(url);
  connection.pathname = `/${world.database}`;
  return connection.href;
};
export async function readConfig(file: string): Promise<Config> {
  if ((await stat(file)).mode & 0o077) throw new Error("world config contains credentials; chmod 600 before use");
  const c = JSON.parse(await readFile(file, "utf8")) as Config;
  if (c.version !== 1 || !/^[a-z][a-z0-9]{0,11}$/.test(c.world.id) || !/^[a-z][a-z0-9_]{0,62}$/.test(c.world.database) ||
      !["local", "simulated"].includes(c.world.kind) || !Number.isSafeInteger(c.world.epoch) || c.world.epoch < 1 ||
      ![c.root, c.controlDir, c.snapshots, c.world.stateDir].every(isAbsolute) || c.controlDir === c.world.stateDir ||
      !c.secret || !c.siteToken || !c.codeVersion || !Number.isSafeInteger(c.chainId) || c.chainId < 1 ||
      !Number.isSafeInteger(c.finality) || c.finality < 0) throw new Error("invalid local world configuration");
  const ports = Object.values(c.ports);
  if (new Set(ports).size !== ports.length || ports.some((p) => !Number.isSafeInteger(p) || p < 1024 || p > 65535)) throw new Error("world ports must be distinct unprivileged ports");
  const admin = new URL(c.database.admin);
  for (const [role, value] of [["capxul_core", c.database.tenant], ["capxul_worker", c.database.worker], ["capxul_ponder", c.database.ponder]]) {
    const u = new URL(value!);
    if (decodeURIComponent(u.username) !== role || !u.password || u.hostname !== admin.hostname || u.port !== admin.port) throw new Error("restricted runtime database URLs required on the maintenance host");
  }
  for (const u of [admin, ...Object.values(c.database).map((v) => new URL(v))]) {
    if (!["127.0.0.1", "localhost", "[::1]"].includes(u.hostname)) throw new Error("this supervisor is local-only; remote databases are refused");
  }
  if (c.bundler && (!c.bundler.argv.length || new URL(c.bundler.url).hostname !== "127.0.0.1")) throw new Error("bundler slot requires fixed argv and a private loopback URL");
  return c;
}
export async function writeConfig(file: string, c: Config): Promise<void> {
  await mkdir(resolve(file, ".."), { recursive: true, mode: 0o700 });
  await writeFile(`${file}.tmp`, JSON.stringify(c, null, 2), { mode: 0o600 });
  await rename(`${file}.tmp`, file);
}
export async function signedCore(c: Config, path: string, body: unknown = {}): Promise<any> {
  const raw = JSON.stringify(body);
  const r = await fetch(new URL(path, loopback(c.ports.core)), { method: "POST", body: raw,
    headers: { "content-type": "application/json", "X-Capxul-Signature": createHmac("sha256", c.secret).update(raw).digest("hex") },
    signal: AbortSignal.timeout(180_000) });
  if (!r.ok) throw new Error(`Core ${path} refused (${r.status}); inspect private service logs`);
  return r.json();
}
export async function until(label: string, check: () => Promise<boolean>, timeout = 120_000): Promise<void> {
  const deadline = Date.now() + timeout;
  do { if (await check()) return; await delay(200); } while (Date.now() < deadline);
  throw new Error(`${label} did not become ready within ${timeout}ms`);
}
export async function httpReady(url: string): Promise<boolean> {
  try { return (await fetch(url, { signal: AbortSignal.timeout(2000) })).status === 200; } catch { return false; }
}
export async function pendingRestore(c: Config): Promise<boolean> {
  try { await access(join(c.world.stateDir, "restore-pending.json")); return true; } catch (e: any) { if (e.code === "ENOENT") return false; throw e; }
}

export type Host = {
  start(component: Component): Promise<void>; stop(component: Component): Promise<void>;
  benchUp(): Promise<void>; benchStop(): Promise<void>;
};
/** The same order is used on cold startup and through the recovery owner's process hooks. */
export async function up(c: Config, host: Host): Promise<void> {
  if (await pendingRestore(c)) throw new Error("restore-pending marker holds this world stopped; resolve recovery before world up");
  try { await access(join(c.world.stateDir, "create-pending.json")); throw new Error("creation is incomplete; inspect create-pending before restarting"); }
  catch (e: any) { if (e.code !== "ENOENT") throw e; }
  for (const file of ["deployment.json", "anvil-state.json", "clock.json"]) await access(join(c.world.stateDir, file));
  await host.stop("ingress");
  try {
    await host.benchUp();
    for (const component of ["anvil", "ponder", "bundler", "site-service", "core"] as const) await host.start(component);
    await signedCore(c, "/admin/snapshot/resume");
    await until("Core /ready", () => httpReady(`${loopback(c.ports.core)}/ready`));
    await host.start("ingress");
  } catch (error) {
    try { await stop(c, host); } catch (cleanup) { throw new AggregateError([error, cleanup], "startup failed; world held closed"); }
    throw error;
  }
}
export async function stop(c: Config, host: Host): Promise<void> {
  // Pause may be unreachable after a crash. Stopping the process still drains its own work.
  const errors: unknown[] = [];
  try { await host.stop("ingress"); } catch (error) { errors.push(error); }
  try { if (await httpReady(`${loopback(c.ports.core)}/health`)) await signedCore(c, "/admin/snapshot/pause"); } catch (error) { errors.push(error); }
  for (const component of ["site-service", "bundler", "core", "anvil", "ponder"] as const) {
    try { await host.stop(component); } catch (error) { errors.push(error); }
  }
  try { await host.benchStop(); } catch (error) { errors.push(error); }
  if (errors.length) throw new AggregateError(errors, "world fenced; some services did not stop cleanly");
}
