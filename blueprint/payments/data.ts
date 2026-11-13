// Payments' tables, its two state machines and each machine's one event (P7), in the target design.
//
// Three tables replace the old thirteen (docs/as-is/archive/payments/data.ts):
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
import { defineEvent, defineInvariant, defineMachine, defineTable } from "../../packages/blueprint-engine/src/index.ts";
import { concept_payments } from "../shared/foundation.ts";
import { Against } from "../books/procedures.ts";
import { table_escrows } from "../indexing/data.ts";

const OLD = "packages/backend/src/payments";
const ASIS = "docs/as-is/archive/payments/data.ts";

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
  "refused",
  "rejected",
  "expired",
  "displaced",
  "reverted",
  "window_closed",
  "voided",
  "budget_cancelled",
  "refunded",
  "withdrawn",
]);

/**
 * What another concept's money is, kept on the Payment for provenance and reads (payments.payroll-door):
 * a payroll run's salary slip, or a payroll deduction's remittance, with the run and the Employee it pays.
 * Books names the Payment as its settlement source; payroll supplies Employee, Payroll Entry and Payroll Payable
 * posting details through `against`, not by casting this source kind into Books' source kind. A seat
 * purchase (`org seats buy`, payments.seat-purchase) is a source too: its id is its command's, `quantity` its seats
 * and `buyer_party_id` the person who bought them, which the settlement passes to organizations' door. So is a
 * hosting payment for the Organization's FDE (`org fde pay`, payments.fde-hosting-purchase): `quantity` its months.
 */
