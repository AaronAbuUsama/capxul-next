// The permissions concept's own door, as it is: every function packages/backend/src/permissions/index.ts
// exports that runs inside its caller's Convex transaction. That is the Promise helpers that take the
// caller's QueryCtx or MutationCtx and throw CapxulErrors, and the Effect steps that read `Database` or
// `Transaction` from the caller's own operation and fail with the codes they name (the door's own
// words, index.ts:3-8). Other concepts import them as "#permissions" or by subpath.
//
// Not booked, because they are not in-transaction functions: the three authority snapshot validators
// (assignmentAuthoritySnapshot, bootstrapPermissionConfirmationValidator, setupAuthoritySnapshotValidator,
// index.ts:13), the pure rule commandIdentity (index.ts:70), readCompanyBudgets (index.ts:48), an
// action-side chain read through ChainRpc, and the door's type exports.
//
// Reads and writes are transitive within permissions: a procedure lists the tables its own helpers
// touch, and another concept's table its own code queries directly (the finding). A door function of
// ANOTHER concept that a procedure calls is NOT linked here: accounts, organizations, parties, payments
// and payroll all depend on permissions in the old code (shared/foundation.ts wire), so a link between
// two door files is an import cycle. Each such call is named in `about` by its conventional procedure id
// ("Calls … (not linked)"), and its refusal codes are listed in `errors`, so the assembly step can link
// them once it has broken the cycles. Rpc and workflow files link those procedures.

import { Schema } from "effect";
import { defineProcedure } from "../../../packages/book/src/index.ts";

import { concept_permissions } from "../shared/foundation.ts";
import {
  error_ACCOUNT_NOT_FOUND,
  error_INVALID_INPUT,
  error_ROLE_PERMISSION_DENIED,
  error_SMART_ACCOUNT_MISSING,
  error_UNKNOWN,
  error_WRONG_STATE,
} from "../shared/vocabulary.ts";
import {
  machine_permission,
  machine_permission_assignment,
  machine_permission_command,
  table_permission_allowance_commands,
  table_permission_allowances,
  table_permission_assignments,
  table_permission_commands,
  table_permission_receipts,
  table_permissions,
} from "./data.ts";
import { table_money_executions } from "../payments/data.ts";
import {
  table_org_lifecycles,
  table_org_members,
  table_org_roles,
  table_org_roles_deployments,
  table_orgs,
} from "../organizations/data.ts";
import { table_accounts } from "../accounts/data.ts";
import { table_parties } from "../parties/data.ts";

const P = "packages/backend/src/permissions";
const DOOR = `${P}/index.ts`;

const opt = Schema.optionalKey;
const S = Schema.String;
const N = Schema.Number;
const B = Schema.Boolean;
const U = Schema.Unknown;
const NullOr = Schema.NullOr;

const none = { drives: [], invokes: [], emits: [] } as const;

/** "Calls x, y (not linked)": another concept's door functions a procedure runs in the same transaction. */
const calls = (...ids: string[]) => ` Calls ${ids.join(", ")} (not linked: door cycle).`;

// ── shapes ──────────────────────────────────────────────────────────────────────────────────

/** `CommandAuthority` (guards/managers.ts:26): the caller's identity, Organization, Manage people Permission and assignment. */
const CommandAuthority = Schema.Struct({
  account: U,
  personalSafe: S,
  organization: Schema.Struct({ orgId: S, chainId: N, safeAddress: S }),
  permission: Schema.Struct({ permissionId: S, rolesModule: S, roleKey: S, revision: N }),
  assignment: Schema.Struct({ permissionAssignmentId: S }),
});

/** `SpendAuthority` (guards/spending.ts:20). */
const SpendAuthority = Schema.Struct({
  permission: Schema.Struct({
    permissionId: S,
    assetId: S,
    decimals: N,
    limitRaw: opt(S),
    label: opt(S),
  }),
  assignment: Schema.Struct({ permissionAssignmentId: S }),
  roleKeys: Schema.Array(S),
});

/** `AssignmentAuthoritySnapshot` (views/snapshots.ts): what reconciliation compares against the chain. */
const AssignmentAuthoritySnapshot = Schema.Struct({
  permissionRowId: S,
  assignmentRowId: S,
  permissionUpdatedAt: N,
  assignmentUpdatedAt: N,
  revision: N,
  rolesModule: S,
  roleKey: S,
  memberSafe: S,
  actorId: S,
  verifiedBlock: N,
  verifiedBlockHash: S,
  verifiedLogIndex: N,
});

/** `WireAssignmentProjection` (reads/assignments.ts:92). `policy` is the stored intent JSON, parsed. */
const WireAssignmentProjection = Schema.Struct({
  id: S,
  authority: Schema.Union([
    Schema.Struct({ type: Schema.Literal("budget"), budgetId: S }),
    Schema.Struct({ type: Schema.Literal("managePeople"), permissionId: S }),
  ]),
  state: Schema.Literals(["pending", "active", "suspended", "revoked"]),
  policy: U,
  revision: N,
  observedAt: N,
});

/** `PermissionExecutionProof` (reads/approvals.ts:83). */
const ExecutionProof = Schema.Union([
  Schema.Struct({ outcome: Schema.Literal("pending") }),
  Schema.Struct({
    outcome: Schema.Literals(["applied", "mismatch"]),
    receipt: Schema.Struct({ userOpHash: S, transactionHash: S, succeeded: B }),
  }),
]);

/** A payments `moneyExecutions` row as the proof reads take it: a whole stored row. */
const Execution = Schema.Struct({ execution: U });

// ── what shared helpers touch (lists spread into the records below) ────────────────────────

const ACCOUNT_IDENTITY = "accounts.require-exact-account-identity-in-tx";
const ACCOUNT_ERRORS = [error_SMART_ACCOUNT_MISSING, error_ACCOUNT_NOT_FOUND, error_UNKNOWN];

/** requireCommandAuthority (guards/managers.ts:57): reads `orgs` and `orgLifecycles` directly. */
const AUTHORITY_READS = [table_orgs, table_org_lifecycles, table_permissions, table_permission_assignments, table_permission_receipts];
const AUTHORITY_ERRORS = [error_INVALID_INPUT, error_ROLE_PERMISSION_DENIED, ...ACCOUNT_ERRORS];
const AUTHORITY =
  "requireCommandAuthority: the caller's exact Account and Safe, a Base Sepolia Organization (else INVALID_INPUT), a usable " +
  "bootstrap (orgLifecycles completed with a verified proof), and an active Manage people Permission the caller is singly " +
  "assigned whose revision and assignment a verified receipt proves (an invitation batch receipt proves both); the " +
  "lowest permissionId wins; none is ROLE_PERMISSION_DENIED.";

