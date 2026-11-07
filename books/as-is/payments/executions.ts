// The as-is book of the old payments concept: the executions area.
//
// Every operation registered at `payments/executions:*` (packages/backend/convex/payments/executions.ts),
// read from packages/backend/src/payments/executions/operations/, as the old code does it. Four are
// public protocol rows (`executions` in packages/protocol/src/payments/operations.ts); twelve are internal
// steps other operations run through `ctx.runQuery` / `ctx.runMutation`; the claim sweep is a workflow.
//
// An action's reads, writes, drives and invokes are those of the internal steps it runs, named in its
// `about`: the action itself holds no transaction. No executions code calls `Effect.withSpan`; an action's
// `spans` are the client spans its context opens for each nested Convex call (`convex.<kind>`,
// platform/execute.ts) and the chain-rpc request spans (`chain.read <method>`, `chain.attempt <upstream>`).

import { Schema } from "effect";
import { defineRpc, defineWorkflow } from "../../../packages/book/src/index.ts";

import { concept_payments } from "./foundation.ts";
import {
  error_ACCOUNT_NOT_FOUND,
  error_ENV_MISSING,
  error_INVALID_INPUT,
  error_NOT_AUTHENTICATED,
  error_NOT_IMPLEMENTED,
  error_PROVIDER_ERROR,
  error_PROVIDER_RESPONSE_INVALID,
  error_ROLE_PERMISSION_DENIED,
  error_SMART_ACCOUNT_MISSING,
  error_SUPERSEDED,
  error_UNKNOWN,
  error_WRONG_STATE,
  event_payment_transitioned,
  event_payout_transitioned,
} from "./vocabulary.ts";
import {
  machine_money_execution,
  machine_payment,
  machine_payment_command,
  machine_payment_command_verification,
  machine_payment_schedule,
  table_money_executions,
  table_payment_commands,
  table_payment_schedules,
  table_payments,
  table_provider_send_attempts,
} from "./data.ts";
import {
  procedure_access_require_authenticated_user,
  procedure_accounts_account_id_for_auth_user_or_null,
  procedure_accounts_read_execution_approval_in_tx,
  procedure_accounts_require_payment_account_in_tx,
  procedure_banking_accept_payout_quote_in_tx,
  procedure_banking_payout_send_failed_in_tx,
  procedure_banking_read_payout_delivery_in_tx,
  procedure_books_book_asset_by_id_in_tx,
  procedure_documents_current_payment_documents,
  procedure_documents_load_payment_documents,
  procedure_documents_load_payment_documents_for_principal,
  procedure_organizations_read_organization_safe_in_tx,
  procedure_organizations_read_owner_safes_in_tx,
  procedure_parties_party_by_id,
  procedure_parties_party_by_safe_address,
  procedure_payroll_advance_runs_to_authorized,
  procedure_payroll_read_department_spend_in_tx,
  procedure_permissions_authorize_invitation_configuration_execution_in_tx,
  procedure_permissions_authorize_permission_execution_in_tx,
  procedure_permissions_find_command_authority,
  procedure_permissions_read_budget_allowance_in_tx,
  procedure_permissions_read_permission_execution_outcome_in_tx,
  procedure_permissions_read_worn_allowances_in_tx,
  procedure_permissions_require_organization_spend_authority_in_tx,
  table_accounts,
  table_counterparty_destinations,
  table_identities,
  table_orgs,
} from "./neighbors.ts";
import { contract_entry_point, contract_erc20, contract_roles, integration_chain_rpc } from "./external.ts";

const BACKEND = "packages/backend";
const CONVEX = `${BACKEND}/convex/payments/executions.ts`;
const SRC = `${BACKEND}/src/payments`;
const EX = `${SRC}/executions`;
const PROTOCOL = "packages/protocol/src/payments";

// ── shared shapes ───────────────────────────────────────────────────────────────────────────

/** A stored `moneyExecutions` row (tables/executions.ts:13), handed back whole: too wide to transcribe. */
const MoneyExecutionRow = Schema.Unknown;
/** The wire Payment (`Payment`, packages/protocol/src/payments/payment-schema.ts): too deep to transcribe. */
const WirePayment = Schema.Unknown;
const CommandKind = Schema.Literals(["payment", "permission", "invitation_configuration"]);
const SweepState = Schema.Literals(["sending", "sent"]);
const ClaimFields = {
  authUserId: Schema.String,
  executionId: Schema.String,
  expectedUserOpHash: Schema.String,
  claimToken: Schema.String,
};
const OperationEvidence = Schema.Struct({
  operationHash: Schema.String,
  succeeded: Schema.Boolean,
  transactionHash: Schema.String,
});
const AttemptEvidence = Schema.Struct({
  receipt: Schema.optionalKey(Schema.NullOr(OperationEvidence)),
  landed: Schema.optionalKey(Schema.NullOr(OperationEvidence)),
  lane: Schema.optionalKey(Schema.NullOr(Schema.Struct({ storedNonce: Schema.String, currentNonce: Schema.String }))),
});
const RecoveryHold = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("backing_off"),
    since: Schema.Number,
    checks: Schema.Number,
    nextCheckAt: Schema.Number,
  }),
  Schema.Struct({ kind: Schema.Literal("parked"), since: Schema.Number, checks: Schema.Number, parkedAt: Schema.Number }),
]);
const SubmitInput = Schema.Struct({ executionId: Schema.String, signature: Schema.String });

// ── shared touches ──────────────────────────────────────────────────────────────────────────

/** Every public row: no session, input that does not decode, or a defect (operations.ts:45, operation.ts:54). */
const CALL_ERRORS = [error_NOT_AUTHENTICATED, error_INVALID_INPUT, error_UNKNOWN, error_ENV_MISSING];

/** `SUBMIT` (operations.ts:94): CALL, DEFECTS, ACCOUNT, DENIED, STATE, CHAIN, ANSWER, RACE, DISABLED. */
const SUBMIT_ERRORS = [
  ...CALL_ERRORS,
  error_SMART_ACCOUNT_MISSING,
  error_ACCOUNT_NOT_FOUND,
  error_ROLE_PERMISSION_DENIED,
  error_WRONG_STATE,
  error_PROVIDER_ERROR,
  error_PROVIDER_RESPONSE_INVALID,
  error_SUPERSEDED,
  error_NOT_IMPLEMENTED,
];

/**
 * `authorizePaymentCommandSubmissionInTx` (guards/authority.ts:172): re-proves the caller's authority over a
 * Payment command by its route (account, owner lifecycle, Owners' birth, Budget, Organization, void).
 */
const AUTHORITY_INVOKES = [
  procedure_accounts_require_payment_account_in_tx,
  procedure_permissions_require_organization_spend_authority_in_tx,
  procedure_organizations_read_organization_safe_in_tx,
  procedure_organizations_read_owner_safes_in_tx,
  procedure_permissions_find_command_authority,
  procedure_permissions_read_worn_allowances_in_tx,
  procedure_payroll_read_department_spend_in_tx,
];
const AUTHORITY_WAS = [
  `${SRC}/guards/authority.ts:1`,
  `${SRC}/guards/authority.ts:3`,
  `${SRC}/guards/authority.ts:172`,
  `${SRC}/guards/budgets.ts:10`,
  `${SRC}/guards/budgets.ts:11`,
  `${SRC}/guards/budgets.ts:12`,
  `${SRC}/guards/owners.ts:8`,
  `${SRC}/guards/owner-approvals.ts:9`,
];

/** `executionStepAnnotated` (events.ts:98): the step's wide Log joins its approval, command and Payments. */
const STEP_READS = [table_money_executions, table_payment_commands, table_payments];
const STEP_INVOKES = [procedure_accounts_read_execution_approval_in_tx];
const STEP_WAS = [
  `${EX}/events.ts:98`,
  `${SRC}/commands/reads/contexts.ts:32`,
  `${SRC}/commands/reads/contexts.ts:59`,
  `${SRC}/commands/reads/contexts.ts:65`,
];

/**
 * `paymentResponsesForCommandIdInTx` (reads/payments.ts:222) and the wire Payment projection
 * (`toWirePayment`, views/payments.ts:198; recipients, views/recipients.ts) the completed send answers with.
 */
