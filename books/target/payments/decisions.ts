// Every judgment the payments design makes, as a decision record (rule 10 of CONVENTIONS.md). Made by Claude
// on 8 November 2026 under the accepted A1-A4 and P1-P10, with docs/as-is/payments.md, docs/as-is/archive/payments/
// and the old code (/home/user/factory, integration/factory) as evidence.
//
// Old against new: 82 old Convex functions (71 rpcs, 11 workflows), 65 door procedures, 8 SDK flows, 13
// tables and 8 machines become 8 rpcs, 3 workflows, 1 procedure, 6 flows, 3 tables and 2 machines
// (decision payments.count).

import { defineDecision } from "../../../packages/book/src/index.ts";
import { concept_payments, environment_devnet, environment_staging } from "../shared/foundation.ts";
import {
  contract_budgets,
  contract_companies_house_claimer,
  contract_escrow,
  contract_escrow_factory,
  contract_exits,
  contract_payments,
  integration_indexer,
  integration_service_signer,
} from "../shared/external.ts";
import { error_INVALID_RECIPIENT, error_PAYROLL_BUDGET_EXCEEDED, error_ROLE_PERMISSION_DENIED } from "../shared/vocabulary.ts";
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
import { event_approval_transitioned, machine_approval } from "../approvals/data.ts";
import { procedure_approvals_withdraw } from "../approvals/procedures.ts";
import { event_proposal_transitioned, machine_proposal } from "../board/data.ts";
import { procedure_documents_store } from "../documents/procedures.ts";
import { procedure_books_record_money_fact } from "../books/procedures.ts";
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
  source: by(`${ASIS} (plumbing, K1, K9, M5, D9); docs/as-is/archive/payments/data.ts (13 tables)`),
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
  source: by("A2, A3, P3; books/target/approvals/data.ts (event_approval_transitioned props); books/target/board/data.ts (proposal_transitioned)"),
  affects: [workflow_payments_lifecycle_payment, event_approval_transitioned, event_proposal_transitioned],
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
    {
      label: "read-parties",
      text: "Read parties' table instead of invoking `parties.resolve-recipient` (parties' suggestion), leaving two procedures.",
    },
  ],
  chosen: "one-transaction",
  why:
    "Each is the same money fact as the Payment: the payee and the Safe its money routes to (a wrong binding pays the " +
    "wrong Safe), the document whose hash goes on chain (a hash with no content is a money bug), and the carrier (nobody " +
    "may sign a payment Capxul has no record of). Naming first would leave named Parties for births that then failed, " +
    "and K2 says the command, its Payments and their documents are born together. The width is three procedures, at the " +
    "rule's limit of three, from three concepts instead of two: this record is the decision P4 asks for. Reading " +
    "parties' table cannot replace the procedure: a mailbox nobody has yet is named a provisional Party at its " +
    "email-derived Safe in the same transaction (the claim escrow's payee), and that is a write to parties. Still " +
    "open for the sys:tx-width reviewer's sign-off.",
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
  source: by("books/target/shared/decisions.ts (environments.devnet, worlds); docs/as-is/archive/payments/operations.ts (27 refusals had no world)"),
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
  source: by("docs/as-is/archive/payments/*.ts (record counts, 8 November 2026); docs/as-is/payments.md (82 functions, 65 procedures)"),
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

// ── assembly: what other concepts asked of payments (8 November 2026) ──────────────────────

export const decision_payments_door_inputs = defineDecision({
  id: "payments.door-inputs",
  title: "The door takes a date, a deadline, a resume, and items with no document",
  question:
    "Requests and banking asked the door for more: a dated `inbox pay` (`pay_at`), the approval's expiry in the answer, " +
    "`inbox pay --resume` reopening a lapsed Payment under the same key, an item with no document (banking does not " +
    "depend on documents), and a payout's Payment that cannot land, or be retried, after its quote expires. Which does " +
    "`payments.prepare-command` take?",
  options: [
    {
      label: "widen",
      text:
        "All five: `pay_at`, `not_after` (kept on the command; it caps the approval's deadline and `payment retry` refuses " +
        "after it), `resume` (a repeat whose Payments all lapsed opens one new approval for the same payment ids and moves " +
        "them `retry`), `expires_at` in the answer, and an item's `document_id` null with a hash its invoker derives " +
        "(never the zero hash, which v4 reverts on: banking.payout-document-hash).",
    },
    { label: "retry-rpc", text: "Keep K1 strict: a resume calls `payments.changes.retry` per Payment from the requests flow." },
    { label: "require-document", text: "Make banking depend on documents so every item carries a stored document." },
  ],
  chosen: "widen",
  why:
    "Each is the same money fact the door already records. A dated Payment is the same birth with `send_after` or " +
    "`Budgets.schedule`, as `payment send --on` does. A resume is a retry: same terms, same job nonce, same payment id, " +
    "so the chain still consumes it once, and it must commit with the request staying `paying`, which a later rpc call " +
    "could not promise; it is asked for explicitly, so K1's plain repeat still answers as it stands. `not_after` belongs " +
    "on the command because a retry opens a new approval long after the first: only the command remembers the quote. " +
    "The deadline answered is an upper bound, since the paymaster cuts the window when it sponsors. A payout's Payment " +
    "has no document of its own on chain today (its Bridge transfer is the record), and its payout's digest names none " +
    "stored; a new edge to documents would make banking store a document nobody reads.",
  source: by(
    "docs/decisions/assembly-items.md (requests: pay_at, expiry, resume; banking: document, expiry); books/target/requests/inbox.ts; " +
      "books/target/banking (payouts); K1, K3",
  ),
  affects: [procedure_payments_prepare_command, table_payment_commands, P.retry, rpc_payments_changes_retry],
});

