// The as-is book of the old permissions/configurations area: every operation in
// packages/backend/src/permissions/configurations/operations/, registered at
// `permissions/configurations:<name>` (packages/backend/convex/permissions/configurations.ts). The
// inviter configures an invitation's rights: the configure command's calls set up the granter's
// technical roles (and any new Budget the invitation creates) on the Organization's Roles module.
//
// propose, prepareExecution and submitExecution implement the public rows
// (`configurations` in packages/protocol/src/permissions/operations.ts). verify is an internal action
// the old code schedules, so it is a workflow; prepareIntent, proposeIntent, completeExecution, record
// and load are internal rpcs. The area's guards, reads, rules, views and writes are steps, booked
// through these records.

import { Schema } from "effect";
import { defineRpc, defineWorkflow } from "../../../packages/book/src/index.ts";

import { concept_permissions } from "../shared/foundation.ts";
import {
  error_ACCOUNT_NOT_FOUND,
  error_ENV_MISSING,
  error_INVALID_INPUT,
  error_NOT_AUTHENTICATED,
  error_PROVIDER_ERROR,
  error_PROVIDER_RESPONSE_INVALID,
  error_ROLE_PERMISSION_DENIED,
  error_SMART_ACCOUNT_MISSING,
  error_SUPERSEDED,
  error_UNKNOWN,
  error_WRONG_STATE,
  event_permission_mirror_verification,
} from "../shared/vocabulary.ts";
import { integration_chain_evidence, integration_chain_rpc } from "../shared/external.ts";
import {
  machine_permission,
  machine_permission_command,
  table_permission_assignments,
  table_permission_commands,
  table_permission_receipts,
  table_permissions,
} from "./data.ts";
import { procedure_permissions_read_owner_roles_module_in_tx, procedure_permissions_require_command_authority } from "./procedures.ts";
import { table_money_executions } from "../payments/data.ts";
import {
  procedure_payments_admit_invitation_configuration_acceptance_in_tx,
  procedure_payments_close_verified_command_execution_in_tx,
  procedure_payments_record_command_execution_acceptance_in_tx,
} from "../payments/procedures.ts";
import {
  procedure_organizations_authorize_invitation_offer_in_tx,
  procedure_organizations_deliver_invitation_outcome,
  procedure_organizations_read_authorizing_invitation_offer_in_tx,
  procedure_organizations_read_configuration_invitation_offer_in_tx,
  procedure_organizations_read_subject_proposal_in_tx,
  procedure_organizations_record_owner_proposal_in_tx,
  procedure_organizations_require_safe_owner,
  procedure_organizations_schedule_invite_progressed,
} from "../organizations/procedures.ts";
import {
  procedure_accounts_require_account_signer_in_tx,
  procedure_accounts_require_exact_account_identity_in_tx,
} from "../accounts/procedures.ts";
import { table_org_lifecycles, table_orgs } from "../organizations/data.ts";

const C = "packages/backend/src/permissions/configurations";
const P = "packages/backend/src/permissions";
const ROW = "packages/protocol/src/permissions/operations.ts";
const CONVEX = "packages/backend/convex/permissions/configurations.ts";

const S = Schema.String;
const N = Schema.Number;
const U = Schema.Unknown;
const opt = Schema.optionalKey;

// ── shapes ──────────────────────────────────────────────────────────────────────────────────

/** `OwnerProposalFacts` (organizations proposals/guards): what requireSafeOwner proved on chain. */
const OwnerFacts = Schema.Struct({ orgId: S, chainId: N, safeAddress: S, chainNonce: N, threshold: N, proposer: S });

/** `ProposedInvitationConfigurationSchema` (protocol invitation-schema.ts). The proposal view is deep: Unknown. */
const ProposedConfiguration = Schema.Struct({
  commandId: S,
  orgId: S,
  invitationId: S,
  generationHash: S,
  rolesModule: S,
  proposal: U,
});

/** `SubmittedInvitationConfigurationSchema` (protocol invitation-schema.ts). */
const SubmittedConfiguration = Schema.Struct({
  status: Schema.Literal("submitted"),
  executionId: S,
  commandId: S,
  userOpHash: S,
});

