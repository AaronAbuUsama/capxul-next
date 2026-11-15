// One call made through the command line, in this process: the arguments of the command that makes it (`argsOf`),
// the command line run on them as the `capxul` process runs it (`run`: the same parsing, the same call through the
// SDK, the same printed line), and that one line read back with the operation's own schemas (`readAnswer`). It
// answers what the line holds, the success or the refusal, so it can stand where the SDK's call stands: the runner
// runs the thin line's journeys through it (packages/runner, `--via=cli`). No process is spawned per call; that the
// process prints the same line is test/round-trip.test.ts's.
import type { CallOptions, OperationName } from "@capxul/blueprint";
import type * as Sdk from "@capxul/sdk";
import * as Arr from "effect/Array";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Redacted from "effect/Redacted";
import * as Ref from "effect/Ref";
import * as Sink from "effect/Sink";
import * as Stdio from "effect/Stdio";
import * as Str from "effect/String";
import * as Terminal from "effect/Terminal";
import * as Command from "effect/cli/Command";
import type * as HttpClient from "effect/http/HttpClient";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import { capxul, VERSION } from "./commands.ts";
import { argsOf } from "./input.ts";
import { readAnswer } from "./output.ts";

/** Where the command line's doors are, and their credentials: what `capxul` reads from its environment. */
export interface Doors {
  /** `CAPXUL_PLATFORM_URL` and `CAPXUL_PLATFORM_TOKEN`, the first operator's. */
  readonly platform: Sdk.Target;
  /** `CAPXUL_DOOR_URL` and `CAPXUL_DOOR_TOKEN`. */
  readonly world: Sdk.Target;
  /** `CAPXUL_SECOND_PLATFORM_TOKEN`, when there is a second operator. */
  readonly secondOperator: Redacted.Redacted | null;
}

/** The environment `capxul` would read, as text, held in memory for the one call. */
const environmentOf = (doors: Doors): Record<string, string> => ({
  CAPXUL_PLATFORM_URL: doors.platform.url,
  CAPXUL_PLATFORM_TOKEN: Redacted.value(doors.platform.token),
  CAPXUL_DOOR_URL: doors.world.url,
  CAPXUL_DOOR_TOKEN: Redacted.value(doors.world.token),
  ...(doors.secondOperator === null ? {} : { CAPXUL_SECOND_PLATFORM_TOKEN: Redacted.value(doors.secondOperator) }),
});

const unused = (what: string) => Effect.die(`a call through the command line uses no ${what}`);

/**
 * What the command line needs of a process, for one call: its standard output kept in `out`, its environment
 * `doors`. It reads no file (a call's payload is in its flags), asks nothing of a terminal and spawns nothing.
 */
const processFor = (doors: Doors, out: Ref.Ref<string>) =>
  Layer.mergeAll(
    FileSystem.layerNoop({}),
    Path.layer,
    Layer.succeed(
      Terminal.Terminal,
      Terminal.make({
        columns: Effect.succeed(80),
        rows: Effect.succeed(24),
        size: unused("terminal"),
        readInput: unused("terminal"),
        readLine: unused("terminal"),
        display: () => Effect.void,
      }),
    ),
    Layer.succeed(
      ChildProcessSpawner.ChildProcessSpawner,
      ChildProcessSpawner.make(() => unused("child process")),
    ),
    Stdio.layerTest({
      stdout: () =>
        Sink.forEach((chunk: string | Uint8Array) =>
          Ref.update(out, (text) => text + (typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk))),
        ),
    }),
    ConfigProvider.layer(ConfigProvider.fromEnvRecord(environmentOf(doors))),
  );

const run = Command.runWith(capxul, { version: VERSION });

/**
 * The call made through the command line: it answers the success its one printed line holds, or fails with the
 * refusal it holds. A command that printed no line ended without an answer (no answer came, or the server died in
 * the call): that is the call's defect, as it is the SDK's.
 */
export const callVia =
  (doors: Doors) =>
  (
    name: OperationName,
    payload: unknown,
    options?: CallOptions,
  ): Effect.Effect<Sdk.Success<OperationName>, Sdk.Refusal<OperationName>, HttpClient.HttpClient> =>
    Effect.gen(function* () {
      const args = yield* argsOf(name, payload, options);
      const out = yield* Ref.make("");
      // oxlint-disable-next-line effecttsgo/strict-effect-provide -- each call is the command line run once, as its own process would be, with its own output and environment
      const exit = yield* Effect.exit(Effect.provide(run(args), processFor(doors, out)));
      const lines = Arr.filter(Str.split(yield* Ref.get(out), "\n"), Str.isNonEmpty);
      const line = Arr.head(lines);
      if (Option.isNone(line)) return yield* Effect.orDie(Effect.andThen(exit, Effect.die(`${name} printed nothing`)));
      if (lines.length > 1) return yield* Effect.die(`${name} printed ${lines.length} lines: ${Arr.join(lines, "\n")}`);
      const answer = yield* Effect.orDie(readAnswer(name, line.value));
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- readAnswer decoded the line with the operation's own success and refusal schemas, the very values the SDK's call answers
      if (answer.outcome === "success") return answer.success as Sdk.Success<OperationName>;
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- as above, for the refusal
      return yield* answer.refusal as Sdk.Refusal<OperationName>;
    });
