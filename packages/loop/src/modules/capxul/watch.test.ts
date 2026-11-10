// `loop watch`: the coordinator is told when a run starts, is refused, fails a model request, turns unhealthy, ends or is superseded.
import assert from "node:assert/strict";
import { test } from "node:test";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import pair from "../../../../../loops/pair.ts";
import { changesOf, type RunView } from "../inspect/service.ts";
import { start, watchAll } from "./service.ts";
import { check, handback, opts, rig } from "./testing.ts";

const view = (o: Partial<RunView>): RunView => ({ id: "r", task: "t", script: "pair", status: "running", step: null, round: 1, rounds: 3, startedAt: "", endedAt: null, lastEventAt: "",
  models: { maker: null, checkers: {} }, turns: 0, toolCalls: { total: 0, byName: {} }, tokens: { in: 0, out: 0 }, refused: 0, failures: 0, superseded: null, branch: null, events: [], why: [], readable: true, ...o });

test("the changes between two looks are one line each, in the order a run lives them", () => {
  assert.deepEqual(changesOf([], [view({})]), ["r: started (t)"]);
  const a = view({ toolCalls: { total: 19, byName: {} } }), b = view({ toolCalls: { total: 22, byName: {} }, refused: 2, failures: 1 });
  assert.deepEqual(changesOf([a], [b]), ["r: 2 calls refused (2 of 22)", "r: unhealthy: more than one call in twenty refused", "r: 1 model failure (1 in all)"]);
  assert.deepEqual(changesOf([b], [view({ ...b, status: "blocked", why: ["F-1: no test"] })]), ["r: ended blocked: F-1: no test"]);
  assert.deepEqual(changesOf([b], [view({ ...b, status: "dead" })]), ["r: its process is gone (dead)"]);
  assert.deepEqual(changesOf([view({ status: "failed" })], [view({ status: "failed", superseded: "run s took over" })]), ["r: superseded: run s took over"]);
  assert.deepEqual(changesOf([b], [b]), [], "nothing changed, nothing is said");
});

test("watching a scripted run: it is seen to start, to be refused, and to end", async () => {
  const r = rig(), lines: string[] = [], base = r.ctx(), ctx = { ...base, say: (l: string) => { lines.push(l); base.say(l); } };
  r.faux.setResponses([
    fauxAssistantMessage(fauxToolCall("bash", { command: "curl http://example.test" }), { stopReason: "toolUse" }),
    fauxAssistantMessage(fauxToolCall("write", { path: "a.txt", content: "made\n" }), { stopReason: "toolUse" }),
    fauxAssistantMessage(handback("Made a.txt.")), fauxAssistantMessage(check("approve")),
  ]);
  let done = false;
  const watching = watchAll(ctx, { intervalMs: 50, until: () => done });
  const info = await start(ctx, "t1", opts, pair);
  await new Promise((w) => setTimeout(w, 300));
  done = true;
  await watching;
  const said = lines.filter((l) => / [a-z0-9-]+: /.test(l) && l.includes(info.id)).map((l) => l.slice(9).replace(info.id, "RUN"));
  assert.ok(said[0]?.startsWith("RUN: started (t1)"), said.join("\n"));
  assert.ok(said.some((l) => l.startsWith("RUN: 1 call refused")), said.join("\n"));
  assert.ok(said.some((l) => l.startsWith("RUN: ended ready")), said.join("\n"));
  assert.ok(said.findIndex((l) => l.includes("refused")) < said.findIndex((l) => l.includes("ended")));
});
