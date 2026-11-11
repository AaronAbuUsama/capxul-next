// The old organizations concept's tables and the state machines that live on them, as the old
// code has them (factory, branch integration/factory). Evidence, not the target design.
//
// Tables: every table in packages/backend/src/organizations/tables/*.ts, registered in
// packages/backend/convex/schema.ts:22-32 and :63-73. Machines: every status, state or phase
// field with a literal union, for the whole concept (part two's areas included). Transitions are
// named to_<state>; `from` lists every state an old write moves the field from. A write that
// leaves the field unchanged (a self-loop) is not listed; a birth (an insert) has no source state
// and is said in `about`. Milestones the old code keeps as timestamps (orgEquities.installedAt,
// orgRounds.openedAt, orgSafeRounds.openedAt, orgEquityIssues.issuedAt, orgOptionGrants.grantedAt)
// are not literal unions and are not booked as machines.

import { Schema } from "effect";
import { defineMachine, defineTable } from "../../../packages/book/src/index.ts";
import { concept_organizations } from "../shared/foundation.ts";
import {
  event_board_seat_transitioned,
  event_board_threshold_transitioned,
  event_equity_shares_transitioned,
  event_org_invite_transitioned,
  event_organization_creation_failed,
  event_organization_creation_ready,
  event_organization_creation_started,
  event_vote_transitioned,
} from "../shared/vocabulary.ts";

const O = "packages/backend/src/organizations";
const T = `${O}/tables`;
const SCHEMA = "packages/backend/convex/schema.ts";
const MODEL = "packages/protocol/src/organizations/model.ts";
const SETUP_MODEL = "packages/protocol/src/organizations/setup-model.ts";

const KEPT = "Kept indefinitely: no job in the old code deletes these rows.";

// ── shared validators ───────────────────────────────────────────────────────────────────────

const opt = Schema.optionalKey;
const S = Schema.String;
const N = Schema.Number;
const B = Schema.Boolean;
const NullOr = Schema.NullOr;
const Strings = Schema.Array(S);

/** `{ to, value, data }`: one Safe call, as every Board and Governor table stores it. */
const Call = Schema.Struct({ to: S, value: S, data: S });

/** `MEMBER_STATUSES` (protocol organizations/model.ts:11). */
const MEMBER_STATUSES = ["pending", "pending_safe", "pending_grant", "active", "revoked", "expired"] as const;
/** `SEAT_PERMISSIONS` (model.ts:82). */
const SEAT_PERMISSIONS = ["manage-books", "issue-invoices", "manage-people"] as const;
/** `INVITATION_PHASES` (model.ts:65). */
const INVITATION_PHASES = [
  "authorizing",
  "pending",
  "pending_grant",
  "active",
  "revoking",
  "declined",
  "cancelled",
  "expired",
  "revoked",
] as const;
/** `SAFE_PROPOSAL_STATUSES` (model.ts:28). */
const SAFE_PROPOSAL_STATUSES = ["awaiting_approvals", "executed", "rejected", "replaced"] as const;
/** `PROPOSAL_SUBJECT_KINDS` (model.ts:42). */
const PROPOSAL_SUBJECT_KINDS = [
  "permission",
  "invitation_configuration",
  "department_change",
  "agreement_payee_write",
  "seat_permission",
  "scheduled_payment",
  "budget_schedule",
  "budget_cancel",
  "allowance",
  "equity_setup",
  "equity_issue",
  "equity_grant",
  "round_create",
  "safe_round",
  "share_transfer",
] as const;
/** `ORGANIZATION_SETUP_STATUSES` (setup-model.ts:2). */
const SETUP_STATUSES = ["awaitingAuthorization", "processing", "needsAttention", "ready", "rechecking", "failed"] as const;
/** `ORGANIZATION_SETUP_REASONS` (setup-model.ts:14). */
const SETUP_REASONS = Schema.Literals([
  "submission_unknown",
  "receipt_unresolved",
  "provider_unavailable",
  "receipt_reverted",
  "deterministic_address_mismatch",
  "receipt_mismatch",
  "block_identity_changed",
  "authority_event_mismatch",
  "allowance_timestamp_mismatch",
  "receipt_identity_unavailable",
  "receipt_identity_mismatch",
  "contract_code_unavailable",
  "contract_state_mismatch",
  "permission_projection_mismatch",
  "bootstrap_reorg",
  "dependent_authority_unresolved",
  "historical_evidence_missing",
  "worker_failed",
]);
/** `EQUITY_TEMPLATES` (protocol organizations/equity-templates.ts:11). */
const EQUITY_TEMPLATES = ["solo", "co-founders", "pre-safe", "seed", "founder-control", "llc"] as const;

/** `setupIssueValidator` (tables/setups.ts:13): `details` and `chain` are open bags (v.any). */
const SetupIssue = Schema.Struct({
  reason: SETUP_REASONS,
  error: opt(
    Schema.Struct({
      code: S,
      message: S,
      details: opt(Schema.Unknown),
      correlationId: opt(S),
      layer: opt(S),
      mode: opt(S),
      chain: opt(Schema.Unknown),
      cause: opt(Schema.Array(Schema.Struct({ name: S, message: S }))),
    }),
  ),
});

/** `invitationBindingValidator` (tables/invitations.ts:12). */
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

// ── organizations ───────────────────────────────────────────────────────────────────────────

export const table_orgs = defineTable({
  id: "orgs",
  title: "Organizations",
  about:
    "One row per Organization: its name, its own Safe and chain, the founder's personal Safe, and the link to its Party. " +
    "`orgId` is the public `org_<ulid>` brand, never the Safe address. Before Protocol v4 the Safe is the founder's " +
    "counterfactual derivation (`deriveCapxulOrgAddress`); on v4 it is the Safe Companies House mints for the company " +
    "(writes/organizations.ts:98). The writer stores `safeAddress` and `ownerPersonalSafeAddress` lowercase; an older row may " +
    "hold a checksummed founder Safe (reads/participation.ts:170). `country` is stored unvalidated. `safeSigners` is the drift " +
    "cycle's copy of the indexed Safe owners and threshold (the Directors, ADR-0040), absent until the first copy; it is " +
    "written through the door (`recordSafeSignersInTx`) by the indexer drift cycle and by proposal settlement. Other " +
    "concepts read this table directly, not through the door: Payments, Requests, Permissions' guards, Indexing's drift " +
    "corrections and Books' keepers. `logoStorageId` names a Convex `_storage` blob; Media binds it through the door.",
  was: [`${T}/organizations.ts:17`, `${SCHEMA}:22`, `${SCHEMA}:63`, `${O}/setups/writes/organizations.ts:106`, `${O}/writes.ts:41`],
  concept: concept_organizations,
  tenancy: "organization",
  tenantField: "orgId",
  fields: Schema.Struct({
    creationSource: opt(Schema.Literals(["human", "e2e", "agent"])),
    orgId: S,
    name: S,
    safeAddress: S,
    chainId: N,
    ownerPersonalSafeAddress: S,
    founderEmail: S,
    country: NullOr(S),
    bio: opt(NullOr(S)),
    size: opt(NullOr(S)),
    logoStorageId: opt(NullOr(S)),
    partyId: opt(S),
    safeSigners: opt(Schema.Struct({ owners: Strings, threshold: N, blockNumber: N })),
    createdAt: N,
    updatedAt: N,
  }),
  key: ["orgId"],
  indexes: [
    {
      name: "by_org_id",
      fields: ["orgId"],
      for: "One Organization by id (`findOrganization`, reads/organizations.ts:17): every participation check and stored-fact read.",
    },
    {
      name: "by_party_id",
      fields: ["partyId"],
      crossTenant: true,
      for: "The Organization a Party stands for: a handle's existing Organization at begin (writes/organizations.ts:80) and `readOrganizationNameByPartyInTx`.",
    },
    {
      name: "by_owner",
      fields: ["ownerPersonalSafeAddress"],
      crossTenant: true,
      for: "The Organizations one personal Safe founded, for an operator purge (`readAccountOrganizationReferencesInTx`, reads/participation.ts:173).",
    },
    {
      name: "by_safe_address",
      fields: ["safeAddress"],
      crossTenant: true,
      for: "The Organizations at one Safe, for recipient resolution and Movement attribution (`readOrganizationsAtSafeInTx`, reads/organizations.ts:104).",
    },
  ],
  retention: KEPT,
});

