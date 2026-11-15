// Every part of a run in one world, timed in the order it happened (roadmap step 1.18; AGENTS.md, "Measure first"):
// the hub brought up, the world created, each starting world made, saved and kept on the bench, each reset before a
// journey, each journey's steps, the worlds a journey made destroyed, the world destroyed and the hub taken down. A
// part's time is recorded however it ended; nothing fails on speed.
//
// Each part timed here also runs in a span of its own, named in `PART_SPANS` and carrying the part, the journey and
// what it acted on as attributes (roadmap 4.4), so the run's trace holds every part beside the JSON timings. Its
// own steps are spans of the code that does them (the world's reset parts, a save's, a destroy's).
import * as Arr from "effect/Array";
import * as Clock from "effect/Clock";
import * as Option from "effect/Option";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Str from "effect/String";
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

/**
 * The span each timed part runs in, by the first words of the part's name (`make founded` runs in `runner.make`); a
 * part named by none of them runs in `runner.part`. Kept stable: they become the blueprint's declared steps of the
 * pipeline (#301). The run, its journeys and their steps are spans too (`RUN_SPANS`).
 */
export const PART_SPANS = [
  ["hub up", "runner.cluster.up"],
  ["hub down", "runner.cluster.down"],
  ["world create", "runner.world.create"],
  ["world destroy", "runner.world.destroy"],
  ["make ", "runner.make"],
  ["save ", "runner.save"],
  ["bench template ", "runner.site-template.keep"],
  ["bench sites", "runner.sites.list"],
  ["reset", "runner.reset"],
  ["restore", "runner.restore"],
  ["starting world", "runner.journey.start"],
  ["keep facts ", "runner.facts.keep"],
  ["move kept facts", "runner.facts.move"],
  ["renew", "runner.renew"],
] as const;

/** The span of a part no entry of `PART_SPANS` names. */
export const OTHER_PART = "runner.part";

/** The span the part `part` runs in. */
export const spanOf = (part: string): string =>
  Arr.findFirst(PART_SPANS, ([prefix]) => part === Str.trimEnd(prefix) || Str.startsWith(prefix)(part)).pipe(
    Option.map(([, span]) => span),
    Option.getOrElse(() => OTHER_PART),
  );

/** The spans of the run itself: its root, each journey and each of its steps. */
export const RUN_SPANS = {
  /** The root of a run's trace (main.ts); the door's and the stage runs' own (run.ts, scenario-runs.ts) too. */
  run: "runner.run",
  /** One step of a journey, from the journey's `begin` to its `end` (steps.ts). */
  step: "runner.journey.step",
} as const;

/** A part's span attributes: what was timed, and the journey and the world it was for, when it was for one. */
const attributesOf = (part: string, extra: Extra): Record<string, string> => ({
  part,
  ...(extra.journey === undefined ? {} : { journey: extra.journey }),
  ...(extra.of === undefined ? {} : { of: extra.of }),
});

/** The run's clock: every timed part appended in order. */
export const makeTimings = Effect.gen(function* () {
  const began = yield* Clock.currentTimeMillis;
  const all = yield* Ref.make<ReadonlyArray<Timing>>([]);
  const add = (entry: Timing) => Ref.update(all, (was) => [...was, entry]);

  /**
   * Runs `effect` as the part `part`, in its span (`spanOf`), and records how long it took and how it ended; `more`
   * adds what its own answer says (its parts' times, a note). Its outcome is handed back unchanged.
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
    }).pipe(Effect.withSpan(spanOf(part), { attributes: attributesOf(part, extra) }));

  /** Records a part timed elsewhere: `ms` long, ending now. */
  const record = (part: string, ms: number, extra: Extra, ok = true) =>
    Effect.flatMap(Clock.currentTimeMillis, (now) => add({ part, ...extra, atMs: now - ms - began, ms, ok }));

  return { timed, record, all: Ref.get(all) };
});

export type Timings = Effect.Success<typeof makeTimings>;
