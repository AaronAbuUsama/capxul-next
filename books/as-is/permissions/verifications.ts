// The as-is book of the old permissions/verifications area: every operation in
// packages/backend/src/permissions/verifications/operations/, registered at
// `permissions/verifications:<name>` (packages/backend/convex/permissions/verifications.ts).
//
// verify implements the public row `permissions.verifications.verify`. verifySubmitted and retry are
// internal actions the old code schedules (ctx.scheduler.runAfter), so they are workflows; record,
// recordAttempt, load and loadForRetry are the internal mutations and queries every verify action
// runs through ctx.runMutation / ctx.runQuery, so they are internal rpcs. An action's touches are the
// union of what its mutation steps touch. The concept-level writes they run (writes/verifications.ts,
// writes/applications.ts, writes/states.ts, writes/suspensions.ts, writes/receipts.ts,
// writes/replacements.ts) are steps, booked through these records.

import { Schema } from "effect";
import { defineRpc, defineWorkflow } from "../../../packages/book/src/index.ts";

import { concept_permissions } from "../shared/foundation.ts";
import {
  error_ACCOUNT_NOT_FOUND,
  error_ENV_MISSING,
  error_INVALID_INPUT,
  error_NOT_AUTHENTICATED,
  error_NOT_IMPLEMENTED,
  error_PROVIDER_ERROR,
  error_SMART_ACCOUNT_MISSING,
  error_UNKNOWN,
  error_WRONG_STATE,
  event_permission_mirror_verification,
} from "../shared/vocabulary.ts";
import { integration_chain_evidence } from "../shared/external.ts";
import {
  machine_permission,
  machine_permission_assignment,
  machine_permission_command,
  table_permission_assignments,
  table_permission_commands,
  table_permission_receipts,
  table_permissions,
} from "./data.ts";
import { table_money_executions } from "../payments/data.ts";
import { procedure_payments_close_verified_command_execution_in_tx } from "../payments/procedures.ts";
import {
  procedure_organizations_read_replaced_invitation_offer_in_tx,
  procedure_organizations_read_replacement_invitation_offers_in_tx,
  procedure_organizations_read_subject_proposal_in_tx,
  procedure_organizations_record_member_permission_application_in_tx,
  procedure_organizations_replace_invitation_offer_generation_in_tx,
} from "../organizations/procedures.ts";
import {
  procedure_accounts_read_attached_account_for_safe_in_tx,
  procedure_accounts_require_exact_account_identity_in_tx,
} from "../accounts/procedures.ts";
import { rpc_permissions_commands_complete_execution } from "./commands.ts";

const V = "packages/backend/src/permissions/verifications";
const P = "packages/backend/src/permissions";
const CONVEX = "packages/backend/convex/permissions/verifications.ts";

const S = Schema.String;
const N = Schema.Number;
const B = Schema.Boolean;
const U = Schema.Unknown;
const opt = Schema.optionalKey;

// ── shapes ──────────────────────────────────────────────────────────────────────────────────

/** `VerifyPermissionReceiptResultSchema` (protocol permissions/receipt-schema.ts:83). Receipts and events are deep: Unknown. */
const Verification = Schema.Union([
  Schema.Struct({ status: Schema.Literal("pending"), reason: Schema.Literal("receipt_missing") }),
  Schema.Struct({ status: Schema.Literal("verified"), commandId: S, receipt: U, events: Schema.Array(U), factsHash: S }),
  Schema.Struct({ status: Schema.Literal("mismatch"), code: S, receipt: opt(U) }),
  Schema.Struct({ status: Schema.Literal("provider_failure"), retryable: Schema.Literal(true) }),
]);

/** `ApplyPermissionMirrorResultSchema` (receipt-schema.ts:107). */
const Apply = Schema.Union([
  Schema.Struct({ status: Schema.Literals(["applied", "replayed"]), revision: N }),
  Schema.Struct({ status: Schema.Literals(["revision_mismatch", "conflicting_replay"]) }),
]);