/** `VerifyPermissionReceiptResultSchema` (protocol receipt-schema.ts:83): receipts and events are deep, Unknown. */
const Verification = Schema.Union([
  Schema.Struct({ status: Schema.Literal("pending"), reason: Schema.Literal("receipt_missing") }),
  Schema.Struct({ status: Schema.Literal("verified"), commandId: S, receipt: U, events: Schema.Array(U), factsHash: S }),
  Schema.Struct({ status: Schema.Literal("mismatch"), code: S, receipt: opt(U) }),
  Schema.Struct({ status: Schema.Literal("provider_failure"), retryable: Schema.Literal(true) }),
]);

/** `InvitationConfigurationApplyResult` (model.ts:53). */
const ApplyResult = Schema.Union([
  Schema.Struct({ status: Schema.Literals(["applied", "replayed"]), authorizedAt: N }),
  Schema.Struct({ status: Schema.Literals(["mismatch", "refused"]) }),
]);

/** `LoadedInvitationConfigurationVerification` (model.ts:45): the receipt input and the inviter's facts. */
const Facts = Schema.Struct({
  commandId: S,
  userOpHash: S,
  generationHash: S,
  chainId: N,
  organizationSafe: S,
  rolesModule: S,
  userOpSenderSafe: S,
  expectedAuthorityEvents: Schema.Array(S),
  allowanceExpectations: Schema.Array(U),
  authUserId: S,
  orgId: S,
  invitationId: S,
  originatingObservationContext: opt(U),
});

// ── what the guards and steps touch (lists spread into the records below) ──────────────────

/** loadAuthorizingCommand (configurations/guards.ts:73): the configure command, its offer, the inviter's authority. */
const AUTHORIZING_READS = [
  table_permission_commands,
  table_orgs,
  table_org_lifecycles,
  table_permissions,
  table_permission_assignments,
  table_permission_receipts,
];
const AUTHORIZING_INVOKES = [procedure_organizations_read_authorizing_invitation_offer_in_tx, procedure_permissions_require_command_authority];
const MANAGER_REFUSALS = [error_ROLE_PERMISSION_DENIED, error_SMART_ACCOUNT_MISSING, error_ACCOUNT_NOT_FOUND, error_INVALID_INPUT];

/** recordInvitationConfigurationVerification (configurations/writes.ts:172). */
const RECORD_READS = [table_permission_commands, table_money_executions, table_permissions];
const RECORD_WRITES = [table_permission_commands, table_permissions];
const RECORD_DRIVES = [machine_permission_command.t.to_mismatch, machine_permission_command.t.to_applied, machine_permission.t.to_active];
const RECORD_INVOKES = [
  procedure_organizations_read_configuration_invitation_offer_in_tx,
  procedure_payments_close_verified_command_execution_in_tx,
  procedure_organizations_authorize_invitation_offer_in_tx,
  procedure_organizations_deliver_invitation_outcome,
  procedure_organizations_schedule_invite_progressed,
];

/** completeExecution (configurations/operations/complete-execution.ts:20). */
const COMPLETE_INVOKES = [
  procedure_payments_admit_invitation_configuration_acceptance_in_tx,
  procedure_payments_record_command_execution_acceptance_in_tx,
  procedure_payments_close_verified_command_execution_in_tx,
];

// ── rpc: propose (public) ───────────────────────────────────────────────────────────────────

