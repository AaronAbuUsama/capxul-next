// The HR area: the emails a leave application, an expense claim and an Employee Advance send as they
// open and as they are decided or paid (payroll.hr-notices; decision notices.hr). Payroll owns the three
// machines; notices follows their one event each through the outbox, one workflow per transition that
// tells someone.
//
// Who is told (payroll.hr-approvers): a leave's deciders are the wearers of the Employee's department's
// hat now, or, when it has none, the People hat's; a claim's or an advance's are whoever wears its
// department budget's hat now. The applicant is told at their Employee's `personal_email`
// (payroll.mailbox-for-pay), as the payslip is; an Employee with none is told nothing. Nobody is told
// about their own application as its decider.

import { table_principals } from "../access/data.ts";
import { table_budgets } from "../budgets/data.ts";
import { table_hat_wearers } from "../indexing/data.ts";
import { table_organizations } from "../organizations/data.ts";
import { table_employees } from "../payroll/data.ts";
import {
  machine_employee_advance,
  machine_expense_claim,
  machine_leave_application,
  table_employee_advances,
  table_expense_claims,
  table_leave_applications,
} from "../payroll/hr-data.ts";
import { PERSON, WEARERS, noticeWorkflow } from "./kit.ts";

const HRMS = "/tmp/hrms/hrms/hr/doctype";

const LEAVE_READS = [table_leave_applications, table_employees, table_organizations, table_hat_wearers, table_principals];
const MONEY_READS = [table_employees, table_organizations, table_budgets, table_hat_wearers, table_principals];

const APPLICANT = {
  name: "applicant",
  about: "The Employee's `personal_email` (payroll.mailbox-for-pay); an Employee with none is told nothing, and the notice ends.",
} as const;
const LEAVE_DECIDERS = {
  name: "deciders",
  about:
    "The wearers of the Employee's department's hat now (indexing's hat-wearers), or, when the department has none or " +
    "the Employee none, the People hat's; never the applicant.",
} as const;
const MONEY_DECIDERS = {
  name: "deciders",
  about: "Whoever wears the department budget's hat now (indexing's hat-wearers), the hat that decides and pays it; never the claimant.",
} as const;
/** A paid notice is keyed by its record, not the outbox id: a reorg's `reverse` settles it again, and its Employee is told once. */
const ONCE = (template: string, record: string) =>
  `Per recipient, \`${template}:<${record} id>\`, not the transition's outbox id: a reorg that reopened its Payment ` +
  "settles it again and finds its row, so its Employee is told once. A send lost before its record is repeated under " +
  "the same provider idempotency key, taken once.";

// ── leave ──────────────────────────────────────────────────────────────────────────────────

export const workflow_notices_hr_leave_waiting = noticeWorkflow({
  id: "notices.hr.leave-waiting",
  title: "Tell a leave's deciders an application waits for them",
  about:
    "Follows `apply`: an Employee applied for leave, here or on a connected head. Sends `leave-waiting` to its deciders: " +
    "the Employee, the leave type, the days and the balance left, and `org hr leave approve|reject`. " + PERSON,
  trigger: { transition: machine_leave_application.t.apply },
  reads: LEAVE_READS,
  steps: [{ name: "leave", about: "Reads the open application and its Employee." }, LEAVE_DECIDERS],
  was: [`${HRMS}/leave_application/leave_application.py (notify_leave_approver)`],
});

export const workflow_notices_hr_leave_approved = noticeWorkflow({
  id: "notices.hr.leave-approved",
  title: "Tell an Employee their leave was approved",
  about: "Follows `approve`. Sends `leave-approved` to the applicant: the leave type, the days and who approved it.",
  trigger: { transition: machine_leave_application.t.approve },
  reads: LEAVE_READS,
  steps: [{ name: "leave", about: "Reads the approved application and its Employee." }, APPLICANT],
  was: [`${HRMS}/leave_application/leave_application.py (notify_employee)`],
});

export const workflow_notices_hr_leave_rejected = noticeWorkflow({
  id: "notices.hr.leave-rejected",
  title: "Tell an Employee their leave was rejected",
  about: "Follows `reject`. Sends `leave-rejected` to the applicant: the leave type, the days and who rejected it.",
  trigger: { transition: machine_leave_application.t.reject },
  reads: LEAVE_READS,
  steps: [{ name: "leave", about: "Reads the rejected application and its Employee." }, APPLICANT],
  was: [`${HRMS}/leave_application/leave_application.py (notify_employee)`],
});

// ── expense claims ─────────────────────────────────────────────────────────────────────────

const CLAIM_READS = [table_expense_claims, ...MONEY_READS];

export const workflow_notices_hr_expense_claim_waiting = noticeWorkflow({
  id: "notices.hr.expense-claim-waiting",
  title: "Tell a claim's deciders an expense claim waits for them",
  about:
    "Follows `create`. Sends `expense-claim-waiting` to its deciders: the Employee, the total, the advances it names and " +
    "`org hr expense-claim approve|reject`. " + WEARERS + " " + PERSON,
  trigger: { transition: machine_expense_claim.t.create },
  reads: CLAIM_READS,
  steps: [{ name: "claim", about: "Reads the open claim, its Employee and its department's budget." }, MONEY_DECIDERS],
  was: [`${HRMS}/expense_claim/expense_claim.py`],
});

