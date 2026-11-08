// The old permissions concept's tables and the state machines that live on them, as the old code
// has them (factory, branch integration/factory). Evidence, not the target design.
//
// Tables: packages/backend/src/permissions/tables/{permissions,allowances}.ts, registered in
// packages/backend/convex/schema.ts:47-48. Machines: every status/state field with a literal union.
// Transitions are named to_<state>; `from` lists every state an old write moves the field from. A
// write that leaves the field unchanged (a self-loop) is not listed; a birth (an insert) has no
// source state and is said in `about`. No old write sends a product event on a transition: the
// permission events are sent by the verify and propose operations (see their records), so every
// transition's `emits` is empty.

import { Schema } from "effect";
import { defineMachine, defineTable } from "../../../packages/book/src/index.ts";
import { concept_permissions } from "../shared/foundation.ts";

const B = "packages/backend/src/permissions";
const T = `${B}/tables`;

const KEPT = "Kept indefinitely: no job in the old code deletes or expires these rows.";

// ── shared validators ───────────────────────────────────────────────────────────────────────

const opt = Schema.optionalKey;
const S = Schema.String;
const N = Schema.Number;
const U = Schema.Unknown;
const NullOr = Schema.NullOr;

/** `lifecycleState` (tables/permissions.ts:6): a Permission's and an assignment's state. */
const LIFECYCLE_STATES = ["pending", "active", "suspended", "revoked", "superseded"] as const;
/** `commandState` (tables/permissions.ts:14): both command kinds share it. */
const COMMAND_STATES = ["pending", "verified", "mismatch", "provider_failure", "applied", "abandoned"] as const;
/** `permissionOperation` (tables/permissions.ts:25). */
const Operation = Schema.Literals(["create", "change", "assign", "revoke", "replace"]);

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

/** An invitation binding: the offer row's own shape (organizations `orgInvitations.bindings`), tables/permissions.ts:164. */
const InvitationBinding = Schema.Struct({
  assignmentId: S,
  permissionId: S,
  authority: Schema.Union([
    Schema.Struct({ type: Schema.Literal("budget"), budgetId: S }),
    Schema.Struct({ type: Schema.Literal("managePeople"), permissionId: S }),
  ]),
  roleKey: S,
  assetId: NullOr(S),
});

/** The granter EOA attempt (tables/permissions.ts:181): one of four shapes by `state`. */
const GranterExecution = Schema.Union([
  Schema.Struct({ state: Schema.Literal("unprepared") }),
  Schema.Struct({
    state: Schema.Literal("reserved"),
    sender: S,
    nonce: S,
    unsignedTransactionJson: S,
    claimToken: S,
    claimExpiresAt: N,
  }),
  Schema.Struct({
    state: Schema.Literals(["signed", "submitted", "included"]),
    sender: S,
    nonce: S,
    signedTransaction: S,
    expectedTransactionHash: S,
    submittedAt: NullOr(N),
  }),
  Schema.Struct({
    state: Schema.Literals(["reverted", "applied"]),
    sender: S,
    nonce: S,
    expectedTransactionHash: S,
  }),
]);

const Member = Schema.Struct({ email: S, safe: S, label: S });

// ── tables ──────────────────────────────────────────────────────────────────────────────────

