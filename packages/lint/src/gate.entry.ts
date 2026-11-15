// `pnpm check`: the gate's rungs 1 to 5, each command run as a child process with the console passed through, in the
// span the blueprint declares for its rung (./climb.ts), stopping at the first that fails and exiting with its code,
// as the chain of `&&` it replaces did. Its telemetry goes where OpenTelemetry's standard settings say, as the
// producer `capxul-gate` (packages/platform's `exportFromConfig`): with no endpoint, as on a builder's machine,
// nothing is exported. In CI, the job's step before it sets the collector and the run's token
// (packages/runner, src/collector-env.entry.ts). GATE_WORDS_BASE names the branch R15 compares with, on a pull
// request.
import { execFileSync, spawn } from "node:child_process";
import { Producers } from "@capxul/blueprint";
import { exportFromConfig, exportLayer } from "@capxul/platform";
import * as Effect from "effect/Effect";
import * as Rec from "effect/Record";
import * as Str from "effect/String";
import { climb, rungsOf, type Run } from "./climb.ts";

const base = process.env["GATE_WORDS_BASE"];

// The code's revision on the gate's resource: GitHub's own in CI, else the commit checked out, as each run.sh gives it.
if (process.env["CODE_REVISION"] === undefined) {
  try {
    process.env["CODE_REVISION"] = Str.trim(execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }));
  } catch {
    process.env["CODE_REVISION"] = "unknown";
  }
}

/**
 * The commands' environment: the gate's own but OpenTelemetry's settings, which are the gate's alone. A rung's command
 * exports nothing of its own, and a test that reads them sees what it would on a builder's machine.
 */
const childEnv = Rec.filter(process.env, (_value, key) => !Str.startsWith("OTEL_")(key));

/** Runs `pnpm <script> <args>` with the console passed through, and answers its exit code. */
const run: Run = (rung) =>
  Effect.promise(
    () =>
      new Promise<number>((resolve) => {
        const child = spawn("pnpm", [rung.script, ...rung.args], { stdio: "inherit", env: childEnv });
        child.on("error", () => resolve(1));
        child.on("close", (code) => resolve(code ?? 1));
      }),
  );

const gateTelemetry = exportFromConfig((options) => exportLayer(Producers.producers.gate.service, options));

Effect.runPromise(climb(rungsOf(base === "" ? undefined : base), run).pipe(Effect.provide(gateTelemetry))).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  },
);
