// The accounts concept's own door, as it is: every function packages/backend/src/accounts/index.ts
// exports that runs inside its caller's Convex transaction (it takes the caller's QueryCtx or
// MutationCtx and throws CapxulErrors), and the action-side door exports other concepts call
// from their own actions (withServiceLane, the faucet mints, the relay, the position readers).
// The action-side ones are booked as procedures because other concepts' records link them; each
// says in its `about` that it runs outside any transaction and which chain calls it makes, which
// a procedure record cannot hold. Pure helpers the door also exports (faucetSafeAddressForSigner,
// withChain) and the types (AccountIdentity, WireAssetPosition) are not booked.
//
// A Convex `.unique()` read throws a plain Error when two rows match; at the operation boundary
// that is an UNKNOWN defect, so a procedure that reads with `.unique()` lists UNKNOWN.
// Reads and writes are what the function's own code touches; a neighbour's function it calls is
// an `invokes`. Paths in `was` are relative to the old repository root (/home/user/factory).

import { Schema } from "effect";
import { defineProcedure } from "../../../packages/book/src/index.ts";

import { concept_accounts } from "../shared/foundation.ts";
import {
  error_ACCOUNT_NOT_FOUND,
  error_ENV_MISSING,
  error_INSUFFICIENT_BALANCE,
  error_INVALID_INPUT,
  error_PROVIDER_ERROR,
  error_SMART_ACCOUNT_MISSING,
  error_TRANSACTION_FAILED,
  error_UNKNOWN,
  error_WRONG_STATE,
} from "../shared/vocabulary.ts";
import { procedure_profiles_read_profile_account_binding_in_tx } from "../profiles/procedures.ts";
import {
  table_accounts,
  table_approvals,
  table_service_lanes,
  table_smart_accounts,
  table_welcome_funding_grants,
} from "./data.ts";

const B = "packages/backend/src";
const A = `${B}/accounts`;
const DOOR = `${A}/index.ts`;

const S = Schema.String;
const N = Schema.Number;
const B_ = Schema.Boolean;
const NullOr = Schema.NullOr;
const opt = Schema.optionalKey;

const none = { drives: [], invokes: [], emits: [] } as const;

/** `AccountIdentity` (accounts/model.ts:8). */
const AccountIdentity = Schema.Struct({ accountId: S, authUserId: S, smartAccountAddress: S, chainId: N });
/** `WireAssetPosition` (accounts/model.ts:37): one settlement asset's exact raw position. */
const Position = Schema.Struct({
  assetId: S,
  tokenAddress: S,
  symbol: S,
  decimals: N,
  rawBalance: S,
  rawAvailableBalance: S,
});
/** `FaucetMintArgs` (grants/rules.ts:31): one named token mint; there is no default token. */
const MintArgs = {
  chainId: N,
  holderAddress: S,
  rawAmount: S,
  tokenAddress: S,
  decimals: N,
};
const MINT_ERRORS = [error_INVALID_INPUT, error_ENV_MISSING, error_TRANSACTION_FAILED, error_PROVIDER_ERROR, error_INSUFFICIENT_BALANCE];
const ACTION_SIDE = "Action-side door export: an Effect that needs `ChainRpc`, run in the caller's action, never inside a transaction.";

// ── identity: payment, Permission and Access facts (reads/identity.ts) ────────────────────────

export const procedure_accounts_read_account_owner_in_tx = defineProcedure({
  id: "accounts.read-account-owner-in-tx",
  title: "Read the person who owns an Account",
  about:
    "The `authUserId` of the Account with this id (`by_account_id`, first), or null. Exported on the door, but no other " +
    "concept calls it today.",
  was: [`${A}/reads/identity.ts:23`, `${DOOR}:12`],
  concept: concept_accounts,
  input: Schema.Struct({ accountId: S }),
  output: NullOr(Schema.Struct({ authUserId: S })),
  errors: [],
  reads: [table_accounts],
  writes: [],
  ...none,
});

export const procedure_accounts_require_payment_account_in_tx = defineProcedure({
  id: "accounts.require-payment-account-in-tx",
  title: "Require the caller's payment Account",
  about:
    "The person's Base Sepolia Account as an `AccountIdentity` (`by_auth_user_chain`, first); none is `INVALID_INPUT` " +
    "(`actor`: authenticated Account is not ready). It does not check the Account's Safe against the Safe row. Payments' " +
    "funding read, recipient resolution and authority guard, Activity's guard, Payroll's replays and Access sessions call it.",
  was: [
    `${A}/reads/identity.ts:34`,
    `${A}/errors.ts:72`,
    `${DOOR}:19`,
    `${B}/payments/guards/authority.ts:178`,
    `${B}/activity/guards.ts:21`,
    `${B}/access/sessions/guards.ts:95`,
  ],
  concept: concept_accounts,
  input: Schema.Struct({ authUserId: S }),
  output: AccountIdentity,
  errors: [error_INVALID_INPUT],
  reads: [table_accounts],
  writes: [],
  ...none,
});

export const procedure_accounts_require_exact_account_identity_in_tx = defineProcedure({
  id: "accounts.require-exact-account-identity-in-tx",
  title: "Require exactly one matching Account and Safe",
  about:
    "Collects the person's Base Sepolia Accounts and Safe rows. Neither is `SMART_ACCOUNT_MISSING`; a Safe with no Account " +
    "is `ACCOUNT_NOT_FOUND`; any other disagreement (more than one of either, an Account without a Safe, a Safe address " +
    "that is not 0x+40 hex, or Account and Safe at different addresses) is `UNKNOWN` naming the counts, never the caller's " +
    "input. Returns the Account and the lowercase personal Safe. Permissions' authority guards, verification reads and " +
    "invitation proposals call it.",
  was: [
    `${A}/reads/identity.ts:48`,
    `${A}/errors.ts:30`,
    `${A}/errors.ts:43`,
    `${DOOR}:18`,
    `${B}/permissions/authorities/guards.ts:53`,
    `${B}/permissions/configurations/writes/proposals.ts:58`,
  ],
  concept: concept_accounts,
  input: Schema.Struct({ authUserId: S }),
  output: Schema.Struct({ account: AccountIdentity, personalSafe: S }),
  errors: [error_SMART_ACCOUNT_MISSING, error_ACCOUNT_NOT_FOUND, error_UNKNOWN],
  reads: [table_accounts, table_smart_accounts],
  writes: [],
  ...none,
});

