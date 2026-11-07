// The payments concept's own door, as it is: every function packages/backend/src/payments/index.ts
// exports that runs inside its caller's Convex transaction (it takes the caller's QueryCtx or
// MutationCtx and throws CapxulErrors). Other concepts import these by subpath ("#payments/…"),
// never through the door file itself. Pure rules, Effect helpers and ActionCtx helpers the door
// also exports (amount rules, buildOrReuseExecution, submitStoredExecution, checkoutPrepared, …)
// are not procedures and are not booked here.
//
// Reads and writes are transitive within payments: a procedure lists the tables its own helpers
// touch. A neighbour concept's function it calls is an `invokes`. Where the old code reads or
// writes another concept's table directly, the record says so: that is the finding.

import { Schema } from "effect";
import { defineProcedure } from "../../../packages/book/src/index.ts";

import { concept_payments } from "./foundation.ts";
import {
  error_INVALID_INPUT,
  error_NOT_IMPLEMENTED,
  error_ROLE_PERMISSION_DENIED,
  error_SUPERSEDED,
  error_UNKNOWN,
  error_WRONG_STATE,
  event_payment_writer_incident,
} from "./vocabulary.ts";
import {
  machine_commitment_evidence,
  machine_deposit_materialization,
  machine_money_execution,
  machine_movement,
  machine_payment,
  machine_payment_command,
  machine_payment_command_verification,
  table_commitment_evidence,
  table_deposit_materializations,
  table_money_executions,
  table_movement_attributions,
  table_movement_scan_checkpoints,
  table_movements,
  table_payment_commands,
  table_payment_document_intents,
  table_payment_schedules,
  table_payments,
  table_provider_send_attempts,
} from "./data.ts";
import {
  procedure_access_can_read_scope_in_tx,
  procedure_access_require_financial_read_principal_in_tx,
  procedure_access_require_financial_read_scope_in_tx,
  procedure_accounts_find_account_recipient_in_tx,
  procedure_accounts_read_accounts_at_safe_in_tx,
  procedure_accounts_require_account_signer_in_tx,
  procedure_accounts_require_payment_account_in_tx,
  procedure_accounts_resolve_account_recipient_safe_in_tx,
  procedure_activity_read_annotation_in_tx,
  procedure_banking_bind_payout_payment_in_tx,
  procedure_banking_classify_payout_refund_in_tx,
  procedure_banking_read_payout_deadline_in_tx,
  procedure_banking_read_payout_delivery_in_tx,
  procedure_banking_read_payout_quote_for_payment_in_tx,
  procedure_books_book_asset_by_id_in_tx,
  procedure_books_book_asset_in_tx,
  procedure_books_record_settled_payment_in_tx,
  procedure_books_records_added_token_in_tx,
  procedure_books_reverse_commitment_claim_in_tx,
  procedure_books_reverse_outside_money_in_tx,
  procedure_books_reverse_settled_payment_in_tx,
  procedure_books_schedule_outside_money_in_tx,
  procedure_documents_admit_payment_document_pair_in_tx,
  procedure_documents_current_payment_documents,
  procedure_documents_link_payment_document_in_tx,
  procedure_documents_load_payment_documents,
  procedure_documents_mark_movement_memo_orphaned_in_tx,
  procedure_documents_orphan_absent_movement_memos_in_tx,
  procedure_documents_persist_movement_memo_in_tx,
  procedure_documents_prepare_payment_documents_in_tx,
  procedure_documents_read_movement_memo_for_occurrence_in_tx,
  procedure_organizations_read_organization_safe_in_tx,
  procedure_organizations_read_organizations_at_safe_in_tx,
  procedure_organizations_read_owner_safes_in_tx,
  procedure_parties_ensure_ledger_party,
  procedure_parties_ensure_party_by_address,
  procedure_parties_ensure_payment_wallet_destination_in_tx,
  procedure_parties_party_by_id,
  procedure_parties_party_by_safe_address,
  procedure_parties_record_contact_edges,
  procedure_parties_resolve_owned_payment_wallet_safe_in_tx,
  procedure_parties_resolve_payment_recipient_in_tx,
  procedure_payroll_read_department_spend_in_tx,
  procedure_payroll_return_run_to_authorized,
  procedure_payroll_settle_run_for_settled_payment,
  procedure_permissions_find_command_authority,
  procedure_permissions_read_permission_execution_proof_in_tx,
  procedure_permissions_read_worn_allowances_in_tx,
  procedure_permissions_require_organization_spend_authority_in_tx,
  procedure_requests_invoice_birth_identity,
  procedure_requests_issued_invoice_read_access,
  procedure_requests_offer_checkout_birth_identity,
  procedure_requests_record_budget_settlement_in_tx,
  procedure_requests_request_memo_birth_identity,
  procedure_requests_schedule_request_paid_notice_in_tx,
  table_accounts,
  table_counterparty_destinations,
  table_financial_document_links,
  table_identities,
  table_invoice_checkout_payments,
  table_orgs,
  table_payment_requests,
} from "./neighbors.ts";

const B = "packages/backend/src";
const P = `${B}/payments`;
const DOOR = `${P}/index.ts`;

// ── shapes the door's callers pass ─────────────────────────────────────────────────────────

const Actor = Schema.Literals(["account", "organization"]);
/** `PaymentViewer` (model.ts:51): who reads a Payment. */
const Viewer = Schema.Struct({ kind: Actor, id: Schema.String });
/** `PaymentReadReference` (model.ts:57): an admitted Payment id and its viewer. */
const ReadReference = Schema.Struct({ paymentId: Schema.String, viewer: Viewer });
const Side = Schema.Literals(["sent", "received"]);
/** `PaymentActivityWindow` (model.ts:243). */
const ActivityWindow = Schema.Struct({
  from: Schema.optionalKey(Schema.Number),
  to: Schema.optionalKey(Schema.Number),
  beforeCreationTime: Schema.optionalKey(Schema.Number),
});
const Take = Schema.Union([Schema.Number, Schema.Literal("all")]);
const Page = Schema.Struct({ cursor: Schema.NullOr(Schema.String), numItems: Schema.Number });
/** `PaymentCorrectionScope` (model.ts:110). */
const CorrectionScope = Schema.Union([
  Schema.Struct({ orgId: Schema.String }),
  Schema.Struct({ accountId: Schema.String }),
]);
/** `TransferIdentity` (movements/rules/movements.ts). */
const TransferIdentity = Schema.Struct({
  chainId: Schema.Number,
  tokenAddress: Schema.String,
  txHash: Schema.String,
  logIndex: Schema.Number,
});
/** `MovementActivityCandidate` (movements/rules/movements.ts). */
const MovementCandidate = Schema.Struct({
  movementId: Schema.String,
  classification: Schema.Literals(["protocol_settlement", "deposit", "refund", "movement_only_outflow"]),
  createdAt: Schema.Number,
  creationTime: Schema.Number,
});
/** `OutsideMoney` (movements/reads/outside.ts:17). */
const OutsideMoney = Schema.Struct({
  movementId: Schema.String,
  orgId: Schema.String,
  direction: Schema.Literals(["out", "returned", "in"]),
  rawAmount: Schema.String,
  assetId: Schema.String,
  decimals: Schema.Number,
  chainId: Schema.Number,
  counterparty: Schema.String,
  txHash: Schema.String,
  occurredAt: Schema.Number,
  blockTime: Schema.NullOr(Schema.Number),
});
/**
 * `PaymentWriteResult` (protocol payments/schema/ledger.ts:262). A ledger record (`PaymentLedgerRecord`) is deep
 * (Schema.Unknown). A refusal is a returned `PaymentCoreError` (ledger.ts:121), not a thrown CapxulError, so its
 * codes live here and not among the errors.
 */
const WriteResult = Schema.Union([
  Schema.Struct({ outcome: Schema.Literal("created"), payments: Schema.Array(Schema.Unknown) }),
  Schema.Struct({ outcome: Schema.Literal("changed"), payment: Schema.Unknown }),
  Schema.Struct({ outcome: Schema.Literal("replayed"), payment: Schema.Unknown }),
  Schema.Struct({ outcome: Schema.Literal("removed"), paymentId: Schema.String, movementId: Schema.String }),
  Schema.Struct({
    outcome: Schema.Literal("refused"),
    error: Schema.Union([
      Schema.Struct({ code: Schema.Literal("INVALID_TRANSITION"), status: Schema.String, event: Schema.String }),
      Schema.Struct({ code: Schema.Literal("ALREADY_SETTLED"), paymentId: Schema.String }),
      Schema.Struct({ code: Schema.Literals(["EVIDENCE_MISSING", "EVIDENCE_MISMATCH", "EVIDENCE_REPLAY"]) }),
    ]),
  }),
]);
/** `PaymentOccurrenceSnapshot` (model.ts:98, validator model.ts:121): Convex ids are strings. */
const OccurrenceSnapshot = Schema.Struct({
  id: Schema.String,
  consumptionId: Schema.String,
  evidenceJson: Schema.String,
  verificationAttempt: Schema.Number,
  txHash: Schema.String,
  eventLogIndex: Schema.Number,
  settledBlockNumber: Schema.optionalKey(Schema.Number),
  settledBlockHash: Schema.optionalKey(Schema.String),
  settledLogicalEventId: Schema.String,
});
/** `assetValidator` (movements/rules/movements.ts:191). */
const ScannedAsset = Schema.Struct({
  chainId: Schema.Literal(84532),
  tokenAddress: Schema.String,
  deploymentStartBlock: Schema.Number,
});
/** `MovementScanCheckpoint` (movements/rules/movements.ts). */
const Checkpoint = Schema.Struct({
  chainId: Schema.Literal(84532),
  tokenAddress: Schema.String,
  nextBlock: Schema.Number,
  anchorBlockNumber: Schema.Number,
  anchorBlockHash: Schema.String,
});
const ExecutionAdmissionArgs = Schema.Struct({
  authUserId: Schema.String,
  executionId: Schema.String,
  userOpHash: Schema.String,
});

// ── what shared helpers touch (not records: lists spread into the records below) ───────────

/** One entry per record when two helper lists overlap. */
const uniq = <T>(items: readonly T[]): T[] => [...new Set(items)];

/** paymentExecutionView (executions/views/executions.ts:52): a Payment's execution meaning. */
const EXECUTION_VIEW_READS = [table_payment_commands, table_money_executions, table_provider_send_attempts];
/** The counterparty label chain (views/recipients.ts): it reads four neighbours' tables directly (Accounts, Profiles, Organizations, Parties). */
const RECIPIENT_READS = [table_accounts, table_identities, table_orgs, table_counterparty_destinations];
const RECIPIENT_INVOKES = [procedure_parties_party_by_id, procedure_parties_party_by_safe_address];
/** paymentActivityView (views/activity.ts:45): asset, execution meaning and counterparty. */
const ACTIVITY_VIEW_READS = [table_payments, ...EXECUTION_VIEW_READS, ...RECIPIENT_READS];
const ACTIVITY_VIEW_INVOKES = [procedure_books_book_asset_by_id_in_tx, ...RECIPIENT_INVOKES];
/** toWirePayment (views/payments.ts:198) plus loadPaymentDocuments: the complete participant view. */
const WIRE_VIEW_READS = [...ACTIVITY_VIEW_READS, table_payment_schedules];
const WIRE_VIEW_INVOKES = [
  ...ACTIVITY_VIEW_INVOKES,
  procedure_banking_read_payout_delivery_in_tx,
  procedure_documents_current_payment_documents,
  procedure_documents_load_payment_documents,
];
/** authorizePaymentCommandSubmissionInTx (guards/authority.ts:172) and its route guards. */
const AUTHORITY_READS = [table_payments, table_money_executions, table_payment_schedules];
const ROUTE_INVOKES = [
  procedure_accounts_require_payment_account_in_tx,
  procedure_permissions_require_organization_spend_authority_in_tx,
  procedure_organizations_read_organization_safe_in_tx,
  procedure_permissions_read_worn_allowances_in_tx,
  procedure_payroll_read_department_spend_in_tx,
];
const AUTHORITY_INVOKES = [
  ...ROUTE_INVOKES,
  procedure_permissions_find_command_authority,
  procedure_organizations_read_owner_safes_in_tx,
];
const AUTHORITY_ERRORS = [error_INVALID_INPUT, error_ROLE_PERMISSION_DENIED, error_WRONG_STATE, error_UNKNOWN];
/** resolveRecipientSafe (commands/reads/recipients.ts:12): the birth and redirect writers' recipient Safe. It also reads `orgs` directly. */
const RESOLVE_SAFE_INVOKES = [
  procedure_accounts_resolve_account_recipient_safe_in_tx,
  procedure_parties_resolve_owned_payment_wallet_safe_in_tx,
];
/** serverPaymentRecipientInTx (commands/reads/recipients.ts:43): a resolved Safe as a closed recipient. */
const SERVER_RECIPIENT_INVOKES = [
  procedure_accounts_find_account_recipient_in_tx,
  procedure_organizations_read_organizations_at_safe_in_tx,
  procedure_accounts_require_payment_account_in_tx,
  procedure_parties_ensure_payment_wallet_destination_in_tx,
];
/** removeMovementProjection (movements/writes/overlays.ts) and the Deposit rollback it may run. */
const MOVEMENT_REMOVAL_INVOKES = [
  procedure_books_reverse_outside_money_in_tx,
  procedure_books_reverse_settled_payment_in_tx,
];