export const rpc_permissions_configurations_propose = defineRpc({
  id: "permissions.configurations.propose",
  title: "Propose an invitation's configuration to the Directors",
  about:
    "Budgets A: signed in; Organizations' requireSafeOwner proves on chain that the caller signs the Organization Safe and " +
    "reads its next nonce and threshold; the commands area's load-owner-module query (readOwnerRolesModuleInTx) names the " +
    "Roles module and payments' rolesModuleAdmitted checks its code is an admitted proxy (chain-rpc fetchCode, " +
    "WRONG_STATE when not); then permissions.configurations.propose-intent saves the Director proposal that carries the " +
    "configure command's direct calls. The same command answers the saved proposal. Approving is a separate step " +
    "(organizations.proposals.request-approval); the configuration applies once the proposal executes and its receipt " +
    "is verified.",
  was: [
    `${C}/operations/propose.ts:7`,
    `${C}/writes.ts:128`,
    `${P}/commands/writes.ts:89`,
    `${P}/external.ts:89`,
    "packages/backend/src/payments/commands/external/roles-modules.ts:16",
    `${ROW}:209`,
    `${CONVEX}:11`,
  ],
  concept: concept_permissions,
  kind: "action",
  who: "A signed-in Director who signs the Organization Safe and is the invitation's inviter, holding current Manage people authority.",
  input: Schema.Struct({ orgId: S, commandId: S, note: opt(S) }),
  output: ProposedConfiguration,
  errors: [
    error_NOT_AUTHENTICATED,
    error_INVALID_INPUT,
    error_ROLE_PERMISSION_DENIED,
    error_SMART_ACCOUNT_MISSING,
    error_ACCOUNT_NOT_FOUND,
    error_WRONG_STATE,
    error_PROVIDER_ERROR,
    error_PROVIDER_RESPONSE_INVALID,
    error_UNKNOWN,
    error_ENV_MISSING,
  ],
  reads: AUTHORIZING_READS,
  writes: [],
  drives: [],
  invokes: [
    procedure_organizations_require_safe_owner,
    procedure_permissions_read_owner_roles_module_in_tx,
    ...AUTHORIZING_INVOKES,
    procedure_accounts_require_exact_account_identity_in_tx,
    procedure_organizations_read_subject_proposal_in_tx,
    procedure_organizations_record_owner_proposal_in_tx,
  ],
  emits: [],
  calls: [integration_chain_rpc.c.fetchCode],
  chain: [],
  spans: [],
});

// ── rpc: prepare-execution (public, retired) ────────────────────────────────────────────────

