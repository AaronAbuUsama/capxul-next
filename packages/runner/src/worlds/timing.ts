// `./run.sh starting-worlds`: makes every starting world the runner can make, in the blueprint's order, as a journey
// of it would get it, and times each: in the run's one world on its hub (worlds/hub.ts), each made once and saved,
// then for each the one world reset to it and what it makes by its steps made. Every call made on the way gets the
// generic checks. Each other world made for one starting world is destroyed before the next is made, the one world at
// the end, and the accounts are read for anything of them afterwards. A starting world the runner cannot make yet
// says which operations its steps wait on. Every part's time is in `timings`.
import { startingWorlds } from "@capxul/blueprint";
import * as Arr from "effect/Array";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Rec from "effect/Record";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import { CheckedCall, failuresOf } from "../checks/checks.ts";
import { describe } from "../failure.ts";
import { Outcome, passedOr, writeJson } from "../record.ts";
import { freshName, keptFor } from "../run.ts";
import { checkedOrPlumbing } from "../telemetry/kept.ts";
import type { Settings } from "../settings.ts";
import { Inventory } from "../world/leftovers.ts";
import { waitsOn } from "./makers.ts";
import { coreLabel, Platform } from "./platform.ts";
import { Timing, makeTimings } from "../timings.ts";
import { onHub } from "./hub.ts";
import { destroyAll, leftOf, takeDownWorlds } from "./teardown.ts";
import { startingWorldsOf } from "./starting.ts";

const Line = Schema.Struct({
  name: Schema.String,
  made: Schema.Literals(["from its template", "by its steps"]),
  /** `made`: the runner made it; `waits`: its steps call operations not built yet; `failed`: making it failed. */
  outcome: Schema.Literals(["made", "waits", "failed"]),
  /** From the first call to the world handed over, the template's making included the first time it is needed. */
  ms: Schema.Finite,
  why: Schema.NullOr(Schema.String),
  /** Every call made for it, checked. */
  calls: Schema.Array(CheckedCall),
});

export const StartingWorldsRecord = Schema.Struct({
  kind: Schema.Literal("starting worlds"),
  run: Schema.String,
  startedAt: Schema.String,
  /** `passed` when every world the runner can make was made, every call passed every check, and nothing is left. */
  outcome: Outcome,
  /** Where Core ran, when not on Cloudflare (src/local/host.ts). */
  core: Schema.optional(Schema.String),
  failure: Schema.NullOr(Schema.String),
  worlds: Schema.Array(Line),
  /** The one world, and how long its destroy took at the end. */
  templates: Schema.Array(Schema.String),
  destroyMs: Schema.Finite,
  /** Every part of the run, timed in order (src/timings.ts). */
  timings: Timing.pipe(Schema.Array, Schema.optional),
  /** What the accounts held of every world of the run afterwards: empty when nothing is left. */
  after: Schema.NullOr(Inventory),
});
export type StartingWorldsRecord = typeof StartingWorldsRecord.Type;

const millis = (took: Duration.Duration) => Math.round(Duration.toMillis(took));

export const timeStartingWorlds = (settings: Settings) =>
  Effect.gen(function* () {
    const platform = yield* Platform;
    const startedAt = DateTime.formatIso(yield* DateTime.now);
    const run = yield* freshName("run");
    const timings = yield* makeTimings;
    // The runner's own failures to read what the api kept of a world's calls: those calls then hold no checks.
    const plumbing = yield* Ref.make<ReadonlyArray<string>>([]);
    const [lines, templates, destroyMs, notTakenDown] = yield* onHub(settings, timings, () =>
      Effect.gen(function* () {
        const starting = yield* startingWorldsOf(settings, platform.url, timings);
        const all = Rec.values(startingWorlds);
        // A starting world that was not made, a defect included, is each line's `why` below.
        yield* Effect.ignoreCause(starting.prepare(Arr.filter(all, (world) => waitsOn(world).length === 0)));
        const made = yield* Effect.forEach(all, (world) =>
          Effect.gen(function* () {
            const before = yield* platform.made;
            const callsBefore = (yield* starting.made).length;
            const [took, exit] = yield* Effect.andThen(
              world === startingWorlds.nothing ? Effect.void : starting.resetFor(world, world.name),
              starting.forScenario(world),
            ).pipe(Effect.exit, Effect.timed);
            const calls = Arr.map(Arr.drop(yield* starting.made, callsBefore), (each) => each.call);
            const found = yield* checkedOrPlumbing(calls, keptFor(Option.none(), calls));
            yield* Ref.update(plumbing, (so) => [
              ...so,
              ...Arr.map(found.plumbing, (each) => `${world.name}: ${each}`),
            ]);
            const one = yield* starting.templateWorlds;
            yield* destroyAll(Arr.filter(Arr.drop(yield* platform.made, before.length), (s) => !Arr.contains(one, s)));
            const waits = waitsOn(world);
            const outcome: (typeof Line.Type)["outcome"] = Exit.isSuccess(exit)
              ? "made"
              : waits.length > 0
                ? "waits"
                : "failed";
            yield* Effect.log(`${world.name}: ${outcome} in ${millis(took)} ms`);
            return {
              name: world.name,
              made: world.made,
              outcome,
              ms: millis(took),
              why: Exit.isSuccess(exit) ? null : describe(exit.cause),
              calls: found.checked,
            };
          }),
        ).pipe(
          // Whatever ends the making early, the one world goes too.
          Effect.onExit((ended) =>
            Exit.isSuccess(ended) ? Effect.void : Effect.flatMap(starting.templateWorlds, destroyAll),
          ),
        );
        // The bench templates kept stay for the sweep (docs/roadmap.md, "Bench templates never change").
        const ones = yield* starting.templateWorlds;
        const done = yield* takeDownWorlds(ones, timings);
        return [made, ones, done.destroyMs, done.failed] as const;
      }),
    );
    const after = yield* leftOf(Arr.dedupe([...(yield* platform.made), ...(yield* platform.tried)]));
    const failures = [
      ...Arr.flatMap(lines, (line) => (line.outcome === "failed" ? [`${line.name}: ${line.why ?? ""}`] : [])),
      ...failuresOf(Arr.flatMap(lines, (line) => line.calls)),
      ...(yield* Ref.get(plumbing)),
      ...notTakenDown,
      ...(after === null || (after.worlds ?? []).length > 0
        ? ["the accounts still hold some of the run's worlds"]
        : []),
    ];
    const core = yield* coreLabel;
    const record: StartingWorldsRecord = {
      kind: "starting worlds",
      run,
      startedAt,
      outcome: failures.length === 0 ? passedOr(core) : "failed",
      ...(core === undefined ? {} : { core }),
      failure: failures.length === 0 ? null : Arr.join(failures, "\n"),
      worlds: lines,
      templates,
      destroyMs,
      timings: yield* timings.all,
      after,
    };
    yield* Effect.orDie(writeJson(`${settings.records}/${run}/starting-worlds.json`, StartingWorldsRecord, record));
    return record;
  });
