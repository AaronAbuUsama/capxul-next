import assert from "node:assert/strict";
import { test } from "node:test";
import { Schema } from "effect";
import { argsOf, buildBlueprint, defineConcept, defineContract, defineRpc, defineTable } from "../src/index.ts";
import { summaryPage, conceptPage } from "../src/views.ts";
import * as f from "./fixtures/invitations.ts";

const blueprint = (records: readonly unknown[]) => buildBlueprint({ name: "test", stage: "as-is", records });
const rules = (xs: readonly { rule: string }[]) => xs.map((x) => x.rule).sort();

test("the slice builds with no problems", () => {
  const b = blueprint(f.records);
  assert.deepEqual(b.problems, []);
});

test("gaps are derived: the list rpc has no operation", () => {
  const b = blueprint(f.records);
  assert.deepEqual(
    b.gaps.map((g) => `${g.record} ${g.rule}`),
    ["rpc:organizations.invitations.list unused-rpc"],
  );
});

test("transitions, calls and links are registered and reversed", () => {
  const b = blueprint(f.records);
  assert.ok(b.records.has("transition:invitation.accept"));
  assert.ok(b.records.has("call:mail.send"));
  const writers = (b.linkedBy.get("table:invitations") ?? []).filter((l) => l.field === "writes").map((l) => l.from).sort();
  assert.deepEqual(writers, ["rpc:organizations.invitations.accept", "rpc:organizations.invitations.invite", "workflow:organizations.invitations.expire"]);
});

test("evals are derived from records, and a retired acceptance line keeps its number", () => {
  const ids = blueprint(f.records).evals.map((e) => e.id);
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
  const b = blueprint(f.records.filter((r) => r !== f.mail));
  assert.ok(rules(b.problems).includes("dangling"));
});

test("writing another concept's table breaks the boundary; invoking its procedure does not", () => {
  const bad = defineRpc({ ...f.acceptRpc, id: "organizations.bad", writes: [f.invitations, f.grants], invokes: [] });
  assert.deepEqual(rules(blueprint([...f.records, bad]).problems), ["write-boundary"]);
});

test("invoking a procedure of a concept it does not depend on is a problem", () => {
  const books = defineConcept({ id: "books", title: "Books", about: "x", component: f.backend, dependsOn: [] });
  const bad = defineRpc({ ...f.listRpc, id: "books.bad", concept: books, reads: [], invokes: [f.grantSeat] });
  assert.deepEqual(rules(blueprint([...f.records, books, bad]).problems), ["invoke-boundary"]);
});

test("driving a transition without writing its table is a problem; so is an unmapped call failure", () => {
  const bad = defineRpc({ ...f.inviteRpc, id: "organizations.bad", writes: [], errors: [f.NOT_AUTHENTICATED] });
  assert.deepEqual(rules(blueprint([...f.records, bad]).problems), ["call-error-not-declared", "drives-without-write"]);
});

test("a refusal its implementation cannot produce is a problem", () => {
  const bad = { ...f.accept, id: "invite.bad", refusals: [{ error: f.ROLE_PERMISSION_DENIED, given: "x", when: "never" }] };
  assert.deepEqual(rules(blueprint([...f.records, bad]).problems), ["refusal-not-produced"]);
});

test("a dependency cycle between concepts is a problem", () => {
  const a = defineConcept({ id: "a", title: "A", about: "x", component: f.backend, dependsOn: [f.organizations] });
  const orgs = { ...f.organizations, dependsOn: [f.access, a] };
  const b = blueprint([...f.records.filter((r) => r !== f.organizations), orgs, a]);
  assert.ok(rules(b.problems).includes("cycle"));
});

test("a record whose fields break its schema is refused when defined", () => {
  assert.throws(() => defineTable({ ...f.invitations, id: "Bad Id", fields: Schema.Struct({}) }));
});

test("views render", () => {
  const b = blueprint(f.records);
  assert.match(summaryPage(b), /stateDiagram|flowchart LR/);
  assert.match(conceptPage(b, f.organizations), /pending --> accepted: accept/);
});

test("a blueprint enforces the accepted policies", () => {
  const b = buildBlueprint({ name: "test", stage: "target", records: f.records });
  const found = new Set(b.problems.map((p) => p.rule));
  for (const rule of ["acceptance-claim", "tenant-key", "one-event-per-machine", "unreached-rpc", "budget-override-why"])
    assert.ok(found.has(rule), rule);
  // the same records as an as-is book break none of them
  const asIs = new Set(blueprint(f.records).problems.map((p) => p.rule));
  assert.equal([...asIs].length, 0);
});

test("a target workflow can be one durable process per row, resumed by signals", () => {
  const process = { ...f.expire, id: "organizations.invitations.lifecycle", trigger: { transition: f.lifecycle.t.send }, instance: { per: f.invitations }, signals: [f.listRpc], waits: [{ name: "answer", for: "person", timeoutMs: 1_209_600_000, about: "The invitee answers within 14 days." }] };
  const b = buildBlueprint({ name: "test", stage: "target", records: [...f.records, process] });
  assert.ok(!b.problems.some((p) => p.record === "rpc:organizations.invitations.list" && p.rule === "unreached-rpc"));
  // its budget eval counts system time only: the person's wait is excluded
  const bud = b.evals.find((e) => e.id === "bud:organizations.invitations.lifecycle/p95");
  assert.match(bud?.claim ?? "", /excluding its waits \(wait\.answer, chain\.confirm\)/);
});

