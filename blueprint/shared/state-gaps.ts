import { defineDecision } from "../../packages/blueprint-engine/src/index.ts";
import { error_POOL_EXCEEDED, error_SHARES_LOCKED } from "./vocabulary.ts";
import * as f from "./foundation.ts";
export const decision_vocabulary_parked_equity_errors = defineDecision({
  id: "vocabulary.parked-equity-errors", title: "Equity errors stay reserved while their producers are parked",
  question: "Why do POOL_EXCEEDED and SHARES_LOCKED have no producer?",
  options: [{ label: "reserve", text: "unproduced-error: POOL_EXCEEDED belongs to the parked option grant pool check; SHARES_LOCKED belongs to parked sale and transfer vesting checks. cut.equity and cut.equity-parked remove those producers from the built book. Keep the shared vocabulary reserved so reintroducing equity does not silently reuse their codes. No active money command is claimed to produce either error." }],
  chosen: "reserve", why: "The cut parks equity, not its meaning. Reserved shared codes are harmless; adding them to unrelated payment errors would promise false refusals.",
  source: "Builder, m1-gaps-states; lane findings.json; cut.equity; cut.equity-parked; shared vocabulary was links",
  affects: [error_POOL_EXCEEDED, error_SHARES_LOCKED],
  stands: [
    { record: "error:POOL_EXCEEDED", rule: "unproduced-error", why: "Reserved for the parked equity option grant pool check; cut.equity and cut.equity-parked remove its producer. No active money command produces it." },
    { record: "error:SHARES_LOCKED", rule: "unproduced-error", why: "Reserved for parked equity sale and transfer vesting checks; cut.equity and cut.equity-parked remove its producers. No active money command produces it." },
  ],
});

export const decision_system_error_producers = defineDecision({
  id: "system.error-producers", title: "Only producer declarations close an unproduced error gap",
  question: "Does a decision mentioning an error make it produced?",
  options: [{ label: "producers", text: "Derive unproduced-error from errors links on operations, flows, rpcs and procedures, and failures links on integration calls. Refusal claims and decision affects links are references, not producers." }],
  chosen: "producers", why: "A reason to reserve a code must not erase the gap it explains. The equity reservation must appear as standing with its reasons, not disappear through affects links.",
  source: "Builder, m1-engine-rules round 2; F-1.1",
  affects: [f.system_capxul],
});

export const decision_system_eval_identity = defineDecision({
  id: "system.eval-identity", title: "Each derived eval has one identity",
  question: "How do repeated refusal and provider codes retain separate claims?",
  options: [{ label: "cases", text: "Keep the first code's existing eval id; subsequent cases append /2, /3 and so on in declaration order. Every derived eval id must be unique across the blueprint; a collision is a build problem, never silently deduplicated." }],
  chosen: "cases", why: "A code can refuse several worlds and a provider can fail several ways. Preserve every claim and existing first-case binding. Case order, like acceptance order, is identity: do not reorder existing cases.",
  source: "Builder, m1-engine-rules, 10 November 2026; repeated refusal and integration failure codes in the built eval list",
  affects: [f.system_capxul],
});
export const decision_system_standing_gaps = defineDecision({
  id: "system.standing-gaps", title: "A standing gap carries a decision and a current reason",
  question: "How can the build distinguish an open gap from an explicitly retained boundary?",
  options: [{ label: "stands", text: "A decision may carry stands: entries of { record: kind:id, rule, why }. Match against derived gaps, move matched findings to standing with the decision id and reason. An unmatched entry is a stale-standing-gap problem. Never waive a problem or invent a gap." }],
  chosen: "stands", why: "Recorded reasons must be machine-readable and cannot outlive the gaps they explain. Standing is visible, not missing design silently erased.",
  source: "Builder, m1-engine-rules, 10 November 2026; m1 gap task decisions",
  affects: [f.system_capxul],
});