/** readPermissionEvidenceInTx (reads/evidence.ts:28): the receipts and commands that prove one Permission. */
const EVIDENCE_READS = [table_permissions, table_permission_assignments, table_permission_commands, table_permission_receipts];

/** endUnsentCommand (writes/abandonments.ts:73): the `pending` rows a command proposed settle superseded. */
const ABANDON_READS = [table_permission_commands, table_money_executions, table_permissions, table_permission_assignments];
const ABANDON_WRITES = [table_permission_commands, table_permissions, table_permission_assignments];
const ABANDON_DRIVES = [
  machine_permission.t.to_superseded,
  machine_permission_assignment.t.to_superseded,
  machine_permission_command.t.to_abandoned,
];

/** applyVerifiedResult (writes/applications.ts:20) for a bootstrap command: state, receipts, applied. */
const APPLY_READS = [table_permission_commands, table_permission_receipts, table_permissions, table_permission_assignments];
const APPLY_WRITES = [table_permission_commands, table_permission_receipts, table_permissions, table_permission_assignments];

// ── managers ────────────────────────────────────────────────────────────────────────────────

export const procedure_permissions_require_command_authority = defineProcedure({
  id: "permissions.require-command-authority",
  title: "Require the caller's current Manage people authority",
  about:
    AUTHORITY +
    " Every Permission command, invitation configuration and execution re-proof runs it. Organizations, Parties, Media, " +
    "Activity and Payment requests reach it through the door." +
    calls(ACCOUNT_IDENTITY),
  was: [`${P}/guards/managers.ts:57`, `${P}/guards/managers.ts:41`, `${P}/reads/assignments.ts:31`, `${DOOR}:25`],
  concept: concept_permissions,
  input: Schema.Struct({ authUserId: S, orgId: S }),
  output: CommandAuthority,
  errors: AUTHORITY_ERRORS,
  reads: AUTHORITY_READS,
  writes: [],
  ...none,
});

export const procedure_permissions_find_command_authority = defineProcedure({
  id: "permissions.find-command-authority",
  title: "Find the caller's Manage people authority, or null",
  about:
    "The read-side view of requireCommandAuthority: SMART_ACCOUNT_MISSING, ACCOUNT_NOT_FOUND, INVALID_INPUT and " +
    "ROLE_PERMISSION_DENIED are absorbed as null (absentOnRefusal, guards/managers.ts:148); any other failure, UNKNOWN " +
    "included, propagates. Payments' Director guard uses it to decide whether a cancel or redirect runs through the " +
    "Director role.",
  was: [`${P}/guards/managers.ts:165`, `${P}/guards/managers.ts:148`, `${DOOR}:23`],
  concept: concept_permissions,
  input: Schema.Struct({ authUserId: S, orgId: S }),
  output: NullOr(CommandAuthority),
  errors: [error_UNKNOWN],
  reads: AUTHORITY_READS,
  writes: [],
  drives: [],
  invokes: [procedure_permissions_require_command_authority],
  emits: [],
});

export const procedure_permissions_require_manager = defineProcedure({
  id: "permissions.require-manager",
  title: "Require Manage people authority, as an Effect step",
  about:
    "The Effect form of requireCommandAuthority on the caller's `Database`, admitting MANAGER_REFUSALS " +
    "(ROLE_PERMISSION_DENIED, SMART_ACCOUNT_MISSING, ACCOUNT_NOT_FOUND, INVALID_INPUT); on success it lets telemetry name " +
    "the Organization (organizationVerified).",
  was: [`${P}/guards/managers.ts:188`, `${P}/guards/managers.ts:177`, `${DOOR}:26`],
  concept: concept_permissions,
  input: Schema.Struct({ authUserId: S, orgId: S }),
  output: CommandAuthority,
  errors: AUTHORITY_ERRORS,
  reads: AUTHORITY_READS,
  writes: [],
  drives: [],
  invokes: [procedure_permissions_require_command_authority],
  emits: [],
});

export const procedure_permissions_find_manager = defineProcedure({
  id: "permissions.find-manager",
  title: "Find Manage people authority, or null, as an Effect step",
  about: "The Effect form of findCommandAuthority on the caller's `Database`; admits no codes, so UNKNOWN is a defect.",
  was: [`${P}/guards/managers.ts:199`, `${DOOR}:24`],
  concept: concept_permissions,
  input: Schema.Struct({ authUserId: S, orgId: S }),
  output: NullOr(CommandAuthority),
  errors: [error_UNKNOWN],
  reads: AUTHORITY_READS,
  writes: [],
  drives: [],
  invokes: [procedure_permissions_find_command_authority],
  emits: [],
});

export const procedure_permissions_org_bootstrap_authority_usable = defineProcedure({
  id: "permissions.org-bootstrap-authority-usable",
  title: "Whether an Organization's bootstrap admits authority now",
  about:
    "True when exactly one orgLifecycles row exists, completed, with a `verified` proof: one index read of Organizations' " +
    "table, made directly. Every Organization gate asks it first.",
  was: [`${P}/guards/bootstraps.ts:8`, `${DOOR}:29`],
  concept: concept_permissions,
  input: Schema.Struct({ orgId: S }),
  output: B,
  errors: [],
  reads: [table_org_lifecycles],
  writes: [],
  ...none,
});

// ── people (Protocol v4) ────────────────────────────────────────────────────────────────────

const PEOPLE_READS = [...AUTHORITY_READS, table_org_roles, table_org_roles_deployments, table_org_members];
const PEOPLE =
  "On a Protocol v4 company (orgLifecycles.protocol `v4`) the People hat manages people: an active orgRoles row with the " +
  "People scope, a confirmed orgRolesDeployments row, and the caller an active orgMember at their own Safe who holds the " +
  "`manage-people` Seat permission; it answers a CommandAuthority with permissionId `hat:<roleKey>` and revision 0. Any " +
  "other Organization runs requireCommandAuthority. It reads Organizations' tables directly.";

export const procedure_permissions_require_people_manager = defineProcedure({
  id: "permissions.require-people-manager",
  title: "Require people-management authority (People hat on v4)",
  about:
    PEOPLE +
    " Effect step admitting MANAGER_REFUSALS; names the Organization to telemetry. Organizations' invitations use it." +
    calls(ACCOUNT_IDENTITY, "organizations.holds-seat-permission-in-tx"),
  was: [`${P}/guards/people.ts:118`, `${P}/guards/people.ts:37`, `${P}/guards/people.ts:98`, `${DOOR}:32`],
  concept: concept_permissions,
  input: Schema.Struct({ authUserId: S, orgId: S }),
  output: CommandAuthority,
  errors: AUTHORITY_ERRORS,
  reads: PEOPLE_READS,
  writes: [],
  drives: [],
  invokes: [procedure_permissions_require_command_authority, procedure_permissions_org_bootstrap_authority_usable],
  emits: [],
});

