// The as-is book of the old operator concept: the fixtures area, the local devnet's browser fixtures.
//
// Every operation registered at `operator/fixtures:*` (packages/backend/convex/operator/fixtures.ts):
// internal functions packages/devnet runs with `convex run`. None is scheduled, so every one is an rpc.
//
// The fixtures own no rows. Each identity, the payout and the deposit are written by their owners'
// proof writes, booked as invokes of those concepts' procedures. The seed action also runs two of
// Applications' internal mutations (registrations.register, keys.issue); an rpc has no link to
// another rpc, so those are named in `about` and their tables are not folded into this concept's
// touches. Operator's own internal rpcs it runs (seed-prerequisites, seed-native-readiness,
// faucets.mint-to) are folded in.

import { Schema } from "effect";
import { defineRpc } from "../../../packages/book/src/index.ts";

import { concept_operator } from "../shared/foundation.ts";
import {
  contract_entry_point,
  contract_erc20,
  contract_safe_4337_module,
  contract_test_money_token,
  integration_chain_rpc,
} from "../shared/external.ts";
import {
  error_ENV_MISSING,
  error_INVALID_INPUT,
  error_NOT_AUTHENTICATED,
  error_PROVIDER_ERROR,
  error_PROVIDER_RESPONSE_INVALID,
  error_TRANSACTION_FAILED,
  error_UNKNOWN,
  error_WRONG_STATE,
} from "../shared/vocabulary.ts";
import { procedure_access_ensure_proof_auth_user_in_tx } from "../access/procedures.ts";
import {
  procedure_accounts_account_id_for_auth_user_or_null,
  procedure_accounts_ensure_proof_personal_account_in_tx,
} from "../accounts/procedures.ts";
import { procedure_banking_ensure_proof_payout_in_tx, procedure_banking_seed_devnet_deposit } from "../banking/procedures.ts";
import { procedure_parties_claim_person_party } from "../parties/procedures.ts";
import { procedure_payments_ensure_proof_payout_payment_in_tx } from "../payments/procedures.ts";
import { procedure_profiles_ensure_proof_profile_in_tx } from "../profiles/procedures.ts";

const BACKEND = "packages/backend";
const SRC = `${BACKEND}/src`;
const CONVEX = `${BACKEND}/convex/operator/fixtures.ts`;
const FX = `${SRC}/operator/fixtures`;
const OPS = `${FX}/operations`;

const WHO = "internal: packages/devnet with `convex run` (the devnet seed, `capxul-devnet bridge seed`, `capxul-devnet seed deposit`).";

/** ensureJourneyIdentity (fixtures/writes.ts:47) and ensureNativeReadyIdentity (:111): each owner's proof write. */
const IDENTITY_INVOKES = [
  procedure_access_ensure_proof_auth_user_in_tx,
  procedure_profiles_ensure_proof_profile_in_tx,
  procedure_parties_claim_person_party,
  procedure_accounts_ensure_proof_personal_account_in_tx,
];
const IDENTITY_WAS = [
  `${FX}/writes.ts:47`,
  `${FX}/writes.ts:111`,
  `${FX}/rules.ts:12`,
  `${FX}/rules.ts:19`,
  `${FX}/rules.ts:77`,
  `${SRC}/access/sessions/writes.ts:45`,
  `${SRC}/profiles/writes.ts:38`,
  `${SRC}/parties/writes/parties.ts:159`,
  `${SRC}/accounts/writes.ts:149`,
];

