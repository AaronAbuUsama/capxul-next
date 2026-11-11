// The as-is book of the old organizations concept: the invitations area.
//
// Every operation registered at `organizations/invitations:*` (packages/backend/convex/organizations/
// invitations.ts:7-23), as the old code does it. Ten are public operations built from their
// protocol rows (packages/protocol/src/organizations/operations.ts:69-139). `sweep` is the internal
// mutation the daily `expire` cron runs in its own action; `expire` is a workflow. The five emit
// operations are telemetry plumbing scheduled by the committing write.
//
// Permissions drives a configured offer through this concept's door (procedures.ts); the work it
// schedules back (`internal.permissions.grants.drive`, `internal.permissions.grants.retry`) is named
// in `about` and not linked. A refusal that confirms nothing: `get`, `accept` and `decline` refuse a
// wrong Organization, a missing offer and a wrong grantee alike (ROLE_PERMISSION_DENIED).

import { Schema } from "effect";
import { defineRpc, defineWorkflow } from "../../../packages/book/src/index.ts";
import { concept_organizations } from "../shared/foundation.ts";
import {
  error_ACCOUNT_NOT_FOUND,
  error_ENV_MISSING,
  error_INVALID_INPUT,
  error_NOT_AUTHENTICATED,
  error_RATE_LIMITED,
  error_ROLE_PERMISSION_DENIED,
  error_SMART_ACCOUNT_MISSING,
  error_UNKNOWN,
  error_WRONG_STATE,
  event_org_invite_transitioned,
} from "../shared/vocabulary.ts";
import {
  machine_org_invitation,
  machine_org_invitation_cleanup,
  machine_org_invitation_delivery,
  machine_org_member,
  table_org_invitations,
  table_org_members,
  table_org_safe_proposals,
  table_orgs,
} from "./data.ts";
import {
  procedure_organizations_apply_verified_invitation_member_in_tx,
  procedure_organizations_begin_authorizing_invitation_offer_in_tx,
  procedure_organizations_deliver_invitation_outcome,
  procedure_organizations_read_subject_proposal_in_tx,
} from "./procedures.ts";
import { procedure_access_admit_invited_in_tx } from "../access/procedures.ts";
import {
  procedure_accounts_read_exact_target_account_in_tx,
  procedure_accounts_read_invitation_account_for_safe_in_tx,
  procedure_accounts_read_party_account_binding_in_tx,
} from "../accounts/procedures.ts";
import {
  procedure_parties_ensure_party_by_email,
  procedure_parties_find_party_by_email,
  procedure_parties_is_invitation_grantee_in_tx,
  procedure_parties_party_by_handle,
  procedure_parties_party_by_id,
  procedure_parties_party_by_safe_address,
  procedure_parties_read_invitation_grantee_binding_in_tx,
} from "../parties/procedures.ts";
import {
  procedure_permissions_create_authorizing_invitation,
  procedure_permissions_find_command_authority,
  procedure_permissions_find_people_manager,
  procedure_permissions_has_uncertain_invitation_configuration_execution,
  procedure_permissions_insert_cleanup_commands,
  procedure_permissions_insert_grant,
  procedure_permissions_preview_grants,
  procedure_permissions_read_configuration_collision,
  procedure_permissions_read_invitation_configuration_state_in_tx,
  procedure_permissions_read_invitation_offer_binding_in_tx,
  procedure_permissions_read_invitation_verification_retry_state_in_tx,
  procedure_permissions_read_live_assignments,
  procedure_permissions_require_people_manager,
} from "../permissions/procedures.ts";

const O = "packages/backend/src/organizations";
const I = `${O}/invitations`;
const OPS = `${I}/operations`;
const CONVEX = "packages/backend/convex/organizations/invitations.ts";
const ROWS = "packages/protocol/src/organizations/operations.ts";

const S = Schema.String;
const N = Schema.Number;
const U = Schema.Unknown;
const uniq = <T>(items: readonly T[]): T[] => [...new Set(items)];

const CALL = [error_NOT_AUTHENTICATED, error_INVALID_INPUT];
const DEFECTS = [error_UNKNOWN, error_ENV_MISSING];
/** Acting as an Admin: no Manage people authority here, or no Account to hold any (operations.ts:49). */
const ADMIN_ERRORS = [error_ROLE_PERMISSION_DENIED, error_SMART_ACCOUNT_MISSING, error_ACCOUNT_NOT_FOUND];

