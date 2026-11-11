// The old requests concept's tables and the state machines that live on them, as the old code
// has them (factory, branch integration/factory). Evidence, not the target design.
//
// Tables: packages/backend/src/requests/tables.ts, registered in packages/backend/convex/schema.ts:83-84.
// Five tables: paymentRequests, invoiceCheckoutPayments, offerCheckouts, fixedOffers, fixedOfferRevisions.
// Machines: every status or state field a writer moves. Transitions are named to_<state>; `from` lists
// every state an old write moves the field from. A write that leaves the field unchanged (a self-loop)
// is not listed; a birth (an insert) has no source state and is said in `about`. Several states of a
// request are never written by any code: they are derived at read time, and each says so.

import { Schema } from "effect";
import { defineMachine, defineTable } from "../../../packages/book/src/index.ts";
import { concept_requests } from "../shared/foundation.ts";
import { event_invoice_request_transitioned, event_service_changed } from "../shared/vocabulary.ts";

const B = "packages/backend/src/requests";
const T = `${B}/tables.ts`;

const KEPT = "Kept indefinitely: no job in the old code deletes or expires these rows.";

const opt = Schema.optionalKey;
const S = Schema.String;
const N = Schema.Number;

const ActorKind = Schema.Literals(["account", "organization"]);

/** `observationContextValidator` (packages/backend/src/platform/observation/validators.ts:4). */
const ObservationContext = Schema.Struct({
  application: opt(S),
  applicationId: opt(S),
  release: opt(S),
  sessionId: opt(S),
  organizationId: opt(S),
  journeyId: opt(S),
  correlationId: opt(S),
  anonymousId: opt(S),
  traceparent: opt(S),
});

/** `paymentRequests.status` (tables.ts:16): every literal the validator admits. */
const PAYMENT_REQUEST_STATUSES = [
  "draft",
  "sent",
  "viewed",
  "pending_settlement",
  "paid",
  "declined",
  "expired",
  "cancelled",
] as const;

/** `paymentRequests.invoiceReceiptVerification` (tables.ts:54); absent reads as `unpaid`. */
const RECEIPT_VERIFICATIONS = ["unpaid", "verified", "orphaned", "unavailable"] as const;

// ── tables ──────────────────────────────────────────────────────────────────────────────────

