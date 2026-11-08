// The old book's Departments area, as it is: one operation record for each operation that
// apps/docs/factory/areas/departments.yaml lists (12), read from /home/user/factory (branch
// integration/factory). The text (title, about, who, changes, notes, mistakes, acceptance and each
// refusal's `when`) is the frozen book's, spread from ../../frozen, never retyped.
//
// implementedBy: each CLI command (apps/cli/src/commands/org/subcommands/department/) resolves the
// Organization (proposal/internal/scope.ts:15) and calls one method of `client.org(orgId).departments`
// (packages/sdk/src/payroll/departments.ts). Every write is a flow: `propose` (departments.ts:84) calls
// the department row, checks the proposed batch against the caller's own input locally, then calls
// organizations.proposals.requestApproval (:108). `pay` is a flow too: `withDepartmentPay`
// (department-pay.ts:29) reads the department and calls `client.approvals.prepare`. The two reads
// (`get`, `list`) forward one row each, so they are implemented by that rpc. Flows are named by the SDK
// method path in ../payroll/flows.ts; rpcs by their payroll.departments row in ../payroll/departments.ts.
//
// The CLI wraps every write in `proposeDepartmentWrite` (internal/write.ts:44): it reads the Directors
// (`directors.get`, :70), often reads the department or the departments first (`before`), calls the
// write (:73), then hands the approval to the browser and follows it and the proposal to the chain
// (`approveInBrowser`, proposal/internal/approval.ts:98: `approvals.wait`, `proposals.wait`).
//
// returns: a Struct of the page's `returns` fields, typed from the row's output schema
// (packages/protocol/src/payroll/department-schema.ts, organizations/proposal-schema.ts). `status` and
// `approvalId` are the CLI's approval hand-over (`awaiting_approval` with `--no-wait`, else the landed
// proposal's status, approval.ts:151, :200): Schema.Unknown, as ../payments/operations.ts books them.
//
// errors: what the CLI command produces itself. Every command goes through the Organization scope,
// which refuses with CLI_USAGE (auth/actor.ts:28, allowance/internal/scope.ts:16, :20,
// proposal/internal/scope.ts:31) and ROLE_PERMISSION_DENIED (an Organization not in your list,
// scope.ts:41 → org/internal/lifecycle.ts:17). Following an approval the CLI refuses CANCELLED (rejected),
// WRONG_STATE (expired), CLI_DEADLINE (still waiting) and TRANSACTION_FAILED itself
// (payment/internal/approval.ts:100, :109, :118, :140), and a proposal that changed before the approval
// was sent with WRONG_STATE (proposal/internal/approval.ts:59). The session restore's NOT_AUTHENTICATED
// (auth/first-party.ts:173) is shared by every signed-in command and left out.
//
// A refusal's `given` names a saved devnet world (packages/scenarios) in which a scenario step's command
// reaches the refusal; `?` where none does. No budget: nothing measured these commands. priority is
// `normal`: the old book has none.

import { Schema } from "effect";
import { defineOperation, type Ref } from "../../../packages/book/src/index.ts";
import { frozenClaims, frozenRefusals, frozenText, type FrozenId } from "../../frozen/index.ts";
import {
  error_AMOUNT_BELOW_USE,
  error_CANCELLED,
  error_CLI_DEADLINE,
  error_CLI_USAGE,
  error_FEATURE_NOT_AVAILABLE,
  error_INVALID_INPUT,
  error_PROVIDER_ERROR,
  error_ROLE_CONFLICT,
  error_ROLE_PERMISSION_DENIED,
  error_TOKEN_NOT_SUPPORTED,
  error_TRANSACTION_FAILED,
  error_WRONG_STATE,
} from "../shared/vocabulary.ts";
import { rpc_payroll_departments_get, rpc_payroll_departments_list } from "../payroll/departments.ts";
import {
  flow_client_org_departments_close,
  flow_client_org_departments_create,
  flow_client_org_departments_freeze_ceiling,
  flow_client_org_departments_holders_add,
  flow_client_org_departments_holders_remove,
  flow_client_org_departments_pay,
  flow_client_org_departments_reopen,
  flow_client_org_departments_set_amount,
  flow_client_org_departments_set_ceiling,
  flow_client_org_departments_unfreeze_ceiling,
} from "../payroll/flows.ts";

