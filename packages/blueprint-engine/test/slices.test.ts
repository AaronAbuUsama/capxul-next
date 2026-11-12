import assert from "node:assert/strict";
import { test } from "node:test";
import { buildBlueprint, defineContract, defineJourney, defineRole, defineScreen, keyOf, mergeResults, sliceEvidence, slicesOf, sliceZeroRequired, underOf, type SliceRun } from "../src/index.ts";
import * as f from "./fixtures/invitations.ts";

const chain = defineContract({ id: "mail-chain", title: "Mail chain", about: "A fixture.", functions: { send: { signature: "send()", about: "Send." } },
  events: { Sent: { signature: "Sent()", about: "Sent." }, Unrelated: { signature: "Unrelated()", about: "Not sent by this path." } } });
const role = defineRole({ id: "owner", title: "Owner", about: "Owns the organization.", concept: f.organizations, frappeRoles: ["System Manager"] });
const screen = defineScreen({ id: "invitations", title: "Invitations", about: "The source values.", surface: "frappe-desk", kind: "list", record: f.invitations, shows: [], who: [role] });
const foundation = defineJourney({ ...f.getInvited, id: "thin_line", steps: [{ operation: f.invite, as: "owner", proves: f.invitationSent, seen: screen }] });
const after = { ...f.expire, id: "after-invite", trigger: { after: f.inviteRpc }, waits: [{ name: "sent", for: "chain", about: "Wait for the explicitly named event.", events: [chain.e.Sent] }] };
const tail = { ...f.expire, id: "after-chain", trigger: { chainEvent: chain.e.Sent } };
const records = [...f.records, foundation, chain, screen, role, after, tail];
const b = buildBlueprint({ name: "slices", stage: "as-is", records });
const conceptOf = new Map([...b.records.values()].flatMap((r) => r.concept ? [[keyOf(r), (r.concept as { id: string }).id] as const] : []));

test("journey reach owns emitted events, seen screens and workflow chain events to closure, not every contract event", () => {
  const reach = underOf(b, b.records.get("journey:thin_line")!).under;
  for (const key of ["event:invitation_sent", "screen:invitations", "table:invitations", "workflow:after-chain", "chainEvent:mail-chain.Sent"]) assert.ok(reach.includes(key), key);
  assert.ok(!reach.includes("chainEvent:mail-chain.Unrelated"));
});

test("slices cover journey reach once, retain the unproved foundation, and are deterministic", () => {
  const manifest = slicesOf(b, { conceptOf });
  assert.deepEqual(manifest, slicesOf(b, { conceptOf }));
  const owned = manifest.slices.flatMap((s) => s.records);
  assert.equal(new Set(owned).size, owned.length);
  const expected = new Set([...b.records.values()].filter((r) => r._kind === "journey").flatMap((j) => underOf(b, j).under.filter((k) => !k.startsWith("journey:"))));
  assert.deepEqual(new Set(owned), expected);
  assert.equal(manifest.slices[0]?.id, "slice-0");
  assert.deepEqual(manifest.slices[0]?.required, sliceZeroRequired(b));
  assert.equal(manifest.slices[0]?.evidence.state, "unproved");
  assert.ok(manifest.slices[0]?.screens.includes("screen:invitations"));
  assert.ok(manifest.slices.some((s) => s.prerequisites.includes("slice-0")));
  assert.ok(manifest.waves.filter((w) => w.id === 1).every((w) => w.concepts.length <= 13));
  assert.ok(manifest.outside.records.includes("chainEvent:mail-chain.Unrelated"));
});

const ids = b.evals.filter((e) => e.subject === "operation:org.member.invite").slice(0, 2).map((e) => e.id);
const run = (id: string, evalIds = ids, state: SliceRun["state"] = "complete"): SliceRun => {
  const status = mergeResults(b, null, { commit: "abc1234", at: `2026-11-12T10:00:0${id}Z`, run: id, results: evalIds.map((id) => ({ id, verdict: "pass" })) });
  assert.ok(status.ok);
  return { id, at: `2026-11-12T10:00:0${id}Z`, commit: "abc1234", state, environment: { world: "fixture", storage: "postgres", indexer: "ponder", stack: "postgres-ponder-erpnext-v4", components: { fixture: "1" } }, requested: ids, screens: [], status: status.value, landed: true };
};

