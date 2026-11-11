// The roles a person takes in an Organization: the hats, and the Frappe roles each gives on the site. Each record is
// the map the site app ships today (packages/frappe-app/capxul/setup.py, DEFAULT_HAT_ROLES); `pnpm frappe:check-blueprint`
// fails the merge on any difference. The target decides each hat's roles from its jobs, one eval per job
// (plugs.hat-roles-by-job, table hat-role-map).

import { defineRole } from "../../packages/blueprint-engine/src/index.ts";
import { concept_plugs } from "../shared/foundation.ts";

const concept = concept_plugs;

export const role_admin = defineRole({
  id: "admin",
  title: "Director (the admin hat)",
  about: "Runs the Organization: every part's manager role, so the Director can set up suppliers, people, sales, projects and stock.",
  concept,
  frappeRoles: [
    "System Manager", "Accounts Manager", "Accounts User", "HR Manager", "HR User", "Purchase Manager", "Purchase User", "Purchase Master Manager",
    "Sales Manager", "Sales User", "Projects Manager", "Stock Manager", "Manufacturing Manager",
  ],
});
export const role_budget_holder = defineRole({
  id: "budget-holder",
  title: "Budget holder",
  about: "Spends a budget: raises purchases and approves expense claims.",
  concept,
  frappeRoles: ["Accounts User", "Purchase User", "Expense Approver"],
});
export const role_payroll_approver = defineRole({
  id: "payroll-approver",
  title: "Payroll approver",
  about: "Approves the payroll run.",
  concept,
  frappeRoles: ["HR Manager", "HR User"],
});
export const role_member = defineRole({
  id: "member",
  title: "Member",
  about: "Every person in the Organization: their own staff record, leave and expenses.",
  concept,
  frappeRoles: ["Employee"],
});
export const role_sales = defineRole({
  id: "sales",
  title: "Sales",
  about: "Works leads and deals in the CRM and raises sales invoices.",
  concept,
  frappeRoles: ["Sales User", "Sales Manager", "Accounts User"],
});
export const role_hr_manager = defineRole({
  id: "hr-manager",
  title: "HR manager",
  about: "Keeps the staff records and their leave.",
  concept,
  frappeRoles: ["HR Manager", "HR User", "Employee"],
});
export const role_project_manager = defineRole({
  id: "project-manager",
  title: "Project manager",
  about: "Runs projects and their tasks.",
  concept,
  frappeRoles: ["Projects Manager", "Projects User", "Employee"],
});
