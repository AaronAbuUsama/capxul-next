// The board concept's own judgments, each a decision record linked to what it shapes. Made by Claude
// while designing the concept, under the accepted A1-A4 and P1-P10 and the shared decisions
// (concepts.board, dependencies.of-board, dependencies.board-below-proposers, rules.procedures,
// rules.durable-processes, operations.member-invite-in-budgets, responsibilities.keepers), with the
// old code (/home/user/factory, integration/factory) and the as-is book as evidence.

import { defineDecision } from "../../../packages/book/src/index.ts";
import { error_FEATURE_NOT_AVAILABLE, error_RESERVED_MATTER, error_ROLE_CONFLICT, error_WRONG_STATE } from "../shared/vocabulary.ts";
import { table_chain_budgets, table_chain_hats } from "../indexing/data.ts";
import { table_feature_flags } from "../access/data.ts";
import { procedure_approvals_withdraw } from "../approvals/procedures.ts";
import {
  event_board_change_transitioned,
  event_officer_change_transitioned,
  event_proposal_transitioned,
  machine_board_change,
  machine_officer_change,
  machine_proposal,
  table_board_changes,
  table_board_proposals,
  table_officer_changes,
  table_proposal_approvals,
} from "./data.ts";
import { procedure_board_propose } from "./procedures.ts";
import {
  rpc_board_directors_claim,
  rpc_board_directors_get,
  rpc_board_directors_hand_over,
  rpc_board_directors_refresh,
  rpc_board_directors_remove,
  rpc_board_directors_safe,
  rpc_board_directors_seat,
  rpc_board_directors_set_threshold,
  rpc_board_directors_show,
} from "./directors.ts";
import { rpc_board_proposals_approve, rpc_board_proposals_get, rpc_board_proposals_list, rpc_board_proposals_reject } from "./proposals.ts";
import { rpc_board_officers_get, rpc_board_officers_grant, rpc_board_officers_revoke } from "./officers.ts";
import { workflow_board_changes_carry, workflow_board_proposals_carry } from "./processes.ts";
import {
  flow_client_org_directors_add,
  flow_client_org_directors_remove,
  flow_client_org_directors_replace,
  flow_client_org_directors_set_threshold,
  flow_client_org_proposals_approve,
} from "./flows.ts";
import * as op from "./operations.ts";

const CLAUDE = "Claude, board design, 8 November 2026";
const by = (evidence: string) => `${CLAUDE}; evidence: ${evidence}`;
const OLD = "packages/backend/src/organizations";

const BOARD_CHANGE_OPERATIONS = [
  op.operation_org_board_claim,
  op.operation_org_board_director_add,
  op.operation_org_board_director_remove,
  op.operation_org_board_handover,
  op.operation_org_board_refresh,
  op.operation_org_board_threshold,
];

// ── proposals ───────────────────────────────────────────────────────────────────────────────

export const decision_board_one_proposal_table = defineDecision({
  id: "board.one-proposal-table",
  title: "One table of Board proposals, every one at a nonce, settled only by its process",
  question:
    "Old `orgSafeProposals` held raw, rejection and nonce-less scheduled-payment proposals, with each Director's sends as " +
    "`submissions`, and every read or action settled every waiting row from the chain. What is a target proposal?",
  options: [
    {
      label: "one-at-a-nonce",
      text:
        "One row per company Safe transaction at a Safe nonce, carrying its opener's subject; its process settles it from " +
        "the indexed execution at the nonce; reads only read.",
    },
    { label: "as-is", text: "Keep the old shape: nonce-less scheduled payments, submissions on the row, settle on read." },
    { label: "chain-only", text: "Store nothing: list the Safe's pending transactions from a transaction service." },
  ],
  chosen: "one-at-a-nonce",
  why:
    "A Safe nonce is used once, so the one execution at it ends every proposal there, and that is a chain event the " +
    "proposal's own process waits for (A3, P3): no read writes. On v4 a dated Board payment is a proposal carrying one " +
    "`Budgets.schedule` at a nonce (payments' design), so the nonce-less lane goes and every proposal has a nonce; the " +
    "frozen kind `scheduled_payment` stays for a proposal that carries a dated payment. The opener's subject is on the " +
    "row so asking twice answers the same proposal and every opener follows its own. Submissions move to " +
    "`proposal-approvals`, because approvals now hold each send. A transaction service is not part of the deployment.",
  source: by(`${OLD}/proposals/rules.ts:100-277; ${OLD}/tables/proposals.ts:15; books/target/payments/commands.ts:168`),
  affects: [table_board_proposals, machine_proposal, workflow_board_proposals_carry, rpc_board_proposals_get, rpc_board_proposals_list],
});

