// The as-is book of the old payments concept: the schedules and lifecycles areas.
//
// Every operation registered at `payments/schedules:*` and `payments/lifecycles:*`
// (packages/backend/convex/payments/{schedules,lifecycles}.ts), as the old code does it.
// Scheduled payments (ADR-0034): the signed operation stored at submit, the due job that sends it on
// its date, the Directors' approvals and Board proposals that store or cancel one. Lifecycles: the
// next step of an existing Payment (retry, claim, cancel, redirect, reschedule), planned in one
// mutation and built in its action.
//
// No operation here opens a span of its own (`withSpan`): every chain-rpc call opens
// `chain.read <method>` and `chain.attempt <upstream>` inside the integration, so `spans` is [].

import { Schema } from "effect";
import { defineRpc, defineWorkflow } from "../../../packages/book/src/index.ts";

import { concept_payments } from "./foundation.ts";
import {
  error_ENV_MISSING,
  error_FEATURE_NOT_AVAILABLE,
  error_INSUFFICIENT_BALANCE,
  error_INVALID_INPUT,
  error_NOT_AUTHENTICATED,
  error_NOT_IMPLEMENTED,
  error_PROVIDER_ERROR,
  error_PROVIDER_RESPONSE_INVALID,
  error_ROLE_PERMISSION_DENIED,
  error_UNKNOWN,
  error_WRONG_STATE,
  event_payment_transitioned,
} from "./vocabulary.ts";
import {
  machine_money_execution,
  machine_payment,
  machine_payment_command,
  machine_payment_command_verification,
  machine_payment_schedule,
  table_money_executions,
  table_payment_commands,
  table_payment_document_intents,
  table_payment_schedules,
  table_payments,
  table_provider_send_attempts,
} from "./data.ts";
import {
  procedure_access_require_feature,
  procedure_access_require_feature_from_action,
  procedure_accounts_account_id_for_auth_user_or_null,
  procedure_accounts_find_account_recipient_in_tx,
  procedure_accounts_read_execution_approval_in_tx,
  procedure_accounts_require_account_signer_in_tx,
  procedure_accounts_require_payment_account_in_tx,
  procedure_accounts_resolve_account_recipient_safe_in_tx,
  procedure_banking_payout_send_failed_in_tx,
  procedure_banking_read_payout_delivery_in_tx,
  procedure_books_book_asset_by_id_in_tx,
  procedure_documents_current_payment_documents,
  procedure_documents_load_payment_documents,
  procedure_documents_load_payment_documents_for_principal,
  procedure_documents_verify_payment_document_reference,
  procedure_organizations_read_organization_safe_in_tx,
  procedure_organizations_read_organizations_at_safe_in_tx,
  procedure_organizations_read_owner_safes_in_tx,
  procedure_organizations_require_org_participant,
  procedure_parties_ensure_payment_wallet_destination_in_tx,
  procedure_parties_party_by_id,
  procedure_parties_party_by_safe_address,
  procedure_parties_resolve_owned_payment_wallet_safe_in_tx,
  procedure_parties_resolve_recipient_in_tx,
  procedure_payroll_advance_runs_to_authorized,
  procedure_payroll_read_department_spend_in_tx,
  procedure_permissions_find_command_authority,
  procedure_permissions_read_budget_allowance_in_tx,
  procedure_permissions_read_worn_allowances_in_tx,
  procedure_permissions_require_organization_spend_authority_in_tx,
  table_accounts,
  table_counterparty_destinations,
  table_identities,
  table_orgs,
} from "./neighbors.ts";
import {
  procedure_payments_load_payment_retry_source_in_tx,
  procedure_payments_prepare_payment_command_in_tx,
  procedure_payments_schedule_for_execution_in_tx,
  procedure_payments_server_payment_authority_in_tx,
} from "./procedures.ts";
import {
  contract_budgets,
  contract_entry_point,
  contract_erc20,
  contract_roles,
  integration_chain_rpc,
} from "./external.ts";

const BACKEND = "packages/backend";
const CONVEX = `${BACKEND}/convex/payments`;
const SRC = `${BACKEND}/src/payments`;
const PROTOCOL = "packages/protocol/src/payments";
const SCHEDULES = `${SRC}/schedules`;
const LIFECYCLES = `${SRC}/lifecycles`;

/** Each record once, in first-seen order: the touch lists below overlap. */
const uniq = <T extends { readonly id: string }>(items: ReadonlyArray<T>): T[] => [
  ...new Map(items.map((item) => [item.id, item])).values(),
];

// ── shared shapes ───────────────────────────────────────────────────────────────────────────

/** `PAYMENT_SCHEDULE_SHORTFALLS` (payment-schema.ts:113). */
const Shortfall = Schema.Literals(["budget_exhausted", "balance_too_low", "fees_too_high", "send_refused"]);
/** `PAYMENT_SCHEDULE_FAILURES` (payment-schema.ts:121). */
const ScheduleFailure = Schema.Literals(["window_passed", "not_member", "approvals_lost"]);

/** `PaymentLifecycleExecutionIntentSchema` (schema/executions.ts:180). The redirect recipient (`PaymentRef`) is too deep: Unknown. */
const LifecycleIntent = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("retry"), paymentId: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("claim"), paymentId: Schema.String, requestKey: Schema.optionalKey(Schema.String) }),
  Schema.Struct({ kind: Schema.Literal("cancel"), paymentId: Schema.String, requestKey: Schema.optionalKey(Schema.String) }),
  Schema.Struct({
    kind: Schema.Literal("redirect"),
    requestKey: Schema.optionalKey(Schema.String),
    paymentId: Schema.String,
    recipient: Schema.Unknown,
  }),
  Schema.Struct({ kind: Schema.Literal("reschedule"), paymentId: Schema.String, at: Schema.Number }),
]);

/** `PaymentLifecycleExecutionScopeSchema` (schema/executions.ts:223). */
const LifecycleScope = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("account") }),
  Schema.Struct({ kind: Schema.Literal("organization"), orgId: Schema.String }),
]);

/**
 * `PreparedPaymentCommandExecutionSchema` (schema/requests.ts:84): its top-level fields. The request,
 * the prepared command, the unsigned UserOperation, the source command, the document bundles and the
 * settled replay are too deep to transcribe: Unknown.
 */
const PreparedPaymentCommandExecution = Schema.Struct({
  recipientObservations: Schema.Array(Schema.Unknown),
  emitPaymentInitiated: Schema.Boolean,
  executionId: Schema.String,
  commandId: Schema.String,
  paymentIds: Schema.Array(Schema.String),
  request: Schema.Unknown,
  chainId: Schema.Number,
  signerAddress: Schema.String,
  userOpSenderSafe: Schema.String,
  digest: Schema.String,
  preparedCommand: Schema.optionalKey(Schema.Unknown),
  userOperation: Schema.optionalKey(Schema.Unknown),
  sourceCommand: Schema.optionalKey(Schema.Unknown),
  sourcePaymentIds: Schema.optionalKey(Schema.Array(Schema.String)),
  sourceRecipientSafes: Schema.optionalKey(Schema.Array(Schema.String)),
  lifecycleSource: Schema.optionalKey(
    Schema.Struct({ paymentId: Schema.String, commitmentId: Schema.String, documentHash: Schema.String }),
  ),
  documentBundles: Schema.optionalKey(Schema.Array(Schema.Unknown)),
  settled: Schema.optionalKey(Schema.Unknown),
});

/** What `preparePaymentLifecycleInTx` returns (lifecycles/writes/commands.ts:43). The prepared command and source command are too deep: Unknown. */
const PlannedLifecycle = Schema.Struct({
  prepared: Schema.Unknown,
  sourceCommand: Schema.optionalKey(Schema.Unknown),
  sourcePaymentIds: Schema.optionalKey(Schema.Array(Schema.String)),
  sourceRecipientSafes: Schema.optionalKey(Schema.Array(Schema.String)),
  recipientObservations: Schema.optionalKey(Schema.Array(Schema.Unknown)),
  lifecycleSource: Schema.optionalKey(
    Schema.Struct({ paymentId: Schema.String, commitmentId: Schema.String, documentHash: Schema.String }),
  ),
});

/** `CommandFundingFacts` (schedules/reads.ts:55). The prepared command and the Budget allowance are too deep: Unknown. */
const CommandFundingFacts = Schema.Struct({
  actor: Schema.Struct({ kind: Schema.Literals(["account", "organization"]), id: Schema.String }),
  commandCompletion: Schema.NullOr(Schema.Literals(["settled", "failed"])),
  prepared: Schema.Unknown,
  budget: Schema.NullOr(Schema.Unknown),
});

/** The step `payments.schedules.record` takes (schedules/operations/record.ts:22). */
const ScheduleStep = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("ahead_checked"),
    shortfall: Schema.optionalKey(Shortfall),
    detail: Schema.optionalKey(Schema.String),
  }),
  Schema.Struct({ kind: Schema.Literal("short"), shortfall: Shortfall, detail: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("sent") }),
  Schema.Struct({ kind: Schema.Literal("cancelled") }),
  Schema.Struct({ kind: Schema.Literal("failed"), reason: ScheduleFailure, failCommand: Schema.Boolean }),
]);

// ── shared touches ──────────────────────────────────────────────────────────────────────────

/**
 * What the submission authority guard (`authorizePaymentCommandSubmissionInTx`) invokes: the
 * caller's Account, then by the command's route the Organization spend authority, the owner
 * lifecycle's manager, the Directors' Safes, or the v4 budget's worn allowances and department spend.
 */
