// The old payments concept's tables and the state machines that live on them, as the old code
// has them (factory, branch integration/factory). Evidence, not the target design.
//
// Tables: packages/backend/src/payments/tables/*.ts, registered in packages/backend/convex/schema.ts:36-40.
// Machines: every status/state field with a literal union. Transitions are named to_<state>; `from`
// lists every state an old write moves the field from. A write that leaves the field unchanged
// (a self-loop) is not listed; a birth (an insert) has no source state and is said in `about`.

import { Schema } from "effect";
import { defineMachine, defineTable } from "../../../packages/book/src/index.ts";
import { concept_payments } from "./foundation.ts";
import {
  event_payment_transitioned,
  event_payment_verification_retry,
  event_payment_writer_incident,
} from "./vocabulary.ts";

const B = "packages/backend/src/payments";
const T = `${B}/tables`;

const KEPT = "Kept indefinitely: no job in the old code deletes or expires these rows.";

// ── shared validators ───────────────────────────────────────────────────────────────────────

const opt = Schema.optionalKey;
const S = Schema.String;
const N = Schema.Number;

const ActorKind = Schema.Literals(["account", "organization"]);
const RecipientActorKind = Schema.Literals(["account", "organization", "destination", "party_account"]);

const PAYMENT_STATUSES = [
  "pending",
  "settling",
  "in_transit",
  "unresolved",
  "pending_claim",
  "scheduled",
  "streaming",
  "settled",
  "cancelled",
  "failed",
] as const;

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

const AssetAmount = Schema.Struct({ asset: S, value: S });

/** `ATTEMPT_STATES` (packages/protocol/src/payments/status.ts:38) followed by the legacy literals. */
const MONEY_EXECUTION_STATES = [
  "prepared",
  "sending",
  "sent",
  "succeeded",
  "reverted",
  "expired",
  "displaced",
  "unknown",
  "submitting",
  "submitted",
  "pending",
  "included",
  "dropped",
  "replaced",
  "unresolved",
  "failed",
  "settled",
  "rejected",
  "superseded",
] as const;

// ── tables ──────────────────────────────────────────────────────────────────────────────────

export const table_payments = defineTable({
  id: "payments",
  title: "Payments: the Payment ledger of record",
  about:
    "One row per Payment, Payout or Deposit an Account or an Organization sends or receives. Every write is meant to go " +
    "through writePaymentInTx (writes/ledger.ts), but many writers patch the row directly: outcomes, expiries, rebinding, " +
    "commitment history, voids, schedule cancels and the telemetry writer's lifecycleSequence/terminal stamps. " +
    "recipientSafeAddress, tokenAddress, rawAmount, userOpHash and txHash are internal evidence the wire never carries. " +
    "Commitment times (startTime, cliffTime, endTime) are uint48 epoch seconds; settledBlockTime is epoch ms. " +
    "Tenancy is mixed: actorKind is account (a person) or organization; the book records organization. " +
    "A rolled-back Deposit is deleted (writes/rollbacks.ts:72).",
  was: [`${T}/payments.ts:36`, "packages/backend/convex/schema.ts:39", `${B}/README.md:1`],
  concept: concept_payments,
  tenancy: "organization",
  fields: Schema.Struct({
    paymentId: S,
    lifecycleSequence: opt(N),
    terminalOutcome: opt(Schema.Literals(["settled", "failed"])),
    terminalEventId: opt(S),
    terminalAt: opt(N),
    paymentCommandId: opt(S),
    actorKind: ActorKind,
    actorId: S,
    status: opt(Schema.Literals(PAYMENT_STATUSES)),
    activeExecutionId: opt(S),
    executionOutcome: opt(
      Schema.Literals(["pending", "included", "dropped", "replaced", "expired", "unresolved", "superseded", "failed", "settled"]),
    ),
    paymentType: opt(Schema.Literals(["unspecified", "invoice", "payroll", "reimbursement"])),
    ledgerKind: opt(Schema.Literals(["Payment", "Payout", "Deposit"])),
    purposeKind: opt(S),
    settlementId: opt(S),
    movementId: opt(S),
    permissionId: opt(S),
    approvedBy: opt(Schema.Literals(["owners"])),
    settledBlockNumber: opt(N),
    settledBlockHash: opt(S),
    settledBlockTime: opt(N),
    settledEventLogIndex: opt(N),
    settledLogicalEventId: opt(S),
    settlementEvidenceDigest: opt(S),
    currency: S,
    assetId: S,
    amountValue: S,
    decimals: N,
    rawAmount: opt(S),
    source: opt(Schema.Literals(["me", "org"])),
    idempotencyKey: opt(S),
    operationKind: opt(S),
    requestFingerprint: opt(S),
    orgId: opt(S),
    recipientActorKind: RecipientActorKind,
    recipientActorId: S,
    recipientSafeAddress: opt(S),
    paymentSenderSafe: opt(S),
    quoteId: opt(S),
    railOperationId: opt(S),
    payoutRecipientLabel: opt(S),
    payoutRecipientOnCapxul: opt(Schema.Boolean),
    payoutWarnRecipientOnCapxul: opt(Schema.Boolean),
    payoutOwnerPartyId: opt(S),
    requestedOutputCurrency: opt(S),
    requestedOutputValue: opt(S),
    requestedOutputDecimals: opt(N),
    payoutOutputExact: opt(Schema.Boolean),
    deliveredOutputValue: opt(S),
    refundMovementId: opt(S),
    tokenAddress: S,
    documentHash: opt(S),
    documentContentHash: opt(S),
    release: opt(S),
    scheduledAt: opt(N),
    userOpHash: opt(S),
    txHash: opt(S),
    settlementLogIndex: opt(N),
    onchainCommitmentId: opt(S),
    commitmentCreatedUserOpHash: opt(S),
    commitmentCreatedTxHash: opt(S),
    commitmentCreatedBlockNumber: opt(N),
    commitmentCreatedBlockHash: opt(S),
    commitmentCreatedEventLogIndex: opt(N),
    commitmentCreatedTransferLogIndex: opt(N),
    commitmentCreationEvidenceDigest: opt(S),
    startTime: opt(N),
    cliffTime: opt(N),
    endTime: opt(N),
    claimedRaw: opt(S),
    payrollRunId: opt(S),
    partyId: opt(S),
    counterpartyPartyId: opt(S),
    createdAt: N,
    updatedAt: N,
  }),
  key: ["paymentId"],
  indexes: [
    {
      name: "by_payment_id",
      fields: ["paymentId"],
      for: "One Payment by id (.unique()): the ledger writer, verification, schedules, retries and requests' invoices (payments/reads/payments.ts:36, requests/reads/invoices.ts:49).",
    },
    {
      name: "by_actor_created",
      fields: ["actorKind", "actorId", "createdAt"],
      for: "A sender's Payments in birth order: the viewer's ledger, activity pages, settled pages and agreements (payments/reads/payments.ts:170, reads/activity.ts:133, reads/settled.ts:38).",
    },
    {
      name: "by_actor_updated",
      fields: ["actorKind", "actorId", "updatedAt"],
      for: "A sender's change feed by last change, and an Account's occurrences since a time (payments/reads/activity.ts:185, reads/occurrences.ts:77).",
    },
    {
      name: "by_actor_status",
      fields: ["actorKind", "actorId", "status"],
      for: "The home's payments to retry: the sender's open Payments by status (payments/reads/retries.ts:28).",
    },
    {
      name: "by_status_created",
      fields: ["status", "createdAt"],
      for: "The settlement sweep: the oldest settling Payments after its cursor, 50 or fewer per run, wrapping to the start (payments/reads/settlements.ts:33, reads/settlements.ts:65).",
    },
    {
      name: "by_actor_execution_outcome",
      fields: ["actorKind", "actorId", "executionOutcome"],
      for: "The home's payments to retry: the sender's Payments whose last execution needs a retry (payments/reads/retries.ts:36).",
    },
    {
      name: "by_commitment_id",
      fields: ["onchainCommitmentId"],
      for: "None: no withIndex(\"by_commitment_id\") on payments outside tests (gap).",
    },
    {
      name: "by_settlement_id",
      fields: ["settlementId"],
      for: "The one Payment a settlement id births (birth refusal of a second birth) and activity lookups by settlement (payments/writes/births.ts:121, writes/collections.ts:25, reads/activity.ts:84).",
    },
    {
      name: "by_rail_operation",
      fields: ["railOperationId"],
      for: "None: no withIndex(\"by_rail_operation\") outside tests (gap).",
    },
    {
      name: "by_movement_id",
      fields: ["movementId"],
      for: "None: no withIndex(\"by_movement_id\") on payments outside tests; reads by movement go to movements and depositMaterializations (gap).",
    },
    {
      name: "by_recipient_actor_created",
      fields: ["recipientActorKind", "recipientActorId", "createdAt"],
      for: "A recipient's Payments in birth order: the viewer's ledger, activity, settled pages and participant checks (payments/reads/payments.ts:176, reads/activity.ts:145, reads/participants.ts:166).",
    },
    {
      name: "by_recipient_actor_updated",
      fields: ["recipientActorKind", "recipientActorId", "updatedAt"],
      for: "The recipient side of an actor's change feed by last change (payments/reads/activity.ts:194).",
    },
    {
      name: "by_organization_created",
      fields: ["orgId", "createdAt"],
      for: "None: no withIndex(\"by_organization_created\") outside tests (gap).",
    },
    {
      name: "by_organization_updated",
      fields: ["orgId", "updatedAt"],
      for: "An Organization's Payments changed since a time, for occurrences (payments/reads/occurrences.ts:71).",
    },
    {
      name: "by_document_hash",
      fields: ["documentHash"],
      for: "None outside tests (commands/tests/prepare-organization.test.ts:376); the participant-scoped document read it was added for does not use it (gap).",
    },
    {
      name: "by_settlement_log",
      fields: ["txHash", "settlementLogIndex"],
      for: "Per-transfer settlement identity: the Payment a Transfer log settled, for movement suppression and outside money (payments/reads/settlements.ts:156, movements/reads/outside.ts:49).",
    },
    {
      name: "by_payroll_run",
      fields: ["payrollRunId"],
      for: "A payroll run's Payments: is every one settled (run settle flip) and the run's notices (payments/reads/settlements.ts:131, payroll/runs/reads/notices.ts:55).",
    },
  ],
  retention: "Kept indefinitely, except a Deposit whose Movement a reorg removed: its row is deleted (writes/rollbacks.ts:72).",
});

