// The old book's Governance area, as it is: one operation record for each of the 43 operations that
// apps/docs/factory/areas/governance.yaml lists (Directors, proposals, the Board, votes, members,
// invitations and allowances), read from /home/user/factory (branch integration/factory). The text
// (title, about, who, changes, notes, mistakes, acceptance and each refusal's `when`) is the frozen
// book's, spread from ../../frozen, never retyped. The one exception is vote.delegate's `about`,
// which says the operation was never built (the old book wrote none).
//
// implementedBy is what the CLI command reaches: the SDK flow when the SDK method the command calls
// composes several calls (a poll loop counts) or is booked as a flow for its own local work (a check of
// what the backend opened: `board.prepareHandOver`, `me.votes.prepareCast`), else the one public rpc it reaches. Most governance
// commands call a `prepare…` or read method that forwards one row, then the CLI itself follows the
// approval page (payment/internal/approval.ts:159, `client.approvals.wait`) and polls the change to
// the chain; that following is the CLI's, not the SDK method's, so those operations name the one rpc.
// Where the CLI's SDK method is not the one the page names (`sdk:`), the comment on the operation says
// so. Rpcs are named by their protocol row and owned by the backend area file (../organizations/
// proposals.ts, directors.ts, votes.ts, members.ts, invitations.ts; ../permissions/allowances.ts);
// flows by their SDK method (../organizations/flows.ts and flows-governance.ts for packages/sdk/src/organizations/,
// ../permissions/flows.ts for packages/sdk/src/permissions/, ../payments/flows.ts for
// `client.approvals.prepare`).
//
// returns is what the command prints with `--json` (its envelope's `data`), typed from the protocol
// row (packages/protocol/src/organizations/*-schema.ts, permissions/allowance-schema.ts) and the CLI
// code that shapes it. Many commands print one of two shapes: the open approval (with `--no-wait`, or
// an agent's `--json`) or the result once followed to the chain; returns is then the Union of both.
// Where the page lists other fields than the CLI prints, the comment says so: that gap is a finding.
//
// errors is what the CLI command produces itself: CLI_USAGE (input and scope refusals), the
// ROLE_PERMISSION_DENIED of an Organization not in your list (proposal/internal/scope.ts:41 →
// org/internal/lifecycle.ts:17), and for commands that follow an approval WRONG_STATE (expired or not
// sent), CANCELLED (rejected on the page) and CLI_DEADLINE (still waiting). The session restore's
// NOT_AUTHENTICATED is shared by every signed-in command and left out, as ../payments/operations.ts
// leaves it out.
//
// A refusal's `given` names a saved devnet world (packages/scenarios: after-s1 at s1.20, after-s2 at
// s2.20, after-s15 at s15.10) from which a scenario step's command line, run by the same person,
// reaches the code for a cause the `when` describes, checked against the backend's refusal order. `?`
// where no step does; the comment names the nearest step when one reaches the code only after a
// later step, by another cause, or on the SDK surface alone. No budget: nothing measured these
// commands. Priority is `normal` throughout: the old book ranks no operation.

import { Schema } from "effect";
import { defineOperation, type Ref } from "../../../packages/book/src/index.ts";
import { frozenClaims, frozenRefusals, frozenText, type FrozenId } from "../../frozen/index.ts";
import {
  error_BELOW_THRESHOLD,
  error_CANCELLED,
  error_CAPABILITY_UNAVAILABLE,
  error_CLI_DEADLINE,
  error_CLI_DEFECT,
  error_CLI_USAGE,
  error_FEATURE_NOT_AVAILABLE,
  error_INVALID_INPUT,
  error_NETWORK_ERROR,
  error_NOT_AUTHENTICATED,
  error_RATE_LIMITED,
  error_ROLE_CONFLICT,
  error_ROLE_PERMISSION_DENIED,
  error_WRONG_STATE,
} from "../shared/vocabulary.ts";
import {
  rpc_organizations_proposals_change_owners,
  rpc_organizations_proposals_get,
  rpc_organizations_proposals_list,
  rpc_organizations_proposals_reject,
  rpc_organizations_proposals_request_approval,
  rpc_organizations_proposals_safe,
} from "../organizations/proposals.ts";
import {
  rpc_organizations_directors_add,
  rpc_organizations_directors_claim,
  rpc_organizations_directors_refresh,
  rpc_organizations_directors_remove,
  rpc_organizations_directors_set_threshold,
} from "../organizations/directors.ts";
import {
  rpc_organizations_votes_create,
  rpc_organizations_votes_get,
  rpc_organizations_votes_list,
  rpc_organizations_votes_mine,
} from "../organizations/votes.ts";
import {
  rpc_organizations_members_grant,
  rpc_organizations_members_list,
  rpc_organizations_members_revoke,
} from "../organizations/members.ts";
import {
  rpc_organizations_invitations_accept,
  rpc_organizations_invitations_cancel,
  rpc_organizations_invitations_decline,
  rpc_organizations_invitations_list,
  rpc_organizations_invitations_list_mine,
  rpc_organizations_invitations_resend,
} from "../organizations/invitations.ts";
import { flow_client_org_invitations_propose } from "../organizations/flows.ts";
import {
  flow_client_me_votes_prepare_cast,
  flow_client_org_board_prepare_hand_over,
  flow_client_org_proposals_wait,
  flow_client_org_votes_prepare_execute,
  flow_client_org_votes_wait,
} from "../organizations/flows-governance.ts";
import { rpc_permissions_allowances_list } from "../permissions/allowances.ts";
import {
  flow_client_org_allowances_assign,
  flow_client_org_allowances_change,
  flow_client_org_allowances_create,
  flow_client_org_allowances_revoke,
} from "../permissions/flows.ts";
import { flow_client_approvals_prepare } from "../payments/flows.ts";

// ── how a page's refusals become records ─────────────────────────────────────────────────────

/** The page's refusals in its order, `when` verbatim; `mapped[i]` is the i-th one's error and world. */
const refusalsOf = (id: FrozenId, mapped: readonly (readonly [error: Ref<"error">, given: string])[]) => {
  const frozen = frozenRefusals(id);
  if (frozen.length !== mapped.length) throw new Error(`${id}: ${frozen.length} refusals, ${mapped.length} mapped`);
  return frozen.map(({ code, when }, i) => {
    const [error, given] = mapped[i]!;
    if (error.id !== code) throw new Error(`${id}: refusal ${i + 1} is ${code}, mapped to ${error.id}`);
    return { error, given, when };
  });
};

const book = (id: string) => `apps/docs/factory/operations/${id}.yaml:1`;
const CLI = "apps/cli/src/commands";
const ORG = `${CLI}/org/subcommands`;
const INVITE = `${CLI}/org-invite`;
const SDK = "packages/sdk/src";
const ROWS = "packages/protocol/src";
const BACK = "packages/backend/src";
const SCN = "packages/scenarios/src/acme";

/** The Organization scope the director, proposal, board, vote and member-permission commands resolve. */
const SCOPE_WAS = [
  `${ORG}/proposal/internal/scope.ts:15`,
  `${ORG}/proposal/internal/scope.ts:41`,
  `${CLI}/org/internal/lifecycle.ts:17`,
  `${ORG}/allowance/internal/scope.ts:16`,
  "apps/cli/src/auth/actor.ts:59",
  "apps/cli/src/auth/input.ts:28",
];

/** The CLI following an approval it handed over: rejected, expired, still waiting. */
const FOLLOW_WAS = [
  `${CLI}/payment/internal/approval.ts:159`,
  `${CLI}/payment/internal/approval.ts:100`,
  `${CLI}/payment/internal/approval.ts:109`,
  `${CLI}/payment/internal/approval.ts:118`,
];

/** A Director's approval of a proposal through the approval page (proposal/internal/approval.ts). */
const PROPOSAL_APPROVAL_WAS = [
  `${ORG}/proposal/internal/approval.ts:98`,
  `${ORG}/proposal/internal/approval.ts:127`,
  `${ORG}/proposal/internal/approval.ts:133`,
  `${ORG}/proposal/internal/approval.ts:197`,
  `${ORG}/proposal/internal/approval.ts:59`,
];

/** A Board change handed over and followed until the chain shows it (board/internal/seat.ts). */
const SEAT_WAS = [`${ORG}/board/internal/seat.ts:52`, `${ORG}/board/internal/seat.ts:64`];

/** The scope refusals and, for a command that follows an approval, the follow's own. */
const SCOPE_ERRORS = [error_CLI_USAGE, error_ROLE_PERMISSION_DENIED];
const FOLLOW_ERRORS = [error_CLI_USAGE, error_ROLE_PERMISSION_DENIED, error_WRONG_STATE, error_CANCELLED, error_CLI_DEADLINE];

// ── what the governance rows answer, transcribed ─────────────────────────────────────────────
// Branded strings and refined numbers are plain here. A Budget policy (permissions/permission-schema.ts
// BudgetIntentSchema) is too deep to transcribe and is Schema.Unknown where an offer carries it.

const Next = Schema.Struct({ argv: Schema.Array(Schema.String) });
const SafeCall = Schema.Struct({ to: Schema.String, value: Schema.String, data: Schema.String });

/** organizations/proposal-schema.ts:29; statuses organizations/model.ts:28. */
const SafeProposal = Schema.Struct({
  proposalId: Schema.String,
  orgId: Schema.String,
  chainId: Schema.Number,
  safeAddress: Schema.String,
  nonce: Schema.NullOr(Schema.Number),
  safeTxHash: Schema.String,
  kind: Schema.Literals(["transaction", "rejection", "scheduled_payment"]),
  rejects: Schema.NullOr(Schema.String),
  transaction: Schema.Struct({
    to: Schema.String,
    value: Schema.String,
    data: Schema.String,
    operation: Schema.Literals(["call", "delegatecall"]),
  }),
  calls: Schema.Array(SafeCall),
  note: Schema.NullOr(Schema.String),
  proposer: Schema.String,
  status: Schema.Literals(["awaiting_approvals", "executed", "rejected", "replaced"]),
  threshold: Schema.Number,
  approvals: Schema.Array(Schema.Struct({ owner: Schema.String, state: Schema.Literals(["approved", "sent"]) })),
  executionUserOpHash: Schema.NullOr(Schema.String),
  payment: Schema.optionalKey(Schema.Struct({ id: Schema.String, sendsAt: Schema.Number })),
  createdAt: Schema.Number,
});

/** organizations/proposal-schema.ts:179 (SafeOwnerSchema :169). */
const SafeOverview = Schema.Struct({
  orgId: Schema.String,
  chainId: Schema.Number,
  safeAddress: Schema.String,
  threshold: Schema.Number,
  nonce: Schema.Number,
  owners: Schema.Array(
    Schema.Struct({
      address: Schema.String,
      label: Schema.NullOr(Schema.String),
      isCaller: Schema.Boolean,
      signer: Schema.Boolean,
    }),
  ),
  waiting: Schema.Number,
});

/** organizations/proposal-schema.ts:117 and :126. */
const OwnerChangePerson = Schema.Struct({
  name: Schema.NullOr(Schema.String),
  email: Schema.NullOr(Schema.String),
  safe: Schema.String,
});
const OwnerCount = Schema.Struct({ owners: Schema.Number, threshold: Schema.Number });
const OwnerChange = Schema.Struct({
  action: Schema.Literals(["add", "remove", "replace", "threshold"]),
  person: Schema.NullOr(OwnerChangePerson),
  replacement: Schema.NullOr(OwnerChangePerson),
  before: OwnerCount,
  after: OwnerCount,
});

/** A Director's approval handed over (proposal/internal/approval.ts:133) or followed until it landed (:197). */
const PROPOSAL_AWAITING = {
  status: Schema.Literal("awaiting_approval"),
  approvalId: Schema.String,
  approvalUrl: Schema.String,
  expiresAt: Schema.Number,
  proposal: SafeProposal,
  next: Next,
};
const PROPOSAL_LANDED = {
  status: SafeProposal.fields.status,
  approvalId: Schema.String,
  proposal: SafeProposal,
};
const ProposalHandOver = Schema.Union([Schema.Struct(PROPOSAL_AWAITING), Schema.Struct(PROPOSAL_LANDED)]);

/** A Director change, proposed then approved (director/internal/change.ts:86): `next` names `director list` once executed. */
const DirectorChangeHandOver = Schema.Union([
  Schema.Struct({ ...PROPOSAL_AWAITING, change: OwnerChange }),
  Schema.Struct({ ...PROPOSAL_LANDED, change: OwnerChange, next: Schema.optionalKey(Next) }),
]);

/** How many Directors must sign, of how many (organizations/director-schema.ts:101). */
const BoardThreshold = Schema.Struct({ needed: Schema.Number, of: Schema.Number });

/** A Board change handed over with `--no-wait` (board/internal/seat.ts:64). */
const BoardAwaiting = Schema.Struct({
  status: Schema.Literal("awaiting_approval"),
  changeId: Schema.String,
  approvalId: Schema.String,
  approvalUrl: Schema.String,
  expiresAt: Schema.Number,
  directors: Schema.Struct({ before: Schema.Number, after: Schema.Number }),
  threshold: BoardThreshold,
  person: Schema.NullOr(OwnerChangePerson),
  next: Next,
});

