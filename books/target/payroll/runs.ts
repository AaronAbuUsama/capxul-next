// The runs area: Frappe's Payroll Entry and its Salary Slips, kept by Capxul. A People hat wearer
// drafts a department's run for a period, which works every Employee's slip out (gross, deductions,
// net), submits it, which fixes the slips and stores each one's payslip, withholds or releases a slip,
// or cancels a run nothing of which was paid. A run a connected head computed arrives submitted through
// `import`. Each is one rpc and one transaction, and none touches the chain.
//
// Paying a submitted run is one payment command with one approval for every slip's net
// (payroll.run-one-approval), born through payments' door, and the settled facts come back from
// payments' settlement to mark each slip paid. That half needs payroll to depend on payments, so its
// records are written in staged.ts and registered once it does (payroll.pays-through-payments).

import { Schema } from "effect";
import { budget, defineRpc } from "../../../packages/book/src/index.ts";
import { concept_payroll } from "../shared/foundation.ts";
import { error_INVALID_INPUT, error_NOT_AUTHENTICATED, error_ROLE_PERMISSION_DENIED } from "../shared/vocabulary.ts";
import { table_budgets } from "../budgets/data.ts";
import { table_organizations } from "../organizations/data.ts";
import { procedure_documents_store } from "../documents/procedures.ts";
import {
  machine_payroll_entry,
  machine_salary_slip,
  table_employees,
  table_payroll_entries,
  table_salary_components,
  table_salary_slips,
  table_salary_structure_assignments,
  table_salary_structures,
} from "./data.ts";
import { HR_ERRORS, HR_GUARD, HR_READS, WHO_HR } from "./employees.ts";
import { ImportInput, Run, RunInput, RunListInput, RunRef, RunRow, WithholdInput } from "./shapes.ts";

const FRAPPE = "/tmp/hrms/hrms/payroll/doctype";
const e = machine_payroll_entry.t;
const s = machine_salary_slip.t;

/** How Capxul works a slip out, as Frappe HR's `calculate_net_pay` does for the portable subset (payroll.portable-formulas). */
const COMPUTE =
  "Each slip is worked out as Frappe HR's `calculate_net_pay` does: `total_working_days` is the period's calendar days " +
  "(Capxul's Payroll Settings count holidays as working days), `payment_days` those the Employee was employed " +
  "(from `date_of_joining`, to `relieving_date`) less their leave without pay; each structure row in order: its " +
  "condition, then its amount or formula over `base`, `variable`, the day counts and the rows above it, prorated by " +
  "`payment_days` over `total_working_days` where it depends on them; `gross_pay` the earnings not statistical or " +
  "left out of totals, then the deductions, `net_pay` gross less deductions. Amounts are exact decimals rounded half " +
  "to even to the token's display precision (Frappe's Banker's Rounding), and `net_pay_raw` is the net in raw units.";

export const rpc_payroll_runs_create = defineRpc({
  id: "payroll.runs.create",
  title: "Draft a department's payroll run for a period, its slips worked out",
  about:
    HR_GUARD +
    "The department is one of the Organization's budgets (INVALID_INPUT); the period's days are calendar days, the end " +
    "on or after the start (INVALID_INPUT). Its Employees are the department's `active` ones, or those named (each the " +
    "department's, else INVALID_INPUT), each with a submitted assignment on or before the period's end whose structure " +
    "pays at the run's frequency and in the department budget's token, and which mirrors no agreement: an agreement pays " +
    "itself on chain and never through a run (INVALID_INPUT naming an Employee without one). An Employee with a live " +
    "slip whose period overlaps is WRONG_STATE naming that run, as Frappe's `check_existing`. A row whose formula or " +
    "condition is not portable is INVALID_INPUT naming the component and saying the run must be computed by the " +
    "Organization's head. " +
    COMPUTE +
    " A net below zero is INVALID_INPUT naming the Employee, as Frappe refuses one on submit. Then, in one transaction, " +
    "the run is born `draft` (payroll-entry.create), with the company Safe, and each slip `draft` (salary-slip.compute). " +
    "Nothing is owed yet.",
  was: [`${FRAPPE}/payroll_entry/payroll_entry.py:309`, `${FRAPPE}/salary_slip/salary_slip.py:985`, `${FRAPPE}/salary_slip/salary_slip.py:1471`],
  concept: concept_payroll,
  kind: "mutation",
  who: WHO_HR,
  input: RunInput,
  output: Schema.Struct({ run: Run }),
  errors: [...HR_ERRORS],
  reads: [
    ...HR_READS,
    table_budgets,
    table_organizations,
    table_employees,
    table_salary_components,
    table_salary_structures,
    table_salary_structure_assignments,
    table_payroll_entries,
    table_salary_slips,
  ],
  writes: [table_payroll_entries, table_salary_slips],
  drives: [e.create, s.compute],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("write"),
});

