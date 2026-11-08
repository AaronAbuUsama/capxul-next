// The target requests concept's tables, its two state machines and each machine's one event (P7).
//
// Asking to be paid. A request is the issuer's receivable: one row in `requests`, whoever pays it
// (a payer on Capxul from their inbox, a payer outside Capxul into an invoice escrow at the link, or
// a bank deposit matched to it), and one durable process per request (processes.ts). A
// fixed-price service is a row in `services` with immutable `service-revisions`; buying one at its
// link births a request of kind `purchase`, so every way of being paid is one request and one
// escrow path. Every judgment here is a record in ./decisions.ts.
//
// Ids: `req_<ulid>`, `svc_<ulid>`. Times are epoch milliseconds. Addresses, hashes and v4 payment
// ids are lowercase hex strings. Amounts are raw token units as decimal strings. Every table is
// its issuer's or owner's (tenancy owner: `owner_kind` and `owner_id` lead the key and every index
// but the few marked crossTenant, each of which says why).

import { Schema } from "effect";
import { defineEvent, defineMachine, defineTable } from "../../../packages/book/src/index.ts";
import { concept_requests } from "../shared/foundation.ts";

const R = "packages/backend/src/requests";
const T = `${R}/tables.ts`;
const AS_IS = "docs/as-is/archive/requests/data.ts";

const S = Schema.String;
const N = Schema.Number;
const NullOr = Schema.NullOr;

const KEPT =
  "Kept for good: a request is the record of what was owed and how it was paid; payments, documents and book facts point at it.";

/** Who owns a row: the person or Organization that issued the request or offers the service. */
export const OwnerKind = Schema.Literals(["person", "organization"]);

/** What is asked for: a basic request (a Memo), an Invoice (an envelope with lines and a due date), or a service bought at its link. */
export const RequestKind = Schema.Literals(["request", "invoice", "purchase"]);

/** Who pays: a Party on Capxul (pays from its inbox), an email not on Capxul (pays into the escrow), or nobody named yet (a link). */
export const PayerKind = Schema.Literals(["capxul", "outside", "none"]);

export const REQUEST_STATES = ["open", "paying", "paid", "declined", "cancelled", "expired"] as const;
export const RequestStatus = Schema.Literals(REQUEST_STATES);
export const REQUEST_TRANSITIONS = [
  "issue",
  "bind_payer",
  "pay",
  "fund",
  "reopen",
  "settle",
  "unsettle",
  "match",
  "decline",
  "cancel",
  "expire",
] as const;

export const SERVICE_STATES = ["active", "inactive"] as const;
export const ServiceStatus = Schema.Literals(SERVICE_STATES);
export const SERVICE_TRANSITIONS = ["create", "revise", "deactivate"] as const;

// ── requests ────────────────────────────────────────────────────────────────────────────────

