// The cut review's cross-cutting rules. Per-decision dispositions live in docs/design/decision-review.json.
import { defineDecision } from "../../packages/blueprint-engine/src/index.ts";
import { system_capxul } from "./foundation.ts";

export const decision_system_decision_review = defineDecision({
  id: "system.decision-review",
  title: "The cut's old decisions are reconciled, with historical text kept apart",
  question: "How do readers distinguish the cut proposal's old decisions from current design authority?",
  options: [
    {
      label: "reviewed",
      text: "Account for every decision marked rewrite in docs/design/cut-proposal.json in docs/design/decision-review.json. Rewrite its current scope, confirm the surviving rule with a dated reason, or archive the mechanism with its replacement authority. Preserve original specifications in docs/cut-archive/decision-review-history.json. Each review must answer the original question, with a concrete surviving rule or a subject-specific archival reason; a category summary is not a disposition. Confirmed records retain their actual choice and rationale. In particular an added token still receives one opening_balance at its add block; admitted assets do not. An archived stub may keep its id and affects for historical links, but grants no authority to rebuild its old mechanism.",
    },
    { label: "leave", text: "Leave superseded decisions reading as current. Rejected: a reader would build the old optional-head model." },
  ],
  chosen: "reviewed",
  why: "aaron.frappe-native and aaron.one-door supersede optional-head synchronization and Core-owned business documents. The plan, portal and loop replace swarmD coordination. Round 2 corrects F-1.1: the category-wide migration erased distinct obligations and is superseded by the explicit per-id reconciliation in packages/plan/scripts/refine-decision-review.mjs. This is a coordinator reconciliation, not a new answer attributed to the owner. Records still retained as compatibility read models are not promoted to a second book of record.",
  source: "The coordinator, 11 November 2026; m1-old-decisions; docs/design/decision-review.md",
  affects: [system_capxul],
});