export const table_org_lifecycles = defineTable({
  id: "org-lifecycles",
  title: "Organization setups (bootstrap lifecycle)",
  about:
    "One durable row per Organization being created; retries advance attempts on the same row. It holds the immutable " +
    "Solo bootstrap snapshot (v3) or the v4 marker with the signed `deployMoney` and the stored company install, the one " +
    "preparation the founder may sign, the accepted submission (hash, sender, nonce), the verified or orphaned proof with " +
    "the Permission receipt ids it materialized, the bounded issue, and the scheduling state of its checks: generation, " +
    "send token, dispatch and lease tokens, `dueAt`, the scheduled function id, the unresolved run and the park. " +
    "Permissions' guard `orgBootstrapAuthorityUsable` reads it directly to decide whether any Seat or Permission authority " +
    "is usable, and `readCompanyDeploymentInTx` serves `companyInstall.deploymentJson` to departments and Seat permissions. " +
    "`bootstrapSnapshotJson` is optional only for the schema rollout; active operations refuse a row without it unless " +
    "`protocol` is v4. `scheduledFunctionId` is a Convex `_scheduled_functions` id.",
  was: [`${T}/setups.ts:35`, `${SCHEMA}:23`, `${O}/setups/writes/begins.ts:161`, `${O}/README.md:475`],
  concept: concept_organizations,
  tenancy: "organization",
  tenantField: "orgId",
  fields: Schema.Struct({
    orgId: S,
    founderAuthUserId: S,
    status: Schema.Literals(SETUP_STATUSES),
    journeyId: opt(S),
    correlationId: opt(S),
    bootstrapSnapshotJson: opt(S),
    protocol: opt(Schema.Literal("v4")),
    companyDeploy: opt(Schema.Struct({ transactionHash: S, signedTransaction: S })),
    companyInstall: opt(Schema.Struct({ deploymentJson: S, deployTxHash: S })),
    revision: N,
    generation: N,
    creationAttemptNumber: N,
    creationAttemptStartedAt: opt(N),
    preparation: opt(
      Schema.Struct({ id: S, digest: S, userOpHash: S, sender: S, nonce: S, expiresAt: N }),
    ),
    submission: opt(
      Schema.Union([
        Schema.Struct({
          origin: Schema.Literal("accepted"),
          userOpHash: S,
          sender: S,
          nonce: S,
          acceptedAt: N,
          acknowledgedAt: opt(N),
        }),
        Schema.Struct({
          origin: Schema.Literal("imported"),
          userOpHash: S,
          sender: opt(S),
          nonce: opt(S),
          acceptedAt: N,
          acknowledgedAt: opt(N),
        }),
      ]),
    ),
    proof: opt(
      Schema.Struct({
        validity: Schema.Literals(["verified", "orphaned"]),
        transactionHash: S,
        blockNumber: N,
        blockHash: S,
        verifiedAt: N,
        permissionReceiptIds: Strings,
      }),
    ),
    completedAt: opt(N),
    firstDefinitiveFailureAt: opt(N),
    issue: opt(SetupIssue),
    lastSendIssue: opt(SetupIssue),
    sendToken: opt(S),
    checkCount: opt(N),
    receiptPendingCount: opt(N),
    providerFailureCount: opt(N),
    recheckStartedAt: opt(N),
    unresolved: opt(Schema.Struct({ since: N, checks: N })),
    parked: opt(Schema.Struct({ at: N, reason: SETUP_REASONS })),
    abandonedChecks: opt(N),
    lastCheckedAt: opt(N),
    nextCheckAt: opt(N),
    leaseToken: opt(S),
    leaseUntil: opt(N),
    dueAt: opt(N),
    scheduledFor: opt(N),
    dispatchToken: opt(S),
    scheduledFunctionId: opt(S),
    createdAt: N,
    updatedAt: N,
  }),
  key: ["orgId"],
  indexes: [
    {
      name: "by_org_id",
      fields: ["orgId"],
      for: "The setup of one Organization (`findSetup`, setups/reads/setups.ts:30); Permissions' bootstrap guard collects them and needs exactly one.",
    },
    {
      name: "by_founder",
      fields: ["founderAuthUserId"],
      crossTenant: true,
      for: "A founder's unfinished setups (`listOwnedSetups`, reads/setups.ts:109) and the Organizations they are still founding (workspaces/reads/workspaces.ts:66).",
    },
    {
      name: "by_status",
      fields: ["status"],
      crossTenant: true,
      for: "Setups in one status. No query in the old organizations code reads it.",
    },
    {
      name: "by_submission_hash",
      fields: ["submission.userOpHash"],
      crossTenant: true,
      for: "Whether an accepted hash is already bound to another Organization (authorizations.ts:169) or another setup recorded it (installs.ts:175).",
    },
    {
      name: "by_due_at",
      fields: ["dueAt"],
      crossTenant: true,
      for: "Checks whose lease or dispatch lapsed before the recovery cutoff, 50 a page (`recoverDuePageInTx`, writes/checks.ts:225).",
    },
  ],
  retention: KEPT,
});

export const table_org_roles = defineTable({
  id: "org-roles",
  title: "Organization role catalog",
  about:
    "The roles an Organization's setup materialized: the founder's bootstrap roles from the Solo snapshot (v3) or the v4 " +
    "company's officer hats, each with its label, stored definition JSON and permissions. Only the setup's first proof " +
    "writes it (setups/writes/bootstraps.ts:125, installs.ts:84, :132); nothing patches a row, so `revokedAt` stays null. " +
    "The roles list, the workspace role label and the Seat's standing read it.",
  was: [`${T}/roles.ts:11`, `${SCHEMA}:24`, `${O}/setups/writes/bootstraps.ts:125`, `${O}/roles/reads.ts:21`],
  concept: concept_organizations,
  tenancy: "organization",
  tenantField: "orgId",
  fields: Schema.Struct({
    orgId: S,
    roleKey: S,
    label: S,
    definitionJson: S,
    permissions: Strings,
    status: Schema.Literals(["active", "revoked"]),
    createdAt: N,
    revokedAt: NullOr(N),
  }),
  key: ["orgId", "roleKey"],
  indexes: [
    { name: "by_org", fields: ["orgId"], for: "An Organization's roles, oldest first (`readInvitableRoles`, roles/reads.ts:26; installs.ts:184)." },
    {
      name: "by_org_role",
      fields: ["orgId", "roleKey"],
      for: "One role's label by key (workspaces/reads/standing.ts:158, workspaces/reads/workspaces.ts:143).",
    },
  ],
  retention: KEPT,
});

export const table_org_roles_deployments = defineTable({
  id: "org-roles-deployments",
  title: "Organization Roles module deployments",
  about:
    "The Roles and Allowance modules the setup's bootstrap deployed for the Organization Safe, with the transaction that " +
    "deployed them. The first proof inserts one row `confirmed` (bootstraps.ts:142, installs.ts:99); no writer moves it " +
    "afterwards, so `requested` and `failed` are never written. The materialization check reads it to refuse a second " +
    "read model (installs.ts:192).",
  was: [`${T}/roles.ts:23`, `${SCHEMA}:24`, `${O}/setups/writes/bootstraps.ts:142`],
  concept: concept_organizations,
  tenancy: "organization",
  tenantField: "orgId",
  fields: Schema.Struct({
    orgId: S,
    rolesModuleAddress: S,
    allowanceModuleAddress: S,
    txHash: S,
    chainId: N,
    status: Schema.Literals(["requested", "confirmed", "failed"]),
    createdAt: N,
    updatedAt: N,
  }),
  key: ["orgId"],
  indexes: [
    { name: "by_org", fields: ["orgId"], for: "The Organization's deployment (`requireUnmaterializedInTx`, installs.ts:192)." },
    { name: "by_status", fields: ["status"], crossTenant: true, for: "Deployments in one status. No query in the old code reads it." },
  ],
  retention: KEPT,
});

// ── members ─────────────────────────────────────────────────────────────────────────────────

export const table_org_members = defineTable({
  id: "org-members",
  title: "Organization members (Seats)",
  about:
    "The Party/Organization member binding (D6). A Seat is current while its row is active, bound to a Party, and the " +
    "Organization's bootstrap is usable. No business key: there is no member id, `authUserId` is optional and nullable, " +
    "and one person can hold several rows in one Organization over time; readers take the first active row " +
    "(`findActiveMember`). The founder's row is inserted active by the setup's first proof; an invitation's verified grant " +
    "or a Seat-only consent inserts or patches the invitee's row active; `pending`, `pending_safe` and `pending_grant` are " +
    "legacy states no writer in the old code inserts. `reconciledAt` is the indexer reconciliation's stamp, never a " +
    "freshness gate. `agent` marks an AI Seat (ADR-0042). `roleKey` is a hex role key.",
  was: [`${T}/members.ts:10`, `${SCHEMA}:26`, `${O}/reads/participation.ts:31`, `${O}/members/writes/grants.ts:41`],
  concept: concept_organizations,
  tenancy: "organization",
  tenantField: "orgId",
  fields: Schema.Struct({
    orgId: S,
    email: opt(S),
    name: opt(NullOr(S)),
    authUserId: opt(NullOr(S)),
    personalSafeAddress: opt(NullOr(S)),
    role: S,
    roleKey: opt(NullOr(S)),
    status: Schema.Literals(MEMBER_STATUSES),
    grantTxHash: opt(NullOr(S)),
    revokeTxHash: opt(NullOr(S)),
    invitedAt: opt(N),
    acceptedAt: opt(NullOr(N)),
    grantedAt: opt(NullOr(N)),
    revokedAt: opt(NullOr(N)),
    expiresAt: opt(N),
    partyId: opt(S),
    agent: opt(B),
    reconciledAt: opt(N),
    createdAt: opt(N),
    updatedAt: N,
  }),
  key: ["_id"],
  indexes: [
    {
      name: "by_org",
      fields: ["orgId"],
      for: "The roster (`readMembers`, members/reads.ts:27), the contact roster, the reconciliation read and a grant's bound rows (grants.ts:181).",
    },
    { name: "by_email", fields: ["email"], crossTenant: true, for: "Whether an email still names any membership, for an operator purge (participation.ts:182)." },
    {
      name: "by_org_email",
      fields: ["orgId", "email"],
      for: "One email's rows in one Organization: verified grant upsert, Seat marks, standing by email, Payroll's invite check (grants.ts:49, reads.ts:39).",
    },
    {
      name: "by_auth_user_status",
      fields: ["authUserId", "status"],
      crossTenant: true,
      for: "The caller's active rows (`findActiveMember`, participation.ts:37), workspaces (workspaces.ts:48) and rows waiting for a Safe (advances.ts:39).",
    },
    { name: "by_status", fields: ["status"], crossTenant: true, for: "Every pending row, for the daily expiry sweep (advances.ts:93)." },
  ],
  retention: KEPT,
});

