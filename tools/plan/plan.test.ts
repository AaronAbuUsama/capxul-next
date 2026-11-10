import assert from "node:assert/strict";
import { test } from "node:test";

import { apply, check, parseArgs, parsePlan, show, waitsOnOwner } from "./service.ts";
import type { Command, Ctx, Facts, Plan } from "./types.ts";
import { EMPTY_PLAN } from "./types.ts";

const ctx: Ctx = { by: "coordinator", date: "2026-11-10", at: "2026-11-10T09:00:00.000Z", commit: "abc1234" };
const facts: Facts = {
  decisions: new Set(["d.one"]), records: new Set(["operation:a.b"]), evals: new Set(["ev:1"]), concepts: new Set(["access"]),
};

/** Runs commands in order, failing the test when one is refused. */
const run = (...commands: Command[]): Plan =>
  commands.reduce((plan, c) => {
    const r = apply(plan, c, ctx, facts);
    assert.ok(r.ok, r.ok ? "" : r.error);
    return r.value.plan;
  }, EMPTY_PLAN);

const base: Command[] = [
  { kind: "milestone.add", id: "m1", title: "One", goal: "g" },
  { kind: "milestone.add", id: "m2", title: "Two", goal: "g" },
  { kind: "milestone.current", id: "m1" },
  { kind: "task.add", id: "t1", title: "T1", why: "w", milestone: "m1" },
  { kind: "task.add", id: "t2", title: "T2", why: "w", milestone: "m1", needs: ["t1"] },
  { kind: "task.add", id: "t3", title: "T3", why: "w", milestone: "m2" },
];
const problemsOf = (plan: Plan): string[] => check(plan, facts).map((p) => `${p.at}: ${p.why}`);
const has = (plan: Plan, text: RegExp): boolean => problemsOf(plan).some((p) => text.test(p));
const edit = (plan: Plan, f: (p: Plan) => Plan): Plan => f(plan);

test("a sound plan has no problems", () => {
  const plan = run(...base, { kind: "path.set", tasks: ["t1", "t2"], why: "t1 first" });
  assert.deepEqual(problemsOf(plan), []);
});

test("commands refuse what they cannot do and write a log line when they can", () => {
  const plan = run(...base);
  assert.equal(apply(plan, { kind: "task.add", id: "t1", title: "x", why: "y", milestone: "m1" }, ctx, facts).ok, false);
  assert.equal(apply(plan, { kind: "task.add", id: "t9", title: "x", why: "y", milestone: "nope" }, ctx, facts).ok, false);
  assert.equal(apply(plan, { kind: "task.block", id: "t1", blocker: { decision: "d.none" } }, ctx, facts).ok, false);
  assert.equal(apply(plan, { kind: "task.start", id: "t1", thread: " " }, ctx, facts).ok, false);
  const done = apply(plan, { kind: "task.done", id: "t1", evidence: "abc" }, ctx, facts);
  assert.ok(done.ok);
  if (!done.ok) return;
  assert.deepEqual(done.value.entry, { at: ctx.at, by: "coordinator", action: "task.done", args: { id: "t1", evidence: "abc" }, commit: "abc1234" });
  assert.equal(apply(done.value.plan, { kind: "task.start", id: "t1", thread: "x" }, ctx, facts).ok, false, "a done task is not restarted");
});

test("ids are unique, milestones exist, needs are real and have no cycle", () => {
  const plan = run(...base);
  const dup = edit(plan, (p) => ({ ...p, tasks: [...p.tasks, { ...p.tasks[0]! }] }));
  assert.ok(has(dup, /t1: two tasks have this id/));
  assert.ok(has(edit(plan, (p) => ({ ...p, tasks: p.tasks.map((t) => (t.id === "t1" ? { ...t, milestone: "mx" } : t)) })), /t1: its milestone mx does not exist/));
  assert.ok(has(edit(plan, (p) => ({ ...p, tasks: p.tasks.map((t) => (t.id === "t1" ? { ...t, needs: ["zz"] } : t)) })), /t1: it needs zz/));
  assert.ok(has(edit(plan, (p) => ({ ...p, tasks: p.tasks.map((t) => (t.id === "t1" ? { ...t, needs: ["t2"] } : t)) })), /needs form a cycle: t1 → t2 → t1|needs form a cycle: t2 → t1 → t2/));
});

