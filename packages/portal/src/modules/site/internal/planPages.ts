/** The page of one task and of one milestone of the plan, with their history from the log. */
import { keyOf } from "@capxul/blueprint-engine";

import type { LogEntry } from "@capxul/plan";
import type { PlanMilestonePage, PlanTaskPage } from "../types.ts";
import { head, type Ctx } from "./context.ts";
import { refOf } from "./locate.ts";
import { blockedOf, fileOf, milestoneOf, rowOf, sections, taskOf } from "./plan.ts";

const SOURCE = "plan/plan.json, plan/tasks, plan/milestones and plan/log.jsonl";

/** The log lines about one id: the command named it, or put it on the path. */
const about = (log: readonly LogEntry[], id: string, own: (a: Readonly<Record<string, unknown>>) => boolean): readonly LogEntry[] =>
  log.filter((l) => typeof l.args === "object" && l.args !== null && (own(l.args as Readonly<Record<string, unknown>>) || (l.args as { tasks?: unknown }).tasks instanceof Array && ((l.args as { tasks: string[] }).tasks).includes(id)));

export const taskPage = (ctx: Ctx, id: string): PlanTaskPage | null => {
  const held = ctx.input.plan;
  const t = held?.plan.tasks.find((x) => x.id === id);
  if (!held || !t) return null;
  const m = held.plan.milestones.find((x) => x.id === t.milestone);
  if (!m) return null;
  const at = held.plan.path.tasks.indexOf(id);
  const post = (x: string): ReturnType<typeof taskOf> | null => { const f = held.plan.tasks.find((y) => y.id === x); return f ? taskOf(ctx, f) : null; };
  const named = t.records.flatMap((k) => { const r = ctx.input.blueprint.records.get(k); return r ? [{ ref: refOf(r), evals: (ctx.evals.get(keyOf(r)) ?? []).length }] : []; });
  return {
    ...head(`plan/task/${id}`, t.title, SOURCE, null), type: "plan-task", commit: ctx.input.commit, task: taskOf(ctx, t), milestone: milestoneOf(ctx, m),
    sections: sections(fileOf(ctx, id)), needs: t.needs.flatMap((x) => post(x) ?? []), neededBy: held.plan.tasks.filter((x) => x.needs.includes(id)).map((x) => taskOf(ctx, x)),
    records: named, blocker: t.state === "blocked" ? blockedOf(ctx, t) : null, pathPosition: at < 0 ? null : at + 1, pathLength: held.plan.path.tasks.length,
    history: about(held.log, id, (a) => a["id"] === id).map(rowOf),
  };
};

export const milestonePage = (ctx: Ctx, id: string): PlanMilestonePage | null => {
  const held = ctx.input.plan;
  const m = held?.plan.milestones.find((x) => x.id === id);
  if (!held || !m) return null;
  return {
    ...head(`plan/milestone/${id}`, m.title, SOURCE, null), type: "plan-milestone", commit: ctx.input.commit, milestone: milestoneOf(ctx, m),
    history: about(held.log, id, (a) => a["id"] === id || a["owner"] === id).map(rowOf),
  };
};
