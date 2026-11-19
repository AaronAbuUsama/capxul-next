// The journeys a run runs (src/chosen.ts): those named on the command line, else those RUNNER_JOURNEYS names, else
// all; an unknown name fails at once. A deploy's check runs one journey as a smoke (platform.yml).
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { journeys } from "@capxul/scenarios";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import { chosenOf, namesIn } from "../src/chosen.ts";

const [first, second] = journeys;
const names = (chosen: ReadonlyArray<{ readonly name: string }>) => Arr.map(chosen, (each) => each.name);

test("RUNNER_JOURNEYS unset or empty runs every journey", () => {
  assert.equal(Effect.runSync(chosenOf(journeys, [], "")).length, journeys.length);
  assert.equal(Effect.runSync(chosenOf(journeys, [], " , ")).length, journeys.length);
});

test("RUNNER_JOURNEYS runs only the journeys it names, its names trimmed", () => {
  assert.ok(first !== undefined && second !== undefined);
  const chosen = Effect.runSync(chosenOf(journeys, [], ` ${second.name} ,${first.name}`));
  assert.deepStrictEqual(names(chosen), [first.name, second.name]);
});

test("names on the command line win over RUNNER_JOURNEYS", () => {
  assert.ok(first !== undefined && second !== undefined);
  const chosen = Effect.runSync(chosenOf(journeys, [second.name], first.name));
  assert.deepStrictEqual(names(chosen), [second.name]);
});

test("a name no journey has fails the run at once, by name", () => {
  assert.ok(first !== undefined);
  const exit = Effect.runSyncExit(chosenOf(journeys, [], `${first.name},no such journey`));
  assert.ok(Exit.isFailure(exit));
  assert.match(String(exit.cause), /no such journey/);
});

test("the smoke platform.yml runs is a registered journey", () => {
  assert.deepStrictEqual(namesIn("found Northwind and give sam the books"), ["found Northwind and give sam the books"]);
  const exit = Effect.runSyncExit(chosenOf(journeys, [], "found Northwind and give sam the books"));
  assert.ok(Exit.isSuccess(exit));
});
