// The old book's payments area, as it is: one operation record for every operation that
// apps/docs/factory/areas/payments.yaml lists in /home/user/factory (branch integration/factory),
// except the seven payment.* pages booked in ../payments/operations.ts. That is balance, address,
// request.*, inbox.*, service.*, contact.* and document.*: 26 records.
//
// Text: title, about, who, changes, notes, mistakes, acceptance claims and each refusal's `when` come
// from the frozen book (../../frozen), never retyped. The page is cited as `<id>.yaml:1` in `was`.
//
// implementedBy: the CLI command (apps/cli/src/commands/<noun>/) is traced to the SDK method it calls.
// Every method in this area forwards one row (packages/sdk/src/{accounts,requests,parties,activity}/),
// so implementedBy is that rpc, named by its protocol row kebab-cased, from the owning concept's
// area file. The one exception is `inbox pay`, whose method `client.approvals.prepare` composes
// several calls: its flow is in ../payments/flows.ts. Where the CLI itself makes further SDK calls
// around the method (a read before a write, a preview, a second read), the record's comment says so.
//
// returns: a Struct of the page's `returns` fields, typed from what the CLI prints with `--json`.
// For most commands that is the SDK's projection of the row's output (ActorRequest, InboxItem,
// AddressBookEntry, Account), with types from the protocol schema the projection copies. A field the
// page names but the CLI does not print is said in the comment.
//
// refusals: each page refusal maps to the error record of its code. `given` is `?` on every one. Only
// two scenario files reach a refusal of this area: S18 (s18-dana-reads-her-payment-surface.scenario.ts)
// runs on an empty devnet (`parent: null`, :89), which no saved world names, and S10's two `inbox
// pay` refusals (s10:666, :717) are budget_exhausted overspends that the page's `when` does not
// describe. No budget: nothing measured these commands. priority is `normal`: the old book has none.
//
// errors: the codes the CLI command constructs itself (CliFailure), before or after its rpc.
// A backend refusal the CLI only rewords (normalizeOrganizationReadFailure, readBeforeAnotherWrite)
// keeps its own code and is not listed.

import { Schema } from "effect";
import { defineOperation } from "../../../packages/book/src/index.ts";
import { frozenClaims, frozenRefusals, frozenText, type FrozenId } from "../../frozen/index.ts";
import {
  error_CANCELLED,
  error_CLI_DEADLINE,
  error_CLI_DEFECT,
  error_CLI_STORAGE,
  error_CLI_USAGE,
  error_INSUFFICIENT_BALANCE,
  error_INVALID_INPUT,
  error_NOT_AUTHENTICATED,
  error_ROLE_PERMISSION_DENIED,
  error_TRANSACTION_FAILED,
  error_WRONG_STATE,
} from "../shared/vocabulary.ts";
import { flow_client_approvals_prepare } from "../payments/flows.ts";
import { operation_payment_send } from "../payments/operations.ts";
import { rpc_accounts_balances_read } from "../accounts/balances.ts";
import { rpc_accounts_summaries_deposit_instructions } from "../accounts/summaries.ts";
import {
  rpc_requests_receivables_cancel,
  rpc_requests_receivables_get_current,
  rpc_requests_receivables_issue,
  rpc_requests_receivables_list_current,
} from "../requests/receivables.ts";
import {
  rpc_requests_inboxes_decline,
  rpc_requests_inboxes_get_current,
  rpc_requests_inboxes_list_current,
} from "../requests/inboxes.ts";
import {
  rpc_requests_offers_create,
  rpc_requests_offers_deactivate,
  rpc_requests_offers_get,
  rpc_requests_offers_list,
  rpc_requests_offers_revise,
} from "../requests/offers.ts";
import {
  rpc_parties_contacts_add,
  rpc_parties_contacts_get,
  rpc_parties_contacts_hide,
  rpc_parties_contacts_label,
  rpc_parties_contacts_list,
  rpc_parties_contacts_unhide,
} from "../parties/contacts.ts";
import { rpc_parties_accounts_add } from "../parties/accounts.ts";
import {
  rpc_activity_documents_get,
  rpc_activity_documents_render,
  rpc_activity_documents_verify,
} from "../activity/documents.ts";

const CLI = "apps/cli/src/commands";
const SDK = "packages/sdk/src";
const PROTOCOL = "packages/protocol/src";
const page = (id: FrozenId) => `apps/docs/factory/operations/${id}.yaml:1`;

// ── refusals: the page's codes, mapped to error records ─────────────────────────────────────

const ERRORS = {
  CLI_USAGE: error_CLI_USAGE,
  INSUFFICIENT_BALANCE: error_INSUFFICIENT_BALANCE,
  INVALID_INPUT: error_INVALID_INPUT,
  NOT_AUTHENTICATED: error_NOT_AUTHENTICATED,
  ROLE_PERMISSION_DENIED: error_ROLE_PERMISSION_DENIED,
  WRONG_STATE: error_WRONG_STATE,
} as const;

/** The page's refusals, in its order and words, each on its error record. No world reaches any (see the header). */
const refusals = (id: FrozenId) =>
  frozenRefusals(id).map(({ code, when }) => {
    const error = (ERRORS as Record<string, (typeof ERRORS)[keyof typeof ERRORS] | undefined>)[code];
    if (error === undefined) throw new Error(`${id}: the refusal code ${code} has no error record here`);
    return { error, given: "?", when };
  });

// ── shapes the CLI prints, transcribed from the protocol ─────────────────────────────────────
// Branded strings and numbers are plain here.

/** AssetAmountSchema (money/schema.ts:46). */
const AssetAmount = Schema.Struct({
  asset: Schema.String,
  value: Schema.String,
  currency: Schema.optional(Schema.Never),
  decimals: Schema.optional(Schema.Never),
});

/** MoneySchema (money/schema.ts:54). */
const Money = Schema.Struct({
  currency: Schema.String,
  value: Schema.String,
  decimals: Schema.Number,
  asset: Schema.optional(Schema.Never),
});

/** DocumentRefV3Schema (documents/read-schema.ts:13). */
const DocumentRef = Schema.Struct({
  documentHash: Schema.String,
  contentHash: Schema.String,
  kind: Schema.Literals(["memo", "invoice", "payslip", "receipt"]),
  format: Schema.Literals(["envelope-v3", "envelope-v4", "envelope-v5", "artifact"]),
  role: Schema.Literals(["instruction", "movement", "supporting"]),
  issuedAt: Schema.NullOr(Schema.Number),
});

/** RecipientLocatorSchema (parties/schema.ts:31) = the SDK's `Ref` (sdk parties/recipients.ts:48). */
const Locator = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("handle"), handle: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("email"), email: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("address"), address: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("party"), partyId: Schema.String }),
]);

/** REQUEST_STATUSES and INBOX_STATUSES (requests/status.ts:2, :18). */
const RequestStatus = Schema.Literals([
  "draft",
  "sent",
  "viewed",
  "pending_settlement",
  "scheduled",
  "paid",
  "declined",
  "cancelled",
  "expired",
]);
const InboxStatus = Schema.Literals(["open", "approved", "scheduled", "declined", "paid", "cancelled", "expired"]);

const Escrow = Schema.Struct({
  address: Schema.String,
  ownerSafe: Schema.String,
  receivedRaw: Schema.optionalKey(Schema.String),
});

/**
 * An issued request as `client.account.requests.*` returns it: `mapActorRequest` (sdk requests/
 * receivables.ts:168) over RequestViewSchema (requests/request-schema.ts:22). It drops memo, the
 * timestamps, dueAt and the settled Payment, renames settledPaymentId to paymentId, and always sets
 * linkToken. `checkoutUrl` is added by the CLI's requestCheckout (request/internal/presentation.ts:29)
 * when the request carries an instruction document.
 */
