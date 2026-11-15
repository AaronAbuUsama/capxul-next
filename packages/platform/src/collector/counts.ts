// The collector's own counts: for every request it forwarded, how many items (spans, log records, metric data points)
// the sink kept and how many it refused, sent to the sink's metrics dataset as OTLP metrics of the collector's own,
// and logged (Workers Logs, exported to Cloudflare's destination). Named by OpenTelemetry's own conventions for an
// exporter's counts (`otel.sdk.exporter.<item>.exported`, with `error.type` on what failed), so no name is ours.
import * as Arr from "effect/Array";
import * as Option from "effect/Option";
import { type Signal, stringAttribute, type StringAttribute } from "./otlp-json.ts";

/** What became of one request's items. */
export interface Outcome {
  readonly signal: Signal;
  /** Items the request carried. */
  readonly items: number;
  /** Items the sink kept. */
  readonly forwarded: number;
  /** Items the sink refused, or that never reached it. */
  readonly refused: number;
  /** Why they were refused: the sink's HTTP status, `partial` (OTLP's partial success), or the collector's reason. */
  readonly reason: Option.Option<string>;
}

/** OpenTelemetry's metric for each signal's exported items, and its unit. */
export const COUNT_METRICS: Record<Signal, { readonly name: string; readonly unit: string }> = {
  traces: { name: "otel.sdk.exporter.span.exported", unit: "{span}" },
  logs: { name: "otel.sdk.exporter.log.exported", unit: "{log_record}" },
  metrics: { name: "otel.sdk.exporter.metric_data_point.exported", unit: "{data_point}" },
};

const ERROR_TYPE = "error.type";
const COMPONENT = "otel.component.name";
const SERVICE = "service.name";
const DELTA = 1;

/** The outcome of an answer from the sink: all kept, some refused in a partial success, or all refused. */
export const outcomeOf = (signal: Signal, items: number, status: number, rejected: number): Outcome => {
  if (status < 200 || status > 299) {
    return { signal, items, forwarded: 0, refused: items, reason: Option.some(`${status}`) };
  }
  const refused = Math.min(rejected, items);
  return {
    signal,
    items,
    forwarded: items - refused,
    refused,
    reason: refused > 0 ? Option.some("partial") : Option.none(),
  };
};

/** The outcome when nothing reached the sink, for the collector's own reason. */
export const notSent = (signal: Signal, items: number, reason: string): Outcome => ({
  signal,
  items,
  forwarded: 0,
  refused: items,
  reason: Option.some(reason),
});

/**
 * The collector's counts as an OTLP metrics export request (JSON): one delta sum per signal, a point for what was
 * forwarded and one for what was refused, each carrying `stamp` (who sent the items). Zero points are left out.
 */
export const countsExport = (
  outcome: Outcome,
  resource: {
    readonly script: string;
    /** The collector's own resource attributes: its stage. */
    readonly own: ReadonlyArray<StringAttribute>;
    readonly stamp: ReadonlyArray<StringAttribute>;
  },
  window: { readonly startNanos: bigint; readonly endNanos: bigint },
) => {
  const metric = COUNT_METRICS[outcome.signal];
  const point = (value: number, attributes: ReadonlyArray<StringAttribute>) => ({
    attributes: [stringAttribute(COMPONENT, resource.script), ...resource.stamp, ...attributes],
    startTimeUnixNano: `${window.startNanos}`,
    timeUnixNano: `${window.endNanos}`,
    asInt: `${value}`,
  });
  const points = [
    ...(outcome.forwarded > 0 ? [point(outcome.forwarded, [])] : []),
    ...(outcome.refused > 0
      ? [point(outcome.refused, Option.toArray(Option.map(outcome.reason, (r) => stringAttribute(ERROR_TYPE, r))))]
      : []),
  ];
  return {
    resourceMetrics: [
      {
        resource: { attributes: [stringAttribute(SERVICE, resource.script), ...resource.own] },
        scopeMetrics: [
          {
            scope: { name: resource.script },
            metrics: Arr.isReadonlyArrayNonEmpty(points)
              ? [
                  {
                    name: metric.name,
                    unit: metric.unit,
                    sum: { aggregationTemporality: DELTA, isMonotonic: true, dataPoints: points },
                  },
                ]
              : [],
          },
        ],
      },
    ],
  };
};
