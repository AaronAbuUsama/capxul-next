// A chain read whose connection drops is sent again, a few times; an answer, a refusal or any other defect never is
// (support/steady.ts).
import { strict as assert } from "node:assert";
import { test } from "node:test";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import { Steps } from "../src/journal.ts";
import { STEADY, steadily } from "../src/support/steady.ts";

/** A read that dies with each of `deaths` in turn, then answers 7; `tries` counts how often it was sent. */
const reading = (deaths: ReadonlyArray<string>, tries: { count: number }) =>
  Effect.suspend(() => {
    const death = deaths[tries.count];
    tries.count += 1;
    return death === undefined ? Effect.succeed(7) : Effect.die(new Error(death));
  });

/** Runs `read` steadily, keeping in `told` what it tells the runner it sent again. */
const run = <A, E>(read: Effect.Effect<A, E>, told: Array<string> = []) =>
  steadily(read, "chain head").pipe(
    Effect.provideService(Steps, {
      begin: () => Effect.void,
      tried: () => Effect.void,
      end: () => Effect.void,
      resent: (what) => Effect.sync(() => told.push(what)),
    }),
    Effect.runPromiseExit,
  );

test("a read whose connection was reset, then refused, is sent again, answers, and each resend is told", async () => {
  const tries = { count: 0 };
  const told: Array<string> = [];
  const exit = await run(reading(["read ECONNRESET", "connect ECONNREFUSED 127.0.0.1:9"], tries), told);
  assert.deepEqual(exit, Exit.succeed(7));
  assert.equal(tries.count, 3);
  assert.equal(told.length, 2);
  assert.match(told[0] ?? "", /^chain head: try 1 of 3 got no answer \(.*ECONNRESET.*\), sent again$/u);
});

test("a read whose connection keeps dropping stops after the last try", async () => {
  const tries = { count: 0 };
  const exit = await run(
    reading(
      Array.from({ length: STEADY.tries + 2 }, () => "read ECONNRESET"),
      tries,
    ),
  );
  assert.ok(Exit.isFailure(exit));
  assert.equal(tries.count, STEADY.tries);
});

test("a read that died of anything else is not sent again", async () => {
  const tries = { count: 0 };
  const told: Array<string> = [];
  const exit = await run(reading(["the answer is not of its schema"], tries), told);
  assert.ok(Exit.isFailure(exit));
  assert.equal(tries.count, 1);
  assert.deepEqual(told, []);
});

test("a refusal is not sent again", async () => {
  const tries = { count: 0 };
  const refused = Effect.suspend(() => {
    tries.count += 1;
    return Effect.fail("refused");
  });
  const exit = await run(refused);
  assert.deepEqual(exit, Exit.fail("refused"));
  assert.equal(tries.count, 1);
});
