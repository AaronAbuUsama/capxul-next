// The as-is Core SDK flows of the old organizations concept, part one: every method of
// `client.org(orgId)` and `client.orgs` (packages/sdk/src/organizations/) for the setups, workspaces,
// treasuries, members, roles, reads and invitations areas that composes more than one backend call
// or does local signing. Methods that forward one rpc are listed in the comment at the end of this
// file, with the rpc each forwards. Part two's methods (proposals, directors, equity, rounds,
// votes) are booked in flows-governance.ts.
//
// Paths in `was` are relative to the old repository root (/home/user/factory).

import { Schema } from "effect";
import { defineFlow } from "../../../packages/book/src/index.ts";
import { component_core_sdk } from "../shared/foundation.ts";
import { integration_openfort } from "../shared/external.ts";
import {
  error_CANCELLED,
  error_CAPABILITY_UNAVAILABLE,
  error_INVALID_INPUT,
  error_NOT_AUTHENTICATED,
  error_NOT_IMPLEMENTED,
  error_PROVIDER_ERROR,
  error_PROVIDER_RESPONSE_INVALID,
  error_SIGNER_REJECTED,
  error_UNKNOWN,
  error_WRONG_STATE,
} from "../shared/vocabulary.ts";
import {
  rpc_organizations_setups_get,
  rpc_organizations_setups_prepare_authorization,
  rpc_organizations_setups_submit_authorization,
} from "./setups.ts";
import { rpc_organizations_treasuries_read } from "./treasuries.ts";
import { rpc_organizations_workspaces_list } from "./workspaces.ts";
import { rpc_organizations_invitations_invite } from "./invitations.ts";
import { rpc_organizations_proposals_request_approval } from "./proposals.ts";
import { rpc_permissions_configurations_propose } from "../permissions/configurations.ts";
import { rpc_accounts_approvals_approve } from "../accounts/approvals.ts";

const SDK = "packages/sdk/src/organizations";
const signerCalls = [integration_openfort.c.getAddress, integration_openfort.c.signUserOpHash];

/** `InvocationControls` (platform/actor/controls.ts): an AbortSignal and observation ids, not data. */
const Controls = Schema.optionalKey(
  Schema.Struct({
    signal: Schema.optionalKey(Schema.Unknown),
    timeoutMs: Schema.optionalKey(Schema.Number),
    deadlineMs: Schema.optionalKey(Schema.Number),
    correlation_id: Schema.optionalKey(Schema.String),
    journey_id: Schema.optionalKey(Schema.String),
  }),
);

// ── setups ──────────────────────────────────────────────────────────────────────────────────

