// The organizations concept's own door, as it is: every function packages/backend/src/organizations/
// index.ts exports that runs inside its caller's Convex transaction (it takes the caller's QueryCtx
// or MutationCtx and throws CapxulErrors), plus the four door functions that run from the caller's
// action instead, whose `about` says so: `requireSafeOwner`, `settleOrganizationProposals`,
// `readTreasuryTarget` and (in-transaction, but with a queued email) `deliverInvitationOutcome`.
//
// Not booked, because they are pure rules or views with no table or ctx: `ownerProposal`,
// `proposalView`, `invitationAssignmentId`, `invitationBudgetId`, `invitationPolicyDigest`,
// `invitationConfigurationStatus`, `invitationExpiredForReplacement`, `invitationGrantDisposition`,
// `invitationHasAppliedConfiguration`, `invitationMayCarryGrant`, `invitationReplacementState`,
// `readInvitationConfigurationRequest`, `replacementInvitationCleanupPurpose`,
// `replacementInvitationNeedsCleanup`, `replacementInvitationNeedsGrant`,
// `requireAuthorizingInvitationOffer`, `requireInvitationCompensationCleanup`,
// `requireInvitationDisableCleanup`, `invitationRequest`, `storedInvitationRequest` (index.ts:107-129),
// and the types the door re-exports.
//
// Reads and writes are transitive within organizations: a procedure lists the tables its own helpers
// touch. Another concept's function it calls is an `invokes` of that concept's procedure, by its
// conventional name. Inputs that are a whole stored row or an admission object are `Schema.Unknown`.

import { Schema } from "effect";
import { defineProcedure } from "../../../packages/book/src/index.ts";
import { concept_organizations } from "../shared/foundation.ts";
import {
  error_ENV_MISSING,
  error_INVALID_INPUT,
  error_PROFILE_NOT_FOUND,
  error_PROVIDER_ERROR,
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
  machine_org_safe_proposal,
  machine_seat_permission_change,
  table_org_equities,
  table_org_equity_issues,
  table_org_invitations,
  table_org_lifecycles,
  table_org_members,
  table_org_option_grants,
  table_org_rounds,
  table_org_safe_proposals,
  table_org_safe_rounds,
  table_org_share_transfers,
  table_orgs,
  table_seat_permission_changes,
  table_seat_permissions,
} from "./data.ts";
import {
  procedure_accounts_read_attached_account_for_safe_in_tx,
  procedure_accounts_read_first_proof_account_chain_in_tx,
  procedure_accounts_read_founder_account_state_in_tx,
} from "../accounts/procedures.ts";
import { procedure_media_find_image_refusal } from "../media/procedures.ts";
import {
  procedure_parties_ensure_org_party,
  procedure_parties_party_by_handle,
  procedure_parties_read_claimed_organization_party_in_tx,
  procedure_parties_read_invitation_delivery_address_in_tx,
} from "../parties/procedures.ts";
import { procedure_permissions_org_bootstrap_authority_usable } from "../permissions/procedures.ts";
import { procedure_requests_document_checkout_origin } from "../requests/procedures.ts";
import {
  procedure_profiles_read_first_proof_profile_email_in_tx,
  procedure_profiles_read_founder_profile_identity_in_tx,
  procedure_profiles_read_profile_account_binding_in_tx,
} from "../profiles/procedures.ts";

const O = "packages/backend/src/organizations";
const DOOR = `${O}/index.ts`;
const PART = `${O}/reads/participation.ts`;
const ORGS = `${O}/reads/organizations.ts`;
const OFFERS = `${O}/invitations/reads/offers.ts`;
const PHASES = `${O}/invitations/writes/phases.ts`;

const S = Schema.String;
const N = Schema.Number;
const B = Schema.Boolean;
const U = Schema.Unknown;
const NullOr = Schema.NullOr;
const Strings = Schema.Array(S);

const none = { writes: [], drives: [], invokes: [], emits: [] } as const;
const SeatPermission = Schema.Literals(["manage-books", "issue-invoices", "manage-people"]);
/** `AuthorizedOrgActor` (reads/participation.ts:21). */
const OrgActor = Schema.Struct({ orgId: S, roleKey: NullOr(S) });
/** `SeatStanding` (reads/participation.ts:206). */
const SeatStanding = Schema.Struct({ authUserId: S, email: NullOr(S), name: NullOr(S), isOwner: B, agent: B });
/** `InvitationOffer` (invitations/rules/offers.ts): a frozen admission of one offer row; too deep to transcribe. */
const Offer = U;
/** The Seat check every participation read makes: Permissions' bootstrap guard over org-lifecycles. */
const BOOTSTRAP = [procedure_permissions_org_bootstrap_authority_usable];

// ── participation ───────────────────────────────────────────────────────────────────────────

export const procedure_organizations_current_org_participation = defineProcedure({
  id: "organizations.current-org-participation",
  title: "Whether one membership row is a current Seat",
  about:
    "A Seat is current while its row is active, bound to a Party, and the Organization's bootstrap is usable " +
    "(`orgBootstrapAuthorityUsable`, Permissions' guard, which reads org-lifecycles directly). It reads no on-chain " +
    "role (ADR-0017). Takes the stored member row; returns the Organization and the row's role key, or null.",
  was: [`${PART}:64`, `${DOOR}:9`],
  concept: concept_organizations,
  input: Schema.Struct({ member: U }),
  output: NullOr(OrgActor),
  errors: [],
  reads: [],
  ...none,
  invokes: BOOTSTRAP,
});

export const procedure_organizations_require_org_participant = defineProcedure({
  id: "organizations.require-org-participant",
  title: "Require a current Seat of the Organization",
  about:
    "The off-chain gate: the Organization exists, the caller has an active membership (`findActiveMember`, " +
    "by_auth_user_status filtered by orgId, first row) and that row is a current Seat. A missing Organization and a " +
    "non-member are refused alike: ROLE_PERMISSION_DENIED with details.resource organization. It reads no permission " +
    "evidence; `reconciledAt` is no freshness gate. Payments, Books, Requests, Payroll and this concept's own reads call it.",
  was: [`${PART}:85`, `${PART}:31`, `${O}/errors.ts:79`, `${DOOR}:16`],
  concept: concept_organizations,
  input: Schema.Struct({ authUserId: S, orgId: S }),
  output: OrgActor,
  errors: [error_ROLE_PERMISSION_DENIED],
  reads: [table_orgs, table_org_members],
  ...none,
  invokes: BOOTSTRAP,
});