const SUBMISSION_AUTHORITY = [
  procedure_accounts_require_payment_account_in_tx,
  procedure_permissions_require_organization_spend_authority_in_tx,
  procedure_permissions_find_command_authority,
  procedure_organizations_read_organization_safe_in_tx,
  procedure_organizations_read_owner_safes_in_tx,
  procedure_permissions_read_worn_allowances_in_tx,
  procedure_payroll_read_department_spend_in_tx,
];

const SUBMISSION_AUTHORITY_WAS = [
  `${SRC}/commands/writes/links.ts:173`,
  `${SRC}/guards/authority.ts:172`,
  `${SRC}/guards/authority.ts:1`,
  `${SRC}/guards/authority.ts:3`,
  `${SRC}/guards/owners.ts:8`,
  `${SRC}/guards/owner-approvals.ts:9`,
  `${SRC}/guards/budgets.ts:10`,
  `${SRC}/guards/budgets.ts:11`,
  `${SRC}/guards/budgets.ts:12`,
  `${SRC}/guards/voids.ts:18`,
  `${SRC}/guards/voids.ts:47`,
];

/** The tables the submission authority guard reads directly: the command, its Payments, a void's schedule and execution (guards/voids.ts:47). */
const SUBMISSION_AUTHORITY_READS = [table_payment_commands, table_payments, table_payment_schedules, table_money_executions];

/** What the wire Payment projection (`toWirePayment`) reads, besides the Payment row itself. */
const PROJECTION_READS = [
  table_payments,
  table_payment_schedules,
  table_payment_commands,
  table_money_executions,
  table_provider_send_attempts,
  table_accounts,
  table_identities,
  table_orgs,
  table_counterparty_destinations,
];

/** The neighbours' readers `toWirePayment` itself calls inside the transaction (views/payments.ts:17, :18, :25; views/recipients.ts). */
const TO_WIRE_INVOKES = [
  procedure_documents_current_payment_documents,
  procedure_books_book_asset_by_id_in_tx,
  procedure_banking_read_payout_delivery_in_tx,
  procedure_parties_party_by_id,
  procedure_parties_party_by_safe_address,
];

/**
 * A command's wire Payments as `paymentResponsesForCommandIdInTx` answers them (reads/payments.ts:222): the caller's
 * Account id, each Payment's documents as that principal reads them, then `toWirePayment`.
 */
const COMMAND_WIRE_INVOKES = [
  procedure_accounts_account_id_for_auth_user_or_null,
  procedure_documents_load_payment_documents_for_principal,
  ...TO_WIRE_INVOKES,
];

const PROJECTION_WAS = [
  `${SRC}/reads/payments.ts:222`,
  `${SRC}/reads/payments.ts:242`,
  `${SRC}/reads/payments.ts:253`,
  `${SRC}/views/payments.ts:17`,
  `${SRC}/views/payments.ts:18`,
  `${SRC}/views/payments.ts:25`,
  `${SRC}/views/payments.ts:198`,
];

/**
 * What the executions area's internal steps a send runs invoke and emit, folded into the actions that run them:
 * `payments.executions.claim` (the authority guard), `payments.executions.classify` (a lapsed or displaced Attempt) and
 * `payments.executions.complete` (its step annotation, payroll runs advanced, the command's wire Payments).
 */
const SEND_STEP_INVOKES = [
  procedure_accounts_read_execution_approval_in_tx,
  procedure_payroll_advance_runs_to_authorized,
  procedure_banking_payout_send_failed_in_tx,
  ...COMMAND_WIRE_INVOKES,
];

/** What those steps drive: the claim, the acceptance and its submission, and the classifier's fates (executions.ts). */
const SEND_STEP_DRIVES = [
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
];

/** What `recordPaymentCommandOutcome(…, "failed")` does: the execution read, each Payment failed, the command completed. */
const COMMAND_FAILED_WAS = [
  `${SRC}/writes/outcomes.ts:16`,
  `${SRC}/writes/outcomes.ts:29`,
  `${SRC}/writes/outcomes.ts:40`,
  `${SRC}/writes/outcomes.ts:89`,
  `${SRC}/writes/outcomes.ts:97`,
  `${SRC}/writes/outcomes.ts:107`,
  `${SRC}/writes/outcomes.ts:109`,
];

/**
 * What one send of a stored operation reaches through the executions area: the scan floor, the lane nonce, the
 * bundler's lookup and send, and the proof a lapsed prepared Attempt (`retireLapsedExecution`) or a lane that moved
 * (`preflightSend`) is classified from: the receipt and the EntryPoint event that consumed the nonce.
 */
const SEND_CALLS = [
  integration_chain_rpc.c.fetchLatestBlockNumber,
  integration_chain_rpc.c.fetchEntryPointNonce,
  integration_chain_rpc.c.hasUserOperationByHash,
  integration_chain_rpc.c.sendUserOperation,
  integration_chain_rpc.c.fetchUserOperationReceipt,
  integration_chain_rpc.c.fetchEntryPointUserOperationEvent,
];

const SEND_WAS = [
  `${SRC}/executions/external/sends.ts:63`,
  `${SRC}/executions/external/sends.ts:98`,
  `${SRC}/executions/external/sends.ts:115`,
  `${SRC}/executions/external/sends.ts:126`,
  `${SRC}/executions/external/sends.ts:129`,
  `${SRC}/executions/external/sends.ts:145`,
  `${SRC}/executions/external/sends.ts:151`,
  `${SRC}/executions/external/sends.ts:162`,
  `${SRC}/executions/external/sends.ts:197`,
  `${SRC}/executions/external/sends.ts:262`,
  `${SRC}/executions/external/preflights.ts:64`,
  `${SRC}/executions/external/preflights.ts:66`,
  `${SRC}/executions/external/preflights.ts:77`,
  `${SRC}/executions/external/preflights.ts:87`,
  `${SRC}/executions/external/expiries.ts:59`,
  `${SRC}/executions/external/attempts.ts:56`,
  `${SRC}/executions/external/attempts.ts:71`,
  `${SRC}/executions/external/attempts.ts:87`,
  `${SRC}/executions/external/attempts.ts:183`,
  `${SRC}/executions/writes/transactions.ts:41`,
  `${SRC}/executions/writes/witnesses.ts:24`,
];

/** The Budget or balance a scheduled send reads before it goes: Roles allowance (and block time), then the Safe's ERC-20 balance. */
const FUNDING_CALLS = [
  integration_chain_rpc.c.fetchEthCall,
  integration_chain_rpc.c.fetchLatestBlock,
  integration_chain_rpc.c.fetchErc20Balance,
];

const FUNDING_WAS = [
  `${SCHEDULES}/external.ts:65`,
  `${SCHEDULES}/external.ts:72`,
  `${SCHEDULES}/external.ts:77`,
  `${SRC}/commands/external/funding.ts:51`,
  `${SRC}/commands/external/funding.ts:72`,
  `${SRC}/commands/external/funding.ts:99`,
  `${SRC}/executions/external/funding.ts:27`,
  `${SRC}/executions/external/funding.ts:36`,
];

/**
 * Every chain-rpc call the lifecycle build reaches: the Roles module code, the Budget left (and allowance with its
 * block time), a lapsed live Attempt's proof (receipt, lane, landed event), the scan floor, the sender's ERC-20
 * balance for an undated birth, fees and sponsorship.
 */
const BUILD_CALLS = [
  integration_chain_rpc.c.fetchCode,
  integration_chain_rpc.c.fetchEthCall,
  integration_chain_rpc.c.fetchLatestBlock,
  integration_chain_rpc.c.fetchLatestBlockNumber,
  integration_chain_rpc.c.fetchEntryPointNonce,
  integration_chain_rpc.c.fetchEntryPointUserOperationEvent,
  integration_chain_rpc.c.fetchUserOperationReceipt,
  integration_chain_rpc.c.fetchErc20Balance,
  integration_chain_rpc.c.fetchUserOperationFees,
  integration_chain_rpc.c.sponsorUserOperation,
];

const BUILD_WAS = [
  `${SRC}/commands/external/builds.ts:42`,
  `${SRC}/commands/external/builds.ts:58`,
  `${SRC}/commands/external/roles-modules.ts:19`,
  `${SRC}/commands/external/funding.ts:129`,
  `${SRC}/commands/external/funding.ts:157`,
  `${SRC}/commands/external/funding.ts:167`,
  `${SRC}/commands/external/funding.ts:181`,
  `${SRC}/commands/external/funding.ts:259`,
  `${SRC}/executions/writes/failures.ts:42`,
  `${SRC}/executions/external/builds.ts:94`,
  `${SRC}/executions/external/builds.ts:102`,
  `${SRC}/executions/external/builds.ts:112`,
  `${SRC}/executions/external/builds.ts:137`,
  `${SRC}/executions/external/builds.ts:153`,
  `${SRC}/executions/external/builds.ts:233`,
  `${SRC}/executions/external/builds.ts:246`,
  `${SRC}/executions/external/builds.ts:269`,
  `${SRC}/executions/external/builds.ts:271`,
  `${SRC}/executions/external/builds.ts:274`,
  `${SRC}/executions/external/expiries.ts:78`,
  `${SRC}/executions/external/funding.ts:36`,
  `${SRC}/executions/external/funding.ts:63`,
  `${SRC}/executions/external/replays.ts:26`,
  `${SRC}/executions/external/lanes.ts:85`,
  `${SRC}/executions/external/lanes.ts:103`,
  `${SRC}/executions/external/safes.ts:164`,
  `${SRC}/executions/external/safes.ts:169`,
  `${SRC}/executions/external/safes.ts:188`,
];

