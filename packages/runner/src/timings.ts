// Every part of a run in one world, timed in the order it happened (roadmap step 1.18; AGENTS.md, "Measure first"):
// the hub brought up, the world created, each starting world made, saved and kept on the bench, each reset before a
// journey, each journey's steps, the worlds a journey made destroyed, the world destroyed and the hub taken down. A
// part's time is recorded however it ended; nothing fails on speed.
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import { describe } from "./failure.ts";

export const TimedStep = Schema.Struct({
  step: Schema.Finite,
  operation: Schema.String,
  outcome: Schema.String,
  ms: Schema.NullOr(Schema.Finite),
});

export const Timing = Schema.Struct({
  /** What was timed: `hub up`, `world create`, `make <starting world>`, `save <…>`, `reset`, `journey`, … */
  part: Schema.String,
  /** The journey it was for, when it was for one. */
  journey: Schema.optional(Schema.String),
  /** The world or hub it acted on, or the snapshot a reset went to. */
  of: Schema.optional(Schema.String),
  /** When it began, in milliseconds since the run began. */
  atMs: Schema.Finite,
  ms: Schema.Finite,
  /** Whether it ended without a failure; why not, when it did not. */
  ok: Schema.Boolean,
  why: Schema.optional(Schema.String),
  /** Its own parts' times, as the part reports them (a reset's index, database, chain, clock, sites, …). */
  parts: Schema.optional(Schema.Record(Schema.String, Schema.Finite)),
  /** What it did that the times alone do not say (how a reset put the sites back, which worlds were destroyed). */
  note: Schema.optional(Schema.String),
  /** A journey's steps, each with its time. */
  steps: TimedStep.pipe(Schema.Array, Schema.optional),
});
export type Timing = typeof Timing.Type;

type Extra = Partial<Pick<Timing, "journey" | "of" | "parts" | "note" | "steps">>;

/** The run's clock: every timed part appended in order. */
export const makeTimings = Effect.gen(function* () {
  const began = yield* Clock.currentTimeMillis;
  const all = yield* Ref.make<ReadonlyArray<Timing>>([]);
  const add = (entry: Timing) => Ref.update(all, (was) => [...was, entry]);

  /**
   * Runs `effect` as the part `part` and records how long it took and how it ended; `more` adds what its own answer
   * says (its parts' times, a note). Its outcome is handed back unchanged.
   */
  const timed = <A, E, R>(part: string, extra: Extra, effect: Effect.Effect<A, E, R>, more?: (value: A) => Extra) =>
    Effect.gen(function* () {
      const start = yield* Clock.currentTimeMillis;
      const exit = yield* Effect.exit(effect);
      const end = yield* Clock.currentTimeMillis;
      yield* add({
        part,
        ...extra,
        ...(Exit.isSuccess(exit) && more !== undefined ? more(exit.value) : {}),
        atMs: start - began,
        ms: end - start,
        ok: Exit.isSuccess(exit),
        ...(Exit.isFailure(exit) ? { why: describe(exit.cause) } : {}),
      });
      return yield* exit;
    });

  /** Records a part timed elsewhere: `ms` long, ending now. */
  const record = (part: string, ms: number, extra: Extra, ok = true) =>
    Effect.flatMap(Clock.currentTimeMillis, (now) => add({ part, ...extra, atMs: now - ms - began, ms, ok }));

  return { timed, record, all: Ref.get(all) };
});

export type Timings = Effect.Success<typeof makeTimings>;
