// Every judgment the payments design makes, as a decision record (rule 10 of CONVENTIONS.md). Made by Claude
// on 8 November 2026 under the accepted A1-A4 and P1-P10, with docs/as-is/payments.md, books/as-is/payments/
// and the old code (/home/user/factory, integration/factory) as evidence.
//
// Old against new: 82 old Convex functions (71 rpcs, 11 workflows), 65 door procedures, 8 SDK flows, 13
// tables and 8 machines become 8 rpcs, 3 workflows, 1 procedure, 6 flows, 3 tables and 2 machines
// (decision payments.count).

import { defineDecision } from "../../../packages/book/src/index.ts";
import { concept_payments } from "../shared/foundation.ts";
import { contract_payments, integration_indexer } from "../shared/external.ts";
import { error_PAYROLL_BUDGET_EXCEEDED, error_ROLE_PERMISSION_DENIED } from "../shared/vocabulary.ts";
import { rpc_payments_changes_cancel, rpc_payments_changes_reschedule, rpc_payments_changes_retry } from "./changes.ts";
import { rpc_payments_commands_prepare, rpc_payments_commands_propose } from "./commands.ts";
import {
  event_movement_transitioned,
  event_payment_transitioned,
  machine_movement,
  machine_payment,
  table_movements,
  table_payment_commands,
  table_payments,
} from "./data.ts";
import {
  flow_client_org_departments_pay,
  flow_client_payments_cancel,
  flow_client_payments_pay,
  flow_client_payments_reschedule,
  flow_client_payments_retry,
  flow_client_payments_subscribe,
} from "./flows.ts";
import { rpc_payments_ledger_get, rpc_payments_ledger_list, rpc_payments_ledger_watch } from "./ledger.ts";
import {
  operation_org_department_pay,
  operation_payment_cancel,
  operation_payment_get,
  operation_payment_list,
  operation_payment_reschedule,
  operation_payment_retry,
  operation_payment_send,
  operation_payment_wait,
} from "./operations.ts";
import { procedure_payments_prepare_command } from "./procedures.ts";
import {
  workflow_payments_lifecycle_payment,
  workflow_payments_movements_record,
  workflow_payments_settlement_observe,
} from "./processes.ts";

const CLAUDE = "Claude, payments design, 8 November 2026";
const by = (evidence: string) => `${CLAUDE}; evidence: ${evidence}`;
const ASIS = "docs/as-is/payments.md";
const P = machine_payment.t;

const OPERATIONS = [
  operation_payment_send,
  operation_payment_retry,
  operation_payment_cancel,
  operation_payment_reschedule,
  operation_payment_get,
  operation_payment_list,
  operation_payment_wait,
  operation_org_department_pay,
];

// ── data ────────────────────────────────────────────────────────────────────────────────────

export const decision_payments_three_tables = defineDecision({
  id: "payments.three-tables",
  title: "Three tables replace the old thirteen",
  question: "Which of the old 13 payments tables does the target keep, merge or drop?",
  options: [
    {
      label: "three",
      text:
        "payment-commands (with the document intents), payments (with dated payments, consumed evidence and mismatches) and " +
        "movements (outside money only); executions to approvals; Transfer copies, scan checkpoints and the sweep cursor gone.",
    },
    { label: "port", text: "Port the 13 tables as they are, in Postgres." },
    { label: "per-route", text: "A table per route (sends, budget spends, Board batches, escrows, dated payments)." },
  ],
  chosen: "three",
  why:
    "Each old store that went is a duplicate or plumbing. money-executions and provider-send-attempts are approvals' now " +
    "(concepts.approvals). movements copied Ponder's Transfer logs and movement-scan-checkpoints was the scan's cursor: " +
    "Ponder indexes Transfers and indexing serves them. settlement-sweep-cursors existed for a minute sweep a chain-event " +
    "wait replaces (P3). payment-schedules held signed bytes (approvals' held operation) and a lease (the process's " +
    "timer); what remains is `pay_at`, `scheduled_id` and `shortfall` on the Payment. commitment-evidence's job (single " +
    "use, K9) is a unique index on the settled log; its preState replay was for V2 commitments (P9). " +
    "payment-evidence-conflicts is the `mismatched` state with its first differing term. payment-document-intents is the " +
    "command's request digest, which covers the document hashes. deposit-materializations went with Deposit Payments " +
    "(payments.movements-outside-money). Per-route tables would split one ledger the activity feed and books must read as one.",
  source: by(`${ASIS} (plumbing, K1, K9, M5, D9); books/as-is/payments/data.ts (13 tables)`),
  affects: [table_payment_commands, table_payments, table_movements, concept_payments],
});

