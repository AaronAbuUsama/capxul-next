// The runs area: Frappe's Payroll Entry and its Salary Slips, kept by Capxul. A People hat wearer
// drafts a department's run for a period, which works every Employee's slip out (gross, deductions,
// net), submits it, which fixes the slips and stores each one's payslip, withholds or releases a slip,
// or cancels a run nothing of which was paid. Each is one rpc and one transaction, and none touches the
// chain. A run a connected head computed arrives submitted through payroll's head sync (IMPORT_RUN below,
// decision payroll.import-run), never through a call the head makes.
//
// Paying a submitted run is one payment command with one approval for every slip's net
// (payroll.run-one-approval), born through payments' door, and the settled facts come back from
// payments' settlement to mark each slip paid. That half is in staged.ts, registered now that payroll
// depends on payments (payroll.pays-through-payments). Submit and cancel post and cancel the run's
// accrual through books' door (payroll.accrual).

import { Schema } from "effect";
import { budget, defineRpc } from "../../../packages/book/src/index.ts";
import { concept_payroll } from "../shared/foundation.ts";
import { error_INVALID_INPUT, error_NOT_AUTHENTICATED, error_ROLE_PERMISSION_DENIED } from "../shared/vocabulary.ts";
import { table_budgets } from "../budgets/data.ts";
import { table_organizations } from "../organizations/data.ts";
import { procedure_documents_store } from "../documents/procedures.ts";
import { procedure_books_record_payroll_accrual } from "../books/procedures.ts";
import { table_book_accounts } from "../books/data.ts";
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
import { HR_ERRORS, HR_GUARD, HR_READS, LOGGED, WHO_HR } from "./employees.ts";
import { Run, RunInput, RunListInput, RunRef, RunRow, WithholdInput } from "./shapes.ts";

const FRAPPE = "/tmp/hrms/hrms/payroll/doctype";
const e = machine_payroll_entry.t;
const s = machine_salary_slip.t;

/** How Capxul works a slip out, as Frappe HR's `calculate_net_pay` does for the portable subset (payroll.portable-formulas). */
const COMPUTE =
  "Each slip is worked out as Frappe HR's `calculate_net_pay` does, by payroll.portable-formulas and " +
  "payroll.money-and-rounding: working days the period's calendar days, payment days those employed less leave " +
  "without pay; each row in order (condition, full-period amount, amount prorated where it depends on payment days); " +
  "gross the earnings in totals, net gross less deductions, in raw units too.";

