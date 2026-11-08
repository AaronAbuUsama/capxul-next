// The tree area: the writes any budget takes whatever it is (a top budget, a department, a team or an
// allowance): its amount, close and reopen; and the tree read. `org department budget set` and
// `org allowance change` are both a budget's new amount, so both flows call `set-amount`; `org
// department close` also closes an allowance's budget (decision budgets.one-write-per-chain-call).

import { budget, defineRpc } from "../../../packages/book/src/index.ts";
import { concept_budgets } from "../shared/foundation.ts";
import { contract_budgets, contract_installer, contract_roles, integration_chain_rpc } from "../shared/external.ts";
import {
  error_AMOUNT_BELOW_USE,
  error_CHILDREN_EXCEED_PARENT,
  error_INVALID_INPUT,
  error_TOKEN_NOT_SUPPORTED,
} from "../shared/vocabulary.ts";
import { table_org_members, table_organizations } from "../organizations/data.ts";
import { table_principals } from "../access/data.ts";
import { table_chain_agreements, table_chain_budgets, table_hat_wearers } from "../indexing/data.ts";
import { procedure_approvals_open } from "../approvals/procedures.ts";
import { procedure_board_propose } from "../board/procedures.ts";
import { machine_budget_change, table_budget_changes, table_budgets } from "./data.ts";
import { AmountPrepared, BudgetWriteInput, DepartmentTree, OpenStatePrepared, SetAmountInput, ShowInput } from "./shapes.ts";
import { BIRTH, GUARD, READ_ERRORS, SIGNER_RULE, WRITE_ERRORS, WRITE_READS } from "./departments.ts";

const PAY = "packages/backend/src/payroll/departments";
const PERM = "packages/backend/src/permissions/allowances";

const WHO_ABOVE =
  "The office above the budget: for a top budget, a Director (the Board signs); for any other budget, the wearer of its " +
  "parent's office hat or of any hat above it (their own Safe signs), or a Director (the Board signs).";

/** A write that changes one budget, with the Board's or the office holder's carrier. */
const ONE_BUDGET = {
  writes: [table_budget_changes],
  drives: [machine_budget_change.t.propose],
  invokes: [procedure_board_propose, procedure_approvals_open],
  emits: [],
  calls: [integration_chain_rpc.c.readContract],
  spans: [],
} as const;

/** What a write on an existing budget checks first. */
const FINDS =
  "The budget is the Organization's, by key, id or chain id (INVALID_INPUT unknown); one still proposed is WRONG_STATE " +
  "(its create has not executed); a change of it already waiting is WRONG_STATE, naming that proposal.";

// ── amount ──────────────────────────────────────────────────────────────────────────────────

export const rpc_budgets_tree_set_amount = defineRpc({
  id: "budgets.tree.set-amount",
  title: "Prepare a budget's new amount per its period",
  about:
    GUARD + " " + FINDS + " " + SIGNER_RULE + " A budget keeps its token and period: a `--token` or period that is not its " +
    "own is INVALID_INPUT, a token the deployment does not admit TOKEN_NOT_SUPPORTED. From `Budgets.budgetOf` and `leftOf` " +
    "now: an amount below what it spent, committed and gave its children this period is AMOUNT_BELOW_USE (naming both); " +
    "a raise its parent has no room to give is CHILDREN_EXCEED_PARENT (naming what is left). The call is " +
    "`Budgets.setAmount(id, amount)`. A top budget's change also moves its token's payout ceiling by the same difference " +
    "(`Installer.buildSetCeiling`, from the Roles allowance as it is now), in the same Board proposal, so no other write " +
    "to that ceiling may wait (WRONG_STATE, naming it: a waiting freeze too). " + BIRTH,
  was: [`${PAY}/operations/set-budget.ts:1`, `${PERM}/operations/change.ts:1`, "books/as-is/payroll/departments.ts:384"],
  concept: concept_budgets,
  kind: "action",
  who: WHO_ABOVE,
  input: SetAmountInput,
  output: AmountPrepared,
  errors: [...WRITE_ERRORS, error_AMOUNT_BELOW_USE, error_CHILDREN_EXCEED_PARENT, error_TOKEN_NOT_SUPPORTED],
  reads: [...WRITE_READS],
  ...ONE_BUDGET,
  chain: [
    contract_budgets.f.budgetOf,
    contract_budgets.f.leftOf,
    contract_budgets.f.authorised,
    contract_roles.f.allowances,
    contract_installer.f.buildSetCeiling,
    contract_roles.f.setAllowance,
    contract_budgets.f.setAmount,
  ],
  budget: budget("chain-read"),
});