export const procedure_accounts_read_attached_account_for_safe_in_tx = defineProcedure({
  id: "accounts.read-attached-account-for-safe-in-tx",
  title: "Read the one Account attached to a Safe",
  about:
    "The Base Sepolia Account at this Safe (`by_smart_account_address`, lowercased, filtered by chain) when exactly one " +
    "exists, else null. Permissions' authority reads, grants and invitation snapshots call it.",
  was: [`${A}/reads/identity.ts:91`, `${DOOR}:14`, `${B}/permissions/authorities/reads.ts:48`, `${B}/permissions/grants/writes/grants.ts:100`],
  concept: concept_accounts,
  input: Schema.Struct({ safeAddress: S }),
  output: NullOr(AccountIdentity),
  errors: [],
  reads: [table_accounts],
  writes: [],
  ...none,
});

export const procedure_accounts_require_account_signer_in_tx = defineProcedure({
  id: "accounts.require-account-signer-in-tx",
  title: "Require the caller's claimed Safe signer",
  about:
    "Reads the person's one Base Sepolia Safe row (`by_auth_user_chain`, `.unique()`) and refuses `INVALID_INPUT` " +
    "(`signerAddress`: does not match the authenticated Account signer) unless its claimed signer is the address named, " +
    "case-insensitively; a missing row is the same refusal. Returns the Safe. Payments' Organization, request and " +
    "lifecycle commands and Permissions' signer guard call it.",
  was: [
    `${A}/reads/identity.ts:107`,
    `${A}/errors.ts:75`,
    `${DOOR}:17`,
    `${B}/payments/commands/writes/organizations.ts:227`,
    `${B}/payments/lifecycles/guards.ts:22`,
    `${B}/permissions/guards/signers.ts:14`,
  ],
  concept: concept_accounts,
  input: Schema.Struct({ authUserId: S, signerAddress: S }),
  output: Schema.Struct({ smartAccountAddress: S }),
  errors: [error_INVALID_INPUT, error_UNKNOWN],
  reads: [table_smart_accounts],
  writes: [],
  ...none,
});

export const procedure_accounts_read_account_safe_address_in_tx = defineProcedure({
  id: "accounts.read-account-safe-address-in-tx",
  title: "Read an Account's Safe, or null",
  about:
    "The lowercase Safe of the Account with this id (`by_account_id`, first); absence is null, not a refusal (actor " +
    "inventory may have no current Account). Access's session reads call it.",
  was: [`${A}/reads/identity.ts:125`, `${DOOR}:13`, `${B}/access/sessions/reads.ts:80`],
  concept: concept_accounts,
  input: Schema.Struct({ accountId: S }),
  output: NullOr(S),
  errors: [],
  reads: [table_accounts],
  writes: [],
  ...none,
});

export const procedure_accounts_account_id_for_auth_user_or_null = defineProcedure({
  id: "accounts.account-id-for-auth-user-or-null",
  title: "Read the caller's Account id, or null",
  about:
    "The `accountId` of the person's Base Sepolia Account (`by_auth_user_chain`, first), or null when none exists. " +
    "Payments' read guards, Payroll's payee agreements, the operator fixtures, and accounts' own agent owner read and " +
    "home needs-you read call it.",
  was: [
    `${A}/reads/identity.ts:136`,
    `${DOOR}:11`,
    `${B}/payments/records/guards.ts:21`,
    `${B}/payroll/agreements/writes/payees.ts:106`,
    `${B}/operator/fixtures/writes.ts:76`,
  ],
  concept: concept_accounts,
  input: Schema.Struct({ authUserId: S }),
  output: NullOr(S),
  errors: [],
  reads: [table_accounts],
  writes: [],
  ...none,
});

export const procedure_accounts_read_owned_safe_addresses_in_tx = defineProcedure({
  id: "accounts.read-owned-safe-addresses-in-tx",
  title: "Read every Safe a person holds on a chain",
  about:
    "Every Safe address of the person's Safe rows on this chain (`by_auth_user_chain`, collect), as stored. Access's " +
    "session reads and Banking's payout notices call it.",
  was: [`${A}/reads/identity.ts:149`, `${DOOR}:16`, `${B}/access/sessions/reads.ts:68`, `${B}/banking/payouts/reads/notices.ts:24`],
  concept: concept_accounts,
  input: Schema.Struct({ authUserId: S, chainId: N }),
  output: Schema.Array(S),
  errors: [],
  reads: [table_smart_accounts],
  writes: [],
  ...none,
});

export const procedure_accounts_read_native_ready_account_in_tx = defineProcedure({
  id: "accounts.read-native-ready-account-in-tx",
  title: "Read the person's Account once its Safe is deployed and claimed",
  about:
    "The person's Safe row on this chain (`by_auth_user` filtered by chain, `.unique()`); null unless it is deployed and " +
    "claimed. Then the Account (`by_auth_user_chain`, `.unique()`), null unless it names the same Safe. Access's client " +
    "store reads call it.",
  was: [`${A}/reads/identity.ts:162`, `${DOOR}:15`, `${B}/access/clients/reads/store.ts:138`],
  concept: concept_accounts,
  input: Schema.Struct({ authUserId: S, chainId: N }),
  output: NullOr(Schema.Struct({ accountId: S })),
  errors: [error_UNKNOWN],
  reads: [table_smart_accounts, table_accounts],
  writes: [],
  ...none,
});

