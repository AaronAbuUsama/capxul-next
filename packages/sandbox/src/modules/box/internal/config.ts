/**
 * Which launcher a caller gets, from what its composition root read: `SANDBOX=docker:<image>` (local Docker),
 * `SANDBOX=url:<address>` (one box already running), else the Cloudflare Worker whose address and key
 * `packages/sandbox/deploy.sh` wrote to `var/sandbox/box.json` of the main checkout (`SANDBOX_CONFIG` names another file).
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Launcher } from "../types.ts";
import { cloudflare, docker, running } from "./launch.ts";

/** Where the deploy leaves the Worker's address and key, relative to the main checkout: git-ignored, mode 600. */
export const KEY_FILE = "var/sandbox/box.json";

export const launcherFrom = (env: Readonly<Record<string, string | undefined>>, mainCheckout: string): Launcher | string => {
  const local = env.SANDBOX?.match(/^docker:(.+)$/)?.[1], at = env.SANDBOX?.match(/^url:(.+)$/)?.[1];
  if (local) return docker(local);
  if (at) return running(at);
  const file = env.SANDBOX_CONFIG ?? join(mainCheckout, KEY_FILE);
  if (!existsSync(file)) return `no sandbox is set up: ${file} is missing (packages/sandbox/deploy.sh writes it when it deploys the Worker), and SANDBOX names no local one`;
  const { url, key } = JSON.parse(readFileSync(file, "utf8")) as { url?: string; key?: string };
  return url && key ? cloudflare(url, key) : `${file} has no url or no key`;
};
