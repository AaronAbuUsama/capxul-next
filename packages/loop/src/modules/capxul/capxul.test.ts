import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import pair from "../../../../../loops/pair.ts";       // the real standard script, played here against a fake provider
import { git } from "../lanes/service.ts";
import { clean, DEFAULTS, lane, logs, merge, resume, showFull, start, status, stop, watch, work, type Ctx, type Opts } from "./service.ts";
import type { Exec } from "../evidence/service.ts";
import * as plan from "./internal/plan.ts";

const AGENTS = join(import.meta.dirname, "../../../../../.claude/agents");
const FAKE_PLAN = `import fs from "node:fs";
const a = process.argv.slice(2);
if (a[0] === "show" && a[1] === "--json") console.log(fs.readFileSync("plan.json", "utf8"));
else fs.appendFileSync("plan-calls.log", a.join(" ") + "\\n");
`;
const PLAN = { plan: { tasks: [
  { id: "t1", title: "First", why: "because", state: "todo", needs: [] },
  { id: "t2", title: "Second", why: "later", state: "todo", needs: ["t1"] },
  { id: "t3", title: "Third", why: "done already", state: "done", needs: [] },
], path: { tasks: ["t1", "t2", "t3"] } } };

/** A recorder that is not there: it writes the cast and the GIF the real one would, and a command named `leave` leaves a file behind. */
const recorder: Exec = async (file, args, o) => {
  const command = args[args.indexOf("-c") + 1] ?? "";
  if (file === "asciinema" && command.includes("leave")) writeFileSync(join(o.cwd, "stray.txt"), "left behind\n");
  writeFileSync(args.at(-1)!, file === "agg" ? "GIF89a" : `${JSON.stringify({ version: 2, command })}\n${JSON.stringify([0.1, "o", "ran\r\n"])}\n`);
  return { code: 0, out: "" };
};

const rig = () => {
  const dir = mkdtempSync(join(tmpdir(), "loop-capxul-"));
  const root = join(dir, "root"), origin = join(dir, "origin.git");
  mkdirSync(join(root, ".claude"), { recursive: true });
  mkdirSync(join(root, "tools"));
  cpSync(AGENTS, join(root, ".claude/agents"), { recursive: true });
  writeFileSync(join(root, "tools/plan.ts"), FAKE_PLAN);
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "rig", private: true, scripts: { plan: "node --experimental-strip-types --no-warnings tools/plan.ts" } }));
  writeFileSync(join(root, "plan.json"), JSON.stringify(PLAN));
  writeFileSync(join(root, "README.md"), "root\n");
  writeFileSync(join(root, ".gitignore"), "var/\nplan-calls.log\n");
  git(dir, "init", "--bare", "-q", origin);
  git(dir, "init", "-q", "-b", "integration/build", root);
  git(root, "config", "user.email", "t@t"); git(root, "config", "user.name", "t");
  git(root, "add", "-A"); git(root, "commit", "-q", "-m", "init");
  git(root, "remote", "add", "origin", origin);
  git(root, "push", "-q", "origin", "integration/build");
  const faux = fauxProvider();
  const models = createModels();
  models.setProvider(faux.provider);
  const lines: string[] = [];
  const ctx = (gates: { name: string; sh: string }[] = [{ name: "ok", sh: "true" }]): Ctx => ({ root, env: { PATH: process.env.PATH ?? "", HOME: dir }, now: () => new Date(), say: (l) => lines.push(l), models, gates, retry: { maxRetries: 0, baseDelayMs: 1, waitsMs: [5, 5] }, evidence: { tooling: { asciinema: "asciinema", agg: "agg", browser: null, ffmpeg: null }, exec: recorder } });
  const calls = (): string[] => (existsSync(join(root, "plan-calls.log")) ? readFileSync(join(root, "plan-calls.log"), "utf8").split("\n").filter(Boolean) : []);
  return { dir, root, origin, faux, ctx, calls, lines };
};

