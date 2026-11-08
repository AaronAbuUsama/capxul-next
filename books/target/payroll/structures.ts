// The structures area: Frappe's Salary Component, Salary Structure and Salary Structure Assignment,
// kept by Capxul. A People hat wearer defines the components (each earning, deduction and employer
// contribution), the structures that combine them, and which structure pays each Employee from which
// day and on what base. Structures and assignments are written submitted, as Frappe's submitted
// documents, and are never edited: a change is a new one (payroll.frappe-doctypes).
//
// A formula or condition is kept as Frappe writes it. Capxul works out only the portable subset, which
// Frappe evaluates identically (payroll.portable-formulas); anything else is kept for a head to compute.

import { Schema } from "effect";
import { budget, defineRpc } from "../../../packages/book/src/index.ts";
import { concept_payroll } from "../shared/foundation.ts";
import { error_INVALID_INPUT, error_NOT_AUTHENTICATED, error_ROLE_PERMISSION_DENIED, error_TOKEN_NOT_BUDGETED } from "../shared/vocabulary.ts";
import { table_budgets } from "../budgets/data.ts";
import { table_book_accounts, table_book_companies } from "../books/data.ts";
import { procedure_parties_resolve_recipient } from "../parties/procedures.ts";
import {
  machine_salary_structure,
  machine_salary_structure_assignment,
  table_employees,
  table_salary_components,
  table_salary_slips,
  table_salary_structure_assignments,
  table_salary_structures,
} from "./data.ts";
import { HR_ERRORS, HR_GUARD, HR_READS, LOGGED, WHO_HR } from "./employees.ts";
import { Assignment, AssignmentInput, CancelInput, Component, ComponentInput, Structure, StructureInput, StructureListInput } from "./shapes.ts";

const FRAPPE = "/tmp/hrms/hrms/payroll/doctype";

export const rpc_payroll_structures_component = defineRpc({
  id: "payroll.structures.component",
  title: "Add or change a salary component",
  about:
    HR_GUARD +
    "A component has a name and an abbreviation unique in the Organization (INVALID_INPUT naming the other), a type, " +
    "and either a fixed `amount` or a `formula`, with an optional `condition`. Each is parsed: one inside the portable " +
    "subset (numbers, the arithmetic and comparison operators, `and`, `or`, `not`, `x if c else y`, the names `base`, " +
    "`variable`, `payment_days`, `total_working_days`, `leave_without_pay`, `gross_pay` and other components' " +
    "abbreviations, and Frappe's `round`, `rounded`, `floor`, `ceil`, `min`, `max`, `int` and `float`) is `portable`; " +
    "any other Python Frappe accepts is kept with `portable` false, for a run a head computes; one that does not parse " +
    "is INVALID_INPUT. A deduction's or employer contribution's `payee` is resolved through `parties.resolve-recipient` " +
    "(INVALID_INPUT when it names nothing): the Party its liability is owed to, which a holder or the FDE agent pays when " +
    "it falls due with an ordinary budget payment against the component's liability account, never inside a run's " +
    "command (payroll.deduction-remittance). `account` and `liabilityAccount` are books' accounts by code or `acct_` " +
    "id: an active ledger account of the chart under Expenses, and one under Liabilities (INVALID_INPUT otherwise); " +
    "left out, or before the chart, they are null and the accrual posts to the line's role's account " +
    "(payroll.books-accounts). " +
    "A change to an existing component affects only slips worked out after it, as in Frappe; the agreement component " +
    "cannot be changed except its accounts (INVALID_INPUT).",
  was: [`${FRAPPE}/salary_component/salary_component.json`, `${FRAPPE}/salary_component/salary_component.py`, "/tmp/hrms/hrms/payroll/utils.py:57"],
  concept: concept_payroll,
  kind: "mutation",
  who: WHO_HR,
  input: ComponentInput,
  output: Schema.Struct({ component: Component }),
  errors: [...HR_ERRORS],
  reads: [...HR_READS, table_salary_components, table_book_companies, table_book_accounts],
  writes: [table_salary_components, ...LOGGED],
  drives: [],
  invokes: [procedure_parties_resolve_recipient],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("write"),
});

