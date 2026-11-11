// What is Capxul's about the agents, tested without a run: the gates, the command policy, the gateway and its models, the session header.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { ask, openHost, refuseBash, refusePath } from "../agents/service.ts";
import { lacks, makes, modelOf, profilesOf, systemOf } from "./internal/agents.ts";
import { allowedModel, CHECKER_MODEL, GATEWAYS, gatewayOf, MAKER_MODEL, modelsOf } from "./internal/config.ts";
import { findingsOf } from "./internal/gates.ts";
import { DEFAULTS, gatesOf, loadDefinitions, POLICY } from "./service.ts";

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

test("every request to the gateway carries the conversation's own session id, one per agent, so a gateway can keep an agent on one account", async () => {
  const seen: (string | undefined)[] = [];
  const gateway = createServer((req, res) => {
    seen.push(req.headers["x-session-id"] as string | undefined);
    req.resume();
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.end(`data: ${JSON.stringify({ id: "c1", object: "chat.completion.chunk", model: "gpt-6.1-sol", choices: [{ index: 0, delta: { role: "assistant", content: "ok" }, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ id: "c1", object: "chat.completion.chunk", model: "gpt-6.1-sol", choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } })}\n\ndata: [DONE]\n\n`);
  });
  await new Promise<void>((ready) => gateway.listen(0, "127.0.0.1", () => ready()));
  const dir = mkdtempSync(join(tmpdir(), "loop-session-"));
  const env = { LOOP_MODEL_BASE_URL: `http://127.0.0.1:${(gateway.address() as { port: number }).port}/v1` };   // the default gateway asks for no key
  const host = await openHost({ file: join(dir, "run.sqlite"), models: modelsOf({ root: dir, env, now: () => new Date(), say: () => undefined, agents: [] }), env: {}, policy: POLICY });
  try {
    const one = await ask(host, { key: "make.1", model: "gateway/gpt-6.1-sol", system: "s", prompt: "p", cwd: dir, profile: "read" });
    assert.equal(one.text, "ok", one.error);
    await ask(host, { key: "reviewer.1.agent", model: "gateway/gpt-6.1-sol", system: "s", prompt: "p", cwd: dir, profile: "read" });
    assert.equal(seen.length, 2);
    assert.match(seen[0] ?? "", /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-/);                  // pi-durable's id of the conversation
    assert.notEqual(seen[0], seen[1]);                                                    // another agent, another session
  } finally { await host.close(); await new Promise((done) => gateway.close(done)); }
});

test("the gateway is named: the proxy on this machine by default, with no key; another by LOOP_GATEWAY; its parts can still be overridden", () => {
  const of = (env: Record<string, string>) => gatewayOf({ root: "/", env, now: () => new Date(), say: () => undefined, agents: [] });
  assert.deepEqual(of({}), { name: "local", baseUrl: "http://127.0.0.1:8317/v1", keyEnv: null });
  assert.deepEqual(of({ LOOP_GATEWAY: "router" }), { name: "router", ...GATEWAYS["router"] });
  assert.deepEqual(of({ LOOP_MODEL_BASE_URL: "http://x/v1", LOOP_MODEL_KEY_ENV: "SOME_KEY" }), { name: "local", baseUrl: "http://x/v1", keyEnv: "SOME_KEY" });
  assert.throws(() => of({ LOOP_GATEWAY: "nope" }), /there is no gateway named nope: LOOP_GATEWAY is one of local, router/);
});

test("a builder is told where its own lane's findings are: the folder the checkout's build script writes to", () => {
  const dir = mkdtempSync(join(tmpdir(), "loop-findings-"));
  writeFileSync(join(dir, "package.json"), JSON.stringify({ scripts: { blueprint: "node engine/main.ts blueprint/index.ts var/blueprint" } }));
  assert.equal(findingsOf(dir), "var/blueprint/findings.json");
  writeFileSync(join(dir, "package.json"), JSON.stringify({ scripts: { blueprint: "node engine/main.ts blueprint/index.ts /tmp/target" } }));
  assert.equal(findingsOf(dir), null);                                    // a folder outside the checkout is shared: the brief does not point at it
});