export const rpc_payroll_runs_create = defineRpc({
  id: "payroll.runs.create",
  title: "Draft a department's payroll run for a period, its slips worked out",
  about:
    HR_GUARD +
    "The department is one of the Organization's budgets and the end on or after the start, in calendar days " +
    "(INVALID_INPUT). Its Employees are those whose own `department` it is, as Frappe's Payroll Entry filters them, " +
    "paid from it; each needs a submitted assignment on or before the period's end, at the run's frequency (monthly " +
    "unless given) and in the budget's token, mirroring no agreement, which pays itself on chain. With none named it " +
    "takes the `active` ones, and those `left` on or after the period's first day (their last period, to that day), " +
    "never an `inactive` or `suspended` one (stricter than Frappe, which leaves out only Inactive: " +
    "payroll.run-employees), and lists the rest as left out; a named one it cannot pay this period is INVALID_INPUT. " +
    "An Employee with a live run slip of an overlapping period is WRONG_STATE naming that run (Frappe's " +
    "`check_existing` matches same dates only), under each Employee's row lock, so two runs never take one period. A row whose formula or condition is not portable is INVALID_INPUT naming the " +
    "component: the head must compute the run. " +
    COMPUTE +
    " A net below zero is INVALID_INPUT naming the Employee, as Frappe refuses one on submit. Then, in one transaction, " +
    "the run is born `draft` (payroll-entry.create), with the company Safe and books' Payroll Payable and treasury " +
    "role accounts (null until books has them: payroll.books-accounts), and each slip `draft` (salary-slip.compute). " +
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
    table_book_accounts,
  ],
  writes: [table_payroll_entries, table_salary_slips, ...LOGGED],
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

/**
 * How payroll's head sync takes in a Payroll Entry its head computed and submitted: the chosen option of decision
 * payroll.import-run, a step of `payroll.head.sync` (processes.ts), which pulls it with Capxul's own key; the head never
 * writes into Capxul (organizations.head-doorbell).
 */
export const IMPORT_RUN =
  "A Payroll Entry the head submitted, with its submitted slips, computed by Frappe HR's full engine (tax slabs, " +
  "attendance, leave, regional deductions), is taken in when the head user who submitted it is a member whose Safe " +
  "wears the People hat (else refused and reported to the head). The department, Employees and assignments must be " +
  "the Organization's and each component known here by abbreviation; each slip's rows must add up to its gross, total " +
  "deduction and net to the cent, its net not below zero, and it must overlap no live run slip of the Employee, checked " +
  "under each Employee's row lock. Runs never pay agreements: a slip whose assignment mirrors an agreement, or with a " +
  "row of the agreement component, is refused, because the agreement pays itself on chain and its collections are " +
  "already paid slips (payroll.agreements-in-frappe-shape). A Payroll Entry already taken in (`by_head_name`, unique) " +
  "is skipped, so a repeat never births a second run to pay. Capxul never works an imported slip out again. In one " +
  "transaction the run is born `submitted` (payroll-entry.import) with `computed_by` head, each slip `submitted` " +
  "(salary-slip.import), or `withheld` where the head's Salary Withholding holds it (salary-slip.import_withheld), and " +
  STORE_PAYSLIPS +
  " It posts no accrual: the head's own accrual Journal Entry, made when it submitted the slips, reaches books through " +
  "books' sync, one author per voucher (payroll.accrual).";

export const rpc_payroll_runs_submit = defineRpc({
  id: "payroll.runs.submit",
  title: "Submit a drafted run: its slips are fixed and owed",
  about:
    HR_GUARD +
    "The run must be `draft` (WRONG_STATE). Its slips are worked out again first, so a component or assignment changed " +
    "since the draft is in them, and the answer shows any slip that changed. Then, in one transaction, the run moves to " +
    "`submitted` (payroll-entry.submit), each slip to `submitted` (salary-slip.submit), and " +
    STORE_PAYSLIPS +
    " The accrual (expense up, Payroll Payable and each deduction's liability up) is books' to post, and only books': " +
    "Capxul computed this run, so its accrual is Capxul's voucher, which a head receives and never posts again. Books " +
    "cannot read payroll, so this rpc invokes books' door `books.record-payroll-accrual` in the same transaction " +
    "(action submit, the run's lines in its token, which books values in the Company's currency: each earning's and " +
    "employer contribution's expense, each deduction's and employer contribution's liability, each net on the run's " +
    "Payroll Payable with party the Employee and reference the Payroll Entry; a null account is the line's role's: " +
    "payroll.accrual, books.payroll-lines).",
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
  writes: [table_payroll_entries, table_salary_slips, ...LOGGED],
  drives: [e.submit, s.submit],
  invokes: [procedure_documents_store, procedure_books_record_payroll_accrual],
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
    "Frappe's Salary Withholding, for one slip. Withholding needs the slip `submitted` with no lapsed Payment (which " +
    "could still be retried) and its run `submitted`, so it is left out of the run's payment command; releasing needs " +
    "it `withheld`. A slip released before its run is paid goes with the run's command; one released after goes out " +
    "under the next attempt when `runs.pay` names it (WRONG_STATE otherwise, naming the status). A run its head computed " +
    "is withheld and released on the head, whose Salary Withholding payroll's head sync applies; a call here for one is " +
    "WRONG_STATE naming the head (payroll.one-computer-per-run). `reason` is kept on the slip.",
  was: [`${FRAPPE}/salary_withholding/salary_withholding.json`, `${FRAPPE}/payroll_entry/payroll_entry.py:1138`],
  concept: concept_payroll,
  kind: "mutation",
  who: WHO_HR,
  input: WithholdInput,
  output: Schema.Struct({ run: Run }),
  errors: [...HR_ERRORS],
  reads: [...HR_READS, table_payroll_entries, table_salary_slips],
  writes: [table_salary_slips, ...LOGGED],
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
    "The run must be `draft` or `submitted`, with no slip holding a Payment: paying, escrowed, paid, or lapsed and still " +
    "retryable (WRONG_STATE naming it). A run its head computed is cancelled on its head, where its accrual is, and " +
    "payroll's head sync applies that cancellation; a call here for one is WRONG_STATE naming the head " +
    "(payroll.one-computer-per-run). Then, in one transaction, the run and each of its slips are `cancelled` " +
    "(payroll-entry.cancel, salary-slip.cancel). The payslips stay stored, as every document does; a submitted run's " +
    "accrual is cancelled in the same transaction through `books.record-payroll-accrual` (action cancel), which writes " +
    "nothing for a draft (payroll.accrual).",
  was: [`${FRAPPE}/payroll_entry/payroll_entry.py:175`],
  concept: concept_payroll,
  kind: "mutation",
  who: WHO_HR,
  input: RunRef,
  output: Schema.Struct({ run: Run }),
  errors: [...HR_ERRORS],
  reads: [...HR_READS, table_payroll_entries, table_salary_slips],
  writes: [table_payroll_entries, table_salary_slips, ...LOGGED],
  drives: [e.cancel, s.cancel],
  invokes: [procedure_books_record_payroll_accrual],
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
    "a draft, pay a submitted run). `department` and `status` filter (INVALID_INPUT for one that names nothing). A page " +
    "at a time: at most `limit` (1 to 100, 25 by default) after the cursor `after` (INVALID_INPUT for one this list " +
    "did not give), and `nextCursor` the next page's `after`, null on the last (payroll.command-fit). It reads only.",
  was: [`${FRAPPE}/payroll_entry/payroll_entry.json`],
  concept: concept_payroll,
  kind: "query",
  who: WHO_HR,
  input: RunListInput,
  output: Schema.Struct({ items: Schema.Array(RunRow), nextCursor: Schema.NullOr(Schema.String) }),
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

