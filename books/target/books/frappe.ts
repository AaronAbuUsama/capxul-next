// The documents the books hand a head, in ERPNext's own shapes: Account, Cost Center, Journal Entry
// and Payment Entry, with their child rows, and the GL Entry lines each voucher posts. The feed
// (`books.sync.feed`) returns them beside each fact, so a head's Capxul app inserts them as they come
// and never computes Capxul's posting rules itself (books.sync). Field names are Frappe's; links
// to accounts, cost centres and parties carry Capxul's ids, which a head's Custom Fields
// (`capxul_account_id`, `capxul_cost_center_id`, `capxul_party_id`, `capxul_voucher_id`) resolve
// to its own document names. Amounts are decimal strings: in USD (the Company's currency) for
// `debit`, `credit` and every `base_` amount, in the account's currency for the `_in_account_currency`
// ones (a Safe account's is its token: USDC, EURC).
//
// Not records: plain schemas the rpcs' outputs use. The rules that fill them are books.vouchers.

import { Schema } from "effect";
import { DocumentRef, FrappeAccountType, GlLine, PartyType, ReferenceDoctype, RootType } from "./data.ts";

const S = Schema.String;
const Int = Schema.Int;
const NullOr = Schema.NullOr;

/** Account: one node of the chart's tree. A Safe account is frozen (`freeze_account` Yes): only Capxul posts to it. */
export const FrappeAccount = Schema.Struct({
  doctype: Schema.Literal("Account"),
  capxul_account_id: S,
  account_name: S,
  account_number: NullOr(S),
  is_group: Schema.Boolean,
  parent_capxul_account_id: NullOr(S),
  root_type: RootType,
  account_type: NullOr(FrappeAccountType),
  account_currency: S,
  freeze_account: Schema.Literals(["No", "Yes"]),
  disabled: Schema.Boolean,
});

/** Cost Center: one node of the cost-centre tree. */
export const FrappeCostCenter = Schema.Struct({
  doctype: Schema.Literal("Cost Center"),
  capxul_cost_center_id: S,
  cost_center_name: S,
  cost_center_number: NullOr(S),
  parent_capxul_cost_center_id: NullOr(S),
  is_group: Schema.Boolean,
  disabled: Schema.Boolean,
});

/** What every Capxul voucher carries beside Frappe's fields: its id, its version and the chain's proof. */
const CapxulVoucher = {
  /** The money fact's id: the head's unique Custom Field, so a voucher can never be inserted twice. */
  capxul_voucher_id: S,
  /** The seq of the last fact that shaped it (the money fact, or the latest annotation fact): a head reposts when it is newer. */
  capxul_version: Int,
  capxul_tx_hash: S,
  capxul_chain_id: Int,
  capxul_log_index: NullOr(Int),
  capxul_block_time: Int,
  posting_date: S,
  /** The voucher of the money occurrence's previous generation, which a reorganization cancelled. */
  amended_from: NullOr(S),
  mode_of_payment: Schema.Literal("Capxul"),
  /** Bank reconciliation has nothing to match: a Capxul voucher is cleared on its posting date. */
  clearance_date: S,
  /** 1 submitted; 2 cancelled by a `reversed` fact, its reversal dated `cancelled_on` (the immutable ledger). */
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
  exchange_rate: S,
  debit_in_account_currency: S,
  debit: S,
  credit_in_account_currency: S,
  credit: S,
  reference_type: NullOr(ReferenceDoctype),
  reference_name: NullOr(S),
});

/** Journal Entry: a Bank Entry for money with no party document to settle, an Opening Entry for an added token's balance. */
export const FrappeJournalEntry = Schema.Struct({
  doctype: Schema.Literal("Journal Entry"),
  ...CapxulVoucher,
  voucher_type: Schema.Literals(["Bank Entry", "Opening Entry"]),
  is_opening: Schema.Literals(["No", "Yes"]),
  multi_currency: Schema.Boolean,
  cheque_no: S,
  cheque_date: S,
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
  deductions: Schema.Array(
    Schema.Struct({ account: S, cost_center: S, amount: S, is_exchange_gain_loss: Schema.Boolean }),
  ),
  remarks: NullOr(S),
});

/** Any document the feed hands a head. */
export const FrappeDoc = Schema.Union([FrappeAccount, FrappeCostCenter, FrappeJournalEntry, FrappePaymentEntry]);
