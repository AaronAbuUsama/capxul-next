// The departments area: creating a department (a top budget, or a team inside one) and listing the
// Organization's departments. A department is a v4 budget whose office hat its holders wear; the
// generic writes on any budget (amount, close, reopen) are in tree.ts, its holders in offices.ts.
//
// A write is one rpc and one transaction (A3): it refuses before anything is saved, reads what the
// chain holds now, builds the calls, and births the change with the Board proposal that carries it
// (`board.propose`) or the office holder's own approval (`approvals.open`). Nothing is on chain when
// it returns; the change's process follows the carrier (processes.ts), the SDK flow the signature
// and the wait (flows.ts).

import { budget, defineRpc } from "../../../packages/book/src/index.ts";
import { concept_budgets } from "../shared/foundation.ts";
import {
  contract_budgets,
  contract_hats,
  contract_installer,
  contract_roles,
  integration_chain_rpc,
  integration_indexer,
} from "../shared/external.ts";
import {
  error_CHILDREN_EXCEED_PARENT,
  error_INVALID_INPUT,
  error_NOT_AUTHENTICATED,
  error_PROVIDER_ERROR,
  error_PROVIDER_RESPONSE_INVALID,
  error_ROLE_CONFLICT,
  error_ROLE_PERMISSION_DENIED,
  error_TOKEN_NOT_SUPPORTED,
  error_WRONG_STATE,
} from "../shared/vocabulary.ts";
import { table_principals } from "../access/data.ts";
import { table_org_deployments, table_org_members, table_organizations } from "../organizations/data.ts";
import { table_chain_agreements, table_chain_budgets, table_chain_hats, table_hat_wearers } from "../indexing/data.ts";
import { procedure_approvals_open } from "../approvals/procedures.ts";
import { procedure_board_propose } from "../board/procedures.ts";
import { machine_budget, machine_budget_change, table_budget_changes, table_budgets } from "./data.ts";
import { CreateDepartmentInput, DepartmentCreated, DepartmentList, OrgInput } from "./shapes.ts";

const PAY = "packages/backend/src/payroll/departments";
const AS_IS = "docs/as-is/archive/payroll/departments.ts";

/** The errors every budgets read raises: the guard, and the chain or Ponder failing to answer. */
export const READ_ERRORS = [error_NOT_AUTHENTICATED, error_ROLE_PERMISSION_DENIED, error_PROVIDER_ERROR, error_PROVIDER_RESPONSE_INVALID] as const;

/** The errors every budgets write raises before the ones its own rules add. */
export const WRITE_ERRORS = [...READ_ERRORS, error_INVALID_INPUT, error_WRONG_STATE] as const;

/** Who is asking: a current Seat of the Organization, by the session's principal; the rest is the chain's. */
export const GUARD =
  "The session's principal must hold a current Seat of the Organization (ROLE_PERMISSION_DENIED otherwise: an outsider " +
  "learns nothing).";

/** How a write decides who signs, from the chain: the office above the budget, else the Board. */
export const SIGNER_RULE =
  "Who signs is the chain's rule: the Board (a Director proposes) for a top budget, a payout ceiling and a hat under the " +
  "Board's top hat; for a team, the caller's own Safe when `Budgets.authorised` says it acts for the parent, else the " +
  "Board when the caller is a Director; anyone else is ROLE_PERMISSION_DENIED. Nobody acts on their own budget.";

/** What every write does once its rules pass. */
export const BIRTH =
  "Then, in one transaction, the change is born proposed (budget-change.propose) with `board.propose` (the Board " +
  "proposal and the caller's first approval) or `approvals.open` (the caller's own approval and its page summary). A " +
  "repeated request key answers that change; a key naming another is INVALID_INPUT, an abandoned one WRONG_STATE.";

/** The reads every write makes to authorize and plan. */
export const WRITE_READS = [
  table_org_members,
  table_principals,
  table_organizations,
  table_org_deployments,
  table_budgets,
  table_budget_changes,
  table_chain_budgets,
  table_hat_wearers,
] as const;

// ── create ──────────────────────────────────────────────────────────────────────────────────

