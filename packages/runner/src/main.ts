// Entry: `bun src/main.ts door [--world=<name>]` or `bun src/main.ts scenarios [--one-stage] [--expect=pass|not-implemented]
// [name...]`, through ../run.sh, which sets the environment. The door runs in its own fresh stage; the scenarios run
// as scenario-runs.ts says, one at a time. `door --world=<name>` runs the door in a world `world create` made
// (packages/world), which it neither creates nor destroys. Exits 1 when the door failed, or when a scenario did not end as the run
// expected or a stage was left. This is the only file of the runner that touches the process: its arguments, its exit
// code and the Bun runtime.
import * as BunFileSystem from "@effect/platform-bun/BunFileSystem";
import * as BunPath from "@effect/platform-bun/BunPath";
import * as BunRuntime from "@effect/platform-bun/BunRuntime";
import * as BunServices from "@effect/platform-bun/BunServices";
import { SharedState } from "@capxul/world";
import { scenarios } from "@capxul/scenarios";
import * as Alchemist from "alchemy/Alchemist";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Str from "effect/String";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import { RunnerFailure } from "./failure.ts";
import { runInWorld } from "./in-world.ts";
import { chainJourney } from "./chain-journey.ts";
import { door, runPlan, scenarioPlan, type Plan } from "./run.ts";
import { OtherWorlds } from "./world/existing.ts";
import { platformFor } from "./worlds/platform.ts";
import { runInWorlds } from "./worlds/run.ts";
import { timeStartingWorlds } from "./worlds/timing.ts";
import { runScenarios } from "./scenario-runs.ts";
import { Settings } from "./settings.ts";
import { ranAsExpected, type Expectation, type Mode } from "./summary.ts";

const USAGE =
  "usage: door [--world=<name>] | chain --world=<name> | scenarios [--one-stage] [--expect=pass|not-implemented] [name...] | starting-worlds";
const [command, ...rest] = process.argv.slice(2);
const WORLD_FLAG = "--world=";
const world = Arr.findFirst(rest, Str.startsWith(WORLD_FLAG)).pipe(Option.map(Str.slice(WORLD_FLAG.length)));
const flags = Arr.filter(rest, (each) => Str.startsWith("--")(each) && !Str.startsWith(WORLD_FLAG)(each));
const names = Arr.filter(rest, (each) => !Str.startsWith("--")(each));

const usage = (message: string) => Effect.fail(RunnerFailure.make({ step: "arguments", message }));

/** The mode and the expectation the flags ask for. One stage is sound only where no scenario changes state. */
const options = (): Effect.Effect<{ readonly mode: Mode; readonly expect: Expectation }, RunnerFailure> => {
  const unknown = Arr.filter(
    flags,
    (flag) => !Arr.contains(["--one-stage", "--expect=pass", "--expect=not-implemented"], flag),
  );
  if (unknown.length > 0) return usage(`unknown ${Arr.join(unknown, " ")}; ${USAGE}`);
  const mode: Mode = Arr.contains(flags, "--one-stage") ? "one stage" : "a stage each";
  const expect: Expectation = Arr.contains(flags, "--expect=not-implemented") ? "not-implemented" : "pass";
  if (mode === "one stage" && expect !== "not-implemented")
    return usage(
      "--one-stage shares one stage between scenarios, which is sound only when none changes its state: against Core's empty handlers, with --expect=not-implemented",
    );
  return Effect.succeed({ mode, expect });
};

/**
 * The plans the command asks for. A scenarios run that expects Core's empty handlers hands each scenario its
 * starting world's example facts; one that expects to pass hands only facts the runner made (given.ts).
 */
const plans = (settings: Settings): Effect.Effect<ReadonlyArray<Plan>, RunnerFailure> => {
  if (command === "door") return flags.length === 0 && names.length === 0 ? Effect.succeed([door]) : usage(USAGE);
  if (command === "starting-worlds")
    return flags.length === 0 && names.length === 0 ? Effect.succeed([]) : usage(USAGE);
  if (command === "chain")
    return flags.length === 0 && names.length === 0 ? Effect.succeed([chainJourney]) : usage(USAGE);
  if (command !== "scenarios") return usage(USAGE);
  const chosen = names.length === 0 ? scenarios : Arr.filter(scenarios, (each) => Arr.contains(names, each.name));
  if (chosen.length < names.length)
    return Effect.fail(
      RunnerFailure.make({ step: "arguments", message: `no scenario is named one of: ${Arr.join(names, "; ")}` }),
    );
  return Effect.map(options(), ({ expect }) =>
    Arr.map(chosen, scenarioPlan(settings, expect === "not-implemented" ? "examples" : "made only")),
  );
};

