// The documents the books hand a head, in ERPNext's own shapes: Account, Cost Center, Journal Entry
// and Payment Entry, with their child rows, and the GL Entry lines each voucher posts. The feed
// (`books.sync.feed`) returns them beside each fact, and the head sync (`books.head.sync`) writes them
// to a connected head through the `frappe-head` integration's `upsertDocs`, so the head's Capxul app
// never computes Capxul's posting rules itself (books.sync). Field names are Frappe's; every document
// carries Capxul's id and version as the Custom Fields `capxul_id` and `capxul_version` (component
// frappe-app), and links to accounts, cost centres and parties carry Capxul's ids, which the app
// resolves by the target's `capxul_id` (a party by `capxul_party`). Amounts are decimal strings: in
// the Company's currency (USD, EUR) for `debit`, `credit` and every `base_` amount, in the account's
// currency for the `_in_account_currency` ones (a Safe account's is its token: USDC, EURC).
//
// A voucher with a newer `capxul_version` replaces the one the head holds the Frappe way, never by
// editing a submitted document (Journal Entry Account's account, party and reference are not
// allow-on-submit) and never by Repost Accounting Ledger (under the immutable ledger it reverses the
// rebuilt lines, dated today): the app cancels the live document, its reversal dated on the voucher's
// own `posting_date`, and submits its amendment on the same date carrying the same `capxul_id`, or a
// new document when the type changes between Journal and Payment Entry (books.vouchers).
//
// Not records: plain schemas the rpcs' outputs use. The rules that fill them are books.vouchers.

import { Schema } from "effect";
import { DocumentRef, FrappeAccountType, GlLine, PartyType, ReferenceDoctype, RootType } from "./data.ts";

const S = Schema.String;
const Int = Schema.Int;
const NullOr = Schema.NullOr;

/** What every synced document carries: Capxul's id and the feed number of the last fact that shaped it. */
const Synced = { capxul_id: S, capxul_version: Int };

/** Account: one node of the chart's tree. A Safe account is frozen (`freeze_account` Yes): only Capxul's app user posts to it. */
export const FrappeAccount = Schema.Struct({
  doctype: Schema.Literal("Account"),
  ...Synced,
  account_name: S,
  account_number: NullOr(S),
  is_group: Schema.Boolean,
  /** The parent's Capxul id; a type group's parent is its root. */
  parent_account: NullOr(S),
  root_type: RootType,
  account_type: NullOr(FrappeAccountType),
  account_currency: S,
  freeze_account: Schema.Literals(["No", "Yes"]),
  disabled: Schema.Boolean,
});

/** Cost Center: one node of the cost-centre tree. */
export const FrappeCostCenter = Schema.Struct({
  doctype: Schema.Literal("Cost Center"),
  ...Synced,
  cost_center_name: S,
  cost_center_number: NullOr(S),
  /** The parent's Capxul id. */
  parent_cost_center: NullOr(S),
  is_group: Schema.Boolean,
  disabled: Schema.Boolean,
});

/** What every Capxul voucher carries beside Frappe's fields: its id, its version and, for money, the chain's proof. */
const CapxulVoucher = {
  /** A money voucher's is its fact's id; a payroll accrual's its `accrual_posted` fact's id. One live document per id. */
  ...Synced,
  /** The chain's proof of a money voucher; null on a payroll accrual. */
  capxul_tx_hash: NullOr(S),
  capxul_chain_id: NullOr(Int),
  capxul_log_index: NullOr(Int),
  capxul_block_time: NullOr(Int),
  posting_date: S,
  /** The voucher of the money occurrence's previous generation, which a reorganization cancelled (a new id, so a new document). */
  amended_from: NullOr(S),
  /** `Capxul` on every money voucher; null on a payroll accrual. */
  mode_of_payment: NullOr(Schema.Literal("Capxul")),
  /** Bank reconciliation has nothing to match: a money voucher is cleared on its posting date. Null on an accrual. */
  clearance_date: NullOr(S),
  /** 1 submitted; 2 cancelled by a `reversed` or `accrual_cancelled` fact, its reversal dated `cancelled_on` (the immutable ledger). */
  docstatus: Schema.Literals([1, 2]),
  cancelled_on: NullOr(S),
  /** The GL Entry lines it posts (and, cancelled, their reversal): what Capxul's own reports sum. */
  gl: Schema.Array(GlLine),
};

/** Journal Entry Account: one line of a Journal Entry. */
export const FrappeJournalEntryAccount = Schema.Struct({
  account: S,
  party_type: NullOr(PartyType),
  party: NullOr(S),
  cost_center: NullOr(S),
  project: NullOr(S),
  account_currency: S,
  /** The block's rate, never 1 by default: the app inserts with `flags.ignore_exchange_rate`, since ERPNext refetches a rate of exactly 1. */
  exchange_rate: S,
  debit_in_account_currency: S,
  debit: S,
  credit_in_account_currency: S,
  credit: S,
  reference_type: NullOr(ReferenceDoctype),
  reference_name: NullOr(S),
});

/** Journal Entry: a Bank Entry for money that settles no party's document through a Payment Entry, or a payroll run's accrual. */
export const FrappeJournalEntry = Schema.Struct({
  doctype: Schema.Literal("Journal Entry"),
  ...CapxulVoucher,
  voucher_type: Schema.Literals(["Bank Entry", "Journal Entry"]),
  is_opening: Schema.Literal("No"),
  multi_currency: Schema.Boolean,
  /** A Bank Entry's transaction and the block's day, which ERPNext requires on one; null on an accrual. */
  cheque_no: NullOr(S),
  cheque_date: NullOr(S),
  user_remark: NullOr(S),
  accounts: Schema.Array(FrappeJournalEntryAccount),
});

/** Payment Entry: money paid to or received from a party, allocated to the documents it settles. */
export const FrappePaymentEntry = Schema.Struct({
  doctype: Schema.Literal("Payment Entry"),
  ...CapxulVoucher,
  payment_type: Schema.Literals(["Pay", "Receive"]),
  party_type: PartyType,
  party: S,
  paid_from: S,
  paid_from_account_currency: S,
  paid_to: S,
  paid_to_account_currency: S,
  paid_amount: S,
  source_exchange_rate: S,
  base_paid_amount: S,
  received_amount: S,
  target_exchange_rate: S,
  base_received_amount: S,
  reference_no: S,
  reference_date: S,
  cost_center: NullOr(S),
  project: NullOr(S),
  references: Schema.Array(DocumentRef),
  /**
   * ERPNext debits every deduction (payment_entry gl_composer `add_deductions_gl_entries`): a rail's fee is a positive
   * amount on 6500; an exchange gain on a par allocation is a negative amount on 6510, a loss a positive one.
   */
  deductions: Schema.Array(
    Schema.Struct({ account: S, cost_center: S, amount: S, is_exchange_gain_loss: Schema.Boolean }),
  ),
  remarks: NullOr(S),
});

/** Any document the feed hands a head. */
export const FrappeDoc = Schema.Union([FrappeAccount, FrappeCostCenter, FrappeJournalEntry, FrappePaymentEntry]);
