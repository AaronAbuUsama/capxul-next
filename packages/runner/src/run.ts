// Runs: for each one a fresh stage, the calls, the generic checks, a run record, and the stage's destruction. Nothing
// here knows any operation or any scenario by name.
import { operations, PLATFORM_PATH, servedBy, type OperationName } from "@capxul/blueprint";
import { Capxul, type ExpectationFailed, type Failure, type Scenario } from "@capxul/scenarios";
import * as Sdk from "@capxul/sdk";
import * as Arr from "effect/Array";
import * as DateTime from "effect/DateTime";
import * as Random from "effect/Random";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Rec from "effect/Record";
import type * as Redacted from "effect/Redacted";
import * as Ref from "effect/Ref";
import * as Result from "effect/Result";
import * as Str from "effect/String";
import type * as HttpClient from "effect/http/HttpClient";
import { checkCall, failuresOf, type CheckedCall } from "./checks/checks.ts";
import { capxulFor, type Call, type Target } from "./client.ts";
import { describe, endedOf, RunnerFailure } from "./failure.ts";
import { givenFor, type Handing } from "./given.ts";
import { writeRecord, type RunRecord } from "./record.ts";
import type { Settings } from "./settings.ts";
import { telemetryOf } from "./world/database.ts";
import { isEmpty } from "./world/leftovers.ts";
import { OtherWorlds } from "./world/existing.ts";
import { PlatformKept } from "./worlds/kept.ts";
import { runInStage, type Lifecycle, type Stage, type StageSpec } from "./world/stage.ts";

/** What a run is: its kind and name, the claim it proves, and the calls it makes through a stage's Core. */
export interface Plan {
  readonly kind: RunRecord["kind"];
  readonly name: string;
  readonly proves: RunRecord["proves"];
  readonly given: string | null;
  /** Makes the run's calls; every one goes through `log`. Fails when the run's own expectations do not hold. */
  readonly calls: (
    target: Target,
    log: Ref.Ref<ReadonlyArray<Call>>,
  ) => Effect.Effect<void, RunFailure, HttpClient.HttpClient>;
}

/** What a run's own calls may fail with: the runner's own failure, or a scenario's. */
export type RunFailure = RunnerFailure | ExpectationFailed | Failure;

/** What one run did in its stage: how its own calls ended, each call checked, and how long each part took. */
export interface Used {
  readonly run: Exit.Exit<void, RunFailure>;
  readonly calls: ReadonlyArray<CheckedCall>;
  readonly ms: { readonly run: number; readonly checks: number };
}

const millis = (took: Duration.Duration) => Math.round(Duration.toMillis(took));

/** The run, then the generic checks on every call it made, while the stage still exists. */
export const use = (plan: Plan, settings: Settings) => (stage: Stage) =>
  Effect.gen(function* () {
    const log = yield* Ref.make<ReadonlyArray<Call>>([]);
    const target: Target = {
      url: stage.url,
      platformUrl: stage.platformUrl ?? `${stage.url}${PLATFORM_PATH}`,
      doorToken: settings.doorToken,
      platformToken: settings.platformToken,
      secondPlatformToken: Option.getOrNull(settings.secondPlatformToken),
      warmUntil: stage.warmUntil,
      every: settings.probeEvery,
    };
    const [runTook, run] = yield* plan.calls(target, log).pipe(Effect.exit, Effect.timed);
    const calls = yield* Ref.get(log);
    const [checksTook, kept] = yield* Effect.timed(keptFor(Option.some(stage.database), calls));
    return {
      run,
      calls: Arr.map(calls, (call) => checkCall(call, kept)),
      ms: { run: millis(runTook), checks: millis(checksTook) },
    } satisfies Used;
  }).pipe(
    Effect.mapError((error) =>
      RunnerFailure.make({ step: "checks", message: `what Core kept could not be read: ${error.message}` }),
    ),
  );

/**
 * What Core kept for every call: the stage's own database for calls through its own door, and, for a call made `at`
 * another world's door, that world's database, when the shared state knows the world (world/existing.ts). A client
 * with no world of its own (a starting world's maker, whose every world call goes `at` a door) passes none.
 */
