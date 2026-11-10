import assert from "node:assert/strict";
import { test } from "node:test";

import { check, expect, passed } from "#src/modules/check/service.ts";

import { assetsOf, generate, load, ROOT } from "./main.ts";

test("the real book generates a site that passes the portal check", async () => {
  const loaded = await load(ROOT, "test000");
  assert.ok(loaded.ok, loaded.ok ? "" : loaded.error);
  const input = loaded.value;
  assert.equal(input.book.problems.length, 0);
  const assets = assetsOf();
  const files = generate(input, assets);
  const expected = expect(input.book, input.waits, input.status);
  const outcomes = check(files, generate(input, assets), expected);
  assert.ok(passed(outcomes), JSON.stringify(outcomes.filter((o) => o.failures > 0), null, 2));

  const operations = [...input.book.records.values()].filter((r) => r._kind === "operation").length;
  assert.equal(expected.operations.length, operations);
  assert.equal([...files.keys()].filter((f) => f.endsWith(".html")).length, expected.pages.length);
  assert.equal(files.size, expected.pages.length * 3 + 3);
  assert.ok(expected.waiting.length > 0, "the judgments list is empty");
  assert.ok((files.get("assets/style.css") ?? "").length > 1000);
});

test("a folder with no books is an error value, not a throw", async () => {
  const loaded = await load("/nonexistent-capxul-root", "test000");
  assert.equal(loaded.ok, false);
});
