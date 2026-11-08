// The as-is book of the old payroll concept: the departments area (ADR-0040 departments amendment,
// Budgets A): a budget its holders pay from, and each token's payout ceiling over every department.
// Every change is one Directors' proposal on the Organization Safe.
//
// Every operation registered at `payroll/departments:*` (packages/backend/convex/payroll/departments.ts).
// Eleven are public rows of `departments` (packages/protocol/src/payroll/operations.ts); load, read,
// record, settle, keepBudgetIds and noticeFacts are internal queries and mutations an action runs in
// the same call; emitChangeProposed is telemetry plumbing; notify is scheduled when a change applies.
//
// How touches are booked: as runs.ts. A public action lists what the payroll rpcs it runs touch on the
// paths it can take (pre-v4 PayrollDepartments with Roles, or Protocol v4 Budgets with an office hat).
// Organizations' action helpers it runs are named in `about`, not linked: requireSafeOwner (the caller
// is a Director; reads the Safe's owners, nonce and threshold and settles its proposals) and
// settleOrganizationProposals (settles the Organization's proposals from the chain). Payments' action
// helper rolesModuleAdmitted (the Roles module is an admitted proxy, CAP-646) is named the same way;
// its eth_getCode is booked under `calls`.

import { Schema } from "effect";
import { defineRpc, defineWorkflow } from "../../../packages/book/src/index.ts";
import { concept_payroll } from "../shared/foundation.ts";
import {
  error_ACCOUNT_NOT_FOUND,
  error_AMOUNT_BELOW_USE,
  error_ENV_MISSING,
  error_FEATURE_NOT_AVAILABLE,
  error_INVALID_INPUT,
  error_NOT_AUTHENTICATED,
  error_PROVIDER_ERROR,
  error_ROLE_CONFLICT,
  error_ROLE_PERMISSION_DENIED,
  error_SMART_ACCOUNT_MISSING,
  error_TOKEN_NOT_SUPPORTED,
  error_UNKNOWN,
  error_WRONG_STATE,
  event_payroll_agreement_transitioned,
  event_payroll_department_change_proposed,
} from "../shared/vocabulary.ts";
import {
  contract_agreements,
  contract_budgets,
  contract_hats,
  contract_installer,
  contract_payroll_departments,
  contract_roles,
  contract_safe,
  integration_chain_rpc,
  integration_mail,
  integration_roles,
} from "../shared/external.ts";
import {
  machine_payroll_agreement,
  machine_payroll_agreement_write,
  machine_payroll_department,
  machine_payroll_department_change,
  table_payroll_agreements,
  table_payroll_department_changes,
  table_payroll_departments,
} from "./data.ts";
import { procedure_access_require_feature_from_action } from "../access/procedures.ts";
import { procedure_accounts_read_workspace_setup_signer_in_tx } from "../accounts/procedures.ts";
import {
  procedure_organizations_read_active_member_by_email_in_tx,
  procedure_organizations_read_company_deployment_in_tx,
  procedure_organizations_read_organization_name_in_tx,
  procedure_organizations_read_subject_proposal_in_tx,
  procedure_organizations_read_waiting_proposal_calls_in_tx,
  procedure_organizations_record_owner_proposal_in_tx,
  procedure_organizations_require_org_participant,
} from "../organizations/procedures.ts";
import { procedure_parties_party_by_safe_address } from "../parties/procedures.ts";
import {
  procedure_permissions_read_manage_people_holder_safes_in_tx,
  procedure_permissions_read_owner_roles_module_in_tx,
} from "../permissions/procedures.ts";

const BACKEND = "packages/backend";
const CONVEX = `${BACKEND}/convex/payroll/departments.ts`;
const SRC = `${BACKEND}/src/payroll`;
const DEP = `${SRC}/departments`;
const OPS = `${DEP}/operations`;
const ROWS = "packages/protocol/src/payroll/operations.ts";
const DSCHEMA = "packages/protocol/src/payroll/department-schema.ts";
const ORG_GUARDS = `${BACKEND}/src/organizations/proposals/guards.ts`;

const S = Schema.String;
const N = Schema.Number;
const opt = Schema.optionalKey;

/** Keep each link once, in first-seen order. */
const union = <const L extends ReadonlyArray<ReadonlyArray<{ readonly id: string }>>>(...lists: L): Array<L[number][number]> => {
  const seen = new Set<string>();
  const out: Array<L[number][number]> = [];
  for (const list of lists)
    for (const item of list) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      out.push(item);
    }
  return out;
};
const spanUnion = (...lists: ReadonlyArray<ReadonlyArray<string>>): string[] => [...new Set(lists.flat())];

// ── errors (operations.ts:101, :109, :115, :199, :213, :216) ──────────────────────────────

const CALL_DEFECTS = [error_NOT_AUTHENTICATED, error_INVALID_INPUT, error_UNKNOWN, error_ENV_MISSING];
/** `DEPARTMENT_HOLDER_WRITE`. */
const HOLDER_WRITE_ERRORS = [
  ...CALL_DEFECTS,
  error_ROLE_PERMISSION_DENIED,
  error_WRONG_STATE,
  error_SMART_ACCOUNT_MISSING,
  error_ACCOUNT_NOT_FOUND,
  error_FEATURE_NOT_AVAILABLE,
  error_ROLE_CONFLICT,
  error_PROVIDER_ERROR,
];
/** `DEPARTMENT_WRITE`: one token too. */
const WRITE_ERRORS = [...HOLDER_WRITE_ERRORS, error_TOKEN_NOT_SUPPORTED];
/** `DEPARTMENT_READ`. */
const READ_ERRORS = [...CALL_DEFECTS, error_ROLE_PERMISSION_DENIED, error_PROVIDER_ERROR];

// ── shapes ─────────────────────────────────────────────────────────────────────────────────

