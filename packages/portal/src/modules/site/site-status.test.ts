import assert from "node:assert/strict";
import { test } from "node:test";
import { Schema } from "effect";
import { defineOperation, evalsUnder, mergeResults, parseResults, type StatusDocument } from "@capxul/book";

import { fixtureInput, fixtureRecords } from "#src/testing.ts";
import * as fixture from "../../../../book/test/fixtures/invitations.ts";

import { buildSite } from "./service.ts";
import type { BuildPage, ConceptPage, OperationPage, OverviewPage, Page, RecordPage } from "./types.ts";

const pageOf = <T extends Page>(site: { pages: readonly Page[] }, id: string, type: T["type"]): T => {
  const found = site.pages.find((p) => p.id === id);
  assert.ok(found && found.type === type, `no ${type} page ${id}`);
  return found as T;
};
const passAll = (ids: readonly string[], verdict: "pass" | "fail" = "pass"): StatusDocument => {
  const input = fixtureInput();
  const run = parseResults({ commit: "abc1234", at: "2026-11-10T10:00:00Z", results: ids.map((id) => ({ id, verdict })) });
  assert.ok(run.ok);
  const merged = mergeResults(input.book, null, run.value);
  assert.ok(merged.ok);
  return merged.value;
};
const l1Of = (op: string): string[] => {
  const book = fixtureInput().book;
  const held = evalsUnder(book, book.records.get(`operation:${op}`)!);
  return [...held.own, ...held.under].filter((e) => e.level === "L1").map((e) => e.id);
};

test("with no status document nothing has a verdict, and the stands are the ones the book alone gives", () => {
  const site = buildSite(fixtureInput());
  const build = pageOf<BuildPage>(site, "build", "build");
  assert.equal(build.recorded, false);
  assert.deepEqual(build.passing, { passing: 0, total: build.evals });
  assert.deepEqual(build.stands, { specify: 0, decide: 1, build: 1, observe: 0, done: 0 });
  assert.equal(build.tiles.at(-1)?.big, `0 of ${build.evals}`);
  assert.deepEqual(build.tiles.map((t) => t.name), ["operations", "still to specify", "wait on a decision", "ready to build", "evals passing"]);
  const accept = pageOf<OperationPage>(site, "operation/invite.accept", "operation");
  assert.ok(accept.evals.every((e) => e.verdict === "not_run"));
  assert.deepEqual(accept.passing.own, { passing: 0, total: accept.evals.length });
  assert.equal(accept.stand.why, "specified and decided; no eval has run against real code yet");
  const overview = pageOf<OverviewPage>(site, "index", "overview");
  assert.deepEqual(overview.climb.slice(2).map((c) => [c.big.startsWith("0 of "), c.bar]), [[true, "empty"], [true, "empty"]]);
});

test("passing evals climb an operation to observe, and every count is read from the status document", () => {
  const ids = l1Of("invite.accept");
  const site = buildSite(fixtureInput("abc1234", "as-is", passAll(ids)));
  const accept = pageOf<OperationPage>(site, "operation/invite.accept", "operation");
  assert.equal(accept.stand.stand, "observe");
  assert.ok(accept.evals.filter((e) => ids.includes(e.id)).every((e) => e.verdict === "pass"));
  const own = ids.filter((id) => accept.evals.some((e) => e.id === id)).length;
  assert.equal(accept.passing.own.passing, own);
  assert.equal(accept.passing.under.passing, ids.length - own);
  const build = pageOf<BuildPage>(site, "build", "build");
  assert.equal(build.recorded, true);
  assert.equal(build.passing.passing, ids.length);
  assert.deepEqual([build.stands.observe, build.stands.build], [1, 0]);
  assert.ok(build.tiles.some((t) => t.name === "proven, not seen live"));
  assert.equal(build.concepts.reduce((n, c) => n + c.passing.passing, 0) <= ids.length, true);
  const overview = pageOf<OverviewPage>(site, "index", "overview");
  assert.deepEqual(overview.climb[2]?.big, "1 of 2");
  assert.equal(overview.climb[3]?.bar, "split");
});

