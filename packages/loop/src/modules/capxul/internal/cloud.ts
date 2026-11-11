/**
 * The `cloud` sandbox: the run's own box (packages/sandbox), which every agent's tool call, every gate and every commit
 * of the run executes in. The run is the box's owner (`run:<id>`), so its boxes are found, and reaped, by the run.
 * Which launcher is the sandbox package's choice (`launcherFrom`): the Cloudflare Worker, or with `SANDBOX=docker:<tag>`
 * or `SANDBOX=url:<address>` a local one, for tests. Inside the box a chain runs from the seeded state, as `light` does.
 */
import { boxOf, launcherFrom, nameOf, reap, type Box, type Launcher } from "@capxul/sandbox/box";
import type { Lane } from "../../lanes/service.ts";
import type { Ctx, SandboxInfo } from "../types.ts";

/** The chain inside a box: the port of `packages/contracts/bin/chain-up.sh`'s default, nothing else uses it there. */
const CHAIN_PORT = 18545;
/** A run's box lives this long from its last start (a resume starts it again): longer than any run's time limit. */
const TTL_MS = 3 * 60 * 60 * 1000;

export const ownerOf = (runId: string): string => `run:${runId}`;
export const launcherOf = (ctx: Ctx): Launcher | string => launcherFrom(ctx.env, ctx.root);

/** The box a run's sandbox names, or none. The key is read again each time and never stored with the run. */
export const boxFor = (ctx: Ctx, s: SandboxInfo | undefined): Box | undefined => {
  if (s?.kind !== "cloud" || !s.box) return undefined;
  const l = launcherOf(ctx), link = typeof l === "string" ? undefined : l.link(s.box);
  return link?.ok ? boxOf(link.value) : undefined;
};

/** Starts the run's box (or finds it again), makes its lane match the lane here, and starts a chain in it. */
export const startCloud = async (ctx: Ctx, lane: Lane, runId: string): Promise<SandboxInfo> => {
  const l = launcherOf(ctx);
  if (typeof l === "string") throw new Error(l);
  const name = nameOf(runId), started = await l.start(name, { owner: ownerOf(runId), ttlMs: TTL_MS });
  if (!started.ok) throw new Error(`the cloud sandbox did not start: ${started.error.message}`);
  const box = boxOf(started.value);
  const pushed = await box.push(lane.dir, lane.branch);
  if (!pushed.ok) throw new Error(`the lane did not reach the cloud sandbox: ${pushed.error.message}`);
  const rpc = `http://127.0.0.1:${CHAIN_PORT}`;
  // A lane without the contracts' chain script (an older one, a test's) has no chain.
  const up = await box.run(`[ ! -f packages/contracts/bin/chain-up.sh ] || curl -sf -X POST -H 'content-type: application/json' --data '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' ${rpc} >/dev/null || CHAIN_PORT=${CHAIN_PORT} bash packages/contracts/bin/chain-up.sh core`, { cwd: lane.dir, timeoutMs: 180_000 });
  if (up.code !== 0) throw new Error(`the chain in the cloud sandbox did not start: ${up.out.slice(-300)}`);
  return { kind: "cloud", box: name, url: started.value.url, launcher: l.name, env: { CAPXUL_CHAIN_RPC: rpc, CAPXUL_CHAIN_ID: "84532", CHAIN_PORT: String(CHAIN_PORT) } };
};

/** The value of a box's answer, or the step fails with the box's own words: a run is resumed from there. */
export const inBox = <T>(r: { ok: true; value: T } | { ok: false; error: { message: string } }): T => { if (!r.ok) throw new Error(`the cloud sandbox failed: ${r.error.message}`); return r.value; };

/** Takes down every box the run owns: its own and any its agents made. Never throws; the launcher's guard catches the rest. */
export const downOwned = async (ctx: Ctx, runId: string): Promise<string[]> => {
  const l = launcherOf(ctx);
  if (typeof l === "string") return [];
  const all = await l.list();
  const mine = all.ok ? all.value.filter((b) => b.owner === ownerOf(runId)).map((b) => b.name) : [nameOf(runId)];
  for (const n of new Set([...mine, nameOf(runId)])) await l.stop(n);
  return mine;
};

/**
 * The host's sweep: takes down boxes past their expiry, boxes that stopped, and boxes of runs that are no longer being
 * played (`playing` says which are). A box no run owns is left to its expiry. Never throws.
 */
export const reapEnded = async (ctx: Ctx, playing: (runId: string) => boolean): Promise<string[]> => {
  const l = launcherOf(ctx);
  if (typeof l === "string") return [];
  const r = await reap(l, { now: ctx.now(), keep: (b) => !b.owner.startsWith("run:") || playing(b.owner.slice(4)) }).catch(() => undefined);
  return r?.ok ? r.value.map((g) => `${g.box.name} (${g.box.owner}): ${g.why}`) : [];
};

/** How often the host sweeps boxes. */
const REAP_MS = 5 * 60_000;

/** Runs `reapEnded` every five minutes, saying what it took down; returns what stops it. */
export const sweepBoxes = (ctx: Ctx, playing: (runId: string) => boolean): (() => void) => {
  const timer = setInterval(() => { void reapEnded(ctx, playing).then((gone) => { for (const g of gone) ctx.say(`sandbox reaped ${g}`); }); }, REAP_MS);
  timer.unref();
  return () => clearInterval(timer);
};