export const procedure_organizations_require_claimed_org_party = defineProcedure({
  id: "organizations.require-claimed-org-party",
  title: "Require the Organization's one claimed Party",
  about:
    "The unique claimed Organization Party that names the Organization's Safe (`readClaimedOrganizationPartyInTx`). " +
    "Refuses WRONG_STATE (organizationPartyMissing, naming the caller's method) when there is none. Takes the stored " +
    "Organization row.",
  was: [`${PART}:44`, `${O}/errors.ts:104`, `${DOOR}:15`],
  concept: concept_organizations,
  input: Schema.Struct({ org: U, method: S }),
  output: Schema.Struct({ partyId: S }),
  errors: [error_WRONG_STATE],
  reads: [],
  ...none,
  invokes: [procedure_parties_read_claimed_organization_party_in_tx],
});

export const procedure_organizations_read_participating_safe_addresses_in_tx = defineProcedure({
  id: "organizations.read-participating-safe-addresses-in-tx",
  title: "The Organization Safes a person's current Seats admit",
  about: "Each current Seat of the person admits its Organization's Safe, on the given chain, to the chain-scoped indexer read.",
  was: [`${PART}:109`, `${DOOR}:12`],
  concept: concept_organizations,
  input: Schema.Struct({ authUserId: S, chainId: N }),
  output: Strings,
  errors: [],
  reads: [table_org_members, table_orgs],
  ...none,
  invokes: BOOTSTRAP,
});

export const procedure_organizations_read_contact_roster_in_tx = defineProcedure({
  id: "organizations.read-contact-roster-in-tx",
  title: "The Organization's current Seats as directory contacts",
  about: "Every current Seat's Party, email and last change, after the caller proved the Organization read scope. Revoked, expired and unbound rows are left out.",
  was: [`${PART}:130`, `${DOOR}:11`],
  concept: concept_organizations,
  input: Schema.Struct({ orgId: S }),
  output: Schema.Array(Schema.Struct({ partyId: S, email: Schema.optionalKey(S), updatedAt: N })),
  errors: [],
  reads: [table_org_members],
  ...none,
  invokes: BOOTSTRAP,
});

export const procedure_organizations_read_account_organization_references_in_tx = defineProcedure({
  id: "organizations.read-account-organization-references-in-tx",
  title: "Which Organization tables still name a person",
  about:
    "For an operator purge of an Account: whether an Organization the person's Safe founded (lowercase or checksummed), a " +
    "membership by their email or auth user, or an invitation to their Party exists, in any state. Returns the table names.",
  was: [`${PART}:161`, `${DOOR}:10`],
  concept: concept_organizations,
  input: Schema.Struct({ safes: Strings, emails: Strings, authUserIds: Strings, partyIds: Strings }),
  output: Strings,
  errors: [],
  reads: [table_orgs, table_org_members, table_org_invitations],
  ...none,
});

export const procedure_organizations_read_seat_standing_in_tx = defineProcedure({
  id: "organizations.read-seat-standing-in-tx",
  title: "The caller's current Seat and whether it is a Director",
  about:
    "The caller's current Seat in the Organization with its name, email, agent mark, and whether its personal Safe is one " +
    "of the Organization Safe's owners as the drift cycle last copied them (`safeSigners`; before the first copy, the " +
    "founder's). Books reads it for each fact it records.",
  was: [`${PART}:249`, `${PART}:220`, `${DOOR}:14`],
  concept: concept_organizations,
  input: Schema.Struct({ orgId: S, authUserId: S }),
  output: NullOr(SeatStanding),
  errors: [],
  reads: [table_org_members, table_orgs],
  ...none,
  invokes: BOOTSTRAP,
});

export const procedure_organizations_read_seat_standing_by_email_in_tx = defineProcedure({
  id: "organizations.read-seat-standing-by-email-in-tx",
  title: "The current Seat with one email and its standing",
  about: "As `readSeatStandingInTx`, for the first active row of the trimmed, lowercased email in the Organization.",
  was: [`${PART}:258`, `${DOOR}:13`],
  concept: concept_organizations,
  input: Schema.Struct({ orgId: S, email: S }),
  output: NullOr(SeatStanding),
  errors: [],
  reads: [table_org_members, table_orgs],
  ...none,
  invokes: BOOTSTRAP,
});

// ── the stored Organization ─────────────────────────────────────────────────────────────────

export const procedure_organizations_read_organization_name_in_tx = defineProcedure({
  id: "organizations.read-organization-name-in-tx",
  title: "Read an Organization's name",
  about: "The Organization's name, or null, without granting scope (`findOrganization` by by_org_id). Approvals, notices, Books' classification and Access's refusal read it.",
  was: [`${ORGS}:30`, `${ORGS}:17`, `${DOOR}:27`],
  concept: concept_organizations,
  input: Schema.Struct({ orgId: S }),
  output: NullOr(S),
  errors: [],
  reads: [table_orgs],
  ...none,
});

export const procedure_organizations_read_organization_name_by_party_in_tx = defineProcedure({
  id: "organizations.read-organization-name-by-party-in-tx",
  title: "Read the name of the Organization a Party stands for",
  about: "The first Organization whose `partyId` is this Party (by_party_id), or null for any other Party.",
  was: [`${ORGS}:35`, `${DOOR}:26`],
  concept: concept_organizations,
  input: Schema.Struct({ partyId: S }),
  output: NullOr(S),
  errors: [],
  reads: [table_orgs],
  ...none,
});

export const procedure_organizations_read_organization_party_id_in_tx = defineProcedure({
  id: "organizations.read-organization-party-id-in-tx",
  title: "Read an Organization's Party link",
  about: "The stored `partyId`, or null, without granting scope or creating an identity.",
  was: [`${ORGS}:25`, `${DOOR}:28`],
  concept: concept_organizations,
  input: Schema.Struct({ orgId: S }),
  output: NullOr(S),
  errors: [],
  reads: [table_orgs],
  ...none,
});

export const procedure_organizations_read_organization_safe_in_tx = defineProcedure({
  id: "organizations.read-organization-safe-in-tx",
  title: "Read an Organization's Safe",
  about: "The Organization's chain and lowercased Safe address, or null, without granting read scope. Payments' guards and Books' Safe account read it.",
  was: [`${ORGS}:58`, `${DOOR}:29`],
  concept: concept_organizations,
  input: Schema.Struct({ orgId: S }),
  output: NullOr(Schema.Struct({ chainId: N, address: S })),
  errors: [],
  reads: [table_orgs],
  ...none,
});

export const procedure_organizations_read_organizations_at_safe_in_tx = defineProcedure({
  id: "organizations.read-organizations-at-safe-in-tx",
  title: "Read the Organizations at one Safe",
  about:
    "Every Base Sepolia (84532) Organization whose Safe is this address, read lowercase by by_safe_address and filtered by " +
    "chain in memory. Recipient resolution takes the first; Movement attribution refuses more than one.",
  was: [`${ORGS}:104`, `${DOOR}:30`],
  concept: concept_organizations,
  input: Schema.Struct({ safeAddress: S }),
  output: Schema.Array(Schema.Struct({ orgId: S, safeAddress: S })),
  errors: [],
  reads: [table_orgs],
  ...none,
});