// ── the Payment ledger's writes ─────────────────────────────────────────────────────────────

export const procedure_payments_apply_payout_rail_delivery_in_tx = defineProcedure({
  id: "payments.apply-payout-rail-delivery-in-tx",
  title: "Apply a bank payout's rail delivery to its Payment",
  about:
    "Banking applies its delivery journal through the Payment sole writer (`writePaymentInTx` kind `apply_rail_delivery`). It reads the payout's delivery from Banking (none is a stored-row defect, UNKNOWN). A `pending` delivery, a Payment still `settling`, or a status that already matches replays. `done` moves an `in_transit` Payment to `settled` and stores the delivered output value; any other end moves `in_transit` or `settled` to `failed` (a bank can return a delivered payout). Either way it stores Banking's refund Movement id when there is one. A settled delivery also settles the Payroll run, schedules the Request's paid notice and records the money in Books. It schedules `payment_transitioned` (transition `settled` or `failed`, with Bridge's failure reason) through the writer telemetry, which its transitions already carry. A missing evidence field or a refused transition is returned as a `refused` outcome with code EVIDENCE_MISSING or INVALID_TRANSITION, not thrown. Money writes switched off throw NOT_IMPLEMENTED; an empty Payment id throws INVALID_INPUT (toPaymentId). Invoked today by banking: banking/payouts/writes/door.ts:251.",
  concept: concept_payments,
  input: Schema.Struct({ paymentId: Schema.String, now: Schema.Number }),
  output: WriteResult,
  errors: [error_NOT_IMPLEMENTED, error_INVALID_INPUT, error_UNKNOWN],
  reads: [table_payments, table_payment_commands, table_money_executions],
  writes: [table_payments],
  drives: [machine_payment.t.to_settled, machine_payment.t.to_failed],
  invokes: [
    procedure_banking_read_payout_delivery_in_tx,
    procedure_payroll_settle_run_for_settled_payment,
    procedure_requests_schedule_request_paid_notice_in_tx,
    procedure_books_record_settled_payment_in_tx,
  ],
  emits: [],
  was: [
    `${DOOR}:31`,
    `${P}/writes/ledger.ts:117`,
    `${P}/writes/ledger.ts:29`,
    `${P}/writes/rails.ts:14`,
    `${P}/events/writer.ts:72`,
    `${B}/banking/payouts/writes/door.ts:251`,
  ],
});

export const procedure_payments_birth_collection_payment_in_tx = defineProcedure({
  id: "payments.birth-collection-payment-in-tx",
  title: "Record an agreement collection as a Payment",
  about:
    "Payroll's agreements record a payee's landed `collect` as a Payment (slice 09). The PayrollDepartments module sent it through CapxulPayments V3 itself, so it has no command: the row is born `pending` and sent at once, so it is stored `settling`, an Organization `payroll` Payment of purpose `collection` keyed by its settlement id. A second birth with the same request key replays; any other second birth of the settlement is returned refused (INVALID_TRANSITION): the pure core refuses `birth` from every stored status, so the invariant throw after it (collections.ts:32) is unreachable. It ensures both ledger Parties and records the paid/paidBy contact edges, and on `created` schedules `payments.verifications.settle` for the new Payment at once (the settlement sweep covers a missed read). `now` defaults to the backend clock shim. Invoked today by payroll: payroll/agreements/writes/payees.ts:130.",
  concept: concept_payments,
  input: Schema.Struct({
    birth: Schema.Struct({
      settlementId: Schema.String,
      requestKey: Schema.String,
      orgId: Schema.String,
      recipient: Schema.Union([
        Schema.Struct({ kind: Schema.Literal("account"), accountId: Schema.String }),
        Schema.Struct({ kind: Schema.Literal("organization"), orgId: Schema.String }),
      ]),
      recipientSafe: Schema.String,
      paymentSenderSafe: Schema.String,
      amount: Schema.Struct({ asset: Schema.String, value: Schema.String }),
      permissionId: Schema.String,
      documentHash: Schema.String,
      txHash: Schema.String,
    }),
    now: Schema.optionalKey(Schema.Number),
  }),
  output: WriteResult,
  errors: [error_NOT_IMPLEMENTED, error_INVALID_INPUT, error_UNKNOWN],
  reads: [table_payments],
  writes: [table_payments],
  drives: [machine_payment.t.to_settling],
  invokes: [procedure_parties_ensure_ledger_party, procedure_parties_record_contact_edges],
  emits: [],
  was: [
    `${DOOR}:33`,
    `${P}/writes/ledger.ts:124`,
    `${P}/writes/collections.ts:17`,
    `${P}/verifications/writes/schedules.ts:60`,
    `${B}/payroll/agreements/writes/payees.ts:130`,
  ],
});

export const procedure_payments_ensure_proof_payout_payment_in_tx = defineProcedure({
  id: "payments.ensure-proof-payout-payment-in-tx",
  title: "Insert the devnet proof's funded bank payout Payment",
  about:
    "The one Payment row written outside `writePaymentInTx` (CAP-670): the operator's devnet Bridge payout fixture inserts a Payout from an Account's Safe, purpose `quick_pay`, recipient a `party_account`, already `in_transit` as a verified funding would leave it, with no chain evidence. A second call with the same Payment id changes nothing. Its operation refuses anywhere but a local devnet; this function itself does not check. Invoked today by operator: operator/fixtures/writes.ts:86.",
  concept: concept_payments,
  input: Schema.Struct({
    paymentId: Schema.String,
    accountId: Schema.String,
    sourceSafe: Schema.String,
    fundingAddress: Schema.String,
    settlementId: Schema.String,
    documentHash: Schema.String,
    quoteId: Schema.String,
    railOperationId: Schema.String,
    partyAccountId: Schema.String,
    ownerPartyId: Schema.String,
    recipientLabel: Schema.String,
    funding: Schema.Struct({ asset: Schema.String, value: Schema.String }),
    requestedOutput: Schema.Struct({ currency: Schema.String, value: Schema.String, decimals: Schema.Number }),
    at: Schema.Number,
  }),
  output: Schema.Void,
  errors: [error_INVALID_INPUT],
  reads: [table_payments],
  writes: [table_payments],
  drives: [machine_payment.t.to_in_transit],
  invokes: [],
  emits: [],
  was: [`${DOOR}:37`, `${P}/writes/proofs.ts:13`, `${P}/writes/proofs.ts:37`, `${B}/operator/fixtures/writes.ts:86`],
});

// ── reads Banking makes ─────────────────────────────────────────────────────────────────────

export const procedure_payments_read_payout_funding_in_tx = defineProcedure({
  id: "payments.read-payout-funding-in-tx",
  title: "How far a bank payout's funding got",
  about:
    "Banking asks before it records a rail delivery (CAP-474). `funded` when settlement evidence reached the Payment or it is `in_transit`/`settled`; `funding` while `settling` or `unresolved`; `unsent` while `pending`, `scheduled`, `streaming` or `pending_claim`; `abandoned` when `failed` or `cancelled`. A payout naming a Payment that does not exist is a stored-row defect (UNKNOWN, CAP-747). Invoked today by banking: banking/payouts/writes/door.ts:197, banking/payouts/writes/proofs.ts:98, banking/payouts/writes/retired-rows.ts:87, banking/payouts/rules/conversion.ts:22.",
  concept: concept_payments,
  input: Schema.Struct({ paymentId: Schema.String }),
  output: Schema.Literals(["funded", "funding", "unsent", "abandoned"]),
  errors: [error_UNKNOWN],
  reads: [table_payments],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  was: [`${DOOR}:35`, `${P}/reads/payouts.ts:24`, `${B}/banking/payouts/writes/door.ts:197`],
});

// ── reads Activity makes ────────────────────────────────────────────────────────────────────

export const procedure_payments_read_activity_settlement_links_in_tx = defineProcedure({
  id: "payments.read-activity-settlement-links-in-tx",
  title: "The Payments an actor's settlement ids and Payment ids name",
  about:
    "The stitch key of the payment lifecycle: each settlement id (and each Payment id) resolves to the Payment it belongs to, only for a Payment the actor sent or received, so a link never leaks another actor's Payment id. Each link carries the Payment's activity view and, when the row has full chain identity and a configured router (read from its command's prepared JSON), the indexed fact it is expected to match. Invoked today by activity: activity/overlays/reads.ts:40.",
  concept: concept_payments,
  input: Schema.Struct({
    actor: Viewer,
    settlementIds: Schema.Array(Schema.String),
    paymentIds: Schema.Array(Schema.String),
  }),
  output: Schema.Array(
    Schema.Struct({
      settlementId: Schema.UndefinedOr(Schema.String),
      paymentId: Schema.String,
      item: Schema.Unknown,
      expected: Schema.optionalKey(Schema.Unknown),
    }),
  ),
  errors: [error_INVALID_INPUT, error_UNKNOWN],
  reads: ACTIVITY_VIEW_READS,
  writes: [],
  drives: [],
  invokes: ACTIVITY_VIEW_INVOKES,
  emits: [],
  was: [`${DOOR}:42`, `${P}/reads/activity.ts:67`, `${P}/reads/routers.ts:24`, `${B}/activity/overlays/reads.ts:40`],
});

export const procedure_payments_read_payment_activity_view_in_tx = defineProcedure({
  id: "payments.read-payment-activity-view-in-tx",
  title: "One Payment's activity row for a viewer",
  about:
    "Activity paginates ids; Payments projects the row: its exact asset (from Books), execution meaning, direction and counterparty label. `item` is the `PaymentActivityView` (deep, Schema.Unknown). A Payment id with no row throws INVALID_INPUT; a viewer who is not a participant, or a counterparty that no longer exists, throws INVALID_INPUT; a row whose ledger fields or asset do not hold throws UNKNOWN. Invoked today by activity: activity/items/reads/pages.ts:179, activity/items/reads/changes.ts:43.",
  concept: concept_payments,
  input: ReadReference,
  output: Schema.Unknown,
  errors: [error_INVALID_INPUT, error_UNKNOWN],
  reads: ACTIVITY_VIEW_READS,
  writes: [],
  drives: [],
  invokes: ACTIVITY_VIEW_INVOKES,
  emits: [],
  was: [`${DOOR}:43`, `${P}/reads/activity.ts:223`, `${P}/views/activity.ts:45`, `${B}/activity/items/reads/pages.ts:179`],
});