export const decision_payments_withdraw_by_opener = defineDecision({
  id: "payments.withdraw-by-opener",
  title: "Banking withdraws an unsigned payout's approval; the process cancels the Payment",
  question:
    "Banking ends a payout before anyone signs (its bank account changed). Approvals asked openers to withdraw such an " +
    "approval (`approvals.withdraw`). Does payments add a procedure for it, and who cancels the Payment?",
  options: [
    {
      label: "opener-withdraws",
      text:
        "Banking, which now depends on approvals, invokes `approvals.withdraw` with the approval id the door answered, in the " +
        "payout's own transaction; the Payment's process cancels the Payment on that approval's `withdraw` (outcome withdrawn).",
    },
    { label: "payments-procedure", text: "A new door procedure, `payments.withdraw-command`, that withdraws the approval and cancels the Payments." },
  ],
  chosen: "opener-withdraws",
  why:
    "P4 adds a procedure only for a money fact no existing door records. The fact here is the payout ended and its " +
    "unsigned carrier with it, which `approvals.withdraw` already is; since dependencies.payers-sign-and-name-budgets " +
    "banking may invoke it. The Payment's status has one writer, its process, which already follows every end of its " +
    "approval; a withdrawn approval is one more end. If the payer signed first, `withdraw` answers `signed` and banking " +
    "knows the payout may still land. Payments' own changes never withdraw: `payment cancel` acts only on a signed, held " +
    "payment (frozen), and a retry opens its new approval only after the old one ended.",
  source: by("books/target/approvals/procedures.ts (approvals.withdraw); dependencies.payers-sign-and-name-budgets; payment.cancel.yaml (about); P4"),
  affects: [workflow_payments_lifecycle_payment, P.cancel, procedure_approvals_withdraw, machine_approval],
});

export const decision_payments_board_outcomes = defineDecision({
  id: "payments.board-outcomes",
  title: "A failed or replaced Board proposal lapses its Payment; a rejection cancels it",
  question:
    "Board's proposal now ends executed, failed (ExecutionFailure: the nonce used, nothing happened), rejected or " +
    "replaced (another transaction took its nonce). How does each move a Board payment?",
  options: [
    { label: "lapse-or-cancel", text: "executed → `submit`; failed or replaced → `lapse` (outcome reverted, displaced); rejected → `cancel` (outcome rejected)." },
    { label: "all-cancel", text: "Every end but executed cancels the Payment." },
  ],
  chosen: "lapse-or-cancel",
  why:
    "A failed or replaced proposal moved no money and its terms still stand, as an approval that reverted or was " +
    "displaced: `payment retry --as-directors` proposes the same payment id again, which the chain consumes once. A " +
    "rejection is the Directors' answer, as a decline is a person's, so it ends the Payment. Board asked every follower " +
    "of proposal_transitioned to treat `fail` as 'ran without effect' (board.failed-proposal).",
  source: by("books/target/board/data.ts (machine_proposal: failed, replaced); board.failed-proposal; payment.retry.yaml"),
  affects: [workflow_payments_lifecycle_payment, P.lapse, P.cancel, machine_proposal],
});

export const decision_payments_chain_born_ids = defineDecision({
  id: "payments.chain-born-ids",
  title: "A Payment born from a chain fact is named by its v4 payment id",
  question:
    "Payroll reports a collection's payment from its indexed PaymentSent and cannot read payments; `payment get` refuses " +
    "an id that does not start with `payment_` (frozen #1). How does payroll name a Payment `payment get` finds?",
  options: [
    { label: "derived-id", text: "A chain-born Payment's id is `payment_` and the 64 hex digits of its v4 payment id; payroll prints the same." },
    { label: "accept-hex", text: "`payment get` also takes a bare `0x` payment id." },
    { label: "payroll-reads", text: "Payroll depends on payments and reads the Payment." },
  ],
  chosen: "derived-id",
  why:
    "Accepting `0x…` would weaken `payment get`'s frozen refusal of an id that does not start with `payment_`, and the " +
    "map keeps payroll and payments apart (dependencies.payments-payroll: neither reads the other). The v4 payment id " +
    "is unique per chain (the by-chain-payment-id index) and known to both sides from the same fact, so the id needs no " +
    "lookup. Prepared Payments keep their ULID ids: nothing outside payments needs to derive them. Payroll's other ask " +
    "is met as designed: `payment wait` follows any `approval_` id its signer holds (payroll's holder writes included), " +
    "with no Payments when it moves no money.",
  source: by("payment.get.yaml (refusal CLI_USAGE); books/target/payroll/decisions.ts (payroll.collection-payment); dependencies.payments-payroll"),
  affects: [table_payments, workflow_payments_settlement_observe, rpc_payments_ledger_get],
});