/** organizations/vote-schema.ts:73 and :82; statuses :55. */
const VoteTally = Schema.Struct({ for: Schema.Number, against: Schema.Number, abstain: Schema.Number });
const Vote = Schema.Struct({
  voteId: Schema.String,
  orgId: Schema.String,
  chainId: Schema.Number,
  governor: Schema.String,
  proposalId: Schema.String,
  matter: Schema.Literals(["authorise"]),
  title: Schema.String,
  description: Schema.String,
  status: Schema.Literals([
    "awaiting_approval",
    "sent",
    "pending",
    "active",
    "canceled",
    "defeated",
    "succeeded",
    "queued",
    "expired",
    "executed",
    "failed",
    "lapsed",
  ]),
  proposer: Schema.String,
  calls: Schema.Array(SafeCall),
  opensAt: Schema.NullOr(Schema.Number),
  closesAt: Schema.NullOr(Schema.Number),
  quorum: Schema.Number,
  tally: Schema.NullOr(VoteTally),
  quorumReached: Schema.NullOr(Schema.Boolean),
  approvalId: Schema.String,
  userOpHash: Schema.NullOr(Schema.String),
  createdAt: Schema.Number,
});

/** organizations/vote-schema.ts:125. */
const MyVote = Schema.Struct({
  voteId: Schema.String,
  orgId: Schema.String,
  org: Schema.String,
  title: Schema.String,
  status: Schema.Literals(["pending", "active"]),
  opensAt: Schema.NullOr(Schema.Number),
  closesAt: Schema.NullOr(Schema.Number),
  weight: Schema.Number,
  voted: Schema.Boolean,
});

/** The approval fields a vote, an execution or a ballot hands over (vote/internal/hand-over.ts:60, cast/execute.ts:86). */
const VOTE_APPROVAL = {
  approvalId: Schema.String,
  approvalUrl: Schema.String,
  expiresAt: Schema.Number,
  next: Next,
};

/** organizations/model.ts:82. */
const SeatPermission = Schema.Literals(["manage-books", "issue-invoices", "manage-people"]);

/** A member as the SDK maps the row (sdk organizations/records.ts:129, member-views.ts:88; row schema.ts:120). */
const Member = Schema.Struct({
  memberId: Schema.String,
  orgId: Schema.String,
  accountId: Schema.NullOr(Schema.String),
  email: Schema.String,
  name: Schema.NullOr(Schema.String),
  personalSafeAddress: Schema.NullOr(Schema.String),
  role: Schema.String,
  roleKey: Schema.NullOr(Schema.String),
  status: Schema.Literals(["pending", "pending_safe", "pending_grant", "active", "revoked", "expired"]),
  grantTxHash: Schema.NullOr(Schema.String),
  revokeTxHash: Schema.NullOr(Schema.String),
  kind: Schema.Literals(["human", "ai"]),
  permissions: Schema.Array(SeatPermission),
});

/** organizations/seat-permission-schema.ts:26; printed beside the proposal (member/internal/permission.ts:79). */
const SeatPermissionChange = Schema.Struct({
  changeId: Schema.String,
  change: Schema.Literals(["grant", "revoke"]),
  permission: SeatPermission,
  email: Schema.String,
  name: Schema.NullOr(Schema.String),
  state: Schema.Literals(["proposed", "applied", "ended"]),
});
const SeatPermissionHandOver = Schema.Union([
  Schema.Struct({ ...PROPOSAL_AWAITING, change: SeatPermissionChange }),
  Schema.Struct({ ...PROPOSAL_LANDED, change: SeatPermissionChange, next: Schema.optionalKey(Next) }),
]);

/** An offered authority (organizations/invitation-schema.ts:120); its Budget policy is Unknown. */
const OfferedAuthority = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("budget"),
    budgetId: Schema.String,
    label: Schema.String,
    policy: Schema.Unknown,
    policyDigest: Schema.String,
  }),
  Schema.Struct({ type: Schema.Literal("managePeople"), permissionId: Schema.String, label: Schema.String }),
]);

/** organizations/invitation-schema.ts:197; phases organizations/model.ts:65; offers :120. */
const InvitationView = Schema.Struct({
  id: Schema.String,
  orgId: Schema.String,
  organizationName: Schema.String,
  grantee: Schema.Struct({
    partyId: Schema.String,
    accountId: Schema.NullOr(Schema.String),
    safeAddress: Schema.String,
    accountReady: Schema.NullOr(Schema.Boolean),
    kind: Schema.Literals(["human", "agent"]),
    handle: Schema.NullOr(Schema.String),
  }),
  phase: Schema.Literals([
    "authorizing",
    "pending",
    "pending_grant",
    "active",
    "revoking",
    "declined",
    "cancelled",
    "expired",
    "revoked",
  ]),
  grants: Schema.Array(
    Schema.Union([
      Schema.Struct({ type: Schema.Literal("budget"), budgetId: Schema.String }),
      Schema.Struct({ type: Schema.Literal("managePeople"), permissionId: Schema.String }),
    ]),
  ),
  offers: Schema.Array(OfferedAuthority),
  recovery: Schema.NullOr(
    Schema.Struct({
      actor: Schema.Literals(["system", "invitee", "admin"]),
      action: Schema.Literals(["wait", "retry", "review_offer", "reauthorize"]),
      reason: Schema.Literals([
        "configuration_pending",
        "grant_pending",
        "provider_unavailable",
        "policy_changed",
        "cleanup_pending",
        "signer_unavailable",
      ]),
    }),
  ),
  recoveryActions: Schema.optionalKey(
    Schema.Array(Schema.Struct({ action: Schema.Literals(["resend", "retry"]), notBefore: Schema.Number })),
  ),
  offerDigest: Schema.String,
  authorizedAt: Schema.NullOr(Schema.Number),
  acceptedAt: Schema.NullOr(Schema.Number),
  expiresAt: Schema.NullOr(Schema.Number),
  commandId: Schema.NullOr(Schema.String),
  endingReason: Schema.NullOr(Schema.Literals(["declined", "cancelled", "expired", "revoked"])),
  delivery: Schema.Literals(["not_confirmed", "sent", "failed", "none"]),
});

/** What `--preview` prints (organizations/invitation-schema.ts:153, grantee :146, a new Budget offer :139). */
const InvitePreview = Schema.Struct({
  orgId: Schema.String,
  grantee: Schema.Struct({
    partyId: Schema.NullOr(Schema.String),
    accountId: Schema.NullOr(Schema.String),
    safeAddress: Schema.String,
    accountReady: Schema.NullOr(Schema.Boolean),
  }),
  grants: Schema.Array(
    Schema.Union([
      OfferedAuthority,
      Schema.Struct({
        type: Schema.Literal("new_budget"),
        label: Schema.String,
        policy: Schema.Unknown,
        policyDigest: Schema.String,
      }),
    ]),
  ),
  existingAssignments: Schema.Array(Schema.String),
  includesManagement: Schema.Boolean,
  observedAt: Schema.Number,
});

/** organizations/invitation-schema.ts:246. */
const InvitationPage = Schema.Struct({
  items: Schema.Array(InvitationView),
  nextCursor: Schema.NullOr(Schema.String),
  observedAt: Schema.Number,
});

/** permissions/allowance-schema.ts:61, :116, :156, :202 and :210: a v4 allowance, a budget under a hat. */
const AllowanceMember = Schema.Struct({ email: Schema.String, label: Schema.String, safe: Schema.String });
const Allowance = Schema.Struct({
  allowanceId: Schema.String,
  requestKey: Schema.String,
  name: Schema.String,
  token: Schema.String,
  asset: Schema.String,
  amount: Schema.String,
  period: Schema.Literals(["month", "quarter", "year"]),
  parentBudgetId: Schema.String,
  budgetId: Schema.NullOr(Schema.String),
  hat: Schema.String,
  holder: Schema.NullOr(AllowanceMember),
  status: Schema.Literals(["pending", "active", "abandoned"]),
  proposalId: Schema.String,
});
const ListedAllowance = Schema.Struct({
  ...Allowance.fields,
  left: Schema.NullOr(Schema.String),
  wearers: Schema.Array(AllowanceMember),
});
const AllowanceCommand = Schema.Struct({
  commandId: Schema.String,
  requestKey: Schema.String,
  allowanceId: Schema.String,
  operation: Schema.Literals(["change", "assign", "revoke"]),
  status: Schema.Literals(["pending", "applied", "abandoned"]),
  amount: Schema.NullOr(Schema.String),
  member: Schema.NullOr(AllowanceMember),
  proposalId: Schema.String,
});

/**
 * What a v4 allowance write prints (allowance/internal/v4-create.ts:121, v4-commands.ts:155): the
 * proposer's approval id when one opened, the proposal as it landed (proposal/internal/approval.ts:197,
 * or as proposed when no approval opened), the request key and the allowance; `--wait` re-reads both.
 */
const ALLOWANCE_WRITE = {
  approvalId: Schema.optionalKey(Schema.String),
  status: SafeProposal.fields.status,
  proposal: SafeProposal,
  requestKey: Schema.String,
  allowance: Allowance,
};

// ═══ Directors ═══════════════════════════════════════════════════════════════════════════════
// `org director …` (apps/cli/src/commands/org/subcommands/director/) is the pre-v4 Director surface: a
// change is a proposal from the Organization's own Safe. Each change command reads the Directors first
// (`directors.get`, organizations.proposals.safe), refuses on its own a change that leaves one Director
// acting alone or removes yourself without `--confirm` (director/internal/change.ts:34), then calls one
// `client.org(orgId).directors.*` method, which forwards organizations.proposals.changeOwners
// (sdk organizations/owners.ts:67), and hands the proposal to the approval page (change.ts:67).
// As is, every Organization on the devnet is a v4 company, and the backend refuses each change on one
// with WRONG_STATE (`currentState` `v4_company`) once membership (readContext, ROLE_PERMISSION_DENIED) and
// the owner-safe-proposals feature pass, before it checks that you are a Director or whom the change names
// (backend organizations/proposals/operations/change-owners.ts:32, :33, :36, errors.ts:112). S33 shows it from after-s2
// (s33.2 to s33.5). No page's WRONG_STATE `when` names that cause, so every Director-change refusal
// below is `?`: the Director, membership and threshold checks the pages describe are unreachable on a
// v4 company.

const DIRECTOR_CHANGE_WAS = [
  `${ORG}/director/internal/change.ts:34`,
  `${ORG}/director/internal/change.ts:59`,
  `${ORG}/director/internal/change.ts:67`,
  `${ORG}/director/internal/change.ts:86`,
  `${SDK}/organizations/owners.ts:67`,
  `${ROWS}/organizations/proposal-operations.ts:54`,
  `${ROWS}/organizations/proposal-schema.ts:126`,
  `${BACK}/organizations/proposals/operations/change-owners.ts:36`,
  `${SCN}/s33-old-director-commands-on-v4.scenario.ts:84`,
];

// `directors.get` (sdk owners.ts:80) forwards organizations.proposals.safe; the CLI prints its answer.
export const operation_org_director_list = defineOperation({
  ...frozenText("org.director.list"),
  was: [
    book("org.director.list"),
    `${ORG}/director/subcommands/list/command.ts:5`,
    `${ORG}/director/subcommands/list/execute.ts:13`,
    `${ORG}/proposal/internal/approval.ts:50`,
    `${SDK}/organizations/owners.ts:80`,
    `${ROWS}/organizations/proposal-operations.ts:127`,
    `${ROWS}/organizations/proposal-schema.ts:179`,
    ...SCOPE_WAS,
  ],
  priority: "normal",
  implementedBy: rpc_organizations_proposals_safe,
  acceptance: frozenClaims("org.director.list"),
  returns: SafeOverview,
  errors: SCOPE_ERRORS,
  refusals: refusalsOf("org.director.list", [
    [error_WRONG_STATE, "?"],
    // The CLI refuses an `--org` that names an Organization you are not in with CLI_USAGE (auth/actor.ts:59)
    // before any read; ROLE_PERMISSION_DENIED reaches the CLI only for a saved or ID-named Organization not in
    // your list (scope.ts:41). No step does either for this command.
    [error_ROLE_PERMISSION_DENIED, "?"],
    [error_NOT_AUTHENTICATED, "?"],
  ]),
});

// `directors.add` (sdk owners.ts:88). Before any call the CLI refuses on its own, with CLI_USAGE, a change that
// lets one Director act alone without `--confirm` (add/execute.ts:22, change.ts:34). The page lists the proposal's fields at the top level; the CLI prints
// them under `proposal`, beside `change`, the approval and the follow-up command.
export const operation_org_director_add = defineOperation({
  ...frozenText("org.director.add"),
  was: [
    book("org.director.add"),
    `${ORG}/director/subcommands/add/command.ts:24`,
    `${ORG}/director/subcommands/add/execute.ts:33`,
    `${SDK}/organizations/owners.ts:88`,
    `${SCN}/s33-old-director-commands-on-v4.scenario.ts:157`,
    ...DIRECTOR_CHANGE_WAS,
    ...PROPOSAL_APPROVAL_WAS,
    ...FOLLOW_WAS,
    ...SCOPE_WAS,
  ],
  priority: "normal",
  implementedBy: rpc_organizations_proposals_change_owners,
  acceptance: frozenClaims("org.director.add"),
  returns: DirectorChangeHandOver,
  errors: FOLLOW_ERRORS,
  refusals: refusalsOf("org.director.add", [
    [error_ROLE_PERMISSION_DENIED, "?"],
    [error_INVALID_INPUT, "?"],
    // s33.2 (s33:157) reaches WRONG_STATE from after-s2 by `v4_company`, which this `when` does not describe.
    [error_WRONG_STATE, "?"],
    [error_NOT_AUTHENTICATED, "?"],
  ]),
});