// ── how a page's refusals become records ─────────────────────────────────────────────────────

type Worlds = Readonly<Record<string, readonly [error: Ref<"error">, given: string]>>;

/** The page's refusals in its order, `when` verbatim; each code mapped to its error and world. */
const refusalsOf = (id: FrozenId, worlds: Worlds) =>
  frozenRefusals(id).map(({ code, when }) => {
    const mapped = worlds[code];
    if (mapped === undefined) throw new Error(`${id}: refusal ${code} has no error record`);
    return { error: mapped[0], given: mapped[1], when };
  });

const page = (id: FrozenId) => `apps/docs/factory/operations/${id}.yaml:1`;
const CLI = "apps/cli/src/commands/org/subcommands/department";
const SDK = "packages/sdk/src/payroll";
const ROWS = "packages/protocol/src/payroll";
const APPROVAL = "apps/cli/src/commands/payment/internal/approval.ts";
const PROPOSAL = "apps/cli/src/commands/org/subcommands/proposal/internal";

/** The Organization scope every department command resolves first, and the refusals it makes itself. */
const SCOPE_WAS = [
  `${PROPOSAL}/scope.ts:15`,
  `${PROPOSAL}/scope.ts:31`,
  `${PROPOSAL}/scope.ts:41`,
  "apps/cli/src/commands/org/internal/lifecycle.ts:17",
  "apps/cli/src/commands/org/subcommands/allowance/internal/scope.ts:16",
  "apps/cli/src/auth/input.ts:20",
];
const SCOPE_ERRORS = [error_CLI_USAGE, error_ROLE_PERMISSION_DENIED];

/** A department write: proposed, its approval handed to the browser and followed to the chain. */
const WRITE_WAS = [
  `${CLI}/internal/write.ts:44`,
  `${CLI}/internal/write.ts:70`,
  `${CLI}/internal/write.ts:77`,
  `${CLI}/internal/write.ts:86`,
  `${PROPOSAL}/approval.ts:98`,
  `${PROPOSAL}/approval.ts:59`,
  `${PROPOSAL}/approval.ts:151`,
  `${PROPOSAL}/approval.ts:200`,
  `${APPROVAL}:159`,
  `${SDK}/departments.ts:84`,
  `${SDK}/departments.ts:108`,
  ...SCOPE_WAS,
];
const WRITE_ERRORS = [...SCOPE_ERRORS, error_CANCELLED, error_WRONG_STATE, error_CLI_DEADLINE, error_TRANSACTION_FAILED];

// ── the row shapes ───────────────────────────────────────────────────────────────────────────

/** PayoutCeilingSchema (department-schema.ts:82). */
const PayoutCeiling = Schema.Struct({
  token: Schema.String,
  amount: Schema.String,
  per: Schema.Literal("year"),
  left: Schema.String,
  frozen: Schema.optional(Schema.Boolean),
});

/** DepartmentSchema (department-schema.ts:116), with DepartmentBudgetLineSchema (:100) and DepartmentHolderSchema (:71). */
const Department = Schema.Struct({
  departmentId: Schema.String,
  key: Schema.String,
  name: Schema.String,
  status: Schema.Literals(["proposed", "active"]),
  budgets: Schema.Array(
    Schema.Struct({
      token: Schema.String,
      status: Schema.Literals(["proposed", "active"]),
      budget: Schema.Struct({ amount: Schema.String, per: Schema.Literals(["year", "quarter", "month"]) }),
      committed: Schema.String,
      left: Schema.String,
      over: Schema.String,
      payoutCeiling: Schema.NullOr(PayoutCeiling),
    }),
  ),
  holders: Schema.Array(Schema.Struct({ address: Schema.String, label: Schema.String })),
  offers: Schema.Number,
  runningAgreements: Schema.Number,
  roleKey: Schema.String,
  chain: Schema.Struct({ department: Schema.String, role: Schema.String, budget: Schema.optional(Schema.String) }),
  closed: Schema.optional(Schema.Boolean),
});

