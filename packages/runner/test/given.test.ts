// What the runner hands a scenario as its starting world's facts, before it makes starting worlds (step 1.12).
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { startingWorlds } from "@capxul/blueprint";
import { Given } from "@capxul/scenarios";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import { givenFor } from "../src/given.ts";

const operators = { first: "runner", second: "runner-2" };
const factsOf = (layer: ReturnType<typeof givenFor>) =>
  Effect.service(Given).pipe(
    Effect.flatMap((given) => given.facts),
    Effect.provide(layer),
    Effect.runSyncExit,
  );

test("nothing's facts are the run's own operators", () => {
  const exit = factsOf(givenFor(startingWorlds.nothing, operators, "made only"));
  assert.ok(Exit.isSuccess(exit));
  assert.deepEqual(exit.value, { operators, calls: [] });
});

test("another world's facts are its examples against empty handlers, and missing otherwise", () => {
  const examples = factsOf(givenFor(startingWorlds.paymentHeld, operators, "examples"));
  assert.ok(Exit.isSuccess(examples));
  assert.equal(examples.value, startingWorlds.paymentHeld.example);
  const missing = factsOf(givenFor(startingWorlds.paymentHeld, operators, "made only"));
  assert.ok(Exit.hasDies(missing));
});
