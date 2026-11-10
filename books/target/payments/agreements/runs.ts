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
import { budget, defineRpc } from "../../../../packages/book/src/index.ts";
import { concept_payments } from "../../shared/foundation.ts";
import { error_INVALID_INPUT, error_NOT_AUTHENTICATED, error_ROLE_PERMISSION_DENIED } from "../../shared/vocabulary.ts";
import { table_budgets } from "../../budgets/data.ts";
import { table_organizations } from "../../organizations/data.ts";
import { procedure_documents_store } from "../../documents/procedures.ts";
import { table_book_accounts } from "../../books/data.ts";
import { HR_ERRORS, HR_GUARD, HR_READS, WHO_HR } from "./employees.ts";
import { Run, RunInput, RunListInput, RunRef, RunRow, WithholdInput } from "./shapes.ts";

const FRAPPE = "/tmp/hrms/hrms/payroll/doctype";

/** How Capxul works a slip out, as Frappe HR's `calculate_net_pay` does for the portable subset (payroll.portable-formulas). */
const COMPUTE =
  "Each slip is worked out as Frappe HR's `calculate_net_pay` does (payroll.portable-formulas, " +
  "payroll.money-and-rounding): payment days those employed less the attendance's unpaid leave and absences " +
  "(payroll.attendance-based); each row in order, prorated where it depends on payment days, then any advance " +
  "recovery its period holds (payroll.advance-recovery); net gross less deductions, in raw units too.";

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

const READ_ERRORS = [error_NOT_AUTHENTICATED, error_ROLE_PERMISSION_DENIED, error_INVALID_INPUT] as const;

