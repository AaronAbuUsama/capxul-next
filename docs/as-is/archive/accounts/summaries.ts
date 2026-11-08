// The as-is book of the old accounts concept: the summaries area (the signed-in person at a
// glance).
//
// Every operation registered at `accounts/summaries:*` (packages/backend/convex/accounts/summaries.ts).
// Three public rows of `summaries` (packages/protocol/src/accounts/operations.ts:243) and one
// internal query the home action runs through ctx.runQuery. Nothing is scheduled.
//
// The home action also runs other concepts' operations as the caller: Organizations'
// `organizations.treasuries.load` (an internal query: the participant check and the
// Organization's Safe), and the public rows `payroll.runs.list` and `activity.items.list`
// through `readAs`. An rpc cannot link another rpc, so those are named in its about and their
// tables are not folded in. Paths in `was` are relative to the old repository root.

import { Schema } from "effect";
import { defineRpc, type CallRef } from "../../../packages/book/src/index.ts";

import { concept_accounts } from "../shared/foundation.ts";
import { contract_erc20, contract_roles, integration_chain_rpc } from "../shared/external.ts";
import {
  error_ENV_MISSING,
  error_INVALID_INPUT,
  error_NOT_AUTHENTICATED,
  error_ROLE_PERMISSION_DENIED,
  error_UNKNOWN,
} from "../shared/vocabulary.ts";
import {
  procedure_access_authenticated_user,
  procedure_access_require_authenticated_user,
} from "../access/procedures.ts";
import { procedure_organizations_require_org_participant } from "../organizations/procedures.ts";
import { procedure_payments_read_payment_ids_to_retry_in_tx } from "../payments/procedures.ts";
import {
  procedure_permissions_list_spend_authorities,
  procedure_permissions_read_budget_allowance_in_tx,
} from "../permissions/procedures.ts";
import { procedure_profiles_read_profile_display_name_in_tx } from "../profiles/procedures.ts";
import { procedure_requests_list_request_ids_to_pay_in_tx } from "../requests/procedures.ts";
import { AssetPosition } from "./balances.ts";
import { table_accounts, table_smart_accounts } from "./data.ts";
import { procedure_accounts_account_id_for_auth_user_or_null, procedure_accounts_read_positions } from "./procedures.ts";

const BACKEND = "packages/backend";
const CONVEX = `${BACKEND}/convex/accounts/summaries.ts`;
const A = `${BACKEND}/src/accounts`;
const SUM = `${A}/summaries`;
const OPS = `${SUM}/operations`;
const ROWS = "packages/protocol/src/accounts/operations.ts";

const rpcCall = (name: string): CallRef =>
  (integration_chain_rpc.c as Record<string, CallRef | undefined>)[name] ?? {
    _kind: "call",
    id: `chain-rpc.${name}`,
    integration: "chain-rpc",
    name,
  };

const noChain = { calls: [], chain: [], spans: [] } as const;

/** `HomeSchema` (operations.ts:221): a section whose read failed is null, never empty. */
const Home = Schema.Struct({
  email: Schema.String,
  actingAs: Schema.Union([
    Schema.Struct({ kind: Schema.Literal("personal") }),
    Schema.Struct({ kind: Schema.Literal("organization"), orgId: Schema.String }),
  ]),
  balances: Schema.NullOr(Schema.Array(AssetPosition)),
  needsYou: Schema.NullOr(
    Schema.Struct({
      requestsToPay: Schema.Array(Schema.String),
      payrollToApprove: Schema.Array(Schema.String),
      paymentsToRetry: Schema.Array(Schema.String),
      budgetsUsedUp: Schema.Array(Schema.String),
    }),
  ),
  /** `ActivityItemSchema` rows (protocol activity/schema): the activity concept's shape, too deep to transcribe. */
  recentActivity: Schema.NullOr(Schema.Array(Schema.Unknown)),
});

const NEEDS_YOU_INVOKES = [
  procedure_organizations_require_org_participant,
  procedure_accounts_account_id_for_auth_user_or_null,
  procedure_requests_list_request_ids_to_pay_in_tx,
  procedure_payments_read_payment_ids_to_retry_in_tx,
  procedure_permissions_list_spend_authorities,
  procedure_permissions_read_budget_allowance_in_tx,
];

// ── public ──────────────────────────────────────────────────────────────────────────────────

