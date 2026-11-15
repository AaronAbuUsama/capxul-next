// The collector (roadmap 4.4; `docs/design/blueprint.md`, part 12): one Worker on the platform's `staging` stage that
// takes OTLP/HTTP JSON at `/v1/traces`, `/v1/logs` and `/v1/metrics`, as Effect's `OtlpProxy` does, and forwards each
// body to the sink with the sink's headers. Two things are its own:
//
// - it stamps the world, the grade and the stage on every resource of the body from who called it, overwriting what
//   the body says, so a test world cannot write into a real world's view;
// - a caller through a service binding is who the binding says; a public caller is who its platform token
//   (`authorization: Bearer <token>`) names, and a public call without a valid one is refused with 401 and forwards
//   nothing. The caller's own headers never reach the sink.
//
// STUB. "🔨 the collector on staging, and the test sink" (PR #317, item 3) replaces `makeCollector`'s body; until then
// every handler answers 501 and forwards nothing, so test/collector.test.ts fails.
import * as Effect from "effect/Effect";
import type * as Option from "effect/Option";
import type * as Redacted from "effect/Redacted";
import type * as Headers from "effect/http/Headers";
import type * as HttpClient from "effect/http/HttpClient";
import type * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import type * as OtlpProxy from "effect/observability/OtlpProxy";

export type Signal = OtlpProxy.Signal;

/** Who sent the telemetry: what the collector stamps on it. */
export interface Identity {
  readonly world: string;
  readonly grade: string;
  readonly stage: string;
}

/** How the call reached the collector: through a world's service binding, or its public route. */
export type Caller = { readonly _tag: "Bound"; readonly identity: Identity } | { readonly _tag: "Public" };

export interface CollectorOptions {
  /** The sink's OTLP base URL: each signal is forwarded to `/v1/<signal>` below it. */
  readonly sinkUrl: string;
  /** The headers sent with each signal's forward: the sink's key and the signal's dataset. Applied last. */
  readonly headers: { readonly [S in Signal]: Headers.Input };
  /** The resource attribute keys stamped with the caller's world, grade and stage (the blueprint's envelope, #301). */
  readonly keys: { readonly [K in keyof Identity]: string };
  /** Whom a public caller's platform token names: none when it is not a valid platform token. */
  readonly verify: (token: Redacted.Redacted) => Effect.Effect<Option.Option<Identity>>;
}

/** One handler per signal, each answering the request it serves for the given caller. */
export type Collector = {
  readonly [S in Signal]: (
    caller: Caller,
  ) => Effect.Effect<HttpServerResponse.HttpServerResponse, never, HttpServerRequest.HttpServerRequest>;
};

const unbuilt = () => Effect.succeed(HttpServerResponse.empty({ status: 501 }));

/** The collector's handlers, forwarding through the given `HttpClient`. */
export const makeCollector = (_options: CollectorOptions): Effect.Effect<Collector, never, HttpClient.HttpClient> =>
  Effect.succeed({ traces: unbuilt, logs: unbuilt, metrics: unbuilt });
