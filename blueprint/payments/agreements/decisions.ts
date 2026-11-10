// Payroll's own judgments, as decision records. Made by Claude on 8 November 2026 while designing
// the target payroll concept, under A1-A4 and P1-P10 and the shared decisions (concepts.payroll,
// dependencies.payments-payroll, dependencies.of-payroll, rules.durable-processes), with the old
// code (/home/user/factory, integration/factory) and docs/as-is/archive/payroll/ as evidence.

import { defineDecision } from "../../../packages/blueprint-engine/src/index.ts";
import { concept_board, concept_books, concept_budgets, concept_notices, concept_payments } from "../../shared/foundation.ts";
import { contract_agreements, integration_indexer } from "../../shared/external.ts";
import {
  error_CANCELLED,
  error_FEATURE_NOT_AVAILABLE,
  error_TOKEN_REQUIRED,
  error_TRANSACTION_FAILED,
  error_WRONG_STATE,
} from "../../shared/vocabulary.ts";
import { machine_approval, table_approvals } from "../../approvals/data.ts";
import { procedure_approvals_open, procedure_approvals_withdraw } from "../../approvals/procedures.ts";
import { procedure_board_propose } from "../../board/procedures.ts";
import { machine_proposal, table_board_proposals } from "../../board/data.ts";
import { procedure_documents_store } from "../../documents/procedures.ts";
import {
  event_agreement_transitioned,
  event_agreement_write_transitioned,
  machine_agreement,
  machine_agreement_write,
  table_agreement_writes,
  table_agreements,
} from "./data.ts";
import {
  IMPORT_RUN,
} from "./runs.ts";
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
import { workflow_payroll_agreements_lifecycle,  } from "./processes.ts";
import {
  flow_client_me_payroll_agreements_accept,
  flow_client_me_payroll_agreements_collect,
  flow_client_org_payroll_agreements_change,
  flow_client_org_payroll_agreements_end,
  flow_client_org_payroll_agreements_offer,
  flow_client_org_payroll_agreements_pause,
  flow_client_org_payroll_agreements_resume,
  flow_client_org_payroll_agreements_withdraw,
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
  flow_client_org_payroll_agreements_offer,
  flow_client_org_payroll_agreements_withdraw,
  flow_client_org_payroll_agreements_change,
  flow_client_org_payroll_agreements_pause,
  flow_client_org_payroll_agreements_resume,
  flow_client_org_payroll_agreements_end,
  flow_client_me_payroll_agreements_accept,
  flow_client_me_payroll_agreements_collect,
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
  affects: [concept_budgets, concept_payments, table_agreements, ],
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
    "is never a join. A salary slip follows the same rule: the paying Organization's row, read by the employee through the Safe it pays." + " Review, 11 November 2026: The surviving rule (An agreement is its payer's row; the payee reads it by its own Safe) still applies. Removed subjects in its historical evidence are not restored; cut.payroll; cut.agreements-in-payments; plugs.held-payment governs their replacement.",
  source: by(`${OLD}/tables.ts:298 (by_payee index); P8`),
  affects: [table_agreements, table_agreement_writes],
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
    "An earlier dependencies.of-payroll said an agreement on a top budget is offered or changed by Board proposal. The " +
    "frozen text says a holder write 'is not a Director proposal'. Which does payroll build, and what does it use board for?",
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
  source: by("blueprint/baseline (org.agreement.* changes; agreement.accept, agreement.collect --org); org.department.create (v4: a top budget); P10"),
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
  source: by("blueprint/baseline (org.agreement.* refusals; agreement.accept acceptance 4; agreement.collect notes); access/procedures.ts (gates)"),
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
  source: by("blueprint/baseline (org.agreement.offer mistakes and designed refusals); docs/planning/protocol-v4/spec/agreements.md:26; P9"),
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
  source: by("blueprint/baseline (agreement.list acceptance 4; eight 'On v4' lines); P1; P9"),
  affects: OPERATIONS,
});

