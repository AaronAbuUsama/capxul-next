// A run of the journeys in one world (`./run.sh scenarios`, expecting `pass`; roadmap step 1.18 and the decision "One
// runner, one world"): the platform served by this process (platform.ts), the run's hub brought up (hub.ts), its one
// world created on it and every starting world the journeys name made in it once and saved (starting.ts); then for
// each journey the world reset in place to its starting world, what that world makes by its steps made, the journey
// run through the door with its operations' checks and the generic checks on every call, and every other world it
// made destroyed after it, whatever happened, with the accounts read before and after for anything of them. The one
// world and the hub go when the run ends, however it ends. Every part is timed into the summary (`timings`).
import type { Journey } from "@capxul/scenarios";
import * as World from "@capxul/world";
import * as Arr from "effect/Array";
import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Ref from "effect/Ref";
import { checkCall, failuresOf } from "../checks/checks.ts";
import type { Call } from "../client.ts";
import { describe, endedOf } from "../failure.ts";
import { passedOr, slugOf, writeJson, RunRecord } from "../record.ts";
import { freshName, journeyPlan, keptFor, stepsFor, use, viaOf } from "../run.ts";
import { stepsOf } from "../steps.ts";
import type { Settings } from "../settings.ts";
import { makeTimings, type Timings } from "../timings.ts";
import { answersSteadily } from "../world/warmup.ts";
import type { Stage } from "../world/stage.ts";
import { noteNotMade, summaryOf } from "./ending.ts";
import { onHub, type HubUse } from "./hub.ts";
import { coreLabel, Platform } from "./platform.ts";
import { sharedStartingWorldsOf, type SharedStartingWorlds } from "../shared/starting.ts";
import { startingWorldsOf, type StartingWorlds } from "./starting.ts";
import { destroyAll, destroyStrays, leftOf, takeDownWorlds } from "./teardown.ts";

/** The starting worlds of a run: made in its one world, or restored from a shared world (shared/starting.ts). */
type Starting = StartingWorlds | SharedStartingWorlds;

const now = Effect.map(DateTime.now, DateTime.formatIso);

const millis = (took: Duration.Duration) => Math.round(Duration.toMillis(took));
const NOWHERE = "http://127.0.0.1:9";

/** The checked calls of `calls`, read from where each was kept. */
const checked = (calls: ReadonlyArray<Call>) =>
  Effect.gen(function* () {
    const kept = yield* keptFor(Option.none(), calls);
    return Arr.map(calls, (call) => checkCall(call, kept));
  });

/** The one world reset to the journey's starting world, what it makes by its steps made, and the journey run. */
const work = (scenario: Journey, settings: Settings, starting: Starting, timings: Timings, name: string) =>
  Effect.gen(function* () {
    const platform = yield* Platform;
    const callsBefore = (yield* starting.made).length;
    const [makeTook, making] = yield* Effect.andThen(
      starting.resetFor(scenario.given, scenario.name),
      timings.timed(
        "starting world",
        { journey: scenario.name, of: scenario.given.name },
        starting.forScenario(scenario.given),
      ),
    ).pipe(Effect.exit, Effect.timed);
    const makingCalls = Arr.map(Arr.drop(yield* starting.made, callsBefore), (each) => each.call);
    const madeChecked = yield* Effect.orElseSucceed(checked(makingCalls), () => []);
    if (Exit.isFailure(making))
      return { makeMs: millis(makeTook), making, madeChecked, readiness: null, stage: name, used: undefined };
    const own = making.value.own;
    const world = own === null ? null : yield* World.open(own.world).pipe(Effect.orDie);
    const readiness =
      world === null
        ? null
        : yield* answersSteadily(world.coreUrl, {
            answers: settings.readyAnswers,
            every: settings.probeEvery,
            warmUp: settings.warmUp,
          });
    const stage: Stage = {
      name: world?.stage ?? name,
      url: world?.coreUrl ?? NOWHERE,
      platformUrl: platform.url,
      database: world?.database ?? Redacted.make(""),
      readiness: readiness ?? { probes: 0, relapses: 0, ms: 0 },
      warmUntil: (yield* Clock.currentTimeMillis) + Duration.toMillis(settings.warmUp),
    };
    const plan = journeyPlan(settings, { made: making.value.facts })(scenario);
    const inWorld = { ...settings, doorToken: world?.doorToken ?? Redacted.make("none") };
    const used = yield* Effect.exit(Effect.timeout(use(plan, inWorld)(stage), settings.worldUseTimeout));
    if (Exit.isSuccess(used))
      yield* timings.record("journey", used.value.ms.run, {
        journey: scenario.name,
        of: stage.name,
        steps: Arr.map(used.value.steps, (step) => ({
          step: step.step,
          operation: step.operation,
          outcome: step.outcome,
          ms: step.ms,
        })),
      });
    if (Exit.isSuccess(used))
      yield* timings.record("checks", used.value.ms.checks, { journey: scenario.name, of: stage.name });
    return { makeMs: millis(makeTook), making, madeChecked, readiness, stage: stage.name, used };
  });