// ── signup (reads/signup.ts) ────────────────────────────────────────────────────────────────

export const procedure_accounts_read_signup_safe_address_in_tx = defineProcedure({
  id: "accounts.read-signup-safe-address-in-tx",
  title: "Read the Safe address a person signs up with",
  about:
    "The first Safe row's address on any chain (`by_auth_user`), else the Safe the email derives " +
    "(`personalSafeAddress`, the Companies House derivation), not lowercased. Profiles' onboarding calls it.",
  was: [`${A}/reads/signup.ts:10`, `${DOOR}:23`, `${B}/profiles/onboardings/writes.ts:96`],
  concept: concept_accounts,
  input: Schema.Struct({ authUserId: S, email: S }),
  output: S,
  errors: [],
  reads: [table_smart_accounts],
  writes: [],
  ...none,
});

// ── targets (reads/targets.ts) ──────────────────────────────────────────────────────────────

export const procedure_accounts_read_exact_target_account_in_tx = defineProcedure({
  id: "accounts.read-exact-target-account-in-tx",
  title: "Read a Permission's exact target Account",
  about:
    "The Account with this id must be the only one and on Base Sepolia, else `INVALID_INPUT` (`accountId`: exact Base " +
    "Sepolia Account not found); its person must have exactly one Base Sepolia Safe row at the same address, else " +
    "`INVALID_INPUT` (Account and smart account identity do not match). Permissions' plans, holders and policies call it.",
  was: [`${A}/reads/targets.ts:17`, `${A}/errors.ts:78`, `${DOOR}:27`, `${B}/permissions/writes/plans.ts:73`, `${B}/permissions/reads/policies.ts:43`],
  concept: concept_accounts,
  input: Schema.Struct({ accountId: S }),
  output: AccountIdentity,
  errors: [error_INVALID_INPUT],
  reads: [table_accounts, table_smart_accounts],
  writes: [],
  ...none,
});

export const procedure_accounts_read_invitation_account_for_safe_in_tx = defineProcedure({
  id: "accounts.read-invitation-account-for-safe-in-tx",
  title: "Read an invitation grantee's Account at a Safe",
  about:
    "The one Base Sepolia Account at this Safe, else null; then its person's Safe row on that chain (first). A row at a " +
    "different address is null; `ready` is null with no Safe row, else whether it is claimed. Organizations' invitation " +
    "grantee reads call it.",
  was: [`${A}/reads/targets.ts:46`, `${DOOR}:29`, `${B}/organizations/invitations/reads/grantees.ts:85`],
  concept: concept_accounts,
  input: Schema.Struct({ safeAddress: S }),
  output: NullOr(Schema.Struct({ accountId: S, ready: NullOr(B_) })),
  errors: [],
  reads: [table_accounts, table_smart_accounts],
  writes: [],
  ...none,
});

export const procedure_accounts_read_founder_account_state_in_tx = defineProcedure({
  id: "accounts.read-founder-account-state-in-tx",
  title: "Read a workspace founder's Safe state",
  about:
    "With a chain: the founder's Safe row on it (`.unique()`). Without: every Safe row of the person; more than one is " +
    "`INVALID_INPUT` (`chainId` is required when the founder has multiple Accounts). Returns the Safe, chain, signer, " +
    "deployment and claim stamps, or null. Organizations' setup writes and guards call it.",
  was: [`${A}/reads/targets.ts:75`, `${A}/errors.ts:84`, `${DOOR}:28`, `${B}/organizations/setups/guards.ts:74`],
  concept: concept_accounts,
  input: Schema.Struct({ authUserId: S, chainId: opt(N) }),
  output: NullOr(
    Schema.Struct({
      smartAccountAddress: S,
      chainId: N,
      signerAddress: opt(S),
      deployedAt: NullOr(N),
      claimedAt: opt(N),
    }),
  ),
  errors: [error_INVALID_INPUT, error_UNKNOWN],
  reads: [table_smart_accounts],
  writes: [],
  ...none,
});

export const procedure_accounts_read_party_account_binding_in_tx = defineProcedure({
  id: "accounts.read-party-account-binding-in-tx",
  title: "Read the Account a Party receives at",
  about:
    "The one Account at the Party's Safe on this chain; its person's Profile binding (Profiles' " +
    "`readProfileAccountBindingInTx`) must exist, carry the Party's email (normalized) and, when it names a Party, this " +
    "one. Then the Safe row (`.unique()`) must not name another address. Returns the Account and whether it is claimed; " +
    "any mismatch answers nulls without creating or repairing anything. Organizations' invitation views call it.",
  was: [`${A}/reads/targets.ts:106`, `${DOOR}:30`, `${B}/organizations/invitations/views.ts:160`],
  concept: concept_accounts,
  input: Schema.Struct({
    party: Schema.Struct({ partyId: S, safeAddress: S, email: opt(NullOr(S)) }),
    chainId: N,
  }),
  output: Schema.Struct({ accountId: NullOr(S), accountReady: NullOr(B_) }),
  errors: [error_UNKNOWN],
  reads: [table_accounts, table_smart_accounts],
  writes: [],
  drives: [],
  invokes: [procedure_profiles_read_profile_account_binding_in_tx],
  emits: [],
});

// ── workspaces (reads/workspaces.ts) ────────────────────────────────────────────────────────

export const procedure_accounts_read_workspace_viewer_safe_in_tx = defineProcedure({
  id: "accounts.read-workspace-viewer-safe-in-tx",
  title: "Read a workspace viewer's first Safe",
  about:
    "The person's first Safe row's address on any chain (`by_auth_user`), as stored, or null. Exported on the door, but no " +
    "other concept calls it today.",
  was: [`${A}/reads/workspaces.ts:12`, `${DOOR}:42`],
  concept: concept_accounts,
  input: Schema.Struct({ authUserId: S }),
  output: NullOr(S),
  errors: [],
  reads: [table_smart_accounts],
  writes: [],
  ...none,
});