export const decision_board_failed_proposal = defineDecision({
  id: "board.failed-proposal",
  title: "A proposal whose execution the Safe reports failed is `failed`",
  question:
    "The frozen statuses are awaiting_approvals, executed, rejected and replaced. A Safe transaction can run at its nonce " +
    "and fail (ExecutionFailure) when it is executed with gas that lets the inner call fail. What is it then?",
  options: [
    { label: "failed", text: "A fifth state, `failed`: the nonce is used and nothing it carried happened." },
    { label: "replaced", text: "Report it as replaced." },
    { label: "executed", text: "Report it as executed and let the opener find out." },
  ],
  chosen: "failed",
  why:
    "Capxul's own executions send no safe gas, so a failing call reverts the whole execution and the nonce does not move; " +
    "but once the approvals are on chain anyone may execute it, and an ExecutionFailure then uses the nonce. Calling it " +
    "executed would make openers apply an intent that never happened (budgets, payments and agents settle on it); calling " +
    "it replaced hides that it was this proposal that ran. The status value is added to the frozen list, which never said " +
    "what this case is (P10 rung 5).",
  source: by("contract_safe ExecutionFailure; books/target/budgets/processes.ts:24 (\"ran and failed\")"),
  affects: [machine_proposal, table_board_proposals, event_proposal_transitioned, rpc_board_proposals_get],
});

export const decision_board_propose_procedure = defineDecision({
  id: "board.propose-procedure",
  title: "`board.propose` takes the calls; board picks the nonce, opens the first approval",
  question: "What does the one procedure for a Board proposal take from its opener, and what does board decide?",
  options: [
    {
      label: "calls-in",
      text:
        "The opener gives its subject, its calls, a note and the page summary; board checks the proposer is a Director, picks " +
        "the next free nonce, packs the calls, computes the Safe transaction hash and opens the proposer's first approval.",
    },
    { label: "transaction-in", text: "The opener gives a finished Safe transaction with its nonce and hash." },
    { label: "no-first-approval", text: "board.propose only stores the proposal; the proposer runs `org proposal approve` after." },
  ],
  chosen: "calls-in",
  why:
    "The concept that knows the intent builds its calls (dependencies.board-below-proposers); the nonce and the hash are " +
    "the Board's, and two openers picking nonces would collide. The proposer's own approval is part of the same fact: the " +
    "budgets, payments and payroll designs already rely on it ('the Board proposal and the caller's first approval'), " +
    "and on a 1-of-1 Board it is the execution. It reads only tables (indexing's Safe nonce at Ponder's head), so it makes " +
    "no outside call; a nonce Ponder had not yet seen used ends the proposal as replaced, never as a wrong payment. Board's " +
    "own grant, revoke and rejection invoke it too, so a proposal is born in one place; a rejection names the proposal " +
    "whose nonce it takes. The transaction is one procedure from board and one from approvals (sys:tx-width).",
  source: by(`${OLD}/proposals/writes.ts:100-196; books/target/budgets/departments.ts:57; books/target/approvals/procedures.ts:20`),
  affects: [procedure_board_propose, table_board_proposals, table_proposal_approvals, machine_proposal],
});

export const decision_board_proposal_approvals = defineDecision({
  id: "board.proposal-approvals",
  title: "Board records each Director approval it opened, in its own table",
  question:
    "A read must say which Directors approved and whose approvals are still on their way. Approvals rows are per signer " +
    "and indexed by signer; the chain holds only what landed. Where does a proposal's list of approvals come from?",
  options: [
    { label: "own-table", text: "A small `proposal-approvals` table: each approval Capxul opened, its Director and its step." },
    { label: "approvals-index", text: "Ask approvals for a cross-signer index by subject." },
    { label: "chain-only", text: "Show only the ApproveHash events indexed on chain." },
  ],
  chosen: "own-table",
  why:
    "The frozen reads show approvals `sent` and on their way, which the chain does not know yet, and `org proposal wait` " +
    "waits on exactly those. Approvals must not read its openers or grow an index for one of them; a board row naming " +
    "each approval id joins approvals' by-id index. The row is written in the transaction that opens the approval, so it " +
    "never disagrees with it.",
  source: by(`${OLD}/proposals/rules.ts:150-175; ${OLD}/proposals/writes/submissions.ts`),
  affects: [table_proposal_approvals, rpc_board_proposals_approve, rpc_board_proposals_get],
});