export const flow_client_org_setup_authorize = defineFlow({
  id: "client.org.setup.authorize",
  title: "Authorize an Organization's setup: prepare, check, sign, submit",
  about:
    "client.org(orgId).setup.authorize runs `ConvexOrganizationSetupAdapter.authorize` through `invokeSetup` (no adapter: " +
    "NOT_IMPLEMENTED; a throw: UNKNOWN). It reads the setup first and returns it untouched unless it is " +
    "awaitingAuthorization. It needs the configured signer (none: CAPABILITY_UNAVAILABLE), asks it for the owner " +
    "address, prepares the bootstrap, checks the prepared reply against the Organization, the signer and the founder's " +
    "authorities, signs the SafeOp digest, and submits once. The backend accepts before it sends, so a lost submit " +
    "answer is not taken as a failure: the setup is read again and returned when it is no longer awaiting " +
    "authorization. An aborted signal is CANCELLED between every step. Input: the orgId the scope closed over and the " +
    "controls. Output: the normalized OrganizationSetup, too deep to transcribe.",
  component: component_core_sdk,
  sdk: "client.org.setup.authorize",
  input: Schema.Struct({ orgId: Schema.String, options: Controls }),
  output: Schema.Unknown,
  steps: [
    { name: "read", rpc: rpc_organizations_setups_get, about: "`this.get(orgId)`: a setup not awaitingAuthorization (or a failed read) is returned as it is." },
    { name: "signer-address", local: "sign", about: "CapxulSigner.getAddress(); a throw becomes SIGNER_REJECTED or PROVIDER_ERROR (`signerFailure`)." },
    { name: "prepare", rpc: rpc_organizations_setups_prepare_authorization, about: "Sends { orgId }; a refusal is returned as it is." },
    {
      name: "check",
      local: "build",
      about: "`validatePrepared`: orgId and expected signer, the userOp sender is the founder's Account, a 32-byte digest; else INVALID_INPUT naming prepareAuthorization.",
    },
    { name: "sign", local: "sign", about: "CapxulSigner.signUserOpHash(digest): the SafeOp digest the backend prepared." },
    { name: "submit", rpc: rpc_organizations_setups_submit_authorization, about: "Sends { orgId, preparationId, userOp, signature } once." },
    {
      name: "read-after-lost-submit",
      rpc: rpc_organizations_setups_get,
      about: "Only when the submit failed: the durable setup is returned if it moved past awaitingAuthorization, else the submit's error.",
    },
    { name: "normalize", local: "build", about: "`setupFromReply`: a null reply is INVALID_INPUT (setup not found); else the setup record." },
  ],
  errors: [
    error_CANCELLED,
    error_CAPABILITY_UNAVAILABLE,
    error_NOT_IMPLEMENTED,
    error_INVALID_INPUT,
    error_SIGNER_REJECTED,
    error_PROVIDER_ERROR,
    error_PROVIDER_RESPONSE_INVALID,
    error_UNKNOWN,
  ],
  calls: signerCalls,
  spans: [],
  was: [
    `${SDK}/scope.ts:247`,
    `${SDK}/setup-adapter.ts:130`,
    `${SDK}/setup-adapter.ts:136`,
    `${SDK}/setup-adapter.ts:140`,
    `${SDK}/setup-adapter.ts:142`,
    `${SDK}/setup-adapter.ts:151`,
    `${SDK}/setup-adapter.ts:156`,
    `${SDK}/setup-adapter.ts:167`,
    `${SDK}/setup-checks.ts:21`,
    `${SDK}/setup-checks.ts:55`,
    `${SDK}/setup-checks.ts:101`,
    `${SDK}/setup-checks.ts:118`,
  ],
});

// ── workspaces and treasuries ───────────────────────────────────────────────────────────────

export const flow_client_org_account_get = defineFlow({
  id: "client.org.account.get",
  title: "The Organization Account: its balances and its Safe address",
  about:
    "client.org(orgId).account.get (R08 #1966) runs one observed compound under `org.account.get`: the treasury read " +
    "(treasuries.read through the OrgPort, a fresh $0 treasury without one), then the Organization list " +
    "(workspaces.list), both as children of this operation's span; it answers the treasury's id and balances with the " +
    "listed Organization's account address, or null when the list does not hold it. An aborted signal is CANCELLED " +
    "before anything runs; the children own cancellation and the timeout.",
  component: component_core_sdk,
  sdk: "client.org.account.get",
  input: Schema.Struct({ orgId: Schema.String, options: Controls }),
  output: Schema.Struct({ id: Schema.String, address: Schema.NullOr(Schema.String), balances: Schema.Unknown }),
  steps: [
    { name: "treasury", rpc: rpc_organizations_treasuries_read, about: "`readTreasuryProgram`: the live balances; a failure ends the flow." },
    { name: "organizations", rpc: rpc_organizations_workspaces_list, about: "`listOrgsProgram`: the caller's Organizations; a failure ends the flow." },
    { name: "project", local: "build", about: "The treasury's id and balances, and the address of the listed Organization with this id." },
  ],
  errors: [error_CANCELLED, error_UNKNOWN],
  calls: [],
  spans: ["org.account.get"],
  was: [`${SDK}/scope-reads.ts:84`, `${SDK}/scope-reads.ts:95`, `${SDK}/programs.ts:71`, `${SDK}/programs.ts:156`, `${SDK}/scope.ts:115`],
});

// ── invitations ─────────────────────────────────────────────────────────────────────────────