export const table_payment_commands = defineTable({
  id: "payment-commands",
  title: "Payment commands",
  about:
    "One row per command that births or advances Payments: send, create/claim/cancel/redirect a commitment, or void a " +
    "schedule. It holds the prepared command and intent as JSON, the signed operation's hash once submitted, and the " +
    "verification lease (verificationState, attempt, retry clock, mismatch resets). The same actor and request key reach " +
    "the same command. Tenancy is mixed: actorKind is account or organization; the book records organization.",
  was: [`${T}/commands.ts:9`, "packages/backend/convex/schema.ts:36"],
  concept: concept_payments,
  tenancy: "organization",
  fields: Schema.Struct({
    commandId: S,
    requestKey: opt(S),
    actorKind: ActorKind,
    actorId: S,
    requestDigest: S,
    operation: Schema.Literals([
      "send",
      "create_commitment",
      "claim_commitment",
      "cancel_commitment",
      "redirect_commitment",
      "void_schedule",
    ]),
    paymentIds: Schema.Array(S),
    preparedCommandJson: S,
    intentJson: S,
    state: Schema.Literals(["prepared", "submitted"]),
    userOpHash: opt(S),
    paymentInitiatedClaimedAt: opt(N),
    recipientObservationsJson: opt(S),
    originatingAuthUserId: opt(S),
    originatingObservationContext: opt(ObservationContext),
    completionOutcome: opt(Schema.Literals(["settled", "failed"])),
    completedAt: opt(N),
    settledAtBlock: opt(N),
    activeExecutionId: opt(S),
    correlationId: opt(S),
    journeyId: opt(S),
    terminalOutcome: opt(Schema.Literals(["settled", "failed", "unresolved", "superseded"])),
    terminalEventId: opt(S),
    terminalAt: opt(N),
    verificationState: Schema.Literals([
      "not_started",
      "scheduled",
      "verifying",
      "retry_wait",
      "mismatch",
      "applied",
      "unresolved",
      "failed",
    ]),
    verificationAttempt: N,
    paymentLifecycleGeneration: opt(N),
    receiptMissingAttempts: opt(N),
    replacementCount: opt(N),
    lastExecutionOutcome: opt(Schema.Literals(["dropped", "replaced", "expired", "unresolved", "superseded", "failed", "settled"])),
    lastVerificationReason: opt(Schema.Literals(["receipt_missing", "provider_failure"])),
    nextVerificationAt: opt(N),
    lastVerificationAt: opt(N),
    mismatchResets: opt(
      Schema.Array(Schema.Struct({ resetBy: S, reason: S, resetAt: N, verificationAttempt: N })),
    ),
    createdAt: N,
    updatedAt: N,
  }),
  key: ["commandId"],
  indexes: [
    {
      name: "by_command_id",
      fields: ["commandId"],
      for: "One command by id (.unique()), 65 reads across payments, requests and the telemetry writer (payments/events/writer.ts:83, schedules/reads.ts:58, requests/writes/approvals.ts:144).",
    },
    {
      name: "by_actor_request_key",
      fields: ["actorKind", "actorId", "requestKey"],
      for: "Idempotent prepare: the command an actor's request key already reached, and reschedule lookups (payments/commands/writes/replays.ts:34, replays.ts:136, lifecycles/reads/reschedules.ts:66).",
    },
    {
      name: "by_user_op_hash",
      fields: ["userOpHash"],
      for: "Which command owns a submitted UserOperation hash: submission conflicts, evidence lookup and landed-operation binding (verifications/writes/submissions.ts:60, verifications/reads/identities.ts:98, commands/writes/bindings.ts:73).",
    },
    {
      name: "by_verification_age",
      fields: ["verificationState", "state", "updatedAt"],
      for: "The recovery sweep: submitted commands left scheduled or verifying for 10 minutes or more, 100 per state (payments/verifications/writes/recoveries.ts:43).",
    },
    {
      name: "by_verification_due",
      fields: ["verificationState", "state", "nextVerificationAt"],
      for: "The recovery sweep: submitted retry_wait commands whose retry time lapsed 10 minutes ago (payments/verifications/writes/recoveries.ts:56).",
    },
  ],
  retention: KEPT,
});

