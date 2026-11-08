// The old banking concept's tables and the state machines that live on them, as the old code
// has them (factory, branch integration/factory). Evidence, not the target design.
//
// Tables: packages/backend/src/banking/tables.ts and tables/payouts.ts, registered in
// packages/backend/convex/schema.ts:52 (`...bankingTables`). Two more tables, `quotes` and
// `railOperations`, are no longer in the schema but still hold rows: only the migration
// `banking.payouts.convert` reads them, untyped, and deletes them on `clear`.
// Machines: every state field with a literal union. Transitions are named to_<state>; `from` lists
// every state an old write (or an old rule a caller reaches) moves the field from. A write that
// leaves the field unchanged (a self-loop) is not listed; a birth (an insert) has no source state
// and is said in `about`. The payout's states keep the old PascalCase spelling.
//
// Only banking code reads or writes these tables: no other concept queries them directly
// (payments/reads/payouts.ts:29 names `payouts` only in an error).

import { Schema } from "effect";
import { defineMachine, defineTable } from "../../../packages/book/src/index.ts";
import { concept_banking } from "../shared/foundation.ts";
import {
  event_bank_deposit_transitioned,
  event_payout_transitioned,
} from "../shared/vocabulary.ts";

const B = "packages/backend/src/banking";
const T = `${B}/tables`;
const PO = `${B}/payouts`;
const RULES = `${PO}/rules`;

const KEPT = "Kept indefinitely: no job in the old code deletes these rows.";

// ── shared validators ───────────────────────────────────────────────────────────────────────

const opt = Schema.optionalKey;
const S = Schema.String;
const N = Schema.Number;
const B_ = Schema.Boolean;

/** `bankCurrency` (banking/model.ts:14). */
const BankCurrency = Schema.Literals(["usd", "eur", "gbp"]);
/** `settlementToken` (banking/model.ts:15). */
const SettlementToken = Schema.Literals(["usdc", "eurc"]);
/** `bankRail` (banking/model.ts:16). */
const BankRail = Schema.Literals(["ach", "wire", "sepa", "faster_payments"]);
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

/** `retryFields` (banking/model.ts:95): a row a banking minute job retries (banking/rules.ts). */
const RetryFields = {
  attempts: opt(N),
  nextAttemptAt: opt(N),
  runId: opt(S),
  parkedAt: opt(N),
  parkReason: opt(S),
};

/** `bankDetailsState` (banking/model.ts:22). */
const BANK_DETAILS_STATES = ["requested", "active", "deactivated", "closed", "failed"] as const;
/** `depositState` (banking/model.ts:36). */
const DEPOSIT_STATES = ["unknown", "scheduled", "received", "in_review", "sent", "delivered", "micro"] as const;
/** `depositRefundState` (banking/model.ts:45). */
const DEPOSIT_REFUND_STATES = ["in_flight", "done", "failed"] as const;

/** `PAYOUT_STATES` (payouts/rules/vocabulary.ts:8). */
const PAYOUT_STATES = [
  "Creating",
  "Quoted",
  "Funding",
  "InTransit",
  "Delivered",
  "Returning",
  "Refunded",
  "Cancelling",
  "Cancelled",
  "ClosedUnfunded",
  "Refused",
  "NeedsAttention",
] as const;
/** `ATTENTION_REASONS` (payouts/rules/vocabulary.ts:61). */
const ATTENTION_REASONS = [
  "create_no_answer",
  "create_answer_unreadable",
  "create_key_expired",
  "send_unknown",
  "delivered_amount_missing",
  "delivered_amount_wrong",
  "delivery_stalled",
  "refund_missing",
  "cancel_failed",
  "bridge_moved_unfunded",
  "bridge_refused_capxul",
  "timer_lost",
  "funding_short",
] as const;
/** `END_REASONS` (payouts/rules/vocabulary.ts:83). */
const END_REASONS = [
  "bridge_refused_amount",
  "quote_expired_unpaid",
  "balance_check_failed",
  "approval_expired",
  "send_not_landed",
  "bridge_answered_late",
  "bridge_answer_unusable",
  "bridge_moved_unfunded",
] as const;
/** `CANCEL_REASONS` (payouts/rules/vocabulary.ts:96). */
const CANCEL_REASONS = [
  "quote_expired_unpaid",
  "balance_check_failed",
  "approval_expired",
  "send_not_landed",
  "bridge_answered_late",
  "bridge_answer_unusable",
] as const;
/** `PAYOUT_REFUSALS` (payouts/rules/vocabulary.ts:41). */
const PAYOUT_REFUSALS = [
  "stale_news",
  "duplicate_news",
  "late_answer",
  "unknown_payout",
  "field_invalid",
  "transfer_conflict",
  "not_allowed_in_state",
  "cancel_not_awaiting_funds",
  "lease_lost",
] as const;
/** `PAYOUT_EVENT_KINDS` (payouts/rules/vocabulary.ts:200) and the conversion's own word. */
const PAYOUT_LINE_EVENTS = [
  "quote_requested",
  "call_claimed",
  "bridge_answered",
  "bridge_answer_unusable",
  "bridge_refused",
  "bridge_call_failed",
  "cancel_answered",
  "payment_bound",
  "balance_check_failed",
  "send_claimed",
  "funding_verified",
  "send_not_landed",
  "funding_reverted",
  "bridge_news",
  "bridge_news_unusable",
  "refund_seen",
  "timer_fired",
  "timer_overdue",
  "person_resolved",
  "converted",
] as const;
/** `PAYOUT_SOURCES` (payouts/rules/vocabulary.ts:226). */
const PAYOUT_SOURCES = ["quote", "dispatcher", "webhook", "timer", "payments", "person", "watchdog", "conversion"] as const;
/** `TIMER_PURPOSES` (payouts/rules/vocabulary.ts:189). */
const TIMER_PURPOSES = ["create_retry", "quote_deadline", "funding_watch", "delivery_read", "refund_watch", "cancel_retry"] as const;
/** `BRIDGE_PROGRESS` (payouts/rules/vocabulary.ts:157). */
const BRIDGE_PROGRESS = ["awaiting_funds", "working", "short", "delivered", "returned", "refunded", "cancelled"] as const;
/** `BRIDGE_ENDS` (payouts/rules/vocabulary.ts:173). */
const BRIDGE_ENDS = ["returned", "refunded", "undeliverable", "error", "canceled"] as const;
/** `PAYMENT_NOTICES` (payouts/rules/vocabulary.ts:177). */
const PAYMENT_NOTICES = ["in_transit", "settled", "failed", "returned", "refunded", "cancelled", "funding_reverted"] as const;
/** `NEWS_HOLDS` (payouts/rules/vocabulary.ts:239). */
const NEWS_HOLDS = ["before_deal", "before_funding"] as const;

