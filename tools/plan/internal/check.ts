/** The checks that keep the plan honest against the book. They report; they never reorder or rewrite the plan. */
import type { ExitLine, Facts, Plan, PlanFiles, Problem } from "../types.ts";
import { sectionBody } from "./markdown.ts";

const dups = (ids: readonly string[]): readonly string[] => [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))];

const exits = (plan: Plan): readonly { readonly owner: string; readonly line: ExitLine }[] => [
  ...plan.goal.exit.map((line) => ({ owner: "goal", line })),
  ...plan.milestones.flatMap((m) => m.exit.map((line) => ({ owner: m.id, line }))),
];

/** The first cycle in `needs`, as task ids, or null. */
const cycleOf = (plan: Plan): readonly string[] | null => {
  const needs = new Map(plan.tasks.map((t) => [t.id, t.needs] as const));
  const state = new Map<string, 1 | 2>();
  const stack: string[] = [];
  const visit = (id: string): readonly string[] | null => {
    if (state.get(id) === 2) return null;
    if (state.get(id) === 1) return [...stack.slice(stack.indexOf(id)), id];
    state.set(id, 1);
    stack.push(id);
    for (const n of needs.get(id) ?? []) {
      if (!needs.has(n)) continue;
      const found = visit(n);
      if (found) return found;
    }
    stack.pop();
    state.set(id, 2);
    return null;
  };
  for (const id of needs.keys()) {
    const found = visit(id);
    if (found) return found;
  }
  return null;
};

/** A task's file must say what the task is, why it is there and when it is done. */
const TASK_SECTIONS = ["What", "Why", "Done when"] as const;

/** The explanation files: an outline, a file for every milestone and task, and no file for anything else. */
const fileProblems = (plan: Plan, files: PlanFiles): readonly Problem[] => {
  const out: Problem[] = [];
  if (files.outline === null || files.outline.trim() === "") out.push({ at: "plan/outline.md", why: "the plan has no outline" });
  for (const m of plan.milestones) if ((files.milestones[m.id] ?? "").trim() === "") out.push({ at: m.id, why: `it has no file plan/milestones/${m.id}.md` });
  for (const t of plan.tasks) {
    const text = files.tasks[t.id];
    if ((text ?? "").trim() === "") { out.push({ at: t.id, why: `it has no file plan/tasks/${t.id}.md` }); continue; }
    for (const h of TASK_SECTIONS) if (sectionBody(text ?? "", h) === "") out.push({ at: t.id, why: `its file has no "${h}" section, or it is empty` });
  }
  for (const id of Object.keys(files.milestones)) if (!plan.milestones.some((m) => m.id === id)) out.push({ at: `plan/milestones/${id}.md`, why: "it is the file of no milestone" });
  for (const id of Object.keys(files.tasks)) if (!plan.tasks.some((t) => t.id === id)) out.push({ at: `plan/tasks/${id}.md`, why: "it is the file of no task" });
  return out;
};

export const check = (plan: Plan, facts: Facts, files?: PlanFiles): readonly Problem[] => {
  const out: Problem[] = files ? [...fileProblems(plan, files)] : [];
  const bad = (at: string, why: string): void => { out.push({ at, why }); };
  const taskIds = new Set(plan.tasks.map((t) => t.id));
  const byId = new Map(plan.tasks.map((t) => [t.id, t] as const));
  const milestones = new Map(plan.milestones.map((m) => [m.id, m] as const));

  for (const id of dups(plan.tasks.map((t) => t.id))) bad(id, "two tasks have this id");
  for (const id of dups(plan.milestones.map((m) => m.id))) bad(id, "two milestones have this id");
  for (const id of dups(plan.milestones.map((m) => String(m.order)))) bad(`order ${id}`, "two milestones have this order");
  for (const [owner, ids] of [["goal", plan.goal.exit.map((e) => e.id)] as const, ...plan.milestones.map((m) => [m.id, m.exit.map((e) => e.id)] as const)]) {
    for (const id of dups(ids)) bad(`${owner}/${id}`, "two exit lines have this id");
  }

  for (const t of plan.tasks) {
    if (!milestones.has(t.milestone)) bad(t.id, `its milestone ${t.milestone} does not exist`);
    for (const n of t.needs) if (!taskIds.has(n)) bad(t.id, `it needs ${n}, which is no task`);
    if (t.needs.includes(t.id)) bad(t.id, "it needs itself");
    if (t.state === "doing" && (t.thread ?? "") === "") bad(t.id, "it is doing, and names no thread");
    if (t.state === "blocked") {
      const b = t.blockedBy;
      if (!b) bad(t.id, "it is blocked, and says what blocks it");
      else if ("decision" in b) {
        if (!facts.decisions.has(b.decision)) bad(t.id, `it is blocked on decision ${b.decision}, which the book does not hold`);
      } else if (b.need.trim() === "" || b.who.trim() === "") bad(t.id, "its blocker names no need or no one");
    }
    for (const key of t.records) if (!facts.records.has(key)) bad(t.id, `it names record ${key}, which the book does not hold`);
    if (t.state === "dropped" && (t.droppedWhy ?? "").trim() === "") bad(t.id, "it is dropped, and says no why");
  }
  const cycle = cycleOf(plan);
  if (cycle) bad(cycle[0] ?? "needs", `needs form a cycle: ${cycle.join(" → ")}`);

  for (const { owner, line } of exits(plan)) {
    const at = `${owner}/${line.id}`;
    if (line.state === "met" && (line.evidence ?? "").trim() === "") bad(at, "it is met, and gives no evidence");
    for (const id of line.evals ?? []) if (!facts.evals.has(id)) bad(at, `it names eval ${id}, which the book does not derive`);
  }
  for (const m of plan.milestones) for (const c of m.concepts ?? []) if (!facts.concepts.has(c)) bad(m.id, `it names concept ${c}, which the book does not hold`);

  const current = plan.milestones.filter((m) => m.state === "current");
  if (current.length !== 1) bad("milestones", `exactly one milestone is current; ${current.length} are`);
  const now = current[0];
  for (const id of dups(plan.path.tasks)) bad(`path/${id}`, "it is on the path twice");
  for (const id of plan.path.tasks) {
    const t = byId.get(id);
    if (!t) { bad(`path/${id}`, "it is on the path and is no task"); continue; }
    if (t.state === "done" || t.state === "dropped") bad(`path/${id}`, `it is on the path and is ${t.state}`);
    const m = milestones.get(t.milestone);
    // A task of a later milestone may stand on the path only while it is blocked: the coordinator asks for it early.
    if (m && now && m.order > now.order && t.state !== "blocked") {
      bad(`path/${id}`, `it belongs to ${m.id}, after the current milestone ${now.id}, and is not blocked`);
    }
  }
  for (const t of facts.applied ?? []) {
    if (t.kind === "decision" && (facts.waiting ?? new Set<string>()).has(t.id)) bad(`answer/${t.id}`, `an answer was applied, and decision ${t.id} still waits in the book with no ruling`);
    if (t.kind === "task" && byId.get(t.id)?.state === "blocked") bad(`answer/${t.id}`, `an answer was applied, and task ${t.id} is still blocked`);
  }
  if (plan.path.tasks.length > 0 && plan.path.why.trim() === "") bad("path", "the path has no why");
  if (plan.path.tasks.length > 0 && plan.path.written.trim() === "") bad("path", "the path has no date");
  return out;
};