export const table_commitment_evidence = defineTable({
  id: "commitment-evidence",
  title: "Consumed lifecycle evidence",
  about:
    "The single-use ledger of on-chain evidence a verified transition consumed: one row per applied send, commitment " +
    "creation, claim, cancel or redirect, with the Payment's state before it (preState) so commitment history can be " +
    "replayed. The table comment says the by_user_op_hash index is unique; Convex has no unique indexes, and the reads " +
    "collect by hash (verifications/reads/identities.ts:52). A reorg marks a row removed. Tenancy: optional actorKind, " +
    "account or organization; the book records organization.",
  was: [`${T}/commands.ts:90`, `${B}/verifications/writes/conflicts.ts:165`],
  concept: concept_payments,
  tenancy: "organization",
  fields: Schema.Struct({
    userOpHash: S,
    paymentId: S,
    commandId: S,
    evidenceJson: S,
    preState: Schema.Struct({
      status: Schema.Literals(PAYMENT_STATUSES),
      rawAmount: S,
      claimedRaw: S,
      endTime: opt(N),
      onchainCommitmentId: opt(S),
      recipientSafeAddress: S,
      recipientActorKind: RecipientActorKind,
      recipientActorId: S,
    }),
    transferId: Schema.NullOr(S),
    state: Schema.Literals(["included", "removed"]),
    ownerAuthUserId: opt(S),
    actorKind: opt(ActorKind),
    actorId: opt(S),
    transition: S,
    evidenceDigest: S,
    logicalEventId: S,
    txHash: S,
    eventLogIndex: N,
    consumedAt: N,
  }),
  key: ["logicalEventId"],
  indexes: [
    {
      name: "by_user_op_hash",
      fields: ["userOpHash"],
      for: "Evidence already consumed under a UserOperation hash (.collect()), before a transition applies (payments/verifications/reads/identities.ts:52).",
    },
    {
      name: "by_payment_id",
      fields: ["paymentId"],
      for: "A Payment's consumed evidence: commitment history replay, occurrences and claimed amounts (verifications/writes/history.ts:233, writes/commitments.ts:130, reads/occurrences.ts:31, reads/settled.ts:80).",
    },
    {
      name: "by_transfer_id",
      fields: ["transferId"],
      for: "Evidence already consumed for one Transfer (.unique()) (payments/verifications/reads/identities.ts:64).",
    },
    {
      name: "by_command_id",
      fields: ["commandId"],
      for: "A command's consumed evidence, at verification start and operator resume (verifications/writes/attempts.ts:54, verifications/writes/recoveries.ts:104).",
    },
    {
      name: "by_logical_event_id",
      fields: ["logicalEventId"],
      for: "Evidence already consumed for one logical chain event (.unique()) (payments/verifications/reads/identities.ts:56).",
    },
    {
      name: "by_tx_event",
      fields: ["txHash", "eventLogIndex"],
      for: "Whether a Transfer's transaction carries consumed protocol evidence, for outside-money classification (payments/movements/reads/outside.ts:56).",
    },
  ],
  retention: KEPT,
});

export const table_money_executions = defineTable({
  id: "money-executions",
  title: "Money executions: one stored UserOperation Attempt",
  about:
    "One row per signed-or-to-be-signed sponsored UserOperation a money command rides: a Payment, a Permission or an " +
    "invitation configuration (commandKind). It holds the unsigned operation, its nonce lane, sponsorship window, the " +
    "send claim, the accepted hash, the pre-dispatch outcome and the claim sweep's recovery hold. Permissions, " +
    "Accounts and Requests read it directly (permissions/writes/verifications.ts:36, accounts/approvals/guards.ts:26, " +
    "requests/reads/attempts.ts:107); Permissions changes it only through Payments' acceptance writers " +
    "(executions/writes/acceptances.ts:174, :199). preDispatchOutcome.details.reason is literals(...ROLE_PERMISSION_DENIED_REASONS), a list spread from " +
    "several concepts' error codes (packages/protocol/src/errors/codes.ts:90); it is booked as String. Tenancy: the " +
    "signer (authUserId), so person; the command it serves may be an Organization's.",
  was: [`${T}/executions.ts:13`, "packages/backend/convex/schema.ts:37", `${B}/executions/writes/stores.ts:67`],
  concept: concept_payments,
  tenancy: "person",
  fields: Schema.Struct({
    executionId: S,
    originatingObservationContext: opt(ObservationContext),
    commandKind: Schema.Literals(["payment", "permission", "invitation_configuration"]),
    commandId: S,
    authUserId: S,
    chainId: N,
    signerAddress: S,
    userOpSenderSafe: S,
    nonce: opt(S),
    sponsorshipValidUntil: opt(N),
    correlationId: opt(S),
    journeyId: opt(S),
    digest: S,
    unsignedUserOpJson: S,
    state: Schema.Literals(MONEY_EXECUTION_STATES),
    expectedUserOpHash: opt(S),
    submissionClaimToken: opt(S),
    submissionClaimedAt: opt(N),
    userOpHash: opt(S),
    submittedAt: opt(N),
    preparedBlock: opt(N),
    sentBlock: opt(N),
    preDispatchOutcome: opt(
      Schema.Union([
        Schema.Struct({
          kind: Schema.Literals(["authority_refused"]),
          details: Schema.Struct({
            reason: S,
            operation: opt(S),
            remaining: opt(AssetAmount),
            required: opt(AssetAmount),
          }),
        }),
        Schema.Struct({ kind: Schema.Literals(["own_lane_advanced"]), expectedUserOpHash: S }),
        Schema.Struct({ kind: Schema.Literals(["signer_refused"]) }),
      ]),
    ),
    recoveryHold: opt(
      Schema.Union([
        Schema.Struct({ kind: Schema.Literals(["backing_off"]), since: N, checks: N, nextCheckAt: N }),
        Schema.Struct({ kind: Schema.Literals(["parked"]), since: N, checks: N, parkedAt: N }),
      ]),
    ),
    recoveryCheckAt: opt(Schema.NullOr(N)),
    createdAt: N,
    updatedAt: N,
  }),
  key: ["executionId"],
  indexes: [
    {
      name: "by_execution_id",
      fields: ["executionId"],
      for: "One execution by id (.unique()), from payments, schedules, the telemetry writer and permissions (payments/events/writer.ts:91, schedules/writes.ts:51, permissions/writes/abandonments.ts:118).",
    },
    {
      name: "by_command",
      fields: ["commandKind", "commandId"],
      for: "A command's Attempts by kind: Payments' store, bindings, classifications and verification fates, Permissions, invitation configurations and Requests (executions/writes/stores.ts:44, commands/writes/bindings.ts:46, permissions/writes/verifications.ts:37, requests/reads/attempts.ts:108).",
    },
    {
      name: "by_sender_nonce",
      fields: ["chainId", "userOpSenderSafe", "nonce"],
      for: "Which executions hold a Safe's nonce lane before a new one reserves it (payments/executions/writes/reservations.ts:61).",
    },
    {
      name: "by_state_recovery_expiry",
      fields: ["state", "recoveryCheckAt", "sponsorshipValidUntil"],
      for: "The claim sweep: sending or sent Attempts whose hold is due or whose sponsorship expired, never a parked one (payments/executions/reads/executions.ts:163).",
    },
    {
      name: "by_user_op_hash",
      fields: ["userOpHash"],
      for: "None: no withIndex(\"by_user_op_hash\") on moneyExecutions outside tests (gap).",
    },
  ],
  retention: KEPT,
});

