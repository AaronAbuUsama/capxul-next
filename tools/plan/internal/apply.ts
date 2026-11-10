/** One command applied to a plan: a new plan and a line for the log, or a refusal that says why. */
import type { Applied, Command, Ctx, ExitLine, Facts, Milestone, Plan, Result, Task, TaskFields } from "../types.ts";

const refuse = (error: string): Result<never> => ({ ok: false, error });
const done = (plan: Plan, command: Command, ctx: Ctx, message: string): Result<Applied> => {
  const { kind, ...args } = command;
  return { ok: true, value: { plan, message, entry: { at: ctx.at, by: ctx.by, action: kind, args, commit: ctx.commit } } };
};

const taskOf = (plan: Plan, id: string): Result<Task> => {
  const t = plan.tasks.find((x) => x.id === id);
  return t ? { ok: true, value: t } : refuse(`no task ${id}`);
};
const withTask = (plan: Plan, t: Task): Plan => ({ ...plan, tasks: plan.tasks.map((x) => (x.id === t.id ? t : x)) });
const strip = (t: Task, ...keys: ("thread" | "blockedBy" | "droppedWhy")[]): Task => {
  const copy: Record<string, unknown> = { ...t };
  for (const k of keys) delete copy[k];
  return copy as unknown as Task;
};

const missing = (what: string, ids: readonly string[], known: (id: string) => boolean): string | null => {
  const bad = ids.filter((id) => !known(id));
  return bad.length ? `${what} ${bad.join(", ")} ${bad.length === 1 ? "does" : "do"} not exist` : null;
};

const exitHolder = (plan: Plan, owner: string): { readonly lines: readonly ExitLine[]; readonly set: (lines: readonly ExitLine[]) => Plan } | null => {
  if (owner === "goal") return { lines: plan.goal.exit, set: (exit) => ({ ...plan, goal: { ...plan.goal, exit } }) };
  const m = plan.milestones.find((x) => x.id === owner);
  return m ? { lines: m.exit, set: (exit) => ({ ...plan, milestones: plan.milestones.map((x) => (x.id === owner ? { ...x, exit } : x)) }) } : null;
};

const editTask = (plan: Plan, t: Task, f: TaskFields, ctx: Ctx, facts: Facts): Result<Plan> => {
  const e =
    (f.milestone !== undefined && !plan.milestones.some((m) => m.id === f.milestone) ? `no milestone ${f.milestone}` : null) ??
    missing("task", f.needs ?? [], (id) => plan.tasks.some((x) => x.id === id) && id !== t.id) ??
    missing("record", f.records ?? [], (k) => facts.records.has(k));
  if (e) return refuse(e);
  const next: Task = {
    ...t, updated: ctx.date, ...(f.title !== undefined ? { title: f.title } : {}), ...(f.why !== undefined ? { why: f.why } : {}),
    ...(f.milestone !== undefined ? { milestone: f.milestone } : {}), ...(f.needs !== undefined ? { needs: f.needs } : {}),
    ...(f.records !== undefined ? { records: f.records } : {}), ...(f.thread !== undefined ? { thread: f.thread } : {}),
  };
  return { ok: true, value: withTask(plan, next) };
};

const becomeCurrent = (plan: Plan, id: string): Result<Plan> => {
  if (!plan.milestones.some((m) => m.id === id)) return refuse(`no milestone ${id}`);
  const settle = (m: Milestone): Milestone =>
    m.id === id ? { ...m, state: "current" } : m.state === "current" ? { ...m, state: m.exit.every((e) => e.state === "met") ? "done" : "todo" } : m;
  return { ok: true, value: { ...plan, milestones: plan.milestones.map(settle) } };
};

