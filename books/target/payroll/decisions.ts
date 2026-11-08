// Payroll's own judgments, as decision records. Made by Claude on 8 November 2026 while designing
// the target payroll concept, under A1-A4 and P1-P10 and the shared decisions (concepts.payroll,
// dependencies.payments-payroll, dependencies.of-payroll, rules.durable-processes), with the old
// code (/home/user/factory, integration/factory) and docs/as-is/archive/payroll/ as evidence.

import { defineDecision } from "../../../packages/book/src/index.ts";
import { concept_board, concept_books, concept_budgets, concept_notices, concept_payments, concept_payroll } from "../shared/foundation.ts";
import { contract_agreements, integration_indexer } from "../shared/external.ts";
import {
  error_CANCELLED,
  error_FEATURE_NOT_AVAILABLE,
  error_TOKEN_REQUIRED,
  error_TRANSACTION_FAILED,
  error_WRONG_STATE,
} from "../shared/vocabulary.ts";
import { machine_approval, table_approvals } from "../approvals/data.ts";
import { procedure_approvals_open, procedure_approvals_withdraw } from "../approvals/procedures.ts";
import { procedure_board_propose } from "../board/procedures.ts";
import { machine_proposal, table_board_proposals } from "../board/data.ts";
import { procedure_documents_store } from "../documents/procedures.ts";
import {
  event_agreement_transitioned,
  event_agreement_write_transitioned,
  event_payroll_entry_transitioned,
  event_salary_slip_transitioned,
  machine_agreement,
  machine_agreement_write,
  machine_employee,
  machine_payroll_entry,
  machine_salary_slip,
  machine_salary_structure,
  machine_salary_structure_assignment,
  table_agreement_writes,
  table_agreements,
  table_employees,
  table_payroll_changes,
  table_payroll_entries,
  table_payroll_head_syncs,
  table_payroll_settings,
  table_salary_components,
  table_salary_slips,
  table_salary_structure_assignments,
  table_salary_structures,
} from "./data.ts";
import { rpc_payroll_employees_add, rpc_payroll_employees_change, rpc_payroll_employees_list } from "./employees.ts";
import {
  rpc_payroll_structures_assign,
  rpc_payroll_structures_cancel,
  rpc_payroll_structures_component,
  rpc_payroll_structures_create,
  rpc_payroll_structures_list,
} from "./structures.ts";
import {
  IMPORT_RUN,
  rpc_payroll_runs_cancel,
  rpc_payroll_runs_create,
  rpc_payroll_runs_list,
  rpc_payroll_runs_show,
  rpc_payroll_runs_submit,
  rpc_payroll_runs_withhold,
} from "./runs.ts";
import { rpc_payroll_slips_mine } from "./slips.ts";
import {
  rpc_payroll_holders_change,
  rpc_payroll_holders_end,
  rpc_payroll_holders_list,
  rpc_payroll_holders_offer,
  rpc_payroll_holders_pause,
  rpc_payroll_holders_resume,
  rpc_payroll_holders_withdraw,
} from "./holders.ts";
import { rpc_payroll_payees_accept, rpc_payroll_payees_collect, rpc_payroll_payees_list, rpc_payroll_payees_show } from "./payees.ts";
import { rpc_payroll_writes_watch } from "./writes.ts";
import { workflow_payroll_agreements_lifecycle, workflow_payroll_head_sync, workflow_payroll_startup_open } from "./processes.ts";
import {
  flow_client_me_payslips,
  flow_client_org_payroll_employees_add,
  flow_client_org_payroll_employees_change,
  flow_client_org_payroll_employees_list,
  flow_client_org_payroll_runs_cancel,
  flow_client_org_payroll_runs_create,
  flow_client_org_payroll_runs_list,
  flow_client_org_payroll_runs_show,
  flow_client_org_payroll_runs_submit,
  flow_client_org_payroll_runs_withhold,
  flow_client_org_payroll_structures_assign,
  flow_client_org_payroll_structures_cancel,
  flow_client_org_payroll_structures_component,
  flow_client_org_payroll_structures_create,
  flow_client_org_payroll_structures_list,
  flow_client_me_agreements_accept,
  flow_client_me_agreements_collect,
  flow_client_org_agreements_change,
  flow_client_org_agreements_end,
  flow_client_org_agreements_offer,
  flow_client_org_agreements_pause,
  flow_client_org_agreements_resume,
  flow_client_org_agreements_withdraw,
} from "./flows.ts";
import {
  operation_agreement_accept,
  operation_agreement_collect,
  operation_agreement_list,
  operation_agreement_show,
  operation_org_agreement_change,
  operation_org_agreement_end,
  operation_org_agreement_list,
  operation_org_agreement_offer,
  operation_org_agreement_pause,
  operation_org_agreement_resume,
  operation_org_agreement_withdraw,
} from "./operations.ts";

const by = (evidence: string) => `Claude, payroll target design, 8 November 2026; evidence: ${evidence}`;
/** The payroll lane of the Frappe redesign: each judgment carries out the rulings its source names. */
const AFTER_RULING = (evidence: string) => `Claude, payroll lane of the Frappe redesign, 8 November 2026; rulings and evidence: ${evidence}`;
const OLD = "packages/backend/src/payroll";

const HOLDER_RPCS = [
  rpc_payroll_holders_offer,
  rpc_payroll_holders_withdraw,
  rpc_payroll_holders_change,
  rpc_payroll_holders_pause,
  rpc_payroll_holders_resume,
  rpc_payroll_holders_end,
];
const WRITE_FLOWS = [
  flow_client_org_agreements_offer,
  flow_client_org_agreements_withdraw,
  flow_client_org_agreements_change,
  flow_client_org_agreements_pause,
  flow_client_org_agreements_resume,
  flow_client_org_agreements_end,
  flow_client_me_agreements_accept,
  flow_client_me_agreements_collect,
];
const OPERATIONS = [
  operation_agreement_accept,
  operation_agreement_collect,
  operation_agreement_list,
  operation_agreement_show,
  operation_org_agreement_change,
  operation_org_agreement_end,
  operation_org_agreement_list,
  operation_org_agreement_offer,
  operation_org_agreement_pause,
  operation_org_agreement_resume,
  operation_org_agreement_withdraw,
];

export const decision_payroll_scope = defineDecision({
  id: "payroll.scope",
  title: "Payroll is Frappe HR's payroll, synced, beside the v4 agreements",
  question:
    "The concept map first gave payroll v4 Agreements only, and dropped runs, items, groups and terms. The ruling makes " +
    "payroll one of the two apps an Organization's data syncs with Frappe at the least, in Frappe's shapes from its " +
    "first day. What does payroll own?",
  options: [
    {
      label: "frappe-hr",
      text:
        "Payroll in Frappe HR's shape: Employees, Salary Components, Salary Structures and their Assignments, Payroll " +
        "Entries and Salary Slips, worked out by Capxul without a head and synced with a Frappe HR head once one is " +
        "connected. Pay that starts on chain, the v4 Agreements and their eleven operations, stays, and is reflected in " +
        "the same shapes. Saved groups and the old terms stay dropped; departments stay budgets'.",
    },
    { label: "concept-map", text: "Agreements and their terms only, as concepts.payroll first assigned; runs, items, groups and terms dropped." },
  ],
  chosen: "frappe-hr",
  why:
    "Rewritten to the ruling that superseded it. A Payroll Entry and its Salary Slips are how Frappe HR pays people whose " +
    "tax and other deductions are withheld, which an agreement, paying gross on chain, cannot. Every new rpc is reached by " +
    "an SDK flow (P2, payroll.hr-surface). The old settle-run procedure stays gone: a run pays through payments' door and " +
    "follows payments' settlement, so payments still never depends on payroll (payroll.pays-through-payments). The " +
    "eleven frozen operations keep their behaviour; the agreement's process only adds Frappe's records beside it.",
  source: AFTER_RULING("aaron.frappe-shape, aaron.erp-on-capxul, aaron.frappe-head; /tmp/hrms/hrms/payroll/doctype; docs/vision/erp.md (C16)"),
  affects: [concept_payroll, concept_budgets, concept_payments, table_agreements, table_employees, table_payroll_entries, table_salary_slips],
});

export const decision_payroll_no_door = defineDecision({
  id: "payroll.no-door",
  title: "Payroll has no procedures",
  question: "Does any other concept write payroll's tables inside its own transaction?",
  options: [
    { label: "none", text: "No: payroll's door is empty; readers above it (notices) read its tables and follow its events." },
    { label: "settle-run", text: "Keep old payroll's door procedures (settle-run, department spend, holder reads)." },
  ],
  chosen: "none",
  why:
    "Every old door procedure served runs, departments or notices, all gone or moved. A collection's Payment is born in " +
    "payments from the indexed PaymentSent, a fact both concepts read, so no money fact spans payroll and a concept above " +
    "it. What follows an agreement's change (an email, a projection) lags harmlessly and goes through the outbox (P4).",
  source: by("docs/as-is/archive/payroll/procedures.ts; P4; dependencies.payments-payroll"),
  affects: [concept_payroll, concept_notices],
});

export const decision_payroll_two_tables = defineDecision({
  id: "payroll.two-tables",
  title: "Two tables: agreements, and the writes on them",
  question: "Old payroll kept eight tables, three of them for agreements. Which survive, and in what shape?",
  options: [
    { label: "two", text: "`agreements` (what the chain cannot name, plus the status) and `agreement-writes` (every holder and payee write until the chain decides it)." },
    { label: "one", text: "One table, with the last write embedded as the old row had it (lastWrite, earlierWrites)." },
    { label: "three", text: "Keep separate holder-write and payee-write stores, as the old code did." },
  ],
  chosen: "two",
  why:
    "A holder's write and a payee's write are the same thing to the process: one Agreements call carried by an approval or " +
    "a proposal, decided by chain proof. One table keeps every collection with its window and PaymentSent id, and lets two " +
    "holders' writes be in flight at once (a pause beaten by another holder's pause is a frozen claim). An embedded last " +
    "write lost history and needed a 20-entry side list. Earned, collectable, the current rate and budget figures are read " +
    "from the chain when asked, never copied, so nothing drifts. The notice-claim table goes with the emails (payroll.notices-elsewhere).",
  source: by(`${OLD}/tables.ts:19-328; docs/as-is/archive/payroll/data.ts; org.agreement.pause acceptance 4`),
  affects: [table_agreements, table_agreement_writes],
});

export const decision_payroll_payee_reads = defineDecision({
  id: "payroll.payee-reads",
  title: "An agreement is its payer's row; the payee reads it by its own Safe",
  question: "An agreement belongs to the paying Organization and to a payee in another tenant. Whose tenant is the row?",
  options: [
    { label: "payer", text: "Tenancy organization (org_id, the payer); the payee reads, and opens its own accept and collect, under a second policy on payee_safe." },
    { label: "owner", text: "Tenancy owner, with the payee as the owner." },
    { label: "two-rows", text: "A payer row and a payee row per agreement." },
  ],
  chosen: "payer",
  why:
    "Every write on an agreement is the payer's money authority (Budgets' reservation) or the payee's acceptance of the " +
    "payer's terms, so the row is the payer's record. A payee's own Safe is what the agreement pays, and P8 already scopes " +
    "chain reads by Safe ownership, so a policy on payee_safe admits exactly the payee (a person, or an Organization's " +
    "members) to read the agreement and open its own accept and collect, and no one else. Two rows would be one fact stored twice. Writes carry the payer's org_id too, so their tenant " +
    "is never a join. A salary slip follows the same rule: the paying Organization's row, read by the employee through the Safe it pays.",
  source: by(`${OLD}/tables.ts:298 (by_payee index); P8`),
  affects: [table_agreements, table_agreement_writes, table_salary_slips],
});

