// The as-is book of the old organizations concept: the members area.
//
// Every operation registered at `organizations/members:*` (packages/backend/convex/organizations/
// members.ts:6-14), as the old code does it. Three are public operations built from their
// protocol rows (packages/protocol/src/organizations/operations.ts:159-172). `permissionTarget` and
// `recordPermissionChange` are internal rpcs the grant and revoke actions run in the same call;
// `advance` is an internal mutation Accounts' claim runs in its own action
// (accounts/claims/writes/transitions.ts:91). `notifyPermission` is scheduled by the settlement
// that applies a grant, so it is a workflow. The two emit operations are telemetry plumbing.
//
// The grant and revoke actions start with `requireSafeOwner`, the door procedure that runs the
// proposals area's load query and settle mutation (booked in proposals.ts); its touches are on that
// procedure, and its chain reads are listed here as the action's calls.

import { Schema } from "effect";
import { defineRpc, defineWorkflow, type CallRef } from "../../../packages/book/src/index.ts";
import { concept_organizations } from "../shared/foundation.ts";
import {
  error_ENV_MISSING,
  error_FEATURE_NOT_AVAILABLE,
  error_INVALID_INPUT,
  error_NOT_AUTHENTICATED,
  error_PROVIDER_ERROR,
  error_ROLE_PERMISSION_DENIED,
  error_SMART_ACCOUNT_MISSING,
  error_UNKNOWN,
  error_WRONG_STATE,
  event_org_invite_transitioned,
  event_org_seat_permission_proposed,
} from "../shared/vocabulary.ts";
import { integration_chain_rpc, integration_mail } from "../shared/external.ts";
import {
  machine_org_member,
  machine_seat_permission_change,
  table_org_lifecycles,
  table_org_members,
  table_org_safe_proposals,
  table_orgs,
  table_seat_permission_changes,
  table_seat_permissions,
} from "./data.ts";
import {
  procedure_organizations_advance_pending_safe_members_in_tx,
  procedure_organizations_read_active_member_by_email_in_tx,
  procedure_organizations_read_company_deployment_in_tx,
  procedure_organizations_read_seat_standing_by_email_in_tx,
  procedure_organizations_record_owner_proposal_in_tx,
  procedure_organizations_require_org_participant,
  procedure_organizations_require_safe_owner,
} from "./procedures.ts";
import { procedure_access_require_feature_from_action } from "../access/procedures.ts";
import { procedure_accounts_read_workspace_attached_account_id_in_tx } from "../accounts/procedures.ts";
import { procedure_permissions_org_bootstrap_authority_usable } from "../permissions/procedures.ts";

const O = "packages/backend/src/organizations";
const M = `${O}/members`;
const OPS = `${M}/operations`;
const CONVEX = "packages/backend/convex/organizations/members.ts";
const ROWS = "packages/protocol/src/organizations/operations.ts";

/** The integration's own call record when booked, else the reference its record will carry. */
const callOf = (integration: { readonly id: string; readonly c: object }, name: string): CallRef =>
  (integration.c as Record<string, CallRef | undefined>)[name] ??
  ({ _kind: "call", id: `${integration.id}.${name}`, integration: integration.id, name } as CallRef);

const S = Schema.String;
const N = Schema.Number;
const U = Schema.Unknown;
const SeatPermission = Schema.Literals(["manage-books", "issue-invoices", "manage-people"]);
const CALL = [error_NOT_AUTHENTICATED, error_INVALID_INPUT];
const DEFECTS = [error_UNKNOWN, error_ENV_MISSING];

