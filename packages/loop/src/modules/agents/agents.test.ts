import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { ask, openHost, refuseBash, refusePath, remember, tail, type Policy } from "./service.ts";

const policy: Policy = { bash: { write: [/^echo /, /^env$/, /^cat /, /^git (status|diff|add|commit)/], read: [/^git (diff|log|show|status)/] }, denyWrite: [/^books\/frozen\//] };

const rig = async () => {
  const dir = mkdtempSync(join(tmpdir(), "loop-agents-"));
  const lane = join(dir, "lane");
  mkdirSync(lane);
  writeFileSync(join(lane, "a.txt"), "hello\n");
  const faux = fauxProvider();
  const models = createModels();
  models.setProvider(faux.provider);
  const open = (readOnly = false) => openHost({ file: join(dir, "run.sqlite"), models, env: { PATH: process.env.PATH ?? "", KEPT: "yes" }, policy, readOnly });
  return { dir, lane, faux, open };
};
const base = (lane: string, key: string) => ({ key, model: "faux/faux-1", system: "You are a test.", prompt: "go", cwd: lane, profile: "write" as const });

test("an agent answers, and the answer carries its json", async () => {
  const r = await rig();
  r.faux.setResponses([fauxAssistantMessage('```json\n{"ok":true}\n```')]);
  const host = await r.open();
  const said = await ask(host, base(r.lane, "one"));
  assert.equal(said.ok, true);
  assert.deepEqual(said.json, { ok: true });
  await host.close();
});

test("the policy refuses what is outside the lane or not on the list", () => {
  assert.match(refuseBash("git push origin integration/build", "/w", policy.bash.write) ?? "", /not a command/);
  assert.match(refuseBash("cat /etc/passwd", "/w", policy.bash.write) ?? "", /outside the lane/);
  assert.match(refuseBash("echo $(whoami)", "/w", policy.bash.write) ?? "", /substitutions/);
  assert.match(refuseBash("echo a && curl x", "/w", policy.bash.write) ?? "", /not a command/);
  assert.equal(refuseBash("echo a && git status", "/w", policy.bash.write), undefined);
  assert.match(refusePath("../x", "/w", false, []) ?? "", /outside/);
  assert.match(refusePath("books/frozen/a.ts", "/w", true, policy.denyWrite) ?? "", /may not be written/);
  assert.equal(refusePath("books/frozen/a.ts", "/w", false, policy.denyWrite), undefined);
});

test("a refused call reaches the model as an error, and bash sees only the environment it was given", async () => {
  const r = await rig();
  process.env.LOOP_TEST_SECRET = "s3cret";
  r.faux.setResponses([
    fauxAssistantMessage(fauxToolCall("bash", { command: "cat /etc/hosts" }), { stopReason: "toolUse" }),
    fauxAssistantMessage(fauxToolCall("bash", { command: "env" }), { stopReason: "toolUse" }),
    fauxAssistantMessage("done"),
  ]);
  const host = await r.open();
  const said = await ask(host, base(r.lane, "env"));
  const lines = (await tail(host, said.conversation)).lines.join("\n");
  assert.match(lines, /Refused by the loop's policy/);
  assert.match(lines, /KEPT=yes/);
  assert.doesNotMatch(lines, /s3cret|LOOP_TEST_SECRET/);
  await host.close();
});

test("after a restart the same key finds the same answer without asking the model again", async () => {
  const r = await rig();
  r.faux.setResponses([fauxAssistantMessage("first")]);
  let host = await r.open();
  const a = await ask(host, base(r.lane, "k"));
  assert.equal(await remember(host, "step.a", async () => 7), 7);
  await host.close();
  r.faux.setResponses([]);                       // a second model call would now fail
  host = await r.open();
  const b = await ask(host, base(r.lane, "k"));
  assert.equal(b.text, a.text);
  assert.equal(b.conversation, a.conversation);
  assert.equal(await remember(host, "step.a", async () => { throw new Error("ran again"); }), 7);
  await host.close();
});

test("a second process can look at a run read-only", async () => {
  const r = await rig();
  r.faux.setResponses([fauxAssistantMessage("hello there")]);
  const host = await r.open();
  const said = await ask(host, base(r.lane, "w"));
  const look = await r.open(true);
  assert.match((await tail(look, said.conversation)).lines.join("\n"), /hello there/);
  await look.close();
  await host.close();
});