/** `DepartmentSchema` (department-schema.ts:116): budget lines, holders and on-chain ids; too deep, Unknown below. */
const Department = Schema.Struct({
  departmentId: S,
  key: S,
  name: S,
  status: S,
  budgets: Schema.Array(Schema.Unknown),
  holders: Schema.Array(Schema.Struct({ address: S, label: S })),
  offers: N,
  runningAgreements: N,
  roleKey: S,
  chain: opt(Schema.Unknown),
});
/** `ProposedDepartmentChangeSchema` (:254): the department as proposed, the Safe proposal and the plan the caller rebuilds. */
const ProposedChange = Schema.Struct({ department: Department, proposal: Schema.Unknown, plan: Schema.Unknown });
/** `ProposedCeilingChangeSchema` (:310). */
const ProposedCeiling = Schema.Struct({
  payoutCeiling: Schema.Struct({ token: S, amount: S, per: Schema.Literals(["year"]), left: S, frozen: opt(Schema.Boolean) }),
  proposal: Schema.Unknown,
  plan: Schema.Unknown,
});
const Note = opt(S);
const HolderInput = Schema.Struct({ orgId: S, department: S, holder: S, note: Note });
const OpenStateInput = Schema.Struct({ orgId: S, department: S, note: Note });
const ChangeKind = Schema.Literals([
  "create",
  "setBudget",
  "addHolder",
  "removeHolder",
  "setCeiling",
  "freezeCeiling",
  "unfreezeCeiling",
  "close",
  "reopen",
]);
const HolderRow = Schema.Struct({ email: S, safe: S, label: S });

// ── shared touches ─────────────────────────────────────────────────────────────────────────

const GATE = [procedure_access_require_feature_from_action];

/** payroll.departments.settle: each waiting change applied or ended, in nonce order (writes.ts:209). */
const SETTLE = {
  reads: [table_payroll_department_changes, table_payroll_departments],
  writes: [table_payroll_department_changes, table_payroll_departments],
  drives: [
    machine_payroll_department_change.t.to_applied,
    machine_payroll_department_change.t.to_abandoned,
    machine_payroll_department.t.to_active,
    machine_payroll_department.t.to_abandoned,
  ],
  invokes: [procedure_organizations_read_subject_proposal_in_tx],
};
const SETTLE_WAS = [
  `${DEP}/writes.ts:209`,
  `${DEP}/writes.ts:227`,
  `${DEP}/writes.ts:264`,
  `${DEP}/writes.ts:275`,
  `${DEP}/reads.ts:51`,
  `${DEP}/rules.ts:64`,
  `${DEP}/rules.ts:100`,
  `${DEP}/writes/notices.ts:18`,
];

/** payroll.departments.load: the planning facts (readPlanningFactsInTx, reads.ts:102). */
const LOAD = {
  reads: [table_payroll_departments, table_payroll_department_changes],
  invokes: [
    procedure_organizations_read_company_deployment_in_tx,
    procedure_permissions_read_owner_roles_module_in_tx,
    procedure_permissions_read_manage_people_holder_safes_in_tx,
    procedure_organizations_read_active_member_by_email_in_tx,
    procedure_parties_party_by_safe_address,
    procedure_organizations_read_subject_proposal_in_tx,
  ],
};
const LOAD_WAS = [`${DEP}/reads.ts:78`, `${DEP}/reads.ts:102`, `${DEP}/reads.ts:149`, `${DEP}/reads.ts:183`, `${DEP}/reads.ts:241`];

/** payroll.departments.record: the change, a create's department and the Director proposal (writes.ts:108). */
const RECORD = {
  reads: [table_payroll_department_changes, table_payroll_departments],
  writes: [table_payroll_departments, table_payroll_department_changes],
  drives: [machine_payroll_department.t.to_proposed, machine_payroll_department_change.t.to_proposed],
  invokes: [procedure_organizations_read_waiting_proposal_calls_in_tx, procedure_organizations_record_owner_proposal_in_tx],
  emits: [event_payroll_department_change_proposed],
};
const RECORD_WAS = [`${DEP}/writes.ts:79`, `${DEP}/writes.ts:108`, `${DEP}/writes.ts:297`, `${DEP}/rules.ts:119`, `${DEP}/events.ts:120`];

/** payroll.departments.read: the departments for a participant (operations/read.ts:20). */
const READ = {
  reads: [table_payroll_departments, table_payroll_department_changes],
  invokes: [
    procedure_organizations_require_org_participant,
    procedure_organizations_read_company_deployment_in_tx,
    procedure_organizations_read_subject_proposal_in_tx,
  ],
};

/**
 * departmentAgreements (agreements/writes/actions.ts:124): payroll.agreements.load, then
 * payroll.agreements.settle when a sent write has a receipt or an approval lapsed, then the chain's
 * answer for each agreement.
 */
const AGREEMENTS = {
  reads: [table_payroll_agreements, table_payroll_departments],
  writes: [table_payroll_agreements],
  drives: [
    machine_payroll_agreement.t.to_onChain,
    machine_payroll_agreement.t.to_abandoned,
    machine_payroll_agreement_write.t.to_landed,
    machine_payroll_agreement_write.t.to_failed,
    machine_payroll_agreement_write.t.to_abandoned,
  ],
  invokes: [
    procedure_organizations_require_org_participant,
    procedure_accounts_read_workspace_setup_signer_in_tx,
    procedure_organizations_read_organization_name_in_tx,
    procedure_parties_party_by_safe_address,
  ],
  emits: [event_payroll_agreement_transitioned],
  calls: [
    integration_chain_rpc.c.fetchEthCall,
    integration_chain_rpc.c.fetchUserOperationReceipt,
    integration_chain_rpc.c.fetchBlockTimestamp,
  ],
  chain: [
    contract_budgets.f.budgetOf,
    contract_budgets.f.leftOf,
    contract_payroll_departments.f.agreementOf,
    contract_payroll_departments.f.earnedOf,
    contract_payroll_departments.f.availableOf,
    contract_agreements.f.agreementOf,
    contract_agreements.f.earnedOf,
    contract_agreements.f.availableOf,
  ],
  spans: ["chain.read eth_call", "chain.read eth_getUserOperationReceipt"],
};
const AGREEMENTS_WAS = [
  `${SRC}/agreements/writes/actions.ts:58`,
  `${SRC}/agreements/writes/actions.ts:124`,
  `${SRC}/agreements/reads/context.ts:106`,
  `${SRC}/agreements/reads/context.ts:219`,
  `${SRC}/agreements/external.ts:115`,
  `${SRC}/agreements/external.ts:198`,
  `${SRC}/agreements/writes/records.ts:222`,
];