export const rpc_operator_fixtures_seed = defineRpc({
  id: "operator.fixtures.seed",
  title: "Seed the local devnet's browser fixture",
  about:
    "The internal action `operator/fixtures:seed`, run by packages/devnet. It has no environment gate of its own: its " +
    "gate is the admin key `convex run` needs. It registers the application `Capxul local devnet` with the given " +
    "origin, backend URLs and vendor keys (Applications' internal applications.registrations.register), issues its " +
    "fixed test key `cap_pk_test_0123456789ABCDEFGHJKMNPQRSTVWXYZ`, written in the code (applications.keys.issue; a " +
    "repeat returns the same key), seeds the reserved identities (seed-prerequisites, then seed-native-readiness, each " +
    "its own transaction), reads the owner Safe's test USDC balance on chain and, only when it is zero, mints 10,000 " +
    "test USDC to it through operator.faucets.mint-to, waiting for inclusion. Every step is idempotent; a failed mint " +
    "stays retryable; `fundOwner` admits no INSUFFICIENT_BALANCE or ROLE_PERMISSION_DENIED, so a mint failing with " +
    "either is UNKNOWN. Answers the application id, key id, the raw key and whether it funded.",
  was: [
    `${CONVEX}:4`,
    `${OPS}/seed.ts:36`,
    `${OPS}/seed.ts:58`,
    `${OPS}/seed.ts:59`,
    `${OPS}/seed.ts:60`,
    `${OPS}/seed.ts:62`,
    `${FX}/writes.ts:137`,
    `${FX}/writes.ts:150`,
    `${FX}/writes.ts:165`,
    `${FX}/external.ts:16`,
    `${FX}/external.ts:30`,
    `${FX}/rules.ts:9`,
    `${FX}/rules.ts:27`,
    `${FX}/rules.ts:80`,
    ...IDENTITY_WAS,
  ],
  concept: concept_operator,
  kind: "action",
  who: WHO,
  input: Schema.Struct({
    origin: Schema.String,
    backendApiUrl: Schema.String,
    backendSiteUrl: Schema.String,
    openfortPublishableKey: Schema.String,
    shieldPublishableKey: Schema.String,
  }),
  output: Schema.Struct({
    applicationId: Schema.String,
    keyId: Schema.String,
    publishableKey: Schema.String,
    funded: Schema.Boolean,
  }),
  errors: [
    error_INVALID_INPUT,
    error_WRONG_STATE,
    error_PROVIDER_ERROR,
    error_PROVIDER_RESPONSE_INVALID,
    error_ENV_MISSING,
    error_TRANSACTION_FAILED,
    error_UNKNOWN,
  ],
  reads: [],
  writes: [],
  drives: [],
  invokes: IDENTITY_INVOKES,
  emits: [],
  calls: [
    integration_chain_rpc.c.fetchErc20Balance,
    integration_chain_rpc.c.fetchAddressCode,
    integration_chain_rpc.c.fetchEntryPointNonce,
    integration_chain_rpc.c.fetchUserOperationFees,
    integration_chain_rpc.c.sponsorUserOperation,
    integration_chain_rpc.c.sendUserOperation,
    integration_chain_rpc.c.waitForUserOperationReceipt,
  ],
  chain: [
    contract_erc20.f.balanceOf,
    contract_test_money_token.f.mint,
    contract_safe_4337_module.f.executeUserOpWithErrorString,
    contract_entry_point.f.getNonce,
  ],
  spans: [],
});