/** SafeProposalSchema (organizations/proposal-schema.ts:29), with SafeProposalApprovalSchema (:24) and SAFE_PROPOSAL_STATUSES (organizations/model.ts:28). */
const SafeProposal = Schema.Struct({
  proposalId: Schema.String,
  orgId: Schema.String,
  chainId: Schema.Number,
  safeAddress: Schema.String,
  nonce: Schema.NullOr(Schema.Number),
  safeTxHash: Schema.String,
  kind: Schema.Literals(["transaction", "rejection", "scheduled_payment"]),
  rejects: Schema.NullOr(Schema.String),
  transaction: Schema.Struct({
    to: Schema.String,
    value: Schema.String,
    data: Schema.String,
    operation: Schema.Literals(["call", "delegatecall"]),
  }),
  calls: Schema.Array(Schema.Struct({ to: Schema.String, value: Schema.String, data: Schema.String })),
  note: Schema.NullOr(Schema.String),
  proposer: Schema.String,
  status: Schema.Literals(["awaiting_approvals", "executed", "rejected", "replaced"]),
  threshold: Schema.Number,
  approvals: Schema.Array(Schema.Struct({ owner: Schema.String, state: Schema.Literals(["approved", "sent"]) })),
  executionUserOpHash: Schema.NullOr(Schema.String),
  payment: Schema.optional(Schema.Struct({ id: Schema.String, sendsAt: Schema.Number })),
  createdAt: Schema.Number,
});

/** DepartmentPlanSchema's `groups` (department-schema.ts:238). */
const Groups = Schema.Struct({
  payoutRole: Schema.Number,
  departmentRole: Schema.Number,
  holders: Schema.Number,
  budget: Schema.Number,
  ceiling: Schema.Number,
});

/**
 * DepartmentPlanSchema's `office` (department-schema.ts:216), as the SDK keeps it (departments.ts:43): the hat,
 * the Board's top hat, the period and on a v4 budget set its id and amount before. Present on v4 only.
 */
const Office = Schema.optionalKey(
  Schema.Struct({
    hat: Schema.String,
    boardTopHat: Schema.String,
    period: Schema.Literals(["year", "quarter", "month"]),
    budgetId: Schema.optionalKey(Schema.String),
    previous: Schema.optionalKey(Schema.String),
  }),
);

const status = Schema.Unknown; // The proposal's status, or `awaiting_approval` with `--no-wait` (approval.ts:151, :200).
const approvalId = Schema.Unknown; // Your approval (approval.ts:151, :200).

// ── org department create ────────────────────────────────────────────────────────────────────