const STORE_PAYSLIPS =
  "`documents.store` stores each slip's payslip (kind `payslip`, subject the slip; the payer is the company Safe and " +
  "its Organization's Party, the payee the Employee's Safe and Party), whose hash its Payment will carry on chain.";

export const rpc_payroll_runs_import = defineRpc({
  id: "payroll.runs.import",
  title: "Take in a run the Organization's head computed and submitted",
  about:
    HR_GUARD +
    "For an Organization with a connected head: the head's Capxul app sends a Payroll Entry it submitted, with its " +
    "submitted slips, computed by Frappe HR's full engine (tax slabs, attendance, leave, regional deductions). The " +
    "department, Employees and assignments must be the Organization's, each component named by abbreviation known " +
    "here (INVALID_INPUT naming what is not); each slip's rows must add up to its gross, total deduction and net to the " +
    "cent, its net not below zero (INVALID_INPUT naming the slip), and overlap no live slip of the Employee " +
    "(WRONG_STATE). A run already taken in under the same head name answers as it stands. Capxul never works an " +
    "imported slip out again (payroll.one-computer-per-run). Then, in one transaction, the run is born `submitted` " +
    "(payroll-entry.import) with `computed_by` head, each slip `submitted` (salary-slip.import), and " +
    STORE_PAYSLIPS,
  was: [`${FRAPPE}/payroll_entry/payroll_entry.py:1837`, `${FRAPPE}/salary_slip/salary_slip.py:276`],
  concept: concept_payroll,
  kind: "mutation",
  who: WHO_HR,
  input: ImportInput,
  output: Schema.Struct({ run: Run, replayed: Schema.Boolean }),
  errors: [...HR_ERRORS],
  reads: [
    ...HR_READS,
    table_budgets,
    table_organizations,
    table_employees,
    table_salary_components,
    table_salary_structure_assignments,
    table_payroll_entries,
    table_salary_slips,
  ],
  writes: [table_payroll_entries, table_salary_slips],
  drives: [e.import, s.import],
  invokes: [procedure_documents_store],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("write"),
});

export const rpc_payroll_runs_submit = defineRpc({
  id: "payroll.runs.submit",
  title: "Submit a drafted run: its slips are fixed and owed",
  about:
    HR_GUARD +
    "The run must be `draft` (WRONG_STATE). Its slips are worked out again first, so a component or assignment changed " +
    "since the draft is in them, and the answer shows any slip that changed. Then, in one transaction, the run moves to " +
    "`submitted` (payroll-entry.submit), each slip to `submitted` (salary-slip.submit), and " +
    STORE_PAYSLIPS +
    " The accrual (expense up, Payroll Payable and each deduction's liability up) is books' to post from the submitted " +
    "run (payroll.accrual).",
  was: [`${FRAPPE}/payroll_entry/payroll_entry.py:372`, `${FRAPPE}/payroll_entry/payroll_entry.py:619`],
  concept: concept_payroll,
  kind: "mutation",
  who: WHO_HR,
  input: RunRef,
  output: Schema.Struct({ run: Run, recomputed: Schema.Array(Schema.String) }),
  errors: [...HR_ERRORS],
  reads: [
    ...HR_READS,
    table_organizations,
    table_employees,
    table_salary_components,
    table_salary_structures,
    table_salary_structure_assignments,
    table_payroll_entries,
    table_salary_slips,
  ],
  writes: [table_payroll_entries, table_salary_slips],
  drives: [e.submit, s.submit],
  invokes: [procedure_documents_store],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("write"),
});

