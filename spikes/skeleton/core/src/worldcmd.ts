// A world is one chain with every company on it, one Core and one clock. `world create|list|show`. The default world is `main` (the stack
// the spike always had); another world is its own anvil, its own Core and its own state directory, on ports of its own, and its companies' sites
// carry the world in their names: `<company>.<world>.localhost` (one wildcard certificate covers one label: `*.<world>.example.com` per world).
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { parseArgs } from "./args.ts";
import { config, coreDir, skeletonDir } from "./config.ts";
import { rmSync } from "node:fs";
import type { Out } from "./doc.ts";
import { CliError, refuse } from "./errors.ts";
import { show } from "./render.ts";
import { touched } from "./trace.ts";
import { appendTo } from "./record.ts";

const exec = promisify(execFile);
export type W = { name: string; stateDir: string; anvilPort: number; corePort: number; createdAt?: string; from?: Record<string, unknown>;
  /** a new one when the world starts and at every restore in place (blueprint devnet flows: a subscriber tells a restore from a move) */ epoch?: number;
  clockMode?: "running" | "frozen" };
const registryFile = join(coreDir, "state", "worlds.json");
const mainWorld: W = { name: "main", stateDir: join(coreDir, "state"), anvilPort: 8545, corePort: 8787 };
export const readRegistry = (): Record<string, W> => ({ main: mainWorld, ...(existsSync(registryFile) ? JSON.parse(readFileSync(registryFile, "utf8")) : {}) });
export function register(w: W): void {
  const all = existsSync(registryFile) ? JSON.parse(readFileSync(registryFile, "utf8")) : {};
  all[w.name] = w;
  writeFileSync(registryFile, JSON.stringify(all, null, 2));
}
export const nextPorts = (): { anvilPort: number; corePort: number } => {
  const n = Object.keys(readRegistry()).length;   // main is 0
  return { anvilPort: 8545 + 100 * n, corePort: 8787 + 100 * n };
};
export const validName = (n: string): void => { if (!/^[a-z][a-z0-9]{1,15}$/.test(n)) throw refuse("USAGE", "a world name is lowercase letters and digits (it becomes a label in the site names): for example w2"); };

const env = (w: W) => ({ ...process.env, STATE_DIR: w.stateDir, ANVIL_PORT: String(w.anvilPort), CORE_PORT: String(w.corePort), CAPXUL_WORLD: w.name,
  RPC_URL: `http://127.0.0.1:${w.anvilPort}`, CORE_URL: `http://127.0.0.1:${w.corePort}`, DEPLOYMENT_FILE: join(w.stateDir, "deployment.json") });
export async function startWorld(w: W): Promise<void> {
  mkdirSync(w.stateDir, { recursive: true });
  try { await exec(join(coreDir, "bin", "up.sh"), [], { env: env(w), timeout: 120_000 }); }
  catch (e: any) { throw new CliError(`world ${w.name} did not start: ${String(e.stderr || e.message).slice(-300)}`, "WORLD_START_FAILED"); }
}
export async function stopWorld(w: W): Promise<void> { await exec(join(coreDir, "bin", "down.sh"), [], { env: env(w), timeout: 60_000 }); }

const up = (url: string) => fetch(url, { signal: AbortSignal.timeout(1500) }).then((r) => r.ok, () => false);
async function describe(w: W) {
  const read = (f: string) => { try { return JSON.parse(readFileSync(join(w.stateDir, f), "utf8")); } catch { return undefined; } };
  const orgs = Object.values<any>(read("outbox.json")?.orgs ?? {}).filter((o) => o.released).map((o) => o.slug);
  const clock = read("clock.json");
  const recFile = join(w.stateDir, "record", `${w.name}.jsonl`);
  const recordHead = existsSync(recFile) ? readFileSync(recFile, "utf8").split("\n").filter(Boolean).length : 0;
  const coreUp = await up(`http://127.0.0.1:${w.corePort}/health`);
  return { name: w.name, state: coreUp ? "running" : "stopped", clockMode: clock?.frozenAtMs !== undefined ? "frozen" : "running", recordHead, core: await up(`http://127.0.0.1:${w.corePort}/health`) ? "up" : "down", chain: await up(`http://127.0.0.1:${w.anvilPort}`) || (await fetch(`http://127.0.0.1:${w.anvilPort}`, { method: "POST", headers: { "content-type": "application/json" }, body: '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}', signal: AbortSignal.timeout(1500) }).then((r) => r.ok, () => false)) ? "up" : "down",
    anvilPort: w.anvilPort, corePort: w.corePort, companies: orgs, sites: orgs.map((o) => (w.name === "main" ? `${o}.localhost` : `${o}.${w.name}.localhost`)),
    time: new Date(clock?.frozenAtMs ?? Date.now() + (clock?.offsetMs ?? 0)).toISOString(), from: w.from ?? null, stateDir: w.stateDir, epoch: w.epoch ?? 1,
    parentWorld: (w.from?.world as string) ?? null, parentSnapshot: (w.from?.snapshot as string) ?? null, parentSeq: ((w.from?.record as any)?.count as number) ?? null };
}