export const table_provider_send_attempts = defineTable({
  id: "provider-send-attempts",
  title: "Provider send attempts",
  about:
    "One row per eth_sendUserOperation this backend attempted, written after the bundler answers. returnedUserOpHash is " +
    "absent when the provider refused; errorCode then names the refusal. It tells a refused send from a send that never " +
    "happened (reliability scenario A07). Append-only: nothing reads a row by a unique key, so the book's key " +
    "(executionId, attemptedAtMs) is its natural identity, not one the code enforces. No tenant column: it is " +
    "reached through its execution and command.",
  was: [`${T}/executions.ts:107`, `${B}/executions/writes/witnesses.ts:24`],
  concept: concept_payments,
  tenancy: "global",
  fields: Schema.Struct({
    executionId: S,
    commandId: S,
    paymentIds: Schema.Array(S),
    chainId: N,
    userOpSenderSafe: S,
    nonce: S,
    attemptedAtMs: N,
    returnedUserOpHash: opt(S),
    errorCode: opt(S),
  }),
  key: ["executionId", "attemptedAtMs"],
  indexes: [
    {
      name: "by_command_attempt",
      fields: ["commandId", "attemptedAtMs"],
      for: "Whether a command or one of its executions was ever sent, and the sends in a witness window (executions/reads/executions.ts:92, executions/reads/witnesses.ts:37, executions/views/executions.ts:101).",
    },
  ],
  retention: KEPT,
});

export const table_movements = defineTable({
  id: "movements",
  title: "Movements: ERC-20 Transfer evidence",
  about:
    "One row per ERC-20 Transfer log the scan saw for a scanned token: chain facts only, no editable accounting fields. " +
    "blockTime is the block's own time in epoch ms (ADR-0041). canonicalState says whether the chain still includes it. " +
    "Banking reads it for payout refunds (banking/payouts/writes/refunds.ts:86). Chain facts belong to no tenant.",
  was: [`${T}/movements.ts:10`, "packages/backend/convex/schema.ts:38", `${B}/movements/writes/windows.ts:97`],
  concept: concept_payments,
  tenancy: "global",
  fields: Schema.Struct({
    movementId: S,
    chainId: N,
    tokenAddress: S,
    txHash: S,
    logIndex: N,
    blockNumber: N,
    blockHash: S,
    blockTime: opt(N),
    source: S,
    destination: S,
    rawAmount: S,
    canonicalState: Schema.Literals(["observed", "included", "finalized", "removed"]),
    createdAt: N,
    updatedAt: N,
  }),
  key: ["movementId"],
  indexes: [
    {
      name: "by_movement_id",
      fields: ["movementId"],
      for: "One Movement by id: activity rows, evidence views, deposit chain time and identities (payments/views/evidence.ts:21, movements/reads/movements.ts:61, reads/settled.ts:23).",
    },
    {
      name: "by_canonical_state",
      fields: ["canonicalState"],
      for: "The operator migration that rewrites finalized Movements to included, and its rollback, 100 per batch (payments/movements/writes/inclusions.ts:16).",
    },
    {
      name: "by_chain_token_tx_log",
      fields: ["chainId", "tokenAddress", "txHash", "logIndex"],
      for: "The one Movement of a Transfer identity: scan apply, corrections, removal overlays, payout refunds (movements/writes/windows.ts:48, writes/corrections.ts:40, writes/overlays.ts:18, banking/payouts/writes/refunds.ts:86).",
    },
    {
      name: "by_chain_token_block",
      fields: ["chainId", "tokenAddress", "blockNumber"],
      for: "A token's stored Movements in a scanned block window, to remove the ones the chain no longer shows (payments/movements/writes/windows.ts:161).",
    },
  ],
  retention: "Kept indefinitely: a reorged Movement is marked removed, never deleted.",
});

export const table_movement_attributions = defineTable({
  id: "movement-attributions",
  title: "Movement attributions",
  about:
    "Which actor a Movement belongs to and on which side, and how it is classified: protocol settlement, deposit, " +
    "refund or movement-only outflow. createdAt is the Movement's own time, so a replay does not move an old transfer " +
    "to the top of an actor's history. Rows are rewritten and deleted as the projection changes. Tenancy is mixed " +
    "(account or organization); the book records organization.",
  was: [`${T}/movements.ts:31`, `${B}/movements/writes/projections.ts:53`, `${B}/movements/writes/overlays.ts:40`],
  concept: concept_payments,
  tenancy: "organization",
  fields: Schema.Struct({
    movementId: S,
    actorKind: ActorKind,
    actorId: S,
    side: Schema.Literals(["source", "destination"]),
    classification: Schema.Literals(["protocol_settlement", "deposit", "refund", "movement_only_outflow"]),
    createdAt: N,
  }),
  key: ["movementId", "actorKind", "actorId", "side"],
  indexes: [
    {
      name: "by_movement_actor",
      fields: ["movementId", "actorKind", "actorId"],
      for: "A Movement's attributions: projection rewrite, removal, activity and identities (movements/writes/projections.ts:24, writes/overlays.ts:38, reads/movements.ts:66, reads/identities.ts:76).",
    },
    {
      name: "by_actor_created",
      fields: ["actorKind", "actorId", "createdAt"],
      for: "An actor's Movement activity in time order, outside money and participant checks (movements/reads/activity.ts:107, movements/reads/outside.ts:157, reads/participants.ts:173).",
    },
  ],
  retention: "Rows are deleted when a Movement is removed or its projection drops them (movements/writes/overlays.ts:40, writes/projections.ts:41); otherwise kept.",
});

export const table_movement_scan_checkpoints = defineTable({
  id: "movement-scan-checkpoints",
  title: "Movement scan checkpoints",
  about:
    "Where the Movement scan stands for one chain and token: the next block to read and the anchor block it last " +
    "trusted, to detect a reorg. One row per chain and token.",
  was: [`${T}/movements.ts:41`, `${B}/movements/writes/windows.ts:254`],
  concept: concept_payments,
  tenancy: "global",
  fields: Schema.Struct({
    chainId: N,
    tokenAddress: S,
    nextBlock: N,
    anchorBlockNumber: N,
    anchorBlockHash: S,
    updatedAt: N,
  }),
  key: ["chainId", "tokenAddress"],
  indexes: [
    {
      name: "by_chain_token",
      fields: ["chainId", "tokenAddress"],
      for: "The checkpoint of one chain and token, read and advanced by the scan (payments/movements/writes/windows.ts:205, movements/reads/movements.ts:159).",
    },
  ],
  retention: KEPT,
});

export const table_deposit_materializations = defineTable({
  id: "deposit-materializations",
  title: "Deposit materializations",
  about:
    "The link from an inbound Movement to the Deposit Payment it materialized, with the evidence digest it was born " +
    "from. A reorg removes the Deposit and marks the link removed; the Movement's return materializes it again. " +
    "No tenant column: it is reached through its Movement and Payment.",
  was: [`${T}/payments.ts:11`, `${B}/writes/deposits.ts:161`, `${B}/writes/rollbacks.ts:73`],
  concept: concept_payments,
  tenancy: "global",
  fields: Schema.Struct({
    movementId: S,
    paymentId: S,
    evidenceDigest: S,
    state: Schema.Literals(["materialized", "removed"]),
    firstMaterializedAt: N,
    updatedAt: N,
  }),
  key: ["movementId"],
  indexes: [
    {
      name: "by_movement_id",
      fields: ["movementId"],
      for: "The materialization of one Movement (.first()): deposit birth, rollback and settlement reads (payments/writes/deposits.ts:153, writes/rollbacks.ts:24, reads/settlements.ts:145).",
    },
    {
      name: "by_payment_id",
      fields: ["paymentId"],
      for: "None: no withIndex(\"by_payment_id\") on depositMaterializations outside tests (gap).",
    },
  ],
  retention: KEPT,
});

