import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import pair from "../../../../../loops/pair.ts";       // the real standard script, played here against a fake provider
import { git } from "../lanes/service.ts";
import { refuseBash, refusePath } from "../agents/service.ts";
import { clean, DEFAULTS, gatesOf, lane, logs, merge, POLICY, resume, start, status, stop, watch, work, type Ctx, type Opts } from "./service.ts";
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
  const ctx = (gates: { name: string; sh: string }[] = [{ name: "ok", sh: "true" }]): Ctx => ({ root, env: { PATH: process.env.PATH ?? "", HOME: dir }, now: () => new Date(), say: (l) => lines.push(l), models, gates, retry: { maxRetries: 0, baseDelayMs: 1, waitsMs: [5, 5] } });
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
  assert.match(status(r.ctx()), /ready/);
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

test("the gates are the root scripts, whichever name the design folder has; the frozen baseline is protected under both names", () => {
  const dir = mkdtempSync(join(tmpdir(), "loop-gates-"));
  writeFileSync(join(dir, "package.json"), JSON.stringify({ scripts: { book: "x", frozen: "x" } }));
  assert.deepEqual(gatesOf(dir).map((g) => g.sh).slice(1), ["pnpm exec tsc -p books", "pnpm book", "pnpm frozen"]);
  mkdirSync(join(dir, "blueprint"));
  writeFileSync(join(dir, "package.json"), JSON.stringify({ scripts: { blueprint: "x", frozen: "x" } }));
  assert.deepEqual(gatesOf(dir).map((g) => g.sh).slice(1), ["pnpm exec tsc -p blueprint", "pnpm blueprint", "pnpm frozen"]);
  assert.ok(gatesOf(dir).every((g) => !/tools\/|\.ts\b/.test(g.sh)), "no gate names a file of the repository");
  for (const path of ["books/frozen/a.ts", "blueprint/baseline/a.ts"]) assert.match(refusePath(path, "/w", true, POLICY.denyWrite) ?? "", /may not be written/);
  assert.equal(refusePath("blueprint/target/a.ts", "/w", true, POLICY.denyWrite), undefined);
  assert.ok(POLICY.bash.write.some((r) => r.test("pnpm blueprint")) && POLICY.bash.write.some((r) => r.test("pnpm frozen")));
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

test("the command policy: what the agents were refused on 10 November and only reads is allowed; what runs or removes is still refused", () => {
  const w = (cmd: string) => refuseBash(cmd, "/lane", POLICY.bash.write), r = (cmd: string) => refuseBash(cmd, "/lane", POLICY.bash.read);
  // a pattern with | and a message of several lines are one command each (they were cut inside the quotes before)
  for (const cmd of [
    "grep -n -E 'dev_time|dev_snapshot' books/target/devnet/operations.ts",
    "git commit -m 'lane/t: one surface' -m 'Task: t\nRound: 1'",
    "node -e 'const fs = require(\"fs\"); console.log(fs.readdirSync(\"books\").length)'",
    "rm resolve-dev-commands.cjs finish-dev-commands.cjs", "pnpm layout", "pnpm -s frozen", "pnpm evals:check",
  ]) assert.equal(w(cmd), undefined, cmd);
  for (const cmd of [
    "rg -n 'world.clock|world.snapshot' books/target", "sed -n '1,260p' books/target/devnet/operations.ts", "git rev-parse HEAD",
    "find books/target -name '*.ts'", "nl -ba books/target/shared/cut.ts", "git ls-files books", "git merge-base integration/build HEAD",
  ]) { assert.equal(r(cmd), undefined, cmd); assert.equal(w(cmd), undefined, cmd); }
  for (const cmd of [
    "rg --pre cat x .", "find . -name x -delete", "find . -exec rm {} +", "sed -i s/a/b/ f.ts", "sed -n '1,3p;w out' f.ts", "git push", "pnpm install",
    "grep 'a' f ; curl http://x", "echo 'unclosed", "echo ok | sh",
  ]) { assert.notEqual(w(cmd), undefined, cmd); assert.notEqual(r(cmd), undefined, cmd); }
  for (const cmd of ["rm -rf books", "rm -r x", "rm .git/config", "rm -f -- -x", "rm books/frozen/a.ts", "rm x.cjs blueprint/baseline/a.ts", "rm packages/sdk/src/generated/a.ts", "rm var/runs/x"]) assert.notEqual(w(cmd), undefined, cmd);
  for (const cmd of ["find . -fprint0 out", "git grep -Osh x"]) { assert.notEqual(w(cmd), undefined, cmd); assert.notEqual(r(cmd), undefined, cmd); }
  for (const cmd of ["rm x.cjs", "node x.js", "git commit -m x", "pnpm test", "mkdir out"]) assert.notEqual(r(cmd), undefined, cmd);   // a reader changes nothing and runs no program
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