export const table_permissions = defineTable({
  id: "permissions",
  title: "Permissions: Budgets and Manage people, one row per revision",
  about:
    "One row per revision of a Permission: a Budget (`budget`: spending authority over one token, capped by `limitRaw` or " +
    "unlimited when it is absent, ADR-0024 R5) or `managePeople`. A change inserts the next revision `pending` beside the " +
    "current one; a module replacement inserts a `pending` row per active Permission on the new Roles module. The " +
    "verified receipt activates the new row and supersedes the old one (writes/states.ts). `policyJson` and " +
    "`resolvedPolicyJson` hold the intent and the resolved Roles policy as JSON text; `allowanceKey` names the Roles " +
    "allowance a capped Budget spends from. Hex columns (`organizationSafe`, `rolesModule`, `roleKey`, `allowanceKey`) " +
    "are the `hex` validator, strings here. Payroll reads the table directly for a Budget's label " +
    "(payroll/runs/reads/notices.ts:37).",
  was: [`${T}/permissions.ts:34`, "packages/backend/convex/schema.ts:48", `${B}/README.md:1`],
  concept: concept_permissions,
  tenancy: "organization",
  tenantField: "orgId",
  fields: Schema.Struct({
    permissionId: S,
    orgId: S,
    type: Schema.Literals(["budget", "managePeople"]),
    state: Schema.Literals(LIFECYCLE_STATES),
    revision: N,
    label: opt(S),
    policyJson: opt(S),
    resolvedPolicyJson: opt(S),
    organizationSafe: S,
    rolesModule: S,
    roleKey: S,
    tokenAddress: opt(S),
    assetId: opt(S),
    decimals: opt(N),
    limitRaw: opt(S),
    allowanceKey: opt(S),
    createdAt: N,
    updatedAt: N,
  }),
  key: ["permissionId", "revision"],
  indexes: [
    {
      name: "by_permission_id",
      fields: ["permissionId"],
      for: "Every revision of one Permission: spend authority, the Budget-left read, applying and suspending a change, a Safe's assignment groups, offered bindings and approvals (guards/spending.ts:181, writes/states.ts:11, reads/assignments.ts:74, reads/previews.ts:135).",
    },
    {
      name: "by_org_state",
      fields: ["orgId", "state"],
      for: "An Organization's Permissions, all or by state: authorities.list, Manage people authority, the authority snapshot, holder Safes, replacement apply and abandonment (authorities/reads.ts:25, guards/managers.ts:70, reads/assignments.ts:173, writes/abandonments.ts:24).",
    },
    {
      name: "by_module_role",
      fields: ["rolesModule", "roleKey"],
      for: "None: no withIndex(\"by_module_role\") outside tests (gap).",
    },
  ],
  retention: KEPT,
});

export const table_permission_assignments = defineTable({
  id: "permission-assignments",
  title: "Permission assignments: who holds a Permission",
  about:
    "The assignment of a Permission to an Account (`account`), an Organization or, from an applied invitation grant, a " +
    "Party (`party`), with the holder's canonical lowercase Safe in `memberSafe`. A Party row carries `partyId`, the " +
    "`accountId` when one is attached (null before), and its invitation source proof (`sourceInvitationId`, " +
    "`sourceGenerationHash`, `sourceCommandId`, `verifiedReceiptId`). The row has no orgId: its Organization is its " +
    "Permission's. Every authority check reads the caller's single active assignment (reads/assignments.ts:31).",
  was: [`${T}/permissions.ts:57`, "packages/backend/convex/schema.ts:48", `${B}/reads/assignments.ts:31`],
  concept: concept_permissions,
  tenancy: "organization",
  scope: "Through permissionId: the Organization of the Permission row the assignment names.",
  fields: Schema.Struct({
    permissionAssignmentId: S,
    permissionId: S,
    actorKind: Schema.Literals(["account", "organization", "party"]),
    actorId: S,
    memberSafe: S,
    partyId: opt(S),
    accountId: opt(NullOr(S)),
    state: Schema.Literals(LIFECYCLE_STATES),
    sourceInvitationId: opt(S),
    sourceGenerationHash: opt(S),
    sourceCommandId: opt(S),
    verifiedReceiptId: opt(S),
    createdAt: N,
    updatedAt: N,
  }),
  key: ["permissionAssignmentId"],
  indexes: [
    {
      name: "by_assignment_id",
      fields: ["permissionAssignmentId"],
      for: "One assignment's rows: applying, suspending and abandoning a command, a grant's and a cleanup's bindings, bootstrap rebinding (writes/states.ts:91, writes/suspensions.ts:33, grants/writes/grants.ts:26, grants/writes/cleanups.ts:30).",
    },
    {
      name: "by_permission_actor",
      fields: ["permissionId", "actorKind", "actorId"],
      for: "A Permission's assignments (prefix permissionId): the caller's active one, authorities.list, holder Safes, occupancy (reads/assignments.ts:19, authorities/reads.ts:35, reads/occupancy.ts:137).",
    },
    {
      name: "by_member_safe",
      fields: ["memberSafe"],
      for: "The assignments bound to one Account's Safe: spend authorities, `me()`, member participation, setup recovery admission, purge ties (reads/assignments.ts:66, :241, guards/members.ts:30, :125).",
    },
    {
      name: "by_source_invitation",
      fields: ["sourceInvitationId"],
      for: "None: no withIndex(\"by_source_invitation\") outside tests (gap).",
    },
  ],
  retention: KEPT,
});