/** `PermissionVerificationResultSchema` (receipt-schema.ts:124): the receipt's verdict, with the applied value when verified. */
const VerificationResult = Schema.Union([
  Schema.Struct({ status: Schema.Literal("pending"), reason: Schema.Literal("receipt_missing") }),
  Schema.Struct({ status: Schema.Literal("mismatch"), code: S, receipt: opt(U) }),
  Schema.Struct({ status: Schema.Literal("provider_failure"), retryable: Schema.Literal(true) }),
  Schema.Struct({ status: Schema.Literal("verified"), verification: U, apply: Apply, value: U }),
]);

/** `LoadedPermissionCommand` (model.ts:263): a stored ordinary command plus its allowance expectations. Deep: Unknown. */
const LoadedCommand = U;

// ── what the record mutation touches (lists spread into the records below) ─────────────────

/** recordAttempt: the submission marker, and what a change, revoke or replacement suspends. */
const ATTEMPT_READS = [table_permission_commands, table_permission_receipts, table_permissions, table_permission_assignments];
const ATTEMPT_WRITES = [table_permission_receipts, table_permissions, table_permission_assignments];
const ATTEMPT_DRIVES = [machine_permission.t.to_suspended, machine_permission_assignment.t.to_suspended];

/**
 * record: mayRecord reads payments' moneyExecutions directly; a refusal keeps mismatch evidence and moves the command;
 * a verified receipt applies the command's state (applyCommandState), appends its receipts, and for a replacement
 * moves each carried invitation to its next generation, inserting its configure, grant and cleanup commands.
 */
const RECORD_READS = [table_permission_commands, table_permission_receipts, table_money_executions, table_permissions, table_permission_assignments];
const RECORD_WRITES = [table_permission_commands, table_permission_receipts, table_permissions, table_permission_assignments];
const RECORD_DRIVES = [
  machine_permission_command.t.to_mismatch,
  machine_permission_command.t.to_pending,
  machine_permission_command.t.to_applied,
  machine_permission.t.to_active,
  machine_permission.t.to_suspended,
  machine_permission.t.to_superseded,
  machine_permission_assignment.t.to_active,
  machine_permission_assignment.t.to_suspended,
  machine_permission_assignment.t.to_revoked,
  machine_permission_assignment.t.to_superseded,
];
const RECORD_INVOKES = [
  procedure_payments_close_verified_command_execution_in_tx,
  procedure_organizations_record_member_permission_application_in_tx,
  procedure_organizations_read_replacement_invitation_offers_in_tx,
  procedure_organizations_replace_invitation_offer_generation_in_tx,
  procedure_organizations_read_replaced_invitation_offer_in_tx,
  procedure_accounts_read_attached_account_for_safe_in_tx,
];
const RECORD_ERRORS = [error_INVALID_INPUT, error_WRONG_STATE, error_UNKNOWN];

const VERIFY_STEPS = [
  { name: "note-attempt", about: "permissions.verifications.record-attempt: the UserOperation is the command's submission evidence." },
  { name: "read-receipt", about: "chain-evidence verifyPermission(command, userOpHash, allowanceExpectations): verified, mismatch, pending or provider_failure." },
  {
    name: "record",
    about:
      "permissions.verifications.record; when it fails, record again with applicationFailed, and annotate the wide event if that fails too, then propagate.",
  },
  { name: "report", about: "permission_mirror_verification for the person behind the command, with outcome, reason, retry_count and the application result." },
  { name: "answer", about: "The verdict; a verified receipt with no recorded application is UNKNOWN (applicationMissing)." },
];

const VERIFY_WAS = [
  `${V}/writes.ts:199`,
  `${V}/writes.ts:142`,
  `${V}/writes.ts:158`,
  `${V}/external.ts:11`,
  `${V}/events.ts:29`,
  `${V}/views.ts:15`,
  `${P}/events.ts:36`,
  `${P}/events.ts:104`,
];

// ── rpc: load ───────────────────────────────────────────────────────────────────────────────

