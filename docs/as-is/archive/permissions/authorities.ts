// The as-is book of the old permissions/authorities area: every operation in
// packages/backend/src/permissions/authorities/operations/, registered at
// `permissions/authorities:<name>` (packages/backend/convex/permissions/authorities.ts).
//
// list, authorize and budgetLeft implement the public rows of
// packages/protocol/src/permissions/operations.ts (`authorities`); loadBudgetLeft is the internal
// query budgetLeft runs through ctx.runQuery. The concept-level guards, reads and rules they run
// (authorities/guards.ts, authorities/reads.ts, authorities/rules.ts, guards/spending.ts) are steps,
// booked through these rpcs.

import { Schema } from "effect";
import { defineRpc } from "../../../packages/book/src/index.ts";

import { concept_permissions } from "../shared/foundation.ts";
import {
  error_ACCOUNT_NOT_FOUND,
  error_ENV_MISSING,
  error_INVALID_INPUT,
  error_NOT_AUTHENTICATED,
  error_PROVIDER_ERROR,
  error_PROVIDER_RESPONSE_INVALID,
  error_ROLE_PERMISSION_DENIED,
  error_SMART_ACCOUNT_MISSING,
  error_UNKNOWN,
  error_WRONG_STATE,
} from "../shared/vocabulary.ts";
import { contract_budgets, contract_roles, integration_chain_rpc } from "../shared/external.ts";
import {
  machine_permission_allowance,
  table_permission_allowances,
  table_permission_assignments,
  table_permissions,
} from "./data.ts";
import { procedure_permissions_require_organization_spend_authority_in_tx } from "./procedures.ts";
import {
  procedure_organizations_read_subject_proposal_in_tx,
  procedure_organizations_read_treasury_target,
  procedure_organizations_require_org_participant,
  procedure_organizations_settle_organization_proposals,
} from "../organizations/procedures.ts";
import {
  procedure_accounts_read_attached_account_for_safe_in_tx,
  procedure_accounts_read_exact_target_account_in_tx,
  procedure_accounts_require_exact_account_identity_in_tx,
} from "../accounts/procedures.ts";
import { table_org_lifecycles } from "../organizations/data.ts";

const A = "packages/backend/src/permissions/authorities";
const ROW = "packages/protocol/src/permissions/operations.ts";
const CONVEX = "packages/backend/convex/permissions/authorities.ts";

const S = Schema.String;
const N = Schema.Number;
const opt = Schema.optionalKey;
const NullOr = Schema.NullOr;

// ── shapes ──────────────────────────────────────────────────────────────────────────────────

/** `AssetAmountSchema` (protocol money/schema): an asset id and a decimal string. */
const AssetAmount = Schema.Struct({ asset: S, value: S });

/** `ActorRefSchema` (protocol access/actor-schema.ts:16). */
const ActorRef = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("account"), accountId: S }),
  Schema.Struct({ kind: Schema.Literal("organization"), orgId: S }),
]);

const State = Schema.Literals(["pending", "active", "suspended", "revoked", "superseded"]);

/** `PermissionSchema` (protocol permissions/permission-schema.ts:120). `currentPolicy` is a deep union: Unknown. */
const Permission = Schema.Struct({
  permissionId: S,
  orgId: S,
  type: Schema.Literals(["budget", "managePeople"]),
  state: State,
  revision: N,
  roleKey: S,
  currentPolicy: opt(Schema.Unknown),
  assetId: opt(S),
  tokenAddress: opt(S),
  decimals: opt(N),
  limitRaw: opt(S),
  allowanceKey: opt(S),
});

/** `PermissionAssignmentSchema` (permission-schema.ts:149). */
const Assignment = Schema.Struct({ permissionAssignmentId: S, permissionId: S, actor: ActorRef, state: State });

/** `BudgetNextRefillSchema` (permission-schema.ts:141). */
const NextRefill = Schema.Struct({ amount: AssetAmount, everyDays: N, nextAt: N });

// ── rpc: list ───────────────────────────────────────────────────────────────────────────────

