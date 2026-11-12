import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildBlueprint, defineDecision, freshStatus, staleEvals, verdictOf, defineTable, evalsUnder, mergeResults, parseResults, parseStatus, standOf, unknownEvals, underOf, type StatusDocument,
} from "../src/index.ts";
import * as f from "./fixtures/invitations.ts";

const decision = defineDecision({
  id: "access.who-invites", title: "Who invites", question: "Who may invite?",
  options: [{ label: "owners", text: "Owners." }, { label: "admins", text: "Admins." }], chosen: "owners",
  why: "Grants are an Owner's.", source: "The fixture.", affects: [f.inviteRpc],
});
const asIs = buildBlueprint({ name: "test", stage: "as-is", records: [...f.records, decision] });
const op = (b: typeof asIs, id: string) => b.records.get(`operation:${id}`)!;
const never = () => false;

test("underOf follows the rules and stops at concepts, tables' owners and decisions", () => {
  const { own, under } = underOf(asIs, op(asIs, "invite.accept"));
  assert.deepEqual(own, ["operation:invite.accept", "flow:organizations.accept-invitation", "rpc:organizations.invitations.accept"]);
  for (const k of ["error:WRONG_STATE", "table:invitations", "transition:invitation.accept", "machine:invitation", "procedure:access.grant-seat", "table:grants"]) assert.ok(under.includes(k), k);
  for (const k of ["concept:organizations", "decision:access.who-invites", "component:backend"]) assert.ok(!under.includes(k), k);
});

test("underOf reaches a call's integration, and a process the records start, with its own records", () => {
  const invite = underOf(asIs, op(asIs, "org.member.invite")).under;
  assert.ok(invite.includes("call:mail.send") && invite.includes("integration:mail") && invite.includes("error:PROVIDER_UNAVAILABLE"));
  // the cron-started expire workflow is triggered by nothing under the operation, so it is not under it
  assert.ok(!invite.includes("workflow:organizations.invitations.expire"));
  const started = { ...f.expire, id: "organizations.invitations.after-invite", trigger: { after: f.inviteRpc }, reads: [f.grants] };
  const b = buildBlueprint({ name: "t", stage: "as-is", records: [...f.records, started] });
  const under = underOf(b, op(b, "org.member.invite")).under;
  assert.ok(under.includes("workflow:organizations.invitations.after-invite") && under.includes("table:grants"));
});

test("with no status a clean operation stands at build, a waiting decision on its own records at decide", () => {
  const clean = standOf(asIs, op(asIs, "invite.accept"), { waits: never });
  assert.equal(clean.stand, "build");
  assert.equal(clean.why, "specified and decided; no eval has run against real code yet");
  const waiting = standOf(asIs, op(asIs, "org.member.invite"), { waits: (d) => d.id === "access.who-invites" });
  assert.deepEqual([waiting.stand, waiting.why], ["decide", "decision access.who-invites waits for an answer"]);
  // a waiting judgment on a record further under the operation does not hold it
  const far = defineDecision({ ...decision, id: "access.far", affects: [f.invitations] });
  const b = buildBlueprint({ name: "t", stage: "as-is", records: [...f.records, far] });
  assert.equal(standOf(b, op(b, "invite.accept"), { waits: () => true }).stand, "build");
});

