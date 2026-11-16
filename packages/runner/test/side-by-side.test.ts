// A run in one shared world (worlds/side-by-side.ts): a journey's worlds are those its own calls made, read from what
// world.create and world.snapshot.restore answered; and a journey declares the worlds it holds beside the shared one.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { journeys } from "@capxul/scenarios";
import * as Option from "effect/Option";
import * as Rec from "effect/Record";
import type { Call } from "../src/client.ts";
import { madeWorldsOf, worldsOf } from "../src/worlds/side-by-side.ts";

// The operations, by name, as object keys (capxul/declared-names reads a key as checked by the compiler).
const [create = "", restore = "", show = ""] = Rec.keys({
  "world.create": 0,
  "world.snapshot.restore": 0,
  "world.show": 0,
});

const call = (operation: string, success: Option.Option<unknown>): Call =>
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a call as the client records it, only the fields madeWorldsOf reads
  ({ operation, success }) as unknown as Call;

test("a journey's worlds are those its world.create and world.snapshot.restore calls answered, by stage", () => {
  const made = madeWorldsOf([
    call(create, Option.some({ world: "qf-1a2b3c" })),
    call(restore, Option.some({ world: "w-rst-4d5e6f" })),
    call(create, Option.none()),
    call(show, Option.some({ world: "elsewhere" })),
  ]);
  assert.deepEqual(made, ["w-qf-1a2b3c", "w-rst-4d5e6f"]);
});

test("a journey that declares no worlds holds none beside the shared one", () => {
  for (const journey of journeys) assert.ok(worldsOf(journey) >= 0, journey.name);
});