export const table_payment_document_intents = defineTable({
  id: "payment-document-intents",
  title: "Payment document intents",
  about:
    "The caller's intent digest and, once resolved, the resolved command and document bundles for one actor's request " +
    "key, so a retried prepare with documents resolves the same way. Tenancy is mixed (account or organization); the " +
    "book records organization.",
  was: [`${T}/payments.ts:22`, `${B}/commands/writes/intents.ts:41`],
  concept: concept_payments,
  tenancy: "organization",
  fields: Schema.Struct({
    actorKind: ActorKind,
    actorId: S,
    requestKey: S,
    callerIntentDigest: S,
    resolvedCommandJson: opt(S),
    documentBundlesJson: opt(S),
    createdAt: N,
  }),
  key: ["actorKind", "actorId", "requestKey"],
  indexes: [
    {
      name: "by_actor_request_key",
      fields: ["actorKind", "actorId", "requestKey"],
      for: "The intent an actor's request key already stored (.unique()), at prepare and at the funding read (payments/commands/writes/intents.ts:17, commands/reads/funding.ts:53).",
    },
  ],
  retention: KEPT,
});

export const table_payment_evidence_conflicts = defineTable({
  id: "payment-evidence-conflicts",
  title: "Payment evidence conflicts",
  about:
    "Evidence submitted for a Payment that disagreed with what it already holds, with its digest and a reason code, " +
    "recorded once per Payment and evidence identity. No tenant column: it is reached through its Payment.",
  was: [`${T}/payments.ts:191`, `${B}/verifications/writes/conflicts.ts:97`],
  concept: concept_payments,
  tenancy: "global",
  fields: Schema.Struct({
    paymentId: S,
    evidenceIdentity: opt(S),
    submittedEvidenceDigest: S,
    reasonCode: S,
    observedAt: N,
  }),
  key: ["paymentId", "evidenceIdentity"],
  indexes: [
    {
      name: "by_payment_observed",
      fields: ["paymentId", "observedAt"],
      for: "None: no withIndex(\"by_payment_observed\") outside tests (gap).",
    },
    {
      name: "by_payment_identity",
      fields: ["paymentId", "evidenceIdentity"],
      for: "Whether this conflict is already recorded before inserting it (payments/verifications/writes/conflicts.ts:92).",
    },
  ],
  retention: KEPT,
});

export const table_settlement_sweep_cursors = defineTable({
  id: "settlement-sweep-cursors",
  title: "Settlement sweep cursor",
  about:
    "The settlement sweep's place in the open (settling) Payments: the createdAt and creation time of the last Payment " +
    "its previous run read, in by_status_created order. One row; no row means the next run starts from the oldest.",
  was: [`${T}/payments.ts:203`, `${B}/reads/settlements.ts:73`],
  concept: concept_payments,
  tenancy: "global",
  fields: Schema.Struct({
    sweep: Schema.Literals(["settlements"]),
    createdAt: N,
    creationTime: N,
    updatedAt: N,
  }),
  key: ["sweep"],
  indexes: [
    {
      name: "by_sweep",
      fields: ["sweep"],
      for: "The one settlements cursor row (.unique()) the sweep reads and moves (payments/reads/settlements.ts:26).",
    },
  ],
  retention: KEPT,
});

export const table_payment_schedules = defineTable({
  id: "payment-schedules",
  title: "Payment schedules: a signed operation sent on its date",
  about:
    "One signed scheduled operation (ADR-0034): Capxul may send exactly that operation inside its window. A v4 budget's " +
    "dated payment has no signature; Budgets holds the reservation and the due job calls Budgets.execute with budget." +
    "scheduledIds. nextAttemptAt is when the due job reads it next. The README's table list omits it; schema.ts:40 " +
    "registers it. Tenancy: the signer (authUserId), so person.",
  was: [`${T}/schedules.ts:17`, "packages/backend/convex/schema.ts:40", `${B}/schedules/writes.ts:67`],
  concept: concept_payments,
  tenancy: "person",
  fields: Schema.Struct({
    executionId: S,
    commandId: S,
    authUserId: S,
    signature: opt(S),
    sendsAt: N,
    windowEndsAt: N,
    state: Schema.Literals(["waiting", "sent", "failed", "cancelled"]),
    nextAttemptAt: opt(N),
    attempts: N,
    shortfall: opt(Schema.Literals(["budget_exhausted", "balance_too_low", "fees_too_high", "send_refused"])),
    shortfallDetail: opt(S),
    failedReason: opt(Schema.Literals(["window_passed", "not_member", "approvals_lost"])),
    aheadCheckedAt: opt(N),
    voidCommandId: opt(S),
    budget: opt(Schema.Struct({ budgets: S, scheduledIds: Schema.Array(S) })),
    createdAt: N,
    updatedAt: N,
  }),
  key: ["executionId"],
  indexes: [
    {
      name: "by_execution",
      fields: ["executionId"],
      for: "The schedule of one execution (.unique()), for each due-job step and cancel (payments/schedules/reads.ts:23).",
    },
    {
      name: "by_command",
      fields: ["commandId"],
      for: "The latest schedule of a command (desc, .first()), for voids, reschedules and budget schedules (payments/schedules/reads.ts:34).",
    },
    {
      name: "by_state_next_attempt",
      fields: ["state", "nextAttemptAt"],
      for: "The due job: waiting schedules whose next attempt is due, leased in a batch (payments/schedules/writes.ts:101).",
    },
  ],
  retention: KEPT,
});

// ── state machines ──────────────────────────────────────────────────────────────────────────