/**
 * The chain a department write or read plans from. Pre-v4: PayrollDepartments `configs` and `budgetOf`,
 * each token's payout ceiling as Roles stores it, the latest block's time, and the Roles module's code.
 * Protocol v4: Budgets' top budget (`budgetOf`, `leftOf`), the next office hat id, the Installer's
 * `buildAddToken`, the company Roles' payout allowance, and a create's execution receipt for its budget id.
 * Every department action also runs organizations' Safe read (readSafeState, organizations/proposals/
 * external.ts:71: block number, owners, threshold, nonce, approvedHashes) inside requireSafeOwner or
 * settleOrganizationProposals.
 */
const CHAIN_READS = {
  calls: [
    integration_chain_rpc.c.fetchEthCall,
    integration_chain_rpc.c.fetchLatestBlock,
    integration_chain_rpc.c.fetchCode,
    integration_chain_rpc.c.fetchUserOperationReceipt,
    integration_chain_rpc.c.fetchLatestBlockNumber,
    integration_chain_rpc.c.fetchSafeOwners,
  ],
  chain: [
    contract_safe.f.getOwners,
    contract_safe.f.getThreshold,
    contract_safe.f.nonce,
    contract_safe.f.approvedHashes,
    contract_payroll_departments.f.configs,
    contract_payroll_departments.f.budgetOf,
    contract_roles.f.allowances,
    contract_budgets.f.budgetOf,
    contract_budgets.f.leftOf,
    contract_hats.f.getNextId,
    contract_installer.f.buildAddToken,
  ],
  spans: [
    "chain.read eth_call",
    "chain.read eth_getBlockByNumber",
    "chain.read eth_getCode",
    "chain.read eth_getUserOperationReceipt",
    "chain.read eth_blockNumber",
  ],
};
const CHAIN_WAS = [
  `${DEP}/external.ts:51`,
  `${DEP}/external.ts:73`,
  `${DEP}/external.ts:95`,
  `${DEP}/external.ts:102`,
  `${DEP}/external.ts:154`,
  `${DEP}/external.ts:274`,
  `${DEP}/external/budgets.ts:59`,
  `${DEP}/external/budgets.ts:76`,
  `${DEP}/external/budget-amounts.ts:41`,
  `${DEP}/external/budget-amounts.ts:68`,
  `${DEP}/external/budget-reads.ts:97`,
];

/** What every Director write runs before and after its own planning: settle, load, record. */
const PROPOSE = {
  reads: union(SETTLE.reads, LOAD.reads, RECORD.reads),
  writes: union(SETTLE.writes, RECORD.writes),
  drives: union(SETTLE.drives, RECORD.drives),
  invokes: union(GATE, SETTLE.invokes, LOAD.invokes, RECORD.invokes),
  emits: RECORD.emits,
};
const PROPOSE_WAS = [`${ORG_GUARDS}:129`, ...SETTLE_WAS, ...LOAD_WAS, ...RECORD_WAS];

const DIRECTOR =
  "A signed-in Director (an owner of the Organization Safe, organizations' requireSafeOwner; else ROLE_PERMISSION_DENIED " +
  "not_member) with a personal Safe and the `payment-departments` gate on; the proposal waits for the Safe's threshold.";
const PROPOSE_ABOUT =
  "Signed in (`signedInAction`); the `payment-departments` gate; organizations' requireSafeOwner (the caller is an owner " +
  "of the Safe, whose owners, nonce and threshold it reads, settling the Organization's proposals); the internal " +
  "mutation payroll.departments.settle; the internal query payroll.departments.load (Roles module or v4 deployment, " +
  "departments, holders resolved as active members with a personal Safe and no Manage Budgets, the waiting changes).";
const RECORD_ABOUT =
  "The internal mutation payroll.departments.record saves the change and the Director proposal (refusing a key taken " +
  "since, or a payout ceiling change a waiting one would undo or that would undo it) and schedules " +
  "payroll_department_change_proposed. Nothing is signed: the Directors approve the proposal on the Safe.";

// ── public writes ──────────────────────────────────────────────────────────────────────────

export const rpc_payroll_departments_create = defineRpc({
  id: "payroll.departments.create",
  title: "Propose a department with its first budget and holders",
  about:
    "Row `payroll.departments.create`, registered as the public action `payroll/departments:create`. " +
    PROPOSE_ABOUT +
    " The name gives the slug; one a department has (not abandoned) is WRONG_STATE. On a v4 company (CAP-1161): a week " +
    "budget is INVALID_INPUT; another create waiting is WRONG_STATE; it plans the office hat under the Board's top hat " +
    "(Hats `getNextId`), its mints to each holder, the token's payout ceiling resize (or the Installer's `buildAddToken` " +
    "calls that turn the token on) and `Budgets.createTopBudget`. Before v4: a yearly budget on PayrollDepartments " +
    "through a Roles role, refusing a Roles module that moved or is not an admitted proxy, with the ceiling over every " +
    "department's max(budget, committed). The token defaults to USDC; one Capxul does not admit is TOKEN_NOT_SUPPORTED; a " +
    "zero budget is INVALID_INPUT. " +
    RECORD_ABOUT +
    " Answers the department as proposed, the proposal and the plan.",
  was: [`${CONVEX}:11`, `${OPS}/create.ts:50`, `${OPS}/create.ts:72`, `${OPS}/create.ts:81`, `${OPS}/create.ts:182`, `${ROWS}:174`, `${DSCHEMA}:262`, ...PROPOSE_WAS, ...CHAIN_WAS],
  concept: concept_payroll,
  kind: "action",
  who: DIRECTOR,
  input: Schema.Struct({
    orgId: S,
    name: S,
    budget: Schema.Struct({ amount: S, per: Schema.Literals(["year", "quarter", "month", "week"]), token: opt(S) }),
    holders: Schema.Array(S),
    note: Note,
  }),
  output: ProposedChange,
  errors: WRITE_ERRORS,
  ...PROPOSE,
  calls: [...CHAIN_READS.calls, integration_roles.c.encodeRoles],
  chain: CHAIN_READS.chain,
  spans: CHAIN_READS.spans,
});

