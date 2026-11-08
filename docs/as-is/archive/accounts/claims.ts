// The as-is book of the old accounts concept: the claims area (install the person's signer as
// their Safe's only owner).
//
// Every operation registered at `accounts/claims:*` (packages/backend/convex/accounts/claims.ts).
// One public row, `claims.claim` (packages/protocol/src/accounts/operations.ts:95); six internal
// mutations the claim action runs through ctx.runMutation in the same call; and the
// member_activation poster it schedules, which is telemetry only, so an rpc whose about starts
// with `Telemetry plumbing:`. Nothing here is a workflow.
//
// On Protocol v4 the claim is one EOA transaction from Companies House's tier service key (the
// only member of the tier's claim role): Roles delegatecalls CompaniesHouseClaimer, which deploys
// the Safe when it has no code and swaps Companies House out for the person's signer. The person
// signs nothing. The fields still named claimUserOp* hold that transaction.
//
// Paths in `was` are relative to the old repository root (/home/user/factory).

import { Schema } from "effect";
import { defineRpc, type CallRef, type FunctionRef } from "../../../packages/book/src/index.ts";

import { concept_accounts } from "../shared/foundation.ts";
import { contract_companies_house_claimer, contract_roles, contract_safe, integration_chain_rpc } from "../shared/external.ts";
import {
  error_ACCOUNT_CLAIMED_BY_OTHER_SIGNER,
  error_ENV_MISSING,
  error_FEATURE_NOT_AVAILABLE,
  error_INVALID_INPUT,
  error_NOT_AUTHENTICATED,
  error_PROFILE_NOT_FOUND,
  error_PROVIDER_ERROR,
  error_UNKNOWN,
  error_WRONG_STATE,
  event_member_activation_failed,
  event_member_activation_ready,
  event_member_activation_started,
  event_provisioning_safe_confirmed,
} from "../shared/vocabulary.ts";
import {
  procedure_access_require_authenticated_user,
  procedure_access_require_beta_access_from_action,
  procedure_access_schedule_qualify,
} from "../access/procedures.ts";
import { procedure_organizations_advance_pending_safe_members_in_tx } from "../organizations/procedures.ts";
import { table_service_lanes, table_smart_accounts } from "./data.ts";
import { procedure_accounts_with_service_lane } from "./procedures.ts";
import { SmartAccount } from "./safes.ts";

const BACKEND = "packages/backend";
const CONVEX = `${BACKEND}/convex/accounts/claims.ts`;
const A = `${BACKEND}/src/accounts`;
const CLAIMS = `${A}/claims`;
const OPS = `${CLAIMS}/operations`;
const ROWS = "packages/protocol/src/accounts/operations.ts";
const CH = `${BACKEND}/src/integrations/companies-house`;

/** A chain-rpc call: the booked link, or a link by its conventional id that the build reports until external.ts books it. */
const rpcCall = (name: string): CallRef =>
  (integration_chain_rpc.c as Record<string, CallRef | undefined>)[name] ?? {
    _kind: "call",
    id: `chain-rpc.${name}`,
    integration: "chain-rpc",
    name,
  };

/** A contract function: the booked link, or one by its conventional id that the build reports. */
const fn = (contract: { readonly id: string; readonly f: object }, name: string): FunctionRef =>
  (contract.f as Record<string, FunctionRef | undefined>)[name] ?? {
    _kind: "function",
    id: `${contract.id}.${name}`,
    contract: contract.id,
    name,
  };

const CHAIN_METHODS: Record<string, readonly string[]> = {
  fetchAddressCode: ["eth_getCode"],
  fetchSafeOwners: ["eth_call"],
  fetchBoundedTransaction: ["eth_getTransactionByHash"],
  prepareTransaction: ["eth_getTransactionCount", "eth_call", "eth_estimateGas"],
  broadcastTransaction: ["eth_sendRawTransaction"],
  waitForTransactionReceipt: ["eth_getTransactionReceipt"],
  fetchBlockTimestamp: ["eth_getBlockByNumber"],
};

const onChain = (...names: string[]) => ({
  calls: names.map(rpcCall),
  spans: [...new Set(names.flatMap((name) => (CHAIN_METHODS[name] ?? []).map((method) => `chain.read ${method}`)))],
});

const noChain = { calls: [], chain: [], spans: [] } as const;

/** Every claim store transition is keyed by the person's Safe on one chain. */
const SafeKey = {
  authUserId: Schema.String,
  chainId: Schema.Number,
  safeAddress: Schema.String,
};

const RUN_BY_CLAIM = "internal: run through ctx.runMutation by accounts.claims.claim (claims/writes/transitions.ts).";

/** requireSafe (reads/safes.ts:28): a malformed or different address is INVALID_INPUT, no row PROFILE_NOT_FOUND. */
const STORE_ERRORS = [error_INVALID_INPUT, error_PROFILE_NOT_FOUND, error_UNKNOWN];

