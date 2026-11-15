// The sink's logical datasets (decision T2 of `telemetry-in-the-blueprint`, its option A2a): one per grade group and
// signal, so test is never beside real, and agents' sessions apart from the product's; plus Cloudflare's own tracing.
// Twelve in all. Each grade group's traces, logs and metrics form one correlation group, so the sink links a log to
// its trace. The events datasets hold the declared product events as flat, typed records (T4, A3c) and are locked
// once made (T3). The blueprint names them; `packages/platform` creates them and the collector routes by them, both
// generated from this list later. Sinks, keys and routing stay out (part 2).

/** A grade group's datasets: test worlds (private and shared grades), real worlds, or agents' sessions. */
export type Group = "test" | "real" | "agents";

/** One logical dataset. */
export interface Dataset {
  readonly name: string;
  /** Axiom's kind of dataset. */
  readonly kind: "otel:traces:v1" | "otel:logs:v1" | "otel:metrics:v1" | "axiom:events:v1";
  /** Its correlation group, or null for one in none. */
  readonly group: Group | null;
  /** True when its schema is locked once made: undeclared fields are dropped at ingest. */
  readonly locked: boolean;
  readonly holds: string;
}

/** Every dataset, by a short name. */
export const datasets = {
  testTraces: {
    name: "capxul-test-traces",
    kind: "otel:traces:v1",
    group: "test",
    locked: false,
    holds: "spans of test worlds, runs and the pipeline",
  },
  testLogs: {
    name: "capxul-test-logs",
    kind: "otel:logs:v1",
    group: "test",
    locked: false,
    holds: "logs of test worlds, runs and the pipeline",
  },
  testMetrics: {
    name: "capxul-test-metrics",
    kind: "otel:metrics:v1",
    group: "test",
    locked: false,
    holds: "metrics of test worlds and the pipeline, cost included",
  },
  testEvents: {
    name: "capxul-test-events",
    kind: "axiom:events:v1",
    group: null,
    locked: true,
    holds: "the declared events of test worlds, flat and typed",
  },
  realTraces: {
    name: "capxul-real-traces",
    kind: "otel:traces:v1",
    group: "real",
    locked: false,
    holds: "spans of real worlds",
  },
  realLogs: {
    name: "capxul-real-logs",
    kind: "otel:logs:v1",
    group: "real",
    locked: false,
    holds: "logs of real worlds",
  },
  realMetrics: {
    name: "capxul-real-metrics",
    kind: "otel:metrics:v1",
    group: "real",
    locked: false,
    holds: "metrics of real worlds",
  },
  realEvents: {
    name: "capxul-real-events",
    kind: "axiom:events:v1",
    group: null,
    locked: true,
    holds: "the declared events of real worlds, flat and typed",
  },
  agentsTraces: {
    name: "capxul-agents-traces",
    kind: "otel:traces:v1",
    group: "agents",
    locked: false,
    holds: "spans of agents' sessions, from Claude Code",
  },
  agentsLogs: {
    name: "capxul-agents-logs",
    kind: "otel:logs:v1",
    group: "agents",
    locked: false,
    holds: "logs of agents' sessions, prompts and tool details left out (T6)",
  },
  agentsMetrics: {
    name: "capxul-agents-metrics",
    kind: "otel:metrics:v1",
    group: "agents",
    locked: false,
    holds: "metrics of agents' sessions: tokens and cost per session",
  },
  cloudflare: {
    name: "capxul-cloudflare",
    kind: "otel:traces:v1",
    group: null,
    locked: false,
    holds: "Cloudflare's own tracing of our workers: CPU time, cold starts, exceptions that escape Effect",
  },
} as const satisfies { readonly [short: string]: Dataset };

export type DatasetKey = keyof typeof datasets;