export const rpc_payroll_departments_set_budget = defineRpc({
  id: "payroll.departments.set-budget",
  title: "Propose a department's new budget",
  about:
    "Row `payroll.departments.setBudget`, registered as the public action `payroll/departments:setBudget`. " +
    PROPOSE_ABOUT +
    " An unknown key is INVALID_INPUT; a department not active is WRONG_STATE. On v4 (CAP-1156): the top budget is read " +
    "(Budgets `budgetOf`, its creation's receipt when its id is not kept); a token or period other than its own is " +
    "INVALID_INPUT; an amount below what it already uses is AMOUNT_BELOW_USE; it plans `Budgets.setAmount` and moves the " +
    "token's payout ceiling by the difference, keeping the budget id on the department. Before v4: token and period are " +
    "required (INVALID_INPUT), a first budget in a token at 0 is INVALID_INPUT, no payout role is WRONG_STATE, and the " +
    "batch resizes the ceiling or enables the token. 0 closes the department in that token. " +
    RECORD_ABOUT,
  was: [`${CONVEX}:22`, `${OPS}/set-budget.ts:59`, `${OPS}/set-budget.ts:93`, `${OPS}/set-budget.ts:169`, `${DEP}/errors.ts:86`, `${ROWS}:185`, `${DSCHEMA}:273`, ...PROPOSE_WAS, ...CHAIN_WAS],
  concept: concept_payroll,
  kind: "action",
  who: DIRECTOR,
  input: Schema.Struct({
    orgId: S,
    department: S,
    budget: Schema.Struct({ amount: S, per: opt(Schema.Literals(["year", "quarter", "month", "week"])), token: opt(S) }),
    note: Note,
  }),
  output: ProposedChange,
  errors: [...WRITE_ERRORS, error_AMOUNT_BELOW_USE],
  ...PROPOSE,
  calls: [...CHAIN_READS.calls, integration_roles.c.encodeRoles],
  chain: CHAIN_READS.chain,
  spans: CHAIN_READS.spans,
});

const HOLDER_ABOUT =
  " An unknown key is INVALID_INPUT; a department not active is WRONG_STATE; a holder already on (or not on) is " +
  "WRONG_STATE. On v4 (CAP-1162, CAP-1163) the company Safe mints the office hat to the holder's Safe, or rules the old " +
  "holder ineligible, which burns it; before v4 one Roles `assignRoles`, refusing a Roles module that moved or is not an " +
  "admitted proxy. ";

export const rpc_payroll_departments_add_holder = defineRpc({
  id: "payroll.departments.add-holder",
  title: "Propose one more holder for a department",
  about:
    "Row `payroll.departments.addHolder`, registered as the public action `payroll/departments:addHolder`. " +
    PROPOSE_ABOUT +
    " The new holder must be an active member with a personal Safe (INVALID_INPUT) who does not hold Manage Budgets " +
    "(ROLE_CONFLICT)." +
    HOLDER_ABOUT +
    RECORD_ABOUT,
  was: [`${CONVEX}:8`, `${OPS}/add-holder.ts:34`, `${OPS}/add-holder.ts:126`, `${OPS}/add-holder.ts:188`, `${DEP}/reads.ts:78`, `${ROWS}:192`, ...PROPOSE_WAS, ...CHAIN_WAS],
  concept: concept_payroll,
  kind: "action",
  who: DIRECTOR,
  input: HolderInput,
  output: ProposedChange,
  errors: HOLDER_WRITE_ERRORS,
  ...PROPOSE,
  calls: CHAIN_READS.calls,
  chain: CHAIN_READS.chain,
  spans: CHAIN_READS.spans,
});

export const rpc_payroll_departments_remove_holder = defineRpc({
  id: "payroll.departments.remove-holder",
  title: "Propose taking one holder off a department",
  about:
    "Row `payroll.departments.removeHolder`, registered as the public action `payroll/departments:removeHolder`. " +
    PROPOSE_ABOUT +
    " A holder can always be taken off, member or not; their agreements stay with the department." +
    HOLDER_ABOUT +
    RECORD_ABOUT,
  was: [`${CONVEX}:21`, `${OPS}/remove-holder.ts:11`, `${OPS}/add-holder.ts:34`, `${ROWS}:199`, ...PROPOSE_WAS, ...CHAIN_WAS],
  concept: concept_payroll,
  kind: "action",
  who: DIRECTOR,
  input: HolderInput,
  output: ProposedChange,
  errors: HOLDER_WRITE_ERRORS,
  ...PROPOSE,
  calls: CHAIN_READS.calls,
  chain: CHAIN_READS.chain,
  spans: CHAIN_READS.spans,
});

export const rpc_payroll_departments_set_ceiling = defineRpc({
  id: "payroll.departments.set-ceiling",
  title: "Propose a token's new payout ceiling",
  about:
    "Row `payroll.departments.setCeiling`, registered as the public action `payroll/departments:setCeiling`. " +
    PROPOSE_ABOUT +
    " A zero ceiling is INVALID_INPUT; a token whose ceiling does not exist yet is WRONG_STATE; a freeze or unfreeze of it " +
    "waiting is WRONG_STATE. The ceiling is the most every department together pays out in the token each 365 days; the " +
    "resize keeps what this period spent and must cover every live budget (INVALID_INPUT below it). On v4 (CAP-1158) it " +
    "resizes the company Roles' `v4-payout-ceiling:` allowance, which must be yearly. " +
    RECORD_ABOUT,
  was: [`${CONVEX}:25`, `${OPS}/set-ceiling.ts:52`, `${OPS}/set-ceiling.ts:136`, `${DEP}/errors.ts:129`, `${ROWS}:206`, `${DSCHEMA}:291`, ...PROPOSE_WAS, ...CHAIN_WAS],
  concept: concept_payroll,
  kind: "action",
  who: DIRECTOR,
  input: Schema.Struct({ orgId: S, token: S, amount: S, note: Note }),
  output: ProposedCeiling,
  errors: WRITE_ERRORS,
  ...PROPOSE,
  calls: CHAIN_READS.calls,
  chain: CHAIN_READS.chain,
  spans: CHAIN_READS.spans,
});