export const table_payment_requests = defineTable({
  id: "payment-requests",
  title: "Payment requests: requests and Invoices an issuer is owed",
  about:
    "One row per request to be paid (the Receivables ledger, Financial Ops G5 #548): money OWED to the issuer, the inverse " +
    "of a Payment. A row is owned by a person (`ownerAuthUserId`) and issued by an Account or an Organization " +
    "(`issuerActorKind` `account` or `org`; rows written before requests named their issuer carry neither). It freezes its " +
    "terms at issuance: an Invoice's envelope input, document hashes and issuer Safe (`invoice*`), or a named basic request's " +
    "private Memo snapshot (`requestInstructionJson`, `requestDocumentHash`, `requestContentHash`); an unaddressed link's Memo " +
    "is frozen when its first payer prepares it. A Money Invoice (`amountKind` `money`, envelope-v5) binds gross fiat " +
    "(`moneyMinorUnits`) to a bank receiving account. An Invoice or (on Protocol v4) a basic request to an email not on " +
    "Capxul carries the escrow its email Safe owns (`invoiceEscrow*`, ADR-0035, CAP-1213). The link checkout's receipt, " +
    "receipt history, consumption and verification live on the row (`invoiceReceipt*`, `invoiceConsumptionJson`); they are " +
    "used for basic requests too, despite the name. Payments reads this table directly (payments/writes/births.ts:45, :79) " +
    "and Documents reads it directly (documents/reads/movements.ts:85). `observationContext` is the stored client linkage. " +
    "Tenancy is mixed: the issuer is an Account or an Organization, and the payer side reads rows by `payerPartyId`.",
  was: [
    `${T}:13`,
    `${T}:92`,
    "packages/backend/convex/schema.ts:83",
    `${B}/model.ts:23`,
    `${B}/README.md:3`,
    "packages/backend/src/payments/writes/births.ts:45",
    "packages/backend/src/documents/reads/movements.ts:85",
  ],
  concept: concept_requests,
  tenancy: "owner",
  tenantField: "issuerActorId",
  scope:
    "An Organization's rows by `issuerActorKind` `org` and `issuerActorId`; an Account's by `ownerAuthUserId` (its actor id " +
    "is the auth user), filtered to rows whose issuer is that Account (reads/requests.ts:92). Payers reach rows through " +
    "`payerPartyId`; link holders through `linkToken`.",
  fields: Schema.Struct({
    paymentRequestId: S,
    ownerAuthUserId: S,
    status: Schema.Literals(PAYMENT_REQUEST_STATUSES),
    issuerActorKind: opt(Schema.Literals(["account", "org"])),
    issuerActorId: opt(S),
    issuerPartyId: S,
    amountKind: opt(Schema.Literals(["asset", "money"])),
    currency: S,
    assetId: opt(S),
    tokenAddress: opt(S),
    amountValue: S,
    decimals: N,
    rawAmount: opt(S),
    moneyMinorUnits: opt(S),
    receivingAccountId: opt(S),
    reference: S,
    payerLabel: opt(S),
    payerPartyId: opt(S),
    requestInstructionJson: opt(S),
    requestDocumentHash: opt(S),
    requestContentHash: opt(S),
    invoiceDocumentHash: opt(S),
    invoiceContentHash: opt(S),
    invoiceFormat: opt(Schema.Literals(["envelope-v3", "envelope-v4", "envelope-v5"])),
    invoiceDocumentInputJson: opt(S),
    invoiceSettlementId: opt(S),
    invoiceReceiptJson: opt(S),
    invoiceReceiptHistoryJson: opt(S),
    invoiceConsumptionJson: opt(S),
    invoiceReceiptVerification: opt(Schema.Literals(RECEIPT_VERIFICATIONS)),
    invoiceReceiptFinalJson: opt(S),
    invoicePayerActorKind: opt(ActorKind),
    invoicePayerActorId: opt(S),
    invoiceIssuerSafe: opt(S),
    invoiceOriginActorKind: opt(ActorKind),
    invoiceOriginActorId: opt(S),
    invoiceEscrowOwnerSafe: opt(S),
    invoiceEscrowAddress: opt(S),
    invoiceEscrowProtocol: opt(Schema.Literal("v4")),
    invoiceEscrowState: opt(Schema.Literals(["waiting", "closed"])),
    invoiceEscrowReceivedRaw: opt(S),
    invoiceEscrowPayoutTx: opt(S),
    invoiceEscrowCheckedAt: opt(N),
    memo: opt(S),
    linkToken: S,
    entitlementGranted: Schema.Boolean,
    settledPaymentId: opt(S),
    settledDepositRef: opt(S),
    journeyId: opt(S),
    observationContext: opt(ObservationContext),
    approvedAt: opt(N),
    approvedByAuthUserId: opt(S),
    declinedAt: opt(N),
    declinedByAuthUserId: opt(S),
    cancelledAt: opt(N),
    expiresAt: opt(N),
    createdAt: N,
    updatedAt: N,
  }),
  key: ["paymentRequestId"],
  indexes: [
    {
      name: "by_payment_request_id",
      fields: ["paymentRequestId"],
      crossTenant: true,
      for:
        "One request by id: loadRequestById (reads/requests.ts:19), the birth checks (reads/births.ts:65, writes/invoices.ts:188), " +
        "the escrow record (writes/escrows.ts:71), registered receipts (writes/receipts.ts:249) and Payments (payments/writes/births.ts:45).",
    },
    {
      name: "by_owner",
      fields: ["ownerAuthUserId"],
      crossTenant: true,
      for: "Whether a person still owns any request, for an operator purge (reads/purges.ts:25).",
    },
    {
      name: "by_owner_created",
      fields: ["ownerAuthUserId", "createdAt"],
      crossTenant: true,
      for: "An Account's issued requests, newest first, then filtered to Account-issued rows (reads/requests.ts:103).",
    },
    {
      name: "by_issuer_actor_created",
      fields: ["issuerActorKind", "issuerActorId", "createdAt"],
      crossTenant: true,
      for: "An Organization's issued requests, newest first (reads/requests.ts:96); an Account actor id for an operator purge (reads/purges.ts:32).",
    },
    {
      name: "by_issuer_party_created",
      fields: ["issuerPartyId", "createdAt"],
      crossTenant: true,
      for: "An issuer Party's open Invoices in a bank deposit's denomination, 20 a page with a row filter (reads/deposits.ts:51).",
    },
    {
      name: "by_issuer_reference",
      fields: ["issuerPartyId", "reference"],
      crossTenant: true,
      for: "The one request an issuer's reference names, for a bank deposit's reference match (reads/deposits.ts:104).",
    },
    {
      name: "by_payer_party_created",
      fields: ["payerPartyId", "createdAt"],
      crossTenant: true,
      for: "One page of a payer's Inbox, newest first (reads/requests.ts:126); a payer Party for an operator purge (reads/purges.ts:46).",
    },
    {
      name: "by_payer_party_status",
      fields: ["payerPartyId", "status", "createdAt"],
      crossTenant: true,
      for: "A payer's open requests (draft, sent, viewed) for the home's requests to pay, #2379 (reads/requests.ts:149).",
    },
    {
      name: "by_request_document",
      fields: ["requestDocumentHash", "requestContentHash"],
      crossTenant: true,
      for: "The request that froze one Memo: its read access (reads/documents.ts:38) and its checkout link (reads/links.ts:68).",
    },
    {
      name: "by_invoice_document",
      fields: ["invoiceDocumentHash", "invoiceContentHash"],
      crossTenant: true,
      for:
        "The requests that issued one Invoice: read access (reads/documents.ts:77), display (:130), checkout link (reads/links.ts:58); " +
        "by document hash alone, whether a generic birth reuses an issued Invoice (reads/attempts.ts:39).",
    },
    {
      name: "by_invoice_escrow_state",
      fields: ["invoiceEscrowState", "invoiceEscrowCheckedAt"],
      crossTenant: true,
      for: "The 25 least recently read waiting escrows the minute sweep reads (reads/waiting-escrows.ts:32).",
    },
    {
      name: "by_link_token",
      fields: ["linkToken"],
      crossTenant: true,
      for: "The request a bearer link names, for any link holder (loadRequestByLink, reads/requests.ts:43).",
    },
  ],
  retention:
    "Kept indefinitely: no job deletes or expires a row. An operator purge only asks which request tables still name a " +
    "person (readPersonRequestReferencesInTx) and keeps this history.",
});

