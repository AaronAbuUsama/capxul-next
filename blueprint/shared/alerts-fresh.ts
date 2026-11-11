import { defineDecision } from "../../packages/blueprint-engine/src/index.ts";
import { decision_loop_alerts } from "./alerts.ts";

export const decision_loop_alerts_fresh = defineDecision({
  id: "loop.alerts-fresh-inputs",
  title: "Each inbox poll uses an isolated module graph",
  question: "How does a running reconciler observe changed blueprint decisions and rulings?",
  options: [
    { label: "fresh-process", text: "Read the authoritative inbox in a short-lived Node process on every poll. Its fresh module graph reloads the blueprint and the portal predicates including all transitive imports. Return only question ids and text; errors fail the poll rather than masquerading as an empty inbox." },
    { label: "cache-busting-entry", text: "Change the entry URL, leaving transitive imports cached and potentially stale." },
  ],
  chosen: "fresh-process",
  why: "Fixes F-1.1 without duplicating predicates, trusting stale generated artifacts, or leaking a new module graph into the long-lived process each poll. Reload every poll rather than maintaining an incomplete dependency fingerprint. The small local process cost buys freshness for new, changed and removed decisions and ruling changes.",
  source: "Builder, m1-alerts, round 2, finding F-1.1",
  affects: [decision_loop_alerts],
});