// `departments.create` (departments.ts:117): the row payroll.departments.create, then on v4 (`plan.office`)
// `checkTopBudget`, else `checkCreate` with the Roles encoder, then requestApproval.
export const operation_org_department_create = defineOperation({
  ...frozenText("org.department.create"),
  was: [
    page("org.department.create"),
    `${CLI}/subcommands/create/command.ts:35`,
    `${CLI}/subcommands/create/execute.ts:32`,
    `${CLI}/subcommands/create/execute.ts:50`,
    `${CLI}/subcommands/create/execute.ts:52`,
    `${SDK}/departments.ts:117`,
    `${ROWS}/operations.ts:174`,
    `${ROWS}/department-schema.ts:254`,
    ...WRITE_WAS,
    "packages/scenarios/src/acme/s2-the-team-and-its-permissions.scenario.ts:1276",
  ],
  priority: "normal",
  implementedBy: flow_client_org_departments_create,
  acceptance: frozenClaims("org.department.create"),
  // `department` and `proposal` are ProposedDepartmentChangeSchema's (department-schema.ts:254); `groups` and
  // `office` its plan's. As is, the CLI prints `department` and `office` beside the approval hand-over, not `groups`
  // (create/execute.ts:62).
  returns: Schema.Struct({ status, approvalId, department: Department, proposal: SafeProposal, groups: Groups, office: Office }),
  // CLI_USAGE also for a budget that is not an amount per period (create/execute.ts:32).
  errors: WRITE_ERRORS,
  // s2.14 (s2:1276) refuses a create with FEATURE_NOT_AVAILABLE (the gate is off), which the page does not list.
  refusals: refusalsOf("org.department.create", {
    INVALID_INPUT: [error_INVALID_INPUT, "?"],
    ROLE_CONFLICT: [error_ROLE_CONFLICT, "?"],
    WRONG_STATE: [error_WRONG_STATE, "?"],
    TOKEN_NOT_SUPPORTED: [error_TOKEN_NOT_SUPPORTED, "?"],
    ROLE_PERMISSION_DENIED: [error_ROLE_PERMISSION_DENIED, "?"],
  }),
});

// ── org department list ──────────────────────────────────────────────────────────────────────

export const operation_org_department_list = defineOperation({
  ...frozenText("org.department.list"),
  was: [
    page("org.department.list"),
    `${CLI}/subcommands/list/command.ts:5`,
    `${CLI}/subcommands/list/execute.ts:12`,
    `${CLI}/subcommands/list/execute.ts:16`,
    `${SDK}/departments.ts:229`,
    `${ROWS}/operations.ts:252`,
    `${ROWS}/department-schema.ts:116`,
    ...SCOPE_WAS,
  ],
  priority: "normal",
  implementedBy: rpc_payroll_departments_list,
  acceptance: frozenClaims("org.department.list"),
  // The row answers Array(DepartmentSchema) (operations.ts:254); the CLI prints it as `{ items }` (list/execute.ts:16).
  returns: Schema.Struct({ items: Schema.Array(Department) }),
  errors: SCOPE_ERRORS,
  refusals: refusalsOf("org.department.list", {
    ROLE_PERMISSION_DENIED: [error_ROLE_PERMISSION_DENIED, "?"],
    PROVIDER_ERROR: [error_PROVIDER_ERROR, "?"],
  }),
});

// ── org department show ──────────────────────────────────────────────────────────────────────

export const operation_org_department_show = defineOperation({
  ...frozenText("org.department.show"),
  was: [
    page("org.department.show"),
    `${CLI}/subcommands/show/command.ts:5`,
    `${CLI}/subcommands/show/execute.ts:16`,
    `${CLI}/subcommands/show/execute.ts:20`,
    `${SDK}/departments.ts:225`,
    `${ROWS}/operations.ts:245`,
    `${ROWS}/department-schema.ts:159`,
    ...SCOPE_WAS,
  ],
  priority: "normal",
  implementedBy: rpc_payroll_departments_get,
  acceptance: frozenClaims("org.department.show"),
  // DepartmentDetailSchema's fields (department-schema.ts:159) with DepartmentAgreementSummarySchema (:148); the CLI
  // prints the whole detail (show/execute.ts:20).
  returns: Schema.Struct({
    departmentId: Department.fields.departmentId,
    key: Department.fields.key,
    status: Department.fields.status,
    budgets: Department.fields.budgets,
    holders: Department.fields.holders,
    items: Schema.Array(
      Schema.Struct({
        agreementId: Schema.String,
        payee: Schema.String,
        kind: Schema.String,
        token: Schema.String,
        rate: Schema.Struct({ amount: Schema.String, per: Schema.String }),
        status: Schema.String,
        offeredBy: Schema.String,
      }),
    ),
  }),
  errors: SCOPE_ERRORS,
  refusals: refusalsOf("org.department.show", {
    INVALID_INPUT: [error_INVALID_INPUT, "?"],
    ROLE_PERMISSION_DENIED: [error_ROLE_PERMISSION_DENIED, "?"],
  }),
});

