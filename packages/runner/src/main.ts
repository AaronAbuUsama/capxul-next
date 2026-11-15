// Entry: `bun src/main.ts door [--world=<name>]` or `bun src/main.ts scenarios [--one-stage] [--expect=pass|not-implemented]
// [--via=sdk|cli] [name...]`, through ../run.sh, which sets the environment. The door runs in its own fresh stage; the journeys (the
// scenarios, since 14 November 2026) run as scenario-runs.ts says, one at a time. `door --world=<name>` runs the door in a world `world create` made
// (packages/world), which it neither creates nor destroys. Exits 1 when the door failed, or when a journey did not end as the run
// expected or a stage was left. This is the only file of the runner that touches the process: its arguments, its exit
// code and the Bun runtime.
import * as BunFileSystem from "@effect/platform-bun/BunFileSystem";
import * as BunPath from "@effect/platform-bun/BunPath";
import * as BunRuntime from "@effect/platform-bun/BunRuntime";
import * as BunServices from "@effect/platform-bun/BunServices";
import * as World from "@capxul/world";
import { SharedState } from "@capxul/world";
import { journeys } from "@capxul/scenarios";
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
import { door, journeyPlan, runPlan, type Plan } from "./run.ts";
import { OtherWorlds } from "./world/existing.ts";
import { localCoreHost } from "./local/host.ts";
import { platformFor } from "./worlds/platform.ts";
import { runInWorlds } from "./worlds/run.ts";
import { makeOrRenew } from "./shared/make.ts";
import { timeStartingWorlds } from "./worlds/timing.ts";
import { runScenarios } from "./scenario-runs.ts";
import { Settings } from "./settings.ts";
import { ranAsExpected, type Expectation, type Mode } from "./summary.ts";

const USAGE =
  "usage: door [--world=<name>] | chain --world=<name> | scenarios [--one-stage] [--expect=pass|not-implemented] [--core=local] [--shared] [--via=sdk|cli] [name...] | starting-worlds [--core=local] | shared";
const [command, ...rest] = process.argv.slice(2);
const WORLD_FLAG = "--world=";
const world = Arr.findFirst(rest, Str.startsWith(WORLD_FLAG)).pipe(Option.map(Str.slice(WORLD_FLAG.length)));
const LOCAL_CORE = "--core=local";
/** `--core=local`: every world's Core runs here in workerd, next to a stand-in bench (src/local/host.ts). */
const localCore = Arr.contains(rest, LOCAL_CORE);
const SHARED = "--shared";
/** `--shared`: the journeys run on the shared world WORLD_SHARED names, each from its templates (src/shared/). */
const onShared = Arr.contains(rest, SHARED);
const VIA_FLAG = "--via=";
/** `--via=cli`: the journeys' calls go through the command line, each the `capxul` command that makes it (client.ts). */
const via = Arr.findFirst(rest, Str.startsWith(VIA_FLAG)).pipe(Option.map(Str.slice(VIA_FLAG.length)));
const flags = Arr.filter(
  rest,
  (each) =>
    Str.startsWith("--")(each) &&
    !Str.startsWith(WORLD_FLAG)(each) &&
    !Str.startsWith(VIA_FLAG)(each) &&
    each !== LOCAL_CORE &&
    each !== SHARED,
);
const names = Arr.filter(rest, (each) => !Str.startsWith("--")(each));
/** The journeys to run, by the names given; all of them when none is. */
const chosenJourneys = names.length === 0 ? journeys : Arr.filter(journeys, (each) => Arr.contains(names, each.name));

const usage = (message: string) => Effect.fail(RunnerFailure.make({ step: "arguments", message }));

/** The mode and the expectation the flags ask for. One stage is sound only where no journey changes state. */
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
      "--one-stage shares one stage between journeys, which is sound only when none changes its state: against Core's empty handlers, with --expect=not-implemented",
    );
  return Effect.succeed({ mode, expect });
};

/**
 * The plans the command asks for. A run that expects Core's empty handlers hands each journey its
 * starting world's example facts; one that expects to pass hands only facts the runner made (given.ts).
 */
