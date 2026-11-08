// The requests concept's own door, as it is: every function packages/backend/src/requests/index.ts
// exports that runs inside its caller's Convex context (it takes the caller's QueryCtx or MutationCtx,
// or reads only the deployment's settings, and throws CapxulErrors). Other concepts import these by
// subpath ("#requests/reads/…", "#requests/writes/…"). Two door exports are pure rules and are not
// booked: requestMemoSnapshot (rules/memos.ts:38, used by Documents and Payments) and
// assertConfirmedRequestBirth (rules/confirmations.ts:151, used by Payments).
//
// Reads and writes are transitive within requests: a procedure lists the tables its own helpers
// touch. Another concept's door function it calls is an `invokes`. Where the old code reads or writes
// another concept's table directly (Payments' payments, paymentCommands and moneyExecutions;
// Organizations' orgs; Accounts' accounts; Profiles' identities; Parties' parties; Documents'
// financialDocumentMovements), the record says so: that is the finding.
//
// Twelve of these stand in payments/neighbors.ts under the same id and export name.

import { Schema } from "effect";
import { defineProcedure } from "../../../packages/book/src/index.ts";

import { concept_requests } from "../shared/foundation.ts";
import {
  error_ENV_MISSING,
  error_INVALID_INPUT,
  error_NOT_IMPLEMENTED,
  error_ROLE_PERMISSION_DENIED,
  error_UNKNOWN,
  error_WRONG_STATE,
  event_invoice_request_transitioned,
} from "../shared/vocabulary.ts";
import {
  machine_invoice_receipt,
  machine_payment_request,
  table_fixed_offers,
  table_invoice_checkout_payments,
  table_offer_checkouts,
  table_payment_requests,
} from "./data.ts";
import { table_money_executions, table_payment_commands, table_payments } from "../payments/data.ts";
import {
  procedure_payments_actor_inventory,
  procedure_payments_prepare_payment_command_in_tx,
  procedure_payments_replay_request_payment_approval_in_tx,
  procedure_payments_voided_by_landed_void_in_tx,
} from "../payments/procedures.ts";
import { procedure_access_can_read_scope_in_tx, procedure_access_read_scope_safe_address_in_tx } from "../access/procedures.ts";
import { procedure_accounts_require_payment_account_in_tx } from "../accounts/procedures.ts";
import { table_accounts } from "../accounts/data.ts";
import {
  procedure_documents_link_movement_document_in_tx,
  procedure_documents_persist_payment_document,
  procedure_documents_prepare_movement_memo_in_tx,
} from "../documents/procedures.ts";
import { table_financial_document_movements } from "../documents/data.ts";
import {
  procedure_organizations_read_organization_name_by_party_in_tx,
  procedure_organizations_read_organization_party_id_in_tx,
  procedure_organizations_require_org_participant,
} from "../organizations/procedures.ts";
import { table_orgs } from "../organizations/data.ts";
import {
  procedure_parties_party_by_safe_address,
  procedure_parties_resolve_recipient_in_tx,
} from "../parties/procedures.ts";
import { table_parties } from "../parties/data.ts";
import { procedure_profiles_read_profile_party_id_in_tx } from "../profiles/procedures.ts";
import { table_identities } from "../profiles/data.ts";

const B = "packages/backend/src";
const R = `${B}/requests`;
const DOOR = `${R}/index.ts`;

const opt = Schema.optionalKey;
const S = Schema.String;
const U = Schema.Unknown;
const NullOr = Schema.NullOr;

const none = { drives: [], invokes: [], emits: [] } as const;

// ── shapes the door's callers pass ─────────────────────────────────────────────────────────

/** `ReadScopePrincipal` (#access/model): the signed-in person reading. */
const Principal = Schema.Struct({ authUserId: S, accountId: S });
/** A Payment command of kind `birth` (`PaymentCommandSchema`); too deep to transcribe. */
const Birth = U;
/** `PrepareInvoiceCheckoutExecutionInputSchema` (checkout-schema.ts:109). */
const LinkCheckoutInput = Schema.Struct({ linkToken: S, payer: U, permissionId: opt(S), signerAddress: S });
/** `PrepareOfferCheckoutExecutionInputSchema` (offer-schema.ts:232). */
const OfferCheckoutInput = Schema.Struct({ checkoutId: S, payer: U, permissionId: opt(S), signerAddress: S });
/** `BankDepositRequestFacts` (reads/deposits.ts:9). */
const DepositFacts = Schema.Struct({
  ownerPartyId: S,
  receivingAccountId: S,
  gross: Schema.Struct({ currency: S }),
  net: Schema.Struct({ assetId: S, safe: S }),
  cursor: opt(S),
});
/** `candidate` (reads/deposits.ts:29): one open Invoice a deposit may pay. */
const DepositCandidate = Schema.Struct({
  requestId: S,
  reference: S,
  dueAt: Schema.Number,
  payerPartyId: opt(S),
  payerLabel: opt(S),
  amount: Schema.Union([
    Schema.Struct({ currency: S, value: S, decimals: Schema.Number }),
    Schema.Struct({ asset: S, value: S }),
  ]),
});
/** A Payment birth's identity (origin id, settlement id, v3 identity, issue time); undefined for another lineage. */
const BirthIdentity = Schema.UndefinedOr(U);

