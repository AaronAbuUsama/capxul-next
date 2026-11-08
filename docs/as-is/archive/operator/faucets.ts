// The as-is book of the old operator concept: the faucets area.
//
// Every operation registered at `operator/faucets:*` (packages/backend/convex/operator/faucets.ts):
// internal functions run with `convex run` (the sandbox's `faucet send`, the devnet journey and
// `capxul dev fund --org` through the devnet guardian). None is scheduled, so every one is an rpc.
//
// The mint itself is Accounts' action-side mint owner (`mintTestTokens`, `mintTestTokensOnce`,
// accounts/grants/external/mints.ts:62, :76), not an in-transaction function, so it is no procedure:
// the chain calls it makes for the faucet are booked on the faucet rpcs. It sends a sponsored
// UserOperation from the backend-owned faucet Safe (deployed on first use), signed with
// DEPLOYER_PRIVATE_KEY, calling the test token's open `mint`, and waits for its receipt.

import { Schema } from "effect";
import { defineRpc } from "../../../packages/book/src/index.ts";

import { concept_operator } from "../shared/foundation.ts";
import {
  contract_entry_point,
  contract_safe_4337_module,
  contract_test_money_token,
  integration_chain_rpc,
} from "../shared/external.ts";
import {
  error_ENV_MISSING,
  error_INSUFFICIENT_BALANCE,
  error_INVALID_INPUT,
  error_PROVIDER_ERROR,
  error_TRANSACTION_FAILED,
  error_UNKNOWN,
} from "../shared/vocabulary.ts";
import { procedure_parties_resolve_recipient_in_tx } from "../parties/procedures.ts";

const BACKEND = "packages/backend";
const SRC = `${BACKEND}/src`;
const CONVEX = `${BACKEND}/convex/operator/faucets.ts`;
const F = `${SRC}/operator/faucets`;
const OPS = `${F}/operations`;
const MINTS = `${SRC}/accounts/grants/external`;

const WHO = "internal: an operator or a proof tool with `convex run`; no session, no caller check.";

/** `RecipientLocatorSchema` (protocol parties/schema.ts:31): a handle, email, address or Party. */
const RecipientLocator = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("handle"), handle: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("email"), email: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("address"), address: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("party"), partyId: Schema.String }),
]);

/** What the mint path can fail with: its own refusals, the sponsorship's, and a reverted receipt. */
const MINT_ERRORS = [
  error_INVALID_INPUT,
  error_ENV_MISSING,
  error_TRANSACTION_FAILED,
  error_PROVIDER_ERROR,
  error_INSUFFICIENT_BALANCE,
  error_UNKNOWN,
];

/** sendOnFaucetLane (faucet.ts:150): deploy check, sponsored build on a fresh nonce lane, send, wait. */
const MINT_CALLS = [
  integration_chain_rpc.c.fetchAddressCode,
  integration_chain_rpc.c.fetchEntryPointNonce,
  integration_chain_rpc.c.fetchUserOperationFees,
  integration_chain_rpc.c.sponsorUserOperation,
  integration_chain_rpc.c.sendUserOperation,
  integration_chain_rpc.c.waitForUserOperationReceipt,
];
/** sendOnceOnFaucetLane (keyed-sends.ts:57): a keyed mint first looks for the one that landed. */
const KEYED_MINT_CALLS = [
  integration_chain_rpc.c.fetchLatestBlockNumber,
  integration_chain_rpc.c.fetchEntryPointUserOperationEvent,
];
const MINT_CHAIN = [
  contract_test_money_token.f.mint,
  contract_safe_4337_module.f.executeUserOpWithErrorString,
  contract_entry_point.f.getNonce,
];
const MINT_WAS = [
  `${F}/external.ts:9`,
  `${MINTS}/mints.ts:38`,
  `${MINTS}/mints.ts:50`,
  `${MINTS}/mints.ts:62`,
  `${MINTS}/mints.ts:76`,
  `${MINTS}/faucet.ts:35`,
  `${MINTS}/faucet.ts:58`,
  `${MINTS}/faucet.ts:150`,
  `${SRC}/accounts/external.ts:27`,
  `${SRC}/operator/external.ts:9`,
];

/** requireFaucetAsset (faucets/rules.ts:17): a configured money asset on Base Sepolia; no default asset. */
const ASSET_WAS = [`${F}/rules.ts:17`, `${F}/errors.ts:6`];

export const rpc_operator_faucets_mint_to = defineRpc({
  id: "operator.faucets.mint-to",
  title: "Mint a named test asset to one Safe address",
  about:
    "The internal action `operator/faucets:mintTo`. The asset id must name a configured money asset on Base Sepolia " +
    "(INVALID_INPUT); the raw amount is minted to the address in one faucet mint of at most 10,000 whole tokens, waiting " +
    "for inclusion. No environment gate: any deployment with a deployer key mints. Answers the transaction hash. Run " +
    "by the devnet and by operator.fixtures.seed (`fundOwner`). The mint admits PROVIDER_ERROR, ENV_MISSING and a " +
    "sponsorship's INSUFFICIENT_BALANCE from the chain; any other chain code (ROLE_PERMISSION_DENIED or " +
    "PROVIDER_RESPONSE_INVALID from the gateway) becomes UNKNOWN, and a refused send TRANSACTION_FAILED.",
  was: [`${CONVEX}:6`, `${OPS}/mint-to.ts:12`, ...ASSET_WAS, ...MINT_WAS],
  concept: concept_operator,
  kind: "action",
  who: `${WHO} Also run by operator.fixtures.seed (operator/fixtures/external.ts:41).`,
  input: Schema.Struct({ holderAddress: Schema.String, rawAmount: Schema.String, assetId: Schema.String }),
  output: Schema.Struct({ txHash: Schema.String }),
  errors: MINT_ERRORS,
  reads: [],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: MINT_CALLS,
  chain: MINT_CHAIN,
  spans: [],
});

