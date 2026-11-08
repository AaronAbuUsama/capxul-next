// The as-is book of the old accounts concept: the grants area (test-network funding: the public
// faucet and staging welcome grants).
//
// Every operation registered at `accounts/grants:*` (packages/backend/convex/accounts/grants.ts).
// One public row, `grants.faucetMint` (packages/protocol/src/accounts/operations.ts:131); four
// internal grant transitions the minting action runs through ctx.runMutation; the one-grant
// minting action the batch runs through ctx.runAction (an rpc); and the batch itself, which a
// provisioning transaction schedules (`scheduleWelcomeFunding`), so a workflow.
//
// Every mint is sent from the backend-owned faucet Safe (owner key DEPLOYER_PRIVATE_KEY, salt
// email faucet@capxul.internal, Safe 1.4.1, v1 namespace) as a sponsored UserOperation calling
// TestMoneyToken.mint on its own random 192-bit EntryPoint nonce lane; the faucet Safe deploys
// itself on first use. Paths in `was` are relative to the old repository root.

import { Schema } from "effect";
import { defineRpc, defineWorkflow, type CallRef, type FunctionRef } from "../../../packages/book/src/index.ts";

import { concept_accounts } from "../shared/foundation.ts";
import {
  contract_entry_point,
  contract_safe_4337_module,
  contract_test_money_token,
  integration_chain_rpc,
} from "../shared/external.ts";
import {
  error_ENV_MISSING,
  error_FEATURE_NOT_AVAILABLE,
  error_INSUFFICIENT_BALANCE,
  error_INVALID_INPUT,
  error_NOT_AUTHENTICATED,
  error_NOT_IMPLEMENTED,
  error_PROVIDER_ERROR,
  error_PROVIDER_RESPONSE_INVALID,
  error_ROLE_PERMISSION_DENIED,
  error_TRANSACTION_FAILED,
  error_UNKNOWN,
  event_faucet_confirmed,
  event_faucet_failed,
} from "../shared/vocabulary.ts";
import {
  procedure_access_require_authenticated_user,
  procedure_access_require_beta_access_from_action,
} from "../access/procedures.ts";
import { BINDING_ERRORS } from "./balances.ts";
import { machine_welcome_funding_grant, table_accounts, table_smart_accounts, table_welcome_funding_grants } from "./data.ts";
import { procedure_accounts_mint_test_tokens } from "./procedures.ts";
import { rpc_accounts_safes_provision } from "./safes.ts";

const BACKEND = "packages/backend";
const CONVEX = `${BACKEND}/convex/accounts/grants.ts`;
const A = `${BACKEND}/src/accounts`;
const GRANTS = `${A}/grants`;
const OPS = `${GRANTS}/operations`;
const ROWS = "packages/protocol/src/accounts/operations.ts";

const rpcCall = (name: string): CallRef =>
  (integration_chain_rpc.c as Record<string, CallRef | undefined>)[name] ?? {
    _kind: "call",
    id: `chain-rpc.${name}`,
    integration: "chain-rpc",
    name,
  };

const fn = (contract: { readonly id: string; readonly f: object }, name: string): FunctionRef =>
  (contract.f as Record<string, FunctionRef | undefined>)[name] ?? {
    _kind: "function",
    id: `${contract.id}.${name}`,
    contract: contract.id,
    name,
  };

/**
 * One faucet send (`sendOnFaucetLane`, grants/external/faucet.ts:150): the faucet Safe's code
 * (deployed once with a sponsored deploy when missing), the sponsored build (`sponsoredUserOp`:
 * nonce, fees, paymaster), the send and the receipt wait.
 */
const FAUCET_SEND = {
  calls: [
    rpcCall("fetchAddressCode"),
    rpcCall("fetchEntryPointNonce"),
    rpcCall("fetchUserOperationFees"),
    rpcCall("sponsorUserOperation"),
    rpcCall("sendUserOperation"),
    rpcCall("waitForUserOperationReceipt"),
  ],
  chain: [
    fn(contract_test_money_token, "mint"),
    contract_safe_4337_module.f.executeUserOpWithErrorString,
    contract_entry_point.f.getNonce,
  ],
  spans: [
    "chain.read eth_getCode",
    "chain.read eth_call",
    "chain.read eth_maxPriorityFeePerGas",
    "chain.read pm_getPaymasterStubData",
    "chain.read eth_estimateUserOperationGas",
    "chain.read pm_getPaymasterData",
    "chain.read eth_sendUserOperation",
    "chain.read eth_getUserOperationReceipt",
  ],
};

