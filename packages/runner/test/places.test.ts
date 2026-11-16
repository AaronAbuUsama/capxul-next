// A run in one shared world (worlds/places.ts): a journey takes all the places it needs at once, waits while they are
// held, gives them back when it ends, however it ends, and fails at once, by name, when it needs more than the run has.
// Each wait is a timed part.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import * as Arr from "effect/Array";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Ref from "effect/Ref";
import { makeTimings } from "../src/timings.ts";
import { placesOf } from "../src/worlds/places.ts";

const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect);

test("the worlds' bound is the smaller of the setting and the cluster's free places", () =>
  run(
    Effect.gen(function* () {
      const timings = yield* makeTimings;
      const roomy = yield* placesOf({ worldsAtOnce: 8, sitesAtOnce: 8 }, 24, timings);
      const tight = yield* placesOf({ worldsAtOnce: 8, sitesAtOnce: 8 }, 3, timings);
      assert.equal(roomy.worlds.size, 8);
      assert.equal(tight.worlds.size, 3);
      assert.equal(tight.sites.size, 8);
    }),
  ));

test("a journey needing more than the run has fails at once, by name", () =>
  run(
    Effect.gen(function* () {
      const places = yield* placesOf({ worldsAtOnce: 4, sitesAtOnce: 8 }, 24, yield* makeTimings);
      const exit = yield* Effect.exit(Effect.void.pipe(places.worlds.held("two operators and their worlds", 5)));
      assert.ok(Exit.isFailure(exit));
      assert.match(String(Exit.isFailure(exit) ? exit.cause : ""), /two operators and their worlds needs 5 worlds/);
    }),
  ));

test("a journey waits until all it needs is free, takes it at once, and gives it back however it ends", () =>
  run(
    Effect.gen(function* () {
      const timings = yield* makeTimings;
      const places = yield* placesOf({ worldsAtOnce: 6, sitesAtOnce: 8 }, 24, timings);
      const order = yield* Ref.make<ReadonlyArray<string>>([]);
      const first = yield* Deferred.make<void>();
      // Holds 5 of 6 until released; the second needs 5 and must wait, though one is free.
      const holder = yield* Effect.forkChild(
        Ref.update(order, (o) => [...o, "first in"]).pipe(
          Effect.andThen(Deferred.await(first)),
          places.worlds.held("a journey of five worlds", 5),
        ),
      );
      yield* Effect.yieldNow;
      const waiter = yield* Effect.forkChild(
        Ref.update(order, (o) => [...o, "second in"]).pipe(places.worlds.held("another of five", 5)),
      );
      yield* Effect.yieldNow;
      assert.deepEqual(yield* Ref.get(order), ["first in"], "the second waits while five are held");
      yield* Deferred.succeed(first, undefined);
      yield* Fiber.join(holder);
      yield* Fiber.join(waiter);
      assert.deepEqual(yield* Ref.get(order), ["first in", "second in"]);
      // A failed journey gives its places back too.
      yield* Effect.exit(Effect.fail("boom").pipe(places.worlds.held("fails", 6)));
      yield* Effect.void.pipe(places.worlds.held("after", 6));
      const parts = Arr.map(yield* timings.all, (part) => part.part);
      assert.ok(
        Arr.every(parts, (part) => part === "world place"),
        Arr.join(parts, ", "),
      );
      assert.equal(parts.length, 4, "every wait is a timed part");
    }),
  ));