export const procedure_permissions_find_people_authority_in_tx = defineProcedure({
  id: "permissions.find-people-authority-in-tx",
  title: "Find people-management authority, or null",
  about: PEOPLE + " Refusals are absorbed as null (absentOnRefusal)." + calls(ACCOUNT_IDENTITY, "organizations.holds-seat-permission-in-tx"),
  was: [`${P}/guards/people.ts:129`, `${DOOR}:32`],
  concept: concept_permissions,
  input: Schema.Struct({ authUserId: S, orgId: S }),
  output: NullOr(CommandAuthority),
  errors: [error_UNKNOWN],
  reads: PEOPLE_READS,
  writes: [],
  drives: [],
  invokes: [procedure_permissions_require_command_authority, procedure_permissions_org_bootstrap_authority_usable],
  emits: [],
});

export const procedure_permissions_find_people_manager = defineProcedure({
  id: "permissions.find-people-manager",
  title: "Find people-management authority, or null, as an Effect step",
  about: "The Effect form of findPeopleAuthorityInTx on the caller's `Database`.",
  was: [`${P}/guards/people.ts:136`, `${DOOR}:32`],
  concept: concept_permissions,
  input: Schema.Struct({ authUserId: S, orgId: S }),
  output: NullOr(CommandAuthority),
  errors: [error_UNKNOWN],
  reads: PEOPLE_READS,
  writes: [],
  drives: [],
  invokes: [procedure_permissions_find_people_authority_in_tx],
  emits: [],
});

// ── members ─────────────────────────────────────────────────────────────────────────────────

export const procedure_permissions_verified_member_participation = defineProcedure({
  id: "permissions.verified-member-participation",
  title: "A member's receipt-backed role: Admin, Member or none",
  about:
    "For an active orgMembers row with a hex Safe and a Party: the active assignments at that Safe that name the member " +
    "(a Party row from an invitation, or an Account row of the member's attached Account), each kept only when its single " +
    "current Permission is active and an admission and current evidence (receipts and commands) prove it. Admin when any " +
    "is managePeople; null when none." +
    calls("accounts.read-attached-account-for-safe-in-tx"),
  was: [`${P}/guards/members.ts:15`, `${P}/reads/evidence.ts:28`, `${DOOR}:35`],
  concept: concept_permissions,
  input: Schema.Struct({
    member: Schema.Struct({ status: S, personalSafeAddress: opt(S), partyId: opt(S), authUserId: opt(S), orgId: S }),
  }),
  output: NullOr(Schema.Struct({ role: Schema.Literals(["Admin", "Member"]) })),
  errors: [],
  reads: EVIDENCE_READS,
  writes: [],
  ...none,
});

export const procedure_permissions_has_setup_recovery_read_admission_in_tx = defineProcedure({
  id: "permissions.has-setup-recovery-read-admission-in-tx",
  title: "Whether a member may read an Organization's setup recovery",
  about:
    "True when an active assignment at the member's Safe names their Party or their Base Sepolia Account and its single " +
    "active Permission has an admission (provisional receipts admitted). It reads Accounts' `accounts` table directly " +
    "(by_auth_user_chain, chain 84532).",
  was: [`${P}/guards/members.ts:105`, `${P}/guards/members.ts:119`, `${DOOR}:35`],
  concept: concept_permissions,
  input: Schema.Struct({ authUserId: S, orgId: S, memberSafe: S, memberPartyId: S }),
  output: B,
  errors: [],
  reads: [table_accounts, ...EVIDENCE_READS],
  writes: [],
  ...none,
});

// ── spending ────────────────────────────────────────────────────────────────────────────────

export const procedure_permissions_list_spend_authorities = defineProcedure({
  id: "permissions.list-spend-authorities",
  title: "Every Budget the caller may spend from in an Organization",
  about:
    "The Account's assignment groups (by_member_safe), each kept when its single active revision is a spendable Budget " +
    "(this Organization, `budget`, active, a configured money asset) with one active assignment; every role key the " +
    "Budget carried, newest first. Empty when the bootstrap is not usable. Refusals are absorbed as an empty list. " +
    "Payroll and Organizations (`org me`) read it." +
    calls(ACCOUNT_IDENTITY),
  was: [`${P}/guards/spending.ts:87`, `${P}/guards/spending.ts:105`, `${P}/reads/assignments.ts:55`, `${DOOR}:40`],
  concept: concept_permissions,
  input: Schema.Struct({ authUserId: S, orgId: S }),
  output: Schema.Array(SpendAuthority),
  errors: [error_UNKNOWN],
  reads: [table_org_lifecycles, table_permission_assignments, table_permissions],
  writes: [],
  drives: [],
  invokes: [procedure_permissions_org_bootstrap_authority_usable],
  emits: [],
});

export const procedure_permissions_read_budget_allowance_in_tx = defineProcedure({
  id: "permissions.read-budget-allowance-in-tx",
  title: "Read the Roles allowance a capped Budget spends from",
  about:
    "For the prepare action to read on chain before it builds (#2297): the one active spendable Budget's Roles module, " +
    "allowance key, asset and decimals; null for an unlimited Budget (no allowanceKey, ADR-0024 R5) or when the " +
    "Organization has no such Budget. Payments' funding and schedule reads call it. It does not check the bootstrap.",
  was: [`${P}/guards/spending.ts:230`, `${P}/guards/spending.ts:238`, `${DOOR}:41`],
  concept: concept_permissions,
  input: Schema.Struct({ orgId: S, permissionId: S }),
  output: NullOr(Schema.Struct({ rolesModule: S, allowanceKey: S, assetId: S, decimals: N })),
  errors: [],
  reads: [table_permissions],
  writes: [],
  ...none,
});

export const procedure_permissions_require_organization_spend_authority_in_tx = defineProcedure({
  id: "permissions.require-organization-spend-authority-in-tx",
  title: "Require Budget authority for an Organization payment",
  about:
    "The bootstrap must be usable and the Account singly assigned to the one active spendable Budget " +
    "(ROLE_PERMISSION_DENIED, membership); its token must be the payment's (condition) and a stored cap not exceeded by " +
    "the raw amount (cap; a negative amount is also cap). A stored limitRaw that is not an integer is UNKNOWN (stored row " +
    "broken). Returns the Permission's Safe, Roles module and role key and the assignment. Payments' authority guard " +
    "calls it; authorities.authorize runs its row form.",
  was: [`${P}/guards/spending.ts:142`, `${P}/guards/spending.ts:169`, `${DOOR}:42`],
  concept: concept_permissions,
  input: Schema.Struct({ account: U, orgId: S, permissionId: S, tokenAddress: S, requiredRawAmount: Schema.BigInt }),
  output: Schema.Struct({
    permission: Schema.Struct({ permissionId: S, organizationSafe: S, rolesModule: S, roleKey: S }),
    assignment: Schema.Struct({ permissionAssignmentId: S }),
  }),
  errors: [error_ROLE_PERMISSION_DENIED, error_UNKNOWN],
  reads: [table_org_lifecycles, table_permissions, table_permission_assignments],
  writes: [],
  drives: [],
  invokes: [procedure_permissions_org_bootstrap_authority_usable],
  emits: [],
});