export const decision_board_approval_step = defineDecision({
  id: "board.approval-step",
  title: "The step is decided from the indexed approvals; only the current nonce executes",
  question:
    "The old rpc waited up to ten minutes for other Directors' approvals in flight before choosing approveHash or the " +
    "execution. An rpc is one transaction now. How is the step chosen?",
  options: [
    {
      label: "indexed",
      text:
        "From the approvals indexed on chain of Directors who still sign, with the caller's, against the Gate's threshold, " +
        "and only at the Safe's current nonce; otherwise approveHash. A Director runs approve again to execute later.",
    },
    { label: "in-flight", text: "Count approvals still on their way as if they had landed." },
    { label: "auto-execute", text: "The proposal's process executes it with a service key once the approvals are on chain." },
  ],
  chosen: "indexed",
  why:
    "Counting an approval that may still fail would build an execution that reverts. Waiting is not an rpc's job (A3). " +
    "Executing with Capxul's own key would make Capxul act for the Board, which the frozen text never says: the approval " +
    "that reaches the threshold executes it. A Director whose approval is already on chain may run it again once the " +
    "proposal can execute, and their approval is then the execution; before that it is WRONG_STATE, as the frozen mistake says.",
  source: by(`${OLD}/proposals/rules.ts:114-144; ${OLD}/proposals/operations/request-approval.ts:73`),
  affects: [rpc_board_proposals_approve, flow_client_org_proposals_approve, table_proposal_approvals],
});

export const decision_board_execution_refusal = defineDecision({
  id: "board.execution-refusal",
  title: "An execution the chain refuses is WRONG_STATE, from the approval's sponsorship",
  question:
    "The frozen refusal says an execution the chain refuses is WRONG_STATE (`execution_reverts`) before the Director " +
    "signs. The bundler's simulation maps a Gate revert to ROLE_PERMISSION_DENIED and others to TRANSACTION_FAILED. Who simulates?",
  options: [
    { label: "sponsorship", text: "Approvals' sponsorship simulates as for every approval; the approve flow answers WRONG_STATE `execution_reverts` for a refused execution." },
    { label: "rpc-simulates", text: "The approve rpc simulates the execution with an eth_call before opening the approval." },
  ],
  chosen: "sponsorship",
  why:
    "The sponsorship already simulates the exact operation before anyone can sign (K18), so a second simulation would " +
    "only race it. The flow knows the step it opened, so it reports the frozen code for an execution and keeps the " +
    "chain's own refusal as the cause; nothing was signed or sent either way. An approval that lands reverted (the " +
    "proposal changed on chain first) is WRONG_STATE too, as the frozen mistake says.",
  source: by(`${OLD}/proposals/operations/request-approval.ts:107; books/target/shared/external.ts (bundler sponsor failures)`),
  affects: [flow_client_org_proposals_approve, rpc_board_proposals_approve, error_WRONG_STATE],
});

export const decision_board_proposals_gate = defineDecision({
  id: "board.proposals-gate",
  title: "Every Director proposal and approval is behind the `owner-safe-proposals` gate",
  question: "The old propose, pay, change-owners, grant, revoke and request-approval each checked `owner-safe-proposals`. Keep it, and where?",
  options: [
    { label: "every-proposal", text: "`board.propose` and `board.proposals.approve` refuse with it off and name it on the approval, so a gate turned off later stops the send." },
    { label: "board-commands-only", text: "Only board's own commands check it." },
    { label: "drop", text: "Drop the gate." },
  ],
  chosen: "every-proposal",
  why:
    "Approve #5 keeps it ('no approval opens, and a gate turned off later stops the send'), and approvals stops a send " +
    "only for the gate an approval names (approvals.gate). The old code gated every way a Director proposal was made, so " +
    "checking it once in `board.propose` keeps that for budgets', payments' and agents' proposals too. Manage books also " +
    "needs the `books` gate, as grant #4 says. The gates are read from access' feature flags through its evaluator.",
  source: by(`${OLD}/members/operations/grant.ts:158; ${OLD}/proposals/operations/request-approval.ts:60; books/target/approvals/decisions.ts:227`),
  affects: [procedure_board_propose, rpc_board_proposals_approve, rpc_board_officers_grant, rpc_board_officers_revoke, table_feature_flags, error_FEATURE_NOT_AVAILABLE],
});