// `directors.remove` (sdk owners.ts:94). Before any call the CLI refuses on its own, with CLI_USAGE, a removal
// that leaves fewer Directors than the threshold without `--threshold` (remove/execute.ts:25).
export const operation_org_director_remove = defineOperation({
  ...frozenText("org.director.remove"),
  was: [
    book("org.director.remove"),
    `${ORG}/director/subcommands/remove/command.ts:26`,
    `${ORG}/director/subcommands/remove/execute.ts:25`,
    `${ORG}/director/subcommands/remove/execute.ts:33`,
    `${SDK}/organizations/owners.ts:94`,
    `${SCN}/s33-old-director-commands-on-v4.scenario.ts:185`,
    ...DIRECTOR_CHANGE_WAS,
    ...PROPOSAL_APPROVAL_WAS,
    ...FOLLOW_WAS,
    ...SCOPE_WAS,
  ],
  priority: "normal",
  implementedBy: rpc_organizations_proposals_change_owners,
  acceptance: frozenClaims("org.director.remove"),
  returns: DirectorChangeHandOver,
  errors: FOLLOW_ERRORS,
  refusals: refusalsOf("org.director.remove", [
    [error_ROLE_PERMISSION_DENIED, "?"],
    [error_INVALID_INPUT, "?"],
    // s33.4 (s33:185) reaches WRONG_STATE from after-s2 by `v4_company`, which this `when` does not describe.
    [error_WRONG_STATE, "?"],
    [error_NOT_AUTHENTICATED, "?"],
  ]),
});

// `directors.replace` (sdk owners.ts:100).
export const operation_org_director_replace = defineOperation({
  ...frozenText("org.director.replace"),
  was: [
    book("org.director.replace"),
    `${ORG}/director/subcommands/replace/command.ts:23`,
    `${ORG}/director/subcommands/replace/execute.ts:23`,
    `${SDK}/organizations/owners.ts:100`,
    `${SCN}/s33-old-director-commands-on-v4.scenario.ts:171`,
    ...DIRECTOR_CHANGE_WAS,
    ...PROPOSAL_APPROVAL_WAS,
    ...FOLLOW_WAS,
    ...SCOPE_WAS,
  ],
  priority: "normal",
  implementedBy: rpc_organizations_proposals_change_owners,
  acceptance: frozenClaims("org.director.replace"),
  returns: DirectorChangeHandOver,
  errors: FOLLOW_ERRORS,
  refusals: refusalsOf("org.director.replace", [
    [error_ROLE_PERMISSION_DENIED, "?"],
    [error_INVALID_INPUT, "?"],
    // s33.3 (s33:171) reaches WRONG_STATE from after-s2 by `v4_company`, which this `when` does not describe.
    [error_WRONG_STATE, "?"],
    [error_NOT_AUTHENTICATED, "?"],
  ]),
});

// `directors.setThreshold` (sdk owners.ts:106). The v4 design moves this to `org.board.setThreshold`
// (`org board threshold`, below); the old command stays and is refused on every v4 company.
export const operation_org_director_threshold = defineOperation({
  ...frozenText("org.director.threshold"),
  was: [
    book("org.director.threshold"),
    `${ORG}/director/subcommands/threshold/command.ts:23`,
    `${ORG}/director/subcommands/threshold/execute.ts:26`,
    `${SDK}/organizations/owners.ts:106`,
    `${SCN}/s33-old-director-commands-on-v4.scenario.ts:199`,
    ...DIRECTOR_CHANGE_WAS,
    ...PROPOSAL_APPROVAL_WAS,
    ...FOLLOW_WAS,
    ...SCOPE_WAS,
  ],
  priority: "normal",
  implementedBy: rpc_organizations_proposals_change_owners,
  acceptance: frozenClaims("org.director.threshold"),
  returns: DirectorChangeHandOver,
  errors: FOLLOW_ERRORS,
  refusals: refusalsOf("org.director.threshold", [
    [error_ROLE_PERMISSION_DENIED, "?"],
    [error_INVALID_INPUT, "?"],
    // s33.5 (s33:199) reaches WRONG_STATE from after-s2 by `v4_company`, which this `when` does not describe.
    [error_WRONG_STATE, "?"],
    [error_NOT_AUTHENTICATED, "?"],
  ]),
});

// ═══ Proposals ═══════════════════════════════════════════════════════════════════════════════
// `org proposal …` (apps/cli/src/commands/org/subcommands/proposal/). Each command resolves the
// Organization (internal/scope.ts:15) and calls one `client.org(orgId).proposals.*` method (sdk
// organizations/proposals.ts). Every read settles from the chain on the server.

// `proposals.list` (sdk proposals.ts:240) forwards organizations.proposals.list. The page lists one
// proposal's fields; the CLI prints the list under `items` (list/execute.ts:28).
export const operation_org_proposal_list = defineOperation({
  ...frozenText("org.proposal.list"),
  was: [
    book("org.proposal.list"),
    `${ORG}/proposal/subcommands/list/command.ts:12`,
    `${ORG}/proposal/subcommands/list/execute.ts:24`,
    `${ORG}/proposal/subcommands/list/execute.ts:28`,
    `${SDK}/organizations/proposals.ts:240`,
    `${ROWS}/organizations/proposal-operations.ts:84`,
    `${ROWS}/organizations/proposal-schema.ts:29`,
    `${SCN}/s1-acme-is-founded.scenario.ts:2234`,
    `${SCN}/s1-acme-is-founded.scenario.ts:1052`,
    ...SCOPE_WAS,
  ],
  priority: "normal",
  implementedBy: rpc_organizations_proposals_list,
  acceptance: frozenClaims("org.proposal.list"),
  returns: Schema.Struct({ items: Schema.Array(SafeProposal) }),
  errors: SCOPE_ERRORS,
  refusals: refusalsOf("org.proposal.list", [
    // s1.32 (s1:2234) lists the proposals of an Organization Sam is not in: the CLI refuses CLI_USAGE on `--org`
    // (auth/actor.ts:59, binding s1:1052); only the step's SDK call is refused ROLE_PERMISSION_DENIED.
    [error_ROLE_PERMISSION_DENIED, "?"],
    [error_NOT_AUTHENTICATED, "?"],
  ]),
});

// `proposals.get` (sdk proposals.ts:251) forwards organizations.proposals.get; the CLI also reads the Directors
// (`directors.get`) in parallel, only for their names (get/execute.ts:34).
export const operation_org_proposal_get = defineOperation({
  ...frozenText("org.proposal.get"),
  was: [
    book("org.proposal.get"),
    `${ORG}/proposal/subcommands/get/command.ts:5`,
    `${ORG}/proposal/subcommands/get/execute.ts:17`,
    `${ORG}/proposal/subcommands/get/execute.ts:34`,
    `${SDK}/organizations/proposals.ts:251`,
    `${ROWS}/organizations/proposal-operations.ts:91`,
    `${ROWS}/organizations/proposal-schema.ts:29`,
    `${SCN}/s1-acme-is-founded.scenario.ts:2208`,
    `${SCN}/s1-acme-is-founded.scenario.ts:185`,
    ...SCOPE_WAS,
  ],
  priority: "normal",
  implementedBy: rpc_organizations_proposals_get,
  acceptance: frozenClaims("org.proposal.get"),
  returns: SafeProposal,
  errors: SCOPE_ERRORS,
  refusals: refusalsOf("org.proposal.get", [
    [error_ROLE_PERMISSION_DENIED, "?"],
    // s1.30 (s1:2208): Sam reads `sp_unknown` in Acme. It needs only Sam's Seat (s1.13), in after-s1 (s1:185).
    [error_INVALID_INPUT, "after-s1"],
    [error_NOT_AUTHENTICATED, "?"],
  ]),
});

// The page names `sdk: client.org(orgId).proposals.approve` (requestApproval, then the client's signer signs).
// The CLI never signs: it reads the proposal and the Directors (approve/execute.ts:19), then calls
// `proposals.requestApproval` (sdk proposals.ts:292, internal/approval.ts:127), one row, and follows the
// approval page. CAPABILITY_UNAVAILABLE is the SDK's `approve` without a signer (proposals.ts:300); the CLI
// never reaches it, so refusal-not-produced on it is a finding. The page lists the Approval's fields; the
// CLI prints the hand-over (internal/approval.ts:133, :197), with the approval's id and URL only.
export const operation_org_proposal_approve = defineOperation({
  ...frozenText("org.proposal.approve"),
  was: [
    book("org.proposal.approve"),
    `${ORG}/proposal/subcommands/approve/command.ts:13`,
    `${ORG}/proposal/subcommands/approve/execute.ts:19`,
    `${ORG}/proposal/subcommands/approve/execute.ts:23`,
    `${SDK}/organizations/proposals.ts:292`,
    `${SDK}/organizations/proposals.ts:296`,
    `${SDK}/organizations/proposals.ts:300`,
    `${ROWS}/organizations/proposal-operations.ts:109`,
    `${SCN}/s1-acme-is-founded.scenario.ts:2179`,
    `${SCN}/s1-acme-is-founded.scenario.ts:1875`,
    ...PROPOSAL_APPROVAL_WAS,
    ...FOLLOW_WAS,
    ...SCOPE_WAS,
  ],
  priority: "normal",
  implementedBy: rpc_organizations_proposals_request_approval,
  acceptance: frozenClaims("org.proposal.approve"),
  returns: ProposalHandOver,
  errors: FOLLOW_ERRORS,
  refusals: refusalsOf("org.proposal.approve", [
    [error_CAPABILITY_UNAVAILABLE, "?"],
    [error_ROLE_PERMISSION_DENIED, "?"],
    [error_INVALID_INPUT, "?"],
    // s1.28 (s1:2179): Dana approves the deposit again. It executed at s1.18 (s1:1875), before after-s1 is saved.
    [error_WRONG_STATE, "after-s1"],
    [error_NOT_AUTHENTICATED, "?"],
  ]),
});

// `proposals.reject` (sdk proposals.ts:309) forwards organizations.proposals.reject; the CLI then hands the
// rejection, a proposal of its own, to the approval page (reject/execute.ts:30). The page lists the
// rejection's fields; the CLI prints them under `proposal` in the hand-over.
export const operation_org_proposal_reject = defineOperation({
  ...frozenText("org.proposal.reject"),
  was: [
    book("org.proposal.reject"),
    `${ORG}/proposal/subcommands/reject/command.ts:13`,
    `${ORG}/proposal/subcommands/reject/execute.ts:25`,
    `${ORG}/proposal/subcommands/reject/execute.ts:30`,
    `${SDK}/organizations/proposals.ts:309`,
    `${ROWS}/organizations/proposal-operations.ts:98`,
    `${SCN}/s1-acme-is-founded.scenario.ts:2195`,
    ...PROPOSAL_APPROVAL_WAS,
    ...FOLLOW_WAS,
    ...SCOPE_WAS,
  ],
  priority: "normal",
  implementedBy: rpc_organizations_proposals_reject,
  acceptance: frozenClaims("org.proposal.reject"),
  returns: ProposalHandOver,
  errors: FOLLOW_ERRORS,
  refusals: refusalsOf("org.proposal.reject", [
    [error_ROLE_PERMISSION_DENIED, "?"],
    [error_INVALID_INPUT, "?"],
    // s1.29 (s1:2195): Sam rejects the deposit, executed at s1.18, before after-s1 is saved.
    [error_WRONG_STATE, "after-s1"],
    [error_NOT_AUTHENTICATED, "?"],
  ]),
});

// `proposals.wait` (sdk proposals.ts:318) reads organizations.proposals.get every two seconds until no sent
// approval is in flight: a poll, so a flow.
export const operation_org_proposal_wait = defineOperation({
  ...frozenText("org.proposal.wait"),
  was: [
    book("org.proposal.wait"),
    `${ORG}/proposal/subcommands/wait/command.ts:12`,
    `${ORG}/proposal/subcommands/wait/execute.ts:25`,
    `${SDK}/organizations/proposals.ts:318`,
    `${SDK}/organizations/proposals.ts:152`,
    `${ROWS}/organizations/proposal-operations.ts:91`,
    `${SCN}/s1-acme-is-founded.scenario.ts:2221`,
    ...SCOPE_WAS,
  ],
  priority: "normal",
  implementedBy: flow_client_org_proposals_wait,
  acceptance: frozenClaims("org.proposal.wait"),
  returns: SafeProposal,
  errors: SCOPE_ERRORS,
  refusals: refusalsOf("org.proposal.wait", [
    [error_ROLE_PERMISSION_DENIED, "?"],
    // s1.31 (s1:2221): Sam waits on `sp_unknown` in Acme; it needs only his Seat, in after-s1.
    [error_INVALID_INPUT, "after-s1"],
    [error_NOT_AUTHENTICATED, "?"],
  ]),
});

