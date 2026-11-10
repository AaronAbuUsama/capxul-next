/**
 * The Plan page and what it is made of: the coordinator's plan (plan/plan.json) and its explanation (plan/outline.md,
 * plan/milestones, plan/tasks) laid beside the blueprint. It adds nothing of its own to the plan.
 */
import { passing } from "@capxul/blueprint-engine";

import { blockerLine, bulletsOf, sectionBody, sectionsOf, sentences, waitsOnOwner } from "@capxul/plan";
import type { ExitLine, LogEntry, Milestone, Task, TaskState } from "@capxul/plan";
import type { PlanBlocked, PlanExit, PlanLogRow, PlanMilestone, PlanPage, PlanSection, PlanStep, PlanTask, Ref } from "../types.ts";
import { head, type Ctx } from "./context.ts";
import { refOf } from "./locate.ts";
import { inbox } from "./questions.ts";

const SOURCE = "plan/plan.json, plan/outline.md, plan/milestones, plan/tasks and plan/log.jsonl";
const STATES: readonly (readonly [TaskState, string])[] = [["doing", "Doing"], ["blocked", "Blocked"], ["todo", "To do"], ["done", "Done"], ["dropped", "Dropped"]];
/** How many lines of the log the Plan page shows. */
export const LOG_SHOWN = 20;

export const taskRef = (id: string, label = id): Ref => ({ label, page: `plan/task/${id}`, anchor: "" });
export const milestoneRef = (id: string, label = id): Ref => ({ label, page: `plan/milestone/${id}`, anchor: "" });

/** The eval ids a plan names, as links to the page of their kind. */
const evalRef = (id: string): Ref => ({ label: id, page: `eval/${id.includes(":") ? id.slice(0, id.indexOf(":")) : "eval"}`, anchor: "" });

const exitOf = (e: ExitLine): PlanExit => ({ id: e.id, claim: e.claim, met: e.state === "met", evidence: e.evidence ?? "", evals: (e.evals ?? []).map(evalRef) });

export const fileOf = (ctx: Ctx, id: string): string => ctx.input.plan?.files.tasks[id] ?? "";
export const sections = (md: string): readonly PlanSection[] => sectionsOf(md).filter((s) => s.body !== "");

export const taskOf = (ctx: Ctx, t: Task): PlanTask => ({
  id: t.id, title: t.title, why: t.why, milestone: t.milestone, state: t.state, thread: t.thread ?? "", needs: t.needs,
  evidence: t.evidence, updated: t.updated, droppedWhy: t.droppedWhy ?? "",
  what: sentences(sectionBody(fileOf(ctx, t.id), "What"), 1), ref: taskRef(t.id, t.title),
});

/** The first sentence of a milestone's "What it delivers" (its goal when the file says nothing). */
const delivers = (ctx: Ctx, m: Milestone): string => sentences(sectionBody(ctx.input.plan?.files.milestones[m.id] ?? "", "What it delivers"), 1) || m.goal;

export const milestoneOf = (ctx: Ctx, m: Milestone): PlanMilestone => {
  const p = ctx.input.plan?.plan;
  const named = new Set(m.concepts ?? []);
  const ids = ctx.input.blueprint.evals.filter((e) => named.has(ctx.input.conceptOf.get(e.subject) ?? "")).map((e) => e.id);
  const mine = (p?.tasks ?? []).filter((t) => t.milestone === m.id);
  const goal = p?.goal.exit ?? [];
  return {
    id: m.id, title: m.title, goal: m.goal, state: m.state, order: m.order, ref: milestoneRef(m.id, m.title), delivers: delivers(ctx, m),
    tasksTotal: mine.filter((t) => t.state !== "dropped").length, tasksDone: mine.filter((t) => t.state === "done").length,
    exit: m.exit.map(exitOf), repeatsGoal: m.exit.length > 0 && m.exit.every((e) => goal.some((g) => g.id === e.id && g.claim === e.claim)),
    concepts: (m.concepts ?? []).flatMap((id) => { const c = ctx.input.blueprint.records.get(`concept:${id}`); return c ? [refOf(c)] : []; }),
    evals: named.size === 0 ? null : { passing: passing(ctx.input.status, ids), total: ids.length },
    sections: sections(ctx.input.plan?.files.milestones[m.id] ?? ""), tasks: mine.map((t) => taskOf(ctx, t)),
  };
};

