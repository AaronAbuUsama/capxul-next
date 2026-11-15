// What watches the declared names (docs/design/blueprint.md, part 10): the monitors and dashboards over what the
// blueprint declares, so none is made by hand in the console. A monitor that fires raises a task; nothing here fails
// a run, since a budget is a target (part 8). Generated from it, later: Axiom's monitor and dashboard JSON, applied by
// the platform's deploy.
import { runRun } from "../things/run/run.ts";
import type { DatasetKey } from "./datasets.ts";
import type { AttributeKey } from "./envelope.ts";
import { metrics } from "./metrics.ts";

/** Over 1.5 times its budget, a measured p95 raises an architecture review (Aaron, 15 November 2026). */
export const REVIEW_FACTOR = 1.5;

/** One monitor. */
export interface Monitor {
  readonly name: string;
  /** The dataset it reads. */
  readonly reads: DatasetKey;
  /** The declared names it reads: a span's or metric's name, and the envelope's attributes it groups by. */
  readonly over: string;
  readonly by: ReadonlyArray<AttributeKey>;
  /** When it fires, in words; the threshold is in `threshold`. */
  readonly when: string;
  readonly threshold: number;
  /** The window it looks over, in minutes. */
  readonly windowMinutes: number;
}

/** Every monitor, by a short name. Each raises a task when it fires. */
export const monitors = {
  architectureReview: {
    name: "capxul.watch.architecture-review",
    reads: "testTraces",
    over: "every span carrying capxul.budget.ms",
    by: ["operation"],
    when: "an operation's measured p95 is over the threshold times its declared budget",
    threshold: REVIEW_FACTOR,
    windowMinutes: 7 * 24 * 60,
  },
  runOverTime: {
    name: "capxul.watch.run-over-time",
    reads: "testTraces",
    over: runRun.name,
    by: ["run"],
    when: "a run's span lasts longer than the threshold, in milliseconds",
    threshold: runRun.budget.ms * REVIEW_FACTOR,
    windowMinutes: 24 * 60,
  },
  refusalRate: {
    name: "capxul.watch.refusal-rate",
    reads: "realTraces",
    over: "every span carrying capxul.outcome",
    by: ["operation", "refusal"],
    when: "the share of an operation's calls refused is over the threshold",
    threshold: 0.2,
    windowMinutes: 60,
  },
  errorRate: {
    name: "capxul.watch.error-rate",
    reads: "realTraces",
    over: "every span carrying capxul.outcome",
    by: ["operation"],
    when: "the share of an operation's calls that ended in what nobody declared is over the threshold",
    threshold: 0,
    windowMinutes: 60,
  },
  ratchetStalled: {
    name: "capxul.watch.ratchet-stalled",
    reads: "testMetrics",
    over: metrics.ratchetRemaining.name,
    by: ["ratchet"],
    when: "a ratchet's list has not fallen in the threshold's number of days",
    threshold: 14,
    windowMinutes: 14 * 24 * 60,
  },
  costHeartbeatMissing: {
    name: "capxul.watch.cost-heartbeat-missing",
    reads: "testMetrics",
    over: metrics.costHeartbeat.name,
    by: [],
    when: "fewer heartbeats than the threshold arrived in the window",
    threshold: 1,
    windowMinutes: 26 * 60,
  },
} as const satisfies { readonly [short: string]: Monitor };

/** One dashboard: the metrics and monitors it shows. */
export interface Dashboard {
  readonly name: string;
  readonly shows: ReadonlyArray<string>;
}

/** Every dashboard, by a short name. */
export const dashboards = {
  ratchets: { name: "capxul.dashboard.ratchets", shows: [metrics.ratchetRemaining.name] },
  cost: { name: "capxul.dashboard.cost", shows: [metrics.costUsd.name, metrics.costHeartbeat.name] },
  cluster: {
    name: "capxul.dashboard.cluster",
    shows: [metrics.clusterWorlds.name, metrics.clusterAdmissionWait.name, metrics.sitePool.name],
  },
} as const satisfies { readonly [short: string]: Dashboard };
