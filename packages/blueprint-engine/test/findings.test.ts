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

test("error references do not produce it; reserved errors stand until a real producer exists", () => {
  const error = { ...f.WRONG_STATE, id: "RESERVED" };
  const entry = { record: "error:RESERVED", rule: "unproduced-error", why: "Its equity producer is parked" };
  const reason = { ...decision([entry]), affects: [error] };
  const records = [...f.records, error];
  const mentioned = build([...records, { ...reason, stands: [] }]);
  assert.ok(mentioned.gaps.some((g) => g.record === entry.record && g.rule === entry.rule));
  const reserved = build([...records, reason]);
  assert.deepEqual(reserved.problems, []);
  assert.ok(reserved.standing.some((g) => g.record === entry.record && g.decision === reason.id && g.why === entry.why));
  assert.ok(!reserved.gaps.some((g) => g.record === entry.record));
  const refusalOnly = build(records.map((r) => r === f.invite ? {
    ...r, refusals: [...r.refusals, { error, given: "reserved-world", when: "Equity is parked" }],
  } : r));
  assert.ok(refusalOnly.gaps.some((g) => g.record === entry.record && g.rule === entry.rule));

  // Every schema-supported producer declaration closes the gap, making the retained reason stale.
  for (const producer of [f.invite, f.acceptFlow, f.inviteRpc, f.grantSeat]) {
    const produced = records.map((r) => r === producer ? { ...r, errors: [error] } : r);
    const b = build([...produced, reason]);
    assert.ok(!b.gaps.some((g) => g.record === entry.record), producer._kind);
    assert.ok(!b.standing.some((g) => g.record === entry.record), producer._kind);
    assert.ok(b.problems.some((p) => p.rule === "stale-standing-gap"), producer._kind);
  }
  const fromCall = build([...records.map((r) => r === f.mail ? {
    ...r,
    calls: { ...r.calls, send: { ...r.calls.send, failures: [{ error, when: "Provider refuses" }] } },
  } : r), reason]);
  assert.ok(!fromCall.gaps.some((g) => g.record === entry.record));
  assert.ok(!fromCall.standing.some((g) => g.record === entry.record));
  assert.ok(fromCall.problems.some((p) => p.rule === "stale-standing-gap"));
});

test("repeated refusal and failure codes preserve each case under a distinct id", () => {
  const operation = f.records.find((r) => r._kind === "operation")!;
  const refusal = operation.refusals[0];
  const refusals = [refusal, { ...refusal, given: "another-world" }];
  const records = f.records.map((r) => r === operation ? { ...r, refusals } : r);
  const b = build(records);
  const base = `ref:${operation.id}/${refusal.error.id}`;
  const original = build(f.records).evals.find((e) => e.id.startsWith(`${base}/`))!;
  assert.ok(b.evals.some((e) => e.id === original.id));
  assert.ok(b.evals.some((e) => e.id.startsWith(`${base}/`) && e.id !== original.id && e.claim.includes("another-world")));
  assert.deepEqual(build(f.records.map((r) => r === operation ? { ...r, refusals: [...refusals].reverse() } : r)).evals.map((e) => e.id).sort(), b.evals.map((e) => e.id).sort());
  assert.equal(new Set(b.evals.map((e) => e.id)).size, b.evals.length);
  const failures = build([{ _kind: "integration", id: "provider", calls: { send: { failures: [
    { error: { _kind: "error", id: "DOWN" }, when: "timed out" },
    { error: { _kind: "error", id: "DOWN" }, when: "refused" },
  ] } } }]);
  assert.equal(failures.evals.filter((e) => e.id.startsWith("int:provider.send/DOWN/")).length, 2);
  assert.ok(failures.evals.some((e) => e.claim.includes("timed out")));
  assert.ok(failures.evals.some((e) => e.claim.includes("refused")));
});

test("global eval identity collisions are problems, not deduplicated", () => {
  // Construct two distinct call names that yield the same concatenated identity.
  const d = build([
    { _kind: "integration", id: "a", calls: { "b.c": { failures: [{ error: { _kind: "error", id: "X" }, when: "one" }] } } },
    { _kind: "integration", id: "a.b", calls: { c: { failures: [{ error: { _kind: "error", id: "X" }, when: "one" }] } } },
  ]);
  assert.ok(d.problems.some((p) => p.rule === "eval-identity" && p.detail.includes("int:a.b.c/X")));
  assert.equal(d.evals.filter((e) => e.id.startsWith("int:a.b.c/X/")).length, 2);
});

test("inserting, retiring and reordering acceptance claims does not redirect existing IDs", () => {
  const ids = (acceptance: readonly unknown[]) => build(f.records.map((r) => r === f.invite ? { ...r, acceptance } : r)).evals.filter((e) => e.id.startsWith("acc:org.member.invite/")).map((e) => e.id);
  const before = ids(f.invite.acceptance);
  const after = ids(["A new acceptance claim.", ...[...f.invite.acceptance].reverse()]);
  assert.ok(before.every((id) => after.includes(id)));
  assert.equal(after.length, before.length + 1);
  assert.deepEqual(ids([f.invite.acceptance[0]]), [before[0]]);
  assert.deepEqual(ids([{ key: "pending", claim: "Old wording" }]), ["acc:org.member.invite/pending"]);
  assert.deepEqual(ids([{ key: "pending", claim: "New wording" }]), ["acc:org.member.invite/pending"]);
});