export const rpc_payroll_departments_freeze_ceiling = defineRpc({
  id: "payroll.departments.freeze-ceiling",
  title: "Propose a payout freeze in one token",
  about:
    "Row `payroll.departments.freezeCeiling`, registered as the public action `payroll/departments:freezeCeiling` (CAP-947). " +
    PROPOSE_ABOUT +
    " No ceiling is WRONG_STATE; any other waiting write to it is WRONG_STATE; an already frozen one is WRONG_STATE; " +
    "`leave` (0 by default) above what is left is INVALID_INPUT. The ceiling keeps `leave` and stops refilling until the " +
    "Directors unfreeze it; the change keeps what it replaced in `restore`. Payees stay owed; collections in the token " +
    "are refused before signing while it is short. " +
    RECORD_ABOUT,
  was: [`${CONVEX}:9`, `${OPS}/freeze-ceiling.ts:44`, `${DEP}/errors.ts:149`, `${DEP}/errors.ts:157`, `${ROWS}:213`, `${DSCHEMA}:298`, ...PROPOSE_WAS, ...CHAIN_WAS],
  concept: concept_payroll,
  kind: "action",
  who: DIRECTOR,
  input: Schema.Struct({ orgId: S, token: S, leave: opt(S), note: Note }),
  output: ProposedCeiling,
  errors: WRITE_ERRORS,
  ...PROPOSE,
  calls: CHAIN_READS.calls,
  chain: CHAIN_READS.chain,
  spans: CHAIN_READS.spans,
});

export const rpc_payroll_departments_unfreeze_ceiling = defineRpc({
  id: "payroll.departments.unfreeze-ceiling",
  title: "Propose the unfreeze of one token's payout ceiling",
  about:
    "Row `payroll.departments.unfreezeCeiling`, registered as the public action `payroll/departments:unfreezeCeiling` " +
    "(CAP-947). " +
    PROPOSE_ABOUT +
    " The load reads the last applied freeze of the token's ceiling. No ceiling, another waiting write to it, or a ceiling " +
    "not frozen is WRONG_STATE; a freeze Capxul did not record, or one the chain no longer holds, is WRONG_STATE " +
    "frozen_outside_capxul. The yearly amount and refill come back, and what was left then less all of `leave`. " +
    RECORD_ABOUT,
  was: [`${CONVEX}:10`, `${OPS}/unfreeze-ceiling.ts:34`, `${DEP}/reads.ts:183`, `${DEP}/errors.ts:165`, `${ROWS}:220`, `${DSCHEMA}:305`, ...PROPOSE_WAS, ...CHAIN_WAS],
  concept: concept_payroll,
  kind: "action",
  who: DIRECTOR,
  input: Schema.Struct({ orgId: S, token: S, note: Note }),
  output: ProposedCeiling,
  errors: WRITE_ERRORS,
  ...PROPOSE,
  calls: CHAIN_READS.calls,
  chain: CHAIN_READS.chain,
  spans: CHAIN_READS.spans,
});

const OPEN_STATE_ABOUT =
  " An unknown key is INVALID_INPUT; a department not active, a pre-v4 one, a close or reopen of it already waiting, or a " +
  "top budget already in that state (Budgets `budgetOf`) is WRONG_STATE. It reads the department's agreements as " +
  "payroll.agreements.list does (load, settle, the chain), so the answer says how many keep paying, then plans one " +
  "`Budgets.close` or `Budgets.reopen` call. ";

export const rpc_payroll_departments_close = defineRpc({
  id: "payroll.departments.close",
  title: "Propose closing a v4 department's top budget",
  about:
    "Row `payroll.departments.close`, registered as the public action `payroll/departments:close` (CAP-1160). " +
    PROPOSE_ABOUT +
    OPEN_STATE_ABOUT +
    "Nothing new is spent, committed or created under a closed budget; running agreements keep paying. " +
    RECORD_ABOUT,
  was: [`${CONVEX}:23`, `${OPS}/close.ts:16`, `${DEP}/writes/open-state.ts:38`, `${DEP}/errors.ts:22`, `${ROWS}:231`, `${DSCHEMA}:319`, ...PROPOSE_WAS, ...CHAIN_WAS, ...AGREEMENTS_WAS],
  concept: concept_payroll,
  kind: "action",
  who: DIRECTOR,
  input: OpenStateInput,
  output: ProposedChange,
  errors: HOLDER_WRITE_ERRORS,
  reads: union(PROPOSE.reads, AGREEMENTS.reads),
  writes: union(PROPOSE.writes, AGREEMENTS.writes),
  drives: union(PROPOSE.drives, AGREEMENTS.drives),
  invokes: union(PROPOSE.invokes, AGREEMENTS.invokes),
  emits: union(PROPOSE.emits, AGREEMENTS.emits),
  calls: union(CHAIN_READS.calls, AGREEMENTS.calls),
  chain: union(CHAIN_READS.chain, AGREEMENTS.chain),
  spans: spanUnion(CHAIN_READS.spans, AGREEMENTS.spans),
});

