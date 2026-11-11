import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { renderSite } from "#src/modules/render/service.ts";
import { twinsOf } from "#src/modules/twins/service.ts";
import { fixtureAssets, fixtureInput } from "#src/testing.ts";

import type { GuideInput, GuidePage, OverviewPage, SiteInput } from "./types.ts";
import { KINDS } from "@capxul/blueprint-engine";
import { KIND_WORDS, RULE_WORDS } from "./internal/guideWords.ts";
import { buildSite } from "./service.ts";

const TEXT = [
  "# The blueprint, explained", "", "Opening words.", "", "<!-- generated: now -->", "",
  "## The idea", "", "Words first.", "", "<!-- generated: kinds -->", "", "More words.", "",
  "## One record, end to end", "", "<!-- generated: follow -->", "", "<!-- generated: follow-evals -->", "",
  "## When something is wrong", "", "<!-- generated: problems -->", "<!-- generated: gaps -->", "<!-- generated: no-such-table -->", "",
].join("\n");

const guideInput = (operation = "invite.accept"): GuideInput => ({
  document: "docs/blueprint-guide.md", text: TEXT, follow: { operation, line: 1 }, cut: { parked: 2 },
  bindings: [{ file: "evals/bindings/fixture.json", area: "fixture", script: "run.sh", bindings: [{ eval: "acc:invite.accept/1", checks: ["A1.joins"], why: "It joins." }], near: [] }],
  repo: { generatedFolders: 0, ciWorkflows: 0, testRunsBlueprint: false, testRunsFrozen: false },
});
const siteWith = (guide: GuideInput | null): ReturnType<typeof buildSite> => buildSite({ ...fixtureInput(), guide } as SiteInput);
const guideOf = (guide: GuideInput): GuidePage => {
  const found = siteWith(guide).pages.find((p) => p.id === "blueprint");
  assert.ok(found && found.type === "guide", "no Blueprint page");
  return found;
};

test("the guide's markers become tables in place, and a marker no table answers is kept for the check", () => {
  const page = guideOf(guideInput());
  assert.deepEqual(page.sections.map((s) => s.anchor), ["the-idea", "one-record-end-to-end", "when-something-is-wrong"]);
  assert.deepEqual(page.intro.map((p) => p.t), ["md", "table"]);
  assert.deepEqual(page.sections[0]?.parts.map((p) => (p.t === "md" ? p.text : p.table.anchor)), ["Words first.", "kinds", "More words."]);
  assert.deepEqual(page.unknownMarkers, ["no-such-table"]);
});

test("the followed record is traced from its claim to its binding and its verdict", () => {
  const page = guideOf(guideInput());
  const follow = page.sections[1]?.parts[0];
  assert.ok(follow?.t === "table" && follow.table.anchor === "followed");
  assert.equal(follow.table.rows.length, 8);
  const cells = JSON.stringify(follow.table.rows);
  assert.match(cells, /The invitee becomes a member in the invited role/);
  assert.match(cells, /A1\.joins\. It joins\./);
  assert.match(cells, /not_run: no run has recorded it/);
  const missing = guideOf(guideInput("no.such.operation")).sections[1]?.parts[0];
  assert.ok(missing?.t === "table" && missing.table.rows.length === 0, "an operation the blueprint lacks is followed anyway");
});

test("the page has a nav entry and both twins only when the guide is there", () => {
  const nav = (s: ReturnType<typeof buildSite>): readonly string[] => (s.pages[0] as OverviewPage).nav.map((r) => r.label);
  assert.ok(nav(siteWith(guideInput())).includes("Blueprint"));
  assert.ok(!nav(siteWith(null)).includes("Blueprint"));
  assert.ok(!siteWith(null).pages.some((p) => p.id === "blueprint"));
  const site = siteWith(guideInput());
  const html = renderSite(site, fixtureAssets).get("blueprint/index.html") ?? "";
  assert.match(html, /<h3 id="followed">/);
  assert.match(html, /href="#one-record-end-to-end"/);
  const md = twinsOf(site).get("blueprint.md") ?? "";
  assert.match(md, /^## One record, end to end$/m);
  assert.match(md, /^### Followed: invite\.accept, acceptance line 1$/m);
  assert.ok(twinsOf(site).has("data/blueprint.json"));
});

test("every rule the build can report is explained on the page", () => {
  const dir = join(import.meta.dirname, "../../../../blueprint-engine/src");
  const source = readdirSync(dir).filter((f) => f.endsWith(".ts")).map((f) => readFileSync(join(dir, f), "utf8")).join("\n");
  const named = new Set([...source.matchAll(/\b[pg]\([^,()]+, "([a-z]+(?:-[a-z]+)*)"/g), ...source.matchAll(/rule: "([a-z]+(?:-[a-z]+)*)"/g)].map((m) => m[1] ?? ""));
  assert.ok(named.size > 40, `only ${named.size} rules found: the pattern no longer reads the engine`);
  const explained = new Set(RULE_WORDS.map((r) => r.rule));
  assert.deepEqual([...named].filter((r) => !explained.has(r)).sort(), [], "rules the Blueprint page does not explain");
});

test("every kind the engine defines has its words and its list on the Blueprint page", () => {
  for (const kind of KINDS) {
    assert.ok(kind in KIND_WORDS, `${kind}: no words in guideWords.ts, so the Blueprint page would say "Not explained on this page yet"`);
  }
});