export const table_invoice_checkout_payments = defineTable({
  id: "invoice-checkout-payments",
  title: "Invoice checkout Payments: each Payment born to pay a request",
  about:
    "The link between a payment request and each Payment born to fund it through its link or approval. Requests never " +
    "inserts a row: Payments inserts it directly while a request or Invoice birth creates its Payment " +
    "(payments/commands/writes/items.ts:210), a write into a table Requests owns. Requests reads it for every attempt of a " +
    "request (requestPaymentIds) and for the request one verified Payment paid (recordRegisteredRequestReceiptInTx). No " +
    "business key: rows are found by Payment or by request.",
  was: [`${T}:109`, `${T}:110`, `${B}/reads/invoices.ts:79`, `${B}/writes/receipts.ts:231`, "packages/backend/src/payments/commands/writes/items.ts:210"],
  concept: concept_requests,
  tenancy: "global",
  scope: "No tenant column: the request it names carries the issuer, and the Payment the payer.",
  fields: Schema.Struct({ paymentRequestId: S, paymentId: S }),
  key: ["paymentId"],
  indexes: [
    {
      name: "by_payment",
      fields: ["paymentId"],
      for: "The request one verified Payment funded (writes/receipts.ts:239).",
    },
    {
      name: "by_request",
      fields: ["paymentRequestId"],
      for: "Every Payment attempt of one request (requestPaymentIds, reads/invoices.ts:85).",
    },
  ],
  retention: KEPT,
});

