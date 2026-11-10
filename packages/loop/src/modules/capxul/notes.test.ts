import assert from "node:assert/strict";
import { test } from "node:test";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import pair from "../../../../../loops/pair.ts";
import { sendNote, showFull, start } from "./service.ts";
import { check, handback, opts, rig } from "./testing.ts";

const record = (name: string, command: string) => fauxAssistantMessage(fauxToolCall("record_terminal", { name, command }), { stopReason: "toolUse" });
const until = async (ok: () => boolean): Promise<void> => { for (let i = 0; i < 500 && !ok(); i++) await new Promise((r) => setTimeout(r, 10)); assert.ok(ok(), "timed out"); };

test("a person's note reaches a working builder: steer joins its turn, queue gives it another, and the last answer is the hand-back", async () => {
  const r = rig(), ctx = r.ctx();
  r.faux.setResponses([
    record("busy", "node hold.js"), fauxAssistantMessage(handback("The first answer.")), fauxAssistantMessage(handback("The answer after the queued note.")), fauxAssistantMessage(check("approve")),
  ]);
  const playing = start(ctx, "t1", opts, pair);
  await r.held;                                                           // the builder is inside a tool call
  const id = r.lines.find((l) => l.startsWith("run "))!.slice(4);

  assert.deepEqual(await sendNote(ctx, id, { agent: "make.1", text: "Use the short name.", mode: "steer" }), { ok: true, said: "sent: make.1 reads it after its current tool call" });
  assert.deepEqual(await sendNote(ctx, id, { agent: "make.1", text: "Then add a test for it.", mode: "queue" }), { ok: true, said: "queued: make.1 reads it when its turn ends, and then goes on" });
  assert.match((await sendNote(ctx, id, { agent: "reviewer.1.agent", text: "Be kind.", mode: "steer" })).said, /^reviewer\.1\.agent is a checker: it can be watched and stopped, not steered/);
  assert.deepEqual(await sendNote(ctx, id, { agent: "make.9", text: "Hello.", mode: "steer" }), { ok: false, said: "there is no agent make.9 in this run" });
  assert.match((await sendNote(ctx, "no-such-run", { agent: "make.1", text: "Hello.", mode: "steer" })).said, /^there is no run no-such-run/);

  r.release();
  const info = await playing;
  assert.equal(info.status, "ready", JSON.stringify(info));
  const full = (await showFull(ctx, id))!, builder = full.agents.find((a) => a.key === "make.1")!;
  assert.deepEqual(builder.messages.filter((m) => m.role === "user").map((m) => m.text).slice(1), ["Use the short name.", "Then add a test for it."], "both notes are in the builder's conversation, after its brief");
  assert.equal((full.steps.find((s) => s.name === "make.1")!.said!.json as { submit: { note: string } }).submit.note, "The answer after the queued note.");
  assert.ok(r.lines.includes("a note for make.1 (steer): sent: make.1 reads it after its current tool call"));
  assert.deepEqual(await sendNote(ctx, id, { agent: "make.1", text: "Too late.", mode: "steer" }), { ok: false, said: `run ${id} is not being played now: nothing was sent` });
});

test("a note to an agent that has finished its part is refused: a note never starts work of its own", async () => {
  const r = rig(), ctx = r.ctx();
  r.faux.setResponses([fauxAssistantMessage(handback("Made.")), record("busy", "node hold.js"), fauxAssistantMessage(check("approve"))]);
  const playing = start(ctx, "t1", opts, pair);
  await r.held;                                                           // the reviewer is working; the builder has handed back
  await until(() => r.lines.some((l) => l.startsWith("run ")));
  const id = r.lines.find((l) => l.startsWith("run "))!.slice(4);
  assert.deepEqual(await sendNote(ctx, id, { agent: "make.1", text: "One more thing.", mode: "queue" }), { ok: false, said: "make.1 is not working now: nothing was sent" });
  r.release();
  assert.equal((await playing).status, "ready");
});