const IssuedRequest = Schema.Struct({
  id: Schema.String,
  payer: Schema.optionalKey(Locator),
  amount: Schema.Union([AssetAmount, Money]),
  reference: Schema.String,
  status: RequestStatus,
  expiresAt: Schema.NullOr(Schema.Number),
  documents: Schema.Array(DocumentRef),
  issuerSafe: Schema.optionalKey(Schema.String),
  paymentId: Schema.optionalKey(Schema.String),
  addressedToViewer: Schema.optionalKey(Schema.Boolean),
  linkToken: Schema.String,
  receivingAccountId: Schema.optionalKey(Schema.String),
  settledDepositRef: Schema.optionalKey(Schema.String),
  escrow: Schema.optionalKey(Escrow),
  checkoutUrl: Schema.optionalKey(Schema.String),
});

/**
 * A received request as `client.account.inbox.*` returns it: `mapInboxItem` (sdk requests/
 * inbox-items.ts:10) over RequestViewSchema, its status mapped to the Inbox's vocabulary. The CLI adds
 * `checkoutUrl` the same way on list and get, not on decline.
 */
const InboxEntry = Schema.Struct({
  id: Schema.String,
  linkToken: Schema.String,
  issuer: Locator,
  amount: Schema.Union([AssetAmount, Money]),
  reference: Schema.String,
  status: InboxStatus,
  documents: Schema.Array(DocumentRef),
  issuerSafe: Schema.optionalKey(Schema.String),
  paymentId: Schema.optionalKey(Schema.String),
  receivingAccountId: Schema.optionalKey(Schema.String),
  settledDepositRef: Schema.optionalKey(Schema.String),
  dueAt: Schema.optionalKey(Schema.Number),
  checkoutUrl: Schema.optionalKey(Schema.String),
});

/** FixedOfferSchema (requests/offer-schema.ts:34) and the CLI's checkoutUrl (service/internal/presentation.ts:10). */
const Service = Schema.Struct({
  offerId: Schema.String,
  revision: Schema.Number,
  active: Schema.Boolean,
  terms: Schema.Struct({
    title: Schema.String,
    description: Schema.optional(Schema.String),
    unitLabel: Schema.String,
    unitAmount: AssetAmount,
    quantity: Schema.Struct({ min: Schema.Number, max: Schema.Number }),
  }),
  recipientSafe: Schema.String,
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
  checkoutUrl: Schema.String,
});

/** ContactSchema (parties/schema.ts:56) as `mapAddressBookEntry` keeps it (sdk parties/contacts.ts:278). */
const Contact = Schema.Struct({
  id: Schema.String,
  ref: Locator,
  label: Schema.String,
  relationship: Schema.Array(
    Schema.Literals(["paid", "paidBy", "invoiced", "invoicedBy", "member", "manual", "employed"]),
  ),
  hidden: Schema.Boolean,
  lastActivityAt: Schema.Number,
});

/** BankAccountSchema (parties/accounts-schema.ts:64): masked, last four digits only. */
const BankAccount = Schema.Struct({
  partyAccountId: Schema.String,
  ownerPartyId: Schema.String,
  ownerScope: Schema.Literals(["self", "contact"]),
  currency: Schema.Literals(["usd", "eur", "gbp"]),
  holderName: Schema.String,
  bankName: Schema.optionalKey(Schema.String),
  last4: Schema.String,
  state: Schema.Literals(["saved", "active", "inactive"]),
  recipient: Schema.Struct({ ref: Locator, label: Schema.String, onCapxul: Schema.Boolean }),
});

const SignatureStatus = Schema.Literals(["absent", "verified", "opaque"]);
const MediaType = Schema.Literals(["application/pdf", "image/png", "image/jpeg", "application/json"]);

// ── balance ─────────────────────────────────────────────────────────────────────────────────

// The CLI (balance/execute.ts:9) runs account/subcommands/balance/execute.ts: `client.accounts.read`
// (:14), which calls one row, accounts.balances.read (balance-adapter.ts:66), retrying it only on a
// dropped connection, then values the positions locally with the configured rates (:73). It prints
// the SDK's Account (accounts/model.ts:34), not the row's {accountId, chainId, positions}. With
// `--org`, or an Organization `use org` saved (selectActor, auth/actor.ts:87), it runs
// org/subcommands/balance/execute.ts: readOrganization lists the person's
// Organizations and refuses one outside the list itself (org/internal/read.ts:218,
// organizationAccessDenied, lifecycle.ts:17), then `client.org(id).treasury()` (:19).
export const operation_balance = defineOperation({
  ...frozenText("balance"),
  was: [
    page("balance"),
    `${CLI}/balance/command.ts:15`,
    `${CLI}/balance/execute.ts:9`,
    "apps/cli/src/auth/actor.ts:87",
    `${CLI}/account/subcommands/balance/execute.ts:14`,
    `${CLI}/org/subcommands/balance/execute.ts:19`,
    `${CLI}/org/internal/read.ts:218`,
    `${CLI}/org/internal/lifecycle.ts:17`,
    `${CLI}/account/internal/presentation.ts:21`,
    `${SDK}/accounts/balances.ts:50`,
    `${SDK}/accounts/balance-programs.ts:30`,
    `${SDK}/accounts/balance-adapter.ts:66`,
    `${SDK}/accounts/balance-adapter.ts:73`,
    `${SDK}/organizations/scope-reads.ts:75`,
    `${PROTOCOL}/accounts/operations.ts:120`,
    `${PROTOCOL}/accounts/model.ts:34`,
    `${PROTOCOL}/accounts/model.ts:47`,
  ],
  priority: "normal",
  implementedBy: rpc_accounts_balances_read,
  acceptance: frozenClaims("balance"),
  returns: Schema.Struct({
    id: Schema.String, // The Account's ID.
    balances: Schema.Array(
      Schema.Struct({
        asset: Schema.String,
        symbol: Schema.String,
        decimals: Schema.Number,
        balance: Schema.String,
        available: Schema.String,
      }),
    ), // One position per settlement asset, each with its balance and what is available.
    balance: Schema.NullOr(Money), // The fiat valuation of the balances, or null when at least one asset has no rate.
    available: Schema.NullOr(Money), // The fiat valuation of what is available, or null in the same case.
  }),
  // readOrganization's own refusals (CLI_USAGE: two --org values, a malformed one, none chosen) and its
  // own membership check (ROLE_PERMISSION_DENIED), before any treasury read.
  errors: [error_CLI_USAGE, error_ROLE_PERMISSION_DENIED],
  refusals: refusals("balance"),
});

// ── address ─────────────────────────────────────────────────────────────────────────────────

// The CLI (address/execute.ts:9) runs account/subcommands/deposit/execute.ts:
// `client.account.profile.depositInstructions` (:14), which hands over to the person's
// `depositInstructions` (sdk parties/contacts.ts:213, accounts/summaries.ts:133): one row,
// accounts.summaries.depositInstructions. With `--org`, or a saved `use org` Organization
// (auth/actor.ts:87), it runs org/subcommands/deposit/execute.ts
// (:19): readOrganization's membership check, then `client.org(id).profile.depositInstructions`,
// which calls no address row: it finds the Organization in the person's list and builds
// `orgTreasury` instructions in the SDK (organizations/programs.ts:115).
// s18.2 (s18:126) reaches NOT_AUTHENTICATED on an empty devnet, which no world names.
export const operation_address = defineOperation({
  ...frozenText("address"),
  was: [
    page("address"),
    `${CLI}/address/command.ts:15`,
    `${CLI}/address/execute.ts:9`,
    "apps/cli/src/auth/actor.ts:87",
    `${CLI}/account/subcommands/deposit/execute.ts:14`,
    `${CLI}/org/subcommands/deposit/execute.ts:19`,
    `${CLI}/org/internal/read.ts:218`,
    `${SDK}/parties/contacts.ts:213`,
    `${SDK}/accounts/summaries.ts:133`,
    `${SDK}/organizations/programs.ts:115`,
    `${PROTOCOL}/accounts/operations.ts:269`,
    "packages/scenarios/src/acme/s18-dana-reads-her-payment-surface.scenario.ts:89",
    "packages/scenarios/src/acme/s18-dana-reads-her-payment-surface.scenario.ts:126",
  ],
  priority: "normal",
  implementedBy: rpc_accounts_summaries_deposit_instructions,
  acceptance: frozenClaims("address"),
  // The row's output is `personalSafe` only; the Organization's instructions come from the SDK.
  returns: Schema.Struct({
    accountKind: Schema.Literals(["personalSafe", "orgTreasury"]), // `personalSafe` or `orgTreasury`.
    chainId: Schema.Number, // The chain to send on.
    network: Schema.Literal("base-sepolia"), // The network, such as `base-sepolia`.
    currency: Schema.Literal("USD"), // The currency, `USD`.
    address: Schema.String, // The address to send to, in lower case.
    label: Schema.String, // What the address belongs to.
  }),
  errors: [error_CLI_USAGE, error_ROLE_PERMISSION_DENIED],
  refusals: refusals("address"),
});