export const rpc_permissions_authorities_list = defineRpc({
  id: "permissions.authorities.list",
  title: "List an Organization's Permissions and their assignments",
  about:
    "requireParticipant (Organizations' requireOrgParticipant, ROLE_PERMISSION_DENIED for a non-participant) names the " +
    "Organization to telemetry; then every Permission row of the Organization (by_org_state, all states) is reduced to " +
    "one row per Permission by currentRevisions: the active revision, else the newest that is not superseded, else the " +
    "newest, in the order the Permissions were first created. Each is turned into its wire form (validatedWirePermission " +
    "re-resolves an allowlisted Budget's recipients through Accounts; a stored policy that does not decode is UNKNOWN). " +
    "Every assignment of those Permissions follows, oldest first; a Party row shows its attached Account, and one with no " +
    "Account yet is left out. One page (onePage): every Permission, nextCursor null.",
  was: [
    `${A}/operations/list.ts:11`,
    `${A}/guards.ts:25`,
    `${A}/reads.ts:14`,
    `${A}/reads.ts:22`,
    `${A}/rules.ts:21`,
    "packages/backend/src/permissions/views/permissions.ts:144",
    "packages/backend/src/permissions/views/permissions.ts:158",
    `${ROW}:166`,
    `${CONVEX}:6`,
  ],
  concept: concept_permissions,
  kind: "query",
  who: "A signed-in person who takes part in the Organization (requireOrgParticipant).",
  input: Schema.Struct({ orgId: S }),
  output: Schema.Struct({ items: Schema.Array(Permission), nextCursor: NullOr(S), assignments: Schema.Array(Assignment) }),
  errors: [error_NOT_AUTHENTICATED, error_INVALID_INPUT, error_WRONG_STATE, error_ROLE_PERMISSION_DENIED, error_UNKNOWN, error_ENV_MISSING],
  reads: [table_permissions, table_permission_assignments],
  writes: [],
  drives: [],
  invokes: [
    procedure_organizations_require_org_participant,
    procedure_accounts_read_attached_account_for_safe_in_tx,
    procedure_accounts_read_exact_target_account_in_tx,
  ],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

// ── rpc: authorize ──────────────────────────────────────────────────────────────────────────

export const rpc_permissions_authorities_authorize = defineRpc({
  id: "permissions.authorities.authorize",
  title: "Whether the caller's Account may spend this amount from this Budget now",
  about:
    "authorizeMoneyInTx: the request's actor must be an Account and the caller's own exact Account (ROLE_PERMISSION_DENIED, " +
    "membership, otherwise); rawAmount must parse as an integer (INVALID_INPUT); then the row form of " +
    "requireOrganizationSpendAuthorityInTx: a usable bootstrap, the one active spendable Budget, the payment's token, the " +
    "stored cap and the caller's single active assignment. It answers the wire Permission (re-validated, recipients " +
    "re-resolved) and an active account assignment, and names the Organization to telemetry. MANAGER_REFUSALS are " +
    "admitted; anything else (a stored cap that is not an integer: UNKNOWN) is a defect.",
  was: [
    `${A}/operations/authorize.ts:9`,
    `${A}/guards.ts:35`,
    `${A}/guards.ts:45`,
    "packages/backend/src/permissions/guards/spending.ts:169",
    `${ROW}:193`,
    `${CONVEX}:3`,
  ],
  concept: concept_permissions,
  kind: "query",
  who: "A signed-in person asking for their own Account, which must be assigned to the Budget.",
  input: Schema.Struct({ orgId: S, actor: ActorRef, permissionId: S, tokenAddress: S, rawAmount: S }),
  output: Schema.Struct({ permission: Permission, assignment: Assignment }),
  errors: [
    error_NOT_AUTHENTICATED,
    error_INVALID_INPUT,
    error_ROLE_PERMISSION_DENIED,
    error_SMART_ACCOUNT_MISSING,
    error_ACCOUNT_NOT_FOUND,
    error_UNKNOWN,
    error_ENV_MISSING,
  ],
  reads: [table_org_lifecycles, table_permissions, table_permission_assignments],
  writes: [],
  drives: [],
  invokes: [
    procedure_accounts_require_exact_account_identity_in_tx,
    procedure_permissions_require_organization_spend_authority_in_tx,
    procedure_accounts_read_exact_target_account_in_tx,
  ],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

// ── rpc: load-budget-left ───────────────────────────────────────────────────────────────────

export const rpc_permissions_authorities_load_budget_left = defineRpc({
  id: "permissions.authorities.load-budget-left",
  title: "Load the Budget a Budget-left read names",
  about:
    "readSpendableBudgetInTx: the one active spendable Budget with this id and its Roles allowance (null for an unlimited " +
    "Budget), answered as kind `roles`; else readAllowanceBudgetInTx: a v4 allowance of the Organization that is not " +
    "abandoned, with its create proposal's status (awaiting_approvals when none), answered as kind `budgets`; else null.",
  was: [
    `${A}/operations/load-budget-left.ts:16`,
    "packages/backend/src/permissions/guards/spending.ts:238",
    "packages/backend/src/permissions/allowances/reads/left.ts:11",
    `${CONVEX}:5`,
  ],
  concept: concept_permissions,
  kind: "query",
  who: "internal: the budgetLeft action (permissions.authorities.budget-left), through ctx.runQuery, once or twice.",
  input: Schema.Struct({ orgId: S, budgetId: S }),
  output: NullOr(
    Schema.Union([
      Schema.Struct({
        kind: Schema.Literal("roles"),
        assetId: S,
        decimals: N,
        allowance: NullOr(Schema.Struct({ rolesModule: S, allowanceKey: S, assetId: S, decimals: N })),
      }),
      Schema.Struct({ kind: Schema.Literal("budgets"), row: Schema.Unknown, proposalStatus: S }),
    ]),
  ),
  errors: [],
  reads: [table_permissions, table_permission_allowances],
  writes: [],
  drives: [],
  invokes: [procedure_organizations_read_subject_proposal_in_tx],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

// ── rpc: budget-left ────────────────────────────────────────────────────────────────────────

export const rpc_permissions_authorities_budget_left = defineRpc({
  id: "permissions.authorities.budget-left",
  title: "What one active Budget can still spend now",
  about:
    "Signed in; Organizations' readTreasuryTarget proves the caller a participant and gives the chain. loadBudgetLeft " +
    "names the Budget; none is INVALID_INPUT (activeBudgetMissing). A Roles Budget with no allowance answers left null and " +
    "refill null. A capped one reads the Roles allowance on chain through payments' budgetAllowanceNow (an action helper, " +
    "eth_call allowances(key) at latest) and answers budgetAllowanceView's left and refill. A v4 allowance that is active " +
    "reads Budgets.budgetOf, Budgets.leftOf and the latest block's time and answers its left and its refill (amount, " +
    "period days, next roll). A v4 allowance still pending first settles the Organization's proposals, re-runs " +
    "loadBudgetLeft and settles the allowance from its proposal (runs permissions.allowances.settle, reading the company's " +
    "budgets on chain to find the new budget id); anything but an active result is INVALID_INPUT. Budgets.budgetOf and " +
    "the Hats reads are not booked on the shared contracts. Every chain read is admitted as PROVIDER_ERROR or ENV_MISSING.",
  was: [
    `${A}/operations/budget-left.ts:63`,
    `${A}/operations/budget-left.ts:30`,
    `${A}/errors.ts:7`,
    "packages/backend/src/permissions/allowances/external.ts:114",
    "packages/backend/src/permissions/allowances/external.ts:118",
    "packages/backend/src/permissions/allowances/external.ts:132",
    "packages/backend/src/permissions/allowances/rules/settlement.ts:42",
    "packages/backend/src/payments/commands/external/funding.ts:72",
    `${ROW}:182`,
    `${CONVEX}:4`,
  ],
  concept: concept_permissions,
  kind: "action",
  who: "A signed-in participant of the Organization, as they read the treasury (readTreasuryTarget).",
  input: Schema.Struct({ orgId: S, budgetId: S }),
  output: Schema.Struct({ budgetId: S, left: NullOr(AssetAmount), refill: opt(NullOr(NextRefill)) }),
  errors: [
    error_NOT_AUTHENTICATED,
    error_INVALID_INPUT,
    error_ROLE_PERMISSION_DENIED,
    error_PROVIDER_ERROR,
    error_PROVIDER_RESPONSE_INVALID,
    error_UNKNOWN,
    error_ENV_MISSING,
  ],
  reads: [table_permissions, table_permission_allowances],
  writes: [table_permission_allowances],
  drives: [machine_permission_allowance.t.to_active, machine_permission_allowance.t.to_abandoned],
  invokes: [
    procedure_organizations_read_treasury_target,
    procedure_organizations_settle_organization_proposals,
    procedure_organizations_read_subject_proposal_in_tx,
  ],
  emits: [],
  calls: [integration_chain_rpc.c.fetchEthCall, integration_chain_rpc.c.fetchLatestBlock],
  chain: [contract_roles.f.allowances, contract_budgets.f.leftOf],
  spans: [],
});