test("a flow only another surface calls is no unused-flow gap; one that implements an operation must serve the cli", () => {
  const pageFlow = { ...f.acceptFlow, id: "organizations.accept-on-page", sdk: "client.invitations.acceptOnPage", surfaces: ["react"] as const };
  const plainFlow = { ...f.acceptFlow, id: "organizations.accept-unused", sdk: "client.invitations.acceptUnused" };
  const b = blueprint([...f.records, pageFlow, plainFlow]);
  const unused = b.gaps.filter((g) => g.rule === "unused-flow").map((g) => g.record);
  assert.ok(!unused.includes("flow:organizations.accept-on-page"));
  assert.ok(unused.includes("flow:organizations.accept-unused"));
  // the fixture's CLI flow named as a web-only flow breaks the target rule
  const misnamed = { ...f.acceptFlow, surfaces: ["react"] as const };
  const t = buildBlueprint({ name: "test", stage: "target", records: [...f.records.filter((r) => r !== f.acceptFlow), misnamed] });
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
  const b = blueprint([...f.records, chain, process]);
  const unconsumed = b.gaps.filter((g) => g.rule === "unconsumed-chain-event").map((g) => g.record);
  assert.deepEqual(unconsumed, ["chainEvent:seats.SeatLeft"]);
  assert.deepEqual(b.problems, []);
});

test("a wait's key names what wakes it and properties that carrier carries", () => {
  const chain = defineContract({
    id: "seats",
    title: "Seats",
    about: "A test contract.",
    functions: {},
    events: { SeatTaken: { signature: "SeatTaken(address indexed safe, (uint256,address) seat, uint256 id)", about: "A Seat was taken." } },
  });
  const wait = (w: object) => ({ ...f.expire, id: "organizations.invitations.answer", trigger: { transition: f.lifecycle.t.send }, instance: { per: f.invitations }, signals: [f.acceptRpc], waits: [w] });
  const good = wait({
    name: "answer",
    for: "person",
    key: [
      { on: [f.acceptRpc], props: ["invitation"] },
      { on: [f.invitationSent], props: ["role"] },
      { on: [chain.e.SeatTaken], props: ["chain_id", "safe", "seat"] },
      { on: [f.invitations], props: ["organizationId"], reaches: "state" },
    ],
    about: "The invitee answers.",
  });
  const b = blueprint([...f.records, chain, good]);
  assert.deepEqual(b.problems, []);
  assert.ok(b.evals.some((e) => e.id === "wfl:organizations.invitations.answer/wake/answer"));
  // a key on a chain event consumes it
  assert.ok(!b.gaps.some((g) => g.record === "chainEvent:seats.SeatTaken"));
  for (const [bad, why] of [
    [{ name: "answer", for: "person", key: [{ on: [f.invitationSent], props: ["invitation_id"] }], about: "x" }, "a prop its event lacks"],
    [{ name: "answer", for: "person", key: [{ on: [f.listRpc], props: ["organization"] }], about: "x" }, "an rpc that is not a signal"],
    [{ name: "answer", for: "person", key: [{ on: [f.mail.c.send], props: ["to"] }], about: "x" }, "a call the workflow does not make"],
    [{ name: "answer", for: "timer", key: [{ on: [f.invitationSent], props: ["role"] }], about: "x" }, "a key on a timer"],
    [{ name: "answer", for: "indexer", key: [{ on: [chain.e.SeatTaken], props: ["seat_id"] }], about: "x" }, "an argument the signature lacks"],
  ] as const)
    assert.deepEqual(rules(blueprint([...f.records, chain, wait(bad)]).problems), ["wait-key"], why);
  // a signal that writes the instance's row knows its columns; one that touches neither its row nor its table does not
  const byRow = wait({ name: "answer", for: "person", key: [{ on: [f.acceptRpc], props: ["role"] }], about: "x" });
  assert.deepEqual(blueprint([...f.records, byRow]).problems, []);
  const nudge = defineRpc({ ...f.acceptRpc, id: "organizations.invitations.nudge", reads: [], writes: [], drives: [], invokes: [] });
  const blind = { ...wait({ name: "answer", for: "person", key: [{ on: [nudge], props: ["role"] }], about: "x" }), signals: [nudge] };
  assert.deepEqual(rules(blueprint([...f.records, nudge, blind]).problems), ["wait-key"]);
});

test("a target wait other than a timer names its key; the as-is book is not held to it", () => {
  const process = { ...f.expire, id: "organizations.invitations.answer", signals: [f.acceptRpc], waits: [{ name: "answer", for: "signal", about: "x" }, { name: "lapse", for: "timer", about: "x" }] };
  const t = buildBlueprint({ name: "test", stage: "target", records: [...f.records, process] });
  assert.deepEqual(t.problems.filter((p) => p.rule === "wait-without-key").map((p) => p.detail), ["wait answer (signal) names no key: what wakes it, and by which properties"]);
  assert.ok(!blueprint([...f.records, process]).problems.some((p) => p.rule === "wait-without-key"));
});