/** The ordinary Permission command shape (tables/permissions.ts:89); old rows have no `kind`. */
const PermissionCommandRow = Schema.Struct({
  kind: opt(Schema.Literal("permission")),
  commandId: S,
  orgId: S,
  operation: Operation,
  permissionId: S,
  permissionAssignmentId: NullOr(S),
  expectedRevision: N,
  userOpSenderSafe: S,
  organizationSafe: S,
  rolesModule: S,
  roleKey: S,
  allowanceKey: NullOr(S),
  memberSafe: NullOr(S),
  expectedAuthorityEvents: Schema.Array(S),
  preparedCallsJson: opt(S),
  preparedValueJson: opt(S),
  effectContextJson: opt(S),
  requestJson: opt(S),
  invitationReplacementJson: opt(S),
  originatingAuthUserId: opt(S),
  originatingObservationContext: opt(ObservationContext),
  verificationOutcome: opt(
    Schema.Struct({
      userOpHash: S,
      retryCount: N,
      automaticRetry: Schema.Literals(["scheduled", "exhausted", "none"]),
      verification: U,
      application: U,
    }),
  ),
  state: Schema.Literals(COMMAND_STATES),
  createdAt: N,
  updatedAt: N,
});

/** The invitation command shape (tables/permissions.ts:141): configure, grant, disable or compensate. */
const InvitationCommandRow = Schema.Struct({
  kind: Schema.Literal("invitation"),
  commandId: S,
  orgId: S,
  invitationId: S,
  configurationVerificationJson: opt(S),
  replacementCommandId: opt(S),
  replacementReceiptId: opt(S),
  previousGenerationHash: opt(S),
  generationHash: S,
  parentCommandId: S,
  purpose: Schema.Literals(["configure", "grant", "disable", "compensate"]),
  chainId: N,
  organizationSafe: S,
  rolesModule: S,
  granterAddress: S,
  granteeSafe: S,
  bindings: Schema.Array(InvitationBinding),
  expectedAuthorityEvents: Schema.Array(S),
  preparedCallsJson: S,
  proposedExecution: opt(Schema.Struct({ userOpHash: S, senderSafe: S })),
  originatingAuthUserId: opt(S),
  originatingObservationContext: opt(ObservationContext),
  execution: GranterExecution,
  eoaChainId: opt(N),
  eoaSender: opt(S),
  eoaNonce: opt(S),
  attempts: opt(
    Schema.Array(
      Schema.Struct({
        nonce: S,
        expectedTransactionHash: NullOr(S),
        state: Schema.Literals(["signed", "submitted", "included", "reverted"]),
        recordedAt: N,
      }),
    ),
  ),
  state: Schema.Literals(COMMAND_STATES),
  createdAt: N,
  updatedAt: N,
});

export const table_permission_commands = defineTable({
  id: "permission-commands",
  title: "Permission commands: ordinary Permission and invitation commands",
  about:
    "A union of two row shapes, booked as Schema.Union. An ordinary Permission command (no `kind` on rows written " +
    "before D8) is a create, change, assign, revoke or replace an Admin signs from their own Safe or a Director proposal " +
    "carries; it holds the prepared calls, value, effect context and request as JSON text and the last verification " +
    "attempt in `verificationOutcome` (`verification` and `application` are `v.any`, booked Unknown). An invitation " +
    "command is the inviter's `configure` (a human UserOperation, or a Director proposal's execution in " +
    "`proposedExecution`) or a granter `grant`, `disable` or `compensate`, sent by the granter EOA; its `execution` is " +
    "the granter attempt (machine granter-execution) and `attempts` the prior reverted ones, at most 16. A command's " +
    "id is permission_command_<keccak(orgId, accountId, requestKey)> (rules/commands.ts:46).",
  was: [`${T}/permissions.ts:87`, `${T}/permissions.ts:89`, `${T}/permissions.ts:141`, "packages/backend/convex/schema.ts:48"],
  concept: concept_permissions,
  tenancy: "organization",
  tenantField: "orgId",
  fields: Schema.Union([PermissionCommandRow, InvitationCommandRow]),
  key: ["commandId"],
  indexes: [
    {
      name: "by_command_id",
      fields: ["commandId"],
      for: "One command by id: every prepare, verify, grant, configuration and approval read (verifications/reads.ts:24, grants/writes/executions.ts:35, configurations/guards.ts:80, reads/approvals.ts:37).",
    },
    {
      name: "by_org_created",
      fields: ["orgId", "createdAt"],
      for: "An Organization's commands: lifecycle recoverability, generation currency, open invitation commands, setup snapshots, recovery admission (reads/lifecycles.ts:17, reads/generations.ts:28, reads/occupancy.ts:70, guards/members.ts:133).",
    },
    {
      name: "by_org_operation_permission",
      fields: ["orgId", "operation", "permissionId"],
      for: "One Permission's own commands and the Organization's replacements, for the evidence that proves a Permission (reads/evidence.ts:43).",
    },
    {
      name: "by_eoa_sender",
      fields: ["eoaChainId", "eoaSender"],
      for: "The granter lane: every invitation command one EOA sender holds, before a new nonce is reserved (grants/writes/executions.ts:69).",
    },
    {
      name: "by_eoa_nonce",
      fields: ["eoaChainId", "eoaSender", "eoaNonce"],
      for: "None: no withIndex(\"by_eoa_nonce\") outside tests (gap).",
    },
  ],
  retention: KEPT,
});