export const decision_payments_command_without_state = defineDecision({
  id: "payments.command-without-state",
  title: "A command is an idempotency record with no state of its own",
  question: "The old command had a state and a verification lease. What does the target command keep?",
  options: [
    { label: "record", text: "Owner, request key, request digest, route, purpose and the approval or proposal it opened; no machine." },
    { label: "machine", text: "Keep a command machine (prepared, submitted, settled, failed) beside the Payments'." },
  ],
  chosen: "record",
  why:
    "K1 needs only the key, the digest and what the command birthed: a repeat answers the first command as its Payments and " +
    "approval stand, another request under the key is refused by the digest, and the key stays closed for good. The old " +
    "command state duplicated its Payments' (prepared ⇄ submitted) and its verification lease was the sweep's bookkeeping, " +
    "which the Payment's process replaces; `applied` meant three things (old S6). A second machine would be a second " +
    "writer of the same outcome.",
  source: by(`${ASIS} (K1, S5, S6); packages/backend/src/payments/tables/commands.ts:9`),
  affects: [table_payment_commands, machine_payment],
});

export const decision_payments_two_sided_tenancy = defineDecision({
  id: "payments.two-sided-tenancy",
  title: "A Payment is held by one owner and read by both sides",
  question: "A Payment between two Capxul tenants is read by both. Whose tenant is its row (P8)?",
  options: [
    {
      label: "holder-and-payee",
      text:
        "`owner` tenancy: the payer when the payer is Capxul's, else the payee; the payee's tenant on the row with a " +
        "cross-tenant payee index; the generated policy admits either column. Labels snapshotted at birth.",
    },
    { label: "row-per-side", text: "One row per side, each with its own tenant, and the status copied to both." },
    { label: "payer-only", text: "The payer's tenant only; the payee reads its incoming money from Movements." },
  ],
  chosen: "holder-and-payee",
  why:
    "One row per side would copy the status into two rows that two transitions must keep equal: the duplicate store P9 " +
    "and old D1 warn about. Payer-only would hide a Payment from the person it pays, who must `payment get` it. Two tenant " +
    "columns keep one machine and let row-level security fail closed for anyone else. The labels (how the payer named the " +
    "payee, how the payee reads the payer) are written once at birth, so reads never reach into parties' tables, which " +
    "was the old projection's read-boundary bug on 27 records.",
  source: by(`${ASIS} (read-boundary 27, M8, D1); docs/decisions/policy-pack.md#p8`),
  affects: [table_payments, rpc_payments_ledger_get, rpc_payments_ledger_list],
});

export const decision_payments_machine = defineDecision({
  id: "payments.machine",
  title: "The Payment machine: nine states, every write a transition",
  question: "Which states does a target Payment have, and what goes from the old ten?",
  options: [
    {
      label: "nine",
      text:
        "prepared, scheduled, due, escrowed, submitted, needs_retry, settled, mismatched, cancelled; a birth is the `open` " +
        "transition from no state; only the Payment's process and the change rpcs drive it.",
    },
    { label: "old-ten", text: "pending, settling, in_transit, unresolved, pending_claim, scheduled, streaming, settled, cancelled, failed." },
  ],
  chosen: "nine",
  why:
    "`in_transit` is a bank payout's, so it is banking's payout machine (K13, dependencies.payments-banking). `streaming` " +
    "and `pending_claim` were V2 commitments (P9); a claim escrow is `escrowed`. `unresolved` existed because a receipt " +
    "could be missing; now approvals ends every approval on chain proof (K6) and the settlement waits for the indexed " +
    "fact, so nothing is unprovable. `failed` merged two meanings: an approval that ended without money moving is " +
    "`needs_retry` (retry sends the same payment id, so it cannot pay twice), and a Payment that will never move is " +
    "`cancelled` with its `outcome`. `due` gives notices the day-ahead warning approvals leaves to payments " +
    "(approvals.held-sends). `mismatched` keeps a fact that disagrees visible instead of booking it. A reorg reopens only " +
    "settled or mismatched (old S1), and nothing else writes `status` (old S3).",
  source: by(`${ASIS} (S1-S7, S9, K6, K13); books/target/approvals/decisions.ts (approvals.held-sends)`),
  affects: [machine_payment, event_payment_transitioned, table_payments],
});