test("a doing task has a thread; a blocked task says what blocks it, and a decision it names exists", () => {
  const plan = run(...base);
  assert.ok(has(edit(plan, (p) => ({ ...p, tasks: p.tasks.map((t) => (t.id === "t1" ? { ...t, state: "doing" } : t)) })), /t1: it is doing, and names no thread/));
  assert.ok(has(edit(plan, (p) => ({ ...p, tasks: p.tasks.map((t) => (t.id === "t1" ? { ...t, state: "blocked" } : t)) })), /t1: it is blocked, and says what blocks it/));
  const gone = edit(plan, (p) => ({ ...p, tasks: p.tasks.map((t) => (t.id === "t1" ? { ...t, state: "blocked", blockedBy: { decision: "d.gone" } } : t)) }));
  assert.ok(has(gone, /t1: it is blocked on decision d\.gone, which the book does not hold/));
  assert.deepEqual(problemsOf(run(...base, { kind: "task.block", id: "t1", blocker: { decision: "d.one" } })), []);
  assert.deepEqual(problemsOf(run(...base, { kind: "task.block", id: "t1", blocker: { need: "a key", who: "Aaron" } })), []);
});

test("record keys, eval ids and concepts must resolve in the book", () => {
  const plan = run(...base);
  assert.ok(has(edit(plan, (p) => ({ ...p, tasks: p.tasks.map((t) => (t.id === "t1" ? { ...t, records: ["operation:no.such"] } : t)) })), /t1: it names record operation:no\.such/));
  assert.equal(apply(plan, { kind: "task.edit", id: "t1", fields: { records: ["operation:no.such"] } }, ctx, facts).ok, false);
  assert.ok(apply(plan, { kind: "task.edit", id: "t1", fields: { records: ["operation:a.b"] } }, ctx, facts).ok);
  const withExit = run(...base, { kind: "exit.add", owner: "m1", id: "x", claim: "c", evals: ["ev:1"] });
  assert.deepEqual(problemsOf(withExit), []);
  assert.ok(has(edit(withExit, (p) => ({ ...p, milestones: p.milestones.map((m) => ({ ...m, exit: m.exit.map((e) => ({ ...e, evals: ["ev:9"] })) })) })), /m1\/x: it names eval ev:9/));
  assert.ok(has(edit(plan, (p) => ({ ...p, milestones: p.milestones.map((m) => ({ ...m, concepts: ["nope"] })) })), /m1: it names concept nope/));
});

test("exactly one milestone is current", () => {
  const plan = run(...base);
  assert.ok(has(edit(plan, (p) => ({ ...p, milestones: p.milestones.map((m) => ({ ...m, state: "todo" })) })), /exactly one milestone is current; 0 are/));
  assert.ok(has(edit(plan, (p) => ({ ...p, milestones: p.milestones.map((m) => ({ ...m, state: "current" })) })), /exactly one milestone is current; 2 are/));
  const moved = run(...base, { kind: "exit.add", owner: "m1", id: "x", claim: "c" }, { kind: "milestone.current", id: "m2" });
  assert.deepEqual(moved.milestones.map((m) => m.state), ["todo", "current"], "the milestone left behind with an open exit goes back to todo");
  assert.deepEqual(run(...base, { kind: "milestone.current", id: "m2" }).milestones.map((m) => m.state), ["done", "current"], "one with every exit met (or none) is done");
});

test("the path: tasks exist, are not done or dropped, and belong to the current milestone or before; it is never reordered", () => {
  const ok = run(...base, { kind: "path.set", tasks: ["t2", "t1"], why: "t2 first, on purpose" });
  assert.deepEqual(ok.path.tasks, ["t2", "t1"], "the coordinator's order is kept, although t2 needs t1");
  assert.deepEqual(problemsOf(ok), []);
  assert.equal(apply(ok, { kind: "path.set", tasks: ["zz"], why: "x" }, ctx, facts).ok, false);
  const finished = run(...base, { kind: "path.set", tasks: ["t1", "t2"], why: "w" }, { kind: "task.done", id: "t1" });
  assert.ok(problemsOf(finished).some((p) => /path\/t1: it is on the path and is done/.test(p)));
  assert.deepEqual(finished.path.tasks, ["t1", "t2"], "check reports; it does not repair the path");
  const later = run(...base, { kind: "path.set", tasks: ["t1", "t3"], why: "w" });
  assert.ok(problemsOf(later).some((p) => /path\/t3: it belongs to m2, after the current milestone m1, and is not blocked/.test(p)));
  const asked = run(...base, { kind: "task.block", id: "t3", blocker: { need: "a login", who: "Aaron" } }, { kind: "path.set", tasks: ["t1", "t3"], why: "t3 is asked for early" });
  assert.deepEqual(problemsOf(asked), [], "a later task stands on the path while it is blocked");
});