export const procedure_payments_read_payment_activity_window_in_tx = defineProcedure({
  id: "payments.read-payment-activity-window-in-tx",
  title: "One page of an actor's sent or received Payments",
  about:
    "Newest first inside a creation window, through `by_actor_created` (sent) or `by_recipient_actor_created` (received); a window whose `from` equals `to` with `beforeCreationTime` resumes inside one millisecond. `take` is a count or `all`. Returns candidates only: id, status, createdAt and Convex creation time. Invoked today by activity: activity/items/reads/pages.ts:53, activity/items/reads/summaries.ts:43.",
  concept: concept_payments,
  input: Schema.Struct({ side: Side, actor: Viewer, window: ActivityWindow, take: Take }),
  output: Schema.Array(
    Schema.Struct({
      paymentId: Schema.String,
      status: Schema.UndefinedOr(Schema.String),
      createdAt: Schema.Number,
      creationTime: Schema.Number,
    }),
  ),
  errors: [],
  reads: [table_payments],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  was: [`${DOOR}:44`, `${P}/reads/activity.ts:120`, `${B}/activity/items/reads/pages.ts:53`],
});

export const procedure_payments_read_payment_changes_in_tx = defineProcedure({
  id: "payments.read-payment-changes-in-tx",
  title: "An actor's Payments in the order they last changed",
  about:
    "Oldest change first from a position (`since`, or an exact `updatedAt` and creation time), through `by_actor_updated` or `by_recipient_actor_updated`; a Payment that changes again moves past the position, so a reader resuming from it reads the change. Invoked today by activity: activity/items/reads/changes.ts:35.",
  concept: concept_payments,
  input: Schema.Struct({
    side: Side,
    actor: Viewer,
    position: Schema.Union([
      Schema.Struct({ since: Schema.Number }),
      Schema.Struct({ updatedAt: Schema.Number, creationTime: Schema.Number }),
    ]),
    take: Schema.Number,
  }),
  output: Schema.Array(
    Schema.Struct({ paymentId: Schema.String, updatedAt: Schema.Number, creationTime: Schema.Number }),
  ),
  errors: [],
  reads: [table_payments],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  was: [`${DOOR}:45`, `${P}/reads/activity.ts:171`, `${B}/activity/items/reads/changes.ts:35`],
});

export const procedure_payments_read_payment_summary_in_tx = defineProcedure({
  id: "payments.read-payment-summary-in-tx",
  title: "One Payment's summary fact for a viewer",
  about:
    "The aggregate-bucket fact for one Payment: asset, status, direction and the raw amount that moved (0 for a self-transfer; the escrowed raw amount, not the kept amount, for a cancelled commitment). An unsent incoming Payment contributes `{ notSent: true }`. No document or recipient reads, and no participant check: a viewer who did not take part reads the Payment as direction `in` (views/payments.ts:107). A missing row throws INVALID_INPUT; broken ledger fields or asset throw UNKNOWN. Invoked today by activity: activity/items/reads/summaries.ts:56.",
  concept: concept_payments,
  input: ReadReference,
  output: Schema.Union([
    Schema.Struct({ notSent: Schema.Literal(true) }),
    Schema.Struct({
      notSent: Schema.Literal(false),
      asset: Schema.String,
      status: Schema.String,
      direction: Schema.Literals(["in", "out", "self"]),
      rawAmount: Schema.BigInt,
    }),
  ]),
  errors: [error_INVALID_INPUT, error_UNKNOWN],
  reads: [table_payments, ...EXECUTION_VIEW_READS],
  writes: [],
  drives: [],
  invokes: [procedure_books_book_asset_by_id_in_tx],
  emits: [],
  was: [`${DOOR}:46`, `${P}/reads/activity.ts:234`, `${P}/views/activity.ts:77`, `${B}/activity/items/reads/summaries.ts:56`],
});

export const procedure_payments_is_payment_participant_in_tx = defineProcedure({
  id: "payments.is-payment-participant-in-tx",
  title: "Whether a viewer sent or received a Payment",
  about:
    "Activity annotations keep the first-row participant check: false for an unknown Payment id. Invoked today by activity: activity/annotations/guards.ts:85.",
  concept: concept_payments,
  input: Schema.Struct({ paymentId: Schema.String, viewer: Viewer }),
  output: Schema.Boolean,
  errors: [],
  reads: [table_payments],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  was: [`${DOOR}:49`, `${P}/reads/participants.ts:86`, `${B}/activity/annotations/guards.ts:85`],
});

export const procedure_payments_find_payment_read_reference_in_tx = defineProcedure({
  id: "payments.find-payment-read-reference-in-tx",
  title: "Admit a participant's read of one Payment",
  about:
    "Resolves who reads the Payment before observation names it: an explicit `actor` and `referenceActor` must each pass the session's read scope (Access) and agree; otherwise the principal's own Account, then any participant whose scope it can read. Null for an unknown Payment or a viewer who did not take part. A refused scope throws INVALID_INPUT `actor not found`; two explicit actors that differ throw INVALID_INPUT `must match reference.actor`. Input is `PaymentDetailReadInput` (model.ts:62): `actor` spells an Organization `org`, `referenceActor` spells it `organization`. Invoked today by activity: activity/items/reads/details.ts:37.",
  concept: concept_payments,
  input: Schema.Struct({
    paymentId: Schema.String,
    principal: Schema.Struct({ authUserId: Schema.String, accountId: Schema.String }),
    actor: Schema.optionalKey(
      Schema.Union([
        Schema.Struct({ kind: Schema.Literal("account") }),
        Schema.Struct({ kind: Schema.Literal("org"), orgId: Schema.String }),
      ]),
    ),
    referenceActor: Schema.optionalKey(
      Schema.Union([
        Schema.Struct({ kind: Schema.Literal("account"), accountId: Schema.String }),
        Schema.Struct({ kind: Schema.Literal("organization"), orgId: Schema.String }),
      ]),
    ),
  }),
  output: Schema.NullOr(ReadReference),
  errors: [error_INVALID_INPUT],
  reads: [table_payments],
  writes: [],
  drives: [],
  invokes: [procedure_access_can_read_scope_in_tx],
  emits: [],
  was: [`${DOOR}:56`, `${P}/reads/payments.ts:115`, `${P}/reads/payments.ts:95`, `${B}/activity/items/reads/details.ts:37`],
});

export const procedure_payments_read_payment_detail_in_tx = defineProcedure({
  id: "payments.read-payment-detail-in-tx",
  title: "One Payment's full view and settlement evidence",
  about:
    "For an admitted participant: the complete wire Payment (documents, labels, timing, schedule, execution meaning, payout delivery) and its settlement evidence against the router its command named (a Deposit's evidence is read from its Movement). Null when the viewer did not take part. Both halves are deep (Schema.Unknown). Invoked today by activity: activity/items/reads/details.ts:49.",
  concept: concept_payments,
  input: ReadReference,
  output: Schema.NullOr(Schema.Struct({ payment: Schema.Unknown, evidence: Schema.NullOr(Schema.Unknown) })),
  errors: [error_INVALID_INPUT, error_UNKNOWN],
  reads: [...WIRE_VIEW_READS, table_movements],
  writes: [],
  drives: [],
  invokes: WIRE_VIEW_INVOKES,
  emits: [],
  was: [`${DOOR}:57`, `${P}/reads/payments.ts:146`, `${P}/views/evidence.ts:19`, `${P}/views/payments.ts:198`, `${B}/activity/items/reads/details.ts:49`],
});

export const procedure_payments_read_movement_activity_view_in_tx = defineProcedure({
  id: "payments.read-movement-activity-view-in-tx",
  title: "One Movement's activity row",
  about:
    "A refund or outflow Movement as an activity row: amount from the Books asset, direction, short counterparty address, receipt. Null when a materialized Deposit Payment already shows the transfer, or the Movement is not included. A `protocol_settlement` candidate is an invariant defect (UNKNOWN); a `deposit` candidate with no materialized Deposit, or an unknown token, is a stored-row defect. Invoked today by activity: activity/items/reads/pages.ts:183.",
  concept: concept_payments,
  input: Schema.Struct({ attribution: MovementCandidate }),
  output: Schema.NullOr(Schema.Unknown),
  errors: [error_UNKNOWN],
  reads: [table_movements, table_deposit_materializations],
  writes: [],
  drives: [],
  invokes: [procedure_books_book_asset_in_tx],
  emits: [],
  was: [`${DOOR}:116`, `${P}/movements/reads/activity.ts:18`, `${B}/activity/items/reads/pages.ts:183`],
});

export const procedure_payments_read_movement_summary_fact_in_tx = defineProcedure({
  id: "payments.read-movement-summary-fact-in-tx",
  title: "One Movement's summary fact",
  about:
    "Only a `movement_only_outflow` Movement that is included and has no materialized Deposit counts toward the summary buckets: its asset and raw amount. Anything else is null; a `protocol_settlement` candidate is an invariant defect. Invoked today by activity: activity/items/reads/summaries.ts:63.",
  concept: concept_payments,
  input: Schema.Struct({ attribution: MovementCandidate }),
  output: Schema.NullOr(Schema.Struct({ asset: Schema.String, rawAmount: Schema.BigInt })),
  errors: [error_UNKNOWN],
  reads: [table_movements, table_deposit_materializations],
  writes: [],
  drives: [],
  invokes: [procedure_books_book_asset_in_tx],
  emits: [],
  was: [`${DOOR}:118`, `${P}/movements/reads/activity.ts:70`, `${B}/activity/items/reads/summaries.ts:63`],
});

export const procedure_payments_read_movement_activity_window_in_tx = defineProcedure({
  id: "payments.read-movement-activity-window-in-tx",
  title: "One page of an actor's Movement attributions",
  about:
    "Newest first inside a creation window through `movementAttributions.by_actor_created`, the candidates Activity merges with Payments. Invoked today by activity: activity/items/reads/pages.ts:83, activity/items/reads/summaries.ts:45.",
  concept: concept_payments,
  input: Schema.Struct({ actor: Viewer, window: ActivityWindow, take: Take }),
  output: Schema.Array(MovementCandidate),
  errors: [],
  reads: [table_movement_attributions],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  was: [`${DOOR}:117`, `${P}/movements/reads/activity.ts:97`, `${B}/activity/items/reads/pages.ts:83`],
});

export const procedure_payments_read_movement_detail_in_tx = defineProcedure({
  id: "payments.read-movement-detail-in-tx",
  title: "One Movement's detail for an admitted principal",
  about:
    "Admits the principal (an explicit actor through Access's financial read scope, else the first attribution whose scope it can read), calls the caller's `observation.onAuthorized` callback (before the `protocol_settlement` refusal below), then projects the Movement's evidence, its Deposit link, the actor's activity annotation (Activity) and its memo documents (Documents). Null for an unknown, excluded or unattributed Movement. A `protocol_settlement` attribution throws INVALID_INPUT. The evidence it returns is hard-coded `verification: verified` and `canonicalState: finalized` for any included Movement. Principal, actor, observation and the detail are deep (Schema.Unknown). Invoked today by activity: activity/items/reads/details.ts:73.",
  concept: concept_payments,
  input: Schema.Struct({
    movementId: Schema.String,
    principal: Schema.Unknown,
    getActor: Schema.optionalKey(Schema.Unknown),
    observation: Schema.optionalKey(Schema.Unknown),
  }),
  output: Schema.NullOr(Schema.Unknown),
  errors: [error_INVALID_INPUT],
  reads: [table_movements, table_movement_attributions, table_deposit_materializations],
  writes: [],
  drives: [],
  invokes: [
    procedure_access_require_financial_read_scope_in_tx,
    procedure_access_can_read_scope_in_tx,
    procedure_activity_read_annotation_in_tx,
    procedure_documents_read_movement_memo_for_occurrence_in_tx,
  ],
  emits: [],
  was: [`${DOOR}:122`, `${P}/movements/reads/movements.ts:52`, `${B}/activity/items/reads/details.ts:73`],
});

export const procedure_payments_require_movement_annotation_reference_in_tx = defineProcedure({
  id: "payments.require-movement-annotation-reference-in-tx",
  title: "Admit an annotation on a Movement",
  about:
    "Only an included Movement the viewer has a `movement_only_outflow` attribution on, with no materialized Deposit, can carry its annotation; anything else throws INVALID_INPUT `activity row not found`. Invoked today by activity: activity/annotations/guards.ts:91.",
  concept: concept_payments,
  input: Schema.Struct({ movementId: Schema.String, viewer: Viewer }),
  output: Schema.Void,
  errors: [error_INVALID_INPUT],
  reads: [table_movements, table_movement_attributions, table_deposit_materializations],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  was: [`${DOOR}:123`, `${P}/movements/reads/movements.ts:129`, `${B}/activity/annotations/guards.ts:91`],
});

