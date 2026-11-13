// The SDK is derived from the blueprint: its operations are exactly the blueprint's, each served by the group the
// blueprint puts it in, and its client fits the scenarios' `Capxul` exactly.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { Chain, operations, servedBy } from "@capxul/blueprint";
import { Capxul } from "@capxul/scenarios";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import type * as Layer from "effect/Layer";
import * as Order from "effect/Order";
import * as Rec from "effect/Record";
import * as Sdk from "../src/door.ts";

const sorted = (names: Iterable<string>): Array<string> => Arr.sort(names, Order.String);

test("the SDK's operations are exactly the blueprint's", () => {
  assert.deepEqual(sorted(Sdk.names), sorted(Rec.keys(operations)));
  assert.equal(Arr.dedupe(Sdk.names).length, Sdk.names.length);
});

test("each operation is served by the group the blueprint puts it in", () => {
  for (const name of Sdk.platformNames) assert.equal(servedBy(name), "platform", name);
  for (const name of Sdk.worldNames) assert.equal(servedBy(name), "world", name);
});

test("the client has one function per blueprint operation, keyed by its name", () => {
  const door: Sdk.Door = { send: () => Effect.die("not sent") };
  const reach: Sdk.Reach = { platform: () => door, world: () => door, chain: () => () => Effect.die("not read") };
  const client = Effect.runSync(
    Sdk.make.pipe(
      Effect.provideService(Sdk.PlatformDoor, door),
      Effect.provideService(Sdk.WorldDoor, door),
      Effect.provideService(Sdk.ReachDoors, reach),
    ),
  );
  const { chain, ...calls } = client;
  assert.deepEqual(sorted(Rec.keys(calls)), sorted(Rec.keys(operations)));
  assert.deepEqual(sorted(Rec.keys(chain)), sorted(Rec.keys(Chain.reads)), "the chain reads are the blueprint's");
  for (const name of Rec.keys(operations)) assert.equal(typeof client[name], "function", name);
});

// The scenarios' `Capxul` is the SDK's client: this line does not compile unless the shapes are the same.
const fitsCapxul: Layer.Layer<Capxul, never, Sdk.PlatformDoor | Sdk.WorldDoor | Sdk.ReachDoors> = Sdk.layer(Capxul);

test("the SDK supplies the scenarios' Capxul", () => {
  assert.ok(fitsCapxul);
});