export const keptFor = (database: Option.Option<Redacted.Redacted>, calls: ReadonlyArray<Call>) =>
  Effect.gen(function* () {
    // Where the platform group is served by this process (worlds/platform.ts), its calls are kept by it.
    const platform = yield* Effect.serviceOption(PlatformKept);
    const byPlatform = (call: Call) => Option.isSome(platform) && servedBy(call.operation) === "platform";
    const ownCalls = Arr.map(
      Arr.filter(calls, (call) => call.at === null && !byPlatform(call)),
      (call) => call.traceId,
    );
    const own = Option.isSome(database) ? yield* telemetryOf(database.value, ownCalls) : { spans: [], events: [] };
    const served = Option.isNone(platform)
      ? { spans: [], events: [] }
      : yield* platform.value.kept(Arr.map(Arr.filter(calls, byPlatform), (call) => call.traceId));
    const doors = Arr.dedupe(
      Arr.filterMap(calls, (call) => (call.at === null ? Result.failVoid : Result.succeed(call.at))),
    );
    if (Arr.isReadonlyArrayEmpty(doors))
      return { spans: [...own.spans, ...served.spans], events: [...own.events, ...served.events] };
    const others = yield* OtherWorlds;
    const elsewhere = yield* Effect.forEach(doors, (door) =>
      Effect.flatMap(others.databaseAt(door), (found) =>
        Option.match(found, {
          onNone: () => Effect.succeed({ spans: [], events: [] }),
          onSome: (theirs) =>
            telemetryOf(
              theirs,
              Arr.map(
                Arr.filter(calls, (call) => call.at === door),
                (call) => call.traceId,
              ),
            ),
        }),
      ),
    );
    return {
      spans: Arr.flatten([own.spans, served.spans, ...Arr.map(elsewhere, (kept) => kept.spans)]),
      events: Arr.flatten([own.events, served.events, ...Arr.map(elsewhere, (kept) => kept.events)]),
    };
  });

/** Everything that went wrong, most fundamental first. Empty when the run passed. */
const failuresIn = (lifecycle: Lifecycle<Used, RunnerFailure>): ReadonlyArray<string> => {
  const left =
    lifecycle.afterwards === "destroying"
      ? []
      : lifecycle.afterwards === "destroy failed"
        ? ["the stage's destroy failed"]
        : lifecycle.found.after === null
          ? ["the accounts could not be read after the destroy"]
          : isEmpty(lifecycle.found.after)
            ? []
            : ["the accounts still hold some of the stage after its destroy"];
  if (lifecycle.createFailure !== null) return [`the stage was not created: ${lifecycle.createFailure}`, ...left];
  if (lifecycle.used === undefined) return ["the run was interrupted", ...left];
  if (Exit.isFailure(lifecycle.used)) return [`the run did not finish: ${describe(lifecycle.used.cause)}`, ...left];
  const used = lifecycle.used.value;
  return [
    ...(Exit.isFailure(used.run) ? [`the run failed: ${describe(used.run.cause)}`] : []),
    ...failuresOf(used.calls),
    ...left,
  ];
};

/** The run record of `plan` from what became of its stage. */
export const recordOf = (plan: Plan, startedAt: string, lifecycle: Lifecycle<Used, RunnerFailure>): RunRecord => {
  const used = lifecycle.used !== undefined && Exit.isSuccess(lifecycle.used) ? lifecycle.used.value : undefined;
  const failures = failuresIn(lifecycle);
  return {
    kind: plan.kind,
    name: plan.name,
    proves: plan.proves,
    given: plan.given,
    stage: lifecycle.name,
    owner: lifecycle.owner,
    startedAt,
    outcome: failures.length === 0 ? "passed" : "failed",
    failure: failures.length === 0 ? null : Arr.join(failures, "\n"),
    ended: used === undefined ? null : endedOf(used.run),
    readiness: lifecycle.readiness,
    calls: used?.calls ?? [],
    afterwards: { stage: lifecycle.afterwards, before: lifecycle.found.before, after: lifecycle.found.after },
    ms: {
      create: lifecycle.ms.create,
      run: used?.ms.run ?? null,
      checks: used?.ms.checks ?? null,
      destroy: lifecycle.ms.destroy,
    },
  };
};