export const machine_payment = defineMachine({
  id: "payment",
  title: "Payment status",
  about:
    "payments.status. The pure core transitionPayment (rules/transitions.ts:196) decides most moves; several writers " +
    "set the status directly without it (expiry, rebinding, unresolved outcomes, commitment history, occurrence removal). " +
    "The core also admits edges no caller sends: reorged (settled to settling) and instruction_failed (settling to " +
    "failed). Writes that keep the status (commitment_created, redirect, a partial claim, a commitment's " +
    "record_submission, attempt_sent on settling) are not listed. rollback_deposit deletes the Deposit row. The field " +
    "is optional in the validator. No writer moves a commitment between scheduled, streaming and pending_claim: the " +
    "status is decided once at birth (rules/amounts.ts:77) and a history replay restores it from the creation " +
    "evidence's preState. A correction moves any send Payment with an included send occurrence back to settling with " +
    "no status check (verifications/writes/history.ts:215), so failed is not terminal.",
  was: [`${B}/rules/transitions.ts:196`, `${T}/payments.ts:45`, "packages/protocol/src/payments/status.ts:23"],
  table: table_payments,
  field: "status",
  initial: "pending",
  states: [
    { id: "pending", about: "Born, not yet sent; also a send whose Attempt expired or was displaced, waiting to be signed again." },
    { id: "settling", about: "Its operation is submitted; waiting for the receipt or the indexed PaymentSent fact." },
    { id: "in_transit", about: "A bank payout whose funding the chain proved; Bridge's delivery journal decides the rest." },
    { id: "unresolved", about: "A send or commitment whose outcome the backend cannot prove; an operator can resume it." },
    { id: "pending_claim", about: "A commitment whose release time has passed, waiting for the recipient's claim." },
    { id: "scheduled", about: "A commitment held until its release time." },
    { id: "streaming", about: "A commitment that vests over time." },
    { id: "settled", about: "The money arrived: proven by evidence, the index, a completed claim, a bank delivery or a Deposit." },
    { id: "cancelled", about: "A commitment cancelled on chain, or a scheduled send voided." },
    { id: "failed", about: "The command failed before money moved, or the bank returned a payout. A correction of a returned payout's funding moves it back to settling." },
  ],
  transitions: {
    to_pending: {
      from: ["settling"],
      to: "pending",
      about: "Birth of a send (births.ts:147, from no row). A send whose sponsorship expired (commands/writes/links.ts:216), or whose Attempt the verification proved expired or displaced (fate expired or replaced, verifications/writes/finishes.ts:223).",
      guard: "Only a settling row moves. Expiry patches only a send command's Payments; a verification fate patches the Payments of any command but a void_schedule. Birth refuses a second birth of a settlement id.",
      emits: [event_payment_transitioned],
    },
    to_settling: {
      from: ["pending", "unresolved", "settled", "in_transit", "failed"],
      to: "settling",
      about:
        "record_submission of a send or Board schedule (submissions.ts:110, schedules/writes.ts:247); own operation bound (bindings.ts:131); operator resume (recoveries.ts:140); " +
        "a drift correction removes a send occurrence, any status (history.ts:218). A collection is born settling (collections.ts:35).",
      emits: [event_payment_transitioned],
    },
    to_in_transit: {
      from: ["settling"],
      to: "in_transit",
      about: "rail_funding_verified: the indexed fact or verified evidence proves a bank payout's funding (writes/settlements.ts:93, verifications/writes/sends.ts:174). The devnet Bridge fixture inserts one in_transit Payout (writes/proofs.ts:40).",
      emits: [event_payment_transitioned],
    },
    to_unresolved: {
      from: ["settling", "scheduled", "streaming", "pending_claim", "cancelled", "settled"],
      to: "unresolved",
      about:
        "A send command ends unresolved while settling (writes/outcomes.ts:100; event at outcomes.ts:54); its verification paths print a payment_writer_incident (finishes.ts:97, 196, 277). History replay finds no creation or an invalidated row (history.ts:165; " +
        "written at :244, commitments.ts:158).",
      emits: [event_payment_transitioned, event_payment_writer_incident],
    },
    to_scheduled: {
      from: ["cancelled", "settled", "unresolved"],
      to: "scheduled",
      about: "Born held when its release is in the future (births.ts:147, rules/amounts.ts:77). Commitment history replay restores the birth status when a removed cancel or claim leaves the creation standing (history.ts:165, written at history.ts:244 and commitments.ts:158).",
      emits: [],
    },
    to_streaming: {
      from: ["cancelled", "settled", "unresolved"],
      to: "streaming",
      about: "Born as a stream (births.ts:147, rules/amounts.ts:91). Commitment history replay restores the birth status when a removed cancel or claim leaves the creation standing (history.ts:165, written at history.ts:244 and commitments.ts:158).",
      emits: [],
    },
    to_pending_claim: {
      from: ["cancelled", "settled", "unresolved"],
      to: "pending_claim",
      about: "Born claimable when its release time has passed (births.ts:147, rules/amounts.ts:77). Commitment history replay restores the birth status when a removed cancel or claim leaves the creation standing (history.ts:165, written at history.ts:244 and commitments.ts:158).",
      emits: [],
    },
    to_settled: {
      from: ["settling", "in_transit", "scheduled", "streaming", "pending_claim", "cancelled", "unresolved"],
      to: "settled",
      about: "Verified evidence or the indexed PaymentSent fact (sends.ts:196, settlements.ts:107); a bank delivery (rails.ts:47); a claim that completes (claims.ts:62); history replay (history.ts:165). A Deposit is born settled (deposits.ts:80).",
      guard: "The fact must equal every stored term; a second settle meets ALREADY_SETTLED and writes nothing.",
      emits: [event_payment_transitioned],
    },
    to_cancelled: {
      from: ["pending", "settling", "scheduled", "streaming", "pending_claim", "settled", "unresolved"],
      to: "cancelled",
      about:
        "A verified commitment cancel (verifications/writes/endings.ts:59; event: command_completed, outcomes.ts:54); a landed void (voids.ts:116; event at voids.ts:118); " +
        "a Budgets chain cancel, with no event (schedules/writes/board-cancels.ts:49); history replay (history.ts:66, written at :244).",
      emits: [event_payment_transitioned],
    },
    to_failed: {
      from: ["pending", "settling", "scheduled", "streaming", "pending_claim", "in_transit", "settled"],
      to: "failed",
      about: "The command failed (writes/outcomes.ts:99): pending or settling, or a held commitment whose create_commitment failed. The bank returned a payout, before or after delivery (writes/rails.ts:47).",
      guard: "A failed void_schedule fails no Payment; only a failed create_commitment fails a held one.",
      emits: [event_payment_transitioned],
    },
  },
});

export const machine_payment_command = defineMachine({
  id: "payment-command",
  title: "Payment command submission state",
  about:
    "paymentCommands.state: prepared until its signed operation is recorded, then submitted. An Attempt proved expired " +
    "or displaced returns the command to prepared so it is signed again. Writes that keep the state (an expiry of a " +
    "command never submitted, a rebind of a submitted one) are not listed. A Board schedule is marked submitted with " +
    "no userOpHash (schedules/writes.ts:225).",
  was: [`${T}/commands.ts:26`, `${B}/commands/writes/commands.ts:233`],
  table: table_payment_commands,
  field: "state",
  initial: "prepared",
  states: [
    { id: "prepared", about: "Born with its prepared command and execution; no operation recorded." },
    { id: "submitted", about: "Its operation's hash is recorded; verification reads the chain." },
  ],
  transitions: {
    to_prepared: {
      from: ["submitted"],
      to: "prepared",
      about: "Born prepared (commands/writes/commands.ts:233). Sponsorship expiry found by the classifier (commands/writes/links.ts:223) or a verification fate of expired or replaced (verifications/writes/finishes.ts:231) clears the hash.",
      guard: "Expiry runs only for a command that has not ended (executions/writes/classifications.ts:199).",
      emits: [event_payment_transitioned],
    },
    to_submitted: {
      from: ["prepared"],
      to: "submitted",
      about: "recordSubmission (verifications/writes/submissions.ts:137); a landed own operation bound (commands/writes/bindings.ts:113); a Board schedule applied (schedules/writes.ts:225).",
      guard: "recordSubmission requires prepared, no hash and the same Payments; a hash another command owns is refused.",
      emits: [event_payment_transitioned],
    },
  },
});