export const decision_payroll_status_machine = defineDecision({
  id: "payroll.status-machine",
  title: "The nine statuses are stored and moved by the agreement's process",
  question: "Old payroll derived an agreement's status at every read from its row, the chain and the clock. Keep that?",
  options: [
    { label: "stored", text: "Store the status; only the agreement's process moves it, from indexed Agreements events and its own timers." },
    { label: "derived", text: "Derive the status at read time from agreementOf and the time, as the old agreementStatus did." },
  ],
  chosen: "stored",
  why:
    "A3 gives each long-lived object a process that owns its machine, and P7 makes each change one event from a " +
    "transition, which a status computed at read time can never send (an agreement that lapsed or ended unread would never " +
    "report it). Lists filter by status, so it must be a column. The names stay the nine `--status` takes (surface, " +
    "P10). `ending` is a holder's end only, as the old rule had it: a fixed term's own end leaves it active until it ends.",
  source: by(`${OLD}/agreements/rules.ts:64-85; packages/protocol/src/payroll/agreement-schema.ts:27-43; A3; P7`),
  affects: [machine_agreement, table_agreements],
});

export const decision_payroll_write_machine = defineDecision({
  id: "payroll.write-machine",
  title: "A write is awaiting until chain proof lands or fails it",
  question: "Old writes had awaiting_approval, sent, landed, failed and abandoned. What does a target write keep?",
  options: [
    { label: "four", text: "awaiting, landed, failed, abandoned: sending and its retries are the approval's, in approvals." },
    { label: "five", text: "Keep `sent`, and its submission and clearing rpcs." },
  ],
  chosen: "four",
  why:
    "Approvals owns sponsoring, the one send and the bundler's refusals (concepts.approvals), so `sent` and the old " +
    "record-submission and clear-submission rpcs would copy its state. The write needs only what approvals cannot know: " +
    "whether the transaction carried this write's own Agreements event (K6: only chain proof ends an attempt). A bundler " +
    "refusal before the send leaves the write awaiting while its approval tries again.",
  source: by(`${OLD}/agreements/writes/records.ts:100-150; ${OLD}/agreements/writes/payees.ts:80-149; K6`),
  affects: [machine_agreement_write, table_agreement_writes],
});

export const decision_payroll_reports = defineDecision({
  id: "payroll.reports",
  title: "What 'reports' means in payroll's claims",
  question:
    "Frozen claims say a write 'reports `accepted` once' or 'reports nothing'. The old event fired only for a landed " +
    "write; the target sends one event per transition of two machines. How does a claim's report map onto them?",
  options: [
    {
      label: "landed-write",
      text:
        "A report is agreement_write_transitioned to `landed` with its `change` (the old transition name, `rate_changed`, " +
        "`accepted`), at the block's time, prepared_by the holder or payee; 'reports nothing' is no such event and no status move.",
    },
    { label: "any-event", text: "A report is any event; then births, failures and abandonments send nothing." },
  ],
  chosen: "landed-write",
  why:
    "P7 wants every transition to send its machine's event, births and failures included, so the funnel sees an offer " +
    "prepared and a write that failed. The frozen claims were written against an event that marked only a landed write, " +
    "and their `change` names survive as the write's `change` column, so the claims stay word for word (P1) and still pass " +
    "against the old system. Each acceptance line's `observes` says which event the trace observer counts.",
  source: by(`${OLD}/agreements/events.ts:28-147 (payroll_agreement_transitioned on landing only); P1; P7`),
  affects: [event_agreement_transitioned, event_agreement_write_transitioned, ...OPERATIONS],
});

export const decision_payroll_one_process = defineDecision({
  id: "payroll.one-process",
  title: "One durable process per agreement, following its chain events",
  question: "What durable work does an agreement need, and how many workflows carry it?",
  options: [
    { label: "one", text: "One instance per agreement owns both machines: chain events, write outcomes and its own timers; the write rpcs signal it." },
    { label: "per-write", text: "A workflow per write, plus one per agreement for its timers." },
    { label: "sweep", text: "Keep a daily sweep that lapses offers and ends agreements, and settle writes when they are read." },
  ],
  chosen: "one",
  why:
    "rules.durable-processes names the agreement, and A3 gives its process the machine. A write lands in the same " +
    "transaction as the status move its event makes, which two processes could not share. A lapse and an end are dates, " +
    "so they are the process's timers (P3: what the old system swept for becomes a process's own timer). Ponder indexes " +
    "every Agreements event, so the process follows them at finality instead of the old settle-on-read. The chain events " +
    "are its waits, not triggers: its trigger is the offer's birth.",
  source: by(`${OLD}/agreements/operations/sweep.ts:44; ${OLD}/agreements/reads/context.ts:70 (settledContext); A3; P3`),
  affects: [
    workflow_payroll_agreements_lifecycle,
    machine_agreement,
    machine_agreement_write,
    contract_agreements.e.AgreementOffered,
    contract_agreements.e.AgreementAccepted,
    contract_agreements.e.OfferWithdrawn,
    contract_agreements.e.RateChanged,
    contract_agreements.e.RateChangeCancelled,
    contract_agreements.e.AgreementPaused,
    contract_agreements.e.AgreementResumed,
    contract_agreements.e.AgreementEnded,
    contract_agreements.e.Collected,
  ],
});

export const decision_payroll_write_outcomes = defineDecision({
  id: "payroll.write-outcomes",
  title: "A write's outcome: its approval's or proposal's end, checked on chain",
  question: "How does the agreement's process learn that a write's approval or Board proposal ended, and how it ended?",
  options: [
    {
      label: "outbox-and-facts",
      text:
        "approval_transitioned (opener payroll, the write as subject) or proposal_transitioned reaches the waiting instance " +
        "through the outbox; the process takes the transaction from the approval's row (or the executed proposal's) and " +
        "reads its indexed facts to land or fail the write.",
    },
    { label: "timer-poll", text: "A timer at the approval's deadline, then read the approval's row." },
    { label: "trigger-each", text: "A small workflow triggered by each terminal transition of approvals and board." },
  ],
  chosen: "outbox-and-facts",
  why:
    "P4 has the reacting concept follow the other's transition, and approvals' event names its opener and subject for " +
    "exactly this. Landing on the approval alone is not enough: a transaction can run and not change the agreement (a pause " +
    "beaten by another holder's), so `factsOf` must show the write's own event. A declined approval ends at once, which a " +
    "deadline timer would only notice minutes later; one workflow per terminal transition would be seven workflows for one wait.",
  source: by("approvals/data.ts (approval_transitioned: opener, subject); integrations indexer.factsOf; P4; K6"),
  affects: [
    workflow_payroll_agreements_lifecycle,
    machine_agreement_write,
    integration_indexer,
    table_approvals,
    machine_approval.t.land,
    machine_approval.t.revert,
    machine_approval.t.displace,
    machine_approval.t.expire,
    machine_approval.t.decline,
    machine_approval.t.refuse,
    machine_approval.t.withdraw,
  ],
});

export const decision_payroll_one_awaiting_per_signer = defineDecision({
  id: "payroll.one-awaiting-per-signer",
  title: "One write on its way per Safe and agreement",
  question: "When may a holder or payee open a write while another write on the same agreement still awaits?",
  options: [
    { label: "per-signer", text: "Any Safe may have one awaiting write per agreement; a second from the same Safe is WRONG_STATE naming the first's approval." },
    { label: "replace", text: "As old payroll: a new write replaces an unsent one and is refused only while one is sent." },
    { label: "per-agreement", text: "One awaiting write per agreement, whoever signs it." },
  ],
  chosen: "per-signer",
  why:
    "Two holders' pauses may race (a frozen claim), so per-agreement is too strict. Replacing an unsigned write left its " +
    "approval signable, so a 'replaced' write could still land unreported; with one awaiting write per Safe nothing lands " +
    "that payroll is not following. A waiting approval ends within the paymaster's window (approvals.open: at most 10 " +
    "minutes), or its signer declines it, so the block is short. The unique partial index is the guard.",
  source: by(`${OLD}/agreements/writes/records.ts:71 (writeInFlight, replace); approvals/procedures.ts (deadline); org.agreement.pause acceptance 4`),
  affects: [table_agreement_writes, machine_agreement_write.t.open, error_WRONG_STATE, ...HOLDER_RPCS, rpc_payroll_payees_accept, rpc_payroll_payees_collect],
});

export const decision_payroll_withdraw_carriers = defineDecision({
  id: "payroll.withdraw-carriers",
  title: "An ended offer takes its unsigned writes' approvals with it",
  question: "When an offer lapses, is withdrawn or is abandoned, what becomes of a write still waiting on it (an acceptance)?",
  options: [
    { label: "withdraw", text: "The process withdraws each such write's unsigned approval (approvals.withdraw) and abandons the write." },
    { label: "leave", text: "Leave the approval to expire; the chain refuses it if it is ever signed." },
  ],
  chosen: "withdraw",
  why:
    "approvals.withdraw's money fact is exactly this: an intent that ended takes its unsigned carrier with it, so nobody " +
    "signs a call whose intent Capxul no longer records. A signed approval is left to the chain, which fails it. A " +
    "collection is never withdrawn this way: earned pay stays collectable after an agreement ends.",
  source: by("approvals/procedures.ts (approvals.withdraw); rules.procedures"),
  affects: [workflow_payroll_agreements_lifecycle, procedure_approvals_withdraw],
});

export const decision_payroll_holder_writes = defineDecision({
  id: "payroll.holder-writes",
  title: "A holder's write is an approval from their own Safe, never a proposal",
  question:
    "dependencies.of-payroll says an agreement on a top budget is offered or changed by Board proposal. The frozen text " +
    "says a holder write 'is not a Director proposal'. Which does payroll build, and what does it use board for?",
  options: [
    { label: "approval", text: "Every holder write is one approval from the holder's Safe; board serves only an Organization payee's accept and collect." },
    { label: "proposal-on-top", text: "A holder write on a top budget is a Board proposal." },
  ],
  chosen: "approval",
  why:
    "The frozen `changes` lines of all six holder commands say it is not a Director proposal, and surface text wins (P10). " +
    "On v4 a department is a top budget whose office hat its holders wear, and Budgets authorises a hat's wearer from their " +
    "own Safe, so no holder write needs the Board. With `--org`, a payee Organization's Safe acts only by Board proposal, " +
    "which payroll opens with `board.propose` in its write's transaction (the call and the proposal are one fact).",
  source: by("books/frozen (org.agreement.* changes; agreement.accept, agreement.collect --org); org.department.create (v4: a top budget); P10"),
  affects: [...HOLDER_RPCS, rpc_payroll_payees_accept, rpc_payroll_payees_collect, concept_board, procedure_approvals_open],
});

export const decision_payroll_gates = defineDecision({
  id: "payroll.gates",
  title: "The payment-agreements gate refuses holders only",
  question: "Which payroll rpcs read access' `payment-agreements` gate, and which read `payslip-preview`?",
  options: [
    { label: "holders", text: "The six holder writes refuse FEATURE_NOT_AVAILABLE when it is off; payees and reads never do; collect reads payslip-preview to add the payslip." },
    { label: "all", text: "Every payroll rpc checks the gate." },
  ],
  chosen: "holders",
  why:
    "The frozen refusals put FEATURE_NOT_AVAILABLE on the holder commands only, and a frozen claim says a payee can still " +
    "accept what was offered with agreements off: the gate stops new commitments, never pay already promised. The payslip " +
    "is shown 'unless the payer turned previews off', which is the payer Organization's gate.",
  source: by("books/frozen (org.agreement.* refusals; agreement.accept acceptance 4; agreement.collect notes); access/procedures.ts (gates)"),
  affects: [...HOLDER_RPCS, rpc_payroll_payees_collect, error_FEATURE_NOT_AVAILABLE],
});