export const procedure_accounts_read_workspace_account_safe_in_tx = defineProcedure({
  id: "accounts.read-workspace-account-safe-in-tx",
  title: "Read a person's first Safe on a workspace's chain",
  about:
    "The person's first Safe row on this chain (`by_auth_user_chain`), as stored, or null. Organizations' setup installs, " +
    "resumes and bootstraps call it.",
  was: [`${A}/reads/workspaces.ts:24`, `${DOOR}:35`, `${B}/organizations/setups/writes/installs.ts:59`, `${B}/organizations/setups/writes/bootstraps.ts:54`],
  concept: concept_accounts,
  input: Schema.Struct({ authUserId: S, chainId: N }),
  output: NullOr(S),
  errors: [],
  reads: [table_smart_accounts],
  writes: [],
  ...none,
});

export const procedure_accounts_read_workspace_member_account_in_tx = defineProcedure({
  id: "accounts.read-workspace-member-account-in-tx",
  title: "Read a member's Account bound to their admitted Safe",
  about:
    "The first Account and first Safe row of the person on this chain. The Account answers only when it names the admitted " +
    "Safe (compared lowercased against the caller's value, which is not lowercased here); `accountReady` is null unless " +
    "both name it, else whether the Safe is claimed. Organizations' workspace views call it.",
  was: [`${A}/reads/workspaces.ts:38`, `${DOOR}:40`, `${B}/organizations/workspaces/views.ts:80`],
  concept: concept_accounts,
  input: Schema.Struct({ authUserId: S, chainId: N, safeAddress: S }),
  output: Schema.Struct({ account: NullOr(AccountIdentity), accountReady: NullOr(B_) }),
  errors: [],
  reads: [table_accounts, table_smart_accounts],
  writes: [],
  ...none,
});

export const procedure_accounts_read_workspace_setup_signer_in_tx = defineProcedure({
  id: "accounts.read-workspace-setup-signer-in-tx",
  title: "Read the claimed Safe and signer that may set up a workspace",
  about:
    "The person's first Safe row on this chain, null unless it has a signer and a claim. It checks `deployedAt !== " +
    "undefined`, which a counterfactual row (deployedAt null) passes: deployment is not really required. Organizations' " +
    "setup contexts, Payroll's agreement contexts and accounts' own agent owner read call it.",
  was: [`${A}/reads/workspaces.ts:76`, `${A}/reads/workspaces.ts:89`, `${DOOR}:41`, `${B}/organizations/setups/reads/contexts.ts:107`, `${B}/payroll/agreements/reads/context.ts:117`],
  concept: concept_accounts,
  input: Schema.Struct({ authUserId: S, chainId: N }),
  output: NullOr(Schema.Struct({ smartAccountAddress: S, signerAddress: S })),
  errors: [],
  reads: [table_smart_accounts],
  writes: [],
  ...none,
});

export const procedure_accounts_read_workspace_founder_safe_in_tx = defineProcedure({
  id: "accounts.read-workspace-founder-safe-in-tx",
  title: "Read a founder's one claimed, deployed Safe at an address",
  about:
    "The person's Safe rows on this chain filtered to deployed, claimed rows at the given address; exactly one answers " +
    "its lowercase address, else null. Organizations' workspace reads call it.",
  was: [`${A}/reads/workspaces.ts:100`, `${DOOR}:38`, `${B}/organizations/workspaces/reads/workspaces.ts:118`],
  concept: concept_accounts,
  input: Schema.Struct({ authUserId: S, chainId: N, safeAddress: S }),
  output: NullOr(S),
  errors: [],
  reads: [table_smart_accounts],
  writes: [],
  ...none,
});

export const procedure_accounts_read_workspace_proof_account_in_tx = defineProcedure({
  id: "accounts.read-workspace-proof-account-in-tx",
  title: "Read the one Safe and signer a setup proof uses",
  about:
    "The person's Safe rows on this chain; exactly one, with a signer, and both addresses 0x+40 hex in any case, answers " +
    "the pair as stored, else null. Organizations' setup proofs call it.",
  was: [`${A}/reads/workspaces.ts:125`, `${DOOR}:41`, `${B}/organizations/setups/reads/proofs.ts:56`],
  concept: concept_accounts,
  input: Schema.Struct({ authUserId: S, chainId: N }),
  output: NullOr(Schema.Struct({ smartAccountAddress: S, signerAddress: S })),
  errors: [],
  reads: [table_smart_accounts],
  writes: [],
  ...none,
});

export const procedure_accounts_read_workspace_authority_account_in_tx = defineProcedure({
  id: "accounts.read-workspace-authority-account-in-tx",
  title: "Read a founder's one logical Account",
  about:
    "The person's Accounts on this chain; exactly one answers its id and Safe as stored, else null. No Safe readiness gate. " +
    "Organizations' setup proofs and contexts call it.",
  was: [`${A}/reads/workspaces.ts:150`, `${DOOR}:37`, `${B}/organizations/setups/writes/proofs.ts:95`],
  concept: concept_accounts,
  input: Schema.Struct({ authUserId: S, chainId: N }),
  output: NullOr(Schema.Struct({ accountId: S, smartAccountAddress: S })),
  errors: [],
  reads: [table_accounts],
  writes: [],
  ...none,
});