// ═══ The Board ═══════════════════════════════════════════════════════════════════════════════
// `org board …` (apps/cli/src/commands/org/subcommands/board/) is the v4 Board. The pages name the SDK's
// whole methods (`board.directors.add`, `board.claim`, …), which open the change, sign it with the
// client's signer and poll it (sdk organizations/board.ts:262). The CLI never signs: it calls the
// `prepare…` method, which forwards one organizations.directors.* row, then hands the approval over and
// follows it (board/internal/seat.ts:52), polling with the matching `wait…` method. So each write's
// implementation is the one row its `prepare…` reaches, except `prepareHandOver`, which also checks what
// opened and is booked as a flow (../organizations/flows-governance.ts). The pages list the settled result's fields; with
// `--no-wait` the CLI prints the open approval instead (seat.ts:64), which the pages' `status` mentions.

// `board.get` (sdk board-results.ts:83) forwards organizations.proposals.safe and maps its owners to Directors
// (readBoard, :55): one row.
export const operation_org_board_show = defineOperation({
  ...frozenText("org.board.show"),
  was: [
    book("org.board.show"),
    `${ORG}/board/subcommands/show/command.ts:5`,
    `${ORG}/board/subcommands/show/execute.ts:39`,
    `${SDK}/organizations/board-results.ts:55`,
    `${SDK}/organizations/board-results.ts:83`,
    `${ROWS}/organizations/proposal-operations.ts:127`,
    `${SCN}/s16-dana-removes-a-director.scenario.ts:267`,
    `${SCN}/s16-dana-removes-a-director.scenario.ts:26`,
    ...SCOPE_WAS,
  ],
  priority: "normal",
  implementedBy: rpc_organizations_proposals_safe,
  acceptance: frozenClaims("org.board.show"),
  returns: Schema.Struct({
    orgId: Schema.String,
    threshold: BoardThreshold,
    directors: Schema.Array(
      Schema.Struct({
        address: Schema.String,
        label: Schema.NullOr(Schema.String),
        isCaller: Schema.Boolean,
        signer: Schema.Boolean,
        seat: Schema.Null, // Always null: no Board elections (board-results.ts:69).
        electedBy: Schema.Null,
        termEnds: Schema.Null,
      }),
    ),
  }),
  errors: SCOPE_ERRORS,
  refusals: refusalsOf("org.board.show", [
    [error_WRONG_STATE, "?"],
    [error_ROLE_PERMISSION_DENIED, "?"],
    // s16.9 (s16:267): Rex, never signed in on his machine, reads Acme's Board. S16 restores after-s1 (s16:26).
    [error_NOT_AUTHENTICATED, "after-s1"],
  ]),
});

// `board.prepareClaim` (sdk board-claim.ts:88) forwards organizations.directors.claim; the CLI follows with
// `board.waitClaimed` (seat.ts:245). Backend refusal order: already a signer (WRONG_STATE), then no Director hat
// (ROLE_PERMISSION_DENIED) (backend directors/rules/claim.ts:41, :42).
export const operation_org_board_claim = defineOperation({
  ...frozenText("org.board.claim"),
  was: [
    book("org.board.claim"),
    `${ORG}/board/subcommands/claim/command.ts:11`,
    `${ORG}/board/subcommands/claim/execute.ts:28`,
    `${ORG}/board/internal/seat.ts:245`,
    `${SDK}/organizations/board-claim.ts:70`,
    `${SDK}/organizations/board-claim.ts:88`,
    `${ROWS}/organizations/director-operations.ts:173`,
    `${ROWS}/organizations/director-schema.ts:143`,
    `${BACK}/organizations/directors/rules/claim.ts:41`,
    `${SCN}/s38-rex-is-elected-and-claims-his-seat.scenario.ts:151`,
    `${SCN}/s38-rex-is-elected-and-claims-his-seat.scenario.ts:195`,
    `${SCN}/s38-rex-is-elected-and-claims-his-seat.scenario.ts:52`,
    ...SEAT_WAS,
    ...FOLLOW_WAS,
    ...SCOPE_WAS,
  ],
  priority: "normal",
  implementedBy: rpc_organizations_directors_claim,
  acceptance: frozenClaims("org.board.claim"),
  returns: Schema.Union([
    BoardAwaiting,
    Schema.Struct({
      status: Schema.Literal("seated"),
      person: Schema.NullOr(OwnerChangePerson),
      directors: Schema.Number,
      threshold: BoardThreshold,
      changeId: Schema.String,
      orgId: Schema.String,
    }),
  ]),
  errors: FOLLOW_ERRORS,
  refusals: refusalsOf("org.board.claim", [
    // s38.2 (s38:151): Mia, a Seat in after-s2 (S38 restores it, s38:52), wears no Director hat.
    [error_ROLE_PERMISSION_DENIED, "after-s2"],
    // s38.4 (s38:195) refuses Rex `already_owner` only after his claim at s38.3; from after-s2 his Safe does not
    // sign yet, so his command is refused ROLE_PERMISSION_DENIED instead.
    [error_WRONG_STATE, "?"],
    [error_NOT_AUTHENTICATED, "?"],
  ]),
});

// `board.prepareRefresh` (sdk board-refresh.ts:92) forwards organizations.directors.refresh; the CLI follows with
// `board.waitRefreshed` (seat.ts:221).
export const operation_org_board_refresh = defineOperation({
  ...frozenText("org.board.refresh"),
  was: [
    book("org.board.refresh"),
    `${ORG}/board/subcommands/refresh/command.ts:11`,
    `${ORG}/board/subcommands/refresh/execute.ts:29`,
    `${ORG}/board/internal/seat.ts:221`,
    `${SDK}/organizations/board-refresh.ts:69`,
    `${SDK}/organizations/board-refresh.ts:92`,
    `${ROWS}/organizations/director-operations.ts:146`,
    `${BACK}/organizations/directors/rules/refresh.ts:47`,
    `${SCN}/s32-the-board-refreshes.scenario.ts:100`,
    `${SCN}/s32-the-board-refreshes.scenario.ts:20`,
    ...SEAT_WAS,
    ...FOLLOW_WAS,
    ...SCOPE_WAS,
  ],
  priority: "normal",
  implementedBy: rpc_organizations_directors_refresh,
  acceptance: frozenClaims("org.board.refresh"),
  returns: Schema.Union([
    BoardAwaiting,
    Schema.Struct({
      status: Schema.Literal("removed"),
      removed: Schema.Array(OwnerChangePerson),
      directors: Schema.Number,
      threshold: BoardThreshold,
      changeId: Schema.String,
      orgId: Schema.String,
    }),
  ]),
  errors: FOLLOW_ERRORS,
  refusals: refusalsOf("org.board.refresh", [
    // s32.3 (s32:100): Sam refreshes while both Directors wear the hat (`nobody_lapsed`). S32 restores after-s1.
    [error_WRONG_STATE, "after-s1"],
    [error_NOT_AUTHENTICATED, "?"],
  ]),
});

// `board.directors.prepare` (sdk board.ts:252) forwards organizations.directors.add; the CLI follows with
// `board.directors.wait` (seat.ts:131).
export const operation_org_board_director_add = defineOperation({
  ...frozenText("org.board.director.add"),
  was: [
    book("org.board.director.add"),
    `${ORG}/board/subcommands/director/subcommands/add/command.ts:20`,
    `${ORG}/board/subcommands/director/subcommands/add/execute.ts:30`,
    `${ORG}/board/internal/seat.ts:131`,
    `${SDK}/organizations/board.ts:149`,
    `${SDK}/organizations/board.ts:252`,
    `${ROWS}/organizations/director-operations.ts:32`,
    `${SCN}/s1-acme-is-founded.scenario.ts:1715`,
    ...SEAT_WAS,
    ...FOLLOW_WAS,
    ...SCOPE_WAS,
  ],
  priority: "normal",
  implementedBy: rpc_organizations_directors_add,
  acceptance: frozenClaims("org.board.director.add"),
  returns: Schema.Union([
    BoardAwaiting,
    Schema.Struct({
      status: Schema.Literal("seated"),
      directors: Schema.Number,
      threshold: BoardThreshold,
      changeId: Schema.String,
      person: Schema.NullOr(OwnerChangePerson),
      orgId: Schema.String,
    }),
  ]),
  errors: FOLLOW_ERRORS,
  refusals: refusalsOf("org.board.director.add", [
    [error_ROLE_PERMISSION_DENIED, "?"],
    [error_WRONG_STATE, "?"],
    [error_INVALID_INPUT, "?"],
    [error_NOT_AUTHENTICATED, "?"],
  ]),
});

// `board.directors.prepareRemove` (sdk board.ts:276) forwards organizations.directors.remove; the CLI follows
// with `board.directors.waitRemoved` (seat.ts:174). Backend refusal order: not the top hat
// (ROLE_PERMISSION_DENIED), then the last Director or a threshold above the Directors left (WRONG_STATE)
// (backend directors/rules.ts:218, :226, :232).
export const operation_org_board_director_remove = defineOperation({
  ...frozenText("org.board.director.remove"),
  was: [
    book("org.board.director.remove"),
    `${ORG}/board/subcommands/director/subcommands/remove/command.ts:20`,
    `${ORG}/board/subcommands/director/subcommands/remove/execute.ts:31`,
    `${ORG}/board/internal/seat.ts:174`,
    `${SDK}/organizations/board.ts:156`,
    `${SDK}/organizations/board.ts:276`,
    `${ROWS}/organizations/director-operations.ts:62`,
    `${BACK}/organizations/directors/rules.ts:218`,
    `${BACK}/organizations/directors/rules.ts:232`,
    `${SCN}/s16-dana-removes-a-director.scenario.ts:132`,
    `${SCN}/s16-dana-removes-a-director.scenario.ts:150`,
    `${SCN}/s16-dana-removes-a-director.scenario.ts:26`,
    ...SEAT_WAS,
    ...FOLLOW_WAS,
    ...SCOPE_WAS,
  ],
  priority: "normal",
  implementedBy: rpc_organizations_directors_remove,
  acceptance: frozenClaims("org.board.director.remove"),
  returns: Schema.Union([
    BoardAwaiting,
    Schema.Struct({
      status: Schema.Literal("removed"),
      directors: Schema.Number,
      threshold: BoardThreshold,
      changeId: Schema.String,
      person: Schema.NullOr(OwnerChangePerson),
      orgId: Schema.String,
    }),
  ]),
  errors: FOLLOW_ERRORS,
  refusals: refusalsOf("org.board.director.remove", [
    // s16.2 (s16:132): Sam, a Director without the Shareholders' top hat, removes Dana. S16 restores after-s1.
    [error_ROLE_PERMISSION_DENIED, "after-s1"],
    // s16.3 (s16:150): Dana removes Sam while the Board signs 2 of 2 (`threshold_above_directors_left`).
    [error_WRONG_STATE, "after-s1"],
    [error_NOT_AUTHENTICATED, "?"],
  ]),
});

// `board.prepareThreshold` (sdk board.ts:215) forwards organizations.directors.setThreshold; the CLI reads the
// Directors first, refuses on its own a threshold of 1 among several Directors without `--confirm`
// (threshold/execute.ts:33, director/internal/change.ts:34), and follows with `board.waitThreshold` (seat.ts:151).
export const operation_org_board_threshold = defineOperation({
  ...frozenText("org.board.threshold"),
  was: [
    book("org.board.threshold"),
    `${ORG}/board/subcommands/threshold/command.ts:16`,
    `${ORG}/board/subcommands/threshold/execute.ts:33`,
    `${ORG}/board/subcommands/threshold/execute.ts:51`,
    `${ORG}/board/internal/seat.ts:151`,
    `${SDK}/organizations/board.ts:170`,
    `${SDK}/organizations/board.ts:215`,
    `${ROWS}/organizations/director-operations.ts:91`,
    `${BACK}/organizations/directors/rules.ts:269`,
    `${SCN}/s25-acme-shareholders-vote.scenario.ts:1077`,
    `${SCN}/s6-the-short-contract.scenario.ts:1885`,
    `${SCN}/s6-the-short-contract.scenario.ts:425`,
    ...SEAT_WAS,
    ...FOLLOW_WAS,
    ...SCOPE_WAS,
  ],
  priority: "normal",
  implementedBy: rpc_organizations_directors_set_threshold,
  acceptance: frozenClaims("org.board.threshold"),
  returns: Schema.Union([
    BoardAwaiting,
    Schema.Struct({
      status: Schema.Literal("set"),
      threshold: BoardThreshold,
      before: BoardThreshold,
      changeId: Schema.String,
      orgId: Schema.String,
    }),
  ]),
  errors: FOLLOW_ERRORS,
  refusals: refusalsOf("org.board.threshold", [
    // s25.22 (s25:1077) refuses Dana `not_shareholders_top_hat` only after the S25 handover (s25.21); in every saved
    // world she still wears the top hat. Sam, who does not (s16.2), would reach rules.ts:269 from after-s1, but no
    // step runs this command as him.
    [error_ROLE_PERMISSION_DENIED, "?"],
    // s6.38 (s6:1885): Dana asks 3 of Acme's 2 Directors. S6 restores after-s2 (s6:425), which has 2 Directors.
    [error_INVALID_INPUT, "after-s2"],
    [error_WRONG_STATE, "?"],
    [error_NOT_AUTHENTICATED, "?"],
  ]),
});