export const decision_payments_movement_memos = defineDecision({
  id: "payments.movement-memos",
  title: "A Movement stores its Memo in its own transaction",
  question: "Documents asked payments to store each Movement's Memo, so `document verify` has one to verify. Where?",
  options: [
    { label: "in-record", text: "`payments.movements.record` invokes `documents.store` beside the book fact, once per Transfer." },
    { label: "none", text: "Leave Movements without a Memo." },
  ],
  chosen: "in-record",
  why:
    "The frozen `document verify` #1 ('A standalone Movement participant can verify its exact Memo') needs it, and a " +
    "Movement and the document that records it are one money fact (documents.movement-memos). The Memo is a pure " +
    "function of the Transfer (basis movement, reference `<chain id>:<tx hash>:<log index>`, issued at the block time, " +
    "the Capxul sides as participants), so a replay stores nothing new. The record transaction then invokes two " +
    "procedures of two concepts (books, documents), within sys:tx-width.",
  source: by("books/target/documents/decisions.ts (documents.movement-memos); document.verify.yaml #1"),
  affects: [workflow_payments_movements_record, procedure_documents_store, table_movements],
});

export const decision_payments_document_bytes = defineDecision({
  id: "payments.document-bytes",
  title: "`--document` passes the receipt's bytes, not a media file id",
  question:
    "SendInput's document named a media file (`content_hash`, `file_id`), but `documents.store` takes a receipt's bytes " +
    "(at most 128 KB), and neither payments nor documents depends on media. How does the file reach documents?",
  options: [
    { label: "bytes", text: "The SDK flow reads the file and passes its bytes, media type and name in the prepare input; prepare stores them." },
    { label: "media-edge", text: "Payments depends on media and reads the uploaded file in its rpc." },
  ],
  chosen: "bytes",
  why:
    "The CLI already holds the file it was given, and 128 KB fits an rpc input. A media edge would add a dependency " +
    "only to read bytes the client had a moment before, and the file's stored copy would then be documents', not " +
    "media's. Documents keeps the bytes exactly and checks the media type.",
  source: by("books/target/documents/procedures.ts (ReceiptContent); apps/cli/src/commands/payment/internal/send-input.ts:147"),
  affects: [rpc_payments_commands_prepare, rpc_payments_commands_propose, flow_client_payments_pay, flow_client_org_departments_pay],
});

// ── the general escrow (aaron.escrow-general, aaron.departments, 8 November 2026) ──────────────

const V4 = "packages/contracts/v4/src";
const V4DOCS = "docs/planning/protocol-v4";

export const decision_payments_general_escrow = defineDecision({
  id: "payments.general-escrow",
  title: "General escrow: the owner collects at any time; the sender takes back until then",
  question:
    "The escrow ruling: one escrow, deployed counterfactually, whose owner is the recipient's account before that " +
    "account exists and may claim whenever it wants, and whose sender may always take the money back until it is " +
    "claimed; general, for other uses too; the escrow changes, Budgets does not. What are its terms and functions, and " +
    "what changes from v4's Escrow and EscrowFactory?",
  options: [
    {
      label: "general-escrow",
      text:
        "v4's Escrow and EscrowFactory, changed and deployed again. Terms: `owner` (who collects), `sender` (where the " +
        "money came from, the only address a refund pays), `authority` and `authorityKey` (zero, or a view " +
        "`authorised(uint256 key, address who)` that admits other callers to refund for the sender), `bootstrapOwner` " +
        "(zero, or an address the owner must no longer list among its owners before it can act), token, amount, job " +
        "nonce, kind, document hash, `condition` (amount-reached: the owner's claim stands in the terms and anyone pays " +
        "it out once funded; owner-collects: the owner collects when it chooses) and `ownerTakesSurplus`. Every term is in " +
        "the CREATE2 address. Functions: `collect` (the owner, once it can act), `payout` (anyone, amount-reached only), " +
        "`refund` (the sender, or whoever the authority admits at the call; it always pays the sender), `canRefund`, " +
        "`conditionMet` and `state`; EscrowRefunded names who took it back. A department's escrow names Budgets and the " +
        "budget id as its authority.",
    },
    {
      label: "sender-is-an-address",
      text:
        "v4 as deployed: `refund` answers one owner address. A department's escrow then belongs to the company Safe (the " +
        "Board alone) or to the spender's Safe (one person, even after they leave the department).",
    },
    {
      label: "budgets-calls",
      text:
        "Budgets gains spendToClaim, scheduleToClaim and refundClaim and owns each budget's escrow (the superseded " +
        "design of payments.claim-escrow-routes). The ruling rules out changing Budgets.",
    },
    {
      label: "second-contract",
      text:
        "A new claim escrow beside v4's Escrow, which stays for invoices and Exits: two escrow contracts, two factories and " +
        "two event sets to index, and v4's claim condition kept with its exit-only lookup.",
    },
  ],
  chosen: "general-escrow",
  why:
    "It is the ruling, met by the smallest change that keeps every v4 behaviour the book relies on. Counterfactual: the " +
    "terms fix the address before anything exists, so prepare shows it, the payer signs money into it, a dated payment " +
    "reserves it, and a later deploy moves nothing. Owner: the recipient's account; for a mailbox, the Safe " +
    "CompaniesHouseClaimer derives. It collects by calling, once Companies House is not among its owners (v4's D11, now " +
    "a term, so an owner with no `isOwner`, a plain account, can collect too). Sender: where the money came from. A " +
    "refund pays it whoever calls, so taking money back can never redirect it. The authority term makes the escrow " +
    "general and leaves Budgets unchanged. Under the departments ruling a budget's payment is its department's, and " +
    "`Budgets.authorised(budgetId, caller)` is exactly the department's authority at the call: its hat's wearers in good " +
    "standing, those above, and the company Safe. So whoever wears the hat when it is taken back may take it back, and " +
    "whoever left may not. A revert or a malformed answer refuses, and the sender itself can always refund, so the " +
    "Board stays the backstop. The invoice condition keeps v4's checkout: its owner's claim is in its terms, so it can be " +
    "taken back only until it holds the amount (v4's S7). Uses that show it is general, not features: a payment to a " +
    "mailbox from a person, the Board, a department (now or dated) and a payroll run's new hire; a request's invoice " +
    "escrow; and v4 Exits' unclaimed exit payouts, where Exits is the sender and sets `ownerTakesSurplus` instead of " +
    "the escrow asking it `isExitClaimEscrow`. What stays: CREATE2 over the terms and Payments, an idempotent deploy by " +
    "anyone, predicted payment ids, one exact payment through Payments with the escrow as executor, D12, no expiry, S1 " +
    "to S3, later deposits returned, and the factory's constructor and `bootstrapOwner()` view. Exits' terms builder is " +
    "the only other contract line that changes: it reads Companies House from that view.",
  source: by(
    `${V4}/money/Escrow.sol:59-186; EscrowFactory.sol:28-50; Budgets.sol:373 (authorised); equity/Exits.sol:136, :561; ${V4DOCS}/spec/escrow.md (D11, D12); aaron.escrow-general; aaron.departments`,
  ),
  affects: [
    contract_escrow,
    contract_escrow_factory,
    contract_budgets,
    contract_companies_house_claimer,
    contract_exits,
    table_payments,
    P.escrow,
    P.cancel,
    rpc_payments_changes_cancel,
  ],
});