export const procedure_permissions_read_worn_allowances_in_tx = defineProcedure({
  id: "permissions.read-worn-allowances-in-tx",
  title: "Read the v4 allowances whose hat a Safe wears",
  about:
    "The Organization's on-chain allowances (active, or pending whose create proposal executed) whose hat the Safe wears " +
    "now: its holder at create, then each applied command and each pending one whose proposal executed, in order. " +
    "Payments' budget guard and Organizations' `org me` read it." +
    calls("organizations.read-subject-proposal-in-tx"),
  was: [`${P}/allowances/reads/worn.ts:70`, `${P}/allowances/reads/worn.ts:51`, `${P}/allowances/reads/worn.ts:22`, `${DOOR}:46`],
  concept: concept_permissions,
  input: Schema.Struct({ orgId: S, safe: S }),
  output: Schema.Array(U),
  errors: [],
  reads: [table_permission_allowances, table_permission_allowance_commands],
  writes: [],
  ...none,
});

// ── assignments ─────────────────────────────────────────────────────────────────────────────

export const procedure_permissions_load_assignment_authority = defineProcedure({
  id: "permissions.load-assignment-authority",
  title: "Snapshot the receipt-proved active assignments of an Organization",
  about:
    "One AssignmentAuthoritySnapshot per active person assignment (account or party) of an active Permission whose latest " +
    "verified receipt proves it: an invitation receipt that proves the assignment, or for an account row a receipt from " +
    "the Permission's Roles module that is a replacement or names this Permission and assignment. External grants create " +
    "none. Organizations' and Indexing's reconciliation read it.",
  was: [`${P}/reads/assignments.ts:167`, `${DOOR}:53`],
  concept: concept_permissions,
  input: Schema.Struct({ orgId: S }),
  output: Schema.Array(AssignmentAuthoritySnapshot),
  errors: [],
  reads: [table_permissions, table_permission_receipts, table_permission_assignments],
  writes: [],
  ...none,
});

export const procedure_permissions_read_account_assignments_in_tx = defineProcedure({
  id: "permissions.read-account-assignments-in-tx",
  title: "An Account's assignment projection, for `org me`",
  about:
    "The Account's assignment groups, each assignment that is not superseded projected with its Permission's authority, " +
    "state, parsed policy and revision. Two settled current revisions refuse WRONG_STATE (assignmentAuthorityAmbiguous); " +
    "a current revision with no policyJson or label refuses WRONG_STATE (assignmentPolicyMissing), both naming the " +
    "caller's method.",
  was: [`${P}/reads/assignments.ts:118`, `${P}/reads/assignments.ts:109`, `${DOOR}:54`],
  concept: concept_permissions,
  input: Schema.Struct({ account: U, orgId: S, method: S }),
  output: Schema.Array(WireAssignmentProjection),
  errors: [error_WRONG_STATE],
  reads: [table_permission_assignments, table_permissions],
  writes: [],
  ...none,
});

export const procedure_permissions_read_budget_holder_safes_in_tx = defineProcedure({
  id: "permissions.read-budget-holder-safes-in-tx",
  title: "The member Safes that can spend from a Budget now",
  about:
    "The lowercase member Safes of active assignments on the Organization's active Budget Permissions. Requests mails an " +
    "Invoice to these holders.",
  was: [`${P}/reads/assignments.ts:295`, `${P}/reads/assignments.ts:249`, `${DOOR}:55`],
  concept: concept_permissions,
  input: Schema.Struct({ orgId: S }),
  output: Schema.Array(S),
  errors: [],
  reads: [table_permissions, table_permission_assignments],
  writes: [],
  ...none,
});

export const procedure_permissions_read_manage_people_holder_safes_in_tx = defineProcedure({
  id: "permissions.read-manage-people-holder-safes-in-tx",
  title: "The member Safes that hold or are about to hold Manage Budgets",
  about:
    "Pending or active assignments on pending or active managePeople Permissions. Payroll refuses a department holder " +
    "among them (ROLE_CONFLICT, ADR-0040).",
  was: [`${P}/reads/assignments.ts:291`, `${P}/reads/assignments.ts:249`, `${DOOR}:56`],
  concept: concept_permissions,
  input: Schema.Struct({ orgId: S }),
  output: Schema.Array(S),
  errors: [],
  reads: [table_permissions, table_permission_assignments],
  writes: [],
  ...none,
});

export const procedure_permissions_read_member_safe_references_in_tx = defineProcedure({
  id: "permissions.read-member-safe-references-in-tx",
  title: "Whether any assignment names one of these Safes",
  about:
    "A purge keeps a Safe that any assignment in any state names: answers [\"permissionAssignments\"] when one does, " +
    "reading each Safe lowercase and checksummed.",
  was: [`${P}/reads/assignments.ts:231`, `${DOOR}:57`],
  concept: concept_permissions,
  input: Schema.Struct({ safes: Schema.Array(S) }),
  output: Schema.Array(S),
  errors: [error_INVALID_INPUT],
  reads: [table_permission_assignments],
  writes: [],
  ...none,
});

export const procedure_permissions_reconcile_assignment_authority = defineProcedure({
  id: "permissions.reconcile-assignment-authority",
  title: "Revoke the exact assignment a reconciliation found stale",
  about:
    "Re-reads the snapshot's Permission and assignment rows by id; when both still match the snapshot exactly (same " +
    "Organization, both active, same revision, module, role key, actor, Safe and update times) it revokes the assignment " +
    "and returns its id; else null (a stale plan). Organizations' and Indexing's reconciliation call it.",
  was: [`${P}/writes/assignments.ts:11`, `${P}/writes/assignments.ts:37`, `${DOOR}:60`],
  concept: concept_permissions,
  input: Schema.Struct({ orgId: S, expected: AssignmentAuthoritySnapshot, at: N }),
  output: NullOr(S),
  errors: [],
  reads: [table_permissions, table_permission_assignments],
  writes: [table_permission_assignments],
  drives: [machine_permission_assignment.t.to_revoked],
  invokes: [],
  emits: [],
});

// ── setup and bootstrap ─────────────────────────────────────────────────────────────────────

