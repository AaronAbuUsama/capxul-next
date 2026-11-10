/** The plan module's door: the plan, its commands and its checks. See README.md. */
import { parseArgs } from "./internal/args.ts";
import { apply } from "./internal/apply.ts";
import { check } from "./internal/check.ts";
import { parsePlan } from "./internal/parse.ts";
import { blockerLine, show } from "./internal/show.ts";
import type { Plan, Task } from "./types.ts";

export { apply, blockerLine, check, parseArgs, parsePlan, show };
export type { Request } from "./internal/args.ts";

/** A task that waits on the owner: blocked on a need that is his, or on a decision that waits for him. */
export const waitsOnOwner = (t: Task, owner: string, decisionWaits: (id: string) => boolean): boolean => {
  const b = t.blockedBy;
  if (t.state !== "blocked" || !b) return false;
  return "decision" in b ? decisionWaits(b.decision) : b.who.toLowerCase() === owner.toLowerCase();
};

/** The milestone that is current, if exactly one is. */
export const currentMilestone = (plan: Plan): Plan["milestones"][number] | null => {
  const now = plan.milestones.filter((m) => m.state === "current");
  return now.length === 1 ? (now[0] ?? null) : null;
};

/** One line of the log, as `plan.jsonl` stores it. */
export const logLine = (entry: unknown): string => `${JSON.stringify(entry)}\n`;
