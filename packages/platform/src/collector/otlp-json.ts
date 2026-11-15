// The OTLP JSON body as the collector reads and rewrites it: OTLP/HTTP's JSON encoding of an export request
// (`resourceSpans`, `resourceLogs` or `resourceMetrics`, each with its resource's attributes). The collector decodes
// it only to stamp every resource and to count what it carries; every other field is kept as it came. Protobuf bodies
// are refused (415): the collector would have to stamp them too, and every producer of ours sends JSON
// (`OtlpSerialization.layerJson`).
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import { pipe } from "effect/Function";
import * as Num from "effect/Number";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";

/** An OTLP signal, as OtlpProxy names its routes. */
export type Signal = "traces" | "logs" | "metrics";
export const SIGNALS: ReadonlyArray<Signal> = ["traces", "logs", "metrics"];

/** The top-level field of each signal's export request, and the field of its scopes and of their items. */
const SHAPE = {
  traces: { resources: "resourceSpans", scopes: "scopeSpans", items: "spans" },
  logs: { resources: "resourceLogs", scopes: "scopeLogs", items: "logRecords" },
  metrics: { resources: "resourceMetrics", scopes: "scopeMetrics", items: "metrics" },
} as const;

/** A metric's data points sit under its one kind. */
const METRIC_KINDS = ["gauge", "sum", "histogram", "exponentialHistogram", "summary"] as const;

type Json = Record<string, unknown>;
const isJson = (u: unknown): u is Json => Predicate.isObject(u) && !Arr.isArray(u);
const arrayAt = (o: unknown, key: string): ReadonlyArray<unknown> => (isJson(o) && Arr.isArray(o[key]) ? o[key] : []);

/** One OTLP attribute: a key and a string value, as the collector writes them. */
export interface StringAttribute {
  readonly key: string;
  readonly value: { readonly stringValue: string };
}
export const stringAttribute = (key: string, value: string): StringAttribute => ({
  key,
  value: { stringValue: value },
});

const decodeBody = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown));

/** The body's export request; none when it is not JSON or its resource list is not a list. */
export const decodeExport = (signal: Signal, text: string): Effect.Effect<Option.Option<Json>> =>
  decodeBody(text).pipe(
    Effect.option,
    Effect.map(
      Option.filter(
        (body): body is Json =>
          isJson(body) && (body[SHAPE[signal].resources] === undefined || Arr.isArray(body[SHAPE[signal].resources])),
      ),
    ),
  );

/** The body as JSON text again. */
export const encodeExport = (body: Json): string => JSON.stringify(body);

/**
 * The export request with every resource's attributes under `owned` dropped and `stamp` added in their place. A
 * resource list entry with no resource gets one. Nothing else changes.
 */
export const stampExport = (
  signal: Signal,
  body: Json,
  owned: ReadonlyArray<string>,
  stamp: ReadonlyArray<StringAttribute>,
): Json => {
  const key = SHAPE[signal].resources;
  const resources = arrayAt(body, key);
  return {
    ...body,
    [key]: Arr.map(resources, (entry) => {
      const kept = isJson(entry) ? entry : {};
      const resource = isJson(kept.resource) ? kept.resource : {};
      const attributes = Arr.filter(
        arrayAt(resource, "attributes"),
        (a) => !(isJson(a) && Predicate.isString(a.key) && owned.includes(a.key)),
      );
      return { ...kept, resource: { ...resource, attributes: [...attributes, ...stamp] } };
    }),
  };
};

/** Every resource's attributes, as the collector sees them: for tests and for the rehearsal's record. */
export const resourceAttributes = (signal: Signal, body: Json): ReadonlyArray<ReadonlyArray<unknown>> =>
  Arr.map(arrayAt(body, SHAPE[signal].resources), (entry) =>
    arrayAt(isJson(entry) ? entry.resource : undefined, "attributes"),
  );

const metricSamples = (metric: unknown): number =>
  pipe(
    METRIC_KINDS,
    Arr.map((kind) => arrayAt(isJson(metric) ? metric[kind] : undefined, "dataPoints").length),
    Num.sumAll,
  );

/** How many items the request carries: spans, log records, or metric data points. */
export const countItems = (signal: Signal, body: Json): number => {
  const shape = SHAPE[signal];
  const items = Arr.flatMap(arrayAt(body, shape.resources), (resource) =>
    Arr.flatMap(arrayAt(resource, shape.scopes), (scope) => arrayAt(scope, shape.items)),
  );
  return signal === "metrics" ? pipe(Arr.map(items, metricSamples), Num.sumAll) : items.length;
};

/** OTLP's partial success: how many items the sink rejected in an answer it accepted, from its JSON body. */
export const rejectedOf = (signal: Signal, text: string) =>
  decodeBody(text).pipe(
    Effect.map((answer) => {
      const partial = isJson(answer) ? answer.partialSuccess : undefined;
      const field =
        signal === "traces" ? "rejectedSpans" : signal === "logs" ? "rejectedLogRecords" : "rejectedDataPoints";
      const n = isJson(partial) ? Number(partial[field] ?? 0) : 0;
      return Number.isFinite(n) && n > 0 ? n : 0;
    }),
    Effect.orElseSucceed(() => 0),
  );