export const decision_payroll_drop_token_required = defineDecision({
  id: "payroll.drop-token-required",
  title: "Org agreement offer drops TOKEN_REQUIRED and gains the designed WRONG_STATE",
  question: "The offer's frozen refusals include TOKEN_REQUIRED, which its mistake text calls pre-v4. Keep it?",
  options: [
    { label: "drop", text: "Drop it: on v4 a budget pays in one token. Add WRONG_STATE for a closed budget, 64 open agreements or no budget yet, as the designed text has." },
    { label: "keep", text: "Keep it as a refusal the target never produces." },
  ],
  chosen: "drop",
  why:
    "The mistake reads 'Before v4, the department budgets in more than one token', and on v4 'every agreement belongs to " +
    "one budget, and through it to one Safe and one token' (agreements spec). P9 drops pre-v4 paths, and the designed " +
    "refusals (the v4 text, P10) list PAYROLL_BUDGET_EXCEEDED, WRONG_STATE and ROLE_PERMISSION_DENIED. A refusal no " +
    "implementation can produce fails `refusal-not-produced`. The code stays in the vocabulary for budgets' own use.",
  source: by("books/frozen (org.agreement.offer mistakes and designed refusals); docs/planning/protocol-v4/spec/agreements.md:26; P9"),
  affects: [operation_org_agreement_offer, rpc_payroll_holders_offer, error_TOKEN_REQUIRED, error_WRONG_STATE],
});

export const decision_payroll_acceptance = defineDecision({
  id: "payroll.acceptance",
  title: "Payroll's acceptance lines: verbatim but for v4 openings and one rewrite",
  question: "Which of payroll's 66 acceptance lines change, and how?",
  options: [
    {
      label: "minimal",
      text:
        "Keep every claim word for word; drop 'On v4' from its eight lines (P9); rewrite agreement list line 4, which " +
        "named the old settle-on-read, as an outcome.",
    },
    { label: "rewrite-reports", text: "Also rewrite every 'reports' and 'receipt' line into event and transaction terms." },
  ],
  chosen: "minimal",
  why:
    "'Is settled when read' describes the old mechanism (settledContext settled writes inside each read), which the target " +
    "replaces with the agreement's process; 'reads settled once it is on chain' is what a black box sees and still passes " +
    "against the old system. 'Reports' and 'receipt' name outcomes an observer checks (an event in the trace, a reverted " +
    "transaction on chain), so they stay, read as payroll.reports says. Lines naming the bundler or the mail sink stay " +
    "too: both are faults or sinks a world can drive.",
  source: by("books/frozen (agreement.list acceptance 4; eight 'On v4' lines); P1; P9"),
  affects: OPERATIONS,
});

export const decision_payroll_collection_payment = defineDecision({
  id: "payroll.collection-payment",
  title: "A collection reports its payment from the indexed PaymentSent",
  question: "`agreement collect` returns 'the one payment the payer made', which payments' ledger holds. Where does payroll get it?",
  options: [
    { label: "chain-fact", text: "The write keeps the PaymentSent id, amount and window from the transaction's indexed facts; payments births its Payment from the same fact." },
    { label: "read-payments", text: "Read the Payment from payments' ledger." },
  ],
  chosen: "chain-fact",
  why:
    "When this was decided neither concept depended on the other. Payroll now depends on payments " +
    "(dependencies.payments-payroll), and the choice stands: the write lands from the indexed facts in the agreement's " +
    "own transaction, which need not wait for payments to birth the Payment, and concepts.payments has payments settle " +
    "every PaymentSent, a collection included. The PaymentSent id is the key both sides share, so `payment get` finds " +
    "the Payment payroll reports, and books' collection accrual names it (payroll.collection-accrual).",
  source: by("shared decisions (concepts.payments, dependencies.payments-payroll); Agreements.collect pays through Budgets.payReserved (kind 4)"),
  affects: [rpc_payroll_writes_watch, flow_client_me_agreements_collect, operation_agreement_collect, table_agreement_writes, concept_payments],
});

export const decision_payroll_live_reads = defineDecision({
  id: "payroll.live-reads",
  title: "Reads ask Agreements and Budgets now; they never write",
  question: "Where do lists and shows get earned, collectable, the current rate and a department's budget, and may a read settle anything?",
  options: [
    { label: "chain-now", text: "From the chain at read time (agreementOf, availableOf, budgetOf, leftOf), refusing PROVIDER_ERROR when it does not answer; reads write nothing." },
    { label: "ponder-copy", text: "From Ponder's views only, computed with the clock." },
    { label: "settle-on-read", text: "As the old code: settle sent writes and proposals inside each read." },
  ],
  chosen: "chain-now",
  why:
    "The frozen notes say budgets are 'read from the chain as it is now', and earned pay accrues every second by the " +
    "Calendar, which only `availableOf` answers exactly. A read that writes is what made the old lists slow and racy; the " +
    "agreement's process now settles everything as it happens. The class is chain-read, no override.",
  source: by(`${OLD}/agreements/operations/list.ts:20; ${OLD}/agreements/reads/context.ts:70; books/frozen (org.agreement.list notes)`),
  affects: [rpc_payroll_holders_list, rpc_payroll_payees_list, rpc_payroll_payees_show],
});

export const decision_payroll_notices_elsewhere = defineDecision({
  id: "payroll.notices-elsewhere",
  title: "Agreement emails and the daily agreement notices are notices'",
  question:
    "Old payroll emailed on every landed write and ran a daily sweep (pay ready, a fixed term's last week, ended, a Safe " +
    "too short for what its payees can collect). Where does that go?",
  options: [
    { label: "notices", text: "Every email, and P3's daily agreement notices cron, are notices', fed by payroll's two events and its tables; the sweep's lapse and end are the process's timers." },
    { label: "payroll", text: "Keep a notify workflow and the daily sweep in payroll." },
  ],
  chosen: "notices",
  why:
    "concepts.notices puts every email after a change in notices, which depends on payroll ('an agreement offered, changed " +
    "or ending'). The notices a claim requires (one email when a resume lands, none for a withdrawal) follow " +
    "agreement_write_transitioned. The daily notices are calendar work with no single trigger, which P3 keeps as a cron, " +
    "and it only sends mail, so it is notices'. Its notice-claim table goes with it.",
  source: by(`${OLD}/agreements/operations/notify.ts:29; ${OLD}/agreements/operations/sweep.ts:44; P3; concepts.notices`),
  affects: [concept_notices, workflow_payroll_agreements_lifecycle, event_agreement_write_transitioned, operation_org_agreement_resume, operation_org_agreement_withdraw],
});

export const decision_payroll_flows = defineDecision({
  id: "payroll.flows",
  title: "One flow per write command, one rpc per read; the designed SDK names win",
  question: "How are the eleven commands implemented, and which SDK method names do the flows take?",
  options: [
    {
      label: "flows-for-writes",
      text:
        "Each write is a flow (prepare, approvals' sponsored read, sign, submit, wait, follow); each read is one rpc. " +
        "Names follow the designed `method` where one exists (`client.me.agreements.collect`).",
    },
    { label: "rpc-only", text: "Every command one rpc, with the CLI doing the signing and following." },
  ],
  chosen: "flows-for-writes",
  why:
    "A4: the SDK owns signing and the CLI calls one method; a write composes a prepare, a signature and two waits, so it " +
    "is a flow, and approvals asks every opener's flow to compose its signing rpcs. The frozen sdk of `agreement collect` " +
    "is `client.agreements.collect` but its designed method is `client.me.agreements.collect`, and the designed text wins " +
    "(P10), so both payee writes sit under `client.me`. The reads keep their frozen methods.",
  source: by("books/frozen (sdk and designed.method of the payroll operations); approvals/flows.ts; A4; P10"),
  affects: [...WRITE_FLOWS, rpc_payroll_holders_list, rpc_payroll_payees_list, rpc_payroll_payees_show],
});

export const decision_payroll_budgets = defineDecision({
  id: "payroll.budgets",
  title: "Payroll's budgets are class defaults",
  question: "Which budget class does each payroll record take, and does any need an override?",
  options: [
    { label: "defaults", text: "Write commands and flows chain-submit; reads and every prepare rpc chain-read; the write watch live-read; the process chain-settle. No overrides." },
    { label: "override", text: "Give the list reads a longer p95 for their per-agreement chain reads." },
  ],
  chosen: "defaults",
  why:
    "Each prepare rpc reads two to four contract views in parallel and writes one transaction: chain-read's 1-3 parallel " +
    "eth_calls. A list reads one view per agreement, also in parallel, within the same class at the sizes the product " +
    "sees. A person's signature and chain confirmation are waits and never system time (P5), so the flows fit chain-submit. " +
    "Each step of the process is a chain event to its recorded transition: chain-settle.",
  source: by("packages/book/src/budgets.ts; P5 (hop table)"),
  affects: [...HOLDER_RPCS, rpc_payroll_holders_list, rpc_payroll_payees_list, rpc_payroll_payees_show, rpc_payroll_writes_watch, workflow_payroll_agreements_lifecycle, ...WRITE_FLOWS],
});

export const decision_payroll_worlds = defineDecision({
  id: "payroll.worlds",
  title: "The seven worlds payroll's refusals are reached from",
  question: "Which named devnet snapshots do payroll's refusals need?",
  options: [
    {
      label: "seven",
      text:
        "org-with-department; org-with-agreements; org-with-agreements-off; org-with-closed-department; org-with-short-safe; " +
        "org-with-frozen-ceiling; org-with-writes-awaiting.",
    },
    { label: "one-per-refusal", text: "A world for every refusal." },
  ],
  chosen: "seven",
  why:
    "org-with-department: a funded USDC department (a top budget) with one office holder, another member and no agreements. " +
    "org-with-agreements: it plus an open offer to a person and one to an Organization's handle, an active agreement with " +
    "released pay, a paused, an ending and an ended one, a lapsed and a withdrawn offer, and the department's room nearly " +
    "used. The rest build on it: the payment-agreements gate off; the budget closed; the company Safe short of the released " +
    "pay; the payout ceiling frozen; and the payee's collection and a holder's pause each opened and unsigned.",
  source: by("books/frozen (payroll refusals); devnet supervisor worlds (environment devnet)"),
  affects: OPERATIONS,
});

export const decision_payroll_dropped = defineDecision({
  id: "payroll.dropped",
  title: "Old agreement rpcs that are folded in or dropped",
  question: "Old payroll registered 37 agreement functions. Which become target rpcs?",
  options: [
    {
      label: "fold",
      text:
        "Twelve rpcs and one process. The Organization-payee rows fold into the payee rpcs (`orgId`); preview-collect " +
        "folds into collect; cancel-change into change; the load, record, submission, settle, send, notice, sweep, claim " +
        "and emit functions are dropped; the org-side get and wait flows go.",
    },
    { label: "port", text: "Port each public row as its own rpc, and the internal ones as internal rpcs." },
  ],
  chosen: "fold",
  why:
    "P3 turns load, record and settle functions into steps and emit functions into the outbox; approvals sends every " +
    "operation, so the send functions have no place here; notices owns the notice reads, sweeps and claims. No frozen " +
    "operation reaches `payroll.agreements.get`, `preview-collect` or the org-side `wait` (P2): a write flow follows its " +
    "own write, and the payslip is part of the collection it previews. An Organization payee is the same payee with " +
    "`--org`, so it needs no second set of rows.",
  source: by("docs/as-is/archive/payroll/agreements.ts (37 rpcs, 2 workflows); docs/as-is/archive/payroll/flows.ts:549-857; P2; P3"),
  affects: [...HOLDER_RPCS, rpc_payroll_payees_accept, rpc_payroll_payees_collect, rpc_payroll_payees_list, rpc_payroll_payees_show, rpc_payroll_writes_watch, workflow_payroll_agreements_lifecycle],
});