/** `money` (tables/payouts.ts:27): a bank amount in its currency. */
const Money = Schema.Struct({ currency: S, value: S, decimals: N });
const AssetAmount = Schema.Struct({ asset: S, value: S });
const PayoutReason = Schema.Literals([...ATTENTION_REASONS, ...END_REASONS]);

// ── bank details ────────────────────────────────────────────────────────────────────────────

export const table_rail_receiving_accounts = defineTable({
  id: "rail-receiving-accounts",
  title: "Bank details: one Bridge virtual account per Party and currency",
  about:
    "The receiving accounts Banking issues (`railReceivingAccounts`). `prepare` inserts the row and its creation key " +
    "(`receivingAccountId`, reused as Bridge's idempotency key) before Bridge is called; `finalize` stores Bridge's answer " +
    "once; `applyLifecycle` applies Bridge's lifecycle points in provider order (`stateAt`, then `stateSeq`, then " +
    "`stateActivityRef`). The destination is derived from the stored Account or Organization Safe, never from the caller, " +
    "lowercased. `publicPayloadJson` holds the masked bank fields, rails, fee and minimum deposit; `secretPayloadEnc` the " +
    "full numbers, AES encrypted with `CAPXUL_ACCOUNT_SECRETS_KEY` and `bank-details:<receivingAccountId>` as associated " +
    "data. `surface` is always written `unspecified`. One row per (ownerPartyId, currency) is enforced only by the " +
    "prepare read (`.unique()`), not by the store.",
  was: [`${B}/tables.ts:20`, `${B}/model.ts:22`, `${B}/bank-details/writes.ts:72`, `${B}/bank-details/external.ts:127`, `${B}/README.md:1`],
  concept: concept_banking,
  tenancy: "owner",
  tenantField: "ownerPartyId",
  scope: "A Party: a person's or an Organization's; `organizationId` is set for an Organization's row.",
  fields: Schema.Struct({
    receivingAccountId: S,
    ownerPartyId: S,
    authUserId: S,
    organizationId: opt(S),
    rail: Schema.Literal("bridge"),
    currency: BankCurrency,
    creationKey: S,
    railSubjectRef: S,
    railAccountRef: opt(S),
    bankRail: opt(BankRail),
    state: Schema.Literals(BANK_DETAILS_STATES),
    stateAt: S,
    stateSeq: opt(N),
    stateActivityRef: opt(S),
    destination: Schema.Struct({ chainId: N, token: SettlementToken, address: S }),
    publicPayloadJson: opt(S),
    secretPayloadEnc: opt(S),
    journeyId: S,
    surface: opt(Schema.Literals(["web", "cli", "agent", "sdk", "unspecified"])),
    observationContext: opt(ObservationContext),
    createdAt: N,
    updatedAt: N,
  }),
  key: ["receivingAccountId"],
  indexes: [
    {
      name: "by_receiving_account",
      fields: ["receivingAccountId"],
      for: "Finalize's row by id (bank-details/writes.ts:115) and Requests' Invoice binding (bank-details/reads/invoices.ts:15).",
    },
    {
      name: "by_owner_currency",
      fields: ["ownerPartyId", "currency"],
      for: "A Party's details for one currency (prepare, get, load) or all currencies (list) (bank-details/reads.ts:19, :32).",
    },
    {
      name: "by_rail_ref",
      fields: ["rail", "railAccountRef"],
      crossTenant: true,
      for: "The row Bridge's virtual account id names: lifecycle points, the inbox's load and deposits (writes/lifecycle.ts:35, reads.ts:102, deposits/writes.ts:48).",
    },
  ],
  retention: KEPT,
});

// ── inbox ───────────────────────────────────────────────────────────────────────────────────

export const table_rail_events = defineTable({
  id: "rail-events",
  title: "Bridge inbox: one encrypted row per Bridge webhook event",
  about:
    "The encrypted Bridge inbox (`railEvents`). A delivery or a catch-up page inserts a row by `eventId` through one guard " +
    "(`insertEvent`) and schedules its processing; a duplicate changes nothing. `payloadEnc` is the whole event body, AES " +
    "encrypted with `bridge:<eventId>` as associated data. Processing sets `processedAt`, `outcome`, `mapped` and, for a " +
    "body no retry can change, `refusal`. A run that fails otherwise backs the row off (`attempts`, `nextAttemptAt`, 1, 2, " +
    "4 ... minutes, at most an hour); the tenth failure parks it (`parkedAt`, `parkReason`) and no job selects it again. " +
    "`runId` is the one scheduled run the row is held for. `row_broken` stays readable for rows stored before the payout " +
    "door; nothing writes it now. Tenancy: none, it is Bridge's feed for the whole deployment.",
  was: [`${B}/tables.ts:59`, `${B}/model.ts:66`, `${B}/model.ts:95`, `${B}/webhooks/writes.ts:23`, `${B}/webhooks/README.md:3`, `${B}/rules.ts:1`],
  concept: concept_banking,
  tenancy: "global",
  fields: Schema.Struct({
    rail: Schema.Literal("bridge"),
    eventId: S,
    sequence: N,
    category: S,
    type: S,
    objectRef: S,
    payloadEnc: S,
    receivedAt: N,
    source: Schema.Literals(["webhook", "catch_up"]),
    processedAt: opt(N),
    outcome: opt(Schema.Literals(["mapped", "ignored", "unknown", "row_broken", "refused"])),
    mapped: opt(
      Schema.Struct({
        machine: Schema.Literals(["verification", "bank_details", "deposit", "payout", "party_account"]),
        event: S,
      }),
    ),
    refusal: opt(Schema.Struct({ code: Schema.Literal("PROVIDER_RESPONSE_INVALID"), field: S, problem: S })),
    ...RetryFields,
  }),
  key: ["rail", "eventId"],
  indexes: [
    {
      name: "by_event",
      fields: ["rail", "eventId"],
      for: "The inbox guard, load, record and back-off read one event by id (webhooks/writes.ts:31, :80, :145; reads.ts:11).",
    },
    {
      name: "by_pending",
      fields: ["processedAt", "parkedAt", "nextAttemptAt"],
      for: "Recovery's two reads: unprocessed, unparked rows never tried and older than two minutes, then rows whose back-off is due (reconcile/writes.ts:184, :199).",
    },
    {
      name: "by_object",
      fields: ["rail", "objectRef", "sequence"],
      for: "No query in the old code reads it: a gap.",
    },
  ],
  retention: KEPT,
});

