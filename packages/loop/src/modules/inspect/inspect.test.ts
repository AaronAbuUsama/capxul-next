import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { ask, openHost } from "../agents/service.ts";
import { play, readInfo } from "../runs/service.ts";
import { scrub, scrubText, secretsOf } from "./internal/scrub.ts";
import { showDetail, showView, statusViews, type Look } from "./service.ts";

const SECRET = "sk-live-0123456789abcdefABCDEF";
const ENV_SECRET = "hunter2-hunter2-hunter2";
const POLICY = { bash: { write: [] as RegExp[], read: [] as RegExp[] }, denyWrite: [] as RegExp[] };

/** A finished run whose maker made two tool calls (one carrying a secret) and whose checker replied. */
const rig = async () => {
  const runs = mkdtempSync(join(tmpdir(), "loop-inspect-"));
  const faux = fauxProvider();
  const models = createModels();
  models.setProvider(faux.provider);
  const open = (dir: string) => openHost({ file: join(dir, "run.sqlite"), models, env: {}, policy: POLICY, readOnly: dir !== join(runs, "r1") ? true : false });
  faux.setResponses([
    fauxAssistantMessage([fauxToolCall("bash", { command: `curl -H "Authorization: Bearer ${SECRET}" https://x.test && echo $API_KEY=${ENV_SECRET}\nsecond line` }), fauxToolCall("read", { path: "/lane/books/a.ts" })], { stopReason: "toolUse" }),
    fauxAssistantMessage("The private plan: do not show this reply."),
    fauxAssistantMessage("approve"),
  ]);
  const dir = join(runs, "r1");
  const info = await play({
    dir, id: "r1", subject: "m1-x", open: () => open(dir),
    script: async (run) => {
      await run.step("make.1", () => ask(run.host, { key: "make.1", model: "faux/faux-1", system: "s", prompt: "PROMPT TEXT NOT TO SHOW", cwd: "/lane", profile: "write", maxTurns: 5 }));
      await run.step("reviewer.1.agent", () => ask(run.host, { key: "reviewer.1.agent", model: "faux/faux-1", system: "s", prompt: "p2", cwd: "/lane", profile: "read", maxTurns: 5 }));
      run.info.extra["lane"] = { dir: "/lane", branch: "lane/m1-x", base: "integration/build" };
      run.info.extra["opts"] = { script: "pair", rounds: 3 };
      await run.end("blocked", [`the maker asked: set TOKEN=${SECRET} please`]);
    },
  });
  assert.equal(info.status, "blocked");
  const look = (events: number): Look => ({ runs, open, now: new Date(), env: { PATH: "/bin", API_KEY: ENV_SECRET }, events });
  return { runs, look };
};

test("a run as a view: the task, models, counts by tool name, tokens, branch, the last events and why it is blocked", async () => {
  const { look } = await rig();
  const v = await showView(look(20), "r1");
  assert.ok(v);
  assert.equal(v.task, "m1-x");
  assert.equal(v.status, "blocked");
  assert.equal(v.script, "pair");
  assert.equal(v.rounds, 3);
  assert.equal(v.branch, "lane/m1-x");
  assert.equal(v.readable, true);
  assert.equal(v.models.maker, "faux/faux-1");
  assert.equal(v.models.checkers["reviewer"], "faux/faux-1");
  assert.deepEqual(v.toolCalls, { total: 2, byName: { bash: 1, read: 1 } });
  assert.equal(v.turns, 3);
  assert.ok(v.tokens.in + v.tokens.out > 0, JSON.stringify(v.tokens));
  assert.deepEqual(v.events.map((e) => `${e.who}: ${e.what.split(" ")[0]}`), ["make.1: bash", "make.1: read", "make.1: replied", "reviewer.1.agent: replied"].slice(0, 4));
  assert.equal(v.events.find((e) => e.what.startsWith("read"))?.what, "read /lane/books/a.ts".replace("/lane/", ""));
  assert.match(v.why.join(" "), /the maker asked/);
  assert.ok(Date.parse(v.lastEventAt) >= Date.parse(v.startedAt));
  assert.equal((await showView(look(2), "r1"))?.events.length, 2);
  assert.equal(await showView(look(20), "nope"), null);
});