const opts: Opts = { ...DEFAULTS, model: "faux/faux-1", checkerModel: "faux/faux-1", rounds: 2 };
const handback = (note: string) => `\`\`\`json\n${JSON.stringify({ submit: { version: { kind: "commit", repo: "x", commit: "0" }, addresses: [], note }, pr: 0, handover: { done: ["made it"], left: [], decisions: [], where: [] }, ran: {} })}\n\`\`\``;
const check = (verdict: string, findings: unknown[] = []) => `\`\`\`json\n${JSON.stringify({ verdict, findings, fixed: [], ran: {}, verdicts: [] })}\n\`\`\``;
const makes = (file: string) => [fauxAssistantMessage(fauxToolCall("write", { path: file, content: "made\n" }), { stopReason: "toolUse" }), fauxAssistantMessage(handback("Changed: a file."))];

test("the plan: ready tasks wait for their needs; claim, block and done go through the plan's own commands", () => {
  const r = rig(), ctx = r.ctx();
  assert.deepEqual(plan.readyTasks(ctx), ["t1"]);                // t2 needs t1; t3 is done
  assert.deepEqual(plan.readyTasks(ctx, ["t2"]), []);
  assert.equal(plan.loadTask(ctx, "t1").title, "First");
  assert.throws(() => plan.loadTask(ctx, "nope"), /no task nope/);
  plan.claim(ctx, "t1", "run-1");
  plan.block(ctx, "t1", "needs a key");
  plan.finish(ctx, "t1", "abc123");
  assert.deepEqual(r.calls(), ["task start t1 --thread run-1 --by loop", "task block t1 --need needs a key --who coordinator --by loop", "task done t1 --evidence abc123 --by loop"]);
});

test("a pair run: the maker writes in its lane, the gates pass, the checker approves, the branch is pushed and the plan claimed", async () => {
  const r = rig();
  r.faux.setResponses([...makes("hello.txt"), fauxAssistantMessage(check("approve"))]);
  const info = await start(r.ctx(), "t1", opts, pair);
  assert.equal(info.status, "ready", JSON.stringify(info));
  const lane = join(r.root, "var", "runs", info.id, "lane");
  assert.equal(readFileSync(join(lane, "hello.txt"), "utf8"), "made\n");
  assert.match(git(r.root, "ls-remote", "origin", "lane/t1"), /refs\/heads\/lane\/t1/);
  assert.equal(git(r.root, "rev-parse", "integration/build"), git(r.origin, "rev-parse", "integration/build"));   // integration/build untouched
  assert.ok(info.tokens > 0);
  assert.equal(r.calls()[0], `task start t1 --thread ${info.id} --by loop`);
  assert.match(await status(r.ctx()), /ready/);
});

test("a failing gate goes back to the maker, and when the rounds run out the run is blocked and the plan task blocked with the reason", async () => {
  const r = rig();
  r.faux.setResponses([...makes("a.txt"), fauxAssistantMessage(check("approve")), ...makes("b.txt"), fauxAssistantMessage(check("approve"))]);
  const info = await start(r.ctx([{ name: "tests", sh: "echo nope; false" }]), "t1", opts, pair);
  assert.equal(info.status, "blocked");
  assert.match(info.reasons.join(" "), /gate:tests/);
  assert.match(r.calls().at(-1)!, /^task block t1 --need loop run .*gate:tests.* --who coordinator/);
});

test("a checker that asks for changes blocks the run after the last round; the checker cannot write", async () => {
  const r = rig();
  const finding = { check: "x", severity: "blocking", where: { path: "a.txt" }, text: "Seen: bad. Expected: good. Fix: do it." };
  const tryWrite = fauxAssistantMessage(fauxToolCall("write", { path: "evil.txt", content: "x" }), { stopReason: "toolUse" });
  r.faux.setResponses([...makes("a.txt"), tryWrite, fauxAssistantMessage(check("changes", [finding])), ...makes("b.txt"), fauxAssistantMessage(check("changes", [finding]))]);
  const info = await start(r.ctx(), "t1", opts, pair);
  assert.equal(info.status, "blocked");
  assert.match(info.reasons.join(" "), /Seen: bad/);
  assert.equal(existsSync(join(r.root, "var", "runs", info.id, "lane", "evil.txt")), false);
});