export const procedure_organizations_read_owner_safes_in_tx = defineProcedure({
  id: "organizations.read-owner-safes-in-tx",
  title: "Read an Organization's owner Safes",
  about: "The Organization Safe's owners, lowercased: `safeSigners.owners` when copied, else the founder's personal Safe. An unknown Organization has none.",
  was: [`${ORGS}:50`, `${DOOR}:31`],
  concept: concept_organizations,
  input: Schema.Struct({ orgId: S }),
  output: Strings,
  errors: [],
  reads: [table_orgs],
  ...none,
});

export const procedure_organizations_read_activity_safe_address_in_tx = defineProcedure({
  id: "organizations.read-activity-safe-address-in-tx",
  title: "Read the Organization's Safe for Activity",
  about: "The stored Safe address, lowercased, or null, without granting read scope.",
  was: [`${ORGS}:82`, `${DOOR}:24`],
  concept: concept_organizations,
  input: Schema.Struct({ orgId: S }),
  output: NullOr(S),
  errors: [],
  reads: [table_orgs],
  ...none,
});

export const procedure_organizations_read_company_deployment_in_tx = defineProcedure({
  id: "organizations.read-company-deployment-in-tx",
  title: "Read a v4 company's stored money deployment",
  about:
    "What the Installer's `deployMoney` created for a v4 company, as the setup stored it (`companyInstall.deploymentJson`); " +
    "null before v4 or before install. Departments build their office hats on it; Seat permissions plan hats from it.",
  was: [`${ORGS}:73`, `${DOOR}:25`],
  concept: concept_organizations,
  input: Schema.Struct({ orgId: S }),
  output: NullOr(S),
  errors: [],
  reads: [table_org_lifecycles],
  ...none,
});

export const procedure_organizations_require_movement_organization_target_in_tx = defineProcedure({
  id: "organizations.require-movement-organization-target-in-tx",
  title: "The unique Organization a Movement names",
  about: "After Movement admission proved participation: the one Organization row (`.unique()`), else INVALID_INPUT (actor not found). More than one row throws Convex's own uniqueness error.",
  was: [`${ORGS}:87`, `${O}/errors.ts:116`, `${DOOR}:34`],
  concept: concept_organizations,
  input: Schema.Struct({ orgId: S }),
  output: Schema.Struct({ orgId: S, safe: S }),
  errors: [error_INVALID_INPUT],
  reads: [table_orgs],
  ...none,
});

export const procedure_organizations_require_payroll_organization_identity_in_tx = defineProcedure({
  id: "organizations.require-payroll-organization-identity-in-tx",
  title: "Payroll's one Organization and its claimed Party",
  about:
    "Exactly one Organization row for the id (else INVALID_INPUT, identity ambiguous) and its unique claimed Party (else " +
    "WRONG_STATE naming Payroll's operation).",
  was: [`${ORGS}:121`, `${O}/errors.ts:112`, `${DOOR}:35`],
  concept: concept_organizations,
  input: Schema.Struct({ orgId: S, method: S }),
  output: Schema.Struct({ orgId: S, partyId: S, safeAddress: S, chainId: N }),
  errors: [error_INVALID_INPUT, error_WRONG_STATE],
  reads: [table_orgs],
  ...none,
  invokes: [procedure_parties_read_claimed_organization_party_in_tx],
});

export const procedure_organizations_read_reconciliation_organization_page_in_tx = defineProcedure({
  id: "organizations.read-reconciliation-organization-page-in-tx",
  title: "One page of Organizations for the canonical-state sweep",
  about: "Paginates the whole orgs table, 100 a page, with no index: the ids, whether more remain, and the cursor. Indexing's drift sweep reads it.",
  was: [`${ORGS}:149`, `${DOOR}:33`],
  concept: concept_organizations,
  input: Schema.Struct({ cursor: Schema.optionalKey(S) }),
  output: Schema.Struct({ orgIds: Strings, truncated: B, continueCursor: S, isDone: B }),
  errors: [],
  reads: [table_orgs],
  ...none,
});

export const procedure_organizations_read_reconciliation_organization_in_tx = defineProcedure({
  id: "organizations.read-reconciliation-organization-in-tx",
  title: "One Organization's active role-bearing members, for reconciliation",
  about: "The Organization's Safe, its copied signers, and each active member with a personal Safe and a role key (its row id, Safe and role key), so the sweep can propose corrections.",
  was: [`${ORGS}:160`, `${DOOR}:32`],
  concept: concept_organizations,
  input: Schema.Struct({ orgId: S }),
  output: NullOr(
    Schema.Struct({
      orgId: S,
      safeAddress: S,
      safeSigners: Schema.optionalKey(Schema.Struct({ owners: Strings, threshold: N, blockNumber: N })),
      members: Schema.Array(Schema.Struct({ id: S, status: S, memberSafe: S, roleKey: S })),
    }),
  ),
  errors: [],
  reads: [table_orgs, table_org_members],
  ...none,
});

export const procedure_organizations_read_verification_organization_in_tx = defineProcedure({
  id: "organizations.read-verification-organization-in-tx",
  title: "Business verification's Organization and Director",
  about:
    "For Parties' business verification: requires a current Seat, reads the Organization (`.unique()`), decides whether " +
    "the caller is the founder (the Account attached to the founder's Safe) and so may prepare, refuses a write by anyone " +
    "else (ROLE_PERMISSION_DENIED not_member), and requires the claimed Party. A role label cannot make an Admin the Director.",
  was: [`${O}/reads/verification.ts:5`, `${O}/errors.ts:87`, `${O}/errors.ts:91`, `${DOOR}:143`],
  concept: concept_organizations,
  input: Schema.Struct({ authUserId: S, orgId: S, write: B }),
  output: Schema.Struct({ orgId: S, partyId: S, name: S, canPrepare: B }),
  errors: [error_ROLE_PERMISSION_DENIED, error_WRONG_STATE],
  reads: [table_orgs, table_org_members],
  ...none,
  invokes: [
    ...BOOTSTRAP,
    procedure_accounts_read_attached_account_for_safe_in_tx,
    procedure_parties_read_claimed_organization_party_in_tx,
  ],
});

// ── writes on the Organization row ──────────────────────────────────────────────────────────

export const procedure_organizations_record_organization_logo_in_tx = defineProcedure({
  id: "organizations.record-organization-logo-in-tx",
  title: "Bind an uploaded logo to the Organization",
  about:
    "Media's write: the Organization must exist (else ROLE_PERMISSION_DENIED), the blob must pass Media's image rule, then " +
    "`logoStorageId` is patched and the replaced blob deleted from `_storage`. Returns the new blob's URL.",
  was: [`${O}/writes.ts:11`, `${DOOR}:39`],
  concept: concept_organizations,
  input: Schema.Struct({ orgId: S, storageId: S, now: N }),
  output: NullOr(S),
  errors: [error_ROLE_PERMISSION_DENIED, error_INVALID_INPUT],
  reads: [table_orgs],
  writes: [table_orgs],
  drives: [],
  invokes: [procedure_media_find_image_refusal],
  emits: [],
});

