// A test endpoint for OTLP export: an in-memory `HttpClient` that keeps every request it is sent and answers 200, and
// a run of an effect under Effect's own OTLP JSON exporter, so a test holds exactly the bodies Effect writes.
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Str from "effect/String";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import * as Otlp from "effect/observability/Otlp";

export interface Posted {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

/** The endpoint's base URL. */
export const ENDPOINT = "https://otlp.test";

/** A client that keeps what it is sent in `posted`. */
export const capturing = () => {
  const posted: Array<Posted> = [];
  const client = HttpClient.make((request) =>
    Effect.sync(() => {
      posted.push({
        url: request.url,
        headers: request.headers,
        body: request.body._tag === "Uint8Array" ? new TextDecoder().decode(request.body.body) : "",
      });
      return HttpClientResponse.fromWeb(request, new Response(null, { status: 200 }));
    }),
  );
  return { posted, layer: Layer.succeed(HttpClient.HttpClient, client) };
};

/** The bodies posted to one signal's path (`/v1/traces`, `/v1/logs`, `/v1/metrics`). */
export const bodiesTo = (posted: ReadonlyArray<Posted>, path: string): ReadonlyArray<string> =>
  Arr.map(
    Arr.filter(posted, (each) => Str.endsWith(path)(each.url)),
    (each) => each.body,
  );

/** The resource the fixtures are exported with. */
export const FIXTURE = { serviceName: "fixture", serviceVersion: "0123abc" } as const;

/** Runs `effect` under `Otlp.layerJson`, flushed when it ends, and returns every request the exporter sent. */
export const exported = <A, E>(effect: Effect.Effect<A, E>) => {
  const { posted, layer } = capturing();
  return Effect.exit(effect).pipe(
    // oxlint-disable-next-line effecttsgo/strict-effect-provide -- the effect under test is its own program, exported by its own layer
    Effect.provide(Otlp.layerJson({ baseUrl: ENDPOINT, resource: FIXTURE }).pipe(Layer.provide(layer))),
    Effect.as(posted),
  );
};