export const table_permission_receipts = defineTable({
  id: "permission-receipts",
  title: "Permission receipts: chain proof and evidence of commands",
  about:
    "One row per verified authority event of an applied command, plus evidence rows the code stores in the same table: " +
    "a submission marker (logIndex SUBMISSION_LOG_INDEX, factsHash `submitted`, transactionHash = the UserOperation hash) " +
    "and mismatch markers (logIndex MISMATCH_LOG_INDEX, factsHash `mismatch:<code>`, zero hashes; an invitation's " +
    "carries the invitation id in `emitter`). An invitation receipt has no permissionId: its `subject` names the " +
    "invitation generation and the assignment ids it proves, and its userOpHash is the transaction hash. Readers tell " +
    "verified rows from markers with isVerifiedReceipt (rules/receipts.ts). A bootstrap receipt a setup reorg replaced " +
    "is stamped `orphanedAt`; no row is deleted.",
  was: [`${T}/permissions.ts:239`, `${B}/writes/receipts.ts:25`, `${B}/writes/receipts.ts:128`, `${B}/writes/receipts.ts:170`],
  concept: concept_permissions,
  tenancy: "organization",
  tenantField: "orgId",
  fields: Schema.Struct({
    commandId: S,
    orgId: S,
    permissionId: opt(S),
    permissionAssignmentId: NullOr(S),
    subject: opt(
      Schema.Union([
        Schema.Struct({ kind: Schema.Literal("permission"), permissionId: S, permissionAssignmentId: NullOr(S) }),
        Schema.Struct({
          kind: Schema.Literal("invitation"),
          invitationId: S,
          generationHash: S,
          assignmentIds: Schema.Array(S),
        }),
      ]),
    ),
    operation: opt(Operation),
    revision: N,
    chainId: N,
    userOpHash: S,
    transactionHash: S,
    blockNumber: N,
    blockHash: S,
    emitter: S,
    transactionIndex: N,
    logIndex: N,
    topic0: S,
    dataHash: S,
    factsHash: S,
    createdAt: N,
    orphanedAt: opt(N),
  }),
  key: ["chainId", "transactionHash", "logIndex"],
  indexes: [
    {
      name: "by_command_id",
      fields: ["commandId"],
      for: "One command's receipts and markers: apply, replay and mismatch checks, execution proofs (writes/applications.ts:37, writes/receipts.ts:149, reads/approvals.ts:129, grants/reads/commands.ts:37).",
    },
    {
      name: "by_org",
      fields: ["orgId"],
      for: "An Organization's receipts, filtered to verified ones: Manage people authority, the assignment snapshot, bootstrap receipts, generation currency (guards/managers.ts:79, reads/assignments.ts:178, reads/bootstrap.ts:18).",
    },
    {
      name: "by_chain_transaction_log",
      fields: ["chainId", "transactionHash", "logIndex"],
      for: "Which command already claims one chain log (live event claims, reads/receipts.ts:200).",
    },
  ],
  retention: "Orphaned bootstrap receipts are stamped `orphanedAt` (writes/bootstrap.ts:87); none are deleted.",
});