export const decision_payments_movements_outside_money = defineDecision({
  id: "payments.movements-outside-money",
  title: "Movements are outside money only, one row per side",
  question: "What does payments keep of the old Movements, attributions and Deposit Payments?",
  options: [
    {
      label: "outside-money",
      text:
        "A Movement is a side of an indexed Transfer that no Payment of that side explains, booked as that side's outside " +
        "money in the same transaction; a Payment's own Transfer is never one; no Deposit Payments.",
    },
    { label: "attribute-all", text: "Keep a Movement for every Transfer, attributed to a Payment or not, and Deposit Payments for inbound ones." },
  ],
  chosen: "outside-money",
  why:
    "Ponder holds every Transfer, so a Movement row for a Payment's own Transfer would be a third copy of one fact; " +
    "suppressing it is K17. Judging each side on its own Payments fixes old M1, where a person's Deposit row made an " +
    "Organization's direct transfer look explained. Deposit Payments were Payments born for inbound Transfers with no " +
    "command, the same fact as the Movement; dropping them leaves one record per money fact. The book key is books' " +
    "`transfer:<chain>:<tx>:<log>`, which banking's deposits use too, so books keeps one live fact whoever writes first. " +
    "The old `observed` and `finalized` states had no reader (old S10).",
  source: by(`${ASIS} (M1, K17, S10, D6); books/target/books/procedures.ts (money_key)`),
  affects: [table_movements, machine_movement, event_movement_transitioned, workflow_payments_movements_record],
});

// ── time ────────────────────────────────────────────────────────────────────────────────────

export const decision_payments_one_process_per_payment = defineDecision({
  id: "payments.one-process-per-payment",
  title: "One durable process per Payment, absorbing the command's and the dated payment's",
  question:
    "rules.durable-processes gives a payment command and a dated payment one process each. Which instance owns a Payment's machine?",
  options: [
    {
      label: "per-payment",
      text:
        "One process per payments row, started by its birth, following its carrier, its dates, its escrow and its settlement; " +
        "a dated payment is a Payment with a date; a command has no process.",
    },
    { label: "per-command", text: "One process per command, driving all of its Payments, and one per dated payment." },
  ],
  chosen: "per-payment",
  why:
    "A Payment is the object that settles, lapses, is retried, rescheduled or cancelled on its own: `payment retry` and " +
    "`payment cancel` name one Payment, and a batch's items are scheduled and settled one by one (`payment send` #9). A " +
    "per-command process would hold N machines' worth of state; a per-dated-payment process would be a second owner of " +
    "the same machine. Each Payment process follows the shared approval, so a void still cancels every Payment of the " +
    "operation (K14), and the command keeps K1 without a process (payments.command-without-state). This drops the two " +
    "listed processes in favour of one, as rules.durable-processes allows with a decision.",
  source: by("A3; rules.durable-processes; payment.retry.yaml and payment.cancel.yaml (one payment id each)"),
  affects: [workflow_payments_lifecycle_payment, machine_payment, table_payments, table_payment_commands],
});

export const decision_payments_carrier_waits = defineDecision({
  id: "payments.carrier-waits",
  title: "The Payment's process follows its approval and proposal as waits",
  question: "How does a Payment's process learn that its approval was signed, sent, landed or ended, or its proposal executed?",
  options: [
    {
      label: "waits",
      text:
        "The process waits on its carrier: approvals' and board's events reach it by the opener and subject they carry; " +
        "approvals' sign and decline and payments' change rpcs are its signals.",
    },
    { label: "reactors", text: "One reacting workflow per approval transition (sign, accept, land, revert, displace, expire, decline, refuse)." },
    { label: "poll", text: "The process reads the approval row on a timer." },
  ],
  chosen: "waits",
  why:
    "The brief's shape is one process per Payment resumed by signals and waits. A reactor per transition would be eight " +
    "workflows each writing the same machine, which is the old system's many writers (S3) in a new form. Polling is the " +
    "sweep P3 removes. approval_transitioned carries `opener` and `subject_id` for exactly this (approvals' event), so " +
    "the runtime resumes the one instance waiting on it. The signature itself is approvals' signal (approvals owns the " +
    "one send, K4); listing approvals' sign and decline rpcs as this process's signals says the person's answer is what " +
    "moves the Payment. A Board proposal's `proposal_transitioned` is followed the same way.",
  source: by("A2, A3, P3; books/target/approvals/data.ts (event_approval_transitioned props)"),
  affects: [workflow_payments_lifecycle_payment],
});