export const table_offer_checkouts = defineTable({
  id: "offer-checkouts",
  title: "Offer checkouts: one wallet's frozen purchase of an Offer revision",
  about:
    "A wallet-funded purchase of a fixed-price Offer revision, frozen once by its UUID v4 purchase key: the canonical " +
    "request (`requestJson`), the funding wallet, the OfferCheckout snapshot (`snapshotJson`: contract, settlement id, " +
    "amount, Memo reference) and the Memo envelope (`documentJson`). Once paid it keeps the verified receipt and the " +
    "receipts a proved reorg replaced (`receiptJson`, `receiptHistoryJson`). A registered payer's Payment for it is " +
    "recorded in `registeredPaymentId`. Anyone holding the checkout id reads it; it names no owner of its own.",
  was: [`${T}:112`, `${T}:125`, `${B}/writes/purchases.ts:191`, `${B}/writes/purchases.ts:261`, `${B}/writes/purchase-receipts.ts:106`],
  concept: concept_requests,
  tenancy: "global",
  scope: "No tenant column: the seller is the owner of the Offer `offerId` names; the buyer is only a wallet.",
  fields: Schema.Struct({
    checkoutId: S,
    offerId: S,
    requestKey: S,
    requestJson: S,
    sourceWallet: S,
    snapshotJson: S,
    documentJson: S,
    receiptJson: opt(S),
    receiptHistoryJson: opt(S),
    registeredPaymentId: opt(S),
    createdAt: N,
  }),
  key: ["checkoutId"],
  indexes: [
    {
      name: "by_checkout",
      fields: ["checkoutId"],
      for: "One purchase by id (loadPurchaseRow, reads/purchases.ts:55; offerCheckoutBirthIdentity, reads/births.ts:126).",
    },
    {
      name: "by_registered_payment",
      fields: ["registeredPaymentId"],
      for: "The purchase a verified registered Payment funded (writes/purchase-receipts.ts:134).",
    },
    {
      name: "by_offer_key",
      fields: ["offerId", "requestKey"],
      for: "A replay of a purchase key on one Offer (writes/purchases.ts:92).",
    },
    {
      name: "by_offer_created",
      fields: ["offerId", "createdAt"],
      for: "One Offer's purchases in the last minute: at most 100 (writes/purchases.ts:72).",
    },
    {
      name: "by_wallet_created",
      fields: ["sourceWallet", "createdAt"],
      for: "One wallet's purchases in the last minute: at most 10 (writes/purchases.ts:64).",
    },
  ],
  retention: KEPT,
});

export const table_fixed_offers = defineTable({
  id: "fixed-offers",
  title: "Fixed-price Offers (services) an Account or Organization sells",
  about:
    "One row per fixed-price Offer (the product word is service; the wire and the code say Offer). Created once per owner " +
    "request key (`creationJson` is the canonical draft a replay must match), revised by freezing a new revision row at the " +
    "expected revision (`revision` is the current one), and deactivated (`active` false, never reactivated). Owned by an " +
    "Account (`actorKind` `account`, `actorId` the auth user) or an Organization (`org`, the orgId).",
  was: [`${T}:130`, `${T}:141`, `${B}/offers/writes.ts:100`, `${B}/offers/writes.ts:146`, `${B}/offers/writes.ts:160`],
  concept: concept_requests,
  tenancy: "owner",
  tenantField: "actorId",
  scope: "The owner is `actorKind` and `actorId` together.",
  fields: Schema.Struct({
    offerId: S,
    actorKind: Schema.Literals(["account", "org"]),
    actorId: S,
    requestKey: S,
    creationJson: S,
    revision: N,
    active: Schema.Boolean,
    createdAt: N,
    updatedAt: N,
  }),
  key: ["offerId"],
  indexes: [
    {
      name: "by_offer",
      fields: ["offerId"],
      crossTenant: true,
      for: "One Offer by id, for its owner and for any link holder (loadOfferRow, reads/offers.ts:19).",
    },
    {
      name: "by_actor",
      fields: ["actorKind", "actorId"],
      crossTenant: true,
      for: "An owner's Offers (listOwnedOffers, reads/offers.ts:35); an Account actor for an operator purge (reads/purges.ts:39).",
    },
    {
      name: "by_actor_key",
      fields: ["actorKind", "actorId", "requestKey"],
      crossTenant: true,
      for: "A replay of an owner's create request key (offers/writes.ts:86).",
    },
  ],
  retention: KEPT,
});

