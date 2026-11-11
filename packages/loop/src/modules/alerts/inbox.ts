/** Short-lived authoritative inbox reader: never import this in the poller. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { Snapshot } from "./service.ts";

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

console.log(JSON.stringify(await questionsAt(process.argv[2]!)));
