// The starting worlds the runner makes: which it can make, which wait on operations not built yet, and how a call
// made in making one becomes an entry of the world's `calls` fact (the blueprint's `MadeCall`).
import { strict as assert } from "node:assert";
import { existsSync } from "node:fs";
import { test } from "node:test";
import { MadeCall, startingWorlds, World } from "@capxul/blueprint";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Rec from "effect/Record";
import * as Schema from "effect/Schema";
import { madeCallOf, makers, waitsOn } from "../src/worlds/makers.ts";
import { CODE } from "../src/worlds/starting.ts";

test("the runner has a maker for every starting world, so none waits on an operation", () => {
  for (const world of Rec.values(startingWorlds)) {
    assert.ok(makers[world.name] !== undefined, world.name);
    assert.deepEqual(waitsOn(world), [], world.name);
  }
});

test("a recorded call becomes a MadeCall, encoded as the blueprint encodes it", () => {
  const example = World.create.examples[0];
  assert.ok(example !== undefined);
  const call = {
    operation: "world.create" as const,
    traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
    at: null,
    outcome: "success" as const,
    refusal: null,
    as: null,
    operator: "second" as const,
    payload: example.payload,
    success: Option.some(example.success),
    error: Option.none(),
    callerMs: 1,
    resent: 0,
    failure: null,
  };
  const decoded = Effect.runSync(Effect.flatMap(madeCallOf(call, null), Schema.decodeUnknownEffect(MadeCall)));
  assert.equal(decoded.world, "town");
  assert.equal(decoded.operator, "second");
  assert.equal(decoded.outcome, "success");
  assert.equal(decoded.trace, call.traceId);
});

test("the code fingerprinted into a bench template's name is all there", () => {
  for (const dir of CODE) assert.ok(existsSync(`${import.meta.dirname}/../../${dir}`), dir);
});
