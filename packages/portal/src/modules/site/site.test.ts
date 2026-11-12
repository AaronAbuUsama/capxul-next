import assert from "node:assert/strict";
import { test } from "node:test";

import { fixtureInput, WAITING } from "#src/testing.ts";

import { placeholder, skeletonOf, typeScriptOf } from "./internal/skeleton.ts";
import { buildSite, canonical, htmlFile, jsonFile, mdFile, relative } from "./service.ts";
import type { CataloguePage, OperationPage, Page } from "./types.ts";

const site = buildSite(fixtureInput());
const page = (id: string): Page => {
  const found = site.pages.find((p) => p.id === id);
  assert.ok(found, `no page ${id}`);
  return found;
};
const catalogue = (id: string): CataloguePage => {
  const found = page(id);
  assert.equal(found.type, "catalogue");
  return found as CataloguePage;
};
const operation = (id: string): OperationPage => {
  const found = page(`operation/${id}`);
  assert.equal(found.type, "operation");
  return found as OperationPage;
};

test("the six fixed pages come first, then the concepts, then every record with a page", () => {
  assert.deepEqual(site.pages.slice(0, 7).map((p) => p.id), ["index", "review", "design", "build", "docs", "concept/access", "concept/organizations"]);
  const ids = new Set(site.pages.map((p) => p.id));
  assert.equal(ids.size, site.pages.length, "a page id is used twice");
  for (const id of ["operation/org.member.invite", "operation/invite.accept", "machine/invitation.lifecycle", "decision/access.who-invites"]) {
    assert.ok(ids.has(id) || id.startsWith("machine/"), `no page ${id}`);
  }
});

test("a child record is a section on its parent's page, and the system is the Overview", () => {
  const kinds = new Set(site.pages.map((p) => p.id.split("/")[0]));
  for (const kind of ["transition", "call", "function", "chainEvent", "system"]) assert.ok(!kinds.has(kind), `${kind} has a page`);
  const machines = site.pages.flatMap((p) => (p.type === "record" && p.kind === "machine" ? [p] : []));
  assert.ok(machines.length > 0 && machines.every((m) => m.children.length > 0), "a machine page shows no transitions");
});

test("the Questions page lists exactly the decisions that wait", () => {
  const review = page("review");
  assert.equal(review.type, "questions");
  if (review.type !== "questions") return;
  assert.deepEqual(review.questions.map((q) => q.id), [WAITING]);
  const [question] = review.questions;
  assert.equal(question?.chosen, "owners");
  assert.deepEqual(question?.options.map((o) => o.recommended), [true, false]);
  assert.equal(site.waiting, 1);
});

test("an operation stands at specify while it has a problem, at decide while a decision on it waits, else at build", () => {
  assert.equal(operation("org.member.invite").stand.stand, "decide");
  assert.match(operation("org.member.invite").stand.why, /access\.who-invites/);
  assert.equal(operation("invite.accept").stand.stand, "build");
  const unspecified = buildSite(fixtureInput("abc1234", "target")).pages.find((p) => p.id === "operation/org.member.invite");
  assert.ok(unspecified?.type === "operation");
  assert.equal(unspecified.stand.stand, "specify");
  assert.match(unspecified.stand.why, /budget-override-why/);
});

test("the old CLI's arguments and flags show only where the old CLI had the command", () => {
  const invite = operation("org.member.invite");
  assert.deepEqual(invite.oldCli?.arguments.map((a) => a.name), ["email"]);
  assert.equal(invite.oldCli?.flags.length, 1);
  assert.equal(invite.isNew, false);
  assert.equal(operation("invite.accept").oldCli, null);
  assert.equal(operation("invite.accept").isNew, true);
  assert.ok(invite.returns.length > 0, "the returns schema is not shown");
});

test("the same blueprint builds the same site, and the commit is the one passed in", () => {
  assert.equal(canonical(buildSite(fixtureInput())), canonical(site));
  assert.equal(buildSite(fixtureInput("fff0000")).commit, "fff0000");
});

test("a page id gives three files, and links between them are relative", () => {
  assert.deepEqual([htmlFile("index"), mdFile("index"), jsonFile("index")], ["index.html", "index.md", "data/index.json"]);
  assert.deepEqual([htmlFile("operation/a.b"), mdFile("operation/a.b"), jsonFile("operation/a.b")],
    ["operation/a.b/index.html", "operation/a.b.md", "data/operation/a.b.json"]);
  assert.equal(relative("operation/a.b/index.html", "index.html"), "../../index.html");
  assert.equal(relative("index.html", "assets/style.css"), "assets/style.css");
});