// ── shared touches ─────────────────────────────────────────────────────────────────────────

/**
 * `currentRequest` (reads/instructions.ts:21): a request with a receipt follows the Payment that funded it
 * (`invoiceReceiptStillPaid`, reads/invoices.ts:146: its attempts, each Payment and its command); one with an
 * approval follows its settled Payment. Both read Payments' tables directly.
 */
const CURRENT_READS = [table_payments, table_payment_commands, table_invoice_checkout_payments];
const CURRENT_WAS = [`${R}/reads/instructions.ts:21`, `${R}/reads/instructions.ts:45`, `${R}/reads/invoices.ts:146`, `${R}/reads/invoices.ts:96`];

/** `partyIdForActor` (reads/requests.ts:50): the Party that stands for an Account or an Organization. */
const PARTY_OF_ACTOR = [procedure_organizations_read_organization_party_id_in_tx, procedure_profiles_read_profile_party_id_in_tx];

// ── documents' reads ───────────────────────────────────────────────────────────────────────

export const procedure_requests_issued_invoice_read_access = defineProcedure({
  id: "requests.issued-invoice-read-access",
  title: "Who may read an issued Invoice or Memo",
  about:
    "Issued request content belongs to its issuer and its immutable named debtor. A frozen Memo is checked first " +
    "(`issuedMemoReadAccess`): `participant` when the principal reads the issuer (the owner for an Account issuer, " +
    "`canReadScopeInTx` for an Organization) or is the payer Party, directly by identity or as a reader of the Organization " +
    "whose Party it is. Then the Invoice: the issuer, or the payer actor through `canReadScopeInTx`, or for an escrow Invoice " +
    "only the person who claimed the payer's email Party. `restricted` otherwise; `not_issued` when no request froze the " +
    "document. It reads Profiles' `identities` and Organizations' `orgs` directly. Documents' guards and reads and Payments' " +
    "retry preview ask it.",
  was: [
    `${DOOR}:9`,
    `${R}/reads/documents.ts:24`,
    `${R}/reads/documents.ts:30`,
    `${R}/reads/documents.ts:45`,
    `${R}/reads/documents.ts:55`,
    `${R}/reads/documents.ts:67`,
    `${R}/reads/documents.ts:84`,
    `${B}/documents/guards.ts:12`,
    `${B}/payments/lifecycles/reads/retries.ts:28`,
  ],
  concept: concept_requests,
  input: Schema.Struct({ principal: Principal, documentHash: S, contentHash: S }),
  output: Schema.Literals(["participant", "restricted", "not_issued"]),
  errors: [],
  reads: [table_payment_requests, table_identities, table_orgs],
  writes: [],
  drives: [],
  invokes: [procedure_access_can_read_scope_in_tx],
  emits: [],
});

export const procedure_requests_request_invoice_display_context = defineProcedure({
  id: "requests.request-invoice-display-context",
  title: "How an issued Invoice names its parties",
  about:
    "For an Invoice envelope (message kind 1) whose stored request matches its issuer Safe and origin id: the public names of " +
    "the issuer and payer Parties (an Organization's name, else the Party's display name or handle) when each Party's Safe is " +
    "the one the Invoice names, and the escrow address a customer not on Capxul pays. An empty object otherwise. It reads " +
    "Parties' `parties` rows directly; the payer Safe comes from Access's `readScopeSafeAddressInTx`. The document read has " +
    "already checked access and integrity. Documents' party read asks it.",
  was: [
    `${DOOR}:9`,
    `${R}/reads/documents.ts:113`,
    `${R}/reads/documents.ts:121`,
    `${R}/reads/documents.ts:150`,
    `${R}/reads/documents.ts:166`,
    `${B}/documents/reads/parties.ts:167`,
  ],
  concept: concept_requests,
  input: Schema.Struct({ envelope: U, documentHash: S, contentHash: S }),
  output: Schema.Struct({
    from: opt(S),
    fromKind: opt(Schema.Literals(["account", "organization"])),
    to: opt(S),
    toKind: opt(Schema.Literals(["account", "organization"])),
    escrowAddress: opt(S),
  }),
  errors: [],
  reads: [table_payment_requests, table_parties],
  writes: [],
  drives: [],
  invokes: [procedure_organizations_read_organization_name_by_party_in_tx, procedure_access_read_scope_safe_address_in_tx],
  emits: [],
});

