import assert from "node:assert/strict";
import { test } from "node:test";
import { buildBlueprint } from "../../blueprint-engine/src/index.ts";
import * as f from "../../blueprint-engine/test/fixtures/invitations.ts";
import { checkSite } from "../src/check.ts";
import { areaOf, parseLog } from "../src/history.ts";
import { generate } from "../src/main.ts";
import { buildModel } from "../src/model.ts";
import { renderSite } from "../src/render.ts";

const SEP = "\u001e";
const log = `${SEP}abc|2026-11-11T10:00:00Z|Aaron|Plan: a change\n\nplan/plan.json\n${SEP}def|2026-11-11T11:00:00Z|Aaron|Books: a rule\nTask: m2-books\n\nblueprint/books/data.ts\npackages/x/src/books/a.ts\n`;

test("history: an agent's commit is Claude's with its task, and a file lands on the concept its path names", () => {
  const h = parseLog(log);
  assert.deepEqual(h.map((c) => [c.sha, c.who, c.via, c.files.length]), [["abc", "Aaron", "", 1], ["def", "Claude", "task m2-books", 2]]);
  assert.equal(areaOf("packages/x/src/books/a.ts", new Set(["books"])), "books");
  assert.equal(areaOf("plan/plan.json", new Set(["books"])), "tooling");
});

test("the model counts from the blueprint, and every page it renders passes the site check", () => {
  const b = buildBlueprint({ name: "t", stage: "as-is", records: f.records });
  const m = buildModel({ blueprint: b, status: null, history: parseLog(log), built: "now" });
  assert.equal(m.counts.records, b.records.size);
  assert.equal(m.counts.pass, 0);
  const pages = renderSite(m);
  assert.deepEqual(checkSite(m, pages), []);
  const broken = new Map(pages);
  broken.set("index.html", `${pages.get("index.html")}<a href="concepts/nowhere.html">x</a> NaN`);
  assert.deepEqual(checkSite(m, broken), ["index.html: links to concepts/nowhere.html, which is not a page", 'index.html: shows "NaN"']);
});

test("every generator works on the real blueprint, status and history", async () => {
  const { pages, errors } = await generate();
  assert.deepEqual(errors, []);
  assert.ok(pages.size > 10);
});
