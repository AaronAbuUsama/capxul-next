// The as-is book of the old permissions/grants area: every operation in
// packages/backend/src/permissions/grants/operations/, registered at `permissions/grants:<name>`
// (packages/backend/convex/permissions/grants.ts). The granter is a dedicated EOA key
// (INVITATION_GRANTER_PRIVATE_KEY, INVITATION_GRANTER_ADDRESS) that grants, disables and compensates
// an invitation's rights through the Organization's Roles module, outside any person's UserOperation.
//
// None implements a public row. drive, verify and retry are internal actions the old code schedules
// (ctx.scheduler.runAfter), so they are workflows; prepare, submit and broadcast are internal actions the
// drive runs through ctx.runAction, and reserve, storeSignature, recordBroadcast, record and the five
// loads are the internal mutations and queries the actions run, so they are internal rpcs. Every grants
// operation runs as the system job `invitation_executor` (grants/events.ts:18). The area's reads, rules
// and writes folders are steps, booked through these records.

import { Schema } from "effect";
import { defineRpc, defineWorkflow } from "../../../packages/book/src/index.ts";

import { concept_permissions } from "../shared/foundation.ts";
import {
  error_ENV_MISSING,
  error_INVALID_INPUT,
  error_PROVIDER_ERROR,
  error_UNKNOWN,
  error_WRONG_STATE,
  event_permission_mirror_verification,
} from "../shared/vocabulary.ts";
import { contract_roles, integration_chain_evidence, integration_chain_rpc } from "../shared/external.ts";
import {
  machine_granter_execution,
  machine_permission_assignment,
  machine_permission_command,
  table_permission_assignments,
  table_permission_commands,
  table_permission_receipts,
  table_permissions,
} from "./data.ts";
import {
  procedure_organizations_activate_invitation_offer_in_tx,
  procedure_organizations_apply_verified_invitation_member_in_tx,
  procedure_organizations_begin_late_invitation_grant_cleanup_in_tx,
  procedure_organizations_is_current_compensation_offer_in_tx,
  procedure_organizations_read_application_invitation_offer_in_tx,
  procedure_organizations_read_receipt_invitation_offer_in_tx,
  procedure_organizations_record_invitation_disabled_in_tx,
  procedure_organizations_retire_invitation_offer_in_tx,
} from "../organizations/procedures.ts";
import { procedure_parties_read_invitation_grantee_binding_in_tx } from "../parties/procedures.ts";
import { procedure_accounts_read_attached_account_for_safe_in_tx } from "../accounts/procedures.ts";
import { rpc_organizations_invitations_accept, rpc_organizations_invitations_retry } from "../organizations/invitations.ts";

const G = "packages/backend/src/permissions/grants";
const P = "packages/backend/src/permissions";
const CONVEX = "packages/backend/convex/permissions/grants.ts";

const S = Schema.String;
const N = Schema.Number;
const U = Schema.Unknown;
const NullOr = Schema.NullOr;

// ── shapes ──────────────────────────────────────────────────────────────────────────────────

/** The granter attempt as stored (tables/permissions.ts:181); its machine is granter-execution. */
const Execution = U;

const Claim = Schema.Struct({ commandId: S, claimToken: S });

/** `invitationVerificationValidator` (model.ts:126): receipts and events are deep, Unknown. */
const InvitationVerification = Schema.Union([
  Schema.Struct({ status: Schema.Literal("pending"), reason: Schema.Literal("receipt_missing") }),
  Schema.Struct({ status: Schema.Literal("provider_failure"), retryable: Schema.Literal(true) }),
  Schema.Struct({
    status: Schema.Literal("mismatch"),
    code: S,
    attemptTransactionHash: Schema.optionalKey(S),
    receipt: Schema.optionalKey(U),
  }),
  Schema.Struct({ status: Schema.Literal("verified"), commandId: S, receipt: U, events: Schema.Array(U), factsHash: S }),
]);

