import assert from "node:assert/strict";
import { test } from "node:test";

import { buildSite, jsonFile, mdFile } from "#src/modules/site/service.ts";
import { fixtureInput, WAITING } from "#src/testing.ts";

import { twinsOf } from "./service.ts";
import { LLMS_FILE } from "./types.ts";

const site = buildSite(fixtureInput());
const files = twinsOf(site);
const file = (path: string): string => files.get(path) ?? assert.fail(`no file ${path}`);
const data = (page: string): Record<string, unknown> => JSON.parse(file(jsonFile(page))) as Record<string, unknown>;

test("every page has a Markdown twin and a JSON twin, and the site has one llms.txt", () => {
  assert.equal(files.size, site.pages.length * 2 + 1);
  for (const page of site.pages) {
    assert.ok(file(mdFile(page.id)).startsWith(`# `), `${page.id}: the Markdown twin has no title`);
    assert.equal(data(page.id)["id"], page.id);
  }
  assert.ok(file(LLMS_FILE).startsWith("# Capxul portal\n"));
});

test("data/index.json carries the counts, the commit, the problems, the gaps and the nav", () => {
  const index = data("index");
  for (const key of ["counts", "commit", "problems", "gaps", "nav"]) assert.ok(key in index, `no ${key}`);
  assert.equal(index["commit"], "abc1234");
  assert.deepEqual(Object.keys(index), Object.keys(index).sort(), "the keys are not sorted");
});

test("data/review.json lists the waiting decisions, and an operation's data carries its stand", () => {
  const questions = data("review")["questions"] as readonly { readonly id: string }[];
  assert.deepEqual(questions.map((q) => q.id), [WAITING]);
  assert.deepEqual((data("operation/org.member.invite")["stand"] as { stand: string }).stand, "decide");
});

test("a Markdown twin links to twins with relative paths, and to its own HTML and JSON", () => {
  const md = file(mdFile("operation/org.member.invite"));
  assert.ok(md.includes("[HTML](org.member.invite/index.html)"));
  assert.ok(md.includes("[JSON](../data/operation/org.member.invite.json)"));
  assert.ok(md.includes("```bash\norg member invite <email> [flags]\n```"), md.slice(0, 400));
  assert.ok(md.includes("Reference, old CLI"));
  assert.ok(md.includes("`--role <role>, -r`"));
  assert.ok(md.includes("Stands at: **decide**"));
  assert.equal(/\]\(\//.test(md), false, "a root-relative link");
});

test("an operation with no old command says so instead of showing flags", () => {
  const md = file(mdFile("operation/invite.accept"));
  assert.ok(md.includes("## Arguments and flags"));
  assert.equal(md.includes("--role"), false);
});

test("text from the book cannot become a link", () => {
  const twins = twinsOf(buildSite({ ...fixtureInput(), direction: { ...fixtureInput().direction, needsYou: "see [here](http://x.test)" } }));
  assert.ok((twins.get("index.md") ?? "").includes("[here]\\(http://x.test)"));
});

test("llms.txt names every fixed page, every concept and the grammar of the record pages", () => {
  const text = file(LLMS_FILE);
  for (const path of ["index.md", "review.md", "design.md", "build.md", "docs.md", "concept/access.md", "data/index.json", "data/review.json"]) {
    assert.ok(text.includes(`(${path})`), `no link to ${path}`);
  }
  assert.ok(text.includes("operation/<id>.md"));
  assert.ok(text.includes("abc1234"));
});

test("the twins carry the skeleton, the SDK call, the trace, the evals by kind and the catalogues", () => {
  const md = file(mdFile("operation/invite.accept"));
  for (const part of ["```json", "```ts", "## What happens when you run it", "### Acceptance (`acc`)", "the book names none"]) {
    assert.ok(md.includes(part), `no ${part}`);
  }
  const operation = data("operation/invite.accept");
  for (const key of ["sdkCall", "trace", "evalKinds"]) assert.ok(key in operation, `no ${key}`);
  assert.ok(file(mdFile("docs/events")).includes("| Event | Concept | What it means |"));
  assert.ok(file(mdFile("eval")).includes("## Level 4: live traffic") && file(mdFile("eval")).includes("The book derives none yet."));
  assert.ok(file(mdFile("design")).includes("## What runs where") && file(mdFile("design")).includes("## What the book is silent on"));
  assert.ok(file(LLMS_FILE).includes("(docs/events.md)") && file(LLMS_FILE).includes("(eval.md)"));
});