export const decision_board_reject_dated_payments = defineDecision({
  id: "board.reject-dated-payments",
  title: "A dated Board payment's proposal can be rejected like any other",
  question: "`org proposal reject` refused a scheduled payment, because it had no nonce to use up. On v4 it has one. Keep the refusal?",
  options: [
    { label: "rejectable", text: "Reject it like any proposal: its nonce is used up and the schedule is never made." },
    { label: "keep-refusal", text: "Keep refusing it WRONG_STATE." },
  ],
  chosen: "rejectable",
  why:
    "The refusal existed only because the old scheduled lane had no nonce. Refusing would leave the Directors no way to " +
    "stop a dated payment they will not approve except waiting forever. The code is unchanged (WRONG_STATE still answers " +
    "a rejection of a rejection or of a settled proposal); one of its reasons goes.",
  source: by(`${OLD}/proposals/operations/reject.ts:31; org.proposal.reject refusals`),
  affects: [rpc_board_proposals_reject, op.operation_org_proposal_reject],
});

// ── Board changes ───────────────────────────────────────────────────────────────────────────

export const decision_board_changes = defineDecision({
  id: "board.changes",
  title: "Board changes from a person's own Safe: one process each, one at a time",
  question:
    "Seats, removals, the threshold, the handover, a claim and a refresh are approvals from one person's Safe, never " +
    "proposals. How are they kept, and may two run at once?",
  options: [
    {
      label: "one-at-a-time",
      text: "One `board-changes` row with its approval and one process each; one change under way per Organization.",
    },
    { label: "per-person", text: "As the old code: one per member for seats and removals, one threshold, a handover against all." },
    { label: "approvals-only", text: "No board row: the approval's subject is the change." },
  ],
  chosen: "one-at-a-time",
  why:
    "Each change is planned from the Board as it stands (the Directors and threshold before and after, the hat's supply, " +
    "who lapsed), so a second running beside it can make its plan wrong: a removal beside a threshold rise trips the " +
    "Gate's ThresholdTooLow, two seats beside a full hat both raise the supply. Where the old rules differed by kind, the " +
    "stricter wins (P10 rung 3) and every frozen refusal still holds. The row keeps what the frozen reads return (`dc_` " +
    "id, person, removed, counts) and what the chain made of it; the calls and the send are the approval's. Its process " +
    "replaces the old follow job and record-outcome.",
  source: by(`${OLD}/directors/rules.ts:130-200; ${OLD}/directors/writes.ts:119-267`),
  affects: [table_board_changes, machine_board_change, workflow_board_changes_carry, rpc_board_directors_seat, rpc_board_directors_remove, rpc_board_directors_set_threshold, rpc_board_directors_hand_over, rpc_board_directors_refresh, rpc_board_directors_claim],
});

export const decision_board_top_hat_refusals = defineDecision({
  id: "board.top-hat-refusals",
  title: "After the handover, the top hat's commands answer RESERVED_MATTER",
  question:
    "The frozen refusal for seat, remove and threshold is ROLE_PERMISSION_DENIED for a caller without the Shareholders' " +
    "top hat; the designed text adds RESERVED_MATTER once the Governor holds it. Which applies when?",
  options: [
    { label: "split", text: "RESERVED_MATTER when the Governor wears the top hat; ROLE_PERMISSION_DENIED for anyone else without it." },
    { label: "permission-only", text: "Always ROLE_PERMISSION_DENIED." },
  ],
  chosen: "split",
  why:
    "The designed text is the v4 surface (P10 rung 1): after the handover the matter belongs to the shareholders, and the " +
    "founder should be told to put it to a vote rather than that they lack a permission. Elections attached to the " +
    "Director hat's eligibility are WRONG_STATE, also as designed. The handover itself keeps ROLE_PERMISSION_DENIED and " +
    "WRONG_STATE, as its designed refusals do.",
  source: by("org.board.director.add, org.board.director.remove and org.board.threshold designed refusals"),
  affects: [rpc_board_directors_seat, rpc_board_directors_remove, rpc_board_directors_set_threshold, error_RESERVED_MATTER],
});