/** What `payments.schedules.store`'s `attempt` admits (schedules/operations/store.ts:29). */
const STORE_ERRORS = [error_INVALID_INPUT, error_ROLE_PERMISSION_DENIED, error_WRONG_STATE];

/** `PREPARE` (operations.ts:79): every lifecycle prepare row. */
const PREPARE_ERRORS = [
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
];

/** `INTENT_FAILURES` (commands/writes/transactions.ts:26). */
const INTENT_ERRORS = [error_INVALID_INPUT, error_ROLE_PERMISSION_DENIED, error_WRONG_STATE, error_NOT_IMPLEMENTED];

// ── schedules: internal rpcs ────────────────────────────────────────────────────────────────

export const rpc_payments_schedules_authorize_resend = defineRpc({
  id: "payments.schedules.authorize-resend",
  title: "Re-prove the signer's authority before a scheduled resend",
  about:
    "Registered as the internal mutation `payments/schedules:authorizeResend`. The due job runs it before it sends again an " +
    "execution it already claimed (state `sending`): it loads the command and runs the same submission authority guard a " +
    "first send claims under (`authorizePaymentExecutionSubmissionInTx`), so a signer who lost the authority is refused. " +
    "It writes nothing and returns null.",
  was: [
    `${CONVEX}/schedules.ts:3`,
    `${SCHEDULES}/operations/authorize-resend.ts:15`,
    `${SCHEDULES}/operations/authorize-resend.ts:23`,
    `${SCHEDULES}/external.ts:161`,
    `${SCHEDULES}/external.ts:167`,
    ...SUBMISSION_AUTHORITY_WAS,
  ],
  concept: concept_payments,
  kind: "mutation",
  who: "internal: the due job (`payments.schedules.send-due`), for an execution it already claimed.",
  input: Schema.Struct({ authUserId: Schema.String, commandId: Schema.String }),
  output: Schema.Null,
  errors: [error_INVALID_INPUT, error_ROLE_PERMISSION_DENIED, error_WRONG_STATE],
  reads: SUBMISSION_AUTHORITY_READS,
  writes: [],
  drives: [],
  invokes: SUBMISSION_AUTHORITY,
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_payments_schedules_claim_due = defineRpc({
  id: "payments.schedules.claim-due",
  title: "Lease the waiting schedules whose next read is due",
  about:
    "Registered as the internal mutation `payments/schedules:claimDue`. Reads up to 25 (`DUE_PAGE`) `waiting` schedules with " +
    "`nextAttemptAt <= now` through `by_state_next_attempt`, pushes each one's `nextAttemptAt` ten minutes out " +
    "(`DUE_LEASE_MS`) so an overlapping run skips it, and returns their execution ids. No state changes.",
  was: [
    `${CONVEX}/schedules.ts:4`,
    `${SCHEDULES}/operations/claim-due.ts:12`,
    `${SCHEDULES}/operations/claim-due.ts:15`,
    `${SCHEDULES}/writes.ts:20`,
    `${SCHEDULES}/writes.ts:94`,
    `${SCHEDULES}/writes.ts:106`,
    `${SCHEDULES}/external.ts:274`,
  ],
  concept: concept_payments,
  kind: "mutation",
  who: "internal: the due job (`payments.schedules.send-due`).",
  input: Schema.Struct({}),
  output: Schema.Array(Schema.String),
  errors: [],
  reads: [table_payment_schedules],
  writes: [table_payment_schedules],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_payments_schedules_load_command = defineRpc({
  id: "payments.schedules.load-command",
  title: "Read a scheduled command's funding facts",
  about:
    "Registered as the internal query `payments/schedules:loadCommand`. Loads the payment command by id, decodes its stored " +
    "prepared command, and for an Organization's command whose first Payment names a Permission reads that Budget's " +
    "allowance through Permissions. Returns the actor, whether the command already completed, the prepared command and " +
    "the Budget, or null when there is no command. Read by the scheduled submit before it stores a schedule and by the " +
    "Board schedule's store before it reads Budgets. The command's `preparedCommandJson` is decoded here and again by " +
    "every reader of it (the authority guard, the due job's funding read).",
  was: [
    `${CONVEX}/schedules.ts:5`,
    `${SCHEDULES}/operations/load-command.ts:12`,
    `${SCHEDULES}/reads.ts:55`,
    `${SCHEDULES}/reads.ts:68`,
    `${SCHEDULES}/reads.ts:72`,
    `${SCHEDULES}/external.ts:119`,
    `${SCHEDULES}/operations/board.ts:55`,
    `${BACKEND}/src/accounts/approvals/operations/send-approved.ts:241`,
  ],
  concept: concept_payments,
  kind: "query",
  who:
    "internal: the scheduled submit (`scheduledSubmitted`, run by `payments.executions.submit`, `submit-command`, " +
    "`payments.schedules.store-approved` and Accounts' approval send) and `payments.schedules.store-board-scheduled`.",
  input: Schema.Struct({ commandId: Schema.String }),
  output: Schema.NullOr(CommandFundingFacts),
  errors: [],
  reads: [table_payment_commands, table_payments],
  writes: [],
  drives: [],
  invokes: [procedure_permissions_read_budget_allowance_in_tx],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_payments_schedules_load = defineRpc({
  id: "payments.schedules.load",
  title: "Read what one due schedule's send needs",
  about:
    "Registered as the internal query `payments/schedules:load`. Loads the schedule by execution id, its command's funding " +
    "facts (as `payments.schedules.load-command`), and whether a void sent for it still waits for proof (its void " +
    "command is `submitted` with no completion). Returns those with the schedule's own fields, or null when the schedule " +
    "or its command is missing.",
  was: [
    `${CONVEX}/schedules.ts:6`,
    `${SCHEDULES}/operations/load.ts:12`,
    `${SCHEDULES}/reads.ts:17`,
    `${SCHEDULES}/reads.ts:85`,
    `${SCHEDULES}/reads.ts:95`,
    `${SCHEDULES}/external.ts:88`,
  ],
  concept: concept_payments,
  kind: "query",
  who: "internal: the due job (`payments.schedules.send-due`).",
  input: Schema.Struct({ executionId: Schema.String }),
  output: Schema.NullOr(
    Schema.Struct({
      ...CommandFundingFacts.fields,
      voidInFlight: Schema.Boolean,
      schedule: Schema.Struct({
        executionId: Schema.String,
        commandId: Schema.String,
        authUserId: Schema.String,
        signature: Schema.optionalKey(Schema.String),
        state: Schema.Literals(["waiting", "sent", "failed", "cancelled"]),
        sendsAt: Schema.Number,
        windowEndsAt: Schema.Number,
        aheadCheckedAt: Schema.NullOr(Schema.Number),
        budget: Schema.NullOr(Schema.Struct({ budgets: Schema.String, scheduledIds: Schema.Array(Schema.String) })),
      }),
    }),
  ),
  errors: [],
  reads: [table_payment_schedules, table_payment_commands, table_payments],
  writes: [],
  drives: [],
  invokes: [procedure_payments_schedule_for_execution_in_tx, procedure_permissions_read_budget_allowance_in_tx],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_payments_schedules_record = defineRpc({
  id: "payments.schedules.record",
  title: "Record one due read of a schedule",
  about:
    "Registered as the internal mutation `payments/schedules:record`. Does nothing unless the schedule is `waiting`. " +
    "`ahead_checked`: stamps the day-ahead check, moves the next read to `sendsAt`, and emails a `short` notice when a " +
    "shortfall was found. `short`: counts the attempt and reads again in an hour (capped at the window end, except a " +
    "budget's schedule, which no window ends). `sent`: the schedule is `sent`, a `sent` notice is scheduled, and for a " +
    "budget's schedule the indexed settlement read is scheduled. `cancelled`: as a Board cancel (schedule, command and " +
    "Payments cancelled). `failed`: the schedule is `failed` with its reason and a `failed` notice is scheduled; with " +
    "`failCommand` the command fails too (`scheduled_<reason>`), failing its Payments and sending `payment_transitioned`. " +
    "Notices go through `payments.notices.notify`, the settlement through `payments.verifications.settle`, both by " +
    "`runAfter(0)`. The `cancelled` path patches Payments to `cancelled` directly, outside the guarded Payment writer.",
  was: [
    `${CONVEX}/schedules.ts:7`,
    `${SCHEDULES}/operations/record.ts:20`,
    `${SCHEDULES}/operations/record.ts:43`,
    `${SCHEDULES}/writes.ts:129`,
    `${SCHEDULES}/writes.ts:137`,
    `${SCHEDULES}/writes.ts:139`,
    `${SCHEDULES}/writes.ts:148`,
    `${SCHEDULES}/writes.ts:150`,
    `${SCHEDULES}/writes.ts:163`,
    `${SCHEDULES}/writes.ts:175`,
    `${SCHEDULES}/writes.ts:177`,
    `${SCHEDULES}/writes.ts:180`,
    `${SCHEDULES}/writes.ts:194`,
    `${SCHEDULES}/writes/board-cancels.ts:19`,
    `${SCHEDULES}/writes/board-cancels.ts:39`,
    `${SCHEDULES}/writes/board-cancels.ts:49`,
    `${SRC}/verifications/writes/schedules.ts:47`,
    `${SRC}/notices/writes.ts:19`,
    ...COMMAND_FAILED_WAS,
  ],
  concept: concept_payments,
  kind: "mutation",
  who: "internal: the due job (`payments.schedules.send-due`), once per schedule it read.",
  input: Schema.Struct({ executionId: Schema.String, step: ScheduleStep }),
  output: Schema.Null,
  errors: [error_INVALID_INPUT],
  reads: [table_payment_schedules, table_payment_commands, table_payments, table_money_executions],
  writes: [table_payment_schedules, table_payment_commands, table_payments],
  drives: [
    machine_payment_schedule.t.to_sent,
    machine_payment_schedule.t.to_failed,
    machine_payment_schedule.t.to_cancelled,
    machine_payment.t.to_cancelled,
    machine_payment.t.to_failed,
  ],
  invokes: [procedure_payments_schedule_for_execution_in_tx, procedure_banking_payout_send_failed_in_tx],
  emits: [event_payment_transitioned],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_payments_schedules_store = defineRpc({
  id: "payments.schedules.store",
  title: "Store a signed scheduled operation for its date",
  about:
    "Registered as the internal mutation `payments/schedules:store`: the scheduled submit's transaction. The execution must " +
    "be the caller's own payment execution. A schedule already stored for it with the same signature is returned " +
    "(another signature is refused). Otherwise the execution must still be `prepared`, the submission authority guard " +
    "runs, and a `waiting` schedule is inserted with its first read a day before `sendsAt` (or at `sendsAt` when that day " +
    "has begun, the check counted as done), carrying the funding shortfall read just before; a `scheduled` notice is " +
    "scheduled. Returns the command id, the expected UserOperation hash and the command's wire Payments " +
    "(`paymentResponsesForCommandIdInTx`, read as the caller). The execution itself is left `prepared`: nothing is sent.",
  was: [
    `${CONVEX}/schedules.ts:9`,
    `${SCHEDULES}/operations/store.ts:15`,
    `${SCHEDULES}/operations/store.ts:29`,
    `${SCHEDULES}/writes.ts:44`,
    `${SCHEDULES}/writes.ts:49`,
    `${SCHEDULES}/writes.ts:61`,
    `${SCHEDULES}/writes.ts:64`,
    `${SCHEDULES}/writes.ts:65`,
    `${SCHEDULES}/writes.ts:67`,
    `${SCHEDULES}/writes.ts:84`,
    `${SCHEDULES}/writes.ts:89`,
    `${SCHEDULES}/rules.ts:27`,
    `${SCHEDULES}/external.ts:123`,
    `${SCHEDULES}/external.ts:282`,
    `${SRC}/executions/operations/submit.ts:23`,
    `${SRC}/executions/operations/submit-command.ts:23`,
    `${BACKEND}/src/accounts/approvals/operations/send-approved.ts:241`,
    ...SUBMISSION_AUTHORITY_WAS,
    ...PROJECTION_WAS,
  ],
  concept: concept_payments,
  kind: "mutation",
  who:
    "internal: the scheduled submit (`scheduledSubmitted`) of `payments.executions.submit`, `submit-command`, " +
    "`payments.schedules.store-approved` and Accounts' approval send (accounts/approvals/operations/send-approved.ts:241).",
  input: Schema.Struct({
    authUserId: Schema.String,
    executionId: Schema.String,
    signature: Schema.String,
    sendsAt: Schema.Number,
    windowEndsAt: Schema.Number,
    shortfall: Schema.optionalKey(Shortfall),
    shortfallDetail: Schema.optionalKey(Schema.String),
  }),
  output: Schema.Struct({
    commandId: Schema.String,
    expectedUserOpHash: Schema.NullOr(Schema.String),
    payments: Schema.Array(Schema.Unknown),
  }),
  errors: STORE_ERRORS,
  reads: [...PROJECTION_READS],
  writes: [table_payment_schedules],
  drives: [machine_payment_schedule.t.to_waiting],
  invokes: [procedure_payments_schedule_for_execution_in_tx, ...SUBMISSION_AUTHORITY, ...COMMAND_WIRE_INVOKES],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_payments_schedules_record_board_scheduled = defineRpc({
  id: "payments.schedules.record-board-scheduled",
  title: "Record a Board's dated payment with Budgets' ids",
  about:
    "Registered as the internal mutation `payments/schedules:recordBoardScheduled`, run by the Board schedule's store action " +
    "once Budgets' ids are read. Returns `replayed` when the command is gone, completed, or already has a schedule. " +
    "Otherwise the command is patched `submitted` with verification `applied` (straight from `not_started`, no " +
    "evidence read), a `waiting` schedule keyed by the command id " +
    "is inserted with the Budgets address and ids, its day-ahead check counted as done and its first read at `sendsAt`, " +
    "each Payment takes `record_submission` (pending to settling), and a `scheduled` notice is scheduled. The Payments are " +
    "patched directly, outside the guarded Payment writer, and no `payment_transitioned` is sent for them.",
  was: [
    `${CONVEX}/schedules.ts:15`,
    `${SCHEDULES}/operations/board.ts:110`,
    `${SCHEDULES}/operations/board.ts:123`,
    `${SCHEDULES}/writes.ts:206`,
    `${SCHEDULES}/writes.ts:222`,
    `${SCHEDULES}/writes.ts:224`,
    `${SCHEDULES}/writes.ts:229`,
    `${SCHEDULES}/writes.ts:247`,
    `${SCHEDULES}/writes.ts:250`,
    `${SCHEDULES}/writes.ts:252`,
    `${SRC}/rules/transitions.ts:160`,
  ],
  concept: concept_payments,
  kind: "mutation",
  who: "internal: `payments.schedules.store-board-scheduled`, in its own transaction.",
  input: Schema.Struct({
    authUserId: Schema.String,
    commandId: Schema.String,
    budgets: Schema.String,
    scheduledIds: Schema.Array(Schema.String),
    sendsAt: Schema.Number,
    windowEndsAt: Schema.Number,
  }),
  output: Schema.Literals(["scheduled", "replayed"]),
  errors: [],
  reads: [table_payment_commands, table_payment_schedules, table_payments],
  writes: [table_payment_commands, table_payment_schedules, table_payments],
  drives: [
    machine_payment_command.t.to_submitted,
    machine_payment_command_verification.t.to_applied,
    machine_payment_schedule.t.to_waiting,
    machine_payment.t.to_settling,
  ],
  invokes: [procedure_payments_schedule_for_execution_in_tx],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_payments_schedules_load_board_cancel = defineRpc({
  id: "payments.schedules.load-board-cancel",
  title: "Read what a Board's cancel of a dated payment calls",
  about:
    "Registered as the internal query `payments/schedules:loadBoardCancel`. The Payment must be the Organization's and have " +
    "a command; that command's latest schedule must be a Board's (keyed by the command id), hold Budgets ids, and still " +
    "be `waiting`. Anything else is refused INVALID_INPUT as not a payment the Directors scheduled. Returns the command " +
    "id, `sendsAt`, the Budgets address and the scheduled ids, for Organizations' proposal that calls `Budgets.cancel`.",
  was: [
    `${CONVEX}/schedules.ts:14`,
    `${SCHEDULES}/operations/board.ts:139`,
    `${SCHEDULES}/operations/board.ts:144`,
    `${SCHEDULES}/reads.ts:124`,
    `${SCHEDULES}/reads.ts:131`,
    `${SCHEDULES}/reads.ts:139`,
    `${SRC}/commands/errors.ts:81`,
    `${BACKEND}/src/organizations/proposals/operations/cancel-scheduled.ts:51`,
  ],
  concept: concept_payments,
  kind: "query",
  who: "internal: Organizations' Board cancel of a scheduled payment (`organizations.proposals.cancelScheduled`).",
  input: Schema.Struct({ orgId: Schema.String, paymentId: Schema.String }),
  output: Schema.Struct({
    commandId: Schema.String,
    sendsAt: Schema.Number,
    budgets: Schema.String,
    scheduledIds: Schema.Array(Schema.String),
  }),
  errors: [error_INVALID_INPUT],
  reads: [table_payments, table_payment_schedules],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

// ── schedules: workflows ────────────────────────────────────────────────────────────────────

export const workflow_payments_schedules_send_due = defineWorkflow({
  id: "payments.schedules.send-due",
  title: "Send the scheduled payments that are due",
  about:
    "Registered as the internal action `payments/schedules:sendDue`, the cron job `send scheduled payments that are due` " +
    "every 5 minutes (`crons.interval`, not clock-aligned), registered only while money writes are on and a Payments V2 address is configured (ADR-0034, rulings " +
    "3A and 4B). Attributed to the system job `scheduled_payment_due_sweep`. It leases a page of due schedules, reads each " +
    "one, decides its step and records it; one schedule's failed read is counted as skipped and left for the next run. A " +
    "full page of 25 schedules this action again at once (`runAfter(0)`, `page + 1`). A day ahead it checks the Budget " +
    "and balance; on the date it re-reads the `scheduled-payments` gate (off: short `send_refused`), then sends the exact " +
    "signed operation (a claimed one is re-authorized first; a lapsed or displaced Attempt is classified from proof " +
    "through `payments.executions.classify`), or for a v4 budget's dated payment calls `Budgets.execute` " +
    "for each pending item from Capxul's own executor key (`BUDGETS_EXECUTOR_PRIVATE_KEY`). Short reads retry hourly " +
    "inside the signed window; when it closes the schedule fails, and the command with it when the bundler never took " +
    "the Attempt. A budget's schedule has no window: it is read until Budgets reads it paid or cancelled. A lost role " +
    "fails it `not_member`; a fee refusal is short `fees_too_high`. Returns `{ read, skipped, <step>: count }`. Timeout " +
    "is Convex's action limit; the code sets none. Retries are the next cron run and each schedule's hourly re-read.",
  was: [
    `${CONVEX}/schedules.ts:8`,
    `${BACKEND}/convex/crons.ts:8`,
    `${BACKEND}/src/platform/jobs.ts:87`,
    `${BACKEND}/src/platform/jobs.ts:99`,
    `${SCHEDULES}/operations/send-due.ts:16`,
    `${SCHEDULES}/operations/send-due.ts:19`,
    `${SCHEDULES}/operations/send-due.ts:32`,
    `${SCHEDULES}/operations/send-due.ts:41`,
    `${SCHEDULES}/operations/send-due.ts:45`,
    `${SCHEDULES}/operations/send-due.ts:50`,
    `${SCHEDULES}/external.ts:147`,
    `${SCHEDULES}/external.ts:181`,
    `${SCHEDULES}/external.ts:189`,
    `${SCHEDULES}/external.ts:193`,
    `${SCHEDULES}/external.ts:208`,
    `${SCHEDULES}/external.ts:216`,
    `${SCHEDULES}/external.ts:228`,
    `${SCHEDULES}/external.ts:235`,
    `${SCHEDULES}/external.ts:240`,
    `${SCHEDULES}/external.ts:252`,
    `${SCHEDULES}/external.ts:257`,
    `${SCHEDULES}/external.ts:265`,
    `${SCHEDULES}/rules.ts:25`,
    `${SCHEDULES}/rules.ts:95`,
    `${SCHEDULES}/rules.ts:103`,
    `${SCHEDULES}/rules.ts:108`,
    `${SCHEDULES}/external/budget-executor.ts:24`,
    `${SCHEDULES}/external/budget-executor.ts:46`,
    `${SCHEDULES}/external/budget-executor.ts:56`,
    `${SCHEDULES}/external/budget-executor.ts:72`,
    `${SCHEDULES}/external/budget-executor.ts:74`,
    `${SCHEDULES}/external/budget-executor.ts:94`,
    `${SCHEDULES}/external/budget-executor.ts:99`,
    ...FUNDING_WAS,
    ...SEND_WAS,
  ],
  concept: concept_payments,
  priority: "critical",
  trigger: { cron: "*/5 * * * *" },
  steps: [
    { name: "attribute", about: "Records the run as the system job `scheduled_payment_due_sweep`." },
    { name: "claim", about: "Runs `payments.schedules.claim-due`: up to 25 due `waiting` schedules, each leased for ten minutes." },
    {
      name: "load",
      about: "Per schedule, runs `payments.schedules.load`; nothing is recorded when it is missing, not `waiting`, or a void sent for it awaits proof.",
    },
    {
      name: "decide",
      about: "A completed command fails it `window_passed`; past the window (not a budget's) it fails, failing the command only if the Attempt is still `prepared`.",
    },
    {
      name: "check-funding",
      about: "Not a budget's: the Roles allowance on a role route, then the Safe's ERC-20 balance. A chain read that does not answer is not a shortfall.",
    },
    { name: "ahead", about: "Before `sendsAt`: the step is `ahead_checked`, with the shortfall if one was read." },
    { name: "gate", about: "Re-reads the `scheduled-payments` gate for the payer (and Organization); off is short `send_refused`." },
    {
      name: "execute-budget",
      about: "A budget's: reads each id's `scheduledOf`; pays a due pending one with `Budgets.execute` from the executor key and waits for its receipt.",
    },
    {
      name: "send",
      about: "Otherwise sends the stored operation: `payments.executions.load`, then a resend after `authorize-resend` or a first send (claim, send, record), then `complete`.",
    },
    {
      name: "record",
      about: "Runs `payments.schedules.record` with the step; a failed read, or a schedule it left unrecorded, is counted as skipped.",
    },
    { name: "next-page", about: "A full page of 25 schedules this action again at once with `page + 1`." },
  ],
  reads: [...PROJECTION_READS],
  writes: [table_payment_schedules, table_payment_commands, table_payments, table_money_executions, table_provider_send_attempts],
  drives: [
    machine_payment_schedule.t.to_sent,
    machine_payment_schedule.t.to_failed,
    machine_payment_schedule.t.to_cancelled,
    machine_payment.t.to_cancelled,
    ...SEND_STEP_DRIVES,
  ],
  invokes: [
    procedure_access_require_feature_from_action,
    procedure_payments_schedule_for_execution_in_tx,
    procedure_permissions_read_budget_allowance_in_tx,
    ...SUBMISSION_AUTHORITY,
    ...SEND_STEP_INVOKES,
  ],
  emits: [event_payment_transitioned],
  calls: [
    ...FUNDING_CALLS,
    integration_chain_rpc.c.prepareTransaction,
    integration_chain_rpc.c.broadcastTransaction,
    integration_chain_rpc.c.waitForTransactionReceipt,
    ...SEND_CALLS,
  ],
  chain: [
    contract_roles.f.allowances,
    contract_erc20.f.balanceOf,
    contract_budgets.f.scheduledOf,
    contract_budgets.f.execute,
    contract_entry_point.f.getNonce,
  ],
  idempotency:
    "The ten-minute lease on each schedule (`nextAttemptAt`), `record` ignoring a schedule no longer `waiting`, the execution claim (one send per execution), and Budgets skipping a paid item.",
  timeoutMs: 600000,
  retries: { max: 0, backoff: "none" },
});

export const workflow_payments_schedules_store_approved = defineWorkflow({
  id: "payments.schedules.store-approved",
  title: "Store or send what the Directors approved at the threshold",
  about:
    "Registered as the internal action `payments/schedules:storeApproved` (ADR-0034 ruling 2A). Organizations' proposal " +
    "settlement schedules it with `runAfter(0)` when a `scheduled_payment` proposal executed, with the proposer and the " +
    "approvers. Attributed to the system job `scheduled_payment_owners_approved`. It loads the command's active payment " +
    "execution (none: returns null), builds the Safe's pre-validated signature from the approvers' addresses, then either " +
    "stores the dated payment for its date (the scheduled submit: signature check, funding read, " +
    "`payments.schedules.store`) or, for an operation with no signed window (a void), sends it now and completes the " +
    "submission. Returns the UserOperation hash. A store, send or completion that fails, whatever its code (a refusal " +
    "that can never clear included), schedules it again a minute later (`tries + 1`, up to 10 runs) and fails this run; " +
    "a failed `load-active` read fails the run with no retry, and the tenth failure stops with nothing recorded on the " +
    "command. The schema has no trigger for another concept's operation: the trigger names the " +
    "settlement as a string. Timeout is Convex's action limit; the code sets none.",
  was: [
    `${CONVEX}/schedules.ts:10`,
    `${SCHEDULES}/operations/store-approved.ts:20`,
    `${SCHEDULES}/operations/store-approved.ts:22`,
    `${SCHEDULES}/operations/store-approved.ts:33`,
    `${SCHEDULES}/operations/store-approved.ts:53`,
    `${SCHEDULES}/operations/store-approved.ts:63`,
    `${SCHEDULES}/operations/store-approved.ts:66`,
    `${SCHEDULES}/operations/store-approved.ts:68`,
    `${SCHEDULES}/operations/store-approved.ts:69`,
    `${SCHEDULES}/operations/store-approved.ts:79`,
    `${SCHEDULES}/external.ts:107`,
    `${SCHEDULES}/external.ts:117`,
    `${SCHEDULES}/external.ts:282`,
    `${BACKEND}/src/organizations/proposals/writes/settlements.ts:98`,
    `${BACKEND}/src/organizations/proposals/writes/settlements.ts:99`,
    ...FUNDING_WAS,
    ...SEND_WAS,
  ],
  concept: concept_payments,
  priority: "critical",
  trigger: {
    indexer:
      "not the indexer: organizations.proposals.settle (a chain read of the Organization Safe) schedules it when a scheduled_payment proposal executed",
  },
  steps: [
    { name: "attribute", about: "Records the run as the system job `scheduled_payment_owners_approved`." },
    { name: "load-execution", about: "Runs `payments.executions.load-active` for the payment command; none ends the run with null." },
    { name: "signature", about: "Builds the Safe's pre-validated signature bundle from the lower-cased approver addresses." },
    {
      name: "store-scheduled",
      about: "A payment execution with a signed window: checks the signature, reads funding (`load-command`, chain reads) and runs `payments.schedules.store`.",
    },
    { name: "send-now", about: "Otherwise (a void): sends the stored operation once and runs `payments.executions.complete` with its hash." },
    {
      name: "retry",
      about: "A failed store, send or completion: `runAfter(60000)` with `tries + 1` while under 10 runs, then fails this run.",
    },
  ],
  reads: [...PROJECTION_READS],
  writes: [table_payment_schedules, table_payment_commands, table_payments, table_money_executions, table_provider_send_attempts],
  drives: [machine_payment_schedule.t.to_waiting, ...SEND_STEP_DRIVES],
  invokes: [
    procedure_payments_schedule_for_execution_in_tx,
    procedure_permissions_read_budget_allowance_in_tx,
    ...SUBMISSION_AUTHORITY,
    ...SEND_STEP_INVOKES,
  ],
  emits: [event_payment_transitioned],
  calls: [...FUNDING_CALLS, ...SEND_CALLS],
  chain: [contract_roles.f.allowances, contract_erc20.f.balanceOf, contract_entry_point.f.getNonce],
  idempotency:
    "`store` returns the schedule already stored with the same signature, and the execution claim sends one operation once; a retry carries the same command and approvers.",
  timeoutMs: 600000,
  retries: { max: 9, backoff: "fixed" },
});

export const workflow_payments_schedules_store_board_scheduled = defineWorkflow({
  id: "payments.schedules.store-board-scheduled",
  title: "Store a Board's dated payment with Budgets' ids",
  about:
    "Registered as the internal action `payments/schedules:storeBoardScheduled` (CAP-1238, Protocol v4). Organizations' " +
    "proposal settlement schedules it with `runAfter(0)` when a `budget_schedule` proposal executed, which called " +
    "`Budgets.schedule` from the company Safe once per item. Attributed to the system job " +
    "`scheduled_payment_board_executed`. It loads the command's funding facts and stops (null) unless the command is dated " +
    "and routed through a budget. It then reads Budgets' newest scheduled ids down, 256 per run, matching each item's job " +
    "nonce on the command's budget: a page with none found schedules the next page below at once; a read that finds " +
    "them not all (or a chain read that failed) schedules a retry 30 seconds later, up to 10 runs, then stops silently. " +
    "Found: runs `payments.schedules.record-board-scheduled` with the ids, `sendsAt` and the window end. The schema has no " +
    "trigger for another concept's operation: the trigger names the settlement as a string. Timeout is Convex's action " +
    "limit; the code sets none.",
  was: [
    `${CONVEX}/schedules.ts:16`,
    `${SCHEDULES}/operations/board.ts:27`,
    `${SCHEDULES}/operations/board.ts:29`,
    `${SCHEDULES}/operations/board.ts:30`,
    `${SCHEDULES}/operations/board.ts:35`,
    `${SCHEDULES}/operations/board.ts:55`,
    `${SCHEDULES}/operations/board.ts:62`,
    `${SCHEDULES}/operations/board.ts:63`,
    `${SCHEDULES}/operations/board.ts:72`,
    `${SCHEDULES}/operations/board.ts:83`,
    `${SCHEDULES}/operations/board.ts:96`,
    `${SCHEDULES}/rules.ts:76`,
    `${SCHEDULES}/external/board-budgets.ts:20`,
    `${SCHEDULES}/external/board-budgets.ts:39`,
    `${SCHEDULES}/external/board-budgets.ts:60`,
    `${SCHEDULES}/external/board-budgets.ts:62`,
    `${SCHEDULES}/external/board-budgets.ts:77`,
    `${BACKEND}/src/organizations/proposals/writes/settlements.ts:105`,
    `${BACKEND}/src/organizations/proposals/writes/settlements.ts:106`,
  ],
  concept: concept_payments,
  priority: "normal",
  trigger: {
    indexer:
      "not the indexer: organizations.proposals.settle (a chain read of the Organization Safe) schedules it when a budget_schedule proposal executed",
  },
  steps: [
    { name: "attribute", about: "Records the run as the system job `scheduled_payment_board_executed`." },
    { name: "load-command", about: "Runs `payments.schedules.load-command`; stops with null unless the command is dated and on a budget route." },
    {
      name: "read-ids",
      about: "Reads `Budgets.scheduledCount`, then `scheduledOf` from the newest id (or below `below`) down, until every item's job nonce is found.",
    },
    { name: "next-page", about: "A page of 256 newer ids with none found: `runAfter(0)` with `below` set." },
    { name: "retry", about: "Not all found, or a chain read failed: `runAfter(30000)` with `tries + 1` while under 10 runs." },
    { name: "record", about: "Found: runs `payments.schedules.record-board-scheduled` and returns its answer." },
  ],
  reads: [table_payment_commands, table_payment_schedules, table_payments],
  writes: [table_payment_commands, table_payment_schedules, table_payments],
  drives: [
    machine_payment_command.t.to_submitted,
    machine_payment_command_verification.t.to_applied,
    machine_payment_schedule.t.to_waiting,
    machine_payment.t.to_settling,
  ],
  invokes: [procedure_payments_schedule_for_execution_in_tx, procedure_permissions_read_budget_allowance_in_tx],
  emits: [],
  calls: [integration_chain_rpc.c.fetchEthCall],
  chain: [contract_budgets.f.scheduledCount, contract_budgets.f.scheduledOf],
  idempotency:
    "`record-board-scheduled` answers `replayed` when the command completed or already has a schedule keyed by its id.",
  timeoutMs: 600000,
  retries: { max: 9, backoff: "fixed" },
});

export const workflow_payments_schedules_end_board_scheduled = defineWorkflow({
  id: "payments.schedules.end-board-scheduled",
  title: "Fail a Board's dated payment whose proposal ended",
  about:
    "Registered as the internal mutation `payments/schedules:endBoardScheduled`. Organizations' proposal settlement schedules " +
    "it with `runAfter(0)` when a `budget_schedule` proposal was rejected or replaced. It records the command's outcome as " +
    "`failed` with reason `scheduled_proposal_ended`: each Payment of the command fails (sending `payment_transitioned`, " +
    "and a bank payout's payout is cancelled), the command completes failed. A missing command is a no-op. The schema has " +
    "no trigger for another concept's operation: the trigger names the settlement as a string. Timeout is Convex's " +
    "mutation limit; the code sets none.",
  was: [
    `${CONVEX}/schedules.ts:13`,
    `${SCHEDULES}/operations/board.ts:128`,
    `${SCHEDULES}/operations/board.ts:134`,
    `${SCHEDULES}/writes.ts:257`,
    `${SCHEDULES}/writes.ts:267`,
    `${BACKEND}/src/organizations/proposals/writes/settlements.ts:69`,
    `${BACKEND}/src/organizations/proposals/writes/settlements.ts:73`,
    ...COMMAND_FAILED_WAS,
  ],
  concept: concept_payments,
  priority: "normal",
  trigger: {
    indexer:
      "not the indexer: organizations.proposals.settle (a chain read of the Organization Safe) schedules it when a budget_schedule proposal was rejected or replaced",
  },
  steps: [
    { name: "load", about: "Reads the payment command by id; none ends the run." },
    { name: "fail", about: "`recordPaymentCommandOutcome(command, \"failed\", { reasonCode: \"scheduled_proposal_ended\" })`." },
  ],
  reads: [table_payment_commands, table_payments, table_money_executions],
  writes: [table_payment_commands, table_payments],
  drives: [machine_payment.t.to_failed],
  invokes: [procedure_banking_payout_send_failed_in_tx],
  emits: [event_payment_transitioned],
  calls: [],
  chain: [],
  idempotency: "`recordPaymentCommandOutcome` does nothing for a command already completed or verified `applied`.",
  timeoutMs: 1000,
  retries: { max: 0, backoff: "none" },
});

export const workflow_payments_schedules_cancel_board_scheduled = defineWorkflow({
  id: "payments.schedules.cancel-board-scheduled",
  title: "Cancel a Board's dated payment after Budgets.cancel",
  about:
    "Registered as the internal mutation `payments/schedules:cancelBoardScheduled`. Organizations' proposal settlement " +
    "schedules it with `runAfter(0)` when a `budget_cancel` proposal executed `Budgets.cancel` (CAP-1238). The schedule " +
    "keyed by the command id becomes `cancelled` and a `cancelled` notice is scheduled; the command completes `failed` " +
    "(last outcome `superseded`) if it had not completed; each Payment takes `voided` (pending or settling to " +
    "cancelled). No money moved. The command and Payments are patched directly, outside the outcome writer and the " +
    "guarded Payment writer, and no `payment_transitioned` is sent. The schema has no trigger for another concept's " +
    "operation: the trigger names the settlement as a string. Timeout is Convex's mutation limit; the code sets none.",
  was: [
    `${CONVEX}/schedules.ts:12`,
    `${SCHEDULES}/operations/board.ts:149`,
    `${SCHEDULES}/operations/board.ts:155`,
    `${SCHEDULES}/writes/board-cancels.ts:19`,
    `${SCHEDULES}/writes/board-cancels.ts:25`,
    `${SCHEDULES}/writes/board-cancels.ts:27`,
    `${SCHEDULES}/writes/board-cancels.ts:32`,
    `${SCHEDULES}/writes/board-cancels.ts:39`,
    `${SCHEDULES}/writes/board-cancels.ts:46`,
    `${SCHEDULES}/writes/board-cancels.ts:49`,
    `${SRC}/rules/transitions.ts:125`,
    `${BACKEND}/src/organizations/proposals/writes/settlements.ts:111`,
    `${BACKEND}/src/organizations/proposals/writes/settlements.ts:112`,
  ],
  concept: concept_payments,
  priority: "normal",
  trigger: {
    indexer:
      "not the indexer: organizations.proposals.settle (a chain read of the Organization Safe) schedules it when a budget_cancel proposal executed",
  },
  steps: [
    { name: "load", about: "Reads the schedule keyed by the command id; anything not `waiting` ends the run." },
    { name: "cancel-schedule", about: "Patches the schedule `cancelled` and schedules the `cancelled` notice." },
    { name: "fail-command", about: "Patches the command `completionOutcome: failed`, `lastExecutionOutcome: superseded` when it had none." },
    { name: "void-payments", about: "Each Payment of the command that accepts `voided` is patched `cancelled`." },
  ],
  reads: [table_payment_schedules, table_payment_commands, table_payments],
  writes: [table_payment_schedules, table_payment_commands, table_payments],
  drives: [machine_payment_schedule.t.to_cancelled, machine_payment.t.to_cancelled],
  invokes: [procedure_payments_schedule_for_execution_in_tx],
  emits: [],
  calls: [],
  chain: [],
  idempotency: "`chainCancelledInTx` returns at once for a schedule that is missing or no longer `waiting`.",
  timeoutMs: 1000,
  retries: { max: 0, backoff: "none" },
});

// ── lifecycles ──────────────────────────────────────────────────────────────────────────────

/** What planning a lifecycle step reaches: retry source, reschedule birth, or one lifecycle command. */
const LIFECYCLE_PLAN_WAS = [
  `${LIFECYCLES}/guards.ts:14`,
  `${LIFECYCLES}/guards.ts:22`,
  `${LIFECYCLES}/guards.ts:24`,
  `${LIFECYCLES}/writes/commands.ts:32`,
  `${LIFECYCLES}/writes/commands.ts:37`,
  `${LIFECYCLES}/writes/commands.ts:51`,
  `${LIFECYCLES}/writes/commands.ts:65`,
  `${LIFECYCLES}/writes/commands.ts:93`,
  `${LIFECYCLES}/writes/commands.ts:104`,
  `${LIFECYCLES}/writes/commands.ts:117`,
  `${LIFECYCLES}/writes/commands.ts:123`,
  `${LIFECYCLES}/writes/commands.ts:124`,
  `${LIFECYCLES}/writes/commands.ts:137`,
  `${LIFECYCLES}/writes/commands.ts:147`,
  `${LIFECYCLES}/reads/retries.ts:147`,
  `${LIFECYCLES}/reads/retries.ts:151`,
  `${LIFECYCLES}/reads/retries.ts:158`,
  `${LIFECYCLES}/reads/retries.ts:200`,
  `${LIFECYCLES}/reads/reschedules.ts:66`,
  `${LIFECYCLES}/reads/reschedules.ts:81`,
  `${LIFECYCLES}/reads/reschedules.ts:91`,
  `${SRC}/commands/writes/commands.ts:104`,
  `${SRC}/commands/writes/commands.ts:146`,
  `${SRC}/commands/writes/commands.ts:190`,
  `${SRC}/commands/writes/commands.ts:202`,
  `${SRC}/commands/writes/commands.ts:223`,
  `${SRC}/commands/writes/commands.ts:240`,
  `${SRC}/commands/writes/commands.ts:249`,
  `${SRC}/commands/writes/items.ts:166`,
  `${SRC}/commands/writes/items.ts:173`,
  `${SRC}/commands/writes/documents.ts:61`,
  `${SRC}/commands/writes/documents.ts:90`,
  `${SRC}/commands/reads/recipients.ts:2`,
  `${SRC}/commands/reads/recipients.ts:3`,
  `${SRC}/commands/reads/recipients.ts:4`,
  `${SRC}/commands/reads/recipients.ts:5`,
  `${SRC}/commands/reads/recipients.ts:6`,
  `${SRC}/index.ts:106`,
  `${SRC}/index.ts:205`,
  `${SRC}/index.ts:206`,
];

/**
 * Tables the lifecycle plan touches: the Payment and its command and schedule, the execution a retry's state or a
 * void's route reads (lifecycles/reads/retries.ts:206, guards/voids.ts:47); a new command; a reschedule's birth.
 */
const LIFECYCLE_PLAN_READS = [
  table_payments,
  table_payment_commands,
  table_payment_schedules,
  table_payment_document_intents,
  table_money_executions,
];
const LIFECYCLE_PLAN_WRITES = [table_payment_commands, table_payments, table_payment_document_intents];

/**
 * What the lifecycle plan invokes: the caller's signer, the reschedule gate, a redirect's recipient
 * (resolved, then made a server recipient), and Payments' own door for the retry source, the
 * Account or Organization authority and the one command writer (whose births reach Documents,
 * Banking and Requests).
 */
const LIFECYCLE_PLAN_INVOKES = [
  procedure_accounts_require_account_signer_in_tx,
  procedure_access_require_feature,
  procedure_parties_resolve_recipient_in_tx,
  procedure_organizations_read_organizations_at_safe_in_tx,
  procedure_parties_ensure_payment_wallet_destination_in_tx,
  procedure_parties_resolve_owned_payment_wallet_safe_in_tx,
  procedure_accounts_resolve_account_recipient_safe_in_tx,
  procedure_accounts_find_account_recipient_in_tx,
  procedure_accounts_require_payment_account_in_tx,
  procedure_payments_load_payment_retry_source_in_tx,
  procedure_payments_server_payment_authority_in_tx,
  procedure_payments_prepare_payment_command_in_tx,
];

export const rpc_payments_lifecycles_prepare_intent = defineRpc({
  id: "payments.lifecycles.prepare-intent",
  title: "Plan the next step of one Payment",
  about:
    "Registered as the internal mutation `payments/lifecycles:prepareIntent`: the lifecycle prepare actions' transaction. " +
    "Decodes the intent and the optional scope strictly (excess properties refused INVALID_INPUT). A reschedule first " +
    "checks the `scheduled-payments` gate, unwrapped, so its FEATURE_NOT_AVAILABLE leaves this mutation. Then requires the " +
    "caller's own signer and plans: a retry replays its source command (refused unless it is the caller's to send, not " +
    "failed, and its stored documents still verify); a reschedule re-births the scheduled payment's birth with request " +
    "key `reschedule_<paymentId>` and the new date (a v4 budget's carries the Budgets ids it cancels first); a claim, " +
    "cancel or redirect prepares one lifecycle command, the Organization's Directors' for an Organization-funded cancel or " +
    "redirect; a cancel of a payment still waiting on its date is a `void_schedule`. The prepare core inserts the " +
    "`prepared` command and points its Payments at it (a void leaves them on the scheduled command); a birth writes a new " +
    "`pending` Payment. The signer must be the command's sender. The deeper invokes of the prepare core are the commands area's.",
  was: [
    `${CONVEX}/lifecycles.ts:3`,
    `${LIFECYCLES}/operations/prepare-intent.ts:24`,
    `${LIFECYCLES}/operations/prepare-intent.ts:36`,
    `${LIFECYCLES}/operations/prepare-intent.ts:50`,
    `${LIFECYCLES}/operations/prepare-intent.ts:57`,
    `${LIFECYCLES}/writes/transactions.ts:27`,
    `${SRC}/commands/writes/transactions.ts:26`,
    ...LIFECYCLE_PLAN_WAS,
  ],
  concept: concept_payments,
  kind: "mutation",
  who: "internal: `payments.lifecycles.prepare` and `payments.lifecycles.prepare-scoped`, for the signed-in caller.",
  input: Schema.Struct({
    authUserId: Schema.String,
    signerAddress: Schema.String,
    intent: LifecycleIntent,
    expectedScope: Schema.optionalKey(LifecycleScope),
  }),
  output: PlannedLifecycle,
  errors: [...INTENT_ERRORS, error_FEATURE_NOT_AVAILABLE],
  reads: LIFECYCLE_PLAN_READS,
  writes: LIFECYCLE_PLAN_WRITES,
  drives: [
    machine_payment_command.t.to_prepared,
    machine_payment_command_verification.t.to_not_started,
    machine_payment.t.to_pending,
  ],
  invokes: LIFECYCLE_PLAN_INVOKES,
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_payments_lifecycles_prepare_owners_void = defineRpc({
  id: "payments.lifecycles.prepare-owners-void",
  title: "Plan the Directors' void of a payment they scheduled",
  about:
    "Registered as the internal mutation `payments/lifecycles:prepareOwnersVoid` (ADR-0034 ruling 5A). Plans a cancel of the " +
    "Payment in the Organization's scope with request key `owners_void_<paymentId>` (asked again, the same void is " +
    "prepared and its approvals still count). It must come out a `void_schedule` sent from the Organization Safe; anything " +
    "else is refused INVALID_INPUT as not a payment the Directors scheduled. Returns the prepared void and the Payment's " +
    "`scheduledAt` (or now). The void is built by Organizations' Board cancel and sent once the Directors approve it.",
  was: [
    `${CONVEX}/lifecycles.ts:4`,
    `${LIFECYCLES}/operations/prepare-owners-void.ts:19`,
    `${LIFECYCLES}/operations/prepare-owners-void.ts:30`,
    `${LIFECYCLES}/operations/prepare-owners-void.ts:34`,
    `${LIFECYCLES}/operations/prepare-owners-void.ts:36`,
    `${LIFECYCLES}/operations/prepare-owners-void.ts:43`,
    `${LIFECYCLES}/operations/prepare-owners-void.ts:51`,
    `${LIFECYCLES}/operations/prepare-owners-void.ts:63`,
    `${SRC}/commands/external/owners.ts:49`,
    `${BACKEND}/src/organizations/proposals/operations/cancel-scheduled.ts:13`,
    `${BACKEND}/src/organizations/proposals/operations/cancel-scheduled.ts:73`,
    `${SRC}/commands/errors.ts:81`,
    `${LIFECYCLES}/writes/commands.ts:93`,
    `${LIFECYCLES}/writes/commands.ts:117`,
    `${LIFECYCLES}/writes/commands.ts:137`,
    `${SRC}/commands/writes/commands.ts:223`,
  ],
  concept: concept_payments,
  kind: "mutation",
  who:
    "internal: Organizations' Board cancel of a scheduled payment when Protocol v4 is not configured, through " +
    "`ownersVoidExecution` (imported from payments/commands/external/owners.ts, not the door); any Director. No signer " +
    "check runs here: it calls the lifecycle planner directly, not `preparePaymentLifecycleExecutionInTx`.",
  input: Schema.Struct({ authUserId: Schema.String, orgId: Schema.String, paymentId: Schema.String }),
  output: Schema.Struct({ prepared: Schema.Unknown, sendsAt: Schema.Number }),
  errors: INTENT_ERRORS,
  reads: [table_payments, table_payment_commands, table_payment_schedules, table_money_executions],
  writes: [table_payment_commands],
  drives: [machine_payment_command.t.to_prepared, machine_payment_command_verification.t.to_not_started],
  invokes: [
    procedure_organizations_read_organization_safe_in_tx,
    procedure_payments_server_payment_authority_in_tx,
    procedure_payments_prepare_payment_command_in_tx,
  ],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

const LIFECYCLE_PREPARED_WAS = [
  `${LIFECYCLES}/external.ts:20`,
  `${LIFECYCLES}/external.ts:26`,
  `${LIFECYCLES}/external.ts:27`,
  `${LIFECYCLES}/external.ts:28`,
  `${LIFECYCLES}/external.ts:30`,
  `${LIFECYCLES}/external.ts:32`,
  `${LIFECYCLES}/external.ts:55`,
  `${LIFECYCLES}/external.ts:57`,
  `${LIFECYCLES}/writes/transactions.ts:16`,
  `${LIFECYCLES}/writes/transactions.ts:26`,
  `${SRC}/commands/reads/contexts.ts:5`,
  `${SRC}/commands/events.ts:10`,
  ...BUILD_WAS,
  ...LIFECYCLE_PLAN_WAS,
];

const LIFECYCLE_PREPARED_ABOUT =
  "Both lifecycle prepare rows run `lifecyclePrepared`, under `withChain`: the signed-in session; " +
  "`payments.lifecycles.prepare-intent` in its own transaction (only INTENT_FAILURES admitted, so a reschedule's " +
  "FEATURE_NOT_AVAILABLE gate refusal arrives as a defect, and FEATURE_NOT_AVAILABLE is not on the row); the command's " +
  "context (an Organization's is attributed); then the build: the Roles module and Budget admission (a module not " +
  "admitted, or a Budget that cannot cover a new birth, fails the prepared command through " +
  "`payments.commands.fail-prepared`), `payments.executions.load-active`, `payments.commands.link-observation` (the " +
  "authority guard again), a lapsed live Attempt classified from proof (`payments.executions.classify`), the scan " +
  "floor, the own lane, the sender's ERC-20 balance for an undated birth (short: fail-prepared, INSUFFICIENT_BALANCE), " +
  "fees and paymaster sponsorship, `payments.executions.store`; a succeeded execution is replayed through " +
  "`payments.executions.complete`. `payments.commands.claim-initiated` never runs here: it runs only for a request " +
  "with `items` (executions/external/builds.ts:271) and a lifecycle intent has none, so `emitPaymentInitiated` is " +
  "always false. Returns the prepared execution the signer signs, with the retry source or lifecycle source. Nothing " +
  "is sent.";

/** The lifecycle prepare actions' touches: the plan's, then the build's internal steps (executions.ts, commands.ts). */
const LIFECYCLE_PREPARED_TOUCHES = {
  reads: uniq([...LIFECYCLE_PLAN_READS, ...PROJECTION_READS]),
  writes: [...LIFECYCLE_PLAN_WRITES, table_money_executions],
  drives: [
    machine_payment_command.t.to_prepared,
    machine_payment_command.t.to_submitted,
    machine_payment_command_verification.t.to_not_started,
    machine_payment.t.to_pending,
    machine_payment.t.to_settling,
    machine_payment.t.to_failed,
    machine_money_execution.t.to_prepared,
    machine_money_execution.t.to_expired,
    machine_money_execution.t.to_displaced,
    machine_money_execution.t.to_succeeded,
    machine_money_execution.t.to_reverted,
  ],
  invokes: uniq([
    ...LIFECYCLE_PLAN_INVOKES,
    ...SUBMISSION_AUTHORITY,
    procedure_accounts_read_execution_approval_in_tx,
    procedure_permissions_read_budget_allowance_in_tx,
    procedure_banking_payout_send_failed_in_tx,
    procedure_payroll_advance_runs_to_authorized,
    ...COMMAND_WIRE_INVOKES,
  ]),
  emits: [event_payment_transitioned],
  calls: BUILD_CALLS,
  chain: [contract_budgets.f.leftOf, contract_roles.f.allowances, contract_erc20.f.balanceOf, contract_entry_point.f.getNonce],
};

export const rpc_payments_lifecycles_prepare = defineRpc({
  id: "payments.lifecycles.prepare",
  title: "Prepare the next step of a Payment",
  about:
    "Implements the protocol row `payments.lifecycles.prepare`, registered as the public action " +
    "`payments/lifecycles:prepare`. " +
    LIFECYCLE_PREPARED_ABOUT,
  was: [`${CONVEX}/lifecycles.ts:6`, `${LIFECYCLES}/operations/prepare.ts:7`, `${PROTOCOL}/operations.ts:190`, ...LIFECYCLE_PREPARED_WAS],
  concept: concept_payments,
  kind: "action",
  who:
    "A signed-in caller with its own signer. A claim, and a personal cancel or redirect, is the caller's own Account's; an " +
    "Organization-funded cancel or redirect is its Directors'; a retry is whoever may send its source command (the " +
    "submission authority guard); a reschedule is its first signer's.",
  input: Schema.Struct({ signerAddress: Schema.String, intent: LifecycleIntent }),
  output: PreparedPaymentCommandExecution,
  errors: PREPARE_ERRORS,
  ...LIFECYCLE_PREPARED_TOUCHES,
  spans: [],
});

export const rpc_payments_lifecycles_prepare_scoped = defineRpc({
  id: "payments.lifecycles.prepare-scoped",
  title: "Prepare the next step of a Payment in a named scope",
  about:
    "Implements the protocol row `payments.lifecycles.prepareScoped`, registered as the public action " +
    "`payments/lifecycles:prepareScoped`: the same as `payments.lifecycles.prepare`, refused unless the Payment belongs " +
    "to the scope the caller names (its Account, or an Organization). " +
    LIFECYCLE_PREPARED_ABOUT,
  was: [
    `${CONVEX}/lifecycles.ts:5`,
    `${LIFECYCLES}/operations/prepare-scoped.ts:7`,
    `${PROTOCOL}/operations.ts:197`,
    `${PROTOCOL}/schema/executions.ts:232`,
    ...LIFECYCLE_PREPARED_WAS,
  ],
  concept: concept_payments,
  kind: "action",
  who:
    "A signed-in caller with its own signer, for a Payment of the scope it names: its own Account's, or an Organization whose " +
    "Directors it acts for (cancel or redirect), or whoever may send a retry's source command; a reschedule is its " +
    "first signer's.",
  input: Schema.Struct({ signerAddress: Schema.String, intent: LifecycleIntent, expectedScope: LifecycleScope }),
  output: PreparedPaymentCommandExecution,
  errors: PREPARE_ERRORS,
  ...LIFECYCLE_PREPARED_TOUCHES,
  spans: [],
});

export const rpc_payments_lifecycles_preview_retry = defineRpc({
  id: "payments.lifecycles.preview-retry",
  title: "Preview what retrying an Organization's Payment would send",
  about:
    "Implements the protocol row `payments.lifecycles.previewRetry`, registered as the public query " +
    "`payments/lifecycles:previewRetry`. Requires a signed-in participant of the Organization, then reads the retry source " +
    "exactly as a retry admits it: the Payment must be the Organization's own (`participantPayment`: the Payment row " +
    "and its participants, no scope read), its command the caller's to send (the " +
    "submission authority guard), not failed, and its stored documents must verify for the caller. Each Payment of the " +
    "source command is projected from its own saved instruction, whose documents must all verify. Returns the command, " +
    "its Permission, its Payment ids in saved order and the wire Payments. Nothing is written.",
  was: [
    `${CONVEX}/lifecycles.ts:7`,
    `${LIFECYCLES}/operations/preview-retry.ts:10`,
    `${LIFECYCLES}/operations/preview-retry.ts:12`,
    `${LIFECYCLES}/operations/preview-retry.ts:13`,
    `${LIFECYCLES}/reads/previews.ts:30`,
    `${LIFECYCLES}/reads/previews.ts:37`,
    `${LIFECYCLES}/reads/previews.ts:46`,
    `${LIFECYCLES}/reads/previews.ts:64`,
    `${LIFECYCLES}/reads/previews.ts:77`,
    `${LIFECYCLES}/reads/previews.ts:82`,
    `${LIFECYCLES}/reads/previews.ts:111`,
    `${LIFECYCLES}/reads/retries.ts:147`,
    `${LIFECYCLES}/reads/retries.ts:151`,
    `${LIFECYCLES}/reads/retries.ts:158`,
    `${LIFECYCLES}/reads/retries.ts:200`,
    `${SRC}/records/guards.ts:27`,
    `${SRC}/records/guards.ts:33`,
    `${SRC}/reads/payments.ts:51`,
    `${PROTOCOL}/operations.ts:204`,
    `${PROTOCOL}/schema/executions.ts:241`,
    `${SRC}/views/payments.ts:17`,
    `${SRC}/views/payments.ts:18`,
    `${SRC}/views/payments.ts:25`,
    `${SRC}/views/payments.ts:198`,
  ],
  concept: concept_payments,
  kind: "query",
  who: "A signed-in participant of the Organization whose Payment it is, admitted as a retry of its source command would be.",
  input: Schema.Struct({ orgId: Schema.String, paymentId: Schema.String }),
  output: Schema.Struct({
    orgId: Schema.String,
    commandId: Schema.String,
    permissionId: Schema.NullOr(Schema.String),
    paymentIds: Schema.Array(Schema.String),
    payments: Schema.Array(Schema.Unknown),
  }),
  errors: [
    error_NOT_AUTHENTICATED,
    error_INVALID_INPUT,
    error_UNKNOWN,
    error_ENV_MISSING,
    error_ROLE_PERMISSION_DENIED,
    error_WRONG_STATE,
  ],
  reads: [...PROJECTION_READS],
  writes: [],
  drives: [],
  invokes: [
    procedure_organizations_require_org_participant,
    procedure_payments_load_payment_retry_source_in_tx,
    procedure_documents_load_payment_documents,
    procedure_documents_verify_payment_document_reference,
    ...TO_WIRE_INVOKES,
  ],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});