// `board.prepareHandOver` (sdk board-handover.ts:142) forwards organizations.directors.handover and checks the
// opened change locally (:120), PROVIDER_RESPONSE_INVALID on a mismatch: the flow client.org.board.prepare-hand-over.
// The CLI follows with `board.waitHandOver` (seat.ts:197). Backend refusal order:
// already handed over, not the top hat, equity not installed (backend directors/rules/handover.ts:48, :49, :50).
export const operation_org_board_handover = defineOperation({
  ...frozenText("org.board.handover"),
  was: [
    book("org.board.handover"),
    `${ORG}/board/subcommands/handover/command.ts:7`,
    `${ORG}/board/subcommands/handover/execute.ts:29`,
    `${ORG}/board/internal/seat.ts:197`,
    `${SDK}/organizations/board-handover.ts:120`,
    `${SDK}/organizations/board-handover.ts:142`,
    `${ROWS}/organizations/director-operations.ts:120`,
    `${BACK}/organizations/directors/rules/handover.ts:50`,
    `${SCN}/s25-acme-shareholders-vote.scenario.ts:1094`,
    `${SCN}/s15-acme-switches-equity-on.scenario.ts:396`,
    ...SEAT_WAS,
    ...FOLLOW_WAS,
    ...SCOPE_WAS,
  ],
  priority: "normal",
  implementedBy: flow_client_org_board_prepare_hand_over,
  acceptance: frozenClaims("org.board.handover"),
  returns: Schema.Union([
    BoardAwaiting,
    Schema.Struct({
      status: Schema.Literal("handed_over"),
      directors: Schema.Number,
      threshold: BoardThreshold,
      changeId: Schema.String,
      orgId: Schema.String,
    }),
  ]),
  errors: FOLLOW_ERRORS,
  refusals: refusalsOf("org.board.handover", [
    [error_ROLE_PERMISSION_DENIED, "?"],
    // s25.23 (s25:1094) refuses Dana `handed_over`, after the S25 handover. The same command by Dana from after-s1,
    // before S15 installs the equity (s15:396), is refused `equity_not_installed` (rules/handover.ts:50), a cause
    // this `when` describes.
    [error_WRONG_STATE, "after-s1"],
    [error_NOT_AUTHENTICATED, "?"],
  ]),
});

// ═══ Shareholder votes ═══════════════════════════════════════════════════════════════════════
// `org vote …` (apps/cli/src/commands/org/subcommands/vote/) and `vote …` (apps/cli/src/commands/vote/).
// Writes call a `prepare…` method that opens the caller's approval, then the CLI follows it and polls to the
// chain (vote/internal/hand-over.ts, cast/execute.ts). Acme's votes exist only inside S25, which restores
// after-s15 (s25:17) and opens the vote at s25.2; no saved world holds a vote, so refusals about an existing
// vote are `?`.

// `votes.prepare` (sdk votes.ts:180) forwards organizations.votes.create; the CLI follows with `votes.wait`
// until the Governor holds it and prints `{ vote }` (hand-over.ts:123).
export const operation_org_vote_create = defineOperation({
  ...frozenText("org.vote.create"),
  was: [
    book("org.vote.create"),
    `${ORG}/vote/subcommands/create/command.ts:24`,
    `${ORG}/vote/subcommands/create/execute.ts:30`,
    `${ORG}/vote/internal/hand-over.ts:60`,
    `${ORG}/vote/internal/hand-over.ts:123`,
    `${SDK}/organizations/votes.ts:138`,
    `${SDK}/organizations/votes.ts:180`,
    `${ROWS}/organizations/vote-operations.ts:36`,
    `${ROWS}/organizations/vote-schema.ts:82`,
    `${SCN}/s25-acme-shareholders-vote.scenario.ts:556`,
    `${SCN}/s25-acme-shareholders-vote.scenario.ts:17`,
    ...FOLLOW_WAS,
    ...SCOPE_WAS,
  ],
  priority: "normal",
  implementedBy: rpc_organizations_votes_create,
  acceptance: frozenClaims("org.vote.create"),
  returns: Schema.Union([
    Schema.Struct({
      status: Schema.Literal("awaiting_approval"),
      voteId: Schema.String,
      matter: Vote.fields.matter,
      title: Schema.String,
      ...VOTE_APPROVAL,
    }),
    Schema.Struct({ vote: Vote }),
  ]),
  errors: FOLLOW_ERRORS,
  refusals: refusalsOf("org.vote.create", [
    [error_BELOW_THRESHOLD, "?"],
    [error_FEATURE_NOT_AVAILABLE, "?"],
    // s25.3 (s25:556): Dana proposes for class Preferred; after-s15 (s25:17) has only Common.
    [error_INVALID_INPUT, "after-s15"],
  ]),
});

// `votes.list` (sdk votes.ts:182) forwards organizations.votes.list.
export const operation_org_vote_list = defineOperation({
  ...frozenText("org.vote.list"),
  was: [
    book("org.vote.list"),
    `${ORG}/vote/subcommands/list/command.ts:5`,
    `${ORG}/vote/subcommands/list/execute.ts:18`,
    `${ORG}/vote/subcommands/list/execute.ts:23`,
    `${SDK}/organizations/votes.ts:182`,
    `${ROWS}/organizations/vote-operations.ts:95`,
    ...SCOPE_WAS,
  ],
  priority: "normal",
  implementedBy: rpc_organizations_votes_list,
  acceptance: frozenClaims("org.vote.list"),
  returns: Schema.Struct({ votes: Schema.Array(Vote) }),
  errors: SCOPE_ERRORS,
  refusals: refusalsOf("org.vote.list", [[error_ROLE_PERMISSION_DENIED, "?"]]),
});

// `votes.get` (sdk votes.ts:181) forwards organizations.votes.get.
export const operation_org_vote_show = defineOperation({
  ...frozenText("org.vote.show"),
  was: [
    book("org.vote.show"),
    `${ORG}/vote/subcommands/show/command.ts:9`,
    `${ORG}/vote/subcommands/show/execute.ts:23`,
    `${ORG}/vote/subcommands/show/execute.ts:27`,
    `${SDK}/organizations/votes.ts:181`,
    `${ROWS}/organizations/vote-operations.ts:88`,
    `${SCN}/s25-acme-shareholders-vote.scenario.ts:812`,
    ...SCOPE_WAS,
  ],
  priority: "normal",
  implementedBy: rpc_organizations_votes_get,
  acceptance: frozenClaims("org.vote.show"),
  returns: Schema.Struct({ vote: Vote }),
  errors: SCOPE_ERRORS,
  refusals: refusalsOf("org.vote.show", [
    // s25.12 (s25:812): Sam reads a cut-short vote id; no vote has it in after-s15 either.
    [error_INVALID_INPUT, "after-s15"],
  ]),
});

// `votes.wait` (sdk votes.ts:187) reads organizations.votes.get until the `--until` state (:152): a poll, so a flow.
export const operation_org_vote_wait = defineOperation({
  ...frozenText("org.vote.wait"),
  was: [
    book("org.vote.wait"),
    `${ORG}/vote/subcommands/wait/command.ts:22`,
    `${ORG}/vote/subcommands/wait/execute.ts:31`,
    `${ORG}/vote/subcommands/wait/execute.ts:48`,
    `${SDK}/organizations/votes.ts:152`,
    `${SDK}/organizations/votes.ts:187`,
    `${ROWS}/organizations/vote-operations.ts:88`,
    ...SCOPE_WAS,
  ],
  priority: "normal",
  implementedBy: flow_client_org_votes_wait,
  acceptance: frozenClaims("org.vote.wait"),
  returns: Schema.Struct({ vote: Vote }),
  errors: SCOPE_ERRORS,
  refusals: refusalsOf("org.vote.wait", [
    [error_INVALID_INPUT, "?"],
    [error_WRONG_STATE, "?"],
  ]),
});

// `votes.prepareExecute` (sdk vote-execute.ts:168) reads organizations.votes.get, then calls
// organizations.votes.execute and checks one against the other (:115): two rows, so a flow. The CLI follows with
// `votes.waitExecute` (execute/execute.ts:118) and prints `{ execution }` (:35); the page lists those fields at the
// top level and a `tally` the CLI does not print.
export const operation_org_vote_execute = defineOperation({
  ...frozenText("org.vote.execute"),
  was: [
    book("org.vote.execute"),
    `${ORG}/vote/subcommands/execute/command.ts:6`,
    `${ORG}/vote/subcommands/execute/execute.ts:35`,
    `${ORG}/vote/subcommands/execute/execute.ts:59`,
    `${ORG}/vote/subcommands/execute/execute.ts:68`,
    `${ORG}/vote/subcommands/execute/execute.ts:125`,
    `${SDK}/organizations/vote-execute.ts:115`,
    `${SDK}/organizations/vote-execute.ts:168`,
    `${ROWS}/organizations/vote-operations.ts:64`,
    `${ROWS}/organizations/vote-schema.ts:241`,
    `${SCN}/s25-acme-shareholders-vote.scenario.ts:750`,
    `${SCN}/s25-acme-shareholders-vote.scenario.ts:1005`,
    ...FOLLOW_WAS,
    ...SCOPE_WAS,
  ],
  priority: "normal",
  implementedBy: flow_client_org_votes_prepare_execute,
  acceptance: frozenClaims("org.vote.execute"),
  returns: Schema.Struct({
    execution: Schema.Struct({
      voteId: Schema.String,
      executionId: Schema.String,
      status: Schema.Literals(["awaiting_approval", "sent", "executed", "failed", "lapsed"]),
      executedAt: Schema.NullOr(Schema.Number),
    }),
    // With `--no-wait` the open approval comes beside the execution (execute/execute.ts:68).
    approvalId: Schema.optionalKey(Schema.String),
    approvalUrl: Schema.optionalKey(Schema.String),
    expiresAt: Schema.optionalKey(Schema.Number),
    next: Schema.optionalKey(Next),
  }),
  errors: FOLLOW_ERRORS,
  refusals: refusalsOf("org.vote.execute", [
    // s25.10 (s25:750) and s25.19 (s25:1005) reach it, on the vote S25 opens after after-s15.
    [error_WRONG_STATE, "?"],
    [error_INVALID_INPUT, "?"],
    [error_FEATURE_NOT_AVAILABLE, "?"],
  ]),
});

// `client.me.votes.prepareCast` (sdk my-votes.ts:194) forwards organizations.votes.cast and checks the opened
// ballot locally (:145), PROVIDER_RESPONSE_INVALID on a mismatch: the flow client.me.votes.prepare-cast. The CLI refuses on its own anything but exactly one side (cast/execute.ts:31),
// then follows with `me.votes.waitCast` (:135).
export const operation_vote_cast = defineOperation({
  ...frozenText("vote.cast"),
  was: [
    book("vote.cast"),
    `${CLI}/vote/subcommands/cast/command.ts:27`,
    `${CLI}/vote/subcommands/cast/execute.ts:31`,
    `${CLI}/vote/subcommands/cast/execute.ts:49`,
    `${CLI}/vote/subcommands/cast/execute.ts:78`,
    `${CLI}/vote/subcommands/cast/execute.ts:86`,
    `${CLI}/vote/subcommands/cast/execute.ts:143`,
    `${SDK}/organizations/my-votes.ts:145`,
    `${SDK}/organizations/my-votes.ts:194`,
    `${ROWS}/organizations/personal-vote-operations.ts:53`,
    `${ROWS}/organizations/vote-schema.ts:177`,
    `${SCN}/s25-acme-shareholders-vote.scenario.ts:723`,
    ...FOLLOW_WAS,
  ],
  priority: "normal",
  implementedBy: flow_client_me_votes_prepare_cast,
  acceptance: frozenClaims("vote.cast"),
  returns: Schema.Struct({
    voteId: Schema.String,
    ballotId: Schema.String,
    support: Schema.Literals(["for", "against", "abstain"]),
    weight: Schema.Number,
    status: Schema.Literals(["awaiting_approval", "sent", "cast", "failed", "lapsed"]),
    // With `--no-wait` the open approval comes beside the ballot (cast/execute.ts:86).
    approvalId: Schema.optionalKey(Schema.String),
    approvalUrl: Schema.optionalKey(Schema.String),
    expiresAt: Schema.optionalKey(Schema.Number),
    next: Schema.optionalKey(Next),
  }),
  errors: [error_CLI_USAGE, error_WRONG_STATE, error_CANCELLED, error_CLI_DEADLINE],
  refusals: refusalsOf("vote.cast", [
    // s25.9 (s25:723): Dana votes twice, on the vote S25 opens after after-s15.
    [error_WRONG_STATE, "?"],
    [error_INVALID_INPUT, "?"],
    [error_FEATURE_NOT_AVAILABLE, "?"],
  ]),
});

