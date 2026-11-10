import assert from "node:assert/strict";
import { test } from "node:test";
import { defineOperation } from "@capxul/book";

import { buildSite, jsonFile, mdFile } from "#src/modules/site/service.ts";
import { fixtureInput, fixtureRecords } from "#src/testing.ts";
import * as fixture from "../../../../book/test/fixtures/invitations.ts";

import { twinsOf } from "./service.ts";

const withExamples = defineOperation({
  ...fixture.invite,
  examples: [{ title: "Invite a colleague", input: "capxul org member invite ada@example.com --json", output: { invitation: "inv_1" }, exit: 0 }],
});
const records = fixtureRecords.map((r) => (r === fixture.invite ? withExamples : r));
const files = twinsOf(buildSite(fixtureInput("abc1234", "as-is", null, records)));
const file = (path: string): string => files.get(path) ?? assert.fail(`no file ${path}`);

test("a record's Markdown twin lists every dependent with its field and distance, and its JSON twin carries them", () => {
  const md = file(mdFile("event/invitation_sent"));
  assert.ok(md.includes("## If this changes"));
  assert.ok(md.includes("| Record | Kind | Field | Names | Distance |"));
  assert.match(md, /\| \[invitation\.send\]\([^)]*\) \| transition \| `emits` \| \[invitation_sent\]\([^)]*\) \| 1 \|/);
  const impact = (JSON.parse(file(jsonFile("event/invitation_sent"))) as { impact: { total: number; all: { distance: number; field: string }[] } }).impact;
  assert.equal(impact.all.length, impact.total);
  assert.ok(impact.all.every((d, i, all) => i === 0 || (all[i - 1]?.distance ?? 0) <= d.distance));
});

test("an operation's twin shows its examples as sessions, its telemetry and its eval counts", () => {
  const md = file(mdFile("operation/org.member.invite"));
  assert.ok(md.includes("## Examples") && md.includes("$ capxul org member invite ada@example.com --json") && md.includes("# exit 0"));
  assert.ok(md.indexOf("## Examples") < md.indexOf("## What it returns"), "examples come before the skeleton");
  assert.match(md, /Events it sends: \[invitation_sent\]\([^)]*\) through \[invitation\.send\]/);
  assert.match(md, /Spans it names: `authorize`/);
  assert.match(md, /Evals passing: 0 of \d+ on it, 0 of \d+ under it\./);
  assert.ok(md.includes("## If this changes"));
});

test("the Build twin counts the gaps by rule, so telemetry and examples are not lost among the rest", () => {
  assert.ok(file(mdFile("build")).includes("none run against real code yet."));
  const target = twinsOf(buildSite(fixtureInput("abc1234", "target", null, records)));
  const md = target.get(mdFile("build")) ?? assert.fail("no build twin");
  assert.ok(md.includes("- no-span: 0") && md.includes("- state-change-without-event: 0") && md.includes("- no-example: 1"), md.slice(0, 600));
});
