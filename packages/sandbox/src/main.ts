// `pnpm sandbox …`: the composition root, the only file that reads the environment, prints or exits.
// Which launcher: SANDBOX=docker:<image> (local Docker), SANDBOX=url:<address> (one box already running), else the
// Cloudflare Worker named in var/sandbox/box.json of the main checkout (packages/sandbox/deploy.sh writes it).
import { execFileSync } from "node:child_process";
import { launcherFrom } from "./modules/box/service.ts";
import { sandboxCli } from "./modules/cli/service.ts";

/** The checkout that holds the key: the main one, whichever worktree the command runs in. */
const mainCheckout = (): string => {
  try { return execFileSync("git", ["worktree", "list", "--porcelain"], { encoding: "utf8" }).split("\n")[0]!.replace(/^worktree /, ""); }
  catch { return process.cwd(); }
};

const launcher = launcherFrom(process.env, mainCheckout());
if (typeof launcher === "string") { process.stderr.write(`${launcher}\n`); process.exit(1); }
const r = await sandboxCli(process.argv.slice(2), { launcher, now: () => new Date(), write: (t) => { process.stdout.write(t); } });
(r.code === 0 ? process.stdout : process.stderr).write(r.lines.map((l) => `${l}\n`).join(""));
process.exit(r.code);