export const procedure_permissions_read_bootstrap_permission_receipt_ids_in_tx = defineProcedure({
  id: "permissions.read-bootstrap-permission-receipt-ids-in-tx",
  title: "The bootstrap's recorded receipt ids, in native order",
  about:
    "The Organization's receipts of the named commands at this UserOperation and transaction with a real log index; none " +
    "is UNKNOWN (rowVanished, step bootstrapReceipts).",
  was: [`${P}/reads/bootstrap.ts:5`, `${DOOR}:65`],
  concept: concept_permissions,
  input: Schema.Struct({ orgId: S, commandIds: Schema.Array(S), userOpHash: S, transactionHash: S }),
  output: Schema.Array(S),
  errors: [error_UNKNOWN],
  reads: [table_permission_receipts],
  writes: [],
  ...none,
});

export const procedure_permissions_read_bootstrap_roles_module_in_tx = defineProcedure({
  id: "permissions.read-bootstrap-roles-module-in-tx",
  title: "The Roles module one ordinary bootstrap command names",
  about: "The rolesModule of exactly one ordinary command with this id; null otherwise.",
  was: [`${P}/reads/bootstrap.ts:40`, `${DOOR}:66`],
  concept: concept_permissions,
  input: Schema.Struct({ commandId: S }),
  output: NullOr(S),
  errors: [],
  reads: [table_permission_commands],
  writes: [],
  ...none,
});

export const procedure_permissions_load_setup_authority_snapshot = defineProcedure({
  id: "permissions.load-setup-authority-snapshot",
  title: "Inventory an Organization's active authority before setup holds release",
  about:
    "The SetupAuthoritySnapshot (views/snapshots.ts): every active Permission and assignment with its admission, the " +
    "bootstrap rows flagged, provisional rows tied to the previous receipts; a missing admission stays visible. Too deep " +
    "to transcribe: Unknown.",
  was: [`${P}/reads/setup.ts:10`, `${DOOR}:68`],
  concept: concept_permissions,
  input: Schema.Struct({ orgId: S, bootstrap: Schema.Array(U), provisional: opt(U) }),
  output: U,
  errors: [],
  reads: EVIDENCE_READS,
  writes: [],
  ...none,
});

export const procedure_permissions_setup_authority_snapshot_matches = defineProcedure({
  id: "permissions.setup-authority-snapshot-matches",
  title: "Whether a setup authority snapshot still matches",
  about:
    "Rechecks the complete active id sets and every captured row (and, with a previous proof, that the previous receipts " +
    "are orphaned at that proof) before Organizations releases a setup hold.",
  was: [`${P}/reads/snapshots.ts:11`, `${DOOR}:69`],
  concept: concept_permissions,
  input: Schema.Struct({ orgId: S, snapshot: U, previousReceiptIds: opt(Schema.Array(S)), previousProof: opt(U) }),
  output: B,
  errors: [],
  reads: EVIDENCE_READS,
  writes: [],
  ...none,
});

export const procedure_permissions_orphan_bootstrap_receipts_in_tx = defineProcedure({
  id: "permissions.orphan-bootstrap-receipts-in-tx",
  title: "Orphan the bootstrap receipts a setup reorg replaced",
  about:
    "Stamps orphanedAt on each named receipt of this Organization at the given UserOperation, transaction and block hash " +
    "that is not orphaned yet.",
  was: [`${P}/writes/bootstrap.ts:67`, `${P}/writes/bootstrap.ts:87`, `${DOOR}:72`],
  concept: concept_permissions,
  input: Schema.Struct({ receiptIds: Schema.Array(S), orgId: S, userOpHash: S, transactionHash: S, blockHash: S, now: N }),
  output: Schema.Void,
  errors: [],
  reads: [table_permission_receipts],
  writes: [table_permission_receipts],
  ...none,
});

export const procedure_permissions_write_confirmed_bootstrap_permission = defineProcedure({
  id: "permissions.write-confirmed-bootstrap-permission",
  title: "Write a founder's confirmed bootstrap Permission and apply it",
  about:
    "Inserts the Permission (pending), the founder's assignment (pending) and the ordinary command (pending), then applies " +
    "the setup's verified receipt through applyVerifiedResult: the rows go active, the receipts are appended, the command " +
    "goes applied. Any apply status but `applied` refuses WRONG_STATE (bootstrapApplyStateInvalid); a receipt that does " +
    "not name the command or its UserOperation refuses INVALID_INPUT." +
    calls("payments.close-verified-command-execution-in-tx", "organizations.record-member-permission-application-in-tx (an assign only)"),
  was: [`${P}/writes/bootstrap.ts:8`, `${P}/writes/applications.ts:20`, `${DOOR}:72`],
  concept: concept_permissions,
  input: Schema.Struct({ input: U, accountId: S, now: N }),
  output: Schema.Void,
  errors: [error_WRONG_STATE, error_INVALID_INPUT, error_UNKNOWN],
  reads: APPLY_READS,
  writes: APPLY_WRITES,
  drives: [machine_permission.t.to_active, machine_permission_assignment.t.to_active, machine_permission_command.t.to_applied],
  invokes: [],
  emits: [],
});

export const procedure_permissions_rebind_bootstrap_permissions = defineProcedure({
  id: "permissions.rebind-bootstrap-permissions",
  title: "Rebind applied bootstrap Permissions to their new receipts",
  about:
    "After a setup reorg: when every previous receipt is orphaned at this UserOperation, append the new occurrence's " +
    "receipts for each bootstrap command (or reuse matching ones) without replaying its state transition, and point the " +
    "captured founder assignment's verifiedReceiptId at the new AssignRoles receipt. Null when anything no longer matches.",
  was: [`${P}/writes/rebinding.ts:15`, `${P}/writes/rebinding.ts:200`, `${DOOR}:73`],
  concept: concept_permissions,
  input: Schema.Struct({
    orgId: S,
    userOpHash: S,
    previousReceiptIds: Schema.Array(S),
    founderAccountId: S,
    founderSafe: S,
    snapshot: U,
    permissions: Schema.Array(U),
    now: N,
  }),
  output: NullOr(Schema.Array(S)),
  errors: [],
  reads: [table_permission_receipts, table_permission_commands, table_permission_assignments, table_permissions],
  writes: [table_permission_receipts, table_permission_assignments],
  ...none,
});

// ── invitations ─────────────────────────────────────────────────────────────────────────────

