// One request to the collector, once its caller is known: stamp every resource with who sent it, forward it to the
// sink with Effect's OtlpProxy (which adds the sink's headers last, sends nothing of the caller's but the body and its
// content type, and returns the sink's answer), and say what became of its items. src/collector.ts calls it for each
// caller; this file knows neither Cloudflare nor where the counts go.
import { Envelope } from "@capxul/blueprint";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Rec from "effect/Record";
import * as Redacted from "effect/Redacted";
import * as Str from "effect/String";
import type * as Headers from "effect/http/Headers";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import * as OtlpProxy from "effect/observability/OtlpProxy";
import { notSent, type Outcome, outcomeOf } from "./counts.ts";
import {
  countItems,
  decodeExport,
  encodeExport,
  rejectedOf,
  type Signal,
  stampExport,
  stringAttribute,
  type StringAttribute,
} from "./otlp-json.ts";

/** The keys the collector owns on every resource, the envelope's: a caller's value under any of them is dropped. */
export const STAMPED = {
  world: Envelope.attributes.world.name,
  stage: Envelope.attributes.stage.name,
  grade: Envelope.attributes.grade.name,
} as const;

/** Who sent the telemetry: what the collector stamps on it. An empty value is dropped and not stamped. */
export interface Identity {
  readonly world: string;
  readonly grade: string;
  readonly stage: string;
}

/** Where and how a request is forwarded, and under which keys its sender is stamped. */
export interface Forwarding {
  readonly sinkUrl: string;
  readonly headers: { readonly [S in Signal]: Headers.Input };
  readonly keys: { readonly [K in keyof Identity]: string };
}

/** Axiom's edge in Frankfurt, where the test datasets are. */
export const AXIOM_EDGE = "https://eu-central-1.aws.edge.axiom.co";
/** The header that names an Axiom dataset. */
export const DATASET_HEADER = "x-axiom-dataset";

/** The test sink's datasets, by signal. */
export const datasetsOf = (prefix: string): Record<Signal, string> => ({
  traces: `${prefix}-traces`,
  logs: `${prefix}-logs`,
  metrics: `${prefix}-metrics`,
});

/** The headers sent to the sink for each signal: its dataset, and the ingest key when there is one. */
export const sinkHeadersOf = (
  datasets: Record<Signal, string>,
  key: Option.Option<Redacted.Redacted>,
): { readonly [S in Signal]: Record<string, string> } => {
  const auth = Option.match(key, {
    onNone: () => ({}),
    onSome: (k): Record<string, string> => ({ authorization: `Bearer ${Redacted.value(k)}` }),
  });
  return {
    traces: { [DATASET_HEADER]: datasets.traces, ...auth },
    logs: { [DATASET_HEADER]: datasets.logs, ...auth },
    metrics: { [DATASET_HEADER]: datasets.metrics, ...auth },
  };
};

/** The attributes stamped for an identity, under the given keys; empty values are left out. */
export const stampOf = (keys: Forwarding["keys"], identity: Identity): ReadonlyArray<StringAttribute> =>
  Arr.flatMap(["world", "grade", "stage"] as const, (field) =>
    Str.isNonEmpty(identity[field]) ? [stringAttribute(keys[field], identity[field])] : [],
  );

const JSON_TYPE = "application/json";
const isJson = (contentType: string | undefined) =>
  contentType !== undefined && Str.toLowerCase(Str.trim(Str.split(";")(contentType)[0])) === JSON_TYPE;

const refuse = (status: number, error: string) => HttpServerResponse.jsonUnsafe({ error }, { status });

const bodyText = (response: HttpServerResponse.HttpServerResponse): string =>
  response.body._tag === "Uint8Array" ? new TextDecoder().decode(response.body.body) : "";

/** What one request came to: the answer to give the caller, and the outcome of its items (none when not counted). */
export interface Forwarded {
  readonly response: HttpServerResponse.HttpServerResponse;
  readonly outcome: Option.Option<Outcome>;
}

/**
 * Stamps and forwards the request being served, as `signal`, for `identity`. A body that is not OTLP JSON is
 * refused (415 for another content type, 400 for one that does not decode) and not counted: nothing of it is known.
 */
export const forward = Effect.fn("platform.collector.forward")(function* (
  options: Forwarding,
  signal: Signal,
  identity: Identity,
) {
  const request = yield* HttpServerRequest.HttpServerRequest;
  if (!isJson(request.headers["content-type"])) {
    return { response: refuse(415, "otlp-json-only"), outcome: Option.none() } satisfies Forwarded;
  }
  const decoded = yield* decodeExport(signal, yield* Effect.orElseSucceed(request.text, () => ""));
  if (Option.isNone(decoded)) {
    return { response: refuse(400, "not-otlp-json"), outcome: Option.none() } satisfies Forwarded;
  }
  const items = countItems(signal, decoded.value);
  const owned = Rec.values(options.keys);
  const stamped = encodeExport(stampExport(signal, decoded.value, owned, stampOf(options.keys, identity)));
  const handlers = yield* OtlpProxy.make({ baseUrl: options.sinkUrl, headers: options.headers[signal] });
  const outbound = HttpServerRequest.fromWeb(
    new Request(`http://collector/v1/${signal}`, {
      method: "POST",
      headers: { "content-type": JSON_TYPE },
      body: stamped,
    }),
  );
  const response = yield* handlers[signal].pipe(Effect.provideService(HttpServerRequest.HttpServerRequest, outbound));
  // OtlpProxy answers 502 when the sink could not be reached and 504 when it did not answer in time.
  const outcome =
    response.status === 502 || response.status === 504
      ? notSent(signal, items, `${response.status}`)
      : outcomeOf(signal, items, response.status, yield* rejectedOf(signal, bodyText(response)));
  return { response, outcome: Option.some(outcome) } satisfies Forwarded;
});
