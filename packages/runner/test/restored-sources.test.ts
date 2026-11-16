// A journey's take-down knows which of its worlds was restored from which (client.ts, `restoredFromOf`; teardown.ts,
// `sourcesIn`), so a restored world goes in a layer before its source (`destroyInOrder`) and never leans on the retry.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Rec from "effect/Record";
import { restoredFromOf, type MadeWorld } from "../src/worlds/restored.ts";
import { layersOf, sourcesIn } from "../src/worlds/teardown.ts";

// The operations, by name, as object keys (capxul/declared-names reads a key as checked by the compiler).
const [create = "", restore = ""] = Rec.keys({ "world.create": 0, "world.snapshot.restore": 0 });

const call = (operation: string, payload: unknown) =>
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a call's operation, as the client records it: a name the blueprint declares
  ({ operation, payload }) as Parameters<typeof restoredFromOf>[0];

test("a world.snapshot.restore names the world it restored from, by stage; a world.create names none", () => {
  assert.equal(restoredFromOf(call(restore, { world: "src-1a2b3c", snapshot: "m3" })), "w-src-1a2b3c");
  assert.equal(restoredFromOf(call(create, { world: "qf-1a2b3c" })), null);
});

test("the worlds a journey made go down a restored one before its source", () =>
  Effect.runPromise(
    Effect.sync(() => {
      const made: ReadonlyArray<MadeWorld> = [
        { stage: "w-src", from: null },
        { stage: "w-rst", from: "w-src" },
        { stage: "w-other", from: null },
      ];
      const from = sourcesIn(made);
      assert.equal(from("w-rst"), "w-src");
      assert.equal(from("w-src"), null);
      assert.equal(from("w-unknown"), null);
      const layers = layersOf(Arr.map(made, (each) => ({ stage: each.stage, from: from(each.stage) })));
      assert.deepEqual(
        Arr.map(layers, (layer) => Arr.map(layer, (each) => each.stage)),
        [["w-other", "w-rst"], ["w-src"]],
      );
    }),
  ));
