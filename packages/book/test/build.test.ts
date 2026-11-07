import assert from "node:assert/strict";
import { test } from "node:test";
import { Schema } from "effect";
import { buildBook, defineConcept, defineOperation, defineTable } from "../src/index.ts";
import { summaryPage, conceptPage } from "../src/views.ts";
import * as f from "./fixtures/invitations.ts";

const book = (records: readonly unknown[]) => buildBook({ name: "test", stage: "target", records });
const rules = (xs: readonly { rule: string }[]) => xs.map((x) => x.rule).sort();

test("the slice builds with no problems", () => {
  const b = book(f.records);
  assert.deepEqual(b.problems, []);
});

test("gaps are derived: the access concept is empty", () => {
  const b = book(f.records);
  assert.deepEqual(
    b.gaps.map((g) => `${g.record} ${g.rule}`),
    ["concept:access empty-concept"],
  );
});

test("transitions, calls and links are registered and reversed", () => {
  const b = book(f.records);
  assert.ok(b.records.has("transition:invitation.accept"));
  assert.ok(b.records.has("call:mail.send"));
  const writers = (b.linkedBy.get("table:invitations") ?? []).filter((l) => l.field === "writes").map((l) => l.from).sort();
  assert.deepEqual(writers, ["operation:invite.accept", "operation:org.member.invite", "workflow:organizations.invitations.expire"]);
});

test("evals are derived from records, and a retired acceptance line keeps its number", () => {
  const ids = book(f.records).evals.map((e) => e.id);
  for (const id of [
    "acc:org.member.invite/1",
    "acc:org.member.invite/3",
    "ref:org.member.invite/ROLE_PERMISSION_DENIED",
    "evt:org.member.invite/invitation_sent",
    "bud:org.member.invite/p95",
    "trn:invitation.expire",
    "wfl:organizations.invitations.expire/idempotent",
    "int:mail.send/PROVIDER_UNAVAILABLE",
    "jrn:join_organization",
    "inv:one-open-invitation",
    "sys:loc/organizations",
    "env:devnet/boot",
  ])
    assert.ok(ids.includes(id), id);
  assert.ok(!ids.includes("acc:org.member.invite/2"));
});

test("a missing record is a dangling link", () => {
  const b = book(f.records.filter((r) => r !== f.mail));
  assert.ok(rules(b.problems).includes("dangling"));
});

test("a concept writing another concept's table breaks the boundary", () => {
  const books = defineConcept({ id: "books", title: "Books", about: "x", component: f.backend, dependsOn: [] });
  const bad = defineOperation({ ...f.accept, id: "books.bad", concept: books, drives: [] });
  const b = book([...f.records, books, bad]);
  assert.deepEqual(rules(b.problems), ["write-boundary"]);
});

test("driving a transition without writing its table is a problem; so is an undeclared refusal", () => {
  const bad = defineOperation({ ...f.invite, id: "org.member.bad", writes: [], errors: [f.NOT_AUTHENTICATED] });
  assert.deepEqual(rules(book([...f.records, bad]).problems), ["drives-without-write", "refusal-not-declared"]);
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