export const machine_payment_command_verification = defineMachine({
  id: "payment-command-verification",
  title: "Payment command verification state",
  about:
    "paymentCommands.verificationState: the lease and outcome of verifying a submitted command against the chain. " +
    "The recovery sweep returns lapsed scheduled, verifying and retry_wait rows to scheduled. An operator resumes " +
    "mismatch or unresolved. Self-loops (a stale scheduled lease rescheduled) are not listed.",
  was: [`${T}/commands.ts:46`, `${B}/verifications/writes/attempts.ts:59`, `${B}/verifications/writes/finishes.ts:82`],
  table: table_payment_commands,
  field: "verificationState",
  initial: "not_started",
  states: [
    { id: "not_started", about: "Not submitted, or reset after its Attempt expired or was displaced." },
    { id: "scheduled", about: "Due for a verification run." },
    { id: "verifying", about: "A verification attempt holds the lease." },
    { id: "retry_wait", about: "The receipt was missing or the provider failed; it retries at nextVerificationAt." },
    { id: "mismatch", about: "The evidence contradicts the command; quarantined for an operator." },
    { id: "applied", about: "The evidence was applied; the command completed." },
    { id: "unresolved", about: "The receipt stayed missing or the own lane was displaced; held for an operator." },
    { id: "failed", about: "The operation reverted, or a void did not land." },
  ],
  transitions: {
    to_scheduled: {
      from: ["not_started", "verifying", "retry_wait", "mismatch", "unresolved", "applied"],
      to: "scheduled",
      about: "Submission (verifications/writes/submissions.ts:139); landed binding (bindings.ts:116); the recovery sweep (recoveries.ts:69); operator resume of mismatch or unresolved (recoveries.ts:148); a reorg invalidates consumed evidence (history.ts:199).",
      emits: [event_payment_transitioned],
    },
    to_verifying: {
      from: ["scheduled", "retry_wait"],
      to: "verifying",
      about: "beginVerificationInTx leases the next attempt (verifications/writes/attempts.ts:59).",
      guard: "The command is submitted and scheduled, or retry_wait whose retry time has come.",
      emits: [],
    },
    to_retry_wait: {
      from: ["verifying"],
      to: "retry_wait",
      about: "The receipt is missing or the provider failed; retries back off from 30 s, capped at 10 min (verifications/writes/finishes.ts:108). A read that saw a new execution state also sends a progressed event (finishes.ts:62).",
      emits: [event_payment_verification_retry, event_payment_transitioned],
    },
    to_unresolved: {
      from: ["verifying"],
      to: "unresolved",
      about: "The receipt stayed missing past the limit (finishes.ts:82), or a landed or held operation could not be bound (finishes.ts:192). Both print a payment_writer_incident (finishes.ts:97, finishes.ts:196).",
      emits: [event_payment_verification_retry, event_payment_transitioned, event_payment_writer_incident],
    },
    to_mismatch: {
      from: ["scheduled", "verifying", "retry_wait", "applied", "unresolved"],
      to: "mismatch",
      about: "The receipt contradicts the command (verifications/writes/finishes.ts:273), or conflicting evidence quarantines the one command that owns the hash (conflicts.ts:70). Both print a payment_writer_incident (finishes.ts:277, conflicts.ts:214), except a replay conflict.",
      guard: "Quarantine picks the command by hash, whatever its state: a not_started one holds no hash, and a failed one is filtered out (verifications/rules.ts:21).",
      emits: [event_payment_transitioned, event_payment_writer_incident],
    },
    to_applied: {
      from: ["not_started", "verifying"],
      to: "applied",
      about: "Verified evidence applied (attempts.ts:146), a void landed (voids.ts:74), a budget schedule proved (budget-schedules.ts:86). A Board schedule applies a not-yet-verified command directly (schedules/writes.ts:226). The budget and Board paths leave completionOutcome unset.",
      emits: [event_payment_transitioned],
    },
    to_failed: {
      from: ["verifying"],
      to: "failed",
      about: "The Attempt reverted, or a void did not land (verifications/writes/finishes.ts:210).",
      emits: [event_payment_transitioned],
    },
    to_not_started: {
      from: ["scheduled", "verifying", "retry_wait", "mismatch", "unresolved"],
      to: "not_started",
      about: "Born not_started (commands/writes/commands.ts:234). A verification fate of expired or replaced (finishes.ts:234), or a classifier-found sponsorship expiry of a command not ended, whatever its verification state (commands/writes/links.ts:225).",
      emits: [event_payment_transitioned],
    },
  },
});

export const machine_commitment_evidence = defineMachine({
  id: "commitment-evidence",
  title: "Consumed evidence inclusion",
  about:
    "commitmentEvidence.state: whether consumed evidence is still on the canonical chain. A correction marks it removed; " +
    "the same occurrence verified again marks it included.",
  was: [`${T}/commands.ts:117`],
  table: table_commitment_evidence,
  field: "state",
  initial: "included",
  states: [
    { id: "included", about: "The evidence was consumed and its occurrence stands." },
    { id: "removed", about: "A reorg or correction removed its occurrence; the money it moved left the books." },
  ],
  transitions: {
    to_included: {
      from: ["removed"],
      to: "included",
      about: "Inserted included when evidence is consumed (verifications/writes/conflicts.ts:183). A re-verified occurrence is marked included again (verifications/writes/commitments.ts:151, verifications/writes/sends.ts:193).",
      emits: [],
    },
    to_removed: {
      from: ["included"],
      to: "removed",
      about: "invalidateConsumption (verifications/writes/history.ts:186), from the indexing drift correction (indexing/drifts/writes/corrections.ts:92, through payments/writes/corrections.ts:75) or a commitment history replay that invalidates later rows (history.ts:243, commitments.ts:157).",
      emits: [],
    },
  },
});

