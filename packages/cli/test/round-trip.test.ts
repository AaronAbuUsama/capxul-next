// Every blueprint operation through the SDK and through the command line, against a door served in this process:
// both give the same answers, refusals and successes alike, whether the payload comes from flags or from a file.
// The `capxul` process itself is run for every operation too: it prints the same line and exits with the
// blueprint's exit code.
import { strict as assert } from "node:assert";
import { execFile } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { Errors, operations, type OperationName } from "@capxul/blueprint";
import * as Sdk from "@capxul/sdk";
import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Arr from "effect/Array";
import * as Cause from "effect/Cause";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Sink from "effect/Sink";
import * as Stdio from "effect/Stdio";
import * as Str from "effect/String";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as Cli from "../src/door.ts";

const TOKEN = "door-token-2";
const BIN = join(import.meta.dirname, "../src/bin.ts");
const names = Sdk.names;
const folder = mkdtempSync(join(tmpdir(), "capxul-cli-"));

const example = (name: OperationName) => {
  const first = operations[name].examples[0];
  assert.ok(first, `${name} declares no example`);
  return first;
};

/** The flags that give the example's payload: a string as itself, anything else as its JSON. */
const flagsOf = (name: OperationName): Array<string> => {
  const payload = example(name).payload;
  assert.ok(typeof payload === "object" && payload !== null);
  return Arr.flatMap(Cli.fieldsOf(name), (field) => {
    const value: unknown = Reflect.get(payload, field.field);
    return [`--${field.flag}`, typeof value === "string" ? value : JSON.stringify(value)];
  });
};

/** `--input` with a file holding the example's payload. */
const fileOf = (name: OperationName): Array<string> => {
  const path = join(folder, `${name}.json`);
  writeFileSync(path, JSON.stringify(example(name).payload));
  return ["--input", path];
};

const argsOf = (name: OperationName, rest: Array<string>) => [...Str.split(name, "."), ...rest];

type Served = { readonly platform: string; readonly world: string };

const envOf = (urls: Served, token: string) => ({
  CAPXUL_PLATFORM_URL: urls.platform,
  CAPXUL_PLATFORM_TOKEN: token,
  CAPXUL_DOOR_URL: urls.world,
  CAPXUL_DOOR_TOKEN: token,
});

/** Runs `body` with the door served and its addresses known. */
const withDoor = <A>(answer: Sdk.TestDoor.Answer, body: (urls: Served) => Promise<A>) =>
  Effect.runPromise(
    Effect.flatMap(Sdk.TestDoor.urls, (urls) => Effect.promise(() => body(urls))).pipe(
      Effect.provide(
        Sdk.TestDoor.serve({ token: TOKEN, answer }).pipe(
          Layer.provideMerge(NodeHttpServer.layer(createServer, { port: 0, host: "127.0.0.1" })),
        ),
      ),
    ),
  );

/** The SDK's answer to the operation's example, as a CLI answer, or null for a defect. */
const viaSdk = (urls: Served, name: OperationName, token = TOKEN) => {
  const doors = Layer.merge(
    Sdk.platformDoor({ url: urls.platform, token: Redacted.make(token) }),
    Sdk.worldDoor({ url: urls.world, token: Redacted.make(token) }),
  ).pipe(Layer.provide(FetchHttpClient.layer));
  return Effect.runPromise(
    Effect.flatMap(Sdk.make, (client) => Effect.exit(Sdk.callByName(client, name, example(name).payload))).pipe(
      Effect.provide(doors),
    ),
  );
};

/** The command line run in this process: what it printed and how it ended. */
const viaCli = async (urls: Served, args: Array<string>, token = TOKEN) => {
  const out: Array<string> = [];
  const stdio = Stdio.layerTest({
    stdout: () =>
      Sink.forEach((chunk: string | Uint8Array) =>
        Effect.sync(() => out.push(typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk))),
      ),
  });
  const services = Layer.mergeAll(
    NodeServices.layer,
    stdio,
    FetchHttpClient.layer,
    ConfigProvider.layer(ConfigProvider.fromEnvRecord(envOf(urls, token))),
  );
  const exit = await Cli.run(args).pipe(Effect.exit, Effect.provide(services), Effect.runPromise);
  return {
    lines: Arr.filter(Str.split(Arr.join(out, ""), "\n"), (line) => line !== ""),
    exit,
  };
};