export const procedure_requests_document_checkout_origin = defineProcedure({
  id: "requests.document-checkout-origin",
  title: "The paired frontend origin every email link opens",
  about:
    "Reads only the deployment's settings, no table: `SITE_URL` names the paired frontend (staging native client, local " +
    "devnet, or the beta product app), and `CAPXUL_CHECKOUT_FRONTEND_ORIGIN` may name it too. A configured origin that differs " +
    "from the paired one is INVALID_INPUT (`checkoutFrontendOrigin`); none is ENV_MISSING; one the shared checkout URL " +
    "builder rejects is ENV_MISSING. Accounts' approval links and notices, Organizations' invitation email and Parties' " +
    "person invite call it, some from actions; it takes no context.",
  was: [
    `${DOOR}:19`,
    `${R}/reads/links.ts:26`,
    `${R}/errors/checkouts.ts:98`, `${R}/errors/checkouts.ts:101`,
    `${B}/accounts/approvals/reads.ts:113`,
    `${B}/accounts/approvals/reads/notices.ts:56`,
    `${B}/organizations/invitations/external.ts:52`,
    `${B}/parties/verifications/operations/deliver-person-invite.ts:23`,
  ],
  concept: concept_requests,
  input: Schema.Struct({ beta: opt(U) }),
  output: S,
  errors: [error_INVALID_INPUT, error_ENV_MISSING],
  reads: [],
  writes: [],
  ...none,
});

export const procedure_requests_document_checkout_link = defineProcedure({
  id: "requests.document-checkout-link",
  title: "The checkout link a stored request instruction carries",
  about:
    "Only an issued request's own instruction supplies a checkout reference: the Invoice link (`/checkout/invoices/<link>`) " +
    "for the request that issued the document, else the request link for the request whose frozen Memo it is; undefined for " +
    "any other document. The origin is `documentCheckoutOrigin`'s. A frozen Memo that does not decode is UNKNOWN. Documents' " +
    "content read asks it.",
  was: [`${DOOR}:10`, `${R}/reads/links.ts:53`, `${R}/reads/links.ts:60`, `${R}/reads/links.ts:68`, `${B}/documents/reads/contents.ts:116`],
  concept: concept_requests,
  input: Schema.Struct({ documentHash: S, contentHash: S }),
  output: Schema.UndefinedOr(S),
  errors: [error_INVALID_INPUT, error_ENV_MISSING, error_UNKNOWN],
  reads: [table_payment_requests],
  writes: [],
  drives: [],
  invokes: [procedure_requests_document_checkout_origin],
  emits: [],
});

// ── operator, accounts and banking reads ────────────────────────────────────────────────────

export const procedure_requests_read_person_request_references_in_tx = defineProcedure({
  id: "requests.read-person-request-references-in-tx",
  title: "The request tables that still name a person",
  about:
    "For an operator purge: whether any request is owned by one of the person's auth users, issued by one of their Account " +
    "actor ids, or addressed to one of their Parties, and whether any Offer is published by one of their Account actor ids. " +
    "Returns the names of the tables that still do (`paymentRequests`, `fixedOffers`), reading one row per index. Operator's " +
    "identity guard asks it.",
  was: [`${DOOR}:13`, `${R}/reads/purges.ts:12`, `${R}/reads/purges.ts:25`, `${R}/reads/purges.ts:39`, `${B}/operator/identities/guards.ts:46`],
  concept: concept_requests,
  input: Schema.Struct({ authUserIds: Schema.Array(S), actorIds: Schema.Array(S), partyIds: Schema.Array(S) }),
  output: Schema.Array(Schema.Literals(["paymentRequests", "fixedOffers"])),
  errors: [],
  reads: [table_payment_requests, table_fixed_offers],
  writes: [],
  ...none,
});

export const procedure_requests_list_request_ids_to_pay_in_tx = defineProcedure({
  id: "requests.list-request-ids-to-pay-in-tx",
  title: "The requests waiting on a scope to pay",
  about:
    "The home's requests to pay (#2379): the scope's Party, then its draft, sent and viewed requests by index, newest first, " +
    "each judged as its view judges it (`currentRequest`, then unexpired and still waiting). Empty when the scope has no Party " +
    "yet. A stored receipt that does not decode is UNKNOWN. Accounts' summaries read asks it.",
  was: [
    `${DOOR}:16`,
    `${R}/reads/requests.ts:50`,
    `${R}/reads/requests.ts:139`,
    `${R}/reads/requests.ts:149`,
    `${R}/rules/lifecycle.ts:43`,
    ...CURRENT_WAS,
    `${B}/accounts/summaries/reads.ts:126`,
  ],
  concept: concept_requests,
  input: Schema.Struct({ actor: Schema.Struct({ kind: Schema.Literals(["account", "org"]), id: S }) }),
  output: Schema.Array(S),
  errors: [error_UNKNOWN],
  reads: [table_payment_requests, ...CURRENT_READS],
  writes: [],
  drives: [],
  invokes: PARTY_OF_ACTOR,
  emits: [],
});

export const procedure_requests_read_bank_deposit_match_candidates_in_tx = defineProcedure({
  id: "requests.read-bank-deposit-match-candidates-in-tx",
  title: "Open Invoices a bank deposit may pay",
  about:
    "One page of 20 of an issuer Party's Invoices still draft, sent or viewed in the deposit's denomination (a Money Invoice's " +
    "receiving account and currency, or an asset Invoice's asset and issuer Safe), filtered in the query, then judged current, " +
    "unexpired, still waiting and with no Payment attempt. Each candidate carries its reference, due date, payer and amount " +
    "from its frozen Invoice; a stored Invoice that does not decode is UNKNOWN. Banking's candidates operation asks it.",
  was: [
    `${DOOR}:24`,
    `${R}/reads/deposits.ts:22`,
    `${R}/reads/deposits.ts:29`,
    `${R}/reads/deposits.ts:48`,
    `${R}/reads/deposits.ts:51`,
    `${R}/rules/invoices.ts:75`,
    ...CURRENT_WAS,
    `${B}/banking/deposits/operations/candidates.ts:29`,
  ],
  concept: concept_requests,
  input: DepositFacts,
  output: Schema.Struct({ items: Schema.Array(DepositCandidate), nextCursor: NullOr(S) }),
  errors: [error_INVALID_INPUT, error_UNKNOWN],
  reads: [table_payment_requests, ...CURRENT_READS],
  writes: [],
  ...none,
});