export const machine_money_execution = defineMachine({
  id: "money-execution",
  title: "Money execution Attempt state",
  about:
    "moneyExecutions.state. Writers use only the eight ATTEMPT_STATES, through transitionAttempt (rules/attempts.ts:136) " +
    "in writeAttemptInTx (executions/writes/attempts.ts:68). The other eleven literals stay in the validator for " +
    "historical rows; nothing writes them now, and storedAttemptState throws on one, so such a row can never move " +
    "(executions/writes/attempts.ts:40). Events are sent for payment commands only, by the Payment writers in the " +
    "same transaction; Permission and invitation executions send none. The claim sweep's recoveryHold never changes it.",
  was: [`${T}/executions.ts:28`, `${B}/rules/attempts.ts:136`, `${B}/executions/writes/attempts.ts:68`],
  table: table_money_executions,
  field: "state",
  initial: "prepared",
  states: [
    { id: "prepared", about: "Built and stored, not yet claimed for sending." },
    { id: "sending", about: "Claimed for its one send." },
    { id: "sent", about: "The bundler accepted it under a hash." },
    { id: "succeeded", about: "Its receipt or EntryPoint event shows it executed.", terminal: true },
    { id: "reverted", about: "It landed and reverted.", terminal: true },
    { id: "expired", about: "Its sponsorship window closed with the lane still at its nonce." },
    { id: "displaced", about: "Another operation consumed its nonce.", terminal: true },
    { id: "unknown", about: "Evidence proves no fate yet." },
    { id: "submitting", about: "Legacy: admitted by the validator for historical rows; no current writer sets it." },
    { id: "submitted", about: "Legacy: admitted by the validator for historical rows; no current writer sets it." },
    { id: "pending", about: "Legacy: admitted by the validator for historical rows; no current writer sets it." },
    { id: "included", about: "Legacy: admitted by the validator for historical rows; no current writer sets it." },
    { id: "dropped", about: "Legacy: admitted by the validator for historical rows; no current writer sets it." },
    { id: "replaced", about: "Legacy: admitted by the validator for historical rows; no current writer sets it." },
    { id: "unresolved", about: "Legacy: admitted by the validator for historical rows; no current writer sets it." },
    { id: "failed", about: "Legacy: admitted by the validator for historical rows; no current writer sets it." },
    { id: "settled", about: "Legacy: admitted by the validator for historical rows; no current writer sets it." },
    { id: "rejected", about: "Legacy: admitted by the validator for historical rows; no current writer sets it." },
    { id: "superseded", about: "Legacy: admitted by the validator for historical rows; no current writer sets it." },
  ],
  transitions: {
    to_prepared: {
      from: [],
      to: "prepared",
      about: "Inserted prepared (executions/writes/stores.ts:78); a payment command's execution is attached at prepare (commands/writes/links.ts:128).",
      emits: [event_payment_transitioned],
    },
    to_sending: {
      from: ["prepared"],
      to: "sending",
      about: "start_sending: the send claims the execution before it is sent (executions/writes/claims.ts:116).",
      emits: [],
    },
    to_sent: {
      from: ["sending"],
      to: "sent",
      about: "send_accepted: the bundler accepted the operation (executions/writes/acceptances.ts:55, acceptances.ts:186); the Payment command records the submission (commands/writes/submissions.ts:169).",
      emits: [event_payment_transitioned],
    },
    to_succeeded: {
      from: ["prepared", "sending", "sent", "unknown", "expired"],
      to: "succeeded",
      about: "classify_evidence: our hash's receipt or EntryPoint event succeeded (executions/writes/lifecycles.ts:159, verifications/writes/inclusions.ts:28, commands/writes/bindings.ts:98). Chain proof overrides a ledger expiry (CAP-701).",
      emits: [event_payment_transitioned],
    },
    to_reverted: {
      from: ["prepared", "sending", "sent", "unknown", "expired"],
      to: "reverted",
      about: "classify_evidence: our operation landed and reverted; the payment command fails (executions/writes/classifications.ts:211).",
      emits: [event_payment_transitioned],
    },
    to_expired: {
      from: ["prepared", "sending", "sent", "unknown"],
      to: "expired",
      about:
        "classify_evidence: sponsorship closed, lane at the stored nonce. The classifier and the verification fate return the command to prepared (classifications.ts:203, links.ts:222; " +
        "lifecycles.ts:159, finishes.ts:230); a new build's reservation supersedes it (reservations.ts:168, links.ts:149).",
      emits: [event_payment_transitioned],
    },
    to_displaced: {
      from: ["prepared", "sending", "sent", "unknown"],
      to: "displaced",
      about: "classify_evidence: another operation (or our own void) consumed the nonce; the command is superseded (executions/writes/classifications.ts:206, commands/writes/links.ts:160).",
      emits: [event_payment_transitioned],
    },
    to_unknown: {
      from: ["sent"],
      to: "unknown",
      about: "The command ended unresolved while its Attempt was sent: held as unknown, never failed (executions/writes/lifecycles.ts:51). The classifier's unknown (rules/attempts.ts:125) is written nowhere else: classifications.ts:80 records none, lifecycles.ts:134 returns no fate.",
      emits: [event_payment_transitioned],
    },
  },
});

export const machine_movement = defineMachine({
  id: "movement",
  title: "Movement canonical state",
  about:
    "movements.canonicalState: whether the chain still includes a Transfer. The scan inserts included; a removed " +
    "Movement is marked, never deleted. finalized is written only by the operator migration rollback; observed has " +
    "no writer.",
  was: [`${T}/movements.ts:23`, `${B}/movements/rules/movements.ts:105`],
  table: table_movements,
  field: "canonicalState",
  initial: "included",
  states: [
    { id: "observed", about: "In the validator; no writer sets it." },
    { id: "included", about: "The scan saw it on the canonical chain." },
    { id: "finalized", about: "The older spelling of included; the operator migration rewrites it to included." },
    { id: "removed", about: "The chain no longer shows it, or its memo conflicted; its attributions are deleted." },
  ],
  transitions: {
    to_included: {
      from: ["finalized", "removed"],
      to: "included",
      about: "Inserted included by the scan (movements/writes/windows.ts:97); a replayed Transfer is marked included, whatever it was (movements/writes/projections.ts:81); the operator migration (movements/writes/inclusions.ts:27).",
      emits: [],
    },
    to_finalized: {
      from: ["included"],
      to: "finalized",
      about: "The operator rollback of the inclusion migration, 100 rows per batch (movements/writes/inclusions.ts:30).",
      emits: [],
    },
    to_removed: {
      from: ["included", "finalized"],
      to: "removed",
      about: "removeMovementProjection: a reorg, a memo conflict or a settled protocol Transfer suppressed (movements/writes/overlays.ts:49).",
      emits: [],
    },
  },
});

export const machine_deposit_materialization = defineMachine({
  id: "deposit-materialization",
  title: "Deposit materialization state",
  about:
    "depositMaterializations.state: whether a Movement's Deposit Payment exists. Rollback deletes the Deposit and marks " +
    "the link removed; the Movement's return re-materializes it.",
  was: [`${T}/payments.ts:15`],
  table: table_deposit_materializations,
  field: "state",
  initial: "materialized",
  states: [
    { id: "materialized", about: "The Deposit Payment exists, settled." },
    { id: "removed", about: "The Movement left the canonical chain; its Deposit was deleted." },
  ],
  transitions: {
    to_materialized: {
      from: ["removed"],
      to: "materialized",
      about: "Inserted materialized with the Deposit (writes/deposits.ts:161); a removed one materializes again when its Movement is included and attributed (writes/deposits.ts:218).",
      emits: [],
    },
    to_removed: {
      from: ["materialized"],
      to: "removed",
      about: "rollbackDeposit, when the Movement is removed and the evidence digest matches (writes/rollbacks.ts:73).",
      emits: [],
    },
  },
});

export const machine_payment_schedule = defineMachine({
  id: "payment-schedule",
  title: "Payment schedule state",
  about:
    "paymentSchedules.state: a scheduled operation waits on its date, then is sent, fails or is cancelled. Each step " +
    "also schedules a notice email (notices/writes.ts:19), which is not a catalog event.",
  was: [`${T}/schedules.ts:25`, `${B}/schedules/writes.ts:90`],
  table: table_payment_schedules,
  field: "state",
  initial: "waiting",
  states: [
    { id: "waiting", about: "Stored, waiting for its date or for a retry after a shortfall." },
    { id: "sent", about: "The due job sent its operation.", terminal: true },
    { id: "failed", about: "It can no longer be sent: window passed, not a member, approvals lost.", terminal: true },
    { id: "cancelled", about: "A void landed or Budgets cancelled the reservation.", terminal: true },
  ],
  transitions: {
    to_waiting: {
      from: [],
      to: "waiting",
      about: "Inserted waiting: a signed schedule (schedules/writes.ts:67), a Board schedule (schedules/writes.ts:229), a budget's dated payment (verifications/writes/budget-schedules.ts:91).",
      emits: [],
    },
    to_sent: {
      from: ["waiting"],
      to: "sent",
      about: "The due job sent the operation (schedules/writes.ts:165).",
      emits: [],
    },
    to_failed: {
      from: ["waiting"],
      to: "failed",
      about: "The due job found it can never be sent (schedules/writes.ts:182); when failCommand, the command fails too (schedules/writes.ts:194).",
      emits: [event_payment_transitioned],
    },
    to_cancelled: {
      from: ["waiting"],
      to: "cancelled",
      about: "A void landed (verifications/writes/voids.ts:92), or Budgets cancelled or rescheduled the reservation (schedules/writes/board-cancels.ts:28).",
      emits: [event_payment_transitioned],
    },
  },
});
