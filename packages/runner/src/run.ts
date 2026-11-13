// Runs: for each one a fresh stage, the calls, the generic checks, a run record, and the stage's destruction. Nothing
// here knows any operation or any scenario by name.
import { operations, type OperationName } from "@capxul/blueprint";
import { Capxul, type ExpectationFailed, type Failure, type Scenario } from "@capxul/scenarios";
import * as Sdk from "@capxul/sdk";
import * as Arr from "effect/Array";
import * as DateTime from "effect/DateTime";
import * as Random from "effect/Random";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Rec from "effect/Record";
import * as Ref from "effect/Ref";
import * as Str from "effect/String";
import type * as HttpClient from "effect/http/HttpClient";
import { checkCall, failuresOf, type CheckedCall } from "./checks/checks.ts";
import { capxulFor, type Call, type Target } from "./client.ts";
import { describe, RunnerFailure } from "./failure.ts";
import { writeRecord, type RunRecord } from "./record.ts";
import type { Settings } from "./settings.ts";
import { telemetryOf } from "./world/database.ts";
import { isEmpty } from "./world/leftovers.ts";
import { runInStage, type Lifecycle, type Stage } from "./world/stage.ts";

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

interface Used {
  readonly run: Exit.Exit<void, RunFailure>;
  readonly calls: ReadonlyArray<CheckedCall>;
  readonly ms: { readonly run: number; readonly checks: number };
}

const millis = (took: Duration.Duration) => Math.round(Duration.toMillis(took));

/** The run, then the generic checks on every call it made, while the stage still exists. */
const use = (plan: Plan, settings: Settings) => (stage: Stage) =>
  Effect.gen(function* () {
    const log = yield* Ref.make<ReadonlyArray<Call>>([]);
    const target: Target = {
      url: stage.url,
      doorToken: settings.doorToken,
      platformToken: settings.platformToken,
      warmUntil: stage.warmUntil,
      every: settings.probeEvery,
    };
    const [runTook, run] = yield* plan.calls(target, log).pipe(Effect.exit, Effect.timed);
    const calls = yield* Ref.get(log);
    const [checksTook, kept] = yield* Effect.timed(
      telemetryOf(
        stage.database,
        Arr.map(calls, (call) => call.traceId),
      ),
    );
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

const recordOf = (plan: Plan, startedAt: string, lifecycle: Lifecycle<Used, RunnerFailure>): RunRecord => {
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

/** Runs one plan in its own fresh stage and returns its run record, which is also on disk by then. */
export const runPlan = (plan: Plan, settings: Settings) =>
  Effect.gen(function* () {
    const startedAt = DateTime.formatIso(yield* DateTime.now);
    const name = `core-${Str.padStart(6, "0")((yield* Random.nextIntBetween(0, 0xffffff)).toString(16))}`;
    const lifecycle = yield* runInStage(
      {
        name,
        owner: settings.owner,
        timeouts: { create: settings.createTimeout, use: settings.useTimeout, destroy: settings.destroyTimeout },
        warmUp: { answers: settings.readyAnswers, every: settings.probeEvery, warmUp: settings.warmUp },
        accounts: { cloudflareAccount: settings.cloudflareAccount, neonOrg: settings.neonOrg },
      },
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

/** A registered scenario as a run: its `Capxul` is the stage's Core, through the recording client. */
export const scenarioPlan = (scenario: Scenario): Plan => ({
  kind: "scenario",
  name: scenario.name,
  proves: scenario.proves,
  given: scenario.given.name,
  // oxlint-disable-next-line effecttsgo/strict-effect-provide -- each scenario is its own program, handed its own stage's client
  calls: (target, log) => Effect.provide(scenario.run, capxulFor(target, log)),
});
