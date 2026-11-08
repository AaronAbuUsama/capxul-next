// Payments' durable work (A2, A3, P3). One process per Payment owns machine `payment` from its birth to its
// end; two chain-event workflows handle what no Payment process is waiting for: a PaymentSent Capxul did not
// prepare (born here as a Payment, then settled by its own process) and a Transfer no Payment explains (a
// Movement of outside money). No cron and no sweep: the old settlement sweep, the verification recovery and
// the due-schedule job are this process's own waits and timers (P3).
//
// The one settlement path: only the Payment's process settles it, from the indexed PaymentSent with its
// payment id, read with every fact of its transaction at the deployment's finality depth (`Indexer.factsOf`),
// every term compared, the log consumed under a unique constraint and the book fact written in the same
// transaction. The old receipt path is gone (M2, M3, M4).

import { budget, defineWorkflow } from "../../../packages/book/src/index.ts";
import { concept_payments } from "../shared/foundation.ts";
import {
  contract_budgets,
  contract_erc20,
  contract_escrow,
  contract_payments,
  integration_chain_rpc,
  integration_indexer,
  integration_service_signer,
} from "../shared/external.ts";
import * as approvalsData from "../approvals/data.ts";
import * as approvalsSigning from "../approvals/signing.ts";
import * as books from "../books/procedures.ts";
import { procedure_documents_store } from "../documents/procedures.ts";
import * as partiesData from "../parties/data.ts";
import { rpc_payments_changes_cancel, rpc_payments_changes_reschedule, rpc_payments_changes_retry } from "./changes.ts";
import { machine_movement, machine_payment, table_movements, table_payment_commands, table_payments } from "./data.ts";
import { event_approval_transitioned } from "../approvals/data.ts";
import { event_proposal_transitioned } from "../board/data.ts";
import { table_indexer_progress } from "../indexing/data.ts";

const OLD = "packages/backend/src/payments";
const DAY_MS = 86_400_000;
const p = machine_payment.t;
const m = machine_movement.t;