const WIRE_READS = [
  table_payments,
  table_payment_commands,
  table_payment_schedules,
  table_money_executions,
  table_provider_send_attempts,
  table_accounts,
  table_identities,
  table_orgs,
  table_counterparty_destinations,
];
const WIRE_INVOKES = [
  procedure_accounts_account_id_for_auth_user_or_null,
  procedure_documents_load_payment_documents_for_principal,
  procedure_documents_current_payment_documents,
  procedure_books_book_asset_by_id_in_tx,
  procedure_banking_read_payout_delivery_in_tx,
  procedure_parties_party_by_id,
  procedure_parties_party_by_safe_address,
];
const WIRE_WAS = [
  `${SRC}/reads/payments.ts:9`,
  `${SRC}/reads/payments.ts:10`,
  `${SRC}/reads/payments.ts:222`,
  `${SRC}/views/payments.ts:17`,
  `${SRC}/views/payments.ts:18`,
  `${SRC}/views/payments.ts:25`,
  `${SRC}/views/payments.ts:198`,
  `${SRC}/views/recipients.ts:8`,
  `${SRC}/views/recipients.ts:75`,
  `${SRC}/views/recipients.ts:80`,
  `${SRC}/views/recipients.ts:88`,
  `${SRC}/views/recipients.ts:109`,
];

/** What the one Attempt writer (`writeAttemptInTx`, writes/attempts.ts:56) and the pure core accept (rules/attempts.ts:141). */
const ATTEMPT_WAS = [`${EX}/writes/attempts.ts:56`, `${SRC}/rules/attempts.ts:141`, `${SRC}/tables/executions.ts:28`];

/** `recordPaymentCommandOutcome(…, "failed")` (writes/outcomes.ts:16): fails the command and each Payment. */
const FAILED_OUTCOME_WAS = [
  `${SRC}/writes/outcomes.ts:16`,
  `${SRC}/writes/outcomes.ts:40`,
  `${SRC}/writes/outcomes.ts:98`,
  `${SRC}/writes/outcomes.ts:108`,
  `${SRC}/writes/outcomes.ts:109`,
  `${SRC}/rules/transitions.ts:182`,
  `${SRC}/events/writer.ts:72`,
];

/** The chain proof one Attempt is classified from (external/attempts.ts:56). */
const PROOF_CALLS = [
  integration_chain_rpc.c.fetchUserOperationReceipt,
  integration_chain_rpc.c.fetchEntryPointNonce,
  integration_chain_rpc.c.fetchEntryPointUserOperationEvent,
];

// ── public rows ─────────────────────────────────────────────────────────────────────────────

const SEND_ABOUT =
  "It names the execution on the wide event (`payments.commands.load-execution-context`; another's is INVALID_INPUT). " +
  "`scheduledSubmitted` loads the execution (`payments.executions.load`); a Payment one whose stored operation carries " +
  "a scheduled window (ADR-0034) has its signature checked (`signedOperation`: the operation re-hashes to the stored " +
  "digest and recovers the stored signer; one the Safe itself signs must be approved-hash `v=1` signatures), its " +
  "funding read (`payments.schedules.load-command`, Roles allowance, ERC-20 balances) and the signature stored for its " +
  "date (`payments.schedules.store`), with no send. Otherwise `sentExecution` loads and checks it the same way. A " +
  "prepared Attempt whose sponsorship lapsed is classified (`payments.executions.classify`), SUPERSEDED " +
  "when that writes. The preflight reads the latest block (scan floor), then the EntryPoint nonce: a moved lane " +
  "classifies the Attempt (on its own lane, `payments.executions.reset-claim` records `own_lane_advanced` when nothing " +
  "was written) and refuses SUPERSEDED; a lapsed window refuses SUPERSEDED. `payments.executions.claim` claims it; a " +
  "row refused before dispatch answers that refusal, an accepted one goes to completion. A claim it did not win is " +
  "never sent: it completes when the bundler holds the hash (`eth_getUserOperationByHash`), else SUPERSEDED. One " +
  "`eth_sendUserOperation`, each leaving a `providerSendAttempts` row (`payments.executions.record-send-attempt`). A " +
  "refused send is not proof (D3): if the bundler lacks the hash the Attempt stays `sending` for the sweep and the " +
  "refusal is the answer. `payments.executions.complete` records the acceptance and re-proves no authority. A " +
  "Permission or invitation execution is claimed and sent, then refused INVALID_INPUT by complete. Calldata was fixed " +
  "at prepare: `chain` holds only eth_call reads.";

const SEND_WAS = [
  `${EX}/external/sends.ts:63`,
  `${EX}/external/sends.ts:98`,
  `${EX}/external/sends.ts:106`,
  `${EX}/external/sends.ts:115`,
  `${EX}/external/sends.ts:126`,
  `${EX}/external/sends.ts:128`,
  `${EX}/external/sends.ts:134`,
  `${EX}/external/sends.ts:136`,
  `${EX}/external/sends.ts:145`,
  `${EX}/external/sends.ts:146`,
  `${EX}/external/sends.ts:151`,
  `${EX}/external/sends.ts:162`,
  `${EX}/external/sends.ts:248`,
  `${EX}/external/sends.ts:262`,
  `${EX}/external/preflights.ts:54`,
  `${EX}/external/preflights.ts:64`,
  `${EX}/external/preflights.ts:66`,
  `${EX}/external/preflights.ts:88`,
  `${EX}/external/preflights.ts:110`,
  `${EX}/external/expiries.ts:59`,
  `${EX}/external/expiries.ts:74`,
  `${EX}/external/witnesses.ts:16`,
  `${EX}/errors.ts:160`,
  `${EX}/writes/claims.ts:103`,
  `${EX}/writes/acceptances.ts:34`,
  `${EX}/writes/transactions.ts:41`,
  `${SRC}/writes/ledger.ts:86`,
  `${SRC}/schedules/external.ts:107`,
  `${SRC}/schedules/external.ts:114`,
  `${SRC}/schedules/external.ts:119`,
  `${SRC}/schedules/external.ts:123`,
  `${SRC}/schedules/external.ts:282`,
  `${SRC}/schedules/writes.ts:44`,
  `${SRC}/schedules/writes.ts:67`,
  `${SRC}/commands/external/funding.ts:48`,
  `${SRC}/commands/external/funding.ts:65`,
  `${SRC}/commands/external/funding.ts:99`,
  `${EX}/external/funding.ts:27`,
  `${SRC}/commands/reads/contexts.ts:80`,
  `${SRC}/commands/reads/contexts.ts:167`,
  `${BACKEND}/src/platform/session.ts:24`,
  `${BACKEND}/src/platform/execute.ts:273`,
  `${BACKEND}/src/integrations/chain-rpc/internal/requests.ts:79`,
  `${BACKEND}/src/integrations/chain-rpc/internal/requests.ts:255`,
];

/**
 * What the internal steps a send runs read, write and drive: claim, classify, reset-claim, record-send-attempt,
 * complete, and on the scheduled branch schedules.load-command and schedules.store.
 */
