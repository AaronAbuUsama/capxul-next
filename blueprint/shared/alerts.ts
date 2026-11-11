import { defineDecision } from "../../packages/blueprint-engine/src/index.ts";
import { decision_loop_plan } from "./swarm.ts";

export const decision_loop_alerts = defineDecision({
  id: "loop.alerts",
  title: "A persistent local reconciler announces owner questions and broken runs",
  question: "How does the owner hear about actionable changes without watching the portal?",
  options: [
    { label: "local-reconciler", text: "pnpm loop alerts polls all structured run views and the Questions inbox inputs (forAaron decisions and plan needs for aaron). Persist active episodes and pending/delivered alerts atomically in var/alerts.json before delivery; retry failed sends. An episode is a question's presence (changed question text starts another), or a run's failed/dead status; recovery ends it. Ignore superseded runs, blocked runs and model-request counters. Inject sender and clock. The composition root uses osascript display notification with the portal Questions or Runs HTTPS URL. --once previews unsent alerts without delivering or acknowledging them. One supervised process owns the file; no external service." },
    { label: "watch-only", text: "Keep terminal watch output without durable delivery." },
  ],
  chosen: "local-reconciler",
  why: "Carries out task m1-alerts and the research recommendation of 11 November. Startup reconciles current facts without a 24-hour cutoff. Persist intent before sending and acknowledgement after success: ordinary restarts deduplicate and catch up. macOS notifications have no transactional acknowledgement or idempotency API; a crash after OS acceptance but before saving acknowledgement can repeat delivery. Do not claim exactly-once OS receipt across that unavoidable window. Pending items no longer actionable are cancelled. Supervision remains the operator's responsibility.",
  source: "Builder, m1-alerts, round 1; docs/mission/research-2026-11-11.md (Alerts when a run needs Aaron); task m1-alerts",
  affects: [decision_loop_plan],
});
