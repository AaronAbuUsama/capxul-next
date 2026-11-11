/**
 * The sandbox a run's agents work against. `none` is nothing. `light` is a local chain from the seeded state on a free
 * port (packages/contracts/bin/chain-up.sh, run in the lane). `heavy` is a world with a company's Frappe site, made
 * through the spike's CLI against the Docker stack that is already running, and removed after. Starting is safe to repeat:
 * a sandbox that still answers is reused. Both talk to the repository through commands, never imports.
 */
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { freePort, type Lane } from "../../lanes/service.ts";
import type { Ctx, SandboxInfo, SandboxKind } from "../types.ts";
import { sh, type Ran } from "./sh.ts";
import { boxFor, startCloud, stopCloud } from "./cloud.ts";

const answers = (url: string): Promise<boolean> =>
  fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}', signal: AbortSignal.timeout(1500) }).then((r) => r.ok, () => false);

const light = async (ctx: Ctx, lane: Lane, was?: SandboxInfo): Promise<SandboxInfo> => {
  if (was?.kind === "light" && was.port && await answers(`http://127.0.0.1:${was.port}`)) return was;
  const port = await freePort();
  const r = await sh(ctx, ["bash", "packages/contracts/bin/chain-up.sh", "core"], { cwd: lane.dir, env: { CHAIN_PORT: String(port) }, timeoutMs: 120_000 });
  if (r.code !== 0) throw new Error(`the light sandbox did not start: ${r.out.slice(-300)}`);
  const pidFile = join(lane.dir, "packages/contracts/.chain", `anvil-${port}.pid`);
  return { kind: "light", port, ...(existsSync(pidFile) ? { pid: Number(readFileSync(pidFile, "utf8")) } : {}), env: { CAPXUL_CHAIN_RPC: `http://127.0.0.1:${port}`, CAPXUL_CHAIN_ID: "84532", CHAIN_PORT: String(port) } };
};

/** The checkout whose Docker stack is up (LOOP_STACK_DIR), not the lane's copy. */
const stackOf = (ctx: Ctx): string => ctx.env.LOOP_STACK_DIR ?? ctx.root;
const spike = (ctx: Ctx, ...args: string[]) =>
  sh(ctx, ["node", "--experimental-strip-types", "--no-warnings", join(stackOf(ctx), "spikes/skeleton/core/src/main.ts"), ...args], { cwd: stackOf(ctx), timeoutMs: 30 * 60_000 });

const heavy = async (ctx: Ctx, id: string, was?: SandboxInfo): Promise<SandboxInfo> => {
  if (was?.kind === "heavy" && was.world) return was;
  const world = `loop${id.replace(/[^a-z0-9]/gi, "").toLowerCase().slice(-8)}`;
  const made = await spike(ctx, "world", "create", world, "--as", "operator");
  if (made.code !== 0) throw new Error(`world ${world} was not made (is the Docker stack up? LOOP_STACK_DIR=${stackOf(ctx)}): ${made.out.slice(-300)}`);
  const org = await spike(ctx, "org", "create", "acme", "Acme Trading Ltd", "--admin", "hannah@acme.test", "--world", world);
  if (org.code !== 0) throw new Error(`the company site was not made in ${world}: ${org.out.slice(-300)}`);
  const w = (JSON.parse(readFileSync(join(stackOf(ctx), "spikes/skeleton/core/state/worlds.json"), "utf8")) as Record<string, { anvilPort: number; corePort: number }>)[world]!;
  return { kind: "heavy", world, port: w.anvilPort, env: { CAPXUL_CHAIN_RPC: `http://127.0.0.1:${w.anvilPort}`, CAPXUL_CORE_URL: `http://127.0.0.1:${w.corePort}`, CAPXUL_WORLD: world, CAPXUL_SITE: `acme.${world}.localhost` } };
};

export const startSandbox = (ctx: Ctx, kind: SandboxKind, lane: Lane, runId: string, was?: SandboxInfo): Promise<SandboxInfo> =>
  kind === "light" ? light(ctx, lane, was) : kind === "heavy" ? heavy(ctx, runId, was) : kind === "cloud" ? startCloud(ctx, lane, runId, was) : Promise.resolve({ kind: "none", env: {} });

/** What runs a command to its end for this sandbox: in its box when it is `cloud`, on this machine otherwise. */
export type Runner = (command: string, o: { cwd: string; env?: Record<string, string>; file?: string; timeoutMs?: number; stopped?: () => boolean }) => Promise<Ran>;
export const runnerOf = (ctx: Ctx, s: SandboxInfo | undefined): Runner => {
  const box = boxFor(ctx, s);
  if (!box) return (command, o) => sh(ctx, command, o);
  return (command, o) => box.run(command, { cwd: o.cwd, ...(o.env ? { env: o.env } : {}), ...(o.timeoutMs ? { timeoutMs: o.timeoutMs } : {}), ...(o.stopped ? { stopped: o.stopped } : {}), ...(o.file ? { onOutput: (t: string) => appendFileSync(o.file!, t) } : {}) });
};

/** Stops it and removes what it made. Never throws: a sandbox that is already gone is the goal. */
export const stopSandbox = async (ctx: Ctx, lane: Lane | undefined, s: SandboxInfo | undefined, runId = ""): Promise<void> => {
  if (!s || s.kind === "none") return;
  if (s.kind === "cloud") return stopCloud(ctx, runId);
  if (s.kind === "light" && lane) await sh(ctx, ["bash", "packages/contracts/bin/chain-down.sh"], { cwd: lane.dir, env: { CHAIN_PORT: String(s.port) } });
  if (s.kind === "heavy" && s.world) await spike(ctx, "world", "delete", s.world, "--as", "operator");
};
