// A run of the journeys in stages of `CapxulCore` (a run that expects Core's empty handlers), in one of two modes,
// ending in its summary (summary.ts).
//
// `a stage each` (the default): every journey in a fresh stage of its own, one world per journey, its record at
// `<stage>/<journey>.json`, and the summary at `run-<6 hex>/summary.json`.
//
// `one stage`: every journey, one after another, in one fresh stage, which is created and destroyed once. Sound only
// when no journey changes the stage's state, which holds against Core's empty handlers, so it is offered only for a
// run that expects `not-implemented`. The summary is `<stage>/summary.json`, the only JSON file in its folder; each
// journey's run record is one line of `<stage>/journeys.jsonl`, so a dashboard that reads every JSON file of the
// folder counts the summary alone. Every call still gets every generic check; only the stage is shared.
import * as Arr from "effect/Array";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import type * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import { RunnerFailure } from "./failure.ts";
import { recordPath, RunRecord, writeJson, writeJsonLines } from "./record.ts";
import { freshName, recordOf, runPlan, stageSpec, use, type Plan, type Used } from "./run.ts";
import type { Settings } from "./settings.ts";
import { summarize, Summary, type Expectation, type Mode } from "./summary.ts";
import { runInStage, type Lifecycle, type Stage } from "./world/stage.ts";
import { RUN_SPANS, stepOptions } from "./telemetry/step.ts";

const now = Effect.map(DateTime.now, DateTime.formatIso);

const writeSummary = (settings: Settings, summary: Summary) =>
  writeJson(`${settings.records}/${summary.run}/summary.json`, Summary, summary);

/** Every journey in a fresh stage of its own, one at a time. */
const eachInItsOwnStage = (plans: ReadonlyArray<Plan>, settings: Settings, expect: Expectation) =>
  Effect.gen(function* () {
    const startedAt = yield* now;
    const run = yield* freshName("run");
    const records = yield* Effect.forEach(plans, (plan) => runPlan(plan, settings), { concurrency: 1 });
    const summary = summarize({
      run,
      mode: "a stage each",
      expect,
      owner: settings.owner,
      startedAt,
      records,
      pathOf: recordPath,
    });
    yield* writeSummary(settings, summary);
    return summary;
  });

interface Done {
  readonly startedAt: string;
  readonly used: Exit.Exit<Used, RunnerFailure>;
}

/** Every journey, one after another, in one fresh stage. */
const allInOneStage = (plans: ReadonlyArray<Plan>, settings: Settings, expect: Expectation) =>
  Effect.gen(function* () {
    const startedAt = yield* now;
    const name = yield* freshName("core");
    const done = yield* Ref.make<ReadonlyArray<Done>>([]);
    const limit = settings.useTimeout;
    // Each journey has the use timeout of one run; a journey that overruns it fails alone, and the next one runs.
    const each = (stage: Stage) =>
      Effect.forEach(
        plans,
        (plan) =>
          Effect.gen(function* () {
            const started = yield* now;
            const used = yield* use(
              plan,
              settings,
            )(stage).pipe(
              Effect.timeoutOrElse({
                duration: limit,
                orElse: () =>
                  RunnerFailure.make({
                    step: "use",
                    message: `did not finish within its declared ${Duration.toMillis(limit)} ms`,
                  }),
              }),
              Effect.exit,
            );
            yield* Ref.update(done, (all) => [...all, { startedAt: started, used }]);
          }).pipe(Effect.withSpan(RUN_SPANS.run.name, stepOptions(RUN_SPANS.run, { mode: "stage", run: plan.name }))),
        { concurrency: 1, discard: true },
      );
    /** Each journey's record from the shared stage's lifecycle and its own use; undefined use when not reached. */
    const recordsOf = (lifecycle: Lifecycle<void, RunnerFailure>) =>
      Effect.map(Ref.get(done), (all) =>
        Arr.map(plans, (plan, index) => {
          const mine = Arr.get(all, index);
          return recordOf(plan, Option.match(mine, { onNone: () => startedAt, onSome: (d) => d.startedAt }), {
            ...lifecycle,
            used: Option.getOrUndefined(Option.map(mine, (d) => d.used)),
          });
        }),
      );
    const summaryOf = (records: ReadonlyArray<RunRecord>) =>
      summarize({
        run: name,
        mode: "one stage",
        expect,
        owner: settings.owner,
        startedAt,
        records,
        pathOf: (_record, index) => `${name}/journeys.jsonl:${index + 1}`,
      });
    const write = (records: ReadonlyArray<RunRecord>) =>
      Effect.andThen(
        writeJsonLines(`${settings.records}/${name}/journeys.jsonl`, RunRecord, records),
        writeSummary(settings, summaryOf(records)),
      );
    const lifecycle = yield* runInStage(
      stageSpec(name, settings, Duration.times(limit, plans.length)),
      each,
      (progress) => Effect.flatMap(recordsOf(progress), write).pipe(Effect.orDie, Effect.asVoid),
    );
    return summaryOf(yield* recordsOf(lifecycle));
  });

/** Runs `plans` in `mode`, expecting `expect`, and returns the run's summary, which is also on disk by then. */
export const runScenarios = (plans: ReadonlyArray<Plan>, settings: Settings, mode: Mode, expect: Expectation) =>
  mode === "one stage" ? allInOneStage(plans, settings, expect) : eachInItsOwnStage(plans, settings, expect);