test("merge: refuses a run that is not ready, a failing gate and a checkout off the base; merges and pushes only when every gate passes", async () => {
  const r = rig();
  r.faux.setResponses([...makes("hello.txt"), fauxAssistantMessage(check("approve"))]);
  const info = await start(r.ctx(), "t1", opts, pair);
  assert.equal(info.status, "ready");
  const before = git(r.root, "rev-parse", "HEAD");

  assert.match((await merge(r.ctx([{ name: "tests", sh: "false" }]), info.id))[0]!, /refused: 1 of 1 gates fail/);
  assert.equal(git(r.root, "rev-parse", "HEAD"), before);

  git(r.root, "checkout", "-q", "-b", "elsewhere");
  assert.match((await merge(r.ctx(), info.id))[0]!, /not on integration\/build/);
  git(r.root, "checkout", "-q", "integration/build");

  writeFileSync(join(r.root, "README.md"), "dirty\n");
  assert.match((await merge(r.ctx(), info.id))[0]!, /uncommitted changes to tracked files outside plan\/ and var\/: README\.md$/);
  git(r.root, "checkout", "--", "README.md");

  // What the runner and a person leave lying around is not in the way: an untracked file, and a changed file under plan/.
  mkdirSync(join(r.root, "plan"));
  writeFileSync(join(r.root, "plan/log.jsonl"), "{}\n");
  git(r.root, "add", "plan/log.jsonl"); git(r.root, "commit", "-q", "-m", "a plan log");
  writeFileSync(join(r.root, "plan/log.jsonl"), "{}\n{}\n");
  writeFileSync(join(r.root, "notes-untracked.md"), "a person's notes\n");

  const out = await merge(r.ctx(), info.id);
  assert.match(out[0]!, /^merged lane\/t1 into integration\/build/);
  assert.equal(readFileSync(join(r.root, "hello.txt"), "utf8"), "made\n");
  assert.equal(git(r.root, "rev-parse", "HEAD"), git(r.origin, "rev-parse", "integration/build"));
  assert.match(r.calls().at(-1)!, /^task done t1 --evidence [0-9a-f]{40} --by loop/);
  assert.match((await merge(r.ctx(), info.id))[0]!, /is merged, not ready/);
  assert.equal(existsSync(join(r.root, "var", "runs", info.id, "lane")), false);   // the lane was cleaned
  assert.deepEqual(clean(r.ctx()), ["nothing to clean"]);
});

test("a run whose script crashed can be resumed, and the lane and plan claim are not made twice", async () => {
  const r = rig();
  const first = await start(r.ctx(), "t1", opts, async (job) => { await lane(job); throw new Error("boom"); });
  assert.equal(first.status, "failed");
  assert.equal(first.error, "boom");
  r.faux.setResponses([...makes("hello.txt"), fauxAssistantMessage(check("approve"))]);
  const again = await resume(r.ctx(), first.id, pair);
  assert.equal(again.id, first.id);
  assert.equal(r.calls().filter((c) => c.startsWith("task start")).length, 1);
});

test("a run that is not there is an error with its name, for every command that takes a run, and no folder is made", async () => {
  const r = rig(), ctx = r.ctx();
  assert.throws(() => stop(ctx, "nope"), /there is no run nope in .*var\/runs/);
  for (const ask of [() => resume(ctx, "nope"), () => merge(ctx, "nope"), () => logs(ctx, "nope", false), () => watch(ctx, "nope")]) await assert.rejects(async () => ask(), /there is no run nope/);
  assert.equal(existsSync(join(r.root, "var", "runs", "nope")), false);
});