const SEND_READS = [...WIRE_READS];
const SEND_WRITES = [
  table_money_executions,
  table_provider_send_attempts,
  table_payment_commands,
  table_payments,
  table_payment_schedules,
];
const SEND_DRIVES = [
  machine_money_execution.t.to_sending,
  machine_money_execution.t.to_sent,
  machine_money_execution.t.to_expired,
  machine_money_execution.t.to_displaced,
  machine_money_execution.t.to_succeeded,
  machine_money_execution.t.to_reverted,
  machine_payment.t.to_settling,
  machine_payment.t.to_pending,
  machine_payment.t.to_failed,
  machine_payment_command.t.to_submitted,
  machine_payment_command.t.to_prepared,
  machine_payment_command_verification.t.to_scheduled,
  machine_payment_command_verification.t.to_not_started,
  machine_payment_schedule.t.to_waiting,
];
const SEND_INVOKES = [
  procedure_access_require_authenticated_user,
  ...STEP_INVOKES,
  ...AUTHORITY_INVOKES,
  procedure_permissions_authorize_permission_execution_in_tx,
  procedure_permissions_authorize_invitation_configuration_execution_in_tx,
  procedure_banking_accept_payout_quote_in_tx,
  procedure_banking_payout_send_failed_in_tx,
  procedure_payroll_advance_runs_to_authorized,
  procedure_permissions_read_budget_allowance_in_tx,
  procedure_documents_load_payment_documents,
  ...WIRE_INVOKES,
];
const SEND_CALLS = [
  integration_chain_rpc.c.fetchLatestBlockNumber,
  integration_chain_rpc.c.fetchEntryPointNonce,
  integration_chain_rpc.c.hasUserOperationByHash,
  integration_chain_rpc.c.sendUserOperation,
  integration_chain_rpc.c.fetchUserOperationReceipt,
  integration_chain_rpc.c.fetchEntryPointUserOperationEvent,
  integration_chain_rpc.c.fetchEthCall,
  integration_chain_rpc.c.fetchLatestBlock,
  integration_chain_rpc.c.fetchErc20Balance,
];
/** Contract reads a send makes over eth_call: the lane nonce, and a scheduled payment's Roles allowance and balances. */
const SEND_CHAIN = [contract_entry_point.f.getNonce, contract_roles.f.allowances, contract_erc20.f.balanceOf];
const SEND_SPANS = [
  "convex.query",
  "convex.mutation",
  "chain.read eth_blockNumber",
  "chain.read eth_call",
  "chain.read eth_getUserOperationByHash",
  "chain.read eth_getUserOperationReceipt",
  "chain.read eth_getLogs",
  "chain.read eth_sendUserOperation",
  "chain.read eth_getBlockByNumber",
  "chain.attempt <upstream>",
];

export const rpc_payments_executions_submit = defineRpc({
  id: "payments.executions.submit",
  title: "Send a personal Payment's signed execution, once",
  about:
    "Public action `payments/executions:submit` (row `executions.submit`); the caller signs in. " +
    SEND_ABOUT +
    " It answers the one Payment; any other count is a defect.",
  was: [
    `${CONVEX}:19`,
    `${EX}/operations/submit.ts:16`,
    `${EX}/operations/submit.ts:21`,
    `${EX}/operations/submit.ts:23`,
    `${EX}/operations/submit.ts:29`,
    `${EX}/operations/submit.ts:32`,
    `${EX}/views/submissions.ts:34`,
    `${PROTOCOL}/operations.ts:214`,
    `${PROTOCOL}/schema/executions.ts:111`,
    `${PROTOCOL}/schema/executions.ts:143`,
    ...SEND_WAS,
  ],
  concept: concept_payments,
  kind: "action",
  who:
    "A signed-in person who owns the execution (`authUserId` matches) and who still holds authority over its command, " +
    "re-proved only inside the claim; the completion checks only that the command's originating sender is the caller.",
  input: SubmitInput,
  output: Schema.Struct({
    executionId: Schema.String,
    commandId: Schema.String,
    userOpHash: Schema.String,
    payment: WirePayment,
  }),
  errors: SUBMIT_ERRORS,
  reads: SEND_READS,
  writes: SEND_WRITES,
  drives: SEND_DRIVES,
  invokes: SEND_INVOKES,
  emits: [event_payment_transitioned, event_payout_transitioned],
  calls: SEND_CALLS,
  chain: SEND_CHAIN,
  spans: SEND_SPANS,
});

export const rpc_payments_executions_submit_command = defineRpc({
  id: "payments.executions.submit-command",
  title: "Send any prepared command's signed execution, once",
  about:
    "Public action `payments/executions:submitCommand` (row `executions.submitCommand`): submit's recipe, answering " +
    "every Payment in the command's saved order. " +
    SEND_ABOUT,
  was: [
    `${CONVEX}:18`,
    `${EX}/operations/submit-command.ts:16`,
    `${EX}/operations/submit-command.ts:21`,
    `${EX}/operations/submit-command.ts:23`,
    `${EX}/operations/submit-command.ts:29`,
    `${EX}/operations/submit-command.ts:32`,
    `${EX}/operations/submit-command.ts:35`,
    `${EX}/views/submissions.ts:30`,
    `${PROTOCOL}/operations.ts:221`,
    `${PROTOCOL}/schema/executions.ts:143`,
    `${PROTOCOL}/schema/executions.ts:161`,
    ...SEND_WAS,
  ],
  concept: concept_payments,
  kind: "action",
  who:
    "A signed-in person who owns the execution (`authUserId` matches) and who still holds authority over its command, " +
    "re-proved only inside the claim; the completion checks only that the command's originating sender is the caller.",
  input: SubmitInput,
  output: Schema.Struct({
    executionId: Schema.String,
    commandId: Schema.String,
    userOpHash: Schema.String,
    payments: Schema.Array(WirePayment),
  }),
  errors: SUBMIT_ERRORS,
  reads: SEND_READS,
  writes: SEND_WRITES,
  drives: SEND_DRIVES,
  invokes: SEND_INVOKES,
  emits: [event_payment_transitioned, event_payout_transitioned],
  calls: SEND_CALLS,
  chain: SEND_CHAIN,
  spans: SEND_SPANS,
});

export const rpc_payments_executions_abandon = defineRpc({
  id: "payments.executions.abandon",
  title: "Close a prepared execution the signer refused or the caller dropped",
  about:
    "Public action `payments/executions:abandon`, the protocol row `executions.abandon`. The caller signs in; the wide " +
    "event is attributed to the execution through `payments.commands.load-execution-context` (INVALID_INPUT for another " +
    "person's execution) and annotated with `reason_code` (`signer_rejected`, `cancelled` or `prepared_mismatch`). It " +
    "runs `payments.executions.fail` with `expectedState: \"prepared\"` and that reason: a Payment execution fails its " +
    "whole command and each Payment; a Permission or invitation execution is closed unsent (`preDispatchOutcome: " +
    "signer_refused`). It answers false when the execution is no longer prepared, was already refused before dispatch, " +
    "or its Payment command already ended or was applied. A sent operation is never failed here: only proof ends it " +
    "(D3). The protocol row declares no WRONG_STATE: a moved execution is `false`, not a refusal.",
  was: [
    `${CONVEX}:3`,
    `${EX}/operations/abandon.ts:12`,
    `${EX}/operations/abandon.ts:16`,
    `${EX}/operations/abandon.ts:17`,
    `${EX}/operations/abandon.ts:18`,
    `${EX}/operations/abandon.ts:20`,
    `${EX}/writes/transactions.ts:29`,
    `${EX}/writes/transactions.ts:51`,
    `${SRC}/commands/reads/contexts.ts:80`,
    `${SRC}/commands/reads/contexts.ts:167`,
    `${SRC}/writes/outcomes.ts:27`,
    `${PROTOCOL}/operations.ts:228`,
    `${PROTOCOL}/schema/executions.ts:152`,
    `${BACKEND}/src/platform/session.ts:24`,
    `${BACKEND}/src/platform/execute.ts:273`,
  ],
  concept: concept_payments,
  kind: "action",
  who:
    "A signed-in person who owns the execution. For a Payment execution the fail step re-proves their authority over " +
    "the command; for a Permission or invitation execution ownership is the only check.",
  input: Schema.Struct({
    executionId: Schema.String,
    reason: Schema.Literals(["signer_rejected", "cancelled", "prepared_mismatch"]),
  }),
  output: Schema.Boolean,
  errors: [...CALL_ERRORS, error_ROLE_PERMISSION_DENIED],
  reads: [table_money_executions, table_payment_commands, table_payments],
  writes: [table_money_executions, table_payment_commands, table_payments],
  drives: [machine_payment.t.to_failed],
  invokes: [procedure_access_require_authenticated_user, ...AUTHORITY_INVOKES, procedure_banking_payout_send_failed_in_tx],
  emits: [event_payment_transitioned, event_payout_transitioned],
  calls: [],
  chain: [],
  spans: ["convex.query", "convex.mutation"],
});

