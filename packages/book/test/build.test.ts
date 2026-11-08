import assert from "node:assert/strict";
import { test } from "node:test";
import { Schema } from "effect";
import { buildBook, defineConcept, defineContract, defineRpc, defineTable } from "../src/index.ts";
import { summaryPage, conceptPage } from "../src/views.ts";
import * as f from "./fixtures/invitations.ts";

const book = (records: readonly unknown[]) => buildBook({ name: "test", stage: "as-is", records });
const rules = (xs: readonly { rule: string }[]) => xs.map((x) => x.rule).sort();

test("the slice builds with no problems", () => {
  const b = book(f.records);
  assert.deepEqual(b.problems, []);
});

test("gaps are derived: the list rpc has no operation", () => {
  const b = book(f.records);
  assert.deepEqual(
    b.gaps.map((g) => `${g.record} ${g.rule}`),
    ["rpc:organizations.invitations.list unused-rpc"],
  );
});

test("transitions, calls and links are registered and reversed", () => {
  const b = book(f.records);
  assert.ok(b.records.has("transition:invitation.accept"));
  assert.ok(b.records.has("call:mail.send"));
  const writers = (b.linkedBy.get("table:invitations") ?? []).filter((l) => l.field === "writes").map((l) => l.from).sort();
  assert.deepEqual(writers, ["rpc:organizations.invitations.accept", "rpc:organizations.invitations.invite", "workflow:organizations.invitations.expire"]);
});

test("evals are derived from records, and a retired acceptance line keeps its number", () => {
  const ids = book(f.records).evals.map((e) => e.id);
  for (const id of [
    "acc:org.member.invite/1",
    "acc:org.member.invite/3",
    "ref:org.member.invite/ROLE_PERMISSION_DENIED",
    "evt:org.member.invite/invitation_sent",
    "evt:invite.accept/invitation_accepted",
    "rpc:organizations.invitations.accept/budget",
    "flw:organizations.accept-invitation/spans",
    "prc:access.grant-seat/atomic",
    "bud:org.member.invite/p95",
    "trn:invitation.expire",
    "wfl:organizations.invitations.expire/idempotent",
    "int:mail.send/PROVIDER_UNAVAILABLE",
    "jrn:join_organization",
    "inv:one-open-invitation",
    "sys:loc/organizations",
    "env:devnet/boot",
    "tbl:invitations/tenancy",
    "sys:generated",
  ])
    assert.ok(ids.includes(id), id);
  assert.ok(!ids.includes("acc:org.member.invite/2"));
});

test("a missing record is a dangling link", () => {
  const b = book(f.records.filter((r) => r !== f.mail));
  assert.ok(rules(b.problems).includes("dangling"));
});

test("writing another concept's table breaks the boundary; invoking its procedure does not", () => {
  const bad = defineRpc({ ...f.acceptRpc, id: "organizations.bad", writes: [f.invitations, f.grants], invokes: [] });
  assert.deepEqual(rules(book([...f.records, bad]).problems), ["write-boundary"]);
});

test("invoking a procedure of a concept it does not depend on is a problem", () => {
  const books = defineConcept({ id: "books", title: "Books", about: "x", component: f.backend, dependsOn: [] });
  const bad = defineRpc({ ...f.listRpc, id: "books.bad", concept: books, reads: [], invokes: [f.grantSeat] });
  assert.deepEqual(rules(book([...f.records, books, bad]).problems), ["invoke-boundary"]);
});

test("driving a transition without writing its table is a problem; so is an unmapped call failure", () => {
  const bad = defineRpc({ ...f.inviteRpc, id: "organizations.bad", writes: [], errors: [f.NOT_AUTHENTICATED] });
  assert.deepEqual(rules(book([...f.records, bad]).problems), ["call-error-not-declared", "drives-without-write"]);
});

test("a refusal its implementation cannot produce is a problem", () => {
  const bad = { ...f.accept, id: "invite.bad", refusals: [{ error: f.ROLE_PERMISSION_DENIED, given: "x", when: "never" }] };
  assert.deepEqual(rules(book([...f.records, bad]).problems), ["refusal-not-produced"]);
});