export const decision_payroll_collection_payment = defineDecision({
  id: "payroll.collection-payment",
  title: "A collection reports its payment from the indexed PaymentSent",
  question: "`payroll agreement collect` returns 'the one payment the payer made', which payments' ledger holds. Where does payroll get it?",
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
  affects: [rpc_payroll_writes_watch, flow_client_me_payroll_agreements_collect, operation_agreement_collect, table_agreement_writes, concept_payments],
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
  source: by(`${OLD}/agreements/operations/list.ts:20; ${OLD}/agreements/reads/context.ts:70; blueprint/baseline (org.agreement.list notes)`),
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
        "Names follow the designed `method` where one exists (`client.me.agreements.collect`), under the group the command tree " +
        "puts them in (`client.me.payroll.agreements.collect`, surface.payroll-group).",
    },
    { label: "rpc-only", text: "Every command one rpc, with the CLI doing the signing and following." },
  ],
  chosen: "flows-for-writes",
  why:
    "A4: the SDK owns signing and the CLI calls one method; a write composes a prepare, a signature and two waits, so it " +
    "is a flow, and approvals asks every opener's flow to compose its signing rpcs. The frozen sdk of `payroll agreement collect` " +
    "is `client.agreements.collect` but its designed method is `client.me.agreements.collect`, and the designed text wins " +
    "(P10), so both payee writes sit under `client.me`. The reads keep their frozen methods. The command tree then put every " +
    "agreement command in the payroll group (surface.payroll-group), so each method gains `.payroll` as its command gains " +
    "`payroll`: `client.me.payroll.agreements.collect`, `client.org(orgId).payroll.agreements.offer`." + " Review, 11 November 2026: The surviving rule (One flow per write command, one rpc per read; the designed SDK names win) still applies. Removed subjects in its historical evidence are not restored; cut.payroll; cut.agreements-in-payments; plugs.held-payment governs their replacement.",
  source: by("blueprint/baseline (sdk and designed.method of the payroll operations); approvals/flows.ts; A4; P10"),
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
    "Each step of the process is a chain event to its recorded transition: chain-settle." + " Review, 11 November 2026: The surviving rule (Payroll's budgets are class defaults) still applies. Removed subjects in its historical evidence are not restored; cut.payroll; cut.agreements-in-payments; plugs.held-payment governs their replacement.",
  source: by("packages/blueprint-engine/src/budgets.ts; P5 (hop table)"),
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
  source: by("blueprint/baseline (payroll refusals); devnet supervisor worlds (environment devnet)"),
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
    "`--org`, so it needs no second set of rows." + " Review, 11 November 2026: The surviving rule (Old agreement rpcs that are folded in or dropped) still applies. Removed subjects in its historical evidence are not restored; cut.payroll; cut.agreements-in-payments; plugs.held-payment governs their replacement.",
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
  source: ASSEMBLY("docs/decisions/assembly-items.md (payroll links); blueprint/board/data.ts (board-proposals); blueprint/documents/procedures.ts"),
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
    "`payroll agreement show`. Board asks openers to read `fail` as 'ran without effect', which is exactly a failed write. The " +
    "codes are the mapping of decision approvals.machine: expired is WRONG_STATE, declined is CANCELLED (contacts.decline-is-cancelled).",
  source: ASSEMBLY("blueprint/board/decisions.ts (board.failed-proposal); blueprint/approvals/decisions.ts (approvals.machine); assembly-items.md (approvals, board)"),
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
    "`payroll agreement collect` returns 'the one payment the payer made', and a person follows it with `payment get`; the raw " +
    "id would be refused there. The id is a pure function of the indexed fact both concepts read, so payroll still never " +
    "reads payments (dependencies.payments-payroll).",
  source: ASSEMBLY("blueprint/payments/decisions.ts (payments.chain-born-ids); payment.get.yaml (refusal CLI_USAGE); agreement.collect.yaml (returns)"),
  affects: [rpc_payroll_writes_watch, flow_client_me_payroll_agreements_collect, operation_agreement_collect],
});