// ── assembly ────────────────────────────────────────────────────────────────────────────────

const ASSEMBLY = (evidence: string) => `Claude, target assembly (rails-and-reads), 8 November 2026; evidence: ${evidence}`;

export const decision_payroll_static_links = defineDecision({
  id: "payroll.static-links",
  title: "Board's and documents' doors are plain imports; the process reads proposals",
  question:
    "payroll/links.ts loaded `board.propose` and `documents.store` dynamically while both concepts were being designed, " +
    "and the agreement's process described board's proposal table in words. Both concepts have landed. What changes?",
  options: [
    {
      label: "static",
      text:
        "Delete links.ts: the payee rpcs import `procedure_board_propose` from ../board/procedures.ts and the offer imports " +
        "`procedure_documents_store` from ../documents/procedures.ts; the lifecycle reads `board-proposals` for an " +
        "executed or failed proposal's transaction.",
    },
    { label: "keep", text: "Keep the dynamic stand-ins: they resolve to the same records once loaded." },
  ],
  chosen: "static",
  why:
    "A stand-in was only for a sibling that did not exist yet; payroll depends on both board and documents, so plain " +
    "imports are the conventional link and a renamed export now fails the typecheck instead of dangling. The process " +
    "needs the proposal row's `execution_tx_hash` to read the write's facts, so the table belongs in its reads.",
  source: ASSEMBLY("docs/decisions/assembly-items.md (payroll links); books/target/board/data.ts (board-proposals); books/target/documents/procedures.ts"),
  affects: [procedure_board_propose, procedure_documents_store, table_board_proposals, rpc_payroll_payees_accept, rpc_payroll_payees_collect, rpc_payroll_holders_offer, workflow_payroll_agreements_lifecycle],
});

export const decision_payroll_carrier_endings = defineDecision({
  id: "payroll.carrier-endings",
  title: "A failed Board proposal fails its write; an expired approval answers WRONG_STATE",
  question:
    "Board added a `failed` proposal (the company Safe ran it and the inner call failed, board.failed-proposal), and " +
    "approvals asks every opener to map an approval's end onto the frozen codes. What does an agreement write do with each?",
  options: [
    {
      label: "fail-and-map",
      text:
        "A `failed` proposal fails the write (`execution_failed`): it ran without effect, as a reverted operation does. The " +
        "flows answer a declined approval CANCELLED, one that expired unsent WRONG_STATE, and a refused, beaten or failed " +
        "write TRANSACTION_FAILED.",
    },
    { label: "abandon", text: "Treat a failed proposal as abandoned, like a rejected or replaced one." },
  ],
  chosen: "fail-and-map",
  why:
    "A failed proposal used its nonce on chain; abandoned means nothing reached the chain, which would read wrongly in " +
    "`agreement show`. Board asks openers to read `fail` as 'ran without effect', which is exactly a failed write. The " +
    "codes are the mapping of decision approvals.machine: expired is WRONG_STATE, declined is CANCELLED (contacts.decline-is-cancelled).",
  source: ASSEMBLY("books/target/board/decisions.ts (board.failed-proposal); books/target/approvals/decisions.ts (approvals.machine); assembly-items.md (approvals, board)"),
  affects: [machine_agreement_write, table_agreement_writes, workflow_payroll_agreements_lifecycle, machine_proposal.t.fail, ...WRITE_FLOWS, error_CANCELLED, error_WRONG_STATE, error_TRANSACTION_FAILED],
});

export const decision_payroll_collection_payment_id = defineDecision({
  id: "payroll.collection-payment-id",
  title: "A collection prints its Payment's id the way `payment get` takes it",
  question:
    "Payments names a Payment born from a chain fact `payment_` and the 64 hex digits of its v4 payment id " +
    "(payments.chain-born-ids), because `payment get` refuses an id that does not start with `payment_`. What does a " +
    "collection's `paymentId` print?",
  options: [
    { label: "derived", text: "The same derived id, built from the PaymentSent's payment id: no read of payments." },
    { label: "raw", text: "The PaymentSent's raw `0x` payment id." },
  ],
  chosen: "derived",
  why:
    "`agreement collect` returns 'the one payment the payer made', and a person follows it with `payment get`; the raw " +
    "id would be refused there. The id is a pure function of the indexed fact both concepts read, so payroll still never " +
    "reads payments (dependencies.payments-payroll).",
  source: ASSEMBLY("books/target/payments/decisions.ts (payments.chain-born-ids); payment.get.yaml (refusal CLI_USAGE); agreement.collect.yaml (returns)"),
  affects: [rpc_payroll_writes_watch, flow_client_me_agreements_collect, operation_agreement_collect],
});

// ── Frappe HR's payroll (the payroll lane of the Frappe redesign) ───────────────────────────

const HR_RPCS = [
  rpc_payroll_employees_add,
  rpc_payroll_employees_change,
  rpc_payroll_employees_list,
  rpc_payroll_structures_component,
  rpc_payroll_structures_create,
  rpc_payroll_structures_assign,
  rpc_payroll_structures_cancel,
  rpc_payroll_structures_list,
  rpc_payroll_runs_create,
  rpc_payroll_runs_submit,
  rpc_payroll_runs_withhold,
  rpc_payroll_runs_cancel,
  rpc_payroll_runs_show,
  rpc_payroll_runs_list,
];
const HR_TABLES = [
  table_employees,
  table_salary_components,
  table_salary_structures,
  table_salary_structure_assignments,
  table_payroll_entries,
  table_salary_slips,
];
const HR_FLOWS = [
  flow_client_org_payroll_employees_add,
  flow_client_org_payroll_employees_change,
  flow_client_org_payroll_employees_list,
  flow_client_org_payroll_structures_component,
  flow_client_org_payroll_structures_create,
  flow_client_org_payroll_structures_assign,
  flow_client_org_payroll_structures_cancel,
  flow_client_org_payroll_structures_list,
  flow_client_org_payroll_runs_create,
  flow_client_org_payroll_runs_submit,
  flow_client_org_payroll_runs_withhold,
  flow_client_org_payroll_runs_cancel,
  flow_client_org_payroll_runs_show,
  flow_client_org_payroll_runs_list,
  flow_client_me_payslips,
];
const HRMS = "/tmp/hrms/hrms/payroll/doctype";

export const decision_payroll_frappe_doctypes = defineDecision({
  id: "payroll.frappe-doctypes",
  title: "Six Frappe HR doctypes, one table each, with Frappe's field names",
  question: "Which of Frappe HR's doctypes does Capxul keep itself, and in what shape?",
  options: [
    {
      label: "six",
      text:
        "Employee, Salary Component, Salary Structure (its Salary Detail rows embedded), Salary Structure Assignment, " +
        "Payroll Entry (its Payroll Employee Detail rows embedded) and Salary Slip, with Frappe's field names and " +
        "options; Capxul's own fields only where money or identity needs them (a Party, a Safe, a budget, a payment's " +
        "settled facts), each a Custom Field on a head. Submittable doctypes are written submitted and never edited.",
    },
    { label: "own-shape", text: "Capxul's own payroll tables, mapped to Frappe's only by the sync." },
    { label: "all", text: "Every payroll doctype Frappe HR has: tax slabs, payroll periods, benefits, gratuity, arrears, leave, attendance." },
  ],
  chosen: "six",
  why:
    "These six are the whole path from a person to a paid slip in Frappe HR (`payroll_entry.py` makes slips from " +
    "assignments of structures of components), so with them an Organization's payroll is complete without a head and a " +
    "head reads it field for field: the sync renames nothing. Child tables are embedded because no reader queries a row " +
    "alone. Writing submitted documents at once keeps Frappe's rule that a submitted document is amended, never edited, " +
    "without a draft lifecycle for structures nobody reviews in Capxul. The rest (Income Tax Slab, Payroll Period, " +
    "benefits, gratuity, leave, attendance, timesheets) are a head's: a run that needs them is computed there " +
    "(payroll.one-computer-per-run). Additional Salary stays a head's own: a collection is pushed as its own slip, " +
    "never as one, which Frappe would fold into the next slip (payroll.agreements-in-frappe-shape).",
  source: AFTER_RULING(`aaron.frappe-shape, aaron.erp-on-capxul; ${HRMS} (salary_slip, payroll_entry, salary_structure_assignment JSON)`),
  affects: [...HR_TABLES, concept_payroll],
});

export const decision_payroll_agreements_in_frappe_shape = defineDecision({
  id: "payroll.agreements-in-frappe-shape",
  title: "An accepted agreement is an Employee and an assignment; no run pays it",
  question: "Pay that starts on chain, a v4 agreement, has no Frappe HR doctype. How does it appear in Frappe's shapes?",
  options: [
    {
      label: "employee-and-assignment",
      text:
        "At acceptance a person payee is hired as an Employee (if they have no live one) and assigned the Organization's " +
        "agreement structure from the start, on the agreement's rate: one earning, the agreement component, at no fixed " +
        "amount, not prorated by payment days, not taxed, left out when zero. A landed rate change assigns it anew from its " +
        "date; the end lets the Employee go when nothing else pays them. Each collection is a paid slip, which a head shows " +
        "as that slip, never as an Additional Salary. No run pays an agreement: a run Capxul makes leaves its assignments " +
        "out, and a head's run with an agreement assignment or an agreement component row is refused when taken in. An " +
        "Organization payee is a Supplier, which is accounting's, not HR's.",
    },
    { label: "slips-only", text: "Only each collection's slip; no Employee or assignment for an agreement." },
    { label: "none", text: "Agreements stay outside Frappe's shapes; the ledger alone records collections." },
  ],
  chosen: "employee-and-assignment",
  why:
    "A Salary Slip in Frappe needs an Employee with a submitted assignment (`set_salary_structure_assignment`), so a " +
    "collection can only be a slip if the agreement is an assignment. A structure with no fixed earning means a head " +
    "never works out pay of its own for an agreement. A collection must not become a submitted Additional Salary on the " +
    "head: Frappe HR adds every submitted Additional Salary whose payroll date falls in a slip's period to the next slip " +
    "it computes for that Employee (`get_additional_salaries` checks no earlier use), so a head's run would carry the " +
    "collection again and Capxul would pay it twice; and Frappe's default `depends_on_payment_days` would prorate the " +
    "collected amount. The guard that keeps one person's pay from being paid twice is therefore Capxul's own, on both " +
    "paths: a Capxul run leaves agreement assignments out, and taking in a head's run refuses them. Release frequencies " +
    "map to `payroll_frequency` (monthly, weekly, daily; a stream's every second is Frappe's empty option). Who is " +
    "employed is the agreement's process's to record because only it sees the acceptance and the end at the block's " +
    "time; the frozen operations' behaviour is unchanged, and the hire never holds up the agreement's own status move.",
  source: AFTER_RULING(`aaron.frappe-shape; ${HRMS}/salary_slip/salary_slip.py:961, :1718, :2250; ${HRMS}/additional_salary/additional_salary.py:331; docs/vision/erp.md (C16, C17)`),
  affects: [
    workflow_payroll_agreements_lifecycle,
    workflow_payroll_head_sync,
    table_agreements,
    table_employees,
    table_salary_components,
    table_salary_structures,
    table_salary_structure_assignments,
    machine_employee.t.hire,
    machine_employee.t.leave,
    machine_salary_structure.t.submit,
    machine_salary_structure_assignment.t.submit,
    rpc_payroll_runs_create,
  ],
});