// ── org department budget set ────────────────────────────────────────────────────────────────

// Without `--token` the CLI calls `departments.setAmount` (budget/execute.ts:46), the method the page names; with
// `--token` it calls `departments.setBudget` (:51), another flow on the same row (departments.ts:134). Both read
// the department first (:56). setAmount's check is `checkTopBudgetAmount` (departments.ts:159).
export const operation_org_department_budget_set = defineOperation({
  ...frozenText("org.department.budget.set"),
  was: [
    page("org.department.budget.set"),
    `${CLI}/subcommands/budget/command.ts:16`,
    `${CLI}/subcommands/budget/execute.ts:19`,
    `${CLI}/subcommands/budget/execute.ts:46`,
    `${CLI}/subcommands/budget/execute.ts:51`,
    `${CLI}/subcommands/budget/execute.ts:56`,
    `${SDK}/departments.ts:145`,
    `${SDK}/departments.ts:134`,
    `${ROWS}/operations.ts:185`,
    ...WRITE_WAS,
    "packages/scenarios/src/acme/s6-the-short-contract.scenario.ts:423",
    "packages/scenarios/src/acme/s6-the-short-contract.scenario.ts:2044",
    "packages/scenarios/src/acme/s7-when-money-controls-say-no.scenario.ts:486",
  ],
  priority: "normal",
  implementedBy: flow_client_org_departments_set_amount,
  acceptance: frozenClaims("org.department.budget.set"),
  // ProposedDepartmentChangeSchema's `department` and `proposal` (department-schema.ts:254), beside the hand-over.
  returns: Schema.Struct({ status, approvalId, department: Department, proposal: SafeProposal }),
  // CLI_USAGE also for a budget that is not an amount per year, quarter or month (budget/execute.ts:19).
  errors: WRITE_ERRORS,
  refusals: refusalsOf("org.department.budget.set", {
    WRONG_STATE: [error_WRONG_STATE, "?"],
    // s6.43 (s6:2044): Dana sets Operations' budget per month and is refused INVALID_INPUT on `budget.per`, inside S6
    // after it creates Operations (s6.2). S6 restores after-s2 (s6:423), where the same command is refused
    // INVALID_INPUT too: Operations is unknown there, which the `when` also names.
    INVALID_INPUT: [error_INVALID_INPUT, "after-s2"],
    // s7.4 (s7:486) is an act: it says 80,000 would be AMOUNT_BELOW_USE but runs only the 93,800 that passes.
    AMOUNT_BELOW_USE: [error_AMOUNT_BELOW_USE, "?"],
    TOKEN_NOT_SUPPORTED: [error_TOKEN_NOT_SUPPORTED, "?"],
    ROLE_PERMISSION_DENIED: [error_ROLE_PERMISSION_DENIED, "?"],
  }),
});

// ── org department ceiling set ───────────────────────────────────────────────────────────────

export const operation_org_department_ceiling_set = defineOperation({
  ...frozenText("org.department.ceiling.set"),
  was: [
    page("org.department.ceiling.set"),
    `${CLI}/subcommands/ceiling/command.ts:15`,
    `${CLI}/subcommands/ceiling/execute.ts:21`,
    `${CLI}/subcommands/ceiling/execute.ts:66`,
    `${CLI}/subcommands/ceiling/execute.ts:69`,
    `${SDK}/departments.ts:178`,
    `${ROWS}/operations.ts:206`,
    `${ROWS}/department-schema.ts:323`,
    ...WRITE_WAS,
  ],
  priority: "normal",
  implementedBy: flow_client_org_departments_set_ceiling,
  acceptance: frozenClaims("org.department.ceiling.set"),
  // ProposedCeilingChangeSchema's `payoutCeiling` and `proposal` (department-schema.ts:323), beside the hand-over.
  returns: Schema.Struct({ status, approvalId, payoutCeiling: PayoutCeiling, proposal: SafeProposal }),
  // CLI_USAGE also for an amount with no period, per 336 days, or 0 (ceiling/execute.ts:24, :31, :36, :41).
  errors: WRITE_ERRORS,
  refusals: refusalsOf("org.department.ceiling.set", {
    CLI_USAGE: [error_CLI_USAGE, "?"],
    INVALID_INPUT: [error_INVALID_INPUT, "?"],
    WRONG_STATE: [error_WRONG_STATE, "?"],
    TOKEN_NOT_SUPPORTED: [error_TOKEN_NOT_SUPPORTED, "?"],
    ROLE_PERMISSION_DENIED: [error_ROLE_PERMISSION_DENIED, "?"],
  }),
});

