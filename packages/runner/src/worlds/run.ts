// A scenarios run in private worlds (`./run.sh scenarios`, expecting `pass`): the platform served by this process
// (platform.ts), every scenario's starting world made for it (starting.ts), the scenario run through the door with the
// generic checks on every call, and every world it made destroyed afterwards, whatever happened, with the accounts read
// before and after for anything of those worlds. The template worlds are destroyed when the run ends.
import type { Scenario } from "@capxul/scenarios";
import * as World from "@capxul/world";
import * as Arr from "effect/Array";
import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Redacted from "effect/Redacted";
import { checkCall, failuresOf } from "../checks/checks.ts";
import type { Call } from "../client.ts";
import { describe, endedOf } from "../failure.ts";
import { slugOf, writeJson, RunRecord } from "../record.ts";
import { freshName, scenarioPlan, use } from "../run.ts";
import type { Settings } from "../settings.ts";
import { summarize, Summary } from "../summary.ts";
import type { Inventory } from "../world/leftovers.ts";
import { answersSteadily } from "../world/warmup.ts";
import type { Stage } from "../world/stage.ts";
import { PlatformKept } from "./kept.ts";
import { Platform } from "./platform.ts";
import { startingWorldsOf, type StartingWorlds } from "./starting.ts";

const now = Effect.map(DateTime.now, DateTime.formatIso);
const millis = (took: Duration.Duration) => Math.round(Duration.toMillis(took));
const NOWHERE = "http://127.0.0.1:9";

/** What the accounts hold of `stages`, by name, or null when they could not be read. */
export const leftOf = (stages: ReadonlyArray<string>) =>
  World.inventory.pipe(
    Effect.map((listing): Inventory | null => ({
      workers: [],
      hyperdrives: [],
      neonProjects: [],
      worlds: World.namesOfWorlds(World.ofThisStackOnly(listing), stages),
    })),
    Effect.catchCause((cause) => Effect.as(Effect.logWarning(`inventory not read: ${describe(cause)}`), null)),
  );

/** Destroys `stages`, the newest first, so a world restored from a snapshot goes before the world it came from. */
export const destroyAll = (stages: ReadonlyArray<string>) =>
  Effect.forEach(Arr.reverse(stages), (stage) =>
    World.destroy(stage).pipe(
      Effect.exit,
      Effect.tap((gone) =>
        Exit.isFailure(gone) ? Effect.logError(`world ${stage}: destroy failed: ${describe(gone.cause)}`) : Effect.void,
      ),
      Effect.map(Exit.isSuccess),
    ),
  ).pipe(Effect.map(Arr.every((gone) => gone)));

/**
 * Destroys what is left of the worlds the platform tried to make but never handed over: a create that failed after
 * its claim takes its world down itself, and when that take-down fails too the world is left. Only a world one of the
 * run's operators owns is touched; one already gone is no failure.
 */
export const destroyStrays = (stages: ReadonlyArray<string>, owners: ReadonlyArray<string>) =>
  Effect.forEach(stages, (stage) =>
    World.open(stage).pipe(
      Effect.flatMap((world) => (Arr.contains(owners, world.owner) ? destroyAll([stage]) : Effect.succeed(true))),
      Effect.orElseSucceed(() => true),
    ),
  ).pipe(Effect.map(Arr.every((gone) => gone)));

/** The checked calls of `calls`, read from where each was kept. */
const checked = (calls: ReadonlyArray<Call>) =>
  Effect.gen(function* () {
    const platform = yield* PlatformKept;
    const kept = yield* platform.kept(Arr.map(calls, (call) => call.traceId));
    return Arr.map(calls, (call) => checkCall(call, kept));
  });

/** The scenario's starting world made for it, its world opened and waited for, and the scenario run there. */
const work = (scenario: Scenario, settings: Settings, starting: StartingWorlds, name: string) =>
  Effect.gen(function* () {
    const platform = yield* Platform;
    const callsBefore = (yield* starting.made).length;
    const [makeTook, making] = yield* starting.forScenario(scenario.given).pipe(Effect.exit, Effect.timed);
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
    const plan = scenarioPlan(settings, { made: making.value.facts })(scenario);
    const inWorld = { ...settings, doorToken: world?.doorToken ?? Redacted.make("none") };
    const used = yield* Effect.exit(Effect.timeout(use(plan, inWorld)(stage), settings.worldUseTimeout));
    return { makeMs: millis(makeTook), making, madeChecked, readiness, stage: stage.name, used };
  });

/**
 * One scenario in worlds made for it; its run record, which is also on disk by then. Every world made while it ran,
 * but the template worlds, is destroyed afterwards, also when it failed, died or was interrupted.
 */
const runOne = (scenario: Scenario, settings: Settings, starting: StartingWorlds, run: string, index: number) =>
  Effect.uninterruptibleMask((restore) =>
    Effect.gen(function* () {
      const platform = yield* Platform;
      const startedAt = yield* now;
      const before = yield* platform.made;
      const triedBefore = (yield* platform.tried).length;
      const done = yield* Effect.exit(restore(work(scenario, settings, starting, `${run}-${index + 1}`)));
      const templates = yield* starting.templateWorlds;
      const mine = Arr.filter(
        Arr.drop(yield* platform.made, before.length),
        (stage) => !Arr.contains(templates, stage),
      );
      // The template worlds live on until the run ends; everything else the platform made or tried is this scenario's.
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
        kind: "scenario",
        name: scenario.name,
        proves: scenario.proves,
        given: scenario.given.name,
        stage: got?.stage ?? `${run}-${index + 1}`,
        owner: settings.owner,
        startedAt,
        outcome: failures.length === 0 ? "passed" : "failed",
        failure: failures.length === 0 ? null : Arr.join(failures, "\n"),
        ended: value === undefined ? null : endedOf(value.run),
        readiness: got?.readiness ?? null,
        calls: value?.calls ?? [],
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
      yield* Effect.log(`${record.outcome}: ${scenario.name} (${mine.length} worlds, made in ${record.ms.create} ms)`);
      if (Exit.isFailure(done) && Exit.hasInterrupts(done)) return yield* Effect.interrupt;
      return record;
    }),
  ).pipe(Effect.withSpan("runner.world.scenario", { attributes: { scenario: scenario.name } }));

/** Every scenario in worlds of its own, one at a time, and the run's summary at `<run>/summary.json`. */
export const runInWorlds = (scenarios: ReadonlyArray<Scenario>, settings: Settings) =>
  Effect.gen(function* () {
    const platform = yield* Platform;
    const startedAt = yield* now;
    const run = yield* freshName("run");
    const starting = yield* startingWorldsOf(settings, platform.url);
    const records = yield* Effect.forEach(scenarios, (scenario, index) =>
      runOne(scenario, settings, starting, run, index),
    ).pipe(
      // The template worlds go when the run ends, however it ends; each scenario's own worlds went after it.
      Effect.ensuring(Effect.flatMap(starting.templateWorlds, destroyAll)),
    );
    const summary = summarize({
      run,
      mode: "a world each",
      expect: "pass",
      owner: settings.owner,
      startedAt,
      records,
      pathOf: (record) => `${run}/${slugOf(record.name)}.json`,
    });
    yield* Effect.orDie(writeJson(`${settings.records}/${run}/summary.json`, Summary, summary));
    return summary;
  });