// ── request issue ───────────────────────────────────────────────────────────────────────────

// request/subcommands/issue/execute.ts: refuses `<email> <amount>` with `--input` (:26), reads the
// file or checks the words (:27, :28), requires `--confirm` off a terminal (:29), then with words reads
// `client.accounts.read` or the treasury to pick the asset (:37). Only a draft with `expiresAt`, which
// only `--input` can give (issue-input.ts:38), reads `client.system.clock` to check it is ahead (:41,
// issue-input.ts:96). It previews and asks at a terminal, and calls `client.account.requests.issue` (:51),
// which forwards one row, requests.receivables.issue (sdk requests/receivables.ts:102). It prints
// { scope, direction, item } (:58).
export const operation_request_issue = defineOperation({
  ...frozenText("request.issue"),
  was: [
    page("request.issue"),
    `${CLI}/request/command.ts:13`,
    `${CLI}/request/subcommands/issue/command.ts:6`,
    `${CLI}/request/subcommands/issue/execute.ts:26`,
    `${CLI}/request/subcommands/issue/execute.ts:29`,
    `${CLI}/request/subcommands/issue/execute.ts:37`,
    `${CLI}/request/subcommands/issue/execute.ts:41`,
    `${CLI}/request/internal/issue-input.ts:38`,
    `${CLI}/request/internal/issue-input.ts:96`,
    `${CLI}/request/subcommands/issue/execute.ts:51`,
    `${CLI}/request/subcommands/issue/execute.ts:58`,
    `${CLI}/request/internal/read.ts:11`,
    `${CLI}/request/internal/presentation.ts:29`,
    `${CLI}/org/internal/write.ts:36`,
    `${CLI}/org/internal/write.ts:50`,
    `${SDK}/requests/receivables.ts:102`,
    `${SDK}/requests/receivables.ts:168`,
    `${PROTOCOL}/requests/operations.ts:72`,
    `${PROTOCOL}/requests/request-schema.ts:22`,
  ],
  priority: "normal",
  implementedBy: rpc_requests_receivables_issue,
  acceptance: frozenClaims("request.issue"),
  returns: Schema.Struct({
    scope: Schema.Union([
      Schema.Struct({ kind: Schema.Literal("personal") }),
      Schema.Struct({ kind: Schema.Literal("organization"), organizationId: Schema.String }),
    ]), // Whether you or the Organization issued it.
    direction: Schema.Literal("issued"), // The request's direction, issued.
    item: IssuedRequest, // The request with its ID, payer, amount, reference, status, expiry, documents, any escrow and its checkout link.
  }),
  // Every refusal of the input, the confirmation and a declined prompt is CLI_USAGE (auth/input.ts:11).
  errors: [error_CLI_USAGE],
  refusals: refusals("request.issue"),
});

// ── request list ────────────────────────────────────────────────────────────────────────────

// request/subcommands/list/execute.ts: checks --limit and --after (:17), then
// `client.account.requests.list` (:30), which forwards one row, requests.receivables.listCurrent
// (sdk requests/receivables.ts:139). The row takes no cursor and answers the whole list; the CLI cuts
// the page itself (showPage, :34). As is, an `--after` the list did not give is refused by the CLI
// with CLI_USAGE (runtime/paging.ts:82), not the INVALID_INPUT the page names; a cursor that does not
// advance is CLI_DEFECT (paging.ts:53).
export const operation_request_list = defineOperation({
  ...frozenText("request.list"),
  was: [
    page("request.list"),
    `${CLI}/request/subcommands/list/command.ts:8`,
    `${CLI}/request/subcommands/list/execute.ts:17`,
    `${CLI}/request/subcommands/list/execute.ts:30`,
    `${CLI}/request/subcommands/list/execute.ts:34`,
    `${CLI}/request/subcommands/list/execute.ts:50`,
    "apps/cli/src/runtime/paging.ts:39",
    "apps/cli/src/runtime/paging.ts:53",
    "apps/cli/src/runtime/paging.ts:82",
    `${SDK}/requests/receivables.ts:139`,
    `${PROTOCOL}/requests/operations.ts:107`,
    `${PROTOCOL}/primitives/page.ts:11`,
  ],
  priority: "normal",
  implementedBy: rpc_requests_receivables_list_current,
  acceptance: frozenClaims("request.list"),
  returns: Schema.Struct({
    items: Schema.Array(IssuedRequest), // Each request you issued, with its status, amount, reference and document references.
    nextCursor: Schema.NullOr(Schema.String), // The `--after` value for the next page, or null on the last.
  }),
  errors: [error_CLI_USAGE, error_CLI_DEFECT],
  refusals: refusals("request.list"),
});

// ── request get ─────────────────────────────────────────────────────────────────────────────

// request/subcommands/get/execute.ts: checks the ID (:21), refuses `--wait` on a received request
// (:23), then `client.account.requests.get` (:30), which forwards one row,
// requests.receivables.getCurrent (sdk requests/receivables.ts:143). A null or another ID is refused
// by the CLI (:41). With `--wait paid` it reads again every 5 s and ends at its deadline with
// CLI_DEADLINE (:57). It prints the request (:83).
export const operation_request_get = defineOperation({
  ...frozenText("request.get"),
  was: [
    page("request.get"),
    `${CLI}/request/subcommands/get/command.ts:18`,
    `${CLI}/request/subcommands/get/execute.ts:21`,
    `${CLI}/request/subcommands/get/execute.ts:23`,
    `${CLI}/request/subcommands/get/execute.ts:30`,
    `${CLI}/request/subcommands/get/execute.ts:41`,
    `${CLI}/request/subcommands/get/execute.ts:57`,
    `${CLI}/request/subcommands/get/execute.ts:83`,
    `${CLI}/request/internal/read.ts:6`,
    `${CLI}/org/internal/read.ts:69`,
    `${SDK}/requests/receivables.ts:143`,
    `${PROTOCOL}/requests/operations.ts:114`,
  ],
  priority: "normal",
  implementedBy: rpc_requests_receivables_get_current,
  acceptance: frozenClaims("request.get"),
  returns: Schema.Struct({
    id: IssuedRequest.fields.id, // The request's ID.
    payer: IssuedRequest.fields.payer, // Who is asked to pay.
    amount: IssuedRequest.fields.amount, // The amount and asset or currency.
    reference: IssuedRequest.fields.reference, // What it is for.
    status: IssuedRequest.fields.status, // Its status.
    expiresAt: IssuedRequest.fields.expiresAt, // When it expires, or null.
    documents: IssuedRequest.fields.documents, // Its documents.
    paymentId: IssuedRequest.fields.paymentId, // The payment that paid it, once paid.
    escrow: IssuedRequest.fields.escrow, // For a payer not on Capxul, the escrow they pay and what it holds so far.
  }),
  errors: [error_CLI_USAGE, error_CLI_DEADLINE],
  refusals: refusals("request.get"),
});

// ── request cancel ──────────────────────────────────────────────────────────────────────────

