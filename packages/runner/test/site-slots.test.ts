// Side by side, company sites are bounded twice (worlds/side-by-side.ts): never more at once than the door's pool of
// ready blank copies reports, and found Northwind's own founding, in its steps, holds a slot as a starting world's does.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { journeys } from "@capxul/scenarios";
import * as Arr from "effect/Array";
import * as Option from "effect/Option";
import { foundsInSteps, sitesOf } from "../src/worlds/side-by-side.ts";

test("sites at once are the setting, capped at the pool the door reports", () => {
  assert.equal(sitesOf(8, Option.some(8)), 8);
  assert.equal(sitesOf(8, Option.some(4)), 4);
  assert.equal(sitesOf(4, Option.some(8)), 4);
});

test("a door that does not report its pool leaves the setting as the bound", () => {
  assert.equal(sitesOf(8, Option.none()), 8);
});

test("found Northwind founds its company in its own steps, and holds a site slot", () => {
  const founding = Arr.filter(journeys, foundsInSteps);
  assert.ok(Arr.some(founding, (each) => each.name === "found Northwind and give sam the books"));
  assert.ok(founding.length < journeys.length, "a journey that founds nothing in its steps holds no slot for it");
});
