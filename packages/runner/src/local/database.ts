// A local Core's way in to its world's database. This machine has no TCP route out: it reaches Neon only through the
// session's HTTPS proxy. Neon also speaks Postgres over a WebSocket (`wss://<endpoint host>/v2`, the serverless
// driver's way), which the proxy carries. So each world gets a Postgres address on this machine's loopback, and every
// connection workerd opens to it is carried, byte for byte, over a WebSocket of its own to the world's Neon endpoint.
// The Postgres protocol inside is untouched: Core's driver authenticates with the branch's own role as it would
// through Hyperdrive. Nothing is listened on but the loopback.
import * as BunSocketServer from "@effect/platform-bun/BunSocketServer";
import * as Config from "effect/Config";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schedule from "effect/Schedule";
import * as Str from "effect/String";
import type * as Scope from "effect/Scope";
import type * as NetAddress from "effect/net/NetAddress";
import * as Socket from "effect/socket/Socket";
import { RunnerFailure } from "../failure.ts";

/** The port a loopback listener got; a Unix socket has none. */
export const portOf = (address: NetAddress.SocketAddress): number =>
  address._tag === "UnixPathAddress" ? 0 : address.port;

/** A world's database as workerd's Hyperdrive binding names it: where it listens here, and the branch's own role. */
export interface DatabaseBridge {
  readonly port: number;
  readonly database: string;
  readonly user: Redacted.Redacted;
  readonly password: Redacted.Redacted;
}

/**
 * Bun's WebSocket, through the session's proxy when there is one. Bun takes the proxy as a constructor option that
 * the DOM's types do not declare.
 */
const proxiedWebSockets = Effect.map(Config.option(Config.String("HTTPS_PROXY")), (proxy) =>
  Socket.WebSocketConstructor.of((url) =>
    Option.match(proxy, {
      onNone: () => new globalThis.WebSocket(url),
      onSome: (through) => new globalThis.WebSocket(url, { proxy: through }),
    }),
  ),
).pipe(Effect.orDie);

/** Copies every chunk `reader` reads to `writer`, until either side closes. */
const pump = (reader: Socket.Reader, writer: Socket.Writer) =>
  Effect.forever(Effect.flatMap(reader.pull, (chunks) => writer.writeAll(chunks)));

/**
 * The endpoint, handed the client's first message, once it has answered it. A WebSocket that closes before any answer
 * (seen once in a run: "Connection closed during startup") is opened again: nothing has been said on it yet.
 */
const answered = (endpoint: string, first: Parameters<Socket.Writer["writeAll"]>[0]) =>
  Effect.gen(function* () {
    const remote = yield* Socket.makeWebSocket(`wss://${endpoint}/v2`, { openTimeout: "20 seconds" });
    const reader = yield* remote.reader;
    const writer = yield* remote.writer;
    yield* writer.writeAll(first);
    const reply = yield* reader.pull;
    return { reader, writer, reply };
  }).pipe(Effect.retry({ times: 3, schedule: Schedule.spaced(Duration.millis(500)) }));

/** One connection from workerd, carried to the endpoint over a WebSocket of its own; either side closing ends both. */
const relay = (endpoint: string) => (local: Socket.Socket) =>
  Effect.gen(function* () {
    const reader = yield* local.reader;
    const writer = yield* local.writer;
    const remote = yield* answered(endpoint, yield* reader.pull);
    yield* writer.writeAll(remote.reply);
    return yield* Effect.raceFirst(pump(reader, remote.writer), pump(remote.reader, writer));
  }).pipe(
    Effect.scoped,
    Effect.catchCause((cause) => Effect.logDebug("a database connection ended", cause)),
  );

/** The bridge to `database` (a Postgres connection string), on a free loopback port, for as long as the scope lives. */
export const bridgeTo = (database: Redacted.Redacted): Effect.Effect<DatabaseBridge, RunnerFailure, Scope.Scope> =>
  Effect.gen(function* () {
    const uri = new URL(Redacted.value(database));
    const server = yield* BunSocketServer.make({ port: 0, host: "127.0.0.1" }).pipe(
      Effect.mapError((error) =>
        RunnerFailure.make({ step: "local core", message: `the database bridge did not listen: ${error.message}` }),
      ),
    );
    const webSockets = yield* proxiedWebSockets;
    yield* Effect.forkScoped(
      server.run(relay(uri.hostname)).pipe(
        Effect.provideService(Socket.WebSocketConstructor, webSockets),
        Effect.catchCause((cause) => Effect.logWarning("the database bridge stopped", cause)),
      ),
    );
    const port = portOf(server.address);
    return {
      port,
      database: decodeURIComponent(Str.slice(1)(uri.pathname)),
      user: Redacted.make(decodeURIComponent(uri.username)),
      password: Redacted.make(decodeURIComponent(uri.password)),
    };
  });