export const rpc_budgets_departments_create = defineRpc({
  id: "budgets.departments.create",
  title: "Prepare a department: a top budget, or a team inside one",
  about:
    GUARD + " " + SIGNER_RULE + " Refused before anything is saved: a key (from the name) a live or proposed budget " +
    "has, a create waiting under the same admin hat, or for a top budget another write waiting on its token's ceiling " +
    "(WRONG_STATE, naming it); an amount of 0 or a week, `--token` with a parent, a parent that is not an active budget " +
    "here or is eight deep, a holder who is not a current member with a set-up Safe (INVALID_INPUT); a holder wearing " +
    "the People hat (ROLE_CONFLICT, naming them); an unadmitted token (TOKEN_NOT_SUPPORTED); a closed parent or one above " +
    "it (WRONG_STATE); a parent with less left to give than the amount (`budgetOf` and `leftOf` now; " +
    "CHILDREN_EXCEED_PARENT). The hat id is planned from its admin's `Hats.viewHat` `lastHatId` now; indexing is read " +
    "at the head (`Indexer.head`). The calls: " +
    "`Hats.createHat`, `Hats.mintHat` per holder, then `Budgets.createChildBudget(parent, amount, hat)`, or " +
    "`Budgets.createTopBudget(token, period, amount, hat)` with the ceiling grown by `Installer.buildSetCeiling`, or set " +
    "up by `buildAddToken` for a token's first budget. " + BIRTH + " The budget is born proposed with no chain id.",
  was: [`${PAY}/operations/create.ts:1`, `${PAY}/rules.ts:64`, `${PAY}/writes.ts:108`, `${AS_IS}:350`],
  concept: concept_budgets,
  kind: "action",
  who:
    "For a top budget, a Director of the Organization (the Board signs). For a team, the wearer of the parent budget's " +
    "office hat or of any hat above it (their own Safe signs), or a Director (the Board signs).",
  input: CreateDepartmentInput,
  output: DepartmentCreated,
  errors: [...WRITE_ERRORS, error_ROLE_CONFLICT, error_TOKEN_NOT_SUPPORTED, error_CHILDREN_EXCEED_PARENT],
  reads: [...WRITE_READS, table_chain_hats],
  writes: [table_budgets, table_budget_changes],
  drives: [machine_budget.t.propose, machine_budget_change.t.propose],
  invokes: [procedure_board_propose, procedure_approvals_open],
  emits: [],
  calls: [integration_chain_rpc.c.readContract, integration_indexer.c.head],
  chain: [
    contract_budgets.f.budgetOf,
    contract_budgets.f.leftOf,
    contract_budgets.f.authorised,
    contract_roles.f.allowances,
    contract_installer.f.buildAddToken,
    contract_installer.f.buildSetCeiling,
    contract_roles.f.setAllowance,
    contract_hats.f.viewHat,
    contract_hats.f.createHat,
    contract_hats.f.mintHat,
    contract_budgets.f.createTopBudget,
    contract_budgets.f.createChildBudget,
  ],
  spans: [],
  budget: budget("chain-read"),
});

// ── list ────────────────────────────────────────────────────────────────────────────────────

export const rpc_budgets_departments_list = defineRpc({
  id: "budgets.departments.list",
  title: "List the Organization's departments as the chain answers now",
  about:
    GUARD + " Every member reads the same list, Director or not. Each department Capxul made, active or proposed, and " +
    "each budget made outside Capxul (by its chain id, with no name), from indexing's budgets of the company Safe joined " +
    "to the budgets table by chain id. An active one's amount, what its children hold, what it spent and committed this " +
    "period and what is left come from `Budgets.budgetOf` and `leftOf` at the chain's latest block, read concurrently, so " +
    "a missed or reordered event changes nothing; a proposed one shows its create's planned amount. Holders are the office " +
    "hat's wearers (indexing), named by their Seat's email where they have one. Offers and running agreements are counted " +
    "from indexing's agreements of each budget. Allowances are listed by `org allowance list`, not here. Nothing is " +
    "written and no product event is sent.",
  was: [`${PAY}/operations/list.ts:1`, `${PAY}/reads.ts:30`, `${PAY}/external/budget-reads.ts:1`, `${AS_IS}:636`],
  concept: concept_budgets,
  kind: "action",
  who: "Any member of the Organization.",
  input: OrgInput,
  output: DepartmentList,
  errors: [...READ_ERRORS],
  reads: [
    table_org_members,
    table_principals,
    table_organizations,
    table_budgets,
    table_budget_changes,
    table_chain_budgets,
    table_hat_wearers,
    table_chain_agreements,
  ],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [integration_chain_rpc.c.readContract],
  chain: [contract_budgets.f.budgetOf, contract_budgets.f.leftOf],
  spans: [],
  budget: budget("chain-read"),
});