test("an admission is one policy clause over the table's own columns, and yields its eval", () => {
  const admits = [
    { match: "email", field: "email", reads: true, writes: true, about: "The invitee reads and answers their own invitation." },
    { match: "anyone", where: { state: "pending" }, reads: true, writes: false, about: "A pending invitation is public." },
  ] as const;
  const invitations = defineTable({ ...f.invitations, admits });
  const b = blueprint([...f.records.filter((r) => r !== f.invitations), invitations]);
  assert.deepEqual(b.problems, []);
  const evals = b.evals.filter((e) => e.id.startsWith("tbl:invitations/admits/")).map((e) => e.id);
  assert.deepEqual(evals, ["tbl:invitations/admits/1", "tbl:invitations/admits/2"]);
  assert.match(b.evals.find((e) => e.id === "tbl:invitations/tenancy")?.claim ?? "", /unless an admission names it/);
  // a join: a grant is admitted to whoever its Organization's invitation is addressed to
  const grants = defineTable({ ...f.grants, admits: [{ match: "email", field: "organizationId", via: { table: f.invitations, on: "organizationId", field: "email" }, reads: true, writes: false, about: "x" }] });
  assert.deepEqual(blueprint([...f.records.filter((r) => r !== f.grants), grants]).problems, []);
  for (const [bad, why] of [
    [{ match: "email", field: "invitee", reads: true, writes: false, about: "x" }, "a column the table lacks"],
    [{ match: "anyone", field: "person", reads: true, writes: false, about: "x" }, "anyone by a column"],
    [{ match: "safe", reads: true, writes: false, about: "x" }, "a match with no column"],
    [{ match: "email", field: "person", kindField: "role", reads: true, writes: false, about: "x" }, "a kind column off a tenant match"],
    [{ match: "email", field: "person", where: { status: "open" }, reads: true, writes: false, about: "x" }, "a where on a column it lacks"],
    [{ match: "email", field: "organizationId", via: { table: f.invitations, on: "organizationId", field: "mailbox" }, reads: true, writes: false, about: "x" }, "a join to a column the other table lacks"],
    [{ match: "email", field: "person", where: { role: 1 }, reads: true, writes: false, about: "x" }, "a where value its column cannot hold"],
    [{ match: "anyone", where: { role: "guest" }, reads: true, writes: true, about: "x" }, "anyone writing"],
    [{ match: "email", field: "person", reads: false, writes: false, about: "x" }, "a clause that admits nothing"],
  ] as const) {
    const t = defineTable({ ...f.grants, admits: [bad] });
    assert.deepEqual(rules(blueprint([...f.records.filter((r) => r !== f.grants), t]).problems), ["admission"], why);
  }
  const global = defineTable({ ...f.grants, tenancy: "global", admits: [admits[1]] });
  assert.ok(rules(blueprint([...f.records.filter((r) => r !== f.grants), global]).problems).includes("admission"));
});

test("a target chain table's policy is its admissions; prose that admits with no admission is a gap", () => {
  const chainTable = (admits?: readonly object[]) =>
    defineTable({ ...f.grants, id: "seat-logs", tenancy: "chain", key: ["person"], indexes: [], ...(admits ? { admits } : {}) } as never);
  const target = (t: unknown) => buildBlueprint({ name: "test", stage: "target", records: [...f.records, t] }).problems.filter((p) => p.rule === "chain-admits").length;
  assert.equal(target(chainTable()), 1);
  assert.equal(target(chainTable([{ match: "safe", field: "person", reads: true, writes: false, about: "x" }])), 0);
  assert.equal(target(chainTable([{ match: "safe", field: "person", reads: true, writes: true, about: "x" }])), 1);
  const prose = defineTable({ ...f.invitations, scope: "The Organization's; the invitee reads their own by email." });
  const gaps = (stage: "as-is" | "target", t: unknown) =>
    buildBlueprint({ name: "test", stage, records: [...f.records.filter((r) => r !== f.invitations), t] }).gaps.filter((g) => g.rule === "admission-in-prose").length;
  assert.equal(gaps("target", prose), 1);
  assert.equal(gaps("as-is", prose), 0);
  assert.equal(gaps("target", defineTable({ ...prose, admits: [{ match: "email", field: "email", reads: true, writes: false, about: "x" }] })), 0);
});

test("a chain event's arguments are read from its signature, tuples and arrays included", () => {
  assert.deepEqual(argsOf("RoundClosed(uint256 indexed roundId, Adjustment[] adjustments)"), ["roundId", "adjustments"]);
  assert.deepEqual(argsOf("Seat((uint256,address) seat, address indexed safe)"), ["seat", "safe"]);
  assert.deepEqual(argsOf("ProposalExecuted(uint256 proposalId)"), ["proposalId"]);
});
