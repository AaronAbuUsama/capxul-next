// The tokens the books record: Capxul's own assets (the deployment's configuration) and the ERC-20s
// an Organization adds. Adding reads the token on the Organization's chain, then saves it in one
// transaction (the old target query, chain action and admit mutation are steps of one rpc, P3).
// The scan of added tokens is a workflow in processes.ts.

import { Schema } from "effect";
import { budget, defineRpc } from "../../../packages/book/src/index.ts";
import { concept_books } from "../shared/foundation.ts";
import {
  error_FEATURE_NOT_AVAILABLE,
  error_INVALID_INPUT,
  error_NOT_AUTHENTICATED,
  error_PROVIDER_ERROR,
  error_PROVIDER_RESPONSE_INVALID,
  error_ROLE_PERMISSION_DENIED,
  error_WRONG_STATE,
} from "../shared/vocabulary.ts";
import { contract_erc20, integration_chain_rpc } from "../shared/external.ts";
import { table_feature_flags } from "../access/data.ts";
import { table_org_deployments, table_org_members, table_organizations } from "../organizations/data.ts";
import { table_hat_wearers } from "../indexing/data.ts";
import {
  machine_book_account,
  machine_book_asset,
  machine_book_company,
  table_book_accounts,
  table_book_assets,
  table_book_companies,
  table_book_facts,
} from "./data.ts";

const OLD = "packages/backend/src/books/assets";
const ROWS = "packages/protocol/src/books";

const S = Schema.String;
const N = Schema.Number;
const NullOr = Schema.NullOr;

export const BookAsset = Schema.Struct({
  assetId: S,
  chainId: N,
  address: S,
  symbol: S,
  decimals: N,
  tier: Schema.Literals(["settlement", "held", "added"]),
  priced: Schema.Boolean,
  addedBy: NullOr(S),
  addedAt: NullOr(N),
});

const KEEPER_WHO =
  "A current Seat of the Organization whose Safe wears its Books hat (Manage books), while the `books` gate is on; " +
  "anyone else is refused ROLE_PERMISSION_DENIED, naming no token.";

export const rpc_books_assets_list = defineRpc({
  id: "books.assets.list",
  title: "List the tokens the books record",
  about:
    "Capxul's own assets first (the deployment's settlement and held tiers, priced, with no adder), then the tokens this " +
    "Organization added and has not removed, in the order first saved, with who added each and when. Needs no chart.",
  was: [`${OLD}/operations/list.ts:12`, `${OLD}/views.ts:1`, `${ROWS}/operations.ts:196`],
  concept: concept_books,
  kind: "query",
  who:
    "Any current Seat of the Organization, with or without the Books hat, while the `books` gate is on; anyone else, or " +
    "an Organization that does not exist, is refused ROLE_PERMISSION_DENIED, naming no token. An empty id is INVALID_INPUT.",
  input: Schema.Struct({ orgId: S }),
  output: Schema.Struct({ assets: Schema.Array(BookAsset) }),
  errors: [error_NOT_AUTHENTICATED, error_ROLE_PERMISSION_DENIED, error_FEATURE_NOT_AVAILABLE, error_INVALID_INPUT],
  reads: [table_org_members, table_feature_flags, table_book_assets],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: ["rpc.books.assets.list"],
  budget: budget("read"),
});

export const rpc_books_assets_add = defineRpc({
  id: "books.assets.add",
  title: "Add an ERC-20 the Safe holds",
  about:
    "Checks the caller and the token first (not one of Capxul's assets, not already recorded here: WRONG_STATE " +
    "`asset_already_admitted`), then reads on the Organization's chain, at the head block, the token's `decimals`, its " +
    "`symbol` (a bytes32 symbol read as text) and the company Safe's `balanceOf`; no code, a revert or no answer to " +
    "either is INVALID_INPUT `not_an_erc20`. Then, in one transaction that checks the caller and the token again, it " +
    "saves the token from that block (born, or added again after a removal) and books what the Safe holds then as one " +
    "`opening_balance` fact with no USD and its feed number (the books born `open` if they had not begun), so the books " +
    "reconcile from the first day (books.added-token-opening). With a chart, the token gets its Safe account, in its own " +
    "currency. Capxul never pays in it and never prices it, so its facts post no voucher (books.vouchers).",
  was: [
    `${OLD}/operations/add.ts:43`,
    `${OLD}/operations/target.ts:10`,
    `${OLD}/operations/admit.ts:19`,
    `${OLD}/external.ts:1`,
    `${OLD}/writes.ts:31`,
    `${ROWS}/operations.ts:182`,
  ],
  concept: concept_books,
  kind: "action",
  who: KEEPER_WHO,
  input: Schema.Struct({ orgId: S, address: S }),
  output: BookAsset,
  errors: [
    error_NOT_AUTHENTICATED,
    error_ROLE_PERMISSION_DENIED,
    error_FEATURE_NOT_AVAILABLE,
    error_INVALID_INPUT,
    error_WRONG_STATE,
    error_PROVIDER_ERROR,
    error_PROVIDER_RESPONSE_INVALID,
  ],
  reads: [
    table_org_members,
    table_feature_flags,
    table_org_deployments,
    table_hat_wearers,
    table_organizations,
    table_book_assets,
    table_book_companies,
    table_book_accounts,
  ],
  writes: [table_book_companies, table_book_assets, table_book_facts, table_book_accounts],
  drives: [machine_book_company.t.open, machine_book_asset.t.add, machine_book_asset.t.readd, machine_book_account.t.add],
  invokes: [],
  emits: [],
  calls: [integration_chain_rpc.c.getBlock, integration_chain_rpc.c.readContract],
  chain: [contract_erc20.f.decimals, contract_erc20.f.symbol, contract_erc20.f.balanceOf],
  spans: ["rpc.books.assets.add"],
  budget: budget("chain-read"),
});

export const rpc_books_assets_remove = defineRpc({
  id: "books.assets.remove",
  title: "Stop recording an added token",
  about:
    "Stops the scan of a token this Organization added; no fact is deleted. One of Capxul's assets, a token never added " +
    "here, or one removed already is WRONG_STATE `asset_not_added`. Another Organization's row of the same token is not " +
    "touched.",
  was: [`${OLD}/operations/remove.ts:15`, `${OLD}/writes.ts:64`, `${ROWS}/operations.ts:189`],
  concept: concept_books,
  kind: "mutation",
  who: KEEPER_WHO,
  input: Schema.Struct({ orgId: S, address: S }),
  output: Schema.Struct({ assetId: S, address: S }),
  errors: [error_NOT_AUTHENTICATED, error_ROLE_PERMISSION_DENIED, error_FEATURE_NOT_AVAILABLE, error_WRONG_STATE],
  reads: [table_org_members, table_feature_flags, table_org_deployments, table_hat_wearers, table_book_assets],
  writes: [table_book_assets],
  drives: [machine_book_asset.t.remove],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: ["rpc.books.assets.remove"],
  budget: budget("write"),
});