export const decision_payments_claim_escrow_fit = defineDecision({
  id: "payments.claim-escrow-fit",
  title: "The general escrow does what the escrow rulings ask; six gaps named",
  question:
    "The escrow ruling and the money-waiting ruling ask for these properties. The escrow is counterfactual. Only the " +
    "recipient's future account may claim it, whenever it wants. The sender may take the money back until then. A " +
    "money-waiting email goes out. Does the general escrow (payments.general-escrow) do exactly this on every route, and " +
    "what is left open?",
  options: [
    {
      label: "fits",
      text:
        "Yes, clause by clause, through the book's flows: the address fixed at prepare, the derived Safe as owner with " +
        "Companies House as bootstrap owner, the sender's or the department's refund until the collection, and no " +
        "expiry; the gaps below are accepted rulings or are named in other records.",
    },
    {
      label: "change-more",
      text: "Change the contract further: an on-chain expiry that returns the money, or a claim secret in the email instead of a derived Safe.",
    },
  ],
  chosen: "fits",
  why:
    "Counterfactual: each claim escrow's address is EscrowFactory.predictAddress of its terms and the Payment's job " +
    "nonce, fixed at prepare, funded by an ordinary Payments.send, Budgets.spend or dated Budgets.execute to it, and " +
    "deployed in the same batch or, for a budget's dated one, by the escrow relayer once funded (payments.escrow-on-funding). " +
    "Only the recipient: the owner is the Safe derived from Companies House, the tier's namespace and the mailbox " +
    "(trimmed, lowercased), the Safe the person's sign-up claims; `collect` answers only it, once Companies House is not " +
    "among its owners. Whenever: no expiry, at setup or later with `account collect` (accounts.collect-any-time). The " +
    "sender until then: the payer's Safe; the company Safe, so the Board, for a Board one; for a department's, whoever " +
    "Budgets.authorised admits on the funding budget at the refund, the money returning to the company Safe. A refund " +
    "racing a collection is decided by the chain, one or the other, and a refund after the owner can act still works " +
    "until it collects (D12). Collecting is accepting: the recipient signs it. A claim secret would let whoever holds a " +
    "link collect without an account, which the ruling rules out; an expiry would move unasked money. " +
    "Gaps: (1) Companies House's claim role picks the signer an email's Safe goes to, a trust root accepted for the " +
    "beta (the claim-trust ruling). (2) Reminders are notices' (the reminders ruling). " +
    "(3) An alias or a typo is another Safe: the preview and the email show the exact mailbox, and the sender takes it " +
    "back and sends again (payments.claim-escrow-mailbox). (4) A non-ASCII mailbox can never be claimed " +
    "(EmailNotNormalized), so it is refused before signing (INVALID_RECIPIENT). (5) A frozen agent cannot take back its " +
    "payment's escrow until unfrozen; the recipient can still collect. (6) Waiting money admits its recipient " +
    "(accounts.money-waiting-admits). The collection's PaymentSent comes from the escrow, its executor, so its sender " +
    "term is `escrow_address`.",
  source: by(
    `${V4}/money/Escrow.sol:98-186; ${V4}/companies-house/CompaniesHouseClaimer.sol:85-152; ${V4DOCS}/spec/escrow.md (D11, D12); aaron.escrow-general; aaron.money-waiting; payments.general-escrow`,
  ),
  affects: [
    contract_escrow,
    contract_escrow_factory,
    contract_companies_house_claimer,
    P.escrow,
    P.settle,
    workflow_payments_lifecycle_payment,
    rpc_payments_changes_cancel,
    operation_payment_send,
  ],
});