export const procedure_requests_read_bank_deposit_request_by_reference_in_tx = defineProcedure({
  id: "requests.read-bank-deposit-request-by-reference-in-tx",
  title: "The one Invoice an issuer's reference names",
  about:
    "The issuer Party's request with exactly this reference, as a deposit candidate, only when exactly one row has it, it " +
    "carries an Invoice and no Payment attempt funded it; null otherwise. It does not check the status or expiry. Banking's " +
    "auto-match asks it.",
  was: [`${DOOR}:25`, `${R}/reads/deposits.ts:98`, `${R}/reads/deposits.ts:104`, `${R}/reads/invoices.ts:79`, `${B}/banking/deposits/operations/auto-match.ts:33`],
  concept: concept_requests,
  input: Schema.Struct({ ownerPartyId: S, reference: S }),
  output: NullOr(DepositCandidate),
  errors: [error_INVALID_INPUT, error_UNKNOWN],
  reads: [table_payment_requests, table_invoice_checkout_payments],
  writes: [],
  ...none,
});

export const procedure_requests_match_bank_deposit_in_tx = defineProcedure({
  id: "requests.match-bank-deposit-in-tx",
  title: "Pay an Invoice by one credited bank deposit",
  about:
    "Links one credited bank deposit to one exact obligation without creating a Payment. The request must be the deposit " +
    "owner's (else INVALID_INPUT `payment request not found`); the same deposit already recorded replays; another deposit is " +
    "WRONG_STATE; any Payment attempt, receipt or verified receipt is INVALID_INPUT; then assertTransition collect on the " +
    "stored status. A Money Invoice must match the deposit's gross (receiving account, currency, minor units, decimals) and " +
    "net Safe; an asset Invoice its net asset, token, raw amount, decimals and Safe; else INVALID_INPUT. Writes paid, " +
    "entitlementGranted and settledDepositRef, and for an Invoice schedules `requests.receivables.notify` with `paid`. " +
    "Returns the request id, reference and its stored linkage. Banking's matching write asks it.",
  was: [
    `${DOOR}:28`,
    `${R}/writes/deposits.ts:37`,
    `${R}/writes/deposits.ts:49`,
    `${R}/writes/deposits.ts:65`,
    `${R}/writes/deposits.ts:84`,
    `${R}/writes/deposits.ts:111`,
    `${R}/writes/deposits.ts:118`,
    `${R}/writes/notices.ts:29`,
    `${B}/banking/deposits/writes/matching.ts:77`,
  ],
  concept: concept_requests,
  input: Schema.Struct({
    requestId: S,
    receivingAccountId: S,
    ownerPartyId: S,
    gross: Schema.Struct({ currency: S, minorUnits: S, decimals: Schema.Number }),
    net: Schema.Struct({ assetId: S, tokenAddress: S, rawAmount: S, decimals: Schema.Number, safe: S }),
    bankDepositId: S,
    how: Schema.Literals(["reference", "manual"]),
  }),
  output: Schema.Struct({ requestId: S, reference: S, journeyId: opt(S), correlationId: opt(S), observationContext: opt(U) }),
  errors: [error_INVALID_INPUT, error_WRONG_STATE, error_UNKNOWN],
  reads: [table_payment_requests, table_invoice_checkout_payments],
  writes: [table_payment_requests],
  drives: [machine_payment_request.t.to_paid],
  invokes: [],
  emits: [],
});

// ── payments: attempts, births and notices ─────────────────────────────────────────────────

export const procedure_requests_invoice_attempt_in_tx = defineProcedure({
  id: "requests.invoice-attempt-in-tx",
  title: "Replay an Invoice attempt, or admit a fresh one",
  about:
    "Every Payment attempt of the request (its `invoiceCheckoutPayments` rows and its approval) with its Payment and command, " +
    "read directly from Payments' tables. The payer's attempt with this request key replays (its Payment id). Otherwise a new " +
    "attempt is WRONG_STATE (`requests.invoiceAttempt`, pending_settlement) when the request is paid, cancelled, declined or " +
    "expired, pending_settlement with no attempt, consumed, receipted or unavailable, or when any earlier attempt is not closed " +
    "failed: its command failed, its Payment failed, nothing settled, its verification failed or never started, and every " +
    "money execution ended from proof or was never sent. A scheduled attempt whose void landed is admitted (payments' own " +
    "`voidedByLandedVoidInTx`, ADR-0034 ruling 7A). A broken attempt row is UNKNOWN. Exported for Payments; today only " +
    "requests' own approval and Invoice birth call it.",
  was: [`${DOOR}:31`, `${R}/reads/attempts.ts:47`, `${R}/reads/attempts.ts:62`, `${R}/reads/attempts.ts:108`, `${R}/reads/invoices.ts:79`, `${R}/reads/invoices.ts:96`],
  concept: concept_requests,
  input: Schema.Struct({ row: U, payer: U, requestKey: S }),
  output: Schema.UndefinedOr(S),
  errors: [error_WRONG_STATE, error_UNKNOWN],
  reads: [table_invoice_checkout_payments, table_payments, table_payment_commands, table_money_executions],
  writes: [],
  drives: [],
  invokes: [procedure_payments_voided_by_landed_void_in_tx],
  emits: [],
});

