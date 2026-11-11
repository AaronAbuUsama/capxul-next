// The as-is book of the old organizations concept: the setups area.
//
// Every operation registered at `organizations/setups:*` (packages/backend/convex/organizations/
// setups.ts:6-24), as the old code does it. Seven are public operations built from their protocol
// rows (packages/protocol/src/organizations/operations.ts:195-245); nine are internal queries and
// mutations an action runs in the same call (`ctx.runQuery` / `ctx.runMutation`); `observe` is
// scheduled by every write that schedules a check and `recover` is a cron, so both are workflows;
// `emitTransition` is telemetry plumbing.
//
// How touches are booked: an internal rpc lists what its own transaction does. A public action
// holds no transaction: it lists what the internal rpcs it runs touch on its paths, and their chain
// calls. Another concept's function is an invoke of its procedure by conventional name. A call to
// an integration the shared book has not booked yet is linked by the id its integration record will
// carry (`callOf`), so the build reports it if it never appears.

import { Schema } from "effect";
import { defineRpc, defineWorkflow, type CallRef } from "../../../packages/book/src/index.ts";
import { concept_organizations } from "../shared/foundation.ts";
import {
  error_ENV_MISSING,
  error_FEATURE_NOT_AVAILABLE,
  error_INSUFFICIENT_BALANCE,
  error_INVALID_INPUT,
  error_NOT_AUTHENTICATED,
  error_PROFILE_NOT_FOUND,
  error_PROVIDER_ERROR,
  error_SMART_ACCOUNT_MISSING,
  error_UNKNOWN,
  error_WRONG_STATE,
  event_organization_creation_failed,
  event_organization_creation_ready,
  event_organization_creation_started,
} from "../shared/vocabulary.ts";
import { integration_chain_rpc, integration_companies_house, integration_ponder } from "../shared/external.ts";
import {
  machine_org_lifecycle,
  machine_org_member,
  table_org_lifecycles,
  table_org_members,
  table_org_roles,
  table_org_roles_deployments,
  table_orgs,
  table_seat_permissions,
} from "./data.ts";
import { procedure_access_require_beta_access } from "../access/procedures.ts";
import {
  procedure_accounts_ensure_account_in_tx,
  procedure_accounts_read_founder_account_state_in_tx,
  procedure_accounts_read_workspace_account_safe_in_tx,
  procedure_accounts_read_workspace_authority_account_in_tx,
  procedure_accounts_read_workspace_proof_account_in_tx,
  procedure_accounts_read_workspace_setup_signer_in_tx,
  procedure_accounts_schedule_welcome_funding,
  procedure_accounts_with_service_lane,
} from "../accounts/procedures.ts";
import { procedure_media_find_image_refusal } from "../media/procedures.ts";
import {
  procedure_parties_ensure_org_party,
  procedure_parties_party_by_handle,
  procedure_parties_party_by_id,
} from "../parties/procedures.ts";
import {
  procedure_permissions_has_setup_recovery_read_admission_in_tx,
  procedure_permissions_load_setup_authority_snapshot,
  procedure_permissions_org_bootstrap_authority_usable,
  procedure_permissions_orphan_bootstrap_receipts_in_tx,
  procedure_permissions_read_bootstrap_permission_receipt_ids_in_tx,
  procedure_permissions_read_bootstrap_roles_module_in_tx,
  procedure_permissions_rebind_bootstrap_permissions,
  procedure_permissions_setup_authority_snapshot_matches,
  procedure_permissions_write_confirmed_bootstrap_permission,
} from "../permissions/procedures.ts";
import { procedure_profiles_read_founder_profile_identity_in_tx } from "../profiles/procedures.ts";

const O = "packages/backend/src/organizations";
const SET = `${O}/setups`;
const OPS = `${SET}/operations`;
const CONVEX = "packages/backend/convex/organizations/setups.ts";
const ROWS = "packages/protocol/src/organizations/operations.ts";

/** The integration's own call record when booked, else the reference its record will carry. */
const callOf = (integration: { readonly id: string; readonly c: object }, name: string): CallRef =>
  (integration.c as Record<string, CallRef | undefined>)[name] ??
  ({ _kind: "call", id: `${integration.id}.${name}`, integration: integration.id, name } as CallRef);
const uniq = <T>(items: readonly T[]): T[] => [...new Set(items)];

const S = Schema.String;
const N = Schema.Number;
const U = Schema.Unknown;
const OneOrganization = Schema.Struct({ orgId: S });
/** `OrganizationSetupSchema` (protocol setup-schema.ts): status, steps, issue, proof and the next action; too deep to transcribe. */
const SetupView = U;

const CALL = [error_NOT_AUTHENTICATED, error_INVALID_INPUT];
const DEFECTS = [error_UNKNOWN, error_ENV_MISSING];

// ── what shared helpers touch ───────────────────────────────────────────────────────────────