// ── org department ceiling freeze ────────────────────────────────────────────────────────────

export const operation_org_department_ceiling_freeze = defineOperation({
  ...frozenText("org.department.ceiling.freeze"),
  was: [
    page("org.department.ceiling.freeze"),
    `${CLI}/subcommands/ceiling/command.ts:54`,
    `${CLI}/subcommands/ceiling/freeze.ts:18`,
    `${CLI}/subcommands/ceiling/freeze.ts:30`,
    `${CLI}/subcommands/ceiling/freeze.ts:33`,
    `${SDK}/departments.ts:186`,
    `${ROWS}/operations.ts:213`,
    `${ROWS}/department-schema.ts:323`,
    ...WRITE_WAS,
  ],
  priority: "normal",
  implementedBy: flow_client_org_departments_freeze_ceiling,
  acceptance: frozenClaims("org.department.ceiling.freeze"),
  returns: Schema.Struct({ status, approvalId, payoutCeiling: PayoutCeiling, proposal: SafeProposal }),
  // CLI_USAGE also for a `--leave` that is not an amount (ceiling/freeze.ts:18).
  errors: WRITE_ERRORS,
  refusals: refusalsOf("org.department.ceiling.freeze", {
    WRONG_STATE: [error_WRONG_STATE, "?"],
    INVALID_INPUT: [error_INVALID_INPUT, "?"],
    CLI_USAGE: [error_CLI_USAGE, "?"],
    ROLE_PERMISSION_DENIED: [error_ROLE_PERMISSION_DENIED, "?"],
  }),
});

// ── org department ceiling unfreeze ──────────────────────────────────────────────────────────

export const operation_org_department_ceiling_unfreeze = defineOperation({
  ...frozenText("org.department.ceiling.unfreeze"),
  was: [
    page("org.department.ceiling.unfreeze"),
    `${CLI}/subcommands/ceiling/command.ts:84`,
    `${CLI}/subcommands/ceiling/freeze.ts:56`,
    `${CLI}/subcommands/ceiling/freeze.ts:58`,
    `${SDK}/departments.ts:199`,
    `${ROWS}/operations.ts:220`,
    `${ROWS}/department-schema.ts:323`,
    ...WRITE_WAS,
  ],
  priority: "normal",
  implementedBy: flow_client_org_departments_unfreeze_ceiling,
  acceptance: frozenClaims("org.department.ceiling.unfreeze"),
  returns: Schema.Struct({ status, approvalId, payoutCeiling: PayoutCeiling, proposal: SafeProposal }),
  errors: WRITE_ERRORS,
  refusals: refusalsOf("org.department.ceiling.unfreeze", {
    WRONG_STATE: [error_WRONG_STATE, "?"],
    ROLE_PERMISSION_DENIED: [error_ROLE_PERMISSION_DENIED, "?"],
  }),
});

// ── org department holder add ────────────────────────────────────────────────────────────────

