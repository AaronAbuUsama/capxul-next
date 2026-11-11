// Moved out of the built book by the cut, 10 November 2026, from books/target/payroll/employees.ts. The records are intact;
// the imports below are as the file had them, so they point at the folder the file was written in (as docs/as-is/archive does).
// What each record became is in docs/cut-archive/INDEX.md.

import { Schema } from "effect";
import { budget, defineRpc } from "../../../packages/book/src/index.ts";
import { concept_payroll } from "../shared/foundation.ts";
import { error_INVALID_INPUT, error_NOT_AUTHENTICATED, error_ROLE_PERMISSION_DENIED, error_WRONG_STATE } from "../shared/vocabulary.ts";
import { table_org_deployments, table_org_members } from "../organizations/data.ts";
import { table_hat_wearers } from "../indexing/data.ts";
import { table_budgets } from "../budgets/data.ts";
import { table_parties } from "../parties/data.ts";
import { procedure_parties_resolve_recipient } from "../parties/procedures.ts";
import {
  machine_employee,
  table_employees,
  table_payroll_changes,
  table_payroll_settings,
  table_salary_slips,
  table_salary_structure_assignments,
  table_salary_structures,
} from "./data.ts";
import { Employee, EmployeeChange, EmployeeInput, EmployeeListInput, EmployeeRef, EmployeeView } from "./shapes.ts";

/**
 * What every write to a Frappe-shaped payroll record also writes: its `payroll-changes` row, numbered under the
 * `payroll-settings` row's lock, so a connected head's sync pushes it in order (payroll.head-sync).
 */
export const LOGGED = [table_payroll_changes, table_payroll_settings] as const;

export const rpc_payroll_employees_add = defineRpc({
  id: "payroll.employees.add",
  title: "Add a person as an Employee of the Organization",
  about:
    HR_GUARD +
    "The person (a mailbox, `@handle`, their Safe's 0x address or a Party id) is resolved through " +
    "`parties.resolve-recipient`: a mailbox no Party holds is named `provisional` at the " +
    "Safe it derives, so a new hire needs no account to be employed or paid (INVALID_INPUT for a locator that names " +
    "nothing, or names an agent, an Organization or an outside address: Frappe's Employee is a person; and for a " +
    "mailbox no account holds whose Safe could never be claimed, not ASCII, since no claim escrow could wait for their " +
    "pay and every run paying them would be INVALID_RECIPIENT: payments.claim-escrow-routes). A person " +
    "who is a live Employee here (not left) is WRONG_STATE naming their `emp_` id; one who left is hired as a new " +
    "Employee, as Frappe does on a rehire (payroll.one-live-employee). `department`, when given, is one of the " +
    "Organization's budgets by key or `dep_…` id (INVALID_INPUT). `employmentType` defaults to `full-time`. Then the " +
    "Employee is born `active` (employee.hire) with the Party's Safe as `payee_safe` and a mailbox locator as " +
    "`personal_email`. It answers the Employee as `payroll.employees.get` does, with a null assignment: a new hire has " +
    "none yet (payroll.command-fit).",
  was: [`${FRAPPE}/employee.json`, `${FRAPPE}/employee.py`],
  concept: concept_payroll,
  kind: "mutation",
  who: WHO_HR,
  input: EmployeeInput,
  output: EmployeeView,
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
    "slip of theirs is paying or escrowed (WRONG_STATE); a withheld slip stays owed after they leave. A move to `left` " +
    "refuses a hosted FDE's act-for call (ROLE_PERMISSION_DENIED): `org hr employee leave` previews, and the preview is " +
    "the asker's own to answer (rules.fde-acts-for-asker). Their Party, Safe and mailbox never change here: pay follows " +
    "the person, not the record (payroll.mailbox-for-pay). It answers the Employee as `payroll.employees.get` does, " +
    "with the assignment that pays them today (payroll.command-fit).",
  was: [`${FRAPPE}/employee.py`],
  concept: concept_payroll,
  kind: "mutation",
  who: WHO_HR,
  input: EmployeeChange,
  output: EmployeeView,
  errors: [...HR_ERRORS],
  reads: [...HR_READS, table_budgets, table_employees, table_salary_slips, table_salary_structure_assignments, table_salary_structures],
  writes: [table_employees, ...LOGGED],
  drives: [machine_employee.t.suspend, machine_employee.t.deactivate, machine_employee.t.reinstate, machine_employee.t.leave],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("write"),
});

export const rpc_payroll_employees_get = defineRpc({
  id: "payroll.employees.get",
  title: "Read one Employee, with their current assignment",
  about:
    HR_GUARD +
    "The Employee by `emp_` id (INVALID_INPUT for one that is not the Organization's, there being no not-found code), " +
    "with their status, joining and relieving days, department, designation and type, whether their Party is still " +
    "provisional (`unclaimed`), and the submitted structure assignment that pays them today: the latest on or before " +
    "today, with the structure it names, or null when none does. It reads only.",
  was: [`${FRAPPE}/employee.json`, "/tmp/hrms/hrms/payroll/doctype/salary_structure_assignment/salary_structure_assignment.json"],
  concept: concept_payroll,
  kind: "query",
  who: WHO_HR,
  input: EmployeeRef,
  output: EmployeeView,
  errors: [error_NOT_AUTHENTICATED, error_ROLE_PERMISSION_DENIED, error_INVALID_INPUT],
  reads: [...HR_READS, table_employees, table_parties, table_salary_structure_assignments, table_salary_structures],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("read"),
});

export const rpc_payroll_employees_list = defineRpc({
  id: "payroll.employees.list",
  title: "List the Organization's Employees",
  about:
    HR_GUARD +
    "The Organization's Employees, by department and name, `left` ones only when asked for by status. `unclaimed` " +
    "says the person's Party is still provisional (no account yet), read from parties. A page at a time: at most " +
    "`limit` (1 to 100, 25 by default) after the cursor `after` (INVALID_INPUT for one this list did not give), and " +
    "`nextCursor` the next page's `after`, null on the last, as every list's (payroll.command-fit). It reads only.",
  was: [`${FRAPPE}/employee.json`],
  concept: concept_payroll,
  kind: "query",
  who: WHO_HR,
  input: EmployeeListInput,
  output: Schema.Struct({ items: Schema.Array(Employee), nextCursor: Schema.NullOr(Schema.String) }),
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