export const table_seat_permissions = defineTable({
  id: "seat-permissions",
  title: "Seat permissions (Manage books, Issue invoices, Manage people)",
  about:
    "The off-chain permissions a Seat holds (CAP-945). A row is written when a Director proposal granting it settles " +
    "executed (`settlePermissionChangeInTx`), or for the founder at creation (`grantFounderPermissionsInTx`, no " +
    "`proposalId`); a revoke that settles executed deletes the row. On v4 each permission is an officer hat; this row is " +
    "still what Requests (`requireIssueInvoicesInTx`) and Books (`holdsSeatPermissionInTx`) check.",
  was: [`${T}/members.ts:49`, `${SCHEMA}:26`, `${O}/members/writes/permissions.ts:64`, `${O}/members/writes/permissions.ts:260`],
  concept: concept_organizations,
  tenancy: "organization",
  tenantField: "orgId",
  fields: Schema.Struct({
    orgId: S,
    authUserId: S,
    email: S,
    permission: Schema.Literals(SEAT_PERMISSIONS),
    proposalId: opt(S),
    grantedAt: N,
  }),
  key: ["orgId", "authUserId", "permission"],
  indexes: [
    { name: "by_org_permission", fields: ["orgId", "permission"], for: "Every grant of one permission in an Organization (`seatPermissionRows`, members/reads/permissions.ts:38)." },
    { name: "by_org_user", fields: ["orgId", "authUserId"], for: "The permissions one person holds (`seatPermissionsOfInTx`, permissions.ts:51; `seatPermissionRow`)." },
  ],
  retention: "A revoked grant's row is deleted (members/writes/permissions.ts:260); others are kept indefinitely.",
});

export const table_seat_permission_changes = defineTable({
  id: "seat-permission-changes",
  title: "Proposed Seat permission changes",
  about:
    "One proposed grant or revoke of a Seat permission (CAP-945), stored with the Director proposal that carries it " +
    "(`subject.kind` seat_permission). Applied once the proposal settles executed, ended once it settles rejected or " +
    "replaced. Its `changeId` is `spc_<ulid>`. `waitingGrantsInTx` counts the proposed grants of one permission, so a " +
    "v4 hat plan sees the seats that wait.",
  was: [`${T}/members.ts:62`, `${SCHEMA}:26`, `${O}/members/writes/permissions.ts:187`, `${O}/members/writes/permissions.ts:243`],
  concept: concept_organizations,
  tenancy: "organization",
  tenantField: "orgId",
  fields: Schema.Struct({
    changeId: S,
    orgId: S,
    authUserId: S,
    email: S,
    change: Schema.Literals(["grant", "revoke"]),
    permission: Schema.Literals(SEAT_PERMISSIONS),
    state: Schema.Literals(["proposed", "applied", "ended"]),
    proposalId: S,
    createdAt: N,
    settledAt: opt(N),
  }),
  key: ["changeId"],
  indexes: [
    { name: "by_change", fields: ["changeId"], crossTenant: true, for: "The change a settled proposal names (`settlePermissionChangeInTx`, permissions.ts:239)." },
    {
      name: "by_org_user",
      fields: ["orgId", "authUserId"],
      for: "A Seat's waiting changes (permissions.ts:148); the whole Organization's, for waiting grants (members/reads/permissions.ts:88).",
    },
  ],
  retention: KEPT,
});

// ── invitations ─────────────────────────────────────────────────────────────────────────────

export const table_org_invitations = defineTable({
  id: "org-invitations",
  title: "Organization invitation offers",
  about:
    "One invitation offer per generation: the request it was made from (canonical JSON and hash), the Organization Safe " +
    "and Roles module it configures, the inviter, the grantee Party and Safe, the bindings it offers (each a Budget or " +
    "Manage people authority with its role key), its phase, its ending reason, the grantee's consent (digest, time, " +
    "account), its delivery outcome and its cleanup. An offer with no binding offers a Seat only (ADR-0040) and is born " +
    "pending. Permissions drives the configured offer through the door (`beginAuthorizingInvitationOfferInTx` … " +
    "`retireInvitationOfferInTx`); a generation replacement rewrites `generationHash`, `configCommandId`, `rolesModule` and " +
    "`bindings` and appends to `replacementLineage`. `deliveryAttemptedAt` anchors the resend cooldown and is absent on " +
    "older rows. Hex fields (`generationHash`, `organizationSafe`, `rolesModule`, `granteeSafe`) are stored lowercase.",
  was: [`${T}/invitations.ts:25`, `${SCHEMA}:25`, `${O}/invitations/writes/phases.ts:55`, `${O}/invitations/writes/offers.ts:136`],
  concept: concept_organizations,
  tenancy: "organization",
  tenantField: "orgId",
  fields: Schema.Struct({
    invitationId: S,
    replacementLineage: opt(
      Schema.Array(
        Schema.Struct({
          previousGenerationHash: S,
          nextGenerationHash: S,
          replacementCommandId: S,
          verifiedReceiptId: S,
          acceptedOfferDigest: NullOr(S),
        }),
      ),
    ),
    generationHash: S,
    configCommandId: S,
    requestHash: S,
    requestJson: S,
    orgId: S,
    chainId: N,
    organizationSafe: S,
    rolesModule: S,
    inviterAccountId: S,
    inviterAuthUserId: S,
    granteePartyId: S,
    granteeSafe: S,
    bindings: Schema.Array(InvitationBinding),
    phase: Schema.Literals(INVITATION_PHASES),
    endingReason: NullOr(Schema.Literals(["declined", "cancelled", "expired", "revoked"])),
    authorizedAt: NullOr(N),
    acceptedAt: NullOr(N),
    acceptedByAuthUserId: opt(S),
    acceptedOfferDigest: NullOr(S),
    expiresAt: NullOr(N),
    delivery: Schema.Literals(["not_confirmed", "sent", "failed", "none"]),
    deliveryAttemptedAt: opt(N),
    cleanup: Schema.Literals(["not_requested", "disable_pending", "compensate_pending", "retired"]),
    createdAt: N,
    updatedAt: N,
  }),
  key: ["invitationId"],
  indexes: [
    { name: "by_invitation_id", fields: ["invitationId"], crossTenant: true, for: "One offer by its public id (`storedOffer`, invitations/reads/offers.ts:38)." },
    {
      name: "by_config_command_id",
      fields: ["configCommandId"],
      crossTenant: true,
      for: "The offer one configure command authorizes. No query in the old organizations code reads it.",
    },
    {
      name: "by_org_created",
      fields: ["orgId", "createdAt", "invitationId"],
      for: "An Organization's offers in page order, cursor-bounded (`orgStream`, invitations/reads/streams.ts:59).",
    },
    {
      name: "by_grantee_created",
      fields: ["granteePartyId", "createdAt", "invitationId"],
      crossTenant: true,
      for: "A grantee's own offers in page order (`granteeStream`, streams.ts:34); whether a Party has any (participation.ts:196).",
    },
    {
      name: "by_org_phase_created",
      fields: ["orgId", "phase", "createdAt", "invitationId"],
      for: "An Organization's offers in one phase (streams.ts:66); the live offers a replacement or an occupancy check reads (offers.ts:178, :200).",
    },
    {
      name: "by_grantee_phase_created",
      fields: ["granteePartyId", "phase", "createdAt", "invitationId"],
      crossTenant: true,
      for: "A grantee's offers in one phase (streams.ts:39).",
    },
    {
      name: "by_phase_expires_at",
      fields: ["phase", "expiresAt"],
      crossTenant: true,
      for: "Every pending offer, for the daily expiry sweep (`expireDueInvitations`, writes/endings.ts:206).",
    },
  ],
  retention: KEPT,
});

