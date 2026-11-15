// A step of a world's life: run under its declared timeout, with its duration written down whether it ended well,
// failed or timed out (roadmap rule 6).
import * as Clock from "effect/Clock";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Rec from "effect/Record";
import * as Ref from "effect/Ref";
import { StepTimedOut } from "./failures.ts";
import type { StepName } from "../stack/names.ts";
import type { Timeouts } from "../things/world/values.ts";

export type Durations = Readonly<Partial<Record<StepName, number>>>;

export interface Stopwatch {
  /** Runs one step under its declared timeout and records how long it took. */
  readonly step: <A, E, R>(name: StepName, effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E | StepTimedOut, R>;
  /** The durations recorded so far, in milliseconds. */
  readonly durations: Effect.Effect<Durations>;
}

export const makeStopwatch = Effect.fn("world.stopwatch")(function* (timeouts: Timeouts) {
  const taken = yield* Ref.make<Durations>({});
  // The duration is written however the step ends: done, failed, timed out or interrupted.
  const step: Stopwatch["step"] = (name, effect) =>
    Effect.gen(function* () {
      const began = yield* Clock.currentTimeMillis;
      const note = Effect.flatMap(Clock.currentTimeMillis, (now) =>
        Ref.update(taken, (was) => ({ ...was, [name]: now - began })),
      );
      const afterMs = Duration.toMillis(timeouts[name]);
      return yield* effect.pipe(
        Effect.timeoutOrElse({
          duration: timeouts[name],
          orElse: () =>
            Effect.fail(
              StepTimedOut.make({
                step: name,
                afterMs,
                message: `the ${name} step did not finish within its declared ${afterMs} ms`,
              }),
            ),
        }),
        Effect.ensuring(note),
      );
    }).pipe(Effect.withSpan(`world.${name}`));
  return { step, durations: Ref.get(taken) } satisfies Stopwatch;
});

/** Every step's declared timeout, in milliseconds, as a record holds them. */
export const timeoutsInMillis = (timeouts: Timeouts): Readonly<Record<StepName, number>> =>
  Rec.map(timeouts, Duration.toMillis);