/** `InvitationVerificationRecord` (model.ts:40). */
const VerificationRecord = Schema.Struct({
  verification: InvitationVerification,
  apply: NullOr(Schema.Struct({ status: Schema.Literals(["applied", "replayed", "cleanup_required", "conflicting_replay"]) })),
});

/** `InvitationReceiptInput` (integrations/chain-evidence/service.ts:98) plus the telemetry facts the load adds. */
const ReceiptInput = Schema.Struct({
  commandId: S,
  generationHash: S,
  purpose: Schema.Literals(["grant", "disable", "compensate"]),
  chainId: N,
  organizationSafe: S,
  rolesModule: S,
  transaction: U,
  member: S,
  roleKeys: Schema.Array(S),
  membership: Schema.Array(Schema.Boolean),
  counter: S,
  telemetry: Schema.optionalKey(U),
});

const Broadcast = Schema.Struct({ commandId: S, transactionHash: S, retryCount: N });

/** What the driver's actions fail with (grants/writes/drives.ts:20). */
const GRANT_FAILURES = [error_INVALID_INPUT, error_WRONG_STATE, error_PROVIDER_ERROR, error_ENV_MISSING];

// ── what the steps touch (lists spread into the records below) ─────────────────────────────

/** mayReverifyCompensation (reads/executions.ts:14): an invitation's current compensation, and its mismatch markers. */
const PREPARATION_READS = [table_permission_commands, table_permission_receipts];

const RECORD_READS = [table_permission_commands, table_permission_receipts, table_permission_assignments, table_permissions];
const RECORD_WRITES = [table_permission_commands, table_permission_receipts, table_permission_assignments];
const RECORD_DRIVES = [
  machine_permission_command.t.to_mismatch,
  machine_permission_command.t.to_provider_failure,
  machine_permission_command.t.to_verified,
  machine_permission_command.t.to_applied,
  machine_granter_execution.t.to_included,
  machine_granter_execution.t.to_reverted,
  machine_granter_execution.t.to_applied,
  machine_permission_assignment.t.to_revoked,
];
const RECORD_INVOKES = [
  procedure_organizations_read_application_invitation_offer_in_tx,
  procedure_organizations_is_current_compensation_offer_in_tx,
  procedure_organizations_activate_invitation_offer_in_tx,
  procedure_organizations_begin_late_invitation_grant_cleanup_in_tx,
  procedure_organizations_apply_verified_invitation_member_in_tx,
  procedure_organizations_record_invitation_disabled_in_tx,
  procedure_organizations_retire_invitation_offer_in_tx,
  procedure_parties_read_invitation_grantee_binding_in_tx,
  procedure_accounts_read_attached_account_for_safe_in_tx,
];

const LOAD_INVOKES = [procedure_organizations_read_receipt_invitation_offer_in_tx, procedure_organizations_is_current_compensation_offer_in_tx];

const SEND_DRIVES = [machine_granter_execution.t.to_reserved, machine_granter_execution.t.to_signed, machine_granter_execution.t.to_submitted];

// ── rpc: load-for-preparation ───────────────────────────────────────────────────────────────