export const workflow_notices_hr_expense_claim_approved = noticeWorkflow({
  id: "notices.hr.expense-claim-approved",
  title: "Tell an Employee their expense claim was approved",
  about: "Follows `approve`: approved with something left to pay. Sends `expense-claim-approved` to the claimant: the sanctioned total, what its advances covered and what will be paid.",
  trigger: { transition: machine_expense_claim.t.approve },
  reads: CLAIM_READS,
  steps: [{ name: "claim", about: "Reads the approved claim and its Employee." }, APPLICANT],
  was: [`${HRMS}/expense_claim/expense_claim.py`],
});

export const workflow_notices_hr_expense_claim_covered = noticeWorkflow({
  id: "notices.hr.expense-claim-covered",
  title: "Tell an Employee their claim was approved and its advances cover it",
  about: "Follows `approve_covered`: approved with nothing left to pay. Sends `expense-claim-paid` to the claimant, saying its advances covered the sanctioned total.",
  trigger: { transition: machine_expense_claim.t.approve_covered },
  reads: CLAIM_READS,
  steps: [{ name: "claim", about: "Reads the claim and the advances that covered it." }, APPLICANT],
  idempotency: ONCE("expense-claim-paid", "claim"),
  was: [`${HRMS}/expense_claim/expense_claim.py`],
});

export const workflow_notices_hr_expense_claim_rejected = noticeWorkflow({
  id: "notices.hr.expense-claim-rejected",
  title: "Tell an Employee their expense claim was rejected",
  about: "Follows `reject`. Sends `expense-claim-rejected` to the claimant: the total, the reason given and who rejected it.",
  trigger: { transition: machine_expense_claim.t.reject },
  reads: CLAIM_READS,
  steps: [{ name: "claim", about: "Reads the rejected claim and its Employee." }, APPLICANT],
  was: [`${HRMS}/expense_claim/expense_claim.py`],
});

export const workflow_notices_hr_expense_claim_paid = noticeWorkflow({
  id: "notices.hr.expense-claim-paid",
  title: "Tell an Employee their expense claim was paid",
  about: "Follows `settle`: its Payment settled to the claimant. Sends `expense-claim-paid` with the amount, its token, when it was paid and the transaction.",
  trigger: { transition: machine_expense_claim.t.settle },
  reads: CLAIM_READS,
  steps: [{ name: "claim", about: "Reads the paid claim, its Payment's `paid_at` and `tx_hash`." }, APPLICANT],
  idempotency: ONCE("expense-claim-paid", "claim"),
  was: [`${HRMS}/expense_claim/expense_claim.py`],
});

// ── advances ───────────────────────────────────────────────────────────────────────────────

const ADVANCE_READS = [table_employee_advances, ...MONEY_READS];

export const workflow_notices_hr_advance_waiting = noticeWorkflow({
  id: "notices.hr.advance-waiting",
  title: "Tell an advance's deciders an Employee asked for one",
  about:
    "Follows `request`. Sends `advance-waiting` to its deciders: the Employee, the amount, the purpose and `org hr " +
    "advance pay|reject`. " + WEARERS + " " + PERSON,
  trigger: { transition: machine_employee_advance.t.request },
  reads: ADVANCE_READS,
  steps: [{ name: "advance", about: "Reads the requested advance, its Employee and its department's budget." }, MONEY_DECIDERS],
  was: [`${HRMS}/employee_advance/employee_advance.py`],
});

export const workflow_notices_hr_advance_rejected = noticeWorkflow({
  id: "notices.hr.advance-rejected",
  title: "Tell an Employee their advance was rejected",
  about: "Follows `reject`. Sends `advance-rejected` to the requester: the amount, the reason given and who rejected it.",
  trigger: { transition: machine_employee_advance.t.reject },
  reads: ADVANCE_READS,
  steps: [{ name: "advance", about: "Reads the rejected advance and its Employee." }, APPLICANT],
  was: [`${HRMS}/employee_advance/employee_advance.py`],
});

export const workflow_notices_hr_advance_paid = noticeWorkflow({
  id: "notices.hr.advance-paid",
  title: "Tell an Employee their advance was paid",
  about:
    "Follows `settle`: the advance's Payment settled to the Employee. Sends `advance-paid` with the amount, its token, " +
    "when it was paid and the transaction, and that it is claimed by expense claims or recovered from a slip.",
  trigger: { transition: machine_employee_advance.t.settle },
  reads: ADVANCE_READS,
  steps: [{ name: "advance", about: "Reads the paid advance, its Payment's `paid_at` and `tx_hash`." }, APPLICANT],
  idempotency: ONCE("advance-paid", "advance"),
  was: [`${HRMS}/employee_advance/employee_advance.py`],
});