export const table_requests = defineTable({
  id: "requests",
  title: "Requests: what an issuer is owed, and how it was paid",
  about:
    "One row per request to be paid: a basic request, an Invoice, or a service bought at its link. Owned by its issuer (a " +
    "person, or an Organization through a wearer of its Invoicing hat). Its terms are frozen at birth: the token, the exact " +
    "raw amount, the reference, the Safe paid into (`issuer_safe`) and, once its payer is known, the document stored " +
    "through `documents.store` whose hash every payment of it carries. The payer is a Safe: a Party on Capxul (a person's " +
    "Safe or a company Safe) pays from its inbox; an email not on Capxul is named by its email Safe (CompaniesHouseClaimer's " +
    "pure `safeAddressFor`), which owns the request's invoice escrow at the address `EscrowFactory.predictAddress(terms, " +
    "salt)` fixes; a link request names no payer until one names their email at the link. `chain_payment_id` is the " +
    "v4 payment id that pays it (from `payments.prepare-command`, or the escrow's `predictPaymentId`), `payment_id` the " +
    "Payment payments holds for it, `deposit_id` the bank deposit matched to it. `escrow_received_raw` is what the request's own process last read the escrow to hold. Replaces old " +
    "paymentRequests and offerCheckouts; old invoiceCheckoutPayments, the receipt, consumption and verification columns, " +
    "the link token, Money Invoices and every pre-v4 envelope and settlement column are dropped (decisions).",
  was: [`${T}:13`, `${T}:112`, `${AS_IS}:62`, `${AS_IS}:219`],
  concept: concept_requests,
  tenancy: "owner",
  tenantField: "owner_kind",
  scope:
    "The issuer's (`owner_kind` with `owner_id`); the row policy also admits the payer, by the tenant that owns " +
    "`payer_safe` in parties' directory, to read it (requests.owner-tenancy).",
  admits: [
    {
      match: "safe",
      field: "payer_safe",
      reads: true,
      writes: false,
      about:
        "The addressed payer reads the request in its inbox (`by_payer_created`); its pay and decline are the inbox rpcs', " +
        "which check the payer Safe is theirs, not this clause's (requests.owner-tenancy admits reads).",
    },
  ],
  fields: Schema.Struct({
    owner_kind: OwnerKind,
    /** The person's principal id, or the Organization's `org_<ulid>`. */
    owner_id: S,
    request_id: S,
    /** The issuer's idempotency key: one request per owner and key. A checkout purchase's key is the buyer's. */
    request_key: S,
    kind: RequestKind,
    status: RequestStatus,
    issuer_party_id: S,
    /** Where the money lands: the person's Safe, or the company Safe. */
    issuer_safe: S,
    payer_kind: PayerKind,
    /** The payer's Party when they are on Capxul; null for an outside email or a link. */
    payer_party_id: NullOr(S),
    /** The payer's mailbox as the issuer or the buyer gave it, for the notices; null when a handle named the payer. */
    payer_email: NullOr(S),
    /** The Safe the inbox is keyed by, and the owner of the escrow for an outside payer; null until a link names one. */
    payer_safe: NullOr(S),
    asset_id: S,
    token_address: S,
    decimals: N,
    amount_raw: S,
    /** 1 to 120 characters: what it is for. */
    reference: S,
    /** Up to 280 characters, private to the issuer and the payer. */
    note: NullOr(S),
    /** An Invoice's lines and due date; null for a basic request. */
    invoice: NullOr(
      Schema.Struct({
        due_at: NullOr(N),
        lines: Schema.Array(Schema.Struct({ description: S, quantity: N, unit_amount_raw: S })),
      }),
    ),
    /** The document `documents.store` returned, and its hash, which the payment and the escrow carry; null until the payer is known. */
    document_id: NullOr(S),
    document_hash: NullOr(S),
    expires_at: NullOr(N),
    /** A purchase: the service, the revision bought and how many. */
    service_id: NullOr(S),
    service_revision: NullOr(N),
    quantity: NullOr(N),
    /** An outside payer's invoice escrow: its predicted address, the salt, its payout's predicted v4 payment id. */
    escrow_address: NullOr(S),
    escrow_salt: NullOr(S),
    escrow_received_raw: NullOr(S),
    escrow_checked_at: NullOr(N),
    payout_tx_hash: NullOr(S),
    /** The Payment (payments' id) that pays it now or paid it, once payments holds one. */
    payment_id: NullOr(S),
    /** The v4 payment id that pays it: fixed by `payments.prepare-command` for an inbox payment, by `predictPaymentId` for an escrow. */
    chain_payment_id: NullOr(S),
    /** The payer's request key for the live inbox attempt: the same key resumes it, a fresh one waits until it ends. */
    pay_key: NullOr(S),
    deposit_id: NullOr(S),
    /** The principal who paid, declined, cancelled or matched it. */
    decided_by: NullOr(S),
    decided_at: NullOr(N),
    created_at: N,
    updated_at: N,
  }),
  key: ["owner_kind", "owner_id", "request_id"],
  indexes: [
    {
      name: "by_owner_created",
      fields: ["owner_kind", "owner_id", "created_at", "request_id"],
      for: "`request list`: the requests this issuer issued, newest first, paged by the cursor.",
    },
    {
      name: "by_owner_key",
      fields: ["owner_kind", "owner_id", "request_key"],
      unique: true,
      for: "`request issue` and a checkout purchase: one request per owner and request key; a repeat returns the same request.",
    },
    {
      name: "by_owner_open_token",
      fields: ["owner_kind", "owner_id", "status", "token_address", "created_at"],
      for: "`bank match`: the issuer's open requests in a credited deposit's token, the candidates it lists and checks.",
    },
    {
      name: "by_owner_reference",
      fields: ["owner_kind", "owner_id", "reference"],
      for: "The deposit auto-match: the one open request a credited deposit's payer reference names.",
    },
    {
      name: "by_payer_created",
      fields: ["payer_safe", "created_at", "request_id"],
      crossTenant: true,
      for: "`inbox list` and `inbox get`: the requests addressed to the reader's Safe (a person's or a company Safe), newest first; the payer is another tenant than the issuer.",
    },
    {
      name: "by_request",
      fields: ["request_id"],
      unique: true,
      crossTenant: true,
      for: "The checkout page by its link (`/pay/<request id>`, no session) and the payment followers' lookup of a request by id.",
    },
    {
      name: "by_chain_payment",
      fields: ["chain_payment_id"],
      unique: true,
      crossTenant: true,
      for: "The payment followers: the request a settled, reversed or cancelled Payment pays, by the v4 payment id its row carries.",
    },
    {
      name: "by_service_created",
      fields: ["service_id", "created_at"],
      crossTenant: true,
      for: "The checkout's rate limit: how many purchases of one service its link started in the last minute.",
    },
  ],
  retention: KEPT,
});

