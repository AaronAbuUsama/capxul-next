// OTLP JSON, as Effect's `OtlpSerialization.layerJson` writes it: the bodies of the trace, log and metric export
// requests (`/v1/traces`, `/v1/logs`, `/v1/metrics`). The one place the runner reads OpenTelemetry's wire format: the
// tap (Core's `telemetry.otlp` rows) and the sink both hold these bodies, and everything else reads the flat spans
// `flat.ts` makes of them. Fields OpenTelemetry defines and Effect does not write are left out; unknown keys are
// ignored, so a newer writer still decodes.
import * as Schema from "effect/Schema";

/** A 64-bit number as OTLP JSON writes it: a decimal string, or a number when it fits. */
const Fixed64 = Schema.Union([Schema.String, Schema.Finite]);

/** An attribute's value: one of OpenTelemetry's `AnyValue` kinds. A non-finite double is written as a string. */
export interface AnyValue {
  readonly stringValue?: string | null;
  readonly boolValue?: boolean | null;
  readonly intValue?: string | number | null;
  readonly doubleValue?: string | number | null;
  readonly arrayValue?: { readonly values: ReadonlyArray<AnyValue> };
  readonly kvlistValue?: { readonly values: ReadonlyArray<KeyValue> };
  /** Base64, as OTLP JSON writes bytes. */
  readonly bytesValue?: string;
}

export interface KeyValue {
  readonly key: string;
  readonly value: AnyValue;
}

export const AnyValue: Schema.Codec<AnyValue> = Schema.Struct({
  stringValue: Schema.String.pipe(Schema.NullOr, Schema.optionalKey),
  boolValue: Schema.Boolean.pipe(Schema.NullOr, Schema.optionalKey),
  intValue: Fixed64.pipe(Schema.NullOr, Schema.optionalKey),
  doubleValue: Fixed64.pipe(Schema.NullOr, Schema.optionalKey),
  arrayValue: Schema.optionalKey(Schema.Struct({ values: Schema.Array(Schema.suspend(() => AnyValue)) })),
  kvlistValue: Schema.optionalKey(Schema.Struct({ values: Schema.Array(Schema.suspend(() => KeyValue)) })),
  bytesValue: Schema.optionalKey(Schema.String),
});

export const KeyValue: Schema.Codec<KeyValue> = Schema.Struct({ key: Schema.String, value: AnyValue });

const Attributes = Schema.Array(KeyValue);

/** Who wrote the telemetry: `service.name`, the code's revision, and anything else the producer set. */
export const Resource = Schema.Struct({
  attributes: Attributes,
  droppedAttributesCount: Schema.optionalKey(Schema.Finite),
});

/** The instrumentation scope: Effect writes its own name here. */
export const Scope = Schema.Struct({
  name: Schema.String,
  version: Schema.optionalKey(Schema.String),
  attributes: Schema.optionalKey(Attributes),
});

// ---- Traces -------------------------------------------------------------------------------------------------------

/** How a span ended: 0 unset (Effect's interrupted span), 1 ok, 2 error. */
export const StatusCode = Schema.Literals([0, 1, 2]);

export const SpanEvent = Schema.Struct({
  name: Schema.String,
  timeUnixNano: Fixed64,
  attributes: Attributes,
});

export const SpanLink = Schema.Struct({ traceId: Schema.String, spanId: Schema.String, attributes: Attributes });

export const Span = Schema.Struct({
  traceId: Schema.String,
  spanId: Schema.String,
  /** Absent on a root span. */
  parentSpanId: Schema.optionalKey(Schema.String),
  name: Schema.String,
  /** OpenTelemetry's span kind: 1 internal, 2 server, 3 client, 4 producer, 5 consumer. */
  kind: Schema.Finite,
  startTimeUnixNano: Fixed64,
  endTimeUnixNano: Fixed64,
  attributes: Attributes,
  events: Schema.Array(SpanEvent),
  status: Schema.Struct({ code: StatusCode, message: Schema.optionalKey(Schema.String) }),
  links: SpanLink.pipe(Schema.Array, Schema.optionalKey),
});
export type Span = typeof Span.Type;

export const TraceExport = Schema.Struct({
  resourceSpans: Schema.Array(
    Schema.Struct({
      resource: Resource,
      scopeSpans: Schema.Array(Schema.Struct({ scope: Scope, spans: Schema.Array(Span) })),
    }),
  ),
});
export type TraceExport = typeof TraceExport.Type;

// ---- Logs ---------------------------------------------------------------------------------------------------------