// ── proposals (part two writes them; the table is the concept's) ─────────────────────────────

export const table_org_safe_proposals = defineTable({
  id: "org-safe-proposals",
  title: "Organization Safe proposals",
  about:
    "One proposed Organization Safe transaction the Directors approve under the Safe's own threshold, keyed the way the " +
    "Safe Transaction Service keys it (ADR-0040). The chain decides its status: the Safe's nonce, `approvedHashes` and the " +
    "executing userOperation's receipt, read by `refreshProposals` and stored by settlement. A scheduled payment rides its " +
    "own EntryPoint lane: no nonce, and `safeTxHash` is its SafeOp hash. `subject` names what it carries out in Capxul " +
    "(a Permission command, an invitation configuration, a Seat permission change, equity, rounds, payroll and scheduled " +
    "payments); settlement applies or ends the subject in the same transaction. `submissions` records each approval or " +
    "execution a Director sent through Capxul. `operation` is 0 (call) or 1 (delegatecall).",
  was: [`${T}/proposals.ts:15`, `${SCHEMA}:27`, `${O}/proposals/writes.ts:100`, `${O}/proposals/writes/settlements.ts:36`],
  concept: concept_organizations,
  tenancy: "organization",
  tenantField: "orgId",
  fields: Schema.Struct({
    proposalId: S,
    orgId: S,
    chainId: N,
    safeAddress: S,
    nonce: opt(N),
    safeTxHash: S,
    kind: Schema.Literals(["transaction", "rejection", "scheduled_payment"]),
    rejects: opt(S),
    to: S,
    value: S,
    data: S,
    operation: Schema.Literals([0, 1]),
    calls: Schema.Array(Call),
    note: opt(S),
    proposerAuthUserId: S,
    proposer: S,
    status: Schema.Literals(SAFE_PROPOSAL_STATUSES),
    threshold: N,
    approvedBy: Strings,
    submissions: Schema.Array(
      Schema.Struct({ owner: S, step: Schema.Literals(["approve", "execute"]), userOpHash: S, sentAt: N }),
    ),
    executionUserOpHash: opt(S),
    subject: opt(Schema.Struct({ kind: Schema.Literals(PROPOSAL_SUBJECT_KINDS), commandId: S })),
    payment: opt(Schema.Struct({ paymentId: S, sendsAt: N })),
    createdAt: N,
    settledAt: opt(N),
  }),
  key: ["proposalId"],
  indexes: [
    { name: "by_proposal", fields: ["proposalId"], crossTenant: true, for: "One proposal by id (reads/proposals.ts:26): an approval's subject and step." },
    {
      name: "by_org_nonce",
      fields: ["orgId", "nonce"],
      for: "An Organization's proposals in Safe nonce order: the next free nonce (proposals/writes.ts:132) and the waiting calls (reads/proposals.ts:96).",
    },
    {
      name: "by_subject_command",
      fields: ["subject.commandId"],
      crossTenant: true,
      for: "The proposal that carries one subject command (`readSubjectProposalInTx`, proposals/writes.ts:196).",
    },
  ],
  retention: KEPT,
});

// ── directors ───────────────────────────────────────────────────────────────────────────────

export const table_org_director_changes = defineTable({
  id: "org-director-changes",
  title: "v4 company Board changes",
  about:
    "One Board change of a v4 company, from the approval its founder signs to the chain's answer: seat a Director " +
    "(CAP-1150), remove one (CAP-1151), set the Signer Gate's threshold (CAP-1172), hand the Board to the Governor, drop " +
    "the signers whose hat lapsed (refresh, CAP-1152) or claim a seat. `lapsed` is not stored: it is read from " +
    "`expiresAt`. `thresholdBefore` is absent on seats stored before CAP-1172.",
  was: [`${T}/directors.ts:12`, `${SCHEMA}:28`, `${O}/directors/writes.ts:267`],
  concept: concept_organizations,
  tenancy: "organization",
  tenantField: "orgId",
  fields: Schema.Struct({
    changeId: S,
    orgId: S,
    chainId: N,
    safeAddress: S,
    authUserId: S,
    action: Schema.Literals(["add", "remove", "threshold", "handover", "refresh", "claim"]),
    person: opt(Schema.Struct({ name: NullOr(S), email: S, safe: S })),
    removed: opt(Schema.Array(Schema.Struct({ name: NullOr(S), email: NullOr(S), safe: S }))),
    signer: S,
    directorsBefore: N,
    directorsAfter: N,
    thresholdNeeded: N,
    thresholdBefore: opt(N),
    calls: Schema.Array(Call),
    approvalId: S,
    expiresAt: N,
    status: Schema.Literals(["awaiting_approval", "sent", "seated", "set", "removed", "handed_over", "failed"]),
    userOpHash: opt(S),
    createdAt: N,
    settledAt: opt(N),
  }),
  key: ["changeId"],
  indexes: [
    { name: "by_change", fields: ["changeId"], crossTenant: true, for: "One change by id: its send, follow and outcome." },
    { name: "by_org_person", fields: ["orgId", "person.safe"], for: "The changes that name one member's Safe." },
    { name: "by_org", fields: ["orgId"], for: "The Organization's Board changes, newest first, for the stale-plan fence." },
  ],
  retention: KEPT,
});

// ── equity ──────────────────────────────────────────────────────────────────────────────────

export const table_org_equities = defineTable({
  id: "org-equities",
  title: "v4 company equity installs",
  about:
    "One row per v4 company that switched equity on (CAP-1174): the template, the terms digest of `deployEquity`, the cap " +
    "table the Board proposed, the signed `deployEquity` recorded before its broadcast, the clones its receipt named " +
    "(Captable, Governor, Options, Rounds, Exits, Elections), clones made for earlier terms, and the Board proposal that " +
    "wires it. `installedAt` is noted by the first equity answer after the proposal executed.",
  was: [`${T}/equity.ts:13`, `${SCHEMA}:29`],
  concept: concept_organizations,
  tenancy: "organization",
  tenantField: "orgId",
  fields: Schema.Struct({
    orgId: S,
    chainId: N,
    safeAddress: S,
    template: Schema.Literals(EQUITY_TEMPLATES),
    termsDigest: S,
    capTableJson: S,
    deploy: opt(Schema.Struct({ transactionHash: S, signedTransaction: S })),
    deployment: opt(Schema.Struct({ deploymentJson: S, deployTxHash: S })),
    governor: opt(S),
    captable: opt(S),
    earlier: opt(
      Schema.Array(Schema.Struct({ termsDigest: S, deploymentJson: S, deployTxHash: S, governor: S, captable: S })),
    ),
    proposalId: opt(S),
    installedAt: opt(N),
    createdAt: N,
    updatedAt: N,
  }),
  key: ["orgId"],
  indexes: [
    { name: "by_org_id", fields: ["orgId"], for: "The company's equity row." },
    { name: "by_governor", fields: ["chainId", "governor"], crossTenant: true, for: "The company a Governor belongs to, for a vote." },
  ],
  retention: KEPT,
});

export const table_org_equity_issues = defineTable({
  id: "org-equity-issues",
  title: "v4 company one-off share issues",
  about:
    "One Board `Captable.issue` proposal per row (CAP-1173). The same issue asked again (same `callDigest`) answers its " +
    "waiting proposal. `issuedAt` is noted by the first equity answer after the proposal executed, which reports it once.",
  was: [`${T}/equity.ts:57`, `${SCHEMA}:29`],
  concept: concept_organizations,
  tenancy: "organization",
  tenantField: "orgId",
  fields: Schema.Struct({
    orgId: S,
    issueId: S,
    callDigest: S,
    classId: N,
    className: S,
    to: S,
    email: opt(S),
    shares: N,
    reasonHash: S,
    proposalId: S,
    issuedAt: opt(N),
    createdAt: N,
  }),
  key: ["issueId"],
  indexes: [
    { name: "by_org_id", fields: ["orgId"], for: "The company's issues." },
    { name: "by_digest", fields: ["orgId", "callDigest"], for: "The same issue asked again." },
  ],
  retention: KEPT,
});

