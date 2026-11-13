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
  question: "How do collection members retain their identity when agents insert or reorder claims?",
  options: [{ label: "stable-keys", text: "Use an explicit key when supplied; otherwise use c- plus the first 16 hex digits of SHA-256 of the member's canonical identity. Acceptance identity is its claim, refusal identity its given and when, admission identity its policy fields, and provider failure identity its when. Never use an array position or occurrence count. Eval ID collisions remain build problems. Migrate bindings and the scoreboard by matching the complete old and new eval contracts, retaining historical evidence unchanged." }],
  chosen: "stable-keys", why: "Independent concept edits must not silently redirect a binding. Content-derived defaults avoid a key inventory across hundreds of unchanged claims; an explicit key preserves identity across a deliberate rewording, whose old verdict still becomes stale. A changed default identity fails binding validation instead of proving another claim.",
  source: "Aaron's parallel breadth preparation, 12 November 2026; supersedes declaration-order identity from 10 November",
  affects: [f.system_capxul],
});

export const decision_system_eval_runs = defineDecision({
  id: "system.eval-runs", title: "Every scoring attempt preserves intent and same-run evidence",
  question: "What happens when a bound script stops without finishing its requested checks?",
  options: [{ label: "receipts", text: "Before execution, save a running receipt with requested IDs, immutable claim and observes snapshots, and the world, storage and indexer. Clear requested scoreboard verdicts to not_run before starting scripts. Save every script exit and per-plan completion under system.eval-reporting; incomplete runs return failure but retain independently completed plan verdicts. Store a per-run status snapshot alongside the receipt. Run success requires every requested eval to pass, including unbound evals which remain not_run; --json returns the run directory and an explicit passed boolean. Keep historical JSON-stack evidence, but never relabel it as Postgres/Ponder evidence. Discover check and binding files per concept; concept workers need not edit a shared registry." }],
  chosen: "receipts", why: "A prior pass cannot stand in for an unfinished attempt. A receipt exists even when the script prints nothing or the runner is killed. Immutable per-run snapshots let the slicer require all of a slice's fresh passes from one complete run in the right environment.",
  source: "Aaron's parallel breadth preparation, 12 November 2026; reproduced zero-result run retaining old passes",
  affects: [f.system_capxul],
});

export const decision_system_eval_preparation = defineDecision({
  id: "system.eval-preparation", title: "Journey preparation belongs to the scoring attempt",
  question: "How can provisioning, payment and recovery happen inside the eval run that scores their evidence?",
  options: [
    { label: "receipt-first", text: "An optional --prepare argv-JSON file names one executable and its literal arguments. Save its argv, pending exit and prepare.log path in the running receipt and clear requested prior verdicts before spawning it with CAPXUL_EVAL_RUN_DIR. Await success and save its exit/signal before any bound script. Failure or interruption makes the attempt incomplete and skips bound scripts. Preparation output cannot satisfy check bindings. Keep old receipts without preparation readable. Credentials belong in environment or files, never argv; preparation output must be sanitized." },
    { label: "external-fixture", text: "Prepare the world before starting the harness, then inspect its finished state. This cannot establish that the public journey actions occurred in the scoring attempt." },
  ],
  chosen: "receipt-first", why: "A paid or restored fixture predating the running receipt cannot prove a same-run journey. The harness owns attempt timing and failure; concept checks still own the exact public actions, independent persisted reads, native integrity and correlated events. A successful preparation process alone supplies no eval pass.",
  source: "Slice zero runtime and world CLI integration, 12 November 2026; system.eval-runs; preparation previously preceded executeRun",
  affects: [f.system_capxul],
});

export const decision_system_eval_unsupported_worlds = defineDecision({
  id: "system.eval-unsupported-worlds", title: "Unsupported bindings remain visible in the scoring attempt",
  question: "How does a full selected-stack attempt record requests whose bound scripts support only another world?",
  options: [
    { label: "record-and-skip", text: "Save every requested eval contract and clear its prior verdict before preparation. Keep every planned script in the receipt; skip a plan if any requested binding file for it excludes the selected world, or if it is the JSON skeleton against a non-skeleton environment. Leave skipped exits unknown, record the reason in run.log and per-eval evidence, and finish incomplete with those requests not_run. Other compatible scripts may retain their completed verdicts under system.eval-reporting. Never expand binding worlds, execute the skeleton on the selected stack, drop requests or score preparation output." },
    { label: "preflight-refusal", text: "Refuse the entire selection before a receipt exists. This conceals the full attempt and prevents preparation or compatible checks from recording same-run evidence." },
  ],
  chosen: "record-and-skip", why: "The first honest full-gate attempt must preserve missing world support as evidence, not require weakening bindings to get past preflight. Unknown script exits and unchanged complete-run rules keep the failure closed.",
  source: "Selected runtime first full-gate attempt, 12 November 2026; executeRun world and skeleton guards refused before saving intent; system.eval-runs",
  affects: [f.system_capxul],
});