export const table_rail_sync_state = defineTable({
  id: "rail-sync-state",
  title: "Bridge catch-up cursor and its lease",
  about:
    "One row for the rail (`railSyncState`): the id of the last Bridge webhook event catch-up read (`cursor`), the lease that " +
    "keeps one catch-up running at a time (`leaseId`, `leaseUntil`, ten minutes), and, on a DevNet, `readsFrom`: the first " +
    "catch-up's start, before which no event is inserted (CAP-818). Only catch-up moves the cursor; a webhook cannot skip a " +
    "gap. No cursor means no page was read yet.",
  was: [`${B}/tables.ts:136`, `${B}/reconcile/writes.ts:20`, `${B}/reconcile/writes.ts:43`, `${B}/reconcile/rules.ts:12`, `${B}/reconcile/README.md:3`],
  concept: concept_banking,
  tenancy: "global",
  fields: Schema.Struct({
    rail: Schema.Literal("bridge"),
    cursor: opt(S),
    leaseId: opt(S),
    leaseUntil: opt(N),
    readsFrom: opt(N),
    updatedAt: N,
  }),
  key: ["rail"],
  indexes: [
    {
      name: "by_rail",
      fields: ["rail"],
      for: "The one row of the rail: cursor read, lease, release and advance (reconcile/reads.ts:10, writes.ts:30).",
    },
  ],
  retention: KEPT,
});

// ── deposits ────────────────────────────────────────────────────────────────────────────────

export const table_rail_deposits = defineTable({
  id: "rail-deposits",
  title: "Bank deposits: one row per Bridge deposit into a receiving account",
  about:
    "One row per Bridge deposit (`railDeposits`), keyed by Bridge's `depositRef`. The row snapshots its receiving account, " +
    "owner and Safe at birth, keeps the bank progress (`state`) and the refund (`refundState`) apart, and derives the public " +
    "status (`depositStatus`: returned, below_minimum, processing, arriving, credited). `payment_processed` freezes the net " +
    "amount and token. It is credited when Ponder shows the exact token transfer (`chainMovementId`); on staging the credit " +
    "first mints test tokens once (`mintClaimedAt`, `stagingMintTxHash`). A credit run that leaves a delivered deposit " +
    "uncredited backs it off (`attempts`, `nextAttemptAt`) and parks it at the tenth run; new Bridge evidence clears the " +
    "back-off and the park. A match links one credited deposit to an Invoice (`match`); a bank deposit never creates a " +
    "Payment row. `sender` and `payerReference` are private payer data.",
  was: [`${B}/tables.ts:84`, `${B}/model.ts:36`, `${B}/deposits/writes/record.ts:41`, `${B}/deposits/rules.ts:187`, `${B}/deposits/README.md:3`],
  concept: concept_banking,
  tenancy: "owner",
  tenantField: "ownerPartyId",
  scope: "A Party: a person's or an Organization's; `organizationId` is set for an Organization's deposit.",
  fields: Schema.Struct({
    bankDepositId: S,
    depositRef: S,
    receivingAccountId: S,
    ownerPartyId: S,
    authUserId: S,
    organizationId: opt(S),
    currency: BankCurrency,
    bankRail: BankRail,
    chainId: N,
    safeAddress: S,
    settlementToken: SettlementToken,
    assetId: opt(S),
    tokenAddress: opt(S),
    decimals: opt(N),
    state: Schema.Literals(DEPOSIT_STATES),
    refundState: opt(Schema.Literals(DEPOSIT_REFUND_STATES)),
    grossAmount: S,
    netAmount: opt(S),
    netRawAmount: opt(S),
    bridgeTxHash: opt(S),
    stagingMintTxHash: opt(S),
    mintClaimedAt: opt(N),
    chainMovementId: opt(S),
    sender: opt(S),
    payerReference: opt(S),
    match: opt(
      Schema.Union([
        Schema.Struct({
          kind: Schema.Literal("request"),
          requestId: S,
          reference: S,
          how: Schema.Literals(["reference", "manual"]),
        }),
        Schema.Struct({ kind: Schema.Literal("not_request") }),
      ]),
    ),
    journeyId: S,
    correlationId: S,
    receivedAt: N,
    updatedAt: N,
    ...RetryFields,
  }),
  key: ["bankDepositId"],
  indexes: [
    {
      name: "by_ref",
      fields: ["depositRef"],
      crossTenant: true,
      for: "The deposit Bridge's deposit id names: record, load, mint claim, mint record, confirm and back-off (deposits/writes.ts:59, writes/credit.ts:56).",
    },
    {
      name: "by_deposit",
      fields: ["bankDepositId"],
      for: "One deposit by Capxul's id: get, candidates, match and auto-match (deposits/reads.ts:26).",
    },
    {
      name: "by_owner",
      fields: ["ownerPartyId"],
      for: "A Party's deposits newest first, 20 a page, optionally only unmatched (deposits/reads.ts:40).",
    },
    {
      name: "by_account",
      fields: ["receivingAccountId"],
      for: "No query in the old code reads it: a gap.",
    },
    {
      name: "by_credit_due",
      fields: ["state", "chainMovementId", "parkedAt", "nextAttemptAt"],
      for: "The credit reconcile: up to 100 delivered, uncredited, unparked deposits whose next attempt is due (deposits/writes/credit.ts:182).",
    },
  ],
  retention: KEPT,
});

