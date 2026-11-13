// Runs scenarios: for each one a fresh world, the scenario, the generic checks, a run record, and the world's
// destruction. Nothing here knows any operation or any scenario by name.
import * as Config from "effect/Config";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Ref from "effect/Ref";
import { checkCall, failuresOf, type CheckedCall } from "./checks.ts";
import { coreOf, TraceIdsLive, type Call } from "./client.ts";
import { telemetryOf } from "./database.ts";
import { describe } from "./failure.ts";
import { slugOf, writeRecord, type RunRecord } from "./record.ts";
import { TraceIds, type Scenario } from "./scenario.ts";
import { runInWorld, type Lifecycle, type World } from "./world.ts";

/** The runner's declared settings. Each has a default and can be set in the environment. */
export const Settings = Config.all({
  /** Who the worlds of this run belong to; part of each world's database branch name. */
  owner: Config.String("WORLD_OWNER").pipe(Config.withDefault("pipeline")),
  /** How long a world may exist before Neon deletes its branch by itself. */
  lifetime: Config.Duration("WORLD_LIFETIME").pipe(Config.withDefault(Duration.minutes(30))),
  createTimeout: Config.Duration("WORLD_CREATE_TIMEOUT").pipe(Config.withDefault(Duration.minutes(3))),
  /** The scenario and the generic checks together. */
  useTimeout: Config.Duration("WORLD_USE_TIMEOUT").pipe(Config.withDefault(Duration.minutes(2))),
  destroyTimeout: Config.Duration("WORLD_DESTROY_TIMEOUT").pipe(Config.withDefault(Duration.minutes(3))),
  /** A world is ready after this many answers in a row from its Core, within the create timeout (warmup.ts). */
  readyAnswers: Config.Int("WORLD_READY_ANSWERS").pipe(Config.withDefault(20)),
  /** The pause between two readiness probes, and between two sends of a call during the warm-up. */
  probeEvery: Config.Duration("WORLD_PROBE_EVERY").pipe(Config.withDefault(Duration.millis(500))),
  /** How long after a world is ready a call that Cloudflare's edge answered (not routed yet) is sent again. */
  warmUp: Config.Duration("WORLD_WARM_UP").pipe(Config.withDefault(Duration.seconds(30))),
  /** Where run records are written, outside any world. */
  records: Config.String("PIPELINE_RECORDS").pipe(Config.withDefault("records")),
  /** The `.sql` files applied to a world's database when it is created. */
  migrations: Config.String("PIPELINE_MIGRATIONS").pipe(Config.withDefault("core/migrations")),
});
export type Settings = Config.Success<typeof Settings>;

interface Used {
  readonly scenario: Exit.Exit<void, unknown>;
  readonly calls: ReadonlyArray<CheckedCall>;
  readonly ms: { readonly scenario: number; readonly checks: number };
}

const millis = (took: Duration.Duration) => Math.round(Duration.toMillis(took));

/** The scenario, then the generic checks on every call it made, while the world still exists. */
const use = (scenario: Scenario, settings: Settings) => (world: World) =>
  Effect.gen(function* () {
    const log = yield* Ref.make<ReadonlyArray<Call>>([]);
    const core = coreOf({ url: world.url, warmUntil: world.warmUntil, every: settings.probeEvery }, log);
    const [scenarioTook, exit] = yield* Effect.timed(Effect.exit(Effect.provide(scenario.run, core)));
    const calls = yield* Ref.get(log);
    const [checksTook, kept] = yield* Effect.timed(telemetryOf(world.database, calls.map((call) => call.traceId)));
    return {
      scenario: exit,
      calls: calls.map((call) => checkCall(call, kept)),
      ms: { scenario: millis(scenarioTook), checks: millis(checksTook) },
    } satisfies Used;
  });

/** Everything that went wrong, most fundamental first. Empty when the run passed. */
const failuresIn = (lifecycle: Lifecycle<Used, unknown>): ReadonlyArray<string> => {
  if (lifecycle.createFailure !== null) return [`the world was not created: ${lifecycle.createFailure}`];
  if (lifecycle.used === undefined) return ["the run was interrupted"];
  if (Exit.isFailure(lifecycle.used)) return [`the run did not finish: ${describe(lifecycle.used.cause)}`];
  const used = lifecycle.used.value;
  return [...(Exit.isFailure(used.scenario) ? [`the scenario failed: ${describe(used.scenario.cause)}`] : []), ...failuresOf(used.calls)];
};

const recordOf = (scenario: Scenario, lifecycle: Lifecycle<Used, unknown>): RunRecord => {
  const used = lifecycle.used !== undefined && Exit.isSuccess(lifecycle.used) ? lifecycle.used.value : undefined;
  const failures = failuresIn(lifecycle);
  return {
    scenario: scenario.name,
    world: lifecycle.name,
    owner: lifecycle.owner,
    expiresAt: lifecycle.expiresAt,
    outcome: failures.length === 0 ? "passed" : "failed",
    failure: failures.length === 0 ? null : failures.join("\n"),
    readiness: lifecycle.readiness,
    calls: used?.calls ?? [],
    worldAfterwards: lifecycle.worldAfterwards,
    ms: { create: lifecycle.ms.create, scenario: used?.ms.scenario ?? null, checks: used?.ms.checks ?? null, destroy: lifecycle.ms.destroy },
  };
};

/** Runs one scenario in its own fresh world and returns its run record, which is also on disk by then. */
export const runScenario = (scenario: Scenario, settings: Settings) =>
  Effect.gen(function* () {
    // The world's name is its stage: short, because it becomes part of the Worker's name, and unique per run.
    const unique = (yield* Effect.provide(Effect.flatMap(TraceIds, (traces) => traces.next), TraceIdsLive)).slice(0, 6);
    const lifecycle = yield* runInWorld(
      {
        name: `pl-${slugOf(scenario.name).slice(0, 10).replace(/-+$/, "")}-${unique}`,
        owner: settings.owner,
        lifetime: settings.lifetime,
        timeouts: { create: settings.createTimeout, use: settings.useTimeout, destroy: settings.destroyTimeout },
        migrations: settings.migrations,
        warmUp: { answers: settings.readyAnswers, every: settings.probeEvery, warmUp: settings.warmUp },
      },
      use(scenario, settings),
      (lifecycle) => Effect.orDie(writeRecord(settings.records, recordOf(scenario, lifecycle))),
    );
    return recordOf(scenario, lifecycle);
  }).pipe(Effect.withSpan("scenario.run", { attributes: { scenario: scenario.name } }));

/** Runs every scenario, one world at a time, and returns the records in order. */
export const runAll = (scenarios: ReadonlyArray<Scenario>, settings: Settings) =>
  Effect.forEach(scenarios, (scenario) => runScenario(scenario, settings), { concurrency: 1 });
