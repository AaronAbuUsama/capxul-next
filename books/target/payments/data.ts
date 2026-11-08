// Payments' tables, its two state machines and each machine's one event (P7), in the target design.
//
// Three tables replace the old thirteen (books/as-is/payments/data.ts):
//   payment-commands  one request key, one command (K1); absorbs payment-document-intents
//   payments          the Payment ledger; absorbs payment-schedules (dated payments), commitment-evidence
//                     (the consumed PaymentSent log, unique: K9) and payment-evidence-conflicts (mismatched)
//   movements         outside money: an indexed Transfer touching a Capxul Safe that no Payment explains,
//                     one row per side; absorbs movement-attributions and drops deposit-materializations
// Gone: money-executions and provider-send-attempts (approvals owns every UserOperation), movements as a
// copy of Transfer logs and movement-scan-checkpoints (Ponder's, read through indexing), and
// settlement-sweep-cursors (no sweep: the settlement waits on the indexed PaymentSent). Each is a decision
// in ./decisions.ts.
//
// Every write to a status is a named transition. A birth is a transition from no state (`from: []`), so
// the funnel sees it and the Payment's process can start from it.

import { Schema } from "effect";
import { defineEvent, defineMachine, defineTable } from "../../../packages/book/src/index.ts";
import { concept_payments } from "../shared/foundation.ts";

const OLD = "packages/backend/src/payments";
const ASIS = "books/as-is/payments/data.ts";

const S = Schema.String;
const Int = Schema.Int;
/** Times are epoch milliseconds, as in parties and organizations. */
const At = Schema.Number;
const Null = Schema.NullOr;

/** Whose a row is (P8 `owner`): a person or an Organization. */
const OwnerKind = Schema.Literals(["person", "organization"]);

/** How a prepared Payment moves on chain (the designed `payment send` routes). `chain`: born from a fact. */
export const Route = Schema.Literals(["personal", "budget", "board", "claim_escrow", "chain"]);

export const PAYMENT_STATUSES = [
  "prepared",
  "scheduled",
  "due",
  "escrowed",
  "submitted",
  "needs_retry",
  "settled",
  "mismatched",
  "cancelled",
] as const;
export const PaymentStatus = Schema.Literals(PAYMENT_STATUSES);

/** Why a Payment lapsed or was cancelled: what its approval, proposal or the chain said. */
export const Outcome = Schema.Literals([
  "declined",
  "rejected",
  "expired",
  "displaced",
  "reverted",
  "window_closed",
  "voided",
  "budget_cancelled",
  "refunded",
]);

// ── payment-commands ────────────────────────────────────────────────────────────────────────

export const table_payment_commands = defineTable({
  id: "payment-commands",
  title: "Payment commands: one request key, one command",
  about:
    "One row per request to move money: a `payment send`, a department payment, a reschedule's new dated payment, or a " +
    "Payment another concept births through `payments.prepare-command` (a request paid from the inbox, a bank payout). " +
    "The same owner and request key always reach the same command and its Payments; another request under a used key is " +
    "refused, because the digest of the canonical request (route, items, date, document hashes) differs (K1). A command " +
    "has no state of its own: where it ended is its Payments' and its approval's. It carries the approval or Board " +
    "proposal it opened, so a repeat reports where the first approval ended. The old document intents are the digest's " +
    "document hashes.",
  concept: concept_payments,
  tenancy: "owner",
  tenantField: "owner_id",
  fields: Schema.Struct({
    owner_id: S,
    owner_kind: OwnerKind,
    id: S,
    request_key: S,
    request_digest: S,
    route: Route,
    purpose: Schema.Literals(["payment", "department", "reschedule", "request", "bank_payout"]),
    requested_by: S,
    approval_id: Null(S),
    proposal_id: Null(S),
    created_at: At,
  }),
  key: ["owner_id", "owner_kind", "id"],
  indexes: [
    {
      name: "by-request-key",
      fields: ["owner_id", "owner_kind", "request_key"],
      unique: true,
      for: "Idempotent prepare (K1): the command this owner's request key already reached, compared by request digest.",
    },
  ],
  retention: "Kept as long as its Payments: the request key stays closed for good.",
  was: [`${OLD}/tables/commands.ts:9`, `${OLD}/tables/payments.ts:22`, `${OLD}/commands/writes/commands.ts:153`, ASIS],
});

// ── payments ────────────────────────────────────────────────────────────────────────────────

