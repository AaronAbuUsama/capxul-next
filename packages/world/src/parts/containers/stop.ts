// Stopping a container so its process can shut down cleanly: SIGTERM, then wait for it to exit, and only a process
// that outlives the grace is killed.
//
// Ponder is why. Killed (Cloudflare's `destroy`, SIGKILL), it leaves its schema locked in the world's database, and
// the next Ponder on that database waits out the lock before it recovers: a resume took 26.3 s, 18.4 of them "Schema
// is locked by a different Ponder app" (spikes/world-speed, 4.2). Sent SIGTERM, it exits in 63 to 114 ms and clears
// its lock (4.3), and a resume takes 7 to 10 s (4.4).
import * as Clock from "effect/Clock";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Schedule from "effect/Schedule";

export const SIGTERM = 15;

/** How long a container has to exit after SIGTERM before it is killed: Ponder exits within 0.2 s of it. */
export const STOP_GRACE = Duration.seconds(10);

/** How often a stopping container is looked at. */
export const STOP_POLL = Duration.millis(100);

/** What stopping a container needs of it: whether it runs, a signal to its main process, and the kill. */
export interface Stoppable<E, R> {
  readonly running: Effect.Effect<boolean, E, R>;
  readonly signal: (signo: number) => Effect.Effect<void, E, R>;
  readonly destroy: Effect.Effect<void, E, R>;
}

/** How a stop ended: the process exited after SIGTERM, or it outlived the grace (or the signal failed) and was killed. */
export interface Stopped {
  readonly ended: "exited" | "killed";
  /** How long after the signal the container was seen gone. */
  readonly ms: number;
}

/**
 * SIGTERM, then wait up to `grace` for the container to stop running; kill it if it does not. A container that is
 * not running is left alone by the caller, not here.
 */
export const stopGently = <E, R>(container: Stoppable<E, R>, grace: Duration.Duration = STOP_GRACE) =>
  Effect.gen(function* () {
    const began = yield* Clock.currentTimeMillis;
    const exited = yield* container.signal(SIGTERM).pipe(
      Effect.andThen(
        container.running.pipe(
          Effect.repeat({ schedule: Schedule.spaced(STOP_POLL), until: (running) => !running }),
          Effect.timeoutOption(grace),
        ),
      ),
      Effect.map((seen) => seen._tag === "Some"),
      Effect.orElseSucceed(() => false),
    );
    if (!exited) yield* container.destroy;
    const stopped: Stopped = { ended: exited ? "exited" : "killed", ms: (yield* Clock.currentTimeMillis) - began };
    return stopped;
  });
