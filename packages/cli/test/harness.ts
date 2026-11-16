// What the grammar's tests (roadmap item 3.9) share: the test door served in this process, an HTTP client that sends
// every call meant for the example world's endpoint to that door instead and keeps what it sent, and the command line
// run in this process with a chosen environment, standard input and terminal. Nothing here is a check; each test file
// holds its own.
//
// The seams the command line reads, and the builder honours:
// - its environment, through Effect's ConfigProvider (`ConfigProvider.fromEnvRecord`), as `src/call.ts` provides it;
// - `CAPXUL_HOME`: the directory the profile lives in (by default the caller's home, `~/.capxul`), read through Config;
// - whether its output is a terminal: `Stdio.stdoutIsTerminal`;
// - its standard input: `Stdio.stdin` (`capxul login` reads the operator's token from it, one line);
// - its disk: Effect's FileSystem (Node's, here), which the profile is written with.
import { Errors, operations, WORLD_PATH, type OperationName } from "@capxul/blueprint";
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
import * as Predicate from "effect/Predicate";
import * as Ref from "effect/Ref";
import * as Sink from "effect/Sink";
import * as Stdio from "effect/Stdio";
import * as Stream from "effect/Stream";
import * as Str from "effect/String";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as Headers from "effect/http/Headers";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
// oxlint-disable-next-line effecttsgo/node-builtin-import -- the test door is served by a Node HTTP server, as the package's other tests serve it
import { createServer } from "node:http";
import * as Cli from "../src/door.ts";

/** The one token the test door accepts, for the account and for every world alike. */
export const TOKEN = "grammar-token-39";

/** The endpoint `world.show` answers in the blueprint's example: where a world's command goes once resolved. */
export const EXAMPLE_ENDPOINT: string = Option.match(Arr.head(operations["world.show"].examples), {
  onNone: () => "",
  onSome: (example) =>
    Predicate.hasProperty(example.success, "door") && Predicate.isString(example.success.door)
      ? example.success.door
      : "",
});

/** Where the test door answers. */
export interface Served {
  /** Its base address, which stands in for the example world's endpoint. */
  readonly door: string;
  /** Its account group: what `CAPXUL_PLATFORM_URL`, or `login --account`, names. */
  readonly platform: string;
  /** Its world group: what `CAPXUL_DOOR_URL` names. */
  readonly world: string;
}

/** One request the command line sent, as it left the process: where to, signed with what, and its body. */
export interface Sent {
  readonly url: string;
  readonly credential: string | null;
  readonly body: string;
}

/** The test door, served on a free port, with the log of the calls it saw. */
const door = (answer: Sdk.TestDoor.Answer) =>
  Sdk.TestDoor.serve({ token: TOKEN, answer }).pipe(
    Layer.provideMerge(NodeHttpServer.layer(createServer, { port: 0, host: "127.0.0.1" })),
  );

/**
 * An HTTP client that sends what is meant for the example world's endpoint to the test door, and keeps every request
 * as it was addressed, before the rewrite.
 */
const routed = (served: Served, sent: Ref.Ref<ReadonlyArray<Sent>>) =>
  Layer.effect(
    HttpClient.HttpClient,
    Effect.map(Effect.service(HttpClient.HttpClient), (client) =>
      // The request as it leaves the process, after every client above has set its address and credential.
      HttpClient.make((request) =>
        Effect.andThen(
          Ref.update(sent, (all) =>
            Arr.append(all, {
              url: request.url,
              credential: Option.getOrNull(Headers.get(request.headers, "authorization")),
              body: request.body._tag === "Uint8Array" ? new TextDecoder().decode(request.body.body) : "",
            }),
          ),
          client.execute(
            Str.startsWith(EXAMPLE_ENDPOINT)(request.url)
              ? HttpClientRequest.setUrl(request, served.door + Str.slice(EXAMPLE_ENDPOINT.length)(request.url))
              : request,
          ),
        ),
      ),
    ),
  ).pipe(Layer.provide(FetchHttpClient.layer));

/** What the door and the command line hand a test's body: where the door is, and the run of one command. */
export interface Bench {
  readonly served: Served;
  /** Runs `capxul` with these arguments, as a process with this environment, input and output would. */
  readonly run: (args: ReadonlyArray<string>, process?: Process) => Promise<Ran>;
  /** Every operation the door has seen, in order. */
  readonly seen: () => Promise<ReadonlyArray<string>>;
  /** Every request the command line has sent, in order. */
  readonly sent: () => Promise<ReadonlyArray<Sent>>;
}

/** The process a command runs as. */
export interface Process {
  /** Its environment's variables; left out, none. */
  readonly env?: Readonly<Record<string, string>>;
  /** True when its standard output is a terminal; left out, false (piped). */
  readonly tty?: boolean;
  /** What is typed on its standard input; left out, nothing. */
  readonly stdin?: string;
}

