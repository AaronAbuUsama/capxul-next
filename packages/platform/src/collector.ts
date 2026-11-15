// The collector (roadmap 4.4; `docs/design/blueprint.md`, part 12): one Worker per platform stage (src/collector/
// worker.ts) that takes OTLP/HTTP JSON at `/v1/traces`, `/v1/logs` and `/v1/metrics`, as Effect's `OtlpProxy` does,
// and forwards each body to the sink with the sink's headers. Two things are its own:
//
// - it stamps the world, the grade and the stage on every resource of the body from who called it, overwriting what
//   the body says, so a test world cannot write into a real world's view;
// - a caller through a service binding is who the binding says; a public caller is who its token
//   (`authorization: Bearer <token>`) names, and a public call without a valid one is refused with 401 and forwards
//   nothing. The caller's own headers never reach the sink.
//
// The interface is the ✍️ author's (#325); the work is in src/collector/ (forward.ts stamps and forwards).
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Str from "effect/String";
import type * as Headers from "effect/http/Headers";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import type * as OtlpProxy from "effect/observability/OtlpProxy";
import type { Outcome } from "./collector/counts.ts";
import { forward, type Identity } from "./collector/forward.ts";

export type Signal = OtlpProxy.Signal;
export type { Identity } from "./collector/forward.ts";

/** How the call reached the collector: through a world's service binding, or its public route. */
export type Caller = { readonly _tag: "Bound"; readonly identity: Identity } | { readonly _tag: "Public" };

export interface CollectorOptions {
  /** The sink's OTLP base URL: each signal is forwarded to `/v1/<signal>` below it. */
  readonly sinkUrl: string;
  /** The headers sent with each signal's forward: the sink's key and the signal's dataset. Applied last. */
  readonly headers: { readonly [S in Signal]: Headers.Input };
  /** The resource attribute keys stamped with the caller's world, grade and stage: the envelope's (#301). */
  readonly keys: { readonly [K in keyof Identity]: string };
  /** Whom a public caller's token names: none when it is not a valid token. */
  readonly verify: (token: Redacted.Redacted) => Effect.Effect<Option.Option<Identity>>;
  /** Told what became of each forwarded request's items, for the collector's counts (src/collector/counts.ts). */
  readonly onOutcome?: (outcome: Outcome, identity: Identity) => Effect.Effect<void>;
}

/** One handler per signal, each answering the request it serves for the given caller. */
export type Collector = {
  readonly [S in Signal]: (
    caller: Caller,
  ) => Effect.Effect<HttpServerResponse.HttpServerResponse, never, HttpServerRequest.HttpServerRequest>;
};

const unauthorized = HttpServerResponse.jsonUnsafe({ error: "token-required" }, { status: 401 });

const bearerOf = (authorization: string | undefined): Option.Option<Redacted.Redacted> =>
  authorization !== undefined && Str.startsWith("Bearer ")(authorization)
    ? Option.some(Redacted.make(Str.trim(Str.slice(7)(authorization))))
    : Option.none();

/** The collector's handlers, forwarding through the given `HttpClient`. */
export const makeCollector = (options: CollectorOptions): Effect.Effect<Collector, never, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient;
    const handler = (signal: Signal) => (caller: Caller) =>
      Effect.gen(function* () {
        const identity =
          caller._tag === "Bound"
            ? Option.some(caller.identity)
            : yield* Option.match(bearerOf((yield* HttpServerRequest.HttpServerRequest).headers.authorization), {
                onNone: () => Effect.succeed(Option.none<Identity>()),
                onSome: options.verify,
              });
        if (Option.isNone(identity)) return unauthorized;
        const done = yield* forward(options, signal, identity.value);
        if (Option.isSome(done.outcome) && options.onOutcome !== undefined) {
          yield* options.onOutcome(done.outcome.value, identity.value);
        }
        return done.response;
      }).pipe(Effect.provideService(HttpClient.HttpClient, client));
    return { traces: handler("traces"), logs: handler("logs"), metrics: handler("metrics") };
  });
