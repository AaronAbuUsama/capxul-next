// What an approval of the domain "budgets" authorises (`Subject` in ../values.ts): a budget's creation by its id
// (`org.budget.create`).
import * as Schema from "effect/Schema";
import { BudgetCreationId } from "../ids.ts";

export const subjects = [Schema.Struct({ kind: Schema.Literal("budget_creation"), id: BudgetCreationId })] as const;
