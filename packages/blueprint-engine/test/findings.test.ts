import assert from "node:assert/strict";
import { test } from "node:test";
import { buildBlueprint, defineDecision } from "../src/index.ts";
import * as f from "./fixtures/invitations.ts";

const build = (records: readonly unknown[]) => buildBlueprint({ name: "rules", stage: "as-is", records });
const decision = (stands: { record: string; rule: string; why: string }[]) => defineDecision({
  id: "test.standing", title: "A retained boundary", question: "Why?",
  options: [{ label: "keep", text: "Retain the boundary" }], chosen: "keep",
  why: "No public caller is intended", source: "test", affects: [], stands,
});

test("standing is separate, carries its decision and reason, and cannot hide problems", () => {
  const entry = { record: "rpc:organizations.invitations.list", rule: "unused-rpc", why: "Reserved for administration" };
  const b = build([...f.records, decision([entry])]);
  assert.deepEqual(b.problems, []);
  assert.equal(b.gaps.length, 0);
  assert.deepEqual(b.standing, [{ ...entry, detail: "no operation or flow uses it", decision: "test.standing" }]);
  const broken = build([...f.records, decision([{ ...entry, rule: "dangling" }]), {
    ...f.listRpc, id: "organizations.broken", reads: [{ _kind: "table", id: "absent" }],
  }]);
  assert.ok(broken.problems.some((p) => p.rule === "dangling"));
  assert.equal(broken.standing.length, 0);
});

test("a stale, mistyped or blank standing reason is a problem", () => {
  for (const entry of [
    { record: "rpc:absent", rule: "unused-rpc", why: "Reserved" },
    { record: "rpc:organizations.invitations.list", rule: "wrong-rule", why: "Reserved" },
    { record: "rpc:organizations.invitations.list", rule: "unused-rpc", why: " " },
  ]) {
    const b = build([...f.records, decision([entry])]);
    assert.ok(b.problems.some((p) => p.rule === "stale-standing-gap"));
    assert.equal(b.standing.length, 0);
    assert.equal(b.gaps.length, 1);
  }
});

test("repeated refusal and failure codes preserve each case under a distinct id", () => {
  const operation = f.records.find((r) => r._kind === "operation")!;
  const refusal = operation.refusals[0];
  const records = f.records.map((r) => r === operation ? { ...r, refusals: [refusal, { ...refusal, given: "another-world" }] } : r);
  const b = build(records);
  const base = `ref:${operation.id}/${refusal.error.id}`;
  assert.ok(b.evals.some((e) => e.id === base));
  assert.ok(b.evals.some((e) => e.id === `${base}/2` && e.claim.includes("another-world")));
  assert.equal(new Set(b.evals.map((e) => e.id)).size, b.evals.length);
  const failures = build([{ _kind: "integration", id: "provider", calls: { send: { failures: [
    { error: { _kind: "error", id: "DOWN" }, when: "timed out" },
    { error: { _kind: "error", id: "DOWN" }, when: "refused" },
  ] } } }]);
  assert.ok(failures.evals.some((e) => e.id === "int:provider.send/DOWN" && e.claim.includes("timed out")));
  assert.ok(failures.evals.some((e) => e.id === "int:provider.send/DOWN/2" && e.claim.includes("refused")));
});

test("global eval identity collisions are problems, not deduplicated", () => {
  // Construct two distinct call names that yield the same concatenated identity.
  const d = build([
    { _kind: "integration", id: "a", calls: { "b.c": { failures: [{ error: { _kind: "error", id: "X" }, when: "one" }] } } },
    { _kind: "integration", id: "a.b", calls: { c: { failures: [{ error: { _kind: "error", id: "X" }, when: "two" }] } } },
  ]);
  assert.ok(d.problems.some((p) => p.rule === "eval-identity" && p.detail.includes("int:a.b.c/X")));
  assert.equal(d.evals.filter((e) => e.id === "int:a.b.c/X").length, 2);
});
