// Stop, as the Runs page sends it (host -> `stop`), ends a run within seconds even while an agent's tool is recording a
// command that would run for a minute: the recorder and everything under it is killed, and nothing is kept.
import assert from "node:assert/strict";
import { chmodSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import pair from "../../../../../loops/pair.ts";
import { nodeExec } from "../evidence/service.ts";
import { start, stop } from "./service.ts";
import { handback, opts, rig } from "./testing.ts";

const until = async (ok: () => boolean, ms: number): Promise<void> => { const t0 = Date.now(); while (!ok() && Date.now() - t0 < ms) await new Promise((r) => setTimeout(r, 20)); assert.ok(ok(), "timed out"); };

test("Stop ends a run within ten seconds while its builder is recording a long command, and the recorder dies with it", async () => {
  const r = rig(), mark = join(r.dir, "recording"), slow = join(r.dir, "slow-recorder.sh");
  writeFileSync(slow, `#!/bin/sh\ntouch '${mark}'\nexec sleep 60\n`);
  chmodSync(slow, 0o755);
  const base = r.ctx(), ctx = { ...base, evidence: { tooling: { ...base.evidence!.tooling, asciinema: slow }, exec: nodeExec } };
  r.faux.setResponses([fauxAssistantMessage(fauxToolCall("record_terminal", { name: "long", command: "node long.js" }), { stopReason: "toolUse" }), fauxAssistantMessage(handback("never reached"))]);
  const playing = start(ctx, "t1", opts, pair);
  await until(() => existsSync(mark), 20_000);                            // the builder is inside the recording
  const id = r.lines.find((l) => l.startsWith("run "))!.slice(4), t0 = Date.now();
  stop(ctx, id);
  const info = await playing;
  assert.ok(Date.now() - t0 < 10_000, `the run took ${Date.now() - t0} ms to end`);
  assert.equal(info.status, "stopped", JSON.stringify(info));
});