// ── services ────────────────────────────────────────────────────────────────────────────────

export const table_services = defineTable({
  id: "services",
  title: "Fixed-price services a person or Organization offers",
  about:
    "One row per fixed-price service (the old code's Offer; the frozen returns still call its id `offerId`). Created once " +
    "per owner and request key (`terms_digest` is the hash of the canonical terms a repeat must match), revised by freezing " +
    "the next revision at the expected one (`revision` is the current), and deactivated once, never reactivated. A buyer " +
    "at its link buys its current revision, which births a purchase request (`requests`). Replaces old fixedOffers.",
  was: [`${T}:130`, `${AS_IS}:345`, `${R}/offers/writes.ts:100`],
  concept: concept_requests,
  tenancy: "owner",
  tenantField: "owner_kind",
  fields: Schema.Struct({
    owner_kind: OwnerKind,
    owner_id: S,
    service_id: S,
    request_key: S,
    terms_digest: S,
    revision: N,
    status: ServiceStatus,
    created_at: N,
    updated_at: N,
  }),
  key: ["owner_kind", "owner_id", "service_id"],
  indexes: [
    {
      name: "by_owner_created",
      fields: ["owner_kind", "owner_id", "created_at", "service_id"],
      for: "`service list`: the owner's services in creation order, paged by the cursor.",
    },
    {
      name: "by_owner_key",
      fields: ["owner_kind", "owner_id", "request_key"],
      unique: true,
      for: "`service create`: one service per owner and request key; the same key and terms return the same service.",
    },
    {
      name: "by_service",
      fields: ["service_id"],
      unique: true,
      crossTenant: true,
      for: "The service's checkout page by its link (`/buy/<service id>`, no session): whether it is still sold.",
    },
  ],
  retention: KEPT,
});

export const table_service_revisions = defineTable({
  id: "service-revisions",
  title: "Service revisions: each revision's frozen terms",
  about:
    "One immutable row per revision of a service: its title, description, unit label, unit price (token and exact raw " +
    "amount), the quantity range a buyer may take and the Safe it pays into, as they were when the revision was frozen. " +
    "Never changed or deleted, so every earlier revision is kept and a purchase points at the one it bought. It carries " +
    "its owner's tenant columns itself (no tenancy by join). Replaces old fixedOfferRevisions.",
  was: [`${T}:144`, `${AS_IS}:378`, `${R}/offers/writes.ts:48`],
  concept: concept_requests,
  tenancy: "owner",
  tenantField: "owner_kind",
  fields: Schema.Struct({
    owner_kind: OwnerKind,
    owner_id: S,
    service_id: S,
    revision: N,
    title: S,
    description: NullOr(S),
    unit_label: S,
    asset_id: S,
    token_address: S,
    decimals: N,
    unit_amount_raw: S,
    quantity_min: N,
    quantity_max: N,
    recipient_safe: S,
    created_at: N,
  }),
  key: ["owner_kind", "owner_id", "service_id", "revision"],
  indexes: [
    {
      name: "by_service_revision",
      fields: ["service_id", "revision"],
      unique: true,
      crossTenant: true,
      for: "The checkout page's terms: a service's current revision read by its link, with no session.",
    },
  ],
  retention: KEPT,
});