export const decision_payments_dated = defineDecision({
  id: "payments.dated",
  title: "Dated payments: approvals holds the personal send, the process pays a budget's",
  question: "Who keeps a dated payment's day, its day-ahead check and its send, now that approvals owns every send?",
  options: [
    {
      label: "split-by-route",
      text:
        "Personal: one approval opened with `sendAfter` and the Safe's need, held and sent by approvals (K16 there). " +
        "Budget or Board: the reservation is on chain and this process asks `Budgets.execute` with the executor key on its " +
        "day, hourly while refused. Both come due a day ahead in this process.",
    },
    { label: "payments-sends", text: "Payments keeps the signed bytes and sends them on the day, as the old schedules did." },
  ],
  chosen: "split-by-route",
  why:
    "Approvals is the only sender of a person's operation (K4), so it holds a signed dated one and checks its needs on the " +
    "day (approvals.held-sends). `Budgets.execute` is not a person's operation: anyone may call it, and the executor key " +
    "is Capxul's (service-signer), so its timer is the Payment's. 'No retry window ends a dated budget payment: only the " +
    "chain does' (payment send notes): the process retries hourly until PaymentSent or ScheduleCancelled. The day-ahead " +
    "check stays the opener's, as `come_due`, so notices has a transition to warn the payer from. The old due-job cron " +
    "(every 5 minutes, 25 schedules under a lease) becomes one timer per Payment (P3).",
  source: by(`${ASIS} (K16, R4, R5, R7); payment.send.yaml notes (CAP-1238, CAP-1252); approvals.held-sends`),
  affects: [workflow_payments_lifecycle_payment, P.come_due, P.schedule, rpc_payments_commands_prepare],
});

// ── settlement ──────────────────────────────────────────────────────────────────────────────

export const decision_payments_one_settlement_path = defineDecision({
  id: "payments.one-settlement-path",
  title: "One settlement path: the Payment's process, from the indexed PaymentSent",
  question: "The old system settled from a receipt and from the indexed fact, with different checks. What settles a target Payment?",
  options: [
    {
      label: "indexed-fact",
      text:
        "Only the Payment's own process, from the indexed PaymentSent with its payment id read with every fact of its " +
        "transaction, every term compared, the log unique, the book fact in the same transaction; a Payment Capxul did not " +
        "prepare is born first and settled by the same step.",
    },
    { label: "receipt-and-index", text: "Keep both paths and make them check the same terms." },
    { label: "birth-settled", text: "Birth a Payment Capxul did not prepare directly as settled, from the chain-event workflow." },
  ],
  chosen: "indexed-fact",
  why:
    "Two paths racing were old M2-M4: different terms checked, side effects copied at five sites, a Memo or evidence row " +
    "depending on which arrived first. One step makes K7 (the union of both old checks: Payments' address, chain, sender " +
    "Safe, recipient, token, raw amount, kind, document hash; the sender is the one term v4's payment id does not hash), " +
    "K8 (settle once: the transition moves only from an open state), K9 (the unique log) and K10 (the book fact in the " +
    "transaction) true in one place. Birthing a chain-born Payment settled would be a second settle site; birthing it " +
    "`prepared` and letting its process settle it costs one transaction and keeps the path single.",
  source: by(`${ASIS} (M2, M3, M4, K7-K10); integrations.indexer (factsOf)`),
  affects: [
    P.settle,
    workflow_payments_lifecycle_payment,
    workflow_payments_settlement_observe,
    contract_payments,
    integration_indexer,
    table_payments,
  ],
});

export const decision_payments_reorg = defineDecision({
  id: "payments.reorg",
  title: "Settle at the finality depth, confirm later, reverse forward",
  question: "How does a target Payment or Movement keep K12 (reorgs reverse what they removed) without the old any-status reset?",
  options: [
    {
      label: "confirm",
      text:
        "Consume a fact at the deployment's finality depth; read it again at twice that depth; if it is gone, `unsettle` " +
        "(or `remove`) and reverse the book fact in one transaction.",
    },
    { label: "trust-depth", text: "Consume at the finality depth and never look again." },
    { label: "head", text: "Settle at Ponder's head and watch every block for a reorg." },
  ],
  chosen: "confirm",
  why:
    "The finality depth is a setting, not a law: a deeper reorg, or Ponder rebuilding past it, would leave a settled " +
    "Payment with a book fact for money the chain no longer shows. One more read per Payment is cheap and makes K12 a " +
    "declared transition from `settled` only (old S1 reopened failed and in-transit Payments too). Settling at the head " +
    "would make every settlement provisional and every reader care.",
  source: by(`${ASIS} (K12, S1, S2); books/target/approvals/data.ts (land at the finality depth)`),
  affects: [P.unsettle, machine_movement, workflow_payments_lifecycle_payment, workflow_payments_movements_record],
});