// ── reads Documents makes ───────────────────────────────────────────────────────────────────

export const procedure_payments_read_payment_participants_in_tx = defineProcedure({
  id: "payments.read-payment-participants-in-tx",
  title: "The actors who took part in a Payment",
  about:
    "A document link exposes participants, not Payment storage: the sender and, when the recipient is an Account or Organization, the recipient. Empty for an unknown Payment. Invoked today by documents: documents/guards.ts:44.",
  concept: concept_payments,
  input: Schema.Struct({ paymentId: Schema.String }),
  output: Schema.Array(Viewer),
  errors: [],
  reads: [table_payments],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  was: [`${DOOR}:53`, `${P}/reads/participants.ts:99`, `${B}/documents/guards.ts:44`],
});

export const procedure_payments_read_document_carrier_payments_in_tx = defineProcedure({
  id: "payments.read-document-carrier-payments-in-tx",
  title: "The Payments one document is linked to",
  about:
    "Reads Documents' `financialDocumentLinks` table directly by document and content hash, keeps the `payment` links and returns each linked Payment's stored row, de-duplicated. The raw Convex `payments` documents leave the concept (Schema.Unknown). Invoked today by documents: documents/reads/parties.ts:153.",
  concept: concept_payments,
  input: Schema.Struct({ documentHash: Schema.String, contentHash: Schema.String }),
  output: Schema.Array(Schema.Unknown),
  errors: [],
  reads: [table_financial_document_links, table_payments],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  was: [`${DOOR}:51`, `${P}/reads/participants.ts:119`, `${B}/documents/reads/parties.ts:153`],
});

export const procedure_payments_lookup_party_recipient = defineProcedure({
  id: "payments.lookup-party-recipient",
  title: "Name a Party recipient by label",
  about:
    "A Party recipient's label: the destination's own label, else the Party's public display name or handle, else its id (never its Safe address or mailbox, ADR-0022 R1). `{ missing }` when the Party does not exist. Output is `RecipientLookup` (Schema.Unknown). Invoked today by documents: documents/reads/parties.ts:17.",
  concept: concept_payments,
  input: Schema.Struct({ partyId: Schema.String, destinationLabel: Schema.optionalKey(Schema.String) }),
  output: Schema.Unknown,
  errors: [],
  reads: [],
  writes: [],
  drives: [],
  invokes: [procedure_parties_party_by_id],
  emits: [],
  was: [`${DOOR}:85`, `${P}/views/recipients.ts:47`, `${B}/documents/reads/parties.ts:17`],
});

export const procedure_payments_lookup_actor_recipient = defineProcedure({
  id: "payments.lookup-actor-recipient",
  title: "Name an Account or Organization by label",
  about:
    "An Account is named by its owner's identity display name through the Party at its Safe; an Organization by its name through its Party. Reads Accounts' `accounts`, Profiles' `identities` and Organizations' `orgs` tables directly. `{ missing }` when the actor or its Party is gone. Invoked today by documents: documents/reads/parties.ts:16.",
  concept: concept_payments,
  input: Schema.Struct({ kind: Actor, id: Schema.String }),
  output: Schema.Unknown,
  errors: [],
  reads: [table_accounts, table_identities, table_orgs],
  writes: [],
  drives: [],
  invokes: RECIPIENT_INVOKES,
  emits: [],
  was: [`${DOOR}:84`, `${P}/views/recipients.ts:68`, `${B}/documents/reads/parties.ts:16`],
});

export const procedure_payments_lookup_payment_recipient = defineProcedure({
  id: "payments.lookup-payment-recipient",
  title: "Name the recipient of a stored Payment row",
  about:
    "An Account or Organization recipient through `lookupActorRecipient`; a saved destination by reading Parties' `counterpartyDestinations` table directly (a self-owned one is an external wallet, else its Party); a bank `party_account` by its stored payout label. `{ missing }` otherwise. Takes the stored `payments` row (Schema.Unknown). Invoked today by documents: documents/reads/parties.ts:18.",
  concept: concept_payments,
  input: Schema.Struct({ row: Schema.Unknown }),
  output: Schema.Unknown,
  errors: [],
  reads: RECIPIENT_READS,
  writes: [],
  drives: [],
  invokes: RECIPIENT_INVOKES,
  emits: [],
  was: [`${DOOR}:86`, `${P}/views/recipients.ts:96`, `${B}/documents/reads/parties.ts:18`],
});

export const procedure_payments_capture_memo_conflict_removal_in_tx = defineProcedure({
  id: "payments.capture-memo-conflict-removal-in-tx",
  title: "Capture the Movement removals a Memo conflict needs",
  about:
    "Reads the Movement rows of one Transfer identity now and returns a function the caller runs later in the same transaction: it removes each Movement's projection (attributions deleted, Movement marked `removed`, outside money reversed in Books) and rolls back a materialized Deposit (its Payment deleted, Books reversed, materialization marked `removed`). The rollback goes through the deposit writer, so money writes switched off throw NOT_IMPLEMENTED there; a rollback the writer refuses prints `payment_writer_incident` and then throws an invariant defect (UNKNOWN, overlays.ts:62), aborting the caller's transaction. The capture reads by the identity exactly as given, without the lower-casing loadMovement applies. Output is that function (Schema.Unknown). Invoked today by documents: documents/writes/memos.ts:202.",
  concept: concept_payments,
  input: Schema.Struct({ identity: TransferIdentity, now: Schema.optionalKey(Schema.Number) }),
  output: Schema.Unknown,
  errors: [error_NOT_IMPLEMENTED, error_UNKNOWN],
  reads: [table_movements, table_movement_attributions, table_deposit_materializations, table_payments],
  writes: [table_movements, table_movement_attributions, table_deposit_materializations, table_payments],
  drives: [machine_movement.t.to_removed, machine_deposit_materialization.t.to_removed],
  invokes: MOVEMENT_REMOVAL_INVOKES,
  emits: [event_payment_writer_incident],
  was: [
    `${DOOR}:141`,
    `${P}/movements/writes/corrections.ts:29`,
    `${P}/movements/writes/overlays.ts:40`,
    `${P}/writes/rollbacks.ts:17`,
    `${B}/documents/writes/memos.ts:202`,
  ],
});

// ── reads the operator makes ────────────────────────────────────────────────────────────────

export const procedure_payments_read_account_ledger_references_in_tx = defineProcedure({
  id: "payments.read-account-ledger-references-in-tx",
  title: "The ledger tables that still name an Account",
  about:
    "For an operator purge: which of `payments` (sent or received) and `movementAttributions` still name any of the Accounts, as table names. That history is kept. Invoked today by operator: operator/identities/guards.ts:37.",
  concept: concept_payments,
  input: Schema.Struct({ accountIds: Schema.Array(Schema.String) }),
  output: Schema.Array(Schema.Literals(["payments", "movementAttributions"])),
  errors: [],
  reads: [table_payments, table_movement_attributions],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  was: [`${DOOR}:50`, `${P}/reads/participants.ts:153`, `${B}/operator/identities/guards.ts:37`],
});

// ── reads and writes Requests makes ─────────────────────────────────────────────────────────

export const procedure_payments_read_request_payment_in_tx = defineProcedure({
  id: "payments.read-request-payment-in-tx",
  title: "A Request's Payment as its sender sees it",
  about:
    "Requests admits the link; Payments returns the complete sender-relative wire Payment with its documents (Schema.Unknown), or null for an unknown id. Invoked today by requests: requests/views.ts:42.",
  concept: concept_payments,
  input: Schema.Struct({ paymentId: Schema.String }),
  output: Schema.NullOr(Schema.Unknown),
  errors: [error_INVALID_INPUT, error_UNKNOWN],
  reads: WIRE_VIEW_READS,
  writes: [],
  drives: [],
  invokes: WIRE_VIEW_INVOKES,
  emits: [],
  was: [`${DOOR}:59`, `${P}/reads/payments.ts:208`, `${B}/requests/views.ts:42`],
});

export const procedure_payments_prepare_payment_command_in_tx = defineProcedure({
  id: "payments.prepare-payment-command-in-tx",
  title: "Prepare a payment command: authorize, freeze, replay or store",
  about:
    "The one writer of payment commands. Decodes the `PaymentCommand` (a birth of one or more sends, or a lifecycle step on one Payment), authorizes the signed-in Account and the route (direct, Zodiac role, Budget, Directors, void), replays a settled birth or an identical earlier request, and otherwise births each Payment through the ledger writer, prepares and links its documents (Documents), binds a bank payout's quote (Banking), records a Budget settlement and the invoice-checkout link (Requests), stores the prepared command and links its Payments. Writes Requests' `invoiceCheckoutPayments` and reads Requests' `paymentRequests` and Organizations' `orgs` directly. A commitment birth is born `scheduled`, `streaming` or `pending_claim`; a plain one `pending`. Optional callbacks `onAuthorized` and `onLifecyclePayment` run inside. `now` defaults to the clock shim. Input and output are deep (Schema.Unknown). Invoked today by requests: requests/writes/approvals.ts:104, requests/writes/checkouts.ts:130, requests/writes/purchases.ts:234; and inside payments by prepareOrganizationPaymentInTx and replayRequestPaymentApprovalInTx.",
  concept: concept_payments,
  input: Schema.Struct({
    authUserId: Schema.String,
    input: Schema.Unknown,
    onAuthorized: Schema.optionalKey(Schema.Unknown),
    callerIntent: Schema.optionalKey(Schema.Unknown),
    onLifecyclePayment: Schema.optionalKey(Schema.Unknown),
    now: Schema.optionalKey(Schema.Number),
    budgetCancels: Schema.optionalKey(Schema.Array(Schema.String)),
  }),
  output: Schema.Unknown,
  errors: [error_NOT_IMPLEMENTED, ...AUTHORITY_ERRORS],
  reads: [
    table_payments,
    table_payment_commands,
    table_payment_document_intents,
    table_money_executions,
    table_payment_schedules,
    table_orgs,
    table_payment_requests,
  ],
  writes: [table_payment_commands, table_payment_document_intents, table_payments, table_invoice_checkout_payments],
  drives: [
    machine_payment.t.to_pending,
    machine_payment.t.to_scheduled,
    machine_payment.t.to_streaming,
    machine_payment.t.to_pending_claim,
    machine_payment_command.t.to_prepared,
    machine_payment_command_verification.t.to_not_started,
  ],
  invokes: uniq([
    ...AUTHORITY_INVOKES,
    ...RESOLVE_SAFE_INVOKES,
    procedure_documents_prepare_payment_documents_in_tx,
    procedure_documents_link_payment_document_in_tx,
    procedure_documents_admit_payment_document_pair_in_tx,
    procedure_banking_read_payout_quote_for_payment_in_tx,
    procedure_banking_bind_payout_payment_in_tx,
    procedure_requests_record_budget_settlement_in_tx,
    procedure_requests_invoice_birth_identity,
    procedure_requests_offer_checkout_birth_identity,
    procedure_requests_request_memo_birth_identity,
    procedure_parties_ensure_ledger_party,
    procedure_parties_record_contact_edges,
  ]),
  emits: [],
  was: [
    `${DOOR}:106`,
    `${P}/commands/writes/commands.ts:82`,
    `${P}/commands/writes/items.ts:210`,
    `${P}/commands/writes/replays.ts:23`,
    `${P}/commands/reads/authorities.ts:36`,
    `${P}/writes/births.ts:169`,
    `${B}/requests/writes/approvals.ts:104`,
  ],
});