// ── Frappe HR's payroll (the payroll lane of the Frappe redesign) ───────────────────────────

const HRMS = "/tmp/hrms/hrms/payroll/doctype";

export const decision_payroll_agreements_in_frappe_shape = defineDecision({
  id: "payroll.agreements-in-frappe-shape",
  title: "An accepted agreement is an Employee and an assignment; no run pays it",
  question: "Pay that starts on chain, a v4 agreement, has no Frappe HR doctype. How does it appear in Frappe's shapes?",
  options: [
  {
    "label": "current-scope",
    "text": "Retained chain agreements live in payments and are not automatically Core Employee/assignment/slip records. Frappe HR owns any corresponding employee and salary structure. Archive automatic hire/termination and exclusion-of-agreement-assignments sync logic; a collection must not cause a second salary run payment."
  },
  {
    "label": "historical",
    "text": "The former answer to payroll.agreements-in-frappe-shape is preserved in docs/cut-archive/decision-review-history.json as historical evidence, not implementation authority."
  }
],
  chosen: "current-scope",
  why:
    "Review, 11 November 2026: Retained chain agreements live in payments and are not automatically Core Employee/assignment/slip records. Frappe HR owns any corresponding employee and salary structure. Archive automatic hire/termination and exclusion-of-agreement-assignments sync logic; a collection must not cause a second salary run payment. Authority: cut.payroll; cut.agreements-in-payments; plugs.held-payment.",
  source: "The coordinator, round 2, m1-old-decisions; cut.payroll; cut.agreements-in-payments; plugs.held-payment",
  affects: [
    workflow_payroll_agreements_lifecycle,
    table_agreements,
  ],
});

export const decision_payroll_collection_slips = defineDecision({
  id: "payroll.collection-slips",
  title: "Archived: A landed collection is one paid slip, born paid, keyed by its write",
  question: "How is pay that starts on chain reflected as a payslip, and what document does it carry?",
  options: [
  {
    "label": "current-scope",
    "text": "Archive one Core born-paid Salary Slip per collection. The collection retains Payment id, transaction, block, time and agreement terms as chain evidence; any HR Salary Slip is a site document, not another chain-settlement record."
  },
  {
    "label": "historical",
    "text": "The former answer to payroll.collection-slips is preserved in docs/cut-archive/decision-review-history.json as historical evidence, not implementation authority."
  }
],
  chosen: "current-scope",
  why:
    "Review, 11 November 2026: Archive one Core born-paid Salary Slip per collection. The collection retains Payment id, transaction, block, time and agreement terms as chain evidence; any HR Salary Slip is a site document, not another chain-settlement record. Authority: cut.payroll; cut.agreements-in-payments; plugs.held-payment.",
  source: "The coordinator, round 2, m1-old-decisions; cut.payroll; cut.agreements-in-payments; plugs.held-payment",
  affects: [workflow_payroll_agreements_lifecycle, operation_agreement_collect],
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
  ],
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
        "the budget. The slip reads `escrowed` until they collect it (at setup, or later with `payment claim`), then `paid` when the escrow's payout settles; if the " +
        "wearer of the budget's hat or one above it, or the Board, takes it back, payments cancels that Payment (outcome refunded), the slip is " +
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
  affects: [],
});

