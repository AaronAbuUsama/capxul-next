// One request to the collector, once its caller is known: stamp every resource with who sent it, forward it to the
// sink with Effect's OtlpProxy (which adds the sink's key and dataset, and returns the sink's answer), and say what
// became of its items. The Worker (worker.ts) finds the caller and sends the counts; this file knows neither
// Cloudflare nor where the counts go, so the tests drive it with a stand-in sink.
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Str from "effect/String";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import * as OtlpProxy from "effect/observability/OtlpProxy";
import type { CollectorClaims } from "./claims.ts";
import { notSent, type Outcome, outcomeOf } from "./counts.ts";
import { STAMPED } from "./envelope.ts";
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

/** Where the collector forwards to: Axiom's OTLP endpoints at its edge, one dataset per signal. */
export interface Sink {
  /** The edge's base URL; OtlpProxy appends `/v1/<signal>`. */
  readonly url: string;
  /** The ingest key; none when the deploy had none (a rehearsal), and then the sink refuses what is sent. */
  readonly key: Option.Option<Redacted.Redacted>;
  readonly datasets: Record<Signal, string>;
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

/** The headers the collector sends the sink for a signal: its dataset, and its key when it has one. */
export const sinkHeaders = (sink: Sink, signal: Signal): Record<string, string> => ({
  [DATASET_HEADER]: sink.datasets[signal],
  ...Option.match(sink.key, {
    onNone: () => ({}),
    onSome: (key) => ({ authorization: `Bearer ${Redacted.value(key)}` }),
  }),
});

/** What the collector stamps on every resource of a caller's request: the claim's world, grade and operator, and the stage. */
export const stampOf = (stage: string, claims: CollectorClaims): ReadonlyArray<StringAttribute> => [
  ...Option.toArray(Option.map(claims.world, (world) => stringAttribute(STAMPED.world, world))),
  ...Option.toArray(Option.map(claims.grade, (grade) => stringAttribute(STAMPED.grade, grade))),
  stringAttribute(STAMPED.stage, stage),
  stringAttribute(STAMPED.operator, claims.operator),
];

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
 * Stamps and forwards the request being served, as `signal`, for a caller whose claim the Worker has verified.
 * A body that is not OTLP JSON is refused (415 for another content type, 400 for one that does not decode) and
 * not counted: nothing of it can be known.
 */
export const forward = Effect.fn("platform.collector.forward")(function* (
  sink: Sink,
  stage: string,
  signal: Signal,
  claims: CollectorClaims,
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
  const stamped = encodeExport(stampExport(signal, decoded.value, stampOf(stage, claims)));
  const handlers = yield* OtlpProxy.make({ baseUrl: sink.url, headers: sinkHeaders(sink, signal) });
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