export const rpc_permissions_verifications_load = defineRpc({
  id: "permissions.verifications.load",
  title: "Load the caller's own command for a verification",
  about:
    "loadOwned: the caller's exact Account and Safe, exactly one ordinary command with the id, and the caller's own: sent " +
    "from their Safe, or originated by them and carried by a Director proposal (readSubjectProposalInTx). Anything else is " +
    "INVALID_INPUT (commandMissing). Returns the stored command with the setAllowance positions of its own expectation " +
    "(storedCommand), INVALID_INPUT when a stored row does not read back.",
  was: [`${V}/operations/load.ts:9`, `${V}/reads.ts:30`, `${P}/reads/commands.ts:45`, `${P}/rules/commands.ts:32`, `${CONVEX}:6`],
  concept: concept_permissions,
  kind: "query",
  who: "internal: the verify action (permissions.verifications.verify), through ctx.runQuery (verifications/reads.ts:77).",
  input: Schema.Struct({ authUserId: S, commandId: S }),
  output: LoadedCommand,
  errors: [error_INVALID_INPUT, error_SMART_ACCOUNT_MISSING, error_ACCOUNT_NOT_FOUND],
  reads: [table_permission_commands],
  writes: [],
  drives: [],
  invokes: [procedure_accounts_require_exact_account_identity_in_tx, procedure_organizations_read_subject_proposal_in_tx],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

// ── rpc: load-for-retry ─────────────────────────────────────────────────────────────────────

export const rpc_permissions_verifications_load_for_retry = defineRpc({
  id: "permissions.verifications.load-for-retry",
  title: "Load any stored command for scheduled verification",
  about:
    "loadScheduled: the first command row with the id, whoever's it is; none, or one that is not an ordinary command, is " +
    "INVALID_INPUT (commandMissing).",
  was: [`${V}/operations/load-for-retry.ts:9`, `${V}/reads.ts:55`, `${CONVEX}:7`],
  concept: concept_permissions,
  kind: "query",
  who: "internal: the verify-submitted and retry actions, through ctx.runQuery (verifications/reads.ts:86).",
  input: Schema.Struct({ commandId: S }),
  output: LoadedCommand,
  errors: [error_INVALID_INPUT],
  reads: [table_permission_commands],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

// ── rpc: record-attempt ─────────────────────────────────────────────────────────────────────

export const rpc_permissions_verifications_record_attempt = defineRpc({
  id: "permissions.verifications.record-attempt",
  title: "Note the UserOperation a verification is about to read",
  about:
    "recordPermissionSubmission: appends the submission marker (factsHash `submitted`) once per UserOperation and, unless " +
    "the command is applied, suspends what it changes (a change's active revision, a revoke's active assignment, a " +
    "replacement's active rows on the old module). A missing command records nothing; an invitation command is " +
    "INVALID_INPUT (ordinaryCommandRequired). Returns null.",
  was: [`${V}/operations/record-attempt.ts:10`, `${V}/writes.ts:30`, `${P}/writes/commands.ts:217`, `${P}/writes/receipts.ts:163`, `${P}/writes/suspensions.ts:84`, `${CONVEX}:9`],
  concept: concept_permissions,
  kind: "mutation",
  who: "internal: every verify action, before it reads the chain (verifications/writes.ts:142).",
  input: Schema.Struct({ commandId: S, userOpHash: S }),
  output: Schema.Null,
  errors: [error_INVALID_INPUT],
  reads: ATTEMPT_READS,
  writes: ATTEMPT_WRITES,
  drives: ATTEMPT_DRIVES,
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

// ── rpc: record ─────────────────────────────────────────────────────────────────────────────

export const rpc_permissions_verifications_record = defineRpc({
  id: "permissions.verifications.record",
  title: "Record one verification result and apply a verified receipt",
  about:
    "Decodes the result strictly (INVALID_INPUT), requires a retry count from 0 to 8, a bytes32 hash and a result that " +
    "names this command and UserOperation (INVALID_INPUT). mayRecordVerificationOutcome refuses attempts sent from another " +
    "Safe, chain or person (INVALID_INPUT) and records nothing for a late result of an older attempt, an applied command " +
    "with verified receipts, or a lower retry count. With applicationFailed it records the outcome as application_failure " +
    "and stops. When the caller passed a retry count, a pending or provider_failure result schedules " +
    "permissions.verifications.retry (1 s x 2^n, at most 30 s, 8 times) for the command's stored origin (INVALID_INPUT " +
    "when none). A mismatch appends its evidence and, while recoverable, moves the command to mismatch and closes its " +
    "payments execution; pending or provider_failure re-marks a recoverable command pending. A verified receipt runs " +
    "applyVerifiedResult: a matching replay closes the execution and answers replayed; a stale generation, a claimed " +
    "event or a conflict answers conflicting_replay; else it applies the command's state (revision_mismatch when the rows " +
    "moved), appends the receipts, applies a replacement's invitations (each invitation's next generation, its configure " +
    "command born applied, its grant or cleanup commands, a permissions.grants.drive scheduled for each; a missing " +
    "DisabledModule event or snapshot change is INVALID_INPUT), marks the command applied, closes the execution and, for " +
    "an assign, records the member's application in Organizations. verificationOutcome keeps the last attempt.",
  was: [
    `${V}/operations/record.ts:18`,
    `${V}/rules.ts:17`,
    `${V}/rules.ts:29`,
    `${V}/rules.ts:59`,
    `${P}/rules/retries.ts:31`,
    `${V}/writes.ts:47`,
    `${V}/writes.ts:57`,
    `${V}/writes.ts:70`,
    `${V}/writes.ts:92`,
    `${P}/writes/verifications.ts:22`,
    `${P}/writes/verifications.ts:75`,
    `${P}/writes/verifications.ts:104`,
    `${P}/writes/applications.ts:20`,
    `${P}/writes/replacements.ts:37`,
    `${P}/writes/replacements.ts:89`,
    `${CONVEX}:8`,
  ],
  concept: concept_permissions,
  kind: "mutation",
  who: "internal: every verify action's recordResult, through ctx.runMutation (verifications/writes.ts:158).",
  input: Schema.Struct({
    commandId: S,
    userOpHash: S,
    verification: Verification,
    retryCount: opt(N),
    authUserId: opt(S),
    applicationFailed: opt(B),
  }),
  output: Schema.NullOr(Schema.Struct({ apply: Apply, value: U })),
  errors: RECORD_ERRORS,
  reads: RECORD_READS,
  writes: RECORD_WRITES,
  drives: RECORD_DRIVES,
  invokes: RECORD_INVOKES,
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

// ── rpc: verify (public) ────────────────────────────────────────────────────────────────────

export const rpc_permissions_verifications_verify = defineRpc({
  id: "permissions.verifications.verify",
  title: "Verify the caller's own submitted command and apply it",
  about:
    "Signed in (signedInAction); load reads the caller's own command and names its Organization to telemetry; then one " +
    "verifyAndRecord with retry count 0: note the attempt, read the receipt through chain-evidence, record it (a missing " +
    "or unreadable receipt schedules the bounded retry workflow), report permission_mirror_verification and answer the " +
    "verdict with the applied Permission when the receipt proved it. The row declares NOT_IMPLEMENTED (money writes off) " +
    "and PROVIDER_ERROR.",
  was: [`${V}/operations/verify.ts:13`, ...VERIFY_WAS, "packages/protocol/src/permissions/operations.ts:157", `${CONVEX}:11`],
  concept: concept_permissions,
  kind: "action",
  who:
    "A signed-in person whose own command it is: sent from their own Safe, or proposed by them and carried by a Director " +
    "proposal (Budgets A).",
  input: Schema.Struct({ commandId: S, userOpHash: S }),
  output: VerificationResult,
  errors: [
    error_NOT_AUTHENTICATED,
    error_INVALID_INPUT,
    error_SMART_ACCOUNT_MISSING,
    error_ACCOUNT_NOT_FOUND,
    error_WRONG_STATE,
    error_PROVIDER_ERROR,
    error_NOT_IMPLEMENTED,
    error_UNKNOWN,
    error_ENV_MISSING,
  ],
  reads: RECORD_READS,
  writes: RECORD_WRITES,
  drives: [...RECORD_DRIVES],
  invokes: [
    procedure_accounts_require_exact_account_identity_in_tx,
    procedure_organizations_read_subject_proposal_in_tx,
    ...RECORD_INVOKES,
  ],
  emits: [event_permission_mirror_verification],
  calls: [integration_chain_evidence.c.verifyPermission],
  chain: [],
  spans: [],
});

// ── workflow: verify-submitted ──────────────────────────────────────────────────────────────

export const workflow_permissions_verifications_verify_submitted = defineWorkflow({
  id: "permissions.verifications.verify-submitted",
  title: "Verify a submitted Permission command under its origin",
  about:
    "An internal action scheduled with runAfter(0) when a command's submission completes " +
    "(permissions.commands.complete-execution) and when a Director proposal carrying it executes " +
    "(permissions.record-proposed-permission-execution-in-tx); payments' execution recovery also runs it directly " +
    "(payments/executions/external/recoveries.ts:144). It loads the command, acts for its originating person (the " +
    "scheduled caller only for a command written before the origin field), requires a bytes32 hash and runs one " +
    "verifyAndRecord at retry count 0. A pending or provider_failure result chains into the retry workflow. timeoutMs is " +
    "Convex's action limit; the code sets none.",
  was: [`${V}/operations/verify-submitted.ts:15`, `${V}/events.ts:19`, `${V}/rules.ts:23`, ...VERIFY_WAS, `${P}/writes/proposal-outcomes.ts:56`, `${CONVEX}:12`],
  concept: concept_permissions,
  priority: "critical",
  trigger: { after: rpc_permissions_commands_complete_execution },
  instance: { per: table_permission_commands },
  steps: [
    { name: "load", about: "permissions.verifications.load-for-retry: the command, whoever's it is." },
    { name: "acting-for", about: "Telemetry signs in the command's originatingAuthUserId (else the scheduled caller) in its Organization." },
    { name: "hash", about: "The userOpHash must be bytes32 (INVALID_INPUT, invalidAttempt)." },
    ...VERIFY_STEPS,
  ],
  reads: RECORD_READS,
  writes: RECORD_WRITES,
  drives: [...RECORD_DRIVES],
  invokes: RECORD_INVOKES,
  emits: [event_permission_mirror_verification],
  calls: [integration_chain_evidence.c.verifyPermission],
  chain: [],
  idempotency:
    "mayRecordVerificationOutcome: a late result of an older attempt, an applied command with verified receipts, a lower retry count or an already verified outcome records nothing; applyVerifiedResult answers a matching verified receipt as replayed",
  timeoutMs: 600000,
  retries: { max: 8, backoff: "exponential" },
});

// ── workflow: retry ─────────────────────────────────────────────────────────────────────────

export const workflow_permissions_verifications_retry = defineWorkflow({
  id: "permissions.verifications.retry",
  title: "Retry a missing or unreadable Permission receipt",
  about:
    "An internal action the record mutation schedules for the command's stored origin when a receipt was pending or the " +
    "provider failed: delay min(1 s x 2^n, 30 s), retry counts 1 to 8 (rules/retries.ts:31). It loads the command, acts " +
    "for its origin, requires a count from 1 to 8 and a bytes32 hash (INVALID_INPUT, invalidRetry) and runs one " +
    "verifyAndRecord at that count; its record schedules the next rung until the eighth, after which the outcome says " +
    "`exhausted`. timeoutMs is Convex's action limit; the code sets none.",
  was: [`${V}/operations/retry.ts:15`, `${V}/rules.ts:50`, `${V}/writes.ts:92`, `${P}/rules/retries.ts:31`, ...VERIFY_WAS, `${CONVEX}:10`],
  concept: concept_permissions,
  priority: "normal",
  trigger: { after: rpc_permissions_verifications_record },
  instance: { per: table_permission_commands },
  waits: [
    {
      name: "backoff",
      for: "timer",
      about: "runAfter(min(1000 x 2^retryCount, 30000) ms) from the record mutation that saw the receipt missing.",
    },
  ],
  steps: [
    { name: "load", about: "permissions.verifications.load-for-retry." },
    { name: "acting-for", about: "Telemetry signs in the command's origin in its Organization." },
    { name: "retry-input", about: "Count 1 to 8 and a bytes32 hash, else INVALID_INPUT (invalidRetry)." },
    ...VERIFY_STEPS,
  ],
  reads: RECORD_READS,
  writes: RECORD_WRITES,
  drives: [...RECORD_DRIVES],
  invokes: RECORD_INVOKES,
  emits: [event_permission_mirror_verification],
  calls: [integration_chain_evidence.c.verifyPermission],
  chain: [],
  idempotency:
    "the retry count: mayRecordVerificationOutcome records nothing for a count lower than the recorded one or for an outcome already verified",
  timeoutMs: 600000,
  retries: { max: 8, backoff: "exponential" },
});