export const decision_board_handover_equity = defineDecision({
  id: "board.handover-equity",
  title: "The handover reads the equity install from the chain and board's own proposals",
  question:
    "`org board handover` waits for the equity setup's Board batch and sends the founder calls `buildEquity` returns. " +
    "Board cannot depend on equity. How does it know equity is installed, and where do the calls come from?",
  options: [
    {
      label: "chain-and-proposal",
      text:
        "Installed when indexing's chain-deployments holds the company's Governor and the equity install's Board proposal " +
        "(opener equity) executed; board builds the three Hats calls from the deployment's hat ids and the Governor.",
    },
    { label: "call-build-equity", text: "Call `Installer.buildEquity` live with the equity install's parameters." },
    { label: "depend-on-equity", text: "Read equity's tables." },
  ],
  chosen: "chain-and-proposal",
  why:
    "Equity sits above board, so its tables are out of reach; the Governor is a chain fact and the install's Board batch is " +
    "a proposal board itself stores, so both are board's to read. `buildEquity` needs the share classes and terms only " +
    "equity knows; its founder calls are fixed (the Director hat's eligibility and toggle, then the top hat last), so " +
    "board builds the same calls and the claim's chain observer checks they equal them, as the old code did.",
  source: by(`${OLD}/directors/operations/handover.ts:17-60; ${OLD}/directors/external/handover.ts`),
  affects: [rpc_board_directors_hand_over, op.operation_org_board_handover, table_board_proposals],
});

export const decision_board_claim_seat = defineDecision({
  id: "board.claim-seat",
  title: "`--seat` names nothing but the one Director hat until Board elections exist",
  question: "`org board claim --seat <group>` picks a seat group when elected to more than one. No seat groups exist yet (CAP-1153). What does it do?",
  options: [
    { label: "one-hat", text: "Accept it; any group but the Board's one Director hat is INVALID_INPUT, and `seat` stays null." },
    { label: "drop-flag", text: "Drop the flag." },
  ],
  chosen: "one-hat",
  why: "The flag is frozen surface (P10 rung 1). Until elections create seat hats the only hat to claim is the Director hat, and saying so is better than ignoring the flag.",
  source: by("org.board.claim designed flags; org.board.show notes (CAP-1153)"),
  affects: [rpc_board_directors_claim, table_board_changes],
});

export const decision_board_live_board_reads = defineDecision({
  id: "board.live-board-reads",
  title: "The Board reads ask the chain live; proposal reads read tables",
  question: "The Board reads say 'as the chain answers it now'; the proposal reads were settled from the chain on every read. What reads live?",
  options: [
    { label: "split", text: "Owners, threshold and each owner's `isValidSigner` live from the chain; proposals from board's tables and indexing's approvals." },
    { label: "all-indexed", text: "Everything from indexing's views." },
    { label: "all-live", text: "Everything live, settling proposals on read as before." },
  ],
  chosen: "split",
  why:
    "Whether the Gate accepts a lapsed owner's signature is the Gate's live answer (`isValidSigner`), which no event " +
    "records when a term simply ends, so the Board reads ask it (chain-read). A proposal's status changes only when its " +
    "nonce is used, which its process settles from the indexed execution, so reading it needs no chain call and stays " +
    "within `read`; its approvals so far are indexed ApproveHash events joined to the Safe's owners now.",
  source: by(`${OLD}/proposals/operations/safe.ts; ${OLD}/proposals/rules.ts:180`),
  affects: [rpc_board_directors_show, rpc_board_directors_safe, rpc_board_proposals_get, rpc_board_proposals_list, rpc_board_directors_get],
});

// ── officer hats ────────────────────────────────────────────────────────────────────────────

export const decision_board_officer_changes = defineDecision({
  id: "board.officer-changes",
  title: "Officer hat changes are settled by their proposal's process; Seat permissions go",
  question:
    "Old grants wrote `seatPermissionChanges` and, once executed, `seatPermissions`, which books and requests checked. On " +
    "v4 the permission is the hat. What does board keep, and who settles it?",
  options: [
    {
      label: "change-only",
      text: "Keep the change (what the frozen grant and revoke return), settled in the proposal's settling transaction; drop the permission rows.",
    },
    { label: "own-process", text: "A durable process per officer change, following proposal_transitioned." },
    { label: "as-is", text: "Keep both tables." },
  ],
  chosen: "change-only",
  why:
    "Capxul reads a permission only from Hats (CAP-1101, responsibilities.keepers), so a permission row would copy the " +
    "chain. The change is still needed: its `spc_` id and state are frozen returns, one waits per member and permission, " +
    "and a grant's plan counts the seats waiting grants will take. Its proposal is board's own, so settling both in one " +
    "transaction needs no outbox hop and no second process; it applies only when the execution's indexed facts hold the " +
    "hat's mint or burn.",
  source: by(`${OLD}/members/writes/permissions.ts:133-260; ${OLD}/proposals/writes/subjects.ts:55`),
  affects: [table_officer_changes, machine_officer_change, workflow_board_proposals_carry, rpc_board_officers_grant, rpc_board_officers_revoke, rpc_board_officers_get],
});