export const decision_payments_claim_escrow_routes = defineDecision({
  id: "payments.claim-escrow-routes",
  title: "Every payment to a mailbox with no account is a general escrow, on every route",
  question:
    "The ruling on paying someone with no account lets a budget spend and a dated payment go to them. The escrow " +
    "ruling makes the escrow general and leaves Budgets unchanged, and the departments ruling makes a budget's payment its " +
    "department's. Which payments become claim escrows? What are each route's terms, how is each funded and taken " +
    "back, and what does the budget show?",
  options: [
    {
      label: "general-escrow",
      text:
        "Every payment to a mailbox with no live Safe, now or dated, is a general escrow: owner the mailbox's derived Safe, " +
        "condition owner-collects, bootstrap owner Companies House, salt the job nonce, the item's token, amount, kind " +
        "and document hash. Personal: sender the payer's Safe, no authority, funded by `Payments.send`. Board now: sender " +
        "the company Safe, no authority, funded by the Board batch's `Payments.send`. A department, allowance or payroll " +
        "run: sender the company Safe, authority Budgets with the funding budget's id, funded by an ordinary " +
        "`Budgets.spend` to the escrow's address. Dated (a budget's, or the Board's on a top budget no member holds): " +
        "`Budgets.schedule` to the address, paid by `Budgets.execute` on its day, with the same authority. The funder's " +
        "batch also sends `EscrowFactory.deploy`; a dated escrow is deployed by its Payment's process once funded. Taking " +
        "back is the sender's approval or Board proposal, or for a budget's an approval from any Safe that " +
        "`Budgets.authorised` admits now. The money returns to the sender, and the budget's room is not restored.",
    },
    {
      label: "budget-owned",
      text:
        "The superseded design: Budgets gains spendToClaim, scheduleToClaim and refundClaim, owns the escrow and gives " +
        "the room back in the period that spent it.",
    },
    {
      label: "company-owned",
      text: "v4 as deployed, for a budget's: the company Safe owns the escrow, and only a Board proposal takes it back.",
    },
    {
      label: "own-safe-or-board",
      text:
        "The first choice: only personal and immediate Board payments are claim escrows; a budget spend, a dated payment " +
        "and a non-ASCII mailbox are INVALID_RECIPIENT.",
    },
  ],
  chosen: "general-escrow",
  why:
    "It follows the three rulings without changing Budgets. A budget pays the escrow exactly as it pays anyone: " +
    "`spend` and `schedule` take any recipient, and the counterfactual address is one. So the spend counts against the " +
    "budget as every spend does. Its PaymentSent is the escrow's funding (`funding_payment_id`, kept on every route), " +
    "which settles nothing. The Payment settles on the collection's PaymentSent, and books posts nothing while the money " +
    "waits. The department's authority is read at the refund: the next wearer may take back what the last one sent, a " +
    "member taken out of the hat is refused at once, and the Board, as the company Safe, always may. The money returns " +
    "to the company Safe, the treasury every budget pays from. The room is not restored, as open question 1 was " +
    "answered: the refund adds to the Safe's balance, not to the budget's period, and the budget keeps showing the " +
    "spend as spent. The Board's dated payment sits on a top budget no member holds, so only the Board may cancel or " +
    "take it back while that holds (payments.department-authority). The terms are fixed at prepare, so a " +
    "retry rebuilds the same escrow. A dated escrow opens on its day; a payee who set up before then collects with " +
    "`account collect`. Payroll's new hire is the budget route through the door, item by item. No frozen claim " +
    "changes; INVALID_RECIPIENT stays only for a non-ASCII mailbox.",
  source: by(
    `aaron.escrow-general; aaron.departments; aaron.budget-pay-unclaimed; ${V4}/money/Budgets.sol:206 (spend), :235 (schedule), :283 (execute); docs/decisions/open-for-aaron.md (question 1)`,
  ),
  affects: [
    rpc_payments_commands_prepare,
    rpc_payments_commands_propose,
    rpc_payments_changes_cancel,
    procedure_payments_prepare_command,
    operation_payment_send,
    operation_payment_cancel,
    error_INVALID_RECIPIENT,
    table_payments,
    P.escrow,
    P.cancel,
    contract_budgets,
    contract_escrow,
    workflow_payments_lifecycle_payment,
    workflow_payments_settlement_observe,
  ],
});

export const decision_payments_escrow_on_funding = defineDecision({
  id: "payments.escrow-on-funding",
  title: "A claim escrow's Payment is escrowed when its funding lands; the deploy follows",
  question:
    "The general escrow is funded before it exists, and anyone may deploy it. If `escrow` waited on EscrowCreated, an " +
    "escrow deployed early (anyone can) would send the money-waiting email before the money arrived, and one deployed " +
    "late would leave its Payment `submitted`. What moves a claim escrow's Payment to `escrowed`, and who deploys the " +
    "escrow?",
  options: [
    {
      label: "funding",
      text:
        "The funding's PaymentSent, with the Payment's `funding_payment_id`, drives `escrow` (from prepared, scheduled, " +
        "due or submitted). The funder's batch deploys the escrow beside its funding. Once `Budgets.execute` funds a " +
        "dated budget payment, its process sends `EscrowFactory.deploy` with the escrow relayer key at once if the address " +
        "has no code, once, looked up by hash.",
    },
    { label: "escrow-created", text: "EscrowCreated with the Payment's collection payment id drives `escrow`, as before." },
  ],
  chosen: "funding",
  why:
    "Money waiting is what the email, the reminders and the admission are about, and the funding's PaymentSent is that " +
    "fact on every route: a personal or Board `Payments.send`, a budget spend, or a dated execute. EscrowCreated only " +
    "says that code exists, which anyone can cause before the money arrives. The deploy is still needed. Indexing admits " +
    "an escrow's own logs, and accounts finds it (at setup or with `account collect`), only once EscrowDeployed makes it " +
    "known (indexing.admission); the Transfers that fund it are indexed from the first. A refund or a collection needs " +
    "code. So every funding is followed by a deploy: in the same batch where the funder signs one (personal, Board, a " +
    "budget spend), else by the Payment's own process with the escrow relayer key as soon as the execute's receipt is " +
    "in, with no wait, so a money-waiting email never points at an escrow nobody can find. A deploy that fails strands " +
    "nothing: the money is at the address, and the next deploy, by anyone, finds it. The relayer key cannot move money.",
  source: by("payments.general-escrow; indexing.admission; books/target/shared/external.ts (service-signer: ESCROW_RELAYER_KEY); payments.escrow-after-send"),
  affects: [P.escrow, workflow_payments_lifecycle_payment, contract_escrow_factory, integration_service_signer, table_payments],
});