export const procedure_permissions_read_configuration_collision = defineProcedure({
  id: "permissions.read-configuration-collision",
  title: "Whether a configure command id is taken, and by which request",
  about:
    "Effect step on the caller's `Database`: occupied when any command has the id; `original` names the configure " +
    "command's chain, Safe, module, invitation and generation when it is this inviter's configure command of this " +
    "Organization and chain.",
  was: [`${P}/reads/invitations.ts:11`, `${P}/reads/invitations.ts:57`, `${DOOR}:78`],
  concept: concept_permissions,
  input: Schema.Struct({ commandId: S, orgId: S, chainId: N, authUserId: S }),
  output: Schema.Struct({ occupied: B, original: NullOr(U) }),
  errors: [],
  reads: [table_permission_commands],
  writes: [],
  ...none,
});

export const procedure_permissions_read_invitation_configuration_state_in_tx = defineProcedure({
  id: "permissions.read-invitation-configuration-state-in-tx",
  title: "An invitation command's state and execution state",
  about: "Null when the row is missing or not an invitation command. Organizations' ending policy reads it.",
  was: [`${P}/reads/invitations.ts:43`, `${DOOR}:79`],
  concept: concept_permissions,
  input: Schema.Struct({ commandId: S }),
  output: NullOr(Schema.Struct({ state: S, executionState: S })),
  errors: [],
  reads: [table_permission_commands],
  writes: [],
  ...none,
});

export const procedure_permissions_read_invitation_verification_retry_state_in_tx = defineProcedure({
  id: "permissions.read-invitation-verification-retry-state-in-tx",
  title: "Whether a granter command's receipt may be re-verified",
  about: "Eligible when the granter command's execution is submitted or included; `missing` unless it is a grant command.",
  was: [`${P}/reads/invitations.ts:27`, `${P}/reads/executions.ts:122`, `${DOOR}:80`],
  concept: concept_permissions,
  input: Schema.Struct({ commandId: S }),
  output: Schema.Struct({ eligible: B, executionState: S }),
  errors: [],
  reads: [table_permission_commands],
  writes: [],
  ...none,
});

export const procedure_permissions_read_live_assignments = defineProcedure({
  id: "permissions.read-live-assignments",
  title: "The live assignments a Safe holds on these Permissions",
  about: "Effect step on the caller's `Database`: ids of assignments neither revoked nor superseded at the Safe, sorted; none for a null Safe.",
  was: [`${P}/reads/invitations.ts:20`, `${P}/reads/invitations.ts:89`, `${DOOR}:81`],
  concept: concept_permissions,
  input: Schema.Struct({ memberSafe: NullOr(S), permissionIds: Schema.Array(S) }),
  output: Schema.Array(S),
  errors: [],
  reads: [table_permission_assignments],
  writes: [],
  ...none,
});

export const procedure_permissions_preview_grants = defineProcedure({
  id: "permissions.preview-grants",
  title: "Preview what each offered grant would be",
  about:
    "Effect step on the caller's `Database`, admitting WRONG_STATE and INVALID_INPUT: each grant as an existing active " +
    "Permission (with its stored intent and policy digest) or a resolved new Budget. A binding that moved refuses " +
    "WRONG_STATE; an unconfigured asset or a bad allowlist INVALID_INPUT; a stored policy that does not decode UNKNOWN." +
    calls("accounts.read-exact-target-account-in-tx"),
  was: [`${P}/reads/previews.ts:30`, `${P}/reads/policies.ts:18`, `${P}/reads/policies.ts:86`, `${DOOR}:83`],
  concept: concept_permissions,
  input: Schema.Struct({ input: U, grants: Schema.Array(U) }),
  output: Schema.Array(U),
  errors: [error_WRONG_STATE, error_INVALID_INPUT, error_UNKNOWN],
  reads: [table_permissions],
  writes: [],
  ...none,
});

export const procedure_permissions_read_invitation_offer_binding_in_tx = defineProcedure({
  id: "permissions.read-invitation-offer-binding-in-tx",
  title: "Hydrate one persisted offered binding",
  about:
    "The binding's single non-superseded Permission must still be this Organization's, of the binding's type, Safe, " +
    "module, role key and asset, and labelled; else WRONG_STATE (invitation binding changed). Returns the offer and its " +
    "authority with the policy digest.",
  was: [`${P}/reads/previews.ts:121`, `${P}/reads/bindings.ts:128`, `${DOOR}:83`],
  concept: concept_permissions,
  input: Schema.Struct({ orgId: S, organizationSafe: S, rolesModule: S, binding: U }),
  output: Schema.Struct({ offer: U, authority: Schema.Struct({ type: S, permissionId: S, policyDigest: U }) }),
  errors: [error_WRONG_STATE, error_UNKNOWN],
  reads: [table_permissions],
  writes: [],
  ...none,
});

export const procedure_permissions_has_uncertain_invitation_configuration_execution = defineProcedure({
  id: "permissions.has-uncertain-invitation-configuration-execution",
  title: "Whether any attempt of a configuration could still reach the chain",
  about:
    "True when the configure command carries a Director proposal's execution and is not applied, or any of its human " +
    "attempts is in an uncertain state and is not the one its saved verification resolved. It reads Payments' " +
    "moneyExecutions table directly (by_command, commandKind invitation_configuration).",
  was: [`${P}/reads/occupancy.ts:160`, `${P}/reads/occupancy.ts:165`, `${DOOR}:84`],
  concept: concept_permissions,
  input: Schema.Struct({ configCommandId: S }),
  output: B,
  errors: [],
  reads: [table_money_executions, table_permission_commands],
  writes: [],
  ...none,
});

export const procedure_permissions_create_authorizing_invitation = defineProcedure({
  id: "permissions.create-authorizing-invitation",
  title: "Create an invitation's generation and its configure command",
  about:
    "Effect step on the caller's `Transaction`, admitting INVALID_INPUT and WRONG_STATE. Resolves each offered grant into " +
    "a binding (a new Budget is inserted as a `pending` Permission), refuses a Party that is not a person with a Safe " +
    "(INVALID_INPUT), an overlapping live authority (WRONG_STATE) or an open invitation command on the Permission " +
    "(INVALID_INPUT), begins the authorizing offer, and inserts the configure command (pending, execution unprepared) " +
    "with its wrapped Roles calls and expected authority events. It reads Parties' `parties` table directly." +
    calls(
      "organizations.read-invitation-authority-occupancy-in-tx",
      "organizations.read-inactive-invitation-ids-in-tx",
      "organizations.begin-authorizing-invitation-offer-in-tx",
      "accounts.read-exact-target-account-in-tx",
    ),
  was: [`${P}/writes/configurations.ts:25`, `${P}/writes/configurations.ts:135`, `${P}/reads/bindings.ts:27`, `${P}/reads/occupancy.ts:109`, `${DOOR}:85`],
  concept: concept_permissions,
  input: Schema.Struct({
    orgId: S,
    authUserId: S,
    requestJson: S,
    requestHash: S,
    configCommandId: S,
    normalizedRequest: U,
    authority: CommandAuthority,
    grantee: Schema.Struct({ partyId: S, safeAddress: S }),
    granterAddress: S,
    observationContext: opt(U),
  }),
  output: Schema.Struct({ invitation: U, occurredAt: N }),
  errors: [error_INVALID_INPUT, error_WRONG_STATE],
  reads: [table_parties, table_permissions, table_permission_assignments, table_permission_commands],
  writes: [table_permissions, table_permission_commands],
  ...none,
});