const INVITE_WAS = [
  `${SDK}/invitations.ts:104`,
  `${SDK}/invitations.ts:167`,
  `${SDK}/invite-execution.ts:65`,
  `${SDK}/invite-proposals.ts:59`,
  `${SDK}/invite-proposals.ts:136`,
  `${SDK}/invite-proposals.ts:189`,
];

export const flow_client_org_invitations_invite = defineFlow({
  id: "client.org.invitations.invite",
  title: "Invite: author the offer, propose its configuration, approve it as a Director",
  about:
    "client.org(orgId).invitations.invite runs `executeInvite` as one observed compound (span organizations.invitations.invite, " +
    "every hop its child) under the Organization's verified " +
    "scope. It needs the actor, chain and signer (else NOT_IMPLEMENTED) and a session (else NOT_AUTHENTICATED). It authors " +
    "the offer (invitations.invite); a replay of an authorized or ended offer, or a Seat-only one, is returned with no " +
    "signer touched. Otherwise it proposes the invitation's configuration to the Directors (Budgets A: never the " +
    "inviter's single signature), checks the proposal is exactly this invitation's, hands { invitationId, commandId } to " +
    "onPrepared, opens the proposer's approval, then signs it with the configured signer and approves it as " +
    "`org(id).proposals.approve` does. A 1-of-N Safe executes on that approval; otherwise the offer stays authorizing. An " +
    "abort before the approval is signed forwards no signature (CANCELLED).",
  component: component_core_sdk,
  sdk: "client.org.invitations.invite",
  input: Schema.Struct({
    orgId: Schema.String,
    /** `InviteInput` (protocol invitation-schema.ts): request key, recipient, grants, agent mark; too deep to transcribe. */
    input: Schema.Unknown,
    options: Schema.optionalKey(Schema.Struct({ onPrepared: Schema.optionalKey(Schema.Unknown), signal: Schema.optionalKey(Schema.Unknown) })),
  }),
  output: Schema.Unknown,
  steps: [
    { name: "session", local: "cache", about: "`sessionForWrite`: the held session's email; none is NOT_AUTHENTICATED." },
    { name: "author", rpc: rpc_organizations_invitations_invite, about: "`authorInvitation`: the offer, or the same request key's replay." },
    { name: "propose", rpc: rpc_permissions_configurations_propose, about: "Only for an authorizing offer: { orgId, commandId, note: `Invite <to>` }." },
    { name: "verify", local: "build", about: "`verifiedConfigurationProposal`: the proposal names this invitation and command; else INVALID_INPUT." },
    { name: "on-prepared", local: "wait", about: "Awaits the caller's onPrepared({ invitationId, commandId }); a throw ends the flow." },
    { name: "open-approval", rpc: rpc_organizations_proposals_request_approval, about: "{ orgId, proposalId }: the proposing Director's approval." },
    { name: "signer-address", local: "sign", about: "CapxulSigner.getAddress(); a throw becomes SIGNER_REJECTED or PROVIDER_ERROR." },
    { name: "check-approval", local: "build", about: "`signOwnerApproval`: the approval's signer is this address; else INVALID_INPUT." },
    { name: "sign", local: "sign", about: "CapxulSigner.signUserOpHash(approval.operation.digest)." },
    { name: "approve", rpc: rpc_accounts_approvals_approve, about: "{ approvalId, signature }; the authored view is returned." },
  ],
  errors: [
    error_CANCELLED,
    error_NOT_IMPLEMENTED,
    error_NOT_AUTHENTICATED,
    error_INVALID_INPUT,
    error_SIGNER_REJECTED,
    error_PROVIDER_ERROR,
    error_UNKNOWN,
  ],
  calls: signerCalls,
  spans: ["organizations.invitations.invite"],
  was: [...INVITE_WAS, `${SDK}/invite-execution.ts:164`, `${SDK}/invite-execution.ts:206`, `${SDK}/proposals.ts:167`],
});

