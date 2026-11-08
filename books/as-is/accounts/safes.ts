// The as-is book of the old accounts concept: the safes area (a person's Safe: provision, prove
// its deployment, read it).
//
// Every operation registered at `accounts/safes:*` (packages/backend/convex/accounts/safes.ts).
// Four are public rows of `safes` (packages/protocol/src/accounts/operations.ts:54); the other
// three are internal: two run by an action through ctx.runQuery / ctx.runMutation in the same
// call, and one telemetry poster the actions schedule. The poster is telemetry only, so it is an
// rpc whose about starts with `Telemetry plumbing:`; nothing here is a workflow.
//
// How touches are booked: an rpc lists the accounts tables its own transaction (or, for an
// action, the internal rpcs it runs) reads and writes, and invokes the door procedures and the
// neighbours' procedures it calls. Chain reads are `calls` on chain-rpc, each with the
// `chain.read <method>` span the chain-rpc request opens. Paths in `was` are relative to the old
// repository root (/home/user/factory).

import { Schema } from "effect";
import { defineRpc, type CallRef } from "../../../packages/book/src/index.ts";

import { concept_accounts } from "../shared/foundation.ts";
import { integration_chain_rpc } from "../shared/external.ts";
import {
  error_ENV_MISSING,
  error_INVALID_INPUT,
  error_NOT_AUTHENTICATED,
  error_PROFILE_NOT_FOUND,
  error_PROVIDER_ERROR,
  error_UNKNOWN,
  error_WRONG_STATE,
  event_provisioning_safe_confirmed,
} from "../shared/vocabulary.ts";
import {
  procedure_access_authenticated_user,
  procedure_access_require_authenticated_user,
} from "../access/procedures.ts";
import { table_accounts, table_smart_accounts, table_welcome_funding_grants } from "./data.ts";
import { procedure_accounts_ensure_account_in_tx, procedure_accounts_schedule_welcome_funding } from "./procedures.ts";

const BACKEND = "packages/backend";
const CONVEX = `${BACKEND}/convex/accounts/safes.ts`;
const A = `${BACKEND}/src/accounts`;
const SAFES = `${A}/safes`;
const OPS = `${SAFES}/operations`;
const ROWS = "packages/protocol/src/accounts/operations.ts";

/** A chain-rpc call: the booked link, or a link by its conventional id that the build reports until external.ts books it. */
const rpcCall = (name: string): CallRef =>
  (integration_chain_rpc.c as Record<string, CallRef | undefined>)[name] ?? {
    _kind: "call",
    id: `chain-rpc.${name}`,
    integration: "chain-rpc",
    name,
  };

/** The JSON-RPC method each chain-rpc call sends; each request opens a `chain.read <method>` span. */
const CHAIN_METHODS: Record<string, readonly string[]> = {
  fetchCode: ["eth_getCode"],
  fetchUserOperationReceipt: ["eth_getUserOperationReceipt"],
  fetchBlockTimestamp: ["eth_getBlockByNumber"],
  fetchProxyCreationLog: ["eth_getLogs"],
};

/** The calls of a chain-reading rpc and the spans they open. */
const onChain = (...names: string[]) => ({
  calls: names.map(rpcCall),
  spans: [...new Set(names.flatMap((name) => (CHAIN_METHODS[name] ?? []).map((method) => `chain.read ${method}`)))],
});

const noChain = { calls: [], chain: [], spans: [] } as const;

/** `SmartAccount` (operations.ts:34): the personal Safe as every safes and claims operation returns it. */
export const SmartAccount = Schema.Struct({
  authUserId: Schema.String,
  signerAddress: Schema.NullOr(Schema.String),
  smartAccountAddress: Schema.String,
  chainId: Schema.Number,
  deployedAt: Schema.NullOr(Schema.Number),
  claimedAt: Schema.NullOr(Schema.Number),
  createdAt: Schema.Number,
});

const SIGNED_IN = "A signed-in person (a BetterAuth session), for their own Safe. The caller never names the person.";
const PUBLIC_ERRORS = [error_NOT_AUTHENTICATED, error_INVALID_INPUT, error_UNKNOWN, error_ENV_MISSING];

// ── public ──────────────────────────────────────────────────────────────────────────────────