export const decision_payroll_collection_slips = defineDecision({
  id: "payroll.collection-slips",
  title: "A landed collection is one paid slip, born paid, keyed by its write",
  question: "How is pay that starts on chain reflected as a payslip, and what document does it carry?",
  options: [
    {
      label: "born-paid",
      text:
        "When a collection's write lands, the agreement's process records one slip for a person payee: born `paid`, its " +
        "window as its period, the collected amount as its one earning (source collection), no deductions, its payment " +
        "id, transaction, block number and block time, and the agreement's terms document, whose hash the collection carried.",
    },
    { label: "run-it", text: "Collect collections into a monthly run and pay nothing on chain until the run." },
  ],
  chosen: "born-paid",
  why:
    "The chain already paid it: an agreement pays the released amount to the payee with no withholding, so the slip's " +
    "gross is its net and nothing is owed. The write's id makes it exactly once (`by_write`), and its payment id is " +
    "the same id payments' Payment carries, so a ledger posts it once. Its window is a half-open span of chain time; its " +
    "days are the dates of its start and of the instant before its end. A new payslip document would be a hash no chain " +
    "carries, so the slip names the terms document the chain did carry.",
  source: AFTER_RULING("aaron.frappe-shape; payroll.collection-payment-id; agreement-writes (payment_id, landed_at, args.period_start, args.period_end)"),
  affects: [workflow_payroll_agreements_lifecycle, machine_salary_slip.t.record_collection, table_salary_slips, operation_agreement_collect],
});

export const decision_payroll_portable_formulas = defineDecision({
  id: "payroll.portable-formulas",
  title: "Capxul works out Frappe's formulas in a subset, evaluated as Python does",
  question:
    "Frappe HR evaluates a component's condition and formula as Python with a few helpers (`_safe_eval`, " +
    "COMPONENT_EVAL_GLOBALS). Capxul must work slips out without a head, to the cent a head would. With what?",
  options: [
    {
      label: "portable-subset",
      text:
        "Keep every formula as Frappe writes it, and evaluate a subset of Python expressions: numbers, `+ - * /`, " +
        "comparisons, `and`, `or`, `not`, a conditional expression, eight of Frappe's helpers (`round`, `rounded`, " +
        "`floor`, `ceil`, `min`, `max`, `int`, `float`), and the names a slip has (`base`, `variable`, the day counts, " +
        "`gross_pay`, earlier rows' abbreviations). It is evaluated exactly as CPython evaluates it, in IEEE 754 binary64 " +
        "(true division, Python's `round` half to even on the binary value, `int` toward zero), and `rounded` with the " +
        "Banker's Rounding a head is set to. Each row's result is then rounded at once, as Frappe's `flt` does, and kept " +
        "as an exact decimal. Proration follows this version of Frappe HR: a row that depends on payment days is its " +
        "full-period amount (its formula over the earlier rows' full-period amounts) times payment days over working days; " +
        "any other row is its formula over the earlier rows' prorated amounts. A component outside the subset is kept, " +
        "marked not portable, for a head to compute.",
    },
    { label: "exact-decimals", text: "Evaluate the subset in exact decimal arithmetic." },
    { label: "amounts-only", text: "Fixed amounts only: no formulas until a head is connected." },
    { label: "python", text: "Run Frappe's own Python evaluator in a sandbox inside Capxul." },
  ],
  chosen: "portable-subset",
  why:
    "The subset covers what most structures use (a percentage of base, a cap, a prorated allowance). What makes it " +
    "portable is evaluating it the way the head does: Frappe's operands are Python floats, so exact decimals would " +
    "differ at the edges (`ceil(0.1 * 3 * 10)` is 4 on a head and 3 in exact decimals; `round(2.675, 2)` is 2.67 on a " +
    "head and 2.68 in exact half-even), and a Capxul run would then fail the head's check. Binary64 arithmetic and " +
    "Python's helpers are fully specified, so the same expression gives the same bits in both, and money is exact from " +
    "the row's rounding on (payroll.money-and-rounding). Amounts only would leave common structures without a head. A " +
    "Python sandbox is a second runtime with its own failure modes, and would still not have the head's leave, " +
    "attendance or tax slabs.",
  source: AFTER_RULING(`aaron.frappe-shape; ${HRMS}/salary_slip/salary_slip.py:1359, :1471, :2250; ${HRMS}/salary_structure_assignment/salary_structure_assignment.py:240`),
  affects: [table_salary_components, rpc_payroll_structures_component, rpc_payroll_structures_create, rpc_payroll_runs_create],
});

export const decision_payroll_one_computer_per_run = defineDecision({
  id: "payroll.one-computer-per-run",
  title: "A run is worked out where it is made; Capxul only pays a head's run",
  question:
    "Once a Frappe HR head is connected, both sides could work a slip out, and Frappe works one out again on every save. " +
    "Who computes a run?",
  options: [
    {
      label: "where-made",
      text:
        "The side a run is made on computes it, and owns its submit, withholding and cancel until it is paid. A run made " +
        "in Capxul (the FDE agent, the SDK) is worked out by Capxul and pushed to the head as a submitted Payroll Entry; " +
        "Frappe HR makes its own draft slips for it, which the Capxul app compares to the cent and submits one by one when " +
        "they agree. A run made in Frappe HR is computed by its full engine (tax slabs, leave, attendance, regional " +
        "deductions) and taken in by payroll's head sync once submitted, withheld slips withheld. Capxul never works an " +
        "imported slip out again, and pays either kind the same way.",
    },
    { label: "head-computes", text: "Once a head is connected, every run is made and computed there; Capxul's own run create refuses." },
    { label: "capxul-computes", text: "Capxul always computes; the head shows Capxul's slips (needs a fork to stop Frappe recomputing on save)." },
  ],
  chosen: "where-made",
  why:
    "Capxul is complete without a head and keeps working if a head is down, so it must compute; and a business that " +
    "connects Frappe HR wants its full engine, which only the head has. Making the computer per run avoids two sources " +
    "of truth for one slip without forking Frappe's recompute-on-save. Frappe's own path decides how a Capxul run lands: " +
    "submitting a Payroll Entry refuses slips that already exist for its dates (`validate_existing_salary_slips`) and " +
    "then makes its own (`create_salary_slips`), so the head's copy is the head's recompute, which agrees with Capxul's " +
    "because its formulas are portable; and submitting slips through the Payroll Entry posts an accrual Journal Entry " +
    "(`submit_salary_slips_for_employees`), so the app submits each slip alone (a slip's own submit posts nothing) and " +
    "the accrual stays books' one voucher. Where they disagree (a head recorded leave Capxul did not see), the head's " +
    "copy stays a draft with the difference, and the money already moved stands. A head's run is cancelled on the head, " +
    "where its accrual is, and the sync cancels it here. For Aaron: is it right that, with a head connected, people may " +
    "still make and pay runs from Capxul (the FDE agent, the CLI), or should the head become the only place runs are made?",
  source: AFTER_RULING(`aaron.frappe-head, aaron.erp-on-capxul; ${HRMS}/salary_slip/salary_slip.py:218, :276; ${HRMS}/payroll_entry/payroll_entry.py:113, :119, :1837`),
  affects: [
    table_payroll_entries,
    table_salary_slips,
    rpc_payroll_runs_create,
    rpc_payroll_runs_cancel,
    rpc_payroll_runs_withhold,
    workflow_payroll_head_sync,
    machine_payroll_entry.t.import,
    machine_salary_slip.t.import,
    machine_salary_slip.t.import_withheld,
  ],
});

export const decision_payroll_slip_machine = defineDecision({
  id: "payroll.slip-machine",
  title: "A slip's states: Frappe's four and Capxul's paying, escrowed and paid",
  question: "Frappe's Salary Slip has Draft, Submitted, Withheld and Cancelled, and no paid. What states does a Capxul slip have?",
  options: [
    {
      label: "seven",
      text:
        "draft, submitted, withheld and cancelled as Frappe has them; paying, escrowed and paid from payments' settlement " +
        "of the slip's Payment, which a head reads as Submitted with a `capxul_status` Custom Field; a collection's slip " +
        "born paid; a head's slip born submitted, or withheld when its Salary Withholding holds it. Back moves: a lapsed " +
        "approval to submitted, keeping its payment id for the same command's resume; a refunded escrow to submitted, its " +
        "payment fields cleared; a reorg's unsettle to paying.",
    },
    { label: "frappe-four", text: "Frappe's four only; paid is read from the ledger when asked." },
  ],
  chosen: "seven",
  why:
    "Frappe knows a run is paid only when its Bank Entry exists (`has_bank_entries`, true at the first entry), which " +
    "cannot say which person is paid. On Capxul each slip's net is its own Payment, so each slip has its own paid, from " +
    "chain proof at finality, and the employee sees it. Escrowed is its own state because a new hire's money has left " +
    "the budget but is not theirs until they claim it, and may come back. A lapsed slip keeps its Payment because " +
    "payments keeps that Payment retryable (`needs_retry`); a new Payment beside it could pay twice, so only its own " +
    "command's resume pays it, and it cannot be withheld or cancelled meanwhile. A refunded escrow's Payment is " +
    "cancelled for good, so the slip forgets it and a later command pays it anew. Frappe's Withheld is not a flag but a " +
    "Salary Withholding covering the slip's period (`check_salary_withholding`), so a head's withheld slip must arrive " +
    "withheld, never payable. One status column keeps it one machine with one event (P7); the head's Submitted is " +
    "unchanged, so no Frappe option is altered.",
  source: AFTER_RULING(`aaron.frappe-shape, aaron.budget-pay-unclaimed; ${HRMS}/payroll_entry/payroll_entry.py:1069; ${HRMS}/salary_slip/salary_slip.py:257, :355; payments/data.ts (payment)`),
  affects: [machine_salary_slip, event_salary_slip_transitioned, table_salary_slips],
});

export const decision_payroll_run_machine = defineDecision({
  id: "payroll.run-machine",
  title: "A run: draft, submitted, paying, paid or cancelled",
  question: "Frappe's Payroll Entry is Draft, Submitted, Cancelled, Queued or Failed. What does a Capxul run move through?",
  options: [
    {
      label: "five",
      text:
        "draft, submitted, paying, paid, cancelled; imported runs are born submitted; cancel only while no slip holds a " +
        "Payment; a lapse returns the run to submitted only while nothing of it is paid or escrowed. A head reads paying " +
        "and paid as Submitted with a `capxul_status` Custom Field.",
    },
    { label: "frappe", text: "Frappe's five, with paid read from the slips." },
  ],
  chosen: "five",
  why:
    "Queued and Failed are Frappe's background jobs for making and submitting many slips; Capxul works a run out in " +
    "one transaction, so it never has them. Paying and paid are what a holder and the FDE agent need to know: whether " +
    "the one approval was signed and whether every slip that is not withheld is paid. Frappe validates a Select against " +
    "its options on save, so paying and paid cannot be written to the head's `status`; they ride in `capxul_status`. A " +
    "run with anything paid is never cancelled: money that moved is reversed forward, never undone; and a run holding a " +
    "lapsed Payment is not cancelled either, because payments keeps that Payment retryable.",
  source: AFTER_RULING(`aaron.frappe-shape; ${HRMS}/payroll_entry/payroll_entry.py:104, :1735; ${HRMS}/payroll_entry/payroll_entry.json (status options)`),
  affects: [machine_payroll_entry, event_payroll_entry_transitioned, table_payroll_entries],
});