export const table_org_safe_rounds = defineTable({
  id: "org-safe-rounds",
  title: "v4 company post-money SAFE rounds",
  about:
    "One Board `Rounds.createSafeRound` proposal per row (CAP-1198), with Capxul's `sr_` id. `openedAt` and `roundNumber` " +
    "are noted once the proposal executed, which reports `fundraise_round_transitioned` (opened) once. Cap and raise are " +
    "whole dollars, the discount whole percent, `closes` a UTC day.",
  was: [`${T}/equity.ts:79`, `${SCHEMA}:29`],
  concept: concept_organizations,
  tenancy: "organization",
  tenantField: "orgId",
  fields: Schema.Struct({
    orgId: S,
    safeRoundId: S,
    callDigest: S,
    rounds: S,
    token: S,
    cap: N,
    discountPct: N,
    raise: N,
    closes: S,
    termsHash: S,
    proposalId: S,
    openedAt: opt(N),
    roundNumber: opt(N),
    createdAt: N,
  }),
  key: ["safeRoundId"],
  indexes: [
    { name: "by_org_id", fields: ["orgId"], for: "The company's SAFE rounds." },
    { name: "by_digest", fields: ["orgId", "callDigest"], for: "The same round asked again." },
  ],
  retention: KEPT,
});

export const table_org_option_grants = defineTable({
  id: "org-option-grants",
  title: "v4 company option grants",
  about:
    "One Board `Options.grant` proposal per row (CAP-1182), with Capxul's `og_` id made from the proposal's. The same " +
    "grant asked again, even on a later day (same `requestDigest`), answers its waiting proposal. `grantedAt` is noted by " +
    "the settlement that sees the proposal execute, which reports it once.",
  was: [`${T}/equity.ts:104`, `${SCHEMA}:29`],
  concept: concept_organizations,
  tenancy: "organization",
  tenantField: "orgId",
  fields: Schema.Struct({
    orgId: S,
    grantId: S,
    requestDigest: S,
    grantee: S,
    email: opt(S),
    shares: N,
    termsJson: S,
    agreementHash: S,
    proposalId: S,
    grantedAt: opt(N),
    createdAt: N,
  }),
  key: ["grantId"],
  indexes: [
    { name: "by_org_id", fields: ["orgId"], for: "The company's grants." },
    { name: "by_digest", fields: ["orgId", "requestDigest"], for: "The same grant asked again." },
    { name: "by_grant", fields: ["grantId"], crossTenant: true, for: "One grant by id." },
  ],
  retention: KEPT,
});

export const table_org_share_transfers = defineTable({
  id: "org-share-transfers",
  title: "v4 company secondary share sales",
  about:
    "One secondary sale of a v4 company's shares (CAP-1217), offered by the seller's own Safe, from the approval its " +
    "seller signs to the chain's answer, then the Board's `Exits.approveTransfer` (CAP-1175). `lapsed` is read from " +
    "`expiresAt`, not stored. `offerId` comes from the receipt's `TransferOffered`.",
  was: [`${T}/share-transfers.ts:9`, `${SCHEMA}:30`],
  concept: concept_organizations,
  tenancy: "organization",
  tenantField: "orgId",
  fields: Schema.Struct({
    transferId: S,
    orgId: S,
    chainId: N,
    authUserId: S,
    classId: N,
    className: S,
    seller: Schema.Struct({ email: NullOr(S), safe: S }),
    buyer: Schema.Struct({ email: NullOr(S), safe: S }),
    shares: N,
    price: S,
    priceUnits: S,
    token: S,
    documentHash: S,
    calls: Schema.Array(Call),
    approvalId: S,
    expiresAt: N,
    status: Schema.Literals(["awaiting_approval", "sent", "offered", "approved", "failed"]),
    userOpHash: opt(S),
    offerId: opt(S),
    boardProposalId: opt(S),
    createdAt: N,
    settledAt: opt(N),
  }),
  key: ["transferId"],
  indexes: [
    { name: "by_transfer", fields: ["transferId"], crossTenant: true, for: "One sale by id." },
    { name: "by_org", fields: ["orgId"], for: "The company's sales." },
  ],
  retention: KEPT,
});

// ── rounds ──────────────────────────────────────────────────────────────────────────────────

export const table_org_rounds = defineTable({
  id: "org-rounds",
  title: "v4 company priced rounds",
  about:
    "One Board `Rounds.createPricedRound` proposal per row (CAP-1193). The same round asked again (same `callDigest`) " +
    "answers its waiting proposal. `roundId` and `openedAt` are noted by the settlement that sees the proposal execute, " +
    "which reports it once. Pre-money and raise are whole dollars; `priceUnits` is token units a share; `payBy` epoch seconds.",
  was: [`${T}/rounds.ts:8`, `${SCHEMA}:31`],
  concept: concept_organizations,
  tenancy: "organization",
  tenantField: "orgId",
  fields: Schema.Struct({
    orgId: S,
    roundKey: S,
    callDigest: S,
    classId: N,
    className: S,
    preMoney: N,
    raise: N,
    priceUnits: S,
    maxShares: N,
    payBy: N,
    termsHash: S,
    proposalId: S,
    roundId: opt(N),
    openedAt: opt(N),
    createdAt: N,
  }),
  key: ["roundKey"],
  indexes: [
    { name: "by_org_id", fields: ["orgId"], for: "The company's rounds." },
    { name: "by_digest", fields: ["orgId", "callDigest"], for: "The same round asked again." },
  ],
  retention: KEPT,
});

// ── votes ───────────────────────────────────────────────────────────────────────────────────

export const table_org_votes = defineTable({
  id: "org-votes",
  title: "v4 company shareholder votes",
  about:
    "One vote Capxul proposed to the company Governor (CAP-1202), from the approval its proposer signs to the proposal on " +
    "chain. After `proposed`, where the vote stands is the Governor's answer, read by `proposalId` (a uint256, decimal). " +
    "`matter` is one of VOTE_MATTERS. `opensAt` and `closesAt` are read once the proposal is on chain.",
  was: [`${T}/votes.ts:11`, `${SCHEMA}:32`],
  concept: concept_organizations,
  tenancy: "organization",
  tenantField: "orgId",
  fields: Schema.Struct({
    voteId: S,
    orgId: S,
    chainId: N,
    governor: S,
    proposalId: S,
    authUserId: S,
    matter: S,
    title: S,
    description: S,
    proposer: S,
    calls: Schema.Array(Call),
    quorumBps: N,
    approvalId: S,
    expiresAt: N,
    status: Schema.Literals(["awaiting_approval", "sent", "proposed", "failed"]),
    userOpHash: opt(S),
    opensAt: opt(N),
    closesAt: opt(N),
    createdAt: N,
    settledAt: opt(N),
  }),
  key: ["voteId"],
  indexes: [
    { name: "by_vote", fields: ["voteId"], crossTenant: true, for: "One vote by id." },
    { name: "by_org", fields: ["orgId", "createdAt"], for: "The company's votes, newest first." },
  ],
  retention: KEPT,
});

export const table_org_vote_ballots = defineTable({
  id: "org-vote-ballots",
  title: "v4 company shareholder ballots",
  about:
    "One cast Capxul opened on a vote (CAP-1219), from the approval its voter signs to the Governor counting it. `weight` " +
    "is the voter's votes at the vote's snapshot (uint256, decimal).",
  was: [`${T}/votes.ts:45`, `${SCHEMA}:32`],
  concept: concept_organizations,
  tenancy: "organization",
  tenantField: "orgId",
  fields: Schema.Struct({
    ballotId: S,
    voteId: S,
    orgId: S,
    chainId: N,
    governor: S,
    proposalId: S,
    authUserId: S,
    voter: S,
    support: Schema.Literals(["for", "against", "abstain"]),
    reason: S,
    weight: S,
    approvalId: S,
    expiresAt: N,
    status: Schema.Literals(["awaiting_approval", "sent", "cast", "failed"]),
    userOpHash: opt(S),
    createdAt: N,
    settledAt: opt(N),
  }),
  key: ["ballotId"],
  indexes: [
    { name: "by_ballot", fields: ["ballotId"], crossTenant: true, for: "One ballot by id." },
    { name: "by_vote_voter", fields: ["voteId", "voter"], crossTenant: true, for: "A voter's earlier ballots on one vote." },
  ],
  retention: KEPT,
});

export const table_org_vote_executions = defineTable({
  id: "org-vote-executions",
  title: "v4 company vote executions",
  about:
    "One execute Capxul opened for a passed vote (CAP-1203), from the approval its executor signs to the Governor running " +
    "the calls. `nonce` is the operation's EntryPoint nonce and `sentBlock` the block at send: where to find the event " +
    "that consumed it.",
  was: [`${T}/votes.ts:71`, `${SCHEMA}:32`],
  concept: concept_organizations,
  tenancy: "organization",
  tenantField: "orgId",
  fields: Schema.Struct({
    executionId: S,
    voteId: S,
    orgId: S,
    chainId: N,
    governor: S,
    proposalId: S,
    authUserId: S,
    executor: S,
    tally: Schema.Struct({ for: S, against: S, abstain: S }),
    approvalId: S,
    expiresAt: N,
    status: Schema.Literals(["awaiting_approval", "sent", "executed", "failed"]),
    userOpHash: opt(S),
    nonce: opt(S),
    sentBlock: opt(N),
    createdAt: N,
    settledAt: opt(N),
  }),
  key: ["executionId"],
  indexes: [
    { name: "by_execution", fields: ["executionId"], crossTenant: true, for: "One execution by id." },
    { name: "by_vote", fields: ["voteId"], crossTenant: true, for: "A vote's executions." },
  ],
  retention: KEPT,
});