export const procedure_permissions_insert_grant = defineProcedure({
  id: "permissions.insert-grant",
  title: "Create an accepted generation's grant command",
  about:
    "Effect step on the caller's `Transaction`: inserts the generation's one grant command (pending, execution " +
    "unprepared) with its compiled grant call and the AssignRoles and ConsumeAllowance event pair its receipt must carry, " +
    "and returns its id for the drive the caller schedules. Organizations' consent calls it.",
  was: [`${P}/writes/invitations.ts:14`, `${P}/writes/invitations.ts:29`, `${DOOR}:86`],
  concept: concept_permissions,
  input: Schema.Struct({ invitation: U, granterAddress: S, now: N, authUserId: S, observationContext: opt(U) }),
  output: S,
  errors: [],
  reads: [],
  writes: [table_permission_commands],
  ...none,
});

export const procedure_permissions_insert_cleanup_commands = defineProcedure({
  id: "permissions.insert-cleanup-commands",
  title: "Create a generation's disable and compensate commands",
  about:
    "Inserts the disable command (the granter's own grant role off) and then the compensation (the grantee's offered " +
    "roles off), or the purposes named, each pending with execution unprepared. Organizations' ending calls it.",
  was: [`${P}/writes/invitations.ts:83`, `${DOOR}:86`],
  concept: concept_permissions,
  input: Schema.Struct({
    purposes: opt(Schema.Array(Schema.Literals(["disable", "compensate"]))),
    invitation: U,
    granterAddress: S,
    now: N,
    authUserId: opt(S),
    observationContext: opt(U),
  }),
  output: Schema.Void,
  errors: [],
  reads: [],
  writes: [table_permission_commands],
  ...none,
});

// ── Director proposals ──────────────────────────────────────────────────────────────────────

export const procedure_permissions_record_proposed_permission_execution_in_tx = defineProcedure({
  id: "permissions.record-proposed-permission-execution-in-tx",
  title: "Record the execution of a proposed Permission command",
  about:
    "The Director proposal carrying the command was executed: the command's sender becomes the executing Director's Safe, " +
    "the submission marker is appended, what the command replaces is suspended (unless applied), and " +
    "permissions.verifications.verify-submitted is scheduled for the command's origin. An abandoned or missing command " +
    "is left alone. Organizations' proposal lifecycle calls it.",
  was: [`${P}/writes/proposal-outcomes.ts:40`, `${P}/writes/receipts.ts:163`, `${P}/writes/suspensions.ts:84`, `${DOOR}:92`],
  concept: concept_permissions,
  input: Schema.Struct({ commandId: S, userOpHash: S, executorSafe: S, now: N }),
  output: Schema.Void,
  errors: [],
  reads: [table_permission_commands, table_permission_receipts, table_permissions, table_permission_assignments],
  writes: [table_permission_commands, table_permission_receipts, table_permissions, table_permission_assignments],
  drives: [machine_permission.t.to_suspended, machine_permission_assignment.t.to_suspended],
  invokes: [],
  emits: [],
});

export const procedure_permissions_abandon_proposed_permission_command_in_tx = defineProcedure({
  id: "permissions.abandon-proposed-permission-command-in-tx",
  title: "End a proposed Permission command whose proposal can never run",
  about:
    "When no submission marker exists and the command is still pending with no live attempt: its proposed pending rows " +
    "settle superseded and it ends abandoned; false when nothing changed. It reads Payments' moneyExecutions directly. " +
    "Organizations' proposal lifecycle calls it.",
  was: [`${P}/writes/proposal-outcomes.ts:71`, `${P}/writes/abandonments.ts:149`, `${P}/writes/abandonments.ts:73`, `${DOOR}:91`],
  concept: concept_permissions,
  input: Schema.Struct({ commandId: S, now: N }),
  output: B,
  errors: [],
  reads: [...ABANDON_READS, table_permission_receipts],
  writes: ABANDON_WRITES,
  drives: ABANDON_DRIVES,
  invokes: [],
  emits: [],
});

export const procedure_permissions_record_proposed_configuration_execution_in_tx = defineProcedure({
  id: "permissions.record-proposed-configuration-execution-in-tx",
  title: "Record the execution of a proposed invitation configuration",
  about:
    "Stores the proposal's execution (userOpHash, executing Director's Safe) on the configure command, unless it is applied " +
    "or already recorded, and schedules permissions.configurations.verify for the inviter (only when the command has an " +
    "origin). Organizations' proposal lifecycle calls it.",
  was: [`${P}/configurations/writes/proposal-outcomes.ts:28`, `${DOOR}:94`],
  concept: concept_permissions,
  input: Schema.Struct({ commandId: S, userOpHash: S, executorSafe: S, now: N }),
  output: Schema.Void,
  errors: [],
  reads: [table_permission_commands],
  writes: [table_permission_commands],
  ...none,
});

// ── departments ─────────────────────────────────────────────────────────────────────────────

export const procedure_permissions_read_owner_roles_module_in_tx = defineProcedure({
  id: "permissions.read-owner-roles-module-in-tx",
  title: "The Roles module a Director's department batch plans through",
  about:
    "requireOwnerCommandAuthority: the caller's Safe must be the owner Safe named (ROLE_PERMISSION_DENIED), the " +
    "Organization on Base Sepolia (INVALID_INPUT), the bootstrap usable, and an active managePeople Permission with a " +
    "verified receipt at its revision must exist (WRONG_STATE, rolesModuleMissing); answers its rolesModule. It reads " +
    "Organizations' `orgs` and `orgLifecycles` directly. Payroll calls it." +
    calls(ACCOUNT_IDENTITY),
  was: [`${P}/guards/owners.ts:89`, `${P}/guards/owners.ts:27`, `${DOOR}:100`],
  concept: concept_permissions,
  input: Schema.Struct({ authUserId: S, orgId: S, ownerSafe: S }),
  output: S,
  errors: [error_ROLE_PERMISSION_DENIED, error_INVALID_INPUT, error_WRONG_STATE, ...ACCOUNT_ERRORS],
  reads: [table_orgs, table_org_lifecycles, table_permission_receipts, table_permissions],
  writes: [],
  drives: [],
  invokes: [procedure_permissions_org_bootstrap_authority_usable],
  emits: [],
});

