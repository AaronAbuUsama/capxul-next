// A container is stopped with SIGTERM and killed only if it outlives the grace (src/containers/stop.ts): how the
// index stops Ponder, so its schema lock is released.
import * as assert from "node:assert/strict";
import { describe, test } from "node:test";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Ref from "effect/Ref";
import { SIGTERM, type Stoppable, stopGently } from "../src/containers/stop.ts";

/** A container that exits `exitsAfter` looks after a SIGTERM (never, when null), and notes what was done to it. */
const container = (exitsAfter: number | null, signalFails = false) =>
  Effect.gen(function* () {
    const done = yield* Ref.make<ReadonlyArray<string>>([]);
    const looks = yield* Ref.make<number | null>(null);
    const note = (what: string) => Ref.update(done, (all) => [...all, what]);
    const stub: Stoppable<string, never> = {
      running: Effect.gen(function* () {
        if ((yield* Ref.get(done)).includes("destroy")) return false;
        const seen = yield* Ref.updateAndGet(looks, (n) => (n === null ? null : n + 1));
        return exitsAfter === null || seen === null || seen < exitsAfter;
      }),
      signal: (signo) =>
        signalFails ? Effect.fail("no such process") : Effect.andThen(note(`signal ${signo}`), Ref.set(looks, 0)),
      destroy: note("destroy"),
    };
    return { stub, done };
  });

describe("stopping a container", () => {
  test("sends SIGTERM and waits for the process to exit, without killing it", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const { stub, done } = yield* container(3);
        const stopped = yield* stopGently(stub, Duration.seconds(5));
        assert.equal(stopped.ended, "exited");
        assert.deepEqual(yield* Ref.get(done), [`signal ${SIGTERM}`]);
      }),
    ));

  test("kills a process that outlives the grace", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const { stub, done } = yield* container(null);
        const stopped = yield* stopGently(stub, Duration.millis(300));
        assert.equal(stopped.ended, "killed");
        // A timer can fire up to a millisecond or so early and `ms` is whole milliseconds, so CI measured 299 ms for a
        // 300 ms grace: the bound allows that, and still fails a stop that did not wait out the grace.
        assert.ok(stopped.ms >= 290 && stopped.ms < 2000, `took ${stopped.ms} ms`);
        assert.deepEqual(yield* Ref.get(done), [`signal ${SIGTERM}`, "destroy"]);
      }),
    ));

  test("kills a container the signal cannot reach", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const { stub, done } = yield* container(1, true);
        const stopped = yield* stopGently(stub, Duration.seconds(5));
        assert.equal(stopped.ended, "killed");
        assert.deepEqual(yield* Ref.get(done), ["destroy"]);
      }),
    ));
});
