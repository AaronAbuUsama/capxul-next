// After a journey's destroy, the accounts are read until they list none of its worlds (src/worlds/teardown.ts,
// `settledLeft`): run 43812161831 found a world its destroy had taken down still in Cloudflare's script list right
// after, and gone a minute later. A stubbed account read stands in for the inventory.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Ref from "effect/Ref";
import { settledLeft, stillHeld } from "../src/worlds/teardown.ts";
import type { Inventory } from "../src/world/leftovers.ts";

const LEFTOVER = "capxulworld-w-qf-8bd105";
const listing = (worlds: ReadonlyArray<string>): Inventory => ({
  workers: [],
  hyperdrives: [],
  neonProjects: [],
  worlds,
});
const quick = { reads: 5, every: Duration.millis(1) };

/** A read that lists the leftover its first `lagging` times, then nothing; it counts its reads. */
const lagging = (times: number) =>
  Effect.map(Ref.make(0), (reads) => ({
    reads,
    read: Effect.map(
      Ref.updateAndGet(reads, (n) => n + 1),
      (n) => listing(n <= times ? [LEFTOVER] : []),
    ),
  }));

test("a world still listed twice after its destroy, then gone, settles: nothing is left", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { reads, read } = yield* lagging(2);
      const { left, rereads } = yield* settledLeft(read, quick);
      assert.deepStrictEqual(left?.worlds, []);
      assert.equal(rereads, 2);
      assert.deepStrictEqual(stillHeld(left), [], "the journey passes");
      assert.equal(yield* Ref.get(reads), 3);
    }),
  ));

test("a world still listed after every re-read is left, by name, after five re-reads", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { reads, read } = yield* lagging(6);
      const { left, rereads } = yield* settledLeft(read, quick);
      assert.deepStrictEqual(left?.worlds, [LEFTOVER]);
      assert.equal(rereads, 5);
      const failures = stillHeld(left);
      assert.equal(failures.length, 1, "the journey fails");
      assert.match(failures[0] ?? "", new RegExp(LEFTOVER), "naming what stays");
      assert.equal(yield* Ref.get(reads), 6);
    }),
  ));

test("accounts that list nothing at once are read once", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { reads, read } = yield* lagging(0);
      const { rereads } = yield* settledLeft(read, quick);
      assert.equal(rereads, 0);
      assert.equal(yield* Ref.get(reads), 1);
    }),
  ));