// ── public ──────────────────────────────────────────────────────────────────────────────────

export const rpc_accounts_claims_claim = defineRpc({
  id: "accounts.claims.claim",
  title: "Install the signer as the Safe's only owner",
  about:
    "Public action. Signed in; the beta waitlist must admit the person (access's hold, FEATURE_NOT_AVAILABLE when " +
    "waiting). The Safe row must exist (INVALID_INPUT `account`, not the row's PROFILE_NOT_FOUND). A claimed row answers " +
    "only for its recorded signer (INVALID_INPUT). A recorded submission is recovered first: another signer's is " +
    "INVALID_INPUT, one without its lock WRONG_STATE; its stored bytes must hash to the recorded hash; known to the node " +
    "or broadcast again it is confirmed, a definitive refusal of an unknown transaction clears it. Then the chain decides: " +
    "no code or Companies House alone is unclaimed; the signer alone is adopted (`adoptOnChain`); anything else is " +
    "ACCOUNT_CLAIMED_BY_OTHER_SIGNER naming up to 8 owners. It builds the claim role's call (Protocol v4 settings and the " +
    "service key: ENV_MISSING), takes the claim lock (`begin`; a live lock answers the unclaimed row for the caller to " +
    "poll), schedules member_activation_started, then under the service key's lane (`withServiceLane`, WRONG_STATE when " +
    "busy for a minute) signs, records (`recordSubmission`), broadcasts and waits for the receipt. A reverted receipt " +
    "clears the record; owners that are not exactly the signer are WRONG_STATE. On success it records the claim " +
    "(`confirm`, which advances the person's waiting memberships), schedules provisioning_safe_confirmed and " +
    "member_activation_ready. A failure releases only what is definitively unsent (`releaseLock` or `clearSubmission`; " +
    "a release that fails writes [CAPXUL_CLAIM_RELEASE_FAILED]) and schedules member_activation_failed. An answer that " +
    "shows the Safe claimed runs Organizations' `organizations.members.advance` (already-claimed paths) and schedules " +
    "access.referrals.qualify for the email.",
  was: [
    `${CONVEX}:5`,
    `${OPS}/claim.ts:34`,
    `${OPS}/claim.ts:44`,
    `${CLAIMS}/rules.ts:45`,
    `${CLAIMS}/rules.ts:122`,
    `${CLAIMS}/external/recovery.ts:37`,
    `${CLAIMS}/external/recovery.ts:66`,
    `${CLAIMS}/external/ownership.ts:23`,
    `${CLAIMS}/external/ownership.ts:48`,
    `${CLAIMS}/external/submissions.ts:45`,
    `${CLAIMS}/external/submissions.ts:98`,
    `${CLAIMS}/external/submissions.ts:164`,
    `${CLAIMS}/writes/transitions.ts:87`,
    `${CLAIMS}/writes/transitions.ts:100`,
    `${CLAIMS}/errors.ts:12`,
    `${CLAIMS}/errors.ts:63`,
    `${CLAIMS}/events.ts:28`,
    `${CH}/service.ts:46`,
    `${CH}/service.ts:92`,
    `${CH}/service.ts:116`,
    `${ROWS}:102`,
  ],
  concept: concept_accounts,
  kind: "action",
  who: "A signed-in person admitted by the beta waitlist, for their own Safe on the named chain.",
  input: Schema.Struct({ chainId: Schema.Number, signerAddress: Schema.String }),
  output: SmartAccount,
  errors: [
    error_NOT_AUTHENTICATED,
    error_INVALID_INPUT,
    error_UNKNOWN,
    error_ENV_MISSING,
    error_PROVIDER_ERROR,
    error_ACCOUNT_CLAIMED_BY_OTHER_SIGNER,
    error_FEATURE_NOT_AVAILABLE,
    error_PROFILE_NOT_FOUND,
    error_WRONG_STATE,
  ],
  reads: [table_smart_accounts, table_service_lanes],
  writes: [table_smart_accounts, table_service_lanes],
  drives: [],
  invokes: [
    procedure_access_require_authenticated_user,
    procedure_access_require_beta_access_from_action,
    procedure_accounts_with_service_lane,
    procedure_organizations_advance_pending_safe_members_in_tx,
    procedure_access_schedule_qualify,
  ],
  emits: [
    event_member_activation_started,
    event_member_activation_ready,
    event_member_activation_failed,
    event_provisioning_safe_confirmed,
  ],
  ...onChain(
    "fetchBoundedTransaction",
    "broadcastTransaction",
    "fetchAddressCode",
    "fetchSafeOwners",
    "prepareTransaction",
    "waitForTransactionReceipt",
    "fetchBlockTimestamp",
  ),
  chain: [fn(contract_roles, "execTransactionWithRole"), fn(contract_companies_house_claimer, "claim"), fn(contract_safe, "getOwners")],
});

