// A run's journeys around the shared world's preparation (worlds/journeys.ts; roadmap 4.8, the own-world track's
// A-1): a journey in a world of its own starts at once, while the shared world is still being made; a journey of the
// shared world waits, and its wait is a timed part, `shared world`; a failed preparation fails only the shared world's
// journeys, each by name. Structural only, never about speed. Written first: the cases marked `todo` fail against
// today's stand-in until the runner's builder lands the change, and are then made plain tests.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { journeys, type Journey } from "@capxul/scenarios";
import * as Arr from "effect/Array";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import { RunnerFailure } from "../src/failure.ts";
import { makeTimings } from "../src/timings.ts";
import { journeysOf } from "../src/worlds/journeys.ts";

const UNTIL_BUILT = "until the runner's builder lands the own-world track's A-1 (worlds/journeys.ts)";

const firstOf = (world: Journey["world"]) =>
  Option.getOrThrow(Arr.findFirst(journeys, (journey) => journey.world === world));
const own = firstOf("own");
const shared = firstOf("shared");

/** Runs `journeysOf` over `own` and `shared`, each journey's record its name, with `prepare` as the preparation. */
const started = (prepare: Effect.Effect<void, RunnerFailure>) =>
  Effect.gen(function* () {
    const timings = yield* makeTimings;
    const ran = yield* Ref.make<ReadonlyArray<string>>([]);
    const records = journeysOf({
      prepare,
      journeys: [own, shared],
      timings,
      run: (journey) =>
        Effect.as(
          Ref.update(ran, (all) => [...all, journey.name]),
          journey.name,
        ),
      notMade: (journey, why) => `${journey.name}: not made: ${why}`,
    });
    return { timings, ran, records };
  });

test(
  "with the shared world's preparation blocked, a journey of its own world starts, and its record is written",
  { todo: UNTIL_BUILT },
  () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const gate = yield* Deferred.make<void>();
        const { ran, records } = yield* started(gate.pipe(Deferred.await));
        const fiber = yield* Effect.forkChild(records);
        yield* Effect.sleep("50 millis");
        assert.deepEqual(yield* Ref.get(ran), [own.name], "the own-world journey ran; the shared one waits");
        yield* Deferred.succeed(gate, undefined);
        assert.deepEqual(yield* Fiber.join(fiber), [own.name, shared.name], "each record, in the order given");
      }),
    ),
);

test(
  "a journey of the shared world waits for its preparation, and its wait is a timed part `shared world`",
  { todo: UNTIL_BUILT },
  () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const gate = yield* Deferred.make<void>();
        const { timings, records } = yield* started(gate.pipe(Deferred.await));
        const fiber = yield* Effect.forkChild(records);
        yield* Effect.sleep("30 millis");
        yield* Deferred.succeed(gate, undefined);
        yield* Fiber.join(fiber);
        const waits = Arr.filter(yield* timings.all, (timing) => timing.part === "shared world");
        assert.deepEqual(
          Arr.map(waits, (timing) => [timing.journey, timing.ok]),
          [[shared.name, true]],
          "one wait, the shared journey's; the own-world journey never waits for the shared world",
        );
      }),
    ),
);

test("a failed preparation fails only the shared world's journeys, each by name", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { ran, records } = yield* started(
        RunnerFailure.make({ step: "prepare", message: "the shared world did not answer" }).pipe(Effect.fail),
      );
      const [ownMade, sharedMade] = yield* records;
      assert.equal(ownMade, own.name, "the own-world journey ran");
      assert.match(sharedMade ?? "", new RegExp(`^${shared.name}: not made: .*the shared world did not answer`, "u"));
      assert.deepEqual(yield* Ref.get(ran), [own.name], "the shared journey never ran");
    }),
  ));
