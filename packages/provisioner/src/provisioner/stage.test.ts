import { strict as assert } from "node:assert";
import { test } from "node:test";
import { boxName, InvalidPlacement, InvalidWorld, placementFrom, worldStage } from "./stage.ts";

test("a world id becomes its own stage and box name", () => {
  const stage = worldStage("town1", "docker");
  assert.equal(stage.stage, "world-town1");
  assert.equal(boxName(stage), "capxul-world-town1");
});

test("ids the supervisor would refuse are refused here first", () => {
  for (const bad of ["", "Town", "town_1", "town-1", "1town", "a".repeat(13)]) {
    assert.throws(() => worldStage(bad, "docker"), InvalidWorld, bad);
  }
});

test("a box is optional: nothing configured means the world runs on the machine", () => {
  assert.equal(placementFrom(undefined), "none");
  assert.equal(placementFrom(""), "none");
  assert.equal(placementFrom("none"), "none");
  assert.equal(placementFrom("docker"), "docker");
  assert.equal(placementFrom("e2b"), "e2b");
  assert.throws(() => placementFrom("lambda"), InvalidPlacement);
});
