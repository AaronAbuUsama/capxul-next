// The starting worlds the runner makes: which it can make, which wait on operations not built yet, and how a call
// made in making one becomes an entry of the world's `calls` fact (the blueprint's `MadeCall`).
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { MadeCall, startingWorlds, World } from "@capxul/blueprint";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { madeCallOf, makers, waitsOn } from "../src/worlds/makers.ts";

test("the runner makes nothing, quota-full, fresh, with-snapshot and restored by their steps", () => {
  for (const world of [
    startingWorlds.nothing,
    startingWorlds.quotaFull,
    startingWorlds.fresh,
    startingWorlds.withSnapshot,
    startingWorlds.restored,
  ])
    assert.ok(makers[world.name] !== undefined, world.name);
  assert.deepEqual(waitsOn(startingWorlds.fresh), []);
  assert.deepEqual(waitsOn(startingWorlds.quotaFull), []);
});

test("a world whose steps need operations not built names them, its ancestors' first", () => {
  assert.deepEqual(waitsOn(startingWorlds.founded), ["org.create", "approval.sign"]);
  assert.deepEqual(waitsOn(startingWorlds.paid), [
    "org.create",
    "approval.sign",
    "org.member.grant",
    "doc.create",
    "doc.submit",
  ]);
  assert.deepEqual(waitsOn(startingWorlds.restored), waitsOn(startingWorlds.paid));
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