// ── state machines ──────────────────────────────────────────────────────────────────────────

const SW = `${O}/setups/writes`;

export const machine_org_lifecycle = defineMachine({
  id: "org-lifecycle",
  title: "Organization setup status",
  about:
    "orgLifecycles.status. Born awaitingAuthorization by begin (begins.ts:161). A check's observation moves it by the pure " +
    "policy `decideSetupObservation` (rules/policies.ts:40), applied in applyObservation (observations.ts:164); the first " +
    "proof (proofs.ts:165), a resume (resumes.ts:63) and the lapsed-check recovery (checks.ts:276) move it too. No state is " +
    "terminal: a resume moves a failed setup back to processing, rechecking or ready, and a definitive answer fails even a " +
    "completed setup. The proof's own `validity` (verified, orphaned) is a second field the observations write; a reorg " +
    "orphans it (observations.ts:194) and a new verified proof restores it (proofs.ts:186). `parked` holds a setup with no " +
    "next check without changing the status.",
  was: [`${T}/setups.ts:38`, `${SETUP_MODEL}:2`, `${O}/setups/rules/policies.ts:40`],
  table: table_org_lifecycles,
  field: "status",
  initial: "awaitingAuthorization",
  states: [
    { id: "awaitingAuthorization", about: "No accepted hash: the founder prepares and signs the one sponsored bootstrap." },
    { id: "processing", about: "An accepted hash is being checked; not yet completed." },
    { id: "needsAttention", about: "A check found no answer for two minutes, a provider failed, a worker lapsed three times, or evidence is missing." },
    { id: "ready", about: "The proof is verified and the bootstrap's read model is written; checked every minute until its block is final." },
    { id: "rechecking", about: "A completed setup whose proof a reorg orphaned, or a resumed completed setup without a verified proof." },
    { id: "failed", about: "A definitive answer: the receipt reverted or does not prove the canonical bootstrap." },
  ],
  transitions: {
    to_awaitingAuthorization: {
      from: ["needsAttention"],
      to: "awaitingAuthorization",
      about:
        "Birth (begins.ts:161, from no row) reports organization_creation_started. A resume with no submission, not completed, " +
        "whose founder facts still hold, reopens authorization (resumes.ts:123); a first start reports started again " +
        "(resumes.ts:132, also recordPreparation authorizations.ts:91).",
      guard: "No submission and not completed; the snapshot parses (v3) and the founder's claimed Party and Account still own the Organization.",
      emits: [event_organization_creation_started],
    },
    to_processing: {
      from: ["awaitingAuthorization", "needsAttention", "failed", "processing"],
      to: "processing",
      about:
        "acceptAuthorization binds the hash and elects one sender (authorizations.ts:174); a resume of a submitted, uncompleted " +
        "setup (resumes.ts:57); a fresh pending or retryable provider answer keeps or returns it here (policies.ts:97).",
      guard: "Accept: the preparation is current, unexpired and identical, and the hash is bound to no other Organization.",
      emits: [],
    },
    to_needsAttention: {
      from: ["awaitingAuthorization", "processing", "rechecking", "needsAttention"],
      to: "needsAttention",
      about:
        "No answer after two minutes, a non-retryable provider failure or a worker failure (policies.ts:62-95, observations.ts:164); " +
        "restored evidence without current authority (proofs.ts:119); three abandoned checks (checks.ts:276); a resume that " +
        "finds the founder facts or snapshot missing (resumes.ts:141).",
      emits: [],
    },
    to_ready: {
      from: ["processing", "rechecking", "needsAttention", "failed"],
      to: "ready",
      about:
        "A verified proof (proofs.ts:165, verifiedProof :183); the first one materializes the read model and reports " +
        "organization_creation_ready (proofs.ts:170). A resume of a completed setup with a verified proof (resumes.ts:61).",
      emits: [event_organization_creation_ready],
    },
    to_rechecking: {
      from: ["ready", "needsAttention", "failed", "processing"],
      to: "rechecking",
      about:
        "An orphaned proof (policies.ts:57, observations.ts:190): generation + 1, the receipts orphaned through Permissions; a " +
        "pending answer on a completed setup (policies.ts:97); a resume of a completed setup whose proof is not verified (resumes.ts:62).",
      emits: [],
    },
    to_failed: {
      from: ["processing", "rechecking", "needsAttention", "ready"],
      to: "failed",
      about:
        "A definitive observation (policies.ts:59). The first definitive failure of an accepted, uncompleted attempt stamps " +
        "firstDefinitiveFailureAt and reports organization_creation_failed (observations.ts:156, :208).",
      emits: [event_organization_creation_failed],
    },
  },
});

export const machine_org_member = defineMachine({
  id: "org-member",
  title: "Organization membership status",
  about:
    "orgMembers.status. Every writer in the old code inserts or patches a row straight to active: the setup's first proof " +
    "(bootstraps.ts:152, installs.ts:109), a verified invitation grant or a Seat-only consent (members/writes/grants.ts:101, " +
    ":104). `pending`, `pending_safe` and `pending_grant` are legacy: no writer inserts them, but the advance, the sweep and " +
    "a permission application still move rows out of them. Nothing moves a row out of revoked or expired; a new " +
    "invitation upserts the same email's row back to active (grants.ts:104).",
  was: [`${T}/members.ts:19`, `${MODEL}:11`, `${O}/members/writes/advances.ts:49`, `${O}/members/writes/grants.ts:192`],
  table: table_org_members,
  field: "status",
  initial: "active",
  states: [
    { id: "pending", about: "Legacy: invited, not accepted. The daily sweep expires it once `expiresAt` (else `updatedAt`) passes." },
    { id: "pending_safe", about: "Legacy: accepted, waiting for the person's personal Safe to be claimed." },
    { id: "pending_grant", about: "Legacy: the Safe is known; waiting for the role grant's verified receipt." },
    { id: "active", about: "A Seat, current while bound to a Party and the bootstrap is usable." },
    { id: "revoked", about: "The indexer reconciliation found the role gone from Ponder's effective assignment." },
    { id: "expired", about: "A pending row the daily sweep expired." },
  ],
  transitions: {
    to_pending_grant: {
      from: ["pending_safe"],
      to: "pending_grant",
      about: "Accounts claimed the person's Safe on the Organization's chain: `advancePendingSafeMembersInTx` (advances.ts:49); reports org_invite_transitioned (progressed, account_ready).",
      emits: [event_org_invite_transitioned],
    },
    to_active: {
      from: ["pending_grant", "revoked", "expired", "pending", "pending_safe"],
      to: "active",
      about:
        "One pending_grant row a verified grant names (grants.ts:192); an invitation upsert of the email's row (grants.ts:104). " +
        "Births active: the founder (bootstraps.ts:152, installs.ts:109), a new invitee (grants.ts:101). Reports membership_activated.",
      guard: "A permission application activates only when exactly one pending_grant row is bound to the Safe and role key.",
      emits: [event_org_invite_transitioned],
    },
    to_revoked: {
      from: ["active"],
      to: "revoked",
      about: "Indexing's reconciliation finds the role no longer held (`reconcileMemberAuthorityInTx`, grants.ts:254).",
      emits: [],
    },
    to_expired: {
      from: ["pending"],
      to: "expired",
      about: "The invitations sweep's member half (`expirePendingMembers`, advances.ts:101).",
      guard: "`expiresAt` (or `updatedAt`) is at or before the sweep's time.",
      emits: [],
    },
  },
});

export const machine_seat_permission_change = defineMachine({
  id: "seat-permission-change",
  title: "Seat permission change state",
  about:
    "seatPermissionChanges.state. Born proposed with its Director proposal (members/writes/permissions.ts:187). Proposal " +
    "settlement applies it when the proposal executes (a grant inserts the seatPermissions row and schedules the grant " +
    "email; a revoke deletes it) or ends it when the proposal is rejected or replaced (proposals/writes/subjects.ts:55, :82).",
  was: [`${T}/members.ts:69`, `${O}/members/writes/permissions.ts:232`],
  table: table_seat_permission_changes,
  field: "state",
  initial: "proposed",
  states: [
    { id: "proposed", about: "Waiting for the Directors to approve its proposal at the Safe's threshold." },
    { id: "applied", about: "Its proposal executed; the grant or revoke is applied.", terminal: true },
    { id: "ended", about: "Its proposal was rejected or replaced.", terminal: true },
  ],
  transitions: {
    to_applied: {
      from: ["proposed"],
      to: "applied",
      about: "`settlePermissionChangeInTx(…, applied)` (permissions.ts:243) from a settlement that saw the proposal execute.",
      emits: [],
    },
    to_ended: {
      from: ["proposed"],
      to: "ended",
      about: "`settlePermissionChangeInTx(…, ended)` (permissions.ts:243) from a settlement that saw it rejected or replaced.",
      emits: [],
    },
  },
});