/** `InvitationViewSchema` (protocol invitation-schema.ts): the offer with its live policies; too deep to transcribe. */
const InvitationView = U;
/** `InvitationPageSchema`: one page of views and its versioned cursor. */
const InvitationPage = Schema.Struct({ items: Schema.Array(U), nextCursor: Schema.NullOr(S) });
const OneInvitation = Schema.Struct({ orgId: S, invitationId: S });
const PageInput = Schema.Struct({
  cursor: Schema.optionalKey(S),
  limit: Schema.optionalKey(N),
  phases: Schema.optionalKey(Schema.Array(S)),
});

// ── what shared helpers touch ───────────────────────────────────────────────────────────────

/** `requireAdmin` (guards.ts:15): Permissions' Manage people authority. */
const ADMIN = [procedure_permissions_require_people_manager];
/** `requireGrantee` (guards.ts:32): the exact grantee Party, by the session's email. */
const GRANTEE = [procedure_parties_is_invitation_grantee_in_tx];
/** `invitationView` (views.ts:130): the grantee binding, the offer's live policy bindings, the Account, retry eligibility. */
const VIEW = {
  reads: [table_org_invitations, table_orgs],
  invokes: [
    procedure_parties_read_invitation_grantee_binding_in_tx,
    procedure_permissions_read_invitation_offer_binding_in_tx,
    procedure_accounts_read_party_account_binding_in_tx,
    procedure_permissions_find_command_authority,
    procedure_permissions_read_invitation_verification_retry_state_in_tx,
  ],
};
/** `previewGrantee` and `requireAccountParty` (reads/grantees.ts): the grantee a request names. */
const GRANTEE_RULE = [
  procedure_accounts_read_exact_target_account_in_tx,
  procedure_parties_find_party_by_email,
  procedure_accounts_read_invitation_account_for_safe_in_tx,
  procedure_parties_party_by_handle,
  procedure_parties_party_by_safe_address,
];
/** `endInvitation` (writes/endings.ts:72): a Seat-only retirement, a provably unsigned cancel, or disable-then-compensate. */
const ENDING = {
  reads: [table_org_invitations, table_org_safe_proposals],
  writes: [table_org_invitations],
  invokes: [
    procedure_organizations_read_subject_proposal_in_tx,
    procedure_permissions_read_invitation_configuration_state_in_tx,
    procedure_permissions_has_uncertain_invitation_configuration_execution,
    procedure_permissions_insert_cleanup_commands,
  ],
};

// ── public reads ────────────────────────────────────────────────────────────────────────────