export const rpc_accounts_summaries_home = defineRpc({
  id: "accounts.summaries.home",
  title: "The home screen in one round trip",
  about:
    "Public action. With an orgId, Organizations' `organizations.treasuries.load` must admit the caller as a participant " +
    "(ROLE_PERMISSION_DENIED) and names the Organization's chain and Safe; the input chainId is then ignored. Three sections " +
    "are read together, each settled on its own: balances (the person's binding via accounts.balances.readBinding and their " +
    "Safe's positions, or the treasury Safe's positions, `readPositions`, with no per-asset account_balance_read); needs you " +
    "(`accounts.summaries.loadNeedsYou`, the Organization's draft runs from `payroll.runs.list` with a permission refusal " +
    "read as none, and the caller's capped Budgets whose Roles allowance leaves 0 now, read on chain); recent activity " +
    "(the newest 5 rows of `activity.items.list`, as the person or the Organization). A section that fails is null and " +
    "its code (and a defect's own words) goes on the wide event (`unavailable_sections`). Requests to pay are the stored " +
    "inbox: a request just paid through its link can still count. The email is normalized. The sections' chain failures " +
    "(PROVIDER_ERROR) are absorbed into null sections and never reach the caller.",
  was: [
    `${CONVEX}:4`,
    `${OPS}/home.ts:32`,
    `${SUM}/reads.ts:63`,
    `${SUM}/reads.ts:161`,
    `${SUM}/reads.ts:147`,
    `${SUM}/reads.ts:186`,
    `${SUM}/external.ts:17`,
    `${SUM}/rules.ts:25`,
    `${SUM}/rules.ts:42`,
    `${BACKEND}/src/organizations/treasuries/reads.ts:40`,
    `${BACKEND}/src/payments/commands/external/funding.ts:90`,
    `${ROWS}:248`,
  ],
  concept: concept_accounts,
  kind: "action",
  who: "A signed-in person, for themselves or for an Organization they take part in now.",
  input: Schema.Struct({ chainId: Schema.Number, orgId: Schema.optionalKey(Schema.String) }),
  output: Home,
  errors: [error_NOT_AUTHENTICATED, error_INVALID_INPUT, error_UNKNOWN, error_ENV_MISSING, error_ROLE_PERMISSION_DENIED],
  reads: [table_smart_accounts, table_accounts],
  writes: [],
  drives: [],
  invokes: [procedure_access_require_authenticated_user, procedure_accounts_read_positions, ...NEEDS_YOU_INVOKES],
  emits: [],
  calls: [rpcCall("fetchErc20Balance"), rpcCall("fetchLatestBlock"), rpcCall("fetchEthCall")],
  chain: [contract_erc20.f.balanceOf, contract_roles.f.allowances],
  spans: ["chain.read eth_call", "chain.read eth_getBlockByNumber"],
});

export const rpc_accounts_summaries_me = defineRpc({
  id: "accounts.summaries.me",
  title: "The signed-in person: id, email and Profile display name",
  about:
    "Public query. The session's authUserId, its email normalized for binding, and the Profile display name (Profiles' " +
    "`readProfileDisplayNameInTx`), or null.",
  was: [`${CONVEX}:6`, `${OPS}/me.ts:10`, `${SUM}/reads.ts:28`, `${ROWS}:258`],
  concept: concept_accounts,
  kind: "query",
  who: "A signed-in person, about themselves.",
  input: Schema.Struct({}),
  output: Schema.Struct({ authUserId: Schema.String, email: Schema.String, displayName: Schema.NullOr(Schema.String) }),
  errors: [error_NOT_AUTHENTICATED, error_INVALID_INPUT, error_UNKNOWN, error_ENV_MISSING],
  reads: [],
  writes: [],
  drives: [],
  invokes: [procedure_access_authenticated_user, procedure_profiles_read_profile_display_name_in_tx],
  emits: [],
  ...noChain,
});

export const rpc_accounts_summaries_deposit_instructions = defineRpc({
  id: "accounts.summaries.deposit-instructions",
  title: "Where money reaches the signed-in person's Safe",
  about:
    "Public query. The person's first Safe row on any chain, or before any row exists the Safe the normalized email " +
    "derives, on Base Sepolia, lowercased. The answer is always labelled `Capxul personal Safe`, network `base-sepolia` and " +
    "currency `USD`, even when the row's chain is another.",
  was: [`${CONVEX}:3`, `${OPS}/deposit-instructions.ts:10`, `${SUM}/reads.ts:39`, `${SUM}/views.ts:4`, `${ROWS}:269`],
  concept: concept_accounts,
  kind: "query",
  who: "A signed-in person, about their own Safe.",
  input: Schema.Struct({}),
  output: Schema.Struct({
    accountKind: Schema.Literal("personalSafe"),
    chainId: Schema.Number,
    network: Schema.Literal("base-sepolia"),
    currency: Schema.Literal("USD"),
    address: Schema.String,
    label: Schema.String,
  }),
  errors: [error_NOT_AUTHENTICATED, error_INVALID_INPUT, error_UNKNOWN, error_ENV_MISSING],
  reads: [table_smart_accounts],
  writes: [],
  drives: [],
  invokes: [procedure_access_authenticated_user],
  emits: [],
  ...noChain,
});

// ── internal ────────────────────────────────────────────────────────────────────────────────

export const rpc_accounts_summaries_load_needs_you = defineRpc({
  id: "accounts.summaries.load-needs-you",
  title: "Read what waits on the caller, by index",
  about:
    "Internal query, recorded as signed in as the given person. With an orgId the person must take part in it now " +
    "(Organizations' `requireOrgParticipant`, ROLE_PERMISSION_DENIED). Then, together: the request ids waiting on the " +
    "person or the Organization to pay (Requests' `listRequestIdsToPayInTx`); the sender's Payment ids to retry " +
    "(Payments' `readPaymentIdsToRetryInTx`; a person without an Account has none); and, in an Organization, the caller's " +
    "Budgets that have a cap, each with the Roles allowance the action reads on chain (Permissions' " +
    "`listSpendAuthorities` and `readBudgetAllowanceInTx`).",
  was: [`${CONVEX}:5`, `${OPS}/load-needs-you.ts:14`, `${SUM}/reads.ts:101`, `${SUM}/reads.ts:78`],
  concept: concept_accounts,
  kind: "query",
  who: "internal: run through ctx.runQuery by accounts.summaries.home (`readNeedsYou`).",
  input: Schema.Struct({ authUserId: Schema.String, orgId: Schema.optionalKey(Schema.String) }),
  output: Schema.Struct({
    requestsToPay: Schema.Array(Schema.String),
    paymentsToRetry: Schema.Array(Schema.String),
    cappedBudgets: Schema.Array(Schema.Struct({ budgetId: Schema.String, allowance: Schema.Unknown })),
  }),
  errors: [error_ROLE_PERMISSION_DENIED],
  reads: [table_accounts],
  writes: [],
  drives: [],
  invokes: NEEDS_YOU_INVOKES,
  emits: [],
  ...noChain,
});