export const rpc_permissions_grants_load_for_preparation = defineRpc({
  id: "permissions.grants.load-for-preparation",
  title: "Load the exact call a granter command prepares, and whether it may",
  about:
    "The invitation execution command (a configure command or no command is INVALID_INPUT), its one stored call to the " +
    "Roles module (INVALID_INPUT, or WRONG_STATE when the call targets another module), its state and execution, whether " +
    "a mismatched compensation may only be re-verified (verificationOnly), and `prepared`: pending or provider_failure, " +
    "fewer than 16 attempts, and execution unprepared, reverted or reserved.",
  was: [`${G}/operations/load-for-preparation.ts:9`, `${G}/reads/executions.ts:18`, `${G}/reads/executions.ts:93`, `${P}/reads/executions.ts:14`, `${CONVEX}:9`],
  concept: concept_permissions,
  kind: "query",
  who: "internal: the drive workflow and the prepare action, through ctx.runQuery (grants/reads/executions.ts:68).",
  input: Schema.Struct({ commandId: S }),
  output: Schema.Struct({
    commandId: S,
    chainId: N,
    sender: S,
    to: S,
    data: S,
    state: S,
    execution: Execution,
    verificationOnly: Schema.Boolean,
    prepared: Schema.Boolean,
  }),
  errors: [error_WRONG_STATE, error_INVALID_INPUT],
  reads: PREPARATION_READS,
  writes: [],
  drives: [],
  invokes: [procedure_organizations_is_current_compensation_offer_in_tx],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

// ── rpc: load-reserved ──────────────────────────────────────────────────────────────────────

export const rpc_permissions_grants_load_reserved = defineRpc({
  id: "permissions.grants.load-reserved",
  title: "Load the reserved unsigned transaction one claim still owns",
  about: "The chain and the reserved unsignedTransactionJson; a claim that is not current is INVALID_INPUT (unsignedClaimNotCurrent).",
  was: [`${G}/operations/load-reserved.ts:9`, `${G}/reads/executions.ts:116`, `${CONVEX}:10`],
  concept: concept_permissions,
  kind: "query",
  who: "internal: the submit action, through ctx.runQuery (grants/reads/executions.ts:76).",
  input: Claim,
  output: Schema.Struct({ chainId: N, unsignedTransactionJson: S }),
  errors: [error_WRONG_STATE, error_INVALID_INPUT],
  reads: [table_permission_commands],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

// ── rpc: load-signed ────────────────────────────────────────────────────────────────────────

export const rpc_permissions_grants_load_signed = defineRpc({
  id: "permissions.grants.load-signed",
  title: "Load the committed signed bytes of a granter attempt",
  about: "The chain, signedTransaction and expected hash of a signed, submitted or included attempt; any other is INVALID_INPUT (signedAttemptMissing).",
  was: [`${G}/operations/load-signed.ts:9`, `${G}/reads/executions.ts:133`, `${CONVEX}:11`],
  concept: concept_permissions,
  kind: "query",
  who: "internal: the broadcast action, through ctx.runQuery (grants/reads/executions.ts:84).",
  input: Schema.Struct({ commandId: S }),
  output: Schema.Struct({ chainId: N, signedTransaction: S, expectedTransactionHash: S }),
  errors: [error_WRONG_STATE, error_INVALID_INPUT],
  reads: [table_permission_commands],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

// ── rpc: load ───────────────────────────────────────────────────────────────────────────────

export const rpc_permissions_grants_load = defineRpc({
  id: "permissions.grants.load",
  title: "Derive a granter receipt's expectations from stored authority",
  about:
    "loadInvitationVerification: the grant, disable or compensate command, its invitation (Organizations' receipt read), " +
    "an applied configure command with the invitation authorized, both commands still binding this generation, and the " +
    "generation naming this command; the signed attempt's bytes must parse to the generation's compiled call on the Roles " +
    "module with the stored hash (a mismatched compensation may be re-read once). Any failed check is WRONG_STATE " +
    "(grantBindingChanged); stored calls or bytes that do not parse are UNKNOWN. Returns the receipt input (transaction, " +
    "member, role keys and membership, counter) and the telemetry facts.",
  was: [`${G}/operations/load.ts:9`, `${G}/reads/verifications.ts:26`, `${G}/reads/verifications.ts:77`, `${G}/rules.ts:133`, `${CONVEX}:8`],
  concept: concept_permissions,
  kind: "query",
  who: "internal: the grants verify workflow, through ctx.runQuery (grants/reads/verifications.ts:58).",
  input: Schema.Struct({ commandId: S }),
  output: ReceiptInput,
  errors: [error_WRONG_STATE, error_INVALID_INPUT, error_UNKNOWN],
  reads: PREPARATION_READS,
  writes: [],
  drives: [],
  invokes: LOAD_INVOKES,
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

// ── rpc: load-submitted ─────────────────────────────────────────────────────────────────────

export const rpc_permissions_grants_load_submitted = defineRpc({
  id: "permissions.grants.load-submitted",
  title: "Load a granter receipt input, only for a submitted attempt",
  about:
    "Refuses WRONG_STATE (notSubmitted, naming the execution state) unless the command is a grant, disable or compensate " +
    "whose execution is submitted or included; then the same expectations as permissions.grants.load.",
  was: [`${G}/operations/load-submitted.ts:9`, `${G}/reads/verifications.ts:222`, `${P}/reads/executions.ts:122`, `${CONVEX}:12`],
  concept: concept_permissions,
  kind: "query",
  who: "internal: the grants retry workflow, through ctx.runQuery (grants/reads/verifications.ts:67).",
  input: Schema.Struct({ commandId: S }),
  output: ReceiptInput,
  errors: [error_WRONG_STATE, error_INVALID_INPUT, error_UNKNOWN],
  reads: PREPARATION_READS,
  writes: [],
  drives: [],
  invokes: LOAD_INVOKES,
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

// ── rpc: reserve ────────────────────────────────────────────────────────────────────────────

export const rpc_permissions_grants_reserve = defineRpc({
  id: "permissions.grants.reserve",
  title: "Reserve the granter's EOA lane and nonce for one claim",
  about:
    "reserveInvitationExecution, at wall time: a configure or missing command is INVALID_INPUT; a command that is not " +
    "pending or provider_failure answers `terminal`; a sender other than the granter, another chain, a non-canonical " +
    "nonce or an empty claim token is INVALID_INPUT. A reverted attempt at 16 attempts answers `exhausted`; a signed, " +
    "submitted or included attempt answers `existing`. A live reservation answers `reserved` to its own token and `busy` " +
    "to another. Any other live attempt on the sender's lane (by_eoa_sender) answers `busy`. Else it reserves (reusing a " +
    "lapsed reservation's nonce and bytes) for 120 s and stores eoaChainId, eoaSender and eoaNonce.",
  was: [`${G}/operations/reserve.ts:11`, `${G}/writes/attempts.ts:43`, `${G}/writes/executions.ts:21`, `${CONVEX}:16`],
  concept: concept_permissions,
  kind: "mutation",
  who: "internal: the prepare action, through ctx.runMutation (grants/writes/attempts.ts:118).",
  input: Schema.Struct({ commandId: S, chainId: N, sender: S, nonce: S, unsignedTransactionJson: S, claimToken: S }),
  output: Schema.Union([
    Schema.Struct({ status: Schema.Literals(["terminal", "exhausted", "busy"]) }),
    Schema.Struct({ status: Schema.Literals(["existing", "reserved"]), execution: Execution }),
  ]),
  errors: [error_INVALID_INPUT, error_WRONG_STATE],
  reads: [table_permission_commands],
  writes: [table_permission_commands],
  drives: [machine_granter_execution.t.to_reserved],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

// ── rpc: store-signature ────────────────────────────────────────────────────────────────────

export const rpc_permissions_grants_store_signature = defineRpc({
  id: "permissions.grants.store-signature",
  title: "Store the granter's signed bytes before anything is sent",
  about:
    "storeInvitationSignature, at wall time: the same bytes already stored answer the stored attempt; else the claim must " +
    "be current (INVALID_INPUT), the reserved unsigned JSON must parse (UNKNOWN when it does not), and the signed type-2 " +
    "transaction must match the reservation field for field: signer, chain, nonce, the Roles module, zero value, no access " +
    "list, the one stored call's data, gas and fees (INVALID_INPUT, signatureMismatch). Stores the bytes, keccak256 as the " +
    "expected hash and submittedAt null.",
  was: [`${G}/operations/store-signature.ts:15`, `${G}/writes/attempts.ts:54`, `${G}/writes/executions.ts:117`, `${CONVEX}:18`],
  concept: concept_permissions,
  kind: "mutation",
  who: "internal: the submit action, through ctx.runMutation (grants/writes/attempts.ts:125).",
  input: Schema.Struct({ commandId: S, claimToken: S, signerAddress: S, signedTransaction: S }),
  output: Execution,
  errors: [error_INVALID_INPUT, error_WRONG_STATE, error_UNKNOWN],
  reads: [table_permission_commands],
  writes: [table_permission_commands],
  drives: [machine_granter_execution.t.to_signed],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

// ── rpc: record-broadcast ───────────────────────────────────────────────────────────────────

export const rpc_permissions_grants_record_broadcast = defineRpc({
  id: "permissions.grants.record-broadcast",
  title: "Record that the stored bytes reached the network",
  about:
    "recordInvitationBroadcast: an attempt with no signed bytes, or a hash other than the expected one, is INVALID_INPUT " +
    "(signedTransactionMismatch); a signed attempt becomes submitted with submittedAt now; a later state is left as it is. " +
    "Returns null.",
  was: [`${G}/operations/record-broadcast.ts:11`, `${G}/writes/attempts.ts:69`, `${G}/writes/executions.ts:212`, `${CONVEX}:15`],
  concept: concept_permissions,
  kind: "mutation",
  who: "internal: the submit and broadcast actions, through ctx.runMutation (grants/writes/attempts.ts:132).",
  input: Schema.Struct({ commandId: S, transactionHash: S }),
  output: Schema.Null,
  errors: [error_INVALID_INPUT, error_WRONG_STATE],
  reads: [table_permission_commands],
  writes: [table_permission_commands],
  drives: [machine_granter_execution.t.to_submitted],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

// ── rpc: record ─────────────────────────────────────────────────────────────────────────────

export const rpc_permissions_grants_record = defineRpc({
  id: "permissions.grants.record",
  title: "Record a granter receipt and apply its grant or cleanup",
  about:
    "Decodes the result strictly (INVALID_INPUT). A mismatch appends one marker per code and, for the live attempt's own " +
    "transaction, reverts the attempt (failed_transaction: the nonce joins `attempts`, at most 16) or marks it included " +
    "(the transaction succeeded but its evidence refused); the command goes mismatch unless applied or verified. A " +
    "provider failure moves a pending command to provider_failure. A verified receipt requires the current generation " +
    "and attempt (WRONG_STATE, invitation-binding-changed). A grant: an already stored receipt answers its recorded outcome; " +
    "an accepted offer inserts one active Party assignment per binding pointing at the AssignRoles receipt, activates the " +
    "member and the offer (applied); an unaccepted offer is WRONG_STATE (invitation-not-pending); an ending offer stores the " +
    "receipt, begins cleanup and assigns nothing (cleanup_required). A disable stores its receipts and moves the offer to " +
    "compensate (which schedules the compensation's drive). A compensation must follow the disable in canonical order with " +
    "no unresolved child attempt (WRONG_STATE, invitation-cleanup-pending), then revokes the generation's assignments and " +
    "retires the offer. Applied moves the command to applied, anything else to verified; the attempt becomes applied.",
  was: [
    `${G}/operations/record.ts:16`,
    `${G}/rules.ts:64`,
    `${G}/writes/attempts.ts:79`,
    `${G}/writes/verifications.ts:18`,
    `${G}/writes/verifications.ts:132`,
    `${G}/writes/grants.ts:173`,
    `${G}/writes/grants.ts:85`,
    `${G}/writes/cleanups.ts:96`,
    `${G}/writes/cleanups.ts:48`,
    `${P}/writes/receipts.ts:56`,
    `${P}/writes/receipts.ts:109`,
    `${CONVEX}:14`,
  ],
  concept: concept_permissions,
  kind: "mutation",
  who: "internal: the grants verify workflow, through ctx.runMutation (grants/writes/attempts.ts:141).",
  input: Schema.Struct({ commandId: S, verification: InvitationVerification }),
  output: VerificationRecord,
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

// ── rpc: prepare ────────────────────────────────────────────────────────────────────────────

export const rpc_permissions_grants_prepare = defineRpc({
  id: "permissions.grants.prepare",
  title: "Simulate and reserve the exact granter transaction",
  about:
    "As the granter job: load-for-preparation; not preparable is INVALID_INPUT (attemptProgressed). A reserved attempt " +
    "re-reserves its own nonce and bytes; otherwise chain-rpc prepareTransaction simulates the stored call from the " +
    "granter to the Roles module (execTransactionWithRole wrapping assignRoles) and reads its nonce and fees, then " +
    "permissions.grants.reserve. Returns the reservation's answer. Only PROVIDER_ERROR and ENV_MISSING are admitted from " +
    "the chain; any other failure is a defect.",
  was: [`${G}/operations/prepare.ts:18`, `${G}/external.ts:203`, `${G}/writes/attempts.ts:118`, `${CONVEX}:13`],
  concept: concept_permissions,
  kind: "action",
  who: "internal: the drive workflow, through ctx.runAction with a fresh claim token (grants/writes/drives.ts:97).",
  input: Claim,
  output: U,
  errors: [...GRANT_FAILURES, error_UNKNOWN],
  reads: PREPARATION_READS,
  writes: [table_permission_commands],
  drives: [machine_granter_execution.t.to_reserved],
  invokes: [procedure_organizations_is_current_compensation_offer_in_tx],
  emits: [],
  calls: [integration_chain_rpc.c.prepareTransaction],
  chain: [contract_roles.f.execTransactionWithRole],
  spans: [],
});

// ── rpc: submit ─────────────────────────────────────────────────────────────────────────────

export const rpc_permissions_grants_submit = defineRpc({
  id: "permissions.grants.submit",
  title: "Sign the reserved granter transaction, store it, then broadcast it",
  about:
    "As the granter job: load-reserved for the claim; signReserved builds the granter from INVITATION_GRANTER_PRIVATE_KEY " +
    "and INVITATION_GRANTER_ADDRESS (ENV_MISSING when unset, INVALID_INPUT when the key is not bytes32 or derives another " +
    "address), parses the unsigned JSON exactly (INVALID_INPUT), signs it and recovers the signer; store-signature; " +
    "chain-rpc broadcastTransaction of the stored bytes; record-broadcast. Returns the hash and retry count 0. The key " +
    "never leaves the action.",
  was: [`${G}/operations/submit.ts:14`, `${G}/external.ts:180`, `${G}/external.ts:222`, `${G}/writes/attempts.ts:125`, `${CONVEX}:19`],
  concept: concept_permissions,
  kind: "action",
  who: "internal: the drive workflow, through ctx.runAction with the claim it reserved (grants/writes/drives.ts:100).",
  input: Claim,
  output: Broadcast,
  errors: [...GRANT_FAILURES, error_UNKNOWN],
  reads: [table_permission_commands],
  writes: [table_permission_commands],
  drives: [machine_granter_execution.t.to_signed, machine_granter_execution.t.to_submitted],
  invokes: [],
  emits: [],
  calls: [integration_chain_rpc.c.broadcastTransaction],
  chain: [contract_roles.f.execTransactionWithRole],
  spans: [],
});

// ── rpc: broadcast ──────────────────────────────────────────────────────────────────────────

export const rpc_permissions_grants_broadcast = defineRpc({
  id: "permissions.grants.broadcast",
  title: "Broadcast the stored signed bytes again",
  about:
    "As the granter job: load-signed, chain-rpc broadcastTransaction of the exact stored bytes, record-broadcast. A " +
    "provider timeout never signs anything new.",
  was: [`${G}/operations/broadcast.ts:14`, `${G}/external.ts:222`, `${CONVEX}:6`],
  concept: concept_permissions,
  kind: "action",
  who: "internal: the drive workflow, for an attempt left signed (grants/writes/drives.ts:46).",
  input: Schema.Struct({ commandId: S }),
  output: Broadcast,
  errors: [...GRANT_FAILURES, error_UNKNOWN],
  reads: [table_permission_commands],
  writes: [table_permission_commands],
  drives: [machine_granter_execution.t.to_submitted],
  invokes: [],
  emits: [],
  calls: [integration_chain_rpc.c.broadcastTransaction],
  chain: [contract_roles.f.execTransactionWithRole],
  spans: [],
});

// ── workflow: drive ─────────────────────────────────────────────────────────────────────────

export const workflow_permissions_grants_drive = defineWorkflow({
  id: "permissions.grants.drive",
  title: "Drive one granter command one automatic step",
  about:
    "The one production driver of the granter lane. Scheduled with runAfter(0) by Organizations' consent when an " +
    "invitation is accepted (organizations/invitations/writes/consent.ts:55), by an invitation's ending and expiry " +
    "(endings.ts:91, :154), by a verified disable (phases.ts:127), by a verified module replacement " +
    "(writes/replacements.ts:170, :182) and by itself. A retry count outside 0 to 5 is INVALID_INPUT. One step from the " +
    "durable state: a compensation that may only be re-verified, a submitted or included attempt, schedules verify; a " +
    "signed attempt schedules verify and rebroadcasts; a command no longer pending or provider_failure, or not preparable, " +
    "stops; a live reservation retries; else a fresh claim runs prepare and then submit and schedules verify. Retry rungs " +
    "2 s, 10 s, 30 s, 60 s, 300 s, also after a failure, only while the command can still move. timeoutMs is Convex's " +
    "action limit; the code sets none.",
  was: [
    `${G}/operations/drive.ts:16`,
    `${G}/rules.ts:52`,
    `${G}/writes/drives.ts:55`,
    `${G}/writes/drives.ts:70`,
    `${P}/rules/retries.ts:8`,
    "packages/backend/src/organizations/invitations/writes/phases.ts:127",
    `${CONVEX}:7`,
  ],
  concept: concept_permissions,
  priority: "critical",
  trigger: { after: rpc_organizations_invitations_accept },
  instance: { per: table_permission_commands },
  waits: [{ name: "rung", for: "timer", about: "runAfter of the next rung: 2 s, 10 s, 30 s, 60 s, 300 s (INVITATION_RETRY_DELAYS_MS)." }],
  steps: [
    { name: "granter", about: "Runs as the system job invitation_executor." },
    { name: "retry-count", about: "0 to 5, else INVALID_INPUT (invalidDriveRetry)." },
    { name: "read", about: "permissions.grants.load-for-preparation." },
    { name: "verify-only", about: "A re-verifiable compensation, or a submitted or included attempt: schedule permissions.grants.verify at count 0." },
    { name: "rebroadcast", about: "A signed attempt: schedule verify, then run permissions.grants.broadcast; no hash back is a retry." },
    { name: "claim", about: "A live reservation retries; otherwise a crypto.randomUUID claim token." },
    { name: "prepare", about: "permissions.grants.prepare; exhausted or terminal stops, anything but reserved retries." },
    { name: "submit", about: "permissions.grants.submit; no hash back is a retry; else schedule verify at the reported count." },
    { name: "next-rung", about: "On retry or failure, schedule the next drive while the command is pending or provider_failure and preparable or sent." },
  ],
  reads: PREPARATION_READS,
  writes: [table_permission_commands],
  drives: SEND_DRIVES,
  invokes: [procedure_organizations_is_current_compensation_offer_in_tx],
  emits: [],
  calls: [integration_chain_rpc.c.prepareTransaction, integration_chain_rpc.c.broadcastTransaction],
  chain: [contract_roles.f.execTransactionWithRole],
  idempotency:
    "the command's one reserved nonce and exact signed bytes: a live claim answers busy, a signed attempt is rebroadcast and never re-signed, and a second logical grant is never started",
  timeoutMs: 600000,
  retries: { max: 5, backoff: "exponential" },
});

// ── workflow: verify ────────────────────────────────────────────────────────────────────────

export const workflow_permissions_grants_verify = defineWorkflow({
  id: "permissions.grants.verify",
  title: "Verify one granter transaction's receipt and record it",
  about:
    "Scheduled by the drive (at count 0 after a broadcast, or for an attempt already sent) and by itself; the grants " +
    "retry runs it inline. As the granter job: a retry count that is not a whole number is INVALID_INPUT; load the " +
    "receipt input; chain-evidence verifyInvitation; record it (a recording failure reports the event with " +
    "application_failure, then propagates); a pending or provider_failure result schedules itself again on the rungs " +
    "2 s, 10 s, 30 s, 60 s, 300 s; report permission_mirror_verification as the system job, attributed to the " +
    "Organization. Returns the verification and its application. timeoutMs is Convex's action limit; the code sets none.",
  was: [`${G}/operations/verify.ts:20`, `${G}/rules.ts:60`, `${G}/external.ts:229`, `${G}/events.ts:28`, `${P}/rules/retries.ts:10`, `${P}/events.ts:39`, `${CONVEX}:20`],
  concept: concept_permissions,
  priority: "critical",
  trigger: { transition: machine_granter_execution.t.to_submitted },
  instance: { per: table_permission_commands },
  waits: [{ name: "rung", for: "timer", about: "runAfter of the next rung while the receipt is missing or the provider failed." }],
  steps: [
    { name: "granter", about: "Runs as the system job invitation_executor." },
    { name: "retry-count", about: "A whole, non-negative number, else INVALID_INPUT (invalidRetry)." },
    { name: "load", about: "permissions.grants.load: the receipt expectations of the signed attempt." },
    { name: "read-receipt", about: "chain-evidence verifyInvitation(input)." },
    { name: "record", about: "permissions.grants.record; its failure reports application_failure first." },
    { name: "retry", about: "invitationVerificationRetry: schedule permissions.grants.verify at count + 1 after the rung's delay." },
    { name: "report", about: "permission_mirror_verification: outcome, reason, chain, retry count, command kind invitation_eoa, purpose, application result." },
  ],
  reads: [...RECORD_READS],
  writes: RECORD_WRITES,
  drives: RECORD_DRIVES,
  invokes: [...LOAD_INVOKES, ...RECORD_INVOKES],
  emits: [event_permission_mirror_verification],
  calls: [integration_chain_evidence.c.verifyInvitation],
  chain: [],
  idempotency:
    "the stored receipt: requireUnclaimedEvents answers a replay with the outcome the receipts already recorded, mismatch markers are one per code, and an applied or verified command is never rewritten",
  timeoutMs: 600000,
  retries: { max: 5, backoff: "exponential" },
});

// ── workflow: retry ─────────────────────────────────────────────────────────────────────────

export const workflow_permissions_grants_retry = defineWorkflow({
  id: "permissions.grants.retry",
  title: "Re-verify a submitted grant now, on an operator's retry",
  about:
    "Scheduled with runAfter(0) by Organizations' invitation retry (scheduleGrantVerification, " +
    "organizations/invitations/writes/endings.ts:229) for the generation's grant command. As the granter job: " +
    "load-submitted (WRONG_STATE unless the attempt is submitted or included), then runs permissions.grants.verify inline " +
    "at count 0. It never prepares, signs or broadcasts. Its own failures are not retried; the verify it runs schedules its " +
    "own rungs. timeoutMs is Convex's action limit; the code sets none.",
  was: [`${G}/operations/retry.ts:15`, `${G}/reads/verifications.ts:67`, `${G}/writes/attempts.ts:168`, `${CONVEX}:17`],
  concept: concept_permissions,
  priority: "normal",
  trigger: { after: rpc_organizations_invitations_retry },
  instance: { per: table_permission_commands },
  steps: [
    { name: "granter", about: "Runs as the system job invitation_executor." },
    { name: "submitted", about: "permissions.grants.load-submitted: refuses WRONG_STATE (notSubmitted) for any other attempt." },
    { name: "verify", about: "ctx.runAction permissions.grants.verify at retry count 0, admitting INVALID_INPUT, WRONG_STATE, PROVIDER_ERROR." },
  ],
  reads: [...RECORD_READS],
  writes: RECORD_WRITES,
  drives: RECORD_DRIVES,
  invokes: [...LOAD_INVOKES, ...RECORD_INVOKES],
  emits: [event_permission_mirror_verification],
  calls: [integration_chain_evidence.c.verifyInvitation],
  chain: [],
  idempotency: "the verify it runs: a receipt already recorded answers its recorded outcome",
  timeoutMs: 600000,
  retries: { max: 0, backoff: "none" },
});
