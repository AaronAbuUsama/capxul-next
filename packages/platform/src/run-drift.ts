// Entry: checks one platform stage for drift (src/drift.ts), prints the report as JSON, writes it to the record file
// when one is named, and exits 0 when it is clean, 2 when it drifted, and 1 when the check itself failed.
// With PLATFORM_HOST=aws the bench host's stack (host.run.ts) is scanned too.
// Usage: bin/run.sh bun src/run-drift.ts <stage> [record.json]
import * as BunRuntime from "@effect/platform-bun/BunRuntime";
import * as BunServices from "@effect/platform-bun/BunServices";
import * as Alchemist from "alchemy/Alchemist";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import { check } from "./drift.ts";
import { hostKind } from "./host.ts";
import { HOST_STACK, STACK } from "./names.ts";
import { exportFromConfig, platformTelemetry } from "./telemetry.ts";

const DRIFT_FOUND = 2;

Effect.gen(function* () {
  const [stage = "", recordFile] = process.argv.slice(2);
  const kind = yield* hostKind;
  const stacks = [
    ...(kind === "aws" ? [{ entrypoint: "host.run.ts", stack: HOST_STACK }] : []),
    { entrypoint: "alchemy.run.ts", stack: STACK },
  ];
  const report = yield* check(stage, stacks);
  const text = JSON.stringify(report, null, 2);
  yield* Console.log(text);
  if (recordFile !== undefined) yield* (yield* FileSystem.FileSystem).writeFileString(recordFile, `${text}\n`);
  if (!report.clean) process.exitCode = DRIFT_FOUND;
}).pipe(
  Effect.scoped,
  // With OTLP export, as OpenTelemetry's standard settings ask (src/telemetry.ts); flushed when the command ends.
  Effect.provide(Layer.mergeAll(Alchemist.layer(), BunServices.layer, exportFromConfig(platformTelemetry))),
  BunRuntime.runMain,
);