export const decision_payments_department_authority = defineDecision({
  id: "payments.department-authority",
  title: "A budget payment is its department's: whoever wears the hat now acts on it",
  question:
    "rules.department-authority: authority over a budget's money is the hat a Safe wears now. `payment cancel`'s who " +
    "gives a claim escrow to its owner or the Board; `payment retry` refuses 'a caller who no longer holds the authority " +
    "the first send needed'; a Board dated payment is scheduled on 'the open top budget with the most left', which may " +
    "be a department. How do payments' who-lines and that choice read?",
  options: [
    {
      label: "hat-now",
      text:
        "Retry, cancel, reschedule and take back a budget's payment or claim escrow: whoever Budgets.authorised admits on " +
        "its budget now, whoever sent it, and the Board. `payment cancel`'s who: 'The payer. For a budget's dated payment " +
        "or claim escrow, whoever wears the budget's hat or one above it now, or the Board. For a payment the Board made, " +
        "the Board.' A Board dated payment is scheduled on the open top budget in the asset with the most left among " +
        "those no member holds: whose hat no Safe but the company Safe wears now (the install's own, or one the Board " +
        "keeps without a holder).",
    },
    { label: "first-sender", text: "Only the person who sent it, with the Board as a backstop (the recommendation Aaron changed)." },
  ],
  chosen: "hat-now",
  why:
    "The departments ruling changed open question 2's recommendation: a budget payment is the department's, not " +
    "the sender's. `Budgets.cancel` and the general escrow's refund already ask `Budgets.authorised` at the call, so " +
    "the who-lines now say what the chain does. A member who left is refused: ROLE_PERMISSION_DENIED before anything is " +
    "built, or by the chain if they lose the hat after sponsorship. The most-left rule could put the Board's payment on " +
    "a department, whose holders could then cancel it and whose room it would use unasked. A top budget no member holds " +
    "is the Board's alone: Budgets.authorised admits only the company Safe on it. The install's own, whose hat is the " +
    "Board's top hat, holds 0 at the install (organizations.fde-hosting), so it alone would refuse every Board dated " +
    "payment until the Board gave it room; one the Board keeps without a holder (org-with-budget-tree's `company`) is " +
    "as much the Board's. No room in any is PAYROLL_BUDGET_EXCEEDED. Should the Board later give that budget a holder, " +
    "the departments ruling makes the payment theirs too. The frozen claims are unchanged: `payment cancel` #2 and #4 still hold (the Board cancels " +
    "what it scheduled; a non-Director cannot), and so does `payment retry` #3 (a member who lost the hat is refused).",
  source: by("rules.department-authority (contradictions 1, 2 and 17 of docs/design/authority.md); aaron.departments; open-for-aaron.md question 2; Budgets.sol:268 (cancel)"),
  affects: [
    rpc_payments_changes_cancel,
    rpc_payments_changes_retry,
    rpc_payments_changes_reschedule,
    rpc_payments_commands_propose,
    operation_payment_cancel,
    operation_payment_retry,
  ],
});

export const decision_payments_escrow_contract_build = defineDecision({
  id: "payments.escrow-contract-build",
  title: "The build writes the general escrow in packages/contracts and deploys it",
  question:
    "The general escrow changes v4's Escrow and EscrowFactory, and the one line of Exits that builds their terms. Who " +
    "writes it, where does it live, when must it exist, and which deployments carry it?",
  options: [
    {
      label: "contracts-package",
      text:
        "`packages/contracts` in this repository holds Protocol v4's Solidity sources, taken at a pinned commit of the v4 " +
        "package as the chain layer the book records (P9, contracts.v4-set). It carries only the general escrow's change: " +
        "Escrow, EscrowFactory, IEscrow and IEscrowFactory, with their spec, trees and Foundry tests, and Exits' terms " +
        "builder. It lands with the spine at B3, before the pilots, because a claim escrow is a route of `payment send`, a " +
        "pilot. The devnet's `up` deploys it, and the regenerated address book records the factory's devnet address. B5's " +
        "new staging deploys it fresh on Base Sepolia (environments.staging). Its exit check: the trees and invariant " +
        "suite in docs/design/escrow.md pass, and `forge build` gives the creation code the SDK's address prediction uses.",
    },
    {
      label: "old-repository",
      text: "Change the escrow in Xelmar-tech/infrastructure's v4 package and deploy from there; the old system is read only, and the build could not change or test it.",
    },
    {
      label: "escrow-only",
      text: "Only the escrow in this repository, the rest of v4 deployed from the old repository: Exits imports the escrow's terms, so the two would not build together.",
    },
  ],
  chosen: "contracts-package",
  why:
    "The rebuild must deploy and test its contracts from the repository it builds. The devnet deploys v4 at `up`, and " +
    "the new staging is a fresh v4 deployment, accepted 'with the changed escrow' (open question 16). v4 is " +
    "not the old system that the never-port rule means. It is the protocol the target book is written against (P9), and " +
    "the book records its contracts as its chain layer; the old TypeScript product stays a reference only. Taking the " +
    "whole v4 package keeps one compiler, one set of addresses and one deploy script, whose constructor arguments do not " +
    "change (the factory still takes Payments and Companies House). The change stays the escrow's and Exits' `_terms`: " +
    "Budgets, Payments, CompaniesHouseClaimer and every other contract are v4's byte for byte, so their trees and audits " +
    "still hold. B3 is the latest it can land, because payments' prepare and the SDK's address prediction need the " +
    "escrow's ABI and creation code. For the goal prompt: the master adds `packages/contracts` to system.layout's " +
    "packages and to B3's spine.",
  source: by("environments.staging; open-for-aaron.md question 16; contracts.v4-set; docs/mission/initializer.md (B3: anvil with the v4 contracts; B5); packages/protocol/src/evm/escrows-v4.ts:13 (creation code)"),
  affects: [contract_escrow, contract_escrow_factory, contract_exits, environment_staging, environment_devnet],
});