export const flow_client_org_invitations_propose = defineFlow({
  id: "client.org.invitations.propose",
  title: "Author an invitation and propose its configuration, for an approval page",
  about:
    "client.org(orgId).invitations.propose runs `proposeInvitation` in the same compound shape as invite, for a caller " +
    "who approves on the approval page: author, propose the configuration, verify, onPrepared, open the proposer's " +
    "approval. Nothing is signed. An offer with nothing to set up (not authorizing, or no command) is WRONG_STATE naming " +
    "permissions.configurations.propose. Accounts' permission approvals run it too (accounts/permission-approvals.ts:167).",
  component: component_core_sdk,
  sdk: "client.org.invitations.propose",
  input: Schema.Struct({
    orgId: Schema.String,
    input: Schema.Unknown,
    options: Schema.optionalKey(Schema.Struct({ onPrepared: Schema.optionalKey(Schema.Unknown), signal: Schema.optionalKey(Schema.Unknown) })),
  }),
  /** `InvitationProposal` (invite-proposals.ts:32): status, approval, request key, invitation, command and proposal. */
  output: Schema.Unknown,
  steps: [
    { name: "session", local: "cache", about: "`sessionForWrite`: none is NOT_AUTHENTICATED." },
    { name: "author", rpc: rpc_organizations_invitations_invite, about: "`authorInvitation`; nothing to propose is WRONG_STATE (`nothingToPropose`)." },
    { name: "propose", rpc: rpc_permissions_configurations_propose, about: "{ orgId, commandId, note }." },
    { name: "verify", local: "build", about: "The proposal is exactly this invitation's; else INVALID_INPUT." },
    { name: "on-prepared", local: "wait", about: "Awaits onPrepared; a throw ends the flow." },
    { name: "open-approval", rpc: rpc_organizations_proposals_request_approval, about: "The proposer's approval, returned unsigned." },
  ],
  errors: [error_CANCELLED, error_NOT_IMPLEMENTED, error_NOT_AUTHENTICATED, error_INVALID_INPUT, error_WRONG_STATE, error_UNKNOWN],
  calls: [],
  spans: ["permissions.configurations.propose"],
  was: [...INVITE_WAS, `${SDK}/invitations.ts:105`, `${SDK}/invite-execution.ts:111`],
});

// ── Methods that forward one rpc: no flow; the operation names the rpc ───────────────────────
//
// client.orgs()                          → organizations.workspaces.list (scope.ts:133, programs.ts:156); CANCELLED
//                                          when the signal is already aborted; no port answers an empty page.
// client.orgs.invitations()              → organizations.invitations.list-mine (invitations.ts:220).
// client.org(id).setup.get               → organizations.setups.get (setup-adapter.ts:82).
// client.org(id).setup.subscribe         → organizations.setups.get as a live subscription (setup-adapter.ts:176);
//                                          a lost connection notifies SETUP_CONNECTION_LOST (NETWORK_ERROR).
// client.org(id).setup.resume            → organizations.setups.resume (setup-adapter.ts:118).
// client.org(id).me                      → organizations.workspaces.me (me.ts:156).
// client.org(id).profile.get             → organizations.workspaces.list, projected to the one Organization;
//                                          absent is INVALID_INPUT (programs.ts:93).
// client.org(id).profile.depositInstructions → organizations.workspaces.list, projected to the Safe's deposit
//                                          instructions (programs.ts:107).
// client.org(id).treasury                → organizations.treasuries.read (scope.ts:115, programs.ts:71).
// client.org(id).members()               → organizations.members.list (scope-reads.ts:126).
// client.org(id).members.grant / revoke  → organizations.members.grant / revoke (member-permissions.ts:41).
// client.org(id).roles()                 → organizations.roles.list (scope-reads.ts:148).
// client.org(id).auditLog                → no rpc: NOT_IMPLEMENTED (scope-reads.ts:170).
// client.org(id).invitations.preview / list / get / accept / decline / cancel / resend / retry
//                                        → organizations.invitations.<same> (invitations.ts:95-160), each refusing a
//                                          reply for another Organization (`scopeRefusal`, UNKNOWN).
// client.org(id).invitations.subscribe   → organizations.invitations.get as a live subscription
//                                          (invitation-subscription.ts:21).
//
// Not booked here: client.onboarding's Organization begin and listMine (profiles/organization-onboarding.ts,
// profiles/onboardings.ts) run organizations.setups.begin and list-mine from the profiles folder of the SDK.