const MINT_ERRORS = [error_INVALID_INPUT, error_ENV_MISSING, error_TRANSACTION_FAILED, error_PROVIDER_ERROR, error_INSUFFICIENT_BALANCE];

const RUN_BY_MINT = "internal: run through ctx.runMutation by accounts.grants.mintWelcomeGrant (grants/writes.ts:70).";
const GrantId = Schema.Struct({ grantId: Schema.String });
const noTouch = { drives: [], invokes: [], emits: [], calls: [], chain: [], spans: [] } as const;

// ── public ──────────────────────────────────────────────────────────────────────────────────

export const rpc_accounts_grants_faucet_mint = defineRpc({
  id: "accounts.grants.faucet-mint",
  title: "Mint a settlement asset into the caller's Safe (test networks only)",
  about:
    "Public action. Signed in; the faucet must be on for this deployment (CAPXUL_FAUCET_ENABLED `1` or `true`, else " +
    "NOT_IMPLEMENTED `account.faucet`: production leaves it unset); the beta waitlist must admit the person " +
    "(FEATURE_NOT_AVAILABLE); `assetId` must be a configured settlement asset of the chain (INVALID_INPUT); then the " +
    "binding (`accounts.balances.readBinding`). It mints the exact raw amount from the faucet Safe (`mintTestTokens`): Base " +
    "Sepolia only, at most 10,000 whole tokens, a positive integer (INVALID_INPUT); a missing or malformed deployer key is " +
    "ENV_MISSING; a refused send or reverted mint is TRANSACTION_FAILED; it waits for inclusion. Then it posts " +
    "faucet_confirmed (awaited) with the raw amount, hash, asset and duration. Nothing is stored. The faucet's nonce " +
    "lanes avoid collisions across workers; the README's one-worker sender lock is gone.",
  was: [
    `${CONVEX}:6`,
    `${OPS}/faucet-mint.ts:16`,
    `${GRANTS}/guards.ts:10`,
    `${GRANTS}/errors.ts:6`,
    `${GRANTS}/rules.ts:23`,
    `${GRANTS}/rules.ts:53`,
    `${GRANTS}/external/mints.ts:76`,
    `${GRANTS}/external/faucet.ts:150`,
    `${GRANTS}/external/faucet.ts:36`,
    `${GRANTS}/events.ts:24`,
    `${ROWS}:133`,
  ],
  concept: concept_accounts,
  kind: "action",
  who: "A signed-in person admitted by the beta waitlist, on a deployment whose faucet is on, minting into their own Safe.",
  input: Schema.Struct({ chainId: Schema.Number, assetId: Schema.String, rawAmount: Schema.String }),
  output: Schema.Struct({ txHash: Schema.String }),
  errors: [
    error_NOT_AUTHENTICATED,
    error_UNKNOWN,
    error_FEATURE_NOT_AVAILABLE,
    error_NOT_IMPLEMENTED,
    ...BINDING_ERRORS,
    ...MINT_ERRORS,
    // Not admitted by the mint (`admit`): a paymaster refusal or a malformed bundler answer dies as a defect that keeps its code.
    error_ROLE_PERMISSION_DENIED,
    error_PROVIDER_RESPONSE_INVALID,
  ],
  reads: [table_smart_accounts, table_accounts],
  writes: [],
  drives: [],
  invokes: [
    procedure_access_require_authenticated_user,
    procedure_access_require_beta_access_from_action,
    procedure_accounts_mint_test_tokens,
  ],
  emits: [event_faucet_confirmed],
  ...FAUCET_SEND,
});

// ── internal: one grant's transitions ───────────────────────────────────────────────────────