// request/subcommands/cancel/execute.ts: requires `--confirm` off a terminal (:20), reads the request
// with `client.account.requests.get` (:23, requests.receivables.getCurrent) and refuses a null (:30),
// previews and asks at a terminal, then `client.account.requests.cancel` (:39), which forwards one
// row, requests.receivables.cancel (sdk requests/receivables.ts:151). It prints the request as the
// SDK returns it, without a checkout link.
export const operation_request_cancel = defineOperation({
  ...frozenText("request.cancel"),
  was: [
    page("request.cancel"),
    `${CLI}/request/subcommands/cancel/command.ts:7`,
    `${CLI}/request/subcommands/cancel/execute.ts:20`,
    `${CLI}/request/subcommands/cancel/execute.ts:23`,
    `${CLI}/request/subcommands/cancel/execute.ts:30`,
    `${CLI}/request/subcommands/cancel/execute.ts:39`,
    `${CLI}/request/internal/write.ts:35`,
    `${SDK}/requests/receivables.ts:151`,
    `${PROTOCOL}/requests/operations.ts:100`,
  ],
  priority: "normal",
  implementedBy: rpc_requests_receivables_cancel,
  acceptance: frozenClaims("request.cancel"),
  returns: Schema.Struct({
    id: IssuedRequest.fields.id, // The request's ID.
    status: IssuedRequest.fields.status, // `cancelled`.
    amount: IssuedRequest.fields.amount, // Its amount.
    reference: IssuedRequest.fields.reference, // What it was for.
  }),
  errors: [error_CLI_USAGE],
  refusals: refusals("request.cancel"),
});

// ── inbox list ──────────────────────────────────────────────────────────────────────────────

// request/subcommands/list/execute.ts with the received context (request/command.ts:18): checks
// --limit and --after (:17), then `client.account.inbox.list` (:38), which forwards one row,
// requests.inboxes.listCurrent, with the cursor and limit (sdk requests/inboxes.ts:90). The backend
// pages; a refused cursor is reworded on `after` and keeps INVALID_INPUT (:65). A backend cursor that
// does not advance is CLI_DEFECT (showBackendPage, paging.ts:53).
export const operation_inbox_list = defineOperation({
  ...frozenText("inbox.list"),
  was: [
    page("inbox.list"),
    `${CLI}/request/command.ts:18`,
    `${CLI}/request/subcommands/list/command.ts:8`,
    `${CLI}/request/subcommands/list/execute.ts:17`,
    `${CLI}/request/subcommands/list/execute.ts:38`,
    `${CLI}/request/subcommands/list/execute.ts:46`,
    `${CLI}/request/subcommands/list/execute.ts:65`,
    "apps/cli/src/runtime/paging.ts:39",
    "apps/cli/src/runtime/paging.ts:53",
    `${SDK}/requests/inboxes.ts:90`,
    `${SDK}/requests/inbox-items.ts:10`,
    `${PROTOCOL}/requests/inbox-operations.ts:35`,
  ],
  priority: "normal",
  implementedBy: rpc_requests_inboxes_list_current,
  acceptance: frozenClaims("inbox.list"),
  returns: Schema.Struct({
    items: Schema.Array(InboxEntry), // Each request sent to whoever you act as, with its issuer, amount, reference, status and documents.
    nextCursor: Schema.NullOr(Schema.String), // The `--after` value for the next page, or null on the last.
  }),
  errors: [error_CLI_USAGE, error_CLI_DEFECT],
  refusals: refusals("inbox.list"),
});

// ── inbox get ───────────────────────────────────────────────────────────────────────────────

// request/subcommands/get/execute.ts with the received context: refuses `--wait` (:23), then
// `client.account.inbox.get` (:31), which forwards one row, requests.inboxes.getCurrent (sdk
// requests/inboxes.ts:101). A null or another ID is refused by the CLI (:41).
export const operation_inbox_get = defineOperation({
  ...frozenText("inbox.get"),
  was: [
    page("inbox.get"),
    `${CLI}/request/subcommands/get/command.ts:18`,
    `${CLI}/request/subcommands/get/execute.ts:21`,
    `${CLI}/request/subcommands/get/execute.ts:23`,
    `${CLI}/request/subcommands/get/execute.ts:31`,
    `${CLI}/request/subcommands/get/execute.ts:41`,
    `${SDK}/requests/inboxes.ts:101`,
    `${SDK}/requests/inbox-items.ts:10`,
    `${PROTOCOL}/requests/inbox-operations.ts:49`,
  ],
  priority: "normal",
  implementedBy: rpc_requests_inboxes_get_current,
  acceptance: frozenClaims("inbox.get"),
  returns: Schema.Struct({
    id: InboxEntry.fields.id, // The request's ID.
    issuer: InboxEntry.fields.issuer, // Who asks you to pay.
    amount: InboxEntry.fields.amount, // The amount and asset or currency.
    reference: InboxEntry.fields.reference, // What it is for.
    status: InboxEntry.fields.status, // Its status.
    documents: InboxEntry.fields.documents, // Its documents.
    dueAt: InboxEntry.fields.dueAt, // The Invoice's due date, when it names one.
  }),
  errors: [error_CLI_USAGE],
  refusals: refusals("inbox.get"),
});

// ── inbox pay ───────────────────────────────────────────────────────────────────────────────

// request/subcommands/pay/execute.ts: refuses both `--on` and `--at` (:28), reads the request with
// `client.account.inbox.get` (:77, requests.inboxes.getCurrent) and refuses a null (:83), refuses a
// request that is not open itself with WRONG_STATE (:98), requires `--permission-id` for an
// Organization (:108), reads `inbox.paymentTerms` (:110, requests.inboxes.paymentTerms) and refuses
// terms that differ, then calls `client.approvals.prepare({ request })` (:132), the flow that prepares
// the Payment (payments.commands.prepareRequest) and opens an approval, and hands it over (:140,
// payment/internal/approval.ts:278), which without `--json` follows it with `client.approvals.wait`
// (approval.ts:175) as payment send does. The hand-over prints what payment send prints, so returns is that
// record's. As is, s10.9 and s10.12 (s10:666, :717) refuse ROLE_PERMISSION_DENIED from after-s2 plus
// S10's steps by a budget_exhausted overspend, which this `when` does not describe.
export const operation_inbox_pay = defineOperation({
  ...frozenText("inbox.pay"),
  was: [
    page("inbox.pay"),
    `${CLI}/request/subcommands/pay/command.ts:6`,
    `${CLI}/request/subcommands/pay/execute.ts:28`,
    `${CLI}/request/subcommands/pay/execute.ts:77`,
    `${CLI}/request/subcommands/pay/execute.ts:83`,
    `${CLI}/request/subcommands/pay/execute.ts:98`,
    `${CLI}/request/subcommands/pay/execute.ts:108`,
    `${CLI}/request/subcommands/pay/execute.ts:110`,
    `${CLI}/request/subcommands/pay/execute.ts:132`,
    `${CLI}/request/subcommands/pay/execute.ts:140`,
    `${CLI}/request/internal/write.ts:7`,
    `${CLI}/payment/internal/approval.ts:278`,
    `${CLI}/payment/internal/approval.ts:175`,
    `${CLI}/payment/internal/approval.ts:100`,
    `${CLI}/payment/internal/approval.ts:109`,
    `${CLI}/payment/internal/approval.ts:118`,
    `${CLI}/payment/internal/approval.ts:131`,
    `${SDK}/accounts/approvals.ts:106`,
    "packages/scenarios/src/acme/s10-acme-schedules-payments.scenario.ts:60",
    "packages/scenarios/src/acme/s10-acme-schedules-payments.scenario.ts:666",
    "packages/scenarios/src/acme/s10-acme-schedules-payments.scenario.ts:717",
  ],
  priority: "normal",
  implementedBy: flow_client_approvals_prepare,
  acceptance: frozenClaims("inbox.pay"),
  returns: operation_payment_send.returns,
  // CLI_USAGE for its input, the missing permission and a mismatch; WRONG_STATE for a request that is not
  // open (pay/execute.ts:98) and an expired approval; CANCELLED for a rejection; CLI_DEADLINE when the
  // follow times out; TRANSACTION_FAILED when a payment does not settle (approval.ts:100-131).
  errors: [error_CLI_USAGE, error_WRONG_STATE, error_CANCELLED, error_CLI_DEADLINE, error_TRANSACTION_FAILED],
  refusals: refusals("inbox.pay"),
});