// ── boundaries ──────────────────────────────────────────────────────────────────────────────

export const decision_payments_prepare_command = defineDecision({
  id: "payments.prepare-command",
  title: "The door takes the invoker's funding read and stored documents",
  question: "`payments.prepare-command` cannot call the chain, and K3 needs funding read before birth. How does a request's or payout's birth keep it?",
  options: [
    {
      label: "invoker-reads",
      text:
        "The invoking rpc reads the paying Safe's balance or the budget's left before its transaction and passes it with the " +
        "block; the procedure refuses a shortfall and writes nothing; documents come already stored; it invokes only approvals.open.",
    },
    { label: "payments-rpc", text: "The invoker's flow calls a payments rpc to prepare, and requests links to it afterwards." },
  ],
  chosen: "invoker-reads",
  why:
    "A request paid and its Payment are one money fact (dependencies.payments-requests), so they must commit together; a " +
    "payments rpc called after would leave a paid request with no Payment if it failed. The read is server code of a " +
    "concept that depends on payments, at a named block, so the procedure can check it. The invoice or payout document is " +
    "the invoker's, stored when the request was issued, so the transaction spans requests (or banking), payments and " +
    "approvals: two procedures from two other concepts, within sys:tx-width.",
  source: by(`${ASIS} (K2, K3, a birth owned by two concepts); rules.procedures; P4`),
  affects: [procedure_payments_prepare_command],
});

export const decision_payments_birth_width = defineDecision({
  id: "payments.birth-width",
  title: "A send's birth invokes three procedures from three concepts",
  question: "prepare and propose invoke parties.resolve-recipient, documents.store and approvals.open or board.propose: wider than sys:tx-width allows. Split it?",
  options: [
    { label: "one-transaction", text: "Keep the three in the birth's transaction." },
    { label: "name-first", text: "Resolve and name the payee in an earlier transaction, then birth with two procedures." },
  ],
  chosen: "one-transaction",
  why:
    "Each is the same money fact as the Payment: the payee and the Safe its money routes to (a wrong binding pays the " +
    "wrong Safe), the document whose hash goes on chain (a hash with no content is a money bug), and the carrier (nobody " +
    "may sign a payment Capxul has no record of). Naming first would leave named Parties for births that then failed, " +
    "and K2 says the command, its Payments and their documents are born together. The width is three procedures, at the " +
    "rule's limit of three, from three concepts instead of two: this record is the decision P4 asks for.",
  source: by(`${ASIS} (K2); P4 (sys:tx-width); books/target/parties/procedures.ts (resolve-recipient's money fact)`),
  affects: [rpc_payments_commands_prepare, rpc_payments_commands_propose],
});

export const decision_payments_board_rpc = defineDecision({
  id: "payments.board-rpc",
  title: "A Board payment is its own rpc",
  question: "`--as-directors` births a Board proposal instead of an approval. One prepare rpc or two?",
  options: [
    { label: "two", text: "`payments.commands.prepare` (approval) and `payments.commands.propose` (Board proposal); the flow calls one." },
    { label: "one", text: "One prepare rpc that invokes approvals.open or board.propose by the flag." },
  ],
  chosen: "two",
  why:
    "Each rpc's `invokes` then lists what its transaction really does, so sys:tx-width and the generated authorization " +
    "(a Director against a hat wearer) are per rpc. The calls differ too: an immediate Board payment cannot be a budget " +
    "spend from inside a Safe transaction (the Gate refuses re-entry), so it is `approve` and `Payments.send` from the " +
    "company Safe, while a member's is `Budgets.spend`.",
  source: by("payment.send.yaml (designed call, NoReentryAllowed); dependencies.board-below-proposers"),
  affects: [rpc_payments_commands_prepare, rpc_payments_commands_propose, flow_client_payments_pay],
});

