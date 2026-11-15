// A decoded OTLP trace (otlp.ts) as flat spans: the shape the runner's checks read, in place of `app.spans`' columns
// (world/database.ts). One flat span per OTLP span, its attributes and its events' attributes as plain values.
import * as Arr from "effect/Array";
import { pipe } from "effect/Function";
import * as Option from "effect/Option";
import * as Rec from "effect/Record";
import type { AnyValue, KeyValue, Span, TraceExport } from "./otlp.ts";

/** How a span ended, by its OTLP status: Effect writes `unset` for an interrupted span, `error` for a failure or defect. */
export type FlatStatus = "unset" | "ok" | "error";

const STATUS: Readonly<Record<Span["status"]["code"], FlatStatus>> = { 0: "unset", 1: "ok", 2: "error" };

/** The resource attribute OpenTelemetry names the producer by. */
export const SERVICE_NAME = "service.name";

export interface FlatEvent {
  readonly name: string;
  /** When it happened, in epoch milliseconds. */
  readonly atMs: number;
  readonly attributes: Readonly<Record<string, unknown>>;
}

export interface FlatSpan {
  readonly name: string;
  readonly traceId: string;
  readonly spanId: string;
  /** Null on a root span. */
  readonly parentSpanId: string | null;
  readonly status: FlatStatus;
  /** The status message Effect writes on an error: the first error's message. Null otherwise. */
  readonly statusMessage: string | null;
  readonly durationMs: number;
  /** When it ended, in epoch milliseconds. */
  readonly endedMs: number;
  readonly attributes: Readonly<Record<string, unknown>>;
  readonly events: ReadonlyArray<FlatEvent>;
  /** The `service.name` of the resource that exported it, or null when it has none. */
  readonly service: string | null;
}

const nanos = (value: string | number): bigint => BigInt(value);
const millis = (value: bigint): number => Number(value) / 1_000_000;

/** A finite number from a 64-bit or double field, as OTLP JSON writes it ("NaN" and friends included). */
const numberOf = (value: string | number): number => Number(value);

/** An attribute's value as a plain value: a string, number, boolean, array, record, base64 string, or null. */
export const valueOf = (value: AnyValue): unknown => {
  if (value.stringValue !== undefined) return value.stringValue;
  if (value.boolValue !== undefined) return value.boolValue;
  if (value.intValue !== undefined) return value.intValue === null ? null : numberOf(value.intValue);
  if (value.doubleValue !== undefined) return value.doubleValue === null ? null : numberOf(value.doubleValue);
  if (value.arrayValue !== undefined) return Arr.map(value.arrayValue.values, valueOf);
  if (value.kvlistValue !== undefined) return attributesOf(value.kvlistValue.values);
  if (value.bytesValue !== undefined) return value.bytesValue;
  return null;
};

/** Key-value attributes as a record. A repeated key keeps its last value. */
export const attributesOf = (attributes: ReadonlyArray<KeyValue>): Readonly<Record<string, unknown>> =>
  Rec.fromEntries(Arr.map(attributes, (each) => [each.key, valueOf(each.value)] as const));

const flatSpan = (service: string | null, span: Span): FlatSpan => {
  const end = nanos(span.endTimeUnixNano);
  return {
    name: span.name,
    traceId: span.traceId,
    spanId: span.spanId,
    parentSpanId: span.parentSpanId ?? null,
    status: STATUS[span.status.code],
    statusMessage: span.status.code === 2 ? (span.status.message ?? null) : null,
    durationMs: millis(end - nanos(span.startTimeUnixNano)),
    endedMs: millis(end),
    attributes: attributesOf(span.attributes),
    events: Arr.map(span.events, (event) => ({
      name: event.name,
      atMs: millis(nanos(event.timeUnixNano)),
      attributes: attributesOf(event.attributes),
    })),
    service,
  };
};

/** The `service.name` among a resource's attributes. */
const serviceOf = (attributes: ReadonlyArray<KeyValue>): string | null =>
  pipe(
    Arr.findFirst(attributes, (each) => each.key === SERVICE_NAME),
    Option.flatMap((each) => Option.fromNullishOr(each.value.stringValue)),
    Option.getOrNull,
  );

/** Every span of a trace export, flat, in the order the export holds them. */
export const flatSpans = (trace: TraceExport): ReadonlyArray<FlatSpan> =>
  Arr.flatMap(trace.resourceSpans, (resourceSpans) =>
    Arr.flatMap(resourceSpans.scopeSpans, (scopeSpans) =>
      Arr.map(scopeSpans.spans, (span) => flatSpan(serviceOf(resourceSpans.resource.attributes), span)),
    ),
  );