export const table_payments = defineTable({
  id: "payments",
  title: "Payments: the Payment ledger of record",
  about:
    "One row per Payment: one exact on-chain payment, identified before anyone signs by its v4 payment id (Payments " +
    "hashes every term but the sender; Budgets and EscrowFactory derive theirs from a job nonce). It holds the terms the " +
    "chain must match, the route that carries it, its date when dated, what carries it now (an approval, a Board proposal, " +
    "a Budgets reservation, a claim escrow) and, once settled, the one PaymentSent log it consumed. Its owner is the side " +
    "that holds it: the payer when the payer is a Capxul party, otherwise the payee (an incoming Payment Capxul did not " +
    "prepare). The payee's tenant is on the row too, so a recipient reads it through the payee index and the generated " +
    "row-level policy admits either side. Labels are the names as the payer gave them, snapshotted at birth, so no read " +
    "reaches into parties. Dated payments are rows here with `pay_at`: the old payment-schedules table, its signed bytes " +
    "(now approvals') and its lease are gone. Status changes only through machine `payment`.",
  concept: concept_payments,
  tenancy: "owner",
  tenantField: "owner_id",
  fields: Schema.Struct({
    owner_id: S,
    owner_kind: OwnerKind,
    id: S,
    command_id: Null(S),
    origin: Schema.Literals(["prepared", "chain"]),
    route: Route,
    status: PaymentStatus,
    outcome: Null(Outcome),
    kind: Int,
    chain_id: Int,
    chain_payment_id: S,
    job_nonce: S,
    payer_safe: S,
    payer_label: S,
    payee_kind: Null(OwnerKind),
    payee_id: Null(S),
    payee_safe: S,
    payee_label: S,
    token_address: S,
    asset: S,
    decimals: Int,
    amount_raw: S,
    document_id: Null(S),
    document_hash: S,
    pay_at: Null(At),
    budget_id: Null(S),
    scheduled_id: Null(S),
    escrow_address: Null(S),
    approval_id: Null(S),
    proposal_id: Null(S),
    cancel_approval_id: Null(S),
    cancel_proposal_id: Null(S),
    rescheduled_from: Null(S),
    shortfall: Null(Schema.Literals(["balance_too_low", "budget_exhausted"])),
    mismatch: Null(S),
    settled_tx_hash: Null(S),
    settled_log_index: Null(Int),
    settled_block_number: Null(Int),
    settled_block_hash: Null(S),
    settled_at: Null(At),
    created_at: At,
    updated_at: At,
  }),
  key: ["owner_id", "owner_kind", "id"],
  indexes: [
    {
      name: "by-owner-created",
      fields: ["owner_id", "owner_kind", "created_at"],
      for: "`payment list` and activity's feed: the Payments an owner holds, newest first, paged by `--after`.",
    },
    {
      name: "by-owner-scheduled",
      fields: ["owner_id", "owner_kind", "status", "pay_at"],
      for: "`payment list --scheduled`: an owner's scheduled Payments, soonest first.",
    },
    {
      name: "by-owner-command",
      fields: ["owner_id", "owner_kind", "command_id"],
      for: "A request-key repeat and `payments.prepare-command`'s answer: the Payments a command birthed.",
    },
    {
      name: "by-owner-approval",
      fields: ["owner_id", "owner_kind", "approval_id"],
      for: "`payment wait approval_…`: the Payments an approval carries.",
    },
    {
      name: "by-payee-created",
      fields: ["payee_id", "payee_kind", "created_at"],
      crossTenant: true,
      for: "The payee's side of `payment list` and `payment get`: Payments it receives from another owner, newest first; the policy admits the payee's tenant.",
    },
    {
      name: "by-chain-payment-id",
      fields: ["chain_id", "chain_payment_id"],
      unique: true,
      crossTenant: true,
      for: "Settlement: the one Payment an indexed PaymentSent's payment id settles, whoever holds it; a second birth of the same id fails here.",
    },
    {
      name: "by-settled-log",
      fields: ["chain_id", "settled_tx_hash", "settled_log_index"],
      unique: true,
      crossTenant: true,
      for: "Single-use evidence (K9): one PaymentSent log settles at most one Payment, enforced by the constraint, not by a read.",
    },
  ],
  retention: "Kept indefinitely: a Payment is a money fact, and its book fact points at it.",
  was: [
    `${OLD}/tables/payments.ts:36`,
    `${OLD}/tables/schedules.ts:17`,
    `${OLD}/tables/commands.ts:90`,
    `${OLD}/tables/payments.ts:191`,
    ASIS,
  ],
});

// ── movements ───────────────────────────────────────────────────────────────────────────────