export const decision_payments_reschedule = defineDecision({
  id: "payments.reschedule",
  title: "A reschedule births a new Payment; a personal one in two runs of one rpc",
  question: "Does a rescheduled payment keep its row, and how does a personal one's void-then-new-date work?",
  options: [
    {
      label: "new-payment",
      text:
        "The old Payment is cancelled when the chain says so and a new one is born for the new day (new job nonce, so a new " +
        "payment id); a personal move is the same rpc run twice, the second once the void landed.",
    },
    { label: "move-in-place", text: "Keep one Payment and move it back to prepared with the new date." },
  ],
  chosen: "new-payment",
  why:
    "`payment reschedule` #3 says the old payment reads cancelled and the new one waits on its day, and on chain they are " +
    "two scheduled ids. A personal void consumes the held operation's nonce, so the new day needs a new operation; the " +
    "frozen notes say running it again after the void goes straight to the new date. Moving in place would need a " +
    "`scheduled → prepared` edge that only reschedules use, and would reuse a payment id the chain may still hold.",
  source: by("payment.reschedule.yaml (acceptance 3, notes, designed call)"),
  affects: [rpc_payments_changes_reschedule, flow_client_payments_reschedule, P.open],
});

export const decision_payments_reads_stay_home = defineDecision({
  id: "payments.reads",
  title: "Reads are one indexed page, answered from payments' own rows",
  question: "How do `payment get`, `list` and `wait` read, given the old list read everything and the projection read four neighbours?",
  options: [
    { label: "own-rows", text: "Payments' rows, the caller's own Party, membership and the carrier's approval; one page per call." },
    { label: "projection", text: "A projection that joins parties, organizations, documents and approvals per Payment." },
  ],
  chosen: "own-rows",
  why:
    "The old list read two whole indexes into one page (M14) and the projection read profiles' tables payments did not " +
    "depend on. With labels, the document id and the outcome on the row, a read needs only the caller's Party (to tell " +
    "'no Account' from 'not yours', old E5), the Seat for `--org`, and the approval for the execution line. `null` is " +
    "never an answer: a read that finds nothing the caller can see is INVALID_INPUT (`payment wait` #4).",
  source: by(`${ASIS} (M14, E2, E5, read-boundary)`),
  affects: [rpc_payments_ledger_get, rpc_payments_ledger_list, rpc_payments_ledger_watch, flow_client_payments_subscribe],
});

// ── operations ──────────────────────────────────────────────────────────────────────────────

export const decision_payments_acceptance_rewrites = defineDecision({
  id: "payments.acceptance-rewrites",
  title: "Eight acceptance lines rewritten as outcomes; three v4 openings stripped",
  question: "Which of payments' 41 frozen acceptance lines name a mechanism a black box cannot see, and what replaces them?",
  options: [
    {
      label: "rewrite-eight",
      text:
        "Rewrite send #9, retry #1, cancel #2, reschedule #4, get #3, list #2, wait #1 and department pay #1 (plus the three " +
        "v4 openings of send #7, #8 and cancel #2) as observable claims, keeping each old line in `was`; keep the rest verbatim.",
    },
    { label: "verbatim", text: "Keep every line word for word." },
  ],
  chosen: "rewrite-eight",
  why:
    "P1: send #9 names the job-nonce lookup and a retry; retry #1 a nonce lane; get #3 and list #2 'schedule nothing' and " +
    "'Payment row'; wait #1 an unsubscribe; department pay #1 'sending re-proves the holder'; cancel #2 the schedule and " +
    "command rows. Each rewrite names what the cli, read, chain, trace or world observer sees and still passes against " +
    "the old system. Reschedule #4 says only a reschedule may cancel in Budgets, but payment cancel's v4 text cancels a " +
    "budget's dated payment with `Budgets.cancel` (P10: the designed text wins), so it now admits a cancel of that same " +
    "payment and still refuses any other scheduled id. P9 strips the 'On Protocol v4' openings; the old text stays in `was`.",
  source: by("docs/decisions/policy-pack.md#p1 (payment.send #9, payment.retry #1 examples); P9; payment.cancel.yaml designed"),
  affects: OPERATIONS,
});

export const decision_payments_designed_surface = defineDecision({
  id: "payments.designed-surface",
  title: "Where a designed block exists, its who and refusal codes are the operation's",
  question: "Five of payments' operations carry a v4 designed block whose `who` and refusals differ from the top-level text. Which wins?",
  options: [
    {
      label: "designed",
      text:
        "The designed `who`, and the union of the top-level and designed refusals, with the designed code where they " +
        "disagree: an over-budget department payment is PAYROLL_BUDGET_EXCEEDED, not ROLE_PERMISSION_DENIED `budget_exhausted`.",
    },
    { label: "top-level", text: "The top-level text, as the old CLI shipped it." },
  ],
  chosen: "designed",
  why:
    "P10 rung 1: surface goes to the book, and where `designed:` exists its v4 text wins (P9). The designed refusals add " +
    "what v4 can answer and the old surface could not: PAYROLL_BUDGET_EXCEEDED for OverBudget and the Roles ceiling, " +
    "WRONG_STATE for a closed budget, INVALID_INPUT for a date not in the future. `department pay` #4 still names " +
    "`budget_exhausted`: it is the reason, the code is the designed one. The top-level `who` lines are kept in the frozen " +
    "pages the operations point at.",
  source: by("docs/decisions/policy-pack.md#p10; books/frozen/operations.ts (designed blocks of send, retry, cancel, reschedule, department pay)"),
  affects: [...OPERATIONS, error_PAYROLL_BUDGET_EXCEEDED, error_ROLE_PERMISSION_DENIED],
});