export const table_fixed_offer_revisions = defineTable({
  id: "fixed-offer-revisions",
  title: "Fixed-price Offer revisions: each revision's frozen terms",
  about:
    "One immutable row per revision of an Offer: its terms (`termsJson`, the draft with the normalized unit amount), the " +
    "recipient Safe the owner was paid into when it was frozen, the exact raw unit amount, decimals and token. Every Offer has " +
    "a row for its current revision; a missing one is a defect (UNKNOWN). Never patched or deleted.",
  was: [`${T}:144`, `${T}:153`, `${B}/offers/writes.ts:48`, `${B}/reads/offers.ts:40`],
  concept: concept_requests,
  tenancy: "owner",
  scope: "By join: the Offer `offerId` names carries its owner.",
  fields: Schema.Struct({
    offerId: S,
    revision: N,
    termsJson: S,
    recipientSafe: S,
    rawUnitAmount: S,
    decimals: N,
    tokenAddress: S,
    createdAt: N,
  }),
  key: ["offerId", "revision"],
  indexes: [
    {
      name: "by_offer_revision",
      fields: ["offerId", "revision"],
      for: "One revision of an Offer: its current terms for every view and purchase (loadRevision, reads/offers.ts:43).",
    },
  ],
  retention: KEPT,
});

// ── machines ────────────────────────────────────────────────────────────────────────────────

