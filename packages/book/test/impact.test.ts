import assert from "node:assert/strict";
import { test } from "node:test";
import { buildBook, defineDecision, impactOf, impactIndex } from "../src/index.ts";
import * as f from "./fixtures/invitations.ts";

const decision = defineDecision({
  id: "access.who-invites", title: "Who invites", question: "Who may invite?",
  options: [{ label: "owners", text: "Owners." }, { label: "admins", text: "Admins." }], chosen: "owners",
  why: "Grants are an Owner's.", source: "The fixture.", affects: [f.inviteRpc],
});
const book = buildBook({ name: "test", stage: "target", records: [...f.records, decision] });
const keys = (xs: readonly { key: string }[]) => xs.map((x) => x.key);

test("an event's dependents are the transitions that send it and what runs them, not the machine's other transitions", () => {
  const i = impactOf(book, "event:invitation_sent");
  assert.ok(i);
  const k = keys(i.dependents);
  for (const expected of ["machine:invitation", "transition:invitation.send", "rpc:organizations.invitations.invite", "operation:org.member.invite", "journey:join_organization"])
    assert.ok(k.includes(expected), expected);
  assert.ok(!k.includes("transition:invitation.accept"), "the accept transition does not send invitation_sent");
  assert.ok(!k.includes("rpc:organizations.invitations.accept"));
});

test("distance and the linking field are reported", () => {
  const i = impactOf(book, "event:invitation_sent");
  const by = (key: string) => i?.dependents.find((d) => d.key === key);
  assert.deepEqual([by("transition:invitation.send")?.distance, by("transition:invitation.send")?.field], [1, "emits"]);
  assert.deepEqual([by("rpc:organizations.invitations.invite")?.distance, by("rpc:organizations.invitations.invite")?.field, by("rpc:organizations.invitations.invite")?.via], [2, "drives", "transition:invitation.send"]);
  assert.equal(by("operation:org.member.invite")?.distance, 3);
  assert.ok(i?.dependents.every((d, n, all) => n === 0 || (all[n - 1]?.distance ?? 0) <= d.distance), "nearest first");
});

test("a table reaches its machine's transitions through the machine", () => {
  const k = keys(impactOf(book, "table:invitations")?.dependents ?? []);
  for (const expected of ["machine:invitation", "transition:invitation.accept", "rpc:organizations.invitations.accept", "workflow:organizations.invitations.expire", "flow:organizations.accept-invitation", "invariant:one-open-invitation"])
    assert.ok(k.includes(expected), expected);
});

test("a call's error reaches the calls that fail with it, then the rpcs that call them", () => {
  const k = keys(impactOf(book, "error:PROVIDER_UNAVAILABLE")?.dependents ?? []);
  for (const expected of ["call:mail.send", "rpc:organizations.invitations.invite", "operation:org.member.invite"]) assert.ok(k.includes(expected), expected);
});

test("depth limits the walk", () => {
  const i = impactOf(book, "event:invitation_sent", { depth: 2 });
  assert.equal(i?.depth, 2);
  assert.ok(Math.max(...(i?.dependents.map((d) => d.distance) ?? [0])) <= 2);
  assert.ok(!keys(i?.dependents ?? []).includes("operation:org.member.invite"));
});

test("decisions are kept out of the dependents and listed apart", () => {
  const i = impactOf(book, "rpc:organizations.invitations.invite");
  assert.ok(!keys(i?.dependents ?? []).some((k) => k.startsWith("decision:")));
  assert.deepEqual(keys(i?.decisions.direct ?? []), ["decision:access.who-invites"]);
  const above = impactOf(book, "table:invitations");
  assert.deepEqual(keys(above?.decisions.onDependents ?? []), ["decision:access.who-invites"]);
  assert.deepEqual(above?.decisions.direct, []);
});

test("a decision's impact is what it names and what depends on that", () => {
  const i = impactOf(book, "decision:access.who-invites");
  assert.deepEqual(i?.dependents.filter((d) => d.distance === 1).map((d) => [d.key, d.field]), [["rpc:organizations.invitations.invite", "affects"]]);
  assert.ok(keys(i?.dependents ?? []).includes("operation:org.member.invite"));
});

test("the evals of the subject and every dependent are listed", () => {
  const ids = impactOf(book, "event:invitation_sent")?.evals.map((e) => e.id) ?? [];
  for (const id of ["acc:org.member.invite/1", "rpc:organizations.invitations.invite/budget", "trn:invitation.send", "jrn:join_organization"]) assert.ok(ids.includes(id), id);
  assert.ok(!ids.includes("rpc:organizations.invitations.accept/budget"));
});

test("counts by kind add up; an unknown record has no impact; a prebuilt index gives the same answer", () => {
  const i = impactOf(book, "table:invitations");
  assert.equal(Object.values(i?.byKind ?? {}).reduce((a, b) => a + b, 0), i?.dependents.length);
  assert.equal(impactOf(book, "table:nothing"), null);
  assert.deepEqual(impactOf(book, "table:invitations", { index: impactIndex(book) }), i);
});