export const decision_payroll_pays_through_payments = defineDecision({
  id: "payroll.pays-through-payments",
  title: "A run pays through payments' door, now that payroll depends on payments",
  question:
    "Capxul pays a slip's net on chain. Payroll could build the budget spends and open their approval itself, as it " +
    "does for an agreement's calls, or birth them through payments' `payments.prepare-command`, as requests and banking " +
    "do. Which, given payroll did not depend on payments when this was decided?",
  options: [
    {
      label: "payments-door",
      text:
        "Through `payments.prepare-command` (purpose payroll, route budget), then follow `payment_transitioned` for the " +
        "settled facts. Payroll gains payments as a dependency; payments still never depends on payroll. The paying half " +
        "is payroll/staged.ts, staged until the shared foundation added the edge and registered since.",
    },
    { label: "own-spends", text: "Payroll builds `Budgets.spend` calls and opens their approval itself; payments births the Payments from the chain facts." },
  ],
  chosen: "payments-door",
  why:
    "A budget spend is a Payment and its route is payments' (concepts.payments): one request key per command (K1), the " +
    "funding check (K3), payment ids fixed before signing, retries that cannot pay twice, the claim escrow for a new " +
    "hire, and one settlement path with its reorg reversal. Building spends in payroll would copy all of it. An agreement " +
    "collection is different because Agreements pays it, not Budgets.spend. The edge points down the concept order " +
    "(payroll sits above payments), so it makes no cycle, and dependencies.payments-payroll's rule that payments never " +
    "depends on payroll holds. Registering the staged records before the edge would have broken the build's boundary " +
    "rules; with it they build with 0 problems and drive the run's and the slip's paying transitions.",
  source: AFTER_RULING("aaron.frappe-shape, aaron.budget-pay-unclaimed; shared/decisions.ts (concepts.payments, dependencies.payments-payroll); payments/procedures.ts"),
  affects: [concept_payroll, concept_payments, machine_payroll_entry.t.pay, machine_salary_slip.t.pay, machine_salary_slip.t.settle, rpc_payroll_runs_submit],
});

export const decision_payroll_run_one_approval = defineDecision({
  id: "payroll.run-one-approval",
  title: "A whole run is one payment command and one approval (C9)",
  question: "How many approvals does paying a run of N people take, does each payment keep its own payslip, and how is a lapse retried?",
  options: [
    {
      label: "one-command",
      text:
        "One payment command per run attempt, request key `payroll:` with the run's id and attempt, one item per slip " +
        "(its net to the Employee's Safe, its own payslip document), under one approval from the payer's own Safe. Asking " +
        "twice answers the same command. A lapsed approval is retried by resuming that same command (same key, " +
        "`resume`, same payment ids, one new approval); the attempt moves on only for slips that hold no Payment, such as " +
        "a slip released from withholding or refunded from escrow. Each slip keeps its command and payment id, by which " +
        "every later transition of its Payment finds it.",
    },
    { label: "new-key-on-lapse", text: "A lapse is retried as a new command under the next attempt's key, for new Payments." },
    { label: "per-slip", text: "One `payment send` per slip, each its own approval." },
  ],
  chosen: "one-command",
  why:
    "`payments.prepare-command` already takes many items, each with its own document, under one approval from the " +
    "payer's own Safe: what blocked C9 was only `payment send`'s one recipient, which payroll does not use. A person " +
    "signs a run once; an agent whose Seat holds the budget's allowance, or the Organization's FDE agent, signs it with " +
    "its key and needs no person, and the chain still caps it at what the budget has left. Each Payment keeps its own " +
    "payslip hash on chain, so every employee can prove their pay alone. A new key after a lapse would birth new " +
    "Payments while the lapsed ones stay `needs_retry` and retryable by `payment retry`, so one slip could be paid " +
    "twice; payments' own `resume` reopens the same Payments under the same key and can never pay twice. A run can " +
    "then hold several commands, so routing by the run's one command column would lose an earlier command's late " +
    "events (an escrow claimed after a refunded slip was paid again); routing by each slip's own command does not.",
  source: AFTER_RULING(
    "aaron.frappe-shape, aaron.fde-agent, aaron.seats; docs/vision/erp.md (C9, C11, section 4 step 8); payments/procedures.ts (items, one approval, resume); payments/data.ts (lapse, retry)",
  ),
  affects: [table_payroll_entries, table_salary_slips, machine_payroll_entry.t.pay, machine_payroll_entry.t.lapse, machine_salary_slip.t.pay, machine_salary_slip.t.lapse, concept_payments],
});

export const decision_payroll_new_hire_escrow = defineDecision({
  id: "payroll.new-hire-escrow",
  title: "A new hire with no account is paid into a claim escrow (C10)",
  question: "A run includes someone who has not claimed their Capxul account. What does payroll do with their slip?",
  options: [
    {
      label: "escrow",
      text:
        "Payroll sends their net in the same command, to their mailbox's Safe; payments pays it into a claim escrow from " +
        "the budget. The slip reads `escrowed` until they claim it, then `paid` when the escrow's payout settles; if the " +
        "budget's holder or the Board takes it back, payments cancels that Payment (outcome refunded), the slip is " +
        "`submitted` again and still owed, and a later `runs.pay` naming it pays it under the next attempt.",
    },
    { label: "hold", text: "Leave their slip submitted and pay it in a later command once their account is live." },
  ],
  chosen: "escrow",
  why:
    "The ruling lets a budget pay someone with no account through a claim escrow, with payroll to new hires as its " +
    "reason, and the money-waiting email tells them how to collect. The Employee is a provisional Party at the Safe " +
    "their mailbox derives, so nothing about them waits on an account. Escrowed is not paid: the money is refundable " +
    "until claimed, so the net stays owed on Payroll Payable and books posts nothing until the claim's payout settles " +
    "(books' own rule for money waiting in an escrow); the run is not paid until the claim. Holding the slip would make " +
    "every first payday a second approval.",
  source: AFTER_RULING("aaron.budget-pay-unclaimed, aaron.money-waiting, aaron.money-waiting-reminders; docs/vision/erp.md (C10); docs/design/frappe/accounting.md (money waiting in a claim escrow)"),
  affects: [machine_salary_slip.t.escrow, machine_salary_slip.t.refund, machine_salary_slip.t.settle, table_employees, rpc_payroll_employees_add],
});

export const decision_payroll_deduction_remittance = defineDecision({
  id: "payroll.deduction-remittance",
  title: "Deductions stay owed; their payee is paid outside the run",
  question: "Frappe HR leaves each deduction a liability nobody pays. Who pays the tax office or the pension fund, and how?",
  options: [
    {
      label: "payee-recorded",
      text:
        "A deduction or employer contribution may name the Party its liability is owed to (a Custom Field on a head). " +
        "The run's command carries nets only. When a remittance falls due, a holder of the department budget, or the FDE " +
        "agent, pays that Party with an ordinary budget payment against the component's liability account, which books " +
        "posts as a Bank Entry on that liability. A component with no payee stays a liability, as in Frappe HR.",
    },
    {
      label: "in-run",
      text:
        "Add one remittance item per payee, the run's total for it, to the run's command, under a schedule document.",
    },
    { label: "never", text: "As Frappe HR: payroll records no payee at all." },
  ],
  chosen: "payee-recorded",
  why:
    "Remitting inside the run's command was the first design, and does not hold: a run can hold several commands (a " +
    "resumed one, a released or refunded slip's), and each would add the run's remittance again and pay the tax office " +
    "twice; the remittance Payments would have no record in payroll to follow or retry; and documents has no kind for " +
    "a remittance schedule. Remittances also fall due on their own calendar (usually once a period for every run), " +
    "which is how the vision has them, not on payday. An ordinary budget payment already carries an account for books " +
    "and keeps its own request key, so nothing new is needed, and Frappe HR's behaviour is kept. Recording the payee " +
    "lets the FDE agent pay it without asking.",
  source: AFTER_RULING("aaron.frappe-shape; docs/vision/erp.md (section 4, step 2); /tmp/hrms/hrms/payroll/doctype/salary_component_account; docs/design/frappe/accounting.md (payment send --account)"),
  affects: [table_salary_components, rpc_payroll_structures_component],
});

export const decision_payroll_accrual = defineDecision({
  id: "payroll.accrual",
  title: "A run's accrual has one author, the side that computed it; payroll posts none",
  question: "Frappe HR posts an accrual Journal Entry when slips are submitted and a Bank Entry when they are paid. Who posts them on Capxul?",
  options: [
    {
      label: "author-follows-computer",
      text:
        "The accrual (each earning's expense, each deduction's liability, Payroll Payable for each net, party the " +
        "Employee) is posted once, by the side that computed the run. For a run Capxul computed, books posts it through " +
        "its door `books.record-payroll-accrual`, which `runs.submit` invokes (action submit) and `runs.cancel` invokes " +
        "(action cancel) in their own transactions (payroll depends on books; books cannot read payroll); a head " +
        "receives it from books' feed and never posts its own. A landed collection's paid slip accrues the same way " +
        "(action collection: payroll.collection-accrual). For a run its head computed, the " +
        "head's own `make_accrual_jv_entry` posts it, books takes it in through its sync, and taking the run in invokes " +
        "nothing. The Bank Entry is always books', from each settled Payment's money fact: the one `make_bank_entry` would " +
        "have made, per slip (Payroll Payable, party the Employee, reference the Payroll Entry, against the treasury " +
        "account of the Safe and token, the transaction as cheque number, the block's date). Money waiting in an escrow " +
        "posts nothing until the claim settles.",
    },
    { label: "payroll-posts", text: "Payroll posts both into books' tables when it moves a run." },
    { label: "books-always", text: "Books posts every run's accrual, a head's included." },
  ],
  chosen: "author-follows-computer",
  why:
    "Posting is the ledger's, and books keeps one author per voucher (books.sync, invariant books.one-author-per-voucher): money in a Safe is " +
    "Capxul's, every other voucher its head's. A head that submits its slips through the Payroll Entry has already " +
    "posted the accrual, so books posting it too would count every salary twice; a Capxul run on a head has its slips " +
    "submitted one by one, which posts nothing, so books' accrual is the only one. Without a head, books must post it, or " +
    "salaries would never reach expense and Payroll Payable would be debited with no credit. Books cannot depend on " +
    "payroll (a cycle through payments), so the accrual must come through a door payroll invokes, never a read. A " +
    "settled Payment already writes exactly one book fact, so payroll posting the Bank Entry would post it twice; a " +
    "per-slip Bank Entry is what makes each employee's payable close at its own block.",
  source: AFTER_RULING(`aaron.books-first-principles, aaron.frappe-shape; ${HRMS}/payroll_entry/payroll_entry.py:619, :1093, :1837; books.sync, books.head-vouchers`),
  affects: [rpc_payroll_runs_submit, rpc_payroll_runs_cancel, workflow_payroll_head_sync, workflow_payroll_agreements_lifecycle, concept_books],
});