export const LogRecord = Schema.Struct({
  timeUnixNano: Fixed64,
  observedTimeUnixNano: Fixed64,
  severityNumber: Schema.optionalKey(Schema.Finite),
  severityText: Schema.optionalKey(Schema.String),
  body: Schema.optionalKey(AnyValue),
  attributes: Attributes,
  /** Present when the log was written inside a span. */
  traceId: Schema.optionalKey(Schema.String),
  spanId: Schema.optionalKey(Schema.String),
});
export type LogRecord = typeof LogRecord.Type;

export const LogsExport = Schema.Struct({
  resourceLogs: Schema.Array(
    Schema.Struct({
      resource: Schema.optionalKey(Resource),
      scopeLogs: Schema.Array(
        Schema.Struct({
          scope: Schema.optionalKey(Scope),
          logRecords: LogRecord.pipe(Schema.Array, Schema.optionalKey),
        }),
      ),
    }),
  ),
});
export type LogsExport = typeof LogsExport.Type;

// ---- Metrics ------------------------------------------------------------------------------------------------------

const NumberPoint = Schema.Struct({
  attributes: Attributes,
  startTimeUnixNano: Schema.optionalKey(Fixed64),
  timeUnixNano: Schema.optionalKey(Fixed64),
  asDouble: Fixed64.pipe(Schema.NullOr, Schema.optionalKey),
  asInt: Schema.optionalKey(Fixed64),
});

const HistogramPoint = Schema.Struct({
  attributes: Schema.optionalKey(Attributes),
  startTimeUnixNano: Schema.optionalKey(Fixed64),
  timeUnixNano: Schema.optionalKey(Fixed64),
  count: Schema.optionalKey(Fixed64),
  sum: Schema.optionalKey(Fixed64),
  bucketCounts: Fixed64.pipe(Schema.Array, Schema.optionalKey),
  explicitBounds: Fixed64.pipe(Schema.Array, Schema.optionalKey),
  min: Schema.optionalKey(Fixed64),
  max: Schema.optionalKey(Fixed64),
});

const SummaryPoint = Schema.Struct({
  attributes: Schema.optionalKey(Attributes),
  startTimeUnixNano: Schema.optionalKey(Fixed64),
  timeUnixNano: Schema.optionalKey(Fixed64),
  count: Schema.optionalKey(Fixed64),
  sum: Schema.optionalKey(Fixed64),
  quantileValues: Schema.Struct({ quantile: Schema.optionalKey(Fixed64), value: Schema.optionalKey(Fixed64) }).pipe(
    Schema.Array,
    Schema.optionalKey,
  ),
});

/** One metric: exactly one of its kinds is present. */
export const Metric = Schema.Struct({
  name: Schema.String,
  description: Schema.optionalKey(Schema.String),
  unit: Schema.optionalKey(Schema.String),
  gauge: Schema.optionalKey(Schema.Struct({ dataPoints: Schema.Array(NumberPoint) })),
  sum: Schema.optionalKey(
    Schema.Struct({
      dataPoints: Schema.Array(NumberPoint),
      aggregationTemporality: Schema.Finite,
      isMonotonic: Schema.Boolean,
    }),
  ),
  histogram: Schema.optionalKey(
    Schema.Struct({
      dataPoints: Schema.Array(HistogramPoint),
      aggregationTemporality: Schema.optionalKey(Schema.Finite),
    }),
  ),
  summary: Schema.optionalKey(Schema.Struct({ dataPoints: Schema.Array(SummaryPoint) })),
});
export type Metric = typeof Metric.Type;

export const MetricsExport = Schema.Struct({
  resourceMetrics: Schema.Array(
    Schema.Struct({
      resource: Resource,
      scopeMetrics: Schema.Array(Schema.Struct({ scope: Scope, metrics: Schema.Array(Metric) })),
    }),
  ),
});
export type MetricsExport = typeof MetricsExport.Type;

// ---- From the text on the wire ------------------------------------------------------------------------------------

/** A `/v1/traces` body, from its JSON text. */
export const decodeTraces = Schema.decodeUnknownEffect(Schema.fromJsonString(TraceExport));
/** A `/v1/logs` body, from its JSON text. */
export const decodeLogs = Schema.decodeUnknownEffect(Schema.fromJsonString(LogsExport));
/** A `/v1/metrics` body, from its JSON text. */
export const decodeMetrics = Schema.decodeUnknownEffect(Schema.fromJsonString(MetricsExport));