export const decision_payroll_accrual = defineDecision({
  id: "payroll.accrual",
  title: "A run's accrual has one author, the side that computed it; payroll posts none",
  question: "Frappe HR posts an accrual Journal Entry when slips are submitted and a Bank Entry when they are paid. Who posts them on Capxul?",
  options: [
  {
    "label": "current-scope",
    "text": "Frappe HR is the sole author of run accruals and site payment posting. Core records chain money and delivers settlement once through plugs; it does not compute salary runs or call a books accrual door. Escrow-held money is not settled payroll and cannot close the payable until claimed."
  },
  {
    "label": "historical",
    "text": "The former answer to payroll.accrual is preserved in docs/cut-archive/decision-review-history.json as historical evidence, not implementation authority."
  }
],
  chosen: "current-scope",
  why:
    "Review, 11 November 2026: Frappe HR is the sole author of run accruals and site payment posting. Core records chain money and delivers settlement once through plugs; it does not compute salary runs or call a books accrual door. Escrow-held money is not settled payroll and cannot close the payable until claimed. Authority: cut.payroll; cut.agreements-in-payments; plugs.held-payment.",
  source: "The coordinator, round 2, m1-old-decisions; cut.payroll; cut.agreements-in-payments; plugs.held-payment",
  affects: [workflow_payroll_agreements_lifecycle, concept_books],
});

export const decision_payroll_head_sync = defineDecision({
  id: "payroll.head-sync",
  title: "Archived: Payroll syncs its own records with a head: pushed in order, pulled on ",
  question: "When a Frappe HR head is connected, who moves payroll's records, which way, keyed how, and what changes in Frappe?",
  options: [
  {
    "label": "current-scope",
    "text": "Archive the six-record payroll replica, change log and capxul_id/head_name push/pull process. Frappe HR owns employees, structures, assignments, runs and slips from the start; plugs delivers chain payment results, not business-data sync."
  },
  {
    "label": "historical",
    "text": "The former answer to payroll.head-sync is preserved in docs/cut-archive/decision-review-history.json as historical evidence, not implementation authority."
  }
],
  chosen: "current-scope",
  why:
    "Review, 11 November 2026: Archive the six-record payroll replica, change log and capxul_id/head_name push/pull process. Frappe HR owns employees, structures, assignments, runs and slips from the start; plugs delivers chain payment results, not business-data sync. Authority: cut.payroll; cut.agreements-in-payments; plugs.held-payment.",
  source: "The coordinator, round 2, m1-old-decisions; cut.payroll; cut.agreements-in-payments; plugs.held-payment",
  affects: [workflow_payroll_agreements_lifecycle],
});

// ── the payroll commands pass (8 November 2026): booking payroll.hr-surface ─────────────────

const COMMANDS = (rulings: string, evidence: string) =>
  `Claude, payroll commands pass, 8 November 2026; rulings: ${rulings}; evidence: ${evidence}`;

export const decision_payroll_one_live_employee = defineDecision({
  id: "payroll.one-live-employee",
  title: "Archived: One live Employee per person; a returning person is a new Employee",
  question: "An Employee who left is final, and the index allowed one Employee per person. What happens when someone comes back?",
  options: [
  {
    "label": "current-scope",
    "text": "Archive Core one-live-Employee indexes and rehire row creation: the Core Employee table is removed. Frappe HR owns employment history and rehire validation on the site; chain agreement acceptance must not silently create or replace an Employee."
  },
  {
    "label": "historical",
    "text": "The former answer to payroll.one-live-employee is preserved in docs/cut-archive/decision-review-history.json as historical evidence, not implementation authority."
  }
],
  chosen: "current-scope",
  why:
    "Review, 11 November 2026: Archive Core one-live-Employee indexes and rehire row creation: the Core Employee table is removed. Frappe HR owns employment history and rehire validation on the site; chain agreement acceptance must not silently create or replace an Employee. Authority: cut.payroll; cut.agreements-in-payments; plugs.held-payment.",
  source: "The coordinator, round 2, m1-old-decisions; cut.payroll; cut.agreements-in-payments; plugs.held-payment",
  affects: [workflow_payroll_agreements_lifecycle],
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
  affects: [],
});

// ── the assembly after the Frappe lanes (8 November 2026) ───────────────────────────────────