/**
 * One journey in the run's one world; its run record, which is also on disk by then. Every world made while it ran,
 * but the one world, is destroyed afterwards, also when it failed, died or was interrupted.
 */
const runOne = (
  scenario: Journey,
  settings: Settings,
  starting: Starting,
  timings: Timings,
  run: string,
  index: number,
) =>
  Effect.uninterruptibleMask((restore) =>
    Effect.gen(function* () {
      const platform = yield* Platform;
      const core = yield* coreLabel;
      const startedAt = yield* now;
      const before = yield* platform.made;
      const triedBefore = (yield* platform.tried).length;
      const done = yield* Effect.exit(restore(work(scenario, settings, starting, timings, `${run}-${index + 1}`)));
      const templates = yield* starting.templateWorlds;
      const mine = Arr.filter(
        Arr.drop(yield* platform.made, before.length),
        (stage) => !Arr.contains(templates, stage),
      );
      // The one world lives on until the run ends; everything else the platform made or tried is this journey's.
      const looked = Arr.filter(
        Arr.dedupe([...mine, ...Arr.drop(yield* platform.tried, triedBefore)]),
        (stage) => !Arr.contains(templates, stage),
      );
      const leftBefore = yield* leftOf(looked);
      const strays = Arr.filter(looked, (stage) => !Arr.contains(mine, stage));
      const [destroyTook, destroyed] = yield* Effect.timed(
        Effect.zipWith(
          destroyAll(mine),
          destroyStrays(strays, [settings.owner, settings.secondOwner]),
          (a, b) => a && b,
        ),
      );
      yield* timings.record("destroy the journey's own worlds", millis(destroyTook), {
        journey: scenario.name,
        note: mine.length === 0 ? "none" : Arr.join(mine, ", "),
      });
      const leftAfter = yield* leftOf(looked);
      const got = Exit.isSuccess(done) ? done.value : undefined;
      const used = got?.used;
      const value = used !== undefined && Exit.isSuccess(used) ? used.value : undefined;
      const failures = [
        ...(Exit.isFailure(done) ? [`the run did not finish: ${describe(done.cause)}`] : []),
        ...(got !== undefined && Exit.isFailure(got.making)
          ? [`the starting world was not made: ${describe(got.making.cause)}`]
          : []),
        ...failuresOf(got?.madeChecked ?? []),
        ...(used !== undefined && Exit.isFailure(used) ? [`the run did not finish: ${describe(used.cause)}`] : []),
        ...(value !== undefined && Exit.isFailure(value.run) ? [`the run failed: ${describe(value.run.cause)}`] : []),
        ...(value === undefined ? [] : failuresOf(value.calls)),
        ...(destroyed ? [] : ["a world's destroy failed"]),
        ...(leftAfter === null || (leftAfter.worlds ?? []).length > 0
          ? ["the accounts still hold some of its worlds"]
          : []),
      ];
      const record: RunRecord = {
        kind: "journey",
        name: scenario.name,
        proves: null,
        given: scenario.given.name,
        stage: got?.stage ?? `${run}-${index + 1}`,
        owner: settings.owner,
        startedAt,
        outcome: failures.length === 0 ? passedOr(core) : "failed",
        ...(core === undefined ? {} : { core }),
        ...viaOf(settings.via),
        failure: failures.length === 0 ? null : Arr.join(failures, "\n"),
        ended: value === undefined ? null : endedOf(value.run),
        readiness: got?.readiness ?? null,
        calls: value?.calls ?? [],
        ...(value === undefined ? {} : { coverage: value.coverage }),
        ...stepsFor({ kind: "journey" }, value?.steps ?? stepsOf(scenario.outline, [], [])),
        making: got?.madeChecked ?? [],
        afterwards: { stage: destroyed ? "destroyed" : "destroy failed", before: leftBefore, after: leftAfter },
        ms: {
          create: got?.makeMs ?? null,
          run: value?.ms.run ?? null,
          checks: value?.ms.checks ?? null,
          destroy: millis(destroyTook),
        },
      };
      yield* Effect.orDie(writeJson(`${settings.records}/${run}/${slugOf(scenario.name)}.json`, RunRecord, record));
      yield* Effect.log(`${record.outcome}: ${scenario.name} (reset and made in ${record.ms.create} ms)`);
      if (Exit.isFailure(done) && Exit.hasInterrupts(done)) return yield* Effect.interrupt;
      return record;
    }),
  ).pipe(Effect.withSpan("runner.world.scenario", { attributes: { scenario: scenario.name } }));

