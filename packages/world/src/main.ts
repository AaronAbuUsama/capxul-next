// The entry: the only file that touches the process. Usage: ./run.sh <command> (see ./run.sh --help).
//
// A command's result is printed to standard output as JSON and nothing else is, so it can be piped: log lines and
// Alchemy's progress are written through Effect's Console and Alchemy's Interaction, both pointed at standard error.
import * as BunRuntime from "@effect/platform-bun/BunRuntime";
import * as BunServices from "@effect/platform-bun/BunServices";
import * as Alchemist from "alchemy/Alchemist";
import * as Interaction from "alchemy/Interaction";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Command from "effect/cli/Command";
import { Report, world } from "./cli/commands.ts";
import { SharedState } from "./stack/engine.ts";

const ToStandardError = Layer.succeed(Console.Console, {
  ...globalThis.console,
  log: console.error,
  info: console.error,
});

const Alchemy = Layer.mergeAll(Alchemist.layer(), Interaction.layerNonInteractive({ stdout: process.stderr })).pipe(
  Layer.provideMerge(ToStandardError),
);

const ReportLive = Layer.succeed(Report, {
  print: (value) => Effect.sync(() => void process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)),
});

Command.run(world, { version: "0.0.0" }).pipe(
  Effect.provide(Layer.mergeAll(SharedState.layer, BunServices.layer, ReportLive).pipe(Layer.provideMerge(Alchemy))),
  // A failure, also one from opening the shared state, is reported on standard error and the process exits non-zero.
  Effect.tapCause((cause) => Effect.logError(cause)),
  Effect.provide(ToStandardError),
  BunRuntime.runMain({ disableErrorReporting: true }),
);