export const machine_org_role = defineMachine({
  id: "org-role",
  title: "Organization role status",
  about: "orgRoles.status. Every row is born active by the setup's first proof (bootstraps.ts:125, installs.ts:84, :132). No writer in the old code moves it to revoked.",
  was: [`${T}/roles.ts:17`, `${SW}/bootstraps.ts:125`],
  table: table_org_roles,
  field: "status",
  initial: "active",
  states: [
    { id: "active", about: "A role in the Organization's catalog." },
    { id: "revoked", about: "Declared by the validator; never written." },
  ],
  transitions: {},
});

export const machine_org_roles_deployment = defineMachine({
  id: "org-roles-deployment",
  title: "Roles module deployment status",
  about: "orgRolesDeployments.status. Born confirmed by the setup's first proof (bootstraps.ts:142, installs.ts:99). No writer moves it; requested and failed are never written.",
  was: [`${T}/roles.ts:29`, `${SW}/bootstraps.ts:142`],
  table: table_org_roles_deployments,
  field: "status",
  initial: "confirmed",
  states: [
    { id: "requested", about: "Declared by the validator; never written." },
    { id: "confirmed", about: "The deployment the verified bootstrap proved." },
    { id: "failed", about: "Declared by the validator; never written." },
  ],
  transitions: {},
});

const IW = `${O}/invitations/writes`;

export const machine_org_invitation = defineMachine({
  id: "org-invitation",
  title: "Invitation offer phase",
  about:
    "orgInvitations.phase. A configured offer is born authorizing by Permissions through the door " +
    "(`beginAuthorizingInvitationOfferInTx`, phases.ts:55); a Seat-only offer is born pending (offers.ts:136). Permissions " +
    "drives authorize, activate, late cleanup, disable and retire through the door; the grantee's consent, the endings and " +
    "the expiry sweep are this concept's own operations. `endingReason` is written once with the first ending and a replay " +
    "of the same ending adds no transition (endings.ts:84). A generation replacement keeps the phase (phases.ts:145).",
  was: [`${T}/invitations.ts:51`, `${MODEL}:65`, `${O}/README.md:660`],
  table: table_org_invitations,
  field: "phase",
  initial: "authorizing",
  states: [
    { id: "authorizing", about: "Its configure command (a Director proposal, Budgets A) has not yet been verified." },
    { id: "pending", about: "Configured and offered: the grantee may accept, decline; it expires after its lifetime." },
    { id: "pending_grant", about: "The grantee consented; the grant command is driven and waits for its verified receipt." },
    { id: "active", about: "The grant verified, or a Seat-only offer was accepted." },
    { id: "revoking", about: "Ending after configuration: disable, then compensate, on chain." },
    { id: "declined", about: "The grantee declined.", terminal: true },
    { id: "cancelled", about: "An Admin cancelled it, or the Directors' proposal of its configuration ended.", terminal: true },
    { id: "expired", about: "Unaccepted past its expiry.", terminal: true },
    { id: "revoked", about: "Retired after cleanup with no ending reason.", terminal: true },
  ],
  transitions: {
    to_pending: {
      from: ["authorizing"],
      to: "pending",
      about: "Permissions verified the configuration: `authorizeInvitationOfferInTx` stamps authorizedAt and expiresAt (phases.ts:90). A Seat-only offer is born pending and delivered in the same transaction (offers.ts:151).",
      emits: [],
    },
    to_pending_grant: {
      from: ["pending"],
      to: "pending_grant",
      about: "The grantee's consent records the digest, inserts the grant command through Permissions and schedules its drive (consent.ts:40).",
      emits: [event_org_invite_transitioned],
    },
    to_active: {
      from: ["pending", "pending_grant"],
      to: "active",
      about: "A Seat-only consent activates the offer and the Seat in one transaction (consent.ts:75); Permissions' verified grant (`activateInvitationOfferInTx`, phases.ts:102).",
      emits: [event_org_invite_transitioned],
    },
    to_revoking: {
      from: ["pending", "pending_grant", "active"],
      to: "revoking",
      about:
        "An ending of a configured offer inserts cleanup commands and schedules the disable (endings.ts:149); Permissions begins a " +
        "late grant cleanup (phases.ts:111) or records the disable and schedules the compensation (phases.ts:123).",
      guard: "The configure command is applied; otherwise the ending refuses as uncertain.",
      emits: [event_org_invite_transitioned],
    },
    to_declined: {
      from: ["pending", "pending_grant", "revoking"],
      to: "declined",
      about: "A Seat-only offer declined (endings.ts:101); a revoking offer retired with reason declined (phases.ts:139).",
      emits: [event_org_invite_transitioned],
    },
    to_cancelled: {
      from: ["authorizing", "pending", "pending_grant", "revoking"],
      to: "cancelled",
      about:
        "An authorizing offer whose configure command is provably unsigned (endings.ts:130); a Seat-only cancel (endings.ts:101); " +
        "a Directors' proposal that ended (`retireUnproposedInvitationInTx`, retirements.ts:26); retirement after cleanup (phases.ts:139).",
      emits: [event_org_invite_transitioned],
    },
    to_expired: {
      from: ["pending", "revoking"],
      to: "expired",
      about: "The sweep expires a pending Seat-only offer at once (endings.ts:101) and starts cleanup for a configured one, which retires expired later (phases.ts:139).",
      guard: "Only pending offers whose expiresAt has passed; authorizing and pending_grant are never expired.",
      emits: [event_org_invite_transitioned],
    },
    to_revoked: {
      from: ["revoking"],
      to: "revoked",
      about: "Retirement with no ending reason (`retireInvitationOfferInTx`, phases.ts:139): a late grant cleanup.",
      emits: [],
    },
  },
});

export const machine_org_invitation_delivery = defineMachine({
  id: "org-invitation-delivery",
  title: "Invitation email delivery outcome",
  about:
    "orgInvitations.delivery. Born not_confirmed. `deliverAuthorizedInvitation` (invitations/external.ts:102) is its one " +
    "writer of an outcome: none for an offer addressed by handle (no mailbox), else sent or failed from the mail provider. " +
    "A resend marks it not_confirmed and delivers again (external.ts:164).",
  was: [`${T}/invitations.ts:59`, `${O}/invitations/external.ts:73`],
  table: table_org_invitations,
  field: "delivery",
  initial: "not_confirmed",
  states: [
    { id: "not_confirmed", about: "No delivery attempt recorded yet." },
    { id: "sent", about: "The mail provider took the message." },
    { id: "failed", about: "The provider refused it; recorded and reported, never retried automatically." },
    { id: "none", about: "The request named a handle: no email goes out." },
  ],
  transitions: {
    to_not_confirmed: { from: ["sent", "failed"], to: "not_confirmed", about: "`redeliver` before a resend's attempt (external.ts:164).", emits: [] },
    to_sent: { from: ["not_confirmed"], to: "sent", about: "external.ts:123.", emits: [] },
    to_failed: { from: ["not_confirmed"], to: "failed", about: "external.ts:123.", emits: [] },
    to_none: { from: ["not_confirmed"], to: "none", about: "external.ts:106.", emits: [] },
  },
});

export const machine_org_invitation_cleanup = defineMachine({
  id: "org-invitation-cleanup",
  title: "Invitation chain cleanup",
  about: "orgInvitations.cleanup: disable-then-compensate after a configured offer ends. Born not_requested.",
  was: [`${T}/invitations.ts:68`, `${IW}/endings.ts:148`, `${IW}/phases.ts:117`],
  table: table_org_invitations,
  field: "cleanup",
  initial: "not_requested",
  states: [
    { id: "not_requested", about: "No ending needs chain cleanup." },
    { id: "disable_pending", about: "The disable command is driven." },
    { id: "compensate_pending", about: "Disabled; the compensation command is driven." },
    { id: "retired", about: "Nothing remains on chain.", terminal: true },
  ],
  transitions: {
    to_disable_pending: { from: ["not_requested"], to: "disable_pending", about: "endings.ts:151; phases.ts:112.", emits: [] },
    to_compensate_pending: { from: ["disable_pending"], to: "compensate_pending", about: "`recordInvitationDisabledInTx` (phases.ts:124).", emits: [] },
    to_retired: {
      from: ["not_requested", "compensate_pending", "disable_pending"],
      to: "retired",
      about: "A Seat-only or provably unconfigured ending (endings.ts:103, :132, retirements.ts:28); retirement after compensation (phases.ts:140).",
      emits: [],
    },
  },
});