const clip = (s: string, n: number): string => (s.length <= n ? s : `${s.slice(0, n - 1)}…`);
/** What a log line was about, in a few words: the task, the exit line, or the start of the text. */
const summaryOf = (args: unknown): string => {
  const a = typeof args === "object" && args !== null ? (args as Readonly<Record<string, unknown>>) : {};
  const s = (k: string): string => (typeof a[k] === "string" ? (a[k] as string) : "");
  const owner = s("owner") !== "" ? `${s("owner")}/${s("id")}` : s("id");
  return clip([owner, Array.isArray(a["tasks"]) ? `${a["tasks"].length} tasks` : "", s("thread") !== "" ? `thread ${s("thread")}` : "", s("text"), s("title"), s("evidence")].filter((x) => x !== "").join(" · "), 160);
};
export const rowOf = (l: LogEntry): PlanLogRow => ({ at: l.at, by: l.by, action: l.action, summary: summaryOf(l.args), commit: l.commit });

const blockedOf = (ctx: Ctx, t: Task): PlanBlocked => {
  const b = t.blockedBy;
  const blueprint = b && "decision" in b ? ctx.input.blueprint.records.get(`decision:${b.decision}`) : undefined;
  const waits = waitsOnOwner(t, ctx.input.direction.settings.reviewer, (id) => ctx.waiting.some((d) => d.id === id));
  const decision = b && "decision" in b ? b.decision : "";
  return {
    task: taskOf(ctx, t), on: b && "decision" in b ? "decision" : "need", who: b && "need" in b ? b.who : "", need: b && "need" in b ? b.need : blockerLine(t),
    waitsOnOwner: waits, decisionRef: blueprint ? refOf(blueprint) : null,
    // a need is its own entry on the Questions page; a task blocked on a waiting decision points at the decision's entry
    inbox: !waits ? null : b && "need" in b ? { label: t.id, page: "review", anchor: `q-task-${t.id}` } : { label: t.id, page: "review", anchor: `q-${decision}` },
  };
};
export { blockedOf };

/** How many tasks wait on the owner (the Plan page's own count of its blocked tasks). */
export const ownerWaits = (ctx: Ctx): number => {
  const p = ctx.input.plan?.plan;
  return p ? p.tasks.filter((t) => waitsOnOwner(t, ctx.input.direction.settings.reviewer, (id) => ctx.waiting.some((d) => d.id === id))).length : 0;
};

/** The two sentences the Overview gives of the goal: the opening of each numbered part of "What this goal is". */
export const goalSummary = (outline: string | null): string => {
  const body = sectionBody(outline ?? "", "What this goal is");
  const parts = bulletsOf(body).map((b) => sentences(b.replace(/\*\*/g, ""), 1)).slice(0, 2);
  return parts.length > 0 ? parts.join(" ") : sentences(body, 2);
};

const absent = (ctx: Ctx): PlanPage => ({
  ...head("plan", "Plan", SOURCE, null), type: "plan", commit: ctx.input.commit, present: false, owner: ctx.input.direction.settings.reviewer, outline: [],
  note: null, goal: null, milestones: [], path: null, blocked: [], waitsOnOwner: 0, inbox: inbox(ctx).length, groups: [], log: [], problems: [],
});

const stepOf = (ctx: Ctx, n: number, t: Task): PlanStep => {
  const file = fileOf(ctx, t.id);
  return { n, task: taskOf(ctx, t), what: sentences(sectionBody(file, "What"), 2), doneWhen: bulletsOf(sectionBody(file, "Done when")) };
};

export const plan = (ctx: Ctx): PlanPage => {
  const held = ctx.input.plan;
  if (!held) return absent(ctx);
  const p = held.plan;
  const byId = new Map(p.tasks.map((t) => [t.id, t] as const));
  const now = p.milestones.find((m) => m.state === "current");
  return {
    ...absent(ctx), present: true, outline: sections(held.files.outline ?? ""),
    note: p.notes[p.notes.length - 1] ?? null,
    goal: { title: p.goal.title, why: p.goal.why, exit: p.goal.exit.map(exitOf) },
    milestones: [...p.milestones].sort((a, b) => a.order - b.order).map((m) => milestoneOf(ctx, m)),
    path: { milestone: now?.id ?? "", written: p.path.written, why: p.path.why, steps: p.path.tasks.flatMap((id, i) => { const t = byId.get(id); return t ? [stepOf(ctx, i + 1, t)] : []; }) },
    blocked: p.tasks.filter((t) => t.state === "blocked").map((t) => blockedOf(ctx, t)), waitsOnOwner: ownerWaits(ctx),
    groups: STATES.map(([state, title]) => ({ state, title, tasks: p.tasks.filter((t) => t.state === state).map((t) => taskOf(ctx, t)) })),
    log: held.log.slice(-LOG_SHOWN).reverse().map(rowOf), problems: held.problems.map((x) => ({ at: x.at, why: x.why })),
  };
};