export const rpc_permissions_configurations_prepare_execution = defineRpc({
  id: "permissions.configurations.prepare-execution",
  title: "Prepare an invitation configuration on one signature (retired)",
  about:
    "Retired by Budgets A: after signedInAction it always refuses INVALID_INPUT (configurationProposalRequired: use " +
    "permissions.configurations.propose). The row keeps its input and output schemas.",
  was: [`${C}/operations/prepare-execution.ts:15`, `${C}/errors.ts:35`, `${ROW}:219`, `${CONVEX}:9`],
  concept: concept_permissions,
  kind: "action",
  who: "Any signed-in person; every call is refused.",
  input: U,
  output: U,
  errors: [error_NOT_AUTHENTICATED, error_INVALID_INPUT, error_UNKNOWN, error_ENV_MISSING],
  reads: [],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

// ── rpc: prepare-intent ─────────────────────────────────────────────────────────────────────

export const rpc_permissions_configurations_prepare_intent = defineRpc({
  id: "permissions.configurations.prepare-intent",
  title: "The inviter's configuration intent, for their own Safe",
  about:
    "Signs the caller in to telemetry; the signer must be the one the caller's Account Safe trusts (INVALID_INPUT); the " +
    "caller must be the inviter with current authority over an authorizing configure command (loadAuthorizingCommand; " +
    "WRONG_STATE when the command is not pending or provider_failure); the signer's Safe must be the inviter's own " +
    "(INVALID_INPUT, inviterSafeChanged). Returns the exact stored calls and the Roles module. No old code calls it since " +
    "prepareExecution was retired.",
  was: [`${C}/operations/prepare-intent.ts:13`, `${C}/guards.ts:44`, `${C}/guards.ts:55`, `${C}/views.ts:10`, `${P}/guards/signers.ts:10`, `${CONVEX}:10`],
  concept: concept_permissions,
  kind: "mutation",
  who: "internal: no caller in the old code (its prepare action is retired).",
  input: Schema.Struct({ authUserId: S, commandId: S, signerAddress: S }),
  output: Schema.Struct({
    commandId: S,
    orgId: S,
    invitationId: S,
    generationHash: S,
    chainId: N,
    signerAddress: S,
    userOpSenderSafe: S,
    rolesModule: S,
    calls: Schema.Array(Schema.Struct({ to: S, value: Schema.Literal("0"), data: S })),
  }),
  errors: [...MANAGER_REFUSALS, error_WRONG_STATE, error_UNKNOWN],
  reads: AUTHORIZING_READS,
  writes: [],
  drives: [],
  invokes: [procedure_accounts_require_account_signer_in_tx, ...AUTHORIZING_INVOKES, procedure_accounts_require_exact_account_identity_in_tx],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

// ── rpc: propose-intent ─────────────────────────────────────────────────────────────────────

export const rpc_permissions_configurations_propose_intent = defineRpc({
  id: "permissions.configurations.propose-intent",
  title: "Save the Director proposal that carries a configure command",
  about:
    "proposeConfigurationInTx: the caller must be the inviter with current authority over the authorizing configure " +
    "command; the command's Organization must be the owner facts' (INVALID_INPUT); the caller's own Safe must be the " +
    "proposer (ROLE_PERMISSION_DENIED). A saved proposal for the command answers its view; otherwise the command's stored " +
    "calls, unwrapped to the Safe's direct Roles calls, are recorded as an owner proposal (subject invitation_configuration) " +
    "at the Safe's next nonce. Names the Organization to telemetry.",
  was: [`${C}/operations/propose-intent.ts:15`, `${C}/writes/proposals.ts:44`, `${C}/guards.ts:73`, `${CONVEX}:12`],
  concept: concept_permissions,
  kind: "mutation",
  who: "internal: the propose action, through ctx.runMutation (configurations/writes.ts:138).",
  input: Schema.Struct({ authUserId: S, owner: OwnerFacts, commandId: S, note: opt(S) }),
  output: ProposedConfiguration,
  errors: [...MANAGER_REFUSALS, error_WRONG_STATE, error_UNKNOWN],
  reads: AUTHORIZING_READS,
  writes: [],
  drives: [],
  invokes: [
    ...AUTHORIZING_INVOKES,
    procedure_accounts_require_exact_account_identity_in_tx,
    procedure_organizations_read_subject_proposal_in_tx,
    procedure_organizations_record_owner_proposal_in_tx,
  ],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

// ── rpc: complete-execution ─────────────────────────────────────────────────────────────────

export const rpc_permissions_configurations_complete_execution = defineRpc({
  id: "permissions.configurations.complete-execution",
  title: "Record a configuration's submission and schedule its verification",
  about:
    "Payments admits the claimed execution as an invitation configuration at this UserOperation (re-proving the inviter's " +
    "authority, INVALID_INPUT otherwise); the command must be a configure command (INVALID_INPUT); Payments records the " +
    "acceptance and classifies the execution by its receipt; a first acceptance schedules " +
    "permissions.configurations.verify at count 0 for the caller, with the command's observation context. A second " +
    "send of the same operation answers the same and schedules nothing.",
  was: [`${C}/operations/complete-execution.ts:20`, `${P}/writes/acceptances.ts:22`, `${P}/writes/acceptances.ts:36`, `${C}/writes.ts:66`, `${CONVEX}:7`],
  concept: concept_permissions,
  kind: "mutation",
  who:
    "internal: the submit action (configurations/writes.ts:149), payments' execution recovery " +
    "(payments/executions/external/recoveries.ts:94) and accounts' approved send (accounts/approvals/operations/send-approved.ts:283).",
  input: Schema.Struct({ authUserId: S, executionId: S, userOpHash: S }),
  output: SubmittedConfiguration,
  errors: [error_INVALID_INPUT, error_WRONG_STATE, error_ROLE_PERMISSION_DENIED, error_SMART_ACCOUNT_MISSING, error_ACCOUNT_NOT_FOUND, error_UNKNOWN],
  reads: [table_permission_commands],
  writes: [],
  drives: [],
  invokes: COMPLETE_INVOKES,
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

// ── rpc: submit-execution (public) ──────────────────────────────────────────────────────────

export const rpc_permissions_configurations_submit_execution = defineRpc({
  id: "permissions.configurations.submit-execution",
  title: "Send the signed configuration, record it, schedule its verification",
  about:
    "Signed in; sendExecution runs payments' submitStoredExecution (an action helper, not a procedure: it claims the " +
    "execution, re-proving the inviter's authority through permissions.authorize-invitation-configuration-execution-in-tx, " +
    "sends the UserOperation once through the AA Gateway and records the attempt in payments' tables); then " +
    "permissions.configurations.complete-execution; the answer is decoded as the submitted view (UNKNOWN when " +
    "malformed). SEND_FAILURES are admitted. The send's other chain reads are booked on payments.executions.submit-command.",
  was: [`${C}/operations/submit-execution.ts:11`, `${P}/external.ts:95`, `${C}/writes.ts:149`, `${P}/views/executions.ts:60`, `${ROW}:226`, `${CONVEX}:14`],
  concept: concept_permissions,
  kind: "action",
  who: "A signed-in inviter who owns the prepared execution and still holds authority over its configure command.",
  input: Schema.Struct({ executionId: S, signature: S }),
  output: SubmittedConfiguration,
  errors: [
    error_NOT_AUTHENTICATED,
    error_INVALID_INPUT,
    error_ROLE_PERMISSION_DENIED,
    error_SMART_ACCOUNT_MISSING,
    error_ACCOUNT_NOT_FOUND,
    error_WRONG_STATE,
    error_PROVIDER_ERROR,
    error_PROVIDER_RESPONSE_INVALID,
    error_SUPERSEDED,
    error_UNKNOWN,
    error_ENV_MISSING,
  ],
  reads: [table_permission_commands],
  writes: [],
  drives: [],
  invokes: COMPLETE_INVOKES,
  emits: [],
  calls: [integration_chain_rpc.c.sendUserOperation],
  chain: [],
  spans: [],
});

// ── rpc: load ───────────────────────────────────────────────────────────────────────────────

export const rpc_permissions_configurations_load = defineRpc({
  id: "permissions.configurations.load",
  title: "Load the facts one configuration attempt is verified against",
  about:
    "loadConfigureCommand: the configure command (INVALID_INPUT), its offer (Organizations) and the generation, all still " +
    "binding each other (INVALID_INPUT). Refuses an offer already authorized while the command is not applied, or one " +
    "that ended. The attempt must be recorded against this command: a human attempt in payments' moneyExecutions " +
    "(read directly) sent from the inviter's own Safe, or the Director proposal's execution. Returns the receipt input " +
    "(the expected sender is the inviter's Safe or the executing Director's) and the inviter's facts.",
  was: [`${C}/operations/load.ts:9`, `${C}/reads/commands.ts:20`, `${C}/reads/commands.ts:51`, `${C}/reads/commands.ts:114`, `${CONVEX}:8`],
  concept: concept_permissions,
  kind: "query",
  who: "internal: the configurations verify workflow, through ctx.runQuery (configurations/reads/commands.ts:36).",
  input: Schema.Struct({ commandId: S, userOpHash: S }),
  output: Facts,
  errors: [error_INVALID_INPUT, error_SMART_ACCOUNT_MISSING, error_ACCOUNT_NOT_FOUND],
  reads: [table_permission_commands, table_money_executions],
  writes: [],
  drives: [],
  invokes: [procedure_organizations_read_configuration_invitation_offer_in_tx, procedure_accounts_require_exact_account_identity_in_tx],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

// ── rpc: record ─────────────────────────────────────────────────────────────────────────────

export const rpc_permissions_configurations_record = defineRpc({
  id: "permissions.configurations.record",
  title: "Record a configuration verification and authorize the offer",
  about:
    "Decodes the result (INVALID_INPUT). A result that does not name this command and UserOperation answers refused. A " +
    "mismatch with a receipt for the live attempt (the newest recorded attempt, or the proposal's execution) moves a " +
    "command not applied or verified to mismatch, saves the result and closes the execution. A verified result that is " +
    "not strict for the chain answers refused. An offer already authorized answers replayed when the command is applied " +
    "and owns the attempt. Otherwise a pending or provider_failure command of an authorizing offer: its inline Budgets go " +
    "active, Organizations authorizes the offer and delivers its outcome (best effort), the command goes applied with " +
    "the strict verification saved, the execution is closed and invite progress `configuration_authorized` is scheduled.",
  was: [`${C}/operations/record.ts:12`, `${C}/rules.ts:24`, `${C}/writes.ts:41`, `${C}/writes.ts:172`, `${C}/reads/budgets.ts:85`, `${CONVEX}:13`],
  concept: concept_permissions,
  kind: "mutation",
  who: "internal: the configurations verify workflow, through ctx.runMutation (configurations/writes.ts:160).",
  input: Schema.Struct({ commandId: S, userOpHash: S, verification: Verification }),
  output: ApplyResult,
  errors: [error_INVALID_INPUT, error_WRONG_STATE, error_UNKNOWN],
  reads: RECORD_READS,
  writes: RECORD_WRITES,
  drives: RECORD_DRIVES,
  invokes: RECORD_INVOKES,
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

// ── workflow: verify ────────────────────────────────────────────────────────────────────────

export const workflow_permissions_configurations_verify = defineWorkflow({
  id: "permissions.configurations.verify",
  title: "Verify a recorded configuration UserOperation and apply it",
  about:
    "An internal action scheduled with runAfter(0) by complete-execution and by a Director proposal's execution " +
    "(permissions.record-proposed-configuration-execution-in-tx); payments' execution recovery also runs it directly " +
    "(recoveries.ts:148). A retry count outside 0 to 8 or a hash that is not 32 bytes is INVALID_INPUT; it loads the " +
    "facts, acts for the inviter, reads the receipt through chain-evidence verifyInvitationConfiguration, records it, " +
    "schedules itself again after min(1 s x 2^n, 30 s) while the receipt is missing or the provider failed (8 times), " +
    "and reports permission_mirror_verification (command_kind invitation_configuration, with invitation and generation). " +
    "Returns the verification. timeoutMs is Convex's action limit; the code sets none.",
  was: [`${C}/operations/verify.ts:21`, `${C}/rules.ts:15`, `${C}/external.ts:10`, `${C}/events.ts:15`, `${C}/events.ts:23`, `${C}/writes.ts:73`, `${P}/events.ts:136`, `${CONVEX}:15`],
  concept: concept_permissions,
  priority: "critical",
  trigger: { after: rpc_permissions_configurations_complete_execution },
  instance: { per: table_permission_commands },
  waits: [{ name: "backoff", for: "timer", about: "runAfter(min(1000 x 2^retryCount, 30000) ms) while the receipt is missing or the provider failed." }],
  steps: [
    { name: "input", about: "Retry count 0 to 8 and a 32-byte hash, else INVALID_INPUT (invalidRetry)." },
    { name: "facts", about: "permissions.configurations.load." },
    { name: "acting-for", about: "Telemetry signs in the inviter (the command's origin) in its Organization." },
    { name: "read-receipt", about: "chain-evidence verifyInvitationConfiguration(facts)." },
    { name: "record", about: "permissions.configurations.record." },
    { name: "retry", about: "permissionVerificationRetry: schedule permissions.configurations.verify at count + 1." },
    { name: "report", about: "permission_mirror_verification for the inviter." },
  ],
  reads: [...RECORD_READS],
  writes: RECORD_WRITES,
  drives: RECORD_DRIVES,
  invokes: [...RECORD_INVOKES, procedure_accounts_require_exact_account_identity_in_tx],
  emits: [event_permission_mirror_verification],
  calls: [integration_chain_evidence.c.verifyInvitationConfiguration],
  chain: [],
  idempotency:
    "the offer's authorization: an authorized offer answers replayed, a command already applied or mismatched answers refused, and only the live attempt's result moves the command",
  timeoutMs: 600000,
  retries: { max: 8, backoff: "exponential" },
});