// ── inbox decline ───────────────────────────────────────────────────────────────────────────

// request/subcommands/decline/execute.ts: requires `--confirm` off a terminal (:20), reads the request
// with `client.account.inbox.get` (:23) and refuses a null (:30), previews and asks at a terminal,
// then `client.account.inbox.decline` (:39), which forwards one row, requests.inboxes.decline (sdk
// requests/inboxes.ts:231). It prints the InboxItem without a checkout link.
export const operation_inbox_decline = defineOperation({
  ...frozenText("inbox.decline"),
  was: [
    page("inbox.decline"),
    `${CLI}/request/subcommands/decline/command.ts:7`,
    `${CLI}/request/subcommands/decline/execute.ts:20`,
    `${CLI}/request/subcommands/decline/execute.ts:23`,
    `${CLI}/request/subcommands/decline/execute.ts:30`,
    `${CLI}/request/subcommands/decline/execute.ts:39`,
    `${SDK}/requests/inboxes.ts:231`,
    `${PROTOCOL}/requests/inbox-operations.ts:76`,
  ],
  priority: "normal",
  implementedBy: rpc_requests_inboxes_decline,
  acceptance: frozenClaims("inbox.decline"),
  returns: Schema.Struct({
    id: InboxEntry.fields.id, // The request's ID.
    status: InboxEntry.fields.status, // `declined`.
    issuer: InboxEntry.fields.issuer, // Who asked you to pay.
    amount: InboxEntry.fields.amount, // Its amount.
  }),
  errors: [error_CLI_USAGE],
  refusals: refusals("inbox.decline"),
});

// ── service list ────────────────────────────────────────────────────────────────────────────

// service/subcommands/list/execute.ts: checks --limit and --after (:12), then
// `client.account.services.list` (:15), which forwards one row, requests.offers.list (sdk
// requests/services.ts:72). The CLI cuts the page itself (showPage, :18): an unknown `--after` is
// CLI_USAGE (paging.ts:82). As is, an Offer the scope does not own is refused INVALID_INPUT
// (backend requests/errors/offers.ts:13) on get, revise and deactivate, which no page describes.
export const operation_service_list = defineOperation({
  ...frozenText("service.list"),
  was: [
    page("service.list"),
    `${CLI}/service/subcommands/list/command.ts:8`,
    `${CLI}/service/subcommands/list/execute.ts:12`,
    `${CLI}/service/subcommands/list/execute.ts:15`,
    `${CLI}/service/subcommands/list/execute.ts:18`,
    `${CLI}/service/internal/presentation.ts:10`,
    "apps/cli/src/runtime/paging.ts:82",
    `${SDK}/requests/services.ts:72`,
    `${PROTOCOL}/requests/operations.ts:147`,
    `${PROTOCOL}/requests/offer-schema.ts:34`,
  ],
  priority: "normal",
  implementedBy: rpc_requests_offers_list,
  acceptance: frozenClaims("service.list"),
  returns: Schema.Struct({
    items: Schema.Array(Service), // Each service with its offer ID, revision, whether it is active, its terms, the Safe it pays and its checkout link.
    nextCursor: Schema.NullOr(Schema.String), // The `--after` value for the next page, or null on the last.
  }),
  errors: [error_CLI_USAGE, error_CLI_DEFECT],
  refusals: refusals("service.list"),
});

// ── service get ─────────────────────────────────────────────────────────────────────────────

// service/subcommands/get/execute.ts: checks the ID (:12), then `client.account.services.get` (:15),
// which forwards one row, requests.offers.get (sdk requests/services.ts:71). As is, a missing service
// and another owner's are both refused INVALID_INPUT `service is unavailable` (backend
// requests/reads/offers.ts:26, errors/offers.ts:13), a refusal this page does not list.
export const operation_service_get = defineOperation({
  ...frozenText("service.get"),
  was: [
    page("service.get"),
    `${CLI}/service/subcommands/get/command.ts:7`,
    `${CLI}/service/subcommands/get/execute.ts:12`,
    `${CLI}/service/subcommands/get/execute.ts:15`,
    `${SDK}/requests/services.ts:71`,
    `${PROTOCOL}/requests/operations.ts:140`,
    "packages/backend/src/requests/reads/offers.ts:26",
    "packages/backend/src/requests/errors/offers.ts:13",
  ],
  priority: "normal",
  implementedBy: rpc_requests_offers_get,
  acceptance: frozenClaims("service.get"),
  returns: Schema.Struct({
    offerId: Service.fields.offerId, // The service's ID.
    revision: Service.fields.revision, // Its current revision, which revise and deactivate expect.
    active: Service.fields.active, // Whether payers can buy it.
    terms: Service.fields.terms, // Its title, unit label, unit price and the quantity range.
    recipientSafe: Service.fields.recipientSafe, // The Safe it pays.
  }),
  errors: [error_CLI_USAGE],
  refusals: refusals("service.get"),
});

// ── service create ──────────────────────────────────────────────────────────────────────────

// service/subcommands/create/execute.ts: checks the request key (:15), reads and decodes the terms,
// at most 64 KiB (:16, service/internal/input.ts:45), requires `--confirm` off a terminal (:17),
// previews and asks at a terminal, then `client.account.services.create` (:30), which forwards one
// row, requests.offers.create (sdk requests/services.ts:70). As is, a quantity range that is not
// positive integers with min <= max is refused by the CLI's own decode with CLI_USAGE (input.ts:34,
// protocol offer-schema.ts:29), and the backend checks no quantity on create (quantityOutOfRange is
// raised only for a purchase, backend requests/writes/purchases.ts:111): the page's INVALID_INPUT for
// a quantity outside its limits is not what this command produces.
export const operation_service_create = defineOperation({
  ...frozenText("service.create"),
  was: [
    page("service.create"),
    `${CLI}/service/subcommands/create/command.ts:7`,
    `${CLI}/service/subcommands/create/execute.ts:15`,
    `${CLI}/service/subcommands/create/execute.ts:16`,
    `${CLI}/service/subcommands/create/execute.ts:17`,
    `${CLI}/service/subcommands/create/execute.ts:30`,
    `${CLI}/service/internal/input.ts:32`,
    `${CLI}/service/internal/input.ts:34`,
    `${CLI}/service/internal/input.ts:45`,
    `${CLI}/service/internal/write.ts:14`,
    "packages/backend/src/requests/writes/purchases.ts:111",
    `${SDK}/requests/services.ts:70`,
    `${PROTOCOL}/requests/operations.ts:133`,
    `${PROTOCOL}/requests/offer-schema.ts:24`,
  ],
  priority: "normal",
  implementedBy: rpc_requests_offers_create,
  acceptance: frozenClaims("service.create"),
  returns: Schema.Struct({
    offerId: Service.fields.offerId, // The new service's ID.
    revision: Service.fields.revision, // 1.
    active: Service.fields.active, // true.
    terms: Service.fields.terms, // Its terms as saved.
    recipientSafe: Service.fields.recipientSafe, // The Safe it pays.
  }),
  errors: [error_CLI_USAGE],
  refusals: refusals("service.create"),
});

// ── service revise ──────────────────────────────────────────────────────────────────────────

