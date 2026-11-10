import assert from "node:assert/strict";
import { test } from "node:test";

import { apply, applyAnswer, appliedTargets, check, parseAnswerLines, parseArgs, parsePlan, show, showTask, unapplied, waitsOnOwner } from "./service.ts";
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
  { kind: "task.add", what: "What it is.", doneWhen: ["It is done."], id: "t1", title: "T1", why: "w", milestone: "m1" },
  { kind: "task.add", what: "What it is.", doneWhen: ["It is done."], id: "t2", title: "T2", why: "w", milestone: "m1", needs: ["t1"] },
  { kind: "task.add", what: "What it is.", doneWhen: ["It is done."], id: "t3", title: "T3", why: "w", milestone: "m2" },
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
  assert.equal(apply(plan, { kind: "task.add", what: "What it is.", doneWhen: ["It is done."], id: "t1", title: "x", why: "y", milestone: "m1" }, ctx, facts).ok, false);
  assert.equal(apply(plan, { kind: "task.add", what: "What it is.", doneWhen: ["It is done."], id: "t9", title: "x", why: "y", milestone: "nope" }, ctx, facts).ok, false);
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

test("answers: unapplied ones are listed, applying is a log line and never a rewrite, and an applied answer's decision must not still wait", () => {
  const text = [
    '{"type":"answer","id":"a-1","at":"t","target":{"kind":"decision","id":"d.one"},"answer":{"how":"accept"}}',
    '{"type":"answer","id":"a-2","at":"t","target":{"kind":"task","id":"t1"},"answer":{"how":"text","text":"sub.example.org"}}',
    '{"type":"withdraw","id":"w-1","at":"t","answer":"a-2"}',
    "garbage", '{"type":"answer","id":"a-3","at":"t","target":{"kind":"bogus","id":"x"},"answer":{"how":"accept"}}',
  ].join("\n");
  const lines = parseAnswerLines(text);
  assert.equal(lines.length, 3, "lines that are not answers are ignored, not repaired");
  assert.deepEqual(unapplied(lines, []).map((a) => a.id), ["a-1"], "a withdrawn answer is not listed");
  const entry = applyAnswer(lines, [], "a-1", "ruling in books/target/shared/rulings.ts", "coordinator", "2026-11-10T10:00:00Z", "abc");
  assert.ok(entry.ok);
  if (!entry.ok) return;
  assert.deepEqual(entry.value.args, { answer: "a-1", target: { kind: "decision", id: "d.one" }, evidence: "ruling in books/target/shared/rulings.ts" });
  assert.deepEqual(unapplied(lines, [entry.value]), [], "the log, not the answers file, says it is applied");
  assert.equal(applyAnswer(lines, [entry.value], "a-1", "x", "c", "t", "c").ok, false, "twice");
  assert.equal(applyAnswer(lines, [], "a-1", " ", "c", "t", "c").ok, false, "without evidence");
  assert.equal(applyAnswer(lines, [], "a-2", "x", "c", "t", "c").ok, false, "a withdrawn answer");
  const plan = run(...base);
  const still = check(plan, { ...facts, waiting: new Set(["d.one"]), applied: appliedTargets([entry.value]) }).map((p) => p.why);
  assert.ok(still.some((w) => /decision d\.one still waits in the book with no ruling/.test(w)));
  assert.deepEqual(check(plan, { ...facts, waiting: new Set(), applied: appliedTargets([entry.value]) }), []);
  assert.match(show(plan, [], unapplied(lines, [])), /^1 answers from Aaron to apply/);
  assert.deepEqual(parseArgs(["answers", "apply", "a-1", "--evidence", "e"]), { ok: true, value: { kind: "answers.apply", answer: "a-1", evidence: "e", by: "coordinator" } });
  assert.equal(parseArgs(["answers", "apply", "a-1"]).ok, false);
});

test("files: the plan needs an outline and a file for every milestone and task with What, Why and Done when, and no file of nothing", () => {
  const plan = run(...base);
  const good = { outline: "# The plan\n\n## Where we are going\nHere.\n", milestones: { m1: "## What it delivers\nx", m2: "## What it delivers\ny" },
    tasks: Object.fromEntries(plan.tasks.map((t) => [t.id, "## What\nw\n## Why\ny\n## Done when\n- d\n"])) };
  assert.deepEqual(check(plan, facts, good), []);
  const why = (files: Parameters<typeof check>[2]): string[] => check(plan, facts, files).map((p) => `${p.at}: ${p.why}`);
  assert.ok(why({ ...good, outline: null }).some((p) => /plan\/outline\.md: the plan has no outline/.test(p)));
  assert.ok(why({ ...good, milestones: { m1: "x" } }).some((p) => /m2: it has no file plan\/milestones\/m2\.md/.test(p)));
  assert.ok(why({ ...good, tasks: { ...good.tasks, t1: undefined as unknown as string } }).some((p) => /t1: it has no file plan\/tasks\/t1\.md/.test(p)));
  assert.ok(why({ ...good, tasks: { ...good.tasks, t1: "## What\nw\n## Why\ny\n" } }).some((p) => /t1: its file has no "Done when" section/.test(p)));
  assert.ok(why({ ...good, tasks: { ...good.tasks, t1: "## What\n\n## Why\ny\n## Done when\n- d" } }).some((p) => /t1: its file has no "What" section, or it is empty/.test(p)));
  assert.ok(why({ ...good, tasks: { ...good.tasks, ghost: "## What\nw" } }).some((p) => /plan\/tasks\/ghost\.md: it is the file of no task/.test(p)));
  assert.ok(why({ ...good, milestones: { ...good.milestones, mx: "x" } }).some((p) => /plan\/milestones\/mx\.md: it is the file of no milestone/.test(p)));
});