export const rpc_accounts_safes_provision = defineRpc({
  id: "accounts.safes.provision",
  title: "Name the signed-in person's Safe on a chain and bind their Account",
  about:
    "Public mutation, idempotent on person and chain. The person's Safe row on the chain answers when it exists; else it " +
    "inserts a counterfactual row (deployedAt null, no signer) at the address the session email derives " +
    "(`personalSafeAddress`, the Companies House derivation), lowercased. Then `ensureAccountInTx` binds the logical " +
    "Account to it (an Account bound to another Safe, or the Safe bound to another person's Account, is WRONG_STATE), and " +
    "`scheduleWelcomeFunding` schedules the staging welcome grants (best-effort, staging only), which starts " +
    "accounts.grants.mintWelcomeGrants. All in one transaction. Nothing is read from the chain; the client's chain id is " +
    "taken as is.",
  was: [`${CONVEX}:7`, `${OPS}/provision.ts:10`, `${SAFES}/writes.ts:24`, `${SAFES}/writes.ts:43`, `${SAFES}/writes.ts:58`, `${ROWS}:56`],
  concept: concept_accounts,
  kind: "mutation",
  who: SIGNED_IN,
  input: Schema.Struct({ chainId: Schema.Number }),
  output: SmartAccount,
  errors: [...PUBLIC_ERRORS, error_WRONG_STATE],
  reads: [table_smart_accounts, table_accounts, table_welcome_funding_grants],
  writes: [table_smart_accounts, table_accounts, table_welcome_funding_grants],
  drives: [],
  invokes: [procedure_access_authenticated_user, procedure_accounts_ensure_account_in_tx, procedure_accounts_schedule_welcome_funding],
  emits: [],
  ...noChain,
});

export const rpc_accounts_safes_confirm_deployment = defineRpc({
  id: "accounts.safes.confirm-deployment",
  title: "Record a Safe deployment the chain proves",
  about:
    "Public action. The evidence must name the asked Safe (lowercased, 0x+40 hex) and chain, else INVALID_INPUT. It reads " +
    "the person's Safe row (`accounts.safes.readSafe`); a row already deployed answers again, but only for its own address " +
    "(another is INVALID_INPUT). Otherwise it proves the deployment on chain, never taking a timestamp from the caller: the " +
    "address must have code; with a userOpHash (0x+64 hex) its receipt must exist, succeed and name the Safe as sender; " +
    "without one, a ProxyCreation log from Safe 1.5.0's factory, then 1.4.1's. deployedAt is the proving block's time. " +
    "Each refusal is INVALID_INPUT. It records the proof (`accounts.safes.recordDeployment`; no Safe row is " +
    "PROFILE_NOT_FOUND) and schedules provisioning_safe_confirmed with the wall-clock duration " +
    "(`accounts.safes.emitSafeConfirmed`); a failed schedule leaves a [CAPXUL_TELEMETRY_DROPPED] line. Chain reads admit " +
    "PROVIDER_ERROR and ENV_MISSING only.",
  was: [
    `${CONVEX}:3`,
    `${OPS}/confirm-deployment.ts:15`,
    `${SAFES}/rules.ts:21`,
    `${SAFES}/rules.ts:37`,
    `${SAFES}/external.ts:35`,
    `${SAFES}/external.ts:66`,
    `${SAFES}/errors.ts:10`,
    `${A}/events.ts:48`,
    `${ROWS}:63`,
  ],
  concept: concept_accounts,
  kind: "action",
  who: SIGNED_IN,
  input: Schema.Struct({
    chainId: Schema.Number,
    safeAddress: Schema.String,
    evidence: Schema.Struct({
      chainId: Schema.Number,
      signerAddress: Schema.String,
      safeAddress: Schema.String,
      userOpHash: Schema.optionalKey(Schema.String),
      txHash: Schema.optionalKey(Schema.String),
      blockNumber: Schema.optionalKey(Schema.Number),
    }),
  }),
  output: SmartAccount,
  errors: [...PUBLIC_ERRORS, error_PROVIDER_ERROR, error_PROFILE_NOT_FOUND],
  reads: [table_smart_accounts],
  writes: [table_smart_accounts],
  drives: [],
  invokes: [procedure_access_require_authenticated_user],
  emits: [event_provisioning_safe_confirmed],
  ...onChain("fetchCode", "fetchUserOperationReceipt", "fetchProxyCreationLog", "fetchBlockTimestamp"),
  chain: [],
});

export const rpc_accounts_safes_load_by_auth_user_id = defineRpc({
  id: "accounts.safes.load-by-auth-user-id",
  title: "Read the signed-in person's first Safe",
  about:
    "Public query. The `authUserId` must be the caller's own, else NOT_AUTHENTICATED (so another person's row never leaks). " +
    "Answers the person's first Safe row on any chain (`by_auth_user`, first), or null. The SDK's account status, claim " +
    "lane and approval preparation read it.",
  was: [`${CONVEX}:5`, `${OPS}/load-by-auth-user-id.ts:11`, `${SAFES}/guards.ts:11`, `${SAFES}/reads.ts:8`, `${ROWS}:81`],
  concept: concept_accounts,
  kind: "query",
  who: "A signed-in person, naming their own authUserId.",
  input: Schema.Struct({ authUserId: Schema.String }),
  output: Schema.NullOr(SmartAccount),
  errors: PUBLIC_ERRORS,
  reads: [table_smart_accounts],
  writes: [],
  drives: [],
  invokes: [procedure_access_authenticated_user],
  emits: [],
  ...noChain,
});