export const procedure_accounts_read_workspace_attached_account_id_in_tx = defineProcedure({
  id: "accounts.read-workspace-attached-account-id-in-tx",
  title: "Read a member's Account id when it names their Safe",
  about:
    "The person's first Account on this chain, answered only when it names the given Safe (case-insensitively), else null. " +
    "Organizations' member views call it.",
  was: [`${A}/reads/workspaces.ts:170`, `${DOOR}:36`, `${B}/organizations/members/views.ts:30`],
  concept: concept_accounts,
  input: Schema.Struct({ authUserId: S, chainId: N, safeAddress: S }),
  output: NullOr(S),
  errors: [],
  reads: [table_accounts],
  writes: [],
  ...none,
});

// ── ledger (reads/ledger.ts) ────────────────────────────────────────────────────────────────

export const procedure_accounts_read_reconciliation_account_page_in_tx = defineProcedure({
  id: "accounts.read-reconciliation-account-page-in-tx",
  title: "Page the Base Sepolia Accounts for reconciliation",
  about:
    "One page of 100 Accounts filtered to Base Sepolia, in native cursor order: a table scan with a filter, no index. " +
    "Indexing's drift sweep calls it.",
  was: [`${A}/reads/ledger.ts:13`, `${DOOR}:50`, `${B}/indexing/drifts/reads.ts:127`],
  concept: concept_accounts,
  input: Schema.Struct({ cursor: opt(S) }),
  output: Schema.Struct({ accountIds: Schema.Array(S), continueCursor: S, isDone: B_ }),
  errors: [],
  reads: [table_accounts],
  writes: [],
  ...none,
});

export const procedure_accounts_read_reconciliation_account_in_tx = defineProcedure({
  id: "accounts.read-reconciliation-account-in-tx",
  title: "Read one reconciliation target",
  about:
    "The Account with this id (`.unique()`) and its lowercase Safe, or null when there is none or it is not on Base " +
    "Sepolia. Indexing's drift sweep calls it.",
  was: [`${A}/reads/ledger.ts:26`, `${DOOR}:49`, `${B}/indexing/drifts/reads.ts:87`],
  concept: concept_accounts,
  input: Schema.Struct({ accountId: S }),
  output: NullOr(Schema.Struct({ accountId: S, safeAddress: S })),
  errors: [error_UNKNOWN],
  reads: [table_accounts],
  writes: [],
  ...none,
});

export const procedure_accounts_read_accounts_at_safe_in_tx = defineProcedure({
  id: "accounts.read-accounts-at-safe-in-tx",
  title: "Read the Accounts at one Safe",
  about:
    "The Base Sepolia Accounts whose Safe is this address (lowercased), oldest first (`by_smart_account_address`, " +
    "filtered by chain). Recipient resolution takes the first; Payments' Movement attribution refuses more than one.",
  was: [`${A}/reads/ledger.ts:42`, `${DOOR}:48`, `${B}/payments/movements/reads/identities.ts:97`],
  concept: concept_accounts,
  input: Schema.Struct({ safeAddress: S }),
  output: Schema.Array(Schema.Struct({ accountId: S, smartAccountAddress: S })),
  errors: [],
  reads: [table_accounts],
  writes: [],
  ...none,
});

export const procedure_accounts_find_account_recipient_in_tx = defineProcedure({
  id: "accounts.find-account-recipient-in-tx",
  title: "Find the Account recipient at one Safe",
  about: "The first Account at this Safe as an `account` recipient, or null. Payments' recipient resolution calls it.",
  was: [`${A}/reads/ledger.ts:60`, `${DOOR}:47`, `${B}/payments/commands/reads/recipients.ts:50`],
  concept: concept_accounts,
  input: Schema.Struct({ safeAddress: S }),
  output: NullOr(Schema.Struct({ kind: Schema.Literals(["account"]), accountId: S })),
  errors: [],
  reads: [table_accounts],
  writes: [],
  drives: [],
  invokes: [procedure_accounts_read_accounts_at_safe_in_tx],
  emits: [],
});

export const procedure_accounts_resolve_account_recipient_safe_in_tx = defineProcedure({
  id: "accounts.resolve-account-recipient-safe-in-tx",
  title: "Resolve an Account recipient's Safe",
  about:
    "The lowercased Safe of the Account a payment pays (`by_account_id`, first), on any chain; none is `INVALID_INPUT` " +
    "(`recipient`: Account recipient not found). Payments' recipient resolution calls it.",
  was: [`${A}/reads/ledger.ts:68`, `${A}/errors.ts:87`, `${DOOR}:52`, `${B}/payments/commands/reads/recipients.ts:21`],
  concept: concept_accounts,
  input: Schema.Struct({ accountId: S }),
  output: S,
  errors: [error_INVALID_INPUT],
  reads: [table_accounts],
  writes: [],
  ...none,
});

export const procedure_accounts_require_movement_account_in_tx = defineProcedure({
  id: "accounts.require-movement-account-in-tx",
  title: "Require the one Base Sepolia Account for Movement attribution",
  about:
    "The person's Base Sepolia Account (`by_auth_user_chain`, `.unique()`); none is `INVALID_INPUT` (`actor`: actor not " +
    "found). Documents' memo guards call it.",
  was: [`${A}/reads/ledger.ts:81`, `${A}/errors.ts:90`, `${DOOR}:51`, `${B}/documents/memos/guards.ts:47`],
  concept: concept_accounts,
  input: Schema.Struct({ authUserId: S }),
  output: Schema.Struct({ accountId: S, smartAccountAddress: S }),
  errors: [error_INVALID_INPUT, error_UNKNOWN],
  reads: [table_accounts],
  writes: [],
  ...none,
});

// ── proofs (reads/proofs.ts) ────────────────────────────────────────────────────────────────