export const machine_payment_request = defineMachine({
  id: "payment-request",
  title: "Payment request status",
  about:
    "paymentRequests.status. The pure rule assertTransition (rules/lifecycle.ts:74) admits collect and decline from sent or " +
    "viewed and cancel from draft, sent or viewed; decline and collect treat a lapsed expiry as expired, cancel ignores it. " +
    "Birth: issueRequestInTx inserts every request `sent` (writes/requests.ts:149). No code writes draft, viewed or expired: " +
    "expiry is derived at read time (isExpired, rules/lifecycle.ts:50). No code writes paid for a crypto payment: a request " +
    "paid through its approval stays pending_settlement and one paid through its link stays sent; both read paid through " +
    "currentRequest, which follows the Payment and the link receipt (reads/instructions.ts:21). A request whose dated Payment " +
    "waits reads `scheduled`, and one whose dated Payment failed or was cancelled reads `sent` again (requestStatusOf, ADR-0034 " +
    "ruling 7A); neither is stored. An Invoice already pending_settlement whose earlier attempts all failed is approved again " +
    "as if sent (writes/approvals.ts:97), a self-loop not listed. Only a bank deposit writes paid.",
  was: [`${T}:16`, `${B}/rules/lifecycle.ts:33`, `${B}/rules/lifecycle.ts:74`, `${B}/model.ts:5`, "packages/protocol/src/requests/status.ts:2"],
  table: table_payment_requests,
  field: "status",
  initial: "sent",
  states: [
    { id: "draft", about: "Admitted by the validator and by cancel and deposit candidates; never written by any code." },
    { id: "sent", about: "Issued and waiting for its payer; every request is born here. A link-paid request stays here and reads paid." },
    { id: "viewed", about: "Admitted by the validator and the rules; never written by any code." },
    { id: "pending_settlement", about: "Its payer approved it and its Payment was prepared; reads paid once that Payment settles." },
    { id: "paid", about: "Written only when a bank deposit fulfills it exactly; a correction never moves it back.", terminal: true },
    { id: "declined", about: "Its payer turned it down; no Payment was created.", terminal: true },
    { id: "expired", about: "Never written: a request past `expiresAt` reads expired while not pending_settlement, paid, declined or cancelled." },
    { id: "cancelled", about: "Its issuer withdrew it. Nothing is written on chain, so a funded escrow still pays out (CAP-1212).", terminal: true },
  ],
  transitions: {
    to_pending_settlement: {
      from: ["sent", "viewed"],
      to: "pending_settlement",
      about:
        "The payer's approval prepares its Payment in the same transaction (prepareApprovedRequest, writes/approvals.ts:129), from " +
        "requests.inboxes.approve or Payments' confirmed-request prepare (prepareConfirmedRequestInTx); stamps settledPaymentId, approvedAt.",
      guard:
        "assertTransition collect on the current status, unexpired; a request already pending_settlement or paid with an earlier " +
        "Payment replays it instead; an asset request only; no stream release.",
      emits: [event_invoice_request_transitioned],
    },
    to_paid: {
      from: ["sent", "viewed"],
      to: "paid",
      about:
        "Banking links one credited bank deposit to the exact obligation (matchBankDepositInTx, writes/deposits.ts:111): paid, " +
        "entitlementGranted, settledDepositRef; an Invoice schedules its paid notice.",
      guard: "assertTransition collect; no earlier Payment attempt, receipt or verified receipt; the deposit matches the Invoice's gross or net terms.",
      emits: [],
    },
    to_declined: {
      from: ["sent", "viewed"],
      to: "declined",
      about: "The addressed payer declines (declineRequestInTx, writes/requests.ts:226); stamps declinedAt and declinedByAuthUserId.",
      guard: "assertTransition decline on the current status, unexpired; only the payer the request names, or anyone for an unaddressed link.",
      emits: [event_invoice_request_transitioned],
    },
    to_cancelled: {
      from: ["draft", "sent", "viewed"],
      to: "cancelled",
      about: "The issuer withdraws it (cancelRequestInTx, writes/requests.ts:196); stamps cancelledAt.",
      guard: "assertTransition cancel on the current status (as currentRequest reads it), whatever its expiry; only its issuer.",
      emits: [event_invoice_request_transitioned],
    },
  },
});

export const machine_invoice_receipt = defineMachine({
  id: "invoice-receipt",
  title: "Request link receipt verification",
  about:
    "paymentRequests.invoiceReceiptVerification: what the last chain check found for the link checkout's receipt, of an " +
    "Invoice or a basic request alike. Absent reads as unpaid. Written only through fenced compare-and-set mutations: the " +
    "verifying action's recordVerification writes whatever its check found, but only when it changed, a finalized receipt " +
    "is stamped, or a consumption is cleared (writes/receipts.ts:85); recordConsumption marks a link whose funding was consumed " +
    "under wrong terms unavailable (writes/receipts.ts:66); recordReceipt records a verified receipt (writes/receipts.ts:165). " +
    "Any state can follow any other.",
  was: [`${T}:54`, `${B}/writes/receipts.ts:66`, `${B}/writes/receipts.ts:85`, `${B}/writes/receipts.ts:165`, `${B}/rules/invoices.ts:121`],
  table: table_payment_requests,
  field: "invoiceReceiptVerification",
  initial: "unpaid",
  states: [
    { id: "unpaid", about: "No receipt holds: none recorded, or the check found the recorded one gone with its consumption cleared." },
    { id: "verified", about: "The recorded receipt is included and still proves the funding; in a finalized block it is stamped final." },
    { id: "orphaned", about: "The recorded receipt's block was replaced; a new receipt may be recorded once the replacement is proved." },
    { id: "unavailable", about: "The check could not decide, the receipt no longer matches a settled Payment, or a consumption is recorded." },
  ],
  transitions: {
    to_unpaid: {
      from: ["verified", "orphaned", "unavailable"],
      to: "unpaid",
      about: "recordVerification with an unpaid check, or clearing a consumption whose block was replaced (writes/receipts.ts:108).",
      emits: [],
    },
    to_verified: {
      from: ["unpaid", "orphaned", "unavailable"],
      to: "verified",
      about: "recordReceipt of a proved receipt (writes/receipts.ts:190, :213) or recordVerification with a verified check (:108).",
      guard: "The receipt pays the link's frozen terms; replacing a different recorded receipt needs a proved replaced block.",
      emits: [],
    },
    to_orphaned: {
      from: ["unpaid", "verified", "unavailable"],
      to: "orphaned",
      about: "recordVerification when the recorded receipt's occurrence was replaced (writes/receipts.ts:108).",
      emits: [],
    },
    to_unavailable: {
      from: ["unpaid", "verified", "orphaned"],
      to: "unavailable",
      about: "recordConsumption (writes/receipts.ts:77) or recordVerification with an unavailable check (:108).",
      guard: "Fenced: the row still holds the receipt and consumption the action read.",
      emits: [],
    },
  },
});

