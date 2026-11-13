// Entry: `bun src/main.ts door` or `bun src/main.ts scenarios [name...]`, through ../run.sh, which sets the
// environment. Runs each plan in its own fresh stage, one at a time, and exits 1 when any run failed. This is the only
// file of the runner that touches the process: its arguments, its exit code and the Bun runtime.
import * as BunFileSystem from "@effect/platform-bun/BunFileSystem";
import * as BunPath from "@effect/platform-bun/BunPath";
import * as BunRuntime from "@effect/platform-bun/BunRuntime";
import { scenarios } from "@capxul/scenarios";
import * as Alchemist from "alchemy/Alchemist";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import { RunnerFailure } from "./failure.ts";
import { door, runPlan, scenarioPlan, type Plan } from "./run.ts";
import { Settings } from "./settings.ts";

const [command, ...names] = process.argv.slice(2);

const plans = (): Effect.Effect<ReadonlyArray<Plan>, RunnerFailure> => {
  if (command === "door") return Effect.succeed([door]);
  if (command !== "scenarios")
    return Effect.fail(RunnerFailure.make({ step: "arguments", message: "usage: door | scenarios [name...]" }));
  const chosen = names.length === 0 ? scenarios : Arr.filter(scenarios, (each) => Arr.contains(names, each.name));
  if (chosen.length < names.length)
    return Effect.fail(
      RunnerFailure.make({ step: "arguments", message: `no scenario is named one of: ${Arr.join(names, "; ")}` }),
    );
  return Effect.succeed(Arr.map(chosen, scenarioPlan));
};

const program = Effect.gen(function* () {
  const settings = yield* Settings;
  const chosen = yield* plans();
  yield* Effect.log(`${chosen.length} run${chosen.length === 1 ? "" : "s"}, each in its own fresh stage`);
  const records = yield* Effect.forEach(chosen, (plan) => runPlan(plan, settings), { concurrency: 1 });
  for (const record of records)
    yield* Effect.log(
      `${record.outcome}: ${record.name} (stage ${record.stage} ${record.afterwards.stage}; create ${record.ms.create} ms, run ${record.ms.run} ms, checks ${record.ms.checks} ms, destroy ${record.ms.destroy} ms) -> ${settings.records}/${record.stage}/`,
    );
  const failed = Arr.filter(records, (record) => record.outcome === "failed");
  if (failed.length > 0) process.exitCode = 1;
});

program.pipe(
  Effect.provide(Layer.mergeAll(Alchemist.layer(), BunFileSystem.layer, BunPath.layer, FetchHttpClient.layer)),
  BunRuntime.runMain,
);
