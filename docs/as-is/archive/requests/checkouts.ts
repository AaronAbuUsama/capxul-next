// The as-is book of the old requests concept: the checkouts area (paying a frozen Offer purchase, an
// Invoice or a request from its link, verified on chain).
//
// Every operation registered at `requests/checkouts:*` (packages/backend/convex/requests/checkouts.ts).
// Fifteen are public rows of `checkouts` (packages/protocol/src/requests/operations.ts:179); ten are
// internal queries and mutations the checkout actions run through `ctx.runQuery` / `ctx.runMutation`
// in the same call; `payEscrows` is the minute cron, booked as a workflow.
//
// How touches are booked:
// - An internal rpc lists what its own transaction does through requests code. A neighbour's door
//   function it calls is an invoke of that neighbour's procedure; a neighbour table the requests code
//   queries or patches by itself is a read or write of that table (a boundary finding).
// - A public action holds no transaction of its own. It lists what the internal rpcs it runs touch, so
//   the endpoint shows everything one call does, and the outside calls its chain checks make.
// - The checks reach the chain through `ChainEvidenceService` over the live `ChainRpc` (external/evidence.ts).

import { Schema } from "effect";
import { defineRpc, defineWorkflow, type Kind, type Ref } from "../../../packages/book/src/index.ts";

import { concept_requests } from "../shared/foundation.ts";
import {
  error_ENV_MISSING,
  error_INSUFFICIENT_BALANCE,
  error_INVALID_INPUT,
  error_NOT_AUTHENTICATED,
  error_NOT_IMPLEMENTED,
  error_PROVIDER_ERROR,
  error_PROVIDER_RESPONSE_INVALID,
  error_RATE_LIMITED,
  error_ROLE_PERMISSION_DENIED,
  error_UNKNOWN,
  error_WRONG_STATE,
} from "../shared/vocabulary.ts";
import {
  contract_capxul_escrow,
  contract_capxul_escrow_factory,
  contract_entry_point,
  contract_erc20,
  contract_escrow,
  contract_escrow_factory,
  contract_multi_send_call_only,
  contract_safe_4337_module,
  integration_chain_evidence,
  integration_chain_rpc,
} from "../shared/external.ts";
import {
  machine_invoice_escrow,
  machine_invoice_receipt,
  table_fixed_offer_revisions,
  table_fixed_offers,
  table_invoice_checkout_payments,
  table_offer_checkouts,
  table_payment_requests,
} from "./data.ts";
import {
  procedure_requests_prepare_registered_invoice_in_tx,
  procedure_requests_prepare_registered_request_in_tx,
} from "./procedures.ts";
import { table_payment_commands, table_payments } from "../payments/data.ts";
import { procedure_payments_actor_inventory } from "../payments/procedures.ts";
import { rpc_payments_commands_prepare_invoice_checkout } from "../payments/commands.ts";
import { procedure_access_read_scope_safe_address_in_tx } from "../access/procedures.ts";
import { procedure_accounts_require_payment_account_in_tx } from "../accounts/procedures.ts";
import {
  procedure_documents_link_movement_document_in_tx,
  procedure_documents_persist_payment_document,
  procedure_documents_prepare_movement_memo_in_tx,
} from "../documents/procedures.ts";
import { table_financial_document_movements } from "../documents/data.ts";
import { procedure_parties_party_by_safe_address, procedure_parties_resolve_recipient_in_tx } from "../parties/procedures.ts";

const BACKEND = "packages/backend";
const CONVEX = `${BACKEND}/convex/requests/checkouts.ts`;
const R = `${BACKEND}/src/requests`;
const AREA = `${R}/checkouts`;
const OPS = `${AREA}/operations`;
const ROWS = "packages/protocol/src/requests/operations.ts";

const S = Schema.String;
const N = Schema.Number;
const U = Schema.Unknown;
const opt = Schema.optionalKey;

/** Keep each link once, in first-seen order. */
const union = <K extends Kind>(...lists: ReadonlyArray<ReadonlyArray<Ref<K>>>): Ref<K>[] => {
  const seen = new Set<string>();
  const out: Ref<K>[] = [];
  for (const list of lists)
    for (const item of list) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      out.push(item);
    }
  return out;
};



// ── shapes ─────────────────────────────────────────────────────────────────────────────────

const AssetAmount = Schema.Struct({ asset: S, value: S });

/** `OfferCheckoutSchema` (offer-schema.ts:138): the frozen purchase. */
const OfferCheckout = Schema.Struct({
  contractAddress: S,
  checkoutId: S,
  offerId: S,
  revision: N,
  quantity: N,
  title: S,
  unitLabel: S,
  sourceWallet: S,
  recipientSafe: S,
  chainId: N,
  amount: AssetAmount,
  rawAmount: S,
  tokenAddress: S,
  settlementId: S,
  /** `DocumentRefV3Schema`; too deep to transcribe. */
  instruction: U,
  createdAt: N,
});

/** `CheckoutTransactionSchema` (offer-schema.ts:157): an unsigned wallet transaction. */
const CheckoutTransaction = Schema.Struct({ from: S, to: S, data: S, value: Schema.Literal("0x0") });
const Allowance = Schema.Struct({ owner: S, token: S, spender: S, rawAmount: S });

/** `CheckoutReceiptSchema` (offer-schema.ts:194). */
const CheckoutReceipt = Schema.Struct({
  userOperation: opt(Schema.Struct({ hash: S, senderSafe: S })),
  settlementTransactionLogOrdinal: N,
  /** `TransferEvidenceSchema`; too deep to transcribe. */
  transfer: U,
  settlementLogIndex: N,
});

const Verification = Schema.Literals(["unpaid", "verified", "orphaned", "unavailable"]);

/** `CheckoutStateSchema` (offer-schema.ts:207). */
const CheckoutState = Schema.Struct({ verification: Verification, checkout: OfferCheckout, receipt: Schema.NullOr(CheckoutReceipt) });

/** A reconciliation: verified with its receipt, pending or provider_failure, or a mismatch with its code. */
const reconciliation = <St extends Schema.Top>(state: St) =>
  Schema.Union([
    Schema.Struct({ status: Schema.Literal("verified"), receipt: CheckoutReceipt, state }),
    Schema.Struct({ status: Schema.Literals(["pending", "provider_failure"]), state }),
    Schema.Struct({ status: Schema.Literal("mismatch"), code: S, state }),
  ]);

const LinkStatus = Schema.Literals(["sent", "pending_settlement", "paid", "cancelled", "declined", "expired", "unavailable"]);

/** `AssetInvoiceCheckoutSummarySchema` (checkout-schema.ts:38): a link's public terms. */
const AssetLinkSummary = Schema.Struct({
  documentKind: opt(Schema.Literals(["memo", "invoice"])),
  linkToken: S,
  issuerLabel: S,
  dueAt: N,
  documentHash: S,
  status: LinkStatus,
  amount: AssetAmount,
  chainId: N,
  tokenAddress: S,
  rawAmount: S,
  recipientSafe: S,
  contractAddress: S,
  settlementId: S,
  escrow: opt(Schema.Struct({ address: S, receivedRaw: opt(S), payoutTxHash: opt(S) })),
});

