// A run with RUNNER_TEARDOWN=job leaves its one world up for CI's teardown job: what the accounts hold of that world
// is recorded in `oneWorld.left` but does not fail the run; anything else left still does.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import * as Str from "effect/String";
import { summarize } from "../src/summary.ts";
import { butHandedOver, type Inventory } from "../src/world/leftovers.ts";

const NOT_GONE = "the run's worlds are not all gone";
const held = (worlds: ReadonlyArray<string>): Inventory => ({ workers: [], hyperdrives: [], neonProjects: [], worlds });
const one = ["capxul-core-w-tpl-2c652e-core", "capxul-core/w-tpl-2c652e"];
const journeys = ["capxul-core-w-j1a2b3-core"];

test("what is left of the worlds handed over to the teardown job is set aside; nothing else is", () => {
  assert.deepEqual(butHandedOver(held(one), ["w-tpl-2c652e"]).worlds, []);
  assert.deepEqual(butHandedOver(held([...one, ...journeys]), ["w-tpl-2c652e"]).worlds, journeys);
  assert.deepEqual(butHandedOver(held(one)).worlds, one, "with nothing handed over, everything left counts");
});

const ending = (left: Inventory, handedOver?: ReadonlyArray<string>) =>
  summarize({
    run: "run-abc123",
    mode: "one world",
    expect: "pass",
    owner: "runner",
    startedAt: "2026-11-15T00:00:00.000Z",
    records: [],
    pathOf: (_record, index) => `run-abc123/${index}.json`,
    oneWorld: {
      world: "tpl-2c652e",
      hub: "rh-1",
      hubBroughtUp: true,
      left,
      notTakenDown: [],
      ...(handedOver === undefined ? {} : { handedOver }),
      timings: [],
    },
  }).failure ?? "";

test("a run in one world fails on what it left only beyond the worlds it handed over", () => {
  assert.ok(!Str.includes(NOT_GONE)(ending(held(one), ["w-tpl-2c652e"])), "the handed-over world does not fail it");
  assert.ok(Str.includes(NOT_GONE)(ending(held(one))), "without the handover, the one world left fails it");
  const both = ending(held([...one, ...journeys]), ["w-tpl-2c652e"]);
  assert.ok(Str.includes(`${NOT_GONE}: left ${journeys[0]}`)(both), both);
});
