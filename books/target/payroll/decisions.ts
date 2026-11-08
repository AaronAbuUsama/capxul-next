// Payroll's own judgments, as decision records. Made by Claude on 8 November 2026 while designing
// the target payroll concept, under A1-A4 and P1-P10 and the shared decisions (concepts.payroll,
// dependencies.payments-payroll, dependencies.of-payroll, rules.durable-processes), with the old
// code (/home/user/factory, integration/factory) and books/as-is/payroll/ as evidence.

import { defineDecision } from "../../../packages/book/src/index.ts";
import { concept_board, concept_budgets, concept_notices, concept_payments, concept_payroll } from "../shared/foundation.ts";
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
  machine_agreement,
  machine_agreement_write,
  table_agreement_writes,
  table_agreements,
} from "./data.ts";
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
import { workflow_payroll_agreements_lifecycle } from "./processes.ts";
import {
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
  title: "Payroll designs agreements only; runs, groups, terms, departments are not here",
  question:
    "The design brief named payroll runs (one durable workflow per run), saved groups, departments and a settle-run " +
    "procedure from payments. The concept map gives payroll v4 Agreements only. Which does the target build?",
  options: [
    { label: "concept-map", text: "Agreements and their terms only, as concepts.payroll and the landings assign; runs, items, groups and terms dropped; departments are budgets'." },
    { label: "brief", text: "Also book payroll runs (one workflow per run), saved groups and departments, with payments settling a run through a payroll procedure." },
  ],
  chosen: "concept-map",
  why:
    "The brief itself says 'as the concept map assigns', and the map is decided: no frozen operation makes, lists or shows " +
    "a run or a group (P2), departments are budgets (concepts.budgets), and payments never depends on payroll " +
    "(dependencies.payments-payroll), so a settle-run procedure could not be invoked. An agreement's terms live in its " +
    "terms document and its row, so old terms go too. A run or a group comes back only with a frozen operation that names it.",
  source: by("shared/decisions.ts (concepts.payroll, dependencies.payments-payroll); shared/landings.ts:139-143; books/frozen (payroll area)"),
  affects: [concept_payroll, concept_budgets, concept_payments, table_agreements],
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
  source: by("books/as-is/payroll/procedures.ts; P4; dependencies.payments-payroll"),
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
  source: by(`${OLD}/tables.ts:19-328; books/as-is/payroll/data.ts; org.agreement.pause acceptance 4`),
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
    "is never a join.",
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
  question: "`agreement collect` returns 'the one payment the payer made', but payroll does not depend on payments. Where does it come from?",
  options: [
    { label: "chain-fact", text: "The write keeps the PaymentSent id, amount and window from the transaction's indexed facts; payments births its Payment from the same fact." },
    { label: "read-payments", text: "Read the Payment from payments' ledger." },
  ],
  chosen: "chain-fact",
  why:
    "dependencies.payments-payroll keeps payments below nothing of payroll's and payroll below nothing of payments', and " +
    "concepts.payments has payments settle every PaymentSent, a collection included. The PaymentSent id is the key both " +
    "sides share, so `payment get` finds the Payment payroll reports without either concept reading the other.",
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
  source: by("books/as-is/payroll/agreements.ts (37 rpcs, 2 workflows); books/as-is/payroll/flows.ts:549-857; P2; P3"),
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
