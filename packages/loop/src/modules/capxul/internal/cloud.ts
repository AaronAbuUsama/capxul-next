/**
 * The `cloud` sandbox: a box off this machine (modules/cloud) that the run's agents and gates execute in. Which launcher
 * is this repository's choice: Cloudflare, through the Worker whose address and key `packages/loop/cloud/deploy.sh`
 * wrote to `var/cloud/box.json`; or, when `LOOP_BOX=docker:<image>`, a local container of the same image, or with
 * `LOOP_BOX=url:<address>` a box already running there (both for testing the image and the bridge, never for real runs). Inside the box a chain runs from the seeded state, as `light` does here.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { boxOf, cloudflare, docker, running, type Box, type Launcher, type Link } from "../../cloud/service.ts";
import type { Lane } from "../../lanes/service.ts";
import type { Ctx, SandboxInfo } from "../types.ts";

/** Where the deploy script leaves the Worker's address and key: git-ignored, readable by this machine's user only. */
export const KEY_FILE = "var/cloud/box.json";
/** The chain inside a box: the port of `packages/contracts/bin/chain-up.sh`'s default, nothing else uses it there. */
const CHAIN_PORT = 18545;

interface Config { readonly launcher: Launcher; readonly headers: Readonly<Record<string, string>> }

const configOf = (ctx: Ctx): Config | string => {
  const local = ctx.env.LOOP_BOX?.match(/^docker:(.+)$/)?.[1], at = ctx.env.LOOP_BOX?.match(/^url:(.+)$/)?.[1];
  if (local) return { launcher: docker(local), headers: {} };
  if (at) return { launcher: running(at), headers: {} };
  const file = join(ctx.root, KEY_FILE);
  if (!existsSync(file)) return `the cloud sandbox is not set up: ${KEY_FILE} is missing (packages/loop/cloud/deploy.sh writes it when it deploys the Worker)`;
  const { url, key } = JSON.parse(readFileSync(file, "utf8")) as { url?: string; key?: string };
  if (!url || !key) return `${KEY_FILE} has no url or no key`;
  return { launcher: cloudflare(url, key), headers: { authorization: `Bearer ${key}` } };
};

/** The box a run's sandbox names, or why there is none. The key is read again each time and never stored with the run. */
export const boxFor = (ctx: Ctx, s: SandboxInfo | undefined): Box | undefined => {
  if (s?.kind !== "cloud" || !s.url) return undefined;
  const c = configOf(ctx);
  return typeof c === "string" ? undefined : boxOf({ url: s.url, headers: c.headers } satisfies Link);
};

/** Starts the run's box (or finds it again), makes its lane match the lane here, and starts a chain in it. */
export const startCloud = async (ctx: Ctx, lane: Lane, runId: string, was?: SandboxInfo): Promise<SandboxInfo> => {
  const c = configOf(ctx);
  if (typeof c === "string") throw new Error(c);
  const started = await c.launcher.start(runId);
  if (!started.ok) throw new Error(`the cloud sandbox did not start: ${started.error.message}`);
  const box = boxOf(started.value);
  const pushed = await box.push(lane.dir, lane.branch);
  if (!pushed.ok) throw new Error(`the lane did not reach the cloud sandbox: ${pushed.error.message}`);
  const rpc = `http://127.0.0.1:${CHAIN_PORT}`;
  // A lane without the contracts' chain script (an older one, a test's) has no chain.
  const up = await box.run(`[ ! -f packages/contracts/bin/chain-up.sh ] || curl -sf -X POST -H 'content-type: application/json' --data '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' ${rpc} >/dev/null || CHAIN_PORT=${CHAIN_PORT} bash packages/contracts/bin/chain-up.sh core`, { cwd: lane.dir, timeoutMs: 180_000 });
  if (up.code !== 0) throw new Error(`the chain in the cloud sandbox did not start: ${up.out.slice(-300)}`);
  if (was?.url && was.url !== started.value.url) ctx.say(`the run's box moved: ${started.value.url}`);
  return { kind: "cloud", url: started.value.url, launcher: c.launcher.name, env: { CAPXUL_CHAIN_RPC: rpc, CAPXUL_CHAIN_ID: "84532", CHAIN_PORT: String(CHAIN_PORT) } };
};

/** The value of a box's answer, or the step fails with the box's own words: a run is resumed from there. */
export const inBox = <T>(r: { ok: true; value: T } | { ok: false; error: { message: string } }): T => { if (!r.ok) throw new Error(`the cloud sandbox failed: ${r.error.message}`); return r.value; };

/** Removes the run's box. Never throws. */
export const stopCloud = async (ctx: Ctx, runId: string): Promise<void> => {
  const c = configOf(ctx);
  if (typeof c !== "string") await c.launcher.stop(runId);
};
