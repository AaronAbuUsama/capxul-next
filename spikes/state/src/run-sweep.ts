// Entry: sweeps the spike's stack once and prints the report as JSON. Exits 0 when no expired stage is left, and 1
// when a destroy failed, so a scheduled job can alert on it. Usage: ./run.sh bun src/run-sweep.ts [--dry-run]
import * as BunRuntime from "@effect/platform-bun/BunRuntime";
import * as Alchemist from "alchemy/Alchemist";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { sweep, SweepIncomplete, SweepReport } from "./sweep.ts";

const print = (report: SweepReport) => Console.log(JSON.stringify(Schema.encodeSync(SweepReport)(report), null, 2));

sweep({ entrypoint: "alchemy.run.ts", dryRun: process.argv.includes("--dry-run") }).pipe(
  Effect.tap(print),
  Effect.tapError((failure) => (failure instanceof SweepIncomplete ? print(failure.report) : Effect.void)),
  Effect.provide(Alchemist.layer()),
  BunRuntime.runMain,
);