export const rpc_accounts_grants_claim_welcome_grant = defineRpc({
  id: "accounts.grants.claim-welcome-grant",
  title: "Take a scheduled welcome grant for minting",
  about:
    "Internal mutation. A grant that is gone, not `scheduled`, or missing its asset, token or decimals answers null. " +
    "Otherwise it moves the grant to `minting` with attemptedAt and answers the mint order (kind, Safe, chain, asset, " +
    "token, decimals, raw amount).",
  was: [`${CONVEX}:3`, `${OPS}/claim-welcome-grant.ts:13`, `${GRANTS}/rules.ts:79`, `${GRANTS}/writes.ts:21`, `${GRANTS}/views.ts:6`],
  concept: concept_accounts,
  kind: "mutation",
  who: RUN_BY_MINT,
  input: GrantId,
  output: Schema.NullOr(
    Schema.Struct({
      kind: Schema.Literals(["personal", "organization"]),
      accountAddress: Schema.String,
      chainId: Schema.Number,
      assetId: Schema.String,
      tokenAddress: Schema.String,
      decimals: Schema.Number,
      rawAmount: Schema.String,
    }),
  ),
  errors: [],
  reads: [table_welcome_funding_grants],
  writes: [table_welcome_funding_grants],
  ...noTouch,
  drives: [machine_welcome_funding_grant.t.to_minting],
});

export const rpc_accounts_grants_complete_welcome_grant = defineRpc({
  id: "accounts.grants.complete-welcome-grant",
  title: "Record a welcome grant's landed mint",
  about: "Internal mutation. Only a `minting` grant moves to `minted`, with the hash and completedAt; anything else is left.",
  was: [`${CONVEX}:4`, `${OPS}/complete-welcome-grant.ts:11`, `${GRANTS}/writes.ts:31`],
  concept: concept_accounts,
  kind: "mutation",
  who: RUN_BY_MINT,
  input: Schema.Struct({ grantId: Schema.String, txHash: Schema.String }),
  output: Schema.Void,
  errors: [],
  reads: [table_welcome_funding_grants],
  writes: [table_welcome_funding_grants],
  ...noTouch,
  drives: [machine_welcome_funding_grant.t.to_minted],
});

export const rpc_accounts_grants_fail_welcome_grant = defineRpc({
  id: "accounts.grants.fail-welcome-grant",
  title: "Record a welcome grant's failed mint",
  about:
    "Internal mutation. Only a `minting` grant moves to `failed`, with reason welcome_funding_mint_failed and completedAt; " +
    "the row stays so an operator sees what never arrived.",
  was: [`${CONVEX}:5`, `${OPS}/fail-welcome-grant.ts:11`, `${GRANTS}/writes.ts:41`, `${GRANTS}/rules.ts:20`],
  concept: concept_accounts,
  kind: "mutation",
  who: RUN_BY_MINT,
  input: GrantId,
  output: Schema.Void,
  errors: [],
  reads: [table_welcome_funding_grants],
  writes: [table_welcome_funding_grants],
  ...noTouch,
  drives: [machine_welcome_funding_grant.t.to_failed],
});

export const rpc_accounts_grants_release_welcome_grant = defineRpc({
  id: "accounts.grants.release-welcome-grant",
  title: "Forget a scheduled welcome grant once welcome funding is off",
  about: "Internal mutation. Only a `scheduled` grant is deleted; a grant that is gone or has moved on is left.",
  was: [`${CONVEX}:9`, `${OPS}/release-welcome-grant.ts:11`, `${GRANTS}/writes.ts:56`],
  concept: concept_accounts,
  kind: "mutation",
  who: RUN_BY_MINT,
  input: GrantId,
  output: Schema.Void,
  errors: [],
  reads: [table_welcome_funding_grants],
  writes: [table_welcome_funding_grants],
  ...noTouch,
});

// ── internal: minting ───────────────────────────────────────────────────────────────────────