test("a start that cannot go ahead claims nothing in the plan and makes no run; the worker says so once and goes on", async () => {
  const r = rig(), ctx = r.ctx();
  await assert.rejects(() => start(ctx, "t1", { ...opts, script: "no-such-script" }), /no script .*no-such-script\.ts/);
  git(r.root, "worktree", "add", "-q", "-b", "lane/t1", join(r.dir, "held"), "integration/build");   // another run holds the lane
  await assert.rejects(() => start(ctx, "t1", opts, pair), /cannot start a run on t1: lane\/t1 is checked out in .*held/);
  assert.deepEqual(r.calls(), []);                                           // the task was never marked started
  assert.equal(existsSync(join(r.root, "var", "runs")), false);              // and there is no run folder to explain later
  await work(ctx, { concurrency: 1, tasks: ["t1"], opts, wait: false, pause: 5 });
  assert.equal(r.lines.filter((l) => /^no script /.test(l)).length, 1);       // this rig has no loops/ folder: the worker's start cannot go ahead either
  assert.deepEqual(r.calls(), []);
});

const down = () => fauxAssistantMessage("", { stopReason: "error", errorMessage: "504 <!doctype html><!--openship-edge-upstream-down--><html>" });

test("a model that fails is waited for and the builder continues where it stood; the run goes on as if nothing happened", async () => {
  const r = rig();
  r.faux.setResponses([down(), down(), ...makes("hello.txt"), fauxAssistantMessage(check("approve"))]);
  const info = await start(r.ctx(), "t1", opts, pair);
  assert.equal(info.status, "ready", info.error);
  assert.equal(info.round, 1);
  assert.equal(readFileSync(join((info.extra.lane as { dir: string }).dir, "hello.txt"), "utf8"), "made\n");
});

test("a model that never answers fails the run with the gateway's words: no check runs, no reviewer reads an empty change, no round is spent", async () => {
  const r = rig();
  r.faux.setResponses([down(), down(), down(), fauxAssistantMessage(check("approve"))]);
  const info = await start(r.ctx(), "t1", opts, pair);
  assert.equal(info.status, "failed");
  assert.match(info.error ?? "", /^make\.1: the model did not answer \(model error\), after waiting for it 2 times\. The gateway answered 504: its upstream is down\.$/);
  assert.equal(info.round, 1);
  assert.equal(info.step, "make.1");                                          // it stopped at the builder: the gates and the reviewer never started
  assert.deepEqual(r.calls().filter((c) => c.startsWith("task block")), []);  // a failed run is resumed, not handed to a person as findings
  r.faux.setResponses([...makes("hello.txt"), fauxAssistantMessage(check("approve"))]);
  assert.equal((await resume(r.ctx(), info.id, pair)).status, "ready");       // the gateway is back: resume continues the same builder
});

test("the worker resumes a named task's run that was stopped or failed, once, instead of sitting idle", async () => {
  const r = rig(), ctx = r.ctx();
  mkdirSync(join(r.root, "loops"));
  writeFileSync(join(r.root, "loops/mini.ts"), `import { lane, ready } from ${JSON.stringify(join(import.meta.dirname, "../../index.ts"))};\nexport default async (job) => { await lane(job, { install: false }); await ready(job); };\n`);
  const first = await start(ctx, "t1", { ...opts, script: "mini" }, async () => { throw new Error("stopped"); });
  assert.equal(first.status, "stopped");
  await work(ctx, { concurrency: 1, tasks: ["t1"], opts: { ...opts, script: "mini" }, wait: false, pause: 5 });
  assert.ok(r.lines.includes(`resuming ${first.id}`));
  assert.equal(JSON.parse(readFileSync(join(r.root, "var", "runs", first.id, "status.json"), "utf8")).status, "ready");
  assert.equal(r.lines.filter((l) => l.startsWith("resuming")).length, 1);
});