// The page names `departments.holders.add`; the CLI reads the department first (holder/execute.ts:17).
export const operation_org_department_holder_add = defineOperation({
  ...frozenText("org.department.holder.add"),
  was: [
    page("org.department.holder.add"),
    `${CLI}/subcommands/holder/command.ts:25`,
    `${CLI}/subcommands/holder/execute.ts:17`,
    `${CLI}/subcommands/holder/execute.ts:24`,
    `${SDK}/departments.ts:208`,
    `${ROWS}/operations.ts:192`,
    ...WRITE_WAS,
  ],
  priority: "normal",
  implementedBy: flow_client_org_departments_holders_add,
  acceptance: frozenClaims("org.department.holder.add"),
  returns: Schema.Struct({ status, approvalId, department: Department, proposal: SafeProposal }),
  errors: WRITE_ERRORS,
  refusals: refusalsOf("org.department.holder.add", {
    INVALID_INPUT: [error_INVALID_INPUT, "?"],
    ROLE_CONFLICT: [error_ROLE_CONFLICT, "?"],
    WRONG_STATE: [error_WRONG_STATE, "?"],
    ROLE_PERMISSION_DENIED: [error_ROLE_PERMISSION_DENIED, "?"],
  }),
});

// ── org department holder remove ─────────────────────────────────────────────────────────────

export const operation_org_department_holder_remove = defineOperation({
  ...frozenText("org.department.holder.remove"),
  was: [
    page("org.department.holder.remove"),
    `${CLI}/subcommands/holder/command.ts:25`,
    `${CLI}/subcommands/holder/execute.ts:17`,
    `${CLI}/subcommands/holder/execute.ts:25`,
    `${SDK}/departments.ts:216`,
    `${ROWS}/operations.ts:199`,
    ...WRITE_WAS,
  ],
  priority: "normal",
  implementedBy: flow_client_org_departments_holders_remove,
  acceptance: frozenClaims("org.department.holder.remove"),
  returns: Schema.Struct({ status, approvalId, department: Department, proposal: SafeProposal }),
  errors: WRITE_ERRORS,
  refusals: refusalsOf("org.department.holder.remove", {
    WRONG_STATE: [error_WRONG_STATE, "?"],
    INVALID_INPUT: [error_INVALID_INPUT, "?"],
    ROLE_PERMISSION_DENIED: [error_ROLE_PERMISSION_DENIED, "?"],
  }),
});

// ── org department close ─────────────────────────────────────────────────────────────────────

export const operation_org_department_close = defineOperation({
  ...frozenText("org.department.close"),
  was: [
    page("org.department.close"),
    `${CLI}/subcommands/close/command.ts:45`,
    `${CLI}/subcommands/close/execute.ts:15`,
    `${CLI}/subcommands/close/execute.ts:19`,
    `${SDK}/departments.ts:162`,
    `${ROWS}/operations.ts:231`,
    ...WRITE_WAS,
    "packages/scenarios/src/acme/s6-the-short-contract.scenario.ts:2107",
  ],
  priority: "normal",
  implementedBy: flow_client_org_departments_close,
  acceptance: frozenClaims("org.department.close"),
  // ProposedDepartmentChangeSchema's `department` and `proposal`, its plan's `office` (close/execute.ts:23).
  returns: Schema.Struct({ status, approvalId, department: Department, office: Office, proposal: SafeProposal }),
  errors: WRITE_ERRORS,
  refusals: refusalsOf("org.department.close", {
    // s6.45 (s6:2107) closes Operations again and is refused WRONG_STATE `closed`, inside S6 after it creates and
    // closes Operations (s6.2, s6.44). No saved world holds a closed department.
    WRONG_STATE: [error_WRONG_STATE, "?"],
    INVALID_INPUT: [error_INVALID_INPUT, "?"],
    FEATURE_NOT_AVAILABLE: [error_FEATURE_NOT_AVAILABLE, "?"],
    ROLE_PERMISSION_DENIED: [error_ROLE_PERMISSION_DENIED, "?"],
  }),
});

// ── org department reopen ────────────────────────────────────────────────────────────────────