/** The exit code the process would end with for a command that ended so. */
const codeOf = (exit: Exit.Exit<unknown, unknown>): number =>
  Exit.isSuccess(exit) ? 0 : Cli.exitCodeOf(exit.cause.pipe(Cause.findErrorOption, Option.getOrNull));

/** What the command line printed, decoded with the operation's own schemas. */
const read = (name: OperationName, line: string | undefined) => {
  assert.ok(line !== undefined, `${name} printed nothing`);
  return Effect.runPromise(Cli.readAnswer(name, line));
};

/** The SDK's answer in the command line's shape. */
const asAnswer = (name: OperationName, exit: Exit.Exit<unknown, unknown>): Cli.Answer => {
  if (Exit.isSuccess(exit)) return { operation: name, outcome: "success", success: exit.value };
  const error = Cause.findErrorOption(exit.cause);
  assert.ok(Option.isSome(error), `${name}: the SDK's call died`);
  return { operation: name, outcome: "refusal", refusal: error.value };
};

const sameAnswers = (answer: Sdk.TestDoor.Answer, input: (name: OperationName) => Array<string>) =>
  withDoor(answer, async (urls) => {
    for (const name of names) {
      const sdk = asAnswer(name, await viaSdk(urls, name));
      const cli = await viaCli(urls, argsOf(name, input(name)));
      assert.equal(cli.lines.length, 1, `${name} printed ${cli.lines.length} lines`);
      assert.deepStrictEqual(await read(name, cli.lines[0]), sdk, name);
      assert.equal(Exit.isSuccess(cli.exit), sdk.outcome === "success", `${name}: the command ended otherwise`);
      if (sdk.outcome === "refusal") assert.equal(codeOf(cli.exit), Cli.exitCodeOf(sdk.refusal), name);
    }
  });

test("every operation refuses with NotImplemented through the SDK and the command line alike, from flags", () =>
  sameAnswers("not-implemented", flagsOf));

test("every operation answers its declared success through the SDK and the command line alike, from flags", () =>
  sameAnswers("examples", flagsOf));

test("every operation answers the same from an --input file as from flags", () => sameAnswers("examples", fileOf));

test("a wrong credential is NotSignedIn through both, and the command line's exit code is the blueprint's", () =>
  withDoor("examples", async (urls) => {
    for (const name of ["world.show", "record.export"] as const) {
      const sdk = asAnswer(name, await viaSdk(urls, name, "a-wrong-token"));
      const cli = await viaCli(urls, argsOf(name, flagsOf(name)), "a-wrong-token");
      assert.deepStrictEqual(await read(name, cli.lines[0]), sdk);
      assert.ok(Exit.isFailure(cli.exit));
      assert.equal(codeOf(cli.exit), Errors.exitCode.NotSignedIn);
    }
  }));

test("a payload that does not decode is refused before any call, naming the operation", () =>
  withDoor("examples", async (urls) => {
    const cli = await viaCli(urls, ["world", "create", "--world", "Not A Name"]);
    assert.deepEqual(cli.lines, []);
    assert.ok(Exit.isFailure(cli.exit));
  }));

const run = promisify(execFile);

test("the capxul process prints the same line and exits with the blueprint's code for every operation", () =>
  withDoor("not-implemented", async (urls) => {
    const runs = await Promise.all(
      Arr.map(names, async (name) => {
        const args = argsOf(name, flagsOf(name));
        const inProcess = await viaCli(urls, args);
        const child = await run(process.execPath, ["--experimental-strip-types", "--no-warnings", BIN, ...args], {
          env: { ...process.env, ...envOf(urls, TOKEN) },
        }).then(
          (done) => ({ stdout: done.stdout, code: 0 }),
          (failed: { stdout: string; code: number }) => ({ stdout: failed.stdout, code: failed.code }),
        );
        return { name, child, inProcess };
      }),
    );
    for (const { name, child, inProcess } of runs) {
      assert.equal(child.code, Errors.exitCode.NotImplemented, `${name} exited ${child.code}`);
      assert.equal(child.stdout, `${inProcess.lines[0]}\n`, name);
    }
  }));