test("completion never unions runs or accepts JSON, zero checks, stale claims, or a later zero-output interruption", () => {
  const complete = run("1");
  assert.equal(sliceEvidence(b, ids, [complete]).state, "proved");
  assert.equal(sliceEvidence(b, [], [complete]).state, "unproved");
  assert.equal(sliceEvidence(b, ids, [{ ...complete, environment: { ...complete.environment, storage: "json" } }]).state, "unproved");
  assert.equal(sliceEvidence(b, ids, [run("1", ids.slice(0, 1)), run("2", ids.slice(1))]).state, "partial");
  assert.equal(sliceEvidence(b, ids, [complete, run("3", [], "running")]).state, "running");
  assert.equal(sliceEvidence(b, ids, [run("3", ids, "incomplete")]).passing, 0);
  assert.equal(sliceEvidence(b, ids, [{ ...complete, id: "another-run" }]).state, "partial");
  assert.equal(sliceEvidence(b, ids, [{ ...complete, commit: "another-commit" }]).state, "partial");
  const reworded = { ...b, evals: b.evals.map((e) => ids.includes(e.id) ? { ...e, claim: "Changed contract." } : e) };
  assert.equal(sliceEvidence(reworded, ids, [complete]).state, "partial");
});

test("screen completion needs a source-equality capture, not only a passing eval", () => {
  const screenId = "scr:invitations/shows";
  const selected = run("1", [screenId]);
  const checked = { ...selected, requested: [screenId] };
  assert.equal(sliceEvidence(b, [screenId], [checked]).state, "partial");
  const capture = { screen: "invitations", path: "capture.png", source: "source.json", assertion: "source-equality" };
  assert.equal(sliceEvidence(b, [screenId], [{ ...checked, screens: [capture] }]).state, "proved");
  assert.equal(sliceEvidence(b, [screenId], [{ ...checked, screens: [{ ...capture, assertion: "only opened it" }] }]).state, "partial");
});

test("remaining work subtracts merged fresh proof, without dropping a slice's identity or catalogue", () => {
  const subject = "operation:org.member.invite";
  const required = b.evals.filter((e) => e.subject === subject && e.level === "L1").map((e) => e.id);
  assert.ok(required.length > 0);
  const proved = { ...run("1", required), requested: required };
  const pending = slicesOf(b, { conceptOf, runs: [{ ...proved, landed: false }] });
  const landed = slicesOf(b, { conceptOf, runs: [proved] });
  assert.ok(pending.slices[0]?.remaining.includes(subject));
  assert.ok(!landed.slices[0]?.remaining.includes(subject));
  assert.ok(landed.proven.includes(subject));
  assert.deepEqual(landed.slices.map((s) => [s.id, s.records]), pending.slices.map((s) => [s.id, s.records]));
  assert.ok(landed.slices[0]?.operations.includes(subject));
});

test("wave one admits thirteen concepts but queues a fourteen-concept journey without dropping its slices", () => {
  for (const count of [13, 14]) {
    const screens = Array.from({ length: count }, (_, i) => defineScreen({ ...screen, id: `wide-${i}` }));
    const wide = defineJourney({ ...f.getInvited, id: "wide", steps: screens.map((seen) => ({ operation: f.invite, as: "owner", proves: f.invitationSent, seen })) });
    const blueprint = buildBlueprint({ name: "wide journey", stage: "as-is", records: [...f.records, role, ...screens, wide] });
    assert.equal(blueprint.problems.length, 0);
    const owners = new Map([...blueprint.records.keys()].map((key) => [key, "shared"]));
    screens.forEach((s, i) => owners.set(keyOf(s), `lane-${i}`));
    const manifest = slicesOf(blueprint, { conceptOf: owners });
    assert.ok(manifest.waves.find((w) => w.id === 1)!.concepts.length <= 13);
    const held = manifest.slices.filter((s) => s.journey === "wide" && s.concept !== "shared");
    assert.equal(held.length, count);
    assert.ok(held.every((s) => s.wave === (count === 13 ? 1 : 2)));
  }
});
