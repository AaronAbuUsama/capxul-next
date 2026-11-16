// A run in one shared world: a journey's worlds are those its own calls made, read from what world.create and
// world.snapshot.restore answered (client.ts, `madeWorldOf`), so journeys side by side never destroy each other's.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import * as Arr from "effect/Array";
import * as Option from "effect/Option";
import * as Rec from "effect/Record";
import { madeWorldOf } from "../src/client.ts";

// The operations, by name, as object keys (capxul/declared-names reads a key as checked by the compiler).
const [create = "", restore = "", show = ""] = Rec.keys({
  "world.create": 0,
  "world.snapshot.restore": 0,
  "world.show": 0,
});

const call = (operation: string, success: Option.Option<unknown>) =>
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a call's operation, as the client records it: a name the blueprint declares
  ({ operation, success }) as Parameters<typeof madeWorldOf>[0];

test("a journey's worlds are those its world.create and world.snapshot.restore calls answered, by stage", () => {
  const made = [
    call(create, Option.some({ world: "qf-1a2b3c" })),
    call(restore, Option.some({ world: "w-rst-4d5e6f" })),
    call(create, Option.none()),
    call(show, Option.some({ world: "elsewhere" })),
  ];
  assert.deepEqual(Arr.flatMap(made, madeWorldOf), ["w-qf-1a2b3c", "w-rst-4d5e6f"]);
});