test("a dependency cycle between concepts is a problem", () => {
  const a = defineConcept({ id: "a", title: "A", about: "x", component: f.backend, dependsOn: [f.organizations] });
  const orgs = { ...f.organizations, dependsOn: [f.access, a] };
  const b = book([...f.records.filter((r) => r !== f.organizations), orgs, a]);
  assert.ok(rules(b.problems).includes("cycle"));
});

test("a record whose fields break its schema is refused when defined", () => {
  assert.throws(() => defineTable({ ...f.invitations, id: "Bad Id", fields: Schema.Struct({}) }));
});

test("views render", () => {
  const b = book(f.records);
  assert.match(summaryPage(b), /stateDiagram|flowchart LR/);
  assert.match(conceptPage(b, f.organizations), /pending --> accepted: accept/);
});

test("a target book enforces the accepted policies", () => {
  const b = buildBook({ name: "test", stage: "target", records: f.records });
  const found = new Set(b.problems.map((p) => p.rule));
  for (const rule of ["acceptance-claim", "tenant-key", "one-event-per-machine", "unreached-rpc", "budget-override-why"])
    assert.ok(found.has(rule), rule);
  // the same records as an as-is book break none of them
  const asIs = new Set(book(f.records).problems.map((p) => p.rule));
  assert.equal([...asIs].length, 0);
});

test("a target workflow can be one durable process per row, resumed by signals", () => {
  const process = { ...f.expire, id: "organizations.invitations.lifecycle", trigger: { transition: f.lifecycle.t.send }, instance: { per: f.invitations }, signals: [f.listRpc], waits: [{ name: "answer", for: "person", timeoutMs: 1_209_600_000, about: "The invitee answers within 14 days." }] };
  const b = buildBook({ name: "test", stage: "target", records: [...f.records, process] });
  assert.ok(!b.problems.some((p) => p.record === "rpc:organizations.invitations.list" && p.rule === "unreached-rpc"));
  // its budget eval counts system time only: the person's wait is excluded
  const bud = b.evals.find((e) => e.id === "bud:organizations.invitations.lifecycle/p95");
  assert.match(bud?.claim ?? "", /excluding its waits \(wait\.answer, chain\.confirm\)/);
});

test("a flow only another surface calls is no unused-flow gap; one that implements an operation must serve the cli", () => {
  const pageFlow = { ...f.acceptFlow, id: "organizations.accept-on-page", sdk: "client.invitations.acceptOnPage", surfaces: ["react"] as const };
  const plainFlow = { ...f.acceptFlow, id: "organizations.accept-unused", sdk: "client.invitations.acceptUnused" };
  const b = book([...f.records, pageFlow, plainFlow]);
  const unused = b.gaps.filter((g) => g.rule === "unused-flow").map((g) => g.record);
  assert.ok(!unused.includes("flow:organizations.accept-on-page"));
  assert.ok(unused.includes("flow:organizations.accept-unused"));
  // the fixture's CLI flow named as a web-only flow breaks the target rule
  const misnamed = { ...f.acceptFlow, surfaces: ["react"] as const };
  const t = buildBook({ name: "test", stage: "target", records: [...f.records.filter((r) => r !== f.acceptFlow), misnamed] });
  assert.ok(t.problems.some((p) => p.rule === "flow-surface" && p.record === "flow:organizations.accept-invitation"));
});

test("a wait that names a chain event consumes it", () => {
  const chain = defineContract({
    id: "seats",
    title: "Seats",
    about: "A test contract.",
    functions: {},
    events: { SeatTaken: { signature: "SeatTaken(address safe)", about: "A Seat was taken." }, SeatLeft: { signature: "SeatLeft(address safe)", about: "A Seat was left." } },
  });
  const process = { ...f.expire, id: "organizations.invitations.seated", waits: [{ name: "seated", for: "indexer", events: [chain.e.SeatTaken], about: "Ponder indexes the Seat, keyed by the Safe." }] };
  const b = book([...f.records, chain, process]);
  const unconsumed = b.gaps.filter((g) => g.rule === "unconsumed-chain-event").map((g) => g.record);
  assert.deepEqual(unconsumed, ["chainEvent:seats.SeatLeft"]);
  assert.deepEqual(b.problems, []);
});
