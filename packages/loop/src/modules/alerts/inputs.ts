/** Capxul inbox adapter: the very predicates used by the portal, not generated pages. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
import type { Snapshot } from "./service.ts";

/** Inspect preserves running runs even when their pid is gone. For alerts, dead runs can be superseded too. */
export const alertRuns = <T extends Snapshot["runs"][number] & { startedAt: string }>(runs: readonly T[], closed: ReadonlySet<string>): readonly T[] => runs.map((r) => {
  if (r.status !== "dead") return r;
  const replaced = runs.some((other) => other.task === r.task && other.startedAt > r.startedAt);
  return replaced || closed.has(r.task) ? { ...r, superseded: r.superseded ?? "newer run or closed task" } : r;
});

export const closedAt = (root: string): ReadonlySet<string> => {
  const plan = JSON.parse(readFileSync(join(root, "plan/plan.json"), "utf8"));
  return new Set((plan.tasks as { id: string; state: string }[]).filter((t) => t.state === "done" || t.state === "dropped").map((t) => t.id));
};

/** A fresh process invalidates the entire import graph, not merely index.ts. */
export const questionsAt = async (root: string): Promise<Snapshot["questions"]> => {
  const { stdout } = await execFileAsync(process.execPath, [
    "--experimental-strip-types", "--no-warnings",
    fileURLToPath(new URL("./inbox.ts", import.meta.url)), root,
  ], { maxBuffer: 4 * 1024 * 1024, timeout: 30_000 });
  return JSON.parse(stdout);
};