export const rpc_payroll_departments_reopen = defineRpc({
  id: "payroll.departments.reopen",
  title: "Propose reopening a closed v4 department's top budget",
  about:
    "Row `payroll.departments.reopen`, registered as the public action `payroll/departments:reopen` (CAP-1166). " +
    PROPOSE_ABOUT +
    OPEN_STATE_ABOUT +
    RECORD_ABOUT,
  was: [`${CONVEX}:24`, `${OPS}/reopen.ts:15`, `${DEP}/writes/open-state.ts:38`, `${ROWS}:238`, `${DSCHEMA}:319`, ...PROPOSE_WAS, ...CHAIN_WAS, ...AGREEMENTS_WAS],
  concept: concept_payroll,
  kind: "action",
  who: DIRECTOR,
  input: OpenStateInput,
  output: ProposedChange,
  errors: HOLDER_WRITE_ERRORS,
  reads: union(PROPOSE.reads, AGREEMENTS.reads),
  writes: union(PROPOSE.writes, AGREEMENTS.writes),
  drives: union(PROPOSE.drives, AGREEMENTS.drives),
  invokes: union(PROPOSE.invokes, AGREEMENTS.invokes),
  emits: union(PROPOSE.emits, AGREEMENTS.emits),
  calls: union(CHAIN_READS.calls, AGREEMENTS.calls),
  chain: union(CHAIN_READS.chain, AGREEMENTS.chain),
  spans: spanUnion(CHAIN_READS.spans, AGREEMENTS.spans),
});

// ── public reads ───────────────────────────────────────────────────────────────────────────

const READ_ABOUT =
  "Signed in (`signedInAction`); organizations' settleOrganizationProposals settles the Organization's proposals from " +
  "the chain, then the internal mutation payroll.departments.settle; the internal query payroll.departments.read " +
  "(a current participant, else ROLE_PERMISSION_DENIED: the departments, the v4 deployment and the executions of v4 " +
  "creates whose budget id is not kept). Budgets come from the chain now, never from summed events (Q2): " +
  "PayrollDepartments `budgetOf` per payout token, or the v4 top budget (`budgetOf`, `leftOf`); each token's payout " +
  "ceiling from Roles. The agreements are read as payroll.agreements.list reads them (load, settle, the chain).";

const READS_TOUCH = {
  reads: union(SETTLE.reads, READ.reads, AGREEMENTS.reads),
  writes: union(SETTLE.writes, AGREEMENTS.writes),
  drives: union(SETTLE.drives, AGREEMENTS.drives),
  invokes: union(SETTLE.invokes, READ.invokes, AGREEMENTS.invokes),
  emits: AGREEMENTS.emits,
  calls: union(CHAIN_READS.calls, AGREEMENTS.calls),
  chain: union(CHAIN_READS.chain, AGREEMENTS.chain),
  spans: spanUnion(CHAIN_READS.spans, AGREEMENTS.spans),
};
const READS_WAS = [`${ORG_GUARDS}:154`, `${DEP}/reads.ts:285`, `${DEP}/views.ts:1`, ...SETTLE_WAS, ...CHAIN_WAS, ...AGREEMENTS_WAS];

export const rpc_payroll_departments_get = defineRpc({
  id: "payroll.departments.get",
  title: "Read one department as the chain answers now",
  about:
    "Row `payroll.departments.get`, registered as the public action `payroll/departments:get`. " +
    READ_ABOUT +
    " An unknown or abandoned key is INVALID_INPUT. A v4 top budget id a read finds is kept on the department through the " +
    "internal mutation payroll.departments.keepBudgetIds, so a payment can name it (CAP-1165). Answers the department " +
    "with every agreement it holds, ended ones included.",
  was: [`${CONVEX}:14`, `${OPS}/get.ts:23`, `${OPS}/get.ts:36`, `${DEP}/writes/budget-ids.ts:42`, `${ROWS}:245`, `${DSCHEMA}:159`, ...READS_WAS],
  concept: concept_payroll,
  kind: "action",
  who: "A signed-in current participant of the Organization.",
  input: Schema.Struct({ orgId: S, department: S }),
  output: Schema.Struct({ ...Department.fields, items: Schema.Array(Schema.Unknown) }),
  errors: READ_ERRORS,
  ...READS_TOUCH,
});

export const rpc_payroll_departments_list = defineRpc({
  id: "payroll.departments.list",
  title: "List an Organization's departments as the chain answers now",
  about:
    "Row `payroll.departments.list`, registered as the public action `payroll/departments:list`. " +
    READ_ABOUT +
    " Every department that is not abandoned, oldest first, with its offers and running agreements counted. Unlike get, " +
    "list keeps no budget id it finds.",
  was: [`${CONVEX}:15`, `${OPS}/list.ts:16`, `${ROWS}:252`, ...READS_WAS],
  concept: concept_payroll,
  kind: "action",
  who: "A signed-in current participant of the Organization.",
  input: Schema.Struct({ orgId: S }),
  output: Schema.Array(Department),
  errors: READ_ERRORS,
  ...READS_TOUCH,
});

// ── internal ───────────────────────────────────────────────────────────────────────────────

