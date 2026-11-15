// Waiting for background work: a site becoming ready, a sent payment posting, a site user appearing. A claim that
// waits polls an operation until it answers differently (packages/blueprint/docs/decisions.md, entry 27). How often and
// how long are declared here, once: a wait that runs out fails the scenario with what it waited for.
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Schedule from "effect/Schedule";
import { ExpectationFailed } from "../expectation.ts";

/** One poll every two seconds, for at most five minutes: a site's creation is the slowest wait of the thin line. */
export const WAIT = { every: Duration.seconds(2), attempts: 150 } as const;

/** Runs `check` until `done` holds of its answer, and answers that; fails when the wait runs out. */
export const eventually = <A, E, R>(
  what: string,
  check: Effect.Effect<A, E, R>,
  done: (answer: A) => boolean,
): Effect.Effect<A, E | ExpectationFailed, R> => {
  const attempt = (left: number): Effect.Effect<A, E | ExpectationFailed, R> =>
    Effect.flatMap(check, (answer) => {
      if (done(answer)) return Effect.succeed(answer);
      if (left <= 1)
        return Effect.fail(
          ExpectationFailed.make({
            message: `waited ${WAIT.attempts} times ${Duration.format(WAIT.every)} for ${what}`,
          }),
        );
      return Effect.andThen(
        Effect.sleep(WAIT.every),
        Effect.suspend(() => attempt(left - 1)),
      );
    });
  return attempt(WAIT.attempts);
};

/** Runs `call` again while it is refused with `tag`; any other answer or refusal ends the wait. */
export const whileRefused = <A, E extends { readonly _tag: string }, R>(
  tag: E["_tag"],
  call: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> =>
  Effect.retry(call, {
    while: (error) => error._tag === tag,
    schedule: Schedule.spaced(WAIT.every),
    times: WAIT.attempts,
  });