// ── internal store transitions ──────────────────────────────────────────────────────────────

export const rpc_accounts_claims_begin = defineRpc({
  id: "accounts.claims.begin",
  title: "Take the claim lock for a Safe",
  about:
    "Internal mutation. A claimed row answers `alreadyClaimed`; a lock younger than ten minutes of wall time " +
    "(`deploymentInFlightAt`) answers `inFlight`; otherwise it writes a fresh ULID as `claimLockId` and the wall time as " +
    "`deploymentInFlightAt` and answers `locked` with the lock id. A lapsed lock is overwritten even when it recorded a " +
    "submission.",
  was: [`${CONVEX}:4`, `${OPS}/begin.ts:14`, `${CLAIMS}/rules.ts:79`, `${CLAIMS}/writes/rows.ts:40`],
  concept: concept_accounts,
  kind: "mutation",
  who: RUN_BY_CLAIM,
  input: Schema.Struct(SafeKey),
  output: Schema.Union([
    Schema.Struct({ status: Schema.Literal("alreadyClaimed"), account: SmartAccount }),
    Schema.Struct({ status: Schema.Literal("inFlight"), account: SmartAccount }),
    Schema.Struct({ status: Schema.Literal("locked"), account: SmartAccount, lockId: Schema.String }),
  ]),
  errors: STORE_ERRORS,
  reads: [table_smart_accounts],
  writes: [table_smart_accounts],
  drives: [],
  invokes: [],
  emits: [],
  ...noChain,
});

export const rpc_accounts_claims_record_submission = defineRpc({
  id: "accounts.claims.record-submission",
  title: "Record the exact signed claim under its lock before it is sent",
  about:
    "Internal mutation. Signer and hash (0x+64 hex) are normalized, the stored JSON must be non-empty and the lock id a " +
    "26-character ULID (INVALID_INPUT). A claimed row answers unchanged. Another lock is WRONG_STATE " +
    "(differentClaimLock); a different submission already recorded is INVALID_INPUT. It writes claimUserOpHash, " +
    "claimSignerAddress and claimUserOpJson (`{ signedTransaction }`).",
  was: [`${CONVEX}:9`, `${OPS}/record-submission.ts:15`, `${CLAIMS}/rules.ts:93`, `${CLAIMS}/writes/rows.ts:48`, `${CLAIMS}/errors.ts:41`],
  concept: concept_accounts,
  kind: "mutation",
  who: RUN_BY_CLAIM,
  input: Schema.Struct({ ...SafeKey, signerAddress: Schema.String, userOpHash: Schema.String, userOpJson: Schema.String, lockId: Schema.String }),
  output: SmartAccount,
  errors: [...STORE_ERRORS, error_WRONG_STATE],
  reads: [table_smart_accounts],
  writes: [table_smart_accounts],
  drives: [],
  invokes: [],
  emits: [],
  ...noChain,
});

export const rpc_accounts_claims_clear_submission = defineRpc({
  id: "accounts.claims.clear-submission",
  title: "Forget a claim submission the chain definitively never took",
  about:
    "Internal mutation. Hash, signer and lock id are validated (INVALID_INPUT). Unless the row is unclaimed and records " +
    "exactly this submission under this lock, it answers unchanged; otherwise it clears the lock, the lease stamp and the " +
    "recorded submission together. The claim runs it on a definitive absence, a reverted receipt, or a definitively " +
    "refused broadcast.",
  was: [`${CONVEX}:6`, `${OPS}/clear-submission.ts:14`, `${CLAIMS}/rules.ts:84`, `${CLAIMS}/writes/rows.ts:63`],
  concept: concept_accounts,
  kind: "mutation",
  who: RUN_BY_CLAIM,
  input: Schema.Struct({ ...SafeKey, signerAddress: Schema.String, userOpHash: Schema.String, lockId: Schema.String }),
  output: SmartAccount,
  errors: STORE_ERRORS,
  reads: [table_smart_accounts],
  writes: [table_smart_accounts],
  drives: [],
  invokes: [],
  emits: [],
  ...noChain,
});

export const rpc_accounts_claims_release_lock = defineRpc({
  id: "accounts.claims.release-lock",
  title: "Release a claim lock under which nothing was recorded",
  about:
    "Internal mutation. The lock id must be a ULID (INVALID_INPUT). A claimed row, another lock, or a recorded submission " +
    "answers unchanged; otherwise it clears claimLockId and deploymentInFlightAt.",
  was: [`${CONVEX}:10`, `${OPS}/release-lock.ts:13`, `${CLAIMS}/writes/rows.ts:66`],
  concept: concept_accounts,
  kind: "mutation",
  who: RUN_BY_CLAIM,
  input: Schema.Struct({ ...SafeKey, lockId: Schema.String }),
  output: SmartAccount,
  errors: STORE_ERRORS,
  reads: [table_smart_accounts],
  writes: [table_smart_accounts],
  drives: [],
  invokes: [],
  emits: [],
  ...noChain,
});

