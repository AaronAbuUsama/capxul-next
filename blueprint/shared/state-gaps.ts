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

export const decision_system_eval_screen_captures = defineDecision({
  id: "system.eval-screen-captures", title: "A run that asks for a screen's shows claim succeeds only with its capture",
  question: "Can `passed` be true when a requested screen shows claim has no source-equality capture in the run?",
  options: [
    { label: "capture-required", text: "A requested eval on a screen: subject whose ID ends in /shows passes only with a receipt screens entry for that screen with a path, a source and assertion source-equality; the engine's uncapturedScreens is the one rule, used by the run, its --json uncaptured list and slice evidence. In a run, an otherwise passing shows claim without one is recorded fail with that reason, never pass: its claim keeps a screenshot, and a completed plan still reports every assertion (system.eval-reporting). Every collected manifest, capture and source file must be a non-empty regular file, not a link, written during this run (modification time at or after the receipt's at); a source is a run-relative file with an optional RFC 6901 JSON pointer (empty or starting with /, ~1 for / and ~0 for ~, own properties only, and an array is entered only by a canonical index, never length) that must name a non-null value, resolved by the engine's pointerValue in both the runner and the full gate. A capture's and a source's real path (links resolved at every level) must lie inside the manifest's base directory, and a capture must be a PNG or JPEG by its magic bytes (engine isScreenImage), never its own source or a manifest; external --screens files are copied in only after those checks. Bad evidence fails collection and leaves the run incomplete. Historical receipts are not rescored." },
    { label: "verdicts-only", text: "Keep success as every requested verdict passing. A run can then report passed:true while slice zero stays partial for the same receipt, so the harness and the slice disagree about one attempt." },
  ],
  chosen: "capture-required", why: "Slice evidence already required source-equality captures for shows claims (portal.product-slices); the run result did not, so a direct run could exit 0, and record a shows pass, without the screens acceptance needs. Independent review of PR87 found that an older run's manifest, an empty capture or an unresolved source would still count; its re-review found that an array's length, a capture behind a nested linked directory, or the source JSON listed as its own capture would too. One shared rule plus same-run, non-empty, resolvable evidence keeps the run's answer and the slice's answer the same.",
  source: "Receipt-first harness lane audit of the Wave Zero gate, 13 November 2026; packages/evals/src/execute.ts finish and packages/blueprint-engine/src/slices.ts sliceEvidence",
  affects: [f.system_capxul],
});