export const procedure_payments_replay_request_payment_approval_in_tx = defineProcedure({
  id: "payments.replay-request-payment-approval-in-tx",
  title: "Replay a Request Payment's original intent",
  about:
    "Before any mutable recipient lookup: reads the Payment's command and prepares its stored `intentJson` again through `preparePaymentCommandInTx`, so the same request digest replays. A Payment with no command, or a command that is gone, is a stored-row defect (UNKNOWN). Invoked today by requests: requests/writes/approvals.ts:88.",
  concept: concept_payments,
  input: Schema.Struct({
    authUserId: Schema.String,
    paymentId: Schema.String,
    onAuthorized: Schema.optionalKey(Schema.Unknown),
    callerIntent: Schema.optionalKey(Schema.Unknown),
  }),
  output: Schema.Unknown,
  errors: [error_UNKNOWN],
  reads: [table_payments, table_payment_commands],
  writes: [],
  drives: [],
  invokes: [procedure_payments_prepare_payment_command_in_tx],
  emits: [],
  was: [`${DOOR}:107`, `${P}/commands/writes/replays.ts:100`, `${B}/requests/writes/approvals.ts:88`],
});

export const procedure_payments_find_payment_intent_in_tx = defineProcedure({
  id: "payments.find-payment-intent-in-tx",
  title: "The saved document intent of an actor's request key",
  about:
    "Reads the saved resolution before mutable recipient or Payroll lookups: the `paymentDocumentIntents` row for the actor and request key, or null. A row whose caller-intent digest (sha256 of the caller's intent) differs throws INVALID_INPUT `already used for different document intent`. Returns the stored row (Schema.Unknown). Invoked today by payroll: payroll/runs/writes/runs.ts:94; and inside payments.",
  concept: concept_payments,
  input: Schema.Struct({
    actor: Viewer,
    requestKey: Schema.String,
    callerIntent: Schema.Unknown,
  }),
  output: Schema.NullOr(Schema.Unknown),
  errors: [error_INVALID_INPUT],
  reads: [table_payment_document_intents],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  was: [`${DOOR}:108`, `${P}/commands/writes/intents.ts:52`, `${B}/payroll/runs/writes/runs.ts:94`],
});

export const procedure_payments_voided_by_landed_void_in_tx = defineProcedure({
  id: "payments.voided-by-landed-void-in-tx",
  title: "Whether a landed void used up a scheduled command",
  about:
    "True when the command's latest schedule is `cancelled` and names a `void_schedule` command that completed `settled`: that scheduled payment can never be sent. Invoked today by requests: requests/reads/attempts.ts:57.",
  concept: concept_payments,
  input: Schema.Struct({ commandId: Schema.String }),
  output: Schema.Boolean,
  errors: [],
  reads: [table_payment_schedules, table_payment_commands],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  was: [`${DOOR}:173`, `${P}/schedules/reads.ts:40`, `${B}/requests/reads/attempts.ts:57`],
});

export const procedure_payments_actor_inventory = defineProcedure({
  id: "payments.actor-inventory",
  title: "The Accounts and Organizations at a set of addresses",
  about:
    "Keyed by lowercase address: Accounts first, then Organizations, each oldest first, two index reads per address through Accounts and Organizations. An address no actor holds has no key. Output is a `Map<string, StoredActor[]>` (Schema.Unknown). Invoked today by requests: requests/writes/receipts.ts:128; and inside payments by the Movement scanner.",
  concept: concept_payments,
  input: Schema.Struct({ addresses: Schema.Array(Schema.String) }),
  output: Schema.Unknown,
  errors: [],
  reads: [],
  writes: [],
  drives: [],
  invokes: [procedure_accounts_read_accounts_at_safe_in_tx, procedure_organizations_read_organizations_at_safe_in_tx],
  emits: [],
  was: [`${DOOR}:114`, `${P}/movements/reads/identities.ts:89`, `${B}/requests/writes/receipts.ts:128`],
});

// ── reads and writes Payroll makes ──────────────────────────────────────────────────────────

export const procedure_payments_prepare_organization_payment_in_tx = defineProcedure({
  id: "payments.prepare-organization-payment-in-tx",
  title: "Prepare an Organization's batch of Payments",
  about:
    "Decodes `PrepareOrganizationPaymentExecutionInput` (orgId, requestKey, permissionId, signerAddress, items, lineage), refuses streams and an empty batch, then either replays the saved resolution of the same request key or resolves every recipient (a bank payout's accepted quote from Banking; otherwise Parties' resolution and the server recipient Safe), takes Payroll documents only from the run, builds the birth command and prepares it through `preparePaymentCommandInTx`. The signer must be the caller's own Account Safe, checked only after the command is prepared (INVALID_INPUT, aborting the transaction). Stores the recipient observations on the command once; a replay returns the stored ones, or stores `[]` when the command has none. A saved resolution without `resolvedCommandJson` is a stored-row defect (UNKNOWN). `now` defaults to the clock shim. Input items and the prepared command are deep (Schema.Unknown). Invoked today by payroll: payroll/runs/writes/runs.ts:76.",
  concept: concept_payments,
  input: Schema.Struct({
    authUserId: Schema.String,
    input: Schema.Unknown,
    payrollDocuments: Schema.optionalKey(Schema.Array(Schema.Unknown)),
    payrollCallerIntent: Schema.optionalKey(Schema.Unknown),
    now: Schema.optionalKey(Schema.Number),
  }),
  output: Schema.Struct({ command: Schema.Unknown, recipientObservations: Schema.Array(Schema.Unknown) }),
  errors: [error_INVALID_INPUT, error_UNKNOWN],
  reads: [table_payment_document_intents, table_payment_commands],
  writes: [table_payment_commands],
  drives: [],
  invokes: [
    procedure_payments_find_payment_intent_in_tx,
    procedure_payments_prepare_payment_command_in_tx,
    procedure_accounts_require_account_signer_in_tx,
    procedure_parties_resolve_payment_recipient_in_tx,
    procedure_banking_read_payout_quote_for_payment_in_tx,
    ...SERVER_RECIPIENT_INVOKES,
  ],
  emits: [],
  was: [
    `${DOOR}:91`,
    `${P}/commands/writes/organizations.ts:37`,
    `${P}/commands/writes/organizations.ts:219`,
    `${P}/commands/writes/observations.ts:30`,
    `${B}/payroll/runs/writes/runs.ts:76`,
  ],
});

export const procedure_payments_read_collection_payment_in_tx = defineProcedure({
  id: "payments.read-collection-payment-in-tx",
  title: "An agreement collection's status for its payee",
  about:
    "The collection Payment's status (an unset status reads `pending`) and, once settled, when (its terminal time, else its last update). Null for an unknown id or a Payment that is not a `collection`. Invoked today by payroll: payroll/agreements/reads/payee.ts:78.",
  concept: concept_payments,
  input: Schema.Struct({ paymentId: Schema.String }),
  output: Schema.NullOr(Schema.Struct({ status: Schema.String, settledAt: Schema.NullOr(Schema.Number) })),
  errors: [],
  reads: [table_payments],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  was: [`${DOOR}:92`, `${P}/reads/payroll.ts:97`, `${B}/payroll/agreements/reads/payee.ts:78`],
});

export const procedure_payments_read_payroll_payment_view_in_tx = defineProcedure({
  id: "payments.read-payroll-payment-view-in-tx",
  title: "One Payment of a saved Payroll run, proved",
  about:
    "Payroll admits its frozen run item; Payments proves the one stored row matches the proof (command, Organization, run, employee Party, settlement id, document hash, token, decimals, raw and exact amount, both Safes), that the viewer took part and that a `payslip` instruction document is linked, then projects the wire Payment. Any mismatch throws INVALID_INPUT `Saved Payroll run proof is missing or contradictory`. The proof and the view are deep (Schema.Unknown). Invoked today by payroll: payroll/runs/reads/details.ts:114.",
  concept: concept_payments,
  input: Schema.Struct({ paymentId: Schema.String, viewer: Viewer, proof: Schema.Unknown }),
  output: Schema.Unknown,
  errors: [error_INVALID_INPUT, error_UNKNOWN],
  reads: WIRE_VIEW_READS,
  writes: [],
  drives: [],
  invokes: WIRE_VIEW_INVOKES,
  emits: [],
  was: [`${DOOR}:92`, `${P}/reads/payroll.ts:69`, `${B}/payroll/runs/reads/details.ts:114`],
});

export const procedure_payments_find_payment_replay_source_in_tx = defineProcedure({
  id: "payments.find-payment-replay-source-in-tx",
  title: "The saved command a Payroll run names",
  about:
    "The command's id, actor, request key and Payment ids, with the stored row kept behind a private symbol until Payroll admits its saved source. Null for an unknown command. Invoked today by payroll: payroll/runs/reads/replays.ts:51.",
  concept: concept_payments,
  input: Schema.Struct({ commandId: Schema.String }),
  output: Schema.NullOr(
    Schema.Struct({
      commandId: Schema.String,
      actorKind: Actor,
      actorId: Schema.String,
      requestKey: Schema.UndefinedOr(Schema.String),
      paymentIds: Schema.Array(Schema.String),
    }),
  ),
  errors: [],
  reads: [table_payment_commands],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  was: [`${DOOR}:95`, `${P}/reads/replays.ts:73`, `${B}/payroll/runs/reads/replays.ts:51`],
});

export const procedure_payments_prove_payroll_payment_replay_in_tx = defineProcedure({
  id: "payments.prove-payroll-payment-replay-in-tx",
  title: "Prove a Payroll run's saved Payment cohort",
  about:
    "Each saved Payment must be the one row of its id, on this command, Organization and run; the caller must still be authorized to submit the command (the full submission authority check); the hydrated prepared command must match the command id, chain and order; every item must match its retry intent. Any mismatch throws INVALID_INPUT `Stored Payroll replay proof is missing or contradictory`. Source, intent and the proof are deep (Schema.Unknown). Invoked today by payroll: payroll/runs/reads/replays.ts:65.",
  concept: concept_payments,
  input: Schema.Struct({
    source: Schema.Unknown,
    intent: Schema.Unknown,
    reference: Schema.Struct({
      authUserId: Schema.String,
      commandId: Schema.String,
      orgId: Schema.String,
      runId: Schema.String,
      chainId: Schema.Number,
    }),
  }),
  output: Schema.Unknown,
  errors: AUTHORITY_ERRORS,
  reads: AUTHORITY_READS,
  writes: [],
  drives: [],
  invokes: AUTHORITY_INVOKES,
  emits: [],
  was: [`${DOOR}:97`, `${P}/reads/replays.ts:98`, `${P}/guards/authority.ts:172`, `${B}/payroll/runs/reads/replays.ts:65`],
});

export const procedure_payments_read_payment_command_completion_in_tx = defineProcedure({
  id: "payments.read-payment-command-completion-in-tx",
  title: "Whether an Organization's exact request completed",
  about:
    "Admits only a command of this Organization and request key that resolved `failed` or `settled` (completion outcome, else terminal outcome) and whose verification is neither `unresolved` nor `mismatch`; null otherwise. Invoked today by payroll: payroll/runs/writes/runs.ts:50.",
  concept: concept_payments,
  input: Schema.Struct({ commandId: Schema.String, orgId: Schema.String, requestKey: Schema.String }),
  output: Schema.NullOr(
    Schema.Struct({
      commandId: Schema.String,
      requestKey: Schema.String,
      resolution: Schema.Literals(["failed", "settled"]),
    }),
  ),
  errors: [],
  reads: [table_payment_commands],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  was: [`${DOOR}:98`, `${P}/reads/replays.ts:27`, `${B}/payroll/runs/writes/runs.ts:50`],
});

export const procedure_payments_read_payroll_payment_command_proof_in_tx = defineProcedure({
  id: "payments.read-payroll-payment-command-proof-in-tx",
  title: "A Payroll run command's identity and evidence",
  about:
    "Decodes the one stored command's intent and prepared command and proves they are an Organization `send` birth of this Organization, chain and sender Safe with one distinct Payment per item; returns intent, prepared command, Payment ids and the command's state, verification and outcomes. Any mismatch throws INVALID_INPUT. Output is deep (Schema.Unknown). Invoked today by payroll: payroll/runs/reads/details.ts:97.",
  concept: concept_payments,
  input: Schema.Struct({
    commandId: Schema.String,
    orgId: Schema.String,
    chainId: Schema.Number,
    senderSafe: Schema.String,
  }),
  output: Schema.Unknown,
  errors: [error_INVALID_INPUT],
  reads: [table_payment_commands],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  was: [`${DOOR}:100`, `${P}/reads/replays.ts:180`, `${B}/payroll/runs/reads/details.ts:97`],
});

