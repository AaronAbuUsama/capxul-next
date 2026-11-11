// A run in a cloud sandbox: every tool call, gate and commit goes through the box's server. Here the box is the same
// server in this process (`LOOP_BOX=url:`), with a HOME of its own, so what ran in the box is told apart by its HOME.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import pair from "../../../../../loops/pair.ts";
import { serveBox } from "../cloud/service.ts";
import { git } from "../lanes/service.ts";
import { showFull, start } from "./service.ts";
import { check, handback, opts, rig } from "./testing.ts";

test("cloud: the maker's tools, the gates and the commits run in the box; the lane here gets the commits; the branch is pushed", async () => {
  const r = rig(), home = mkdtempSync(join(tmpdir(), "box-home-"));
  const box = await serveBox({ port: 0, host: "127.0.0.1", machine: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: home }, repo: r.root });
  try {
    const base = r.ctx([{ name: "in the box", sh: `test "$HOME" = "${home}" && test -f hello.txt` }]);
    const ctx = { ...base, env: { ...base.env, LOOP_BOX: `url:http://127.0.0.1:${box.port}` } };
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
  assert.match(JSON.stringify(info), /var\/cloud\/box\.json is missing/);
});