export const table_permission_allowances = defineTable({
  id: "permission-allowances",
  title: "Permission allowances: v4 child budgets under a hat",
  about:
    "A Protocol v4 spending allowance (CAP-1144): a child budget on the Budgets contract under a hat its holder wears, " +
    "made by one Director proposal (`proposalId`). `budgetId` is set once the proposal executes and the chain shows the " +
    "budget; `amount` is the token's raw units per the parent's period; `holder` is the first wearer, by email and Safe. " +
    "Payroll reads it directly for a run notice's label (payroll/runs/reads/notices.ts:31).",
  was: [`${T}/allowances.ts:9`, "packages/backend/convex/schema.ts:47", `${B}/allowances/writes.ts:92`],
  concept: concept_permissions,
  tenancy: "organization",
  tenantField: "orgId",
  fields: Schema.Struct({
    allowanceId: S,
    orgId: S,
    requestKey: S,
    proposerAuthUserId: S,
    name: S,
    token: S,
    amount: S,
    period: Schema.Literals(["month", "quarter", "year"]),
    parentBudgetId: S,
    budgetId: opt(S),
    hat: S,
    holder: opt(Member),
    status: Schema.Literals(["pending", "active", "abandoned"]),
    proposalId: S,
    createdAt: N,
    updatedAt: N,
  }),
  key: ["allowanceId"],
  indexes: [
    {
      name: "by_org_request",
      fields: ["orgId", "requestKey"],
      for: "A repeat of a create request, and the saved request key a create answers (allowances/reads.ts:50, allowances/writes.ts:55).",
    },
    {
      name: "by_org_status",
      fields: ["orgId", "status"],
      for: "An Organization's active and pending allowances: worn allowances and the list (allowances/reads/worn.ts:56, allowances/reads/commands.ts:148).",
    },
    {
      name: "by_allowance",
      fields: ["allowanceId"],
      for: "One allowance by id: Budget-left, commands, notices, settle; payroll's label read (allowances/reads/left.ts:14, allowances/writes.ts:115, payroll/runs/reads/notices.ts:33).",
    },
  ],
  retention: KEPT,
});

export const table_permission_allowance_commands = defineTable({
  id: "permission-allowance-commands",
  title: "Permission allowance commands: change, assign, revoke",
  about:
    "A Board write on a v4 allowance after it exists (W2): a new amount, one more wearer of its hat, or one wearer out, " +
    "each carried by one Director proposal. `hatSupply` is an assign's hat as Hats Protocol read it when the batch was " +
    "planned. `applied` once the proposal executed, `abandoned` if it never runs.",
  was: [`${T}/allowances.ts:34`, "packages/backend/convex/schema.ts:47", `${B}/allowances/writes/commands.ts:90`],
  concept: concept_permissions,
  tenancy: "organization",
  tenantField: "orgId",
  fields: Schema.Struct({
    commandId: S,
    orgId: S,
    allowanceId: S,
    requestKey: S,
    proposerAuthUserId: S,
    operation: Schema.Literals(["change", "assign", "revoke"]),
    amount: opt(S),
    member: opt(Member),
    hatSupply: opt(Schema.Struct({ supply: N, maxSupply: N })),
    status: Schema.Literals(["pending", "applied", "abandoned"]),
    proposalId: S,
    createdAt: N,
    updatedAt: N,
  }),
  key: ["commandId"],
  indexes: [
    {
      name: "by_org_request",
      fields: ["orgId", "requestKey"],
      for: "A repeat of a command request (allowances/writes/commands.ts:53, allowances/reads/commands.ts:73).",
    },
    {
      name: "by_allowance_status",
      fields: ["allowanceId", "status"],
      for: "One allowance's applied or pending commands: worn hats, the list, notices, an open command (allowances/reads/worn.ts:27, allowances/reads/commands.ts:86, allowances/writes/commands.ts:60).",
    },
    {
      name: "by_command",
      fields: ["commandId"],
      for: "One command by id: settle and notices (allowances/writes/commands.ts:110, allowances/reads/notices.ts:24).",
    },
  ],
  retention: KEPT,
});

// ── state machines ──────────────────────────────────────────────────────────────────────────