export const PaymentSource = Schema.Struct({
  /** `expense-claim` and `employee-advance`: payroll's HR money (payroll.hr-money), paid from the department's budget to the Employee. */
  kind: Schema.Literals(["salary-slip", "payroll-remittance", "expense-claim", "employee-advance", "seat-purchase", "fde-hosting"]),
  id: S,
  /** The run a slip or remittance belongs to; null for an expense claim, an advance and a purchase. */
  payroll_entry_id: Null(S),
  employee_id: Null(S),
  /** A seat purchase's seats (1 to 1,000), or a hosting payment's months (1 to 12); absent for a payroll source. */
  quantity: Schema.optionalKey(Int),
  /** The person who asked for a seat purchase or a hosting payment, by their Party, kept when another wearer retries it; absent for a payroll source. */
  buyer_party_id: Schema.optionalKey(S),
});

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
    "proposal it opened (the latest, after a resume), so a repeat reports where that approval ended. `not_after` is the " +
    "last moment its money may move (a bank quote's expiry): its approval's deadline is capped at it, and `payment " +
    "retry` refuses after it. A payroll run's pay (`purpose` payroll) is one command per attempt; a seat purchase " +
    "(`purpose` seats, `org seats buy`) or a hosting payment (`purpose` fde_hosting, `org fde pay`) is one command whose " +
    "one Payment pays Capxul (payments.seat-purchase, payments.fde-hosting-purchase). What the money is for " +
    "in the books (`payment send --account`, a request's meaning, a payout's payee, a head's references) is kept on each " +
    "Payment it births, from that birth, so it reaches books at settlement (payments.money-sides). The old document " +
    "intents are the digest's document hashes.",
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
    purpose: Schema.Literals(["payment", "department", "reschedule", "request", "bank_payout", "payroll", "seats", "fde_hosting"]),
    requested_by: S,
    approval_id: Null(S),
    proposal_id: Null(S),
    not_after: Null(At),
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
    "row-level policy admits either side. Labels are the names as the payer gave them, snapshotted at birth. Dated " +
    "payments are rows here with `pay_at`. A Payment born from a chain fact has the id `payment_` and the 64 hex digits " +
    "of its v4 payment id, so a concept that read the PaymentSent (payroll's collection) names it without reading " +
    "payments; a prepared Payment's id is `payment_` and a ULID. A claim escrow's Payment keeps `payee_mailbox` as the " +
    "payer typed it (trimmed and lowercased), for the money-waiting email (payments.claim-escrow-mailbox), and its payee " +
    "tenant is filled when the payee collects. Every claim escrow keeps `escrow_address`, its general escrow's " +
    "counterfactual address, and `funding_payment_id`, the id of the PaymentSent that pays that address (from the payer's " +
    "Safe, or the company Safe directly or through Budgets), which settles nothing; one a budget funds keeps `budget_id` too, the budget " +
    "whose current hat-wearers may take it back (payments.claim-escrow-routes). Books gets `against`, `fee_raw` and " +
    "source=Payment; Payment.source keeps origin (payments.payroll-door). `settled_at` is block time, and " +
    "the settled transaction, log and block are the holder's to read: a payroll run copies them onto its slips " +
    "(payments.payroll-door). Status changes only through machine `payment`.",
  concept: concept_payments,
  tenancy: "owner",
  tenantField: "owner_id",
  admits: [
    {
      match: "tenant",
      field: "payee_id",
      kindField: "payee_kind",
      reads: true,
      writes: false,
      about:
        "The payee's tenant reads a Payment it receives from another owner (`by-payee-created`); only the holder's rpcs " +
        "and payments' processes write it (payments.two-sided-tenancy).",
    },
  ],
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
    /** A claim escrow's mailbox, trimmed and lowercased; null on every other route. Read only by its holder and notices. */
    payee_mailbox: Null(S),
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
    /** A claim escrow's funding: the payment id of the PaymentSent that pays the escrow's address, on every route. Null otherwise. */
    funding_payment_id: Null(S),
    /** What the payer's books post it against, as the command carried it at birth; null when nothing was said. */
    against: Null(Against),
    /** What the payee's books post it against, when the payee said so first (a request's income account and invoice). */
    payee_against: Null(Against),
    /** A payroll slip or remittance this Payment pays, or the seat purchase or FDE hosting it pays for; null for every other Payment. */
    source: Null(PaymentSource),
    /** The part of the amount a rail keeps (a bank payout's quoted fee), in the token's units; null when none. */
    fee_raw: Null(S),
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
    /** The settling block's time, epoch ms: the same instant books dates the fact at and a payroll slip copies. */
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
      name: "by-funding-payment-id",
      fields: ["chain_id", "funding_payment_id"],
      unique: true,
      crossTenant: true,
      for: "A claim escrow's funding PaymentSent: the Payment it funds, which `escrow` follows, so the PaymentSent births no Payment of its own.",
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
    {
      id: "escrowed",
      about:
        "In a claim escrow for an email with no account yet: its owner may collect whenever it chooses, and its sender (for a budget's, whoever wears the budget's hat now, or the Board) may take it back until then; no expiry.",
    },
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
      from: ["prepared", "scheduled", "due", "submitted"],
      to: "escrowed",
      about:
        "Its funding's PaymentSent (`funding_payment_id`) is indexed: the escrow's address holds the money, and notices " +
        "sends the money-waiting email. Also from `submitted`, or `scheduled` or `due` for a dated one (payments.escrow-on-funding).",
      emits: sends,
    },
    submit: {
      from: ["prepared", "scheduled", "due"],
      to: "submitted",
      about:
        "Its approval was sent, its Board proposal executed, or `Budgets.execute` on its day was mined with its ScheduledPaid.",
      emits: sends,
    },
    settle: {
      from: ["prepared", "scheduled", "due", "escrowed", "submitted"],
      to: "settled",
      about: "The indexed PaymentSent with its payment id matched every term; its book fact is written in the same transaction.",
      guard:
        "Payments' address, chain, sender (a claim escrow's: its escrow), recipient, token, raw amount, kind and document hash all match (K7), and the log is no other Payment's (K9).",
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
      about:
        "Its approval ended expired, displaced or reverted, its Board proposal failed or lost its nonce to another transaction, or a dated operation's signed window closed; nothing moved.",
      emits: sends,
    },
    retry: {
      from: ["needs_retry"],
      to: "prepared",
      about: "`payment retry` opened a new approval or Board proposal for the same terms and payment id.",
      guard: "The payer still has the funds and the authority the first send needed, and its command's `not_after` has not passed.",
      emits: sends,
    },
    cancel: {
      from: ["prepared", "scheduled", "due", "escrowed"],
      to: "cancelled",
      about:
        "Its approval was declined, refused or withdrawn before signing, its proposal rejected, or its void, `Budgets.cancel` or escrow refund landed (outcome refunded: the money back at its sender, a budget's at the company Safe, no room restored); a void cancels every Payment of its operation (K14).",
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

// ── invariants of the general escrow (aaron.escrow-general; docs/design/escrow.md) ─────────────
//
// What the general escrow must keep, as the evals check it: the contracts package's Foundry trees and invariant
// suite check them on the contract, and the devnet's evals check them through each claim escrow's Payment.

const ESCROW_EVIDENCE = "docs/design/escrow.md (invariants G1 to G11)";

export const invariant_payments_escrow_counterfactual = defineInvariant({
  id: "payments.escrow-counterfactual",
  title: "A claim escrow's address is fixed by its terms before anything is on chain",
  about:
    "G1 and G2: the general escrow is deployed counterfactually. Prepare fixes the address from the terms and the job " +
    "nonce, the payer signs the money into it, and a deploy before or after the funding moves nothing. Checked by the " +
    "factory's trees (deploy, predictAddress, predictPaymentId) and, on the devnet, by each claim escrow's Payment: its " +
    "`escrow_address` is where the funding went and where EscrowDeployed lands. " + ESCROW_EVIDENCE + ".",
  statement:
    "For every claim-escrow Payment, `escrow_address` equals EscrowFactory.predictAddress of its terms and salt from prepare on; its funding, collection and refund touch only that address, and a second deploy returns the same escrow.",
  over: [table_payments, table_escrows],
  check: "property",
});

export const invariant_payments_escrow_two_ways_out = defineInvariant({
  id: "payments.escrow-two-ways-out",
  title: "Money in a claim escrow leaves only to its owner or its sender",
  about:
    "G3 and G7: the money goes to the owner when it collects, or back to the sender when it is taken back; never to a " +
    "caller, never both. Checked by the escrow's invariant handler over random calls, deposits and authority answers, " +
    "and on the devnet by each Payment ending once. " + ESCROW_EVIDENCE + ".",
  statement:
    "Every token that leaves a general escrow goes to its owner (a collection or payout, through Payments) or to its sender (a refund); at most one of the two ends it, and its Payment ends settled to the owner's Safe or cancelled refunded, never both.",
  over: [table_payments, machine_payment, table_escrows],
  check: "fuzz",
});

export const invariant_payments_escrow_owner_any_time = defineInvariant({
  id: "payments.escrow-owner-any-time",
  title: "The owner collects whenever it chooses, and nobody else can",
  about:
    "G4 and G5: an owner-collects escrow has no expiry; its owner collects once it can act (it has code and no longer " +
    "lists the bootstrap owner among its owners, read failing closed), at setup or later with `payment claim`. " +
    ESCROW_EVIDENCE + ".",
  statement:
    "While open and holding its amount, `collect` from the owner succeeds once the owner can act, at any time; from any other caller, or while Companies House is still among the owner's owners, it reverts and moves nothing.",
  over: [table_payments, table_escrows],
  check: "fuzz",
});

export const invariant_payments_escrow_sender_until_collected = defineInvariant({
  id: "payments.escrow-sender-until-collected",
  title: "The sender takes it back at any time until it is collected",
  about:
    "G6 and G11: the escape hatch. A refund works while the escrow is open, even after the owner can act (D12), and always " +
    "pays the sender, whoever calls. An amount-reached escrow (an invoice) carries its owner's claim, so it can be taken " +
    "back only while short. " + ESCROW_EVIDENCE + ".",
  statement:
    "While an owner-collects escrow is open, `refund` by its sender, or by a caller its authority admits at that block, succeeds and pays its sender the whole balance; any other caller, or an authority that reverts or answers malformed, is refused.",
  over: [table_payments, machine_payment, table_escrows],
  check: "fuzz",
});

export const invariant_payments_escrow_department_now = defineInvariant({
  id: "payments.escrow-department-now",
  title: "A department's escrow is taken back by whoever wears its hat at the refund",
  about:
    "G9, aaron.departments through the authority term: an escrow a budget funded names Budgets and the budget id, so the " +
    "department's authority is read at the call. A holder taken out of the hat is refused at once and the next wearer " +
    "admitted, with no Capxul write in between; the Board, as the company Safe, always may. " + ESCROW_EVIDENCE + ".",
  statement:
    "For an escrow whose authority is Budgets and a budget id, `refund` from a caller other than the sender succeeds exactly when Budgets.authorised(budgetId, caller) holds at that block, and the money goes to the company Safe.",
  over: [table_payments, table_escrows],
  check: "property",
});

export const invariant_payments_escrow_budgets_unchanged = defineInvariant({
  id: "payments.escrow-budgets-unchanged",
  title: "A budget funds a claim escrow as any spend, and its refund restores no room",
  about:
    "G10: aaron.escrow-general leaves Budgets unchanged, and Aaron accepted that the room is not restored (open question 1). " +
    "A budget's claim escrow is an ordinary Budgets.spend, or a schedule paid by execute, to the escrow's address; the " +
    "refund is a transfer to the company Safe that Budgets never sees. " + ESCROW_EVIDENCE + ".",
  statement:
    "A budget's claim escrow is funded only by Budgets.spend or a scheduled Budgets.execute to its address, and its refund leaves every budget's spent and leftOf as they were; the money's return shows only in the company Safe's balance.",
  over: [table_payments],
  check: "property",
});