// `client.me.votes.list` (sdk my-votes.ts:193) forwards organizations.votes.mine.
export const operation_vote_list = defineOperation({
  ...frozenText("vote.list"),
  was: [
    book("vote.list"),
    `${CLI}/vote/subcommands/list/command.ts:6`,
    `${CLI}/vote/subcommands/list/execute.ts:46`,
    `${CLI}/vote/subcommands/list/execute.ts:48`,
    `${SDK}/organizations/my-votes.ts:193`,
    `${ROWS}/organizations/personal-vote-operations.ts:28`,
    `${ROWS}/organizations/vote-schema.ts:125`,
  ],
  priority: "normal",
  implementedBy: rpc_organizations_votes_mine,
  acceptance: frozenClaims("vote.list"),
  returns: Schema.Struct({ votes: Schema.Array(MyVote) }),
  refusals: refusalsOf("vote.list", [[error_NOT_AUTHENTICATED, "?"]]),
});

// NOT BUILT. The page has a design only (slice W5, CAP-1220): no CLI command (apps/cli/src/commands/vote/command.ts
// has cast and list), no `client.me.votes.delegate` (sdk my-votes.ts), no protocol row and no backend function.
// s25.13 and s25.14 are `future` steps. implementedBy names the designed SDK method as a link no file defines, so
// the build reports it dangling; the assembly step decides it. returns is the page's two fields, untyped.
export const operation_vote_delegate = defineOperation({
  ...frozenText("vote.delegate"),
  about: `${frozenText("vote.delegate").about} As is, not built: the old code has no \`vote delegate\` command, no \`client.me.votes.delegate\` method and no row; the design names \`ShareClass.delegate\` on the class token.`,
  was: [
    book("vote.delegate"),
    `${CLI}/vote/command.ts:10`,
    `${SDK}/organizations/my-votes.ts:193`,
    `${SCN}/s25-acme-shareholders-vote.scenario.ts:837`,
    `${SCN}/s25-acme-shareholders-vote.scenario.ts:866`,
  ],
  priority: "normal",
  implementedBy: { _kind: "flow", id: "client.me.votes.delegate" },
  acceptance: frozenClaims("vote.delegate"),
  returns: Schema.Struct({ class: Schema.Unknown, delegate: Schema.Unknown }),
  refusals: refusalsOf("vote.delegate", [
    // s25.14 (s25:866) is a `future` step: nothing runs it.
    [error_INVALID_INPUT, "?"],
    [error_NOT_AUTHENTICATED, "?"],
  ]),
});

// ═══ Members ═════════════════════════════════════════════════════════════════════════════════

// `org member invite` (apps/cli/src/commands/org-invite/member/subcommands/invite/). The page names
// `invitations.invite`; the CLI previews the offer (`invitations.preview`), then calls
// `client.org(orgId).invitations.propose` (execute.ts:129; sdk invite-execution.ts:111), which authors the
// invitation (organizations.invitations.invite), proposes its configuration to the Directors
// (permissions.configurations.propose) and opens the proposer's approval (organizations.proposals.requestApproval)
// (invite-proposals.ts:145, :166): several rows, so a flow. A Seat-only offer, or a key whose invitation is set
// up, is answered with the invitation (execute.ts:147, :182). With `--json` the CLI does not follow the approval:
// it prints the hand-over with the request key and invitation id (:170), not the invitation the page lists.
// `--preview` calls only `invitations.preview` (organizations.invitations.preview) and prints the preview (:109).
export const operation_org_member_invite = defineOperation({
  ...frozenText("org.member.invite"),
  was: [
    book("org.member.invite"),
    `${INVITE}/member/subcommands/invite/command.ts:41`,
    `${INVITE}/member/subcommands/invite/execute.ts:100`,
    `${INVITE}/member/subcommands/invite/execute.ts:109`,
    `${INVITE}/member/subcommands/invite/execute.ts:129`,
    `${INVITE}/member/subcommands/invite/execute.ts:147`,
    `${INVITE}/member/subcommands/invite/execute.ts:170`,
    `${INVITE}/member/subcommands/invite/execute.ts:182`,
    `${INVITE}/internal/recovery.ts:20`,
    `${INVITE}/internal/shared.ts:122`,
    `${SDK}/organizations/invitations.ts:105`,
    `${SDK}/organizations/invite-execution.ts:111`,
    `${SDK}/organizations/invite-proposals.ts:145`,
    `${SDK}/organizations/invite-proposals.ts:166`,
    `${ROWS}/organizations/operations.ts:99`,
    `${ROWS}/organizations/invitation-schema.ts:197`,
    `${ROWS}/organizations/invitation-schema.ts:153`,
    `${SCN}/s2-the-team-and-its-permissions.scenario.ts:1988`,
    `${SCN}/s2-the-team-and-its-permissions.scenario.ts:175`,
    ...PROPOSAL_APPROVAL_WAS,
    ...FOLLOW_WAS,
  ],
  priority: "normal",
  implementedBy: flow_client_org_invitations_propose,
  acceptance: frozenClaims("org.member.invite"),
  returns: Schema.Union([
    InvitationView,
    InvitePreview,
    Schema.Struct({ ...PROPOSAL_AWAITING, requestKey: Schema.String, invitationId: Schema.String }),
    Schema.Struct({ ...PROPOSAL_LANDED, requestKey: Schema.String, invitationId: Schema.String }),
  ]),
  errors: [error_CLI_USAGE, error_ROLE_PERMISSION_DENIED, error_NETWORK_ERROR, error_WRONG_STATE, error_CANCELLED, error_CLI_DEADLINE],
  refusals: refusalsOf("org.member.invite", [
    // s2.30 (s2:1988): Rex, a Seat without the People hat, invites Priya. He holds no permission in after-s2
    // (s2:175); his manage-people grant comes later, at s2.31.
    [error_ROLE_PERMISSION_DENIED, "after-s2"],
    [error_INVALID_INPUT, "?"],
    [error_WRONG_STATE, "?"],
    [error_NOT_AUTHENTICATED, "?"],
  ]),
});

// `client.org(orgId).members()` (sdk scope-reads.ts:126, adapter.ts:84) forwards organizations.members.list and
// maps each row (member-views.ts:88). The CLI pages the answer itself (org/internal/members.ts:25) and prints
// `{ items, nextCursor }` (:33).
export const operation_org_member_list = defineOperation({
  ...frozenText("org.member.list"),
  was: [
    book("org.member.list"),
    `${ORG}/member/list/command.ts:8`,
    `${ORG}/member/list/execute.ts:6`,
    `${CLI}/org/internal/members.ts:21`,
    `${CLI}/org/internal/members.ts:33`,
    `${CLI}/org/internal/read.ts:218`,
    `${SDK}/organizations/scope-reads.ts:126`,
    `${SDK}/organizations/adapter.ts:84`,
    `${SDK}/organizations/member-views.ts:88`,
    `${ROWS}/organizations/operations.ts:161`,
    `${ROWS}/organizations/schema.ts:120`,
  ],
  priority: "normal",
  implementedBy: rpc_organizations_members_list,
  acceptance: frozenClaims("org.member.list"),
  returns: Schema.Struct({ items: Schema.Array(Member), nextCursor: Schema.NullOr(Schema.String) }),
  errors: SCOPE_ERRORS,
  refusals: refusalsOf("org.member.list", [
    [error_ROLE_PERMISSION_DENIED, "?"],
    [error_NOT_AUTHENTICATED, "?"],
  ]),
});

// The same list (organizations.members.list): the CLI picks the member with the Account ID itself and refuses
// none (INVALID_INPUT) or two (CLI_DEFECT) (get/execute.ts:47, :54, :56). It prints the member.
export const operation_org_member_get = defineOperation({
  ...frozenText("org.member.get"),
  was: [
    book("org.member.get"),
    `${ORG}/member/get/command.ts:7`,
    `${ORG}/member/get/execute.ts:30`,
    `${ORG}/member/get/execute.ts:47`,
    `${ORG}/member/get/execute.ts:54`,
    `${ORG}/member/get/execute.ts:56`,
    `${ORG}/member/get/execute.ts:63`,
    `${CLI}/org/internal/read.ts:218`,
    `${SDK}/organizations/scope-reads.ts:126`,
    `${SDK}/organizations/adapter.ts:84`,
    `${ROWS}/organizations/operations.ts:161`,
    `${SCN}/s1-acme-is-founded.scenario.ts:2271`,
    `${SCN}/s1-acme-is-founded.scenario.ts:1109`,
    "apps/cli/src/auth/actor.ts:59",
  ],
  priority: "normal",
  implementedBy: rpc_organizations_members_list,
  acceptance: frozenClaims("org.member.get"),
  returns: Member,
  errors: [error_CLI_USAGE, error_ROLE_PERMISSION_DENIED, error_INVALID_INPUT, error_CLI_DEFECT],
  refusals: refusalsOf("org.member.get", [
    // s1.39 (s1:2271) reaches CLI_USAGE on the CLI; only its SDK call is refused ROLE_PERMISSION_DENIED.
    [error_ROLE_PERMISSION_DENIED, "?"],
    // s1.39: Sam names Analytical Engines, made at s1.24 after after-s1 is saved. The CLI refuses any `--org` not
    // among his Organizations before a call (auth/actor.ts:59), whether or not it exists, so from after-s1 it does.
    [error_CLI_USAGE, "after-s1"],
    [error_INVALID_INPUT, "?"],
    [error_NOT_AUTHENTICATED, "?"],
  ]),
});

// `members.grant` (sdk member-permissions.ts:65) forwards organizations.members.grant; the CLI reads the Directors
// and hands the proposal to the approval page (member/internal/permission.ts:50, :72). The page lists `change` and
// six `proposal` fields; the CLI prints `change` beside the whole approval hand-over (:79).
export const operation_org_member_grant = defineOperation({
  ...frozenText("org.member.grant"),
  was: [
    book("org.member.grant"),
    `${ORG}/member/grant/command.ts:27`,
    `${ORG}/member/grant/execute.ts:5`,
    `${ORG}/member/internal/permission.ts:50`,
    `${ORG}/member/internal/permission.ts:61`,
    `${ORG}/member/internal/permission.ts:79`,
    `${SDK}/organizations/member-permissions.ts:65`,
    `${ROWS}/organizations/operations.ts:168`,
    `${ROWS}/organizations/seat-permission-schema.ts:37`,
    `${SCN}/s2-the-team-and-its-permissions.scenario.ts:1869`,
    ...PROPOSAL_APPROVAL_WAS,
    ...FOLLOW_WAS,
    ...SCOPE_WAS,
  ],
  priority: "normal",
  implementedBy: rpc_organizations_members_grant,
  acceptance: frozenClaims("org.member.grant"),
  returns: SeatPermissionHandOver,
  errors: FOLLOW_ERRORS,
  refusals: refusalsOf("org.member.grant", [
    [error_ROLE_PERMISSION_DENIED, "?"],
    [error_INVALID_INPUT, "?"],
    // s2.27 (s2:1869) refuses `permission_held` only after s2.25 and s2.26 grant Rex issue-invoices, after
    // after-s2 is saved; no member holds a permission in a saved world.
    [error_WRONG_STATE, "?"],
    [error_WRONG_STATE, "?"],
    [error_FEATURE_NOT_AVAILABLE, "?"],
    [error_NOT_AUTHENTICATED, "?"],
  ]),
});

// `members.revoke` (sdk member-permissions.ts:67) forwards organizations.members.revoke, handed over as grant is.
export const operation_org_member_revoke = defineOperation({
  ...frozenText("org.member.revoke"),
  was: [
    book("org.member.revoke"),
    `${ORG}/member/revoke/command.ts:27`,
    `${ORG}/member/revoke/execute.ts:5`,
    `${ORG}/member/internal/permission.ts:50`,
    `${ORG}/member/internal/permission.ts:61`,
    `${ORG}/member/internal/permission.ts:79`,
    `${SDK}/organizations/member-permissions.ts:67`,
    `${ROWS}/organizations/operations.ts:171`,
    `${ROWS}/organizations/seat-permission-schema.ts:37`,
    ...PROPOSAL_APPROVAL_WAS,
    ...FOLLOW_WAS,
    ...SCOPE_WAS,
  ],
  priority: "normal",
  implementedBy: rpc_organizations_members_revoke,
  acceptance: frozenClaims("org.member.revoke"),
  returns: SeatPermissionHandOver,
  errors: FOLLOW_ERRORS,
  refusals: refusalsOf("org.member.revoke", [
    [error_ROLE_PERMISSION_DENIED, "?"],
    [error_INVALID_INPUT, "?"],
    [error_WRONG_STATE, "?"],
    [error_WRONG_STATE, "?"],
    [error_FEATURE_NOT_AVAILABLE, "?"],
    [error_NOT_AUTHENTICATED, "?"],
  ]),
});

