// A run in a cloud sandbox: every tool call, gate and commit goes through the box's server. Here the box is the same
// server in this process (`SANDBOX=url:`), with a HOME of its own, so what ran in the box is told apart by its HOME.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import pair from "../../../../../loops/pair.ts";
import { serveBox } from "@capxul/sandbox/box";
import { git } from "../lanes/service.ts";
import { showFull, start } from "./service.ts";
import { check, handback, opts, rig } from "./testing.ts";

test("cloud: the maker's tools, the gates and the commits run in the box; the lane here gets the commits; the branch is pushed", async () => {
  const r = rig(), home = mkdtempSync(join(tmpdir(), "box-home-"));
  const box = await serveBox({ port: 0, host: "127.0.0.1", machine: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: home }, repo: r.root });
  try {
    const base = r.ctx([{ name: "in the box", sh: `test "$HOME" = "${home}" && test -f hello.txt` }]);
    const ctx = { ...base, env: { ...base.env, SANDBOX: `url:http://127.0.0.1:${box.port}` } };
    r.faux.setResponses([
      fauxAssistantMessage(fauxToolCall("write", { path: "hello.txt", content: "made\n" }), { stopReason: "toolUse" }),
      fauxAssistantMessage(fauxToolCall("bash", { command: "pwd" }), { stopReason: "toolUse" }),
      fauxAssistantMessage(handback("Changed: a file.")),
      fauxAssistantMessage(check("approve")),
    ]);
    const info = await start(ctx, "t1", { ...opts, sandbox: "cloud" }, pair);
    assert.equal(info.status, "ready", JSON.stringify(info));
    const lane = join(r.root, "var", "runs", info.id, "lane");
    assert.equal(readFileSync(join(lane, "hello.txt"), "utf8"), "made\n");
    assert.match(git(lane, "log", "-1", "--format=%s"), /^loop: make\.1/);
    assert.match(git(r.root, "ls-remote", "origin", "lane/t1"), /refs\/heads\/lane\/t1/);
    const saved = JSON.parse(readFileSync(join(r.root, "var", "runs", info.id, "status.json"), "utf8")) as { extra: { sandbox: { kind: string } } };
    assert.equal(saved.extra.sandbox.kind, "none");   // stopped at the end
    assert.ok(JSON.stringify(await showFull(ctx, info.id)).includes("in the box"));
  } finally { await box.close(); }
});

test("cloud: a run whose sandbox is not set up fails at the start with what is missing", async () => {
  const r = rig();
  const info = await start(r.ctx(), "t1", { ...opts, sandbox: "cloud" }, pair);
  assert.equal(info.status, "failed");
  assert.match(JSON.stringify(info), /var\/sandbox\/box\.json is missing/);
});

// An agent's own boxes, against local Docker containers of the image (LOOP_BOX_IMAGE=<tag>; skipped without one).
test("a builder starts a box of its own with its lane, runs in it, takes it down; the run's end takes down what it left", { skip: !process.env.LOOP_BOX_IMAGE }, async () => {
  const r = rig(), base = r.ctx();
  const ctx = { ...base, env: { ...base.env, SANDBOX: `docker:${process.env.LOOP_BOX_IMAGE}` } };
  r.faux.setResponses([
    fauxAssistantMessage(fauxToolCall("write", { path: "hello.txt", content: "made\n" }), { stopReason: "toolUse" }),
    fauxAssistantMessage(fauxToolCall("bash", { command: "git add hello.txt && git commit -qm hello" }), { stopReason: "toolUse" }),
    fauxAssistantMessage(fauxToolCall("sandbox_up", { name: "try", lane: true }), { stopReason: "toolUse" }),
    fauxAssistantMessage(fauxToolCall("sandbox_exec", { name: "try", command: "cat hello.txt && test \"$HOME\" = /root" }), { stopReason: "toolUse" }),
    fauxAssistantMessage(fauxToolCall("sandbox_up", { name: "left" }), { stopReason: "toolUse" }),
    fauxAssistantMessage(fauxToolCall("sandbox_down", { name: "try" }), { stopReason: "toolUse" }),
    fauxAssistantMessage(handback("Changed: a file.")),
    fauxAssistantMessage(check("approve")),
  ]);
  const info = await start(ctx, "t1", { ...opts, sandbox: "none" }, pair);
  assert.equal(info.status, "ready", JSON.stringify(info));
  const said = JSON.stringify(await showFull(ctx, info.id));
  assert.match(said, /is up for 60 minutes, with your lane/);
  assert.match(said, /exit 0[^"]*made/);
  assert.match(said, /-try is down/);
  const { docker } = await import("@capxul/sandbox/box");
  const left = await docker(process.env.LOOP_BOX_IMAGE!).list();
  assert.ok(left.ok && !left.value.some((b) => b.owner === `run:${info.id}`), "the run's end took down the box it left");
});
