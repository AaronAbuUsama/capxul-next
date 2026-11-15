// Every metric of our own (docs/design/blueprint.md, part 10): its name, its type, its unit and the closed list of
// tags it may carry, each tag an attribute of the envelope, so a metric cannot grow a tag nobody declared. Metrics
// are only for what a span cannot show (`telemetry-in-the-blueprint`, A4): counts over time, a ratchet's length,
// cost, the cluster's capacity. Durations, calls and refusals per operation are read from spans. Generated from it,
// later: Effect `Metric` definitions and the metrics a check expects.
import type { AttributeKey } from "./envelope.ts";

/** One metric. Its unit is UCUM, as OpenTelemetry writes units (`ms`, `{item}`). */
export interface Metric {
  readonly name: string;
  readonly type: "counter" | "gauge" | "histogram";
  readonly unit: string;
  /** The envelope's attributes it may carry, and no other. */
  readonly tags: ReadonlyArray<AttributeKey>;
  readonly measures: string;
}

/** Every metric, by a short name code uses (`Metrics.metrics.ratchetRemaining.name`). */
export const metrics = {
  ratchetRemaining: {
    name: "capxul.ratchet.remaining",
    type: "gauge",
    unit: "{item}",
    tags: ["ratchet"],
    measures: "how many items a ratchet's list still holds, counted by ratchet.count on every pull request",
  },
  costUsd: {
    name: "capxul.cost.usd",
    type: "counter",
    unit: "USD",
    tags: ["costSource", "grade", "world", "run", "lane", "journey", "session"],
    measures: "money spent, priced by the cost job and attributed to what spent it",
  },
  costHeartbeat: {
    name: "capxul.cost.heartbeat",
    type: "counter",
    unit: "{run}",
    tags: [],
    measures: "one a day, from the cost job: a missing day shows it did not run",
  },
  collectorForwarded: {
    name: "capxul.collector.forwarded",
    type: "counter",
    unit: "{record}",
    tags: ["stage", "signal", "trace"],
    measures: "records the collector forwarded to the sink, per stage, signal and trace",
  },
  collectorRefused: {
    name: "capxul.collector.refused",
    type: "counter",
    unit: "{record}",
    tags: ["stage", "signal", "trace"],
    measures: "records the sink refused, per stage, signal and trace",
  },
  clusterWorlds: {
    name: "capxul.cluster.worlds",
    type: "gauge",
    unit: "{world}",
    tags: ["stage"],
    measures: "worlds on a stage's cluster, against its places",
  },
  clusterAdmissionWait: {
    name: "capxul.cluster.admission.wait",
    type: "histogram",
    unit: "ms",
    tags: ["stage", "run", "lane"],
    measures: "how long a world waited for a place on the cluster: one of the four measures that raise a run's shards",
  },
  sitePool: {
    name: "capxul.site.pool.size",
    type: "gauge",
    unit: "{site}",
    tags: ["stage"],
    measures: "ready sites in the bench's pool, waiting to be taken",
  },
} as const satisfies { readonly [short: string]: Metric };
