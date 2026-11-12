import { strict as assert } from "node:assert";
import { test } from "node:test";
import { boxName, InvalidWorld, worldStage } from "./stage.ts";

test("a world id becomes its own stage and box name", () => {
  const stage = worldStage("town-1", "docker");
  assert.equal(stage.stage, "world-town-1");
  assert.equal(boxName(stage), "capxul-world-town-1");
});

test("ids Alchemy or a hostname could not carry are refused", () => {
  for (const bad of ["", "Town", "town_1", "-town", "town-", "town--1", "1town", "a".repeat(41)]) {
    assert.throws(() => worldStage(bad, "docker"), InvalidWorld, bad);
  }
});