/** `MoneyInvoiceCheckoutSummarySchema` (checkout-schema.ts:60): a bank Invoice's terms. */
const MoneyLinkSummary = Schema.Struct({
  documentKind: Schema.Literal("invoice"),
  linkToken: S,
  issuerLabel: S,
  dueAt: N,
  documentHash: S,
  status: LinkStatus,
  amount: Schema.Struct({ currency: S, value: S, decimals: N }),
  bankPayment: Schema.Struct({ receivingAccountId: S, currency: S }),
});

const LinkSummary = Schema.Union([AssetLinkSummary, MoneyLinkSummary]);

/** `InvoiceCheckoutStateSchema` (checkout-schema.ts:82); the request rows name the summary `request`. */
const linkState = (key: "invoice" | "request") =>
  Schema.Struct({ [key]: AssetLinkSummary, verification: Verification, receipt: Schema.NullOr(CheckoutReceipt), latePayment: Schema.Boolean });

const linkPreparation = (key: "invoice" | "request") =>
  Schema.Struct({ [key]: AssetLinkSummary, sourceWallet: S, allowance: Allowance, approval: CheckoutTransaction, payment: CheckoutTransaction });

const Link = Schema.Struct({ linkToken: S });
const LinkFunding = Schema.Struct({ linkToken: S, sourceWallet: S });
const LinkReconciliation = Schema.Struct({ linkToken: S, transactionHash: S });

/** The fence every link record compares: what the verifying action read. */
const Fence = { linkToken: S, expectedPrior: Schema.NullOr(S), expectedConsumption: Schema.NullOr(S) };

// ── errors ─────────────────────────────────────────────────────────────────────────────────

/** `PUBLIC` and `DEFECTS` (operation-errors.ts:8, operation.ts:54): a link holder's call. */
const PUBLIC_ERRORS = [error_INVALID_INPUT, error_UNKNOWN, error_ENV_MISSING];
/** PUBLIC, DEFECTS and CHAIN (operation-errors.ts:20). */
const CHAIN_ERRORS = [...PUBLIC_ERRORS, error_PROVIDER_ERROR];
/** PUBLIC, DEFECTS, CHAIN and DISABLED (operation-errors.ts:23). */
const CHAIN_DISABLED_ERRORS = [...CHAIN_ERRORS, error_NOT_IMPLEMENTED];
/** `LINK_FAILURES` (checkouts/external/links.ts:74) and a defect. */
const LINK_FAILURES = [error_INVALID_INPUT, error_NOT_IMPLEMENTED, error_UNKNOWN];

// ── shared touches ─────────────────────────────────────────────────────────────────────────

/**
 * `invoicePublicSummary` (reads/checkouts.ts:88): the link's frozen document (`requestCheckoutDocument`, a v4
 * escrow's settlement, the Invoice settlement identity read from Payments' `payments` directly), the issuer label
 * from Parties, and the status, following the funding Payment (`invoiceReceiptStillPaid`, reading Payments'
 * `payments` and `paymentCommands` directly).
 */
const LINK_SUMMARY = {
  reads: [table_payment_requests, table_payments, table_payment_commands, table_invoice_checkout_payments],
  invokes: [procedure_parties_party_by_safe_address],
  was: [
    `${R}/reads/checkouts.ts:53`,
    `${R}/reads/checkouts.ts:88`,
    `${R}/reads/escrows.ts:82`,
    `${R}/reads/invoices.ts:32`,
    `${R}/reads/invoices.ts:146`,
    `${R}/rules/invoices.ts:121`,
  ],
};

/** `projectReceiptMovement` and `orphanOldMovement` (writes/receipts.ts:117, :152): a verified receipt's Movement Memo. */
const PROJECT_MOVEMENT = {
  reads: [table_financial_document_movements],
  writes: [table_financial_document_movements],
  invokes: [
    procedure_payments_actor_inventory,
    procedure_documents_prepare_movement_memo_in_tx,
    procedure_documents_link_movement_document_in_tx,
  ],
  was: [`${R}/writes/receipts.ts:117`, `${R}/writes/receipts.ts:152`, `${R}/writes/receipts.ts:161`],
};

/** The chain reads a request link's check makes (external/requests.ts). */
const LINK_CHECK_CALLS = [
  integration_chain_rpc.c.fetchBoundedBlock,
  integration_chain_rpc.c.fetchBoundedTransaction,
  integration_chain_evidence.c.verifyPayment,
  integration_chain_evidence.c.verifyCheckoutPayment,
  integration_chain_evidence.c.checkoutReceiptOccurrence,
];
const LINK_CHECK_WAS = [
  `${R}/external/evidence.ts:11`,
  `${R}/external/evidence.ts:17`,
  `${R}/external/requests.ts:30`,
  `${R}/external/requests.ts:62`,
  `${R}/external/requests.ts:118`,
  `${R}/external/requests.ts:184`,
  `${R}/external/requests.ts:190`,
  `${R}/external/requests.ts:204`,
  `${R}/external/requests.ts:234`,
  `${R}/external/requests.ts:243`,
];

/** The chain reads an Offer purchase's check makes (external/purchases.ts). */
const PURCHASE_CHECK_CALLS = [
  integration_chain_evidence.c.verifyPayment,
  integration_chain_evidence.c.verifyCheckoutPayment,
  integration_chain_evidence.c.checkoutReceiptOccurrence,
];
const PURCHASE_CHECK_WAS = [`${R}/external/purchases.ts:15`, `${R}/external/purchases.ts:21`, `${R}/external/purchases.ts:50`];

const ALL_VERIFICATIONS = [
  machine_invoice_receipt.t.to_unpaid,
  machine_invoice_receipt.t.to_verified,
  machine_invoice_receipt.t.to_orphaned,
  machine_invoice_receipt.t.to_unavailable,
];

// ── internal: the verifying actions' reads ─────────────────────────────────────────────────