/** `memberView` (members/views.ts:19): the attached Account and, for a Seat, its permissions. */
const MEMBER_VIEW = {
  reads: [table_org_members, table_orgs, table_seat_permissions],
  invokes: [procedure_accounts_read_workspace_attached_account_id_in_tx, procedure_permissions_org_bootstrap_authority_usable],
};
/** `waitingGrantsInTx` and the Seat lookup (members/reads/permissions.ts:81, reads/participation.ts:258). */
const TARGET = {
  reads: [table_org_members, table_orgs, table_org_lifecycles, table_seat_permission_changes],
  invokes: [
    procedure_organizations_read_seat_standing_by_email_in_tx,
    procedure_organizations_read_company_deployment_in_tx,
    procedure_organizations_read_active_member_by_email_in_tx,
  ],
};
/** `recordPermissionChangeInTx` (members/writes/permissions.ts:134). */
const RECORD = {
  reads: [table_seat_permissions, table_seat_permission_changes, table_org_safe_proposals],
  writes: [table_org_safe_proposals, table_seat_permission_changes],
  invokes: [procedure_organizations_record_owner_proposal_in_tx],
};
/** `refreshProposals` (proposals/writes.ts:303) behind `requireSafeOwner`, and `readOfficerHat` (members/external.ts:77). */
const OWNER_CALLS = [
  callOf(integration_chain_rpc, "fetchLatestBlockNumber"),
  callOf(integration_chain_rpc, "fetchSafeOwners"),
  callOf(integration_chain_rpc, "fetchEthCall"),
  callOf(integration_chain_rpc, "fetchStorageAtBlock"),
  callOf(integration_chain_rpc, "fetchUserOperationReceipt"),
];

const SeatPermissionInput = Schema.Struct({
  orgId: S,
  email: S,
  permission: SeatPermission,
  note: Schema.optionalKey(S),
});
/** `ProposedSeatPermissionSchema` (protocol seat-permission-schema.ts): the change and its proposal view. */
const ProposedSeatPermission = Schema.Struct({
  change: Schema.Struct({
    changeId: S,
    change: Schema.Literals(["grant", "revoke"]),
    permission: SeatPermission,
    email: S,
    name: Schema.NullOr(S),
    state: Schema.Literal("proposed"),
  }),
  proposal: U,
});

// ── public ──────────────────────────────────────────────────────────────────────────────────