export const rpc_accounts_safes_load_by_smart_account_address = defineRpc({
  id: "accounts.safes.load-by-smart-account-address",
  title: "Read the Safe at an address, when it is the caller's own",
  about:
    "Public query. The address must be 0x+40 hex in any case (INVALID_INPUT address). The first Safe row at it, lowercased, " +
    "on any chain; none is null; another person's row is NOT_AUTHENTICATED.",
  was: [`${CONVEX}:6`, `${OPS}/load-by-smart-account-address.ts:12`, `${SAFES}/rules.ts:17`, `${SAFES}/reads.ts:20`, `${SAFES}/guards.ts:15`, `${ROWS}:88`],
  concept: concept_accounts,
  kind: "query",
  who: SIGNED_IN,
  input: Schema.Struct({ address: Schema.String }),
  output: Schema.NullOr(SmartAccount),
  errors: PUBLIC_ERRORS,
  reads: [table_smart_accounts],
  writes: [],
  drives: [],
  invokes: [procedure_access_authenticated_user],
  emits: [],
  ...noChain,
});

// ── internal ────────────────────────────────────────────────────────────────────────────────

export const rpc_accounts_safes_read_safe = defineRpc({
  id: "accounts.safes.read-safe",
  title: "Read the person's Safe row on a chain, for an action",
  about: "Internal query: the person's Safe row on this chain (`by_auth_user_chain`, first), as stored, or null.",
  was: [`${CONVEX}:8`, `${OPS}/read-safe.ts:9`, `${A}/reads/safes.ts:14`, `${A}/reads/safes.ts:47`],
  concept: concept_accounts,
  kind: "query",
  who: "internal: run through ctx.runQuery by accounts.claims.claim and accounts.safes.confirmDeployment (`loadSafe`).",
  input: Schema.Struct({ authUserId: Schema.String, chainId: Schema.Number }),
  output: Schema.Unknown,
  errors: [],
  reads: [table_smart_accounts],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  ...noChain,
});

export const rpc_accounts_safes_record_deployment = defineRpc({
  id: "accounts.safes.record-deployment",
  title: "Stamp a proven deployment on the Safe row once",
  about:
    "Internal mutation. The person's Safe row on the chain must exist (PROFILE_NOT_FOUND) at this exact lowercased address " +
    "(INVALID_INPUT). A deployed row answers unchanged. Otherwise it patches deployedAt (the proving block's time), " +
    "deployTxHash, deployedAtBlock and the userOpHash when given, and clears deploymentInFlightAt, the claim lock's lease " +
    "stamp, while leaving claimLockId in place. A row gone after its own write is an UNKNOWN defect.",
  was: [`${CONVEX}:9`, `${OPS}/record-deployment.ts:12`, `${A}/reads/safes.ts:28`, `${SAFES}/writes.ts:73`, `${A}/reads/safes.ts:38`],
  concept: concept_accounts,
  kind: "mutation",
  who: "internal: run through ctx.runMutation by accounts.safes.confirmDeployment.",
  input: Schema.Struct({
    authUserId: Schema.String,
    chainId: Schema.Number,
    safeAddress: Schema.String,
    derivedDeployedAt: Schema.Number,
    deployedAtBlock: Schema.Number,
    deployTxHash: Schema.String,
    userOpHash: Schema.optionalKey(Schema.String),
  }),
  output: SmartAccount,
  errors: [error_INVALID_INPUT, error_PROFILE_NOT_FOUND, error_UNKNOWN],
  reads: [table_smart_accounts],
  writes: [table_smart_accounts],
  drives: [],
  invokes: [],
  emits: [],
  ...noChain,
});

export const rpc_accounts_safes_emit_safe_confirmed = defineRpc({
  id: "accounts.safes.emit-safe-confirmed",
  title: "Post provisioning_safe_confirmed",
  about:
    "Telemetry plumbing: an internal action scheduled (never awaited) by a deployment confirmation or a claim, run as the " +
    "system job `emit_provisioning_safe_confirmed`. It posts provisioning_safe_confirmed attributed to the person, with the " +
    "chain, Safe, duration and the deployment's block, hash and time when known, carrying the caller's journey and " +
    "correlation ids.",
  was: [`${CONVEX}:4`, `${OPS}/emit-safe-confirmed.ts:14`, `${SAFES}/events.ts:12`, `${A}/events.ts:48`],
  concept: concept_accounts,
  kind: "action",
  who: "internal: scheduled by accounts.safes.confirmDeployment and accounts.claims.claim (`safeConfirmed`).",
  input: Schema.Struct({
    authUserId: Schema.String,
    chainId: Schema.Number,
    safeAddress: Schema.String,
    durationMs: Schema.Number,
    deployedAt: Schema.optionalKey(Schema.Number),
    deployedAtBlock: Schema.optionalKey(Schema.Number),
    deployTxHash: Schema.optionalKey(Schema.String),
    userOpHash: Schema.optionalKey(Schema.String),
    journeyId: Schema.optionalKey(Schema.String),
    correlationId: Schema.optionalKey(Schema.String),
  }),
  output: Schema.Void,
  errors: [],
  reads: [],
  writes: [],
  drives: [],
  invokes: [],
  emits: [event_provisioning_safe_confirmed],
  ...noChain,
});