// service/subcommands/revise/execute.ts: checks the ID and the revision (:14), reads the terms,
// requires `--confirm` off a terminal, then changeOffer (service/internal/write.ts:33) reads the
// service with `services.get` (:52, requests.offers.get), previews and asks at a terminal, and calls
// `client.account.services.revise` (revise/execute.ts:25), which forwards one row,
// requests.offers.revise (sdk requests/services.ts:73). As is, another owner's service is refused at
// that first read with INVALID_INPUT (backend requests/errors/offers.ts:13), not the
// ROLE_PERMISSION_DENIED the page names; that code comes only from `--org` (requests/guards.ts:44).
export const operation_service_revise = defineOperation({
  ...frozenText("service.revise"),
  was: [
    page("service.revise"),
    `${CLI}/service/subcommands/revise/command.ts:7`,
    `${CLI}/service/subcommands/revise/execute.ts:14`,
    `${CLI}/service/subcommands/revise/execute.ts:25`,
    `${CLI}/service/internal/write.ts:33`,
    `${CLI}/service/internal/write.ts:52`,
    `${CLI}/service/internal/input.ts:21`,
    `${SDK}/requests/services.ts:73`,
    `${PROTOCOL}/requests/operations.ts:154`,
    "packages/backend/src/requests/errors/offers.ts:13",
    "packages/backend/src/requests/guards.ts:44",
  ],
  priority: "normal",
  implementedBy: rpc_requests_offers_revise,
  acceptance: frozenClaims("service.revise"),
  returns: Schema.Struct({
    offerId: Service.fields.offerId, // The service's ID.
    revision: Service.fields.revision, // The new revision.
    active: Service.fields.active, // Whether payers can buy it.
    terms: Service.fields.terms, // The new terms.
  }),
  errors: [error_CLI_USAGE],
  refusals: refusals("service.revise"),
});

// ── service deactivate ──────────────────────────────────────────────────────────────────────

// service/subcommands/deactivate/execute.ts: checks the ID and the revision (:13), requires `--confirm`
// off a terminal, then changeOffer reads the service (write.ts:52), asks at a terminal, and calls
// `client.account.services.deactivate` (:23), which forwards one row, requests.offers.deactivate (sdk
// requests/services.ts:74). Another owner's service: INVALID_INPUT, as for revise.
export const operation_service_deactivate = defineOperation({
  ...frozenText("service.deactivate"),
  was: [
    page("service.deactivate"),
    `${CLI}/service/subcommands/deactivate/command.ts:7`,
    `${CLI}/service/subcommands/deactivate/execute.ts:13`,
    `${CLI}/service/subcommands/deactivate/execute.ts:23`,
    `${CLI}/service/internal/write.ts:33`,
    `${CLI}/service/internal/write.ts:52`,
    `${CLI}/service/internal/input.ts:21`,
    `${SDK}/requests/services.ts:74`,
    `${PROTOCOL}/requests/operations.ts:166`,
    "packages/backend/src/requests/errors/offers.ts:13",
  ],
  priority: "normal",
  implementedBy: rpc_requests_offers_deactivate,
  acceptance: frozenClaims("service.deactivate"),
  returns: Schema.Struct({
    offerId: Service.fields.offerId, // The service's ID.
    revision: Service.fields.revision, // The revision it was at, unchanged.
    active: Service.fields.active, // false.
  }),
  errors: [error_CLI_USAGE],
  refusals: refusals("service.deactivate"),
});

// ── contact list ────────────────────────────────────────────────────────────────────────────

// contact/subcommands/list/execute.ts: checks --limit and --after (:43), picks the book (selectedBook,
// contact/internal/selection.ts:19), then `client.account.addressBook.list` (:23), which forwards one
// row, parties.contacts.list (sdk parties/contacts.ts:136). The CLI cuts the page itself (showPage,
// :29): an unknown `--after` is CLI_USAGE (paging.ts:82).
export const operation_contact_list = defineOperation({
  ...frozenText("contact.list"),
  was: [
    page("contact.list"),
    `${CLI}/contact/subcommands/list/command.ts:8`,
    `${CLI}/contact/subcommands/list/execute.ts:43`,
    `${CLI}/contact/subcommands/list/execute.ts:23`,
    `${CLI}/contact/subcommands/list/execute.ts:29`,
    `${CLI}/contact/internal/selection.ts:19`,
    `${CLI}/contact/internal/recovery.ts:9`,
    "apps/cli/src/runtime/paging.ts:82",
    `${SDK}/parties/contacts.ts:136`,
    `${PROTOCOL}/parties/operations.ts:86`,
    `${PROTOCOL}/parties/schema.ts:56`,
  ],
  priority: "normal",
  implementedBy: rpc_parties_contacts_list,
  acceptance: frozenClaims("contact.list"),
  returns: Schema.Struct({
    items: Schema.Array(Contact), // Each contact with its PartyId, ref, label, relationships, whether hidden, and its last activity.
    nextCursor: Schema.NullOr(Schema.String), // The `--after` value for the next page, or null on the last.
  }),
  errors: [error_CLI_USAGE, error_CLI_DEFECT],
  refusals: refusals("contact.list"),
});

// ── contact get ─────────────────────────────────────────────────────────────────────────────

// contact/subcommands/get/execute.ts: checks the PartyId, or requires one off a terminal (:17,
// contact/internal/shared.ts:7); at a terminal with none it lists the book and asks. Then
// `client.account.addressBook.get` (:27), which forwards one row, parties.contacts.get (sdk
// parties/contacts.ts:146), and a second read, `bankAccounts.list` for that party (:50,
// parties.accounts.list), whose items it prints as `bankAccounts` (:61). As is, a party outside the
// book prints `data: null` and "No contact found." with exit 0 (:42 of the same file), so returns is
// nullable. s18.4 (s18:167) reaches CLI_USAGE on an empty devnet, which no world names.
export const operation_contact_get = defineOperation({
  ...frozenText("contact.get"),
  was: [
    page("contact.get"),
    `${CLI}/contact/subcommands/get/command.ts:7`,
    `${CLI}/contact/subcommands/get/execute.ts:17`,
    `${CLI}/contact/subcommands/get/execute.ts:27`,
    `${CLI}/contact/subcommands/get/execute.ts:42`,
    `${CLI}/contact/subcommands/get/execute.ts:50`,
    `${CLI}/contact/subcommands/get/execute.ts:61`,
    `${CLI}/contact/internal/shared.ts:7`,
    `${CLI}/contact/internal/parse.ts:91`,
    `${SDK}/parties/contacts.ts:146`,
    `${PROTOCOL}/parties/operations.ts:93`,
    `${PROTOCOL}/parties/accounts-operations.ts:40`,
    `${PROTOCOL}/parties/accounts-schema.ts:64`,
    "packages/scenarios/src/acme/s18-dana-reads-her-payment-surface.scenario.ts:89",
    "packages/scenarios/src/acme/s18-dana-reads-her-payment-surface.scenario.ts:167",
  ],
  priority: "normal",
  implementedBy: rpc_parties_contacts_get,
  acceptance: frozenClaims("contact.get"),
  returns: Schema.NullOr(
    Schema.Struct({
      id: Contact.fields.id, // The contact's PartyId.
      ref: Contact.fields.ref, // How you named them.
      label: Contact.fields.label, // Its label.
      hidden: Contact.fields.hidden, // Whether it is hidden.
      bankAccounts: Schema.Array(BankAccount), // The bank accounts saved for them, masked.
    }),
  ),
  errors: [error_CLI_USAGE],
  refusals: refusals("contact.get"),
});

// ── contact add ─────────────────────────────────────────────────────────────────────────────