export const decision_system_eval_reporting = defineDecision({
  id: "system.eval-reporting", title: "Report completed plans without accepting an incomplete gate",
  question: "Does an unsupported or interrupted plan erase another plan's completed assertions?",
  options: [{ label: "per-plan", text: "New receipts assign each bound requested eval to exactly one script with evals and completed fields. A plan completes only with well-formed output for every bound requested check, no signal, and exit 0, or exit 1 with an explicit failed check. Other exits, missing checks and malformed output are incomplete; retain explicit failures and raw evidence but demote that plan's passes to not_run. A finalized incomplete receipt may publish passes only from a completed plan after successful preparation. Complete means every requested eval was bound and every plan completed, not that assertions passed. Run success still requires every requested verdict pass; slice acceptance still requires one fresh complete selected-stack receipt, never unioned partial reports. Unexpected harness/evidence errors prevent completion and passing reports. Old receipts remain readable under their existing rules; never rewrite or rescore historical evidence." }],
  chosen: "per-plan", why: "PR77 retained 18 passing checks and 17 captures, but the skipped skeleton globally demoted all usable bindings. Per-plan completion separates assertion outcomes from transport/crash failure without letting a partial report satisfy the full gate. Exit 1 counts as assertion failure only when all planned checks were reported and at least one explicitly failed; a process cannot prove normal completion from a bare exit code alone.",
  source: "Aaron's resumed Wave0 implementation; retained PR77 exact 8144d0a; supersedes global pass demotion in system.eval-runs and system.eval-unsupported-worlds",
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

export const decision_system_eval_event_checks = defineDecision({
  id: "system.eval-event-checks", title: "Event claims check this run's outbox against operations the run logged",
  question: "How does a runner prove evt:<operation>/<event> (it sends the event, valid against its schema, carrying trace_id) on the selected stack?",
  options: [
    { label: "logged-invocations", text: "Whatever invokes a public operation during a run, preparation or a concept module, appends one JSON line {operation, trace_id, ok} per call to its own <run>/<module>/operations.jsonl, trace_id being the trace the caller sent, a W3C trace id minted for the run (its first 16 hex digits are the first 16 of sha256 of the receipt's id, the rest random per call) so that a row from an earlier run on the same world, or inherited from a snapshot's parent, can never match. Only regular non-empty files written during this run count, and a malformed line or a trace not minted for the run is a log error that fails every check. One blueprint-driven module, packages/evals/src/modules/events, names a check EVENTS.<operation>.<event> per evt eval, reads app.transition_outbox as the restricted worker role for the logged traces, and passes a check only when at least one successful logged invocation of that operation sent that event under its own trace, no trace of that operation is logged by any other call (a shared trace cannot say which call sent the row), and every such envelope is well formed, names the machine whose transitions emit the event, and its props decode exactly (no excess keys) against the event record, per the engine's eventPropsErrors. A missing log, invocation or event is an explicit failure with its reason, never silence. Evidence keeps the invocations, the matching envelopes and the result." },
    { label: "latest-rows", text: "Accept any outbox row with the event's name. A row from a fixture, an older world or another operation would then prove a claim about this operation in this run." },
  ],
  chosen: "logged-invocations", why: "The claim is about this operation's call, so the evidence must tie a row to a call made in this run; the trace the caller sent is the one identity both sides already carry. Independent review of PR121 found that two calls sharing a trace, or a trace reused from an earlier run on the same world, let one call's row prove another's, so traces are unique per call and minted for the run. A shared checker keeps sixteen evt claims across seven lanes to one rule, and lanes only log their calls.",
  source: "Wave Zero integrator gate audit (T-01a1cfb4), 13 November 2026; packages/backend/src/platform/outbox.ts TransitionEvent; packages/blueprint-engine/src/evals.ts evt claims",
  affects: [f.system_capxul],
});