export const procedure_organizations_record_safe_signers_in_tx = defineProcedure({
  id: "organizations.record-safe-signers-in-tx",
  title: "Copy the Organization Safe's signers (the Directors)",
  about:
    "Stores the indexer's owners (lowercased), threshold and block on `safeSigners`, including a reorg's replacement at the " +
    "same or a lower block; nothing when unchanged or the Organization is unknown. Returns what was stored before. The " +
    "indexer drift cycle and proposal settlement call it.",
  was: [`${O}/writes.ts:41`, `${DOOR}:42`],
  concept: concept_organizations,
  input: Schema.Struct({ orgId: S, signers: Schema.Struct({ owners: Strings, threshold: N, blockNumber: N }), now: N }),
  output: NullOr(Schema.Struct({ previous: NullOr(Schema.Struct({ owners: Strings, threshold: N, blockNumber: N })) })),
  errors: [],
  reads: [table_orgs],
  writes: [table_orgs],
  drives: [],
  invokes: [],
  emits: [],
});

export const procedure_organizations_seed_financial_proof_organization_in_tx = defineProcedure({
  id: "organizations.seed-financial-proof-organization-in-tx",
  title: "Seed a proof Organization through the one creation path",
  about:
    "Operator's proof seed: the person's first proof Account chain (else SMART_ACCOUNT_MISSING) and profile email must match " +
    "(else INVALID_INPUT), then `createOrganizationInTx` creates the Organization and its Party exactly as begin does " +
    "(handle, name and bound checks; v4 Companies House or derived Safe; `ensureOrgParty`). It creates no setup row.",
  was: [`${O}/setups/writes/organizations.ts:133`, `${O}/setups/writes/organizations.ts:61`, `${DOOR}:71`],
  concept: concept_organizations,
  input: Schema.Struct({ authUserId: S, email: S, name: S, handle: S, now: N }),
  output: Schema.Struct({ orgId: S, handle: S, safeAddress: S, chainId: N }),
  errors: [error_SMART_ACCOUNT_MISSING, error_INVALID_INPUT, error_PROFILE_NOT_FOUND, error_UNKNOWN],
  reads: [table_orgs],
  writes: [table_orgs],
  drives: [],
  invokes: [
    procedure_accounts_read_first_proof_account_chain_in_tx,
    procedure_profiles_read_first_proof_profile_email_in_tx,
    procedure_profiles_read_founder_profile_identity_in_tx,
    procedure_accounts_read_founder_account_state_in_tx,
    procedure_parties_party_by_handle,
    procedure_parties_ensure_org_party,
  ],
  emits: [],
});

// ── proposals ───────────────────────────────────────────────────────────────────────────────

export const procedure_organizations_read_safe_proposal_approval_subject_in_tx = defineProcedure({
  id: "organizations.read-safe-proposal-approval-subject-in-tx",
  title: "The proposal a Director's approval names",
  about: "What Approvals shows of one proposal: Organization, Safe, nonce, kind, note, status and calls (none for a rejection). A missing row is the approval's defect (UNKNOWN, storedRowBroken).",
  was: [`${O}/reads/proposals.ts:32`, `${DOOR}:47`],
  concept: concept_organizations,
  input: Schema.Struct({ proposalId: S }),
  output: Schema.Struct({
    orgId: S,
    proposalId: S,
    safeAddress: S,
    nonce: NullOr(N),
    kind: S,
    note: NullOr(S),
    status: S,
    calls: Schema.Array(Schema.Struct({ to: S, value: S })),
  }),
  errors: [error_UNKNOWN],
  reads: [table_org_safe_proposals],
  ...none,
});

export const procedure_organizations_read_safe_proposal_step_in_tx = defineProcedure({
  id: "organizations.read-safe-proposal-step-in-tx",
  title: "Where one Director's approve or execute step stands",
  about:
    "waiting, done or dropped: an execution is done once sent through Capxul; an approval once the Safe as last read holds " +
    "it or the proposal settled; an approval still unseen after its last follow-up window was dropped. A missing row is UNKNOWN.",
  was: [`${O}/reads/proposals.ts:58`, `${DOOR}:48`],
  concept: concept_organizations,
  input: Schema.Struct({ proposalId: S, owner: S, step: Schema.Literals(["approve", "execute"]), now: N }),
  output: Schema.Literals(["waiting", "done", "dropped"]),
  errors: [error_UNKNOWN],
  reads: [table_org_safe_proposals],
  ...none,
});

export const procedure_organizations_read_waiting_proposal_calls_in_tx = defineProcedure({
  id: "organizations.read-waiting-proposal-calls-in-tx",
  title: "The calls of every waiting transaction proposal",
  about: "Every awaiting_approvals transaction of the Organization with its calls' to and data, so a v4 hat plan avoids an id a waiting proposal would take (CAP-1144).",
  was: [`${O}/reads/proposals.ts:86`, `${DOOR}:49`],
  concept: concept_organizations,
  input: Schema.Struct({ orgId: S }),
  output: Schema.Array(Schema.Struct({ proposalId: S, calls: Schema.Array(Schema.Struct({ to: S, data: S })) })),
  errors: [],
  reads: [table_org_safe_proposals],
  ...none,
});

export const procedure_organizations_read_subject_proposal_in_tx = defineProcedure({
  id: "organizations.read-subject-proposal-in-tx",
  title: "The proposal that carries one subject command",
  about: "The Organization's proposal whose `subject.commandId` is this command (by_subject_command), or null. Permissions, Payroll and the invitation endings read it.",
  was: [`${O}/proposals/writes.ts:196`, `${DOOR}:63`],
  concept: concept_organizations,
  input: Schema.Struct({ orgId: S, commandId: S }),
  output: NullOr(U),
  errors: [],
  reads: [table_org_safe_proposals],
  ...none,
});

export const procedure_organizations_record_owner_proposal_in_tx = defineProcedure({
  id: "organizations.record-owner-proposal-in-tx",
  title: "Store a Director proposal at the next free nonce",
  about:
    "Stores a proposal built by `ownerProposal` (or a Seat permission's SignMessageLib call) awaiting_approvals at the " +
    "next free nonce from the chain nonce; a rejection takes its target's nonce. Refuses a missing target (INVALID_INPUT), " +
    "a rejection of a non-transaction or a settled target, and a full queue (WRONG_STATE). Permissions (Budget writes), " +
    "Payroll and Seat permission changes call it with their subject.",
  was: [`${O}/proposals/writes.ts:180`, `${O}/proposals/writes.ts:115`, `${DOOR}:64`],
  concept: concept_organizations,
  input: Schema.Struct({ proposal: U, subject: U, now: N }),
  output: U,
  errors: [error_INVALID_INPUT, error_WRONG_STATE],
  reads: [table_org_safe_proposals],
  writes: [table_org_safe_proposals],
  drives: [],
  invokes: [],
  emits: [],
});