const theDoor = (settings: Settings, plan: Plan = door) =>
  Effect.gen(function* () {
    const record = Option.isSome(world)
      ? yield* runInWorld(plan, settings, world.value)
      : yield* runPlan(plan, settings);
    yield* Effect.log(
      `${record.outcome}: ${record.name} (stage ${record.stage} ${record.afterwards.stage}; create ${record.ms.create} ms, run ${record.ms.run} ms, checks ${record.ms.checks} ms, destroy ${record.ms.destroy} ms) -> ${settings.records}/${record.stage}/`,
    );
    if (record.outcome === "failed") process.exitCode = 1;
  });

/** The scenarios to run, by the names given; all of them when none is. */
const chosenScenarios =
  names.length === 0 ? scenarios : Arr.filter(scenarios, (each) => Arr.contains(names, each.name));

/**
 * A run in private worlds needs the platform, served by this process (worlds/platform.ts), and the shared state of
 * packages/world, through which it finds every world, and the databases of the worlds a call is made `at`.
 */
const inWorlds = <A, E, R>(settings: Settings, run: Effect.Effect<A, E, R>) =>
  run.pipe(
    Effect.provide(
      Layer.mergeAll(platformFor(settings), OtherWorlds.fromSharedState).pipe(
        Layer.provideMerge(SharedState.layer),
        Layer.provideMerge(BunServices.layer),
      ),
    ),
  );

const theScenarios = (settings: Settings, chosen: ReadonlyArray<Plan>) =>
  Effect.gen(function* () {
    const { mode, expect } = yield* options();
    const inPrivateWorlds = expect === "pass";
    const shown = inPrivateWorlds ? "a world each" : mode;
    yield* Effect.log(`${chosen.length} scenario${chosen.length === 1 ? "" : "s"}, ${shown}, expecting ${expect}`);
    const summary = inPrivateWorlds
      ? yield* inWorlds(settings, runInWorlds(chosenScenarios, settings))
      : yield* runScenarios(chosen, settings, mode, expect);
    for (const line of summary.scenarios)
      yield* Effect.log(
        `${line.asExpected ? "as expected" : "NOT as expected"}: ${line.name}${line.why === null ? "" : ` (${line.why})`}`,
      );
    for (const stage of summary.stages)
      yield* Effect.log(
        `stage ${stage.name}: create ${stage.createMs} ms, destroy ${stage.destroyMs} ms, ${stage.afterwards}`,
      );
    yield* Effect.log(
      `${summary.outcome}: ${summary.count.asExpected} of ${summary.count.scenarios} as expected (${summary.count.claims} of ${summary.count.declaredClaims} claims) -> ${settings.records}/${summary.run}/summary.json${summary.failure === null ? "" : `\n${summary.failure}`}`,
    );
    if (!ranAsExpected(summary)) process.exitCode = 1;
  });

const theStartingWorlds = (settings: Settings) =>
  Effect.gen(function* () {
    const record = yield* inWorlds(settings, timeStartingWorlds(settings));
    for (const line of record.worlds)
      yield* Effect.log(
        `${line.name} (${line.made}): ${line.outcome} in ${line.ms} ms${line.why === null ? "" : `: ${line.why}`}`,
      );
    yield* Effect.log(`${record.outcome}: -> ${settings.records}/${record.run}/starting-worlds.json`);
    if (record.outcome === "failed") process.exitCode = 1;
  });

const program = Effect.gen(function* () {
  const settings = yield* Settings;
  const chosen = yield* plans(settings);
  if (Option.isSome(world) && (command === "scenarios" || command === "starting-worlds"))
    return yield* usage(`--world is for the door and the chain journey only; ${USAGE}`);
  if (command === "chain" && Option.isNone(world))
    return yield* usage(`chain needs --world=<name>: a stage has no chain; ${USAGE}`);
  if (command === "starting-worlds") return yield* theStartingWorlds(settings);
  return yield* command === "scenarios"
    ? theScenarios(settings, chosen)
    : theDoor(settings, command === "chain" ? chainJourney : door);
});

// Bun's fetch gives up on any answer after five minutes; a world.create can take longer when Cloudflare is slow, and every
// call already runs under a declared timeout of the runner's, so fetch itself waits as long as it is asked to.
const bunInit: globalThis.RequestInit & { readonly timeout: boolean } = { timeout: false };
const noFetchTimeout = Layer.succeed(FetchHttpClient.RequestInit, bunInit);

program.pipe(
  Effect.provide(
    Layer.mergeAll(
      OtherWorlds.none,
      Alchemist.layer(),
      BunFileSystem.layer,
      BunPath.layer,
      FetchHttpClient.layer,
      // Read by every fetch from the calling fiber's context, so it is provided to the whole program.
      noFetchTimeout,
    ),
  ),
  BunRuntime.runMain,
);
