/** Two commands that end a run's life on disk: `merge` (a ready run into its base, after the gates pass again) and `clean` (a run's lane). */
import { spawnSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { catchUp, dropLane, git, type Lane } from "../../lanes/service.ts";
import { listRuns, readInfo, type Info } from "../../runs/service.ts";
import type { Ctx, Gate, Opts, Task } from "../types.ts";
import { runGates } from "./gates.ts";
import * as plan from "./plan.ts";
import { runnerOf, startSandbox, stopSandbox } from "./sandbox.ts";
import { runDir, runsDir } from "./where.ts";

/** Tracked files with uncommitted changes, outside plan/ and var/ (the runner itself writes there). An untracked file is not in a merge's way. */
const dirtyOutsidePlan = (cwd: string): string[] => git(cwd, "diff", "--name-only", "HEAD").split("\n").filter((p) => p !== "" && !/^(plan|var)\//.test(p));

/**
 * Merges a run that is "ready": brings the current base into the lane, runs the gates again there, and only if every one
 * passes merges into the base in this checkout and pushes it. Refuses, and says why, otherwise. Marks the plan task done.
 */
export const merge = async (ctx: Ctx, id: string): Promise<string[]> => {
  const dir = runDir(ctx, id), info = readInfo(dir), wt = info.extra.lane as Lane | undefined, opts = info.extra.opts as Opts;
  if (info.status !== "ready" || !wt) return [`refused: run ${id} is ${info.status}, not ready to merge`];
  if (git(ctx.root, "rev-parse", "--abbrev-ref", "HEAD") !== wt.base) return [`refused: this checkout is not on ${wt.base}`];
  const dirty = dirtyOutsidePlan(ctx.root);
  if (dirty.length) return [`refused: this checkout has uncommitted changes to tracked files outside plan/ and var/: ${dirty.slice(0, 3).join("; ")}${dirty.length > 3 ? ` and ${dirty.length - 3} more` : ""}`];
  if (!catchUp(wt)) return [`refused: ${wt.branch} conflicts with the current ${wt.base}; resolve it in ${wt.dir}`];
  const task = info.extra.task as Task;
  const box = await startSandbox(ctx, opts.sandbox, wt, id);
  let gates: Gate[];
  try { gates = await runGates(ctx, wt.dir, task, { env: box.env as Record<string, string>, out: join(dir, `merge-gates.${ctx.now().getTime()}.out`), run: runnerOf(ctx, box) }); } finally { await stopSandbox(ctx, wt, box, id); }
  const failed = gates.filter((g) => !g.ok);
  if (failed.length) return [`refused: ${failed.length} of ${gates.length} gates fail on ${wt.branch} with ${wt.base} merged in`, ...failed.map((g) => `  ${g.name}: ${g.tail.split("\n").slice(-3).join(" ")}`)];
  git(ctx.root, "push", "--dry-run", "origin", wt.base);
  git(ctx.root, "merge", "--no-ff", "-m", `Merge ${wt.branch} (loop run ${id})`, wt.branch);
  const commit = git(ctx.root, "rev-parse", "HEAD");
  try { git(ctx.root, "push", "origin", wt.base); } catch (cause) { return [`merged locally at ${commit} but the push failed: ${String(cause).slice(0, 200)}`]; }
  if (info.extra.source === "plan") {
    // Remove only the merged task, not the coordinator's ordering of the remaining work.
    // Do this before marking it done, so even the intermediate plan has no done task on its path.
    const cli = (args: string[]): string => {
      const r = spawnSync("pnpm", ["-s", "plan", ...args], { cwd: ctx.root, encoding: "utf8", env: { ...ctx.env } as NodeJS.ProcessEnv });
      if (r.status !== 0) throw new Error(`plan ${args.slice(0, 2).join(" ")} failed: ${`${r.stdout ?? ""}${r.stderr ?? ""}${r.error ?? ""}`.slice(0, 300)}`);
      return r.stdout;
    };
    const view = JSON.parse(cli(["show", "--json"])) as { plan: { path: { tasks: string[]; why: string } } };
    if (view.plan.path.tasks.includes(info.subject)) {
      cli(["path", "set", ...view.plan.path.tasks.filter((id) => id !== info.subject), "--why", view.plan.path.why ?? `Task ${info.subject} merged`, "--by", "loop"]);
    }
    plan.finish(ctx, info.subject, commit);
  }
  await writeStatus(dir, { ...info, status: "merged", endedAt: ctx.now().toISOString() });
  dropLane(ctx.root, wt);
  return [`merged ${wt.branch} into ${wt.base} at ${commit.slice(0, 7)} and pushed${info.extra.source === "plan" ? `; plan task ${info.subject} marked done` : ""}`];
};

const writeStatus = async (dir: string, info: Info): Promise<void> => writeFileSync(join(dir, "status.json"), `${JSON.stringify(info, null, 2)}\n`);

/** Removes the worktree of one run (any run that is not running), or of every merged or answered run, and frees the branch name `lane/<task>`: a merged branch is deleted, unmerged work is kept as `kept/<run id>`. */
export const clean = (ctx: Ctx, id?: string): string[] => {
  const picked = listRuns(runsDir(ctx)).filter((r) => (id ? r.info.id === id : r.info.status === "merged" || r.info.status === "answered") && existsSync((r.info.extra.lane as Lane | undefined)?.dir ?? "") && r.info.status !== "running");
  return picked.length ? picked.map((r) => `removed the lane of ${r.info.id}: ${dropLane(ctx.root, r.info.extra.lane as Lane, `kept/${r.info.id}`)}`) : ["nothing to clean"];
};