// contact/subcommands/add/execute.ts: reads `--input` (at most 64 KB, strict keys) or asks at a
// terminal (:23, contact/internal/parse.ts:48), requires `--confirm` off a terminal, previews and asks,
// then `client.account.addressBook.add` (:47), which forwards one row, parties.contacts.add (sdk
// parties/contacts.ts:150). A lost reply names `contact list --include-hidden` (recovery.ts:20).
export const operation_contact_add = defineOperation({
  ...frozenText("contact.add"),
  was: [
    page("contact.add"),
    `${CLI}/contact/subcommands/add/command.ts:7`,
    `${CLI}/contact/subcommands/add/execute.ts:23`,
    `${CLI}/contact/subcommands/add/execute.ts:47`,
    `${CLI}/contact/internal/parse.ts:48`,
    `${CLI}/contact/internal/recovery.ts:20`,
    `${SDK}/parties/contacts.ts:150`,
    `${PROTOCOL}/parties/operations.ts:100`,
  ],
  priority: "normal",
  implementedBy: rpc_parties_contacts_add,
  acceptance: frozenClaims("contact.add"),
  returns: Schema.Struct({
    id: Contact.fields.id, // The contact's stable PartyId.
    ref: Contact.fields.ref, // How you named them.
    label: Contact.fields.label, // Its label.
    relationship: Contact.fields.relationship, // How you know them.
    hidden: Contact.fields.hidden, // false.
  }),
  errors: [error_CLI_USAGE],
  refusals: refusals("contact.add"),
});

// ── contact label ───────────────────────────────────────────────────────────────────────────

// contact/subcommands/label/execute.ts: checks the PartyId and a nonempty `--label` (:24), requires
// `--confirm` off a terminal, then writeContact (contact/internal/write.ts:26): at a terminal it reads
// `addressBook.get` and refuses a null itself with CLI_USAGE (:40), then `client.account.addressBook
// .label` (label/execute.ts:40), which forwards one row, parties.contacts.label (sdk parties/
// contacts.ts:172). So a party outside the book is CLI_USAGE at a terminal, INVALID_INPUT from a script.
export const operation_contact_label = defineOperation({
  ...frozenText("contact.label"),
  was: [
    page("contact.label"),
    `${CLI}/contact/subcommands/label/command.ts:7`,
    `${CLI}/contact/subcommands/label/execute.ts:24`,
    `${CLI}/contact/subcommands/label/execute.ts:40`,
    `${CLI}/contact/internal/parse.ts:97`,
    `${CLI}/contact/internal/write.ts:26`,
    `${CLI}/contact/internal/write.ts:40`,
    `${SDK}/parties/contacts.ts:172`,
    `${PROTOCOL}/parties/operations.ts:125`,
  ],
  priority: "normal",
  implementedBy: rpc_parties_contacts_label,
  acceptance: frozenClaims("contact.label"),
  returns: Schema.Struct({
    id: Contact.fields.id, // The contact's PartyId.
    label: Contact.fields.label, // The new label.
  }),
  errors: [error_CLI_USAGE],
  refusals: refusals("contact.label"),
});

// ── contact hide ────────────────────────────────────────────────────────────────────────────

// contact/subcommands/hide/execute.ts (:3) is visibilityVerbs("hide"): checks the PartyId and
// `--confirm` (contact/internal/visibility.ts:48), then writeContact as for label, and
// `client.account.addressBook.hide` (:31), which forwards one row, parties.contacts.hide (sdk
// parties/contacts.ts:168). A party outside the book: CLI_USAGE at a terminal (write.ts:40).
export const operation_contact_hide = defineOperation({
  ...frozenText("contact.hide"),
  was: [
    page("contact.hide"),
    `${CLI}/contact/subcommands/hide/command.ts:7`,
    `${CLI}/contact/subcommands/hide/execute.ts:3`,
    `${CLI}/contact/internal/visibility.ts:31`,
    `${CLI}/contact/internal/visibility.ts:48`,
    `${CLI}/contact/internal/write.ts:40`,
    `${SDK}/parties/contacts.ts:168`,
    `${PROTOCOL}/parties/operations.ts:111`,
  ],
  priority: "normal",
  implementedBy: rpc_parties_contacts_hide,
  acceptance: frozenClaims("contact.hide"),
  returns: Schema.Struct({
    id: Contact.fields.id, // The contact's PartyId.
    hidden: Contact.fields.hidden, // true.
  }),
  errors: [error_CLI_USAGE],
  refusals: refusals("contact.hide"),
});

// ── contact unhide ──────────────────────────────────────────────────────────────────────────

// contact/subcommands/unhide/execute.ts (:3) is visibilityVerbs("unhide"):
// `client.account.addressBook.unhide` (visibility.ts:31), which forwards one row,
// parties.contacts.unhide (sdk parties/contacts.ts:170).
export const operation_contact_unhide = defineOperation({
  ...frozenText("contact.unhide"),
  was: [
    page("contact.unhide"),
    `${CLI}/contact/subcommands/unhide/command.ts:7`,
    `${CLI}/contact/subcommands/unhide/execute.ts:3`,
    `${CLI}/contact/internal/visibility.ts:31`,
    `${CLI}/contact/internal/visibility.ts:48`,
    `${CLI}/contact/internal/write.ts:40`,
    `${SDK}/parties/contacts.ts:170`,
    `${PROTOCOL}/parties/operations.ts:118`,
  ],
  priority: "normal",
  implementedBy: rpc_parties_contacts_unhide,
  acceptance: frozenClaims("contact.unhide"),
  returns: Schema.Struct({
    id: Contact.fields.id, // The contact's PartyId.
    hidden: Contact.fields.hidden, // false.
  }),
  errors: [error_CLI_USAGE],
  refusals: refusals("contact.unhide"),
});

// ── contact bank add ────────────────────────────────────────────────────────────────────────

// contact/subcommands/bank/subcommands/add/execute.ts: reads `--input` (:24), lists the book with
// hidden contacts and resolves the selector, through `targets.resolve` when no label or PartyId
// matches (:26, bank/internal/selection.ts:44), reads `bankAccounts.requirements` for the currency's
// fields (:27), checks the request keys agree (:28, bank/.../request.ts:9), then
// `client.account.bankAccounts.add` (:30), which forwards one row, parties.accounts.add (sdk
// parties/accounts.ts:56). It prints the BankAccount.
export const operation_contact_bank_add = defineOperation({
  ...frozenText("contact.bank.add"),
  was: [
    page("contact.bank.add"),
    `${CLI}/contact/subcommands/bank/subcommands/add/command.ts:17`,
    `${CLI}/contact/subcommands/bank/subcommands/add/execute.ts:24`,
    `${CLI}/contact/subcommands/bank/subcommands/add/execute.ts:26`,
    `${CLI}/contact/subcommands/bank/subcommands/add/execute.ts:27`,
    `${CLI}/contact/subcommands/bank/subcommands/add/execute.ts:28`,
    `${CLI}/contact/subcommands/bank/subcommands/add/execute.ts:30`,
    `${CLI}/contact/subcommands/bank/internal/selection.ts:44`,
    `${CLI}/bank/subcommands/accounts/internal/request.ts:9`,
    `${CLI}/bank/subcommands/accounts/internal/scope.ts:6`,
    `${SDK}/parties/accounts.ts:56`,
    `${PROTOCOL}/parties/accounts-operations.ts:29`,
    `${PROTOCOL}/parties/accounts-schema.ts:64`,
  ],
  priority: "normal",
  implementedBy: rpc_parties_accounts_add,
  acceptance: frozenClaims("contact.bank.add"),
  returns: Schema.Struct({
    partyAccountId: BankAccount.fields.partyAccountId, // The saved bank account's ID.
    state: BankAccount.fields.state, // `active`, `saved` or `inactive`.
    currency: BankAccount.fields.currency, // `usd`, `eur` or `gbp`.
    recipient: BankAccount.fields.recipient, // The contact it belongs to, and whether they are on Capxul.
  }),
  errors: [error_CLI_USAGE],
  refusals: refusals("contact.bank.add"),
});

// ── document get ────────────────────────────────────────────────────────────────────────────

