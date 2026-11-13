// A step of a world's life: run under its declared timeout, with its duration written down whether it ended well,
// failed or timed out (roadmap rule 6).
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Ref from "effect/Ref";
import type { StepName } from "./record.ts";
import { StepTimedOut, type Timeouts } from "./spec.ts";

export type Durations = Readonly<Partial<Record<StepName, number>>>;

export interface Stopwatch {
  /** Runs one step under its declared timeout and records how long it took. */
  readonly step: <A, E, R>(name: StepName, effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E | StepTimedOut, R>;
  /** The durations recorded so far, in milliseconds. */
  readonly durations: Effect.Effect<Durations>;
}

export const makeStopwatch = (timeouts: Timeouts) =>
  Effect.gen(function* () {
    const taken = yield* Ref.make<Durations>({});
    const step: Stopwatch["step"] = (name, effect) =>
      effect.pipe(
        Effect.timeoutOrElse({
          duration: timeouts[name],
          orElse: () => {
            const afterMs = Duration.toMillis(timeouts[name]);
            return Effect.fail(new StepTimedOut({ step: name, afterMs, message: `the ${name} step did not finish within its declared ${afterMs} ms` }));
          },
        }),
        Effect.exit,
        Effect.timed,
        Effect.tap(([took]) => Ref.update(taken, (was) => ({ ...was, [name]: Math.round(Duration.toMillis(took)) }))),
        Effect.flatMap(([, exit]) => (Exit.isSuccess(exit) ? Effect.succeed(exit.value) : Effect.failCause(exit.cause))),
        Effect.withSpan(`world.${name}`),
      );
    return { step, durations: Ref.get(taken) } satisfies Stopwatch;
  });

export const timeoutsInMillis = (timeouts: Timeouts) => ({
  claim: Duration.toMillis(timeouts.claim),
  deploy: Duration.toMillis(timeouts.deploy),
  migrate: Duration.toMillis(timeouts.migrate),
  chain: Duration.toMillis(timeouts.chain),
  fund: Duration.toMillis(timeouts.fund),
  index: Duration.toMillis(timeouts.index),
  core: Duration.toMillis(timeouts.core),
  use: Duration.toMillis(timeouts.use),
  park: Duration.toMillis(timeouts.park),
  destroy: Duration.toMillis(timeouts.destroy),
  release: Duration.toMillis(timeouts.release),
});
