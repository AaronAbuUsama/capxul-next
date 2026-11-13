import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { sliceZeroRequired } from "@capxul/blueprint-engine";
import { loadTarget } from "../../../../blueprint-engine/scripts/target.ts";
import { eventChecks, judgeEvent, readInvocations, type Envelope, type Invocation } from "./service.ts";

const target = await loadTarget();
assert.ok(target.ok);
const b = target.blueprint;
const [check] = eventChecks(b, ["evt:world.create/world_transitioned"]);
const call = (trace: string, ok = true, operation = "world.create"): Invocation => ({ operation, trace_id: trace, ok, file: "preparation/operations.jsonl" });
const sent = (trace: string, change: Partial<Envelope> = {}, props: Record<string, unknown> = {}): Envelope => ({
  id: `e-${trace}-${Object.keys(change).join("")}${Object.keys(props).join("")}`, name: "world_transitioned", machine: "world", entity_id: "w1",
  owner_kind: null, owner_id: null, actor: null, trace_id: trace, at: 1,
  props: { from: null, to: "creating", transition: "create", world_id: "w1", kind: "local", epoch: 1, ...props }, ...change,
});

test("checks are named from the blueprint's evt claims in the gate", () => {
  const ids = sliceZeroRequired(b).filter((id) => id.startsWith("evt:"));
  const named = eventChecks(b, [...ids, "evt:no.such/thing", "ret:world.create"]);
  assert.deepEqual(named.map((c) => c.id), ids);
  assert.equal(check?.name, "EVENTS.world.create.world_transitioned");
});

test("an event passes only when a logged call sent it under its own trace and every envelope is valid", () => {
  assert.ok(check);
  for (const [label, calls, outbox, pass] of [
    ["valid", [call("t1")], [sent("t1")], true],
    ["no log", [], [sent("t1")], false],
    ["failed call", [call("t1", false)], [sent("t1")], false],
    ["another operation's trace", [call("t1"), call("t2", true, "world.snapshot.restore")], [sent("t2")], false],
    ["another event", [call("t1")], [sent("t1", { name: "payment_transitioned" })], false],
    ["excess prop", [call("t1")], [sent("t1", {}, { extra: 1 })], false],
    ["undeclared state", [call("t1")], [sent("t1", {}, { to: "flying" })], false],
    ["half an owner", [call("t1")], [sent("t1", { owner_kind: "organization" })], false],
    ["one bad envelope among good", [call("t1")], [sent("t1"), sent("t1", { at: -1 })], false],
    ["second call sent it", [call("t0"), call("t1")], [sent("t1")], true],
  ] as const) {
    const j = judgeEvent(b, check, calls, outbox);
    assert.equal(j.pass, pass, `${label}: ${j.detail}`);
  }
});

test("only regular, fresh, well-formed operations.jsonl files in module directories count", () => {
  const run = mkdtempSync(join(tmpdir(), "events-run-"));
  try {
    const since = Date.now() - 1000;
    for (const m of ["preparation", "sites", "old", "linked-src"]) mkdirSync(join(run, m));
    writeFileSync(join(run, "preparation/operations.jsonl"), `${JSON.stringify({ operation: "world.create", trace_id: "t1", ok: true })}\nnot json\n`);
    writeFileSync(join(run, "sites/operations.jsonl"), `${JSON.stringify({ operation: "doc.submit", trace_id: "", ok: true })}\n`);
    writeFileSync(join(run, "old/operations.jsonl"), `${JSON.stringify({ operation: "org.create", trace_id: "t9", ok: true })}\n`);
    utimesSync(join(run, "old/operations.jsonl"), new Date(since - 60_000), new Date(since - 60_000));
    writeFileSync(join(run, "linked-src/real.jsonl"), `${JSON.stringify({ operation: "org.create", trace_id: "t8", ok: true })}\n`);
    symlinkSync(join(run, "linked-src/real.jsonl"), join(run, "linked-src/operations.jsonl"));
    writeFileSync(join(run, "operations.jsonl"), `${JSON.stringify({ operation: "org.create", trace_id: "t7", ok: true })}\n`);
    const { invocations, errors } = readInvocations(run, since);
    assert.deepEqual(invocations.map((i) => i.trace_id), ["t1"]);
    assert.equal(errors.length, 4, errors.join("\n"));
  } finally { rmSync(run, { recursive: true, force: true }); }
});

test("without a world, every requested check is reported as an explicit failure", () => {
  const r = spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", join(import.meta.dirname, "main.ts"), "slug", "--only", "EVENTS"],
    { encoding: "utf8", env: { PATH: process.env.PATH } });
  const lines = r.stdout.split("\n").filter((l) => l.startsWith("@check\t"));
  assert.equal(r.status, 1, r.stderr);
  assert.equal(lines.length, eventChecks(b, sliceZeroRequired(b)).length);
  assert(lines.every((l) => l.split("\t")[2] === "fail" && /not checked/.test(l)));
});
