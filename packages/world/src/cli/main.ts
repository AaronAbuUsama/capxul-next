// The entry: the only file that touches the process. Usage: ./run.sh <command> (see ./run.sh --help).
//
// A command's result is printed to standard output as JSON and nothing else is, so it can be piped: log lines and
// Alchemy's progress are written through Effect's Console and Alchemy's Interaction, both pointed at standard error.
import * as BunRuntime from "@effect/platform-bun/BunRuntime";
import * as BunServices from "@effect/platform-bun/BunServices";
import * as Alchemist from "alchemy/Alchemist";
import * as Interaction from "alchemy/Interaction";
import * as Console from "effect/Console";
import * as Digest from "effect/crypto/Digest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Tracer from "effect/Tracer";
import { appendFileSync } from "node:fs";
import * as Command from "effect/cli/Command";
import { exportLayer, PRODUCERS } from "@capxul/platform";
import { Report, world } from "./commands.ts";
import { asJsonText } from "../common/record.ts";
import { SharedState } from "../stack/engine.ts";

const ToStandardError = Layer.succeed(Console.Console, {
  ...globalThis.console,
  log: console.error,
  info: console.error,
});

const ReportToStandardOutput = Layer.succeed(Report, {
  print: (value) => Effect.sync(() => void process.stdout.write(asJsonText(value))),
});

// Alchemy's own services, then the shared state store, which needs them, over Bun's platform services.
const Alchemy = Layer.mergeAll(Alchemist.layer(), Interaction.layerNonInteractive({ stdout: process.stderr }));
const Services = SharedState.layer.pipe(
  Layer.provideMerge(Alchemy),
  Layer.provideMerge(ReportToStandardOutput),
  Layer.provideMerge(BunServices.layer),
  // The image fingerprints of `images` (src/stack/images.ts) hash with WebCrypto.
  Layer.provideMerge(Digest.layerWebCrypto),
  Layer.provideMerge(ToStandardError),
);

// With WORLD_SPANS=<file>, every span that ends is appended to that file as one line of JSON: its name, its parent's,
// when it began and how long it took, in milliseconds. How a command's time is split, Alchemy's own steps included.
// It writes beside the tracer already in place, so the spans are also exported when OTLP export is on.
const spansFile = process.env["WORLD_SPANS"];
const nowMs = (nanos: bigint) => Number(nanos / 1_000_000n);
const SpansToFile = Layer.effect(
  Tracer.Tracer,
  Effect.map(Effect.tracer, (outer) =>
    Tracer.make({
      span(options) {
        const span = outer.span(options);
        const end = span.end.bind(span);
        span.end = (endTime, exit) => {
          end(endTime, exit);
          const parent = options.parent._tag === "Some" ? options.parent.value : undefined;
          const line = {
            name: options.name,
            id: span.spanId,
            parent: parent?.spanId ?? null,
            parentName: parent !== undefined && "name" in parent ? parent.name : null,
            startMs: nowMs(options.startTime),
            ms: nowMs(endTime - options.startTime),
            ok: exit._tag === "Success",
          };
          if (spansFile !== undefined) appendFileSync(spansFile, `${JSON.stringify(line)}\n`);
        };
        return span;
      },
    }),
  ),
);

Command.run(world, { version: "0.0.0" }).pipe(
  // This is the entry point: the one place every layer is provided.
  Effect.provide(Services),
  // A failure, also one from opening the shared state, is reported on standard error and the process exits non-zero.
  Effect.tapCause((cause) => Effect.logError(cause)),
  Effect.provide(ToStandardError),
  spansFile === undefined ? (effect) => effect : Effect.provide(SpansToFile),
  // OTLP export, as OpenTelemetry's standard settings ask (packages/platform, src/telemetry.ts); outermost, so every
  // span of the command, the file's included, goes through it, and it is flushed when the command ends.
  Effect.provide(exportLayer(PRODUCERS.world)),
  BunRuntime.runMain({ disableErrorReporting: true }),
);
