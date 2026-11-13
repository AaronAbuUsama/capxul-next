// Starting one of a world's containers from its Durable Object, patiently. Cloudflare refuses a start for a while
// ("There is no container instance that can be provided to this Durable Object, try again later"): on a container
// application that was just made, until it has instances, and again now and then when a container went away and its
// Durable Object starts it anew. A start it accepted can also be lost: the container never answers. So a start is
// tried again until the container is ready, with backoff, within a declared window, and every try is written down
// with how long it took. The chain, the index and the bundler each start their containers through here.
//
// Each window is a declared limit (roadmap lifecycle rule 6), set from measured runs (README, Timings), and sits
// inside the declared timeout of the world step that waits on it (src/lifecycle/spec.ts, checked by
// test/patience.test.ts), so a refused start fails as the part's own failure, with its tries, before the step's
// timeout would cut it off.
import * as Arr from "effect/Array";
import * as Clock from "effect/Clock";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import { describe } from "../lifecycle/describe.ts";
import { stamp } from "./record.ts";

/** How patient a start is: how long all tries may take together, and how long to wait between two. */
export interface Patience {
  /** The most all tries together may take, the one under way included. */
  readonly within: Duration.Duration;
  /** The wait after the first refusal, and between two looks at a container that started but does not answer yet. */
  readonly first: Duration.Duration;
  /** Each refusal doubles the wait before the next try, up to this. */
  readonly most: Duration.Duration;
}

/**
 * The chain: anvil answers within 1 to 3 s of an accepted start (README, Timings: the chain step's median is 2.5 s).
 * Two minutes is far past any start seen, and leaves a minute of the chain step's 3 for the rest of it.
 */
export const CHAIN_START: Patience = {
  within: Duration.minutes(2),
  first: Duration.seconds(1),
  most: Duration.seconds(8),
};

/**
 * The index: in the twenty creates recorded before this window (packages/runner/records, run-717645 and run-e710b3),
 * Cloudflare refused the index's first start for 0 to 54 s in nineteen and for all of the 180 s the step then had in
 * one. Four minutes, as long as the bundler, which is refused in the same way on the same kind of application, has
 * always had; the index step adds a minute for Ponder's own start (README, Timings).
 */
export const INDEX_START: Patience = {
  within: Duration.minutes(4),
  first: Duration.seconds(1),
  most: Duration.seconds(8),
};

/** The bundler: alto on a new container application took 2 to 13 start calls and up to 44.6 s (README, Timings). */
export const BUNDLER_START: Patience = {
  within: Duration.minutes(4),
  first: Duration.seconds(1),
  most: Duration.seconds(8),
};

/** One try at starting a container and finding it ready. */
export interface StartAttempt {
  readonly at: string;
  readonly ms: number;
  /** Whether this try asked Cloudflare to start the container: it was not running when the try began. */
  readonly started: boolean;
  /** refused: the start failed; not ready: the container runs but does not answer yet; ready: it answers. */
  readonly outcome: "refused" | "not ready" | "ready";
  /** Why a try that was not ready was not, in one line. */
  readonly message: string | null;
}

/** Every try of one start, and how long they took together. */
export interface StartReport {
  readonly attempts: ReadonlyArray<StartAttempt>;
  readonly ms: number;
  /** How many tries asked Cloudflare to start the container. */
  readonly startCalls: number;
  /** How many of those Cloudflare refused. */
  readonly refusals: number;
}

/** How many tries a record keeps of one start: the first one and the latest, when there were more. */
export const KEPT_ATTEMPTS = 30;

/** A start's tries, summed up. */
export const reportOf = (attempts: ReadonlyArray<StartAttempt>, ms: number): StartReport => ({
  attempts:
    Arr.length(attempts) <= KEPT_ATTEMPTS
      ? attempts
      : [...Arr.take(attempts, 1), ...Arr.takeRight(attempts, KEPT_ATTEMPTS - 1)],
  ms,
  startCalls: Arr.filter(attempts, (attempt) => attempt.started).length,
  refusals: Arr.filter(attempts, (attempt) => attempt.outcome === "refused").length,
});

