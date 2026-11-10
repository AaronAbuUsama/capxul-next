// Activity's holdings: what whoever you act as holds (`balance`) and where money reaches it
// (`address`). Both answer for the caller's own Safe, or for the company Safe of an Organization
// whose active Seat the caller holds; any other Organization is ROLE_PERMISSION_DENIED before
// anything about it is read. They replace old accounts' balance read and its binding query, old
// organizations' treasury read and load, and old accounts' deposit instructions: one rpc per
// command whatever the scope (decisions concepts.activity, responsibilities.summaries).
//
// A balance is read from indexing's views in the same Postgres (safe-balances: every Transfer of
// every admitted asset since its deployment block), not by one `balanceOf` per asset over the
// chain's RPC, so it costs one query and no chain call (decision activity.balances-from-views).

import { Schema } from "effect";
import { budget, defineRpc } from "../../../packages/book/src/index.ts";
import { concept_activity } from "../shared/foundation.ts";
import {
  error_INVALID_INPUT,
  error_NOT_AUTHENTICATED,
  error_PROVIDER_ERROR,
  error_ROLE_PERMISSION_DENIED,
  error_SMART_ACCOUNT_MISSING,
} from "../shared/vocabulary.ts";
import { table_principals } from "../access/data.ts";
import { table_parties } from "../parties/data.ts";
import { table_org_members, table_organizations } from "../organizations/data.ts";
import { table_payments } from "../payments/data.ts";
import { table_chain_budgets, table_indexer_progress, table_safe_balances, table_safe_owners } from "../indexing/data.ts";
import { Scope } from "./feed.ts";

const OLD = "packages/backend/src";
const ACC = `${OLD}/accounts`;
const TREASURY = `${OLD}/organizations/treasuries`;
const SDK = "packages/sdk/src/accounts";

const S = Schema.String;
const N = Schema.Number;
const Int = Schema.Int;
const Null = Schema.NullOr;

/** What the address or balance belongs to. */
export const AccountKind = Schema.Literals(["personalSafe", "orgTreasury"]);

/** One admitted asset's position: what the Safe holds and what is not promised elsewhere. */
export const Position = Schema.Struct({
  asset: S,
  chainId: Int,
  tokenAddress: S,
  symbol: S,
  decimals: Int,
  /** In the asset's usual units (`0` when it holds none); `rawBalance` is exact. */
  balance: S,
  available: S,
  rawBalance: S,
  rawAvailable: S,
});

/** A fiat valuation: the sum of every non-zero position at its latest USD rate. */
export const Money = Schema.Struct({ currency: Schema.Literal("USD"), value: S, decimals: Int });

export const Holdings = Schema.Struct({
  /** The Party the Safe is: the caller's own, or the Organization's (`party_…`). */
  id: S,
  accountKind: AccountKind,
  chainId: Int,
  safe: S,
  /** One per admitted asset of the deployment, in its order, zeros included; never one USD record. */
  balances: Schema.Array(Position),
  /** Null when a non-zero position's asset has no USD rate. */
  balance: Null(Money),
  available: Null(Money),
  observedAt: N,
});

export const DepositAddress = Schema.Struct({
  accountKind: AccountKind,
  chainId: Int,
  network: Schema.Literal("base-sepolia"),
  currency: Schema.Literal("USD"),
  /** Lower case. */
  address: S,
  label: S,
});

const WHO =
  "A signed-in person or agent, for their own Safe; or a current member of an Organization (an active Seat), for its " +
  "company Safe. Anyone else naming that Organization is ROLE_PERMISSION_DENIED.";

const SCOPE =
  "The scope comes first. Its own: the Safe on the caller's principal (access' `principals`: a person's email-derived " +
  "Safe, an agent's own). An Organization: the caller's principal must hold an active Seat there (organizations' " +
  "`by_org_principal`), else ROLE_PERMISSION_DENIED and nothing about the Organization is read; then its company Safe " +
  "from `organizations`. ";

// ── balance ─────────────────────────────────────────────────────────────────────────────────

export const rpc_activity_holdings_balances = defineRpc({
  id: "activity.holdings.balances",
  title: "What a Safe holds of each admitted asset, valued in USD",
  about:
    SCOPE +
    "The Safe must be on chain: a person's Safe not claimed yet (no row in indexing's `safe-owners`) is " +
    "SMART_ACCOUNT_MISSING. Ponder's views must be ready (`indexer-progress`), else PROVIDER_ERROR: a view that is " +
    "rebuilding would answer less than the chain holds. Then one position per admitted asset of the deployment, in its " +
    "order, from `safe-balances`; an asset the Safe never touched reads 0, and a token outside the admitted list is never " +
    "shown. `available` is the balance less what is promised: the Safe's Payments already sent and not yet settled, " +
    "and its dated Payments held for their day (payments' rows by owner, submitted, scheduled or due), and for a " +
    "company Safe what its open budgets hold reserved for agreements (indexing's `chain-budgets`, `committed`). The USD " +
    "headline sums each non-zero position at the latest rate of its pair in books' `book-prices` (the Chainlink sync); " +
    "if one has no rate, both valuations are null and the positions still show. One query; no chain call and no " +
    "telemetry call waits in it.",
  was: [
    `${ACC}/balances/operations/read.ts:14`,
    `${ACC}/balances/operations/read-binding.ts:16`,
    `${ACC}/reads/safes.ts:73`,
    `${TREASURY}/operations/read.ts:12`,
    `${TREASURY}/reads.ts:23`,
    `${SDK}/positions.ts:93`,
    "docs/as-is/archive/accounts/balances.ts",
    "docs/as-is/archive/organizations/treasuries.ts",
  ],
  concept: concept_activity,
  kind: "query",
  who: WHO,
  input: Schema.Struct({ scope: Scope }),
  output: Holdings,
  errors: [error_NOT_AUTHENTICATED, error_INVALID_INPUT, error_ROLE_PERMISSION_DENIED, error_SMART_ACCOUNT_MISSING, error_PROVIDER_ERROR],
  reads: [
    table_principals,
    table_org_members,
    table_organizations,
    table_parties,
    table_safe_owners,
    table_indexer_progress,
    table_safe_balances,
    table_payments,
    table_chain_budgets,
  ],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: ["rpc.activity.holdings.balances"],
  budget: budget("read"),
});

// ── address ─────────────────────────────────────────────────────────────────────────────────

export const rpc_activity_holdings_address = defineRpc({
  id: "activity.holdings.address",
  title: "Where to send money to whoever you act as",
  about:
    SCOPE +
    "It answers that Safe's address in lower case, on the deployment's chain (Base Sepolia, 84532), in USD: a person's " +
    "Safe is the one their email derives, so it is the same before and after the Safe is claimed; `label` names whose it " +
    "is (`Capxul personal Safe`, an agent's handle, or the Organization's name). It reads no other principal's row, " +
    "writes nothing and starts nothing.",
  was: [
    `${ACC}/summaries/operations/deposit-instructions.ts:10`,
    `${ACC}/summaries/reads.ts:39`,
    `${ACC}/summaries/views.ts:4`,
    "docs/as-is/archive/accounts/summaries.ts",
  ],
  concept: concept_activity,
  kind: "query",
  who: WHO,
  input: Schema.Struct({ scope: Scope }),
  output: DepositAddress,
  errors: [error_NOT_AUTHENTICATED, error_INVALID_INPUT, error_ROLE_PERMISSION_DENIED],
  reads: [table_principals, table_org_members, table_organizations, table_parties],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: ["rpc.activity.holdings.address"],
  budget: budget("read"),
});