export const decision_payments_claim_escrow_mailbox = defineDecision({
  id: "payments.claim-escrow-mailbox",
  title: "A claim escrow's Payment keeps its mailbox, for the money-waiting email",
  question: "Notices must email a claim escrow's payee, who has no account, but parties keeps only a mailbox's digest. Where is the mailbox?",
  options: [
    { label: "on-payment", text: "The Payment keeps `payee_mailbox` (trimmed and lowercased, as typed) on route `claim_escrow` only; its holder and notices read it." },
    { label: "in-parties", text: "Parties keeps the mailbox on the provisional person Party." },
    { label: "in-event", text: "The `escrow` transition's event carries the mailbox to notices." },
  ],
  chosen: "on-payment",
  why:
    "The payer typed it and holds the Payment, so the row exposes no one's data to a reader who did not have it. " +
    "Parties' directory is global (every tenant reads it), so it keeps digests by design; an event carries ids only (P7). " +
    "The email goes to the exact mailbox the payee Safe is derived from, so a typo shows to its owner, not to a " +
    "stranger's lookalike. Once the payee collects, settlement fills `payee_kind` and `payee_id` from the Party at the " +
    "payee Safe, now the person's, and the payee reads the Payment through the payee index.",
  source: by("books/target/parties/data.ts (mailbox_digest; it never holds a mailbox); P7; books/target/shared/rulings.ts (aaron.money-waiting)"),
  affects: [table_payments, P.escrow, workflow_payments_lifecycle_payment],
});

export const decision_payments_escrow_after_send = defineDecision({
  id: "payments.escrow-after-send",
  title: "A claim escrow escrows from `submitted` too: its carrier answers before Ponder",
  question:
    "A personal claim escrow's approval is `sent` when the bundler accepts it, and the process then drives `submit`; a " +
    "Board one's proposal executes in the funding's own transaction. The funding's PaymentSent, which drives `escrow` " +
    "(payments.escrow-on-funding), is indexed after both. If `escrow` ran only from `prepared`, what would a claim escrow do?",
  options: [
    {
      label: "from-submitted",
      text:
        "`escrow` runs from `prepared` or `submitted`, and for a dated claim escrow from `scheduled` or `due`: whichever " +
        "answer the process sees first, the funding's PaymentSent takes the Payment to `escrowed`, and a carrier's answer " +
        "after that moves nothing.",
    },
    { label: "hold-submit", text: "A claim escrow's carrier never drives `submit`; it stays `prepared` until its funding is indexed." },
  ],
  chosen: "from-submitted",
  why:
    "With `escrow` only from `prepared`, every claim escrow would stop at `submitted`: the money-waiting email, which " +
    "follows `escrow`, would never be sent, and a refund could not `cancel` it (cancel does not run from `submitted`), " +
    "though a collection would still settle it. Keeping `submit` means a claim escrow reads like every other sent " +
    "payment until the chain says where the money is, and a reverted operation still lapses from `submitted`. Holding " +
    "`submit` would give one route its own carrier rules. A dated claim escrow, which payments.claim-escrow-routes now " +
    "allows, opens on its day from `scheduled` or `due` when `Budgets.execute`'s PaymentSent to it is indexed before " +
    "its carrier's answer, for the same reason.",
  source: by("books/target/approvals/data.ts (state sent: the bundler accepted it); books/target/board/data.ts (executed); books/target/payments/processes.ts (follow-carrier); books/target/notices/payments.ts (money-waiting follows escrow)"),
  affects: [P.escrow, P.submit, P.cancel, workflow_payments_lifecycle_payment, machine_approval, machine_proposal],
});

// ── assembly after the Frappe redesign (8 November 2026): what accounting and payroll asked ──────