export const rpc_payroll_runs_withhold = defineRpc({
  id: "payroll.runs.withhold",
  title: "Withhold a submitted slip from its run's payment, or release it",
  about:
    HR_GUARD +
    "Frappe's Salary Withholding, for one slip. Withholding needs the slip `submitted` and its run `submitted`, so it " +
    "is left out of the run's payment command; releasing needs it `withheld`, and once released it is paid on its own " +
    "(WRONG_STATE otherwise, naming the status). `reason` is kept on the slip.",
  was: [`${FRAPPE}/salary_withholding/salary_withholding.json`, `${FRAPPE}/payroll_entry/payroll_entry.py:1138`],
  concept: concept_payroll,
  kind: "mutation",
  who: WHO_HR,
  input: WithholdInput,
  output: Schema.Struct({ run: Run }),
  errors: [...HR_ERRORS],
  reads: [...HR_READS, table_payroll_entries, table_salary_slips],
  writes: [table_salary_slips],
  drives: [s.withhold, s.release],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("write"),
});

export const rpc_payroll_runs_cancel = defineRpc({
  id: "payroll.runs.cancel",
  title: "Cancel a run nothing of which was paid",
  about:
    HR_GUARD +
    "The run must be `draft` or `submitted`, with no slip paying, escrowed or paid (WRONG_STATE naming it). Then, in " +
    "one transaction, the run and each of its slips are `cancelled` (payroll-entry.cancel, salary-slip.cancel). The " +
    "payslips stay stored, as every document does; books reverses a submitted run's accrual (payroll.accrual).",
  was: [`${FRAPPE}/payroll_entry/payroll_entry.py:175`],
  concept: concept_payroll,
  kind: "mutation",
  who: WHO_HR,
  input: RunRef,
  output: Schema.Struct({ run: Run }),
  errors: [...HR_ERRORS],
  reads: [...HR_READS, table_payroll_entries, table_salary_slips],
  writes: [table_payroll_entries, table_salary_slips],
  drives: [e.cancel, s.cancel],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("write"),
});

const READ_ERRORS = [error_NOT_AUTHENTICATED, error_ROLE_PERMISSION_DENIED, error_INVALID_INPUT] as const;

export const rpc_payroll_runs_show = defineRpc({
  id: "payroll.runs.show",
  title: "Show one run with its slips",
  about:
    HR_GUARD +
    "The run (INVALID_INPUT for one not the Organization's), its totals and each slip with its rows, status and, once " +
    "paid, the settled facts that came back. It reads only.",
  was: [`${FRAPPE}/payroll_entry/payroll_entry.json`],
  concept: concept_payroll,
  kind: "query",
  who: WHO_HR,
  input: RunRef,
  output: Schema.Struct({ run: Run }),
  errors: [...READ_ERRORS],
  reads: [...HR_READS, table_payroll_entries, table_salary_slips],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("read"),
});

export const rpc_payroll_runs_list = defineRpc({
  id: "payroll.runs.list",
  title: "List the Organization's runs",
  about:
    HR_GUARD +
    "Runs by department and period, newest first, with their status, head count, net total and the next step (submit " +
    "a draft, pay a submitted run). `department` and `status` filter (INVALID_INPUT for one that names nothing). It " +
    "reads only.",
  was: [`${FRAPPE}/payroll_entry/payroll_entry.json`],
  concept: concept_payroll,
  kind: "query",
  who: WHO_HR,
  input: RunListInput,
  output: Schema.Struct({ items: Schema.Array(RunRow) }),
  errors: [...READ_ERRORS],
  reads: [...HR_READS, table_budgets, table_payroll_entries],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("read"),
});

