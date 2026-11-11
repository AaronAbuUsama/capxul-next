import assert from "node:assert/strict";
import { test } from "node:test";
import { defineOperation, evalsUnder, mergeResults, parseResults } from "@capxul/blueprint-engine";

import { buildSite, htmlFile } from "#src/modules/site/service.ts";
import { fixtureAssets, fixtureInput, fixtureRecords } from "#src/testing.ts";
import * as fixture from "../../../../blueprint-engine/test/fixtures/invitations.ts";

import { renderSite } from "./service.ts";

const withExamples = defineOperation({
  ...fixture.invite,
  examples: [
    { title: "Invite a colleague", input: "capxul org member invite ada@example.com --json", output: { invitation: "inv_1" }, exit: 0 },
    { title: "A member may not invite", input: "capxul org member invite ada@example.com --json", output: { error: { code: "ROLE_PERMISSION_DENIED", message: "Ask an Owner." } }, exit: 3 },
  ],
});
const records = fixtureRecords.map((r) => (r === fixture.invite ? withExamples : r));
const base = fixtureInput("abc1234", "as-is", null, records);
const ids = (() => {
  const held = evalsUnder(base.blueprint, base.blueprint.records.get("operation:invite.accept")!);
  return [...held.own, ...held.under].filter((e) => e.level === "L1").map((e) => e.id);
})();
const run = parseResults({ commit: "abc1234", at: "2026-11-10T10:00:00Z", results: ids.map((id, i) => ({ id, verdict: i === 0 ? "fail" as const : "pass" as const })) });
const merged = run.ok ? mergeResults(base.blueprint, null, run.value) : null;
const status = merged?.ok ? merged.value : null;

const pages = (input = base) => {
  const files = renderSite(buildSite(input), fixtureAssets);
  return (page: string): string => files.get(htmlFile(page)) ?? assert.fail(`no page ${page}`);
};

test("examples are terminal sessions above the generated skeleton, which keeps its label", () => {
  const text = pages()("operation/org.member.invite");
  const first = text.indexOf("Example · Invite a colleague");
  assert.ok(first > 0 && first < text.indexOf("generated from the schema, not a recorded response"), "the examples do not come first");
  assert.ok(text.includes('<span class="tk-prompt">$ </span>') && text.includes("# exit 0") && text.includes("# exit 3"));
  assert.ok(text.includes("Example · A member may not invite · refusal"));
  assert.ok(text.includes("ROLE_PERMISSION_DENIED"));
  assert.equal(pages()("operation/invite.accept").includes("Example ·"), false, "an operation with no example shows none");
});

test("every record page, operation page and concept page has an If this changes block with counts by kind and the nearest few", () => {
  const html = pages();
  for (const page of ["event/invitation_sent", "operation/invite.accept", "concept/organizations", "table/invitations"]) {
    assert.ok(html(page).includes('<h2 id="impact">If this changes</h2>'), page);
  }
  const text = html("event/invitation_sent");
  assert.ok(text.includes("impact-kinds") && text.includes("JSON and Markdown twins") === false, "five or fewer dependents are all shown");
  const table = html("table/invitations");
  assert.ok(table.includes("The nearest 5 of "), "a longer list is cut to the nearest five");
  assert.ok(table.includes("JSON and Markdown twins"));
  assert.ok((table.match(/<ul class="impact-list">[\s\S]*?<\/ul>/)?.[0].match(/<li>/g) ?? []).length === 5);
});

test("the trace names the events with their transition, and the spans", () => {
  const text = pages()("operation/org.member.invite");
  assert.ok(text.includes("Events it sends") && text.includes("through") && text.includes("driven by"));
  assert.ok(text.includes("Spans it names") && text.includes("<code>mail.send</code>"));
});

test("with a status document the eval rows show verdicts and the page shows the counts", () => {
  const html = pages(fixtureInput("abc1234", "as-is", status, records));
  const text = html("operation/invite.accept");
  assert.ok(text.includes("chip chip-orange\">fail<") && text.includes("chip chip-blue\">pass<"), "verdict chips are missing");
  assert.match(text, /Evals passing<\/a><span class="mono">\d+ \/ \d+<\/span>/);
  assert.ok(html("build").includes("pass in the status document."));
  assert.ok(html("build").includes("evals passing"));
});

test("with no status document the pages report only the absence of recorded verdicts", () => {
  const html = pages();
  assert.ok(html("build").includes("No recorded verdict is available; implementation existence is not inferred."));
  assert.ok(html("operation/invite.accept").includes("no recorded verdict is available for these evals."));
  assert.ok(html("build").includes("What the blueprint still lacks"));
  assert.ok(html("build").includes("observe means every L1 eval under it passes"));
  assert.ok(!html("operation/invite.accept").includes("no code exists"));
  assert.ok(!html("operation/invite.accept").includes("Nothing here has run"));
});

for (const commit of ["abc1234", "abc123456789", "def5678"]) {
  test("verdict provenance is retained and linked at result commit " + commit, () => {
    const doc = { version: 1 as const, evals: Object.fromEntries(ids.map((id) => [id, {
      verdict: "pass" as const, commit, at: "2026-11-10T10:00:00Z", run: "run-test", evidence: "status/runs/run-test/evidence/check.txt",
    }])) };
    const site = buildSite(fixtureInput("abc1234", "as-is", doc, records));
    const operation = site.pages.find((p) => p.type === "operation" && p.id === "operation/invite.accept");
    assert.ok(operation?.type === "operation");
    const row = operation.evals.find((e) => ids.includes(e.id))!;
    assert.deepEqual(row.provenance, { result: doc.evals[row.id], builtCommit: "abc1234", repo: base.direction.settings.repo });
    const html = pages(fixtureInput("abc1234", "as-is", doc, records));
    const record = site.pages.find((p) => p.type === "record" && p.evals.some((e) => ids.includes(e.id)));
    assert.ok(record, "fixture must exercise the shared record eval table");
    for (const page of ["operation/invite.accept", record.id]) {
      const text = html(page);
      assert.ok(text.includes('>run-test</a>'));
      assert.ok(text.includes('datetime="2026-11-10T10:00:00Z"'));
      assert.ok(text.includes('/commit/' + commit + '">' + commit + '</a>'));
      assert.ok(text.includes('/blob/' + commit + '/status/runs/run-test/results.json'));
      assert.ok(text.includes('/blob/' + commit + '/status/runs/run-test/evidence/check.txt'));
      assert.ok(text.includes(commit === "def5678" ? "Last seen at a different commit; not proof at built commit abc1234." : "At built commit."));
    }
  });
}

test("legacy results keep date and commit while missing optional provenance is explicit", () => {
  const text = pages(fixtureInput("abc1234", "as-is", status, records))("operation/invite.accept");
  assert.ok(text.includes("Run: not recorded"));
  assert.ok(text.includes("Evidence: not recorded"));
  assert.ok(text.includes("2026-11-10T10:00:00Z"));
});
