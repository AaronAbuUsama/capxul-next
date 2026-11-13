import * as assert from "node:assert/strict";
import { describe, test } from "node:test";
import * as Arr from "effect/Array";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Ref from "effect/Ref";
import {
  BUNDLER_START,
  CHAIN_START,
  INDEX_START,
  KEPT_ATTEMPTS,
  type Patience,
  reportOf,
  type StartAttempt,
  type StartReport,
  startPatiently,
} from "../src/containers/patience.ts";
import { Timeouts } from "../src/lifecycle/spec.ts";

/** What Alchemy fails a start with when Cloudflare cannot place it. */
const REFUSAL = {
  _tag: "NoContainerInstanceError",
  message: "There is no container instance that can be provided to this Durable Object, try again later",
};

const quick: Patience = { within: Duration.seconds(2), first: Duration.millis(10), most: Duration.millis(40) };

/**
 * A container that refuses `refusals` starts, then runs, and answers once it has been asked `notReady` more times.
 * Gives back its handles and how many starts it was asked for.
 */
const stubbed = (refusals: number, notReady = 0) =>
  Effect.gen(function* () {
    const up = yield* Ref.make(false);
    const starts = yield* Ref.make(0);
    const looks = yield* Ref.make(0);
    const start = Ref.updateAndGet(starts, (count) => count + 1).pipe(
      Effect.flatMap((n) => (n <= refusals ? Effect.fail(REFUSAL) : Ref.set(up, true))),
    );
    const ready = Ref.updateAndGet(looks, (count) => count + 1).pipe(
      Effect.flatMap((n) => (n <= notReady ? Effect.fail("the port does not answer yet") : Effect.void)),
    );
    return { running: Ref.get(up), start, ready, starts };
  });

const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromiseExit(effect);

const report = (tried: StartReport) => tried;

/** What an exit that must have succeeded holds. */
const valueOf = <A, E>(exit: Exit.Exit<A, E>): A => {
  if (Exit.isFailure(exit)) return assert.fail(`it failed: ${String(exit.cause)}`);
  return exit.value;
};

const attempt = (i: number): StartAttempt => ({ at: `t${i}`, ms: 1, started: true, outcome: "refused", message: null });

const room = (step: Duration.Duration, patience: Patience) =>
  Duration.toMillis(step) - Duration.toMillis(patience.within);

describe("a refused container start is tried again", () => {
  test("two refusals, then a start that answers: three tries, each written down with its duration", async () => {
    const exit = await run(
      Effect.gen(function* () {
        const container = yield* stubbed(2);
        const got = yield* startPatiently({ ...container, patience: quick, gaveUp: report });
        return { got, starts: yield* Ref.get(container.starts) };
      }),
    );
    const { got, starts } = valueOf(exit);
    assert.strictEqual(starts, 3);
    assert.deepStrictEqual(
      Arr.map(got.attempts, (one) => one.outcome),
      ["refused", "refused", "ready"],
    );
    assert.strictEqual(got.startCalls, 3);
    assert.strictEqual(got.refusals, 2);
    assert.ok(Arr.every(got.attempts, (one) => one.ms >= 0 && one.started));
    assert.match(got.attempts[0]?.message ?? "", /NoContainerInstanceError: There is no container instance/);
    assert.strictEqual(got.attempts[2]?.message, null);
  });

  test("the wait after each refusal doubles, up to the most", async () => {
    const exit = await run(
      Effect.gen(function* () {
        const container = yield* stubbed(4);
        return yield* startPatiently({ ...container, patience: quick, gaveUp: report });
      }),
    );
    const at = Arr.map(valueOf(exit).attempts, (one) => Date.parse(one.at));
    const gaps = Arr.map(Arr.drop(at, 1), (moment, i) => moment - (at[i] ?? moment));
    // Waits of 10, 20, 40 and 40 ms (the most): each gap between two tries is at least its wait.
    assert.strictEqual(gaps.length, 4);
    Arr.forEach([10, 20, 40, 40], (wait, i) => assert.ok((gaps[i] ?? 0) >= wait - 1, `gap ${i} was ${gaps[i]} ms`));
  });

  test("a container that runs but does not answer yet is looked at again, not started again", async () => {
    const exit = await run(
      Effect.gen(function* () {
        const container = yield* stubbed(0, 3);
        const got = yield* startPatiently({ ...container, patience: quick, gaveUp: report });
        return { got, starts: yield* Ref.get(container.starts) };
      }),
    );
    const { got, starts } = valueOf(exit);
    assert.strictEqual(starts, 1);
    assert.deepStrictEqual(
      Arr.map(got.attempts, (one) => [one.started, one.outcome]),
      [
        [true, "not ready"],
        [false, "not ready"],
        [false, "not ready"],
        [false, "ready"],
      ],
    );
  });

  test("a start refused for good gives up within its window, with every try", async () => {
    const began = Date.now();
    const exit = await run(
      Effect.gen(function* () {
        const container = yield* stubbed(Number.POSITIVE_INFINITY);
        return yield* startPatiently({
          ...container,
          patience: { within: Duration.millis(300), first: Duration.millis(10), most: Duration.millis(40) },
          gaveUp: report,
        });
      }),
    );
    const took = Date.now() - began;
    if (Exit.isSuccess(exit)) assert.fail("a start refused for good was ready");
    const failure = exit.cause.reasons[0];
    if (failure?._tag !== "Fail") assert.fail(`it ended by ${String(exit.cause)}`);
    const gaveUp = failure.error;
    assert.ok(gaveUp.attempts.length > 3, `${gaveUp.attempts.length} tries`);
    assert.ok(Arr.every(gaveUp.attempts, (one) => one.outcome === "refused"));
    assert.strictEqual(gaveUp.refusals, gaveUp.attempts.length);
    assert.ok(gaveUp.ms <= 300 + 20, `the tries took ${gaveUp.ms} ms`);
    assert.ok(took < 1000, `the whole took ${took} ms`);
  });

  test("a try that hangs is cut off at the window", async () => {
    const exit = await run(
      startPatiently({
        running: Effect.succeed(false),
        start: Effect.never,
        ready: Effect.void,
        patience: { within: Duration.millis(100), first: Duration.millis(10), most: Duration.millis(40) },
        gaveUp: report,
      }),
    );
    if (Exit.isSuccess(exit)) assert.fail("a start that never returns was ready");
  });

  test("a record keeps the first try and the latest when there are many", () => {
    const kept = reportOf(Arr.makeBy(50, attempt), 50);
    assert.strictEqual(kept.attempts.length, KEPT_ATTEMPTS);
    assert.strictEqual(kept.attempts[0]?.at, "t0");
    assert.strictEqual(kept.attempts[KEPT_ATTEMPTS - 1]?.at, "t49");
    assert.strictEqual(kept.refusals, 50);
  });
});

describe("each part's patience sits inside its step's declared timeout (lifecycle rule 6)", () => {
  const timeouts = Effect.runSync(Timeouts);
  test("the chain step holds the chain's patience and a minute more", () => {
    assert.ok(room(timeouts.chain, CHAIN_START) >= 60_000);
  });
  test("the index step holds the index's patience and a minute for Ponder's own start", () => {
    assert.ok(room(timeouts.index, INDEX_START) >= 60_000);
  });
  test("the bundler step holds the bundler's patience and a minute for the paymaster's setup", () => {
    assert.ok(room(timeouts.bundler, BUNDLER_START) >= 60_000);
  });
});
