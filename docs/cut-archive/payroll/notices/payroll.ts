// Moved out of the built book by the cut, 10 November 2026, from books/target/notices/payroll.ts. The records are intact;
// the imports below are as the file had them, so they point at the folder the file was written in (as docs/as-is/archive does).
// What each record became is in docs/cut-archive/INDEX.md.

import { table_principals } from "../access/data.ts";
import { table_hat_wearers } from "../indexing/data.ts";
import { table_organizations } from "../organizations/data.ts";
import { table_parties } from "../parties/data.ts";
import {
  machine_agreement,
  machine_agreement_write,
  machine_salary_slip,
  table_agreement_writes,
  table_agreements,
  table_employees,
  table_salary_slips,
} from "../payroll/data.ts";
import { contract_agreements, contract_safe } from "../shared/external.ts";
import { DIRECTORS, noticeWorkflow } from "./kit.ts";

export const workflow_notices_payroll_payslip = noticeWorkflow({
  id: "notices.payroll.payslip",
  title: "Send an employee their payslip once its net is paid",
  about:
    "Follows `settle` of a salary slip: the net of a run's slip settled to the employee (from `paying`, or from " +
    "`escrowed` once a new hire claimed their account), at the block's time. Sends `payslip` once to the Employee's " +
    "`personal_email` (payroll.mailbox-for-pay): the Organization, the period, gross pay, each deduction, the net and " +
    "its token, when it was paid and the transaction, and how to read the stored payslip, whose hash the Payment " +
    "carried. It replaces Frappe HR's `email_salary_slip_to_employee`, which a head keeps off, so an " +
    "employee is told once whether or not a head is connected. An Employee with no personal email is told nothing. A " +
    "slip paid by an agreement's collection (`record_collection`) sends nothing here: its `pay-received` already told " +
    "the payee. A slip still `escrowed` is not paid: its money-waiting email told the new hire.",
  trigger: { transition: machine_salary_slip.t.settle },
  reads: [table_salary_slips, table_employees, table_organizations],
  idempotency:
    "Per recipient, `payslip:<salary slip id>`, not the transition's outbox id: a slip a reorg reopened (`reverse`) " +
    "settles again as the next generation and finds its row, so its employee is told once. A send lost before its " +
    "record is repeated under the same provider idempotency key, taken once.",
  steps: [
    { name: "slip", about: "Reads the paid slip (source `run`) and its Employee; one with no `personal_email` ends here." },
    {
      name: "facts",
      about:
        "The Organization's name, the period and its days, the earnings, deductions, gross and net with the token, `paid_at` and `tx_hash`, and the payslip's document hash.",
    },
  ],
  was: ["/tmp/hrms/hrms/payroll/doctype/salary_slip/salary_slip.py (email_salary_slip)", "docs/design/frappe/payroll.md (notices)"],
});