export const rpc_operator_faucets_mint_to_recipient = defineRpc({
  id: "operator.faucets.mint-to-recipient",
  title: "Mint a named test asset to whoever a locator names",
  about:
    "The internal action `operator/faucets:mintToRecipient` (the sandbox's `faucet send`). The asset must be admitted " +
    "(INVALID_INPUT); the recipient is resolved through operator.faucets.resolve-recipient, the same Parties path " +
    "product payments use, then the amount is minted to its Safe as for mintTo. No environment gate. Answers the hash, " +
    "the Safe, its label, the locator and the resolution kind. Chain codes the mint does not admit become UNKNOWN.",
  was: [`${CONVEX}:7`, `${OPS}/mint-to-recipient.ts:29`, `${OPS}/mint-to-recipient.ts:38`, `${F}/reads.ts:20`, ...ASSET_WAS, ...MINT_WAS],
  concept: concept_operator,
  kind: "action",
  who: WHO,
  input: Schema.Struct({ recipient: RecipientLocator, rawAmount: Schema.String, assetId: Schema.String }),
  output: Schema.Struct({
    txHash: Schema.String,
    safeAddress: Schema.String,
    label: Schema.String,
    recipient: RecipientLocator,
    kind: Schema.String,
  }),
  errors: MINT_ERRORS,
  reads: [],
  writes: [],
  drives: [],
  invokes: [procedure_parties_resolve_recipient_in_tx],
  emits: [],
  calls: MINT_CALLS,
  chain: MINT_CHAIN,
  spans: [],
});

export const rpc_operator_faucets_resolve_recipient = defineRpc({
  id: "operator.faucets.resolve-recipient",
  title: "Resolve a faucet recipient through Parties",
  about:
    "The internal query `operator/faucets:resolveRecipient`: the transaction mintToRecipient and fundOrganization read " +
    "their recipient in. Parties resolves the locator, admitting INVALID_INPUT. The answer is Parties' recipient " +
    "resolution (deep, Schema.Unknown).",
  was: [`${CONVEX}:8`, `${OPS}/resolve-recipient.ts:9`, `${F}/reads.ts:13`, `${SRC}/parties/reads/recipients.ts:73`],
  concept: concept_operator,
  kind: "query",
  who: "internal: run by operator.faucets.mint-to-recipient and fund-organization (`recipientFor`, faucets/reads.ts:20).",
  input: Schema.Struct({ recipient: RecipientLocator }),
  output: Schema.Unknown,
  errors: [error_INVALID_INPUT, error_UNKNOWN],
  reads: [],
  writes: [],
  drives: [],
  invokes: [procedure_parties_resolve_recipient_in_tx],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_operator_faucets_fund_organization = defineRpc({
  id: "operator.faucets.fund-organization",
  title: "Fund an Organization's Safe with test money, in faucet-sized mints",
  about:
    "The internal action `operator/faucets:fundOrganization` (`capxul dev fund --org`, G9). On a local devnet only " +
    "(INVALID_INPUT `environment`). The asset is test USDC on Base Sepolia unless `assetId` names another admitted asset " +
    "(EURC for a euro department); the raw amount must be a whole positive number of base units (INVALID_INPUT) and is " +
    "cut into mints of at most 10,000 tokens, largest first. The handle (a leading @ dropped) must resolve through " +
    "Parties to a known Organization with a Safe (INVALID_INPUT `org`). Each mint is sent one after another; with " +
    "`mintKey` each is keyed `<mintKey>:<index>`, sent at most once, and a repeated ask reports the hash that landed, " +
    "read back from recent blocks only (CAP-1288). A failed mint stops the run with the earlier mints landed. Answers " +
    "the Safe, label, hashes, token and decimals. Chain codes the mint does not admit become UNKNOWN.",
  was: [
    `${CONVEX}:5`,
    `${OPS}/fund-organization.ts:41`,
    `${OPS}/fund-organization.ts:54`,
    `${OPS}/fund-organization.ts:56`,
    `${OPS}/fund-organization.ts:57`,
    `${OPS}/fund-organization.ts:60`,
    `${F}/rules.ts:28`,
    `${F}/rules.ts:40`,
    `${F}/rules.ts:50`,
    `${F}/errors.ts:10`,
    `${F}/errors.ts:18`,
    `${SRC}/operator/guards.ts:10`,
    `${MINTS}/keyed-sends.ts:57`,
    ...MINT_WAS,
  ],
  concept: concept_operator,
  kind: "action",
  who: `${WHO} The devnet guardian runs it for \`capxul dev fund --org\`.`,
  input: Schema.Struct({
    handle: Schema.String,
    rawAmount: Schema.String,
    assetId: Schema.optionalKey(Schema.String),
    mintKey: Schema.optionalKey(Schema.String),
  }),
  output: Schema.Struct({
    safeAddress: Schema.String,
    label: Schema.String,
    txHashes: Schema.Array(Schema.String),
    tokenAddress: Schema.String,
    decimals: Schema.Number,
  }),
  errors: MINT_ERRORS,
  reads: [],
  writes: [],
  drives: [],
  invokes: [procedure_parties_resolve_recipient_in_tx],
  emits: [],
  calls: [...MINT_CALLS, ...KEYED_MINT_CALLS],
  chain: MINT_CHAIN,
  spans: [],
});