/** One line that says how a start that never got ready went: its tries, and why the last one was not ready. */
export const gaveUpMessage = (what: string, patience: Patience, report: StartReport): string => {
  const last = Option.match(Arr.last(report.attempts), {
    onNone: () => "no try finished",
    onSome: (attempt) => `the last ${attempt.outcome}: ${attempt.message ?? "no reason given"}`,
  });
  return `${what} was not ready within ${Duration.format(patience.within)}: ${Arr.length(report.attempts)} tries, ${report.refusals} refused; ${last}`;
};

/**
 * Starts a container until it is ready. Each try starts it if it is not running, then asks whether it is ready. A
 * refused start doubles the wait before the next try, up to `most`; a container that runs but does not answer yet is
 * looked at again after `first`. No try begins once the next one could not finish inside `within`, and the whole is
 * cut off at `within` whatever a try is doing. Gives back every try, or fails with `gaveUp` of them.
 */
export const startPatiently = <A, E1, E2, E3, R1, R2, R3, F>(options: {
  readonly running: Effect.Effect<boolean, E1, R1>;
  readonly start: Effect.Effect<A, E2, R2>;
  readonly ready: Effect.Effect<unknown, E3, R3>;
  readonly patience: Patience;
  readonly gaveUp: (report: StartReport) => F;
}): Effect.Effect<StartReport, F, R1 | R2 | R3> =>
  Effect.gen(function* () {
    const { patience } = options;
    const withinMs = Duration.toMillis(patience.within);
    const began = yield* Clock.currentTimeMillis;
    const attempts = yield* Ref.make<ReadonlyArray<StartAttempt>>([]);

    const tryOnce = Effect.gen(function* () {
      const at = yield* Clock.currentTimeMillis;
      const up = yield* options.running.pipe(Effect.orElseSucceed(() => false));
      const started = up ? Exit.void : yield* options.start.pipe(Effect.asVoid, Effect.exit);
      const answered = Exit.isSuccess(started) ? yield* Effect.exit(options.ready) : Exit.void;
      const ms = (yield* Clock.currentTimeMillis) - at;
      const attempt: StartAttempt = Exit.isFailure(started)
        ? { at: stamp(at), ms, started: true, outcome: "refused", message: describe(started.cause) }
        : Exit.isFailure(answered)
          ? { at: stamp(at), ms, started: !up, outcome: "not ready", message: describe(answered.cause) }
          : { at: stamp(at), ms, started: !up, outcome: "ready", message: null };
      yield* Ref.update(attempts, Arr.append(attempt));
      return attempt;
    });

    const loop = (wait: Duration.Duration): Effect.Effect<boolean, never, R1 | R2 | R3> =>
      Effect.gen(function* () {
        const attempt = yield* tryOnce;
        if (attempt.outcome === "ready") return true;
        const next = attempt.outcome === "refused" ? wait : patience.first;
        const spent = (yield* Clock.currentTimeMillis) - began;
        // A try takes about as long as the last one did; one that could not finish in time is not begun.
        if (spent + Duration.toMillis(next) + attempt.ms >= withinMs) return false;
        yield* Effect.sleep(next);
        const after = attempt.outcome === "refused" ? Duration.min(Duration.times(wait, 2), patience.most) : wait;
        return yield* loop(after);
      });

    const ready = yield* loop(patience.first).pipe(
      Effect.timeoutOrElse({ duration: patience.within, orElse: () => Effect.succeed(false) }),
    );
    const report = reportOf(yield* Ref.get(attempts), (yield* Clock.currentTimeMillis) - began);
    return ready ? report : yield* Effect.fail(options.gaveUp(report));
  });