export const procedure_accounts_read_proof_smart_accounts_in_tx = defineProcedure({
  id: "accounts.read-proof-smart-accounts-in-tx",
  title: "Read a person's Safe rows for operator diagnostics",
  about: "Every Safe row of the person (`by_auth_user`), with deployment and claim stamps. The operator identity reads call it.",
  was: [`${A}/reads/proofs.ts:6`, `${DOOR}:60`, `${B}/operator/identities/reads.ts:69`],
  concept: concept_accounts,
  input: Schema.Struct({ authUserId: S }),
  output: Schema.Array(
    Schema.Struct({
      authUserId: S,
      signerAddress: NullOr(S),
      smartAccountAddress: S,
      chainId: N,
      deployedAt: NullOr(N),
      deployTxHash: NullOr(S),
      claimedAt: NullOr(N),
      claimTxHash: NullOr(S),
      createdAt: N,
    }),
  ),
  errors: [],
  reads: [table_smart_accounts],
  writes: [],
  ...none,
});

export const procedure_accounts_read_first_proof_account_chain_in_tx = defineProcedure({
  id: "accounts.read-first-proof-account-chain-in-tx",
  title: "Read the chain of a person's first Safe row",
  about: "The chain of the person's first Safe row (`by_auth_user`), or null. Organizations' setup writes call it.",
  was: [`${A}/reads/proofs.ts:24`, `${DOOR}:59`, `${B}/organizations/setups/writes/organizations.ts:145`],
  concept: concept_accounts,
  input: Schema.Struct({ authUserId: S }),
  output: NullOr(N),
  errors: [],
  reads: [table_smart_accounts],
  writes: [],
  ...none,
});

export const procedure_accounts_read_account_purge_target_in_tx = defineProcedure({
  id: "accounts.read-account-purge-target-in-tx",
  title: "Read everything an operator purge of an Account removes",
  about:
    "Every Account row with this id, then every Account and Safe row of the auth users behind them, as Account ids, auth " +
    "user ids and (chain, lowercase Safe) pairs; null when no row has the id. The operator identity reads call it before " +
    "anything is removed.",
  was: [`${A}/reads/proofs.ts:49`, `${DOOR}:58`, `${B}/operator/identities/reads.ts:33`],
  concept: concept_accounts,
  input: Schema.Struct({ accountId: S }),
  output: NullOr(
    Schema.Struct({
      accountIds: Schema.Array(S),
      authUserIds: Schema.Array(S),
      safes: Schema.Array(Schema.Struct({ chainId: N, address: S })),
    }),
  ),
  errors: [],
  reads: [table_accounts, table_smart_accounts],
  writes: [],
  ...none,
});

// ── writes (writes.ts) ──────────────────────────────────────────────────────────────────────

export const procedure_accounts_ensure_account_in_tx = defineProcedure({
  id: "accounts.ensure-account-in-tx",
  title: "Bind the logical Account on a chain to exactly one Safe",
  about:
    "The Safe must be 0x+40 hex once lowercased (`INVALID_INPUT` smartAccountAddress). The person's Account on the chain " +
    "(first) answers its id when it names the same Safe, else `WRONG_STATE` (chainOwnedByDifferentSafe). With none, an " +
    "Account of anyone else at that Safe on that chain is `WRONG_STATE` (addressOwnedByDifferentUserOnChain); otherwise " +
    "it inserts `account_` + ULID at `now`. accounts.safes.provision and Organizations' setup installs and bootstraps " +
    "call it (an Organization's Safe gets an Account row bound to the founder's auth user).",
  was: [`${A}/writes.ts:24`, `${A}/errors.ts:56`, `${A}/errors.ts:63`, `${DOOR}:69`, `${B}/organizations/setups/writes/installs.ts:74`],
  concept: concept_accounts,
  input: Schema.Struct({ authUserId: S, chainId: N, smartAccountAddress: S, now: N }),
  output: Schema.Struct({ accountId: S }),
  errors: [error_INVALID_INPUT, error_WRONG_STATE],
  reads: [table_accounts],
  writes: [table_accounts],
  ...none,
});

export const procedure_accounts_schedule_welcome_funding = defineProcedure({
  id: "accounts.schedule-welcome-funding",
  title: "Schedule a new Safe's welcome grants (staging only)",
  about:
    "Only when SITE_URL is https://api.staging.capxul.com, CAPXUL_STAGING_WELCOME_FUNDING_ENABLED is `true` and the chain " +
    "is 84532: for each synthetic fixture (USDC 1000, USDT 1000, WETH 1) whose grant key is missing, inserts a `scheduled` " +
    "grant, then schedules `accounts.grants.mintWelcomeGrants` at once with the new grant ids. Best-effort: any failure " +
    "deletes the grants it inserted and writes a `[CAPXUL_WELCOME_FUNDING_FAILED]` line; it never fails the provisioning " +
    "that asked. accounts.safes.provision (personal) and Organizations' setup installs and bootstraps (organization) call it.",
  was: [`${A}/writes.ts:87`, `${A}/writes.ts:69`, `${A}/writes.ts:130`, `${A}/rules.ts:57`, `${A}/events.ts:63`, `${DOOR}:69`, `${B}/organizations/setups/writes/bootstraps.ts:188`],
  concept: concept_accounts,
  input: Schema.Struct({ kind: Schema.Literals(["personal", "organization"]), accountAddress: S, chainId: N, now: N }),
  output: Schema.Void,
  errors: [],
  reads: [table_welcome_funding_grants],
  writes: [table_welcome_funding_grants],
  ...none,
});

export const procedure_accounts_ensure_proof_personal_account_in_tx = defineProcedure({
  id: "accounts.ensure-proof-personal-account-in-tx",
  title: "Write a synthetic personal Account for operator proof work",
  about:
    "The operator fixture's readiness shortcut, separate from receipt-verified claim policy: inserts the person's Base " +
    "Sepolia Safe row at the given address when missing (deployed and claimed at `at` when `nativeReady`), or stamps " +
    "deployedAt and claimedAt on an existing one that lacks them; then binds the Account (`ensureAccountInTx`). No chain " +
    "is read. The operator fixtures call it.",
  was: [`${A}/writes.ts:149`, `${DOOR}:63`, `${B}/operator/fixtures/writes.ts:62`],
  concept: concept_accounts,
  input: Schema.Struct({ authUserId: S, safeAddress: S, at: N, nativeReady: B_ }),
  output: Schema.Void,
  errors: [error_INVALID_INPUT, error_WRONG_STATE, error_UNKNOWN],
  reads: [table_smart_accounts, table_accounts],
  writes: [table_smart_accounts, table_accounts],
  drives: [],
  invokes: [procedure_accounts_ensure_account_in_tx],
  emits: [],
});