test("a met exit line needs evidence", () => {
  const plan = run(...base, { kind: "exit.add", owner: "goal", id: "g1", claim: "c" });
  assert.equal(apply(plan, { kind: "exit.met", owner: "goal", id: "g1", evidence: " " }, ctx, facts).ok, false);
  assert.ok(has(edit(plan, (p) => ({ ...p, goal: { ...p.goal, exit: p.goal.exit.map((e) => ({ ...e, state: "met" as const })) } })), /goal\/g1: it is met, and gives no evidence/));
  assert.deepEqual(problemsOf(run(...base, { kind: "exit.add", owner: "goal", id: "g1", claim: "c" }, { kind: "exit.met", owner: "goal", id: "g1", evidence: "abc" })), []);
});

test("the plan round-trips through JSON and parsePlan; a malformed one is an error value", () => {
  const plan = run(...base, { kind: "note", text: "where things are" }, { kind: "path.set", tasks: ["t1"], why: "w" });
  const back = parsePlan(JSON.parse(JSON.stringify(plan)) as unknown);
  assert.ok(back.ok);
  if (back.ok) assert.deepEqual(back.value, plan);
  assert.equal(parsePlan({ goal: {}, path: {} }).ok, false);
  assert.equal(parsePlan(null).ok, false);
});

test("who waits on the owner: a need that is his, or a decision that waits for him", () => {
  const plan = run(...base, { kind: "task.block", id: "t1", blocker: { need: "n", who: "aaron" } }, { kind: "task.block", id: "t2", blocker: { decision: "d.one" } });
  const [t1, t2] = [plan.tasks[0]!, plan.tasks[1]!];
  assert.equal(waitsOnOwner(t1, "Aaron", () => false), true);
  assert.equal(waitsOnOwner(t2, "Aaron", (id) => id === "d.one"), true);
  assert.equal(waitsOnOwner(t2, "Aaron", () => false), false);
});

test("the command line parses into commands, and says what is missing", () => {
  const r = parseArgs(["task", "block", "t1", "--need", "a key", "--who", "Aaron", "--by", "door-clock"]);
  assert.ok(r.ok);
  if (r.ok) assert.deepEqual(r.value, { kind: "change", by: "door-clock", command: { kind: "task.block", id: "t1", blocker: { need: "a key", who: "Aaron" } } });
  assert.equal(parseArgs(["task", "block", "t1", "--need", "x"]).ok, false);
  assert.equal(parseArgs(["task", "add", "t1"]).ok, false);
  assert.deepEqual(parseArgs(["show", "--json"]), { ok: true, value: { kind: "show", json: true } });
  assert.deepEqual(parseArgs(["path", "set", "a", "b", "--why", "because"]), { ok: true, value: { kind: "change", by: "coordinator", command: { kind: "path.set", tasks: ["a", "b"], why: "because" } } });
  assert.equal(parseArgs(["nonsense"]).ok, false);
});

test("show prints the note, the path in its order and what is blocked", () => {
  const plan = run(...base, { kind: "note", text: "hello" }, { kind: "task.block", id: "t1", blocker: { need: "a key", who: "Aaron" } }, { kind: "path.set", tasks: ["t2", "t1"], why: "w" });
  const text = show(plan, []);
  assert.match(text, /Note, 2026-11-10 \(coordinator\): hello/);
  assert.ok(text.indexOf("1. t2") < text.indexOf("2. t1"));
  assert.match(text, /\[!\] t1 {2}T1 {2}<- Aaron: a key/);
});
