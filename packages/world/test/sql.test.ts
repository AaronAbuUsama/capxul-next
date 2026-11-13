import * as assert from "node:assert/strict";
import { describe, test } from "node:test";
import { statementsOf } from "../src/database/sql.ts";
import { nameOf, stageOf, isWorldStage } from "../src/stack/names.ts";

describe("statementsOf", () => {
  test("drops comment lines and splits at semicolons", () => {
    assert.deepStrictEqual(statementsOf("-- a comment\ncreate schema app;\n\ncreate table app.t (\n  id int\n);\n"), [
      "create schema app",
      "create table app.t (\n  id int\n)",
    ]);
  });
  test("an empty file has no statements", () => {
    assert.deepStrictEqual(statementsOf("-- nothing\n\n"), []);
  });
});

describe("world names", () => {
  test("a world's stage carries the prefix exactly once", () => {
    assert.strictEqual(stageOf("demo"), "w-demo");
    assert.strictEqual(stageOf("w-demo"), "w-demo");
    assert.strictEqual(nameOf("w-demo"), "demo");
  });
  test("the platform is not a world", () => {
    assert.strictEqual(isWorldStage("platform"), false);
    assert.strictEqual(isWorldStage("w-demo"), true);
  });
});