export const rpc_requests_checkouts_load_offer = defineRpc({
  id: "requests.checkouts.load-offer",
  title: "Load a purchase for its chain check",
  about:
    "The internal query `requests/checkouts:loadOffer`: the frozen purchase, its saved receipt, and for a registered Payment " +
    "the facts its UserOperation must prove, from the Payment and command read in Payments' `payments` and " +
    "`paymentCommands` directly (`expectedFactsForItem`, a payments rule). Null for an id over 128 characters or none. A " +
    "snapshot, receipt or prepared command that does not decode is UNKNOWN.",
  was: [`${CONVEX}:9`, `${OPS}/load-offer.ts:9`, `${AREA}/reads.ts:45`, `${R}/reads/purchases.ts:128`, `${R}/reads/invoices.ts:96`, `${R}/reads/invoices.ts:113`],
  concept: concept_requests,
  kind: "query",
  who: "internal: run by requests.checkouts.state and requests.checkouts.reconcile in the same call.",
  input: Schema.Struct({ checkoutId: S }),
  output: Schema.NullOr(Schema.Struct({ checkout: OfferCheckout, receipt: Schema.NullOr(CheckoutReceipt), registered: opt(Schema.Boolean), expected: opt(U) })),
  errors: [error_UNKNOWN],
  reads: [table_offer_checkouts, table_payments, table_payment_commands],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_requests_checkouts_load_request = defineRpc({
  id: "requests.checkouts.load-request",
  title: "Load a request link for its chain check",
  about:
    "The internal query `requests/checkouts:loadRequest`: the link's row (null for a malformed or unknown token), its public " +
    "terms, its saved receipt, every funding Payment's expected send facts (each attempt's and the approval's Payment and " +
    "command, read from Payments' tables directly; a dated budget Payment instead counts as settled by its indexed fact), " +
    "and whether the receipt's own Payment settled. A Money request is INVALID_INPUT; a stored row that does not decode is " +
    "UNKNOWN.",
  was: [
    `${CONVEX}:10`,
    `${OPS}/load-request.ts:9`,
    `${AREA}/reads.ts:99`,
    `${R}/reads/checkouts.ts:252`,
    `${R}/reads/fundings.ts:18`,
    ...LINK_SUMMARY.was,
  ],
  concept: concept_requests,
  kind: "query",
  who: "internal: run by the request and Invoice state and reconcile actions, and the escrow sweep, in the same call.",
  input: Link,
  output: Schema.NullOr(U),
  errors: LINK_FAILURES,
  reads: LINK_SUMMARY.reads,
  writes: [],
  drives: [],
  invokes: LINK_SUMMARY.invokes,
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_requests_checkouts_is_invoice = defineRpc({
  id: "requests.checkouts.is-invoice",
  title: "Whether a link names an issued Invoice",
  about: "The internal query `requests/checkouts:isInvoice`: true when the link's request carries an Invoice. The Invoice actions are guarded by it.",
  was: [`${CONVEX}:8`, `${OPS}/is-invoice.ts:9`, `${AREA}/reads.ts:52`, `${R}/reads/invoices.ts:20`, `${R}/reads/requests.ts:38`],
  concept: concept_requests,
  kind: "query",
  who: "internal: run by requests.checkouts.invoice-state and reconcile-invoice through `namesInvoice`.",
  input: Link,
  output: Schema.Boolean,
  errors: [error_UNKNOWN],
  reads: [table_payment_requests],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_requests_checkouts_final_links = defineRpc({
  id: "requests.checkouts.final-links",
  title: "Which links hold a finalized receipt",
  about:
    "The internal query `requests/checkouts:finalLinks`: of the given links, those whose verified receipt was stamped final " +
    "(`invoiceReceiptFinalJson` equals the receipt). A current read checks only the others on chain.",
  was: [`${CONVEX}:4`, `${OPS}/final-links.ts:9`, `${AREA}/reads.ts:59`, `${R}/external/currents.ts:32`],
  concept: concept_requests,
  kind: "query",
  who: "internal: run by every current read (`refreshCheckouts`) of receivables and inboxes.",
  input: Schema.Struct({ linkTokens: Schema.Array(S) }),
  output: Schema.Array(S),
  errors: [error_UNKNOWN],
  reads: [table_payment_requests],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_requests_checkouts_waiting_escrows = defineRpc({
  id: "requests.checkouts.waiting-escrows",
  title: "The escrows the sweep still watches",
  about:
    "The internal query `requests/checkouts:waitingEscrows`: the 25 least recently read `waiting` escrows, each with its exact " +
    "terms read back from the row (an Invoice's issuer Safe and document, or a basic request's Memo), checked against the " +
    "stored address its factory fixed (CREATE2; a v4 escrow's with the v4 EscrowFactory, which needs the v4 deployment " +
    "settings). Each says whether the request is still open (sent, no receipt, unexpired) or cancelled with no receipt. A " +
    "row whose terms or address do not check is UNKNOWN, which fails the whole page.",
  was: [`${CONVEX}:28`, `${OPS}/waiting-escrows.ts:8`, `${AREA}/reads.ts:108`, `${R}/reads/waiting-escrows.ts:16`, `${R}/reads/waiting-escrows.ts:26`, `${R}/reads/escrows.ts:49`],
  concept: concept_requests,
  kind: "query",
  who: "internal: run by the escrow sweep, requests.checkouts.pay-escrows.",
  input: Schema.Struct({}),
  output: Schema.Array(U),
  errors: [error_UNKNOWN],
  reads: [table_payment_requests],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

// ── internal: the verifying actions' fenced records ────────────────────────────────────────

export const rpc_requests_checkouts_record_offer = defineRpc({
  id: "requests.checkouts.record-offer",
  title: "Record a purchase's proved receipt once",
  about:
    "The internal mutation `requests/checkouts:recordOffer`. The proved receipt must decode (UNKNOWN otherwise) and pay the " +
    "frozen purchase (INVALID_INPUT): a registered purchase only through its own Payment's UserOperation and sender Safe, read " +
    "from Payments' tables directly; a direct one with no UserOperation. The same receipt replays; one different from the " +
    "expected prior is INVALID_INPUT; replacing a recorded receipt needs the same logical receipt and a proved replaced block, " +
    "keeps the old one in `receiptHistoryJson` and orphans its Movement occurrence. Then projects the Movement's Memo. An " +
    "asset the configuration does not know is INVALID_INPUT.",
  was: [
    `${CONVEX}:22`,
    `${OPS}/record-offer.ts:9`,
    `${AREA}/writes.ts:51`,
    `${R}/writes/purchase-receipts.ts:49`,
    `${R}/writes/purchase-receipts.ts:78`,
    `${R}/writes/purchase-receipts.ts:106`,
    ...PROJECT_MOVEMENT.was,
  ],
  concept: concept_requests,
  kind: "mutation",
  who: "internal: run by requests.checkouts.reconcile once a funding transaction verified.",
  input: Schema.Struct({ checkoutId: S, receiptJson: S, expectedPriorReceiptJson: Schema.NullOr(S), replacedBlockHash: opt(S) }),
  output: CheckoutReceipt,
  errors: LINK_FAILURES,
  reads: union([table_offer_checkouts, table_payments, table_payment_commands], PROJECT_MOVEMENT.reads),
  writes: union([table_offer_checkouts], PROJECT_MOVEMENT.writes),
  drives: [],
  invokes: PROJECT_MOVEMENT.invokes,
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_requests_checkouts_record_request = defineRpc({
  id: "requests.checkouts.record-request",
  title: "Record a request link's proved receipt once",
  about:
    "The internal mutation `requests/checkouts:recordRequest`. The proved receipt must decode (UNKNOWN) and pay the link's " +
    "frozen terms: chain, recipient Safe, token and raw amount (INVALID_INPUT). The same receipt only re-marks verified. A " +
    "different prior than expected is INVALID_INPUT; replacing a recorded receipt needs a proved replaced block, keeps the " +
    "old one in `invoiceReceiptHistoryJson` and orphans its Movement occurrence. Records the settlement id, the receipt and " +
    "verified, clears a consumption, and projects the Movement's Memo with the request's instruction. Writes no status: a " +
    "link-paid request stays as it was and reads paid.",
  was: [
    `${CONVEX}:23`,
    `${OPS}/record-request.ts:9`,
    `${AREA}/writes.ts:65`,
    `${R}/writes/receipts.ts:165`,
    `${R}/writes/receipts.ts:190`,
    `${R}/writes/receipts.ts:213`,
    ...LINK_SUMMARY.was,
    ...PROJECT_MOVEMENT.was,
  ],
  concept: concept_requests,
  kind: "mutation",
  who: "internal: run by the request and Invoice state and reconcile actions and the escrow sweep once a receipt is proved.",
  input: Schema.Struct({ linkToken: S, receiptJson: S, expectedPrior: Schema.NullOr(S), replacedBlockHash: opt(S) }),
  output: CheckoutReceipt,
  errors: LINK_FAILURES,
  reads: union(LINK_SUMMARY.reads, PROJECT_MOVEMENT.reads),
  writes: union([table_payment_requests], PROJECT_MOVEMENT.writes),
  drives: [machine_invoice_receipt.t.to_verified],
  invokes: union(LINK_SUMMARY.invokes, PROJECT_MOVEMENT.invokes),
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_requests_checkouts_record_verification = defineRpc({
  id: "requests.checkouts.record-verification",
  title: "Record what a link's chain check found",
  about:
    "The internal mutation `requests/checkouts:recordVerification`, fenced: false when the row no longer holds the receipt " +
    "and consumption the action read. Writes the verification only when it changed, when a verified receipt sits in a " +
    "finalized block (`invoiceReceiptFinalJson`), or when a consumption whose block was replaced is cleared.",
  was: [`${CONVEX}:24`, `${OPS}/record-verification.ts:9`, `${AREA}/writes.ts:79`, `${R}/writes/receipts.ts:47`, `${R}/writes/receipts.ts:85`, `${R}/writes/receipts.ts:108`],
  concept: concept_requests,
  kind: "mutation",
  who: "internal: run by the request and Invoice state and reconcile actions after each check.",
  input: Schema.Struct({ ...Fence, clearConsumption: opt(Schema.Boolean), final: opt(Schema.Boolean), verification: Verification }),
  output: Schema.Boolean,
  errors: [error_UNKNOWN],
  reads: [table_payment_requests],
  writes: [table_payment_requests],
  drives: ALL_VERIFICATIONS,
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_requests_checkouts_record_consumption = defineRpc({
  id: "requests.checkouts.record-consumption",
  title: "Record a link funding consumed under wrong terms",
  about:
    "The internal mutation `requests/checkouts:recordConsumption`, fenced like recordVerification: stores the transaction, " +
    "block number and hash that consumed the link's settlement under wrong payment terms, and marks the link unavailable " +
    "until a later check proves that block replaced.",
  was: [`${CONVEX}:20`, `${OPS}/record-consumption.ts:9`, `${AREA}/writes.ts:92`, `${R}/writes/receipts.ts:66`, `${R}/writes/receipts.ts:77`],
  concept: concept_requests,
  kind: "mutation",
  who: "internal: run by the request and Invoice reconcile actions when a transaction is a `wrong_payment_terms` mismatch.",
  input: Schema.Struct({ ...Fence, consumption: Schema.Struct({ transactionHash: S, blockNumber: N, blockHash: S }) }),
  output: Schema.Boolean,
  errors: [error_UNKNOWN],
  reads: [table_payment_requests],
  writes: [table_payment_requests],
  drives: [machine_invoice_receipt.t.to_unavailable],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_requests_checkouts_record_escrow = defineRpc({
  id: "requests.checkouts.record-escrow",
  title: "Record one sweep read of a request's escrow",
  about:
    "The internal mutation `requests/checkouts:recordEscrow`. Only a `waiting` escrow is written: its checked time (which " +
    "moves it to the back of the queue), the balance read, the payout transaction, and closed when asked. A paid close " +
    "schedules `requests.receivables.notify` `paid`; more arriving below the amount schedules `part_received` with the " +
    "balance. A closed escrow is never reopened.",
  was: [`${CONVEX}:21`, `${OPS}/record-escrow.ts:9`, `${AREA}/writes.ts:104`, `${R}/writes/escrows.ts:48`, `${R}/writes/escrows.ts:58`, `${R}/writes/escrows.ts:74`, `${R}/writes/notices.ts:29`],
  concept: concept_requests,
  kind: "mutation",
  who: "internal: run by the escrow sweep, requests.checkouts.pay-escrows.",
  input: Schema.Struct({ paymentRequestId: S, receivedRaw: opt(S), payoutTx: opt(S), close: opt(Schema.Boolean), paid: opt(Schema.Boolean) }),
  output: Schema.Null,
  errors: [error_UNKNOWN],
  reads: [table_payment_requests],
  writes: [table_payment_requests],
  drives: [machine_invoice_escrow.t.to_closed],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

// ── action touches, folded from the internal rpcs they run ─────────────────────────────────

/** `checkedLink` (checkouts/external/links.ts:104): load, check, then record the first proved receipt or the verification. */
const CHECKED_LINK = {
  reads: union(rpc_requests_checkouts_load_request.reads, rpc_requests_checkouts_record_request.reads, rpc_requests_checkouts_record_verification.reads),
  writes: union(rpc_requests_checkouts_record_request.writes, rpc_requests_checkouts_record_verification.writes),
  drives: union(rpc_requests_checkouts_record_request.drives, rpc_requests_checkouts_record_verification.drives),
  invokes: union(rpc_requests_checkouts_load_request.invokes, rpc_requests_checkouts_record_request.invokes),
  was: [`${AREA}/external/links.ts:84`, `${AREA}/external/links.ts:104`, ...LINK_CHECK_WAS],
};

/** `reconciledLink` (checkouts/external/links.ts:134): load, check, verify one transaction, record. */
const RECONCILED_LINK = {
  reads: union(CHECKED_LINK.reads, rpc_requests_checkouts_record_consumption.reads),
  writes: union(CHECKED_LINK.writes, rpc_requests_checkouts_record_consumption.writes),
  drives: union(CHECKED_LINK.drives, rpc_requests_checkouts_record_consumption.drives),
  invokes: CHECKED_LINK.invokes,
  was: [`${AREA}/external/links.ts:97`, `${AREA}/external/links.ts:134`, `${AREA}/external/links.ts:192`, ...LINK_CHECK_WAS],
};

// ── public rows: Offer purchases ───────────────────────────────────────────────────────────

export const rpc_requests_checkouts_offer = defineRpc({
  id: "requests.checkouts.offer",
  title: "An active Offer's public terms",
  about:
    "Row `requests.checkouts.offer`, registered as `requests/checkouts:offer`. No session. An active Offer at its current " +
    "revision; null for an id over 128 characters, an unknown or an inactive Offer. Creates no purchase.",
  was: [`${CONVEX}:11`, `${OPS}/offer.ts:8`, `${ROWS}:181`, `${AREA}/reads.ts:24`, `${R}/reads/offers.ts:84`, `${R}/reads/offers.ts:67`],
  concept: concept_requests,
  kind: "query",
  who: "Anyone holding the Offer's link; no session.",
  input: Schema.Struct({ offerId: S }),
  output: Schema.NullOr(U),
  errors: PUBLIC_ERRORS,
  reads: [table_fixed_offers, table_fixed_offer_revisions],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_requests_checkouts_create = defineRpc({
  id: "requests.checkouts.create",
  title: "Freeze one wallet's purchase of an Offer revision",
  about:
    "Row `requests.checkouts.create`, registered as `requests/checkouts:create`. No session. The purchase key must be a UUID " +
    "v4 and the wallet nonzero (INVALID_INPUT). A repeat of the key with the same request replays the stored purchase; with " +
    "different terms it is INVALID_INPUT. A new purchase is refused RATE_LIMITED (retry after 60 s) when the wallet started 10 " +
    "or the Offer 100 in the last minute; the Offer must be active (INVALID_INPUT `service is unavailable`), at the revision " +
    "named (`service price changed`) and the quantity in range. It freezes the total, a Memo envelope (title, quantity and " +
    "unit) stored through Documents, the V3 settlement id on the current router (purchase job nonce, executor zero), and the " +
    "snapshot, then inserts the purchase. A broken revision row is UNKNOWN.",
  was: [
    `${CONVEX}:3`,
    `${OPS}/create.ts:8`,
    `${ROWS}:188`,
    `${AREA}/writes.ts:26`,
    `${R}/writes/purchases.ts:60`,
    `${R}/writes/purchases.ts:78`,
    `${R}/writes/purchases.ts:147`,
    `${R}/writes/purchases.ts:191`,
    `${R}/errors/offers.ts:32`,
    `${R}/rules/settlements.ts:41`,
  ],
  concept: concept_requests,
  kind: "mutation",
  who: "Anyone holding the Offer's link, for the wallet that will fund it; no session.",
  input: Schema.Struct({ offerId: S, revision: N, quantity: N, sourceWallet: S, requestKey: S }),
  output: OfferCheckout,
  errors: [...PUBLIC_ERRORS, error_RATE_LIMITED],
  reads: [table_offer_checkouts, table_fixed_offers, table_fixed_offer_revisions],
  writes: [table_offer_checkouts],
  drives: [],
  invokes: [procedure_documents_persist_payment_document],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_requests_checkouts_get = defineRpc({
  id: "requests.checkouts.get",
  title: "A frozen Offer purchase",
  about: "Row `requests.checkouts.get`, registered as `requests/checkouts:get`. No session. The stored snapshot, or null; a snapshot that does not decode is UNKNOWN.",
  was: [`${CONVEX}:5`, `${OPS}/get.ts:7`, `${ROWS}:201`, `${AREA}/reads.ts:31`, `${R}/reads/purchases.ts:60`],
  concept: concept_requests,
  kind: "query",
  who: "Anyone holding the checkout id; no session.",
  input: Schema.Struct({ checkoutId: S }),
  output: Schema.NullOr(OfferCheckout),
  errors: PUBLIC_ERRORS,
  reads: [table_offer_checkouts],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_requests_checkouts_prepare = defineRpc({
  id: "requests.checkouts.prepare",
  title: "The unsigned transactions that pay a frozen purchase",
  about:
    "Row `requests.checkouts.prepare`, registered as `requests/checkouts:prepare`. No session. Only the frozen wallet may " +
    "prepare (INVALID_INPUT `funding wallet differs from frozen checkout`); a purchase frozen for another router or settlement " +
    "id is INVALID_INPUT `checkout is unavailable`. Returns the allowance and two unsigned transactions the payer's own wallet " +
    "signs and sends: ERC-20 `approve` of the router for the total, and the V3 router's `send` of the obligation. It calls " +
    "nothing on chain itself.",
  was: [`${CONVEX}:13`, `${OPS}/prepare.ts:8`, `${ROWS}:208`, `${AREA}/reads.ts:38`, `${R}/reads/purchases.ts:67`, `${R}/rules/settlements.ts:46`],
  concept: concept_requests,
  kind: "query",
  who: "Anyone holding the checkout id, for the frozen funding wallet; no session.",
  input: Schema.Struct({ checkoutId: S, sourceWallet: S }),
  output: Schema.Struct({ checkout: OfferCheckout, allowance: Allowance, approval: CheckoutTransaction, payment: CheckoutTransaction }),
  errors: PUBLIC_ERRORS,
  reads: [table_offer_checkouts],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_requests_checkouts_state = defineRpc({
  id: "requests.checkouts.state",
  title: "A purchase's saved receipt, checked on chain now",
  about:
    "Row `requests.checkouts.state`, registered as `requests/checkouts:state`. No session. Loads the purchase in its own query " +
    "(`load-offer`); with no receipt it is unpaid; else the receipt's occurrence is checked (orphaned, unavailable) and the " +
    "funding verified again (a registered Payment against its facts, a direct one against the frozen terms), verified only " +
    "when the proof equals the saved receipt. Writes nothing; null when there is no purchase. A chain read that fails is the " +
    "`unavailable` verdict or `provider_failure`, never an error.",
  was: [`${CONVEX}:27`, `${OPS}/state.ts:9`, `${ROWS}:215`, `${AREA}/external/purchases.ts:40`, `${AREA}/external/purchases.ts:47`, ...PURCHASE_CHECK_WAS],
  concept: concept_requests,
  kind: "action",
  who: "Anyone holding the checkout id; no session.",
  input: Schema.Struct({ checkoutId: S }),
  output: Schema.NullOr(CheckoutState),
  errors: CHAIN_ERRORS,
  reads: rpc_requests_checkouts_load_offer.reads,
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: PURCHASE_CHECK_CALLS,
  chain: [],
  spans: [],
});

export const rpc_requests_checkouts_reconcile = defineRpc({
  id: "requests.checkouts.reconcile",
  title: "Verify one funding transaction for a purchase and record it",
  about:
    "Row `requests.checkouts.reconcile`, registered as `requests/checkouts:reconcile`. No session. Loads the purchase " +
    "(INVALID_INPUT `checkout is unavailable` when none), checks its state, verifies the transaction (a registered Payment " +
    "against its facts and only that transaction; a direct one against the frozen terms). Not verified: answers the status " +
    "with the state. A verified receipt that differs from a saved one that is not orphaned (or not the same logical receipt) " +
    "answers `mismatch` `conflicting_receipt`. Otherwise records it through `record-offer` (fenced) and answers verified.",
  was: [`${CONVEX}:17`, `${OPS}/reconcile.ts:9`, `${ROWS}:222`, `${AREA}/external/purchases.ts:56`, ...PURCHASE_CHECK_WAS],
  concept: concept_requests,
  kind: "action",
  who: "Anyone holding the checkout id and a funding transaction hash; no session.",
  input: Schema.Struct({ checkoutId: S, transactionHash: S }),
  output: reconciliation(CheckoutState),
  errors: CHAIN_DISABLED_ERRORS,
  reads: union(rpc_requests_checkouts_load_offer.reads, rpc_requests_checkouts_record_offer.reads),
  writes: rpc_requests_checkouts_record_offer.writes,
  drives: [],
  invokes: rpc_requests_checkouts_record_offer.invokes,
  emits: [],
  calls: PURCHASE_CHECK_CALLS,
  chain: [],
  spans: [],
});

// ── public rows: request and Invoice links ─────────────────────────────────────────────────

export const rpc_requests_checkouts_request = defineRpc({
  id: "requests.checkouts.request",
  title: "A request link's public terms",
  about:
    "Row `requests.checkouts.request`, registered as `requests/checkouts:request`. No session. The link's public terms naming " +
    "its document kind (memo or invoice), never the private document; null when the link names no request with a frozen " +
    "Invoice or Memo. The status follows the funding Payment and the receipt verification as stored; nothing is checked on " +
    "chain. A broken stored document is UNKNOWN.",
  was: [`${CONVEX}:25`, `${OPS}/request.ts:10`, `${ROWS}:229`, `${AREA}/reads.ts:83`, `${AREA}/views.ts:33`, `${R}/reads/checkouts.ts:169`, ...LINK_SUMMARY.was],
  concept: concept_requests,
  kind: "query",
  who: "Anyone holding the request link; no session.",
  input: Link,
  output: Schema.NullOr(LinkSummary),
  errors: PUBLIC_ERRORS,
  reads: LINK_SUMMARY.reads,
  writes: [],
  drives: [],
  invokes: LINK_SUMMARY.invokes,
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_requests_checkouts_prepare_request = defineRpc({
  id: "requests.checkouts.prepare-request",
  title: "Freeze an unaddressed request for this wallet, then its unsigned transactions",
  about:
    "Row `requests.checkouts.prepareRequest`, registered as `requests/checkouts:prepareRequest`: the one public write. No " +
    "session. An unknown link is INVALID_INPUT `request is unavailable`. A request with no frozen document yet freezes its Memo " +
    "for the wallet that first prepares it (a zero wallet is INVALID_INPUT; one approved before Memos were frozen at issuance " +
    "is INVALID_INPUT `request has no frozen instruction`): the payer resolved by address or by its named Party, the Memo " +
    "stored through Documents, and on v4 for an email payer the escrow fields. Then, as prepare-invoice, the unsigned approve " +
    "and V3 `send` for an open link: an escrow request is INVALID_INPUT (it is paid only by a transfer into its escrow), a " +
    "link not sent or pending_settlement is INVALID_INPUT, and an identity frozen before V3 is INVALID_INPUT.",
  was: [
    `${CONVEX}:15`,
    `${OPS}/prepare-request.ts:11`,
    `${ROWS}:236`,
    `${AREA}/writes.ts:35`,
    `${AREA}/reads.ts:90`,
    `${R}/writes/checkouts.ts:51`,
    `${R}/writes/checkouts.ts:82`,
    `${R}/writes/memos.ts:31`,
    `${R}/writes/escrows.ts:20`,
    `${R}/reads/checkouts.ts:161`,
    `${R}/reads/checkouts.ts:181`,
    ...LINK_SUMMARY.was,
  ],
  concept: concept_requests,
  kind: "mutation",
  who: "Anyone holding the request link, for the wallet that will fund it; no session.",
  input: LinkFunding,
  output: linkPreparation("request"),
  errors: PUBLIC_ERRORS,
  reads: LINK_SUMMARY.reads,
  writes: [table_payment_requests],
  drives: [],
  invokes: union(LINK_SUMMARY.invokes, [
    procedure_parties_resolve_recipient_in_tx,
    procedure_access_read_scope_safe_address_in_tx,
    procedure_accounts_require_payment_account_in_tx,
    procedure_documents_persist_payment_document,
  ]),
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_requests_checkouts_request_state = defineRpc({
  id: "requests.checkouts.request-state",
  title: "A request link's saved receipt, checked on chain now",
  about:
    "Row `requests.checkouts.requestState`, registered as `requests/checkouts:requestState`. No session. Loads the link in its " +
    "own query (`load-request`), reads the finalized head (1 s), then checks within 3 s (a check that passes it is " +
    "`unavailable`): with no receipt, a privately approved request bootstraps one from its settled Payment's proof (a dated " +
    "budget Payment counts as paid), and a recorded consumption is cleared once its block is proved replaced; with a receipt, " +
    "its occurrence and funding are checked again, verified only when the proof equals it and its own Payment settled. The " +
    "first proved receipt is recorded through `record-request`; otherwise the verification is recorded (fenced, " +
    "`record-verification`; a lost fence answers unavailable). A receipt in a finalized block is stamped final. Null when " +
    "there is no link.",
  was: [`${CONVEX}:26`, `${OPS}/request-state.ts:11`, `${ROWS}:243`, `${AREA}/views.ts:50`, ...CHECKED_LINK.was],
  concept: concept_requests,
  kind: "action",
  who: "Anyone holding the request link; no session. Every current read of receivables and inboxes runs it for a request.",
  input: Link,
  output: Schema.NullOr(linkState("request")),
  errors: CHAIN_DISABLED_ERRORS,
  reads: CHECKED_LINK.reads,
  writes: CHECKED_LINK.writes,
  drives: CHECKED_LINK.drives,
  invokes: CHECKED_LINK.invokes,
  emits: [],
  calls: LINK_CHECK_CALLS,
  chain: [],
  spans: [],
});

export const rpc_requests_checkouts_reconcile_request = defineRpc({
  id: "requests.checkouts.reconcile-request",
  title: "Verify one funding transaction for a request link and record it",
  about:
    "Row `requests.checkouts.reconcileRequest`, registered as `requests/checkouts:reconcileRequest`. No session. An unknown " +
    "link is INVALID_INPUT `Invoice is unavailable`. Checks the link's state and records it (fenced), then verifies the " +
    "transaction: a registered Payment's expected facts first, else the frozen terms from the transaction's sender, and for " +
    "an escrow request the escrow's payout inside a relayed transaction. A `wrong_payment_terms` mismatch on a link with no " +
    "receipt records the consumption (the link reads unavailable). A verified receipt that conflicts with a saved one that is " +
    "not orphaned answers `mismatch` `conflicting_receipt`; otherwise it is recorded through `record-request` and answers " +
    "verified, with `latePayment` when the request had expired, been cancelled or declined.",
  was: [`${CONVEX}:19`, `${OPS}/reconcile-request.ts:11`, `${ROWS}:250`, `${AREA}/views.ts:55`, ...RECONCILED_LINK.was],
  concept: concept_requests,
  kind: "action",
  who: "Anyone holding the request link and a funding transaction hash; no session.",
  input: LinkReconciliation,
  output: reconciliation(linkState("request")),
  errors: CHAIN_DISABLED_ERRORS,
  reads: RECONCILED_LINK.reads,
  writes: RECONCILED_LINK.writes,
  drives: RECONCILED_LINK.drives,
  invokes: RECONCILED_LINK.invokes,
  emits: [],
  calls: LINK_CHECK_CALLS,
  chain: [],
  spans: [],
});

/** Payments' Invoice checkout engine, which this request row runs with `request` (payments/commands.ts books it). */
const ENGINE = rpc_payments_commands_prepare_invoice_checkout;

export const rpc_requests_checkouts_prepare_request_registered = defineRpc({
  id: "requests.checkouts.prepare-request-registered",
  title: "A registered payer's sponsored Payment for a request link",
  about:
    "Row `requests.checkouts.prepareRequestRegistered`, registered as `requests/checkouts:prepareRequestRegistered`. It is " +
    "Payments' `checkoutPrepared(input, \"request\")` (payments/commands/external/builds.ts:83), the engine " +
    "payments.commands.prepare-invoice-checkout runs with `invoice`: signed in, `payerFunded` on the link's frozen terms " +
    "(#2403), the internal mutation payments.commands.prepare-request-checkout-intent (Requests' " +
    "`prepareRegisteredRequestInTx` births the Payment, calling back payments' `preparePaymentCommandInTx`), then " +
    "`builtExecution` (Roles module and budget allowance gates, linkObservation, build or reuse, store). Requests owns only " +
    "the frozen terms and the reply's `request` summary (UNKNOWN when it does not match its wire shape). Touches, outside " +
    "calls and chain functions are the engine's as payments books them, with the request preparation in place of the " +
    "Invoice's.",
  was: [
    `${CONVEX}:16`,
    `${OPS}/prepare-request-registered.ts:13`,
    `${OPS}/prepare-request-registered.ts:16`,
    `${ROWS}:257`,
    `${AREA}/views.ts:39`,
    `${BACKEND}/src/payments/commands/external/builds.ts:83`,
    `${BACKEND}/src/payments/commands/writes/transactions.ts:86`,
  ],
  concept: concept_requests,
  kind: "action",
  who: "A signed-in, registered payer of a request link (its Account, or an Organization under a Permission), signing with its own signer.",
  input: Schema.Struct({ linkToken: S, payer: U, permissionId: opt(S), signerAddress: S }),
  output: Schema.Struct({
    executionId: S,
    commandId: S,
    paymentIds: Schema.Array(S),
    chainId: N,
    signerAddress: S,
    userOpSenderSafe: S,
    digest: S,
    /** `PersonalUnsignedUserOperationSchema` and the prepared command's public fields; too deep to transcribe. */
    userOperation: U,
    preparedCommand: U,
    request: AssetLinkSummary,
  }),
  errors: [
    error_NOT_AUTHENTICATED,
    error_INVALID_INPUT,
    error_UNKNOWN,
    error_ENV_MISSING,
    error_ROLE_PERMISSION_DENIED,
    error_WRONG_STATE,
    error_PROVIDER_ERROR,
    error_PROVIDER_RESPONSE_INVALID,
    error_INSUFFICIENT_BALANCE,
    error_NOT_IMPLEMENTED,
  ],
  reads: ENGINE.reads,
  writes: ENGINE.writes,
  drives: ENGINE.drives,
  invokes: [
    ...ENGINE.invokes.filter((p) => p.id !== procedure_requests_prepare_registered_invoice_in_tx.id),
    procedure_requests_prepare_registered_request_in_tx,
  ],
  emits: ENGINE.emits,
  calls: ENGINE.calls,
  chain: ENGINE.chain,
  spans: ENGINE.spans,
});

export const rpc_requests_checkouts_invoice = defineRpc({
  id: "requests.checkouts.invoice",
  title: "An Invoice link's public terms",
  about:
    "Row `requests.checkouts.invoice`, registered as `requests/checkouts:invoice`. No session. Null unless the link's request " +
    "carries an Invoice; then the same public terms as the request row (a Money Invoice's carry its bank payment), with no " +
    "document kind for an asset Invoice.",
  was: [`${CONVEX}:6`, `${OPS}/invoice.ts:9`, `${ROWS}:264`, `${AREA}/reads.ts:52`, `${AREA}/reads.ts:83`, ...LINK_SUMMARY.was],
  concept: concept_requests,
  kind: "query",
  who: "Anyone holding the Invoice link; no session.",
  input: Link,
  output: Schema.NullOr(LinkSummary),
  errors: PUBLIC_ERRORS,
  reads: LINK_SUMMARY.reads,
  writes: [],
  drives: [],
  invokes: LINK_SUMMARY.invokes,
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_requests_checkouts_prepare_invoice = defineRpc({
  id: "requests.checkouts.prepare-invoice",
  title: "The unsigned transactions that fund an open Invoice",
  about:
    "Row `requests.checkouts.prepareInvoice`, registered as `requests/checkouts:prepareInvoice`. No session. A link that names " +
    "no Invoice is INVALID_INPUT `Invoice is unavailable`. Then the open-link checks (an escrow Invoice is INVALID_INPUT and " +
    "names its escrow; a link not sent or pending_settlement is INVALID_INPUT `Invoice is not open for new funding " +
    "preparation`), a nonzero wallet, and the V3 identity check, and returns the allowance, the ERC-20 `approve` and the V3 " +
    "router's `send` for the payer's own wallet. A Money Invoice is INVALID_INPUT `Pay this Invoice by bank transfer.`.",
  was: [`${CONVEX}:14`, `${OPS}/prepare-invoice.ts:9`, `${ROWS}:271`, `${AREA}/reads.ts:76`, `${AREA}/reads.ts:90`, `${R}/reads/checkouts.ts:161`, `${R}/reads/checkouts.ts:181`, ...LINK_SUMMARY.was],
  concept: concept_requests,
  kind: "query",
  who: "Anyone holding the Invoice link, for the wallet that will fund it; no session.",
  input: LinkFunding,
  output: linkPreparation("invoice"),
  errors: PUBLIC_ERRORS,
  reads: LINK_SUMMARY.reads,
  writes: [],
  drives: [],
  invokes: LINK_SUMMARY.invokes,
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_requests_checkouts_invoice_state = defineRpc({
  id: "requests.checkouts.invoice-state",
  title: "An Invoice link's saved receipt, checked on chain now",
  about:
    "Row `requests.checkouts.invoiceState`, registered as `requests/checkouts:invoiceState`. No session. Null unless the link " +
    "names an Invoice (`is-invoice`, in its own query); then exactly the request link's check and record (request-state).",
  was: [`${CONVEX}:7`, `${OPS}/invoice-state.ts:11`, `${ROWS}:278`, `${AREA}/external/links.ts:77`, `${AREA}/views.ts:62`, ...CHECKED_LINK.was],
  concept: concept_requests,
  kind: "action",
  who: "Anyone holding the Invoice link; no session. Every current read of receivables and inboxes runs it for an Invoice.",
  input: Link,
  output: Schema.NullOr(linkState("invoice")),
  errors: CHAIN_DISABLED_ERRORS,
  reads: CHECKED_LINK.reads,
  writes: CHECKED_LINK.writes,
  drives: CHECKED_LINK.drives,
  invokes: CHECKED_LINK.invokes,
  emits: [],
  calls: LINK_CHECK_CALLS,
  chain: [],
  spans: [],
});

export const rpc_requests_checkouts_reconcile_invoice = defineRpc({
  id: "requests.checkouts.reconcile-invoice",
  title: "Verify one funding transaction for an Invoice link and record it",
  about:
    "Row `requests.checkouts.reconcileInvoice`, registered as `requests/checkouts:reconcileInvoice`. No session. A link that " +
    "names no Invoice is INVALID_INPUT `Invoice is unavailable`; then exactly the request link's reconciliation " +
    "(reconcile-request).",
  was: [`${CONVEX}:18`, `${OPS}/reconcile-invoice.ts:12`, `${ROWS}:285`, `${AREA}/external/links.ts:77`, `${AREA}/views.ts:68`, ...RECONCILED_LINK.was],
  concept: concept_requests,
  kind: "action",
  who: "Anyone holding the Invoice link and a funding transaction hash; no session.",
  input: LinkReconciliation,
  output: reconciliation(linkState("invoice")),
  errors: CHAIN_DISABLED_ERRORS,
  reads: RECONCILED_LINK.reads,
  writes: RECONCILED_LINK.writes,
  drives: RECONCILED_LINK.drives,
  invokes: RECONCILED_LINK.invokes,
  emits: [],
  calls: LINK_CHECK_CALLS,
  chain: [],
  spans: [],
});

// ── workflow: the escrow sweep ─────────────────────────────────────────────────────────────

export const workflow_requests_checkouts_pay_escrows = defineWorkflow({
  id: "requests.checkouts.pay-escrows",
  title: "Pay out the funded request escrows",
  about:
    "Registered as the internal action `requests/checkouts:payEscrows`, the cron job `pay out funded Invoice escrows` every " +
    "minute (`crons.interval`, not clock-aligned), registered on every deployment whatever the money-write switch " +
    "(ADR-0035; on v4, CAP-1213). Attributed to the system job `invoice_escrow`. It reads the 25 least recently read waiting " +
    "escrows; none ends the run. For each, one at a time: a request neither open nor cancelled closes; otherwise the escrow's " +
    "ERC-20 balance is read; short of the amount with no payout yet, a cancelled request closes (CAP-1212: only what an " +
    "escrow already holds pays out) and an open one records the balance (a rise below the amount sends `part_received`). A " +
    "funded escrow with no payout yet is deployed (when it has no code) and paid out in one sponsored UserOperation relayed " +
    "from the faucet Safe (`relayOpenCalls`, Accounts' action helper, signed with `DEPLOYER_PRIVATE_KEY`, Base Sepolia " +
    "only: production needs its own relayer), waiting for inclusion, and the payout transaction is recorded. The payout is " +
    "then settled through the link's reconciliation (as reconcile-request); verified closes the escrow `paid`, which sends " +
    "the paid notice. Any failure of one escrow records a bare read (moving it to the back of the queue) and counts it " +
    "failed. Returns `{ waiting, funded, paid, closed, failed }`. Timeout is Convex's action limit; the code sets none.",
  was: [
    `${CONVEX}:12`,
    `${BACKEND}/src/platform/jobs.ts:117`,
    `${OPS}/pay-escrows.ts:18`,
    `${OPS}/pay-escrows.ts:26`,
    `${AREA}/external/escrows.ts:60`,
    `${AREA}/external/escrows.ts:104`,
    `${AREA}/external/escrows.ts:111`,
    `${AREA}/external/escrows.ts:119`,
    `${AREA}/external/escrows.ts:137`,
    `${AREA}/external/escrows.ts:139`,
    `${AREA}/external/escrows.ts:151`,
    `${AREA}/external/escrows.ts:158`,
    `${BACKEND}/src/accounts/grants/external/relays.ts:18`,
    `${BACKEND}/src/accounts/grants/external/faucet.ts:36`,
    `${BACKEND}/src/accounts/grants/rules.ts:41`,
    ...RECONCILED_LINK.was,
  ],
  concept: concept_requests,
  priority: "critical",
  trigger: { cron: "* * * * *" },
  steps: [
    { name: "attribute", about: "Records the run as the system job `invoice_escrow`." },
    { name: "load", about: "Runs `requests.checkouts.waiting-escrows`: up to 25 waiting escrows with their checked terms; none ends the run." },
    { name: "close-ended", about: "An escrow whose request is neither open nor cancelled closes through `record-escrow`, unread." },
    { name: "read-balance", about: "Reads the escrow's ERC-20 balance on Base Sepolia (`fetchErc20Balance`)." },
    { name: "record-short", about: "Short with no payout: a cancelled request closes; an open one records the balance and stays waiting." },
    { name: "deploy-and-payout", about: "No payout yet: reads the escrow's code, then relays deploy (if needed) and `payout` from the faucet Safe and waits for inclusion." },
    { name: "record-payout", about: "Records the balance and the payout transaction, so a retry reconciles the same one." },
    { name: "settle", about: "Reconciles the payout transaction through the link (load-request, check, record-verification, record-consumption, record-request)." },
    { name: "close-paid", about: "Verified: closes the escrow with `paid`, which schedules the paid notice; otherwise it stays waiting as funded." },
    { name: "annotate", about: "Annotates the run's counts on its wide event." },
  ],
  reads: union([table_payment_requests], rpc_requests_checkouts_waiting_escrows.reads, rpc_requests_checkouts_record_escrow.reads, RECONCILED_LINK.reads),
  writes: union(rpc_requests_checkouts_record_escrow.writes, RECONCILED_LINK.writes),
  drives: union(rpc_requests_checkouts_record_escrow.drives, RECONCILED_LINK.drives),
  invokes: RECONCILED_LINK.invokes,
  emits: [],
  calls: union(
    [
      integration_chain_rpc.c.fetchErc20Balance,
      integration_chain_rpc.c.fetchAddressCode,
      integration_chain_rpc.c.fetchEntryPointNonce,
      integration_chain_rpc.c.sponsorUserOperation,
      integration_chain_rpc.c.sendUserOperation,
      integration_chain_rpc.c.waitForUserOperationReceipt,
    ],
    LINK_CHECK_CALLS,
  ),
  chain: [
    contract_erc20.f.balanceOf,
    contract_capxul_escrow_factory.f.deploy,
    contract_escrow_factory.f.deploy,
    contract_capxul_escrow.f.payout,
    contract_escrow.f.payout,
    contract_safe_4337_module.f.executeUserOpWithErrorString,
    contract_multi_send_call_only.f.multiSend,
    contract_entry_point.f.getNonce,
  ],
  idempotency:
    "A payout transaction is recorded before it is settled, so a later run reconciles that one and never relays a second; " +
    "record-escrow writes only a waiting escrow, and a closed one is never read again; the link's receipt record is fenced.",
  timeoutMs: 600000,
  retries: { max: 0, backoff: "none" },
});