export const decision_payments_money_sides = defineDecision({
  id: "payments.money-sides",
  title: "Each money side gives books its Safe, log, Party, fee and what it is for",
  question:
    "Books' Frappe-shaped vouchers need, for each settled side, its Safe, the log index, the counterparty's directory " +
    "Party, a rail's fee and what the payer said the money is for (`payment send --account` and `--suggest`, a " +
    "request's meaning, a payout's payee, a head's references). Nothing carried `--account` to books. Where does " +
    "payments keep each, and when does it pass them?",
  options: [
    {
      label: "kept-on-payment",
      text:
        "The Payment keeps `against`, `source` and `fee_raw` from its birth: prepare turns `--account` (a code, resolved " +
        "to its account in the Organization's chart, or for a person a code of the fixed personal chart) and `--suggest` " +
        "into `against`, and the door's items bring theirs from requests, banking and payroll, with `payee_against` for " +
        "the payee's side when the invoker knows it (a paid request's income account, Customer and invoice). The " +
        "settlement passes each side its own, with the side's Safe, the settled log index, the block's time and the other " +
        "side's Party from parties' directory, in the transaction that settles it. A claim escrow's PaymentSent comes " +
        "from the escrow, so its payer side's Safe is `payer_safe`, the Safe that funded it (the payer's own, or the " +
        "company Safe for a budget or the Board), and its counterparty the payee's Party; the escrow is never a side.",
    },
    { label: "classify-at-send", text: "Annotate books' row at send time through a books procedure, as the old `bookSentPayments` did." },
    { label: "books-reads", text: "Books reads the command at settlement." },
  ],
  chosen: "kept-on-payment",
  why:
    "A procedure is for one money fact (rules.procedures), and an annotation before any money moved is not one; books " +
    "cannot read payments, which sits above it. Kept on the Payment from birth, the choice is the same for a retry, a " +
    "resume and a reorg's second settlement, and a replay changes nothing. Books applies only the parts that fit the " +
    "chart and leaves the rest in review (its door never refuses), so payments refuses only what it can check at the " +
    "birth: an `--account` code the Organization's chart lacks, archived or a group, and a `--suggest` with no " +
    "`--account` or beside one other than 4999 or 6999, are INVALID_INPUT naming it, as the old classifier refused " +
    "before saving (packages/backend/src/books/writes.ts:223). `--as-directors` takes neither flag (the frozen note " +
    "says so). A person's own payment has books too, the fixed personal chart, which keep no fact: the old send gave " +
    "the person's row its account at prepare, so `client.payments.pay` saves a personal choice as the person's own " +
    "annotation of each Payment (`books.annotations.save`, actor person) right after prepare, and not on a replay, so " +
    "a repeat never undoes a later choice. An escrow's own address names no Safe of the payer's, and books makes a " +
    "Safe account for any side's Safe it lacks, so the funding Safe is passed. The counterparty's Party is read at " +
    "settlement, not snapshotted: a Party id never changes, and a chain-born Payment has none at birth. `fee_raw` comes " +
    "from the rail that knows it (a bank payout's quote): payments never computes a fee. A deposit's and a payout " +
    "return's sides are banking's own facts and carry the same fields from banking.",
  source: by(
    "docs/design/frappe/accounting.md (For other lanes: payments); books/target/books/procedures.ts (MoneySide, Against); packages/backend/src/payments/commands/writes/books.ts:24; books/writes.ts:223",
  ),
  affects: [
    table_payments,
    table_payment_commands,
    rpc_payments_commands_prepare,
    procedure_payments_prepare_command,
    workflow_payments_lifecycle_payment,
    procedure_books_record_money_fact,
    operation_payment_send,
    flow_client_payments_pay,
  ],
});

export const decision_payments_payroll_door = defineDecision({
  id: "payments.payroll-door",
  title: "Payroll pays a run through the door; settled_at is the block's time",
  question:
    "Payroll asked the door for purpose payroll, an optional source on each item (the slip, its run, its Employee) kept " +
    "on the Payment and its book fact, and a mailbox for a payee with no account; and for `settled_at` to be the " +
    "settling block's time, with the settled transaction and block readable by the payer's tenant (C6). Which does " +
    "payments take?",
  options: [
    {
      label: "widen",
      text:
        "All of them: purpose `payroll`; per item an optional `source` (kind salary-slip or payroll-remittance, its id, " +
        "the Payroll Entry and the Employee) and `payee_mailbox`; `settled_at` defined as the settling block's time; the " +
        "settled facts stay on the row the payer holds.",
    },
    { label: "payroll-reads-chain", text: "Payroll reads the PaymentSent itself for the settled facts, and pays new hires only once they have an account." },
  ],
  chosen: "widen",
  why:
    "A run's pay and its Payments are one money fact, which the door already records for requests and banking; payroll " +
    "now depends on payments (dependencies.payments-payroll), and payments still knows nothing of payroll beyond an " +
    "opaque source: it never reads payroll's tables, and payroll routes `payment_transitioned` by the command and " +
    "payment ids it already holds. Books' door names a settlement's source as the Payment, so the slip reaches books in " +
    "the side's `against` (party the Employee, reference the Payroll Entry, the Payroll Payable account), which payroll " +
    "sets per item; the Payment's own `source` keeps the slip for reads and a head. The mailbox is per item because a " +
    "run mixes Employees with and without accounts; such an item is a budget claim escrow (payments.claim-escrow-routes). " +
    "`settled_at` is the block's time because books dates the fact at it and the slip copies it; when Capxul saw it is " +
    "`updated_at`. The payer owns the row, so its tenant already reads `settled_tx_hash` and `settled_block_number`, " +
    "and a concept above payments reads them as a plain read: nothing new is admitted. A resume still reopens a " +
    "command whose Payments all lapsed, which is how payroll retries a run's approval.",
  source: by("docs/design/frappe/payroll.md (For other lanes: Payments); books/target/payroll/staged.ts (payroll.runs.pay)"),
  affects: [procedure_payments_prepare_command, table_payments, table_payment_commands, workflow_payments_lifecycle_payment],
});
