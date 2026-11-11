// What the running product says about itself besides its events: log rows and metrics. Each names what writes it,
// so a silent part of the product is a gap, and each derives the evals that prove it is written as recorded.

import { Schema } from "effect";
import { AnySchema, Common, Line, make, Producer, Ref } from "./base.ts";

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

// ── what is asked of them, and who is told ───────────────────────────────────────────────────

export const InsightSpec = Schema.Struct({
  ...Common,
  /** The events, log rows and metrics it queries. A query that names one it does not list is a problem. */
  reads: Schema.Array(Schema.Union([Ref("event"), Ref("log"), Ref("metric")])).pipe(Schema.check(Schema.isMinLength(1))),
  /** The query, with `<env>` for the environment; for a funnel, the journey whose steps it follows. */
  query: Schema.Union([Schema.String, Schema.Struct({ funnel: Ref("journey") })]),
  display: Schema.Literals(["number", "line", "table", "funnel"]),
  env: Schema.Array(Schema.String).pipe(Schema.check(Schema.isMinLength(1))),
  /** On the thin-line world, the value it must return (`1 payment settled`). */
  answer: Schema.optionalKey(Line),
});
/** A question asked of the telemetry. */
export const defineInsight = make("insight")(InsightSpec);

export const AlertSpec = Schema.Struct({
  ...Common,
  insight: Ref("insight"),
  /** The bound and its window: `5 starts and a failure rate of 20% or more, over 15 minutes`. */
  condition: Line,
  /** How often it is evaluated: `5m`, `1h`. */
  cadence: Schema.String,
  severity: Schema.Literals(["page", "notify", "log"]),
  /** Who is told: Aaron, Capxul's operator, or the company's Director. */
  route: Schema.Array(Schema.Literals(["aaron", "operator", "director"])).pipe(Schema.check(Schema.isMinLength(1))),
  /** What to do: the operation that repairs it, or the steps in words. */
  runbook: Schema.Union([Ref("operation"), Line]),
  /** When it must not fire: a world being restored, the sandbox. */
  silence: Schema.optionalKey(Schema.Array(Line)),
});
export const defineAlert = make("alert")(AlertSpec);

export const DashboardSpec = Schema.Struct({
  ...Common,
  audience: Schema.Literals(["aaron", "operator", "company"]),
  where: Schema.Literals(["posthog", "frappe-workspace", "portal"]),
  /** Its tiles, in order. */
  tiles: Schema.Array(Schema.Union([Ref("insight"), Ref("journey")])).pipe(Schema.check(Schema.isMinLength(1))),
});
export const defineDashboard = make("dashboard")(DashboardSpec);