export const workflow_payments_lifecycle_payment = defineWorkflow({
  id: "payments.lifecycle.payment",
  title: "Carry one Payment from its birth to settled or cancelled",
  about:
    "Started by the `open` transition's event, one instance per Payment, for every route. It follows what carries the " +
    "Payment and moves it on each answer: its approval (signed and held for its day → `schedule`; sent → `submit`; " +
    "reverted, displaced or expired → `lapse`; declined, refused or withdrawn by its opener → `cancel`), its Board " +
    "proposal (executed → `submit`; failed, or replaced by another transaction at its nonce → `lapse`; rejected → " +
    "`cancel`), a budget's reservation (PaymentScheduled with its job nonce on its own budget → " +
    "`schedule`), a claim escrow (EscrowCreated → `escrow`, from `prepared` or from the `submitted` its sent approval or " +
    "executed proposal left; a carrier's answer after `escrow` moves nothing), and a cancel (a void that displaced the held operation, " +
    "ScheduleCancelled or EscrowRefunded → `cancel` for every Payment it carried, K14). A dated Payment comes due a day " +
    "ahead (`come_due`, funding read, a shortfall kept for the payer's notice); approvals sends a personal one on its day, " +
    "and for a budget's this process asks Budgets to pay it (`Budgets.execute` with the executor key, sent once and looked " +
    "up by hash, again an hour later while the chain refuses: only the chain ends a dated budget payment). It settles " +
    "only from the indexed PaymentSent with its payment id, every term compared (K7): all equal settles it, consuming the " +
    "log (unique, K9) and writing the book fact of each Organization side in the same transaction (K10, settle once, " +
    "K8); a differing term is `mismatch`, booked nothing. After settling it waits until the block is twice the finality " +
    "depth deep and reads the facts again: gone, it reopens (`unsettle`) and reverses the book fact in one transaction " +
    "(K12). A Payment born from a chain fact meets its PaymentSent at once. A `needs_retry` Payment rests until `payment " +
    "retry` resumes it; the instance ends once its Payment is cancelled, mismatched for good, or settled and confirmed.",
  concept: concept_payments,
  priority: "critical",
  trigger: { transition: p.open },
  instance: { per: table_payments },
  signals: [
    approvalsSigning.rpc_approvals_signing_sign,
    approvalsSigning.rpc_approvals_signing_decline,
    rpc_payments_changes_retry,
    rpc_payments_changes_cancel,
    rpc_payments_changes_reschedule,
  ],
  waits: [
    {
      name: "carrier",
      for: "signal",
      key: [{ on: [event_approval_transitioned, event_proposal_transitioned], props: ["opener", "subject_kind", "subject_id"] }],
      about:
        "Its approval's `approval_transitioned` or its Board proposal's `proposal_transitioned`, routed by opener payments and its command or Payment as subject; each ends on chain proof, a window or an answer.",
    },
    {
      name: "payment-sent",
      for: "indexer",
      key: [{ on: [contract_payments.e.PaymentSent], props: ["chain_id", "paymentId"] }],
      about: "The indexed PaymentSent with its payment id at the finality depth, read with every fact of its transaction.",
    },
    {
      name: "reserved",
      for: "indexer",
      events: [contract_budgets.e.PaymentScheduled],
      key: [{ on: [contract_budgets.e.PaymentScheduled], props: ["chain_id", "budgetId", "jobNonce"] }],
      about: "A budget's dated payment: PaymentScheduled with its job nonce on its own budget, which gives its scheduled id.",
    },
    { name: "escrowed", for: "indexer", events: [contract_escrow.e.EscrowCreated], key: [{ on: [contract_escrow.e.EscrowCreated], props: ["chain_id", "paymentId"] }], about: "A claim escrow: EscrowCreated with its payment id." },
    { name: "released", for: "indexer", events: [contract_budgets.e.ScheduleCancelled, contract_escrow.e.EscrowRefunded], key: [{ on: [contract_budgets.e.ScheduleCancelled], props: ["chain_id", "budgetId", "scheduledId"] }, { on: [contract_escrow.e.EscrowRefunded], props: ["chain_id", "paymentId"] }], about: "A cancel: ScheduleCancelled of its scheduled id, or EscrowRefunded of its payment id." },
    { name: "day-ahead", for: "timer", about: "A dated Payment, 24 hours before its day: `come_due` and the funding read." },
    {
      name: "pay-day",
      for: "timer",
      timeoutMs: 3_600_000,
      about: "A budget's dated payment on its day, then hourly while `Budgets.execute` reverts, until it pays or is cancelled.",
    },
    {
      name: "confirm",
      for: "indexer",
      key: [{ on: [table_indexer_progress], props: ["chain_id"], reaches: "indexed_block" }],
      about: "After settling: until Ponder's head is twice the finality depth past the settled block, then the facts again.",
    },
    { name: "retry", for: "person", key: [{ on: [rpc_payments_changes_retry], props: ["payment_id"] }], about: "A `needs_retry` Payment: the payer's `payment retry`, which opens a new carrier for the same terms." },
  ],
  steps: [
    { name: "route", about: "Reads its Payment and its carrier; a chain-born Payment goes straight to the settlement." },
    { name: "follow-carrier", about: "Moves the Payment on each answer of its approval or Board proposal, as the about lists." },
    { name: "reserve", about: "On PaymentScheduled with its job nonce, `schedule` with the scheduled id; one on another budget is not its." },
    {
      name: "escrow",
      about:
        "On EscrowCreated with its payment id, `escrow`, whether the carrier's send already moved it to `submitted` or not. An escrowed Payment has no timer: it waits for the payee's collection (its PaymentSent) or the owner's refund.",
    },
    { name: "come-due", about: "A day ahead: reads the paying Safe's balance (personal) and moves `come_due`, keeping a shortfall." },
    {
      name: "execute",
      about: "A budget's dated payment on its day: `Budgets.execute(scheduledId)` sent once with the executor key, its receipt awaited, then `submit`.",
    },
    {
      name: "settle",
      about:
        "On its PaymentSent: every term compared (a claim escrow's sender is its escrow); equal → `settle` with the book " +
        "fact in one transaction; different → `mismatch`. A claim escrow's settlement fills its payee tenant from the Party " +
        "at its payee Safe.",
    },
    { name: "release", about: "On ScheduleCancelled or EscrowRefunded for it, `cancel`." },
    { name: "confirm", about: "Twice the finality depth later, reads the facts again; gone → `unsettle` with the book fact reversed." },
    { name: "rest", about: "A `needs_retry` Payment rests until a retry; an ended or confirmed Payment ends the instance." },
  ],
  reads: [table_payments, table_payment_commands, approvalsData.table_approvals, partiesData.table_parties],
  writes: [table_payments],
  drives: [p.schedule, p.come_due, p.escrow, p.submit, p.settle, p.mismatch, p.unsettle, p.lapse, p.cancel],
  invokes: [books.procedure_books_record_money_fact, books.procedure_books_reverse_money_fact],
  emits: [],
  calls: [
    integration_indexer.c.factsOf,
    integration_indexer.c.awaitBlock,
    integration_indexer.c.head,
    integration_chain_rpc.c.readContract,
    integration_service_signer.c.send,
    integration_service_signer.c.waitForReceipt,
  ],
  chain: [contract_budgets.f.execute, contract_erc20.f.balanceOf],
  idempotency:
    "One instance per Payment id. Each step's transaction moves the status only from the state it read; the settled log " +
    "is unique and the book fact's money key is `payment:<v4 payment id>`, so a replayed step writes nothing twice.",
  timeoutMs: 400 * DAY_MS,
  retries: { max: 10, backoff: "exponential" },
  compensation:
    "None by rollback: what the chain did stands. A settlement a reorg undid is reopened forward, by `unsettle` and a " +
    "reversing book fact; a Payment whose carrier ended without moving money lapses or is cancelled, never deleted.",
  budget: budget("chain-settle"),
  was: [
    `${OLD}/verifications/operations/verify.ts:121`,
    `${OLD}/verifications/operations/settle.ts:70`,
    `${OLD}/writes/settlements.ts:84`,
    `${OLD}/verifications/writes/sends.ts:187`,
    `${OLD}/verifications/writes/history.ts:186`,
    `${OLD}/schedules/operations/send-due.ts:22`,
    `${OLD}/schedules/external/budget-executor.ts:75`,
    "packages/backend/src/platform/jobs.ts:87",
  ],
});