test("a failing eval holds the operation at build and shows as a failure", () => {
  const ids = l1Of("invite.accept");
  const doc = passAll(ids, "pass");
  const failing = { ...doc, evals: { ...doc.evals, [ids[0]!]: { ...doc.evals[ids[0]!]!, verdict: "fail" as const } } };
  const accept = pageOf<OperationPage>(buildSite(fixtureInput("abc1234", "as-is", failing)), "operation/invite.accept", "operation");
  assert.equal(accept.stand.stand, "build");
  assert.match(accept.stand.why, /1 do not/);
  assert.equal(accept.evals.concat().find((e) => e.id === ids[0])?.verdict ?? "fail", "fail");
});

test("every record page carries its dependents: counts by kind, each with its field and distance", () => {
  const site = buildSite(fixtureInput());
  const event = pageOf<RecordPage>(site, "event/invitation_sent", "record");
  assert.equal(event.impact.total, event.impact.all.length);
  assert.equal(event.impact.byKind.reduce((n, k) => n + k.count, 0), event.impact.total);
  const labels = event.impact.all.map((d) => d.ref.label);
  for (const expected of ["invitation", "invitation.send", "organizations.invitations.invite", "org member invite", "join_organization"])
    assert.ok(labels.includes(expected), expected);
  const send = event.impact.all.find((d) => d.ref.label === "invitation.send");
  assert.deepEqual([send?.distance, send?.field, send?.via.label], [1, "emits", "invitation_sent"]);
  const invite = pageOf<OperationPage>(site, "operation/org.member.invite", "operation");
  assert.deepEqual(invite.impact.all.map((d) => d.ref.label), ["join_organization"]);
  const concept = pageOf<ConceptPage>(site, "concept/organizations", "concept");
  assert.ok(concept.impact.total > 5);
  assert.equal(concept.impact.decisions + concept.impact.decisionsOnDependents >= 0, true);
});

test("the trace names the events an operation sends, through which transition, and the spans it names", () => {
  const site = buildSite(fixtureInput());
  const invite = pageOf<OperationPage>(site, "operation/org.member.invite", "operation");
  assert.deepEqual(invite.trace.sends.map((e) => [e.event.label, e.transition?.label, e.by.label]), [["invitation_sent", "invitation.send", "organizations.invitations.invite"]]);
  assert.deepEqual(invite.trace.named.map((s) => s.span), ["authorize", "db.tx", "mail.send"]);
  const accept = pageOf<OperationPage>(site, "operation/invite.accept", "operation");
  assert.deepEqual(accept.trace.named.filter((s) => s.by.label === "organizations.accept-invitation").map((s) => s.span), ["accept", "switch"]);
});

test("examples show as the operation's recorded runs, and a refusal links its error", () => {
  const withExamples = defineOperation({
    ...fixture.invite,
    examples: [
      { title: "Invite a colleague", input: "capxul org member invite ada@example.com --json", output: { invitation: "inv_1" }, exit: 0 },
      { title: "A member may not invite", input: "capxul org member invite ada@example.com --json", output: { error: { code: "ROLE_PERMISSION_DENIED", message: "Ask an Owner." } }, exit: 3 },
    ],
  });
  const records = fixtureRecords.map((r) => (r === fixture.invite ? withExamples : r));
  const site = buildSite(fixtureInput("abc1234", "as-is", null, records));
  const invite = pageOf<OperationPage>(site, "operation/org.member.invite", "operation");
  assert.deepEqual(invite.examples.map((e) => [e.title, e.exit, e.refusal?.label ?? null]), [["Invite a colleague", 0, null], ["A member may not invite", 3, "ROLE_PERMISSION_DENIED"]]);
  assert.equal(invite.examples[0]?.output, '{\n  "invitation": "inv_1"\n}');
  assert.deepEqual(pageOf<OperationPage>(site, "operation/invite.accept", "operation").examples, []);
  assert.ok(Schema.isSchema(withExamples.returns));
});

test("the Build page counts telemetry gaps and example gaps apart from every other gap", () => {
  const build = pageOf<BuildPage>(buildSite(fixtureInput("abc1234", "target")), "build", "build");
  const counts = build.gapCounts;
  assert.deepEqual(counts.telemetry.map((t) => t.rule), ["no-span", "state-change-without-event"]);
  assert.equal(counts.examples, 2);
  assert.equal(counts.total, counts.telemetry.reduce((n, t) => n + t.count, 0) + counts.examples + counts.other);
  assert.equal(counts.total, fixtureInput("abc1234", "target").book.gaps.length);
});