export const rpc_accounts_claims_confirm = defineRpc({
  id: "accounts.claims.confirm",
  title: "Record the claim the chain confirmed",
  about:
    "Internal mutation. A claimed row advances the person's waiting memberships (Organizations' " +
    "`advancePendingSafeMembersInTx`) and answers. Otherwise the row must record exactly this submission under this lock " +
    "(WRONG_STATE differentClaimSubmission). It sets signerAddress, claimedAt (business time), claimTxHash and userOpHash, " +
    "clears the lock and submission, takes the claim as the deployment when deployedAt was null (deployedAt from the block, " +
    "deployTxHash the claim's), stores deployedAtBlock, then advances the memberships in the same transaction.",
  was: [`${CONVEX}:7`, `${OPS}/confirm.ts:15`, `${CLAIMS}/writes/rows.ts:70`, `${CLAIMS}/writes/rows.ts:107`, `${CLAIMS}/errors.ts:51`],
  concept: concept_accounts,
  kind: "mutation",
  who: RUN_BY_CLAIM,
  input: Schema.Struct({
    ...SafeKey,
    signerAddress: Schema.String,
    derivedDeployedAt: Schema.Number,
    claimTxHash: Schema.String,
    userOpHash: Schema.String,
    lockId: Schema.String,
    deployedAtBlock: Schema.optionalKey(Schema.Number),
  }),
  output: SmartAccount,
  errors: [...STORE_ERRORS, error_WRONG_STATE],
  reads: [table_smart_accounts],
  writes: [table_smart_accounts],
  drives: [],
  invokes: [procedure_organizations_advance_pending_safe_members_in_tx],
  emits: [],
  ...noChain,
});

export const rpc_accounts_claims_adopt_on_chain = defineRpc({
  id: "accounts.claims.adopt-on-chain",
  title: "Record a claim the chain shows the signer already made",
  about:
    "Internal mutation. When the row is unclaimed it sets the signer, claimedAt to business time (and deployedAt to the " +
    "same time when null: not the chain's time) and clears any lock or submission; then it advances the person's waiting " +
    "memberships. No transaction hash is recorded.",
  was: [`${CONVEX}:3`, `${OPS}/adopt-on-chain.ts:13`, `${CLAIMS}/writes/rows.ts:95`, `${CLAIMS}/writes/rows.ts:107`],
  concept: concept_accounts,
  kind: "mutation",
  who: RUN_BY_CLAIM,
  input: Schema.Struct({ ...SafeKey, signerAddress: Schema.String }),
  output: SmartAccount,
  errors: STORE_ERRORS,
  reads: [table_smart_accounts],
  writes: [table_smart_accounts],
  drives: [],
  invokes: [procedure_organizations_advance_pending_safe_members_in_tx],
  emits: [],
  ...noChain,
});

export const rpc_accounts_claims_emit_member_activation = defineRpc({
  id: "accounts.claims.emit-member-activation",
  title: "Post one member_activation event",
  about:
    "Telemetry plumbing: an internal action the claim schedules (never awaited), run as the system job " +
    "`emit_member_activation`. It posts member_activation_started, _ready or _failed with `$insert_id` " +
    "`member:<authUserId>:activation:<transition>`, the duration, or on failure stage accountClaim, the error code, " +
    "whether it is retryable (anything but INVALID_INPUT and NOT_AUTHENTICATED), the failure mode and the chain cause " +
    "properties.",
  was: [`${CONVEX}:8`, `${OPS}/emit-member-activation.ts:15`, `${CLAIMS}/events.ts:47`, `${CLAIMS}/rules.ts:132`],
  concept: concept_accounts,
  kind: "action",
  who: "internal: scheduled by accounts.claims.claim (`memberActivation`).",
  input: Schema.Struct({
    authUserId: Schema.String,
    transition: Schema.Literals(["started", "ready", "failed"]),
    journeyId: Schema.optionalKey(Schema.String),
    correlationId: Schema.optionalKey(Schema.String),
    durationMs: Schema.optionalKey(Schema.Number),
    errorCode: Schema.optionalKey(Schema.String),
    retryable: Schema.optionalKey(Schema.Boolean),
    failureMode: Schema.optionalKey(Schema.String),
    chainProps: Schema.optionalKey(Schema.Unknown),
  }),
  output: Schema.Void,
  errors: [],
  reads: [],
  writes: [],
  drives: [],
  invokes: [],
  emits: [event_member_activation_started, event_member_activation_ready, event_member_activation_failed],
  ...noChain,
});