export const rpc_operator_fixtures_seed_prerequisites = defineRpc({
  id: "operator.fixtures.seed-prerequisites",
  title: "Ensure the money journeys' owner and recipient",
  about:
    "The internal mutation `operator/fixtures:seedPrerequisites`, one transaction. Ensures `devnet-owner@e2e.capxul.test` " +
    "(`Devnet Director`) and `devnet-recipient@e2e.capxul.test` (`Devnet Recipient`), deliberately half set up: an auth " +
    "user, a Profile with no country, and an undeployed, unclaimed personal Account Safe derived from the email. The " +
    "recipient's Party is also claimed with the handle `devnetrecipient`, so a request to its email reaches its inbox. " +
    "No environment gate. Every owner call is admitted with no codes. Answers both Safe addresses.",
  was: [`${CONVEX}:7`, `${OPS}/seed-prerequisites.ts:14`, `${OPS}/seed-prerequisites.ts:21`, `${FX}/rules.ts:16`, ...IDENTITY_WAS],
  concept: concept_operator,
  kind: "mutation",
  who: "internal: run by operator.fixtures.seed (`seedIdentities`, fixtures/writes.ts:165).",
  input: Schema.Struct({}),
  output: Schema.Struct({ ownerSafeAddress: Schema.String, recipientSafeAddress: Schema.String }),
  errors: [error_UNKNOWN],
  reads: [],
  writes: [],
  drives: [],
  invokes: IDENTITY_INVOKES,
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_operator_fixtures_seed_native_readiness = defineRpc({
  id: "operator.fixtures.seed-native-readiness",
  title: "Ensure the grant-ready native identity",
  about:
    "The internal mutation `operator/fixtures:seedNativeReadiness` (AUTH A2), one transaction. Ensures " +
    "`devnet-native@e2e.capxul.test`: an auth user, a complete Profile (country US, native-ready), a Party claimed with " +
    "the handle `devnetnative` and a claimed personal Account Safe. No environment gate. Answers the email and Safe.",
  was: [`${CONVEX}:6`, `${OPS}/seed-native-readiness.ts:8`, `${FX}/rules.ts:19`, ...IDENTITY_WAS],
  concept: concept_operator,
  kind: "mutation",
  who: "internal: run by operator.fixtures.seed (`seedIdentities`, fixtures/writes.ts:171).",
  input: Schema.Struct({}),
  output: Schema.Struct({ email: Schema.String, safeAddress: Schema.String }),
  errors: [error_UNKNOWN],
  reads: [],
  writes: [],
  drives: [],
  invokes: IDENTITY_INVOKES,
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_operator_fixtures_seed_bridge_payout = defineRpc({
  id: "operator.fixtures.seed-bridge-payout",
  title: "Write the devnet owner's bound, funded Bridge payout",
  about:
    "The internal mutation `operator/fixtures:seedBridgePayout` (CAP-670). Local devnet only, before anything is read " +
    "(INVALID_INPUT `environment`). In one transaction: the owner identity as the seed leaves it, its Account (none is " +
    "a defect), then Payments' funded `in_transit` Payout of 3 test USDC with no chain evidence behind it and Banking's " +
    "quote and journal row for 2.38 GBP over faster_payments, each written once. Its Bridge transfer, customer and " +
    "account ids are fixed UUIDs written in the code, and no Bridge object stands behind them; the owner Party id names " +
    "no row. A second run changes nothing. Answers every reference a signed Bridge update for the transfer repeats.",
  was: [
    `${CONVEX}:5`,
    `${OPS}/seed-bridge-payout.ts:15`,
    `${OPS}/seed-bridge-payout.ts:22`,
    `${FX}/guards.ts:12`,
    `${FX}/errors.ts:6`,
    `${FX}/writes.ts:73`,
    `${FX}/writes.ts:76`,
    `${FX}/writes.ts:86`,
    `${FX}/writes.ts:98`,
    `${FX}/rules.ts:36`,
    `${FX}/rules.ts:61`,
    `${SRC}/accounts/reads/identity.ts:136`,
    `${SRC}/banking/payouts/writes/proofs.ts:42`,
    ...IDENTITY_WAS,
  ],
  concept: concept_operator,
  kind: "mutation",
  who: WHO,
  input: Schema.Struct({}),
  output: Schema.Struct({
    paymentId: Schema.String,
    transferId: Schema.String,
    clientReferenceId: Schema.String,
    onBehalfOf: Schema.String,
    externalAccountId: Schema.String,
    sourceSafe: Schema.String,
    sourceCurrency: Schema.String,
    fundingAddress: Schema.String,
    funding: Schema.String,
    destinationCurrency: Schema.String,
    destinationRail: Schema.String,
    output: Schema.String,
  }),
  errors: [error_INVALID_INPUT, error_UNKNOWN],
  reads: [],
  writes: [],
  drives: [],
  invokes: [
    ...IDENTITY_INVOKES,
    procedure_accounts_account_id_for_auth_user_or_null,
    procedure_payments_ensure_proof_payout_payment_in_tx,
    procedure_banking_ensure_proof_payout_in_tx,
  ],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_operator_fixtures_seed_deposit = defineRpc({
  id: "operator.fixtures.seed-deposit",
  title: "Write one delivered devnet bank deposit for a person",
  about:
    "The internal mutation `operator/fixtures:seedDeposit` (CAP-788). It hands the whole call to Banking's devnet seed: " +
    "unless this devnet's fault switch names a deposit fault it refuses NOT_AUTHENTICATED; a person with no person Party " +
    "is INVALID_INPUT; otherwise Banking writes one delivered 100 USD wire deposit (99 net) for the Party's Safe and " +
    "schedules its credit. Operator adds nothing but the registration.",
  was: [`${CONVEX}:8`, `${OPS}/seed-deposit.ts:15`, `${OPS}/seed-deposit.ts:21`, `${SRC}/banking/deposits/writes/devnet.ts:35`, `${SRC}/banking/deposits/errors.ts:26`],
  concept: concept_operator,
  kind: "mutation",
  who: WHO,
  input: Schema.Struct({ authUserId: Schema.String }),
  output: Schema.Struct({ bankDepositId: Schema.String, depositRef: Schema.String, assetId: Schema.String }),
  errors: [error_NOT_AUTHENTICATED, error_INVALID_INPUT, error_UNKNOWN],
  reads: [],
  writes: [],
  drives: [],
  invokes: [procedure_banking_seed_devnet_deposit],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