const FRAPPE_ASSEMBLY = (evidence: string) => `Claude, assembly of the Frappe lanes (ledger: books and payroll), 8 November 2026; evidence: ${evidence}`;

export const decision_payroll_collection_accrual = defineDecision({
  id: "payroll.collection-accrual",
  title: "Archived: A person's landed collection accrues through books' door with its paid",
  question:
    "A landed agreement collection is paid on chain before anyone classifies it, and payments, which books its money fact, knows nothing of agreements, so books saw it as unclassified money out. Payroll asked for it to post as the agreement component's expense with party the Employee. How does that meaning reach books?",
  options: [
  {
    "label": "current-scope",
    "text": "Archive the Core collection process calling books.record-payroll-accrual and generating a salary liability. A collection is chain money projected once to the company site; HR/accounting classification is site-owned. Organization payees are not manufactured as Employees."
  },
  {
    "label": "historical",
    "text": "The former answer to payroll.collection-accrual is preserved in docs/cut-archive/decision-review-history.json as historical evidence, not implementation authority."
  }
],
  chosen: "current-scope",
  why:
    "Review, 11 November 2026: Archive the Core collection process calling books.record-payroll-accrual and generating a salary liability. A collection is chain money projected once to the company site; HR/accounting classification is site-owned. Organization payees are not manufactured as Employees. Authority: cut.payroll; cut.agreements-in-payments; plugs.held-payment.",
  source: "The coordinator, round 2, m1-old-decisions; cut.payroll; cut.agreements-in-payments; plugs.held-payment",
  affects: [workflow_payroll_agreements_lifecycle, concept_books],
});

// ── the payroll truth review (8 November 2026): what the booked commands could not yet produce ──

const REVIEW = (rulings: string, evidence: string) =>
  `Claude, payroll truth review, 8 November 2026; rulings: ${rulings}; evidence: ${evidence}`;

// ── the payroll fit review (8 November 2026): the booked commands against the grammar and the 215 ──

const FIT = (rulings: string, evidence: string) =>
  `Claude, payroll fit review, 8 November 2026; rulings: ${rulings}; evidence: ${evidence}`;

// ── the command tree (surface pass, 9 November 2026) ────────────────────────────────────────

/** Who decided this section's records, and when: the frappe-apps owner in the surface pass. */
const surfaceBy = (evidence: string) => `Claude, surface pass (frappe-apps), 9 November 2026; evidence: ${evidence}`;

