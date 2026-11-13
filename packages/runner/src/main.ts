// Entry: `bun src/main.ts door` or `bun src/main.ts scenarios [--one-stage] [--expect=pass|not-implemented]
// [name...]`, through ../run.sh, which sets the environment. The door runs in its own fresh stage; the scenarios run
// as scenario-runs.ts says, one at a time. Exits 1 when the door failed, or when a scenario did not end as the run
// expected or a stage was left. This is the only file of the runner that touches the process: its arguments, its exit
// code and the Bun runtime.
import * as BunFileSystem from "@effect/platform-bun/BunFileSystem";
import * as BunPath from "@effect/platform-bun/BunPath";
import * as BunRuntime from "@effect/platform-bun/BunRuntime";
import { scenarios } from "@capxul/scenarios";
import * as Alchemist from "alchemy/Alchemist";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Str from "effect/String";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import { RunnerFailure } from "./failure.ts";
import { door, runPlan, scenarioPlan, type Plan } from "./run.ts";
import { runScenarios } from "./scenario-runs.ts";
import { Settings } from "./settings.ts";
import { ranAsExpected, type Expectation, type Mode } from "./summary.ts";

const USAGE = "usage: door | scenarios [--one-stage] [--expect=pass|not-implemented] [name...]";
const [command, ...rest] = process.argv.slice(2);
const flags = Arr.filter(rest, Str.startsWith("--"));
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

const theDoor = (settings: Settings) =>
  Effect.gen(function* () {
    const record = yield* runPlan(door, settings);
    yield* Effect.log(
      `${record.outcome}: ${record.name} (stage ${record.stage} ${record.afterwards.stage}; create ${record.ms.create} ms, run ${record.ms.run} ms, checks ${record.ms.checks} ms, destroy ${record.ms.destroy} ms) -> ${settings.records}/${record.stage}/`,
    );
    if (record.outcome === "failed") process.exitCode = 1;
  });

const theScenarios = (settings: Settings, chosen: ReadonlyArray<Plan>) =>
  Effect.gen(function* () {
    const { mode, expect } = yield* options();
    yield* Effect.log(`${chosen.length} scenario${chosen.length === 1 ? "" : "s"}, ${mode}, expecting ${expect}`);
    const summary = yield* runScenarios(chosen, settings, mode, expect);
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

const program = Effect.gen(function* () {
  const settings = yield* Settings;
  const chosen = yield* plans(settings);
  yield* command === "door" ? theDoor(settings) : theScenarios(settings, chosen);
});

program.pipe(
  Effect.provide(Layer.mergeAll(Alchemist.layer(), BunFileSystem.layer, BunPath.layer, FetchHttpClient.layer)),
  BunRuntime.runMain,
);