export const decision_payments_worlds = defineDecision({
  id: "payments.worlds",
  title: "Seven worlds reach every payments refusal",
  question: "Which named devnet snapshots do payments' refusals start from?",
  options: [
    {
      label: "seven",
      text:
        "signed-out: no session on this machine. person-with-funded-safe: a signed-in person whose live Safe holds 1,000 " +
        "USDC, another person with a live Safe, and a mailbox with no account. person-with-empty-safe: a signed-in person " +
        "whose live Safe holds no USDC, with one payment whose approval expired. person-without-account: signed in with no " +
        "Party or Safe yet. person-with-payment-history: a person with a settled payment, a scheduled personal dated " +
        "payment, a payment whose approval expired, one received from another person, and a payment between two others.",
    },
    {
      label: "and-organizations",
      text:
        "org-with-budgets: an Organization with a funded company Safe, two Directors, an active department and a spending " +
        "allowance each with a holder, a closed department, a proposed department, a member who holds nothing and a " +
        "signed-in outsider. org-with-dated-payments: org-with-budgets plus a department's dated payment reserved in " +
        "Budgets, a Board-scheduled dated payment and a lapsed department payment larger than the department has left.",
    },
  ],
  chosen: "seven",
  why:
    "Each is made by running operations as the devnet's fixed identities and saved as a snapshot (environments.devnet), " +
    "named after what it holds. Seven cover all 36 refusals of the eight operations: a refusal that needs an approval to " +
    "lapse (SUPERSEDED) is reached by running the command in its world and moving the clock past the window.",
  source: by("books/target/shared/decisions.ts (environments.devnet, worlds); books/as-is/payments/operations.ts (27 refusals had no world)"),
  affects: OPERATIONS,
});

export const decision_payments_priority = defineDecision({
  id: "payments.priority",
  title: "`payment send` is critical; the other seven are normal",
  question: "Which payments operations are the spine's pilots (critical)?",
  options: [
    { label: "send", text: "`payment send` critical, with the process and the chain birth it rides on; the rest normal." },
    { label: "all-money", text: "Every money-moving payments operation critical." },
  ],
  chosen: "send",
  why:
    "Spec 40 makes the spine and its three pilots critical without naming the pilots here; `payment send` is the one " +
    "payments operation every money journey starts with, and it exercises every layer (flow, prepare rpc, procedures of " +
    "four concepts, the approval, the process, settlement and books). Marking all of them critical would leave the word " +
    "meaning nothing. Change it when the spine names its pilots.",
  source: by("docs/spec/40-capxul-team.md:23 (priority); books/target/CONVENTIONS.md rule 4 (priority)"),
  affects: [operation_payment_send, workflow_payments_lifecycle_payment, workflow_payments_settlement_observe],
});

// ── what went, what was kept ────────────────────────────────────────────────────────────────

export const decision_payments_dropped = defineDecision({
  id: "payments.dropped",
  title: "What the old payments concept had that the target does not port",
  question: "Which old payments functions, crons and behaviours are not ported, and where did each go?",
  options: [
    {
      label: "drop",
      text:
        "Plumbing (1 emit, 8 intent, 11 load, 3 record operations, 10 scheduler sites, 20 telemetry schedules) becomes steps " +
        "or the outbox; executions go to approvals; the three payment crons become waits; operator retries, inclusion " +
        "migrations, the money-writes switch and V2/V3 code paths go.",
    },
    { label: "port", text: "Port every function so the old behaviour is reproduced one to one." },
  ],
  chosen: "drop",
  why:
    "P3: a load, intent, record or emit is a step inside one rpc or workflow, and transition events leave through the " +
    "outbox (P7), so telemetry no longer decides money (M7). The crons: settlement verification recovery → the process's " +
    "own resume; scheduled payments due → one timer per Payment; settle from the indexer → the PaymentSent wait. " +
    "retry-mismatch and retry-unresolved had no caller (P2); migrate- and rollback-inclusion only renamed a stored value; " +
    "the 18 money-writes checks could never fire (D7). V2 commitments, V3 sends and their claims (K15) are pre-v4 (P9). " +
    "Payroll runs (K11) are dropped with runs (concepts.payroll). Bank delivery and return (K13) are banking's payout " +
    "machine. Schedule notices are notices' workflows on `payment_transitioned` (old R8, M9).",
  source: by(`${ASIS} (plumbing, crons, D7, K11, K13, K15, R8, M7, M9); P2, P3, P7, P9`),
  affects: [concept_payments, workflow_payments_lifecycle_payment, event_payment_transitioned],
});