// ── close and reopen ────────────────────────────────────────────────────────────────────────

const OPEN_STATE =
  "Running agreements keep paying until they end; the count of them comes from indexing's agreements of the budget.";

export const rpc_budgets_tree_close = defineRpc({
  id: "budgets.tree.close",
  title: "Prepare closing a budget",
  about:
    GUARD + " " + FINDS + " " + SIGNER_RULE + " A budget the chain already holds closed is WRONG_STATE (`closed`) and " +
    "proposes nothing. The one call is `Budgets.close(id)` on the budget's own id: nothing new is spent, committed or " +
    "created under it, and it keeps its amount. " + OPEN_STATE + " " + BIRTH,
  was: [`${PAY}/operations/close.ts:1`, "books/as-is/payroll/departments.ts:544"],
  concept: concept_budgets,
  kind: "action",
  who: WHO_ABOVE,
  input: BudgetWriteInput,
  output: OpenStatePrepared,
  errors: [...WRITE_ERRORS],
  reads: [...WRITE_READS, table_chain_agreements],
  ...ONE_BUDGET,
  chain: [contract_budgets.f.budgetOf, contract_budgets.f.authorised, contract_budgets.f.close],
  budget: budget("chain-read"),
});

export const rpc_budgets_tree_reopen = defineRpc({
  id: "budgets.tree.reopen",
  title: "Prepare reopening a closed budget",
  about:
    GUARD + " " + FINDS + " " + SIGNER_RULE + " A budget the chain holds open is WRONG_STATE (`open`) and proposes " +
    "nothing. The one call is `Budgets.reopen(id)` on the budget's own id: it can spend and commit again. " + BIRTH,
  was: [`${PAY}/operations/reopen.ts:1`, "books/as-is/payroll/departments.ts:570"],
  concept: concept_budgets,
  kind: "action",
  who: WHO_ABOVE,
  input: BudgetWriteInput,
  output: OpenStatePrepared,
  errors: [...WRITE_ERRORS],
  reads: [...WRITE_READS, table_chain_agreements],
  ...ONE_BUDGET,
  chain: [contract_budgets.f.budgetOf, contract_budgets.f.authorised, contract_budgets.f.reopen],
  budget: budget("chain-read"),
});

// ── the tree ────────────────────────────────────────────────────────────────────────────────

export const rpc_budgets_tree_show = defineRpc({
  id: "budgets.tree.show",
  title: "Read the budget tree, or one budget and everything under it",
  about:
    GUARD + " The roots are the company Safe's top budgets in indexing (one tree per token and period), or the one budget " +
    "asked for (INVALID_INPUT naming it when no budget of the Organization has that key, id or chain id). Every read goes " +
    "to the chain again: `Budgets.childrenOf`, `budgetOf` and `leftOf` at the latest block, concurrently, so a release, a " +
    "payout or a new team shows on the next read. Each node shows its amount, what its children hold, what it spent and " +
    "committed this period and what is left, open or closed, its office hat's wearers, and offers and running agreements " +
    "from indexing. A department whose create waits reads as proposed, with its planned amount. Each tree shows its " +
    "token's payout ceiling from `Roles.allowances`: frozen when it has no refill, with what is left. With `at`, spent and " +
    "committed are those of the period that holds that date, from indexing's spends; amounts are the chain's now. " +
    "Nothing is written.",
  was: [`${PAY}/operations/get.ts:1`, `${PAY}/external/budget-reads.ts:1`, "books/as-is/payroll/departments.ts:617"],
  concept: concept_budgets,
  kind: "action",
  who: "Any member of the Organization.",
  input: ShowInput,
  output: DepartmentTree,
  errors: [...READ_ERRORS, error_INVALID_INPUT],
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
  chain: [contract_budgets.f.childrenOf, contract_budgets.f.budgetOf, contract_budgets.f.leftOf, contract_roles.f.allowances],
  spans: [],
  budget: budget("chain-read"),
});