export const decision_payroll_surface_moves = defineDecision({
  id: "payroll.surface-moves",
  title: "HR commands take `hr` and `org hr`; payslips and agreements take `payroll`",
  question:
    "The command surface makes HR and Payroll each one group, with your side under the bare word and the " +
    "Organization's under `org` (surface.hr-group, surface.payroll-group). This concept booked HR's 53 commands under " +
    "twelve nouns, the payslips as `payslip` and `org payslip`, and keeps the 215's eleven agreement commands. How do " +
    "they read now, and what are their ids and SDK methods?",
  options: [
    {
      label: "tree",
      text:
        "As the tree spells them. HR: `org employee|holiday|leave-type|leave|shift-type|attendance|expense-type|" +
        "expense-claim|advance …` become `org hr employee …` and so on, and the Employee's own `leave apply|list|cancel|" +
        "balance`, `attendance checkin|list`, `expense-claim create|list|get|cancel` and `advance request|list|cancel` become " +
        "`hr leave …`, `hr attendance …`, `hr expense-claim …` and `hr advance …`. Payslips: `payslip list|get` become " +
        "`payroll payslip list|get`, `org payslip withhold|release` become `org payroll payslip withhold|release`. The 215's " +
        "agreement accept, agreement collect, agreement list and agreement show become `payroll agreement accept|collect|" +
        "list|show`, and org agreement offer, org agreement change, org agreement pause, org agreement resume, org " +
        "agreement end, org agreement withdraw and org agreement list become `org payroll agreement …`. A new command's id " +
        "is its new words joined by dots (`leave.apply` is `hr.leave.apply`); a frozen one keeps its id.",
    },
    { label: "as-booked", text: "Keep the booked nouns, and leave HR and the agreements outside the tree." },
  ],
  chosen: "tree",
  why:
    "Aaron, 9 November 2026: everything Frappe can do must be reachable from Capxul's tooling, and what matters is the " +
    "logical groupings, so Frappe HR's HR module and its Payroll module each take one group word, where a Frappe user " +
    "looks for them (aaron.frappe-shape). The move is spelling only (system.frozen-behaviour): each command's claims, " +
    "refusals, worlds, rpcs, budgets and authority are as they were (payroll.hr-commands, payroll.hr-surface, " +
    "payroll.hr-approvers), and every claim, refusal, shape and decision here that quoted a command quotes the new " +
    "words. The eleven agreement commands keep their ids, claims and refusals; their command is the tree's, and the " +
    "frozen about, notes and mistakes quote the tree's words wherever they named an agreement command. Each flow's id " +
    "follows its SDK method (G7): `client.org.employees.*` is `client.org.hr.employees.*`, " +
    "`client.org.expense-claims.pay` and `client.org.advances.pay|settle` gain `.hr`, `client.me.payslips.*` and " +
    "`client.org.payslips.*` gain `.payroll`, and so do `client.me.agreements.*` and `client.org.agreements.*`; the " +
    "commands an rpc implements alone change no record but their operation. HR stays in this concept (surface.hr-concept, " +
    "payroll.hr-in-payroll). Part of question 50 (surface.tree). Aaron, 10 November 2026, on the portal's Questions page: accepted as recommended. What it now applies to: the eleven " +
    "agreement commands, booked in payments (`payroll agreement …`, `org payroll agreement …`); HR's and the payslips' words are the tree's " +
    "and are Frappe's now, reached through the door (cut.payroll). The ruling stands as chosen.",
  source: surfaceBy(
    "blueprint/shared/surface.ts (surface.tree, surface.hr-group, surface.payroll-group); docs/design/command-surface.md " +
      "sections 3, 4, 5 and 9; aaron.frappe-shape",
  ),
  affects: [
    ...WRITE_FLOWS,
  ],
});

/** The HR and payroll commands booked with one claim, which payroll.claims-thickened gave the rest of theirs. */
const THICKENED: readonly string[] = [
  "org.payroll.component.change", "org.payroll.component.list", "org.payroll.run.get", "org.payroll.run.list",
  "org.payroll.structure.list", "org.hr.holiday.list", "org.hr.holiday.remove", "org.hr.leave-type.list",
  "org.hr.leave.balance", "org.hr.leave.reject", "hr.leave.balance", "hr.leave.list", "org.hr.shift-type.list",
  "org.hr.shift-type.unassign", "hr.attendance.list", "org.hr.attendance.list", "org.hr.expense-type.add",
  "org.hr.expense-type.list", "hr.expense-claim.list", "hr.expense-claim.get", "hr.expense-claim.cancel",
  "org.hr.expense-claim.list", "org.hr.expense-claim.get", "org.hr.expense-claim.reject", "org.hr.expense-claim.cancel",
  "hr.advance.request", "hr.advance.list", "hr.advance.cancel", "org.hr.advance.reject", "org.hr.advance.get",
  "org.hr.advance.list",
];

/** The commands the fit review changed: a who, a preview's guard, a reader's who, or a claim that repeated another's evidence. */
const FIT_REVIEWED: readonly string[] = [
  "org.payroll.run.pay", "org.hr.advance.settle", "org.hr.leave.list", "org.payroll.run.list", "org.hr.leave-type.list",
  "org.payroll.component.list", "org.payroll.component.change", "org.hr.expense-type.add", "org.hr.shift-type.list",
  "hr.leave.balance",
];