export const procedure_payments_is_payroll_batch_settled_in_tx = defineProcedure({
  id: "payments.is-payroll-batch-settled-in-tx",
  title: "Whether every Payment of a Payroll batch settled",
  about:
    "Payroll's lineage is a claim: the command named by the batch reference proves the set. True only when every one of the command's Payments is found under the run (`by_payroll_run`) and is `settled`. Invoked today by payroll: payroll/runs/writes/progression.ts:59.",
  concept: concept_payments,
  input: Schema.Struct({ runId: Schema.String, batchRef: Schema.String }),
  output: Schema.Boolean,
  errors: [],
  reads: [table_payment_commands, table_payments],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  was: [`${DOOR}:102`, `${P}/reads/settlements.ts:117`, `${B}/payroll/runs/writes/progression.ts:59`],
});

export const procedure_payments_read_organization_payment_batch_facts_in_tx = defineProcedure({
  id: "payments.read-organization-payment-batch-facts-in-tx",
  title: "An Organization command's batch attribution",
  about:
    "First-row attribution for Payroll's native transition events: the command's Organization, Payment count, originating auth user and observation context. Null for an unknown or Account command. Invoked today by payroll: payroll/runs/events.ts:65.",
  concept: concept_payments,
  input: Schema.Struct({ commandId: Schema.String }),
  output: Schema.NullOr(
    Schema.Struct({
      commandId: Schema.String,
      organizationId: Schema.String,
      paymentCount: Schema.Number,
      authUserId: Schema.UndefinedOr(Schema.String),
      observationContext: Schema.Unknown,
    }),
  ),
  errors: [],
  reads: [table_payment_commands],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  was: [`${DOOR}:52`, `${P}/reads/participants.ts:46`, `${B}/payroll/runs/events.ts:65`],
});

export const procedure_payments_read_prepared_payment_views_in_tx = defineProcedure({
  id: "payments.read-prepared-payment-views-in-tx",
  title: "The sender's views of a prepared command's Payments",
  about:
    "Every Payment the prepared command's items name, in saved order, as the sender's wire Payment with documents. A Payment the command names that does not exist is a stored-row defect (UNKNOWN). Prepared command and views are deep (Schema.Unknown). Invoked today by payroll: payroll/runs/reads/replays.ts:110; and inside payments by readSigningSubjectInTx.",
  concept: concept_payments,
  input: Schema.Struct({ prepared: Schema.Unknown }),
  output: Schema.Array(Schema.Unknown),
  errors: [error_INVALID_INPUT, error_UNKNOWN],
  reads: WIRE_VIEW_READS,
  writes: [],
  drives: [],
  invokes: WIRE_VIEW_INVOKES,
  emits: [],
  was: [`${DOOR}:58`, `${P}/reads/payments.ts:192`, `${B}/payroll/runs/reads/replays.ts:110`],
});

export const procedure_payments_read_active_payment_execution_replay_in_tx = defineProcedure({
  id: "payments.read-active-payment-execution-replay-in-tx",
  title: "A Payroll run's earlier execution, replayed",
  about:
    "The execution must be this Payment command's, signer, chain and Safe. `prepared` when neither it nor the command has a hash; otherwise the stored UserOperation is re-hashed and must equal the expected hash: `submitting` while `sending`, `accepted` (wire `pending`) once `sent` with its hash and submission time. Anything else is null. The `submitting` and `accepted` answers carry the stored execution row (Schema.Unknown). Invoked today by payroll: payroll/runs/reads/replays.ts:80.",
  concept: concept_payments,
  input: Schema.Struct({
    executionId: Schema.String,
    commandId: Schema.String,
    authUserId: Schema.String,
    signerAddress: Schema.String,
    chainId: Schema.Number,
    accountSafe: Schema.String,
    userOpSenderSafe: Schema.String,
    commandUserOpHash: Schema.optionalKey(Schema.String),
  }),
  output: Schema.NullOr(Schema.Unknown),
  errors: [],
  reads: [table_money_executions],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  was: [`${DOOR}:182`, `${P}/executions/reads/replays.ts:28`, `${B}/payroll/runs/reads/replays.ts:80`],
});

// ── reads Books makes ───────────────────────────────────────────────────────────────────────

export const procedure_payments_read_settled_payments_page_in_tx = defineProcedure({
  id: "payments.read-settled-payments-page-in-tx",
  title: "One page of an Organization's settled Payments",
  about:
    "For Books to record the money that settled before its chart (A2): one paginated page of the Organization's sent or received Payments in birth order, keeping those `settled` or with any claimed amount, each with its settling block's time (a Deposit born before Payments kept it reads its Movement's time; otherwise null). Rows are the stored `payments` documents (Schema.Unknown). Invoked today by books: books/facts/writes/backfill.ts:35.",
  concept: concept_payments,
  input: Schema.Struct({ orgId: Schema.String, side: Side, page: Page }),
  output: Schema.Struct({
    payments: Schema.Array(Schema.Struct({ payment: Schema.Unknown, chainTime: Schema.NullOr(Schema.Number) })),
    next: Schema.NullOr(Schema.String),
  }),
  errors: [],
  reads: [table_payments, table_movements],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  was: [`${DOOR}:65`, `${P}/reads/settled.ts:29`, `${B}/books/facts/writes/backfill.ts:35`],
});

export const procedure_payments_read_commitment_claims_in_tx = defineProcedure({
  id: "payments.read-commitment-claims-in-tx",
  title: "A commitment's claims that still stand on chain",
  about:
    "The `claim_commitment` evidence rows still `included` for the Payment, oldest first: logical event id, raw amount, tx hash and chain time in ms, parsed from the stored evidence JSON without decoding its schema. Invoked today by books: books/facts/writes/backfill.ts:41.",
  concept: concept_payments,
  input: Schema.Struct({ paymentId: Schema.String }),
  output: Schema.Array(
    Schema.Struct({
      logicalEventId: Schema.String,
      rawAmount: Schema.String,
      txHash: Schema.String,
      chainTime: Schema.Number,
    }),
  ),
  errors: [],
  reads: [table_commitment_evidence],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  was: [`${DOOR}:64`, `${P}/reads/settled.ts:74`, `${B}/books/facts/writes/backfill.ts:41`],
});

export const procedure_payments_explained_by_capxul = defineProcedure({
  id: "payments.explained-by-capxul",
  title: "Whether Capxul's own evidence covers a Transfer log",
  about:
    "True when any `payments` row carries that exact `(txHash, settlementLogIndex)`, whatever its status or ledger kind (a Deposit row of the same Transfer counts), or an included commitment evidence row of that transaction moved money with that log. Corrupt evidence JSON throws a plain SyntaxError. Each Transfer is matched by its own log, so the rest of a batch or a shared ERC-4337 transaction stays outside Capxul. Invoked today by books: books/facts/writes/observed.ts:38; and inside payments by the outside-money reads.",
  concept: concept_payments,
  input: Schema.Struct({ transfer: Schema.Struct({ txHash: Schema.String, logIndex: Schema.Number }) }),
  output: Schema.Boolean,
  errors: [],
  reads: [table_payments, table_commitment_evidence],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  was: [`${DOOR}:71`, `${P}/movements/reads/outside.ts:43`, `${B}/books/facts/writes/observed.ts:38`],
});

export const procedure_payments_read_outside_money_in_tx = defineProcedure({
  id: "payments.read-outside-money-in-tx",
  title: "What one Movement put in or took out of Organizations' books",
  about:
    "For an included Movement of a Books asset: each Organization side classified `movement_only_outflow` (unless `explainedByCapxul` holds, which a Deposit row of the same Transfer makes true) or `refund` (a bank payout that came back), leaving out the destination side of a materialized Deposit. Empty for an unknown Movement. Invoked today by books: books/facts/operations/outside.ts:21.",
  concept: concept_payments,
  input: Schema.Struct({ movementId: Schema.String }),
  output: Schema.Array(OutsideMoney),
  errors: [],
  reads: [table_movements, table_movement_attributions, table_deposit_materializations, table_payments, table_commitment_evidence],
  writes: [],
  drives: [],
  invokes: [procedure_books_book_asset_in_tx],
  emits: [],
  was: [`${DOOR}:73`, `${P}/movements/reads/outside.ts:115`, `${P}/movements/reads/outside.ts:72`, `${B}/books/facts/operations/outside.ts:21`],
});

export const procedure_payments_read_outside_money_orgs_in_tx = defineProcedure({
  id: "payments.read-outside-money-orgs-in-tx",
  title: "The Organizations a Movement's outside money was booked for",
  about:
    "Read before a Movement's attributions go: the Organizations with a `movement_only_outflow` or `refund` attribution on it. The door exports it, but no other concept invokes it today; payments' own Movement removal uses it (movements/writes/overlays.ts:48).",
  concept: concept_payments,
  input: Schema.Struct({ movementId: Schema.String }),
  output: Schema.Array(Schema.String),
  errors: [],
  reads: [table_movement_attributions],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  was: [`${DOOR}:74`, `${P}/movements/reads/outside.ts:132`, `${P}/movements/writes/overlays.ts:48`],
});

export const procedure_payments_read_outside_money_page_in_tx = defineProcedure({
  id: "payments.read-outside-money-page-in-tx",
  title: "One page of an Organization's outside money",
  about:
    "For the chart's backfill: one paginated page of the Organization's Movement attributions, oldest first, each projected as outside money the same way as `readOutsideMoneyInTx`. Invoked today by books: books/facts/writes/backfill.ts:62.",
  concept: concept_payments,
  input: Schema.Struct({ orgId: Schema.String, page: Page }),
  output: Schema.Struct({ money: Schema.Array(OutsideMoney), next: Schema.NullOr(Schema.String) }),
  errors: [],
  reads: [table_movement_attributions, table_movements, table_deposit_materializations, table_payments, table_commitment_evidence],
  writes: [],
  drives: [],
  invokes: [procedure_books_book_asset_in_tx],
  emits: [],
  was: [`${DOOR}:75`, `${P}/movements/reads/outside.ts:150`, `${B}/books/facts/writes/backfill.ts:62`],
});

export const procedure_payments_read_agreement_holdings_in_tx = defineProcedure({
  id: "payments.read-agreement-holdings-in-tx",
  title: "What an Organization's open agreements still hold",
  about:
    "For Books to check its record of the Safe (A3b): every Organization Payment whose commitment creation landed and that is not `settled`, `cancelled` or `failed`, as its funded raw amount less what was claimed, when positive. It scans all of the Organization's sent Payments (`by_actor_created`). Invoked today by books: books/reports/reads.ts:180.",
  concept: concept_payments,
  input: Schema.Struct({ orgId: Schema.String }),
  output: Schema.Array(Schema.Struct({ assetId: Schema.String, rawHeld: Schema.BigInt })),
  errors: [],
  reads: [table_payments],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  was: [`${DOOR}:78`, `${P}/reads/agreements.ts:29`, `${B}/books/reports/reads.ts:180`],
});

// ── reads and writes Indexing makes ─────────────────────────────────────────────────────────

export const procedure_payments_read_included_payment_occurrences_in_tx = defineProcedure({
  id: "payments.read-included-payment-occurrences-in-tx",
  title: "A scope's included on-chain occurrences, snapshotted",
  about:
    "Every Payment of the Organization (or the Account's own) updated since the time, with each `included` commitment evidence row it consumed and its command's verification attempt, so a correction can compare the exact snapshot it read. An evidence row whose command is gone, or whose evidence JSON no longer decodes, is a stored-row defect (UNKNOWN). Invoked today by indexing: indexing/drifts/reads.ts:76.",
  concept: concept_payments,
  input: Schema.Struct({ scope: CorrectionScope, updatedSince: Schema.Number }),
  output: Schema.Array(OccurrenceSnapshot),
  errors: [error_UNKNOWN],
  reads: [table_payments, table_commitment_evidence, table_payment_commands],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  was: [`${DOOR}:112`, `${P}/reads/occurrences.ts:63`, `${B}/indexing/drifts/reads.ts:76`],
});