/**
 * Destroys the run's one world, timed; what could not be done, one line each. Whatever ends the run, this runs. The
 * bench templates the run kept stay: they are the bench's, never dropped by a run, and the sweep removes them by age
 * (docs/roadmap.md, "Bench templates never change").
 */
const takeDown = (starting: Starting, timings: Timings) =>
  Effect.gen(function* () {
    const done = yield* takeDownWorlds(yield* starting.templateWorlds, timings);
    return done.failed;
  });

/**
 * Every journey in the run's one world, or, given a shared world, each in a world restored from its templates, one at
 * a time; and the run's summary at `<run>/summary.json`. The summary is written however the run ends but by
 * interruption: a starting world that was not made, a run that died, or a take-down that failed, is named in it with
 * why, and its outcome is `failed`.
 *
 * Several runners may run at once on one bench and one hub, each in its own world: nothing of one run's is named so
 * another's could take it. Only a site made from nothing waits, one at a time across the bench (the site door's
 * `BENCH_LOCK`), about two to three minutes each.
 * TODO: measure how many runs at once the staging bench (2 vCPU, 8 GiB) holds.
 * TODO: the snapshots a journey saves in the one world (`m3`, `draft`) stay for the rest of the run; a later journey
 * that saved the same name would be refused `SnapshotExists`. None does today.
 */
export const runInWorlds = (
  scenarios: ReadonlyArray<Journey>,
  settings: Settings,
  shared: Option.Option<string> = Option.none(),
) =>
  Effect.gen(function* () {
    const platform = yield* Platform;
    const startedAt = yield* now;
    const run = yield* freshName("run");
    const timings = yield* makeTimings;
    const notMade = yield* Ref.make<string | null>(null);
    const notTakenDown = yield* Ref.make<ReadonlyArray<string>>([]);
    const oneWorld = yield* Ref.make<string | null>(null);
    const hubUsed = yield* Ref.make<HubUse | null>(null);
    const ran = yield* Effect.exit(
      onHub(settings, timings, (used) =>
        Effect.gen(function* () {
          yield* Ref.set(hubUsed, used);
          const starting: Starting = Option.isSome(shared)
            ? yield* sharedStartingWorldsOf(settings, platform.url, timings, shared.value)
            : yield* startingWorldsOf(settings, platform.url, timings);
          // What the take-down could not do fails the run; a take-down that itself died is named as one.
          const takenDown = takeDown(starting, timings).pipe(
            Effect.flatMap((failed) => Ref.set(notTakenDown, failed)),
            Effect.catchCause((cause) => Ref.set(notTakenDown, [`the take-down did not finish: ${describe(cause)}`])),
          );
          return yield* Effect.gen(function* () {
            // A starting world that could not be made fails the journeys of it, each with why; the rest still run.
            // The summary names it too, a defect included (a door that answered an error page, say).
            yield* starting
              .prepare(Arr.map(scenarios, (scenario) => scenario.given))
              .pipe(Effect.catchCause(noteNotMade(timings, notMade)));
            yield* Ref.set(oneWorld, Option.getOrNull(yield* Effect.option(starting.oneWorld)));
            return yield* Effect.forEach(scenarios, (scenario, index) =>
              runOne(scenario, settings, starting, timings, run, index),
            );
          }).pipe(Effect.ensuring(takenDown));
        }),
      ),
    );
    const summary = yield* summaryOf({
      run,
      mode: Option.isSome(shared) ? "shared world" : "one world",
      startedAt,
      owner: settings.owner,
      records: settings.records,
      core: yield* coreLabel,
      ran,
      notMade: yield* Ref.get(notMade),
      notTakenDown: yield* Ref.get(notTakenDown),
      world: yield* Ref.get(oneWorld),
      used: yield* Ref.get(hubUsed),
      left: yield* leftOf(Arr.dedupe([...(yield* platform.made), ...(yield* platform.tried)])),
      timings: yield* timings.all,
    });
    if (Exit.isFailure(ran) && Exit.hasInterrupts(ran)) return yield* Effect.interrupt;
    return summary;
  });