// document/subcommands/get/execute.ts: checks both hashes (document/internal/shared.ts:10), then
// `client.paymentDocuments.get` (:20), which decodes the pair and forwards one row,
// activity.documents.get (sdk activity/documents.ts:87). The row belongs to the activity concept
// (protocol activity/operations.ts:144), not documents. A reply for another pair is CLI_USAGE
// (shared.ts:20). It prints the ref, the media type and the signature status, never the bytes (:26).
// s18.6 (s18:216) reaches CLI_USAGE on an empty devnet, which no world names.
export const operation_document_get = defineOperation({
  ...frozenText("document.get"),
  was: [
    page("document.get"),
    `${CLI}/document/subcommands/get/command.ts:6`,
    `${CLI}/document/subcommands/get/execute.ts:20`,
    `${CLI}/document/subcommands/get/execute.ts:26`,
    `${CLI}/document/internal/shared.ts:10`,
    `${CLI}/document/internal/shared.ts:20`,
    `${SDK}/activity/documents.ts:64`,
    `${SDK}/activity/documents.ts:87`,
    `${PROTOCOL}/activity/operations.ts:144`,
    `${PROTOCOL}/documents/read-schema.ts:46`,
    "packages/scenarios/src/acme/s18-dana-reads-her-payment-surface.scenario.ts:89",
    "packages/scenarios/src/acme/s18-dana-reads-her-payment-surface.scenario.ts:216",
  ],
  priority: "normal",
  implementedBy: rpc_activity_documents_get,
  acceptance: frozenClaims("document.get"),
  returns: Schema.Struct({
    ref: Schema.Struct({
      documentHash: DocumentRef.fields.documentHash,
      contentHash: DocumentRef.fields.contentHash,
      kind: DocumentRef.fields.kind,
      format: DocumentRef.fields.format,
      issuedAt: DocumentRef.fields.issuedAt,
    }), // The document's kind, format, issue time, document hash and content hash.
    mediaType: MediaType, // Its media type.
    signatureStatus: SignatureStatus, // `absent`, `verified` or `opaque`.
  }),
  errors: [error_CLI_USAGE],
  refusals: refusals("document.get"),
});

// ── document verify ─────────────────────────────────────────────────────────────────────────

// document/subcommands/verify/execute.ts: checks both hashes, then `client.paymentDocuments.verify`
// (:18), which forwards one row, activity.documents.verify (sdk activity/documents.ts:88). It prints
// the row's verification. s18.8 (s18:265) reaches INVALID_INPUT on an empty devnet, which no world names.
export const operation_document_verify = defineOperation({
  ...frozenText("document.verify"),
  was: [
    page("document.verify"),
    `${CLI}/document/subcommands/verify/command.ts:6`,
    `${CLI}/document/subcommands/verify/execute.ts:18`,
    `${CLI}/document/internal/shared.ts:10`,
    `${CLI}/document/internal/shared.ts:20`,
    `${SDK}/activity/documents.ts:88`,
    `${PROTOCOL}/activity/operations.ts:151`,
    `${PROTOCOL}/documents/read-schema.ts:60`,
    "packages/scenarios/src/acme/s18-dana-reads-her-payment-surface.scenario.ts:89",
    "packages/scenarios/src/acme/s18-dana-reads-her-payment-surface.scenario.ts:265",
  ],
  priority: "normal",
  implementedBy: rpc_activity_documents_verify,
  acceptance: frozenClaims("document.verify"),
  returns: Schema.Struct({
    ok: Schema.Boolean, // Whether the document verified against its hashes.
    signatureStatus: SignatureStatus, // `verified`, `absent` or `opaque`.
    documentHash: Schema.String, // The document hash checked.
    contentHash: Schema.String, // The content hash checked.
  }),
  errors: [error_CLI_USAGE],
  refusals: refusals("document.verify"),
});

// ── document render ─────────────────────────────────────────────────────────────────────────

// document/subcommands/render/execute.ts: checks both hashes, then `client.paymentDocuments.render`
// (:15), which forwards one row, activity.documents.render (sdk activity/documents.ts:89), and saves
// the HTML and a PDF it prints in a headless browser into a new private folder (saveDocumentPdf, :19,
// platform/documents.ts:69). As is, `document` carries the hashes, the PDF and HTML paths, the media
// type and the byte length (platform/documents.ts:130); the `kind` the page names is not printed.
// s18.12 (s18:389) reaches CLI_USAGE on an empty devnet, which no world names.
export const operation_document_render = defineOperation({
  ...frozenText("document.render"),
  was: [
    page("document.render"),
    `${CLI}/document/subcommands/render/command.ts:6`,
    `${CLI}/document/subcommands/render/execute.ts:15`,
    `${CLI}/document/subcommands/render/execute.ts:19`,
    `${CLI}/document/internal/shared.ts:10`,
    "apps/cli/src/platform/documents.ts:69",
    "apps/cli/src/platform/documents.ts:79",
    "apps/cli/src/platform/documents.ts:90",
    "apps/cli/src/platform/documents.ts:114",
    "apps/cli/src/platform/documents.ts:130",
    `${SDK}/activity/documents.ts:89`,
    `${PROTOCOL}/activity/operations.ts:158`,
    `${PROTOCOL}/documents/read-schema.ts:68`,
    "packages/scenarios/src/acme/s18-dana-reads-her-payment-surface.scenario.ts:89",
    "packages/scenarios/src/acme/s18-dana-reads-her-payment-surface.scenario.ts:389",
  ],
  priority: "normal",
  implementedBy: rpc_activity_documents_render,
  acceptance: frozenClaims("document.render"),
  returns: Schema.Struct({
    document: Schema.Struct({
      documentHash: Schema.String,
      contentHash: Schema.String,
      path: Schema.String,
      htmlPath: Schema.String,
      mediaType: Schema.Literal("application/pdf"),
      byteLength: Schema.Number,
    }), // The saved PDF's path, with its kind, document hash and content hash.
  }),
  // CLI_USAGE for a hash or a mismatched reply; CLI_STORAGE when a folder or file cannot be written;
  // CLI_DEFECT when the hashes are not lower-case hex (documents.ts:79) or the PDF cannot be produced (:114).
  errors: [error_CLI_USAGE, error_CLI_STORAGE, error_CLI_DEFECT],
  refusals: refusals("document.render"),
});

// ── document export ─────────────────────────────────────────────────────────────────────────

// document/subcommands/export/execute.ts: checks both hashes and a nonempty `--out` (:13), then
// `client.paymentDocuments.get` (:16), the same SDK method and row as `document get`
// (activity.documents.get), and writes the bytes with `wx` and mode 0600: an existing file is CLI_USAGE
// (:25), any other write failure CLI_STORAGE (:27). s18.10 (s18:329) reaches CLI_USAGE on an empty
// devnet, which no world names.
export const operation_document_export = defineOperation({
  ...frozenText("document.export"),
  was: [
    page("document.export"),
    `${CLI}/document/subcommands/export/command.ts:13`,
    `${CLI}/document/subcommands/export/execute.ts:13`,
    `${CLI}/document/subcommands/export/execute.ts:16`,
    `${CLI}/document/subcommands/export/execute.ts:25`,
    `${CLI}/document/subcommands/export/execute.ts:27`,
    `${CLI}/document/subcommands/export/execute.ts:35`,
    `${SDK}/activity/documents.ts:87`,
    `${PROTOCOL}/activity/operations.ts:144`,
    `${PROTOCOL}/documents/read-schema.ts:46`,
    "packages/scenarios/src/acme/s18-dana-reads-her-payment-surface.scenario.ts:89",
    "packages/scenarios/src/acme/s18-dana-reads-her-payment-surface.scenario.ts:329",
  ],
  priority: "normal",
  implementedBy: rpc_activity_documents_get,
  acceptance: frozenClaims("document.export"),
  returns: Schema.Struct({
    path: Schema.String, // The new file's path.
    documentHash: Schema.String, // The document hash.
    contentHash: Schema.String, // The content hash.
    mediaType: MediaType, // The file's media type.
    byteLength: Schema.Number, // How many bytes were written.
  }),
  errors: [error_CLI_USAGE, error_CLI_STORAGE],
  refusals: refusals("document.export"),
});
