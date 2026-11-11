// The employees area: Frappe's Employee, kept by Capxul. A People hat wearer (Frappe's HR Manager)
// adds a person as an Employee, changes their department, designation or employment type, and moves
// their status; any of them lists the Organization's Employees. An agreement's acceptance also hires its
// payee (processes.ts). Each write is one rpc and one transaction; none touches the chain.
//
// The person is named by mailbox, `@handle` or Party id and resolved through parties' door, so a new hire
// with no account is a provisional Party at the Safe their mailbox derives, and pay to them waits in a
// claim escrow until they collect it, at setup or later with `payment claim` (payroll.new-hire-escrow, aaron.budget-pay-unclaimed).

import { Schema } from "effect";
import { budget, defineRpc } from "../../../packages/blueprint-engine/src/index.ts";
import { concept_payments } from "../../shared/foundation.ts";
import { error_INVALID_INPUT, error_NOT_AUTHENTICATED, error_ROLE_PERMISSION_DENIED, error_WRONG_STATE } from "../../shared/vocabulary.ts";
import { table_org_deployments, table_org_members } from "../../organizations/data.ts";
import { table_hat_wearers } from "../../indexing/data.ts";
import { table_budgets } from "../../budgets/data.ts";
import { table_parties } from "../../parties/data.ts";
import { procedure_parties_resolve_recipient } from "../../parties/procedures.ts";
import { Employee, EmployeeChange, EmployeeInput, EmployeeListInput, EmployeeRef, EmployeeView } from "./shapes.ts";

const FRAPPE = "/tmp/erpnext/erpnext/setup/doctype/employee";

/** Who may change an Organization's payroll records: the People hat, Frappe's HR Manager (payroll.hr-authority). */
export const WHO_HR =
  "A signed-in member of the Organization, person or agent, whose own Safe wears its People hat (Frappe's HR Manager), " +
  "read from the deployment's `people_hat` and indexing's hat-wearers; the founder wears it from setup. The hat " +
  "decides, never the person: a self-run agent only once the Board granted its Safe the hat; the hosted FDE only as " +
  "an asker who wears it (rules.fde-acts-for-asker).";

/** The guard every payroll HR write and read runs first. */
export const HR_GUARD =
  "The caller must hold an active Seat in the Organization whose Safe wears its People hat (ROLE_PERMISSION_DENIED, " +
  "nothing read or written otherwise). ";

/** What the People hat check reads. */
export const HR_READS = [table_org_members, table_org_deployments, table_hat_wearers] as const;

export const HR_ERRORS = [error_NOT_AUTHENTICATED, error_ROLE_PERMISSION_DENIED, error_INVALID_INPUT, error_WRONG_STATE] as const;