/** `authorizedSetup` (guards.ts:22): the founder's own until completion, then a current Seat or the proof hold's audience. */
const AUTHORIZED = {
  reads: [table_org_lifecycles, table_org_members],
  invokes: [procedure_permissions_org_bootstrap_authority_usable, procedure_permissions_has_setup_recovery_read_admission_in_tx],
};
/** `founderFactsHold` (resumes.ts:88): the snapshot, the Organization, and the founder's claimed Party and Account. */
const FOUNDER_FACTS = [
  procedure_profiles_read_founder_profile_identity_in_tx,
  procedure_accounts_read_workspace_account_safe_in_tx,
  procedure_parties_party_by_id,
];
/** `resumeSetupInTx` (resumes.ts:42): reopen, hold, or a new generation and a check. */
const RESUME = {
  reads: [...AUTHORIZED.reads, table_orgs],
  writes: [table_org_lifecycles],
  drives: [
    machine_org_lifecycle.t.to_awaitingAuthorization,
    machine_org_lifecycle.t.to_needsAttention,
    machine_org_lifecycle.t.to_processing,
    machine_org_lifecycle.t.to_ready,
    machine_org_lifecycle.t.to_rechecking,
  ],
  invokes: uniq([...AUTHORIZED.invokes, ...FOUNDER_FACTS]),
};
/** `authorizationContextInTx` (reads/contexts.ts:86). */
const CONTEXT = {
  reads: [...AUTHORIZED.reads, table_orgs],
  invokes: uniq([...AUTHORIZED.invokes, procedure_parties_party_by_id, procedure_accounts_read_workspace_setup_signer_in_tx]),
};
/** `buildSponsoredSafeUserOp` (payments executions/external/safes.ts): the sponsored founder operation. */
const SPONSOR_CALLS = [
  callOf(integration_chain_rpc, "fetchEntryPointNonce"),
  callOf(integration_chain_rpc, "fetchUserOperationFees"),
  callOf(integration_chain_rpc, "sponsorUserOperation"),
];
/** v4 `ensureCompanyDeployed` (external/deploys.ts:191) and the install batch read (external/installs.ts:64). */
const COMPANY_CALLS = [
  callOf(integration_chain_rpc, "fetchAddressCode"),
  callOf(integration_chain_rpc, "fetchSafeOwners"),
  callOf(integration_chain_rpc, "fetchBoundedTransaction"),
  callOf(integration_chain_rpc, "broadcastTransaction"),
  callOf(integration_chain_rpc, "fetchEthCall"),
  callOf(integration_companies_house, "sendServiceCall"),
  callOf(integration_companies_house, "signServiceCall"),
  callOf(integration_companies_house, "confirmServiceTransaction"),
];
/** `observeChain` (external/bootstraps.ts:134): one read of the receipt, block, contracts and authority. */
const OBSERVE_CALLS = [
  callOf(integration_chain_rpc, "fetchUserOperationReceipt"),
  callOf(integration_chain_rpc, "hasUserOperationByHash"),
  callOf(integration_chain_rpc, "fetchBlockIdentity"),
  callOf(integration_chain_rpc, "fetchBoundedBlock"),
  callOf(integration_chain_rpc, "fetchLatestBlockNumber"),
  callOf(integration_chain_rpc, "fetchCodeAtBlock"),
  callOf(integration_chain_rpc, "fetchEthCallAtBlock"),
  callOf(integration_chain_rpc, "fetchStorageAtBlock"),
  callOf(integration_chain_rpc, "fetchEthCall"),
  callOf(integration_ponder, "locateBootstrapModule"),
  callOf(integration_companies_house, "readWornHats"),
];
/** `verificationContextInTx` (reads/contexts.ts:182): what one check reads and verifies against. */
const VERIFY_CONTEXT = {
  reads: [table_org_lifecycles, table_orgs],
  invokes: [
    procedure_parties_party_by_id,
    procedure_accounts_read_workspace_account_safe_in_tx,
    procedure_permissions_read_bootstrap_roles_module_in_tx,
    procedure_accounts_read_workspace_authority_account_in_tx,
    procedure_permissions_load_setup_authority_snapshot,
  ],
};
/** `applyObservationInTx` (writes/observations.ts:72) with the proof's materialization (proofs.ts, bootstraps.ts, installs.ts). */
const APPLY = {
  reads: [table_org_lifecycles, table_orgs, table_org_roles, table_org_members, table_org_roles_deployments, table_seat_permissions],
  writes: [table_org_lifecycles, table_org_roles, table_org_roles_deployments, table_org_members, table_seat_permissions, table_orgs],
  drives: [
    machine_org_lifecycle.t.to_processing,
    machine_org_lifecycle.t.to_needsAttention,
    machine_org_lifecycle.t.to_ready,
    machine_org_lifecycle.t.to_rechecking,
    machine_org_lifecycle.t.to_failed,
    machine_org_member.t.to_active,
  ],
  invokes: [
    procedure_permissions_orphan_bootstrap_receipts_in_tx,
    procedure_permissions_setup_authority_snapshot_matches,
    procedure_permissions_rebind_bootstrap_permissions,
    procedure_permissions_write_confirmed_bootstrap_permission,
    procedure_permissions_read_bootstrap_permission_receipt_ids_in_tx,
    procedure_accounts_ensure_account_in_tx,
    procedure_accounts_schedule_welcome_funding,
    procedure_accounts_read_workspace_account_safe_in_tx,
    procedure_accounts_read_workspace_authority_account_in_tx,
    procedure_parties_party_by_id,
    procedure_profiles_read_founder_profile_identity_in_tx,
  ],
};