// ── the request's life ──────────────────────────────────────────────────────────────────────

export const event_request_transitioned = defineEvent({
  id: "request_transitioned",
  about:
    "A request changed state: issued, its payer named at the link, being paid, paid, back open, declined, cancelled or " +
    "expired. `from` is null at its birth. Notices follow it (issued, paid) and so does the funnel. It never carries the " +
    "amount, the reference, the note or the payer's mailbox. Replaces old invoice_issued and invoice_request_transitioned.",
  props: Schema.Struct({
    from: NullOr(RequestStatus),
    to: RequestStatus,
    transition: Schema.Literals(REQUEST_TRANSITIONS),
    request_id: S,
    owner_kind: OwnerKind,
    owner_id: S,
    kind: RequestKind,
    payer_kind: PayerKind,
  }),
  was: [`${R}/events.ts:87`, `${R}/events.ts:138`],
});

export const machine_request = defineMachine({
  id: "request",
  title: "A request: open until it is paid, declined, cancelled or expires",
  about:
    "`requests.status`. A request is born open (issued, or bought at a service's link). Its payer pays it from their inbox " +
    "(paying, with the Payment it births), or funds its escrow (paying, once the escrow holds the amount), or a bank deposit " +
    "is matched to it (paid). Its Payment settling makes it paid; a cancelled Payment puts it back open; a reorg that " +
    "reverses its Payment puts it back to paying. The payer may decline an open request; the issuer may cancel an open or expired one. An escrow that already " +
    "held the amount when its request was cancelled or expired still pays out, and the request reads paid (the designed " +
    "text of `request cancel`). Its one process (processes.ts) drives the transitions nobody asks for; the rpcs drive the " +
    "ones a person makes. The old derived states (draft, viewed, sent, scheduled, pending_settlement) are gone.",
  was: [`${T}:16`, `${R}/rules/lifecycle.ts:74`, `${AS_IS}:428`],
  table: table_requests,
  field: "status",
  initial: "open",
  states: [
    { id: "open", about: "Issued and waiting for its payer: in their inbox, or at its link with its escrow." },
    { id: "paying", about: "Being paid: the payment it birthed waits for its approval, its date or the chain, or its funded escrow is paying out." },
    { id: "paid", about: "Paid: its payment settled, its escrow paid out, or a bank deposit was matched to it.", terminal: true },
    { id: "declined", about: "Its payer turned it down; no payment was born.", terminal: true },
    { id: "cancelled", about: "Its issuer withdrew it; nothing is written on chain. An escrow that already held the amount still pays out." },
    { id: "expired", about: "Its expiry passed while open; it can still be cancelled, and an escrow that held the amount still pays out." },
  ],
  transitions: {
    issue: {
      from: [],
      to: "open",
      about: "Birth: `request issue`, or a buyer at a service's link (a purchase), with its document when its payer is known.",
      guard: "A new request key for this owner; a valid payer, token and amount; an Invoice names a payer that is not a bare address.",
      emits: [event_request_transitioned],
    },
    bind_payer: {
      from: ["open"],
      to: "open",
      about: "A payer at a link request's checkout names their email: the request now names its payer, document and escrow.",
      guard: "The request names no payer yet; the email is well formed.",
      emits: [event_request_transitioned],
    },
    pay: {
      from: ["open"],
      to: "paying",
      about: "The payer pays from their inbox: the payment is born through `payments.prepare-command` in the same transaction.",
      guard: "The addressed payer; no escrow; not expired; the date, if any, at least an hour ahead.",
      emits: [event_request_transitioned],
    },
    fund: {
      from: ["open"],
      to: "paying",
      about: "The request's process read its escrow holding at least the amount: it is deployed and paid out.",
      guard: "An outside payer's escrow request; the token balance at the escrow address is at least `amount_raw`.",
      emits: [event_request_transitioned],
    },
    reopen: {
      from: ["paying"],
      to: "open",
      about: "The Payment it birthed was cancelled: its approval declined or rejected, or its dated payment voided or cancelled.",
      guard: "Followed from payments' `cancel`; only the request's current Payment. A lapsed one stays paying: `inbox pay --resume` retries it.",
      emits: [event_request_transitioned],
    },
    settle: {
      from: ["paying", "cancelled", "expired"],
      to: "paid",
      about: "Its Payment settled: an inbox payment, or the escrow's payout, which payments births from the indexed PaymentSent.",
      guard: "The payment id is the request's; a cancelled or expired request settles only from an escrow that held the amount when it ended.",
      emits: [event_request_transitioned],
    },
    unsettle: {
      from: ["paid"],
      to: "paying",
      about: "A reorg reversed the payment that paid it: it waits for that payment again.",
      guard: "Followed from payments' `unsettle` of the request's Payment; never for a request paid by a bank deposit.",
      emits: [event_request_transitioned],
    },
    match: {
      from: ["open"],
      to: "paid",
      about: "A credited bank deposit is matched to it (`bank match`, or the auto-match by reference); no Payment is born.",
      guard: "The deposit is the owner's, credited and unmatched, in the request's token, for at least its amount; no payment in flight.",
      emits: [event_request_transitioned],
    },
    decline: {
      from: ["open"],
      to: "declined",
      about: "The addressed payer turns it down (`inbox decline`).",
      guard: "The addressed payer (an Organization's through its Invoicing hat); not expired.",
      emits: [event_request_transitioned],
    },
    cancel: {
      from: ["open", "expired"],
      to: "cancelled",
      about: "The issuer withdraws it (`request cancel`); nothing is written on chain.",
      guard: "Its issuer (an Organization's through its Invoicing hat); not being paid.",
      emits: [event_request_transitioned],
    },
    expire: {
      from: ["open"],
      to: "expired",
      about: "Its process's timer reached `expires_at` while it was open.",
      emits: [event_request_transitioned],
    },
  },
});