export const decision_board_withdraw_on_settle = defineDecision({
  id: "board.withdraw-on-settle",
  title: "A settled proposal withdraws its Directors' unsigned approvals",
  question: "When a proposal's nonce is used, Directors may still have approvals of it open and unsigned. What happens to them?",
  options: [
    { label: "withdraw", text: "The settling transaction withdraws each through `approvals.withdraw`." },
    { label: "expire", text: "Leave them to expire with their sponsorship." },
  ],
  chosen: "withdraw",
  why:
    "Nobody should be asked to sign for a nonce already used; the approvals designer added the procedure for exactly this " +
    "case (an ended intent takes its unsigned carrier). A signed approval is left to the chain, which ends it as reverted or displaced.",
  source: by("books/target/approvals/procedures.ts:72 (approvals.withdraw)"),
  affects: [workflow_board_proposals_carry, procedure_approvals_withdraw],
});

// ── the old `org director` commands ─────────────────────────────────────────────────────────

export const decision_board_director_commands = defineDecision({
  id: "board.director-commands",
  title: "The four `org director` writes refuse WRONG_STATE; pre-v4 lines retire",
  question:
    "`org director add`, `remove`, `replace` and `threshold` propose the company Safe's own owner calls, which the v4 " +
    "Signer Gate refuses (`CannotCallSafe`); every target Organization is v4 (P9). The designed text moves them to `org " +
    "board`, with no alias. What do the four frozen operations become?",
  options: [
    {
      label: "refuse",
      text:
        "Each SDK method fails WRONG_STATE before any rpc, naming its v4 command; lines that state a refusal stay, lines " +
        "that describe the pre-v4 owner change retire as null, and line 1 becomes the refusal.",
    },
    { label: "alias", text: "Run the matching `org board` change." },
    { label: "board-proposal", text: "Propose the v4 calls as a Board batch." },
  ],
  chosen: "refuse",
  why:
    "This is what the old system already answers on a v4 company (`ownerChangeGated`, WRONG_STATE naming `org board`), so " +
    "the rewritten line 1 passes against it (P1). An alias is ruled out by the designed text; a Board batch cannot work, " +
    "because the Director hat's admin is the Shareholders' top hat, not the company Safe. The other frozen refusals " +
    "(not a Director, not a member, not signed up) cannot happen once nothing is read, so each operation lists only " +
    "WRONG_STATE; lines like 'removing the last Director is refused' still hold and are kept. `org director list` is a " +
    "v4 read and is unchanged.",
  source: by(`${OLD}/proposals/operations/change-owners.ts:35; ${OLD}/proposals/errors.ts:112; org.board.director.add and org.director.threshold designed text`),
  affects: [
    flow_client_org_directors_add,
    flow_client_org_directors_remove,
    flow_client_org_directors_replace,
    flow_client_org_directors_set_threshold,
    op.operation_org_director_add,
    op.operation_org_director_remove,
    op.operation_org_director_replace,
    op.operation_org_director_threshold,
  ],
});

// ── acceptance and refusals ─────────────────────────────────────────────────────────────────

export const decision_board_acceptance_events = defineDecision({
  id: "board.acceptance-events",
  title: "Lines about the old Board events name each machine's one event",
  question:
    "Lines of the six Board changes say a landing 'posts `board_seat_transitioned`' or `board_threshold_transitioned`; " +
    "grant and revoke say 'it schedules one event'. P7 keeps one event per machine. How are the lines kept?",
  options: [
    { label: "rename", text: "Rewrite each as 'reports `board_change_transitioned` (`<transition>`) once', or `officer_change_transitioned` (`propose`), keeping what it carries and omits." },
    { label: "retire", text: "Retire them as telemetry." },
  ],
  chosen: "rename",
  why:
    "The claims are about what a funnel sees exactly once and what it never carries (an email, a Safe, the Seat, the " +
    "note), which the trace observer checks on the target's event; only the event's name is a mechanism. The old " +
    "transition names map to the machine's: claimed to claim, seated to seat, removed to remove, lapsed to lapse, " +
    "handed_over to hand_over, set to set_threshold. The claim's 'seated as of its block' part is kept.",
  source: by("P1, P7; org.board.* acceptance (events.test.ts lines); org.member.grant #5, org.member.revoke #4"),
  affects: [...BOARD_CHANGE_OPERATIONS, op.operation_org_member_grant, op.operation_org_member_revoke, event_board_change_transitioned, event_officer_change_transitioned],
});