export const decision_payroll_head_sync = defineDecision({
  id: "payroll.head-sync",
  title: "Payroll syncs its own records with a head: pushed in order, pulled on a ring",
  question: "When a Frappe HR head is connected, who moves payroll's records, which way, keyed how, and what changes in Frappe?",
  options: [
    {
      label: "own-sync",
      text:
        "Payroll's own process (`payroll.head.sync`), as contacts and projects have theirs: it pushes every change of " +
        "the six records from payroll's gap-free change log, in order, and pulls the head's own changes when the head " +
        "rings, with Capxul's key; the head never calls Capxul's rpcs. Employees, components, structures and assignments " +
        "are shared business records; runs and slips belong to the side that computed them; agreements' records and every " +
        "payment fact are Capxul's only. The key is Capxul's id in a `capxul_id` Custom Field, and `head_name` here. " +
        "Money and identity (Party, Safe, the pay mailbox, budget, payment facts) only Capxul changes; a head change to " +
        "them is pushed back. Frappe gets Custom Fields, three Property Setters, settings and a Client Script from the " +
        "Capxul app: no fork.",
    },
    { label: "head-pushes", text: "The head's Capxul app calls payroll's SDK flows as the Organization's agent, and takes in runs through an import rpc." },
    { label: "fork-hr", text: "Fork Frappe HR so its Salary Slip has Capxul's states and its payment step is Capxul's." },
  ],
  chosen: "own-sync",
  why:
    "The head connection's contract is that Capxul always calls and the head only rings (organizations.head-doorbell, " +
    "integration frappe-head), and that each concept syncs its own records by the three classes of " +
    "organizations.head-ownership; a head pushing through the SDK would make it a writer into Capxul holding Capxul's " +
    "trust, which that contract refuses. A change log numbered under one lock is what lets a head replay payroll exactly " +
    "once; a time column cannot. On the head, nothing is forked. Custom Fields carry what Frappe has no field for: " +
    "`capxul_id` on all six doctypes; `capxul_party` on Employee; `capxul_payee_party` on Salary Component " +
    "(organizations.frappe-app-fields: one Party field across the apps); " +
    "`capxul_budget_id` and `capxul_agreement_id` on Salary Structure Assignment; `capxul_budget_id`, " +
    "`capxul_command_id`, `capxul_status` and `capxul_computed_by` on Payroll Entry (Frappe validates `status` against " +
    "its options, so paying and paid cannot go there); and on Salary Slip `capxul_status`, `capxul_payment_id`, " +
    "`capxul_chain_payment_id`, `capxul_tx_hash`, `capxul_paid_at`, `capxul_document_hash` and `capxul_computed_by`. " +
    "Three Property Setters: Employee's `gender` and `date_of_birth` optional (Capxul never needs them), and `Capxul` " +
    "added to Employee's `salary_mode` options (Bank, Cash, Cheque otherwise refuse Capxul's value). Settings match " +
    "payroll-settings and Banker's Rounding. A Client Script hides Payroll Entry's Submit Salary Slip and Make Bank Entry " +
    "on a Capxul run, and the app sets each such slip's, and each collection slip's, `journal_entry` to books' accrual voucher, so neither Frappe " +
    "button can post a second entry. Frappe's mandatory `company`, `cost_center`, `exchange_rate` and Payable " +
    "`payroll_payable_account` come from the Company's defaults, books' chart and the rate books posted at " +
    "(books.payroll-lines). Withholding is a Salary Withholding " +
    "over the slip's period both ways. A collection is a submitted slip, never an Additional Salary.",
  source: AFTER_RULING("aaron.frappe-head, aaron.erp-on-capxul; organizations.head-ownership, organizations.head-doorbell; shared/external.ts (frappe-head); contacts.head.sync; erpnext employee.json; hrms payroll_entry.json"),
  affects: [...HR_TABLES, table_payroll_changes, table_payroll_settings, table_payroll_head_syncs, workflow_payroll_head_sync, ...HR_RPCS, workflow_payroll_agreements_lifecycle],
});

export const decision_payroll_mailbox_for_pay = defineDecision({
  id: "payroll.mailbox-for-pay",
  title: "An Employee is paid at the mailbox they keep, never a work address",
  question: "A person's Safe is a function of their mailbox, and nothing moves it to another (C27). Which mailbox does payroll pay?",
  options: [
    { label: "personal", text: "`personal_email`, the one the person keeps; a `company_email` is never a payee locator." },
    { label: "any", text: "Whatever mailbox HR typed, work or personal." },
  ],
  chosen: "personal",
  why:
    "Pay to a work mailbox would land in a Safe the person loses with the job. Frappe's Employee already separates " +
    "`personal_email` from `company_email`, so payroll keys pay on the first and never reads the second; changing an " +
    "Employee never changes their Party or Safe. The head sync resolves a head-born Employee's Party the same way, as " +
    "the CRM lane asked (parties.mailbox-for-life), and never takes the pay mailbox from the head.",
  source: AFTER_RULING("aaron.erp-on-capxul; docs/vision/erp.md (C27); /tmp/erpnext/erpnext/setup/doctype/employee/employee.json"),
  affects: [table_employees, rpc_payroll_employees_add, rpc_payroll_employees_change, workflow_payroll_head_sync],
});

export const decision_payroll_hr_authority = defineDecision({
  id: "payroll.hr-authority",
  title: "The People hat is Frappe's HR Manager; paying is the budget's",
  question: "Who may change an Organization's payroll records, and who may pay a run?",
  options: [
    {
      label: "people-hat",
      text:
        "Records (Employees, components, structures, assignments, runs) are changed and read by a member whose Safe wears " +
        "the People hat, read from the chain's indexed wearers; paying a run is whoever Budgets authorises on its " +
        "department's budget. Employees read their own slips.",
    },
    { label: "any-member", text: "Any member may change payroll records." },
  ],
  chosen: "people-hat",
  why:
    "Salaries are private, and the People hat is the officer hat for people, as Frappe's HR Manager role is; the same " +
    "hat already guards the company's contact book. Splitting who records pay from who pays it is Frappe's own split " +
    "between HR and Accounts, and on Capxul the second is decided on chain.",
  source: AFTER_RULING("aaron.contacts-permissions, aaron.frappe-shape; organizations/data.ts (people_hat); indexing/data.ts (hat-wearers)"),
  affects: [...HR_RPCS],
});

export const decision_payroll_hr_surface = defineDecision({
  id: "payroll.hr-surface",
  title: "Frappe HR's capabilities reach the CLI now, beside the SDK and web app",
  question: "The HR rpcs are new capabilities, not among the 215. Which surfaces reach them, and when do they get CLI commands?",
  options: [
    {
      label: "sdk-now",
      text:
        "One SDK flow per rpc, on the SDK and the web app (the FDE agent, any agent, people; a head is synced by " +
        "payroll's own process, never through them); their " +
        "CLI commands (`org employee add|change|list`, `org payroll component|structure|assign|run|submit|withhold|pay|" +
        "cancel|show|list`, `payslip list|show`) are designed with acceptance claims in the payroll operations pass, from " +
        "docs/design/frappe/payroll.md.",
    },
    {
      label: "cli-now",
      text:
        "Recommended: book now, with acceptance claims and worlds, exactly the 28 commands of " +
        "docs/design/new-commands.md (section 5.3), in its one grammar; each calls one SDK method, whose flow keeps " +
        "`react` and adds `cli`: `org employee add|change|get|list|suspend|deactivate|reinstate|leave` " +
        "(`client.org(orgId).employees.*`; the four status verbs are the Employee machine's, over " +
        "`payroll.employees.change`; `get` is a new rpc); `org payroll component add|change|list|disable|enable` (over " +
        "`payroll.structures.component` and `.list`); `org payroll structure create|cancel|assign|unassign|list` " +
        "(`unassign` cancels an assignment, over `payroll.structures.cancel`); `org payroll run " +
        "create|submit|pay|cancel|list|get` (`get` over `payroll.runs.show`); `org payslip withhold|release` (over " +
        "`payroll.runs.withhold`); and the payee's own `payslip list|get` (`client.me.payslips.*` over " +
        "`payroll.slips.mine`, filtered by `--employer`, never `--org`). Who (payroll.hr-authority): a member whose Safe " +
        "wears the People hat changes and reads the records; paying a run is whoever Budgets.authorised admits on its " +
        "department's budget; a payee reads their own slips. Reads are `read`, `org payroll run pay` `chain-submit`, " +
        "the rest `write`, all `normal`.",
    },
  ],
  chosen: "cli-now",
  why:
    "Aaron asked on 8 November 2026 for the new commands to be designed in the book; booked under rules.new-operations " +
    "on this recommendation, which stands until he answers. The capability serves aaron.frappe-shape (payroll in " +
    "Frappe HR's shape in every Organization), and the FDE works it through the same CLI (aaron.fde-agent). The rpcs " +
    "and flows came first (sdk-now); the commands now follow the one grammar every new command keeps " +
    "(docs/design/new-commands.md): nouns then verbs, a status step as its own verb, `get` for one record, and one SDK " +
    "method per command, so a flow that served two steps is two commands. Every rpc stays reached (P2), and each flow " +
    "keeps its class default budget.",
  source: AFTER_RULING("aaron.frappe-shape, aaron.fde-agent, aaron.projects (new capabilities designed book first)"),
  affects: [...HR_FLOWS, ...HR_RPCS, rpc_payroll_slips_mine],
});

export const decision_payroll_money_and_rounding = defineDecision({
  id: "payroll.money-and-rounding",
  title: "Amounts are rounded per row as Frappe rounds, then exact, paid in raw units",
  question: "Frappe's Currency is a float rounded by the site's method. How does Capxul keep the figures?",
  options: [
    {
      label: "row-rounded-then-exact",
      text:
        "Each row's amount, once its formula is evaluated as Python does (payroll.portable-formulas), is rounded to the " +
        "token's display precision (2 places) with Frappe's non-legacy Banker's Rounding (`_bankers_rounding`: half to " +
        "even within its epsilon), which the Capxul app sets on a head. From there every amount is an exact decimal " +
        "string: totals are exact sums, there is no rounded total, and the net is paid as `net_pay_raw` in the token's " +
        "raw units.",
    },
    { label: "exact-throughout", text: "Exact decimals from the formula on, rounded half to even." },
    { label: "float", text: "Frappe's floats with its legacy rounding." },
  ],
  chosen: "row-rounded-then-exact",
  why:
    "A float that drifts a cent makes the chain pay a figure the slip does not show, so money is exact once a row is " +
    "rounded. Before that, the head's figure is what the head's floats give, and the only way to give the same cent is " +
    "to compute it the same way. The legacy method (Frappe's default) rounds half up above zero places, so the app sets " +
    "the non-legacy one. A head stores Currency to nine places, so exact sums of two-place rows are what it stores too; " +
    "Payroll Settings' disabled rounded total keeps the net the sum of the rows.",
  source: AFTER_RULING("aaron.frappe-shape; /tmp/frappe/frappe/utils/data.py:1255 (rounded), :1276 (legacy), :1329 (_bankers_rounding)"),
  affects: [table_salary_slips, table_salary_structures, table_payroll_settings, rpc_payroll_runs_create],
});

export const decision_payroll_one_live_employee = defineDecision({
  id: "payroll.one-live-employee",
  title: "One live Employee per person; a returning person is a new Employee",
  question: "An Employee who left is final, and the index allowed one Employee per person. What happens when someone comes back?",
  options: [
    {
      label: "new-employee",
      text:
        "At most one Employee per person and Organization is live (not left). A person who left and is hired again, by " +
        "`employees.add` or by accepting a new agreement, is a new Employee; the old record keeps its history.",
    },
    { label: "reinstate", text: "Let a left Employee return to active, clearing its relieving date." },
  ],
  chosen: "new-employee",
  why:
    "With `left` final and one Employee per person, a contractor who left could never accept another agreement: the " +
    "agreement's process could neither hire nor reinstate them. Frappe treats a rehire as a new Employee (its duplicate " +
    "check counts only Active ones), so its slips, joining date and payment days start afresh, and a head shows the same.",
  source: AFTER_RULING("aaron.frappe-shape; /tmp/erpnext/erpnext/setup/doctype/employee/employee.py:406 (validate_duplicate_user_id)"),
  affects: [table_employees, machine_employee.t.hire, rpc_payroll_employees_add, workflow_payroll_agreements_lifecycle],
});