// ── the service's life ──────────────────────────────────────────────────────────────────────

export const event_service_transitioned = defineEvent({
  id: "service_transitioned",
  about:
    "A service was created, revised or deactivated. `from` is null at its birth; a revision is active to active with its " +
    "new `revision`, so each revision is reported once, in order. It never carries the price, title, description or unit " +
    "label. Replaces old service_changed.",
  props: Schema.Struct({
    from: NullOr(ServiceStatus),
    to: ServiceStatus,
    transition: Schema.Literals(SERVICE_TRANSITIONS),
    service_id: S,
    revision: N,
    owner_kind: OwnerKind,
    owner_id: S,
  }),
  was: [`${R}/offers/events.ts:53`],
});

export const machine_service = defineMachine({
  id: "service",
  title: "A service: sold until it is deactivated",
  about:
    "`services.status`. Born active at revision 1; each revision freezes new terms and keeps it active; deactivating stops it " +
    "selling for good. A deactivated service refuses revision and new purchases, and its owner still reads it. Replaces " +
    "the old boolean `active`.",
  was: [`${T}:137`, `${AS_IS}:543`],
  table: table_services,
  field: "status",
  initial: "active",
  states: [
    { id: "active", about: "Sold: a buyer at its link buys its current revision." },
    { id: "inactive", about: "Deactivated: no longer sold, and never revised again.", terminal: true },
  ],
  transitions: {
    create: {
      from: [],
      to: "active",
      about: "Birth at revision 1 with its first revision row (`service create`).",
      guard: "A new request key for this owner; terms within their limits; the owner's Safe is known.",
      emits: [event_service_transitioned],
    },
    revise: {
      from: ["active"],
      to: "active",
      about: "The next revision is frozen at the expected revision (`service revise`); every earlier one is kept.",
      guard: "The caller read the current revision; the service is active.",
      emits: [event_service_transitioned],
    },
    deactivate: {
      from: ["active"],
      to: "inactive",
      about: "It stops selling (`service deactivate`); its revision does not change.",
      guard: "The caller read the current revision. An inactive service is returned as it is and nothing is sent.",
      emits: [event_service_transitioned],
    },
  },
});