export const procedure_organizations_require_safe_owner = defineProcedure({
  id: "organizations.require-safe-owner",
  title: "From an action: the caller is a Director of the Organization Safe now",
  about:
    "Runs from the caller's action, not inside a transaction: `readContext` runs the organizations.proposals.load query, " +
    "`refreshProposals` reads the Safe's owners, threshold, nonce and approvals and the waiting executions from the chain " +
    "and stores what settled (organizations.proposals.settle: proposals, `safeSigners`, and each subject's apply or end), " +
    "then requires the caller's personal Safe to be a live owner. Returns the facts `ownerProposal` needs: chain, Safe, " +
    "nonce, threshold and proposer. Its reads and writes are those two rpcs' (booked in proposals.ts).",
  was: [`${O}/proposals/guards.ts:129`, `${O}/proposals/writes.ts:303`, `${DOOR}:58`],
  concept: concept_organizations,
  input: Schema.Struct({ authUserId: S, orgId: S, operation: S }),
  output: Schema.Struct({ orgId: S, chainId: N, safeAddress: S, chainNonce: N, threshold: N, proposer: S }),
  errors: [error_ROLE_PERMISSION_DENIED, error_SMART_ACCOUNT_MISSING, error_PROVIDER_ERROR, error_ENV_MISSING, error_UNKNOWN],
  reads: [table_orgs, table_org_members, table_org_lifecycles, table_org_safe_proposals],
  writes: [
    table_org_safe_proposals,
    table_orgs,
    table_seat_permission_changes,
    table_seat_permissions,
    table_org_invitations,
    table_org_equities,
    table_org_equity_issues,
    table_org_option_grants,
    table_org_safe_rounds,
    table_org_rounds,
    table_org_share_transfers,
  ],
  drives: [
    machine_org_safe_proposal.t.to_executed,
    machine_org_safe_proposal.t.to_rejected,
    machine_org_safe_proposal.t.to_replaced,
    machine_seat_permission_change.t.to_applied,
    machine_seat_permission_change.t.to_ended,
  ],
  invokes: [],
  emits: [],
});

export const procedure_organizations_settle_organization_proposals = defineProcedure({
  id: "organizations.settle-organization-proposals",
  title: "From an action: settle the Organization's waiting proposals",
  about:
    "Runs from the caller's action: the same organizations.proposals.load and chain read and settle as `requireSafeOwner`, " +
    "for a current participant, without requiring a Director. A read of what a proposal carries out starts here. Returns " +
    "the chain, Safe and nonce.",
  was: [`${O}/proposals/guards.ts:154`, `${DOOR}:59`],
  concept: concept_organizations,
  input: Schema.Struct({ authUserId: S, orgId: S }),
  output: Schema.Struct({ chainId: N, safeAddress: S, nonce: N }),
  errors: [error_ROLE_PERMISSION_DENIED, error_PROVIDER_ERROR, error_ENV_MISSING, error_UNKNOWN],
  reads: [table_orgs, table_org_members, table_org_lifecycles, table_org_safe_proposals],
  writes: [
    table_org_safe_proposals,
    table_orgs,
    table_seat_permission_changes,
    table_seat_permissions,
    table_org_invitations,
    table_org_equities,
    table_org_equity_issues,
    table_org_option_grants,
    table_org_safe_rounds,
    table_org_rounds,
    table_org_share_transfers,
  ],
  drives: [
    machine_org_safe_proposal.t.to_executed,
    machine_org_safe_proposal.t.to_rejected,
    machine_org_safe_proposal.t.to_replaced,
    machine_seat_permission_change.t.to_applied,
    machine_seat_permission_change.t.to_ended,
  ],
  invokes: [],
  emits: [],
});

// ── members ─────────────────────────────────────────────────────────────────────────────────

const M = `${O}/members`;

export const procedure_organizations_is_payroll_invite_for_party_in_tx = defineProcedure({
  id: "organizations.is-payroll-invite-for-party-in-tx",
  title: "Whether an email's membership is this Party's live invite",
  about: "The first row of the email in the Organization is bound to this Party and neither revoked nor expired. Payroll resolves an existing email invite with it, creating nothing.",
  was: [`${M}/reads.ts:34`, `${DOOR}:76`],
  concept: concept_organizations,
  input: Schema.Struct({ orgId: S, partyId: S, email: S }),
  output: B,
  errors: [],
  reads: [table_org_members],
  ...none,
});

export const procedure_organizations_read_active_member_by_email_in_tx = defineProcedure({
  id: "organizations.read-active-member-by-email-in-tx",
  title: "The active member with an email and a personal Safe",
  about: "The first active row of the trimmed, lowercased email that has a personal Safe, or null. Payroll names a department holder with it; the Seat permission target reads it on v4.",
  was: [`${M}/reads.ts:54`, `${DOOR}:76`],
  concept: concept_organizations,
  input: Schema.Struct({ orgId: S, email: S }),
  output: NullOr(Schema.Struct({ email: S, name: NullOr(S), authUserId: NullOr(S), personalSafe: S })),
  errors: [],
  reads: [table_org_members],
  ...none,
});