// ── payouts ─────────────────────────────────────────────────────────────────────────────────

export const table_payouts = defineTable({
  id: "payouts",
  title: "Bank payouts (one Bridge payout and the quote it began as)",
  about:
    "Banking's one record of a bank payout (CAP-738) and of the quote it began as (CAP-741): the payer, bank account, Safe, " +
    "journey, the exact Bridge create body (`request`), the draft terms and the terms Bridge's answer completed, written " +
    "once. `payoutId` is the `railOperationId` a Payment names, Bridge's client reference and the create idempotency key. " +
    "The door (`applyPayoutEventInTx`) writes every move: state, `version`, the saved Bridge call (`intent`, with its token, " +
    "lease, first try and last error), the one live timer (`timer`) and its scheduled job (`timerJob`), Bridge's latest " +
    "news (`news`, `newsHeld`), the Payment links and what Payments told it, the outcome and a person's resolution. " +
    "`paymentNotice` is what the payout last told its Payment. Two writers outside the door: the conversion inserts payouts " +
    "made from stored facts (the migration and the devnet fixture), and the refund link sets only `refundMovementId` " +
    "(`classifyPayoutRefundInTx` and the door's `linkRefund`). Rows belong to an Account or an Organization payer.",
  was: [`${T}/payouts.ts:131`, `${T}/payouts.ts:107`, `${T}/payouts.ts:122`, `${T}/README.md:1`, `${PO}/README.md:6`],
  concept: concept_banking,
  tenancy: "owner",
  tenantField: "actorId",
  scope: "`actorKind` says whether `actorId` is an Account or an Organization.",
  fields: Schema.Struct({
    payoutId: S,
    quoteId: S,
    state: Schema.Literals(PAYOUT_STATES),
    stateSince: N,
    version: N,
    environment: Schema.Literals(["sandbox", "production"]),
    requestKey: S,
    requestDigest: S,
    authUserId: S,
    actorKind: ActorKind,
    actorId: S,
    ownerPartyId: S,
    partyAccountId: S,
    railSubjectRef: S,
    railAccountRef: S,
    sourceSafe: S,
    chainId: N,
    currency: BankCurrency,
    sourceToken: opt(SettlementToken),
    journeyId: S,
    observationContext: opt(ObservationContext),
    quoteDeadlineAt: N,
    request: opt(
      Schema.Struct({
        railOperationId: S,
        railSubjectRef: S,
        source: Schema.Struct({ currency: SettlementToken, from_address: S }),
        destination: Schema.Struct({ payment_rail: S, currency: S, external_account_id: S }),
        amount: Schema.Struct({ fixed: Schema.Literals(["output", "source"]), value: S }),
        fundingAtMost: opt(S),
      }),
    ),
    draftQuoteJson: opt(S),
    publicQuoteJson: opt(S),
    deal: opt(
      Schema.Struct({
        transferId: S,
        depositAddress: opt(S),
        funding: AssetAmount,
        lockedOutput: Money,
        outputExact: opt(Schema.Literal(false)),
        expiresAt: opt(N),
      }),
    ),
    intent: opt(
      Schema.Struct({
        kind: Schema.Literals(["create", "cancel"]),
        attempt: N,
        token: N,
        leaseUntil: opt(N),
        firstTriedAt: opt(N),
        lastError: opt(Schema.Struct({ code: S, mode: opt(S), httpStatus: opt(N), at: N })),
      }),
    ),
    timer: opt(Schema.Struct({ purpose: Schema.Literals(TIMER_PURPOSES), at: N, token: N, step: N })),
    timerJob: opt(S),
    transferId: opt(S),
    news: opt(
      Schema.Struct({
        transferId: S,
        progress: Schema.Literals(BRIDGE_PROGRESS),
        updatedAt: N,
        sequence: opt(N),
        deliveredAmount: opt(Money),
        refundTxHash: opt(S),
        end: opt(Schema.Literals(BRIDGE_ENDS)),
      }),
    ),
    newsHeld: opt(B_),
    paymentId: opt(S),
    settlementId: opt(S),
    commandId: opt(S),
    acceptedAt: opt(N),
    fundingVerifiedAt: opt(N),
    sendFailedAt: opt(N),
    balanceCheckFailedAt: opt(N),
    paymentNotice: opt(Schema.Literals(PAYMENT_NOTICES)),
    deliveredAmount: opt(Money),
    refundTxHash: opt(S),
    refundMovementId: opt(S),
    endReason: opt(PayoutReason),
    cancelReason: opt(Schema.Literals(CANCEL_REASONS)),
    attention: opt(Schema.Struct({ reason: Schema.Literals(ATTENTION_REASONS), from: Schema.Literals(PAYOUT_STATES) })),
    refusedBy: opt(Schema.Literals(["amount", "capxul"])),
    bridgeRefusal: opt(Schema.Struct({ httpStatus: N, providerCode: opt(S), reason: opt(S) })),
    resolvedBy: opt(Schema.Struct({ who: S, why: S })),
    createdAt: N,
    updatedAt: N,
  }),
  key: ["payoutId"],
  indexes: [
    {
      name: "by_payout",
      fields: ["payoutId"],
      crossTenant: true,
      for: "The payout a Payment's `railOperationId` or Bridge's client reference names (`payoutById`, payouts/reads.ts:23).",
    },
    { name: "by_quote", fields: ["quoteId"], for: "The payout a quote opened: outcome and the Payment's quote read (`payoutByQuote`, reads.ts:30)." },
    {
      name: "by_request",
      fields: ["actorKind", "actorId", "requestKey"],
      for: "A repeat of the payer's request key finds its payout (`payoutByRequest`, reads.ts:37; prepare and request).",
    },
    { name: "by_transfer", fields: ["transferId"], for: "No query in the old code reads it: a gap." },
    {
      name: "by_settlement",
      fields: ["settlementId"],
      for: "A settlement binds one payout (`bindPayoutPaymentInTx`, writes/payments.ts:47).",
    },
    {
      name: "by_deposit",
      fields: ["chainId", "deal.depositAddress"],
      crossTenant: true,
      for: "The payouts paid into one Bridge deposit address: refund classification and Books' returned payout (writes/refunds.ts:54, reads.ts:202).",
    },
    {
      name: "by_state_timer",
      fields: ["state", "timer.at"],
      for: "The watchdog's read: waiting payouts whose timer is overdue or missing, 50 at most (`overduePayouts`, reads.ts:61).",
    },
  ],
  retention: KEPT,
});