export const rpc_organizations_members_list = defineRpc({
  id: "organizations.members.list",
  title: "The Organization's roster",
  about:
    "Row `organizations.members.list`, the public query `organizations/members:list`. Signed in, a current participant " +
    "(`requireParticipant`). Every membership row of the Organization in any status, as member views with the attached " +
    "Account and, for a Seat, its permissions, oldest invitation first, as one page. No on-chain assignment is read.",
  was: [`${OPS}/list.ts:11`, `${CONVEX}:10`, `${ROWS}:161`, `${M}/reads.ts:16`, `${M}/views.ts:19`],
  concept: concept_organizations,
  kind: "query",
  who: "A signed-in current Seat of the Organization.",
  input: Schema.Struct({ orgId: S }),
  output: Schema.Struct({ items: Schema.Array(U), nextCursor: Schema.NullOr(S) }),
  errors: [...CALL, ...DEFECTS, error_ROLE_PERMISSION_DENIED],
  reads: MEMBER_VIEW.reads,
  writes: [],
  drives: [],
  invokes: [procedure_organizations_require_org_participant, ...MEMBER_VIEW.invokes],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

const changeAbout = (verb: string) =>
  `Signed in (\`signedInAction\`). The \`owner-safe-proposals\` gate for the Organization, and for Manage books the \`books\` ` +
  `gate too (FEATURE_NOT_AVAILABLE). \`requireSafeOwner\`: the proposals area's load, the Safe read from the chain and ` +
  `settled, the caller's personal Safe a live owner (ROLE_PERMISSION_DENIED, SMART_ACCOUNT_MISSING). ` +
  `organizations.members.permission-target names the current Seat by email (none: INVALID_INPUT); Manage people needs ` +
  `v4 (FEATURE_NOT_AVAILABLE). On v4 the change is the officer hat: Hats is read now (wears or not, else WRONG_STATE ` +
  `unchanged; no personal Safe: WRONG_STATE) and the Board's calls mint or rule out the hat. ` +
  `organizations.members.record-permission-change then ${verb}. The Seat holds the change only once the proposal executes.`;

export const rpc_organizations_members_grant = defineRpc({
  id: "organizations.members.grant",
  title: "A Director proposes giving a Seat a permission",
  about:
    "Row `organizations.members.grant`, the public action `organizations/members:grant` (CAP-945). " +
    changeAbout("stores the grant with its Director proposal and schedules org_seat_permission_proposed"),
  was: [`${OPS}/grant.ts:155`, `${OPS}/grant.ts:110`, `${OPS}/grant.ts:63`, `${CONVEX}:9`, `${ROWS}:59`, `${ROWS}:168`, `${M}/external.ts:77`],
  concept: concept_organizations,
  kind: "action",
  who: "A signed-in Director: the caller's personal Safe signs the Organization Safe now, as the chain reads it.",
  input: SeatPermissionInput,
  output: ProposedSeatPermission,
  errors: [...CALL, ...DEFECTS, error_ROLE_PERMISSION_DENIED, error_SMART_ACCOUNT_MISSING, error_WRONG_STATE, error_PROVIDER_ERROR, error_FEATURE_NOT_AVAILABLE],
  reads: [...new Set([...TARGET.reads, ...RECORD.reads])],
  writes: RECORD.writes,
  drives: [],
  invokes: [
    procedure_access_require_feature_from_action,
    procedure_organizations_require_safe_owner,
    ...TARGET.invokes,
    ...RECORD.invokes,
  ],
  emits: [event_org_seat_permission_proposed],
  calls: OWNER_CALLS,
  chain: [],
  spans: [],
});

export const rpc_organizations_members_revoke = defineRpc({
  id: "organizations.members.revoke",
  title: "A Director proposes taking a Seat's permission back",
  about:
    "Row `organizations.members.revoke`, the public action `organizations/members:revoke` (CAP-945), the same composition " +
    "as grant with change revoke. " +
    changeAbout("stores the revoke with its Director proposal and schedules org_seat_permission_proposed"),
  was: [`${OPS}/revoke.ts:11`, `${OPS}/grant.ts:110`, `${CONVEX}:14`, `${ROWS}:171`],
  concept: concept_organizations,
  kind: "action",
  who: "A signed-in Director: the caller's personal Safe signs the Organization Safe now, as the chain reads it.",
  input: SeatPermissionInput,
  output: ProposedSeatPermission,
  errors: [...CALL, ...DEFECTS, error_ROLE_PERMISSION_DENIED, error_SMART_ACCOUNT_MISSING, error_WRONG_STATE, error_PROVIDER_ERROR, error_FEATURE_NOT_AVAILABLE],
  reads: [...new Set([...TARGET.reads, ...RECORD.reads])],
  writes: RECORD.writes,
  drives: [],
  invokes: [
    procedure_access_require_feature_from_action,
    procedure_organizations_require_safe_owner,
    ...TARGET.invokes,
    ...RECORD.invokes,
  ],
  emits: [event_org_seat_permission_proposed],
  calls: OWNER_CALLS,
  chain: [],
  spans: [],
});

// ── internal ────────────────────────────────────────────────────────────────────────────────

export const rpc_organizations_members_permission_target = defineRpc({
  id: "organizations.members.permission-target",
  title: "The current Seat a permission change names",
  about:
    "Internal query: the current Seat with the email (none: null); on a v4 company also its stored deployment, the Seat's " +
    "personal Safe (the active member with that email) and how many proposed grants of the permission wait.",
  was: [`${OPS}/permission-target.ts:21`, `${CONVEX}:12`],
  concept: concept_organizations,
  kind: "query",
  who: "internal: the grant and revoke actions.",
  input: Schema.Struct({ orgId: S, email: S, permission: SeatPermission }),
  output: Schema.NullOr(
    Schema.Struct({
      grantee: Schema.Struct({ authUserId: S, email: S, name: Schema.NullOr(S) }),
      deployment: Schema.NullOr(S),
      personalSafe: Schema.NullOr(S),
      waitingGrants: N,
    }),
  ),
  errors: [],
  reads: TARGET.reads,
  writes: [],
  drives: [],
  invokes: [...TARGET.invokes, procedure_permissions_org_bootstrap_authority_usable],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_organizations_members_record_permission_change = defineRpc({
  id: "organizations.members.record-permission-change",
  title: "Store a Seat permission change with its Director proposal",
  about:
    "Internal mutation. Before v4 it re-checks the held state (a grant of a held permission or a revoke of an unheld one " +
    "is WRONG_STATE); a change of the same permission still proposed is WRONG_STATE; on v4 a grant whose waiting-grant " +
    "count moved is WRONG_STATE. It stores the Director proposal at the next free nonce (v4: the hat calls; before: one " +
    "SignMessageLib delegatecall naming the change), subject seat_permission, then the change `spc_<ulid>` proposed, and " +
    "schedules organizations.members.emit-permission-proposed.",
  was: [`${OPS}/record-permission-change.ts:17`, `${CONVEX}:13`, `${M}/writes/permissions.ts:134`, `${M}/events.ts:161`],
  concept: concept_organizations,
  kind: "mutation",
  who: "internal: the grant and revoke actions, for the Director they checked.",
  input: Schema.Struct({
    method: S,
    authUserId: S,
    owner: Schema.Struct({ orgId: S, chainId: N, safeAddress: S, chainNonce: N, threshold: N, proposer: S }),
    grantee: Schema.Struct({ authUserId: S, email: S, name: Schema.NullOr(S) }),
    change: Schema.Literals(["grant", "revoke"]),
    permission: SeatPermission,
    note: Schema.optionalKey(S),
    hatPlan: Schema.optionalKey(Schema.Struct({ waitingGrants: N, calls: Schema.Array(Schema.Struct({ to: S, value: S, data: S })) })),
  }),
  output: ProposedSeatPermission,
  errors: [error_INVALID_INPUT, error_WRONG_STATE],
  ...RECORD,
  drives: [],
  emits: [event_org_seat_permission_proposed],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_organizations_members_advance = defineRpc({
  id: "organizations.members.advance",
  title: "A claimed personal Safe advances the memberships waiting for it",
  about:
    "Internal mutation Accounts' claim runs (`ctx.runMutation`) once a person's personal Safe is claimed on a chain: every " +
    "pending_safe row of theirs on that chain gets the Safe and moves to pending_grant, each reporting progressed " +
    "(account_ready). Returns the matched Organizations and member views.",
  was: [`${OPS}/advance.ts:11`, `${CONVEX}:6`, `${M}/writes/advances.ts:72`, "packages/backend/src/accounts/claims/writes/transitions.ts:91"],
  concept: concept_organizations,
  kind: "mutation",
  who: "internal: Accounts' claim transition, for the person who claimed the Safe.",
  input: Schema.Struct({ authUserId: S, chainId: N, personalSafeAddress: S }),
  output: Schema.Struct({ matched: Schema.Array(S), members: Schema.Array(U) }),
  errors: [error_INVALID_INPUT, error_UNKNOWN],
  reads: MEMBER_VIEW.reads,
  writes: [table_org_members],
  drives: [machine_org_member.t.to_pending_grant],
  invokes: [procedure_organizations_advance_pending_safe_members_in_tx, ...MEMBER_VIEW.invokes],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_organizations_members_emit_progressed = defineRpc({
  id: "organizations.members.emit-progressed",
  title: "Deliver org_invite_transitioned (progressed)",
  about:
    "Telemetry plumbing: the internal action `organizations/members:emitProgressed`, scheduled by " +
    "`scheduleInviteProgressed` from the mutation that committed a membership step (account_ready, " +
    "configuration_authorized, permission_applied, membership_activated). It posts the event from the captured snapshot " +
    "and re-reads no row. Reads and writes no table.",
  was: [`${OPS}/emit-progressed.ts:14`, `${CONVEX}:8`, `${M}/events.ts:58`, `${M}/events.ts:94`],
  concept: concept_organizations,
  kind: "action",
  who: "internal: scheduled by the membership write it reports.",
  input: Schema.Struct({
    organizationId: S,
    progress: Schema.Literals(["account_ready", "configuration_authorized", "permission_applied", "membership_activated"]),
    memberPartyId: S,
    occurredAt: N,
    invitationId: Schema.optionalKey(S),
    generation: Schema.optionalKey(S),
    commandId: Schema.optionalKey(S),
    authUserId: Schema.optionalKey(S),
    observationContext: Schema.optionalKey(U),
  }),
  output: Schema.Void,
  errors: [],
  reads: [],
  writes: [],
  drives: [],
  invokes: [],
  emits: [event_org_invite_transitioned],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_organizations_members_emit_permission_proposed = defineRpc({
  id: "organizations.members.emit-permission-proposed",
  title: "Deliver org_seat_permission_proposed",
  about:
    "Telemetry plumbing: the internal action `organizations/members:emitPermissionProposed`, scheduled by " +
    "record-permission-change after the proposal commits; posts the change, permission, proposal, nonce and threshold " +
    "from the snapshot. Reads and writes no table.",
  was: [`${OPS}/emit-permission-proposed.ts:16`, `${CONVEX}:7`, `${M}/events.ts:194`],
  concept: concept_organizations,
  kind: "action",
  who: "internal: scheduled by organizations.members.record-permission-change.",
  input: Schema.Struct({
    authUserId: S,
    organizationId: S,
    change: Schema.Literals(["grant", "revoke"]),
    permission: SeatPermission,
    changeId: S,
    proposalId: S,
    nonce: N,
    threshold: N,
    occurredAt: N,
    observationContext: Schema.optionalKey(U),
  }),
  output: Schema.Void,
  errors: [],
  reads: [],
  writes: [],
  drives: [],
  invokes: [],
  emits: [event_org_seat_permission_proposed],
  calls: [],
  chain: [],
  spans: [],
});

// ── workflow ────────────────────────────────────────────────────────────────────────────────

export const workflow_organizations_members_notify_permission = defineWorkflow({
  id: "organizations.members.notify-permission",
  title: "Email a Seat it now holds a permission",
  about:
    "The internal action `organizations/members:notifyPermission`, scheduled (runAfter 0) by `grantSeatPermissionInTx` in " +
    "the settlement that applies a proposed grant (members/writes/permissions.ts:66); the founder's grants at creation " +
    "send none. It runs as the system job `seat_permission_notices` and sends one notice through `deliverNotices`, keyed " +
    "by operation, Organization, person, permission and grant time; recipients the provider did not take are retried by " +
    "scheduling itself again with `attempt + 1` and only those recipients. A failed send never stops or repeats the grant.",
  was: [`${OPS}/notify-permission.ts:18`, `${CONVEX}:11`, `${M}/external.ts:43`, `${M}/writes/permissions.ts:66`],
  concept: concept_organizations,
  priority: "low",
  trigger: { transition: machine_seat_permission_change.t.to_applied },
  instance: { per: table_seat_permissions },
  steps: [
    { name: "attribute", about: "Runs as the system job `seat_permission_notices`." },
    { name: "deliver", about: "`deliverNotices`: one email to the Seat naming the Organization and the permission." },
    { name: "retry", about: "Schedules itself for the recipients the provider did not take, with the next attempt number." },
  ],
  reads: [],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [callOf(integration_mail, "deliverNotices")],
  chain: [],
  idempotency: "The notice key `<operation>:<orgId>:<authUserId>:<permission>:<grantedAt>` and the delivery record of each recipient.",
  timeoutMs: 600_000,
  retries: { max: 2, backoff: "exponential" },
});