export const machine_invoice_escrow = defineMachine({
  id: "invoice-escrow",
  title: "Request escrow sweep state",
  about:
    "paymentRequests.invoiceEscrowState for a request whose payer is not on Capxul (ADR-0035; on v4 a basic request too, " +
    "CAP-1213). Birth: issuance writes `waiting` with the predicted escrow address (outsidePayerEscrowFields, " +
    "writes/escrows.ts:20). The minute sweep records each read (balance, payout transaction, checked time) and closes it " +
    "once paid out, or once the request is no longer open and the escrow holds less than the amount (writes/escrows.ts:58). " +
    "A closed escrow is never reopened or read again.",
  was: [`${T}:72`, `${B}/writes/escrows.ts:20`, `${B}/writes/escrows.ts:58`, `${B}/checkouts/external/escrows.ts:111`],
  table: table_payment_requests,
  field: "invoiceEscrowState",
  initial: "waiting",
  states: [
    { id: "waiting", about: "The sweep reads its balance every minute, least recently read first." },
    { id: "closed", about: "Paid out and settled through its link, or ended unfunded; never read again.", terminal: true },
  ],
  transitions: {
    to_closed: {
      from: ["waiting"],
      to: "closed",
      about: "recordEscrowReadInTx with close (writes/escrows.ts:74), from requests.checkouts.record-escrow.",
      guard: "Only a waiting escrow is written; a paid close schedules the paid notice.",
      emits: [],
    },
  },
});

export const machine_fixed_offer = defineMachine({
  id: "fixed-offer",
  title: "Fixed-price Offer active flag",
  about:
    "fixedOffers.active, a boolean: an Offer is born active (createOfferInTx, offers/writes.ts:100) and deactivated once " +
    "(deactivateOfferInTx, offers/writes.ts:160). A deactivated Offer is never reactivated, refuses revision (INVALID_INPUT " +
    "`service is inactive`) and new purchases, and reads null to link holders. States are the stored boolean values.",
  was: [`${T}:137`, `${B}/offers/writes.ts:100`, `${B}/offers/writes.ts:152`, `${B}/offers/writes.ts:160`],
  table: table_fixed_offers,
  field: "active",
  initial: "true",
  states: [
    { id: "true", about: "Sold: link holders read it and buy its current revision." },
    { id: "false", about: "Deactivated: no longer sold; its owner still reads it.", terminal: true },
  ],
  transitions: {
    to_false: {
      from: ["true"],
      to: "false",
      about: "requests.offers.deactivate at the expected revision; an Offer already inactive is returned unchanged and reports no change.",
      guard: "The owner's Offer, at the revision the caller read.",
      emits: [event_service_changed],
    },
  },
});