export const table_payout_transitions = defineTable({
  id: "payout-transitions",
  title: "Payout log (one line per move or refusal)",
  about:
    "Banking's append-only payout log (`payoutTransitions`, ADR-0019): one line per move or refusal the door saves, never " +
    "edited. `version` is the payout's version after a move, or the version that refused the event, so several refusals " +
    "at one version share (`payoutId`, `version`); an event for no payout is one `unknown_payout` line at version 0 from " +
    "`new`. A line with `to` is a move (a stay to the same state included) and leaves as `payout_transitioned`; a line " +
    "with `refused` sends nothing. `held` says Bridge news was kept for later. The conversion writes one `converted` line " +
    "per payout it makes. A refused send claim's line rolls back with the failed claim.",
  was: [`${T}/payouts.ts:199`, `${PO}/writes/lines.ts:66`, `${PO}/writes/lines.ts:96`, `${PO}/writes/door.ts:153`],
  concept: concept_banking,
  tenancy: "owner",
  scope: "Through `payoutId` to the payout's `actorKind` and `actorId`.",
  fields: Schema.Struct({
    payoutId: S,
    version: N,
    from: Schema.Literals([...PAYOUT_STATES, "new"]),
    event: Schema.Literals(PAYOUT_LINE_EVENTS),
    to: opt(Schema.Literals(PAYOUT_STATES)),
    refused: opt(Schema.Literals(PAYOUT_REFUSALS)),
    reason: opt(PayoutReason),
    held: opt(Schema.Literals(NEWS_HOLDS)),
    source: Schema.Literals(PAYOUT_SOURCES),
    transferId: opt(S),
    at: N,
  }),
  key: ["_id"],
  indexes: [
    {
      name: "by_payout",
      fields: ["payoutId", "version"],
      for: "One payout's log in version order. No query in the old code reads it; only inserts touch the table.",
    },
  ],
  retention: KEPT,
});

// ── retired payout rows ─────────────────────────────────────────────────────────────────────

export const table_quotes = defineTable({
  id: "quotes",
  title: "Retired payout quotes (no longer in the schema)",
  about:
    "The bank payout quotes stored before the payouts table (CAP-741). The table is no longer in the schema, but its rows " +
    "stay until the migration `banking.payouts.convert` clears them: it reads each one untyped through `by_creation_time` " +
    "beside its journal row, decodes it with `RetiredQuoteSchema`, makes its payout, and with `clear` deletes it. A quote " +
    "whose stored terms do not decode keeps its row. No other code reads or writes it.",
  was: [`${RULES}/retired-rows.ts:16`, `${RULES}/retired-rows.ts:34`, `${PO}/writes/retired-rows.ts:103`, `${PO}/writes/retired-rows.ts:131`, `${T}/README.md:21`],
  concept: concept_banking,
  tenancy: "owner",
  tenantField: "actorId",
  scope: "`actorKind` says whether `actorId` is an Account or an Organization.",
  fields: Schema.Struct({
    quoteId: S,
    railOperationId: S,
    requestKey: S,
    requestDigest: S,
    authUserId: S,
    actorKind: ActorKind,
    actorId: S,
    ownerPartyId: S,
    partyAccountId: S,
    railSubjectRef: S,
    railAccountRef: S,
    sourceSafe: S,
    chainId: N,
    currency: BankCurrency,
    sourceToken: opt(SettlementToken),
    fundingAddress: opt(S),
    publicQuoteJson: opt(S),
    providerExpiresAt: opt(N),
    acceptedAt: opt(N),
    journeyId: S,
    observationContext: opt(ObservationContext),
    createdAt: N,
    expiresAt: N,
  }),
  key: ["quoteId"],
  indexes: [
    {
      name: "by_creation_time",
      fields: ["_creationTime"],
      for: "The migration finds a journal row's quote written just before or after it, filtered by quoteId (writes/retired-rows.ts:108).",
    },
  ],
  retention: "Deleted by `banking.payouts.convert` with `clear` once its payout exists, unless its stored terms do not decode.",
});

export const table_rail_operations = defineTable({
  id: "rail-operations",
  title: "Retired bank leg journal (no longer in the schema)",
  about:
    "The bank legs' journal rows stored before the payouts table (`railOperations`, CAP-741). Not in the schema any more; " +
    "the migration `banking.payouts.convert` pages through it untyped, 50 rows a run, decodes each row with " +
    "`RetiredOperationSchema`, makes its payout from today's facts, and with `clear` deletes it. No other code reads or " +
    "writes it.",
  was: [`${RULES}/retired-rows.ts:16`, `${RULES}/retired-rows.ts:64`, `${PO}/operations/convert.ts:31`, `${PO}/writes/retired-rows.ts:149`],
  concept: concept_banking,
  tenancy: "owner",
  scope: "Through `quoteId` to the retired quote's `actorKind` and `actorId`.",
  fields: Schema.Struct({
    railOperationId: S,
    quoteId: S,
    railTransferRef: opt(S),
    settlementId: opt(S),
    paymentId: opt(S),
    commandId: opt(S),
    deliveryState: Schema.Literals(["pending", "done", "failed", "refunded"]),
    deliveredOutputValue: opt(S),
    stateAt: opt(N),
    stateSeq: opt(N),
    refundMovementId: opt(S),
    refundTxHash: opt(S),
  }),
  key: ["railOperationId"],
  indexes: [],
  retention: "Deleted by `banking.payouts.convert` with `clear` once its payout exists, unless its quote's stored terms do not decode.",
});

// ── machines ────────────────────────────────────────────────────────────────────────────────

