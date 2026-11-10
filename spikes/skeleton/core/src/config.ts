// Configuration. Every value can be overridden from the environment (the test script relies on that).
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const coreDir = resolve(here, "..");
export const skeletonDir = resolve(coreDir, "..");

function loadDotEnv(path: string): void {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && process.env[m[1]!] === undefined) process.env[m[1]!] = m[2]!;
  }
}
loadDotEnv(join(skeletonDir, ".env"));

const env = (k: string, d: string): string => process.env[k] ?? d;
const stateDir = env("STATE_DIR", join(coreDir, "state"));
const corePort = Number(env("CORE_PORT", "8787"));

export const config = {
  secret: env("SKELETON_SECRET", ""),
  stateDir,
  rpcUrl: env("RPC_URL", "http://127.0.0.1:8545"),
  deploymentFile: env("DEPLOYMENT_FILE", join(stateDir, "deployment.json")),
  frappeUrl: env("FRAPPE_URL", "http://127.0.0.1:8000"),
  corePort,
  coreUrl: env("CORE_URL", `http://127.0.0.1:${corePort}`),
  // the URL a person's browser uses (the approval link in /prepare answers)
  coreBrowserUrl: env("CORE_BROWSER_URL", `http://localhost:${corePort}`),
  newSiteScript: env("NEW_SITE_SCRIPT", join(skeletonDir, "frappe", "bin", "new-site.sh")),
  featureScript: env("FEATURE_SCRIPT", join(skeletonDir, "frappe", "bin", "feature.sh")),  // stand-in for the site service
  peopleFile: join(coreDir, "people.json"),
  outDir: join(coreDir, "out"),
  clientId: "capxul-skeleton",
  pollMs: Number(env("POLL_MS", "700")),
  retryMinMs: Number(env("RETRY_MIN_MS", "500")),
  retryMaxMs: Number(env("RETRY_MAX_MS", "8000")),
};

if (!config.secret) throw new Error("SKELETON_SECRET is not set (expected in spikes/skeleton/.env)");