export const procedure_payments_correct_payment_occurrences_in_tx = defineProcedure({
  id: "payments.correct-payment-occurrences-in-tx",
  title: "Correct settled Payments whose occurrence a reorg removed",
  about:
    "Admits the whole batch at one snapshot (the Payment in scope, the evidence row still `included` with the same JSON and event, the command at the same verification attempt) before any write; a snapshot that no longer holds is skipped silently, never refused. Then each correction marks the evidence `removed`, reverses the money in Books, orphans a linked Movement memo (Documents), returns the command to verification (`verificationState` `scheduled`, attempt + 1, settled block cleared) and schedules `payments.verifications.verify`. A send's Payment goes back to `settling` (execution outcome `pending`) with its settlement facts cleared, and its Payroll run returns to authorized; a commitment's status is re-projected from its remaining history (held, claimable, streaming, settled or cancelled; `unresolved` when its creation was removed or a later row no longer applies), and its run returns to authorized unless it is still `settled`. Status is patched directly, not through transitionPayment, and no `payment_transitioned` is scheduled. Returns the drifts it corrected. Does nothing when money writes are switched off. Invoked today by indexing: indexing/drifts/writes/corrections.ts:92.",
  concept: concept_payments,
  input: Schema.Struct({ occurrences: Schema.Array(OccurrenceSnapshot), now: Schema.Number, scope: CorrectionScope }),
  output: Schema.Array(
    Schema.Struct({
      projectionKind: Schema.Literal("payment_settlement"),
      previousState: Schema.String,
      currentState: Schema.String,
      referenceId: Schema.String,
      previousBlock: Schema.optionalKey(Schema.Number),
      logicalEventId: Schema.optionalKey(Schema.String),
    }),
  ),
  errors: [error_UNKNOWN],
  reads: [table_payments, table_commitment_evidence, table_payment_commands],
  writes: [table_payments, table_commitment_evidence, table_payment_commands],
  drives: [
    machine_payment.t.to_settling,
    machine_payment.t.to_unresolved,
    machine_payment.t.to_scheduled,
    machine_payment.t.to_streaming,
    machine_payment.t.to_pending_claim,
    machine_payment.t.to_settled,
    machine_payment.t.to_cancelled,
    machine_commitment_evidence.t.to_removed,
    machine_payment_command_verification.t.to_scheduled,
  ],
  invokes: [
    procedure_books_reverse_commitment_claim_in_tx,
    procedure_books_reverse_settled_payment_in_tx,
    procedure_documents_mark_movement_memo_orphaned_in_tx,
    procedure_payroll_return_run_to_authorized,
  ],
  emits: [],
  was: [
    `${DOOR}:113`,
    `${P}/writes/corrections.ts:89`,
    `${P}/writes/corrections.ts:35`,
    `${P}/verifications/writes/history.ts:209`,
    `${P}/verifications/writes/history.ts:180`,
    `${B}/indexing/drifts/writes/corrections.ts:92`,
  ],
});

export const procedure_payments_read_movement_checkpoint_in_tx = defineProcedure({
  id: "payments.read-movement-checkpoint-in-tx",
  title: "Where the Movement scanner stopped for one asset",
  about:
    "The scan checkpoint for the asset's chain and lowercase token: next block and the anchor block's number and hash. The chain id it returns is the constant 84532, not the stored one. The input is `movementLoadCheckpointArgs` (movements/rules/movements.ts:236): the whole asset validator, of which only chain and token are read. A token address that is not hex throws INVALID_INPUT. Invoked today by indexing: indexing/movements/reads.ts:25.",
  concept: concept_payments,
  input: Schema.Struct({ asset: ScannedAsset }),
  output: Schema.NullOr(Checkpoint),
  errors: [error_INVALID_INPUT],
  reads: [table_movement_scan_checkpoints],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  was: [`${DOOR}:121`, `${P}/movements/reads/movements.ts:153`, `${B}/indexing/movements/reads.ts:25`],
});

export const procedure_payments_apply_movement_window_in_tx = defineProcedure({
  id: "payments.apply-movement-window-in-tx",
  title: "Apply one verified Transfer window to the Movement projection",
  about:
    "Refuses a disabled scanner (NOT_IMPLEMENTED, unless the token was added by an Organization), admits the checkpoint (exact chain, token, start, at most 10000 blocks, head and anchor; otherwise INVALID_INPUT), then applies the Transfers in evidence order: a bank payout refund is classified (Banking), its memo persisted (Documents), the Movement inserted or replayed as `included`, its attributions upserted from the actor inventory, Books asked to book outside money, and a Deposit Payment born `settled` with its materialization and Books record. A Transfer a settled protocol Payment explains is suppressed; Movements absent from the window are removed (a materialized Deposit rolled back) and their memos orphaned. Finally the checkpoint advances. A Deposit write the writer refuses prints `payment_writer_incident` and then throws an invariant defect (UNKNOWN), so the whole window aborts. A Safe with more than one owner, a replayed Transfer with other chain facts, or an asset Books does not admit throws INVALID_INPUT. The Transfers are `TransferEvidence` (deep, Schema.Unknown). Invoked today by indexing: indexing/movements/writes.ts:63.",
  concept: concept_payments,
  input: Schema.Struct({
    args: Schema.Struct({
      asset: ScannedAsset,
      range: Schema.Struct({ fromBlock: Schema.Number, toBlock: Schema.Number }),
      chainHead: Schema.Struct({ chainId: Schema.Number, blockNumber: Schema.Number, blockHash: Schema.String }),
      anchor: Schema.Struct({ chainId: Schema.Number, blockNumber: Schema.Number, blockHash: Schema.String }),
      transfers: Schema.Array(Schema.Unknown),
      expectedCheckpoint: Schema.NullOr(Checkpoint),
      mode: Schema.Literals(["initial", "overlap", "reorganization", "continuation"]),
    }),
    now: Schema.Number,
  }),
  output: Schema.Struct({
    checkpoint: Checkpoint,
    counts: Schema.Struct({
      movementsInserted: Schema.Number,
      movementsReplayed: Schema.Number,
      movementsRemoved: Schema.Number,
      attributionsInserted: Schema.Number,
      settlementsSuppressed: Schema.Number,
      depositsMaterialized: Schema.Number,
      depositsRolledBack: Schema.Number,
    }),
  }),
  errors: [error_NOT_IMPLEMENTED, error_INVALID_INPUT, error_UNKNOWN],
  reads: [
    table_movement_scan_checkpoints,
    table_movements,
    table_movement_attributions,
    table_deposit_materializations,
    table_payments,
  ],
  writes: [
    table_movement_scan_checkpoints,
    table_movements,
    table_movement_attributions,
    table_deposit_materializations,
    table_payments,
  ],
  drives: [
    machine_payment.t.to_settled,
    machine_movement.t.to_included,
    machine_movement.t.to_removed,
    machine_deposit_materialization.t.to_materialized,
    machine_deposit_materialization.t.to_removed,
  ],
  invokes: [
    procedure_banking_classify_payout_refund_in_tx,
    procedure_documents_persist_movement_memo_in_tx,
    procedure_documents_orphan_absent_movement_memos_in_tx,
    procedure_books_book_asset_in_tx,
    procedure_books_records_added_token_in_tx,
    procedure_books_schedule_outside_money_in_tx,
    procedure_books_record_settled_payment_in_tx,
    ...MOVEMENT_REMOVAL_INVOKES,
    procedure_accounts_read_accounts_at_safe_in_tx,
    procedure_organizations_read_organizations_at_safe_in_tx,
    procedure_parties_ensure_ledger_party,
    procedure_parties_ensure_party_by_address,
    procedure_parties_record_contact_edges,
  ],
  emits: [event_payment_writer_incident],
  was: [
    `${DOOR}:142`,
    `${P}/movements/writes/windows.ts:195`,
    `${P}/movements/writes/projections.ts:53`,
    `${P}/movements/writes/admission.ts:29`,
    `${P}/writes/deposits.ts:228`,
    `${B}/indexing/movements/writes.ts:63`,
  ],
});

// ── reads Accounts makes ────────────────────────────────────────────────────────────────────

export const procedure_payments_read_payment_ids_to_retry_in_tx = defineProcedure({
  id: "payments.read-payment-ids-to-retry-in-tx",
  title: "The ids of a viewer's own Payments that need a retry",
  about:
    "Newest first, only Payments the viewer sent: reads the `pending` and `settling` ones and those whose stored execution outcome requires a retry (`by_actor_status`, `by_actor_execution_outcome`, never the whole ledger, #2379), and keeps those whose execution view says `retryRequired`. Invoked today by accounts: accounts/summaries/reads.ts:127.",
  concept: concept_payments,
  input: Schema.Struct({ viewer: Viewer }),
  output: Schema.Array(Schema.String),
  errors: [],
  reads: [table_payments, ...EXECUTION_VIEW_READS],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  was: [`${DOOR}:80`, `${P}/reads/retries.ts:20`, `${B}/accounts/summaries/reads.ts:127`],
});

export const procedure_payments_read_signing_subject_in_tx = defineProcedure({
  id: "payments.read-signing-subject-in-tx",
  title: "What a signer reviews before they sign",
  about:
    "One of the caller's own executions (another person's is not found: INVALID_INPUT), and for a Payment execution its command's actor, sender Safe, lineage and lifecycle step (a cancel, a void read as a cancel, or a redirect) with the sender's views of its Payments. A Permission or invitation execution, or a Payment execution whose command row is gone, has no command and no Payments; stored command JSON that does not decode is UNKNOWN. Output is deep (Schema.Unknown). Invoked today by accounts: accounts/approvals/reads.ts:125, accounts/approvals/operations/record-approval.ts:48.",
  concept: concept_payments,
  input: Schema.Struct({ authUserId: Schema.String, executionId: Schema.String }),
  output: Schema.Unknown,
  errors: [error_INVALID_INPUT, error_UNKNOWN],
  reads: uniq([table_money_executions, ...WIRE_VIEW_READS]),
  writes: [],
  drives: [],
  invokes: WIRE_VIEW_INVOKES,
  emits: [],
  was: [`${DOOR}:190`, `${P}/reads/signing.ts:51`, `${B}/accounts/approvals/reads.ts:125`],
});

export const procedure_payments_read_approval_execution_in_tx = defineProcedure({
  id: "payments.read-approval-execution-in-tx",
  title: "An approval's immutable execution facts",
  about:
    "For the approval's owner, without current spending authority: the execution must be theirs (INVALID_INPUT), match the approval's digest and command (UNKNOWN when not). A refusal recorded before dispatch is thrown (ROLE_PERMISSION_DENIED for an authority refusal, SUPERSEDED when its own lane advanced), except a signer's refusal, which is returned as `signerRefused`. The hash is returned only when it equals the expected hash. Invoked today by accounts: accounts/approvals/reads.ts:200.",
  concept: concept_payments,
  input: Schema.Struct({
    authUserId: Schema.String,
    executionId: Schema.String,
    digest: Schema.String,
    commandId: Schema.optionalKey(Schema.String),
  }),
  output: Schema.Struct({
    signerRefused: Schema.Boolean,
    commandKind: Schema.Literals(["payment", "permission", "invitation_configuration"]),
    commandId: Schema.String,
    state: Schema.String,
    chainId: Schema.Number,
    authUserId: Schema.String,
    senderSafe: Schema.String,
    userOpHash: Schema.NullOr(Schema.String),
    sponsorshipValidUntil: Schema.NullOr(Schema.Number),
  }),
  errors: [error_INVALID_INPUT, error_UNKNOWN, error_ROLE_PERMISSION_DENIED, error_SUPERSEDED],
  reads: [table_money_executions],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  was: [`${DOOR}:191`, `${P}/executions/reads/executions.ts:99`, `${P}/executions/errors.ts:13`, `${B}/accounts/approvals/reads.ts:200`],
});