test("any model the gateway serves may be used; one it does not serve is refused; when it does not answer, only the two defaults", async () => {
  const gateway = createServer((req, res) => { res.writeHead(req.url === "/v1/models" ? 200 : 404, { "content-type": "application/json" }); res.end(JSON.stringify({ data: [{ id: "gpt-6.1-sol" }, { id: "claude-sonnet-5-5" }] })); });
  await new Promise<void>((ready) => gateway.listen(0, "127.0.0.1", () => ready()));
  const ctx = (url: string) => ({ root: "/", env: { LOOP_MODEL_BASE_URL: url }, now: () => new Date(), say: () => undefined, agents: [] });
  const up = ctx(`http://127.0.0.1:${(gateway.address() as { port: number }).port}/v1`);
  try {
    assert.deepEqual([await allowedModel(up, "gateway/claude-sonnet-5-5"), await allowedModel(up, "gateway/gpt-6.1-sol"), await allowedModel(up, "gateway/not-served")], [true, true, false]);
    assert.equal(await allowedModel(up, "faux/faux-1"), true);                      // a test's fake provider is not the gateway
  } finally { await new Promise((done) => gateway.close(done)); }
  const down = ctx("http://127.0.0.1:1/v1");
  assert.deepEqual([await allowedModel(down, "gateway/gpt-6.1-terra"), await allowedModel(down, "gateway/claude-sonnet-5-5")], [true, false]);
});

test("the definitions in packages/loop/agents: five, sound, each on its side's model unless the run names another, and only a maker's tools write", async () => {
  const root = join(import.meta.dirname, "../../../../.."), { agents, problems } = await loadDefinitions(root);
  assert.deepEqual(problems, []);
  assert.deepEqual(agents.map((a) => [a.name, a.side, a.model, a.shell, makes(a)]), [
    ["adversary", "checker", CHECKER_MODEL, "read", false], ["builder", "maker", MAKER_MODEL, "write", true], ["diagnoser", "checker", CHECKER_MODEL, "read", false],
    ["researcher", "maker", MAKER_MODEL, "read", false], ["reviewer", "checker", CHECKER_MODEL, "read", false],
  ]);
  const [builder, reviewer] = [agents.find((a) => a.name === "builder")!, agents.find((a) => a.name === "reviewer")!];
  const ctx = (env: Record<string, string> = {}) => ({ root, env, now: () => new Date(), say: () => undefined, agents });
  assert.deepEqual([modelOf(ctx(), DEFAULTS, builder), modelOf(ctx(), DEFAULTS, reviewer)], [`gateway/${MAKER_MODEL}`, `gateway/${CHECKER_MODEL}`]);
  assert.deepEqual([modelOf(ctx({ LOOP_MODEL: "m" }), DEFAULTS, builder), modelOf(ctx({ LOOP_MODEL: "m", LOOP_CHECKER_MODEL: "c" }), DEFAULTS, reviewer)], ["gateway/m", "gateway/c"]);
  const named = { ...DEFAULTS, model: "a/x", checkerModel: "b/y" };
  assert.deepEqual([modelOf(ctx({ LOOP_MODEL: "m" }), named, builder), modelOf(ctx(), named, reviewer)], ["a/x", "b/y"]);   // a flag wins over the environment, and each side has its own
  const profiles = profilesOf(agents);
  assert.deepEqual(profiles["agent.builder"]!.tools, ["read", "write", "edit", "bash"]);
  assert.deepEqual([profiles["agent.reviewer"]!.tools, profiles["agent.reviewer"]!.also, profiles["agent.reviewer"]!.bash], [["read", "bash"], ["record_terminal", "browser", "screenshot", "record_screen"], POLICY.bash.read]);
  assert.match(builder.instructions, /^You make one plan task true\./);                    // the role file's body: its front matter is Claude Code's
  assert.equal(systemOf(builder, root), builder.instructions);                                      // no skills: nothing is added
  const skilled = { ...builder, skills: [{ name: "careful", description: "Check twice.", file: join(root, "loops/skills/careful/SKILL.md") }] };
  assert.match(systemOf(skilled, root), /## Skills\n.*\n- careful: Check twice\. \(`loops\/skills\/careful\/SKILL\.md`\)$/);
  assert.equal(lacks(builder, { kind: "none", env: {} }), undefined);
  assert.equal(lacks({ ...builder, sandbox: "light" }, undefined), "the builder needs a light sandbox and this run has none: start the run with --sandbox light");
  assert.equal(lacks({ ...builder, sandbox: "light" }, { kind: "heavy", env: {} }), undefined);
});