/** A fresh name of `prefix-<6 hex>`: `core-` for a stage of `CapxulCore`. */
export const freshName = (prefix: string) =>
  Effect.map(Random.nextIntBetween(0, 0xffffff), (n) => `${prefix}-${Str.padStart(6, "0")(n.toString(16))}`);

/** The declared settings of a stage named `name`, its use limited to `useTimeout`. */
export const stageSpec = (name: string, settings: Settings, useTimeout: Duration.Duration): StageSpec => ({
  name,
  owner: settings.owner,
  timeouts: { create: settings.createTimeout, use: useTimeout, destroy: settings.destroyTimeout },
  warmUp: { answers: settings.readyAnswers, every: settings.probeEvery, warmUp: settings.warmUp },
  accounts: { cloudflareAccount: settings.cloudflareAccount, neonOrg: settings.neonOrg },
});

/** Runs one plan in its own fresh stage and returns its run record, which is also on disk by then. */
export const runPlan = (plan: Plan, settings: Settings) =>
  Effect.gen(function* () {
    const startedAt = DateTime.formatIso(yield* DateTime.now);
    const name = yield* freshName("core");
    const lifecycle = yield* runInStage(
      stageSpec(name, settings, settings.useTimeout),
      use(plan, settings),
      (progress) =>
        writeRecord(settings.records, recordOf(plan, startedAt, progress)).pipe(Effect.orDie, Effect.asVoid),
    );
    return recordOf(plan, startedAt, lifecycle);
  }).pipe(Effect.withSpan("runner.run", { attributes: { run: plan.name } }));

/**
 * The door: every blueprint operation called once, as the world's owner, with its first declared example. It passes
 * when every call is answered with a success or a refusal its operation declares, and every generic check passes.
 * Against Core's empty handlers every answer is `NotImplemented`.
 */
export const door: Plan = {
  kind: "door",
  name: "every operation answers through the door",
  proves: null,
  given: null,
  calls: (target, log) =>
    // oxlint-disable-next-line effecttsgo/strict-effect-provide -- the door run is its own program, handed its own stage's client
    Effect.provide(
      Effect.gen(function* () {
        const capxul = yield* Capxul;
        const names: ReadonlyArray<OperationName> = Rec.keys(operations);
        yield* Effect.forEach(names, (name) =>
          Effect.exit(
            Sdk.callByName(capxul, name, Option.getOrUndefined(Arr.head(operations[name].examples))?.payload),
          ),
        );
        const calls = yield* Ref.get(log);
        const unanswered = Arr.filter(calls, (call) => call.outcome === "defect" || call.outcome === "unanswered");
        return yield* unanswered.length === 0
          ? Effect.void
          : Effect.fail(
              RunnerFailure.make({
                step: "door",
                message: `not answered with a declared outcome: ${Arr.join(
                  Arr.map(unanswered, (call) => `${call.operation} (${call.outcome})`),
                  ", ",
                )}`,
              }),
            );
      }),
      capxulFor(target, log),
    ),
};

/**
 * A registered scenario as a run: its `Capxul` is the stage's Core, through the recording client, and its `Given` the
 * facts the runner has of its starting world (given.ts).
 */
export const scenarioPlan =
  (settings: Settings, handing: Handing) =>
  (scenario: Scenario): Plan => ({
    kind: "scenario",
    name: scenario.name,
    proves: scenario.proves,
    given: scenario.given.name,
    calls: (target, log) =>
      // oxlint-disable-next-line effecttsgo/strict-effect-provide -- each scenario is its own program, handed its own stage's client and facts
      Effect.provide(
        scenario.run,
        Layer.merge(
          capxulFor(target, log),
          givenFor(scenario.given, { first: settings.owner, second: settings.secondOwner }, handing),
        ),
      ),
  });