export const procedure_accounts_purge_account_rows_in_tx = defineProcedure({
  id: "accounts.purge-account-rows-in-tx",
  title: "Delete a purged person's Account, Safe and grant rows",
  about:
    "The operator purge: deletes every Account row of the target's ids, every Safe row of its auth users, and every welcome " +
    "grant whose key has a target Safe's `chainId:address:` prefix. Returns how many rows each table lost. Approvals and " +
    "agents are not touched (the purge refuses a person with a prepared Payment before it gets here). The operator " +
    "identity writes call it.",
  was: [`${A}/writes.ts:193`, `${DOOR}:64`, `${B}/operator/identities/writes.ts:65`],
  concept: concept_accounts,
  input: Schema.Struct({
    target: Schema.Struct({
      accountIds: Schema.Array(S),
      authUserIds: Schema.Array(S),
      safes: Schema.Array(Schema.Struct({ chainId: N, address: S })),
    }),
  }),
  output: Schema.Struct({ accounts: N, smartAccounts: N, welcomeFundingGrants: N }),
  errors: [],
  reads: [table_accounts, table_smart_accounts, table_welcome_funding_grants],
  writes: [table_accounts, table_smart_accounts, table_welcome_funding_grants],
  ...none,
});

export const procedure_accounts_remove_first_proof_safe_in_tx = defineProcedure({
  id: "accounts.remove-first-proof-safe-in-tx",
  title: "Delete a person's first Safe row",
  about:
    "The narrow legacy cleanup: deletes the person's first Safe row (`by_auth_user`) and answers whether one existed; the " +
    "Account and history stay. The operator identity writes call it.",
  was: [`${A}/writes.ts:236`, `${DOOR}:65`, `${B}/operator/identities/writes.ts:89`],
  concept: concept_accounts,
  input: Schema.Struct({ authUserId: S }),
  output: B_,
  errors: [],
  reads: [table_smart_accounts],
  writes: [table_smart_accounts],
  ...none,
});

// ── approvals (approvals/reads.ts) ──────────────────────────────────────────────────────────

export const procedure_accounts_read_execution_approval_in_tx = defineProcedure({
  id: "accounts.read-execution-approval-in-tx",
  title: "Read the approval of one execution",
  about:
    "The approval row of one money execution (`by_execution_id`, `.unique()`), as its id, its page URL (null when the " +
    "paired frontend origin is not configured: the ENV_MISSING is swallowed) and its state judged against the backend " +
    "clock shim; null when none was opened. Payments' execution context and reservation, and Permissions' occupancy " +
    "read, call it to name the approval a refused operation waits on.",
  was: [
    `${A}/approvals/reads.ts:105`,
    `${DOOR}:72`,
    `${B}/payments/executions/writes/reservations.ts:100`,
    `${B}/payments/commands/reads/contexts.ts:5`,
    `${B}/permissions/reads/occupancy.ts:248`,
  ],
  concept: concept_accounts,
  input: Schema.Struct({ executionId: S }),
  output: NullOr(
    Schema.Struct({
      approvalId: S,
      url: NullOr(S),
      state: Schema.Literals(["pending", "approved", "rejected", "consumed", "expired"]),
    }),
  ),
  errors: [error_UNKNOWN],
  reads: [table_approvals],
  writes: [],
  ...none,
});

// ── action-side door exports ────────────────────────────────────────────────────────────────

export const procedure_accounts_with_service_lane = defineProcedure({
  id: "accounts.with-service-lane",
  title: "Hold the Companies House key's sender lane for one send",
  about:
    "Action-side door export (lanes/external.ts), run in the caller's action. Takes a fresh ULID as holder and runs " +
    "`accounts.lanes.reserve` up to 30 times, two seconds apart; still busy after a minute is `WRONG_STATE` " +
    "(serviceSenderBusy, under the caller's operation name). Then runs the caller's send and always runs " +
    "`accounts.lanes.release`, ignoring its failure. A missing or malformed CAPXUL_COMPANIES_HOUSE_SERVICE_KEY fails " +
    "reading the sender. Each reserve and release is its own transaction. The claim and Organizations' setup deploys and " +
    "equity sends call it.",
  was: [`${A}/lanes/external.ts:21`, `${A}/lanes/external.ts:13`, `${A}/lanes/errors.ts:6`, `${DOOR}:89`, `${B}/organizations/setups/external/deploys.ts:58`, `${B}/organizations/equity/external.ts:141`],
  concept: concept_accounts,
  input: Schema.Struct({ chainId: N, operation: S, send: Schema.Unknown }),
  output: Schema.Unknown,
  errors: [error_WRONG_STATE, error_INVALID_INPUT, error_ENV_MISSING],
  reads: [table_service_lanes],
  writes: [table_service_lanes],
  ...none,
});

