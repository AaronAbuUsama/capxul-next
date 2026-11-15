// Core's handlers of the blueprint's domain "budgets" (src/budgets): a company's budgets on the world's chain, and
// proposing a new one, which lands through approval.sign as a `budget_creation` (src/budgets/landed.ts).
import { budgetsHandlers } from "../budgets/handlers.ts";

/** Its share of the world group. */
export const world = budgetsHandlers;