export const table_movements = defineTable({
  id: "movements",
  title: "Movements: outside money in and out of Capxul Safes",
  about:
    "One row per side of an indexed ERC-20 Transfer that touches a Capxul Safe and that no Payment explains: money that " +
    "arrived from or left to outside Capxul's Payments. A Payment's own Transfer (beside its PaymentSent, or funding or " +
    "refunding its claim escrow) is never a Movement (K17). Each side is judged on its own Payments only, so an " +
    "Organization's direct transfer to a person is outside money for both sides (old M1). The Transfer itself is " +
    "Ponder's: this row holds the classification, the side's tenant and the block it was recorded at, and its book fact " +
    "is written in the same transaction under books' money key `transfer:<chain id>:<tx hash>:<log index>`, the key a " +
    "bank deposit's Transfer is booked under too, so books keeps one live fact for it whoever writes first.",
  concept: concept_payments,
  tenancy: "owner",
  tenantField: "owner_id",
  fields: Schema.Struct({
    owner_id: S,
    owner_kind: OwnerKind,
    chain_id: Int,
    tx_hash: S,
    log_index: Int,
    side: Schema.Literals(["in", "out"]),
    safe: S,
    counterparty: S,
    token_address: S,
    amount_raw: S,
    block_number: Int,
    block_hash: S,
    block_time: At,
    status: Schema.Literals(["recorded", "removed"]),
    created_at: At,
    updated_at: At,
  }),
  key: ["owner_id", "owner_kind", "chain_id", "tx_hash", "log_index", "side"],
  indexes: [
    {
      name: "by-owner-time",
      fields: ["owner_id", "owner_kind", "block_time"],
      for: "Activity's feed and books' reconcile: an owner's outside money by block time.",
    },
    {
      name: "by-log",
      fields: ["chain_id", "tx_hash", "log_index"],
      crossTenant: true,
      for: "A Transfer's rows on both sides, for a replayed chain event and the finality check after a reorg.",
    },
  ],
  retention: "Kept indefinitely: a reorged Movement is marked removed, never deleted.",
  was: [`${OLD}/tables/movements.ts:10`, `${OLD}/tables/movements.ts:31`, `${OLD}/movements/reads/outside.ts:43`, ASIS],
});

// ── machine: payment ────────────────────────────────────────────────────────────────────────

export const event_payment_transitioned = defineEvent({
  id: "payment_transitioned",
  about:
    "A Payment changed state. Requests (paid), banking (a payout's Payment), notices and activity follow it through the " +
    "outbox. `outcome` says why a Payment lapsed or was cancelled.",
  props: Schema.Struct({
    from: Null(PaymentStatus),
    to: PaymentStatus,
    transition: S,
    payment_id: S,
    owner_kind: OwnerKind,
    owner_id: S,
    command_id: Null(S),
    route: Route,
    outcome: Null(Outcome),
  }),
  was: ["packages/observability/src/catalog/domains/payments.ts", `${OLD}/events/writer.ts:198`],
});

const sends = [event_payment_transitioned];

