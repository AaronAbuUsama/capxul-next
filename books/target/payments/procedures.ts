// Payments' door: the one procedure another concept invokes to write payments' tables in its own
// transaction. Requests (a request paid from the inbox) and banking (a bank payout) depend on payments and
// birth the Payment that moves their money here; nothing else writes payments' tables from outside.
//
// Approvals, documents and books are reached through their own doors, imported by the conventional export
// names (CONVENTIONS.md): a sibling's door may still be being written while this file is.

import { Schema } from "effect";
import { defineProcedure } from "../../../packages/book/src/index.ts";
import { concept_payments } from "../shared/foundation.ts";
import {
  error_INSUFFICIENT_BALANCE,
  error_INVALID_INPUT,
  error_INVALID_RECIPIENT,
  error_PAYROLL_BUDGET_EXCEEDED,
  error_WRONG_STATE,
} from "../shared/vocabulary.ts";
import * as approvals from "../approvals/procedures.ts";
import { Against } from "../books/procedures.ts";
import * as partiesData from "../parties/data.ts";
import { PaymentSource, machine_payment, table_payment_commands, table_payments } from "./data.ts";

const OLD = "packages/backend/src/payments";

const OwnerKind = Schema.Literals(["person", "organization"]);

/** One payment a request, a bank payout or a payroll run needs: its payee already resolved to a Party and Safe, its
 * document, if it has one, already stored. An item with no document (a bank payout: banking does not depend on documents)
 * carries a null `document_id` and a hash the invoker derives (banking.payout-document-hash), never the zero hash, which
 * `Payments.send`, `Budgets.spend` and `Escrow` all revert on (`ZeroDocumentHash`). The optional keys are what the
 * money is for (payments.money-sides, payments.payroll-door): `against` for the books, `source` for a payroll slip or
 * remittance, `fee_raw` for a rail's fee, and `payee_mailbox` for a payee who has no account yet. */
export const PreparedItem = Schema.Struct({
  payee_party_id: Schema.String,
  payee_safe: Schema.String,
  payee_label: Schema.String,
  payee_kind: Schema.NullOr(OwnerKind),
  payee_id: Schema.NullOr(Schema.String),
  token_address: Schema.String,
  asset: Schema.String,
  decimals: Schema.Int,
  amount_raw: Schema.String,
  kind: Schema.Int,
  document_id: Schema.NullOr(Schema.String),
  /** The stored document's hash, or for an item with none the digest its invoker derives; never `0x` and 64 zeros. */
  document_hash: Schema.String,
  /** What the payer's books post it against: an account, a party, documents (books' own shape), kept from birth. */
  against: Schema.optionalKey(Against),
  /** What the payee's books post it against, when the invoker knows: a paid request's income account, Customer and invoice. */
  payee_against: Schema.optionalKey(Against),
  /** The payroll slip or remittance it pays, kept on the Payment and passed with its book fact. */
  source: Schema.optionalKey(PaymentSource),
  /** A rail's fee inside `amount_raw` (a bank payout's quoted `fee_amount`), in the token's units. */
  fee_raw: Schema.optionalKey(Schema.String),
  /** The mailbox a provisional payee's Safe derives from, trimmed and lowercased: such an item is paid into a claim escrow. */
  payee_mailbox: Schema.optionalKey(Schema.String),
});

export const procedure_payments_prepare_command = defineProcedure({
  id: "payments.prepare-command",
  title: "Birth a Payment command another concept's money needs",
  about:
    "Money fact: a Payment command another concept births (the request it pays, the bank payout it funds, the payroll " +
    "run it pays): the command, its Payments and the approval that moves them commit together, or none do. Requests " +
    "invokes it from the inbox, banking for a bank payout, payroll for a run, a claim or an advance (purpose payroll, " +
    "route budget). It keeps " +
    "every birth rule of `payment send`: one owner and request key reach one command, another request under a used key " +
    "is refused (K1); the funding the invoker read before its transaction (the Safe's balance, or the budget's " +
    "`leftOf`) must cover every item, or nothing is written (K3); each item's v4 payment id is fixed here, before anyone " +
    "signs. It births each Payment through `open` and opens one approval from the payer's own Safe for all of them " +
    "(`approvals.open`). A dated birth (`pay_at`, at least an hour ahead, else INVALID_INPUT) is a personal operation " +
    "signed now and sent on its day (`send_after`) or a budget's `Budgets.schedule`. `not_after` (a bank quote's expiry) " +
    "caps the approval's deadline and is kept on the command, so no later `payment retry` moves the money after it. A " +
    "repeat under the key answers the command as it stands (`replayed`); with `resume`, one whose Payments all lapsed " +
    "opens one new approval for the same payment ids and moves them `retry` after the same funding check, so a retry " +
    "never pays twice (past `not_after`: WRONG_STATE). An item whose payee Party is still provisional is a claim escrow " +
    "(route `claim_escrow`) and needs its ASCII `payee_mailbox`, else INVALID_RECIPIENT; a budget's sender is the " +
    "company Safe, with Budgets and the budget as authority (payments.claim-escrow-routes). The zero " +
    "document hash, which every v4 call refuses, is INVALID_INPUT. Each item's `against`, `payee_against`, `source` and " +
    "`fee_raw` are kept on its Payment for its book facts. It answers the approval's deadline as opened. It makes no " +
    "outside call; the invoker follows `payment_transitioned`.",
  concept: concept_payments,
  input: Schema.Struct({
    owner_kind: OwnerKind,
    owner_id: Schema.String,
    requested_by: Schema.String,
    request_key: Schema.String,
    purpose: Schema.Literals(["request", "bank_payout", "payroll"]),
    route: Schema.Literals(["personal", "budget"]),
    payer_safe: Schema.String,
    payer_label: Schema.String,
    budget_id: Schema.NullOr(Schema.String),
    chain_id: Schema.Int,
    funding: Schema.Struct({ raw: Schema.String, block_number: Schema.Int, of: Schema.Literals(["balance", "budget_left"]) }),
    items: Schema.Array(PreparedItem),
    summary: Schema.String,
    /** Epoch ms: pay on this day (`inbox pay --on/--at`); null pays at once. */
    pay_at: Schema.NullOr(Schema.Number),
    /** Epoch ms: nothing may be signed or sent after it (a bank quote's `expires_at`); null for no cap. */
    not_after: Schema.NullOr(Schema.Number),
    /** A repeat that reopens a lapsed command's Payments (`inbox pay --resume`). */
    resume: Schema.Boolean,
  }),
  output: Schema.Struct({
    command_id: Schema.String,
    payment_ids: Schema.Array(Schema.String),
    approval_id: Schema.String,
    /** Epoch ms: the approval's deadline as opened; the paymaster may cut it when it sponsors. */
    expires_at: Schema.Number,
    replayed: Schema.Boolean,
  }),
  errors: [error_INVALID_INPUT, error_INVALID_RECIPIENT, error_INSUFFICIENT_BALANCE, error_PAYROLL_BUDGET_EXCEEDED, error_WRONG_STATE],
  reads: [table_payment_commands, table_payments, partiesData.table_parties],
  writes: [table_payment_commands, table_payments],
  drives: [machine_payment.t.open, machine_payment.t.retry],
  invokes: [approvals.procedure_approvals_open],
  emits: [],
  was: [
    `${OLD}/commands/writes/commands.ts:82`,
    `${OLD}/commands/writes/commands.ts:153`,
    "packages/backend/src/requests/writes/approvals.ts:104",
    "docs/as-is/archive/payments/procedures.ts",
  ],
});