// ── public ──────────────────────────────────────────────────────────────────────────────────

export const rpc_organizations_setups_begin = defineRpc({
  id: "organizations.setups.begin",
  title: "Create the Organization and its awaiting setup, or replay the intent",
  about:
    "Row `organizations.setups.begin`, the public mutation `organizations/setups:begin`. Signed in; the founder must be off " +
    "the beta waitlist (`requireBetaAccess`, FEATURE_NOT_AVAILABLE). `requireReadyFounder`: a deployed, claimed personal " +
    "Account behind a claimed person Party at that Account (else WRONG_STATE). `createOrganization`: a usable logo image, " +
    "the same founder's handle carrying the same intent (else WRONG_STATE conflictingIntent), then `createOrganizationInTx` " +
    "(handle and bound checks, the v4 Companies House Safe or the derived Safe, insert, `ensureOrgParty`), or the founder's " +
    "existing Organization at the handle (binding a new logo and deleting the old blob); the signer, the founder Account " +
    "and the Organization Account must differ (INVALID_INPUT). `startSetup`: an existing setup of another founder or a " +
    "broken attempt is WRONG_STATE; one that never started resumes; else it inserts the awaiting row (v3 snapshot or v4 " +
    "marker, the telemetry linkage) and schedules organization_creation_started.",
  was: [`${OPS}/begin.ts:11`, `${CONVEX}:8`, `${ROWS}:197`, `${SET}/guards.ts:70`, `${SET}/writes/begins.ts:139`, `${SET}/writes/begins.ts:215`, `${SET}/writes/organizations.ts:61`],
  concept: concept_organizations,
  kind: "mutation",
  who: "A signed-in person with beta access whose personal Account is deployed and claimed behind their claimed person Party.",
  input: Schema.Struct({
    name: S,
    handle: S,
    country: Schema.optionalKey(Schema.NullOr(S)),
    bio: Schema.optionalKey(Schema.NullOr(S)),
    size: Schema.optionalKey(Schema.NullOr(S)),
    logoStorageId: Schema.optionalKey(S),
    chainId: Schema.optionalKey(N),
  }),
  output: Schema.Struct({ orgId: S, setup: SetupView }),
  errors: [...CALL, ...DEFECTS, error_WRONG_STATE, error_PROFILE_NOT_FOUND, error_SMART_ACCOUNT_MISSING, error_FEATURE_NOT_AVAILABLE],
  reads: uniq([table_orgs, ...RESUME.reads]),
  writes: [table_orgs, table_org_lifecycles],
  drives: [machine_org_lifecycle.t.to_awaitingAuthorization, machine_org_lifecycle.t.to_needsAttention],
  invokes: uniq([
    procedure_access_require_beta_access,
    procedure_accounts_read_founder_account_state_in_tx,
    procedure_profiles_read_founder_profile_identity_in_tx,
    procedure_parties_party_by_id,
    procedure_media_find_image_refusal,
    procedure_parties_party_by_handle,
    procedure_parties_ensure_org_party,
    ...RESUME.invokes,
  ]),
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_organizations_setups_get = defineRpc({
  id: "organizations.setups.get",
  title: "The setup, for its founder or a current participant",
  about:
    "Row `organizations.setups.get`, the public query `organizations/setups:get`; the SDK also subscribes to it " +
    "(setup-adapter.ts:203). `readableSetup`: the founder's own until completion; after it, a current Seat's, or while the " +
    "proof is held (not verified) the members Permissions admits for recovery. A foreign setup reads as null, never a refusal.",
  was: [`${OPS}/get.ts:10`, `${CONVEX}:12`, `${ROWS}:205`, `${SET}/guards.ts:22`, `${O}/views.ts:44`],
  concept: concept_organizations,
  kind: "live",
  who: "A signed-in person: the founder before completion, then a current Seat (or the recovery audience during a proof hold).",
  input: OneOrganization,
  output: Schema.NullOr(SetupView),
  errors: [...CALL, ...DEFECTS],
  reads: AUTHORIZED.reads,
  writes: [],
  drives: [],
  invokes: AUTHORIZED.invokes,
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_organizations_setups_get_proof_receipt = defineRpc({
  id: "organizations.setups.get-proof-receipt",
  title: "The narrow proof a submitted setup leaves",
  about:
    "Row `organizations.setups.getProofReceipt`, the public query `organizations/setups:getProofReceipt`. For a setup the " +
    "caller may read: null before a real acknowledgement; else the submitted or confirmed proof (hash, sender, block) with " +
    "the Organization and founder proof Account. A stored identity, projection or occurrence that does not hold is WRONG_STATE.",
  was: [`${OPS}/get-proof-receipt.ts:9`, `${CONVEX}:13`, `${ROWS}:212`, `${SET}/reads/proofs.ts:20`],
  concept: concept_organizations,
  kind: "query",
  who: "A signed-in person who may read the setup (as organizations.setups.get).",
  input: OneOrganization,
  output: Schema.NullOr(U),
  errors: [...CALL, ...DEFECTS, error_WRONG_STATE],
  reads: uniq([...AUTHORIZED.reads, table_orgs]),
  writes: [],
  drives: [],
  invokes: [...AUTHORIZED.invokes, procedure_accounts_read_workspace_proof_account_in_tx],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_organizations_setups_list_mine = defineRpc({
  id: "organizations.setups.list-mine",
  title: "The founder's unfinished setups, one page at a time",
  about:
    "Row `organizations.setups.listMine`, the public query `organizations/setups:listMine`. One page (limit 1-50, default " +
    "50, else INVALID_INPUT) of the caller's setups by by_founder, filtered to `completedAt` absent, as setup views.",
  was: [`${OPS}/list-mine.ts:9`, `${CONVEX}:14`, `${ROWS}:219`, `${SET}/reads/setups.ts:97`],
  concept: concept_organizations,
  kind: "query",
  who: "A signed-in founder; only their own setups.",
  input: Schema.Struct({ cursor: Schema.optionalKey(S), limit: Schema.optionalKey(N) }),
  output: Schema.Struct({ items: Schema.Array(SetupView), nextCursor: Schema.NullOr(S) }),
  errors: [...CALL, ...DEFECTS],
  reads: [table_org_lifecycles],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_organizations_setups_resume = defineRpc({
  id: "organizations.setups.resume",
  title: "Wake a halted setup",
  about:
    "Row `organizations.setups.resume`, the public mutation `organizations/setups:resume`. A setup the caller may read, else " +
    "INVALID_INPUT (setup not found). With no submission: back to awaitingAuthorization when uncompleted and the founder's " +
    "facts still hold, else needsAttention (historical_evidence_missing). With a submission and no live lease or recent " +
    "check (5 s quiet): a new generation, counters cleared, un-parked, status processing, ready or rechecking, and a check " +
    "scheduled at once. It never authorizes another send.",
  was: [`${OPS}/resume.ts:9`, `${CONVEX}:23`, `${ROWS}:226`, `${SET}/writes/resumes.ts:30`, `${SET}/writes/resumes.ts:42`],
  concept: concept_organizations,
  kind: "mutation",
  who: "A signed-in person who may read the setup (as organizations.setups.get).",
  input: OneOrganization,
  output: SetupView,
  errors: [...CALL, ...DEFECTS],
  ...RESUME,
  emits: [event_organization_creation_started],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_organizations_setups_prepare_authorization = defineRpc({
  id: "organizations.setups.prepare-authorization",
  title: "Build the sponsored bootstrap the founder's signer authorizes",
  about:
    "Row `organizations.setups.prepareAuthorization`, the public action `organizations/setups:prepareAuthorization`. Signed " +
    "in (`signedInAction`). Runs organizations.setups.load-authorization-context (prepare), refuses an accepted setup " +
    "(WRONG_STATE), builds the one sponsored founder-Account operation and requires it to match the stored build. v3: the " +
    "Solo bootstrap calls from the snapshot in one MultiSend. v4: `ensureCompanyDeployed` first: Companies House mints the " +
    "company Safe (service lane) unless it has code, the Safe's single owner must be the founder, then `deployMoney` is " +
    "signed under the service lane, recorded before its broadcast (organizations.setups.record-company-install deploy), " +
    "broadcast, confirmed and recorded (install), or recovered by hash; then the `buildMoney` batch the founder's Safe " +
    "runs. Sponsorship refusals (INSUFFICIENT_BALANCE, PROVIDER_ERROR) are admitted. Then " +
    "organizations.setups.record-preparation names the one operation the founder may sign (ten minutes), and the answer " +
    "carries the userOp, its EntryPoint hash and the SafeOp digest.",
  was: [`${OPS}/prepare-authorization.ts:14`, `${CONVEX}:17`, `${ROWS}:233`, `${SET}/external/authorizations.ts:66`, `${SET}/external/deploys.ts:191`, `${SET}/external/installs.ts:64`, `${SET}/writes/authorizations.ts:103`],
  concept: concept_organizations,
  kind: "action",
  who: "The signed-in founder of an uncompleted setup awaiting authorization.",
  input: OneOrganization,
  output: Schema.Struct({
    orgId: S,
    organizationAccountAddress: S,
    founderPersonalAccount: S,
    expectedSigner: S,
    preparationId: S,
    expiresAt: N,
    digest: S,
    userOpHash: S,
    /** `BootstrapUserOp` (protocol organizations/schema.ts): a sponsored v0.7 UserOperation. */
    userOp: U,
  }),
  errors: [...CALL, ...DEFECTS, error_WRONG_STATE, error_PROVIDER_ERROR, error_INSUFFICIENT_BALANCE],
  reads: CONTEXT.reads,
  writes: [table_org_lifecycles],
  drives: [],
  invokes: uniq([...CONTEXT.invokes, procedure_accounts_with_service_lane]),
  emits: [event_organization_creation_started],
  calls: uniq([...SPONSOR_CALLS, ...COMPANY_CALLS]),
  chain: [],
  spans: [],
});

export const rpc_organizations_setups_submit_authorization = defineRpc({
  id: "organizations.setups.submit-authorization",
  title: "Accept the signed bootstrap's hash, then send it from the one elected sender",
  about:
    "Row `organizations.setups.submitAuthorization`, the public action `organizations/setups:submitAuthorization`. Signed in. " +
    "Runs load-authorization-context (submit), admits the signature against the stored build and signer, then " +
    "organizations.setups.accept-authorization binds the hash and elects one sender (a replay of the same hash or a stale " +
    "sender returns the accepted setup without sending). The elected sender checks the fence (check-send-fence), sends the " +
    "exact userOp to the bundler (`eth_sendUserOperation`; a DevNet fault can throw first), and records the outcome with " +
    "record-send-outcome. A send failure is recorded on the setup, never returned; an unrecorded outcome is reported " +
    "(`sendOutcomeUnrecorded`) and a later check resolves it. It answers the current setup read through organizations.setups.get.",
  was: [`${OPS}/submit-authorization.ts:22`, `${CONVEX}:24`, `${ROWS}:240`, `${SET}/external/authorizations.ts:134`, `${SET}/external/authorizations.ts:190`, `${SET}/reads/setups.ts:85`],
  concept: concept_organizations,
  kind: "action",
  who: "The signed-in founder; after completion, a person who may read the setup may replay the accepted hash.",
  input: Schema.Struct({ orgId: S, preparationId: S, userOp: U, signature: S }),
  output: SetupView,
  errors: [...CALL, ...DEFECTS, error_WRONG_STATE, error_PROVIDER_ERROR],
  reads: uniq([...CONTEXT.reads]),
  writes: [table_org_lifecycles],
  drives: [machine_org_lifecycle.t.to_processing],
  invokes: CONTEXT.invokes,
  emits: [],
  calls: [callOf(integration_chain_rpc, "sendUserOperation")],
  chain: [],
  spans: [],
});

// ── internal: the prepare and submit actions' transactions ─────────────────────────────────

export const rpc_organizations_setups_load_authorization_context = defineRpc({
  id: "organizations.setups.load-authorization-context",
  title: "The founder's stored facts an authorization is built and admitted against",
  about:
    "Internal query. The current setup (else INVALID_INPUT); the founder before completion, or after completion only a " +
    "submit by a person who may read it; the Organization, its Party's handle, the founder's Account and setup signer; the " +
    "signer, founder Account and Organization Account distinct addresses; the v3 snapshot or the v4 deploy and install. " +
    "Anything missing is WRONG_STATE (storedFactsMissing).",
  was: [`${OPS}/load-authorization-context.ts:11`, `${CONVEX}:15`, `${SET}/reads/contexts.ts:86`],
  concept: concept_organizations,
  kind: "query",
  who: "internal: the prepare and submit actions, for the signed-in caller they name.",
  input: Schema.Struct({ authUserId: S, orgId: S, purpose: Schema.Literals(["prepare", "submit"]) }),
  output: U,
  errors: [error_INVALID_INPUT, error_WRONG_STATE],
  reads: CONTEXT.reads,
  writes: [],
  drives: [],
  invokes: CONTEXT.invokes,
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_organizations_setups_record_preparation = defineRpc({
  id: "organizations.setups.record-preparation",
  title: "Name the one operation the founder may sign",
  about:
    "Internal mutation. The founder's uncompleted setup awaiting authorization with no submission (else INVALID_INPUT); the " +
    "hash, sender, digest and nonce well formed and a v4 install equal to the stored one (else INVALID_INPUT). Stores the " +
    "preparation (ten minutes), the v4 install when first named, revision + 1; a first start stamps it and schedules " +
    "organization_creation_started without changing the status.",
  was: [`${OPS}/record-preparation.ts:11`, `${CONVEX}:19`, `${SET}/writes/authorizations.ts:54`],
  concept: concept_organizations,
  kind: "mutation",
  who: "internal: organizations.setups.prepare-authorization.",
  input: Schema.Struct({
    authUserId: S,
    orgId: S,
    digest: S,
    userOpHash: S,
    sender: S,
    nonce: S,
    companyInstall: Schema.optionalKey(Schema.Struct({ deploymentJson: S, deployTxHash: S })),
  }),
  output: Schema.Struct({ id: S, expiresAt: N }),
  errors: [error_INVALID_INPUT],
  reads: [table_org_lifecycles],
  writes: [table_org_lifecycles],
  drives: [],
  invokes: [],
  emits: [event_organization_creation_started],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_organizations_setups_record_company_install = defineRpc({
  id: "organizations.setups.record-company-install",
  title: "Record a v4 setup's deployMoney before and after it is sent",
  about:
    "Internal mutation. The founder's uncompleted v4 setup with no submission (else INVALID_INPUT). `deploy` records the " +
    "signed transaction once; `clear` drops it when its hash matches and nothing was installed; `install` records the " +
    "deployment once. Returns the stored deploy and install.",
  was: [`${OPS}/record-company-install.ts:11`, `${CONVEX}:18`, `${SET}/writes/deploys.ts:40`],
  concept: concept_organizations,
  kind: "mutation",
  who: "internal: organizations.setups.prepare-authorization (its `ensureCompanyDeployed`).",
  input: Schema.Struct({
    authUserId: S,
    orgId: S,
    record: Schema.Union([
      Schema.Struct({ kind: Schema.Literal("deploy"), transactionHash: S, signedTransaction: S }),
      Schema.Struct({ kind: Schema.Literal("clear"), transactionHash: S }),
      Schema.Struct({ kind: Schema.Literal("install"), deploymentJson: S, deployTxHash: S }),
    ]),
  }),
  output: Schema.Struct({
    companyDeploy: Schema.optionalKey(Schema.Struct({ transactionHash: S, signedTransaction: S })),
    companyInstall: Schema.optionalKey(Schema.Struct({ deploymentJson: S, deployTxHash: S })),
  }),
  errors: [error_INVALID_INPUT],
  reads: [table_org_lifecycles],
  writes: [table_org_lifecycles],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_organizations_setups_accept_authorization = defineRpc({
  id: "organizations.setups.accept-authorization",
  title: "Bind the hash and elect one sender before any send",
  about:
    "Internal mutation. With a submission: a replay by the founder (or, after completion, a reader) of exactly the accepted " +
    "hash, sender and nonce returns the setup, not elected; anything else is WRONG_STATE. Else the founder's current, " +
    "unexpired, identical preparation (else WRONG_STATE stalePreparation) and a hash no other Organization bound (by_" +
    "submission_hash) become the accepted submission with a new send token, status processing, and a check scheduled now.",
  was: [`${OPS}/accept-authorization.ts:11`, `${CONVEX}:6`, `${SET}/writes/authorizations.ts:133`],
  concept: concept_organizations,
  kind: "mutation",
  who: "internal: organizations.setups.submit-authorization.",
  input: Schema.Struct({ authUserId: S, orgId: S, preparationId: S, digest: S, userOpHash: S, sender: S, nonce: S }),
  output: Schema.Struct({ setup: SetupView, elected: Schema.Boolean, sendToken: Schema.NullOr(S), generation: N }),
  errors: [error_INVALID_INPUT, error_WRONG_STATE],
  reads: AUTHORIZED.reads,
  writes: [table_org_lifecycles],
  drives: [machine_org_lifecycle.t.to_processing],
  invokes: AUTHORIZED.invokes,
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_organizations_setups_check_send_fence = defineRpc({
  id: "organizations.setups.check-send-fence",
  title: "The elected sender is still current",
  about: "Internal query: the setup's generation, send token and accepted hash are still the elected sender's.",
  was: [`${OPS}/check-send-fence.ts:9`, `${CONVEX}:9`, `${SET}/reads/setups.ts:50`],
  concept: concept_organizations,
  kind: "query",
  who: "internal: organizations.setups.submit-authorization, just before it sends.",
  input: Schema.Struct({ orgId: S, generation: N, sendToken: S, userOpHash: S }),
  output: Schema.Boolean,
  errors: [],
  reads: [table_org_lifecycles],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_organizations_setups_record_send_outcome = defineRpc({
  id: "organizations.setups.record-send-outcome",
  title: "Record the one send's outcome",
  about:
    "Internal mutation. A stale sender, a completed or failed setup writes nothing. An acknowledged send stamps " +
    "`acknowledgedAt` once; a failed one records `lastSendIssue` (and `issue` if none), which must be submission_unknown " +
    "(else INVALID_INPUT). Either clears the send token. The status does not change.",
  was: [`${OPS}/record-send-outcome.ts:10`, `${CONVEX}:20`, `${SET}/writes/authorizations.ts:232`],
  concept: concept_organizations,
  kind: "mutation",
  who: "internal: organizations.setups.submit-authorization, after its send.",
  input: Schema.Struct({
    orgId: S,
    generation: N,
    sendToken: S,
    userOpHash: S,
    acknowledged: Schema.Boolean,
    issue: Schema.optionalKey(U),
  }),
  output: Schema.Literals(["applied", "stale"]),
  errors: [error_INVALID_INPUT],
  reads: [table_org_lifecycles],
  writes: [table_org_lifecycles],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

// ── internal: the check's transactions ─────────────────────────────────────────────────────

export const rpc_organizations_setups_claim_check = defineRpc({
  id: "organizations.setups.claim-check",
  title: "Lease one dispatched check, or name the fence a stale one failed",
  about:
    "Internal mutation. A dispatch whose generation or token is no longer current claims nothing and returns the fence it " +
    "failed. Else it reads the verification context (the Organization, its Party, the founder's Account, the v3 Roles " +
    "module and authority snapshot, or the v4 install; missing facts are WRONG_STATE) and leases the check for 90 s with " +
    "a new token, clearing the dispatch and counting the check.",
  was: [`${OPS}/claim-check.ts:12`, `${CONVEX}:10`, `${SET}/writes/checks.ts:153`, `${SET}/reads/contexts.ts:182`],
  concept: concept_organizations,
  kind: "mutation",
  who: "internal: the organizations.setups.observe workflow.",
  input: Schema.Struct({ orgId: S, generation: N, dispatchToken: S }),
  output: U,
  errors: [error_WRONG_STATE],
  reads: VERIFY_CONTEXT.reads,
  writes: [table_org_lifecycles],
  drives: [],
  invokes: VERIFY_CONTEXT.invokes,
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_organizations_setups_apply_observation = defineRpc({
  id: "organizations.setups.apply-observation",
  title: "The row's owner applies one check's observation",
  about:
    "Internal mutation. A stale observation (generation, lease token, accepted hash, previous proof block or an observation " +
    "that no longer fits the row) writes nothing. An orphaned proof orphans its Permission receipts. A verified one records " +
    "the proof: the first materializes the read model (v3: the founder's Account, roles, the Roles deployment, the founder " +
    "member and Seat permissions, the confirmed bootstrap Permissions; v4: the officer hats as roles and the founder's " +
    "hats' Seat permissions), schedules welcome funding and organization_creation_ready; restored evidence rebinds the " +
    "receipts or holds the setup. Any other observation moves the status by `decideSetupObservation`, counts it, " +
    "schedules the next check (fixed delays, or the unresolved backoff that parks after a day), and the first definitive " +
    "failure schedules organization_creation_failed. Returns the check's facts for the action's wide event.",
  was: [`${OPS}/apply-observation.ts:14`, `${CONVEX}:7`, `${SET}/writes/observations.ts:72`, `${SET}/writes/proofs.ts:22`, `${SET}/writes/bootstraps.ts:28`, `${SET}/writes/installs.ts:42`, `${SET}/writes/checks.ts:111`],
  concept: concept_organizations,
  kind: "mutation",
  who: "internal: the organizations.setups.observe workflow, holding the check's lease.",
  input: Schema.Struct({
    orgId: S,
    generation: N,
    token: S,
    expectedHash: S,
    expectedProofBlockHash: Schema.optionalKey(S),
    /** `bootstrapObservationValidator` (rules/observations.ts): pending, providerFailure, verified, sameProof, orphaned, definitive, workerFailure. */
    observation: U,
  }),
  output: Schema.Union([Schema.Literal("stale"), U]),
  errors: [error_INVALID_INPUT, error_WRONG_STATE],
  ...APPLY,
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_organizations_setups_recover_due_page = defineRpc({
  id: "organizations.setups.recover-due-page",
  title: "Recover one page of lapsed checks",
  about:
    "Internal mutation. Up to 50 setups whose `dueAt` is at or before the cutoff: a row with no submission is released; an " +
    "imported submission never checked gets its first dispatch; any other lapsed check is rescheduled, and the third " +
    "abandoned check halts it (needsAttention, or ready for a verified completed setup, issue worker_failed). When more " +
    "remain it schedules organizations.setups.recover again with the same cutoff. A page with nothing due is a no-op record.",
  was: [`${OPS}/recover-due-page.ts:12`, `${CONVEX}:22`, `${SET}/writes/checks.ts:212`, `${SET}/writes/checks.ts:245`],
  concept: concept_organizations,
  kind: "mutation",
  who: "internal: the organizations.setups.recover workflow.",
  input: Schema.Struct({ cutoff: N }),
  output: Schema.Struct({ recovered: N, hasMore: Schema.Boolean }),
  errors: [error_UNKNOWN],
  reads: [table_org_lifecycles],
  writes: [table_org_lifecycles],
  drives: [machine_org_lifecycle.t.to_needsAttention],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_organizations_setups_emit_transition = defineRpc({
  id: "organizations.setups.emit-transition",
  title: "Deliver organization_creation_started, ready or failed",
  about:
    "Telemetry plumbing: the internal action `organizations/setups:emitTransition`, scheduled by `scheduleCreationTransition` " +
    "(setups/events.ts:64) from the mutation that made the transition durable: begin and the first preparation or reopen " +
    "(started), the first proof (ready), the first definitive failure (failed). It posts the event from the snapshot, " +
    "best effort, with the stage, error code, confirmation reason and flat chain cause props. Reads and writes no table.",
  was: [`${OPS}/emit-transition.ts:12`, `${CONVEX}:11`, `${SET}/events.ts:64`, `${SET}/events.ts:104`],
  concept: concept_organizations,
  kind: "action",
  who: "internal: scheduled by the setup write whose transition it reports.",
  input: Schema.Struct({
    transition: Schema.Literals(["started", "ready", "failed"]),
    authUserId: S,
    organizationId: S,
    attemptNumber: N,
    attemptStartedAt: N,
    transitionedAt: N,
    stage: Schema.optionalKey(Schema.Literal("confirmingBootstrap")),
    errorCode: Schema.optionalKey(S),
    retryable: Schema.optionalKey(Schema.Boolean),
    confirmationReason: Schema.optionalKey(S),
    failureMode: Schema.optionalKey(S),
    chainProps: Schema.optionalKey(U),
  }),
  output: Schema.Void,
  errors: [],
  reads: [],
  writes: [],
  drives: [],
  invokes: [],
  emits: [event_organization_creation_started, event_organization_creation_ready, event_organization_creation_failed],
  calls: [],
  chain: [],
  spans: [],
});

// ── workflows ───────────────────────────────────────────────────────────────────────────────

export const workflow_organizations_setups_observe = defineWorkflow({
  id: "organizations.setups.observe",
  title: "One scheduled check of an accepted setup",
  about:
    "The internal action `organizations/setups:observe`, scheduled by `scheduleCheck` (writes/checks.ts:77, runAfter with " +
    "the decided delay) from accept-authorization, resume, apply-observation, the unresolved backoff and recover-due-page. " +
    "It runs as the system job `check_organization_setup` until the claim, then for the founder it names. It claims the " +
    "dispatch (claim-check); a stale dispatch ends there. It reads the chain once under its own 45 s budget: the receipt " +
    "(recorded, by hash, or located by the indexer), the block, the canonical bootstrap's logs, the contracts' state at the " +
    "receipt block and the current authority (v3), or the company Safe's owners, module, guard and the founder's hats (v4); " +
    "a failed indexer lookup is a failed read. It hands the observation to apply-observation. One wide record carries the " +
    "entry, the claim and the applied check's facts; the check that parks the setup raises one alert (UNKNOWN setupParked). " +
    "Checks back off 1, 2, 4, 8, 15, 30 s (5 to 300 s after a provider failure) in the first two minutes, then 1, 2, 4 … " +
    "minutes capped at 60, and park after a day unresolved; a verified proof is checked every minute until final.",
  was: [`${OPS}/observe.ts:29`, `${CONVEX}:16`, `${SET}/writes/checks.ts:77`, `${SET}/external/bootstraps.ts:109`, `${SET}/external/bootstraps.ts:134`, `${SET}/rules/policies.ts:33`, `${SET}/rules/policies.ts:125`, `${O}/README.md:484`],
  concept: concept_organizations,
  priority: "critical",
  trigger: { after: rpc_organizations_setups_accept_authorization },
  instance: { per: table_org_lifecycles },
  waits: [{ name: "next-check", for: "timer", about: "The delay `decideSetupObservation` or `nextUnresolvedCheck` chose; none while parked." }],
  steps: [
    { name: "attribute", about: "Runs as the system job `check_organization_setup`." },
    { name: "claim", about: "organizations.setups.claim-check: lease the dispatch for 90 s, or stop on the fence a stale one failed." },
    { name: "observe", about: "`observeChain`: one bounded read of the receipt, block, logs, contracts and authority (45 s)." },
    { name: "apply", about: "organizations.setups.apply-observation: the row's owner applies it and schedules the next check." },
    { name: "report", about: "The applied check's facts on the wide event; a parked setup raises its one alert." },
  ],
  reads: uniq([...VERIFY_CONTEXT.reads, ...APPLY.reads]),
  writes: APPLY.writes,
  drives: APPLY.drives,
  invokes: uniq([...VERIFY_CONTEXT.invokes, ...APPLY.invokes]),
  emits: [],
  calls: OBSERVE_CALLS,
  chain: [],
  idempotency: "The dispatch token and generation: a dispatch that is no longer current claims nothing, and an observation under a lapsed lease token writes nothing.",
  timeoutMs: 45_000,
  retries: { max: 2, backoff: "none" },
  compensation:
    "None. A lapsed lease is recovered by organizations.setups.recover: rescheduled twice, and the third abandoned check " +
    "halts the setup with issue worker_failed.",
});

export const workflow_organizations_setups_recover = defineWorkflow({
  id: "organizations.setups.recover",
  title: "Recover lapsed setup checks",
  about:
    "The internal action `organizations/setups:recover`, the cron `recover Organization setup` every minute " +
    "(`crons.interval`, not clock-aligned), and each further page recover-due-page schedules with the same cutoff. It runs " +
    "as the system job `recover_organization_setup_checks`, takes the business time as cutoff when none is given, and runs " +
    "organizations.setups.recover-due-page; a run that recovered nothing and has no more is a no-op record. Timeout is " +
    "Convex's action limit; the code sets none.",
  was: [`${OPS}/recover.ts:26`, `${CONVEX}:21`, "packages/backend/src/platform/jobs.ts:151", `${SET}/writes/checks.ts:237`],
  concept: concept_organizations,
  priority: "normal",
  trigger: { cron: "* * * * *" },
  instance: "singleton",
  steps: [
    { name: "attribute", about: "Runs as the system job `recover_organization_setup_checks`." },
    { name: "page", about: "organizations.setups.recover-due-page under one cutoff; it schedules the next page itself." },
    { name: "report", about: "Annotates recovered and has_more; nothing recovered is a no-op." },
  ],
  reads: [table_org_lifecycles],
  writes: [table_org_lifecycles],
  drives: [machine_org_lifecycle.t.to_needsAttention],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  idempotency: "Recovery removes due eligibility (`dueAt` cleared or moved past the cutoff), so a second run under the same cutoff finds nothing.",
  timeoutMs: 600_000,
  retries: { max: 0, backoff: "none" },
});
