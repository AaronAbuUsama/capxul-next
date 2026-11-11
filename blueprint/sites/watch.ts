// What Aaron watches of the thin line: its funnel and the money it moved, on one dashboard. The judgment is the
// decision at the end of this file.

import { defineDashboard, defineDecision, defineInsight } from "../../packages/blueprint-engine/src/index.ts";
import { insight_payments_settled } from "../payments/watch.ts";
import { log_operation_row } from "../shared/signals.ts";
import { journey_thin_line } from "./thin-line.ts";

export const insight_thin_line_funnel = defineInsight({
  id: "thin_line_funnel",
  title: "The thin line, step by step",
  about: "How many runs reached each of the thin line's 12 steps, from each step's proving event.",
  // Every step proves by its own success, so the funnel reads the rows its rpcs write. A row per CLI command
  // (per operation) would read it directly; the log kind has no `per: operation` yet.
  reads: [log_operation_row],
  query: { funnel: journey_thin_line },
  display: "funnel",
  env: ["shared-world", "staging"],
  answer: "On the thin-line world: 1 run through all 12 steps.",
});

export const dashboard_thin_line = defineDashboard({
  id: "thin_line",
  title: "Aaron: the thin line",
  about: "Whether one company ran end to end on the shared world: the funnel of its 12 steps, and the payments it settled.",
  audience: "aaron",
  where: "posthog",
  tiles: [journey_thin_line, insight_thin_line_funnel, insight_payments_settled],
});

export const decision_sites_thin_line_dashboard = defineDecision({
  id: "sites.thin-line-dashboard",
  title: "The thin line has one dashboard for Aaron",
  question: "Where does Aaron see that the thin line ran, besides the eval scoreboard?",
  options: [
    { label: "posthog-dashboard", text: "One PostHog dashboard: the journey, its funnel, and payments settled." },
    { label: "scoreboard-only", text: "Only the portal's scoreboard." },
  ],
  chosen: "posthog-dashboard",
  why:
    "The scoreboard says the checks passed; the dashboard shows the product's own signals saying the same thing, so the " +
    "telemetry is proven on the thin line before the fan-out copies it. Funnel and settled count have known answers there.",
  source: "Aaron, 18:49 UTC 11 November 2026; docs/mission/record-kinds-spec-2026-11-11.md",
  affects: [dashboard_thin_line, insight_thin_line_funnel],
});