const plans = (settings: Settings): Effect.Effect<ReadonlyArray<Plan>, RunnerFailure> => {
  if (command === "door") return flags.length === 0 && names.length === 0 ? Effect.succeed([door]) : usage(USAGE);
  if (localCore && (onShared || command === "shared"))
    return usage(`a shared world's Core runs on Cloudflare: ${LOCAL_CORE} cannot be used with it; ${USAGE}`);
  if (localCore && command !== "scenarios" && command !== "starting-worlds")
    return usage(`${LOCAL_CORE} is for runs in private worlds: scenarios and starting-worlds; ${USAGE}`);
  if (onShared && command !== "scenarios") return usage(`${SHARED} is for scenarios; ${USAGE}`);
  if (command === "starting-worlds" || command === "shared")
    return flags.length === 0 && names.length === 0 ? Effect.succeed([]) : usage(USAGE);
  if (command === "chain")
    return flags.length === 0 && names.length === 0 ? Effect.succeed([chainJourney]) : usage(USAGE);
  if (command !== "scenarios") return usage(USAGE);
  if (chosenJourneys.length < names.length)
    return Effect.fail(
      RunnerFailure.make({ step: "arguments", message: `no journey is named one of: ${Arr.join(names, "; ")}` }),
    );
  return Effect.map(options(), ({ expect }) =>
    Arr.map(chosenJourneys, journeyPlan(settings, expect === "not-implemented" ? "examples" : "made only")),
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

/**
 * A run in private worlds needs the platform, served by this process (worlds/platform.ts), and the shared state of
 * packages/world, through which it finds every world, and the databases of the worlds a call is made `at`.
 */
const inWorlds = <A, E, R>(settings: Settings, run: Effect.Effect<A, E, R>) =>
  run.pipe(
    Effect.provide(
      Layer.mergeAll(platformFor(settings), OtherWorlds.fromSharedState).pipe(
        Layer.provideMerge(localCore ? localCoreHost : Layer.empty),
        Layer.provideMerge(SharedState.layer),
        Layer.provideMerge(BunServices.layer),
      ),
    ),
  );

/**
 * The settings of a run on the shared world: its first operator is the world's owner, signed in with the world's own
 * operator token, read from the shared state (packages/world, `renew`), so the run may read the world as its owner.
 */
const onSharedWorld = (settings: Settings) =>
  Effect.gen(function* () {
    const shared = yield* World.open(settings.shared).pipe(
      Effect.mapError((error) =>
        RunnerFailure.make({
          step: "arguments",
          message: `no shared world ${settings.shared}: ${error._tag}; make it with ./run.sh shared`,
        }),
      ),
    );
    if (shared.owner !== settings.owner)
      return yield* usage(`${settings.shared} belongs to ${shared.owner}: run with WORLD_OWNER=${shared.owner}`);
    return { ...settings, platformToken: shared.operatorToken };
  }).pipe(Effect.provide(Layer.provideMerge(SharedState.layer, BunServices.layer)));

const theScenarios = (given: Settings, chosen: ReadonlyArray<Plan>) =>
  Effect.gen(function* () {
    const { mode, expect } = yield* options();
    const inPrivateWorlds = expect === "pass";
    yield* onShared && !inPrivateWorlds ? usage(`${SHARED} runs journeys that expect to pass; ${USAGE}`) : Effect.void;
    const settings = onShared ? yield* onSharedWorld(given) : given;
    const shown = onShared
      ? `on the shared world ${settings.shared}, each from its templates`
      : inPrivateWorlds
        ? "one world, reset before each journey"
        : mode;
    const through = settings.via === "cli" ? "through the command line" : "through the SDK";
    yield* Effect.log(
      `${chosen.length} journey${chosen.length === 1 ? "" : "s"}, ${shown}, ${through}, expecting ${expect}`,
    );
    const summary = inPrivateWorlds
      ? yield* inWorlds(
          settings,
          runInWorlds(chosenJourneys, settings, onShared ? Option.some(settings.shared) : Option.none()),
        )
      : yield* runScenarios(chosen, settings, mode, expect);
    for (const line of summary.journeys)
      yield* Effect.log(
        `${line.asExpected ? "as expected" : "NOT as expected"}: ${line.name}${line.failedStep === null ? "" : ` (failed at step ${line.failedStep.step}, ${line.failedStep.operation})`}${line.why === null ? "" : ` (${line.why})`}`,
      );
    for (const stage of summary.stages)
      yield* Effect.log(
        `stage ${stage.name}: create ${stage.createMs} ms, destroy ${stage.destroyMs} ms, ${stage.afterwards}`,
      );
    yield* Effect.log(
      `${summary.outcome}: ${summary.count.asExpected} of ${summary.count.journeys} journeys as expected (${summary.count.registered} registered, covering ${summary.count.claims} claims) -> ${settings.records}/${summary.run}/summary.json${summary.failure === null ? "" : `\n${summary.failure}`}`,
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

/** The settings, with `--via`'s over `RUNNER_VIA`'s; `--via` is for the journeys only. */
const withVia = (settings: Settings): Effect.Effect<Settings, RunnerFailure> => {
  if (Option.isNone(via)) return Effect.succeed(settings);
  if (command !== "scenarios") return usage(`--via is for the journeys: scenarios; ${USAGE}`);
  if (via.value === "sdk" || via.value === "cli") return Effect.succeed({ ...settings, via: via.value });
  return usage(`--via is sdk or cli, not ${via.value}; ${USAGE}`);
};

/** `./run.sh shared`: a shared world already there is reached as its owner with its own operator token. */
const theSharedWorld = (given: Settings) =>
  Effect.gen(function* () {
    const there = yield* Effect.option(World.open(given.shared)).pipe(
      Effect.provide(Layer.provideMerge(SharedState.layer, BunServices.layer)),
    );
    const settings =
      Option.isSome(there) && there.value.owner === given.owner
        ? { ...given, platformToken: there.value.operatorToken }
        : given;
    const record = yield* inWorlds(settings, makeOrRenew(settings, journeys));
    yield* Effect.log(
      `${record.outcome}: ${record.world} ${record.how}, owned by ${record.owner}, until ${record.expiresAt ?? "?"} on hub ${record.hub.stage}; templates ${Arr.join(record.templates, ", ")} -> ${settings.records}/${record.run}/shared.json${record.failure === null ? "" : `\n${record.failure}`}`,
    );
    if (record.outcome === "failed") process.exitCode = 1;
  });

const program = Effect.gen(function* () {
  const settings = yield* Effect.flatMap(Settings, withVia);
  const chosen = yield* plans(settings);
  if (Option.isSome(world) && (command === "scenarios" || command === "starting-worlds"))
    return yield* usage(`--world is for the door and the chain journey only; ${USAGE}`);
  if (localCore && Arr.contains(flags, "--expect=not-implemented"))
    return yield* usage(
      `${LOCAL_CORE} runs in private worlds, which a run expecting not-implemented does not; ${USAGE}`,
    );
  if (command === "chain" && Option.isNone(world))
    return yield* usage(`chain needs --world=<name>: a stage has no chain; ${USAGE}`);
  if (command === "starting-worlds") return yield* theStartingWorlds(settings);
  if (command === "shared") return yield* theSharedWorld(settings);
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