export const machine_permission = defineMachine({
  id: "permission",
  title: "Permission revision state",
  about:
    "permissions.state, per revision row. Every row is born `pending`: a create or change plan (writes/policies.ts:49, " +
    ":169), a replacement plan (writes/replacement-plans.ts:49), an invitation's new Budget (reads/bindings.ts:53) or a " +
    "founder's bootstrap (writes/bootstrap.ts:15). Submission suspends what a change or replacement replaces; the " +
    "verified receipt activates the new row and supersedes the old. A command that ends mismatched leaves the old row " +
    "`suspended`: no write restores it to `active`. An assign or revoke bumps the active row's revision in place (a " +
    "self-loop). No write ever sets `revoked`.",
  was: [`${T}/permissions.ts:6`, `${B}/writes/states.ts:21`, `${B}/writes/suspensions.ts:6`, `${B}/writes/abandonments.ts:73`],
  table: table_permissions,
  field: "state",
  initial: "pending",
  states: [
    { id: "pending", about: "A proposed revision its command has not applied; counts as authority only while nothing else holds the Permission." },
    { id: "active", about: "The current revision: the one every authority and spend check reads." },
    { id: "suspended", about: "The previous revision while a submitted change or replacement waits for its receipt." },
    { id: "revoked", about: "In the validator, but no old write sets it.", terminal: true },
    { id: "superseded", about: "Replaced by an applied revision, or proposed by a command that was abandoned.", terminal: true },
  ],
  transitions: {
    to_active: {
      from: ["pending"],
      to: "active",
      about:
        "A verified create, change or replacement (writes/states.ts:44, :77, :173), or a verified invitation configuration " +
        "that activates the inline Budgets it created (configurations/writes.ts:250).",
      guard: "Exactly one pending row at the command's expected revision on the command's Roles module; else the apply answers revision_mismatch.",
      emits: [],
    },
    to_suspended: {
      from: ["active"],
      to: "suspended",
      about: "A change's or replacement's UserOperation was submitted or its proposal executed (writes/suspensions.ts:25, :77).",
      guard: "The next revision exists `pending` on the same module (change), or on the new module (replacement).",
      emits: [],
    },
    to_superseded: {
      from: ["pending", "suspended"],
      to: "superseded",
      about:
        "The suspended previous revision once the change or replacement applies (writes/states.ts:76, :171); a pending " +
        "revision whose command ended unsent (writes/abandonments.ts:94).",
      emits: [],
    },
  },
});

export const machine_permission_assignment = defineMachine({
  id: "permission-assignment",
  title: "Permission assignment state",
  about:
    "permissionAssignments.state. Born `pending` by a create's first holder, an assign plan, a replacement plan or a " +
    "bootstrap (writes/holders.ts:46, writes/plans.ts:102, writes/replacement-plans.ts:90, writes/bootstrap.ts:37), or born " +
    "`active` by a verified invitation grant (grants/writes/grants.ts:137). A revoke suspends the assignment on " +
    "submission and revokes it on its receipt. Reconciliation revokes an active row whose chain authority is gone " +
    "(writes/assignments.ts:37). An invitation cleanup revokes every row of its generation with no state check.",
  was: [`${T}/permissions.ts:68`, `${B}/writes/states.ts:81`, `${B}/writes/suspensions.ts:29`, `${B}/grants/writes/cleanups.ts:38`],
  table: table_permission_assignments,
  field: "state",
  initial: "pending",
  states: [
    { id: "pending", about: "Proposed by a command that has not applied." },
    { id: "active", about: "The holder may act on the Permission; the authority checks read only this state." },
    { id: "suspended", about: "A submitted revoke or replacement waits for its receipt." },
    { id: "revoked", about: "Revoked by a verified revoke, a reconciliation or an invitation cleanup.", terminal: true },
    { id: "superseded", about: "Replaced by the replacement's new assignment, or proposed by an abandoned command." },
  ],
  transitions: {
    to_active: {
      from: ["pending", "suspended"],
      to: "active",
      about:
        "A verified create with a first holder, a verified assign, or a verified replacement's new assignment " +
        "(writes/states.ts:49, :103, :178). Born active by an invitation grant.",
      guard: "The single pending (or suspended) assignment the command names, and the active Permission at the expected revision.",
      emits: [],
    },
    to_suspended: {
      from: ["active"],
      to: "suspended",
      about: "A revoke's or a replacement's submission (writes/suspensions.ts:40, :79).",
      emits: [],
    },
    to_revoked: {
      from: ["pending", "active", "suspended", "superseded"],
      to: "revoked",
      about:
        "A verified revoke (writes/states.ts:103), reconciliation of a stale active row (writes/assignments.ts:37), or a " +
        "verified invitation compensation that revokes its generation's rows whatever their state (grants/writes/cleanups.ts:38).",
      emits: [],
    },
    to_superseded: {
      from: ["pending", "suspended"],
      to: "superseded",
      about: "The old assignment once a replacement applies (writes/states.ts:175); a pending assignment of an abandoned command (writes/abandonments.ts:94).",
      emits: [],
    },
  },
});