export const decision_payments_keep_list = defineDecision({
  id: "payments.keep-list",
  title: "Where each money rule of the keep list lives in the target",
  question: "Each of K1-K18 is real money behaviour in the old code. Which target record keeps it?",
  options: [
    {
      label: "mapped",
      text:
        "K1 request key: payment-commands' unique key and digest. K2 born together: prepare's one transaction. K3 funding " +
        "before birth: prepare's reads and prepare-command's funding input. K4-K6 one send, execution binding, chain proof: " +
        "approvals. K7 exact terms, K8 settle once, K9 single use, K10 book fact: the process's settle step.",
    },
    {
      label: "and",
      text:
        "K12 reorgs: `unsettle` and `remove` with reversed book facts. K14 a void uses up the operation: every Payment of " +
        "the displaced approval cancels. K16 dated: approvals' held send and the process's timers. K17 a Payment's own " +
        "Transfer is not outside money: the Movements workflow. K18 Roles refusals: the bundler's sponsor failures. K11, " +
        "K13, K15: dropped or moved (payments.dropped).",
    },
  ],
  chosen: "mapped",
  why:
    "Every rule the reviewers kept has one named home, and the build links each home to the records here. Funding is " +
    "still read, not reserved: the old race of two unsent batches on one budget (M6) is closed by the chain, which refuses " +
    "the second at sponsorship before anyone signs, so the user hears it before signing rather than after landing.",
  source: by(`${ASIS} (What the target payments design must keep, K1-K18; M6)`),
  affects: [
    table_payment_commands,
    rpc_payments_commands_prepare,
    procedure_payments_prepare_command,
    workflow_payments_lifecycle_payment,
    workflow_payments_movements_record,
    P.settle,
    P.unsettle,
    P.cancel,
  ],
});

export const decision_payments_count = defineDecision({
  id: "payments.count",
  title: "Old against new: 82 functions and 13 tables become 18 behaviours and 3 tables",
  question: "How much of the old payments concept does the target need?",
  options: [
    {
      label: "count",
      text:
        "Old: 71 rpcs and 11 workflows (82 Convex functions: 17 public, 65 internal), 65 door procedures, 8 SDK flows, 13 " +
        "tables, 8 machines, 3 crons. New: 8 rpcs, 3 workflows, 1 procedure, 6 flows, 3 tables, 2 machines, no cron.",
    },
  ],
  chosen: "count",
  why:
    "The 8 frozen operations need 6 flows and 2 rpcs at the boundary, 6 more rpcs behind the flows (2 births, 3 changes, " +
    "1 live read), 1 door procedure for requests and banking, and 3 workflows for time and the chain. Everything else was " +
    "Convex's split of one write into many hops, executions now in approvals, pre-v4 paths, or stores that duplicated " +
    "Ponder. The 60 old door procedures with no booked caller have none now: their callers' needs are prepare-command, " +
    "the outbox (payment_transitioned) and plain reads of payments' tables.",
  source: by("books/as-is/payments/*.ts (record counts, 8 November 2026); docs/as-is/payments.md (82 functions, 65 procedures)"),
  affects: [
    concept_payments,
    rpc_payments_commands_prepare,
    rpc_payments_commands_propose,
    rpc_payments_changes_retry,
    rpc_payments_changes_cancel,
    rpc_payments_changes_reschedule,
    rpc_payments_ledger_get,
    rpc_payments_ledger_list,
    rpc_payments_ledger_watch,
    procedure_payments_prepare_command,
    flow_client_payments_pay,
    flow_client_org_departments_pay,
    flow_client_payments_retry,
    flow_client_payments_cancel,
    flow_client_payments_reschedule,
    flow_client_payments_subscribe,
    workflow_payments_lifecycle_payment,
    workflow_payments_settlement_observe,
    workflow_payments_movements_record,
  ],
});