export const rpc_organizations_invitations_preview = defineRpc({
  id: "organizations.invitations.preview",
  title: "What an invitation would grant, for an Admin",
  about:
    "Row `organizations.invitations.preview`, the public query `organizations/invitations:preview`. Signed in, a current " +
    "Admin (Manage people). The grantee the request names, by the same rule the writer uses, the grants Permissions would " +
    "configure (`previewGrants`) and the grantee's existing live assignments. Writes nothing.",
  was: [`${OPS}/preview.ts:10`, `${CONVEX}:20`, `${ROWS}:71`, `${I}/views.ts:98`, `${I}/reads/grantees.ts:72`],
  concept: concept_organizations,
  kind: "query",
  who: "A signed-in person with Manage people authority in the Organization.",
  input: Schema.Struct({ orgId: S, request: U }),
  output: U,
  errors: [...CALL, ...DEFECTS, ...ADMIN_ERRORS, error_WRONG_STATE],
  reads: [],
  writes: [],
  drives: [],
  invokes: [...ADMIN, ...GRANTEE_RULE, procedure_permissions_preview_grants, procedure_permissions_read_live_assignments],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_organizations_invitations_get = defineRpc({
  id: "organizations.invitations.get",
  title: "One offer, for its grantee or a current Admin",
  about:
    "Row `organizations.invitations.get`, the public query `organizations/invitations:get`; the SDK also subscribes to it " +
    "(invitation-subscription.ts:21). The offer in this Organization (else ROLE_PERMISSION_DENIED), visible to its exact " +
    "grantee Party or anyone with Manage people authority (else the same refusal), as the view with its live policies.",
  was: [`${OPS}/get.ts:11`, `${CONVEX}:16`, `${ROWS}:78`, `${I}/guards.ts:39`, `${I}/views.ts:42`],
  concept: concept_organizations,
  kind: "live",
  who: "A signed-in person who is the offer's grantee or holds Manage people authority in the Organization.",
  input: OneInvitation,
  output: InvitationView,
  errors: [...CALL, ...DEFECTS, error_ROLE_PERMISSION_DENIED, error_WRONG_STATE],
  reads: VIEW.reads,
  writes: [],
  drives: [],
  invokes: uniq([...GRANTEE, procedure_permissions_find_people_manager, ...VIEW.invokes]),
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_organizations_invitations_list = defineRpc({
  id: "organizations.invitations.list",
  title: "The Organization's offers, for a current Admin",
  about:
    "Row `organizations.invitations.list`, the public query `organizations/invitations:list`. Signed in, a current Admin. " +
    "One bounded page of the Organization's offers (every phase or exactly one) in (createdAt, invitationId) order under a " +
    "versioned cursor; a bad page or a foreign cursor is INVALID_INPUT.",
  was: [`${OPS}/list.ts:10`, `${CONVEX}:18`, `${ROWS}:85`, `${I}/views.ts:51`, `${I}/reads/pages.ts:201`, `${I}/reads/streams.ts:59`],
  concept: concept_organizations,
  kind: "query",
  who: "A signed-in person with Manage people authority in the Organization.",
  input: Schema.Struct({ orgId: S, cursor: Schema.optionalKey(S), limit: Schema.optionalKey(N), phases: Schema.optionalKey(Schema.Array(S)) }),
  output: InvitationPage,
  errors: [...CALL, ...DEFECTS, ...ADMIN_ERRORS, error_WRONG_STATE],
  reads: VIEW.reads,
  writes: [],
  drives: [],
  invokes: uniq([...ADMIN, ...VIEW.invokes]),
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_organizations_invitations_list_mine = defineRpc({
  id: "organizations.invitations.list-mine",
  title: "The signed-in person's own offers",
  about:
    "Row `organizations.invitations.listMine`, the public query `organizations/invitations:listMine`. Signed in. The " +
    "Party of the session's email (`findPartyByEmail`); none is an empty page. One bounded page of that Party's offers " +
    "across Organizations (by_grantee_created or by_grantee_phase_created).",
  was: [`${OPS}/list-mine.ts:9`, `${CONVEX}:19`, `${ROWS}:92`, `${I}/views.ts:75`, `${I}/reads/streams.ts:34`],
  concept: concept_organizations,
  kind: "query",
  who: "A signed-in person; only offers to their own Party.",
  input: PageInput,
  output: InvitationPage,
  errors: [...CALL, ...DEFECTS, error_WRONG_STATE],
  reads: VIEW.reads,
  writes: [],
  drives: [],
  invokes: uniq([procedure_parties_find_party_by_email, ...VIEW.invokes]),
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

// ── public writes ───────────────────────────────────────────────────────────────────────────

export const rpc_organizations_invitations_invite = defineRpc({
  id: "organizations.invitations.invite",
  title: "Offer someone a place in the Organization, or replay the same request key",
  about:
    "Row `organizations.invitations.invite`, the public mutation `organizations/invitations:invite`. Signed in, a current " +
    "Admin. A request key that already made this offer replays it (a different request under the key, or a key a " +
    "Permission command took, is INVALID_INPUT). Else it ensures the grantee's Party by email (an Organization is " +
    "INVALID_INPUT), by Account or by @handle, then: with grants, Permissions' `createAuthorizingInvitation` births the " +
    "offer authorizing through the door together with its configure command; with none, a Seat-only offer is written " +
    "pending (seven days) and its email delivered in the same transaction. The grantee is admitted past the beta " +
    "waitlist, and org_invite_transitioned (sent) is scheduled. Returns the view.",
  was: [`${OPS}/invite.ts:13`, `${CONVEX}:17`, `${ROWS}:99`, `${I}/reads/invitations.ts:38`, `${I}/writes/offers.ts:33`, `${I}/writes/offers.ts:85`, `${I}/writes/offers.ts:121`, `${I}/events/offers.ts:37`],
  concept: concept_organizations,
  kind: "mutation",
  who: "A signed-in person with Manage people authority in the Organization.",
  input: Schema.Struct({ orgId: S, request: U }),
  output: InvitationView,
  errors: [...CALL, ...DEFECTS, ...ADMIN_ERRORS, error_WRONG_STATE],
  reads: VIEW.reads,
  writes: [table_org_invitations],
  drives: [machine_org_invitation.t.to_pending],
  invokes: uniq([
    ...ADMIN,
    procedure_permissions_read_configuration_collision,
    procedure_parties_ensure_party_by_email,
    procedure_parties_party_by_id,
    ...GRANTEE_RULE,
    procedure_permissions_create_authorizing_invitation,
    procedure_organizations_begin_authorizing_invitation_offer_in_tx,
    procedure_organizations_deliver_invitation_outcome,
    procedure_access_admit_invited_in_tx,
    ...VIEW.invokes,
  ]),
  emits: [event_org_invite_transitioned],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_organizations_invitations_accept = defineRpc({
  id: "organizations.invitations.accept",
  title: "The grantee consents to the exact offer they read",
  about:
    "Row `organizations.invitations.accept`, the public mutation `organizations/invitations:accept`. Signed in, the exact " +
    "grantee. A recorded consent replays when the digest matches (else WRONG_STATE). Else the offer must be acceptable " +
    "(pending, unexpired) and the digest the live offer's. A Seat-only offer becomes active and its Seat active in the " +
    "same transaction; any other becomes pending_grant, Permissions inserts its grant command and " +
    "`internal.permissions.grants.drive` is scheduled. Consent does not imply authority. org_invite_transitioned " +
    "(accepted) is scheduled.",
  was: [`${OPS}/accept.ts:14`, `${CONVEX}:7`, `${ROWS}:106`, `${I}/reads/invitations.ts:84`, `${I}/writes/consent.ts:23`, `${I}/writes/consent.ts:62`],
  concept: concept_organizations,
  kind: "mutation",
  who: "The signed-in exact grantee Party of the offer.",
  input: Schema.Struct({ orgId: S, invitationId: S, expectedOfferDigest: S }),
  output: InvitationView,
  errors: [...CALL, ...DEFECTS, error_ROLE_PERMISSION_DENIED, error_WRONG_STATE],
  reads: uniq([...VIEW.reads, table_org_members]),
  writes: [table_org_invitations, table_org_members],
  drives: [machine_org_invitation.t.to_pending_grant, machine_org_invitation.t.to_active, machine_org_member.t.to_active],
  invokes: uniq([
    ...GRANTEE,
    ...VIEW.invokes,
    procedure_permissions_insert_grant,
    procedure_organizations_apply_verified_invitation_member_in_tx,
  ]),
  emits: [event_org_invite_transitioned],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_organizations_invitations_decline = defineRpc({
  id: "organizations.invitations.decline",
  title: "The grantee turns the offer down",
  about:
    "Row `organizations.invitations.decline`, the public mutation `organizations/invitations:decline`. Signed in, the exact " +
    "grantee. `end(declined)`: a replay of the same ending returns the row (resuming a pending cleanup's drive); an active " +
    "or authorizing offer is WRONG_STATE; a Seat-only offer is declined and retired at once; a configured one inserts the " +
    "cleanup commands, becomes revoking (disable_pending) and schedules the disable's drive. Only the first decline " +
    "schedules org_invite_transitioned (declined).",
  was: [`${OPS}/decline.ts:14`, `${CONVEX}:9`, `${ROWS}:113`, `${I}/writes/endings.ts:44`, `${I}/writes/endings.ts:72`, `${I}/events/endings.ts:50`],
  concept: concept_organizations,
  kind: "mutation",
  who: "The signed-in exact grantee Party of the offer.",
  input: OneInvitation,
  output: InvitationView,
  errors: [...CALL, ...DEFECTS, error_ROLE_PERMISSION_DENIED, error_WRONG_STATE],
  reads: uniq([...ENDING.reads, ...VIEW.reads]),
  writes: ENDING.writes,
  drives: [
    machine_org_invitation.t.to_declined,
    machine_org_invitation.t.to_revoking,
    machine_org_invitation_cleanup.t.to_retired,
    machine_org_invitation_cleanup.t.to_disable_pending,
  ],
  invokes: uniq([...GRANTEE, ...ENDING.invokes, ...VIEW.invokes]),
  emits: [event_org_invite_transitioned],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_organizations_invitations_cancel = defineRpc({
  id: "organizations.invitations.cancel",
  title: "A current Admin withdraws the offer",
  about:
    "Row `organizations.invitations.cancel`, the public mutation `organizations/invitations:cancel`. Signed in, a current " +
    "Admin. `end(cancelled)`: as decline, and an authorizing offer cancels only when no Director proposal of its " +
    "configuration may still run and its configure command is provably unsigned (pending, unprepared or reverted, no " +
    "uncertain UserOperation attempt); anything else is WRONG_STATE (configuration uncertain). Only the first cancel " +
    "schedules org_invite_transitioned (cancelled).",
  was: [`${OPS}/cancel.ts:13`, `${CONVEX}:8`, `${ROWS}:120`, `${I}/writes/endings.ts:108`, `${I}/events/endings.ts:74`],
  concept: concept_organizations,
  kind: "mutation",
  who: "A signed-in person with Manage people authority in the Organization.",
  input: OneInvitation,
  output: InvitationView,
  errors: [...CALL, ...DEFECTS, ...ADMIN_ERRORS, error_WRONG_STATE],
  reads: uniq([...ENDING.reads, ...VIEW.reads]),
  writes: ENDING.writes,
  drives: [
    machine_org_invitation.t.to_cancelled,
    machine_org_invitation.t.to_revoking,
    machine_org_invitation_cleanup.t.to_retired,
    machine_org_invitation_cleanup.t.to_disable_pending,
  ],
  invokes: uniq([...ADMIN, ...ENDING.invokes, ...VIEW.invokes]),
  emits: [event_org_invite_transitioned],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_organizations_invitations_resend = defineRpc({
  id: "organizations.invitations.resend",
  title: "Send the offer email again, at most once per cooldown",
  about:
    "Row `organizations.invitations.resend`, the public mutation `organizations/invitations:resend`. Signed in, a current " +
    "Admin. The offer must be resendable: pending with a mailbox (else WRONG_STATE) and past the 60 s cooldown from its " +
    "last delivery attempt (else RATE_LIMITED with retryAfterMs). It marks delivery not_confirmed and hands one message " +
    "to the provider; a recorded attempt, sent or failed, schedules org_invite_transitioned (resent); a refused resend " +
    "reports nothing. Delivery never rolls back or repeats authority work.",
  was: [`${OPS}/resend.ts:14`, `${CONVEX}:21`, `${ROWS}:127`, `${I}/rules/offers.ts:111`, `${I}/external.ts:159`, `${I}/events/deliveries.ts:47`],
  concept: concept_organizations,
  kind: "mutation",
  who: "A signed-in person with Manage people authority in the Organization.",
  input: OneInvitation,
  output: InvitationView,
  errors: [...CALL, ...DEFECTS, ...ADMIN_ERRORS, error_WRONG_STATE, error_RATE_LIMITED],
  reads: VIEW.reads,
  writes: [table_org_invitations],
  drives: [machine_org_invitation_delivery.t.to_not_confirmed],
  invokes: uniq([...ADMIN, procedure_organizations_deliver_invitation_outcome, ...VIEW.invokes]),
  emits: [event_org_invite_transitioned],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_organizations_invitations_retry = defineRpc({
  id: "organizations.invitations.retry",
  title: "Re-check a submitted grant that has not been verified yet",
  about:
    "Row `organizations.invitations.retry`, the public mutation `organizations/invitations:retry`. Signed in, the grantee " +
    "or a current Admin. The offer must be pending_grant (else WRONG_STATE) with its grant command submitted (else " +
    "WRONG_STATE); it schedules `internal.permissions.grants.retry` for the grant command, which verifies the receipt. It " +
    "never prepares or signs another grant and writes nothing itself.",
  was: [`${OPS}/retry.ts:13`, `${CONVEX}:22`, `${ROWS}:134`, `${I}/writes/endings.ts:223`],
  concept: concept_organizations,
  kind: "mutation",
  who: "The signed-in grantee, or a person with Manage people authority in the Organization.",
  input: OneInvitation,
  output: InvitationView,
  errors: [...CALL, ...DEFECTS, ...ADMIN_ERRORS, error_WRONG_STATE],
  reads: VIEW.reads,
  writes: [],
  drives: [],
  invokes: uniq([...GRANTEE, ...ADMIN, procedure_permissions_read_invitation_verification_retry_state_in_tx, ...VIEW.invokes]),
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

// ── internal ────────────────────────────────────────────────────────────────────────────────

export const rpc_organizations_invitations_sweep = defineRpc({
  id: "organizations.invitations.sweep",
  title: "Expire pending members, then pending offers past their expiry",
  about:
    "Internal mutation, one transaction. The member half first: every pending membership past `expiresAt` (else " +
    "`updatedAt`) becomes expired. Then every pending offer whose `expiresAt` passed ends through `endInvitation` " +
    "(expired): a Seat-only one retires at once, a configured one starts disable-then-compensate. authorizing and " +
    "pending_grant offers are never touched. An uncertain configuration is skipped and returned; any other failure " +
    "aborts the whole sweep (Convex rolls it back).",
  was: [`${OPS}/sweep.ts:19`, `${CONVEX}:23`, `${O}/members/writes/advances.ts:85`, `${I}/writes/endings.ts:175`, `${I}/writes/endings.ts:200`],
  concept: concept_organizations,
  kind: "mutation",
  who: "internal: the organizations.invitations.expire workflow.",
  input: Schema.Struct({ now: N }),
  output: Schema.Struct({
    expired: N,
    members: Schema.Array(U),
    invitationsExpired: Schema.Array(Schema.Struct({ invitationId: S, orgId: S })),
    invitationsSkipped: Schema.Array(Schema.Struct({ invitationId: S, orgId: S })),
  }),
  errors: [error_UNKNOWN, error_WRONG_STATE, error_ENV_MISSING, error_INVALID_INPUT],
  reads: uniq([table_org_members, table_orgs, ...ENDING.reads]),
  writes: [table_org_members, table_org_invitations],
  drives: [
    machine_org_member.t.to_expired,
    machine_org_invitation.t.to_expired,
    machine_org_invitation.t.to_revoking,
    machine_org_invitation_cleanup.t.to_retired,
    machine_org_invitation_cleanup.t.to_disable_pending,
  ],
  invokes: ENDING.invokes,
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

const emitAbout = (name: string, transition: string, by: string) =>
  `Telemetry plumbing: the internal action \`organizations/invitations:${name}\`, scheduled by ${by} after it commits; posts ` +
  `org_invite_transitioned (${transition}) under the person and verified Organization the snapshot names ` +
  `(\`invitationAttribution\`). Reads and writes no table.`;

const EmitBase = {
  authUserId: S,
  organizationId: S,
  invitationId: S,
  generation: S,
  commandId: S,
  subjectPartyId: S,
  observationContext: Schema.optionalKey(U),
};

export const rpc_organizations_invitations_emit_sent = defineRpc({
  id: "organizations.invitations.emit-sent",
  title: "Deliver org_invite_transitioned (sent)",
  about: emitAbout("emitSent", "sent", "organizations.invitations.invite"),
  was: [`${OPS}/emit-sent.ts:10`, `${CONVEX}:14`, `${I}/events/offers.ts:90`],
  concept: concept_organizations,
  kind: "action",
  who: "internal: scheduled by organizations.invitations.invite.",
  input: Schema.Struct({ ...EmitBase, occurredAt: N }),
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

export const rpc_organizations_invitations_emit_accepted = defineRpc({
  id: "organizations.invitations.emit-accepted",
  title: "Deliver org_invite_transitioned (accepted)",
  about: emitAbout("emitAccepted", "accepted", "organizations.invitations.accept"),
  was: [`${OPS}/emit-accepted.ts:13`, `${CONVEX}:10`, `${I}/events/offers.ts:113`],
  concept: concept_organizations,
  kind: "action",
  who: "internal: scheduled by organizations.invitations.accept.",
  input: Schema.Struct({ ...EmitBase, acceptedAt: N }),
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

export const rpc_organizations_invitations_emit_declined = defineRpc({
  id: "organizations.invitations.emit-declined",
  title: "Deliver org_invite_transitioned (declined)",
  about: emitAbout("emitDeclined", "declined", "the first organizations.invitations.decline"),
  was: [`${OPS}/emit-declined.ts:10`, `${CONVEX}:12`, `${I}/events/endings.ts:104`],
  concept: concept_organizations,
  kind: "action",
  who: "internal: scheduled by organizations.invitations.decline.",
  input: Schema.Struct({ ...EmitBase, declinedAt: N }),
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

export const rpc_organizations_invitations_emit_cancelled = defineRpc({
  id: "organizations.invitations.emit-cancelled",
  title: "Deliver org_invite_transitioned (cancelled)",
  about: emitAbout("emitCancelled", "cancelled", "the first organizations.invitations.cancel"),
  was: [`${OPS}/emit-cancelled.ts:10`, `${CONVEX}:11`, `${I}/events/endings.ts:125`],
  concept: concept_organizations,
  kind: "action",
  who: "internal: scheduled by organizations.invitations.cancel.",
  input: Schema.Struct({ ...EmitBase, cancelledAt: N }),
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

export const rpc_organizations_invitations_emit_resent = defineRpc({
  id: "organizations.invitations.emit-resent",
  title: "Deliver org_invite_transitioned (resent)",
  about: emitAbout("emitResent", "resent", "organizations.invitations.resend for one recorded delivery attempt"),
  was: [`${OPS}/emit-resent.ts:10`, `${CONVEX}:13`, `${I}/events/deliveries.ts:86`],
  concept: concept_organizations,
  kind: "action",
  who: "internal: scheduled by organizations.invitations.resend.",
  input: Schema.Struct({ ...EmitBase, attemptedAt: N, delivery: Schema.Literals(["sent", "failed"]) }),
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

// ── workflow ────────────────────────────────────────────────────────────────────────────────

export const workflow_organizations_invitations_expire = defineWorkflow({
  id: "organizations.invitations.expire",
  title: "Expire pending org invitations, daily",
  about:
    "The internal action `organizations/invitations:expire`, the cron `expire pending org invitations` daily at 00:00 UTC " +
    "(`crons.daily`), with the argument systemJob `expire_pending_org_invitations`. It runs as that system job with no " +
    "person behind it, runs organizations.invitations.sweep at the business time, and reports what the sweep expired: " +
    "one org_invite_transitioned (expired) per expired offer, and the skipped ones. Returns the expired and skipped " +
    "counts. Timeout is Convex's action limit; the code sets none.",
  was: [`${OPS}/expire.ts:24`, `${CONVEX}:15`, "packages/backend/src/platform/jobs.ts:81", `${I}/events/expiry.ts:38`],
  concept: concept_organizations,
  priority: "normal",
  trigger: { cron: "0 0 * * *" },
  instance: "singleton",
  steps: [
    { name: "attribute", about: "Runs as the system job `expire_pending_org_invitations`." },
    { name: "sweep", about: "organizations.invitations.sweep in one transaction: members, then offers." },
    { name: "report", about: "`invitationsExpired`: org_invite_transitioned (expired) per offer, and the skipped uncertain ones." },
  ],
  reads: uniq([table_org_members, table_orgs, ...ENDING.reads]),
  writes: [table_org_members, table_org_invitations],
  drives: [
    machine_org_member.t.to_expired,
    machine_org_invitation.t.to_expired,
    machine_org_invitation.t.to_revoking,
    machine_org_invitation_cleanup.t.to_retired,
    machine_org_invitation_cleanup.t.to_disable_pending,
  ],
  invokes: ENDING.invokes,
  emits: [event_org_invite_transitioned],
  calls: [],
  chain: [],
  idempotency: "An expired offer leaves the pending phase, so a second run finds only offers still pending; a revoking offer's replay adds no transition.",
  timeoutMs: 600_000,
  retries: { max: 0, backoff: "none" },
});
