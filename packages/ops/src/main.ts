import { statSync } from "node:fs";
import { dirname } from "node:path";
import { execFileSync } from "node:child_process";
import { supervisor, services } from "./modules/ops/service.ts";
import { systemPorts } from "./modules/ops/internal/system.ts";
import type { Result } from "./modules/ops/types.ts";

const main = async (): Promise<Result> => {
  const [command, target = "all", ...flags] = process.argv.slice(2);
  if (!command || !["start", "stop", "restart", "status", "reap"].includes(command)) return { ok: false, error: "usage: pnpm ops <start|stop|restart|status> [service|all] | reap [--dry-run]" };
  const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
  const worktree = statSync(root + "/.git").isFile();
  if (worktree && (command === "start" || command === "restart")) return { ok: false, error: "Start refused inside a worktree (.git is a file); use the main checkout" };
  const common = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { encoding: "utf8" }).trim();
  const io = systemPorts(dirname(common));
  io.worktree = worktree;
  const ops = supervisor(io);
  if (command === "reap") {
    if (!["all", "--dry-run"].includes(target) || flags.length) return { ok: false, error: "usage: pnpm ops reap [--dry-run]" };
    return ops.reap(target === "--dry-run");
  }
  const selected = target === "all" ? [...services] : services.filter((s) => s.name === target);
  if (!selected.length || flags.length) return { ok: false, error: "service must be portal, host, alerts, chain, core or all" };
  if (command === "stop" || command === "restart") {
    for (const s of [...selected].reverse()) { const result = await ops.stop(s); if (!result.ok) return result; }
  }
  if (command !== "stop") for (const s of selected) {
    const result = await ops[command === "restart" ? "start" : command as "start" | "status"](s);
    if (!result.ok) return result;
  }
  return { ok: true };
};
main().then((r) => { if (!r.ok) { console.error(r.error); process.exitCode = 1; } }, (error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1;
});