export const procedure_requests_schedule_request_paid_notice_in_tx = defineProcedure({
  id: "requests.schedule-request-paid-notice-in-tx",
  title: "Schedule a request's paid notice",
  about:
    "As a Payment settles: when it pays a request (`requestFingerprint`), schedules Requests' internal action " +
    "`requests.receivables.notify` with `paid` at once (`runAfter(0)`); the notice reads the request's state, so only a paid " +
    "Invoice is announced. A Payment that pays no request schedules nothing. Writes no table itself. Payments' settlement, " +
    "claim, commitment, send verification and rail writers call it.",
  was: [
    `${DOOR}:34`,
    `${R}/writes/notices.ts:29`,
    `${R}/writes/notices.ts:48`,
    `${B}/payments/writes/settlements.ts:14`,
    `${B}/payments/verifications/writes/claims.ts:8`,
    `${B}/payments/verifications/writes/sends.ts:10`,
  ],
  concept: concept_requests,
  input: Schema.Struct({ payment: Schema.Struct({ requestFingerprint: opt(S) }) }),
  output: Schema.Void,
  errors: [],
  reads: [],
  writes: [],
  ...none,
});

export const procedure_requests_checkout_birth_terms_in_tx = defineProcedure({
  id: "requests.checkout-birth-terms-in-tx",
  title: "Read a checkout's birth request key and amount",
  about:
    "The request key and amount a registered payer's checkout Payment is born with: the frozen Offer purchase's (its checkout " +
    "id and snapshot amount), or the Invoice or request link's (the request id and amount; a Money request is INVALID_INPUT " +
    "`Pay this Invoice by bank transfer.`). Null when the checkout does not resolve; the birth refuses that itself. A stored " +
    "snapshot that does not decode is UNKNOWN. Payments' funding read uses it before the allowance and balance check.",
  was: [`${DOOR}:41`, `${R}/reads/births.ts:175`, `${R}/reads/purchases.ts:60`, `${R}/reads/invoices.ts:20`, `${B}/payments/commands/reads/funding.ts:14`],
  concept: concept_requests,
  input: Schema.Struct({ checkout: U }),
  output: NullOr(Schema.Struct({ requestKey: S, amounts: Schema.Array(Schema.Struct({ asset: S, value: S })) })),
  errors: [error_INVALID_INPUT, error_UNKNOWN],
  reads: [table_offer_checkouts, table_payment_requests],
  writes: [],
  ...none,
});

export const procedure_requests_offer_checkout_birth_identity = defineProcedure({
  id: "requests.offer-checkout-birth-identity",
  title: "Check a birth against its frozen Offer purchase",
  about:
    "For an `offer_checkout` birth: the checkout must exist (INVALID_INPUT `checkout is unavailable`), and the command must " +
    "carry exactly its stored facts (one quick-pay send keyed by the checkout id, the frozen sender and recipient Safes, " +
    "amount, Memo bytes and hashes), else INVALID_INPUT; envelope bytes that do not decode are INVALID_INPUT `invalid " +
    "document`. Returns the origin, settlement id, v3 identity (the purchase job nonce, executor zero) and issue time; " +
    "undefined for another lineage. Stored bytes that do not decode are UNKNOWN. Payments' item birth calls it.",
  was: [`${DOOR}:42`, `${R}/reads/births.ts:116`, `${R}/reads/births.ts:126`, `${R}/rules/settlements.ts:41`, `${B}/payments/commands/writes/items.ts:21`],
  concept: concept_requests,
  input: Schema.Struct({ command: Birth, senderSafe: S, recipientSafe: S }),
  output: BirthIdentity,
  errors: [error_INVALID_INPUT, error_UNKNOWN],
  reads: [table_offer_checkouts],
  writes: [],
  ...none,
});