export const rpc_payroll_structures_create = defineRpc({
  id: "payroll.structures.create",
  title: "Create a salary structure, submitted",
  about:
    HR_GUARD +
    "Each row names a component by abbreviation (INVALID_INPUT for an unknown or disabled one, or one under the wrong " +
    "heading: an earning under deductions), and may override its amount, formula or condition. A row's formula may " +
    "name only `base`, `variable`, the payment-day names and the abbreviations of rows above it (INVALID_INPUT naming " +
    "the row), so a slip works out in one pass as Frappe's does. The token defaults to the one the Organization's " +
    "budgets pay in; a token none of its budgets pays in is TOKEN_NOT_BUDGETED. With `amends`, the structure it " +
    "replaces must be submitted with no submitted assignment left on it (INVALID_INPUT otherwise) and is cancelled in " +
    "the same transaction (salary-structure.cancel). Then the structure is born submitted (salary-structure.submit).",
  was: [`${FRAPPE}/salary_structure/salary_structure.json`, `${FRAPPE}/salary_structure/salary_structure.py`],
  concept: concept_payroll,
  kind: "mutation",
  who: WHO_HR,
  input: StructureInput,
  output: Schema.Struct({ structure: Structure }),
  errors: [...HR_ERRORS, error_TOKEN_NOT_BUDGETED],
  reads: [...HR_READS, table_budgets, table_salary_components, table_salary_structures, table_salary_structure_assignments],
  writes: [table_salary_structures, ...LOGGED],
  drives: [machine_salary_structure.t.submit, machine_salary_structure.t.cancel],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("write"),
});

export const rpc_payroll_structures_assign = defineRpc({
  id: "payroll.structures.assign",
  title: "Assign a structure to an Employee from a day, on a base",
  about:
    HR_GUARD +
    "The Employee must be the Organization's and not `left` (INVALID_INPUT, WRONG_STATE); the structure submitted and " +
    "not the agreement structure, which only an agreement's acceptance assigns (INVALID_INPUT). `fromDate` must be on " +
    "or after `date_of_joining` (INVALID_INPUT). The department budget, the Employee's own unless given, must be one " +
    "of the Organization's budgets and pay in the structure's token (INVALID_INPUT, TOKEN_NOT_BUDGETED). `base` and " +
    "`variable` are amounts in that token, at its display precision. Then the assignment is born submitted " +
    "(salary-structure-assignment.submit), owed on books' Payroll Payable (null before the chart: " +
    "payroll.books-accounts); from `fromDate` it supersedes any earlier one for the periods after it.",
  was: [`${FRAPPE}/salary_structure_assignment/salary_structure_assignment.json`, `${FRAPPE}/salary_structure_assignment/salary_structure_assignment.py`],
  concept: concept_payroll,
  kind: "mutation",
  who: WHO_HR,
  input: AssignmentInput,
  output: Schema.Struct({ assignment: Assignment }),
  errors: [...HR_ERRORS, error_TOKEN_NOT_BUDGETED],
  reads: [...HR_READS, table_budgets, table_employees, table_salary_structures, table_salary_structure_assignments, table_book_accounts],
  writes: [table_salary_structure_assignments, ...LOGGED],
  drives: [machine_salary_structure_assignment.t.submit],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("write"),
});

export const rpc_payroll_structures_cancel = defineRpc({
  id: "payroll.structures.cancel",
  title: "Cancel a structure or an assignment",
  about:
    HR_GUARD +
    "Exactly one of `structureId` and `assignmentId` (INVALID_INPUT). A structure is cancelled only with no submitted " +
    "assignment on it, and an assignment only when no slip that is not cancelled names it and it mirrors no agreement " +
    "(WRONG_STATE naming what holds it). Slips already made keep what they were made with.",
  was: [`${FRAPPE}/salary_structure/salary_structure.py`, `${FRAPPE}/salary_structure_assignment/salary_structure_assignment.py`],
  concept: concept_payroll,
  kind: "mutation",
  who: WHO_HR,
  input: CancelInput,
  output: Schema.Struct({ structure: Schema.NullOr(Structure), assignment: Schema.NullOr(Assignment) }),
  errors: [...HR_ERRORS],
  reads: [...HR_READS, table_salary_structures, table_salary_structure_assignments, table_salary_slips],
  writes: [table_salary_structures, table_salary_structure_assignments, ...LOGGED],
  drives: [machine_salary_structure.t.cancel, machine_salary_structure_assignment.t.cancel],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("write"),
});

export const rpc_payroll_structures_list = defineRpc({
  id: "payroll.structures.list",
  title: "List the components, structures and assignments",
  about:
    HR_GUARD +
    "The Organization's components, its submitted structures, and its assignments (one Employee's with `employeeId`, " +
    "INVALID_INPUT for one not the Organization's), each assignment with the structure it names. It reads only.",
  was: [`${FRAPPE}/salary_structure/salary_structure.json`],
  concept: concept_payroll,
  kind: "query",
  who: WHO_HR,
  input: StructureListInput,
  output: Schema.Struct({ components: Schema.Array(Component), structures: Schema.Array(Structure), assignments: Schema.Array(Assignment) }),
  errors: [error_NOT_AUTHENTICATED, error_ROLE_PERMISSION_DENIED, error_INVALID_INPUT],
  reads: [...HR_READS, table_salary_components, table_salary_structures, table_salary_structure_assignments],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("read"),
});
