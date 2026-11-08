// The employees area: Frappe's Employee, kept by Capxul. A People hat wearer (Frappe's HR Manager)
// adds a person as an Employee, changes their department, designation or employment type, and moves
// their status; any of them lists the Organization's Employees. An agreement's acceptance also hires its
// payee (processes.ts). Each write is one rpc and one transaction; none touches the chain.
//
// The person is named by mailbox, `@handle` or Party id and resolved through parties' door, so a new hire
// with no account is a provisional Party at the Safe their mailbox derives, and pay to them waits in a
// claim escrow until they claim it (payroll.new-hire-escrow, aaron.budget-pay-unclaimed).

import { Schema } from "effect";
import { budget, defineRpc } from "../../../packages/book/src/index.ts";
import { concept_payroll } from "../shared/foundation.ts";
import { error_INVALID_INPUT, error_NOT_AUTHENTICATED, error_ROLE_PERMISSION_DENIED, error_WRONG_STATE } from "../shared/vocabulary.ts";
import { table_org_deployments, table_org_members } from "../organizations/data.ts";
import { table_hat_wearers } from "../indexing/data.ts";
import { table_budgets } from "../budgets/data.ts";
import { table_parties } from "../parties/data.ts";
import { procedure_parties_resolve_recipient } from "../parties/procedures.ts";
import { machine_employee, table_employees, table_payroll_changes, table_payroll_settings, table_salary_slips } from "./data.ts";
import { Employee, EmployeeChange, EmployeeInput, EmployeeListInput } from "./shapes.ts";

const FRAPPE = "/tmp/erpnext/erpnext/setup/doctype/employee";

/** Who may change an Organization's payroll records: the People hat, Frappe's HR Manager (payroll.hr-authority). */
export const WHO_HR =
  "A signed-in member of the Organization, person or agent, whose own Safe wears its People hat (Frappe's HR Manager), " +
  "read from the deployment's `people_hat` and indexing's hat-wearers; the founder wears it from setup.";

/** The guard every payroll HR write and read runs first. */
export const HR_GUARD =
  "The caller must hold an active Seat in the Organization whose Safe wears its People hat (ROLE_PERMISSION_DENIED, " +
  "nothing read or written otherwise). ";

/** What the People hat check reads. */
export const HR_READS = [table_org_members, table_org_deployments, table_hat_wearers] as const;

/**
 * What every write to a Frappe-shaped payroll record also writes: its `payroll-changes` row, numbered under the
 * `payroll-settings` row's lock, so a connected head's sync pushes it in order (payroll.head-sync).
 */
export const LOGGED = [table_payroll_changes, table_payroll_settings] as const;

export const HR_ERRORS = [error_NOT_AUTHENTICATED, error_ROLE_PERMISSION_DENIED, error_INVALID_INPUT, error_WRONG_STATE] as const;

export const rpc_payroll_employees_add = defineRpc({
  id: "payroll.employees.add",
  title: "Add a person as an Employee of the Organization",
  about:
    HR_GUARD +
    "The person is resolved through `parties.resolve-recipient`: a mailbox no Party holds is named `provisional` at the " +
    "Safe it derives, so a new hire needs no account to be employed or paid (INVALID_INPUT for a locator that names " +
    "nothing, or names an agent, an Organization or an outside address: Frappe's Employee is a person). A person " +
    "who is a live Employee here (not left) is WRONG_STATE naming their `emp_` id; one who left is hired as a new " +
    "Employee, as Frappe does on a rehire (payroll.one-live-employee). `department`, when given, is one of the " +
    "Organization's budgets by key or `dep_…` id (INVALID_INPUT). `employmentType` defaults to `full-time`. Then the " +
    "Employee is born `active` (employee.hire) with the Party's Safe as `payee_safe` and a mailbox locator as " +
    "`personal_email`.",
  was: [`${FRAPPE}/employee.json`, `${FRAPPE}/employee.py`],
  concept: concept_payroll,
  kind: "mutation",
  who: WHO_HR,
  input: EmployeeInput,
  output: Schema.Struct({ employee: Employee }),
  errors: [...HR_ERRORS],
  reads: [...HR_READS, table_budgets, table_employees],
  writes: [table_employees, ...LOGGED],
  drives: [machine_employee.t.hire],
  invokes: [procedure_parties_resolve_recipient],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("write"),
});

export const rpc_payroll_employees_change = defineRpc({
  id: "payroll.employees.change",
  title: "Change an Employee's department, designation, type or status",
  about:
    HR_GUARD +
    "The Employee must be the Organization's (INVALID_INPUT). `status` moves as machine employee allows (WRONG_STATE " +
    "otherwise, naming the status it is in): `suspended`, `inactive`, back to `active`, or `left` with " +
    "`relievingDate`, the last day worked, on or after `date_of_joining` (INVALID_INPUT). Leaving is refused while a " +
    "slip of theirs is paying, escrowed or withheld, or holds a lapsed Payment (WRONG_STATE). Their Party, Safe and mailbox never change here: pay follows " +
    "the person, not the record (payroll.mailbox-for-pay).",
  was: [`${FRAPPE}/employee.py`],
  concept: concept_payroll,
  kind: "mutation",
  who: WHO_HR,
  input: EmployeeChange,
  output: Schema.Struct({ employee: Employee }),
  errors: [...HR_ERRORS],
  reads: [...HR_READS, table_budgets, table_employees, table_salary_slips],
  writes: [table_employees, ...LOGGED],
  drives: [machine_employee.t.suspend, machine_employee.t.deactivate, machine_employee.t.reinstate, machine_employee.t.leave],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("write"),
});

export const rpc_payroll_employees_list = defineRpc({
  id: "payroll.employees.list",
  title: "List the Organization's Employees",
  about:
    HR_GUARD +
    "The Organization's Employees, by department and name, `left` ones only when asked for by status. `unclaimed` " +
    "says the person's Party is still provisional (no account yet), read from parties. It reads only.",
  was: [`${FRAPPE}/employee.json`],
  concept: concept_payroll,
  kind: "query",
  who: WHO_HR,
  input: EmployeeListInput,
  output: Schema.Struct({ items: Schema.Array(Employee) }),
  errors: [error_NOT_AUTHENTICATED, error_ROLE_PERMISSION_DENIED, error_INVALID_INPUT],
  reads: [...HR_READS, table_employees, table_parties],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("read"),
});
