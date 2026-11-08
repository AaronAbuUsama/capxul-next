// The as-is book of the old accounts concept: the balances area (the live balance of a person's
// Safe).
//
// Every operation registered at `accounts/balances:*` (packages/backend/convex/accounts/balances.ts):
// the public row `balances.read` (packages/protocol/src/accounts/operations.ts:118) and the
// internal binding query actions run through ctx.runQuery (`readBinding`, reads/safes.ts:73).
// Holdings are not here: since 5 September 2026 the Ponder indexer is the balance read model and
// the SDK reads it directly (accounts/README.md). Paths in `was` are relative to the old
// repository root.

import { Schema } from "effect";
import { defineRpc, type CallRef } from "../../../packages/book/src/index.ts";

import { concept_accounts } from "../shared/foundation.ts";
import { contract_erc20, integration_chain_rpc } from "../shared/external.ts";
import {
  error_ACCOUNT_NOT_FOUND,
  error_ENV_MISSING,
  error_INVALID_INPUT,
  error_NOT_AUTHENTICATED,
  error_PROVIDER_ERROR,
  error_SMART_ACCOUNT_MISSING,
  error_UNKNOWN,
  error_WRONG_STATE,
  event_account_balance_read,
} from "../shared/vocabulary.ts";
import { procedure_access_require_authenticated_user } from "../access/procedures.ts";
import { table_accounts, table_smart_accounts } from "./data.ts";
import { procedure_accounts_read_positions } from "./procedures.ts";

const BACKEND = "packages/backend";
const CONVEX = `${BACKEND}/convex/accounts/balances.ts`;
const A = `${BACKEND}/src/accounts`;
const BAL = `${A}/balances`;
const ROWS = "packages/protocol/src/accounts/operations.ts";

const rpcCall = (name: string): CallRef =>
  (integration_chain_rpc.c as Record<string, CallRef | undefined>)[name] ?? {
    _kind: "call",
    id: `chain-rpc.${name}`,
    integration: "chain-rpc",
    name,
  };

/** `AssetPositionSchema` (operations.ts:45): one settlement asset's exact raw position; never labelled USD. */
export const AssetPosition = Schema.Struct({
  assetId: Schema.String,
  tokenAddress: Schema.String,
  symbol: Schema.String,
  decimals: Schema.Number,
  rawBalance: Schema.String,
  rawAvailableBalance: Schema.String,
});

/** The binding refusals (operations.ts:31): no Safe, no Account, or an Account bound to another Safe. */
export const BINDING_ERRORS = [error_SMART_ACCOUNT_MISSING, error_ACCOUNT_NOT_FOUND, error_WRONG_STATE];

export const rpc_accounts_balances_read = defineRpc({
  id: "accounts.balances.read",
  title: "Read every settlement asset's balance in the caller's Safe",
  about:
    "Public action. Reads the caller's binding first (`accounts.balances.readBinding`: SMART_ACCOUNT_MISSING, " +
    "ACCOUNT_NOT_FOUND or WRONG_STATE before any chain call), then one ERC-20 `balanceOf` per configured settlement asset " +
    "of the chain, together, in registry order (`readPositions`), each within a 10 s total chain budget so the chain gives " +
    "up before the SDK's 15 s read timeout (CAP-709). Available equals balance. After each asset it queues one " +
    "server-confirmed account_balance_read (account kind personalSafe, a balance bucket, the duration) for delivery after " +
    "the action answers. A chain id with no configured asset answers no positions.",
  was: [`${CONVEX}:3`, `${BAL}/operations/read.ts:14`, `${A}/reads/safes.ts:73`, `${A}/external.ts:64`, `${A}/external.ts:43`, `${BAL}/events.ts:12`, `${ROWS}:120`],
  concept: concept_accounts,
  kind: "action",
  who: "A signed-in person, for their own Safe and Account on the named chain.",
  input: Schema.Struct({ chainId: Schema.Number }),
  output: Schema.Struct({ accountId: Schema.String, chainId: Schema.Number, positions: Schema.Array(AssetPosition) }),
  errors: [error_NOT_AUTHENTICATED, error_INVALID_INPUT, error_UNKNOWN, error_ENV_MISSING, error_PROVIDER_ERROR, ...BINDING_ERRORS],
  reads: [table_smart_accounts, table_accounts],
  writes: [],
  drives: [],
  invokes: [procedure_access_require_authenticated_user, procedure_accounts_read_positions],
  emits: [event_account_balance_read],
  calls: [rpcCall("fetchErc20Balance")],
  chain: [contract_erc20.f.balanceOf],
  spans: ["chain.read eth_call"],
});

export const rpc_accounts_balances_read_binding = defineRpc({
  id: "accounts.balances.read-binding",
  title: "Read the caller's Account bound to their Safe on a chain",
  about:
    "Internal query. The person's Safe row on the chain (first; none is SMART_ACCOUNT_MISSING), their Account (first; " +
    "none is ACCOUNT_NOT_FOUND), and the Account must name the same Safe case-insensitively, else WRONG_STATE " +
    "(accountOwnedByDifferentSafe, under the caller's method name). Answers the Account id and the Safe as stored.",
  was: [`${CONVEX}:4`, `${BAL}/operations/read-binding.ts:16`, `${BAL}/rules.ts:11`, `${A}/errors.ts:35`, `${A}/reads/safes.ts:56`],
  concept: concept_accounts,
  kind: "query",
  who: "internal: run through ctx.runQuery (`readBinding`) by accounts.balances.read, accounts.grants.faucetMint and accounts.summaries.home.",
  input: Schema.Struct({ authUserId: Schema.String, chainId: Schema.Number, method: Schema.String }),
  output: Schema.Struct({ accountId: Schema.String, smartAccountAddress: Schema.String }),
  errors: BINDING_ERRORS,
  reads: [table_smart_accounts, table_accounts],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});
