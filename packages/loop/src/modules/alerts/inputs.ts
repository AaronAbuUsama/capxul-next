/** Capxul inbox adapter: the very predicates used by the portal, not generated pages. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
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

export const questionsAt = async (root: string): Promise<Snapshot["questions"]> => {
  const load = (path: string) => import(pathToFileURL(join(root, path)).href);
  const [book, waiting, planDoor] = await Promise.all([
    load("blueprint/index.ts"), load("blueprint/shared/waiting.ts"), load("packages/plan/src/index.ts"),
  ]);
  const plan = JSON.parse(readFileSync(join(root, "plan/plan.json"), "utf8"));
  const decisions = (book.records as { _kind: string; id: string; question: string }[])
    .filter((d) => d._kind === "decision" && waiting.forAaron(d))
    .map((d) => ({ id: `decision:${d.id}`, text: d.question }));
  const needs = (plan.tasks as { id: string; blockedBy?: { need?: string } }[])
    .filter((t) => planDoor.waitsOnOwner(t, "aaron", () => false))
    .map((t) => ({ id: `task:${t.id}`, text: t.blockedBy!.need! }));
  return [...decisions, ...needs];
};