export const machine_org_safe_proposal = defineMachine({
  id: "org-safe-proposal",
  title: "Organization Safe proposal status",
  about:
    "orgSafeProposals.status, decided by the chain. Born awaiting_approvals (proposals/writes.ts:100). `settle` " +
    "(proposals/rules.ts:184-262) settles every waiting row at a used nonce: the one whose execution landed is executed, the " +
    "rejection's target is rejected, the rest are replaced; a scheduled payment executes once its approvals reach the " +
    "threshold (rules.ts:214). Settlement then applies or ends each subject in the same transaction.",
  was: [`${T}/proposals.ts:34`, `${MODEL}:28`, `${O}/proposals/writes/settlements.ts:47`],
  table: table_org_safe_proposals,
  field: "status",
  initial: "awaiting_approvals",
  states: [
    { id: "awaiting_approvals", about: "Its nonce is unused; Directors approve it." },
    { id: "executed", about: "Its execution landed.", terminal: true },
    { id: "rejected", about: "The rejection at its nonce executed.", terminal: true },
    { id: "replaced", about: "Another transaction used its nonce.", terminal: true },
  ],
  transitions: {
    to_executed: { from: ["awaiting_approvals"], to: "executed", about: "rules.ts:214, :247.", emits: [] },
    to_rejected: { from: ["awaiting_approvals"], to: "rejected", about: "rules.ts:249.", emits: [] },
    to_replaced: { from: ["awaiting_approvals"], to: "replaced", about: "rules.ts:251.", emits: [] },
  },
});

export const machine_org_director_change = defineMachine({
  id: "org-director-change",
  title: "Board change status",
  about:
    "orgDirectorChanges.status. Born awaiting_approval (directors/writes.ts:267). `recordChangeOutcome` notes the send once " +
    "(and schedules the follow) and then the chain's answer (writes.ts:130-160). A landed change reports " +
    "board_seat_transitioned or board_threshold_transitioned in the same transaction. `lapsed` is read from expiresAt.",
  was: [`${T}/directors.ts:47`, `${O}/directors/writes.ts:119`],
  table: table_org_director_changes,
  field: "status",
  initial: "awaiting_approval",
  states: [
    { id: "awaiting_approval", about: "Waiting for the founder's signed approval." },
    { id: "sent", about: "The seat's operation went to the bundler." },
    { id: "seated", about: "A Director was seated or a seat claimed.", terminal: true },
    { id: "set", about: "The Signer Gate's threshold was set.", terminal: true },
    { id: "removed", about: "A Director was removed, or lapsed signers dropped.", terminal: true },
    { id: "handed_over", about: "The Board was handed to the Governor.", terminal: true },
    { id: "failed", about: "The operation reverted or never landed.", terminal: true },
  ],
  transitions: {
    to_sent: { from: ["awaiting_approval"], to: "sent", about: "writes.ts:139.", emits: [] },
    to_seated: { from: ["awaiting_approval", "sent"], to: "seated", about: "writes.ts:152.", emits: [event_board_seat_transitioned] },
    to_set: { from: ["awaiting_approval", "sent"], to: "set", about: "writes.ts:152.", emits: [event_board_threshold_transitioned] },
    to_removed: { from: ["awaiting_approval", "sent"], to: "removed", about: "writes.ts:152.", emits: [event_board_seat_transitioned] },
    to_handed_over: { from: ["awaiting_approval", "sent"], to: "handed_over", about: "writes.ts:152.", emits: [event_board_seat_transitioned] },
    to_failed: { from: ["awaiting_approval", "sent"], to: "failed", about: "writes.ts:152; nothing is reported.", emits: [] },
  },
});

export const machine_org_share_transfer = defineMachine({
  id: "org-share-transfer",
  title: "Secondary share sale status",
  about:
    "orgShareTransfers.status. Born awaiting_approval (equity/writes/transfers.ts:169). The send, then the receipt's " +
    "answer (transfers.ts:57, :71, equity/external/transfers.ts:98); the Board's approval settles it approved " +
    "(transfer-settlements.ts:23, approve-transfer.ts:58). `lapsed` is read from expiresAt.",
  was: [`${T}/share-transfers.ts:30`, `${O}/equity/writes/transfers.ts:57`],
  table: table_org_share_transfers,
  field: "status",
  initial: "awaiting_approval",
  states: [
    { id: "awaiting_approval", about: "Waiting for the seller's signed approval." },
    { id: "sent", about: "The offer went to the bundler." },
    { id: "offered", about: "Exits recorded the offer (`TransferOffered`)." },
    { id: "approved", about: "The Board's `Exits.approveTransfer` executed.", terminal: true },
    { id: "failed", about: "The offer reverted or never landed.", terminal: true },
  ],
  transitions: {
    to_sent: { from: ["awaiting_approval"], to: "sent", about: "transfers.ts:57.", emits: [] },
    to_offered: { from: ["awaiting_approval", "sent"], to: "offered", about: "transfers.ts:71; reports equity_shares_transitioned (sale_requested).", emits: [event_equity_shares_transitioned] },
    to_approved: { from: ["offered"], to: "approved", about: "transfer-settlements.ts:23; reports transfer_approved.", emits: [event_equity_shares_transitioned] },
    to_failed: { from: ["awaiting_approval", "sent"], to: "failed", about: "transfers.ts:71.", emits: [] },
  },
});

export const machine_org_vote = defineMachine({
  id: "org-vote",
  title: "Shareholder vote status (Capxul's part)",
  about:
    "orgVotes.status: only Capxul's part, until the Governor holds the proposal. Born awaiting_approval (votes/writes.ts:205); " +
    "the send, then `proposed` with opensAt/closesAt, which reports vote_transitioned (opened) (writes.ts:74-99).",
  was: [`${T}/votes.ts:33`, `${O}/votes/writes.ts:74`],
  table: table_org_votes,
  field: "status",
  initial: "awaiting_approval",
  states: [
    { id: "awaiting_approval", about: "Waiting for the proposer's signed approval." },
    { id: "sent", about: "The `propose` operation went to the bundler." },
    { id: "proposed", about: "The Governor holds it; the Governor answers from here.", terminal: true },
    { id: "failed", about: "The operation reverted or never landed.", terminal: true },
  ],
  transitions: {
    to_sent: { from: ["awaiting_approval"], to: "sent", about: "writes.ts:74.", emits: [] },
    to_proposed: { from: ["awaiting_approval", "sent"], to: "proposed", about: "writes.ts:88, :98.", emits: [event_vote_transitioned] },
    to_failed: { from: ["awaiting_approval", "sent"], to: "failed", about: "writes.ts:88; votes/external.ts:272.", emits: [] },
  },
});

export const machine_org_vote_ballot = defineMachine({
  id: "org-vote-ballot",
  title: "Shareholder ballot status",
  about: "orgVoteBallots.status. Born awaiting_approval (votes/writes/ballots.ts:149); the send, then cast or failed from the receipt (ballots.ts:63, :76; votes/external/ballots.ts:127).",
  was: [`${T}/votes.ts:62`, `${O}/votes/writes/ballots.ts:63`],
  table: table_org_vote_ballots,
  field: "status",
  initial: "awaiting_approval",
  states: [
    { id: "awaiting_approval", about: "Waiting for the voter's signed approval." },
    { id: "sent", about: "`castVoteWithReason` went to the bundler." },
    { id: "cast", about: "The Governor counted it.", terminal: true },
    { id: "failed", about: "Reverted or never landed.", terminal: true },
  ],
  transitions: {
    to_sent: { from: ["awaiting_approval"], to: "sent", about: "ballots.ts:63.", emits: [] },
    to_cast: { from: ["awaiting_approval", "sent"], to: "cast", about: "ballots.ts:76; reports vote_transitioned (cast) (ballots.ts:81).", emits: [event_vote_transitioned] },
    to_failed: { from: ["awaiting_approval", "sent"], to: "failed", about: "ballots.ts:76.", emits: [] },
  },
});

export const machine_org_vote_execution = defineMachine({
  id: "org-vote-execution",
  title: "Vote execution status",
  about: "orgVoteExecutions.status. Born awaiting_approval (votes/writes/executions.ts:172); the send with its EntryPoint nonce and block, then executed or failed (executions.ts:83, :100; votes/external/executions.ts:83).",
  was: [`${T}/votes.ts:86`, `${O}/votes/writes/executions.ts:83`],
  table: table_org_vote_executions,
  field: "status",
  initial: "awaiting_approval",
  states: [
    { id: "awaiting_approval", about: "Waiting for the executor's signed approval." },
    { id: "sent", about: "`execute` went to the bundler." },
    { id: "executed", about: "The Governor ran the calls.", terminal: true },
    { id: "failed", about: "Reverted or never landed.", terminal: true },
  ],
  transitions: {
    to_sent: { from: ["awaiting_approval"], to: "sent", about: "executions.ts:83.", emits: [] },
    to_executed: { from: ["awaiting_approval", "sent"], to: "executed", about: "executions.ts:100; reports vote_transitioned (executed) (executions.ts:105).", emits: [event_vote_transitioned] },
    to_failed: { from: ["awaiting_approval", "sent"], to: "failed", about: "executions.ts:100.", emits: [] },
  },
});