export const machine_permission_command = defineMachine({
  id: "permission-command",
  title: "Permission command state, both kinds",
  about:
    "permissionCommands.state for ordinary and invitation commands. Born `pending` (writes/command-rows.ts:61, " +
    "writes/configurations.ts:135, writes/invitations.ts:41, :104, writes/bootstrap.ts:47), or born `applied` as the " +
    "configure command a replacement carries over (writes/replacements.ts:137). An ordinary command never enters " +
    "`provider_failure` or `verified`: only the granter's record writes them. `applied`, `verified` and `abandoned` " +
    "are not guarded against every later write: a granter verification can still move `verified` to `applied`.",
  was: [`${T}/permissions.ts:14`, `${B}/writes/verifications.ts:104`, `${B}/grants/writes/verifications.ts:18`, `${B}/configurations/writes.ts:172`],
  table: table_permission_commands,
  field: "state",
  initial: "pending",
  states: [
    { id: "pending", about: "Prepared or proposed; waiting for its submission or its receipt." },
    { id: "verified", about: "An invitation command whose receipt was consumed but which activated nothing (cleanup_required, conflicting_replay)." },
    { id: "mismatch", about: "Its receipt did not prove it; the attempt's evidence is kept. A compensation can be re-verified." },
    { id: "provider_failure", about: "A granter receipt read failed at the provider; the drive retries." },
    { id: "applied", about: "Its receipt was verified and applied to the mirror." },
    { id: "abandoned", about: "Ended before anything reached the chain: its request key can never be used again.", terminal: true },
  ],
  transitions: {
    to_pending: {
      from: ["provider_failure"],
      to: "pending",
      about:
        "A non-verified result of an ordinary command's receipt (pending or provider_failure) re-marks a recoverable " +
        "command pending (writes/verifications.ts:131). No write puts an ordinary command in provider_failure, so this is a self-loop in practice.",
      emits: [],
    },
    to_mismatch: {
      from: ["pending", "provider_failure"],
      to: "mismatch",
      about:
        "A mismatched receipt: an ordinary command (writes/verifications.ts:120), a granter command (grants/writes/verifications.ts:81) " +
        "or an owned configuration attempt (configurations/writes.ts:211).",
      guard: "Ordinary: recoverable and not verified. Granter and configure: not applied or verified.",
      emits: [],
    },
    to_provider_failure: {
      from: ["pending"],
      to: "provider_failure",
      about: "A granter receipt read failed at the provider (grants/writes/verifications.ts:86).",
      emits: [],
    },
    to_verified: {
      from: ["pending", "provider_failure", "mismatch"],
      to: "verified",
      about: "A granter receipt verified but its application was cleanup_required or a conflicting replay (grants/writes/verifications.ts:119).",
      emits: [],
    },
    to_applied: {
      from: ["pending", "provider_failure", "mismatch", "verified"],
      to: "applied",
      about:
        "A verified ordinary receipt applied (writes/applications.ts:80), a granter grant or cleanup applied " +
        "(grants/writes/verifications.ts:100), a configuration applied (configurations/writes.ts:260).",
      guard: "Ordinary: the command's generation is current and its rows still match; an abandoned command's rows are superseded, so its apply answers revision_mismatch.",
      emits: [],
    },
    to_abandoned: {
      from: ["pending"],
      to: "abandoned",
      about:
        "An ordinary command whose approval lapsed or was refused unsent, whose prepare built no execution, or whose Director " +
        "proposal can never run, with no live attempt (writes/abandonments.ts:96).",
      emits: [],
    },
  },
});