/** How one command ended: what it printed on each stream, and its exit. */
export interface Ran {
  readonly stdout: string;
  readonly stderr: string;
  /** Standard output's lines that are not empty. */
  readonly lines: ReadonlyArray<string>;
  readonly exit: Exit.Exit<void, unknown>;
}

const collect = (into: Ref.Ref<string>) => () =>
  Sink.forEach((chunk: string | Uint8Array) =>
    Ref.update(into, (text) => text + (typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk))),
  );

const runOne =
  (sent: Ref.Ref<ReadonlyArray<Sent>>, served: Served) =>
  (args: ReadonlyArray<string>, shell: Process = {}) =>
    Effect.gen(function* () {
      const out = yield* Ref.make("");
      const err = yield* Ref.make("");
      const stdio = Stdio.layerTest({
        stdout: collect(out),
        stderr: collect(err),
        stdoutIsTerminal: Effect.succeed(shell.tty ?? false),
        stdin: shell.stdin === undefined ? Stream.empty : Stream.make(new TextEncoder().encode(shell.stdin)),
      });
      const services = Layer.mergeAll(
        NodeServices.layer,
        stdio,
        routed(served, sent),
        ConfigProvider.layer(ConfigProvider.fromEnvRecord({ ...shell.env })),
      );
      // oxlint-disable-next-line effecttsgo/strict-effect-provide -- each command is run as its own process would be, with its own environment and output
      const exit = yield* Effect.exit(Effect.provide(Cli.run(args), services));
      const stdout = yield* Ref.get(out);
      return {
        stdout,
        stderr: yield* Ref.get(err),
        lines: Arr.filter(Str.split(stdout, "\n"), Str.isNonEmpty),
        exit,
      };
    });

/** Serves the test door answering so, and hands `body` a bench to run commands on. */
export const withBench = <A>(answer: Sdk.TestDoor.Answer, body: (bench: Bench) => Promise<A>): Promise<A> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const urls = yield* Sdk.TestDoor.urls;
      const calls = yield* Sdk.TestDoor.Calls;
      const sent = yield* Ref.make<ReadonlyArray<Sent>>([]);
      const served: Served = { door: urls.door, platform: urls.platform, world: urls.world };
      const run = runOne(sent, served);
      const context = yield* Effect.context();
      const runPromise = Effect.runPromiseWith(context);
      const bench: Bench = {
        served,
        run: (args, shell) => runPromise(run(args, shell)),
        seen: () => runPromise(calls.pipe(Ref.get, Effect.map(Arr.map((call) => call.operation)))),
        sent: () => runPromise(sent.pipe(Ref.get)),
      };
      return yield* Effect.promise(() => body(bench));
      // oxlint-disable-next-line effecttsgo/strict-effect-provide -- each test serves its own door, for that test alone
    }).pipe(Effect.provide(door(answer))),
  );

/** The environment `capxul` reads today, naming the test door: what the runner's `--via=cli` sets. */
export const envOf = (served: Served): Record<string, string> => ({
  CAPXUL_PLATFORM_URL: served.platform,
  CAPXUL_PLATFORM_TOKEN: TOKEN,
  CAPXUL_DOOR_URL: served.world,
  CAPXUL_DOOR_TOKEN: TOKEN,
});

/** The world group's address at the example world's endpoint: where a resolved world's command is sent. */
export const EXAMPLE_WORLD_URL = `${Str.replace(/\/+$/, "")(EXAMPLE_ENDPOINT)}${WORLD_PATH}`;

/** The flags that give the operation's first example's payload, without its command's path. */
export const exampleFlags = (name: OperationName): Promise<ReadonlyArray<string>> =>
  Effect.runPromise(
    Effect.map(
      Cli.argsOf(
        name,
        Option.match(Arr.head(operations[name].examples), { onNone: () => ({}), onSome: (e) => e.payload }),
      ),
      Arr.dropWhile((arg) => !Str.startsWith("--")(arg)),
    ),
  );

/** True when two addresses name the same place, a trailing slash aside. */
export const sameUrl = (a: string, b: string): boolean => Str.replace(/\/+$/, "")(a) === Str.replace(/\/+$/, "")(b);

/** The operations and the refusal these tests name, imported from the blueprint rather than written again. */
export const DOC_CREATE = operations["doc.create"].rpc._tag;
export const WORLD_SHOW = operations["world.show"].rpc._tag;
export const WORLD_LIST = operations["world.list"].rpc._tag;
export const THRESHOLD_SET = operations["org.threshold.set"].rpc._tag;
export const NOT_IMPLEMENTED: string = Errors.NotImplemented.make({ operation: THRESHOLD_SET })._tag;

/** The exit code the process would end with for a command that ended so. */
export const codeOf = (ran: Ran): number =>
  Exit.isSuccess(ran.exit) ? 0 : Cli.exitCodeOf(ran.exit.cause.pipe(Cause.findErrorOption, Option.getOrNull));