// ═══ Invitations ═════════════════════════════════════════════════════════════════════════════
// `org invite …` and `invite …` (apps/cli/src/commands/org-invite/). Both list commands share one leaf
// (subcommands/list/execute.ts); the transitions share internal/transition.ts, which reads the offer for an
// interactive confirmation, then calls one `client.org(orgId).invitations.*` method (sdk
// organizations/invitations.ts) that forwards one row. `invite …` is the "own" side: its dispatch never passes an
// `--org` (subcommands/shared.ts:53), so decline and accept always resolve the Organization from your own offers,
// ROLE_PERMISSION_DENIED when the invitation is not among them (reads.ts:76, :91). `org invite cancel` and `resend`
// require `--org` and never search (transition.ts:25). The CLI rebuilds the row's ROLE_PERMISSION_DENIED as its
// own failure (internal/recovery.ts:8), and bounds a write by its own deadline, NETWORK_ERROR (internal/shared.ts:122).

const TRANSITION_WAS = [
  `${INVITE}/internal/transition.ts:25`,
  `${INVITE}/internal/transition.ts:44`,
  `${INVITE}/internal/transition.ts:56`,
  `${INVITE}/internal/transition.ts:70`,
  `${INVITE}/internal/reads.ts:76`,
  `${INVITE}/internal/recovery.ts:8`,
  `${INVITE}/internal/shared.ts:122`,
  `${ROWS}/organizations/invitation-schema.ts:197`,
];
const TRANSITION_ERRORS = [error_CLI_USAGE, error_ROLE_PERMISSION_DENIED, error_NETWORK_ERROR];

// With `--org`, `client.org(orgId).invitations.list` (sdk invitations.ts:118) forwards organizations.invitations.list.
// The CLI refuses a `--limit` outside 1 to 100 or a repeated or unknown `--phase` itself, CLI_USAGE, before any call
// (reads.ts:44, :53, :55); of the page's INVALID_INPUT only a foreign `--after` cursor reaches the row.
export const operation_org_invite_list = defineOperation({
  ...frozenText("org.invite.list"),
  was: [
    book("org.invite.list"),
    `${INVITE}/subcommands/list/command.ts:9`,
    `${INVITE}/subcommands/list/command.ts:29`,
    `${INVITE}/subcommands/list/execute.ts:27`,
    `${INVITE}/subcommands/list/execute.ts:43`,
    `${INVITE}/internal/reads.ts:44`,
    `${INVITE}/internal/reads.ts:55`,
    `${INVITE}/internal/recovery.ts:20`,
    `${SDK}/organizations/invitations.ts:118`,
    `${ROWS}/organizations/operations.ts:85`,
    `${ROWS}/organizations/invitation-schema.ts:246`,
    `${SCN}/s1-acme-is-founded.scenario.ts:2302`,
    `${SCN}/s1-acme-is-founded.scenario.ts:1144`,
    "apps/cli/src/auth/actor.ts:59",
  ],
  priority: "normal",
  implementedBy: rpc_organizations_invitations_list,
  acceptance: frozenClaims("org.invite.list"),
  returns: InvitationPage,
  errors: [error_CLI_USAGE, error_ROLE_PERMISSION_DENIED],
  refusals: refusalsOf("org.invite.list", [
    // s1.41 (s1:2302) reaches CLI_USAGE on the CLI; only its SDK call is refused ROLE_PERMISSION_DENIED.
    [error_ROLE_PERMISSION_DENIED, "?"],
    // s1.41: Sam names Analytical Engines, made after after-s1 is saved; the CLI refuses any `--org` not among his
    // Organizations before a call (auth/actor.ts:59), so from after-s1 it does.
    [error_CLI_USAGE, "after-s1"],
    [error_INVALID_INPUT, "?"],
    [error_WRONG_STATE, "?"],
    [error_NOT_AUTHENTICATED, "?"],
  ]),
});

// `invitations.resend` (sdk invitations.ts:148) forwards organizations.invitations.resend.
export const operation_org_invite_resend = defineOperation({
  ...frozenText("org.invite.resend"),
  was: [
    book("org.invite.resend"),
    `${INVITE}/subcommands/resend/command.ts:6`,
    `${INVITE}/subcommands/resend/execute.ts:3`,
    `${SDK}/organizations/invitations.ts:148`,
    `${ROWS}/organizations/operations.ts:127`,
    ...TRANSITION_WAS,
  ],
  priority: "normal",
  implementedBy: rpc_organizations_invitations_resend,
  acceptance: frozenClaims("org.invite.resend"),
  returns: InvitationView,
  errors: TRANSITION_ERRORS,
  refusals: refusalsOf("org.invite.resend", [
    [error_ROLE_PERMISSION_DENIED, "?"],
    [error_WRONG_STATE, "?"],
    [error_RATE_LIMITED, "?"],
    [error_NOT_AUTHENTICATED, "?"],
  ]),
});

// `invitations.cancel` (sdk invitations.ts:140) forwards organizations.invitations.cancel.
export const operation_org_invite_cancel = defineOperation({
  ...frozenText("org.invite.cancel"),
  was: [
    book("org.invite.cancel"),
    `${INVITE}/subcommands/cancel/command.ts:6`,
    `${INVITE}/subcommands/cancel/execute.ts:3`,
    `${SDK}/organizations/invitations.ts:140`,
    `${ROWS}/organizations/operations.ts:120`,
    ...TRANSITION_WAS,
  ],
  priority: "normal",
  implementedBy: rpc_organizations_invitations_cancel,
  acceptance: frozenClaims("org.invite.cancel"),
  returns: InvitationView,
  errors: TRANSITION_ERRORS,
  refusals: refusalsOf("org.invite.cancel", [
    [error_ROLE_PERMISSION_DENIED, "?"],
    [error_WRONG_STATE, "?"],
    [error_NOT_AUTHENTICATED, "?"],
  ]),
});

// `client.orgs.invitations` (sdk scope.ts:170, invitations.ts:221) forwards organizations.invitations.listMine.
// As is, `invite list` always lists your own offers: it shares the leaf with `org invite list`, but its "own"
// dispatch passes no `--org` (subcommands/shared.ts:53), so `explicitOrg` is always null (list/execute.ts:17, :26).
// The page's ROLE_PERMISSION_DENIED (only with `--org`) is unreachable from the CLI; the CLI refuses `--limit` and
// `--phase` itself, CLI_USAGE (reads.ts:44, :55), before the row's INVALID_INPUT.
export const operation_invite_list = defineOperation({
  ...frozenText("invite.list"),
  was: [
    book("invite.list"),
    `${INVITE}/subcommands/list/command.ts:9`,
    `${INVITE}/subcommands/shared.ts:53`,
    `${INVITE}/subcommands/list/execute.ts:17`,
    `${INVITE}/subcommands/list/execute.ts:26`,
    `${INVITE}/subcommands/list/execute.ts:43`,
    `${INVITE}/internal/reads.ts:44`,
    `${SDK}/organizations/scope.ts:170`,
    `${SDK}/organizations/invitations.ts:221`,
    `${ROWS}/organizations/operations.ts:92`,
    `${ROWS}/organizations/invitation-schema.ts:246`,
  ],
  priority: "normal",
  implementedBy: rpc_organizations_invitations_list_mine,
  acceptance: frozenClaims("invite.list"),
  returns: InvitationPage,
  errors: [error_CLI_USAGE],
  refusals: refusalsOf("invite.list", [
    [error_INVALID_INPUT, "?"],
    [error_WRONG_STATE, "?"],
    [error_ROLE_PERMISSION_DENIED, "?"],
    [error_NOT_AUTHENTICATED, "?"],
  ]),
});

// `invitations.accept` (sdk invitations.ts:106) forwards organizations.invitations.accept. The CLI refuses on its own
// a missing or malformed digest in a script (accept/execute.ts:24, :76) and an invitation not among your own offers
// (reads.ts:91 → recovery.ts:8, ROLE_PERMISSION_DENIED). An `inv_kyb_…` id is not accepted at all: the command
// runs a business verification for it instead (`client.verification.forInvitation`, accept/execute.ts:52), whose
// output returns does not describe.
export const operation_invite_accept = defineOperation({
  ...frozenText("invite.accept"),
  was: [
    book("invite.accept"),
    `${INVITE}/subcommands/accept/command.ts:8`,
    `${INVITE}/subcommands/accept/execute.ts:24`,
    `${INVITE}/subcommands/accept/execute.ts:52`,
    `${INVITE}/subcommands/accept/execute.ts:76`,
    `${INVITE}/subcommands/accept/execute.ts:83`,
    `${INVITE}/subcommands/accept/execute.ts:106`,
    `${INVITE}/subcommands/accept/execute.ts:115`,
    `${INVITE}/internal/reads.ts:91`,
    `${INVITE}/internal/recovery.ts:8`,
    `${SDK}/organizations/invitations.ts:106`,
    `${ROWS}/organizations/operations.ts:106`,
    `${ROWS}/organizations/invitation-schema.ts:197`,
  ],
  priority: "normal",
  implementedBy: rpc_organizations_invitations_accept,
  acceptance: frozenClaims("invite.accept"),
  returns: InvitationView,
  errors: TRANSITION_ERRORS,
  refusals: refusalsOf("invite.accept", [
    [error_ROLE_PERMISSION_DENIED, "?"],
    [error_WRONG_STATE, "?"],
    [error_NOT_AUTHENTICATED, "?"],
  ]),
});

// `invitations.decline` (sdk invitations.ts:132) forwards organizations.invitations.decline.
export const operation_invite_decline = defineOperation({
  ...frozenText("invite.decline"),
  was: [
    book("invite.decline"),
    `${INVITE}/subcommands/decline/command.ts:6`,
    `${INVITE}/subcommands/decline/execute.ts:3`,
    `${SDK}/organizations/invitations.ts:132`,
    `${ROWS}/organizations/operations.ts:113`,
    ...TRANSITION_WAS,
  ],
  priority: "normal",
  implementedBy: rpc_organizations_invitations_decline,
  acceptance: frozenClaims("invite.decline"),
  returns: InvitationView,
  errors: TRANSITION_ERRORS,
  refusals: refusalsOf("invite.decline", [
    [error_ROLE_PERMISSION_DENIED, "?"],
    [error_WRONG_STATE, "?"],
    [error_NOT_AUTHENTICATED, "?"],
  ]),
});

// ═══ Allowances ══════════════════════════════════════════════════════════════════════════════
// `org allowance …` (apps/cli/src/commands/org/subcommands/allowance/) has two implementations side by side:
// a v4 allowance (a budget under a hat, id `allowance_…`, design W2) and a pre-v4 Roles Permission, which the CLI
// prepares through `client.approvals.prepare` (internal/write-execution.ts:117). The CLI picks v4 by the id's
// shape or the policy's (v4-commands.ts:32, v4-create.ts) and, for list, by trying v4 first and falling back on
// `pre_v4` (v4-commands.ts:216). Every Organization in the scenario worlds is a v4 company, and the pages' rows
// are the v4 ones, so implementedBy and returns follow the v4 path; the Roles path is recorded here only. The pages'
// returns describe the Roles shapes (permissionId, revision, currentPolicy, roleKey, command.*, value), which the
// v4 path does not print: that gap is a finding. The pages' CAPABILITY_UNAVAILABLE (beta or production) is refused
// before any session on another command (s1.23); no step runs an allowance command there.

const V4_WRITE_WAS = [
  `${ORG}/allowance/internal/v4-commands.ts:94`,
  `${ORG}/allowance/internal/v4-commands.ts:113`,
  `${ORG}/allowance/internal/v4-commands.ts:139`,
  `${ORG}/allowance/internal/v4-commands.ts:155`,
  `${ORG}/allowance/internal/v4-commands.ts:196`,
  `${SDK}/permissions/allowance-dispatch.ts:45`,
  `${SDK}/permissions/allowance-writes.ts:180`,
  `${SDK}/permissions/allowance-writes.ts:246`,
  `${ROWS}/permissions/allowance-schema.ts:156`,
  `${ROWS}/organizations/proposal-operations.ts:109`,
];

// v4: `allowances.listBudgets` (sdk permissions/commands.ts:217, allowance-writes.ts:259) forwards
// permissions.allowances.list; the CLI prints its answer (v4-commands.ts:216). Pre-v4: `permissions.list`
// (permissions.authorities.list) and a budget-left read per allowance, printed as `{ permissions, allowances }`
// (list/execute.ts:52).
export const operation_org_allowance_list = defineOperation({
  ...frozenText("org.allowance.list"),
  was: [
    book("org.allowance.list"),
    `${ORG}/allowance/subcommands/list/command.ts:7`,
    `${ORG}/allowance/subcommands/list/execute.ts:26`,
    `${ORG}/allowance/subcommands/list/execute.ts:52`,
    `${ORG}/allowance/internal/v4-commands.ts:216`,
    `${ORG}/allowance/internal/scope.ts:58`,
    `${SDK}/permissions/commands.ts:217`,
    `${SDK}/permissions/allowance-writes.ts:259`,
    `${ROWS}/permissions/allowance-operations.ts:97`,
    `${ROWS}/permissions/allowance-schema.ts:210`,
  ],
  priority: "normal",
  implementedBy: rpc_permissions_allowances_list,
  acceptance: frozenClaims("org.allowance.list"),
  returns: Schema.Struct({ items: Schema.Array(ListedAllowance), nextCursor: Schema.Null }),
  errors: SCOPE_ERRORS,
  refusals: refusalsOf("org.allowance.list", [
    [error_CAPABILITY_UNAVAILABLE, "?"],
    [error_NOT_AUTHENTICATED, "?"],
    [error_ROLE_PERMISSION_DENIED, "?"],
    [error_INVALID_INPUT, "?"],
    [error_WRONG_STATE, "?"],
  ]),
});