/** Applies `command`. It validates what the command itself says; `check` judges the whole plan against the book. */
export const apply = (plan: Plan, command: Command, ctx: Ctx, facts: Facts): Result<Applied> => {
  const c = command;
  switch (c.kind) {
    case "note":
      return c.text.trim() === "" ? refuse("a note says something") : done({ ...plan, notes: [...plan.notes, { date: ctx.date, by: ctx.by, text: c.text }] }, c, ctx, `note added, ${ctx.date}`);
    case "goal.set":
      return done({ ...plan, goal: { ...plan.goal, ...(c.title !== undefined ? { title: c.title } : {}), ...(c.why !== undefined ? { why: c.why } : {}) } }, c, ctx, "goal updated");
    case "exit.add": {
      const h = exitHolder(plan, c.owner);
      if (!h) return refuse(`no goal or milestone ${c.owner}`);
      if (h.lines.some((l) => l.id === c.id)) return refuse(`${c.owner} already has an exit line ${c.id}`);
      const line: ExitLine = { id: c.id, claim: c.claim, state: "open", ...(c.evals?.length ? { evals: c.evals } : {}) };
      const bad = missing("eval", c.evals ?? [], (id) => facts.evals.has(id));
      return bad ? refuse(bad) : done(h.set([...h.lines, line]), c, ctx, `${c.owner}/${c.id} added`);
    }
    case "exit.met": {
      const h = exitHolder(plan, c.owner);
      if (!h) return refuse(`no goal or milestone ${c.owner}`);
      if (!h.lines.some((l) => l.id === c.id)) return refuse(`${c.owner} has no exit line ${c.id}`);
      if (c.evidence.trim() === "") return refuse("a met exit line needs evidence");
      return done(h.set(h.lines.map((l) => (l.id === c.id ? { ...l, state: "met", evidence: c.evidence } : l))), c, ctx, `${c.owner}/${c.id} met`);
    }
    case "milestone.add": {
      if (plan.milestones.some((m) => m.id === c.id)) return refuse(`milestone ${c.id} exists`);
      const order = c.order ?? Math.max(0, ...plan.milestones.map((m) => m.order)) + 1;
      const m: Milestone = { id: c.id, title: c.title, goal: c.goal, exit: [], state: "todo", order, ...(c.concepts?.length ? { concepts: c.concepts } : {}) };
      const bad = missing("concept", c.concepts ?? [], (id) => facts.concepts.has(id));
      return bad ? refuse(bad) : done({ ...plan, milestones: [...plan.milestones, m].sort((a, b) => a.order - b.order) }, c, ctx, `milestone ${c.id} added`);
    }
    case "milestone.current": {
      const next = becomeCurrent(plan, c.id);
      return next.ok ? done(next.value, c, ctx, `${c.id} is the current milestone`) : next;
    }
    case "task.add": {
      if (plan.tasks.some((t) => t.id === c.id)) return refuse(`task ${c.id} exists`);
      if (!plan.milestones.some((m) => m.id === c.milestone)) return refuse(`no milestone ${c.milestone}`);
      const bad = missing("task", c.needs ?? [], (id) => plan.tasks.some((t) => t.id === id)) ?? missing("record", c.records ?? [], (k) => facts.records.has(k));
      if (bad) return refuse(bad);
      const t: Task = { id: c.id, title: c.title, why: c.why, milestone: c.milestone, state: "todo", needs: c.needs ?? [], records: c.records ?? [], evidence: [], created: ctx.date, updated: ctx.date };
      return done({ ...plan, tasks: [...plan.tasks, t] }, c, ctx, `task ${c.id} added to ${c.milestone}`);
    }
    case "task.edit": {
      const t = taskOf(plan, c.id);
      if (!t.ok) return t;
      const next = editTask(plan, t.value, c.fields, ctx, facts);
      return next.ok ? done(next.value, c, ctx, `task ${c.id} edited`) : next;
    }
    case "path.set": {
      const bad = missing("task", c.tasks, (id) => plan.tasks.some((t) => t.id === id));
      if (bad) return refuse(bad);
      if (c.why.trim() === "") return refuse("the path needs a why, in your words");
      return done({ ...plan, path: { tasks: c.tasks, why: c.why, written: ctx.date } }, c, ctx, `path set: ${c.tasks.length} tasks, ${ctx.date}`);
    }
    default:
      return moveTask(plan, c, ctx, facts);
  }
};

type Move = Extract<Command, { kind: "task.start" | "task.block" | "task.unblock" | "task.done" | "task.drop" }>;

/** The commands that move one task between states. */
const moveTask = (plan: Plan, c: Move, ctx: Ctx, facts: Facts): Result<Applied> => {
  const found = taskOf(plan, c.id);
  if (!found.ok) return found;
  const t = found.value;
  if ((t.state === "done" || t.state === "dropped") && c.kind !== "task.done") return refuse(`task ${c.id} is ${t.state}`);
  const put = (x: Task, message: string): Result<Applied> => done(withTask(plan, { ...x, updated: ctx.date }), c, ctx, message);
  switch (c.kind) {
    case "task.start":
      return c.thread.trim() === "" ? refuse("a task that is doing names its thread") : put({ ...strip(t, "blockedBy"), state: "doing", thread: c.thread }, `task ${c.id} is doing, on ${c.thread}`);
    case "task.block": {
      if ("decision" in c.blocker && !facts.decisions.has(c.blocker.decision)) return refuse(`the book holds no decision ${c.blocker.decision}`);
      if ("need" in c.blocker && (c.blocker.need.trim() === "" || c.blocker.who.trim() === "")) return refuse("a need names what is needed and who has it");
      return put({ ...t, state: "blocked", blockedBy: c.blocker }, `task ${c.id} is blocked`);
    }
    case "task.unblock":
      return t.state !== "blocked" ? refuse(`task ${c.id} is not blocked`) : put({ ...strip(t, "blockedBy"), state: t.thread ? "doing" : "todo" }, `task ${c.id} is no longer blocked`);
    case "task.done":
      return put({ ...strip(t, "blockedBy", "droppedWhy"), state: "done", evidence: c.evidence ? [...t.evidence, c.evidence] : t.evidence }, `task ${c.id} is done`);
    case "task.drop":
      return c.why.trim() === "" ? refuse("a dropped task says why") : put({ ...strip(t, "blockedBy"), state: "dropped", droppedWhy: c.why }, `task ${c.id} is dropped`);
  }
};