test("clean frees the lane's branch name, so the next run of the task starts from the base; unmerged work is kept under the run's name", async () => {
  const r = rig(), ctx = r.ctx([{ name: "tests", sh: "false" }]);
  r.faux.setResponses([...makes("first.txt"), fauxAssistantMessage(check("approve")), ...makes("first.txt"), fauxAssistantMessage(check("approve"))]);
  const one = await start(ctx, "t1", opts, pair);
  assert.equal(one.status, "blocked");                                        // the gate fails both rounds: its work is not merged
  assert.match(clean(ctx, one.id)[0]!, new RegExp(`removed the lane of ${one.id}: its unmerged work is kept as the branch kept/${one.id}`));
  assert.equal(git(r.root, "branch", "--list", "lane/t1"), "");
  assert.notEqual(git(r.root, "branch", "--list", `kept/${one.id}`), "");
  r.faux.setResponses([...makes("second.txt"), fauxAssistantMessage(check("approve"))]);
  const two = await start(r.ctx(), "t1", opts, pair);
  assert.equal(two.status, "ready", two.error);
  const dir = (two.extra.lane as { dir: string }).dir;
  assert.equal(existsSync(join(dir, "second.txt")), true);
  assert.equal(existsSync(join(dir, "first.txt")), false);                    // a fresh lane from the base, not the old attempt
});

test("evidence: both agents record commands; claims are judged against what the loop recorded; the checker is told; what a reader leaves is undone", async () => {
  const r = rig();
  const record = (name: string, command: string) => fauxAssistantMessage(fauxToolCall("record_terminal", { name, command }), { stopReason: "toolUse" });
  const withEvidence = (block: string, evidence: unknown[]) => block.replace("```json\n{", `\`\`\`json\n{"evidence":${JSON.stringify(evidence)},`);
  r.faux.setResponses([
    record("it-runs", "node -v"), fauxAssistantMessage(withEvidence(handback("Made."), [{ capture: "it-runs", shows: "node answers" }, { capture: "made-up", shows: "nothing" }])),
    record("tried-it", "node leave.js"), record("no", "git commit -m x"), fauxAssistantMessage(withEvidence(check("approve"), [{ capture: "tried-it", shows: "it runs" }])),
  ]);
  const info = await start(r.ctx(), "t1", opts, pair);
  assert.equal(info.status, "ready", JSON.stringify(info));
  const full = (await showFull(r.ctx(), info.id))!;
  assert.deepEqual(full.captures.map((c) => [c.id, c.by, c.source, c.files.map((x) => x.type)]), [
    ["make.1.it-runs", "make.1", { command: "node -v", exit: 0 }, ["image/gif", "application/x-asciicast"]],
    ["reviewer.1.agent.tried-it", "reviewer.1.agent", { command: "node leave.js", exit: 0 }, ["image/gif", "application/x-asciicast"]],
  ]);
  const step = (name: string) => full.steps.find((x) => x.name === name)!;
  assert.deepEqual(step("make.1").evidence, [{ capture: "make.1.it-runs", shows: "node answers", ok: true }, { capture: "made-up", shows: "nothing", ok: false, why: "no capture named made-up was made in this run" }]);
  assert.deepEqual(step("reviewer.1.agent").evidence, [{ capture: "reviewer.1.agent.tried-it", shows: "it runs", ok: true }]);
  const reviewer = full.agents.find((a) => a.key === "reviewer.1.agent")!, said = JSON.stringify(reviewer.messages);
  assert.ok(reviewer.tools.includes("record_terminal"));
  assert.match(said, /terminal `make\.1\.it-runs`: the maker says it shows \\"node answers\\"\. The loop recorded: `node -v` ended with 0\./);
  assert.match(said, /THROWN OUT `made-up`: no capture named made-up was made in this run\./);
  assert.match(said, /Refused by the loop's policy: `git commit -m x` is not a command this agent may run/);   // a reader runs things on camera, but still changes nothing
  assert.equal(existsSync(join(r.root, "var", "runs", info.id, "lane", "stray.txt")), false);
  assert.ok(r.lines.includes("reviewer.1.agent left 1 change(s) in the lane; they are undone"), r.lines.join("\n"));
});
