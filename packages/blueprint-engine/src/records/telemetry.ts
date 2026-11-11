// What the running product says about itself besides its events: log rows and metrics. Each names what writes it,
// so a silent part of the product is a gap, and each derives the evals that prove it is written as recorded.

import { Schema } from "effect";
import { AnySchema, Common, make, Producer, Ref } from "./base.ts";

export const LogSpec = Schema.Struct({
  ...Common,
  /** The component that writes it: the Core service, a site, the CLI, the indexer. */
  component: Ref("component"),
  level: Schema.Literals(["info", "warn", "error"]),
  /** One row per call of every record of this kind (`rpc`: every rpc writes one), or `once` for a single writer. */
  per: Schema.Literals(["rpc", "flow", "workflow", "procedure", "call", "once"]),
  /** With `once`: what writes it. */
  producer: Schema.optionalKey(Producer),
  /** The row's attributes beyond the system's envelope, as an Effect Schema Struct. */
  attributes: AnySchema,
  /** The attributes that are masked before the row leaves the component. */
  redact: Schema.optionalKey(Schema.Array(Schema.String)),
});
/** A log row: `operation_row`, the wide row every rpc writes. */
export const defineLog = make("log")(LogSpec);
export type LogRecord = ReturnType<typeof defineLog>;

export const MetricSpec = Schema.Struct({
  ...Common,
  component: Ref("component"),
  instrument: Schema.Literals(["counter", "gauge", "histogram"]),
  /** `ms`, `bytes`, `{payment}`: UCUM, as OpenTelemetry writes it. */
  unit: Schema.String,
  attributes: AnySchema,
  producer: Producer,
});
/** A counter, gauge or histogram. Host gauges (CPU, memory) belong to an environment, not here. */
export const defineMetric = make("metric")(MetricSpec);
export type MetricRecord = ReturnType<typeof defineMetric>;