export const decision_board_acceptance_pre_v4 = defineDecision({
  id: "board.acceptance-pre-v4",
  title: "Pre-v4 lines and clauses: one retired, one clause cut, the v4 openings stripped",
  question: "Which board lines describe pre-v4 behaviour, and what becomes of them (P9)?",
  options: [
    {
      label: "p9",
      text:
        "`org board show` #3 (a pre-v4 Organization refused) retires as null; `org member grant` #8 loses 'and is refused " +
        "before v4'; grant #6, #7 and revoke #5 lose 'On a v4 company'.",
    },
    { label: "keep", text: "Keep them verbatim." },
  ],
  chosen: "p9",
  why:
    "P9 names show #3 as one of the two pre-v4-only lines and grant #8 as one of the two with a pre-v4 clause; no pre-v4 " +
    "Organization exists in the target, so neither can be observed. The openings are P9's mechanical strip. The " +
    "refusals' FEATURE_NOT_AVAILABLE for 'Manage people before v4' becomes the gates' refusal, which is what that code " +
    "still means on v4 (board.proposals-gate); approve gains it as a refusal because its line #5 already claims it.",
  source: by("docs/decisions/policy-pack.md P9 (org.board.show #3, org.member.grant #8)"),
  affects: [op.operation_org_board_show, op.operation_org_member_grant, op.operation_org_member_revoke, op.operation_org_proposal_approve],
});

export const decision_board_worlds = defineDecision({
  id: "board.worlds",
  title: "The worlds board's refusals and claims are reached from",
  question: "Which devnet snapshots does board introduce, and what does each hold?",
  options: [
    {
      label: "nine",
      text:
        "org-with-founder-board: a v4 Organization fresh from setup, its founder the one Director (1 of 1) wearing the " +
        "Shareholders' top hat, a set-up member, a member who has not finished signing up, a signed-in outsider. " +
        "org-with-two-directors: that member seated, 2 of 2. org-with-waiting-proposals: two proposals waiting at " +
        "consecutive nonces, one executed, one rejected, one replaced outside Capxul, a waiting rejection, a member " +
        "wearing the Books hat and a waiting Invoicing grant. org-with-board-change-waiting: a seat waiting for the " +
        "founder's approval. org-with-lapsed-director: the second Director's hat ruled out while still an owner. " +
        "org-with-board-handed-over: equity installed and handed to the Governor. org-with-setup-awaiting-install: no " +
        "deployment yet. org-with-proposals-gate-off: `owner-safe-proposals` off. cli-signed-out (shared with budgets).",
    },
    { label: "per-refusal", text: "One world per refusal." },
  ],
  chosen: "nine",
  why:
    "Most refusals are reached by who runs the command in a small Board (the founder, the second Director, a member, an " +
    "outsider); waiting proposals, a waiting change, a lapsed hat, the handover and a gate change what every write " +
    "answers, so each is its own world. Each is built by running operations from org-with-founder-board, except the " +
    "lapsed hat, which the founder rules out on chain outside Capxul.",
  source: by("books/frozen/operations.ts (org.board.*, org.director.*, org.member.grant, org.member.revoke, org.proposal.*)"),
  affects: [
    ...BOARD_CHANGE_OPERATIONS,
    op.operation_org_board_show,
    op.operation_org_director_add,
    op.operation_org_director_list,
    op.operation_org_director_remove,
    op.operation_org_director_replace,
    op.operation_org_director_threshold,
    op.operation_org_member_grant,
    op.operation_org_member_revoke,
    op.operation_org_proposal_approve,
    op.operation_org_proposal_get,
    op.operation_org_proposal_list,
    op.operation_org_proposal_reject,
    op.operation_org_proposal_wait,
  ],
});

// ── what does not survive ───────────────────────────────────────────────────────────────────

export const decision_board_dropped = defineDecision({
  id: "board.dropped",
  title: "The old proposals', directors' and grants' plumbing is not ported",
  question: "Which old rpcs and workflows of organizations/proposals, organizations/directors and permissions/grants have no target record?",
  options: [
    {
      label: "drop",
      text:
        "Raw `propose` and `changeOwners` (no frozen command on v4), `pay` and `cancelScheduled` (payments'), every " +
        "`sendSigned` (approvals'), `load`, `ownerLabels`, `ownerCandidates`, `paymentRecipient`, `record`, " +
        "`recordSubmission`, `recordOutcome`, `settle` and `emitBoardTransitioned` (steps or transitions now), " +
        "`noticeFacts` and `notify` (notices'), the directors' follow job (the change's process), and the granter key's " +
        "reserve, sign, broadcast, drive, verify and retry (P9: grants are Board batches).",
    },
    { label: "port", text: "Port each as an rpc or workflow." },
  ],
  chosen: "drop",
  why:
    "P2 keeps only what an operation, flow step, signal or trigger reaches; each of these was a step of one operation, " +
    "an outside call now owned by approvals or notices, or a pre-v4 path. Events are sent by transitions (P7), so an " +
    "emit rpc has nothing to do. Old staging keeps running these until Aaron turns it off.",
  source: by("books/as-is/organizations/proposals.ts, directors.ts; books/as-is/permissions/grants.ts"),
  affects: [table_board_proposals, table_board_changes, workflow_board_proposals_carry, workflow_board_changes_carry, rpc_board_directors_get],
});