export const machine_payment = defineMachine({
  id: "payment",
  title: "A Payment, from prepare to settled",
  about:
    "The one machine of a Payment, driven by the Payment's own durable process and by the rpcs that change its plan. " +
    "No other writer touches `status` (old S3). A reorg reopens only a settled or mismatched Payment (old S1). Bank " +
    "delivery and return are the payout's machine in banking (K13), not states here; pre-v4 commitment states are gone (P9).",
  table: table_payments,
  field: "status",
  initial: "prepared",
  states: [
    {
      id: "prepared",
      about: "Born with its terms, its document and the approval or Board proposal that carries it; nothing is signed or sent yet.",
    },
    { id: "scheduled", about: "Dated: its operation is signed and held for its day, or its budget reserves it in Budgets; nothing has moved." },
    {
      id: "due",
      about: "Dated and within a day of its day: its funding was checked a day ahead and a shortfall is kept for the payer's notice.",
    },
    { id: "escrowed", about: "In a claim escrow for an email with no account yet: the payer can take it back until the payee collects." },
    { id: "submitted", about: "Sent: its approval was sent, its Board proposal executed, or Budgets was asked to pay it; waiting for the indexed PaymentSent." },
    { id: "needs_retry", about: "Its approval ended without moving money; `payment retry` sends the same terms again under the same payment id." },
    { id: "settled", about: "The indexed PaymentSent matched every term and its book fact is written; a reorg below finality reopens it." },
    { id: "mismatched", about: "An indexed PaymentSent carries its payment id but disagrees on a term: nothing is booked." },
    { id: "cancelled", about: "It will never move: declined, rejected, voided, cancelled in Budgets or refunded from its claim escrow.", terminal: true },
  ],
  transitions: {
    open: {
      from: [],
      to: "prepared",
      about: "Birth: a prepare, `payments.prepare-command`, a reschedule's new date, or an indexed PaymentSent no Payment holds.",
      guard: "A prepared birth reads funding first and commits with its command, its document and its approval or proposal (K2, K3).",
      emits: sends,
    },
    schedule: {
      from: ["prepared"],
      to: "scheduled",
      about: "A personal dated payment's approval is signed and held for its day, or PaymentScheduled with its job nonce is indexed.",
      emits: sends,
    },
    come_due: {
      from: ["scheduled"],
      to: "due",
      about: "A day before its day: the funding it needs then was read (a personal Safe's balance; a budget's reservation needs none).",
      emits: sends,
    },
    escrow: {
      from: ["prepared"],
      to: "escrowed",
      about: "EscrowCreated with its payment id is indexed: the claim escrow holds the money for the payee.",
      emits: sends,
    },
    submit: {
      from: ["prepared", "scheduled", "due"],
      to: "submitted",
      about: "Its approval was sent, its Board proposal executed, or `Budgets.execute` was sent on its day.",
      emits: sends,
    },
    settle: {
      from: ["prepared", "scheduled", "due", "escrowed", "submitted"],
      to: "settled",
      about: "The indexed PaymentSent with its payment id matched every term; its book fact is written in the same transaction.",
      guard:
        "Payments' address, chain, sender Safe, recipient, token, raw amount, kind and document hash all match (K7), and the log is no other Payment's (K9).",
      emits: sends,
    },
    mismatch: {
      from: ["prepared", "scheduled", "due", "escrowed", "submitted"],
      to: "mismatched",
      about: "The indexed PaymentSent with its payment id differs on a term; the first differing term is kept and nothing is booked.",
      emits: sends,
    },
    unsettle: {
      from: ["settled", "mismatched"],
      to: "submitted",
      about: "A reorg removed the PaymentSent it consumed; a settled Payment's book fact is reversed in the same transaction (K12).",
      emits: sends,
    },
    lapse: {
      from: ["prepared", "scheduled", "due", "submitted"],
      to: "needs_retry",
      about: "Its approval ended expired, displaced or reverted, or a dated operation's signed window closed; nothing moved.",
      emits: sends,
    },
    retry: {
      from: ["needs_retry"],
      to: "prepared",
      about: "`payment retry` opened a new approval or Board proposal for the same terms and payment id.",
      guard: "The payer still has the funds and the authority the first send needed.",
      emits: sends,
    },
    cancel: {
      from: ["prepared", "scheduled", "due", "escrowed"],
      to: "cancelled",
      about:
        "Its approval was declined, its proposal rejected, or its void, `Budgets.cancel` or escrow refund landed; a void cancels every Payment of the operation (K14).",
      emits: sends,
    },
  },
  was: [`${OLD}/rules/transitions.ts:196`, `${OLD}/schedules/rules.ts:25`, ASIS],
});

// ── machine: movement ───────────────────────────────────────────────────────────────────────

export const event_movement_transitioned = defineEvent({
  id: "movement_transitioned",
  about: "Outside money was recorded for a side of a Transfer, or a reorg removed it. Activity follows it through the outbox.",
  props: Schema.Struct({
    from: Null(Schema.Literals(["recorded", "removed"])),
    to: Schema.Literals(["recorded", "removed"]),
    transition: S,
    owner_kind: OwnerKind,
    owner_id: S,
    chain_id: Int,
    tx_hash: S,
    log_index: Int,
    side: Schema.Literals(["in", "out"]),
  }),
  was: [`${OLD}/movements/rules/movements.ts:6`],
});

export const machine_movement = defineMachine({
  id: "movement",
  title: "A Movement of outside money",
  about:
    "Recorded with its book fact when the Transfer is indexed, removed with its book fact reversed when a reorg takes the " +
    "Transfer away, recorded again if the chain brings it back. The old `observed` and `finalized` states had no meaning " +
    "a reader could use (old S10): how final a Movement is, is its block against the indexer's head.",
  table: table_movements,
  field: "status",
  initial: "recorded",
  states: [
    { id: "recorded", about: "An indexed Transfer no Payment explains, booked as this side's outside money." },
    { id: "removed", about: "A reorg took the Transfer away; its book fact is reversed." },
  ],
  transitions: {
    record: { from: [], to: "recorded", about: "Birth: a Transfer touching this side's Safe that no Payment of this side explains.", emits: [event_movement_transitioned] },
    remove: { from: ["recorded"], to: "removed", about: "A reorg removed the Transfer before it was final.", emits: [event_movement_transitioned] },
    restore: { from: ["removed"], to: "recorded", about: "The chain included the same Transfer again.", emits: [event_movement_transitioned] },
  },
  was: [`${OLD}/movements/rules/movements.ts:6`, ASIS],
});
