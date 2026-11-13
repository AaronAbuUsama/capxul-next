// bun test src
import { describe, expect, test } from "bun:test";
import { statementsOf } from "./sql.ts";
import { nameOf, stageOf, isWorldStage } from "../stack/names.ts";

describe("statementsOf", () => {
  test("drops comment lines and splits at semicolons", () => {
    expect(statementsOf("-- a comment\ncreate schema app;\n\ncreate table app.t (\n  id int\n);\n")).toEqual([
      "create schema app",
      "create table app.t (\n  id int\n)",
    ]);
  });
  test("an empty file has no statements", () => {
    expect(statementsOf("-- nothing\n\n")).toEqual([]);
  });
});

describe("world names", () => {
  test("a world's stage carries the prefix exactly once", () => {
    expect(stageOf("demo")).toBe("w-demo");
    expect(stageOf("w-demo")).toBe("w-demo");
    expect(nameOf("w-demo")).toBe("demo");
  });
  test("the platform is not a world", () => {
    expect(isWorldStage("platform")).toBe(false);
    expect(isWorldStage("w-demo")).toBe(true);
  });
});