export const workflow_payments_settlement_observe = defineWorkflow({
  id: "payments.settlement.observe",
  title: "Birth a Payment from a PaymentSent Capxul did not prepare",
  about:
    "Triggered by each indexed PaymentSent. When a Payment already holds its payment id, it does nothing: that Payment's " +
    "process is waiting for this fact. Otherwise, when the sender or the recipient Safe is a Party a Capxul tenant owns " +
    "(parties' directory), it births the Payment (`open`, origin `chain`, id `payment_` and the payment id's 64 hex " +
    "digits) with the fact's terms and the side that holds it: the payer's tenant when the payer is Capxul's, else the " +
    "payee's. That covers agreement collections (kind 4, so `payment get` finds the payment payroll reports), " +
    "escrow payouts (an invoice escrow's checkout), `Budgets.execute` of a dated payment Capxul did not schedule, equity " +
    "purchases and payments made outside Capxul from a Capxul Safe. The birth's event starts the Payment's own process, " +
    "which settles it on the same fact through the one settlement step. A second run births nothing: the payment id is " +
    "unique.",
  concept: concept_payments,
  priority: "critical",
  trigger: { chainEvent: contract_payments.e.PaymentSent },
  steps: [
    { name: "facts", about: "Reads every fact of the PaymentSent's transaction at the finality depth." },
    { name: "match", about: "A Payment holding the payment id ends the run: its own process settles it." },
    { name: "birth", about: "A Capxul Safe on either side births the Payment through `open` with the fact's terms." },
  ],
  reads: [table_payments, partiesData.table_parties],
  writes: [table_payments],
  drives: [p.open],
  invokes: [],
  emits: [],
  calls: [integration_indexer.c.factsOf],
  chain: [],
  idempotency: "The unique (chain id, payment id) index: a replayed PaymentSent births nothing.",
  timeoutMs: 60_000,
  retries: { max: 5, backoff: "exponential" },
  budget: budget("chain-settle"),
  was: [`${OLD}/writes/births.ts:121`, `${OLD}/writes/collections.ts:25`, `${OLD}/reads/settlements.ts:8`, "packages/backend/src/platform/jobs.ts:106"],
});