export const procedure_requests_request_memo_birth_identity = defineProcedure({
  id: "requests.request-memo-birth-identity",
  title: "Check a birth against an issued request's Memo",
  about:
    "For a `payment_request` or `invoice_checkout` birth of a request with a frozen Memo: the command must carry exactly its " +
    "terms (one quick-pay item keyed by the request id, the Memo document, the issuer as recipient, the amount, and for a link " +
    "its link token), else INVALID_INPUT `command differs from issued request`; a request named to a payer Party must be paid " +
    "as that Party, else INVALID_INPUT `payer differs from addressed party`. Returns the origin, settlement id (the " +
    "budget-derived id when recorded, CAP-1252), v3 identity, issue time, Memo source and issuer Safe; undefined otherwise. It " +
    "reads Accounts' `accounts`, Organizations' `orgs` and Profiles' `identities` directly to name the issuer and payer. A " +
    "Money request is INVALID_INPUT; a frozen Memo that does not decode is UNKNOWN. Payments' item birth calls it.",
  was: [`${DOOR}:43`, `${R}/reads/births.ts:39`, `${R}/reads/births.ts:60`, `${R}/reads/births.ts:76`, `${R}/rules/memos.ts:38`, `${B}/payments/commands/writes/items.ts:21`],
  concept: concept_requests,
  input: Schema.Struct({ command: Birth }),
  output: BirthIdentity,
  errors: [error_INVALID_INPUT, error_UNKNOWN],
  reads: [table_payment_requests, table_accounts, table_orgs, table_identities],
  writes: [],
  ...none,
});

export const procedure_requests_invoice_birth_identity = defineProcedure({
  id: "requests.invoice-birth-identity",
  title: "Check a birth against its issued Invoice and fix its settlement id",
  about:
    "Only request-owned Invoice bytes select the named debtor's origin and the settlement identity. A birth outside a request, " +
    "or of a request with no Invoice, must not reuse an issued Invoice's document (`requireUnissuedInvoiceInTx`, INVALID_INPUT). " +
    "For a request birth with an issued Invoice the command must carry exactly its terms (one `invoice` item, the stored " +
    "envelope input, the issuer Safe, the amount, the payer actor, the link token and for a link the request id as key), else " +
    "INVALID_INPUT; a Money Invoice is INVALID_INPUT. A `payment_request` birth then passes `invoiceAttemptInTx` (WRONG_STATE " +
    "while an earlier attempt is open). The settlement identity is the earlier approval's Payment's (INVALID_INPUT when it is " +
    "incomplete or conflicts), else the recorded one, else the V3 id of the frozen terms on the current router; it is " +
    "patched onto the request (`invoiceSettlementId`). Payments' item birth calls it.",
  was: [
    `${DOOR}:45`,
    `${R}/writes/invoices.ts:176`,
    `${R}/writes/invoices.ts:214`,
    `${R}/reads/attempts.ts:21`,
    `${R}/reads/invoices.ts:32`,
    `${R}/rules/invoices.ts:75`,
    `${B}/payments/commands/writes/items.ts:20`,
  ],
  concept: concept_requests,
  input: Schema.Struct({ command: Birth, recipientSafe: S }),
  output: BirthIdentity,
  errors: [error_INVALID_INPUT, error_WRONG_STATE, error_ENV_MISSING, error_UNKNOWN],
  reads: [table_payment_requests, table_invoice_checkout_payments, table_payments, table_payment_commands, table_money_executions],
  writes: [table_payment_requests],
  drives: [],
  invokes: [procedure_requests_invoice_attempt_in_tx],
  emits: [],
});

export const procedure_requests_record_budget_settlement_in_tx = defineProcedure({
  id: "requests.record-budget-settlement-in-tx",
  title: "Record a v4 budget birth's settlement id on its request",
  about:
    "A request paid from a v4 budget (CAP-1252) pays under the id Budgets derives: the request records it at birth so its " +
    "checkout and status match that Payment. Nothing without a budget or an obligation, for another lineage, or when the same " +
    "id is already recorded; a different recorded id is overwritten. Payments' item birth calls it.",
  was: [`${DOOR}:45`, `${R}/writes/invoices.ts:230`, `${R}/writes/invoices.ts:248`, `${B}/payments/commands/writes/items.ts:20`],
  concept: concept_requests,
  input: Schema.Struct({ birth: Schema.Struct({ lineage: U, budget: U, obligation: U }), settlementId: S }),
  output: Schema.Void,
  errors: [],
  reads: [table_payment_requests],
  writes: [table_payment_requests],
  ...none,
});

// ── payments: the registered payer's Payment ───────────────────────────────────────────────

