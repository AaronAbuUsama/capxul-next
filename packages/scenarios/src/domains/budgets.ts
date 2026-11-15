// The scenarios of the blueprint's domain "budgets" (a company's budgets on the world's chain, and proposing a new
// one): the checks of each of its operations, the journeys it leads, and where each claim of its operations is checked
// (../domain.ts). ../domains.ts lists it once.
import type { Budgets } from "@capxul/blueprint";
import { orgBudgetCreate } from "../checks/org-budget-create.ts";
import { orgBudgetList } from "../checks/org-budget-list.ts";
import { orgBudgetShow } from "../checks/org-budget-show.ts";
import { at, type Domain } from "../domain.ts";
import { budgetSam } from "../journeys/budget-sam.ts";

/** The checks of each of its operations. */
export const checks: Domain<typeof Budgets>["checks"] = {
  "org.budget.create": orgBudgetCreate,
  "org.budget.show": orgBudgetShow,
  "org.budget.list": orgBudgetList,
};

/** The journeys it leads, in the order they run. */
export const journeys: Domain<typeof Budgets>["journeys"] = [budgetSam];

/** Where each claim of each of its operations is checked, in claims.md's order. */
export const coverage: Domain<typeof Budgets>["coverage"] = {
  "org.budget.create": [
    at(["org.budget.create"], [budgetSam, 4]),
    at(["approval.sign", "org.budget.show"], [budgetSam, 5], [budgetSam, 6]),
    at(["org.budget.create"], [budgetSam, 3]),
    at(["org.budget.create"], [budgetSam, 3]),
    at(["org.budget.create"], [budgetSam, 3], [budgetSam, 8]),
    at(["org.budget.create"], [budgetSam, 8]),
  ],
  "org.budget.show": [at(["org.budget.show"], [budgetSam, 2], [budgetSam, 6]), at(["org.budget.show"], [budgetSam, 2])],
  "org.budget.list": [at(["org.budget.list"], [budgetSam, 1], [budgetSam, 7]), at(["org.budget.list"], [budgetSam, 1])],
};
