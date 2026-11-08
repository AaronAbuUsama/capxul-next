// The grants area: test money from the deployment's faucet, on test networks only.
//
// The faucet is a Capxul service key (the service-signer integration's FAUCET_KEY) that mints the
// test tokens of the deployment (their `mint` is open on Base Sepolia's test tokens and the
// devnet's). It sends a plain transaction; nothing waits for it here (decision `accounts.faucet`).
// Welcome grants are not here: they are a staging-only step of the setup process.

import { Schema } from "effect";
import { budget, defineRpc } from "../../../packages/book/src/index.ts";
import { integration_service_signer } from "../shared/external.ts";
import { concept_accounts } from "../shared/foundation.ts";
import {
  error_FEATURE_NOT_AVAILABLE,
  error_INVALID_INPUT,
  error_NOT_AUTHENTICATED,
  error_PROVIDER_ERROR,
  error_SMART_ACCOUNT_MISSING,
  error_TRANSACTION_FAILED,
  error_WRONG_ENVIRONMENT,
} from "../shared/vocabulary.ts";
import { table_personal_safes, table_admissions } from "./data.ts";
import { table_feature_flags } from "../access/data.ts";
import { table_parties } from "../parties/data.ts";

const OLD = "packages/backend/src";
const G = `${OLD}/accounts/grants`;

const S = Schema.String;

export const rpc_accounts_grants_fund = defineRpc({
  id: "accounts.grants.fund",
  title: "Mint test money into your own Safe, or an Organization's on a devnet",
  about:
    "Off a test network (production) it is WRONG_ENVIRONMENT. The caller must be admitted or the beta open to them " +
    "(FEATURE_NOT_AVAILABLE) and have started their setup, which names their Safe (SMART_ACCOUNT_MISSING). `asset` " +
    "defaults to USDC and `amount` to 100; an asset the deployment does not mint, or an amount that is not a positive " +
    "number of at most 10,000 whole tokens, is INVALID_INPUT. With `org` it funds that Organization's Safe instead, on a " +
    "devnet only (WRONG_ENVIRONMENT elsewhere), with USDC, USDT, EURC or WETH; a handle that names no Organization in " +
    "parties' directory is INVALID_INPUT (`org`). It sends one mint from the faucet key through the service signer, " +
    "which records the signed bytes before broadcasting, and answers the amount and the transaction hash at broadcast; " +
    "it does not wait for the receipt. Nothing is stored.",
  concept: concept_accounts,
  kind: "action",
  who: "A signed-in person, admitted or with the beta open, for their own Safe; `org` on a local devnet only.",
  input: Schema.Struct({ asset: Schema.optionalKey(S), amount: Schema.optionalKey(S), org: Schema.optionalKey(S) }),
  output: Schema.Struct({ amount: Schema.Struct({ asset: S, value: S }), txHash: S }),
  errors: [
    error_NOT_AUTHENTICATED,
    error_WRONG_ENVIRONMENT,
    error_FEATURE_NOT_AVAILABLE,
    error_SMART_ACCOUNT_MISSING,
    error_INVALID_INPUT,
    error_PROVIDER_ERROR,
    error_TRANSACTION_FAILED,
  ],
  reads: [table_personal_safes, table_admissions, table_feature_flags, table_parties],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [integration_service_signer.c.send],
  // The test token's open `mint(address,uint256)` is not in shared/external.ts yet (decision `accounts.faucet`).
  chain: [],
  spans: [],
  budget: budget("chain-submit"),
  was: [`${G}/operations/faucet-mint.ts:16`, `${G}/guards.ts:10`, `${G}/rules.ts:23`, `${G}/external/mints.ts:76`, `${OLD}/operator/faucets/operations`],
});