test("a gap or problem on a record under the operation is specify; telemetry and example gaps are not", () => {
  const audit = defineTable({ ...f.grants, id: "audit", title: "Audit", about: "Read by the accept rpc, written by nobody." });
  const reads = { ...f.acceptRpc, reads: [f.grants, audit] };
  const gapped = buildBlueprint({ name: "t", stage: "as-is", records: [...f.records.filter((r) => r !== f.acceptRpc), reads, audit] });
  const held = standOf(gapped, op(gapped, "invite.accept"), { waits: never });
  assert.deepEqual([held.stand, held.why.startsWith("table:audit: unwritten-table")], ["specify", true]);
  // an operation with no example, span or event gap but nothing else wrong stays at build
  const target = buildBlueprint({ name: "t", stage: "target", records: [...f.records, decision] });
  assert.ok(target.gaps.some((g) => g.rule === "no-example" && g.record === "operation:invite.accept"));
  const onlyDeclared = { ...target, problems: [], gaps: target.gaps.filter((g) => ["no-example", "no-span", "state-change-without-event"].includes(g.rule)) };
  assert.ok(onlyDeclared.gaps.length > 0);
  assert.equal(standOf(onlyDeclared, op(target, "invite.accept"), { waits: never }).stand, "build");
  const problem = buildBlueprint({ name: "t", stage: "as-is", records: [...f.records.filter((r) => r !== f.accept), { ...f.accept, refusals: [{ error: f.ROLE_PERMISSION_DENIED, given: "x", when: "never" }] }] });
  const s = standOf(problem, op(problem, "invite.accept"), { waits: never });
  assert.deepEqual([s.stand, s.why.startsWith("operation:invite.accept: refusal-not-produced")], ["specify", true]);
});

const run = (results: readonly { id: string; verdict: "pass" | "fail" | "not_run" }[], commit = "abc1234"): StatusDocument => {
  const parsed = parseResults({ commit, at: "2026-11-10T10:00:00Z", run: "r1", results });
  assert.ok(parsed.ok);
  const merged = mergeResults(asIs, null, parsed.value);
  assert.ok(merged.ok);
  return merged.value;
};

test("the stand climbs with verdicts: build, then observe, never done without a live eval", () => {
  const accept = op(asIs, "invite.accept");
  const { own, under } = evalsUnder(asIs, accept);
  const l1 = [...own, ...under].filter((e) => e.level === "L1").map((e) => e.id);
  assert.ok(l1.length > 5);
  const part = standOf(asIs, accept, { waits: never, status: run(l1.slice(1).map((id) => ({ id, verdict: "pass" }))) });
  assert.equal(part.stand, "build");
  assert.match(part.why, new RegExp(`${l1.length - 1} of ${l1.length} L1 evals pass, 1 do not \\(first: ${l1[0]?.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\)`));
  const failing = standOf(asIs, accept, { waits: never, status: run(l1.map((id, i) => ({ id, verdict: i === 0 ? "fail" : "pass" }))) });
  assert.equal(failing.stand, "build");
  const all = standOf(asIs, accept, { waits: never, status: run(l1.map((id) => ({ id, verdict: "pass" }))) });
  assert.equal(all.stand, "observe");
});

test("an eval of a record under an operation counts toward its stand", () => {
  const accept = op(asIs, "invite.accept");
  const { own, under } = evalsUnder(asIs, accept);
  assert.ok(own.every((e) => e.subject === "operation:invite.accept"));
  assert.ok(under.some((e) => e.id === "tbl:invitations/schema") && under.some((e) => e.id === "trn:invitation.accept"));
  assert.ok(!under.some((e) => e.id === "rpc:organizations.invitations.invite/budget"));
});

test("the status document parses, refuses a malformed one, and refuses an eval the blueprint does not derive", () => {
  assert.ok(parseStatus({ version: 1, evals: { "ret:invite.accept": { verdict: "pass", commit: "abc", at: "2026-11-10T10:00:00Z" } } }).ok);
  for (const bad of [{ version: 2, evals: {} }, { version: 1, evals: { x: { verdict: "green", commit: "abc", at: "2026-11-10T10:00:00Z" } } }, { version: 1, evals: { x: { verdict: "pass", commit: "abc", at: "yesterday" } } }, null])
    assert.ok(!parseStatus(bad).ok);
  assert.deepEqual(unknownEvals(asIs, { version: 1, evals: { "ret:invite.accept": { verdict: "pass", commit: "a", at: "2026-11-10T10:00:00Z" }, "ret:ghost": { verdict: "pass", commit: "a", at: "2026-11-10T10:00:00Z" } } }), ["ret:ghost"]);
  const results = parseResults({ commit: "abc", at: "2026-11-10T10:00:00Z", results: [{ id: "ret:invite.accept", verdict: "pass" }, { id: "ret:ghost", verdict: "pass" }] });
  assert.ok(results.ok);
  const merged = mergeResults(asIs, null, results.value);
  assert.deepEqual(merged, { ok: false, errors: ["ret:ghost: the blueprint derives no such eval"] });
});