export const decision_system_eval_system_checks = defineDecision({
  id: "system.eval-system-checks", title: "Import and generation claims are judged from the build's own commit",
  question: "How does a run prove sys:imports/<concept> and sys:generated on the selected stack?",
  options: [
    { label: "static-at-commit", text: "packages/evals/src/modules/system reads the receipt's commit from git, never the working tree. sys:imports/<concept> passes when code exists under some packages/<package>/src/<concept>/ (system.layout) and everything it names in another concept's folder is a dependsOn concept's src/<concept>/door. Modules come from each file's syntax tree: import and export declarations, import = require(), import() types, import(), require() and import.meta.resolve() calls and new URL(…, import.meta.url); comments are not imports. A relative path resolves against the file, and a bare @capxul/<package> import resolves through that package's exports map as Node loads it (exact key or longest-prefix pattern, array fallbacks, first matching condition in object order, require for require()). An @capxul import that resolves to nothing, or an import()/require() whose argument is not a literal, is a violation, and so is any other module or file reached in another concept's folder. A +dirty receipt commit is refused. A concept with no such code fails with that reason, never passes empty. sys:generated runs the commit's own packages/generate/src/main.ts --check in a clean git worktree of the receipt's commit, after a frozen-lockfile pnpm install (offline first, then once more with --prefer-offline; the lockfile still pins and integrity-checks every version, the network only fills a store that lacks one, and both attempts stay in the evidence), and passes only on exit 0: every packages/<package>/src/generated/ file is as the records generate it, none is stray or missing, and every generated package compiles. Evidence keeps each step's command, exit and output; the worktree is then removed. While packages/generate is absent at the commit it fails with that reason. Evidence keeps every file read and every violation with its line." },
    { label: "lint-only", text: "Leave the claims to a future lint rule. The gate would then require two claims nothing measures in the run." },
  ],
  chosen: "static-at-commit", why: "Both claims are about the build itself, so reading the receipt's commit ties the verdict to the code the run tested. Independent review of PR147 found that a pattern match missed require, template and mid-line imports and that @capxul/<package> subpaths were mapped to folders Node never loads, so imports through the exports map went unchecked; its re-review found that an unresolvable @capxul import, a computed import() and a fixed condition order still passed silently; running the commit's own generator in a clean checkout keeps the sys:generated verdict about that commit, never the working tree, and the --prefer-offline retry exists because the attempt host cannot be assumed to have a warm pnpm store (a fresh checkout here failed offline with ERR_PNPM_NO_OFFLINE_META); a vacuous pass for a concept with no code, or a regeneration check with no generator, would count a claim nothing checked.",
  source: "Wave Zero integrator assignment of sys:imports and sys:generated to the harness lane after the measured-gate widening (portal.slice-zero-measured-gate), 13 November 2026",
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

export const decision_system_eval_warm_budgets = defineDecision({
  id: "system.eval-warm-budgets", title: "Budget claims are judged from this run's warm samples by one shared rule",
  question: "How does a runner prove a budget claim (bud:*/p95, rpc:*/budget, flw:*/budget) on the selected stack?",
  options: [
    { label: "warm-in-run", text: "Use only samples measured in this run, from operational host time (the database's clock_timestamp() created_at/acked_at pairs or span durations), never the world or chain clock. A sample may subtract only named waits the claim's subject record excludes: a workflow's waits (wait.<name>), its budget's excludes and chain.confirm; a flow's local wait steps (wait.<step>) and its budget's excludes; an operation's or rpc's budget excludes, which are usually none. Any other wait name, or waits longer than the sample, is refused. Every sample carries its host-clock start (startedAt, epoch ms); the helper orders each kind by it, a kind being one measured path in one process, so the earliest sample of each kind is cold and excluded whatever order the caller passes; a missing start or two samples of one kind starting together is refused. Every kind needs a warm sample, and the warm count N must be at least 2, or the check fails. With N at least 20, p95 and p50 are nearest-rank (the ceil(q*N)-th smallest). With N below 20, the maximum must be within the p95 budget and the median within the p50 budget. Budgets without p50 check p95 only. The numbers come from the eval's blueprint record, and the evidence keeps the budget, its exclusions, N (warm samples only), the method, every sample, warm and cold, and the result. packages/evals/src/modules/budgets is the one implementation every runner uses." },
    { label: "per-lane", text: "Each lane computes its own percentiles. Different warm-up, sample-size and percentile rules would make the same claim pass in one runner and fail in another." },
  ],
  chosen: "warm-in-run", why: "A budget claim is a statement about this build on this stack, so only same-run host-clock samples can prove it, and world time can be moved by the devnet clock. Independent review found that an unnamed wait amount could cancel any sample and that the cold sample depended on the caller's array order, so waits are named by the record and order by the host clock. Nearest-rank p95 below 20 samples is the maximum anyway; requiring max and median there keeps small runs honest without pretending to a percentile. One shared helper keeps every lane's verdict comparable.",
  source: "Wave Zero integrator ruling on budget evals, 13 November 2026; packages/blueprint-engine/src/evals.ts bud/rpc/flw budget claims",
  affects: [f.system_capxul],
});

export const decision_system_eval_screen_manifests = defineDecision({
  id: "system.eval-screen-manifests", title: "Each eval module lists its own screen captures",
  question: "How do two modules in one run both report screen captures when the run has one screens.json?",
  options: [
    { label: "per-module", text: "The runner collects <run>/screens.json and every <run>/<module>/screens.json one directory down, in that order (modules sorted by name), into the receipt's screens. Every in-run manifest lists run-relative paths and sources, so a module writes only its own manifest and captures under its own directory. The run-level manifest is acceptance's and, like <run>/acceptance/screens.json, may list only files under acceptance/; any other module manifest may list only captures and source files under its own <module>/; paths are compared and recorded in normalized form. A path listed twice, a capture outside the module's directory, a symlinked run subdirectory, a missing capture or an invalid entry fails the run's evidence collection, which makes the run incomplete. --screens still imports one external manifest relative to its own file, and fails when in-run manifests are also present." },
    { label: "shared-file", text: "Every module reads, merges and rewrites <run>/screens.json. Correct only while scripts run strictly one after another, and a module that writes the whole file silently drops another module's captures." },
  ],
  chosen: "per-module", why: "Acceptance already writes the whole run-level file, and Sites now captures the hat-grants and payment-requests screens in the same run. Separate manifests cannot overwrite each other and keep each capture attributable to its module, with no ordering assumption.",
  source: "Sites lane request for scr:hat-grants/shows and scr:payment-requests/shows, 13 November 2026; packages/evals/src/execute.ts screen collection",
  affects: [f.system_capxul],
});