test("a schema's skeleton holds placeholders, never values that look real", () => {
  const schema = {
    type: "object", required: ["status", "id"],
    properties: {
      status: { enum: ["awaiting_approval", "settled"] }, id: { type: "string" }, amount: { type: "number" },
      payAt: { anyOf: [{ type: "string" }, { type: "null" }] }, done: { type: "boolean" }, gone: { type: "null" },
      items: { type: "array", items: { type: "object", properties: { n: { type: "integer" } } } },
      route: { anyOf: [{ const: "personal" }, { const: "budget" }] }, extra: { type: "object" },
    },
  };
  assert.deepEqual(placeholder(schema), {
    status: "awaiting_approval", id: "<string>", amount: "<number>", payAt: "<string | null>", done: "<boolean>", gone: null,
    items: [{ n: "<integer>" }], route: "personal", extra: {},
  });
  assert.equal(skeletonOf({ type: "array", items: { type: "string" } }), '[\n  "<string>"\n]');
  assert.equal(typeScriptOf(schema).split("\n")[1], '  status: "awaiting_approval" | "settled";');
  assert.ok(typeScriptOf(schema).includes("payAt?: string | null;") && typeScriptOf(schema).includes("extra?: Record<string, unknown>;"));
  for (const v of operation("org.member.invite").returns) {
    assert.doesNotThrow(() => { JSON.parse(v.skeleton); }, "a skeleton is not JSON");
  }
});

test("an operation carries its SDK call, its trace, and every eval under a named kind", () => {
  const accept = operation("invite.accept");
  assert.ok(accept.sdkCall.includes("type Input = ") && accept.sdkCall.includes(`await ${accept.sdk}(input)`), accept.sdkCall);
  assert.equal(accept.trace.kind, "flow");
  assert.ok(accept.trace.steps.length > 0 && accept.trace.steps.some((s) => s.rpc !== null));
  const invite = operation("org.member.invite");
  assert.ok(invite.sdkCall.includes("The blueprint names no SDK method"));
  assert.equal(invite.trace.steps.length, 1);
  assert.ok(invite.trace.steps[0]?.events.some((e) => e.label === "invitation_sent"), "the rpc's transition events are not traced");
  assert.deepEqual(invite.evalKinds.map((k) => k.kind), [...new Set(invite.evalKinds.map((k) => k.kind))]);
  assert.equal(invite.evals.filter((e) => invite.evalKinds.some((k) => k.kind === e.kind)).length, invite.evals.length);
  assert.ok(invite.evalKinds.every((k) => k.name !== "" && k.claims !== ""), "a kind has no plain name or claim");
  assert.deepEqual(invite.acceptance.map((a) => a.n), [1, 3], "displayed line numbers are not eval identities");
  assert.deepEqual(invite.acceptance.map((a) => a.claim), invite.evals.filter((e) => e.kind === "acc").map((e) => e.claim));
});

test("the eval catalogue counts every eval the blueprint derives, by level and by kind", () => {
  const { evals } = fixtureInput().blueprint;
  const kinds = [...new Set(evals.map((e) => e.id.slice(0, e.id.indexOf(":"))))];
  const index = catalogue("eval");
  assert.deepEqual(index.sections.map((s) => s.anchor), ["l1", "l2", "l3", "l4"]);
  assert.equal(index.sections[3]?.rows.length, 0);
  assert.equal(index.sections[3]?.empty, "The blueprint derives none yet.");
  const listed = index.sections.flatMap((s) => s.rows.map((r) => r.cells[0])).flatMap((c) => (c?.t === "ref" ? [c.ref.label] : []));
  assert.deepEqual([...listed].sort(), [...kinds].sort());
  let total = 0;
  for (const kind of kinds) {
    const rows = catalogue(`eval/${kind}`).sections[0]?.rows ?? [];
    assert.equal(rows.length, evals.filter((e) => e.id.startsWith(`${kind}:`)).length, kind);
    total += rows.length;
  }
  assert.equal(total, evals.length);
  assert.equal(index.tiles[0]?.big, String(evals.length));
});

test("Docs is catalogues: every count is the length of the table it links to", () => {
  const docs = catalogue("docs");
  for (const tile of docs.tiles) {
    assert.ok(tile.to, `${tile.name} links nowhere`);
    if (tile.to?.page === "eval") continue;
    assert.equal(tile.big, String(catalogue(tile.to?.page ?? "").sections[0]?.rows.length), tile.name);
  }
  assert.equal(catalogue("docs/commands").sections[0]?.rows.length, 2);
  const events = catalogue("docs/events").sections[0];
  assert.deepEqual(events?.heads, ["Event", "Concept", "What it means", "Fields", "Sent by", "Journeys that read it"]);
  const sent = events?.rows.find((r) => r.cells[0]?.t === "ref" && r.cells[0].ref.label === "invitation_sent")?.cells[4];
  assert.ok(sent?.t === "refs" && sent.refs.length > 0, "an event names nothing that sends it");
  assert.equal(catalogue("docs/spans").sections[0]?.heads.length, 3);
  const concept = page("concept/organizations");
  assert.ok(concept.type === "concept");
  for (const tile of concept.counts) assert.equal(tile.to === null, tile.big === "0", `${tile.name}: a count and its link disagree`);
});

test("Architecture is drawn from the blueprint: what runs where, the layers, and what the blueprint is silent on", () => {
  const design = page("design");
  assert.ok(design.type === "architecture");
  assert.deepEqual(design.runs.heads.slice(0, 2), ["Component", "Runs on"]);
  assert.equal(design.runs.rows.length, 3);
  assert.deepEqual(design.layers.map((l) => l.map((r) => r.label)), [["postgres"], ["backend"], ["sdk"]]);
  assert.equal(design.traced, null);
  assert.ok(design.silent.some((s) => s.includes("payment.send")), "a missing trace is not named");
  assert.ok(design.silent.some((s) => s.startsWith("Spans:")));
  assert.equal(design.boundary.length, 2);
});
