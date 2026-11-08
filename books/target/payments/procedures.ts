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
import { machine_payment, table_payment_commands, table_payments } from "./data.ts";

const OLD = "packages/backend/src/payments";

const OwnerKind = Schema.Literals(["person", "organization"]);

/** One payment a request or a bank payout needs: its payee already resolved to a Party and Safe, its document, if it has
 * one, already stored. An item with no document (a bank payout: banking does not depend on documents) carries a null
 * `document_id` and the zero hash, which stamps no document on chain. */
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
  /** The stored document's hash, or `0x` and 64 zeros for an item with none. */
  document_hash: Schema.String,
});

export const procedure_payments_prepare_command = defineProcedure({
  id: "payments.prepare-command",
  title: "Birth a Payment command another concept's money needs",
  about:
    "Money fact: a Payment command another concept births: the request it pays or the bank payout it funds, the Payments " +
    "that carry it and the approval that moves them commit together, or none of them do. Requests invokes it when a payer " +
    "pays from the inbox, banking when a bank payout is quoted and accepted. It keeps every birth rule a `payment send` " +
    "keeps: one owner and request key reach one command, and another request under a used key is refused (K1); the " +
    "funding the invoker read from the chain before its transaction (the paying Safe's balance, or the budget's `leftOf`) " +
    "must cover every item, or nothing is written (K3); each item's v4 payment id is fixed here from its job nonce, before " +
    "anyone signs. It births each Payment through `open` and opens one approval from the payer's own Safe for all of them " +
    "(`approvals.open`), with the approval page's summary. A dated birth (`pay_at`, at least an hour ahead, else " +
    "INVALID_INPUT) is a personal operation signed now and sent on its day (`send_after`, with what the Safe needs that " +
    "day) or a budget's `Budgets.schedule`. `not_after` (a bank quote's expiry) caps the approval's deadline and is kept on " +
    "the command, so neither the approval nor a later `payment retry` can move the money after it. A repeat under the same " +
    "key answers the command as it stands (`replayed`); with `resume`, a repeat whose Payments all lapsed (`needs_retry`) " +
    "opens one new approval for the same items and payment ids and moves them `retry`, after the same funding check, so " +
    "a retry can never pay twice; live Payments answer as they stand, and a lapsed command past `not_after` is " +
    "WRONG_STATE. The documents are the " +
    "invoker's, already stored, so it stores none. It answers the approval's deadline as opened (the paymaster may cut " +
    "it shorter when it sponsors). It makes no outside call; the invoker follows `payment_transitioned` for the outcome.",
  concept: concept_payments,
  input: Schema.Struct({
    owner_kind: OwnerKind,
    owner_id: Schema.String,
    requested_by: Schema.String,
    request_key: Schema.String,
    purpose: Schema.Literals(["request", "bank_payout"]),
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
  reads: [table_payment_commands, table_payments],
  writes: [table_payment_commands, table_payments],
  drives: [machine_payment.t.open, machine_payment.t.retry],
  invokes: [approvals.procedure_approvals_open],
  emits: [],
  was: [
    `${OLD}/commands/writes/commands.ts:82`,
    `${OLD}/commands/writes/commands.ts:153`,
    "packages/backend/src/requests/writes/approvals.ts:104",
    "books/as-is/payments/procedures.ts",
  ],
});