test("merging keeps earlier entries, replaces an eval run again, records the run and evidence, and sorts by id", () => {
  const first = run([{ id: "ret:invite.accept", verdict: "fail" }, { id: "doc:invite.accept", verdict: "pass" }]);
  const again = parseResults({ commit: "def5678", at: "2026-11-11T09:00:00Z", run: "r2", results: [{ id: "ret:invite.accept", verdict: "pass", evidence: "evidence/r2/ret.txt" }] });
  assert.ok(again.ok);
  const merged = mergeResults(asIs, first, again.value);
  assert.ok(merged.ok);
  assert.deepEqual(Object.keys(merged.value.evals), ["doc:invite.accept", "ret:invite.accept"]);
  assert.deepEqual(merged.value.evals["ret:invite.accept"], { verdict: "pass", commit: "def5678", at: "2026-11-11T09:00:00Z", claim: "a success prints exactly the returns schema with --json", run: "r2", evidence: "evidence/r2/ret.txt" });
  assert.equal(merged.value.evals["doc:invite.accept"]?.commit, "abc1234");
});

test("a verdict goes stale when its claim changes, when it records no claim, or when its id is no longer derived", () => {
  const doc = run([{ id: "ret:invite.accept", verdict: "pass" }, { id: "doc:invite.accept", verdict: "pass" }]);
  assert.deepEqual(staleEvals(asIs, doc), []);
  const reworded = { ...asIs, evals: asIs.evals.map((e) => (e.id === "ret:invite.accept" ? { ...e, claim: "it prints something else" } : e)) };
  assert.deepEqual(staleEvals(reworded, doc), ["ret:invite.accept"]);
  assert.equal(verdictOf(freshStatus(reworded, doc), "ret:invite.accept"), "not_run");
  assert.equal(verdictOf(freshStatus(reworded, doc), "doc:invite.accept"), "pass");
  const unclaimed = { version: 1 as const, evals: { "doc:invite.accept": { verdict: "pass" as const, commit: "abc1234", at: "2026-11-11T09:00:00Z" } } };
  assert.deepEqual(staleEvals(asIs, unclaimed), ["doc:invite.accept"]);
  const gone = { ...asIs, evals: asIs.evals.filter((e) => e.id !== "doc:invite.accept") };
  assert.deepEqual(staleEvals(gone, doc), ["doc:invite.accept"]);
});

test("a verdict goes stale when only how its claim is observed changes, and an entry that recorded no observes is stale", () => {
  const observed = (observes: string) =>
    buildBlueprint({ name: "test", stage: "as-is", records: [...f.records.map((r) => (r === f.invite ? { ...f.invite, acceptance: [{ claim: "An Owner's invitation is pending and the invitee gets one email.", observes }, null, "A Seat that is not an Owner is refused."] } : r)), decision] });
  const was = observed("cli: prints the invitation");
  const id = "acc:org.member.invite/c-90dd4c9d35059050";
  const results = parseResults({ commit: "abc1234", at: "2026-11-11T09:00:00Z", results: [{ id, verdict: "pass" }] });
  assert.ok(results.ok);
  const merged = mergeResults(was, null, results.value);
  assert.ok(merged.ok);
  assert.equal(merged.value.evals[id]?.observes, "cli: prints the invitation");
  assert.deepEqual(staleEvals(was, merged.value), []);
  const now = observed("cli: prints nothing; read: the mail sink holds one email");
  assert.deepEqual(staleEvals(now, merged.value), [id]);
  assert.equal(verdictOf(freshStatus(now, merged.value), id), "not_run");
  const { observes: _dropped, ...legacy } = merged.value.evals[id]!;
  assert.deepEqual(staleEvals(was, { version: 1, evals: { [id]: legacy } }), [id]);
});
