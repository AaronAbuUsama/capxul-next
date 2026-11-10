// The entry point. It picks the WORLD (a chain with every company on it, one Core, one clock), points the environment at that world's own
// state, chain and Core, and only then loads the command table (run.ts), because configuration is read when a module is first loaded.
//   node --experimental-strip-types core/src/main.ts [--world <name>] org create acme "Acme Trading Ltd" --admin hannah@acme.test
// The world is `--world <name>`; or, for commands that are about a world (world ... <name>, record ... <name>), the name given as the argument;
// otherwise CAPXUL_WORLD; otherwise `main`, the one the spike always had.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const coreDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const registryFile = join(coreDir, "state", "worlds.json");
type W = { name: string; stateDir: string; anvilPort: number; corePort: number };
const mainWorld: W = { name: "main", stateDir: join(coreDir, "state"), anvilPort: 8545, corePort: 8787 };
export const registry = (): Record<string, W> => ({ main: mainWorld, ...(existsSync(registryFile) ? JSON.parse(readFileSync(registryFile, "utf8")) : {}) });

import { parseArgs } from "./args.ts";
const { pos, flags } = parseArgs(process.argv.slice(2).filter((a) => a !== "--json"));
const positional = pos[0] === "world" && pos[1] === "clock" ? pos[3] : pos[0] === "world" && (pos[1] === "show" || (pos[1] === "snapshot" && pos[2] === "save")) ? pos[pos[1] === "show" ? 2 : 3]
  : pos[0] === "record" && pos[1] !== "show" ? pos[2] : undefined;
const name = (typeof flags.world === "string" ? flags.world : undefined) ?? positional ?? process.env.CAPXUL_WORLD ?? "main";
const w = registry()[name];
if (w) {
  // the default world keeps whatever the environment already says (the test scripts point it at their own state, chain and Core)
  const set = (k: string, v: string) => { if (w.name !== "main" || process.env[k] === undefined) process.env[k] = v; };
  process.env.CAPXUL_WORLD = w.name;
  set("STATE_DIR", w.stateDir);
  set("RPC_URL", `http://127.0.0.1:${w.anvilPort}`);
  set("CORE_PORT", String(w.corePort));
  set("CORE_URL", `http://127.0.0.1:${process.env.CORE_PORT}`);
  set("DEPLOYMENT_FILE", join(process.env.STATE_DIR!, "deployment.json"));
} else {
  process.env.CAPXUL_WORLD = name;   // unknown world: run.ts refuses (or, for `world create`, makes it)
}
await import("./run.ts");