test("nothing secret leaves: not a token in a command, not a value of the environment, not a prompt or a reply, not a reason", async () => {
  const { look } = await rig();
  const all = JSON.stringify([await showView(look(20), "r1"), ...(await statusViews(look(3), 24))]);
  for (const forbidden of [SECRET, ENV_SECRET, "PROMPT TEXT NOT TO SHOW", "do not show this reply", "second line"]) assert.equal(all.includes(forbidden), false, forbidden);
  assert.match(all, /\[hidden\]/);
  assert.match(all, /"what":"bash curl/);
});

test("status lists runs that are running or recent, and a run whose process is gone is dead", async () => {
  const { runs, look } = await rig();
  assert.equal((await statusViews(look(3), 24)).length, 1);
  const dir = join(runs, "r1");
  const info = readInfo(dir);
  writeFileSync(join(dir, "status.json"), JSON.stringify({ ...info, status: "running", pid: 2 ** 22 + 5, updatedAt: "2020-01-01T00:00:00.000Z" }));
  const [v] = await statusViews(look(3), 1);
  assert.equal(v?.status, "dead");                                     // running, so listed however old; its pid is gone
  assert.match(v?.why[0] ?? "", /process is gone/);
  writeFileSync(join(dir, "status.json"), JSON.stringify({ ...info, updatedAt: "2020-01-01T00:00:00.000Z" }));
  assert.equal((await statusViews(look(3), 24)).length, 0);            // finished long ago: not listed
});

test("a run whose storage cannot be read still has a view, from its status file", async () => {
  const { look } = await rig();
  const broken: Look = { ...look(3), open: async () => { throw new Error("database is locked"); } };
  const v = await showView(broken, "r1");
  assert.equal(v?.readable, false);
  assert.equal(v?.turns, 0);
  assert.match(v?.why.join(" ") ?? "", /could not be read: database is locked/);
});

test("scrub: shapes of keys, tokens and assignments, values of secret-named variables, a long hash; cuts at the cap", () => {
  const s = secretsOf({ PATH: "/usr/bin:/bin:/usr/local/bin", MY_API_TOKEN: "abcdefgh12345", HOME: "/Users/someone" });
  assert.deepEqual(s, ["abcdefgh12345"]);
  assert.equal(scrub("a abcdefgh12345 b", s, 50), "a [hidden] b");
  assert.equal(scrub("key sk-abcdefghij12 and ghp_abcdefghijk", [], 50), "key [hidden] and [hidden]");
  assert.equal(scrub("PASSWORD=hunter2 ok", [], 50), "[hidden] ok");
  assert.equal(scrub("git show 0123456789abcdef0123456789abcdef01234567", [], 50), "git show 0123456");
  assert.equal(scrub("word ".repeat(30), [], 10), "word word…");
});

test("a run in full: its steps, each agent's conversation with tool calls matched to results, and nothing secret", async () => {
  const { look } = await rig();
  const d = (await showDetail(look(0), "r1"))!;
  assert.equal(d.task.id, "m1-x");
  const maker = d.agents.find((a) => a.key === "make.1")!;
  assert.equal(maker.role, "builder");
  assert.deepEqual(maker.messages.map((m) => m.role).slice(0, 2), ["user", "assistant"]);
  const calls = maker.messages.flatMap((m) => m.calls ?? []);
  assert.deepEqual(calls.map((c) => c.name), ["bash", "read"]);
  assert.ok(maker.messages.filter((m) => m.role === "tool").every((m) => calls.some((c) => c.id === m.callId)), "every result names its call");
  assert.equal(maker.usage.turns >= 2, true);
  const all = JSON.stringify(d);
  assert.ok(!all.includes(SECRET) && !all.includes(ENV_SECRET), "no secret leaves");
  assert.match(all, /second line/);                                   // unlike a view, a detail keeps the lines of a command
  assert.equal(await showDetail(look(0), "nope"), null);
});

test("scrub: a long path is not taken for a key; a text of several lines keeps its lines and says what was cut", () => {
  const path = "packages/blueprint-engine/src/records/behaviour-and-evals.ts";
  assert.equal(scrub(`cat ${path}`, [], 200), `cat ${path}`);
  assert.equal(scrubText("one\ntwo sk-abcdefghij12\nthree", [], 100), "one\ntwo [hidden]\nthree");
  assert.equal(scrubText("abcdef", [], 3), "abc\n… 3 more characters");
  assert.equal(scrubText("HEAD is b50cae1db01670af9d2496cdd2b31005be15e9ff\nok", [], 100), "HEAD is b50cae1\nok");
});
