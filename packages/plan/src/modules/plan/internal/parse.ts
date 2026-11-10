/** Reads `plan/plan.json` as data of the right shape, or says which part is not. It repairs nothing. */
import type { Blocker, ExitLine, Goal, Milestone, Note, Plan, Result, Task } from "../types.ts";

type Fields = Readonly<Record<string, unknown>>;
const isFields = (u: unknown): u is Fields => typeof u === "object" && u !== null && !Array.isArray(u);
const str = (u: unknown): string | null => (typeof u === "string" ? u : null);
const strs = (u: unknown): readonly string[] | null =>
  Array.isArray(u) && u.every((x) => typeof x === "string") ? (u as readonly string[]) : null;

const TASK_STATES = ["todo", "doing", "blocked", "done", "dropped"];
const MILESTONE_STATES = ["todo", "current", "done"];

const fail = (at: string, why: string): Result<never> => ({ ok: false, error: `${at}: ${why}` });

const exitOf = (at: string, u: unknown): Result<ExitLine> => {
  if (!isFields(u)) return fail(at, "an exit line is an object");
  const id = str(u["id"]), claim = str(u["claim"]);
  if (id === null || claim === null) return fail(at, "an exit line has an id and a claim");
  if (u["state"] !== "open" && u["state"] !== "met") return fail(`${at}/${id}`, "state is open or met");
  const evals = u["evals"] === undefined ? [] : strs(u["evals"]);
  if (evals === null) return fail(`${at}/${id}`, "evals is a list of eval ids");
  const evidence = str(u["evidence"]);
  return { ok: true, value: { id, claim, state: u["state"], ...(evidence !== null ? { evidence } : {}), ...(evals.length ? { evals } : {}) } };
};

const exitsOf = (at: string, u: unknown): Result<readonly ExitLine[]> => {
  if (!Array.isArray(u)) return fail(at, "exit is a list");
  const out: ExitLine[] = [];
  for (const x of u) {
    const r = exitOf(at, x);
    if (!r.ok) return r;
    out.push(r.value);
  }
  return { ok: true, value: out };
};

const blockerOf = (at: string, u: unknown): Result<Blocker | undefined> => {
  if (u === undefined) return { ok: true, value: undefined };
  if (!isFields(u)) return fail(at, "blockedBy is an object");
  if (typeof u["decision"] === "string") return { ok: true, value: { decision: u["decision"] } };
  if (typeof u["need"] === "string" && typeof u["who"] === "string") return { ok: true, value: { need: u["need"], who: u["who"] } };
  return fail(at, "blockedBy is { decision } or { need, who }");
};

const taskOf = (u: unknown, i: number): Result<Task> => {
  const at = `tasks[${i}]`;
  if (!isFields(u)) return fail(at, "a task is an object");
  const id = str(u["id"]), title = str(u["title"]), why = str(u["why"]), milestone = str(u["milestone"]);
  const created = str(u["created"]), updated = str(u["updated"]);
  const needs = strs(u["needs"]), records = strs(u["records"]), evidence = strs(u["evidence"]);
  const evals = u["evals"] === undefined ? [] : strs(u["evals"]);
  if (id === null || title === null || why === null || milestone === null || created === null || updated === null) {
    return fail(at, "a task has an id, title, why, milestone, created and updated");
  }
  if (needs === null || records === null || evidence === null || evals === null) return fail(id, "needs, records, evals and evidence are lists of strings");
  if (typeof u["state"] !== "string" || !TASK_STATES.includes(u["state"])) return fail(id, `state is one of ${TASK_STATES.join(", ")}`);
  const blocker = blockerOf(id, u["blockedBy"]);
  if (!blocker.ok) return blocker;
  const thread = str(u["thread"]), droppedWhy = str(u["droppedWhy"]);
  return {
    ok: true,
    value: {
      id, title, why, milestone, state: u["state"] as Task["state"], needs, records, evidence, created, updated,
      ...(evals.length > 0 ? { evals } : {}), ...(thread !== null ? { thread } : {}), ...(blocker.value ? { blockedBy: blocker.value } : {}), ...(droppedWhy !== null ? { droppedWhy } : {}),
    },
  };
};

const milestoneOf = (u: unknown, i: number): Result<Milestone> => {
  const at = `milestones[${i}]`;
  if (!isFields(u)) return fail(at, "a milestone is an object");
  const id = str(u["id"]), title = str(u["title"]), goal = str(u["goal"]);
  if (id === null || title === null || goal === null || typeof u["order"] !== "number") return fail(at, "a milestone has an id, title, goal and order");
  if (typeof u["state"] !== "string" || !MILESTONE_STATES.includes(u["state"])) return fail(id, `state is one of ${MILESTONE_STATES.join(", ")}`);
  const exit = exitsOf(id, u["exit"]);
  if (!exit.ok) return exit;
  const concepts = u["concepts"] === undefined ? undefined : strs(u["concepts"]);
  if (concepts === null) return fail(id, "concepts is a list of concept ids");
  return { ok: true, value: { id, title, goal, order: u["order"], state: u["state"] as Milestone["state"], exit: exit.value, ...(concepts ? { concepts } : {}) } };
};

const many = <T>(at: string, u: unknown, one: (x: unknown, i: number) => Result<T>): Result<readonly T[]> => {
  if (!Array.isArray(u)) return fail(at, "a list is expected");
  const out: T[] = [];
  for (const [i, x] of u.entries()) {
    const r = one(x, i);
    if (!r.ok) return r;
    out.push(r.value);
  }
  return { ok: true, value: out };
};

const noteOf = (u: unknown, i: number): Result<Note> => {
  const date = isFields(u) ? str(u["date"]) : null, by = isFields(u) ? str(u["by"]) : null, text = isFields(u) ? str(u["text"]) : null;
  return date === null || by === null || text === null ? fail(`notes[${i}]`, "a note has a date, by and text") : { ok: true, value: { date, by, text } };
};

/** The plan, if `u` has the shape of one. Whether it is consistent with the book is `check`'s question, not this one's. */
export const parsePlan = (u: unknown): Result<Plan> => {
  if (!isFields(u) || !isFields(u["goal"]) || !isFields(u["path"])) return fail("plan", "a plan has a goal and a path");
  const g = u["goal"], p = u["path"];
  const title = str(g["title"]), why = str(g["why"]);
  const exit = exitsOf("goal", g["exit"]);
  if (title === null || why === null) return fail("goal", "a goal has a title and a why");
  if (!exit.ok) return exit;
  const milestones = many("milestones", u["milestones"], milestoneOf);
  if (!milestones.ok) return milestones;
  const tasks = many("tasks", u["tasks"], taskOf);
  if (!tasks.ok) return tasks;
  const notes = many("notes", u["notes"], noteOf);
  if (!notes.ok) return notes;
  const ids = strs(p["tasks"]), pwhy = str(p["why"]), written = str(p["written"]);
  if (ids === null || pwhy === null || written === null) return fail("path", "a path has tasks, a why and the date it was written");
  const goal: Goal = { title, why, exit: exit.value };
  return { ok: true, value: { goal, milestones: milestones.value, tasks: tasks.value, path: { tasks: ids, why: pwhy, written }, notes: notes.value } };
};