export const procedure_accounts_mint_test_tokens = defineProcedure({
  id: "accounts.mint-test-tokens",
  title: "Mint a test token from the faucet Safe (at most 10,000 tokens)",
  about:
    ACTION_SIDE +
    " Base Sepolia only (INVALID_INPUT chainId); holder and token must be addresses and the raw amount a positive integer " +
    "within 10,000 whole tokens (INVALID_INPUT). Signs with DEPLOYER_PRIVATE_KEY (missing or malformed: ENV_MISSING), " +
    "deploys the faucet Safe on first use, and sends `TestMoneyToken.mint(holder, amount)` as a sponsored UserOperation " +
    "on a fresh random 192-bit nonce lane (a bundler refusal is rebuilt once on a new lane), then waits for its receipt " +
    "(eth_sendUserOperation, eth_getUserOperationReceipt; a refused send or a revert is TRANSACTION_FAILED). The operator " +
    "faucet and accounts.grants.faucetMint call it.",
  was: [`${A}/grants/external/mints.ts:76`, `${A}/grants/external/faucet.ts:150`, `${A}/grants/external/faucet.ts:36`, `${A}/grants/rules.ts:53`, `${DOOR}:75`, `${B}/operator/faucets/external.ts:23`],
  concept: concept_accounts,
  input: Schema.Struct(MintArgs),
  output: Schema.Struct({ txHash: S }),
  errors: MINT_ERRORS,
  reads: [],
  writes: [],
  ...none,
});

export const procedure_accounts_mint_test_tokens_once = defineProcedure({
  id: "accounts.mint-test-tokens-once",
  title: "Mint a test token at most once for a mint key",
  about:
    ACTION_SIDE +
    " As mint-test-tokens, but on the faucet nonce lane keccak256(`faucet:<mintKey>`) cut to 192 bits, so a second ask " +
    "with the same key builds the same first nonce: a lane that already landed answers with what landed (its " +
    "UserOperationEvent within the last 9,999 blocks), and a send the bundler refuses while the first holds the nonce " +
    "polls the lane each second for up to 60 s (CAP-1288). The operator faucet calls it for devnet worlds.",
  was: [`${A}/grants/external/mints.ts:62`, `${A}/grants/external/keyed-sends.ts:57`, `${A}/grants/external/keyed-sends.ts:47`, `${DOOR}:75`, `${B}/operator/faucets/external.ts:23`],
  concept: concept_accounts,
  input: Schema.Struct({ ...MintArgs, mintKey: S }),
  output: Schema.Struct({ txHash: S }),
  errors: MINT_ERRORS,
  reads: [],
  writes: [],
  ...none,
});

export const procedure_accounts_mint_bank_deposit_tokens = defineProcedure({
  id: "accounts.mint-bank-deposit-tokens",
  title: "Mint a completed bank deposit's exact amount from the faucet Safe",
  about:
    ACTION_SIDE +
    " The faucet mint path with no whole-token cap (any uint256); the deposit owns idempotency. Banking's deposit credit " +
    "calls it.",
  was: [`${A}/grants/external/mints.ts:84`, `${DOOR}:76`, `${B}/banking/deposits/operations/credit.ts:59`],
  concept: concept_accounts,
  input: Schema.Struct(MintArgs),
  output: Schema.Struct({ txHash: S }),
  errors: MINT_ERRORS,
  reads: [],
  writes: [],
  ...none,
});

export const procedure_accounts_relay_open_calls = defineProcedure({
  id: "accounts.relay-open-calls",
  title: "Relay open calls for another concept from the faucet Safe",
  about:
    ACTION_SIDE +
    " Sends the given calls, in order, as one sponsored operation from the faucet Safe on its own lane (one call through " +
    "the Safe 4337 module, several through MultiSendCallOnly) and waits for inclusion. Base Sepolia only. The faucet Safe " +
    "gains no authority: each call is open to any sender. Requests' Invoice escrow deploys and payouts call it (ADR-0035).",
  was: [`${A}/grants/external/relays.ts:18`, `${DOOR}:79`, `${B}/requests/checkouts/external/escrows.ts:139`],
  concept: concept_accounts,
  input: Schema.Struct({ chainId: N, calls: Schema.Array(Schema.Unknown), operation: S }),
  output: Schema.Struct({ txHash: S }),
  errors: MINT_ERRORS,
  reads: [],
  writes: [],
  ...none,
});

export const procedure_accounts_read_positions = defineProcedure({
  id: "accounts.read-positions",
  title: "Read a Safe's position in each settlement asset",
  about:
    ACTION_SIDE +
    " One ERC-20 `balanceOf` per configured settlement asset of the chain (`fetchErc20Balance`, eth_call, a 10 s total " +
    "chain budget each), read together, in registry order; no token is labelled USD, and available equals balance. An " +
    "optional callback runs after each asset (the balance read posts account_balance_read there). Organizations' treasury " +
    "read, the home, the balance read and the agent reads call it.",
  was: [`${A}/external.ts:64`, `${A}/external.ts:43`, `${DOOR}:86`, `${B}/organizations/treasuries/operations/read.ts:19`],
  concept: concept_accounts,
  input: Schema.Struct({ chainId: N, holderAddress: S, reported: opt(Schema.Unknown) }),
  output: Schema.Array(Position),
  errors: [error_PROVIDER_ERROR, error_ENV_MISSING],
  reads: [],
  writes: [],
  ...none,
});

export const procedure_accounts_read_token_balances = defineProcedure({
  id: "accounts.read-token-balances",
  title: "Read a holder's raw balance of named tokens",
  about:
    ACTION_SIDE +
    " One `balanceOf` per token the caller names, read together, in the order given, as bigints, within the same 10 s " +
    "chain budget. Books' balance reports call it.",
  was: [`${A}/external.ts:90`, `${DOOR}:86`, `${B}/books/reports/operations/balances.ts:61`],
  concept: concept_accounts,
  input: Schema.Struct({ chainId: N, holderAddress: S, tokens: Schema.Array(Schema.Struct({ tokenAddress: S })) }),
  output: Schema.Array(Schema.Struct({ token: Schema.Unknown, rawBalance: Schema.BigInt })),
  errors: [error_PROVIDER_ERROR, error_ENV_MISSING],
  reads: [],
  writes: [],
  ...none,
});