export const machine_bank_details = defineMachine({
  id: "bank-details",
  title: "Bank details state",
  about:
    "railReceivingAccounts.state. `prepare` inserts `requested`. `finalize` writes the state Bridge's create answer reports " +
    "once (`stateOf`: activated is active; deactivated and closed as they are). Afterwards `applyBankDetailsLifecycle` " +
    "applies one provider point: only a newer point moves the state, by `transitionBankDetails` (activated, deactivated, " +
    "closed, failed; `updated` keeps the state). A closed account refuses every point (`CLOSED`); a stale or duplicate " +
    "point leaves the row. No reader ever produces the `failed` event: Bridge's activity types map to activated, " +
    "deactivated, closed and updated, and a readback reports Bridge's account status, so `failed` is admitted by the rules " +
    "and unreachable. A repeated finalize changes nothing.",
  was: [`${B}/model.ts:22`, `${B}/bank-details/rules.ts:101`, `${B}/bank-details/rules.ts:140`, `${B}/bank-details/rules.ts:169`, `${B}/bank-details/writes/lifecycle.ts:29`],
  table: table_rail_receiving_accounts,
  field: "state",
  initial: "requested",
  states: [
    { id: "requested", about: "Prepared with its creation key; Bridge has not answered yet." },
    { id: "active", about: "Bridge's virtual account is activated and takes deposits." },
    { id: "deactivated", about: "Deactivated at Bridge; a person can reactivate it." },
    { id: "closed", about: "Closed at Bridge; every later lifecycle point is refused.", terminal: true },
    { id: "failed", about: "Admitted by the rules for a `failed` lifecycle event that no reader produces." },
  ],
  transitions: {
    to_active: {
      from: ["requested", "deactivated", "failed"],
      to: "active",
      about: "Finalize stores an activated answer (writes.ts:137); a newer `activation` or `reactivation` point, or a readback that reads `activated` (writes/lifecycle.ts:79).",
      guard: "Finalize only while `railAccountRef` is unset; a lifecycle point only when newer and the row is not closed.",
      emits: [],
    },
    to_deactivated: {
      from: ["requested", "active", "failed"],
      to: "deactivated",
      about: "Finalize stores a deactivated answer; a newer `deactivation` point, or a readback after `deactivate` (writes/lifecycle.ts:79).",
      guard: "Finalize only while `railAccountRef` is unset; a lifecycle point only when newer and the row is not closed.",
      emits: [],
    },
    to_closed: {
      from: ["requested", "active", "deactivated", "failed"],
      to: "closed",
      about: "Finalize stores a closed answer; a newer `close` point or a readback that reads `closed` (writes/lifecycle.ts:79).",
      guard: "Finalize only while `railAccountRef` is unset; a lifecycle point only when newer.",
      emits: [],
    },
    to_failed: {
      from: ["active", "deactivated"],
      to: "failed",
      about: "Admitted by `transitionBankDetails` for a `failed` event (rules.ts:113); no reader produces that event, so no write reaches it.",
      emits: [],
    },
  },
});

export const machine_bank_deposit = defineMachine({
  id: "bank-deposit",
  title: "Bank deposit progress",
  about:
    "railDeposits.state: Bridge's bank progress for one deposit. `insertDeposit` is born at the progress of the first " +
    "event that carries an amount (scheduled, received, in_review, sent, delivered or micro), or `unknown` when a refund " +
    "arrives first; an event with no amount and no row is dropped (`STALE`). `transitionDeposit` then moves it only " +
    "forward by rank (unknown < scheduled < received < in_review < sent < delivered); `micro` is taken from any state and " +
    "never left. A completed refund (`refundState` done) refuses every later progress event (`REFUNDED`). Refund events " +
    "keep the state. A refused event still records a late payer memo. A move to delivered schedules the credit run.",
  was: [`${B}/model.ts:36`, `${B}/deposits/rules.ts:155`, `${B}/deposits/writes.ts:35`, `${B}/deposits/writes/record.ts:21`, `${B}/deposits/writes/record.ts:128`],
  table: table_rail_deposits,
  field: "state",
  initial: "unknown",
  states: [
    { id: "unknown", about: "Born by a refund event before any bank progress." },
    { id: "scheduled", about: "Bridge scheduled the incoming deposit." },
    { id: "received", about: "Bridge received the bank money; `receivedAt` moves to this event's time when it was scheduled." },
    { id: "in_review", about: "Bridge is reviewing the deposit." },
    { id: "sent", about: "Bridge sent the tokens on chain." },
    { id: "delivered", about: "Bridge delivered the tokens; the credit job confirms the transfer on chain (credited) or retries." },
    { id: "micro", about: "Below Bridge's minimum; public status below_minimum." },
  ],
  transitions: {
    to_scheduled: {
      from: ["unknown"],
      to: "scheduled",
      about: "Born scheduled by `deposit_scheduled` (writes/record.ts:41); `applyDepositTransition` (writes/record.ts:147).",
      guard: "Only forward by rank; never after a completed refund.",
      emits: [],
    },
    to_received: {
      from: ["unknown", "scheduled"],
      to: "received",
      about: "Born received, or `deposit_received` moves it (writes/record.ts:147).",
      guard: "Only forward by rank; never after a completed refund.",
      emits: [],
    },
    to_in_review: {
      from: ["unknown", "scheduled", "received"],
      to: "in_review",
      about: "Born in review, or `deposit_in_review` moves it.",
      guard: "Only forward by rank; never after a completed refund.",
      emits: [],
    },
    to_sent: {
      from: ["unknown", "scheduled", "received", "in_review"],
      to: "sent",
      about: "Born sent, or `deposit_sent` moves it.",
      guard: "Only forward by rank; never after a completed refund.",
      emits: [],
    },
    to_delivered: {
      from: ["unknown", "scheduled", "received", "in_review", "sent"],
      to: "delivered",
      about: "Born delivered, or `deposit_delivered` moves it; it freezes the gross and net amounts and the token, and schedules a held credit run (writes/record.ts:90, :203).",
      guard: "Only forward by rank; never after a completed refund.",
      emits: [],
    },
    to_micro: {
      from: ["unknown", "scheduled", "received", "in_review", "sent", "delivered"],
      to: "micro",
      about: "Born micro, or `deposit_micro` moves it from any state (rules.ts:178).",
      guard: "Never after a completed refund.",
      emits: [],
    },
  },
});