export const rpc_payroll_departments_load = defineRpc({
  id: "payroll.departments.load",
  title: "Read what a Director's department write plans with",
  about:
    "Registered as the internal query `payroll/departments:load`. The company's v4 deployment (null before v4); before v4 " +
    "the owner's Roles module from Permissions (readOwnerRolesModuleInTx). The departments; each named holder email as an " +
    "active member (organizations) with a personal Safe and a label (the Party's display name, else the member's name or " +
    "email), refused INVALID_INPUT when not a member and ROLE_CONFLICT when that Safe holds Manage Budgets (Permissions' " +
    "readManagePeopleHolderSafesInTx); the last applied freeze of a token when asked; the waiting changes; and on v4 the " +
    "execution hash of each active create whose budget id is not kept.",
  was: [`${CONVEX}:16`, `${OPS}/load.ts:13`, ...LOAD_WAS, `${DEP}/errors.ts:52`, `${DEP}/errors.ts:195`],
  concept: concept_payroll,
  kind: "query",
  who: "internal: a department write action runs it with ctx.runQuery (loadCompanyFacts) for the Director.",
  input: Schema.Struct({ authUserId: S, orgId: S, ownerSafe: S, holders: Schema.Array(S), token: opt(S) }),
  output: Schema.Struct({
    rolesModule: Schema.NullOr(S),
    deployment: Schema.NullOr(S),
    departments: Schema.Array(Schema.Unknown),
    holders: Schema.Array(HolderRow),
    lastFreeze: Schema.NullOr(Schema.Struct({ amount: S, left: S, leave: S, timestamp: S })),
    waiting: Schema.Array(Schema.Struct({ kind: ChangeKind, proposalId: S, token: opt(S), departmentId: opt(S) })),
    creations: Schema.Record(S, S),
  }),
  errors: [
    error_INVALID_INPUT,
    error_ROLE_PERMISSION_DENIED,
    error_ROLE_CONFLICT,
    error_WRONG_STATE,
    error_SMART_ACCOUNT_MISSING,
    error_ACCOUNT_NOT_FOUND,
    error_UNKNOWN,
  ],
  reads: LOAD.reads,
  writes: [],
  drives: [],
  invokes: LOAD.invokes,
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_payroll_departments_read = defineRpc({
  id: "payroll.departments.read",
  title: "Read an Organization's departments for a participant",
  about:
    "Registered as the internal query `payroll/departments:read`. requireOrgParticipant (ROLE_PERMISSION_DENIED); the " +
    "departments that are not abandoned, oldest first; the company's stored v4 deployment as JSON (null before v4); and, " +
    "on v4, the operation hash that executed each active create whose budget id is not kept (CAP-1167), read from the " +
    "create change's organizations proposal.",
  was: [`${CONVEX}:19`, `${OPS}/read.ts:20`, `${DEP}/reads.ts:30`, `${DEP}/reads.ts:149`],
  concept: concept_payroll,
  kind: "query",
  who: "internal: a department read action runs it with ctx.runQuery (loadDepartments) for the caller.",
  input: Schema.Struct({ authUserId: S, orgId: S }),
  output: Schema.Struct({ rows: Schema.Array(Schema.Unknown), deploymentJson: Schema.NullOr(S), creations: Schema.Record(S, S) }),
  errors: [error_ROLE_PERMISSION_DENIED, error_UNKNOWN],
  reads: READ.reads,
  writes: [],
  drives: [],
  invokes: READ.invokes,
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_payroll_departments_record = defineRpc({
  id: "payroll.departments.record",
  title: "Save a department change and the Director proposal that carries it",
  about:
    "Registered as the internal mutation `payroll/departments:record`. In one transaction: refuses a v4 create while " +
    "another create or any waiting proposal that creates a hat waits (WRONG_STATE, the office hat id would collide), a " +
    "payout ceiling change a waiting one would undo or that would undo it, and a second close or reopen of a department; " +
    "keeps a budget set's v4 budget id on the department; inserts a create's department (`proposed`, `dep_<ULID>`, a slug " +
    "taken by a department not abandoned is WRONG_STATE); records the Director proposal at the Safe's next free nonce " +
    "through organizations' recordOwnerProposalInTx (subject department_change); inserts the change `proposed`. Then it " +
    "schedules payroll_department_change_proposed. Calls are lower-cased and hex-checked first.",
  was: [`${CONVEX}:20`, `${OPS}/record.ts:20`, `${OPS}/record.ts:86`, `${OPS}/record.ts:99`, ...RECORD_WAS, `${DEP}/errors.ts:103`, `${DEP}/errors.ts:224`],
  concept: concept_payroll,
  kind: "mutation",
  who: "internal: a department write action runs it with ctx.runMutation (recordChange) after its own refusals.",
  input: Schema.Struct({
    method: S,
    authUserId: S,
    owner: Schema.Struct({ orgId: S, chainId: N, safeAddress: S, chainNonce: N, threshold: N, proposer: S }),
    calls: Schema.Array(Schema.Struct({ to: S, value: S, data: S })),
    note: opt(S),
    change: Schema.Struct({
      kind: ChangeKind,
      departmentId: opt(S),
      token: opt(S),
      enablesToken: opt(Schema.Boolean),
      budget: opt(S),
      holder: opt(HolderRow),
      ceiling: opt(S),
      restore: opt(Schema.Struct({ amount: S, left: S, leave: S, timestamp: S })),
      department: opt(
        Schema.Struct({
          name: S,
          slug: S,
          budgets: Schema.Array(Schema.Struct({ token: S, budget: S, period: opt(Schema.Literals(["year", "quarter", "month"])) })),
          holders: Schema.Array(HolderRow),
          hat: opt(S),
        }),
      ),
      budgetId: opt(S),
      coversBudgets: opt(Schema.Boolean),
    }),
  }),
  output: Schema.Struct({ proposal: Schema.Unknown, department: Schema.NullOr(Schema.Unknown) }),
  errors: [error_INVALID_INPUT, error_WRONG_STATE, error_UNKNOWN],
  ...RECORD,
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_payroll_departments_settle = defineRpc({
  id: "payroll.departments.settle",
  title: "Apply or end each waiting department change by its proposal",
  about:
    "Registered as the internal mutation `payroll/departments:settle`. Each waiting change whose organizations proposal " +
    "executed is applied (the department patched: a create activates it, a budget set sets its token's line, a holder is " +
    "added or removed by Safe, close and reopen set `closed`, ceiling changes touch no department) and one whose proposal " +
    "was rejected or replaced is abandoned (an abandoned create abandons its department), in proposal nonce order. An " +
    "applied create, addHolder or removeHolder schedules payroll.departments.notify. Answers how many settled. It reads " +
    "proposals as organizations last stored them; it does not read the chain.",
  was: [`${CONVEX}:26`, `${OPS}/settle.ts:12`, ...SETTLE_WAS],
  concept: concept_payroll,
  kind: "mutation",
  who: "internal: every department action and every agreements action runs it with ctx.runMutation after organizations settled the proposals.",
  input: Schema.Struct({ orgId: S }),
  output: N,
  errors: [error_UNKNOWN],
  ...SETTLE,
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_payroll_departments_keep_budget_ids = defineRpc({
  id: "payroll.departments.keep-budget-ids",
  title: "Keep the v4 top budget ids a chain read found",
  about:
    "Registered as the internal mutation `payroll/departments:keepBudgetIds` (CAP-1165). For each department id with the " +
    "budget id a chain read found: patches budgetId onto the department when it is this Organization's and has none yet. " +
    "Answers null.",
  was: [`${CONVEX}:13`, `${OPS}/keep-budget-ids.ts:12`, `${DEP}/writes/budget-ids.ts:14`, `${DEP}/writes/budget-ids.ts:42`],
  concept: concept_payroll,
  kind: "mutation",
  who: "internal: payroll.departments.get runs it with ctx.runMutation when its read found an id not kept.",
  input: Schema.Struct({ orgId: S, ids: Schema.Array(Schema.Struct({ departmentId: S, budgetId: S })) }),
  output: Schema.Null,
  errors: [error_UNKNOWN],
  reads: [table_payroll_departments],
  writes: [table_payroll_departments],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_payroll_departments_notice_facts = defineRpc({
  id: "payroll.departments.notice-facts",
  title: "Read what an applied department change's holder emails are built from",
  about:
    "Registered as the internal query `payroll/departments:noticeFacts`. Null unless the change is applied, names a " +
    "department and is a create, addHolder or removeHolder. The mailboxes are a create's holders, or the one holder added " +
    "or removed; the department's name and first budget line (amount, the configured asset's symbol and decimals, or " +
    "null); the Organization's name, else its id.",
  was: [`${CONVEX}:17`, `${OPS}/notice-facts.ts:12`, `${DEP}/reads/notices.ts:17`, `${DEP}/reads/notices.ts:50`],
  concept: concept_payroll,
  kind: "query",
  who: "internal: the payroll.departments.notify workflow runs it with ctx.runQuery.",
  input: Schema.Struct({ changeId: S }),
  output: Schema.NullOr(
    Schema.Struct({
      kind: Schema.Literals(["create", "addHolder", "removeHolder"]),
      organizationName: S,
      departmentName: S,
      budget: Schema.NullOr(Schema.Struct({ amount: S, symbol: S, decimals: N })),
      holders: Schema.Array(S),
    }),
  ),
  errors: [error_UNKNOWN],
  reads: [table_payroll_department_changes, table_payroll_departments],
  writes: [],
  drives: [],
  invokes: [procedure_organizations_read_organization_name_in_tx],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_payroll_departments_emit_change_proposed = defineRpc({
  id: "payroll.departments.emit-change-proposed",
  title: "Deliver one department change proposed event after its write commits",
  about:
    "Telemetry plumbing: registered as the internal action `payroll/departments:emitChangeProposed` (CAP-1059). " +
    "departmentChangeProposed schedules it through scheduleTelemetryEmit from the payroll.departments.record transaction, " +
    "so a failed delivery never rolls back or repeats the write. Only durable ids, the Organization and the change word " +
    "(set_budget, add_holder, …) travel. It attributes the event to the Director, marks the Organization verified and posts " +
    "payroll_department_change_proposed awaited. It reads and writes no table.",
  was: [`${CONVEX}:12`, `${OPS}/emit-change-proposed.ts:13`, `${DEP}/events.ts:32`, `${DEP}/events.ts:120`, `${DEP}/events.ts:151`],
  concept: concept_payroll,
  kind: "action",
  who: "internal: scheduled by departmentChangeProposed from the payroll.departments.record transaction.",
  input: Schema.Struct({
    authUserId: S,
    organizationId: S,
    change: Schema.Literals([
      "create",
      "set_budget",
      "add_holder",
      "remove_holder",
      "set_ceiling",
      "freeze_ceiling",
      "unfreeze_ceiling",
      "close",
      "reopen",
    ]),
    changeId: S,
    proposalId: S,
    departmentId: opt(S),
    occurredAt: N,
    observationContext: opt(Schema.Unknown),
  }),
  output: Schema.Void,
  errors: [],
  reads: [],
  writes: [],
  drives: [],
  invokes: [],
  emits: [event_payroll_department_change_proposed],
  calls: [],
  chain: [],
  spans: [],
});

// ── workflows ──────────────────────────────────────────────────────────────────────────────

export const workflow_payroll_departments_notify = defineWorkflow({
  id: "payroll.departments.notify",
  title: "Email the holders an applied department change names",
  about:
    "Registered as the internal action `payroll/departments:notify` (G5). Settling a change schedules it in the same " +
    "transaction for an applied create, addHolder or removeHolder (scheduleDepartmentNoticeInTx, runAfter 0), so a failed " +
    "send never stops or repeats the change. Attributed to the system job `department_holder_notices`. It reads the facts " +
    "(payroll.departments.notice-facts; null sends nothing); a create or an added holder gets `department-holder-added` " +
    "(with the first budget), a removed holder `department-holder-removed`. Sent through deliverNotices with the key " +
    "`payroll.departments.notify:<changeId>`; recipients the provider did not take are retried by scheduling this " +
    "action again for them only, while attempts remain.",
  was: [
    `${CONVEX}:18`,
    `${OPS}/notify.ts:21`,
    `${DEP}/writes/notices.ts:18`,
    `${DEP}/rules/notices.ts:1`,
    `${DEP}/external/notices.ts:23`,
    `${DEP}/reads/notices.ts:68`,
  ],
  concept: concept_payroll,
  priority: "low",
  trigger: { transition: machine_payroll_department_change.t.to_applied },
  instance: { per: table_payroll_department_changes },
  steps: [
    { name: "attribute", about: "Records the run as the system job `department_holder_notices`." },
    { name: "facts", about: "Runs payroll.departments.notice-facts; null ends with { sent: 0, failed: 0 }." },
    { name: "plan", about: "One email to the change's holders: added (with the budget) or removed." },
    { name: "send", about: "deliverNotices, to `only` on a retry." },
    { name: "retry", about: "Recipients the provider did not take: this action again after the retry delay, attempt + 1." },
  ],
  reads: [table_payroll_department_changes, table_payroll_departments],
  writes: [],
  drives: [],
  invokes: [procedure_organizations_read_organization_name_in_tx],
  emits: [],
  calls: [integration_mail.c.deliverNotices],
  chain: [],
  idempotency:
    "None stops a resend: the notice key only names the delivery record. A change not applied sends nothing, and a retry sends only to `only`.",
  timeoutMs: 600000,
  retries: { max: 2, backoff: "exponential" },
});