export const rpc_accounts_grants_mint_welcome_grant = defineRpc({
  id: "accounts.grants.mint-welcome-grant",
  title: "Mint one scheduled welcome grant",
  about:
    "Internal action, run as the system job `mint_welcome_funding_grant`. Welcome funding off now: it releases the grant " +
    "(`releaseWelcomeGrant`) and answers `disabled`. Else it claims it (`claimWelcomeGrant`; null answers `skipped`), " +
    "mints it from the faucet Safe (`mintWelcomeTokens`: up to 100,000 whole tokens), and records the outcome: a failure " +
    "runs `failWelcomeGrant`, writes [CAPXUL_WELCOME_FUNDING_FAILED] with the grant id and posts faucet_failed; a landing " +
    "runs `completeWelcomeGrant` and posts faucet_confirmed. Both events are attributed to the system actor " +
    "`welcome_funding_<kind>`, not to a person. Every chain failure of the mint is absorbed into `failed` (Effect.exit), so a " +
    "caller never receives one; a failure of the store calls is not caught here.",
  was: [`${CONVEX}:7`, `${OPS}/mint-welcome-grant.ts:26`, `${GRANTS}/external/mints.ts:80`, `${GRANTS}/writes.ts:70`, `${GRANTS}/events.ts:55`, `${GRANTS}/events.ts:73`],
  concept: concept_accounts,
  kind: "action",
  who: "internal: run through ctx.runAction, in its own action, by the accounts.grants.mintWelcomeGrants batch.",
  input: GrantId,
  output: Schema.Struct({ status: Schema.Literals(["disabled", "skipped", "minted", "failed"]) }),
  errors: [error_UNKNOWN],
  reads: [table_welcome_funding_grants],
  writes: [table_welcome_funding_grants],
  drives: [
    machine_welcome_funding_grant.t.to_minting,
    machine_welcome_funding_grant.t.to_minted,
    machine_welcome_funding_grant.t.to_failed,
  ],
  invokes: [],
  emits: [event_faucet_confirmed, event_faucet_failed],
  ...FAUCET_SEND,
});

export const workflow_accounts_grants_mint_welcome_grants = defineWorkflow({
  id: "accounts.grants.mint-welcome-grants",
  title: "Mint a newly provisioned Safe's welcome grants",
  about:
    "Registered as the internal action `accounts/grants:mintWelcomeGrants`, scheduled with runAfter(0) by " +
    "`scheduleWelcomeFunding` in the transaction that inserted the grants: a personal provision, or Organizations' setup " +
    "install or bootstrap for a company Safe (the schema's trigger names only the personal provision). Run as the system " +
    "job `mint_welcome_funding_grants`. It mints the grants in registry order, each in its own action " +
    "(`accounts.grants.mintWelcomeGrant`); a grant whose action fails is written down with " +
    "[CAPXUL_WELCOME_FUNDING_FAILED] (step mintBatch) and the next still runs. Nothing retries a failed or stuck grant. " +
    "Timeout is Convex's action limit; the code sets none.",
  was: [`${CONVEX}:8`, `${OPS}/mint-welcome-grants.ts:20`, `${A}/writes.ts:130`, `${GRANTS}/writes.ts:85`, `${GRANTS}/events.ts:101`],
  concept: concept_accounts,
  priority: "low",
  trigger: { after: rpc_accounts_safes_provision },
  steps: [
    { name: "attribute", about: "Records the run as the system job `mint_welcome_funding_grants`." },
    { name: "mint-each", about: "For each grant id in order, runs accounts.grants.mintWelcomeGrant in its own action." },
    { name: "note-failure", about: "A grant whose action failed leaves a [CAPXUL_WELCOME_FUNDING_FAILED] line; the batch goes on." },
  ],
  reads: [table_welcome_funding_grants],
  writes: [table_welcome_funding_grants],
  drives: [
    machine_welcome_funding_grant.t.to_minting,
    machine_welcome_funding_grant.t.to_minted,
    machine_welcome_funding_grant.t.to_failed,
  ],
  invokes: [],
  emits: [event_faucet_confirmed, event_faucet_failed],
  calls: FAUCET_SEND.calls,
  chain: FAUCET_SEND.chain,
  idempotency: "Each grant moves scheduled → minting once (`claimWelcomeGrant` answers null for any other state), so a second run mints nothing twice.",
  timeoutMs: 600000,
  retries: { max: 0, backoff: "none" },
});