export const machine_granter_execution = defineMachine({
  id: "granter-execution",
  title: "Granter EOA attempt of an invitation command",
  about:
    "permissionCommands.execution.state on the invitation shape. Every invitation command is born `unprepared`; a " +
    "configure command's stays so (the human UserOperation lives in payments' moneyExecutions). A grant, disable or " +
    "compensate is reserved on the shared EOA lane (one nonce per sender, a 120 s claim), signed by the granter key, " +
    "broadcast once and verified. A reserved claim that lapsed is re-reserved in place (a self-loop). A canonical revert " +
    "spends the nonce and joins `attempts`; a fresh reservation is allowed after it, until 16 attempts.",
  was: [`${T}/permissions.ts:181`, `${B}/grants/writes/executions.ts:21`, `${B}/grants/writes/verifications.ts:132`, `${B}/grants/rules.ts:119`],
  table: table_permission_commands,
  field: "execution.state",
  initial: "unprepared",
  states: [
    { id: "unprepared", about: "No attempt yet." },
    { id: "reserved", about: "A nonce and the simulated unsigned transaction, held by one claim token until claimExpiresAt." },
    { id: "signed", about: "The exact signed bytes are stored; nothing was sent yet, or the send's answer was lost." },
    { id: "submitted", about: "The stored bytes were broadcast under their expected hash." },
    { id: "included", about: "The transaction succeeded but its evidence refused the application." },
    { id: "reverted", about: "The transaction reverted on chain; the nonce is spent." },
    { id: "applied", about: "The receipt verified; the attempt is kept for reconciliation." },
  ],
  transitions: {
    to_reserved: {
      from: ["unprepared", "reverted"],
      to: "reserved",
      about: "grants.reserve (grants/writes/executions.ts:100).",
      guard: "The command is pending or provider_failure, the sender is its granter, no other live attempt holds the lane, fewer than 16 attempts.",
      emits: [],
    },
    to_signed: {
      from: ["reserved"],
      to: "signed",
      about: "grants.store-signature binds the recovered signer and the exact signed bytes (grants/writes/executions.ts:207).",
      guard: "The claim token is current and every signed field equals the reservation.",
      emits: [],
    },
    to_submitted: {
      from: ["signed"],
      to: "submitted",
      about: "grants.record-broadcast (grants/writes/executions.ts:234).",
      guard: "The broadcast hash is the stored expected hash.",
      emits: [],
    },
    to_included: {
      from: ["signed", "submitted"],
      to: "included",
      about: "A mismatched receipt for the live attempt's own successful transaction (grants/writes/verifications.ts:74).",
      emits: [],
    },
    to_reverted: {
      from: ["signed", "submitted", "included"],
      to: "reverted",
      about: "A mismatched receipt with code failed_transaction for the live attempt (grants/writes/verifications.ts:150).",
      emits: [],
    },
    to_applied: {
      from: ["unprepared", "reserved", "signed", "submitted", "included", "reverted"],
      to: "applied",
      about: "A verified receipt, whatever its application status (grants/writes/verifications.ts:101, :120; appliedExecution grants/rules.ts:119).",
      guard: "The generation and the signed attempt are current; a reverted attempt only for a compensation being re-verified.",
      emits: [],
    },
  },
});

export const machine_permission_allowance = defineMachine({
  id: "permission-allowance",
  title: "v4 allowance status",
  about:
    "permissionAllowances.status. Born `pending` with its Director proposal (allowances/writes.ts:92); settled once from " +
    "the proposal's outcome (allowances/writes.ts:118), only while pending.",
  was: [`${T}/allowances.ts:22`, `${B}/allowances/writes.ts:101`, `${B}/allowances/rules/settlement.ts:23`],
  table: table_permission_allowances,
  field: "status",
  initial: "pending",
  states: [
    { id: "pending", about: "Proposed; its proposal has not executed or failed." },
    { id: "active", about: "The proposal executed and the chain shows the budget (`budgetId` set).", terminal: true },
    { id: "abandoned", about: "The proposal can never run.", terminal: true },
  ],
  transitions: {
    to_active: {
      from: ["pending"],
      to: "active",
      about: "permissions.allowances.settle, from the executed proposal and the budget it created (allowances/writes.ts:118, rules/settlement.ts:36).",
      emits: [],
    },
    to_abandoned: {
      from: ["pending"],
      to: "abandoned",
      about: "permissions.allowances.settle for a proposal that can never run (allowances/rules/settlement.ts:23).",
      emits: [],
    },
  },
});

export const machine_permission_allowance_command = defineMachine({
  id: "permission-allowance-command",
  title: "v4 allowance command status",
  about:
    "permissionAllowanceCommands.status. Born `pending` with its Director proposal (allowances/writes/commands.ts:90); " +
    "settled once (allowances/writes/commands.ts:113), only while pending.",
  was: [`${T}/allowances.ts:45`, `${B}/allowances/writes/commands.ts:100`],
  table: table_permission_allowance_commands,
  field: "status",
  initial: "pending",
  states: [
    { id: "pending", about: "Proposed; its proposal has not executed or failed." },
    { id: "applied", about: "The proposal executed.", terminal: true },
    { id: "abandoned", about: "The proposal can never run.", terminal: true },
  ],
  transitions: {
    to_applied: {
      from: ["pending"],
      to: "applied",
      about: "permissions.allowances.settle-command (allowances/writes/commands.ts:113).",
      emits: [],
    },
    to_abandoned: {
      from: ["pending"],
      to: "abandoned",
      about: "permissions.allowances.settle-command for a proposal that can never run (allowances/writes/commands.ts:113).",
      emits: [],
    },
  },
});