// ── executions (Payments' execution owner) ──────────────────────────────────────────────────

export const procedure_permissions_authorize_permission_execution_in_tx = defineProcedure({
  id: "permissions.authorize-permission-execution-in-tx",
  title: "Authorize claiming a Permission command's execution",
  about:
    "The ordinary command must exist and be sent from the caller's own Safe (INVALID_INPUT, commandMissing), the caller " +
    "must hold current authority (" +
    AUTHORITY +
    ") whose Safe is still the command's sender (INVALID_INPUT, commandAuthorityChanged), and the command must be pending " +
    "or provider_failure (WRONG_STATE); an applied command passes. Payments' execution claim calls it." +
    calls(ACCOUNT_IDENTITY),
  was: [`${P}/commands/guards.ts:7`, `${P}/reads/commands.ts:208`, `${DOOR}:103`],
  concept: concept_permissions,
  input: Schema.Struct({ authUserId: S, commandId: S }),
  output: U,
  errors: [error_INVALID_INPUT, error_WRONG_STATE, error_ROLE_PERMISSION_DENIED, ...ACCOUNT_ERRORS],
  reads: [table_permission_commands, ...AUTHORITY_READS],
  writes: [],
  drives: [],
  invokes: [procedure_permissions_require_command_authority],
  emits: [],
});

export const procedure_permissions_authorize_invitation_configuration_execution_in_tx = defineProcedure({
  id: "permissions.authorize-invitation-configuration-execution-in-tx",
  title: "Authorize claiming an invitation configure command's execution",
  about:
    "The one rule for an authorizing configure command (N2), shared by prepare, claim and completion " +
    "(loadAuthorizingCommand): the configure command must exist (INVALID_INPUT), its offer must be the caller's " +
    "authorizing one (Organizations refuses INVALID_INPUT or WRONG_STATE), the caller must hold current authority, and the " +
    "command must be pending or provider_failure (WRONG_STATE, invitation-not-pending). Payments' execution claim calls it." +
    calls("organizations.read-authorizing-invitation-offer-in-tx", ACCOUNT_IDENTITY),
  was: [`${P}/configurations/guards.ts:25`, `${P}/configurations/guards.ts:73`, `${DOOR}:104`],
  concept: concept_permissions,
  input: Schema.Struct({ authUserId: S, commandId: S }),
  output: U,
  errors: [error_INVALID_INPUT, error_WRONG_STATE, error_ROLE_PERMISSION_DENIED, ...ACCOUNT_ERRORS],
  reads: [table_permission_commands, ...AUTHORITY_READS],
  writes: [],
  drives: [],
  invokes: [procedure_permissions_require_command_authority],
  emits: [],
});

// ── approvals (Accounts) ────────────────────────────────────────────────────────────────────

export const procedure_permissions_read_permission_approval_subject_in_tx = defineProcedure({
  id: "permissions.read-permission-approval-subject-in-tx",
  title: "What an approval shows for a Permission or invitation command",
  about:
    "The command an execution carries, as its approval names it: kind, Organization and Safe, operation (`invite` for a " +
    "configuration), the Permission's type, and the member an assign or revoke names or the invitee. A missing row or a " +
    "row of the wrong kind is UNKNOWN (stored row broken). Accounts' approval page reads it.",
  was: [`${P}/reads/approvals.ts:29`, `${P}/reads/approvals.ts:16`, `${DOOR}:108`],
  concept: concept_permissions,
  input: Schema.Struct({ commandKind: Schema.Literals(["permission", "invitation_configuration"]), commandId: S }),
  output: Schema.Struct({
    kind: Schema.Literals(["permission_change", "invitation"]),
    orgId: S,
    organizationSafe: S,
    operation: Schema.Literals(["create", "change", "assign", "revoke", "replace", "invite"]),
    permissionType: NullOr(Schema.Literals(["budget", "managePeople"])),
    personSafe: NullOr(S),
  }),
  errors: [error_UNKNOWN],
  reads: [table_permission_commands, table_permissions],
  writes: [],
  ...none,
});

export const procedure_permissions_read_permission_execution_proof_in_tx = defineProcedure({
  id: "permissions.read-permission-execution-proof-in-tx",
  title: "Read a Permission or invitation execution's proof",
  about:
    "The command an execution names and its receipts: pending until the execution has a hash and a receipt decides it, " +
    "then applied or mismatch with the receipt that proves it. A missing command, one of the wrong kind, or one sent " +
    "from another Safe than stored is UNKNOWN (stored row broken, naming payments' moneyExecutions). An invitation " +
    "configure command reads its saved configurationVerificationJson instead of receipts. Payments' acceptance writer " +
    "reads it.",
  was: [`${P}/reads/approvals.ts:104`, `${P}/reads/approvals.ts:83`, `${DOOR}:110`],
  concept: concept_permissions,
  input: Execution,
  output: ExecutionProof,
  errors: [error_UNKNOWN],
  reads: [table_permission_commands, table_permission_receipts],
  writes: [],
  ...none,
});

export const procedure_permissions_read_permission_execution_outcome_in_tx = defineProcedure({
  id: "permissions.read-permission-execution-outcome-in-tx",
  title: "Read a Permission or invitation execution's outcome",
  about: "The `outcome` of readPermissionExecutionProofInTx. Payments' execution reads call it.",
  was: [`${P}/reads/approvals.ts:195`, `${DOOR}:109`],
  concept: concept_permissions,
  input: Execution,
  output: Schema.Literals(["pending", "applied", "mismatch"]),
  errors: [error_UNKNOWN],
  reads: [table_permission_commands, table_permission_receipts],
  writes: [],
  drives: [],
  invokes: [procedure_permissions_read_permission_execution_proof_in_tx],
  emits: [],
});

export const procedure_permissions_abandon_unsent_permission_command_in_tx = defineProcedure({
  id: "permissions.abandon-unsent-permission-command-in-tx",
  title: "End a Permission command whose approval lapsed unsent",
  about:
    "For a permission-kind execution that never left prepared (or ended expired, displaced or failed): when no other " +
    "attempt of the command is live and the command is still pending, its proposed pending rows settle superseded and it " +
    "ends abandoned; false when nothing changed. It reads Payments' moneyExecutions directly. Accounts' approvals call it.",
  was: [`${P}/writes/abandonments.ts:111`, `${P}/writes/abandonments.ts:73`, `${DOOR}:115`],
  concept: concept_permissions,
  input: Schema.Struct({ executionId: S, now: N }),
  output: B,
  errors: [],
  reads: ABANDON_READS,
  writes: ABANDON_WRITES,
  drives: ABANDON_DRIVES,
  invokes: [],
  emits: [],
});
