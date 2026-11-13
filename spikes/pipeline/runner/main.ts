// Entry: runs every scenario found under a directory, each in its own fresh world, and exits non-zero when any
// of them failed. Usage (through ../run.sh, which sets the environment): bun runner/main.ts <directory>
//
// This is the only file here that touches the process: its arguments, its exit code and the Bun runtime.
import * as BunFileSystem from "@effect/platform-bun/BunFileSystem";
import * as BunPath from "@effect/platform-bun/BunPath";
import * as BunRuntime from "@effect/platform-bun/BunRuntime";
import * as Alchemist from "alchemy/Alchemist";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import { runAll, Settings } from "./run.ts";
import { isScenario, type Scenario } from "./scenario.ts";
import { ensurePlatform } from "./world.ts";

class NotAScenario extends Schema.TaggedError<NotAScenario>()("NotAScenario", { file: Schema.String, message: Schema.String }) {}

class ScenariosFailed extends Schema.TaggedError<ScenariosFailed>()("ScenariosFailed", { failed: Schema.Array(Schema.String), message: Schema.String }) {}

/** Every `*.scenario.ts` under `directory`, in path order. Each file's default export is one scenario. */
const discover = (directory: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const files = (yield* fs.readDirectory(directory, { recursive: true })).filter((file) => file.endsWith(".scenario.ts")).sort();
    const scenarios = yield* Effect.forEach(files, (file) =>
      Effect.gen(function* () {
        const module: { readonly default?: unknown } = yield* Effect.tryPromise({
          try: () => import(path.resolve(directory, file)),
          catch: (cause) => new NotAScenario({ file, message: String(cause) }),
        });
        if (isScenario(module.default)) return module.default;
        return yield* new NotAScenario({ file, message: "the default export is not a scenario (see runner/scenario.ts)" });
      }),
    );
    const names = scenarios.map((scenario) => scenario.name);
    const twice = names.find((name, index) => names.indexOf(name) !== index);
    if (twice !== undefined) return yield* new NotAScenario({ file: directory, message: `two scenarios are named "${twice}"` });
    return scenarios satisfies ReadonlyArray<Scenario>;
  });

const program = (directory: string) =>
  Effect.gen(function* () {
    const settings = yield* Settings;
    const scenarios = yield* discover(directory);
    yield* Effect.log(`${scenarios.length} scenario${scenarios.length === 1 ? "" : "s"} in ${directory}`);
    if (scenarios.length === 0) return;
    yield* ensurePlatform;
    const records = yield* runAll(scenarios, settings);
    yield* Effect.forEach(records, (record) =>
      Effect.log(
        `${record.outcome}: ${record.scenario} (world ${record.world} ${record.worldAfterwards}; create ${record.ms.create} ms, scenario ${record.ms.scenario} ms, checks ${record.ms.checks} ms, destroy ${record.ms.destroy} ms) -> ${settings.records}/`,
      ),
    );
    const failed = records.filter((record) => record.outcome === "failed" || record.worldAfterwards !== "destroyed");
    if (failed.length === 0) return;
    const names = failed.map((record) => record.scenario);
    return yield* new ScenariosFailed({ failed: names, message: `${names.length} of ${records.length} did not pass or left a world behind: ${names.join("; ")}` });
  });

program(process.argv[2] ?? "scenarios").pipe(
  Effect.provide(Layer.mergeAll(Alchemist.layer(), BunFileSystem.layer, BunPath.layer, FetchHttpClient.layer)),
  BunRuntime.runMain,
);
