import assert from "node:assert/strict";
import { test } from "node:test";

import { fixtureInput } from "#src/testing.ts";

import { areaOf } from "./internal/history.ts";
import { buildSite, parseLog } from "./service.ts";
import type { CataloguePage } from "./types.ts";

const RS = "\u001e";
const log = `${RS}abc1234567|2026-11-11T10:00:00Z|Aaron|Plan: a change\n\nplan/plan.json\n` +
  `${RS}def1234567|2026-11-11T11:00:00Z|Aaron|Books: a rule\nTask: m2-books\n\nblueprint/books/data.ts\npackages/x/src/books/a.ts\n`;

test("an agent's commit is Claude's with its task, and a file lands on the concept its path names", () => {
  const h = parseLog(log);
  assert.deepEqual(h.map((c) => [c.sha, c.who, c.via, c.files.length]), [["abc1234", "Aaron", "", 1], ["def1234", "Claude", "task m2-books", 2]]);
  assert.equal(areaOf("packages/x/src/books/a.ts", new Set(["books"])), "books");
  assert.equal(areaOf("plan/plan.json", new Set(["books"])), "tooling");
});

test("the History page exists only with a history, and counts who worked on each concept", () => {
  assert.equal(buildSite(fixtureInput()).pages.some((p) => p.id === "history"), false);
  const site = buildSite({ ...fixtureInput(), history: parseLog(log) });
  const page = site.pages.find((p) => p.id === "history") as CataloguePage | undefined;
  assert.ok(page);
  assert.deepEqual(page.sections.map((s) => s.anchor), ["by-concept", "timeline", "recent"]);
  assert.equal(page.sections[2]?.rows.length, 2);
});
