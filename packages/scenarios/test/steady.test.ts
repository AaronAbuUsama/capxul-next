// A chain read whose connection drops is sent again, a few times; an answer, a refusal or any other defect never is
// (support/steady.ts).
import { strict as assert } from "node:assert";
import { test } from "node:test";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import { STEADY, steadily } from "../src/support/steady.ts";

/** A read that dies with each of `deaths` in turn, then answers 7; `tries` counts how often it was sent. */
const reading = (deaths: ReadonlyArray<string>, tries: { count: number }) =>
  Effect.suspend(() => {
    const death = deaths[tries.count];
    tries.count += 1;
    return death === undefined ? Effect.succeed(7) : Effect.die(new Error(death));
  });

const run = <A, E>(read: Effect.Effect<A, E>) => steadily(read).pipe(Effect.runPromiseExit);

test("a read whose connection dropped twice is sent again and answers", async () => {
  const tries = { count: 0 };
  const exit = await run(reading(["read ECONNRESET", "socket hang up"], tries));
  assert.deepEqual(exit, Exit.succeed(7));
  assert.equal(tries.count, 3);
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
  const exit = await run(reading(["the answer is not of its schema"], tries));
  assert.ok(Exit.isFailure(exit));
  assert.equal(tries.count, 1);
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
