// A local Core's way to its world's chain and bundler. On Cloudflare, Core reaches them over a service binding to the
// world's door (`CHAIN`), at `https://chain/<door token>/rpc` and `/bundler`. workerd cannot reach the door itself:
// this machine resolves no name and has no route out but the session's HTTPS proxy. So every local Core's `CHAIN`
// is one HTTP server on this machine's loopback, which carries each request to the door of the world whose token
// starts its path, through the proxy, and hands back the door's answer as it is.
import * as Arr from "effect/Array";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Ref from "effect/Ref";
import * as Schedule from "effect/Schedule";
import type * as Scope from "effect/Scope";
import * as Str from "effect/String";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import * as BunHttpServer from "@effect/platform-bun/BunHttpServer";
import { RunnerFailure } from "../failure.ts";
import { portOf } from "./database.ts";

export interface ChainForwarder {
  /** The loopback port workerd's `CHAIN` service is bound to. */
  readonly port: number;
  /** Carries requests under `token` to `door` (the world's door with its token, a secret) from now on. */
  readonly add: (token: Redacted.Redacted, door: Redacted.Redacted) => Effect.Effect<void>;
  readonly remove: (token: Redacted.Redacted) => Effect.Effect<void>;
}

/** The forwarder, on a free loopback port, for as long as the scope lives. */
export const chainForwarder: Effect.Effect<ChainForwarder, RunnerFailure, Scope.Scope | HttpClient.HttpClient> =
  Effect.gen(function* () {
    const doors = yield* Ref.make(new Map<string, Redacted.Redacted>());
    const http = yield* HttpClient.HttpClient;
    const server = yield* BunHttpServer.make({ port: 0, hostname: "127.0.0.1" });
    const answer = Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const [token = "", ...rest] = Arr.filter(Str.split(request.url, "/"), Str.isNonEmpty);
      const door = Option.fromUndefinedOr((yield* Ref.get(doors)).get(token));
      if (Option.isNone(door)) return HttpServerResponse.jsonUnsafe({ error: "no such world here" }, { status: 404 });
      const body = new Uint8Array(yield* request.arrayBuffer);
      const sent = HttpClientRequest.make(request.method === "GET" ? "GET" : "POST")(
        `${Redacted.value(door.value)}/${Arr.join(rest, "/")}`,
      ).pipe(HttpClientRequest.bodyUint8Array(body, request.headers["content-type"] ?? "application/json"));
      // A connection through the session's proxy is now and then reset before it carries the request (seen once in
      // a rehearsal: ECONNRESET on the door's /rpc); it is sent again on a fresh connection. An answer, any status,
      // is never sent again.
      const response = yield* http.execute(sent).pipe(
        Effect.retry({ times: 2, schedule: Schedule.spaced(Duration.millis(250)) }),
      );
      return HttpServerResponse.fromClientResponse(response);
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.as(
          Effect.logWarning("the chain forwarder could not carry a request", cause),
          HttpServerResponse.jsonUnsafe({ error: "the door did not answer" }, { status: 502 }),
        ),
      ),
    );
    yield* server.serve(answer);
    const port = portOf(server.address);
    return {
      port,
      add: (token, door) => Ref.update(doors, (all) => new Map([...all, [Redacted.value(token), door]])),
      remove: (token) =>
        Ref.update(doors, (all) => new Map(Arr.filter([...all], ([held]) => held !== Redacted.value(token)))),
    } satisfies ChainForwarder;
  }).pipe(
    Effect.mapError((error) =>
      RunnerFailure.make({ step: "local core", message: `the chain forwarder did not listen: ${error.message}` }),
    ),
  );