export const workflow_payments_movements_record = defineWorkflow({
  id: "payments.movements.record",
  title: "Record outside money from a Transfer no Payment explains",
  about:
    "Triggered by each indexed ERC-20 Transfer that touches a Capxul Safe. It reads every fact of the transaction and " +
    "sets aside a Transfer that a Payment explains for that side: the one beside a PaymentSent moving the same token and " +
    "amount between the same addresses (a direct send, a budget's payout through Roles, an escrow's payout), or a claim " +
    "escrow's funding or refund of one of that side's Payments (K17). For each remaining side whose Safe a Capxul tenant " +
    "owns, it records a Movement (`record`), that side's book fact (`books.record-money-fact`, key `transfer:<chain " +
    "id>:<tx hash>:<log index>`) and the Transfer's Memo (`documents.store`: basis movement, reference the same key, " +
    "issued at the block time, the Capxul sides as participants, so a replayed Transfer stores nothing new) in one " +
    "transaction, so an Organization's direct transfer to a person is outside money for both (old M1). Twice the " +
    "finality depth later it reads the facts again: a Transfer no longer there is `remove`d with its book fact reversed " +
    "(the Memo, immutable, stays); one the chain brought back is `restore`d and booked again.",
  concept: concept_payments,
  priority: "normal",
  trigger: { chainEvent: contract_erc20.e.Transfer },
  waits: [{ name: "confirm", for: "indexer", key: [{ on: [table_indexer_progress], props: ["chain_id"], reaches: "indexed_block" }], about: "Until Ponder's head is twice the finality depth past the Transfer's block." }],
  steps: [
    { name: "facts", about: "Reads every fact of the Transfer's transaction at the finality depth." },
    { name: "explain", about: "Sets aside a side whose Payment explains the Transfer." },
    { name: "record", about: "Records each remaining Capxul side, its book fact and the Transfer's Memo in one transaction." },
    { name: "confirm", about: "Reads the facts again later: gone → `remove` and reverse; back → `restore` and book again." },
  ],
  reads: [table_movements, table_payments, partiesData.table_parties],
  writes: [table_movements],
  drives: [m.record, m.remove, m.restore],
  invokes: [books.procedure_books_record_money_fact, books.procedure_books_reverse_money_fact, procedure_documents_store],
  emits: [],
  calls: [integration_indexer.c.factsOf, integration_indexer.c.awaitBlock],
  chain: [],
  idempotency: "The Movement's key (owner, chain, transaction, log, side) and books' money key: a replayed Transfer writes nothing.",
  timeoutMs: DAY_MS,
  retries: { max: 5, backoff: "exponential" },
  budget: budget("chain-settle"),
  was: [
    `${OLD}/movements/writes/windows.ts:97`,
    `${OLD}/movements/writes/projections.ts:53`,
    `${OLD}/movements/reads/outside.ts:43`,
    `${OLD}/writes/settlements.ts:120`,
    "packages/backend/src/indexing/movements/writes.ts:19",
  ],
});