export const machine_bank_deposit_refund = defineMachine({
  id: "bank-deposit-refund",
  title: "Bank deposit refund",
  about:
    "railDeposits.refundState, kept apart from the bank progress. `none` is the field absent, as the old code's own " +
    "annotations name it (writes/record.ts:83). A deposit can be born with a refund state when the refund arrives first. " +
    "`transitionDeposit`: started only from none; completed from anything but done; failed from anything but done and " +
    "failed. A completed refund is terminal and refuses every later event. Its first move to done emits " +
    "`bank_deposit_transitioned` (returned).",
  was: [`${B}/model.ts:45`, `${B}/deposits/rules.ts:160`, `${B}/deposits/writes/record.ts:89`, `${B}/deposits/writes/record.ts:140`, `${B}/deposits/events.ts:102`],
  table: table_rail_deposits,
  field: "refundState",
  initial: "none",
  states: [
    { id: "none", about: "No refund event yet (the field is absent)." },
    { id: "in_flight", about: "Bridge started returning the deposit." },
    { id: "done", about: "Bridge returned it; public status returned.", terminal: true },
    { id: "failed", about: "Bridge's return failed." },
  ],
  transitions: {
    to_in_flight: {
      from: ["none"],
      to: "in_flight",
      about: "`refund_started` on a deposit with no refund state, or a deposit born by it (rules.ts:160).",
      emits: [],
    },
    to_done: {
      from: ["none", "in_flight", "failed"],
      to: "done",
      about: "`refund_completed` (rules.ts:164); the save schedules `bank_deposit_transitioned` returned (events.ts:102).",
      emits: [event_bank_deposit_transitioned],
    },
    to_failed: {
      from: ["none", "in_flight"],
      to: "failed",
      about: "`refund_failed` (rules.ts:168).",
      emits: [],
    },
  },
});

export const machine_rail_event = defineMachine({
  id: "rail-event",
  title: "Bridge inbox row outcome",
  about:
    "railEvents.outcome, set once when `recordMapping` marks the row processed. `unprocessed` is the field absent: an " +
    "inserted row waiting for its process run, backing off, or parked after its tenth failure (parked rows stay here " +
    "for good). A row the Bridge door mapped to a machine is `mapped` (a payout's stale, duplicate or unknown news " +
    "included); an unmapped `kyc_link` event is `ignored`, any other unmapped one `unknown`; a body no retry can change " +
    "is `refused`. `row_broken` is admitted by the validator for rows stored before the payout door; nothing writes it.",
  was: [`${B}/tables.ts:65`, `${B}/webhooks/writes.ts:164`, `${B}/webhooks/README.md:9`],
  table: table_rail_events,
  field: "outcome",
  initial: "unprocessed",
  states: [
    { id: "unprocessed", about: "Inserted, not yet processed: due, backing off, held for a run, or parked." },
    { id: "mapped", about: "The Bridge door mapped it to a verification, bank-details, deposit, payout or party-account event.", terminal: true },
    { id: "ignored", about: "An unmapped `kyc_link` event.", terminal: true },
    { id: "unknown", about: "Any other event the Bridge door does not map.", terminal: true },
    { id: "row_broken", about: "A payout event whose stored quote row was broken (CAP-719); nothing writes it now.", terminal: true },
    { id: "refused", about: "A body no retry can change, with the refused Bridge field; its run raises one alert.", terminal: true },
  ],
  transitions: {
    to_mapped: { from: ["unprocessed"], to: "mapped", about: "recordMapping with a mapping and no refusal (webhooks/writes.ts:164).", emits: [] },
    to_ignored: { from: ["unprocessed"], to: "ignored", about: "recordMapping with no mapping for a `kyc_link` row.", emits: [] },
    to_unknown: { from: ["unprocessed"], to: "unknown", about: "recordMapping with no mapping for any other category.", emits: [] },
    to_refused: { from: ["unprocessed"], to: "refused", about: "recordMapping with a refusal (process.ts:53, :144).", emits: [] },
    to_row_broken: { from: ["unprocessed"], to: "row_broken", about: "No writer: the validator keeps it readable for old rows (tables.ts:71).", emits: [] },
  },
});

const DOOR = `${PO}/writes/door.ts`;