// v4: `allowances.getBudget` (sdk permissions/commands.ts:218) reads the whole list (permissions.allowances.list)
// and picks the id: one row. The CLI refuses a null answer itself, INVALID_INPUT (v4-commands.ts:262). Pre-v4:
// `permissions.get` (permissions.authorities.list), refused alike (get/execute.ts:24).
export const operation_org_allowance_get = defineOperation({
  ...frozenText("org.allowance.get"),
  was: [
    book("org.allowance.get"),
    `${ORG}/allowance/subcommands/get/command.ts:6`,
    `${ORG}/allowance/subcommands/get/execute.ts:24`,
    `${ORG}/allowance/subcommands/get/execute.ts:36`,
    `${ORG}/allowance/internal/v4-commands.ts:249`,
    `${ORG}/allowance/internal/v4-commands.ts:262`,
    `${SDK}/permissions/commands.ts:218`,
    `${ROWS}/permissions/allowance-operations.ts:97`,
    `${ROWS}/permissions/allowance-schema.ts:202`,
    `${SCN}/s2-the-team-and-its-permissions.scenario.ts:2173`,
    ...SCOPE_WAS,
  ],
  priority: "normal",
  implementedBy: rpc_permissions_allowances_list,
  acceptance: frozenClaims("org.allowance.get"),
  returns: ListedAllowance,
  errors: [error_CLI_USAGE, error_ROLE_PERMISSION_DENIED, error_INVALID_INPUT],
  refusals: refusalsOf("org.allowance.get", [
    [error_CAPABILITY_UNAVAILABLE, "?"],
    [error_NOT_AUTHENTICATED, "?"],
    [error_ROLE_PERMISSION_DENIED, "?"],
    // s2.35 (s2:2173): Dana reads an allowance id Acme never made; none has it in after-s2 either.
    [error_INVALID_INPUT, "after-s2"],
    [error_WRONG_STATE, "?"],
  ]),
});

// v4: `allowances.create` (sdk allowance-create.ts:247) forwards permissions.allowances.create, checks the answer
// against the ask, then opens the proposer's approval (organizations.proposals.requestApproval) (:173): two rows,
// so a flow. The CLI hands the approval over (v4-create.ts:63, :83, :121).
export const operation_org_allowance_create = defineOperation({
  ...frozenText("org.allowance.create"),
  was: [
    book("org.allowance.create"),
    `${ORG}/allowance/subcommands/create/command.ts:15`,
    `${ORG}/allowance/subcommands/create/execute.ts:20`,
    `${ORG}/allowance/internal/v4-create.ts:63`,
    `${ORG}/allowance/internal/v4-create.ts:83`,
    `${ORG}/allowance/internal/v4-create.ts:121`,
    `${ORG}/allowance/internal/v4-create.ts:168`,
    `${SDK}/permissions/allowance-create.ts:173`,
    `${SDK}/permissions/allowance-create.ts:247`,
    `${ROWS}/permissions/allowance-operations.ts:43`,
    `${ROWS}/permissions/allowance-schema.ts:61`,
    `${ROWS}/organizations/proposal-operations.ts:109`,
    `${SCN}/s2-the-team-and-its-permissions.scenario.ts:1081`,
    ...PROPOSAL_APPROVAL_WAS,
    ...FOLLOW_WAS,
    ...SCOPE_WAS,
  ],
  priority: "normal",
  implementedBy: flow_client_org_allowances_create,
  acceptance: frozenClaims("org.allowance.create"),
  returns: Schema.Struct(ALLOWANCE_WRITE),
  errors: FOLLOW_ERRORS,
  refusals: refusalsOf("org.allowance.create", [
    [error_CAPABILITY_UNAVAILABLE, "?"],
    [error_NOT_AUTHENTICATED, "?"],
    [error_ROLE_PERMISSION_DENIED, "?"],
    [error_INVALID_INPUT, "?"],
    [error_WRONG_STATE, "?"],
    [error_ROLE_CONFLICT, "?"],
  ]),
});

// v4: `allowances.change` with an allowance id (sdk allowance-dispatch.ts:45) forwards permissions.allowances.change,
// checks it, then opens the proposer's approval (allowance-writes.ts:180): two rows, so a flow.
export const operation_org_allowance_change = defineOperation({
  ...frozenText("org.allowance.change"),
  was: [
    book("org.allowance.change"),
    `${ORG}/allowance/subcommands/change/command.ts:15`,
    `${ORG}/allowance/subcommands/change/execute.ts:15`,
    `${ORG}/allowance/internal/v4-commands.ts:61`,
    `${ROWS}/permissions/allowance-operations.ts:64`,
    `${SCN}/s2-the-team-and-its-permissions.scenario.ts:2189`,
    ...V4_WRITE_WAS,
    ...PROPOSAL_APPROVAL_WAS,
    ...FOLLOW_WAS,
    ...SCOPE_WAS,
  ],
  priority: "normal",
  implementedBy: flow_client_org_allowances_change,
  acceptance: frozenClaims("org.allowance.change"),
  returns: Schema.Struct({ ...ALLOWANCE_WRITE, command: AllowanceCommand }),
  errors: FOLLOW_ERRORS,
  // s2.36 (s2:2189) is refused CHILDREN_EXCEED_PARENT, a code the page does not list.
  refusals: refusalsOf("org.allowance.change", [
    [error_CAPABILITY_UNAVAILABLE, "?"],
    [error_NOT_AUTHENTICATED, "?"],
    [error_ROLE_PERMISSION_DENIED, "?"],
    [error_INVALID_INPUT, "?"],
    [error_WRONG_STATE, "?"],
  ]),
});

// v4: `allowances.assign` with an allowance id (sdk allowance-dispatch.ts:61) forwards permissions.allowances.assign,
// then opens the proposer's approval: a flow.
export const operation_org_allowance_assign = defineOperation({
  ...frozenText("org.allowance.assign"),
  was: [
    book("org.allowance.assign"),
    `${ORG}/allowance/subcommands/assign/command.ts:17`,
    `${ORG}/allowance/subcommands/assign/execute.ts:15`,
    `${SDK}/permissions/allowance-dispatch.ts:61`,
    `${ROWS}/permissions/allowance-operations.ts:75`,
    `${SCN}/s2-the-team-and-its-permissions.scenario.ts:2212`,
    ...V4_WRITE_WAS,
    ...PROPOSAL_APPROVAL_WAS,
    ...FOLLOW_WAS,
    ...SCOPE_WAS,
  ],
  priority: "normal",
  implementedBy: flow_client_org_allowances_assign,
  acceptance: frozenClaims("org.allowance.assign"),
  returns: Schema.Struct({ ...ALLOWANCE_WRITE, command: AllowanceCommand }),
  errors: FOLLOW_ERRORS,
  refusals: refusalsOf("org.allowance.assign", [
    [error_CAPABILITY_UNAVAILABLE, "?"],
    [error_NOT_AUTHENTICATED, "?"],
    [error_ROLE_PERMISSION_DENIED, "?"],
    // As is, a member who already wears the hat is refused WRONG_STATE `wears_hat`, not the INVALID_INPUT this
    // `when` gives for an Account that already holds it: s2.37 (s2:2212) shows it from after-s2's state.
    [error_INVALID_INPUT, "?"],
    // s2.37 reaches WRONG_STATE by `wears_hat`, which this `when` does not describe.
    [error_WRONG_STATE, "?"],
    [error_ROLE_CONFLICT, "?"],
  ]),
});

// v4: `allowances.revoke` with an allowance id (sdk allowance-dispatch.ts:77) forwards permissions.allowances.revoke,
// then opens the proposer's approval: a flow. As is the v4 command takes the allowance id and `--member`, not the
// assignment id the page describes (revoke/execute.ts:14).
export const operation_org_allowance_revoke = defineOperation({
  ...frozenText("org.allowance.revoke"),
  was: [
    book("org.allowance.revoke"),
    `${ORG}/allowance/subcommands/revoke/command.ts:15`,
    `${ORG}/allowance/subcommands/revoke/execute.ts:14`,
    `${SDK}/permissions/allowance-dispatch.ts:77`,
    `${ROWS}/permissions/allowance-operations.ts:86`,
    `${SCN}/s2-the-team-and-its-permissions.scenario.ts:2235`,
    ...V4_WRITE_WAS,
    ...PROPOSAL_APPROVAL_WAS,
    ...FOLLOW_WAS,
    ...SCOPE_WAS,
  ],
  priority: "normal",
  implementedBy: flow_client_org_allowances_revoke,
  acceptance: frozenClaims("org.allowance.revoke"),
  returns: Schema.Struct({ ...ALLOWANCE_WRITE, command: AllowanceCommand }),
  errors: FOLLOW_ERRORS,
  refusals: refusalsOf("org.allowance.revoke", [
    [error_CAPABILITY_UNAVAILABLE, "?"],
    [error_NOT_AUTHENTICATED, "?"],
    [error_ROLE_PERMISSION_DENIED, "?"],
    [error_INVALID_INPUT, "?"],
    // s2.38 (s2:2235) reaches WRONG_STATE by `does_not_wear_hat` (Rex never held it), which this `when` does not describe.
    [error_WRONG_STATE, "?"],
  ]),
});

// Pre-v4 only: the CLI previews the replacement, then calls `client.approvals.prepare` with a `replace` permission
// write (write-execution.ts:117), the flow ../payments/flows.ts books; the page's row,
// permissions.replacements.prepareExecution, is reached through it. The CLI checks the prepared write against its
// preview in the callback and refuses a changed session (NOT_AUTHENTICATED) or target (INVALID_INPUT) itself
// (:102, :109), then follows the approval (payment/internal/approval-writes.ts:42 → approval.ts:159), with its
// WRONG_STATE, CANCELLED and CLI_DEADLINE. It prints the open approval with the request key, the approval as it ended, or a command already
// sent (:174, :184, :208; command-recovery.ts:77), not the execution fields the page lists. s11.22 (s11:1314) on
// v4 Acme is refused FEATURE_NOT_AVAILABLE, a code the page does not list.
export const operation_org_allowance_replace = defineOperation({
  ...frozenText("org.allowance.replace"),
  was: [
    book("org.allowance.replace"),
    `${ORG}/allowance/subcommands/replace/command.ts:6`,
    `${ORG}/allowance/subcommands/replace/execute.ts:10`,
    `${ORG}/allowance/internal/write-preview.ts:48`,
    `${ORG}/allowance/internal/write-preview.ts:51`,
    `${ORG}/allowance/internal/write-execution.ts:102`,
    `${ORG}/allowance/internal/write-execution.ts:109`,
    `${ORG}/allowance/internal/write-execution.ts:117`,
    `${ORG}/allowance/internal/write-execution.ts:174`,
    `${ORG}/allowance/internal/write-execution.ts:184`,
    `${ORG}/allowance/internal/write-execution.ts:208`,
    `${ORG}/allowance/internal/command-recovery.ts:77`,
    `${CLI}/payment/internal/approval.ts:49`,
    `${CLI}/payment/internal/approval-writes.ts:42`,
    ...FOLLOW_WAS,
    `${SDK}/permissions/commands.ts:199`,
    `${SCN}/s11-paid-by-link.scenario.ts:1314`,
  ],
  priority: "normal",
  implementedBy: flow_client_approvals_prepare,
  acceptance: frozenClaims("org.allowance.replace"),
  returns: Schema.Union([
    Schema.Struct({
      status: Schema.Literal("awaiting_approval"),
      approvalId: Schema.String,
      approvalUrl: Schema.String,
      paymentIds: Schema.Array(Schema.String),
      expiresAt: Schema.Number,
      next: Next,
      requestKey: Schema.String,
    }),
    // The approval's outcome and the command view are the Roles command shapes, too deep to transcribe.
    Schema.Struct({ approval: Schema.Unknown, requestKey: Schema.String, command: Schema.optionalKey(Schema.Unknown) }),
    Schema.Struct({
      status: Schema.Literals(["already_applied", "already_sent"]),
      requestKey: Schema.String,
      command: Schema.Unknown,
    }),
  ]),
  errors: [...FOLLOW_ERRORS, error_NOT_AUTHENTICATED, error_INVALID_INPUT],
  refusals: refusalsOf("org.allowance.replace", [
    [error_CAPABILITY_UNAVAILABLE, "?"],
    [error_NOT_AUTHENTICATED, "?"],
    [error_ROLE_PERMISSION_DENIED, "?"],
    [error_INVALID_INPUT, "?"],
    [error_WRONG_STATE, "?"],
  ]),
});