export const operation_org_department_reopen = defineOperation({
  ...frozenText("org.department.reopen"),
  was: [
    page("org.department.reopen"),
    `${CLI}/subcommands/close/command.ts:46`,
    `${CLI}/subcommands/close/execute.ts:15`,
    `${CLI}/subcommands/close/execute.ts:20`,
    `${SDK}/departments.ts:170`,
    `${ROWS}/operations.ts:238`,
    ...WRITE_WAS,
  ],
  priority: "normal",
  implementedBy: flow_client_org_departments_reopen,
  acceptance: frozenClaims("org.department.reopen"),
  returns: Schema.Struct({ status, approvalId, department: Department, office: Office, proposal: SafeProposal }),
  errors: WRITE_ERRORS,
  refusals: refusalsOf("org.department.reopen", {
    WRONG_STATE: [error_WRONG_STATE, "?"],
    INVALID_INPUT: [error_INVALID_INPUT, "?"],
    FEATURE_NOT_AVAILABLE: [error_FEATURE_NOT_AVAILABLE, "?"],
    ROLE_PERMISSION_DENIED: [error_ROLE_PERMISSION_DENIED, "?"],
  }),
});

// ── org department pay ───────────────────────────────────────────────────────────────────────

// The CLI reads the department itself first (`departments.get`, pay/execute.ts:43) to find its token, then calls
// `departments.pay` (:61), which the client binds to its approvals (assemble.ts:237, department-pay.ts:29): it reads
// the department again and calls `client.approvals.prepare` with the department as the permission. The CLI hands
// the approval over and follows it (`handOver`, :74 → approval.ts:278).
export const operation_org_department_pay = defineOperation({
  ...frozenText("org.department.pay"),
  was: [
    page("org.department.pay"),
    `${CLI}/subcommands/pay/command.ts:24`,
    `${CLI}/subcommands/pay/execute.ts:39`,
    `${CLI}/subcommands/pay/execute.ts:43`,
    `${CLI}/subcommands/pay/execute.ts:51`,
    `${CLI}/subcommands/pay/execute.ts:61`,
    `${CLI}/subcommands/pay/execute.ts:74`,
    `${APPROVAL}:278`,
    `${APPROVAL}:49`,
    `${SDK}/department-pay.ts:29`,
    `${SDK}/department-pay.ts:32`,
    "packages/sdk/src/platform/client/assemble.ts:237",
    "apps/cli/src/commands/payment/internal/send-target.ts:27",
    ...SCOPE_WAS,
    "packages/scenarios/src/acme/s31-mia-pays-from-engineering.scenario.ts:47",
    "packages/scenarios/src/acme/s31-mia-pays-from-engineering.scenario.ts:179",
    "packages/scenarios/src/acme/s31-mia-pays-from-engineering.scenario.ts:197",
  ],
  priority: "normal",
  implementedBy: flow_client_org_departments_pay,
  acceptance: frozenClaims("org.department.pay"),
  // No row returns these: they are the CLI's approval hand-over (awaitingApproval, approval.ts:49). Schema.Unknown.
  returns: Schema.Struct({
    approvalId: Schema.Unknown, // The approval you sign on the approval page.
    paymentIds: Schema.Unknown, // The one payment it makes.
  }),
  // CLI_USAGE also for a recipient (send-target.ts:27), a department with no payable token and an amount that is
  // not one (pay/execute.ts:51, :56, :58).
  errors: WRITE_ERRORS,
  refusals: refusalsOf("org.department.pay", {
    // s31.3 and s31.4 (s31:179, :197): Mia pays 200,000 from Engineering (budget_exhausted) and Sam, who does not
    // hold it, pays himself 100 (not_holder); both are refused ROLE_PERMISSION_DENIED. S31 restores after-s2 (:47),
    // where Engineering has its 100,000 and its holders, so either command reaches it there.
    ROLE_PERMISSION_DENIED: [error_ROLE_PERMISSION_DENIED, "after-s2"],
    WRONG_STATE: [error_WRONG_STATE, "?"],
    INVALID_INPUT: [error_INVALID_INPUT, "?"],
  }),
});
