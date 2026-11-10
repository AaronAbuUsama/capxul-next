/** The Plan page: the coordinator's plan (plan/plan.json) laid beside the book. It adds nothing of its own to the plan. */
import { passing, type AnyRecord } from "@capxul/book";

import type { ExitLine, Task, TaskState } from "../../../../../../tools/plan/types.ts";
import { blockerLine, waitsOnOwner } from "../../../../../../tools/plan/service.ts";
import type {
  PlanBlocked, PlanExit, PlanLogRow, PlanMilestone, PlanPage, PlanTask, Ref,
} from "../types.ts";
import { head, type Ctx } from "./context.ts";
import { refOf } from "./locate.ts";
import { questionOf } from "./questions.ts";

const SOURCE = "plan/plan.json and plan/log.jsonl";
const STATES: readonly (readonly [TaskState, string])[] = [
  ["doing", "Doing"], ["blocked", "Blocked"], ["todo", "To do"], ["done", "Done"], ["dropped", "Dropped"],
];
/** How many lines of the log the page shows. */
export const LOG_SHOWN = 20;

const exitOf = (e: ExitLine): PlanExit => ({ id: e.id, claim: e.claim, met: e.state === "met", evidence: e.evidence ?? "" });
export const taskOf = (t: Task): PlanTask => ({
  id: t.id, title: t.title, why: t.why, milestone: t.milestone, state: t.state, thread: t.thread ?? "", needs: t.needs,
  evidence: t.evidence, updated: t.updated, droppedWhy: t.droppedWhy ?? "",
});

const clip = (s: string, n: number): string => (s.length <= n ? s : `${s.slice(0, n - 1)}…`);
/** What a log line was about, in a few words: the task, the exit line, or the start of the text. */
const summaryOf = (args: unknown): string => {
  const a = typeof args === "object" && args !== null ? (args as Readonly<Record<string, unknown>>) : {};
  const s = (k: string): string => (typeof a[k] === "string" ? (a[k] as string) : "");
  const owner = s("owner") !== "" ? `${s("owner")}/${s("id")}` : s("id");
  const tasks = Array.isArray(a["tasks"]) ? `${a["tasks"].length} tasks` : "";
  return clip([owner, tasks, s("thread") !== "" ? `thread ${s("thread")}` : "", s("text"), s("title"), s("evidence")].filter((x) => x !== "").join(" · "), 160);
};

const counts = (tasks: readonly Task[]): PlanMilestone["tasks"] => ({
  todo: tasks.filter((t) => t.state === "todo").length, doing: tasks.filter((t) => t.state === "doing").length,
  blocked: tasks.filter((t) => t.state === "blocked").length, done: tasks.filter((t) => t.state === "done").length,
  dropped: tasks.filter((t) => t.state === "dropped").length,
});

const milestones = (ctx: Ctx, tasks: readonly Task[]): readonly PlanMilestone[] => {
  const plan = ctx.input.plan?.plan;
  if (!plan) return [];
  return [...plan.milestones].sort((a, b) => a.order - b.order).map((m) => {
    const named = new Set(m.concepts ?? []);
    const ids = ctx.input.book.evals.filter((e) => named.has(ctx.input.conceptOf.get(e.subject) ?? "")).map((e) => e.id);
    const concepts: Ref[] = (m.concepts ?? []).flatMap((id) => {
      const c = ctx.input.book.records.get(`concept:${id}`);
      return c ? [refOf(c)] : [];
    });
    const goal = plan.goal.exit;
    const repeatsGoal = m.exit.length > 0 && m.exit.every((e) => goal.some((g) => g.id === e.id && g.claim === e.claim));
    return {
      id: m.id, title: m.title, goal: m.goal, state: m.state, order: m.order, exit: m.exit.map(exitOf), concepts, repeatsGoal,
      evals: named.size === 0 ? null : { passing: passing(ctx.input.status, ids), total: ids.length },
      tasks: counts(tasks.filter((t) => t.milestone === m.id)),
    };
  });
};

const blockedOf = (ctx: Ctx, t: Task): PlanBlocked => {
  const b = t.blockedBy;
  const book = b && "decision" in b ? ctx.input.book.records.get(`decision:${b.decision}`) : undefined;
  const waits = book !== undefined && ctx.waiting.includes(book as AnyRecord);
  const decision = book ? questionOf(ctx, book) : null;
  return {
    task: taskOf(t), on: b && "decision" in b ? "decision" : "need", who: b && "need" in b ? b.who : "", need: b && "need" in b ? b.need : blockerLine(t),
    waitsOnOwner: waitsOnOwner(t, ctx.input.direction.settings.reviewer, (id) => ctx.waiting.some((d) => d.id === id)),
    decision, decisionRef: book ? (waits && decision ? decision.ref : refOf(book)) : null, decisionWaits: waits,
  };
};

/** How many tasks wait on the owner: the count beside Plan in the top bar. */
export const ownerWaits = (ctx: Ctx): number => {
  const plan = ctx.input.plan?.plan;
  if (!plan) return 0;
  const owner = ctx.input.direction.settings.reviewer;
  return plan.tasks.filter((t) => waitsOnOwner(t, owner, (id) => ctx.waiting.some((d) => d.id === id))).length;
};

const absent = (ctx: Ctx): PlanPage => ({
  ...head("plan", "Plan", SOURCE, null), type: "plan", commit: ctx.input.commit, present: false, owner: ctx.input.direction.settings.reviewer,
  note: null, goal: null, milestones: [], path: null, blocked: [], waitsOnOwner: 0, groups: [], log: [], problems: [],
});

export const plan = (ctx: Ctx): PlanPage => {
  const held = ctx.input.plan;
  if (!held) return absent(ctx);
  const p = held.plan;
  const byId = new Map(p.tasks.map((t) => [t.id, t] as const));
  const now = p.milestones.find((m) => m.state === "current");
  const log: readonly PlanLogRow[] = held.log.slice(-LOG_SHOWN).reverse().map((l) => ({ at: l.at, by: l.by, action: l.action, summary: summaryOf(l.args), commit: l.commit }));
  return {
    ...absent(ctx), present: true,
    note: p.notes[p.notes.length - 1] ?? null,
    goal: { title: p.goal.title, why: p.goal.why, exit: p.goal.exit.map(exitOf) },
    milestones: milestones(ctx, p.tasks),
    path: { milestone: now?.id ?? "", written: p.path.written, why: p.path.why, steps: p.path.tasks.flatMap((id) => { const t = byId.get(id); return t ? [taskOf(t)] : []; }) },
    blocked: p.tasks.filter((t) => t.state === "blocked").map((t) => blockedOf(ctx, t)), waitsOnOwner: ownerWaits(ctx),
    groups: STATES.map(([state, title]) => ({ state, title, tasks: p.tasks.filter((t) => t.state === state).map(taskOf) })),
    log, problems: held.problems.map((x) => ({ at: x.at, why: x.why })),
  };
};