export const machine_payout = defineMachine({
  id: "payout",
  title: "Bank payout state (Design A)",
  about:
    "payouts.state. `transitionPayout` (rules/transition.ts:123) decides every move; the door saves it with its log line " +
    "and its `payout_transitioned` event. A stay (a move to the same state: a bind, a failed balance check, a call claim, " +
    "a retry, held news) also leaves as `payout_transitioned`, from and to the same state; stays are not listed. A payout " +
    "is born `Creating` by the quote (`quote_requested`) or born at any state the conversion works out (`converted`, " +
    "conversion.ts:178). In `NeedsAttention` new evidence is applied as the state the payout waited in " +
    "(`attention.from`): it leaves only when the evidence moves it elsewhere, so every target of a waiting state is also " +
    "reachable from NeedsAttention; a person's resolution moves it to a finished state or to Cancelling. Two rule rows " +
    "have no sender: `refund_seen` (Returning to Refunded) and `funding_reverted` (InTransit to Funding). Every waiting " +
    "state has one live timer (M6); the door refuses a save that breaks M2, M3 or M6 with UNKNOWN.",
  was: [`${RULES}/transition.ts:123`, `${RULES}/vocabulary.ts:8`, `${T}/payouts.ts:134`, DOOR + ":223", `${PO}/README.md:66`, `${RULES}/README.md:25`],
  table: table_payouts,
  field: "state",
  initial: "Creating",
  states: [
    { id: "Creating", about: "The create call is saved and the dispatcher sends it; the timer asks again at 5 s, 15 s, 1 and 5 min, then every 30 min, and gives up at 23 hours." },
    { id: "Quoted", about: "Bridge's deal is saved; waiting for the payer's send until the quote's deadline, when the timer cancels at Bridge." },
    { id: "Funding", about: "The payer's send is claimed; the timer reads Payments at the deadline plus 5 min, then hourly, and gives up at 24 hours." },
    { id: "InTransit", about: "Capxul proved the funding on chain; the timer reads Bridge at 1, 2, 4 ... 60 min, then hourly, and gives up at 7 days." },
    { id: "Delivered", about: "Bridge delivered the locked bank amount (or a person said so); the Payment settles.", terminal: true },
    { id: "Returning", about: "Bridge returned, refunded or cancelled a funded transfer; the timer reads Bridge every 6 hours, giving up at 14 days." },
    { id: "Refunded", about: "The refund arrived (a person's resolution, or a converted leg).", terminal: true },
    { id: "Cancelling", about: "The cancel call is saved; the timer asks again at 30 s, 2 and 10 min, then hourly, and gives up at 24 hours." },
    { id: "Cancelled", about: "Bridge cancelled the transfer, with the reason the cancel was asked for.", terminal: true },
    { id: "ClosedUnfunded", about: "Bridge moved the transfer on without Capxul's funding; in production it raises an alert.", terminal: true },
    { id: "Refused", about: "Bridge refused the create call: the payer's amount, or Capxul itself (an alert).", terminal: true },
    { id: "NeedsAttention", about: "A person owns it, with one reason and one alert; no timer. New evidence still applies; `banking.payouts.resolve` ends it." },
  ],
  transitions: {
    to_Creating: {
      from: [],
      to: "Creating",
      about: "Birth only: `quote_requested` opens the payout with its create to-do and a 5-second timer (transition.ts:16, open.ts:15), or a converted leg whose deal was never saved (conversion.ts:196).",
      guard: "Only a payout that does not exist yet, opened with its quote.",
      emits: [event_payout_transitioned],
    },
    to_Quoted: {
      from: ["Creating", "NeedsAttention"],
      to: "Quoted",
      about: "`bridge_answered` before the deadline saves the deal and the quote's completed terms (bridge-calls.ts:35, finalize.ts:27); a converted unsent leg is born Quoted.",
      guard: "The answer's token is the saved call's; held news must name the same transfer (else transfer_conflict).",
      emits: [event_payout_transitioned],
    },
    to_Funding: {
      from: ["Quoted", "InTransit", "NeedsAttention"],
      to: "Funding",
      about: "`send_claimed` for the deal's exact send before the deadline (funding.ts:33, money rule M1); `funding_reverted` from InTransit has no sender; a converted sent leg is born Funding.",
      guard: "Live quote, saved deal, same Payment, same asset, amount and deposit address; else not_allowed_in_state or field_invalid.",
      emits: [event_payout_transitioned],
    },
    to_InTransit: {
      from: ["Quoted", "Funding", "NeedsAttention"],
      to: "InTransit",
      about: "`funding_verified` (funding.ts:97): Payments proved the funding, before or after the claim; any held news applies in the same save. A converted funded pending leg is born InTransit.",
      guard: "The proof names the bound Payment, or none; a Quoted payout needs a deal and a Payment.",
      emits: [event_payout_transitioned],
    },
    to_Delivered: {
      from: ["InTransit", "Quoted", "Funding", "NeedsAttention"],
      to: "Delivered",
      about: "Bridge news `delivered` with the locked amount (delivery.ts:54, M5); held delivered news applied by funding_verified; a person's resolution with Capxul's funding proof; a converted done leg.",
      guard: "M3: Capxul's own chain proof of funding first; the delivered amount equals the locked output (or the same currency for an estimate).",
      emits: [event_payout_transitioned],
    },
    to_Returning: {
      from: ["InTransit", "Delivered", "Quoted", "Funding", "NeedsAttention"],
      to: "Returning",
      about: "Bridge news returned, refunded or cancelled for a funded payout (delivery.ts:33); returned or refunded after delivery; held news applied by funding_verified; a converted failed leg.",
      emits: [event_payout_transitioned],
    },
    to_Refunded: {
      from: ["Returning", "NeedsAttention"],
      to: "Refunded",
      about: "`refund_seen` (delivery.ts:132) has no sender; a person's resolution (attention.ts:61); a converted refunded leg.",
      emits: [event_payout_transitioned],
    },
    to_Cancelling: {
      from: ["Creating", "Quoted", "Funding", "NeedsAttention"],
      to: "Cancelling",
      about: "A late answer or an unusable one that names its transfer (bridge-calls.ts:35, :76); the Quoted deadline (funding.ts:85); `send_not_landed` (funding.ts:141); a person's cancel (attention.ts:45). Saves the cancel to-do and its timer.",
      guard: "M2: never once a send may have started (funding verified, or accepted and not failed).",
      emits: [event_payout_transitioned],
    },
    to_Cancelled: {
      from: ["Cancelling", "NeedsAttention"],
      to: "Cancelled",
      about: "Bridge answered the cancel `cancelled`, or news says cancelled (bridge-calls.ts:125); a person's resolution; a converted unsent failed or refunded leg.",
      emits: [event_payout_transitioned],
    },
    to_ClosedUnfunded: {
      from: ["Cancelling", "NeedsAttention"],
      to: "ClosedUnfunded",
      about: "Bridge would not cancel (`not_awaiting_funds`) and its news says it moved on, or such news arrives while cancelling (bridge-calls.ts:111); a person's resolution.",
      emits: [event_payout_transitioned],
    },
    to_Refused: {
      from: ["Creating", "NeedsAttention"],
      to: "Refused",
      about: "`bridge_refused` of the payer's amount or of Capxul (bridge-calls.ts:56); the save keeps Bridge's refusal for the payer; a person's resolution.",
      emits: [event_payout_transitioned],
    },
    to_NeedsAttention: {
      from: ["Creating", "Quoted", "Funding", "InTransit", "Returning", "Cancelling"],
      to: "NeedsAttention",
      about:
        "A waiting state gives up (create_no_answer, send_unknown, delivery_stalled, refund_missing, cancel_failed), the watchdog's timer_lost, an unreadable or key-expired create answer, a short funding, a delivered amount missing or wrong (moves.ts:156).",
      emits: [event_payout_transitioned],
    },
  },
});