export const procedure_requests_prepare_confirmed_request_in_tx = defineProcedure({
  id: "requests.prepare-confirmed-request-in-tx",
  title: "Prepare the Payment a payer confirmed for a request",
  about:
    "Refuses NOT_IMPLEMENTED while the payment writer is disabled (payments' rule `requirePaymentWriterEnabled`). An " +
    "Organization payer must be a current participant (Organizations' `requireOrgParticipant`). Loads the request addressed " +
    "to the payer's Party (INVALID_INPUT otherwise), compares the payer's reviewed terms (payer Safe, issuer Safe, asset, raw " +
    "amount, decimals, instruction, no Permission for a person) with the issued request (INVALID_INPUT on a mismatch), then " +
    "`prepareApprovedRequest`: no stream release; the current request; an Invoice only for its named debtor; a replay of an " +
    "earlier Payment (payments' `replayRequestPaymentApprovalInTx`) when pending_settlement or paid, else assertTransition " +
    "collect and a new `payment_request` birth through payments' own `preparePaymentCommandInTx`, patching the request " +
    "pending_settlement with the Payment id. Re-reads the stored birth command from Payments' `paymentCommands` directly and " +
    "checks it is the request's (INVALID_INPUT), and on a first approval schedules `invoice_request_transitioned` " +
    "(`approval_prepared`). Payments' confirmed-request prepare calls it.",
  was: [
    `${DOOR}:46`,
    `${R}/writes/approvals.ts:57`,
    `${R}/writes/approvals.ts:129`,
    `${R}/writes/approvals.ts:141`,
    `${R}/writes/approvals.ts:157`,
    `${R}/writes/approvals.ts:209`,
    `${R}/reads/instructions.ts:127`,
    `${R}/reads/requests.ts:69`,
    ...CURRENT_WAS,
    `${B}/payments/commands/writes/requests.ts:28`,
  ],
  concept: concept_requests,
  input: Schema.Struct({ authUserId: S, confirmation: U }),
  output: Schema.Struct({ prepared: U, sourceCommand: U }),
  errors: [error_INVALID_INPUT, error_WRONG_STATE, error_ROLE_PERMISSION_DENIED, error_NOT_IMPLEMENTED, error_UNKNOWN],
  reads: [table_payment_requests, ...CURRENT_READS, table_money_executions],
  writes: [table_payment_requests],
  drives: [machine_payment_request.t.to_pending_settlement],
  invokes: [
    procedure_organizations_require_org_participant,
    ...PARTY_OF_ACTOR,
    procedure_accounts_require_payment_account_in_tx,
    procedure_access_read_scope_safe_address_in_tx,
    procedure_requests_invoice_attempt_in_tx,
    procedure_payments_replay_request_payment_approval_in_tx,
    procedure_payments_prepare_payment_command_in_tx,
  ],
  emits: [event_invoice_request_transitioned],
});

/**
 * `prepareRequestDocumentInTx` (writes/checkouts.ts:51) and `issueRequestMemo` (writes/memos.ts:31): an
 * unaddressed request's Memo frozen for its first payer, stored through Documents, with a v4 escrow for a payer
 * not on Capxul. The issuer's Account read is Accounts'.
 */
const FREEZE_MEMO = {
  invokes: [
    procedure_parties_resolve_recipient_in_tx,
    procedure_access_read_scope_safe_address_in_tx,
    procedure_accounts_require_payment_account_in_tx,
    procedure_documents_persist_payment_document,
  ],
  was: [`${R}/writes/checkouts.ts:51`, `${R}/writes/checkouts.ts:82`, `${R}/writes/memos.ts:31`, `${R}/writes/escrows.ts:20`],
};

/** `invoicePublicSummary` and `assertInvoiceOpen` (reads/checkouts.ts:88, :161): the link's public terms and status. */
const LINK_SUMMARY = {
  reads: [table_payment_requests, ...CURRENT_READS],
  invokes: [procedure_parties_party_by_safe_address],
  was: [`${R}/reads/checkouts.ts:53`, `${R}/reads/checkouts.ts:88`, `${R}/reads/checkouts.ts:161`, `${R}/reads/escrows.ts:82`, `${R}/reads/invoices.ts:32`],
};

export const procedure_requests_prepare_registered_request_in_tx = defineProcedure({
  id: "requests.prepare-registered-request-in-tx",
  title: "Prepare a registered payer's Payment for a request link",
  about:
    "Loads the request by its link (INVALID_INPUT `Invoice is unavailable` when gone; a Money request is INVALID_INPUT), " +
    "resolves the payer's Safe (Access's `readScopeSafeAddressInTx`; none is INVALID_INPUT), freezes an unaddressed request's " +
    "Memo for that Safe (resolves the payer through Parties, stores the Memo through Documents' `persistPaymentDocument`, " +
    "patches the request, and on v4 for an email payer the escrow fields), refuses a link that is not open (an escrow request " +
    "is paid only by a transfer into its escrow) and a personal payer naming a Permission, then either replays the payer's " +
    "private approval (reads its Payment and command from Payments' tables directly; INVALID_INPUT when the command is gone or " +
    "its authority differs) or prepares a new `invoice_checkout` birth through payments' own `preparePaymentCommandInTx`, the " +
    "issuer as recipient (an Account issuer's Account read from Accounts' `accounts` directly). Returns the public summary and " +
    "the prepared command. Payments' request checkout intent calls it.",
  was: [
    `${DOOR}:48`,
    `${R}/writes/checkouts.ts:87`,
    `${R}/writes/checkouts.ts:101`,
    `${R}/writes/checkouts.ts:142`,
    ...FREEZE_MEMO.was,
    ...LINK_SUMMARY.was,
    `${B}/payments/commands/writes/requests.ts:12`,
  ],
  concept: concept_requests,
  input: Schema.Struct({ authUserId: S, input: LinkCheckoutInput }),
  output: Schema.Struct({ invoice: U, prepared: U }),
  errors: [error_INVALID_INPUT, error_ENV_MISSING, error_UNKNOWN],
  reads: [...LINK_SUMMARY.reads, table_accounts],
  writes: [table_payment_requests],
  drives: [],
  invokes: [
    ...FREEZE_MEMO.invokes,
    ...LINK_SUMMARY.invokes,
    procedure_payments_prepare_payment_command_in_tx,
  ],
  emits: [],
});

