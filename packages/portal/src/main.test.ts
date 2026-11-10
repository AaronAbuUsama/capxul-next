import assert from "node:assert/strict";
import { test } from "node:test";

import { check, expect, passed } from "#src/modules/check/service.ts";

import { assetsOf, generate, load, ownerNeedsOf, planPagesOf, ROOT } from "./main.ts";

test("the real book generates a site that passes the portal check", async () => {
  const loaded = await load(ROOT, "test000");
  assert.ok(loaded.ok, loaded.ok ? "" : loaded.error);
  const input = loaded.value;
  assert.equal(input.book.problems.length, 0);
  const assets = assetsOf();
  const files = generate(input, assets);
  const expected = expect(input.book, input.waits, input.status, {
    problems: (input.plan?.problems ?? []).map((p) => `${p.at}: ${p.why}`), tasks: input.plan?.plan.tasks.length ?? null, ownerNeeds: ownerNeedsOf(input), pages: planPagesOf(input),
  }, input.worlds ? ["worlds"] : []);
  assert.ok(input.worlds, "the Worlds page is made from docs/design/worlds-platform.md");
  assert.ok((files.get("worlds/index.html") ?? "").includes("Worlds as a hosted platform"));
  assert.ok((files.get("worlds.md") ?? "").includes("## Clean data"));
  for (const path of ["design/index.html", "design.md", "data/design.json"]) {
    const page = files.get(path) ?? "";
    for (const phrase of ["sites-backup", "production", "worlds", "34.249.131.57", "8 February 2027", "No production RPO/RTO promised"]) {
      assert.ok(page.includes(phrase), `${path} exposes deployment record: ${phrase}`);
    }
  }
  const outcomes = check(files, generate(input, assets), expected);
  assert.ok(passed(outcomes), JSON.stringify(outcomes.filter((o) => o.failures > 0), null, 2));

  const operations = [...input.book.records.values()].filter((r) => r._kind === "operation").length;
  assert.equal(expected.operations.length, operations);
  assert.equal([...files.keys()].filter((f) => f.endsWith(".html")).length, expected.pages.length);
  assert.equal(files.size, expected.pages.length * 3 + 3);
  // The list of what waits on the owner may be empty: he may have answered everything.
  assert.ok((files.get("assets/style.css") ?? "").length > 1000);
});

test("a folder with no books is an error value, not a throw", async () => {
  const loaded = await load("/nonexistent-capxul-root", "test000");
  assert.equal(loaded.ok, false);
});