export const procedure_organizations_schedule_invite_progressed = defineProcedure({
  id: "organizations.schedule-invite-progressed",
  title: "Schedule org_invite_transitioned (progressed) for a committed membership step",
  about:
    "Schedules organizations.members.emitProgressed (`scheduleTelemetryEmit`, runAfter 0) with the snapshot the committing " +
    "mutation captured: account_ready, configuration_authorized, permission_applied or membership_activated. Permissions " +
    "calls it when it reports configuration progress.",
  was: [`${M}/events.ts:58`, `${DOOR}:77`],
  concept: concept_organizations,
  input: Schema.Struct({
    progress: Schema.Literals(["account_ready", "configuration_authorized", "permission_applied", "membership_activated"]),
    organizationId: S,
    memberPartyId: Schema.optionalKey(S),
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
});

const SEAT_PERMISSION_READS = [table_seat_permissions, table_org_members, table_orgs];

export const procedure_organizations_holds_seat_permission_in_tx = defineProcedure({
  id: "organizations.holds-seat-permission-in-tx",
  title: "Whether a current Seat holds a Seat permission now",
  about: "The person is a current Seat (`readSeatStandingInTx`) and holds a seatPermissions row for the permission. Books asks for Manage books.",
  was: [`${M}/reads/permissions.ts:57`, `${M}/reads/permissions.ts:43`, `${DOOR}:80`],
  concept: concept_organizations,
  input: Schema.Struct({ orgId: S, authUserId: S, permission: SeatPermission }),
  output: B,
  errors: [],
  reads: SEAT_PERMISSION_READS,
  ...none,
  invokes: BOOTSTRAP,
});

export const procedure_organizations_require_issue_invoices_in_tx = defineProcedure({
  id: "organizations.require-issue-invoices-in-tx",
  title: "Require a current Seat holding Issue invoices",
  about: "Refuses ROLE_PERMISSION_DENIED (issueInvoicesRequired, naming the Organization and Requests' operation) unless the caller holds issue-invoices as a current Seat now.",
  was: [`${M}/reads/permissions.ts:67`, `${M}/errors.ts:62`, `${DOOR}:81`],
  concept: concept_organizations,
  input: Schema.Struct({ orgId: S, authUserId: S, operation: S }),
  output: Schema.Void,
  errors: [error_ROLE_PERMISSION_DENIED],
  reads: SEAT_PERMISSION_READS,
  ...none,
  invokes: BOOTSTRAP,
});

export const procedure_organizations_seat_permission_rows = defineProcedure({
  id: "organizations.seat-permission-rows",
  title: "Every grant of one Seat permission in the Organization",
  about: "The seatPermissions rows of one permission (by_org_permission), oldest first, whatever the holders' Seats are now.",
  was: [`${M}/reads/permissions.ts:31`, `${DOOR}:82`],
  concept: concept_organizations,
  input: Schema.Struct({ orgId: S, permission: SeatPermission }),
  output: Schema.Array(U),
  errors: [],
  reads: [table_seat_permissions],
  ...none,
});

export const procedure_organizations_advance_pending_safe_members_in_tx = defineProcedure({
  id: "organizations.advance-pending-safe-members-in-tx",
  title: "A claimed personal Safe advances the memberships waiting for it",
  about:
    "Every pending_safe row of the person whose Organization is on the claimed chain gets the Safe and moves to " +
    "pending_grant; each schedules org_invite_transitioned (progressed, account_ready). Returns the matched Organizations " +
    "and member views. INVALID_INPUT for a malformed Safe address. Accounts runs it through organizations.members.advance.",
  was: [`${M}/writes/advances.ts:35`, `${DOOR}:84`],
  concept: concept_organizations,
  input: Schema.Struct({ authUserId: S, chainId: N, personalSafeAddress: S, now: N }),
  output: Schema.Struct({ matched: Strings, members: Schema.Array(U) }),
  errors: [error_INVALID_INPUT, error_UNKNOWN],
  reads: [table_org_members, table_orgs, table_seat_permissions],
  writes: [table_org_members],
  drives: [machine_org_member.t.to_pending_grant],
  invokes: [procedure_organizations_schedule_invite_progressed],
  emits: [],
});

export const procedure_organizations_apply_verified_invitation_member_in_tx = defineProcedure({
  id: "organizations.apply-verified-invitation-member-in-tx",
  title: "A verified invitation makes its grantee an active member",
  about:
    "Inserts or patches the one row of the grantee's email active, bound to the offer's Party and Safe and the consenting " +
    "account, refusing any binding that moved (WRONG_STATE memberBindingChanged); applies the request's Seat marks (agent); " +
    "with an activation, schedules progressed (membership_activated). Permissions calls it for a verified grant; a Seat-only " +
    "consent calls it too.",
  was: [`${M}/writes/grants.ts:142`, `${M}/writes/grants.ts:41`, `${M}/writes/grants.ts:120`, `${DOOR}:86`],
  concept: concept_organizations,
  input: Schema.Struct({
    invitation: U,
    party: Schema.Struct({ email: Schema.optionalKey(NullOr(S)), displayName: Schema.optionalKey(NullOr(S)) }),
    account: NullOr(Schema.Struct({ authUserId: S })),
    role: Schema.Literals(["Admin", "Member"]),
    transactionHash: NullOr(S),
    now: N,
    activation: NullOr(Schema.Struct({ commandId: S })),
  }),
  output: Schema.Void,
  errors: [error_WRONG_STATE],
  reads: [table_org_members, table_org_invitations],
  writes: [table_org_members],
  drives: [machine_org_member.t.to_active],
  invokes: [procedure_profiles_read_profile_account_binding_in_tx, procedure_organizations_schedule_invite_progressed],
  emits: [],
});

export const procedure_organizations_record_member_permission_application_in_tx = defineProcedure({
  id: "organizations.record-member-permission-application-in-tx",
  title: "A verified role grant activates the one waiting membership",
  about:
    "Among the Organization's rows bound to the member Safe and role key, exactly one pending_grant row becomes active with " +
    "the grant's transaction hash. Schedules progressed permission_applied when the permission applied, and " +
    "membership_activated when a row activated; an ambiguous binding reports nothing.",
  was: [`${M}/writes/grants.ts:164`, `${DOOR}:88`],
  concept: concept_organizations,
  input: Schema.Struct({
    orgId: S,
    memberSafe: S,
    roleKey: S,
    transactionHash: S,
    permissionApplied: B,
    originatingAuthUserId: Schema.optionalKey(S),
    originatingObservationContext: Schema.optionalKey(U),
    now: N,
  }),
  output: Schema.Void,
  errors: [],
  reads: [table_org_members],
  writes: [table_org_members],
  drives: [machine_org_member.t.to_active],
  invokes: [procedure_organizations_schedule_invite_progressed],
  emits: [],
});

export const procedure_organizations_require_pending_member_account_in_tx = defineProcedure({
  id: "organizations.require-pending-member-account-in-tx",
  title: "Require the one pending_grant membership an Account grant names",
  about: "Exactly one row of the email, pending_grant, with this account's auth user, Safe and the role key; else INVALID_INPUT (notThePendingMember).",
  was: [`${M}/writes/grants.ts:217`, `${DOOR}:89`],
  concept: concept_organizations,
  input: Schema.Struct({
    orgId: S,
    email: S,
    roleKey: S,
    account: Schema.Struct({ authUserId: S, smartAccountAddress: S }),
  }),
  output: Schema.Void,
  errors: [error_INVALID_INPUT],
  reads: [table_org_members],
  ...none,
});

export const procedure_organizations_reconcile_member_authority_in_tx = defineProcedure({
  id: "organizations.reconcile-member-authority-in-tx",
  title: "Reconcile one membership against the indexed role",
  about:
    "Indexing's reconciliation: stamps `reconciledAt`, and an active row whose role is no longer held becomes revoked. " +
    "Returns the status change, or null. Takes the member row id.",
  was: [`${M}/writes/grants.ts:247`, `${DOOR}:87`],
  concept: concept_organizations,
  input: Schema.Struct({ memberId: S, holdsRole: B, at: N }),
  output: NullOr(Schema.Struct({ previousStatus: S, currentStatus: S })),
  errors: [],
  reads: [table_org_members],
  writes: [table_org_members],
  drives: [machine_org_member.t.to_revoked],
  invokes: [],
  emits: [],
});

// ── invitations ─────────────────────────────────────────────────────────────────────────────

export const procedure_organizations_deliver_invitation_outcome = defineProcedure({
  id: "organizations.deliver-invitation-outcome",
  title: "Deliver an authorized offer's email and record the outcome",
  about:
    "In the caller's mutation: `deliverAuthorizedInvitation`, the one writer of `delivery`. A confirmed outcome, a phase " +
    "other than pending, an unauthorized offer or a missing Organization writes nothing; a grantee with no mailbox records " +
    "none; else it hands one message to the mail provider through the Convex Resend component (`sendMail`, queued in the " +
    "transaction, never rejecting) and records sent or failed with `deliveryAttemptedAt`. Returns only the recorded " +
    "outcome. The email links to Requests' document checkout origin. Permissions calls it once the configuration is " +
    "authorized; the Seat-only invite calls it at birth.",
  was: [`${O}/invitations/external.ts:145`, `${O}/invitations/external.ts:73`, `${O}/invitations/external.ts:64`, `${DOOR}:95`],
  concept: concept_organizations,
  input: Schema.Struct({ invitationId: S, authUserId: S, operation: S, now: N }),
  output: NullOr(Schema.Struct({ delivery: Schema.Literals(["not_confirmed", "sent", "failed", "none"]) })),
  errors: [],
  reads: [table_org_invitations, table_orgs],
  writes: [table_org_invitations],
  drives: [
    machine_org_invitation_delivery.t.to_sent,
    machine_org_invitation_delivery.t.to_failed,
    machine_org_invitation_delivery.t.to_none,
  ],
  invokes: [procedure_parties_read_invitation_delivery_address_in_tx, procedure_requests_document_checkout_origin],
  emits: [],
});

export const procedure_organizations_is_current_compensation_offer_in_tx = defineProcedure({
  id: "organizations.is-current-compensation-offer-in-tx",
  title: "Whether an offer is still the one a compensation was planned for",
  about: "The stored offer exists, is the same Organization and generation, and its compensation still belongs to the parent command.",
  was: [`${OFFERS}:58`, `${DOOR}:97`],
  concept: concept_organizations,
  input: Schema.Struct({ invitationId: S, orgId: S, generationHash: S, parentCommandId: Schema.optionalKey(S) }),
  output: B,
  errors: [],
  reads: [table_org_invitations],
  ...none,
});

export const procedure_organizations_read_configuration_invitation_offer_in_tx = defineProcedure({
  id: "organizations.read-configuration-invitation-offer-in-tx",
  title: "The offer a configure command names",
  about: "The offer admission when its `configCommandId` is the command; else INVALID_INPUT (configuration command not found).",
  was: [`${OFFERS}:87`, `${DOOR}:100`],
  concept: concept_organizations,
  input: Schema.Struct({ invitationId: S, commandId: S }),
  output: Offer,
  errors: [error_INVALID_INPUT],
  reads: [table_org_invitations],
  ...none,
});

export const procedure_organizations_read_authorizing_invitation_offer_in_tx = defineProcedure({
  id: "organizations.read-authorizing-invitation-offer-in-tx",
  title: "The authorizing offer a configuration execution claims",
  about: "The offer admission when it is still authorizing, under this configure command and inviter; else INVALID_INPUT or WRONG_STATE. Payments' configuration execution claim reads it.",
  was: [`${OFFERS}:96`, `${DOOR}:99`],
  concept: concept_organizations,
  input: Schema.Struct({ invitationId: S, commandId: S, authUserId: S }),
  output: Offer,
  errors: [error_INVALID_INPUT, error_WRONG_STATE],
  reads: [table_org_invitations],
  ...none,
});

export const procedure_organizations_read_application_invitation_offer_in_tx = defineProcedure({
  id: "organizations.read-application-invitation-offer-in-tx",
  title: "The offer a grant application names",
  about: "The offer admission, or INVALID_INPUT (invitation not found).",
  was: [`${OFFERS}:110`, `${DOOR}:98`],
  concept: concept_organizations,
  input: Schema.Struct({ invitationId: S }),
  output: Offer,
  errors: [error_INVALID_INPUT],
  reads: [table_org_invitations],
  ...none,
});

export const procedure_organizations_read_receipt_invitation_offer_in_tx = defineProcedure({
  id: "organizations.read-receipt-invitation-offer-in-tx",
  title: "The authorized offer a receipt verifies",
  about: "The offer admission when it was authorized; else WRONG_STATE (receipt binding changed).",
  was: [`${OFFERS}:119`, `${DOOR}:103`],
  concept: concept_organizations,
  input: Schema.Struct({ invitationId: S }),
  output: Offer,
  errors: [error_WRONG_STATE],
  reads: [table_org_invitations],
  ...none,
});

export const procedure_organizations_read_inactive_invitation_ids_in_tx = defineProcedure({
  id: "organizations.read-inactive-invitation-ids-in-tx",
  title: "Which of these offers no longer hold authority",
  about: "Of the given invitation ids in the Organization, those whose offer is missing, foreign or not live.",
  was: [`${OFFERS}:146`, `${DOOR}:101`],
  concept: concept_organizations,
  input: Schema.Struct({ orgId: S, invitationIds: Strings }),
  output: Strings,
  errors: [],
  reads: [table_org_invitations],
  ...none,
});

export const procedure_organizations_read_invitation_authority_occupancy_in_tx = defineProcedure({
  id: "organizations.read-invitation-authority-occupancy-in-tx",
  title: "Whether a Party's live offers already occupy these authorities",
  about: "Reads the grantee's live offers in the Organization and reports which of the Permission ids their bindings already offer.",
  was: [`${OFFERS}:169`, `${DOOR}:102`],
  concept: concept_organizations,
  input: Schema.Struct({ partyId: S, orgId: S, permissionIds: Strings }),
  output: U,
  errors: [],
  reads: [table_org_invitations],
  ...none,
});

export const procedure_organizations_read_replacement_invitation_offers_in_tx = defineProcedure({
  id: "organizations.read-replacement-invitation-offers-in-tx",
  title: "The live offers a Roles module replacement must carry",
  about: "Every offer of the Organization in a live phase (by_org_phase_created, one read per phase), as admissions.",
  was: [`${OFFERS}:193`, `${DOOR}:105`],
  concept: concept_organizations,
  input: Schema.Struct({ orgId: S }),
  output: Schema.Array(Offer),
  errors: [],
  reads: [table_org_invitations],
  ...none,
});

export const procedure_organizations_read_replaced_invitation_offer_in_tx = defineProcedure({
  id: "organizations.read-replaced-invitation-offer-in-tx",
  title: "An offer read back after its replacement",
  about: "The admission's row read back by id; a vanished row is UNKNOWN (rowVanished).",
  was: [`${OFFERS}:216`, `${DOOR}:104`],
  concept: concept_organizations,
  input: Schema.Struct({ before: Offer }),
  output: Offer,
  errors: [error_UNKNOWN],
  reads: [table_org_invitations],
  ...none,
});

export const procedure_organizations_begin_authorizing_invitation_offer_in_tx = defineProcedure({
  id: "organizations.begin-authorizing-invitation-offer-in-tx",
  title: "Birth of a configured offer, authorizing",
  about:
    "Permissions' `createAuthorizingInvitation` inserts the offer authorizing, with its generation, request, Safe, Roles " +
    "module, inviter, grantee and bindings, delivery not_confirmed and cleanup not_requested, before it builds the configure " +
    "call and its child commands. Returns the admission.",
  was: [`${PHASES}:35`, `${DOOR}:133`],
  concept: concept_organizations,
  input: Schema.Struct({
    invitationId: S,
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
    bindings: Schema.Array(U),
    now: N,
  }),
  output: Offer,
  errors: [error_UNKNOWN],
  reads: [table_org_invitations],
  writes: [table_org_invitations],
  drives: [],
  invokes: [],
  emits: [],
});

export const procedure_organizations_authorize_invitation_offer_in_tx = defineProcedure({
  id: "organizations.authorize-invitation-offer-in-tx",
  title: "The verified configuration makes the offer pending",
  about: "Sets pending, `authorizedAt` and `expiresAt` (now + the offer lifetime).",
  was: [`${PHASES}:84`, `${DOOR}:132`],
  concept: concept_organizations,
  input: Schema.Struct({ offer: Offer, now: N }),
  output: Schema.Void,
  errors: [],
  reads: [],
  writes: [table_org_invitations],
  drives: [machine_org_invitation.t.to_pending],
  invokes: [],
  emits: [],
});

export const procedure_organizations_activate_invitation_offer_in_tx = defineProcedure({
  id: "organizations.activate-invitation-offer-in-tx",
  title: "The verified grant makes the offer active",
  about: "Sets the phase active.",
  was: [`${PHASES}:97`, `${DOOR}:131`],
  concept: concept_organizations,
  input: Schema.Struct({ offer: Offer, now: N }),
  output: Schema.Void,
  errors: [],
  reads: [],
  writes: [table_org_invitations],
  drives: [machine_org_invitation.t.to_active],
  invokes: [],
  emits: [],
});

export const procedure_organizations_begin_late_invitation_grant_cleanup_in_tx = defineProcedure({
  id: "organizations.begin-late-invitation-grant-cleanup-in-tx",
  title: "A grant that landed after the offer ended starts cleanup",
  about: "Sets revoking with cleanup disable_pending.",
  was: [`${PHASES}:105`, `${DOOR}:134`],
  concept: concept_organizations,
  input: Schema.Struct({ offer: Offer, now: N }),
  output: Schema.Void,
  errors: [],
  reads: [],
  writes: [table_org_invitations],
  drives: [machine_org_invitation.t.to_revoking, machine_org_invitation_cleanup.t.to_disable_pending],
  invokes: [],
  emits: [],
});

export const procedure_organizations_record_invitation_disabled_in_tx = defineProcedure({
  id: "organizations.record-invitation-disabled-in-tx",
  title: "The disable landed: compensate next",
  about: "Sets revoking with cleanup compensate_pending and schedules Permissions' `internal.permissions.grants.drive` for the generation's compensate command.",
  was: [`${PHASES}:117`, `${DOOR}:135`],
  concept: concept_organizations,
  input: Schema.Struct({ offer: Offer, now: N }),
  output: Schema.Void,
  errors: [],
  reads: [],
  writes: [table_org_invitations],
  drives: [machine_org_invitation_cleanup.t.to_compensate_pending],
  invokes: [],
  emits: [],
});

export const procedure_organizations_retire_invitation_offer_in_tx = defineProcedure({
  id: "organizations.retire-invitation-offer-in-tx",
  title: "Cleanup finished: the offer retires",
  about: "Sets the phase to its ending reason, or revoked when it has none, and cleanup retired.",
  was: [`${PHASES}:132`, `${DOOR}:137`],
  concept: concept_organizations,
  input: Schema.Struct({ offer: Offer, now: N }),
  output: Schema.Void,
  errors: [],
  reads: [],
  writes: [table_org_invitations],
  drives: [
    machine_org_invitation.t.to_declined,
    machine_org_invitation.t.to_cancelled,
    machine_org_invitation.t.to_expired,
    machine_org_invitation.t.to_revoked,
    machine_org_invitation_cleanup.t.to_retired,
  ],
  invokes: [],
  emits: [],
});

export const procedure_organizations_replace_invitation_offer_generation_in_tx = defineProcedure({
  id: "organizations.replace-invitation-offer-generation-in-tx",
  title: "Move a live offer to the replacement Roles module's generation",
  about:
    "A verified module replacement rewrites the offer's generation hash, configure command id, Roles module and bindings' " +
    "role keys, appending the lineage; refuses a generation or proof that changed (INVALID_INPUT). The phase is kept.",
  was: [`${PHASES}:145`, `${DOOR}:136`],
  concept: concept_organizations,
  input: Schema.Struct({ snapshot: U, replacementCommandId: S, receiptId: S, now: N }),
  output: U,
  errors: [error_INVALID_INPUT],
  reads: [table_org_invitations],
  writes: [table_org_invitations],
  drives: [],
  invokes: [],
  emits: [],
});

// ── treasuries ──────────────────────────────────────────────────────────────────────────────

export const procedure_organizations_read_treasury_target = defineProcedure({
  id: "organizations.read-treasury-target",
  title: "From an action: the Organization Account a participant may read",
  about:
    "Exported from the door as `readTreasuryTarget` (treasuries/reads.ts `readTarget`). Runs from the caller's action, not " +
    "inside a transaction: it runs the organizations.treasuries.load query (participant check, then the stored Organization's " +
    "chain and Safe) and names the verified Organization on the wide event. The Accounts home read takes balances from it.",
  was: [`${O}/treasuries/reads.ts:40`, `${O}/treasuries/reads.ts:23`, `${DOOR}:142`],
  concept: concept_organizations,
  input: Schema.Struct({ authUserId: S, orgId: S }),
  output: Schema.Struct({ orgId: S, chainId: N, safeAddress: S }),
  errors: [error_ROLE_PERMISSION_DENIED],
  reads: [table_orgs, table_org_members],
  ...none,
  invokes: BOOTSTRAP,
});