export const decision_payroll_startup = defineDecision({
  id: "payroll.startup",
  title: "Payroll starts by writing its Payroll Settings at the setup's begin",
  question:
    "organizations.startup has each fundamental app start itself at the setup's `begin`, payroll with its Payroll " +
    "Settings and salary components. What does payroll make there?",
  options: [
    {
      label: "settings-at-begin",
      text:
        "A payroll process triggered by the setup's `begin` (`payroll.startup.open`) writes the Organization's Payroll " +
        "Settings, as Frappe HR's install sets that single's defaults: the values Capxul computes by (leave-based, " +
        "holidays counted, no rounded total, no Frappe email) and the change counter at zero. No salary component: " +
        "components are the Organization's own to define, and the agreement component is made at its first acceptance.",
    },
    {
      label: "nothing-at-begin",
      text:
        "The earlier choice: nothing at begin; the `payroll-settings` row is born with the Organization's first payroll " +
        "write.",
    },
    { label: "settings-and-components", text: "Write the settings and a starting set of components (basic pay, a tax deduction) at begin." },
  ],
  chosen: "settings-at-begin",
  why:
    "Rewritten at the assembly: this record first chose nothing-at-begin, since the settings are constants. The row is " +
    "not only constants: it holds the change log's counter, whose lock every payroll write takes (rpcs, the agreement's " +
    "process, the head sync), so with it born at begin no writer has to birth a lock row in a race, and payroll starts " +
    "as projects does (projects.startup) and as organizations.startup expects, in Frappe's shape from the first day. " +
    "A writer that still finds no row (the start-up not yet run) births it, so nothing waits on the process. Starting " +
    "components would be guesses about a business's pay that its People hat or FDE makes better in conversation, and " +
    "Frappe HR installs none either outside its India regional setup (its `make_fixtures` has no Salary Component); " +
    "organizations.startup's mention of salary components is answered with none. The values written are Capxul's, " +
    "not Frappe HR's install defaults (which count no holidays, round the total and email slips).",
  source: AFTER_RULING("aaron.frappe-shape, aaron.fde-agent; organizations.startup; /tmp/hrms/hrms/setup.py:606 (set_single_defaults); payroll_settings.json"),
  affects: [table_payroll_settings, concept_payroll, workflow_payroll_startup_open],
});

export const decision_payroll_import_run = defineDecision({
  id: "payroll.import-run",
  title: "How a run the head computed is taken in, checked and never paid twice",
  question:
    "Payroll's head sync finds a Payroll Entry the head submitted. What must hold before Capxul will pay it, and what is " +
    "written when it is taken in?",
  options: [
    { label: "checked-once", text: IMPORT_RUN },
    { label: "trust-the-head", text: "Take the head's slips as they come and pay their nets." },
  ],
  chosen: "checked-once",
  why:
    "Capxul is the system of record for money, so a head's figures are paid only after Capxul's own checks: rows that " +
    "add up, no overlap, no agreement pay (Frappe would fold a collection back into a slip), Frappe's Withheld kept " +
    "withheld, and a unique head name so a repeated pull never births a second run. It is the head sync's step, not an " +
    "rpc the head calls, because the head never writes into Capxul (organizations.head-doorbell). The accrual stays the " +
    "head's voucher (payroll.accrual).",
  source: AFTER_RULING(
    `aaron.frappe-head; ${HRMS}/salary_slip/salary_slip.py:257 (check_salary_withholding), :383 (check_existing); ${HRMS}/payroll_entry/payroll_entry.py:1837`,
  ),
  affects: [workflow_payroll_head_sync, machine_payroll_entry.t.import, machine_salary_slip.t.import, machine_salary_slip.t.import_withheld, table_payroll_entries, table_salary_slips],
});

// ── the assembly after the Frappe lanes (8 November 2026) ───────────────────────────────────

const FRAPPE_ASSEMBLY = (evidence: string) => `Claude, assembly of the Frappe lanes (ledger: books and payroll), 8 November 2026; evidence: ${evidence}`;

export const decision_payroll_books_accounts = defineDecision({
  id: "payroll.books-accounts",
  title: "Payroll's accounts are books' ids: role accounts by default, checked when given",
  question:
    "Payroll keeps Frappe's account links (a component's expense and liability, a run's and an assignment's Payroll " +
    "Payable, a run's treasury) as books' account ids, and asked books for the defaults. How does payroll fill and " +
    "check them, now that it depends on books?",
  options: [
    {
      label: "roles-and-checks",
      text:
        "A run's and an assignment's Payroll Payable is books' `payroll_payable` account, and a run's `payment_account` " +
        "the `safe` account of the company Safe and the run's token, each read from books' chart when the record is " +
        "made, null before the chart. A component's `account` and `liabilityAccount` are given by code or id, active " +
        "ledger accounts read as Frappe HR's accrual reads them: an earning's or employer contribution's `account` under " +
        "Expenses, a deduction's `account` under Liabilities, `liabilityAccount` only an employer contribution's, under " +
        "Liabilities; left out they are null, and the accrual posts the line to its role's account " +
        "(books.payroll-defaults). The agreement component's accounts may be set, so collections accrue to the expense " +
        "the business chooses (contractors, say).",
    },
    { label: "unchecked", text: "Keep whatever account ids are given, and let books' fallback catch an unfit one." },
  ],
  chosen: "roles-and-checks",
  why:
    "Frappe HR refuses a run with no payable and a component with no account; Capxul's books never refuse an accrual, " +
    "so payroll is where a wrong account is caught, at the command, while a person can still fix it. One Payroll " +
    "Payable per Company keeps a run's accrual and its slips' Bank Entries on the same account, chart or no chart " +
    "(books.payroll-postings). Payroll reads books' chart as a plain read: books sits below it.",
  source: FRAPPE_ASSEMBLY("docs/design/frappe/payroll.md (For other lanes: Books); books.payroll-defaults; hrms payroll_entry.py:408, :810, :891 (a deduction credits its `account`)"),
  affects: [
    table_salary_components,
    table_salary_structure_assignments,
    table_payroll_entries,
    rpc_payroll_structures_component,
    rpc_payroll_structures_assign,
    rpc_payroll_runs_create,
  ],
});

export const decision_payroll_collection_accrual = defineDecision({
  id: "payroll.collection-accrual",
  title: "A person's landed collection accrues through books' door with its paid slip",
  question:
    "A landed agreement collection is paid on chain before anyone classifies it, and payments, which books its money " +
    "fact, knows nothing of agreements, so books saw it as unclassified money out. Payroll asked for it to post as the " +
    "agreement component's expense with party the Employee. How does that meaning reach books?",
  options: [
    {
      label: "door-with-slip",
      text:
        "When the agreement's process records the paid slip of a collection to a person, it invokes " +
        "`books.record-payroll-accrual` (action collection) in the same transaction: Dr the agreement component's " +
        "expense, Cr Payroll Payable, party the Employee, naming the collection's Payment (`payment_` and its v4 id). " +
        "Books then posts that Payment's voucher on Payroll Payable, party the Employee, so the pay and its liability " +
        "meet as a Frappe slip's do (books.payroll-postings). A collection to an Organization payee has no slip and " +
        "posts nothing here: its meaning is a Purchase Invoice, the head's.",
    },
    { label: "review", text: "Leave every collection in review for a Books-hat wearer to classify." },
    { label: "payments-against", text: "Ask payments to give a collection's Payment an `against` at its birth from the chain fact." },
  ],
  chosen: "door-with-slip",
  why:
    "Only payroll knows a collection's Employee and its component's account, and books cannot read payroll; payments " +
    "births the Payment from the chain fact and cannot know either. The door is already payroll's way down to books " +
    "(payroll.accrual), and a paid slip and its expense are one money fact as a run and its accrual are: if they " +
    "disagreed at a commit, the slip would show pay the books never expensed. Review would leave every salary paid by " +
    "agreement unclassified. The step invokes one procedure of one concept, within sys:tx-width.",
  source: FRAPPE_ASSEMBLY("docs/design/frappe/assembly-items.md (accounting and payroll on collections); payroll.collection-slips; books.payroll-postings"),
  affects: [workflow_payroll_agreements_lifecycle, machine_salary_slip.t.record_collection, table_salary_slips, concept_books],
});

export const decision_payroll_timesheet_pay = defineDecision({
  id: "payroll.timesheet-pay",
  title: "Capxul's slips pay no timesheets yet, so projects.pay-time is deferred",
  question:
    "The projects lane asked: if salary slips pay timesheets, payroll should depend on projects and design with it a " +
    "door (`projects.pay-time`, the hours a slip pays) driving `timesheet.pay`. Do Capxul's slips pay timesheets?",
  options: [
    {
      label: "defer",
      text:
        "Not yet. Capxul computes slips from structures only; Frappe HR's timesheet-based slip " +
        "(`salary_slip_based_on_timesheet`) is computed by a head, like leave and attendance (payroll.frappe-doctypes). " +
        "Such a run comes in by payroll.import-run as an ordinary run, and the head's slip marks its timesheets paid " +
        "through projects' own head sync, under its paid-once guard (projects.billing-and-payslips). Payroll does not " +
        "depend on projects, and no door is designed until Capxul computes slips from hours.",
    },
    {
      label: "pay-time-now",
      text: "Payroll depends on projects now and designs `projects.pay-time` for a Capxul-computed slip from timesheets.",
    },
  ],
  chosen: "defer",
  why:
    "A door nothing invokes is a gap, not a design, and projects.billing-and-payslips says the same of doors designed " +
    "early. Hours paid twice would be money paid twice, but with no Capxul slip that pays hours there is only one " +
    "writer of the paid mark, the head's slip through projects' sync. When a customer needs Capxul to pay by the hour, " +
    "this record is reopened: payroll adds projects to its dependencies (projects sits below it) and the two concepts " +
    "design `projects.pay-time` together.",
  source: FRAPPE_ASSEMBLY("docs/design/frappe/projects-and-startup.md (For other lanes: payroll); projects.billing-and-payslips; hrms salary_slip.py:2402"),
  affects: [concept_payroll, rpc_payroll_runs_create, workflow_payroll_head_sync],
});

export const decision_payroll_employee_wise_accounting = defineDecision({
  id: "payroll.employee-wise-accounting",
  title: "Payroll accounts by Employee: each Payroll Payable line carries its party",
  question:
    "Frappe HR's Payroll Settings `process_payroll_accounting_entry_based_on_employee` (off by default) decides whether a " +
    "run's accrual and Bank Entry put each Employee on the Payroll Payable lines, or post one party-less line. Capxul " +
    "posts each slip's Bank Entry with party the Employee. Which does payroll set?",
  options: [
    {
      label: "by-employee",
      text:
        "On, the same for every Organization, as a fixed value of Payroll Settings that a head must match: Capxul's " +
        "accrual credits each net on Payroll Payable with party the Employee, and a head-computed run's accrual does the " +
        "same, so each slip's Bank Entry closes its own Employee's payable.",
    },
    { label: "frappe-default", text: "Off, Frappe HR's default: one party-less Payroll Payable line per run." },
  ],
  chosen: "by-employee",
  why:
    "Capxul pays each slip as its own Payment and posts one Bank Entry per slip with party the Employee " +
    "(books.payroll-postings), so the accrual must credit per Employee too, or every Employee would show a debit on " +
    "Payroll Payable against one party-less credit; a head-computed run Capxul pays meets the same Bank Entries. With " +
    "it off, ERPNext lets a Payroll Entry's Payable lines go without a party (`party_not_required`), which no other " +
    "Capxul voucher does. The Capxul app sets it on a head with the other fixed settings.",
  source: FRAPPE_ASSEMBLY("hrms payroll_entry.py:621, :1196; payroll_settings.json; erpnext journal_entry.py:509 (party_not_required)"),
  affects: [table_payroll_settings, workflow_payroll_startup_open, rpc_payroll_runs_submit, workflow_payroll_head_sync],
});
