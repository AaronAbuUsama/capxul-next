import { defineDecision } from "../../packages/blueprint-engine/src/index.ts";
import * as v from "./vocabulary.ts";

export const decision_vocabulary_remaining_equity_errors = defineDecision({
  id: "vocabulary.remaining-equity-errors",
  title: "The remaining equity codes await their parked operations",
  question: "Should parked equity refusals be attached to active money commands?",
  options: [
    { label: "reserve", text: "Keep each code reserved with its parked producer; do not invent an active refusal." },
    { label: "wire", text: "Attach the codes to active payments despite their different meaning." },
  ],
  chosen: "reserve",
  why: "cut.equity-parked keeps equity outside the built book. vocabulary.new-equity-codes preserves its refusal vocabulary. Restore producer declarations when those operations return; these reservations do not implement equity.",
  source: "Builder, m1-gaps-unproduced-errors; cut.equity-parked; vocabulary.new-equity-codes; vocabulary.classes",
  affects: [v.error_BELOW_THRESHOLD, v.error_CONSENT_MISSING, v.error_INSUFFICIENT_FUNDS, v.error_NOT_VESTED, v.error_ROUND_CLOSED],
  stands: [
    { record: "error:BELOW_THRESHOLD", rule: "unproduced-error", why: "Reserved for org.vote.create's shareholder proposal threshold check. cut.equity-parked removes that operation; active Board permissions are not a Governor vote threshold." },
    { record: "error:CONSENT_MISSING", rule: "unproduced-error", why: "Reserved for share-class consent on org.round.create and org.round.close. Those round operations are parked by cut.equity-parked; ordinary payment approval is not class consent." },
    { record: "error:INSUFFICIENT_FUNDS", rule: "unproduced-error", why: "Reserved for the strike-token balance check in parked shares.exercise. vocabulary.new-equity-codes deliberately distinguishes it from active payments' INSUFFICIENT_BALANCE." },
    { record: "error:NOT_VESTED", rule: "unproduced-error", why: "Reserved for the vested-amount check in shares.exercise, parked by cut.equity-parked. No active payment operation exercises options." },
    { record: "error:ROUND_CLOSED", rule: "unproduced-error", why: "Reserved for closed rounds or expired pay-by dates in invest.commit, org.round.invite and org.safe.close. cut.equity-parked removes their producers, not their shared vocabulary." },
  ],
});

export const decision_vocabulary_token_required_reserved = defineDecision({
  id: "vocabulary.token-required-reserved",
  title: "TOKEN_REQUIRED has no v4 multi-token budget producer",
  question: "Does keeping TOKEN_REQUIRED for budgets mean a current operation produces it?",
  options: [
    { label: "reserve", text: "Retain the historical code without promising a v4 refusal; revisit if multi-token budget selection returns." },
    { label: "wire", text: "Declare it on single-token budgets even though no token choice is needed." },
  ],
  chosen: "reserve",
  why: "payroll.drop-token-required removes the pre-v4 offer refusal. Its suggestion of budgets' own use is a reservation, not a producer: the target budget identifies its token. Do not attach an impossible refusal merely to close a gap.",
  source: "Builder, m1-gaps-unproduced-errors; payroll.drop-token-required; budgets.chain-is-the-record",
  affects: [v.error_TOKEN_REQUIRED],
  stands: [{ record: "error:TOKEN_REQUIRED", rule: "unproduced-error", why: "The code describes choosing a token from a multi-token budget. payroll.drop-token-required removes that pre-v4 path; target budgets each identify one token. Retained as historical vocabulary, not an active refusal." }],
});

export const decision_vocabulary_runtime_boundaries = defineDecision({
  id: "vocabulary.runtime-boundaries",
  title: "Runtime boundary codes are not SDK business refusals",
  question: "How do runtime-only codes stand without an operation implementation that raises them?",
  options: [
    { label: "boundary", text: "Keep explicit reservations for CLI startup, unexpected CLI crashes and unbuilt deployment stubs; do not claim that a business RPC raises them." },
    { label: "all-operations", text: "Add every runtime code to every operation, including local commands and built implementations." },
  ],
  chosen: "boundary",
  why: "vocabulary.kept and vocabulary.keep-unnamed retain these codes. No runtime-boundary record kind declares their producers today. Standing records that modeling boundary without inventing an RPC or treating a fully designed implementation as an unbuilt stub.",
  source: "Builder, m1-gaps-unproduced-errors; vocabulary.kept; vocabulary.keep-unnamed; shared vocabulary CLI-only section",
  affects: [v.error_CLI_DEFECT, v.error_ENVIRONMENT_NOT_CHOSEN, v.error_NOT_IMPLEMENTED],
  stands: [
    { record: "error:CLI_DEFECT", rule: "unproduced-error", why: "Reserved for the CLI's unexpected-crash boundary (exit 1), not an SDK error or intended operation refusal. vocabulary.keep-unnamed retains it; the blueprint has no CLI exception-boundary producer record." },
    { record: "error:ENVIRONMENT_NOT_CHOSEN", rule: "unproduced-error", why: "Reserved for CLI startup when a network command has neither a saved nor explicit environment. This happens before SDK dispatch; local commands such as use.env and whoami must work without one. No shared CLI preflight producer is modeled." },
    { record: "error:NOT_IMPLEMENTED", rule: "unproduced-error", why: "Reserved by vocabulary.keep-unnamed for deployment stubs until commands are built. The target describes intended implementations, not per-deployment stub availability; no business implementation is asserted to raise this defect. Revisit when the last stub is built." },
  ],
});