export const procedure_payments_read_command_join_in_tx = defineProcedure({
  id: "payments.read-command-join-in-tx",
  title: "The ids that join a background step to a command",
  about:
    "For telemetry: the command's Payment ids and, when it carries exactly one bank payout, that payout's quote and rail operation ids. Null for an unknown command; a missing Payment is left out, never a failure. Invoked today by accounts: accounts/approvals/reads.ts:95.",
  concept: concept_payments,
  input: Schema.Struct({ commandId: Schema.String }),
  output: Schema.NullOr(
    Schema.Struct({
      paymentIds: Schema.Array(Schema.String),
      payout: Schema.NullOr(Schema.Struct({ quoteId: Schema.String, railOperationId: Schema.String })),
    }),
  ),
  errors: [],
  reads: [table_payment_commands, table_payments],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  was: [`${DOOR}:193`, `${P}/commands/reads/contexts.ts:32`, `${B}/accounts/approvals/reads.ts:95`],
});

export const procedure_payments_has_execution_provider_attempt_in_tx = defineProcedure({
  id: "payments.has-execution-provider-attempt-in-tx",
  title: "Whether any provider send was attempted for an execution",
  about:
    "Any provider send attempt for the command and execution, even one whose response was lost, keeps an approval's retry lookup-only. Invoked today by accounts: accounts/approvals/operations/reschedule-approved.ts:52.",
  concept: concept_payments,
  input: Schema.Struct({ commandId: Schema.String, executionId: Schema.String }),
  output: Schema.Boolean,
  errors: [],
  reads: [table_provider_send_attempts],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  was: [`${DOOR}:195`, `${P}/executions/reads/executions.ts:84`, `${B}/accounts/approvals/operations/reschedule-approved.ts:52`],
});

export const procedure_payments_schedule_for_execution_in_tx = defineProcedure({
  id: "payments.schedule-for-execution-in-tx",
  title: "The payment schedule of one execution",
  about:
    "The stored `paymentSchedules` row of the execution (unique by `by_execution`), or null. The raw row leaves the concept (Schema.Unknown). Invoked today by accounts: accounts/approvals/reads.ts:206.",
  concept: concept_payments,
  input: Schema.Struct({ executionId: Schema.String }),
  output: Schema.NullOr(Schema.Unknown),
  errors: [],
  reads: [table_payment_schedules],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  was: [`${DOOR}:173`, `${P}/schedules/reads.ts:17`, `${B}/accounts/approvals/reads.ts:206`],
});

export const procedure_payments_read_payment_payout_deadline_in_tx = defineProcedure({
  id: "payments.read-payment-payout-deadline-in-tx",
  title: "The earliest bank payout deadline of an execution",
  about:
    "For a Payment execution: every bank payout its command's Payments bind (quote and rail operation), each asked of Banking for its deadline, the earliest returned. Undefined when it carries none, so the ordinary execution deadline stands. A command or payout binding that is missing is an invariant defect (UNKNOWN). Invoked today by accounts: accounts/approvals/operations/record-approval.ts:51, accounts/approvals/operations/request.ts:92.",
  concept: concept_payments,
  input: Schema.Struct({
    execution: Schema.Struct({
      commandKind: Schema.Literals(["payment", "permission", "invitation_configuration"]),
      commandId: Schema.String,
    }),
    now: Schema.Number,
  }),
  output: Schema.UndefinedOr(Schema.Number),
  errors: [error_UNKNOWN],
  reads: [table_payment_commands, table_payments],
  writes: [],
  drives: [],
  invokes: [procedure_banking_read_payout_deadline_in_tx],
  emits: [],
  was: [`${DOOR}:208`, `${P}/guards/payouts.ts:42`, `${P}/guards/payouts.ts:10`, `${B}/accounts/approvals/operations/record-approval.ts:51`],
});

// ── reads and writes Permissions makes ──────────────────────────────────────────────────────

export const procedure_payments_admit_permission_execution_acceptance_in_tx = defineProcedure({
  id: "payments.admit-permission-execution-acceptance-in-tx",
  title: "Admit a Permission execution's accepted hash",
  about:
    "The execution must be the caller's and a `permission` one, in `sending`, `sent` or `succeeded`, and the hash must match its expected hash; otherwise INVALID_INPUT. A row in a legacy state no writer uses is a stored-row defect (UNKNOWN). Returns the command id, whether this hash is already recorded, and the execution row behind a private symbol for `recordCommandExecutionAcceptanceInTx`. Nothing is written. Invoked today by permissions: permissions/writes/acceptances.ts:30.",
  concept: concept_payments,
  input: ExecutionAdmissionArgs,
  output: Schema.Struct({ commandId: Schema.String, recorded: Schema.Boolean }),
  errors: [error_INVALID_INPUT, error_UNKNOWN],
  reads: [table_money_executions],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  was: [`${DOOR}:185`, `${P}/executions/writes/acceptances.ts:159`, `${P}/executions/writes/acceptances.ts:125`, `${B}/permissions/writes/acceptances.ts:30`],
});

export const procedure_payments_admit_invitation_configuration_acceptance_in_tx = defineProcedure({
  id: "payments.admit-invitation-configuration-acceptance-in-tx",
  title: "Admit an invitation configuration execution's accepted hash",
  about:
    "The same admission as for a Permission execution, for an `invitation_configuration` execution: the caller's, in `sending`, `sent` or `succeeded`, with the expected hash; otherwise INVALID_INPUT, or UNKNOWN for a row in a legacy state. Nothing is written. Invoked today by permissions: permissions/writes/acceptances.ts:31.",
  concept: concept_payments,
  input: ExecutionAdmissionArgs,
  output: Schema.Struct({ commandId: Schema.String, recorded: Schema.Boolean }),
  errors: [error_INVALID_INPUT, error_UNKNOWN],
  reads: [table_money_executions],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  was: [`${DOOR}:184`, `${P}/executions/writes/acceptances.ts:166`, `${P}/executions/writes/acceptances.ts:125`, `${B}/permissions/writes/acceptances.ts:31`],
});

export const procedure_payments_record_command_execution_acceptance_in_tx = defineProcedure({
  id: "payments.record-command-execution-acceptance-in-tx",
  title: "Record an admitted execution acceptance",
  about:
    "After the command owner admitted its own submission: unless the hash is already recorded, the Attempt writer moves the execution with `send_accepted` (to `sent`), storing the hash as both `userOpHash` and `expectedUserOpHash` and the submission time (kept when already set). It writes from the row the admission captured and reads nothing itself. A refused transition throws INVALID_INPUT `has no admitted submission`; money writes switched off throw NOT_IMPLEMENTED. Takes the admission returned by an `admit…AcceptanceInTx` (Schema.Unknown). `now` defaults to the clock shim. Invoked today by permissions: permissions/writes/acceptances.ts:42.",
  concept: concept_payments,
  input: Schema.Struct({ admission: Schema.Unknown, userOpHash: Schema.String, now: Schema.optionalKey(Schema.Number) }),
  output: Schema.Void,
  errors: [error_INVALID_INPUT, error_NOT_IMPLEMENTED],
  reads: [],
  writes: [table_money_executions],
  drives: [machine_money_execution.t.to_sent],
  invokes: [],
  emits: [],
  was: [`${DOOR}:186`, `${P}/executions/writes/acceptances.ts:174`, `${P}/executions/writes/attempts.ts:56`, `${B}/permissions/writes/acceptances.ts:42`],
});

export const procedure_payments_close_verified_command_execution_in_tx = defineProcedure({
  id: "payments.close-verified-command-execution-in-tx",
  title: "Classify a sent Permission or invitation execution by its receipt",
  about:
    "Finds the one `sent` execution of the command whose hash and expected hash match, asks Permissions for its execution proof and, unless it is still pending, moves the Attempt with `classify_evidence` to `succeeded` or `reverted`. More than one match, or none, does nothing. Money writes switched off throw NOT_IMPLEMENTED; a receipt hash that is not bytes32 throws INVALID_INPUT. `now` defaults to the clock shim. Invoked today by permissions: permissions/writes/applications.ts:46, permissions/writes/verifications.ts:122, permissions/configurations/writes.ts:216, permissions/configurations/operations/complete-execution.ts:40, permissions/commands/operations/complete-execution.ts:36.",
  concept: concept_payments,
  input: Schema.Struct({
    commandKind: Schema.Literals(["permission", "invitation_configuration"]),
    commandId: Schema.String,
    userOpHash: Schema.String,
    now: Schema.optionalKey(Schema.Number),
  }),
  output: Schema.Void,
  errors: [error_NOT_IMPLEMENTED, error_INVALID_INPUT],
  reads: [table_money_executions],
  writes: [table_money_executions],
  drives: [machine_money_execution.t.to_succeeded, machine_money_execution.t.to_reverted],
  invokes: [procedure_permissions_read_permission_execution_proof_in_tx],
  emits: [],
  was: [`${DOOR}:196`, `${P}/executions/writes/acceptances.ts:199`, `${B}/permissions/writes/applications.ts:46`],
});

// ── exported, but no other concept invokes them today ──────────────────────────────────────

export const procedure_payments_server_payment_authority_in_tx = defineProcedure({
  id: "payments.server-payment-authority-in-tx",
  title: "The Payment actor and Permission the signed-in Account may use",
  about:
    "Without an Organization: the authenticated Account as actor. With one: the execution route for the Permission and token (a Budget's route through Organizations, Permissions and Payroll's department spend; otherwise Permissions' spend authority for the raw amount), returning the Organization actor and its Permission. The door exports it, but no other concept invokes it today; payments' lifecycle reads and writes use it (lifecycles/reads/retries.ts, lifecycles/writes/commands.ts, commands/writes/personal.ts).",
  concept: concept_payments,
  input: Schema.Struct({
    authUserId: Schema.String,
    orgId: Schema.optionalKey(Schema.String),
    permissionId: Schema.optionalKey(Schema.String),
    tokenAddress: Schema.optionalKey(Schema.String),
    requiredRawAmount: Schema.optionalKey(Schema.BigInt),
  }),
  output: Schema.Union([
    Schema.Struct({ actor: Schema.Struct({ kind: Schema.Literal("account"), accountId: Schema.String }) }),
    Schema.Struct({
      actor: Schema.Struct({ kind: Schema.Literal("organization"), orgId: Schema.String }),
      orgId: Schema.String,
      permissionId: Schema.String,
    }),
  ]),
  errors: AUTHORITY_ERRORS,
  reads: [],
  writes: [],
  drives: [],
  invokes: ROUTE_INVOKES,
  emits: [],
  was: [`${DOOR}:205`, `${P}/guards/authority.ts:210`, `${P}/guards/authority.ts:97`],
});

export const procedure_payments_load_payment_retry_source_in_tx = defineProcedure({
  id: "payments.load-payment-retry-source-in-tx",
  title: "The exact original birth cohort of a Payment to retry",
  about:
    "Before authorization or preparation: the Payment's command and every Payment it names (exactly one row each), in the expected scope, still authorized for submission, not failed, still `prepared` with a retryable execution state; the stored intent and prepared command decode, the instruction documents hydrate, the session principal (Access) is the caller and may read every issued invoice (Requests), and every item matches. Refusals are INVALID_INPUT (no retryable command, invalid membership or source) or WRONG_STATE. Output is deep (Schema.Unknown). The door exports it, but no other concept invokes it today; payments' lifecycle reads use it.",
  concept: concept_payments,
  input: Schema.Struct({
    authUserId: Schema.String,
    paymentId: Schema.String,
    expectedScope: Schema.optionalKey(Schema.Unknown),
  }),
  output: Schema.Unknown,
  errors: AUTHORITY_ERRORS,
  reads: uniq([table_payments, table_payment_commands, ...AUTHORITY_READS, ...EXECUTION_VIEW_READS]),
  writes: [],
  drives: [],
  invokes: uniq([
    procedure_payments_server_payment_authority_in_tx,
    ...AUTHORITY_INVOKES,
    procedure_access_require_financial_read_principal_in_tx,
    procedure_requests_issued_invoice_read_access,
  ]),
  emits: [],
  was: [`${DOOR}:206`, `${P}/lifecycles/reads/retries.ts:158`, `${P}/lifecycles/reads/retries.ts:141`],
});
