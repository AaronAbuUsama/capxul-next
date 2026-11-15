// What the compiler cannot hold about the journeys: names and keys are unique, each is 5 to 10 steps from one of the
// blueprint's starting worlds, and between them they call every operation of the blueprint. There are at least the
// thin line's two or three; each slice adds its own (docs/roadmap.md, phase 3), so there is no upper bound.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { operations, startingWorlds } from "@capxul/blueprint";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Order from "effect/Order";
import * as Rec from "effect/Record";
import { journeys } from "../src/door.ts";

test("every journey has its own name, a story and a run", () => {
  const names = Arr.map(journeys, (each) => each.name);
  assert.deepEqual(Arr.dedupe(names), names);
  for (const each of journeys) {
    assert.ok(each.story.length > 0, `${each.name} tells no story`);
    assert.ok(Effect.isEffect(each.run), `${each.name} has no run`);
  }
});

test("every journey has its own key, 2 to 6 lowercase letters and digits, by which the run casts its people", () => {
  const keys = Arr.map(journeys, (each) => each.key);
  assert.deepEqual(Arr.dedupe(keys), keys);
  for (const each of journeys) assert.match(each.key, /^[a-z0-9]{2,6}$/, `${each.name}'s key ${each.key}`);
});

test("at least the thin line's journeys, each 5 to 10 steps from a starting world the blueprint declares", () => {
  assert.ok(journeys.length >= 2, `${journeys.length} journeys`);
  for (const each of journeys) {
    assert.ok(each.outline.length >= 5 && each.outline.length <= 10, `${each.name} has ${each.outline.length} steps`);
    assert.ok(Arr.contains(Rec.values(startingWorlds), each.given), `${each.name} begins from an undeclared world`);
  }
});

test("between them the journeys call every operation of the blueprint", () => {
  const called = Arr.dedupe(Arr.flatMap(journeys, (each) => Arr.map(each.outline, (step) => step.operation)));
  assert.deepEqual(Arr.sort(called, Order.String), Arr.sort(Rec.keys(operations), Order.String));
});
