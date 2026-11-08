// The budgets area: the emails that tell a member they now hold, or no longer hold, a budget's
// office. One workflow follows budgets' `apply`: only budgets knows which proposal carried an
// allowance assign, to whom and on which budget (budgets.notices-need-budgets,
// dependencies.notices-budgets). The amount is the chain's now, read when the email is sent, so a
// change that applied before it is already in it (`org allowance assign` #5).

import { table_principals } from "../access/data.ts";
import { machine_budget_change, table_budget_changes, table_budgets } from "../budgets/data.ts";
import { table_org_members, table_organizations } from "../organizations/data.ts";
import { contract_budgets } from "../shared/external.ts";
import { noticeWorkflow } from "./kit.ts";

const OLD = "packages/backend/src";

export const workflow_notices_budgets_office_changed = noticeWorkflow({
  id: "notices.budgets.office-changed",
  title: "Tell a member they were given or relieved of a budget's office",
  about:
    "Follows `apply`: a budget change's Board proposal or approval executed. Only a change that names holders sends " +
    "anything: an allowance's `create` with holders or `add_holder` sends `allowance-assigned` to each new holder, with " +
    "the allowance's name, token, period and its amount now (`Budgets.budgetOf` through chain-rpc, after any change that " +
    "applied); a department's or team's `create` with holders or `add_holder` sends `department-holder-added`; a " +
    "department's `remove_holder` sends `department-holder-removed`. An allowance's `remove_holder` (`org allowance " +
    "revoke`), amounts, closes, reopens and payout ceilings send nothing, as before. Holders are members: each Seat's " +
    "principal and its email; an agent holder is told nothing.",
  trigger: { transition: machine_budget_change.t.apply },
  reads: [table_budget_changes, table_budgets, table_org_members, table_organizations, table_principals],
  steps: [
    {
      name: "change",
      about: "Reads the applied change: its kind, the budget it applied to and the holders its terms name; any other kind ends here.",
    },
    {
      name: "amount",
      about: "For an allowance, its amount, token and period now from `Budgets.budgetOf(budget_id)`, read at `latest`.",
    },
    {
      name: "holders",
      about: "Each holder's Seat (by member id) to its principal and that principal's email, and the Organization's name.",
    },
  ],
  chain: [contract_budgets.f.budgetOf],
  was: [
    `${OLD}/organizations/proposals/rules/notices.ts:218`,
    `${OLD}/payroll/departments/rules/notices.ts:1`,
    `${OLD}/payroll/departments/operations/notify.ts:1`,
    "books/target/budgets/decisions.ts (budgets.notices-need-budgets)",
  ],
});