test("task add makes the task's file from a stub and refuses to finish without what, why and done when", () => {
  const plan = run(...base);
  const add = (c: Partial<Extract<Command, { kind: "task.add" }>>): ReturnType<typeof apply> =>
    apply(plan, { kind: "task.add", id: "t9", title: "T9", why: "Because.", milestone: "m1", ...c }, ctx, facts);
  assert.equal(add({}).ok, false, "nothing but a why");
  assert.equal(add({ what: "A thing." }).ok, false, "no done when");
  assert.equal(add({ doneWhen: ["It is done."] }).ok, false, "no what");
  const r = add({ what: "A thing.", doneWhen: ["It is done.", "Also this."] });
  assert.ok(r.ok);
  if (r.ok) assert.deepEqual(r.value.writes, [{ path: "plan/tasks/t9.md", content: "## What\nA thing.\n## Why\nBecause.\n## Done when\n- It is done.\n- Also this.\n" }]);
  const whole = add({ detail: "## What\nw\n## Why\ny\n## Done when\n- d\n", detailFile: "x.md" });
  assert.ok(whole.ok);
  if (whole.ok) assert.equal(JSON.stringify(whole.value.entry.args).includes("## What"), false, "the log holds no file text");
  assert.equal(add({ detail: "## What\nw\n" }).ok, false, "a whole file must have all three sections");
  assert.deepEqual(parseArgs(["task", "add", "t9", "--title", "T", "--why", "w", "--milestone", "m1", "--what", "x", "--done-when", "a", "--done-when", "b"]),
    { ok: true, value: { kind: "change", by: "coordinator", command: { kind: "task.add", id: "t9", title: "T", why: "w", milestone: "m1", what: "x", doneWhen: ["a", "b"] } } });
});

test("answers: a change to a decision, or a need set after the answer, is not an applied answer to a question that must close", () => {
  const lines = parseAnswerLines([
    '{"type":"answer","id":"a-1","at":"2026-11-10T10:00:00Z","target":{"kind":"decision","id":"d.one"},"answer":{"how":"change","text":"look deeper"}}',
    '{"type":"answer","id":"a-2","at":"2026-11-10T10:00:00Z","target":{"kind":"task","id":"t1"},"answer":{"how":"done"}}',
    '{"type":"answer","id":"a-3","at":"2026-11-10T10:00:00Z","target":{"kind":"decision","id":"d.two"},"answer":{"how":"accept"}}',
  ].join("\n"));
  const log = [
    { at: "2026-11-10T11:00:00Z", by: "c", action: "task.block", args: { id: "t1", blocker: { need: "n", who: "Aaron" } }, commit: "x" },
    ...["a-1", "a-2", "a-3"].map((answer, i) => ({ at: "2026-11-10T12:00:00Z", by: "c", action: "answers.apply", args: { answer, target: { kind: i === 1 ? "task" : "decision", id: ["d.one", "t1", "d.two"][i] }, evidence: "e" }, commit: "x" })),
  ] as never;
  assert.equal(appliedTargets(log).length, 3, "without the answers file every apply counts");
  assert.deepEqual(appliedTargets(log, lines).map((t) => t.id), ["d.two"]);
});

test("a task names the evals that say it is done; an unknown one is refused, and `show` counts the ones that pass", () => {
  const plan = run(...base);
  const edit = (evals: string[]) => apply(plan, { kind: "task.edit", id: "t1", fields: { evals } }, ctx, facts);
  const refused = edit(["ev:9"]);
  assert.ok(!refused.ok && /eval ev:9 does not exist/.test(refused.error));
  const named = edit(["ev:1"]);
  assert.ok(named.ok);
  if (!named.ok) return;
  const withEvals = named.value.plan;
  assert.deepEqual(withEvals.tasks.find((t) => t.id === "t1")?.evals, ["ev:1"]);
  assert.deepEqual(parseArgs(["task", "edit", "t1", "--evals", "ev:1,ev:2"]), { ok: true, value: { kind: "change", by: "coordinator", command: { kind: "task.edit", id: "t1", fields: { evals: ["ev:1", "ev:2"] } } } });
  assert.ok(has({ ...withEvals, tasks: withEvals.tasks.map((t) => (t.id === "t1" ? { ...t, evals: ["ev:7"] } : t)) }, /t1: it names eval ev:7/));
  const text = (status: Parameters<typeof showTask>[4]) => showTask(withEvals, "t1", null, [], status);
  assert.match(text(null), /evals: 0 of 1 pass; not yet: ev:1 \(not run\)/);
  assert.match(text({ evals: { "ev:1": { verdict: "fail" } } }), /evals: 0 of 1 pass; not yet: ev:1 \(fail\)/);
  assert.match(text({ evals: { "ev:1": { verdict: "pass" } } }), /evals: 1 of 1 pass$/m);
  assert.equal(parsePlan(JSON.parse(JSON.stringify(withEvals))).ok, true, "the plan round-trips with the field");
});