export const procedure_requests_prepare_registered_invoice_in_tx = defineProcedure({
  id: "requests.prepare-registered-invoice-in-tx",
  title: "Prepare a registered payer's Payment for an Invoice link",
  about:
    "The same Payment as a request link, only for a link that names an issued Invoice (INVALID_INPUT `Invoice is unavailable` " +
    "otherwise). Payments' Invoice checkout intent calls it.",
  was: [`${DOOR}:48`, `${R}/writes/checkouts.ts:187`, `${R}/reads/invoices.ts:20`, `${B}/payments/commands/writes/requests.ts:12`],
  concept: concept_requests,
  input: Schema.Struct({ authUserId: S, input: LinkCheckoutInput }),
  output: Schema.Struct({ invoice: U, prepared: U }),
  errors: [error_INVALID_INPUT],
  reads: [table_payment_requests],
  writes: [],
  drives: [],
  invokes: [procedure_requests_prepare_registered_request_in_tx],
  emits: [],
});

export const procedure_requests_prepare_registered_purchase_in_tx = defineProcedure({
  id: "requests.prepare-registered-purchase-in-tx",
  title: "Prepare a registered payer's Payment for a frozen purchase",
  about:
    "A personal payer naming a Permission, a missing checkout or Offer are INVALID_INPUT. Prepares one quick-pay " +
    "`offer_checkout` birth keyed by the checkout id, to the Offer's owner (an Account owner's Account read from Accounts' " +
    "`accounts` directly; none is INVALID_INPUT), with the frozen Memo bytes, through payments' own `preparePaymentCommandInTx`, " +
    "then records the Payment on the checkout (`registeredPaymentId`); a checkout registered to another Payment is " +
    "INVALID_INPUT. A stored snapshot that does not decode is UNKNOWN. Payments' Offer checkout intent calls it.",
  was: [
    `${DOOR}:49`,
    `${R}/writes/purchases.ts:205`,
    `${R}/writes/purchases.ts:222`,
    `${R}/writes/purchases.ts:261`,
    `${R}/reads/purchases.ts:30`,
    `${B}/payments/commands/writes/requests.ts:13`,
  ],
  concept: concept_requests,
  input: Schema.Struct({ authUserId: S, input: OfferCheckoutInput }),
  output: Schema.Struct({ checkout: U, prepared: U }),
  errors: [error_INVALID_INPUT, error_UNKNOWN],
  reads: [table_offer_checkouts, table_fixed_offers, table_accounts],
  writes: [table_offer_checkouts],
  drives: [],
  invokes: [procedure_payments_prepare_payment_command_in_tx],
  emits: [],
});

export const procedure_requests_record_registered_receipt_in_tx = defineProcedure({
  id: "requests.record-registered-receipt-in-tx",
  title: "Project a verified Payment's receipt onto its link or purchase",
  about:
    "A verified registered `send` projects its first receipt onto the request it paid (found through `invoiceCheckoutPayments` " +
    "or the Payment's `requestFingerprint`, read from Payments' `payments` directly; an approval's Payment only for a request " +
    "with a frozen document) and onto the Offer checkout it funded, unless a different receipt is already there. Each recorded " +
    "receipt is checked against the frozen terms (INVALID_INPUT), marks the link's verification verified, and projects its " +
    "Movement's Memo: it names the Movement's actors through payments' own `actorInventory` and `desiredAttributions`, plans " +
    "and applies the Memo through Documents' `prepareMovementMemoInTx` (a conflict is INVALID_INPUT), links the instruction " +
    "through Documents' `linkMovementDocumentInTx`, and on a proved reorg correction patches the old occurrence `orphaned` in " +
    "Documents' `financialDocumentMovements` directly (`orphanOldMovement`). A purchase receipt's funding check reads the " +
    "registered Payment's command directly. A changed or unproved receipt is INVALID_INPUT; a broken stored row UNKNOWN. " +
    "Payments' verification evidence writer calls it.",
  was: [
    `${DOOR}:50`,
    `${R}/writes/purchase-receipts.ts:49`,
    `${R}/writes/purchase-receipts.ts:78`,
    `${R}/writes/purchase-receipts.ts:126`,
    `${R}/writes/receipts.ts:117`,
    `${R}/writes/receipts.ts:152`,
    `${R}/writes/receipts.ts:161`,
    `${R}/writes/receipts.ts:165`,
    `${R}/writes/receipts.ts:231`,
    ...LINK_SUMMARY.was,
    `${B}/payments/verifications/writes/evidence.ts:7`,
  ],
  concept: concept_requests,
  input: Schema.Struct({ paymentId: S, evidence: U }),
  output: Schema.Void,
  errors: [error_INVALID_INPUT, error_ENV_MISSING, error_UNKNOWN],
  reads: [...LINK_SUMMARY.reads, table_offer_checkouts, table_financial_document_movements],
  writes: [table_payment_requests, table_offer_checkouts, table_financial_document_movements],
  drives: [machine_invoice_receipt.t.to_verified],
  invokes: [
    ...LINK_SUMMARY.invokes,
    procedure_payments_actor_inventory,
    procedure_documents_prepare_movement_memo_in_tx,
    procedure_documents_link_movement_document_in_tx,
  ],
  emits: [],
});
