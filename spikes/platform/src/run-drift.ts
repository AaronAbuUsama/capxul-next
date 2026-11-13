// Entry: checks one platform stage for drift (src/drift.ts), prints the report as JSON and exits 0 when it is clean,
// 2 when it drifted, and 1 when the check itself failed. Usage: ./run.sh bun src/run-drift.ts <stage>
import * as BunRuntime from "@effect/platform-bun/BunRuntime";
import * as BunServices from "@effect/platform-bun/BunServices";
import * as Alchemist from "alchemy/Alchemist";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { check } from "./drift.ts";

const DRIFT_FOUND = 2;

check("alchemy.run.ts", process.argv[2] ?? "").pipe(
  Effect.tap((report) => Console.log(JSON.stringify(report, null, 2))),
  Effect.tap((report) => (report.clean ? Effect.void : Effect.sync(() => (process.exitCode = DRIFT_FOUND)))),
  Effect.scoped,
  Effect.provide(Layer.merge(Alchemist.layer(), BunServices.layer)),
  BunRuntime.runMain,
);