export const rpc_payments_executions_read_send_witness = defineRpc({
  id: "payments.executions.read-send-witness",
  title: "Read the provider sends one command attempted in a window (e2e)",
  about:
    "Public query `payments/executions:readSendWitness`, the protocol row `executions.readSendWitness`. It takes no " +
    "session: the only guard is the deployment's reserved e2e auth gate (`e2eAuthVerdict(SITE_URL)` must be " +
    "`enabled`), else NOT_AUTHENTICATED. A window that ends before it starts, or a command id no `paymentCommands` row " +
    "owns, is INVALID_INPUT. It reads at most 65 `providerSendAttempts` rows of the command inside the window (index " +
    "`by_command_attempt`), answers the first 64 oldest first with `complete: false` when there were more, the " +
    "command's Payment ids, and `backendOrigin` from `CONVEX_CLOUD_URL` (ENV_MISSING when unset). A reply that does not " +
    "decode against `SendWitnessSchema` is an invariant defect. Reliability scenario A07 (#1977) counts sends with it.",
  was: [
    `${CONVEX}:13`,
    `${EX}/operations/read-send-witness.ts:10`,
    `${EX}/operations/read-send-witness.ts:12`,
    `${EX}/guards.ts:11`,
    `${EX}/reads/witnesses.ts:14`,
    `${EX}/reads/witnesses.ts:16`,
    `${EX}/reads/witnesses.ts:27`,
    `${EX}/reads/witnesses.ts:36`,
    `${EX}/views/witnesses.ts:14`,
    `${EX}/views/witnesses.ts:28`,
    `${SRC}/reads/participants.ts:74`,
    `${BACKEND}/src/access/sessions/rules.ts:126`,
    `${PROTOCOL}/operations.ts:235`,
    `${PROTOCOL}/witness-schema.ts:12`,
    `${PROTOCOL}/witness-schema.ts:29`,
  ],
  concept: concept_payments,
  kind: "query",
  who:
    "Anyone, signed in or not, on a deployment whose reserved e2e auth gate is enabled; refused everywhere else. It " +
    "grants no proof access.",
  input: Schema.Struct({ commandId: Schema.String, observedFromMs: Schema.Number, observedThroughMs: Schema.Number }),
  output: Schema.Struct({
    commandId: Schema.String,
    paymentIds: Schema.Array(Schema.String),
    backendOrigin: Schema.String,
    observedFromMs: Schema.Number,
    observedThroughMs: Schema.Number,
    complete: Schema.Boolean,
    attempts: Schema.Array(
      Schema.Struct({
        executionId: Schema.String,
        chainId: Schema.Number,
        userOpSenderSafe: Schema.String,
        nonce: Schema.String,
        attemptedAtMs: Schema.Number,
        returnedUserOpHash: Schema.NullOr(Schema.String),
        errorCode: Schema.NullOr(Schema.String),
      }),
    ),
  }),
  errors: CALL_ERRORS,
  reads: [table_payment_commands, table_provider_send_attempts],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

// ── internal steps ──────────────────────────────────────────────────────────────────────────

export const rpc_payments_executions_claim = defineRpc({
  id: "payments.executions.claim",
  title: "Claim an execution for its one send",
  about:
    "Internal mutation `payments/executions:claim` (`claimSubmissionInTx`). An execution that is not the caller's is " +
    "INVALID_INPUT. One already refused before dispatch, already accepted (`sent`, `succeeded`) or already `sending` " +
    "answers `claimed: false` when the hash matches, else INVALID_INPUT; any other state but `prepared` is " +
    "WRONG_STATE. Then it re-proves authority over the command: a Payment command (a failed one is INVALID_INPUT, " +
    "`requestFailed`; any other ending WRONG_STATE), a Permission command or an invitation configuration. A row whose " +
    "`preDispatchOutcome` is `own_lane_advanced` is claimed like any prepared row. A ROLE_PERMISSION_DENIED on an " +
    "unsent Attempt " +
    "is committed, not thrown: a Payment command fails with reason `role_permission_denied` (its Payments fail, a bank " +
    "payout cancels at Bridge), any other command's execution closes, and the row keeps `preDispatchOutcome: " +
    "authority_refused`. Otherwise each bank payout the command carries accepts its quote (Banking), and the Attempt " +
    "enters `sending` with its claim token, claim time, expected hash and scan floor in one write; no scan floor is " +
    "INVALID_INPUT. A refusal of a bank payout's send is reported on the claim's wide Log " +
    "(`payoutSendRefusalObserved`, CAP-738) and rolls back with it. It is never claimed back.",
  was: [
    `${CONVEX}:4`,
    `${EX}/operations/claim.ts:18`,
    `${EX}/operations/claim.ts:22`,
    `${EX}/operations/claim.ts:25`,
    `${EX}/operations/claim.ts:35`,
    `${EX}/writes/claims.ts:45`,
    `${EX}/writes/claims.ts:89`,
    `${EX}/writes/claims.ts:101`,
    `${EX}/writes/claims.ts:102`,
    `${EX}/writes/claims.ts:109`,
    `${EX}/writes/claims.ts:127`,
    `${EX}/writes/claims.ts:139`,
    `${EX}/writes/claims.ts:145`,
    `${EX}/writes/claims.ts:153`,
    `${EX}/writes/claims.ts:159`,
    `${EX}/writes/claims.ts:167`,
    `${EX}/writes/claims.ts:171`,
    `${EX}/writes/claims.ts:181`,
    `${EX}/writes/claims.ts:182`,
    `${EX}/writes/claims.ts:183`,
    `${EX}/writes/refusals.ts:18`,
    `${EX}/writes/refusals.ts:35`,
    `${EX}/writes/refusals.ts:47`,
    `${EX}/reads/executions.ts:84`,
    `${SRC}/guards/payouts.ts:10`,
    `${SRC}/commands/errors.ts:18`,
    `${EX}/errors.ts:13`,
    `${SRC}/commands/writes/links.ts:173`,
    `${SRC}/commands/writes/submissions.ts:179`,
    ...ATTEMPT_WAS,
    ...AUTHORITY_WAS,
    ...FAILED_OUTCOME_WAS,
    ...STEP_WAS,
  ],
  concept: concept_payments,
  kind: "mutation",
  who:
    "internal: the send path `submitStoredExecution` (external/sends.ts:128), run by submit, submit-command, the " +
    "scheduled due job (schedules/external.ts:156), a Board-approved schedule (schedules/operations/store-approved.ts:68) " +
    "and Permissions' own sends (permissions/external.ts:99).",
  input: Schema.Struct({ ...ClaimFields, sentBlock: Schema.optionalKey(Schema.Number) }),
  output: Schema.Struct({ execution: MoneyExecutionRow, claimed: Schema.Boolean }),
  errors: [
    error_INVALID_INPUT,
    error_WRONG_STATE,
    error_NOT_IMPLEMENTED,
    error_ROLE_PERMISSION_DENIED,
    error_SMART_ACCOUNT_MISSING,
    error_ACCOUNT_NOT_FOUND,
  ],
  reads: [table_money_executions, table_provider_send_attempts, table_payment_commands, table_payments],
  writes: [table_money_executions, table_payment_commands, table_payments],
  drives: [machine_money_execution.t.to_sending, machine_payment.t.to_failed],
  invokes: [
    ...STEP_INVOKES,
    ...AUTHORITY_INVOKES,
    procedure_permissions_authorize_permission_execution_in_tx,
    procedure_permissions_authorize_invitation_configuration_execution_in_tx,
    procedure_banking_accept_payout_quote_in_tx,
    procedure_banking_payout_send_failed_in_tx,
  ],
  emits: [event_payment_transitioned, event_payout_transitioned],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_payments_executions_classify = defineRpc({
  id: "payments.executions.classify",
  title: "Classify a Payment Attempt from chain proof",
  about:
    "Internal mutation `payments/executions:classify` (`classifyPaymentAttemptInTx`). It takes the proof an action " +
    "read (receipt, the EntryPoint event that consumed the nonce, the lane) and re-decides it with the one core " +
    "classifier. A row that moved since the read (state, hash, or a sending claim token) or an outcome this path does " +
    "not record from that state writes nothing: prepared records expired or displaced; sending expired, displaced or " +
    "reverted; sent expired (and displaced, for a Permission or invitation Attempt); expired succeeded or reverted. A " +
    "displacement on the command's own Payment lane binds the command to the sibling operation that landed (that " +
    "sibling succeeds or reverts, the command is `submitted` again, its Payments `settling` and `included`, " +
    "verification scheduled) or writes nothing (#2404, CAP-701); an expired Payment Attempt whose own hash landed binds " +
    "the same way. Otherwise the Attempt writer records the outcome and a Payment command reacts: expired retires the " +
    "command to `prepared` and its settling Payments to `pending`; displaced supersedes it (`stale_nonce`); reverted " +
    "fails it (`user_operation_reverted`); a succeeded Attempt schedules `payments.verifications.settle`. A command " +
    "that already ended keeps its ending. Answers `{ outcome, written }`.",
  was: [
    `${CONVEX}:5`,
    `${EX}/operations/classify.ts:12`,
    `${EX}/operations/classify.ts:21`,
    `${EX}/writes/classifications.ts:49`,
    `${EX}/writes/classifications.ts:80`,
    `${EX}/writes/classifications.ts:93`,
    `${EX}/writes/classifications.ts:117`,
    `${EX}/writes/classifications.ts:159`,
    `${EX}/writes/classifications.ts:185`,
    `${EX}/writes/classifications.ts:193`,
    `${EX}/writes/classifications.ts:202`,
    `${EX}/writes/classifications.ts:207`,
    `${EX}/writes/classifications.ts:210`,
    `${EX}/writes/classifications.ts:221`,
    `${EX}/writes/classifications.ts:239`,
    `${EX}/writes/classifications.ts:266`,
    `${SRC}/commands/writes/bindings.ts:88`,
    `${SRC}/commands/writes/bindings.ts:112`,
    `${SRC}/commands/writes/bindings.ts:116`,
    `${SRC}/commands/writes/bindings.ts:124`,
    `${SRC}/commands/writes/bindings.ts:139`,
    `${SRC}/commands/writes/links.ts:137`,
    `${SRC}/commands/writes/links.ts:188`,
    `${SRC}/commands/writes/links.ts:207`,
    `${SRC}/commands/writes/links.ts:215`,
    `${SRC}/commands/writes/links.ts:222`,
    `${SRC}/commands/writes/links.ts:225`,
    `${SRC}/verifications/writes/schedules.ts:22`,
    `${SRC}/verifications/writes/schedules.ts:47`,
    ...ATTEMPT_WAS,
    ...FAILED_OUTCOME_WAS,
  ],
  concept: concept_payments,
  kind: "mutation",
  who:
    "internal: `attemptClassified` (external/attempts.ts:170), run by a send's preflight and lapsed-sponsorship " +
    "check, a build that reuses or replaces an active execution, a build's own-lane resolution (external/lanes.ts:118), " +
    "the claim sweep, and a payroll run's own recovery.",
  input: Schema.Struct({
    authUserId: Schema.String,
    executionId: Schema.String,
    state: Schema.Literals(["prepared", "sending", "sent", "expired"]),
    expectedUserOpHash: Schema.String,
    submissionClaimToken: Schema.optionalKey(Schema.String),
    evidence: AttemptEvidence,
  }),
  output: Schema.Struct({
    outcome: Schema.Literals(["succeeded", "reverted", "expired", "displaced", "unknown"]),
    written: Schema.Boolean,
  }),
  errors: [error_INVALID_INPUT, error_NOT_IMPLEMENTED],
  reads: [table_money_executions, table_payment_commands, table_payments],
  writes: [table_money_executions, table_payment_commands, table_payments],
  drives: [
    machine_money_execution.t.to_expired,
    machine_money_execution.t.to_displaced,
    machine_money_execution.t.to_reverted,
    machine_money_execution.t.to_succeeded,
    machine_payment.t.to_pending,
    machine_payment.t.to_settling,
    machine_payment.t.to_failed,
    machine_payment_command.t.to_prepared,
    machine_payment_command.t.to_submitted,
    machine_payment_command_verification.t.to_scheduled,
    machine_payment_command_verification.t.to_not_started,
  ],
  invokes: [procedure_banking_payout_send_failed_in_tx],
  emits: [event_payment_transitioned, event_payout_transitioned],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_payments_executions_complete = defineRpc({
  id: "payments.executions.complete",
  title: "Record the bundler's acceptance on the execution, command and Payments",
  about:
    "Internal mutation `payments/executions:complete`. `acceptPaymentExecutionInTx`: the execution must be the " +
    "caller's Payment execution (INVALID_INPUT otherwise), `sending`, `sent` or `succeeded` (else INVALID_INPUT, no " +
    "admitted submission), and the hash must match the claimed one. Only a `sending` Attempt moves: to `sent`, with " +
    "`userOpHash` and `submittedAt`. Then `completePaymentExecutionSubmissionInTx`: each Payment of the command gets " +
    "`activeExecutionId` and `executionOutcome: pending`; a command not yet `submitted` records the submission through " +
    "the Payment writer (`record_submission`: a send's `pending` Payments become `settling` with the hash; payroll " +
    "runs advance to authorized; the command becomes `submitted`, `verificationState: scheduled`; " +
    "`payments.verifications.verify` is scheduled now; a void marks its waiting schedule with `voidCommandId`). A " +
    "submitted command with another hash is INVALID_INPUT. A first acceptance schedules a `progressed` " +
    "`payment_transitioned`. Answers the command's wire Payments. It re-proves no authority: " +
    "`submitAcceptedPaymentCommandInTx` skips the authority guard its sibling `submitPaymentCommandInTx` runs, and the " +
    "only owner check is the command's `originatingAuthUserId`; the ROLE_PERMISSION_DENIED, SMART_ACCOUNT_MISSING and " +
    "ACCOUNT_NOT_FOUND it admits come from no path in it. Money writes switched off are NOT_IMPLEMENTED.",
  was: [
    `${CONVEX}:6`,
    `${EX}/operations/complete.ts:15`,
    `${EX}/operations/complete.ts:19`,
    `${EX}/operations/complete.ts:25`,
    `${EX}/operations/complete.ts:34`,
    `${EX}/writes/acceptances.ts:22`,
    `${EX}/writes/acceptances.ts:38`,
    `${EX}/writes/acceptances.ts:54`,
    `${EX}/writes/acceptances.ts:55`,
    `${SRC}/commands/writes/submissions.ts:87`,
    `${SRC}/commands/writes/submissions.ts:117`,
    `${SRC}/commands/writes/submissions.ts:169`,
    `${SRC}/writes/ledger.ts:71`,
    `${SRC}/writes/ledger.ts:86`,
    `${SRC}/writes/ledger.ts:91`,
    `${SRC}/verifications/writes/submissions.ts:139`,
    `${SRC}/verifications/writes/submissions.ts:47`,
    `${SRC}/verifications/writes/submissions.ts:122`,
    `${SRC}/verifications/writes/submissions.ts:131`,
    `${SRC}/verifications/writes/submissions.ts:136`,
    `${SRC}/verifications/writes/submissions.ts:143`,
    `${SRC}/verifications/writes/submissions.ts:144`,
    `${SRC}/verifications/writes/schedules.ts:22`,
    `${SRC}/verifications/writes/voids.ts:33`,
    `${SRC}/rules/transitions.ts:160`,
    `${SRC}/events/writer.ts:62`,
    ...ATTEMPT_WAS,
    ...WIRE_WAS,
    ...STEP_WAS,
  ],
  concept: concept_payments,
  kind: "mutation",
  who:
    "internal: `submissionCompleted` (writes/transactions.ts:41) after a send or a resend, and the claim sweep; " +
    "also Payroll's run send (payroll/runs/writes/attempts.ts:62), the Accounts approval send " +
    "(accounts/approvals/operations/send-approved.ts:273) and a settled replay (external/replays.ts:26).",
  input: Schema.Struct({ authUserId: Schema.String, executionId: Schema.String, userOpHash: Schema.String }),
  output: Schema.Array(WirePayment),
  errors: [
    error_INVALID_INPUT,
    error_NOT_IMPLEMENTED,
    error_ROLE_PERMISSION_DENIED,
    error_SMART_ACCOUNT_MISSING,
    error_ACCOUNT_NOT_FOUND,
  ],
  reads: WIRE_READS,
  writes: [table_money_executions, table_payment_commands, table_payments, table_payment_schedules],
  drives: [
    machine_money_execution.t.to_sent,
    machine_payment.t.to_settling,
    machine_payment_command.t.to_submitted,
    machine_payment_command_verification.t.to_scheduled,
  ],
  invokes: [...STEP_INVOKES, procedure_payroll_advance_runs_to_authorized, ...WIRE_INVOKES],
  emits: [event_payment_transitioned],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_payments_executions_fail = defineRpc({
  id: "payments.executions.fail",
  title: "Fail a prepared Payment execution's command, or close an unsent one",
  about:
    "Internal mutation `payments/executions:fail`. The execution must be the caller's (INVALID_INPUT). It answers " +
    "false, writing nothing, unless the execution is still in the expected state (`prepared`) and was not already " +
    "refused before dispatch. A Permission or invitation execution is closed unsent: it keeps `prepared` and records " +
    "`preDispatchOutcome: signer_refused`, which frees the sender's lane and the command's slot (CAP-790 B). A Payment " +
    "execution re-proves the caller's authority over its command, then fails the whole command with the reason code " +
    "(and cause properties): each `pending` or `settling` Payment becomes `failed` (a failed void leaves its Payment " +
    "waiting), `executionOutcome: failed`, a bank payout cancels at Bridge, a `failed` `payment_transitioned` is " +
    "scheduled per failed Payment; the command records `completionOutcome: failed`. A command that already ended or " +
    "was applied answers false.",
  was: [
    `${CONVEX}:7`,
    `${EX}/operations/fail.ts:19`,
    `${EX}/operations/fail.ts:20`,
    `${EX}/operations/fail.ts:32`,
    `${EX}/operations/fail.ts:34`,
    `${EX}/operations/fail.ts:36`,
    `${EX}/writes/acceptances.ts:76`,
    `${EX}/writes/acceptances.ts:99`,
    `${SRC}/commands/writes/submissions.ts:179`,
    `${SRC}/commands/writes/submissions.ts:210`,
    `${SRC}/executions/writes/lifecycles.ts:41`,
    ...FAILED_OUTCOME_WAS,
    ...AUTHORITY_WAS,
  ],
  concept: concept_payments,
  kind: "mutation",
  who: "internal: `executionFailed` (writes/transactions.ts:51), run only by `payments.executions.abandon`.",
  input: Schema.Struct({
    authUserId: Schema.String,
    executionId: Schema.String,
    reasonCode: Schema.String,
    causeProps: Schema.optionalKey(Schema.Unknown),
    expectedState: Schema.Literal("prepared"),
  }),
  output: Schema.Boolean,
  errors: [error_INVALID_INPUT, error_ROLE_PERMISSION_DENIED],
  reads: [table_money_executions, table_payment_commands, table_payments],
  writes: [table_money_executions, table_payment_commands, table_payments],
  drives: [machine_payment.t.to_failed],
  invokes: [...AUTHORITY_INVOKES, procedure_banking_payout_send_failed_in_tx],
  emits: [event_payment_transitioned, event_payout_transitioned],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_payments_executions_hold_claim = defineRpc({
  id: "payments.executions.hold-claim",
  title: "Space out or park the sweep's next check of a kept Attempt",
  about:
    "Internal mutation `payments/executions:holdClaim` (`holdKeptAttemptInTx`, CAP-876). The claim sweep read every " +
    "proof of a lapsed Attempt after its window and grace closed and still nothing ends it. A row whose state or " +
    "expected hash moved since the read answers null. Otherwise it records one more check in `recoveryHold` " +
    "(`backing_off` with the next check time, or `parked` after a day) and the hold's due time in `recoveryCheckAt` " +
    "(null once parked), the sweep's index key (CAP-902). The Attempt's state and its command never change for it. An " +
    "unknown execution is INVALID_INPUT.",
  was: [
    `${CONVEX}:8`,
    `${EX}/operations/hold-claim.ts:12`,
    `${EX}/operations/hold-claim.ts:21`,
    `${EX}/writes/holds.ts:13`,
    `${EX}/writes/holds.ts:31`,
    `${EX}/writes/holds.ts:36`,
    `${EX}/writes/holds.ts:43`,
    `${SRC}/tables/executions.ts:72`,
    `${SRC}/tables/executions.ts:91`,
  ],
  concept: concept_payments,
  kind: "mutation",
  who: "internal: `claimKept` in the claim sweep (external/recoveries.ts:66).",
  input: Schema.Struct({
    authUserId: Schema.String,
    executionId: Schema.String,
    state: SweepState,
    expectedUserOpHash: Schema.String,
  }),
  output: Schema.NullOr(RecoveryHold),
  errors: [error_INVALID_INPUT],
  reads: [table_money_executions],
  writes: [table_money_executions],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_payments_executions_list_expired_claims = defineRpc({
  id: "payments.executions.list-expired-claims",
  title: "Read one page of Attempts whose sponsorship lapsed",
  about:
    "Internal query `payments/executions:listExpiredClaims` (`listExpiredClaimsInTx`). One page of up to 100 " +
    "`moneyExecutions` in `state` (default `sending`) through `by_state_recovery_expiry`: with `held`, the rows whose " +
    "`recoveryCheckAt` is due by `cutoff`; without, the rows with no `recoveryCheckAt` whose `sponsorshipValidUntil` is " +
    "at or before it (no recorded sponsorship sorts first and counts as lapsed; a hold recorded before that index key " +
    "existed still arrives here). A sent Payment Attempt is dropped (its " +
    "verification lease owns it); a hold not yet due or parked is dropped. Each sent Permission or invitation row " +
    "carries its command's verification outcome, read from Permissions. Answers Convex's pagination result.",
  was: [
    `${CONVEX}:9`,
    `${EX}/operations/list-expired-claims.ts:12`,
    `${EX}/operations/list-expired-claims.ts:26`,
    `${EX}/reads/executions.ts:148`,
    `${EX}/reads/executions.ts:159`,
    `${EX}/reads/executions.ts:163`,
    `${EX}/reads/executions.ts:177`,
    `${EX}/reads/executions.ts:180`,
    `${EX}/reads/executions.ts:185`,
    `${SRC}/tables/executions.ts:98`,
  ],
  concept: concept_payments,
  kind: "query",
  who: "internal: `expiredClaims` in the claim sweep (reads/executions.ts:200).",
  input: Schema.Struct({
    cursor: Schema.optionalKey(Schema.String),
    state: Schema.optionalKey(SweepState),
    held: Schema.optionalKey(Schema.Boolean),
    cutoff: Schema.Number,
  }),
  output: Schema.Struct({
    page: Schema.Array(MoneyExecutionRow),
    isDone: Schema.Boolean,
    continueCursor: Schema.String,
  }),
  errors: [],
  reads: [table_money_executions],
  writes: [],
  drives: [],
  invokes: [procedure_permissions_read_permission_execution_outcome_in_tx],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_payments_executions_load_active = defineRpc({
  id: "payments.executions.load-active",
  title: "Load a command's live or settled execution for its owner",
  about:
    "Internal query `payments/executions:loadActive` (`loadActiveExecutionInTx`). Every `moneyExecutions` row of the " +
    "command (`by_command`) owned by the caller that is active, or, for a Payment command, `succeeded`. Null when none; " +
    "more than one is a broken stored row (a defect: `attempt([])` admits no code).",
  was: [
    `${CONVEX}:10`,
    `${EX}/operations/load-active.ts:12`,
    `${EX}/operations/load-active.ts:28`,
    `${EX}/reads/executions.ts:21`,
    `${EX}/reads/executions.ts:35`,
    `${EX}/reads/executions.ts:41`,
  ],
  concept: concept_payments,
  kind: "query",
  who:
    "internal: a build that reuses an execution (external/builds.ts:77, external/builds.ts:224), the Budget gate " +
    "(commands/reads/budgets.ts:66) and a Board-approved schedule (schedules/operations/store-approved.ts:56).",
  input: Schema.Struct({ commandKind: CommandKind, commandId: Schema.String, authUserId: Schema.String }),
  output: Schema.NullOr(MoneyExecutionRow),
  errors: [],
  reads: [table_money_executions],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_payments_executions_load_lane_holders = defineRpc({
  id: "payments.executions.load-lane-holders",
  title: "Load a command's stored operations at one nonce of its own lane",
  about:
    "Internal query `payments/executions:loadLaneHolders` (`loadLaneHoldersInTx`, CAP-701). The caller's Payment " +
    "executions of the command whose stored nonce equals the given one. A build on a lane that moved reads them to name " +
    "the operation that landed. Empty when the ledger holds none at that nonce.",
  was: [
    `${CONVEX}:11`,
    `${EX}/operations/load-lane-holders.ts:12`,
    `${EX}/operations/load-lane-holders.ts:20`,
    `${EX}/reads/executions.ts:52`,
  ],
  concept: concept_payments,
  kind: "query",
  who: "internal: `resolveAdvancedOwnLane` in a build (external/lanes.ts:95).",
  input: Schema.Struct({ authUserId: Schema.String, commandId: Schema.String, nonce: Schema.String }),
  output: Schema.Array(MoneyExecutionRow),
  errors: [],
  reads: [table_money_executions],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_payments_executions_load = defineRpc({
  id: "payments.executions.load",
  title: "Load one execution for its owner",
  about:
    "Internal query `payments/executions:load` (`loadExecutionInTx`). The `moneyExecutions` row by `executionId`; one " +
    "that is missing or another person's is INVALID_INPUT (`Money execution not found`).",
  was: [
    `${CONVEX}:12`,
    `${EX}/operations/load.ts:12`,
    `${EX}/operations/load.ts:17`,
    `${EX}/reads/executions.ts:69`,
  ],
  concept: concept_payments,
  kind: "query",
  who:
    "internal: the send path (external/sends.ts:106), a lane resolution (external/lanes.ts:133), a caller's own claim " +
    "recovery (external/recoveries.ts:218) and the scheduled payment path (schedules/external.ts:52).",
  input: Schema.Struct({ authUserId: Schema.String, executionId: Schema.String }),
  output: MoneyExecutionRow,
  errors: [error_INVALID_INPUT],
  reads: [table_money_executions],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_payments_executions_record_send_attempt = defineRpc({
  id: "payments.executions.record-send-attempt",
  title: "Record one provider send and what the bundler answered",
  about:
    "Internal mutation `payments/executions:recordSendAttempt` (`recordSendAttemptInTx`, #1977). Inserts one " +
    "`providerSendAttempts` row after the bundler answered: the execution, command, the command's Payment ids (read " +
    "from its `paymentCommands` row, empty when there is none), chain, sender Safe, nonce, time, and the returned hash " +
    "or the refusal's code. The money path never waits on it: a failure to record is reported as a dropped " +
    "observation (`provider_send_witness`), never a failed send. Admits no code.",
  was: [
    `${CONVEX}:14`,
    `${EX}/operations/record-send-attempt.ts:13`,
    `${EX}/operations/record-send-attempt.ts:29`,
    `${EX}/operations/record-send-attempt.ts:31`,
    `${EX}/writes/witnesses.ts:20`,
    `${EX}/writes/witnesses.ts:24`,
    `${EX}/external/witnesses.ts:16`,
    `${EX}/external/witnesses.ts:43`,
    `${SRC}/reads/participants.ts:74`,
    `${SRC}/tables/executions.ts:107`,
    ...STEP_WAS,
  ],
  concept: concept_payments,
  kind: "mutation",
  who: "internal: `recordSendAttempt` after every `eth_sendUserOperation` (external/sends.ts:162, external/sends.ts:226).",
  input: Schema.Struct({
    executionId: Schema.String,
    commandId: Schema.String,
    chainId: Schema.Number,
    userOpSenderSafe: Schema.String,
    nonce: Schema.String,
    attemptedAtMs: Schema.Number,
    returnedUserOpHash: Schema.optionalKey(Schema.String),
    errorCode: Schema.optionalKey(Schema.String),
  }),
  output: Schema.Void,
  errors: [],
  reads: [...STEP_READS],
  writes: [table_provider_send_attempts],
  drives: [],
  invokes: STEP_INVOKES,
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_payments_executions_reset_claim = defineRpc({
  id: "payments.executions.reset-claim",
  title: "Record that a Payment send found its own lane moved",
  about:
    "Internal mutation `payments/executions:resetClaim` (`resetClaimInTx`). Despite its name it releases no claim: an " +
    "Attempt is never claimed back (D3). Only with `diagnostic: own_lane_advanced`, on the caller's unsent `prepared` " +
    "Payment execution whose hash matches and that has no provider send recorded, it records `expectedUserOpHash` and " +
    "`preDispatchOutcome: own_lane_advanced` (#2404); the Attempt keeps its state. Anything else writes nothing.",
  was: [
    `${CONVEX}:16`,
    `${EX}/operations/reset-claim.ts:13`,
    `${EX}/operations/reset-claim.ts:17`,
    `${EX}/operations/reset-claim.ts:22`,
    `${EX}/writes/claims.ts:62`,
    `${EX}/writes/claims.ts:77`,
    `${EX}/writes/claims.ts:194`,
    `${EX}/reads/executions.ts:84`,
  ],
  concept: concept_payments,
  kind: "mutation",
  who: "internal: a send's preflight when the command's own lane moved and nothing classified it (external/preflights.ts:88).",
  input: Schema.Struct({ ...ClaimFields, diagnostic: Schema.optionalKey(Schema.Literal("own_lane_advanced")) }),
  output: Schema.Void,
  errors: [],
  reads: [table_money_executions, table_provider_send_attempts],
  writes: [table_money_executions],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_payments_executions_store = defineRpc({
  id: "payments.executions.store",
  title: "Store a built operation once, one live execution per command",
  about:
    "Internal mutation `payments/executions:store` (`storePreparedExecutionInTx`). The same execution id again answers " +
    "the stored row (INVALID_INPUT if it differs in owner, command, digest or operation). Another live execution of the " +
    "command answers as it stands (INVALID_INPUT if its authority differs); two are a broken row. Otherwise a Payment " +
    "command is admitted: a missing one is INVALID_INPUT; a failed one is INVALID_INPUT (`requestFailed`) after its " +
    "authority check; an ended, applied, unresolved, mismatched or `submitted` command, and an advanced own lane, are " +
    "WRONG_STATE; then the caller's authority is re-proved. The sender nonce must be free: a live holder of the lane is " +
    "WRONG_STATE naming its approval (an unsent prepared Payment Attempt of an ended command holds nothing); " +
    "an unsent holder whose sponsorship and grace lapsed is expired by the core and its Payment command superseded " +
    "(`sponsorship_expired`); a void must share its scheduled operation's nonce. Then it inserts the row `prepared` " +
    "with a lowercased sender and nonce, the command's correlation and journey, and attaches it: the command's and its " +
    "Payments' `activeExecutionId`, and a `prepared` progress `payment_transitioned`. Answers `{ execution, inserted }`.",
  was: [
    `${CONVEX}:17`,
    `${EX}/operations/store.ts:18`,
    `${EX}/operations/store.ts:45`,
    `${EX}/writes/stores.ts:28`,
    `${EX}/writes/stores.ts:33`,
    `${EX}/writes/stores.ts:42`,
    `${EX}/writes/stores.ts:57`,
    `${EX}/writes/stores.ts:58`,
    `${EX}/writes/stores.ts:67`,
    `${EX}/writes/stores.ts:78`,
    `${EX}/writes/stores.ts:85`,
    `${EX}/writes/reservations.ts:129`,
    `${EX}/writes/reservations.ts:23`,
    `${EX}/writes/reservations.ts:38`,
    `${EX}/writes/reservations.ts:54`,
    `${EX}/writes/reservations.ts:96`,
    `${EX}/writes/reservations.ts:153`,
    `${EX}/writes/reservations.ts:175`,
    `${SRC}/commands/writes/links.ts:71`,
    `${SRC}/commands/writes/links.ts:80`,
    `${SRC}/commands/writes/links.ts:81`,
    `${SRC}/commands/writes/links.ts:95`,
    `${SRC}/commands/writes/links.ts:101`,
    `${SRC}/commands/writes/links.ts:137`,
    `${SRC}/commands/writes/bindings.ts:32`,
    ...ATTEMPT_WAS,
    ...AUTHORITY_WAS,
  ],
  concept: concept_payments,
  kind: "mutation",
  who:
    "internal: a build (`buildOrReuseExecution`, `storeBuiltExecution`, external/builds.ts:153), run by Payments' " +
    "prepares, Permissions' prepares (permissions/external.ts:10) and Payroll's run (payroll/runs/external.ts:12).",
  input: Schema.Struct({
    executionId: Schema.String,
    commandKind: CommandKind,
    commandId: Schema.String,
    authUserId: Schema.String,
    chainId: Schema.Number,
    signerAddress: Schema.String,
    userOpSenderSafe: Schema.String,
    nonce: Schema.String,
    sponsorshipValidUntil: Schema.Number,
    correlationId: Schema.optionalKey(Schema.String),
    journeyId: Schema.optionalKey(Schema.String),
    originatingObservationContext: Schema.optionalKey(Schema.Unknown),
    digest: Schema.String,
    unsignedUserOpJson: Schema.String,
    expectedUserOpHash: Schema.optionalKey(Schema.String),
    preparedBlock: Schema.optionalKey(Schema.Number),
  }),
  output: Schema.Struct({ execution: MoneyExecutionRow, inserted: Schema.Boolean }),
  errors: [
    error_INVALID_INPUT,
    error_WRONG_STATE,
    error_ROLE_PERMISSION_DENIED,
    error_SMART_ACCOUNT_MISSING,
    error_ACCOUNT_NOT_FOUND,
  ],
  reads: [table_money_executions, table_payment_commands, table_payments],
  writes: [table_money_executions, table_payment_commands, table_payments],
  drives: [machine_money_execution.t.to_prepared, machine_money_execution.t.to_expired],
  invokes: [...AUTHORITY_INVOKES, procedure_accounts_read_execution_approval_in_tx],
  emits: [event_payment_transitioned],
  calls: [],
  chain: [],
  spans: [],
});

// ── the claim sweep ─────────────────────────────────────────────────────────────────────────

export const workflow_payments_executions_recover_claims = defineWorkflow({
  id: "payments.executions.recover-claims",
  title: "Sweep lapsed sending and sent Attempts and ask the chain what became of them",
  about:
    "Internal action `payments/executions:recoverClaims`. The 10-minute job `recover Payment settlement verification` " +
    "(registered only with money writes on and a V2 address) runs `payments.verifications.recover-job`, which runs this " +
    "action after the verification recovery; the action then reschedules itself with `runAfter(0)` for each sweep " +
    "whose page was full, under the same cutoff. It reads only executions whose sponsorship lapsed by the cutoff. A " +
    "sending Attempt is decided from its receipt, lane, EntryPoint event and whether the bundler holds the hash: our " +
    "landed hash or a held one is an acceptance (`payments.executions.complete` for a Payment, Permissions' own " +
    "`completeExecution` otherwise); a proven expiry, displacement or revert is classified " +
    "(`payments.executions.classify`); anything else is retained. A sent Permission or invitation Attempt whose " +
    "command applied or mismatched completes through Permissions; one still pending is classified when expired or " +
    "displaced, else Permissions' verification runs again (`verifySubmitted`, `configurations.verify`). An Attempt kept " +
    "with every proof read after its window closed backs off and after a day parks " +
    "(`payments.executions.hold-claim`); parking raises one Error Tracking issue (`claimParked`). A sent Payment " +
    "Attempt is never read: its verification lease owns it. No priority, timeout or retry is set in the code: the " +
    "timeout is Convex's action limit, and Convex does not retry an action; the next tick reads again. Child spans: " +
    "`convex.query`, `convex.mutation`, `convex.action` and the chain-rpc request spans.",
  was: [
    `${CONVEX}:15`,
    `${EX}/operations/recover-claims.ts:21`,
    `${EX}/operations/recover-claims.ts:37`,
    `${EX}/operations/recover-claims.ts:55`,
    `${EX}/operations/recover-claims.ts:56`,
    `${EX}/operations/recover-claims.ts:61`,
    `${EX}/operations/recover-claims.ts:62`,
    `${EX}/operations/recover-claims.ts:73`,
    `${EX}/operations/recover-claims.ts:82`,
    `${EX}/operations/recover-claims.ts:87`,
    `${EX}/external/recoveries.ts:62`,
    `${EX}/external/recoveries.ts:79`,
    `${EX}/external/recoveries.ts:93`,
    `${EX}/external/recoveries.ts:99`,
    `${EX}/external/recoveries.ts:144`,
    `${EX}/external/recoveries.ts:148`,
    `${EX}/external/recoveries.ts:154`,
    `${EX}/external/recoveries.ts:163`,
    `${EX}/external/recoveries.ts:190`,
    `${EX}/external/attempts.ts:56`,
    `${EX}/external/attempts.ts:170`,
    `${EX}/events.ts:22`,
    `${EX}/events.ts:39`,
    `${EX}/reads/executions.ts:200`,
    `${SRC}/verifications/operations/recover-job.ts:32`,
    `${BACKEND}/src/platform/jobs.ts:87`,
    `${BACKEND}/src/platform/jobs.ts:90`,
    `${BACKEND}/src/platform/execute.ts:273`,
  ],
  concept: concept_payments,
  priority: "critical",
  trigger: { cron: "*/10 * * * * (Convex interval, through payments.verifications.recover-job)" },
  steps: [
    { name: "attribute", about: "Records the run as the system job `payment_writer`." },
    { name: "cutoff", about: "The continuation's cutoff, or the business clock's now on a first run." },
    {
      name: "pages",
      about:
        "A first run reads four first pages (sending and sent, unheld and held) through " +
        "`payments.executions.list-expired-claims`; a continuation reads its own one sweep.",
    },
    {
      name: "recover",
      about:
        "`claimRecovered` on every row read, four at a time, each as a result: complete, classify, hold, or a " +
        "Permissions completion or verification.",
    },
    {
      name: "continue",
      about: "For each sweep whose page was not done, `runAfter(0)` itself with the page's cursor, state, held and cutoff.",
    },
    {
      name: "report",
      about:
        "After the continuations are saved, fails with the first failed entry; a run that read nothing and has no more " +
        "pages is a no-op tick (ADR-0020 B1); else answers `{ recovered, retired }`.",
    },
  ],
  reads: [...WIRE_READS],
  writes: [table_money_executions, table_payment_commands, table_payments, table_payment_schedules],
  drives: [
    machine_money_execution.t.to_sent,
    machine_money_execution.t.to_expired,
    machine_money_execution.t.to_displaced,
    machine_money_execution.t.to_reverted,
    machine_money_execution.t.to_succeeded,
    machine_payment.t.to_settling,
    machine_payment.t.to_pending,
    machine_payment.t.to_failed,
    machine_payment_command.t.to_submitted,
    machine_payment_command.t.to_prepared,
    machine_payment_command_verification.t.to_scheduled,
    machine_payment_command_verification.t.to_not_started,
  ],
  invokes: [
    procedure_permissions_read_permission_execution_outcome_in_tx,
    ...STEP_INVOKES,
    procedure_payroll_advance_runs_to_authorized,
    procedure_banking_payout_send_failed_in_tx,
    ...WIRE_INVOKES,
  ],
  emits: [event_payment_transitioned, event_payout_transitioned],
  calls: [...PROOF_CALLS, integration_chain_rpc.c.hasUserOperationByHash],
  chain: [contract_entry_point.f.getNonce],
  idempotency:
    "Every write is fenced by what the sweep read: the classifier and the hold write only while the row keeps the " +
    "state and hash read (and a sending row its claim token); a continuation keeps the first page's cutoff and cursor.",
  timeoutMs: 600000,
  retries: { max: 0, backoff: "none" },
});