// ── assembly ────────────────────────────────────────────────────────────────────────────────

export const decision_board_people_hat_role_conflict = defineDecision({
  id: "board.people-hat-role-conflict",
  title: "Granting the People hat to a department's office holder is ROLE_CONFLICT",
  question:
    "Budgets refuses a department's or team's office to a wearer of the People hat (budgets.role-conflict-people-hat) and " +
    "asks board for the reverse. `org member grant`'s frozen page lists no ROLE_CONFLICT, and board sits below budgets, " +
    "so it cannot read which budgets are departments. Does the grant refuse, and how does it know?",
  options: [
    {
      label: "chain-offices",
      text:
        "Refuse `manage-people` with ROLE_CONFLICT when the member's Safe wears a department's or team's office hat, read " +
        "from indexing: a budget's hat where the budget is a top budget, or its hat's admin is its parent budget's hat.",
    },
    { label: "any-budget-hat", text: "Refuse when the member's Safe wears any budget's hat, an allowance's included." },
    { label: "none", text: "Keep the frozen refusal list: the grant never checks the office." },
  ],
  chosen: "chain-offices",
  why:
    "P10 rung 3: this is authority, so the stricter version wins until a matter rules. The old Manage people grant " +
    "refused a department holder (permissions/guards/conflicts.ts, ADR-0040), and on v4 Manage people is this grant, so " +
    "without the check one person could hold an office and Manage allowances by asking in the other order. ROLE_CONFLICT " +
    "is already a frozen code with that meaning. Budgets' designed creates place the hats so the chain tells them apart: " +
    "a top department's hat and an allowance's hat sit under the Board's top hat, a team's under its parent's office hat, " +
    "and only an allowance is a child budget with its hat under the top hat. Refusing allowance wearers too would be a " +
    "conflict the old system never had. The refusal is reached from budgets' world org-with-budget-tree.",
  source: by("packages/backend/src/permissions/guards/conflicts.ts:13; books/target/budgets/decisions.ts (budgets.role-conflict-people-hat); budgets/departments.ts, allowances.ts (hat placement); P10"),
  affects: [rpc_board_officers_grant, op.operation_org_member_grant, error_ROLE_CONFLICT, table_chain_budgets, table_chain_hats],
});

export const decision_board_approval_endings = defineDecision({
  id: "board.approval-endings",
  title: "A Board change's unlanded approval ends with approvals' frozen-code mapping",
  question:
    "Approvals asks every opener to map an approval's endings onto the frozen codes (approvals.machine). Board's change " +
    "process said only 'fails it with that code'. Which code does each ending give?",
  options: [
    {
      label: "approvals-map",
      text: "declined and withdrawn CANCELLED; expired and displaced WRONG_STATE; reverted TRANSACTION_FAILED; refused the code approvals stored.",
    },
    { label: "one-code", text: "TRANSACTION_FAILED for every unlanded ending." },
  ],
  chosen: "approvals-map",
  why:
    "The frozen pages of `org board` commands refuse only CANCELLED, WRONG_STATE and the sponsorship codes, and the " +
    "change flows already declare CANCELLED, WRONG_STATE and TRANSACTION_FAILED. A person's no is CANCELLED (the " +
    "vocabulary merged SIGNER_REJECTED into it), a lapse or a used nonce is a state that no longer allows the change, " +
    "and a refusal at sponsorship already carries its own code (integrations.sponsor-refusals). Agents maps its " +
    "carriers the same way (agents.failure-codes), so one CLI answers alike. A proposal's own end (`fail`, `reject`, " +
    "`replace`) is board's and reads as `failed`, `rejected` or `replaced` (board.failed-proposal).",
  source: by("books/target/approvals/decisions.ts (approvals.machine); books/target/board/flows.ts (CHANGE_ERRORS); books/target/agents/decisions.ts (agents.failure-codes)"),
  affects: [workflow_board_changes_carry, table_board_changes, machine_board_change],
});