export async function worldCreate(args: string[]): Promise<Out> {
  const { pos, flags } = parseArgs(args);
  if (!pos[0]) throw refuse("USAGE", "usage: world create <name> --as operator [--clock running|frozen] [--start-at <iso>] [--template empty]");
  const mode = flags.clock === undefined ? "running" : flags.clock;
  if (mode !== "running" && mode !== "frozen") throw refuse("INVALID_INPUT", "--clock is running or frozen");
  if (flags.template !== undefined && flags.template !== "empty") throw refuse("INVALID_INPUT", "only the empty template is built here: a world starts with no company");
  const startAt = typeof flags["start-at"] === "string" ? Date.parse(flags["start-at"]) : nextMondayNine();
  if (Number.isNaN(startAt)) throw refuse("INVALID_INPUT", `--start-at is not a time: ${flags["start-at"]}`);
  if (flags.as !== "operator") throw refuse("NOT_WORLD_ADMIN", "refused: only the operator makes a world (--as operator)");
  validName(pos[0]);
  if (readRegistry()[pos[0]]) throw refuse("EXISTS", `world ${pos[0]} already exists`);
  const t0 = Date.now();
  const w: W = { name: pos[0], stateDir: join(coreDir, "state", "worlds", pos[0]), ...nextPorts(), createdAt: new Date().toISOString() };
  register(w); touched.extra.world = w.name;
  born(w, mode, mode === "frozen" ? startAt : Date.now());   // first, before the world's own Core writes anything
  await startWorld(w);
  if (mode === "frozen") await freeze(w, startAt);
  const d = await describe(w);
  return { data: { ...d, ms: Date.now() - t0 }, lines: [`world ${w.name}: its own chain on :${w.anvilPort} (contracts deployed) and its own Core on :${w.corePort}, ${Date.now() - t0} ms. Make a company in it: org create <slug> "<name>" --admin <email> --world ${w.name}`] };
}
// The eval epoch of devnet.deterministic-worlds, without a fork: 09:00 UTC on the next Monday.
function nextMondayNine(): number {
  const d = new Date(); d.setUTCHours(9, 0, 0, 0);
  do d.setUTCDate(d.getUTCDate() + 1); while (d.getUTCDay() !== 1);
  return d.getTime();
}
// A frozen world: its time is `at` until a set or an advance moves it. The chain is set to it and then moves one second a block.
async function freeze(w: W, at: number): Promise<void> {
  const rpc = (method: string, params: unknown[]) => fetch(`http://127.0.0.1:${w.anvilPort}`, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(5000) }).then((r) => r.json());
  await rpc("anvil_setTime", [Math.floor(at / 1000)]);
  await rpc("anvil_setBlockTimestampInterval", [1]);
  await rpc("evm_mine", []);
  writeFileSync(join(w.stateDir, "clock.json"), JSON.stringify({ offsetMs: at - Date.now(), frozenAtMs: at, changedAt: new Date().toISOString() }));
}
// The world's record begins with its birth: entry 1 says how it was made.
function born(w: W, mode: string, at: number): void {
  appendTo(join(w.stateDir, "record", `${w.name}.jsonl`), { v: 1, id: `rec_born_${Date.now().toString(36)}`, command: "world create", world: w.name, org: null, outcome: "ok",
    trace: `born_${Date.now().toString(36)}`, args: { positional: [w.name], flags: { clock: mode } }, actor: null, site: null, duration_ms: 0, error: null, result: null,
    changes: { tx: [], docs: [] }, note: "this world was born here: the first entry of its record", born: { world: w.name, clockMode: mode, template: "empty", epoch: 1 },
    world_time: new Date(at).toISOString(), world_time_end: new Date(at).toISOString(), real_time: new Date().toISOString() });
}
export async function worldList(_args: string[]): Promise<Out> {
  const rows = await Promise.all(Object.values(readRegistry()).map(describe));
  return { data: { worlds: rows }, lines: show(rows.map((r) => ({ world: r.name, chain: `${r.chain} :${r.anvilPort}`, core: `${r.core} :${r.corePort}`, companies: r.companies.join(","), time: r.time.slice(0, 19), from: (r.from as any)?.snapshot ?? "" }))) };
}
export async function worldShow(args: string[]): Promise<Out> {
  const { pos } = parseArgs(args);
  const w = pos[0] ? readRegistry()[pos[0]] : undefined;
  if (!w) throw refuse("NOT_FOUND", `no world ${pos[0] ?? ""}; worlds: ${Object.keys(readRegistry()).join(", ")}`);
  const d = await describe(w);
  return { data: d, lines: JSON.stringify(d, null, 2).split("\n") };
}
void config;

// Remove a world made here: stop its chain and Core, drop its sites, delete its state. (The default world `main` cannot be removed.)
export async function worldDelete(args: string[]): Promise<Out> {
  const { pos, flags } = parseArgs(args);
  if (flags.as !== "operator") throw refuse("NOT_WORLD_ADMIN", "refused: only the operator removes a world (--as operator)");
  const w = pos[0] ? readRegistry()[pos[0]] : undefined;
  if (!w) throw refuse("NOT_FOUND", `no world ${pos[0] ?? ""}`);
  if (w.name === "main") throw refuse("INVALID", "the default world cannot be removed");
  const orgs = Object.values<any>((() => { try { return JSON.parse(readFileSync(join(w.stateDir, "outbox.json"), "utf8")).orgs; } catch { return {}; } })()).map((o) => o.slug as string);
  await stopWorld(w).catch(() => undefined);
  await Promise.all(orgs.map((o) => exec(join(skeletonDir, "frappe", "bin", "site-drop.sh"), [`${o}.${w.name}.localhost`], { timeout: 300_000 }).catch(() => undefined)));
  rmSync(w.stateDir, { recursive: true, force: true });
  const all = JSON.parse(readFileSync(registryFile, "utf8")); delete all[w.name]; writeFileSync(registryFile, JSON.stringify(all, null, 2));
  touched.extra.world = w.name;
  return { data: { removed: w.name, sites: orgs.map((o) => `${o}.${w.name}.localhost`) }, lines: [`world ${w.name} removed (its chain, Core and ${orgs.length} sites)`] };
}
