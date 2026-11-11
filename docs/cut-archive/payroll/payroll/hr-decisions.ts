// Payroll's judgments on the HR that changes pay or moves money (hr-data.ts and its areas), made on 8 November 2026
// carrying out Aaron's evening answer (docs/decisions/open-for-aaron.md: payroll means HR; leave, holidays,
// attendance, expense claims and advances native, recruitment, appraisal, training and onboarding on the head) and
// the eighth batch of rulings (aaron.world-clock, aaron.sdk-reaches-everything), with Frappe HR's sources at
// /tmp/hrms as the reference for every shape.

import { defineDecision } from "../../../packages/book/src/index.ts";
import { concept_payroll } from "../shared/foundation.ts";
import { error_INVALID_INPUT, error_ROLE_PERMISSION_DENIED } from "../shared/vocabulary.ts";
import { table_payroll_settings, table_salary_components, table_salary_slips } from "./data.ts";
import {
  machine_attendance,
  machine_employee_advance,
  machine_expense_claim,
  machine_leave_allocation,
  machine_leave_application,
  machine_shift_assignment,
  table_additional_salaries,
  table_attendances,
  table_employee_advances,
  table_employee_checkins,
  table_expense_claim_types,
  table_expense_claims,
  table_holiday_lists,
  table_hr_settings,
  table_leave_allocations,
  table_leave_applications,
  table_leave_types,
  table_shift_assignments,
  table_shift_types,
} from "./hr-data.ts";
import {
  rpc_payroll_leave_allocate,
  rpc_payroll_leave_apply,
  rpc_payroll_leave_approve,
  rpc_payroll_leave_balance,
  rpc_payroll_leave_cancel,
  rpc_payroll_leave_list,
  rpc_payroll_leave_mine,
  rpc_payroll_leave_my_balance,
  rpc_payroll_leave_reject,
} from "./leave.ts";
import {
  rpc_payroll_attendance_checkin,
  rpc_payroll_attendance_mine,
  rpc_payroll_shift_types_add,
  workflow_payroll_attendance_auto,
} from "./attendance.ts";
import {
  flow_client_org_hr_advances_pay,
  flow_client_org_hr_advances_settle,
  flow_client_org_hr_expense_claims_pay,
  rpc_payroll_advances_mine,
  rpc_payroll_advances_pay,
  rpc_payroll_advances_reject,
  rpc_payroll_advances_request,
  rpc_payroll_advances_settle,
  rpc_payroll_advances_withdraw,
  rpc_payroll_expense_claims_approve,
  rpc_payroll_expense_claims_cancel,
  rpc_payroll_expense_claims_create,
  rpc_payroll_expense_claims_get,
  rpc_payroll_expense_claims_mine,
  rpc_payroll_expense_claims_mine_get,
  rpc_payroll_expense_claims_pay,
  rpc_payroll_expense_claims_reject,
  rpc_payroll_expense_claims_withdraw,
  rpc_payroll_expense_types_add,
  rpc_payroll_expense_types_mine,
  workflow_payroll_advances_payment,
  workflow_payroll_expense_claims_payment,
} from "./expenses.ts";
import { rpc_payroll_holidays_mine, rpc_payroll_leave_types_mine } from "./leave.ts";
import { rpc_payroll_runs_cancel, rpc_payroll_runs_create, rpc_payroll_runs_submit } from "./runs.ts";
import { workflow_payroll_head_sync, workflow_payroll_startup_open } from "./processes.ts";
import { operation_org_payroll_run_create } from "./operations.ts";
import {
  HR_CRITICAL,
  HR_OPERATIONS,
  operation_hr_attendance_checkin,
  operation_hr_expense_claim_create,
  operation_hr_expense_type_list,
  operation_hr_holiday_list,
  operation_hr_leave_apply,
  operation_hr_leave_type_list,
  operation_org_hr_advance_pay,
  operation_org_hr_advance_settle,
  operation_org_hr_expense_claim_approve,
  operation_org_hr_expense_claim_pay,
  operation_org_hr_leave_approve,
} from "./operations.ts";

const HRMS = "/tmp/hrms/hrms/hr/doctype";
/** Every source names Aaron's evening answer (payroll means HR) and the rulings each judgment serves; the evidence is in its why. */
const by = (rulings: string, evidence: string) => {
  const head = `Claude, HR pass, 8 November 2026, on Aaron's evening answer (payroll means HR); rulings ${rulings}`;
  const full = `${head}; evidence ${evidence}`;
  return full.length <= 300 ? full : head;
};

const HR_TABLES = [
  table_holiday_lists,
  table_leave_types,
  table_leave_allocations,
  table_leave_applications,
  table_shift_types,
  table_shift_assignments,
  table_employee_checkins,
  table_attendances,
  table_expense_claim_types,
  table_expense_claims,
  table_employee_advances,
  table_additional_salaries,
  table_hr_settings,
];
const SELF_RPCS = [
  rpc_payroll_leave_apply,
  rpc_payroll_leave_cancel,
  rpc_payroll_leave_mine,
  rpc_payroll_leave_my_balance,
  rpc_payroll_attendance_checkin,
  rpc_payroll_attendance_mine,
  rpc_payroll_expense_claims_create,
  rpc_payroll_expense_claims_withdraw,
  rpc_payroll_expense_claims_mine,
  rpc_payroll_expense_claims_mine_get,
  rpc_payroll_advances_request,
  rpc_payroll_advances_withdraw,
  rpc_payroll_advances_mine,
];

export const decision_payroll_hr_in_payroll = defineDecision({
  id: "payroll.hr-in-payroll",
  title: "HR is part of payroll, as Frappe HR is one app; no new concept",
  question:
    "Payroll means HR. Is the HR that changes pay or moves money (holidays, leave, attendance, expense claims, " +
    "advances) part of the payroll concept, or a concept of its own?",
  options: [
    {
      label: "in-payroll",
      text:
        "Part of payroll: its tables beside the payroll DocTypes (hr-data.ts), its rpcs in leave.ts, attendance.ts and " +
        "expenses.ts, its operations at the end of operations.ts (rules.new-operations), synced by payroll's one head " +
        "sync and numbered in payroll's one change log. Payroll's dependencies " +
        "already hold everything it needs (budgets, indexing, approvals through payments, books, documents, payments), " +
        "so no dependency is added and none of foundation.ts changes.",
    },
    {
      label: "hr-concept",
      text:
        "A concept `hr` beside payroll. Payroll's runs read attendance for payment days, and HR's leave, attendance and " +
        "claims hang off the Employee, which payroll owns: either `hr` depends on payroll and payroll reads `hr`, a " +
        "cycle, or the Employee moves to `hr` and payroll's runs, agreements and sync reach across a boundary on every write.",
    },
  ],
  chosen: "in-payroll",
  why:
    "Frappe ships HR and payroll as one app, hrms, with the HR and Payroll modules side by side on one Employee; the " +
    "concept mirrors the app, as books mirrors ERPNext's accounting. A run's slip must read the period's attendance in " +
    "its own transaction (payroll.attendance-based), an advance's recovery is a slip's deduction (payroll.advance-" +
    "recovery), and the head sync pushes every HR and payroll DocType in one order: split, each would cross a concept " +
    "boundary or make a cycle. The concept's id stays `payroll`, the one organizations' native list and the start-up " +
    "already name; the concept's `about` in foundation.ts gains the HR it now holds (for the shared owner).",
  source: by("aaron.frappe-shape, aaron.erp-on-capxul", `${HRMS} (hrms: modules HR and Payroll on one Employee); books/target/shared/foundation.ts (concept_payroll.dependsOn)`),
  affects: [concept_payroll, ...HR_TABLES],
});

export const decision_payroll_hr_scope = defineDecision({
  id: "payroll.hr-scope",
  title: "Native HR: what changes pay or moves money; the rest stays on the head",
  question: "Which of Frappe HR's HR DocTypes does Capxul keep itself, and which stay on a connected head?",
  options: [
    {
      label: "pay-and-money",
      text:
        "Native, one table each with Frappe's field names: Holiday List (its Holiday rows embedded), Leave Type, Leave " +
        "Allocation, Leave Application, Shift Type, Shift Assignment, Employee Checkin, Attendance, Expense Claim Type, " +
        "Expense Claim (its Expense Claim Detail and Expense Claim Advance rows embedded), Employee Advance, Additional " +
        "Salary for an advance's recovery only, and HR Settings. On the head, reached through the document family: " +
        "recruitment (Job Opening, Job Applicant, Interview, Job Offer), appraisal, training, onboarding and separation, " +
        "promotions and transfers, and the leave and attendance machinery that is not on the path to a slip: Leave Policy " +
        "and its Assignment, Leave Period, earned, compensatory, optional and encashable leave, Leave Block List, " +
        "Attendance Request, Shift Request and Schedule, overtime, and Holiday List Assignment.",
    },
    { label: "all-hr", text: "Every HR DocType native." },
    { label: "head-hr", text: "No HR native: leave and attendance only on a head, as payroll.frappe-doctypes first had it." },
  ],
  chosen: "pay-and-money",
  why:
    "Aaron's line is what changes pay or moves money: an unpaid leave's day or an absence docks a slip, and a claim or " +
    "an advance is money from a department's budget, so each must be Capxul's to compute and pay without a head " +
    "(aaron.frappe-shape). The leave and attendance kept are exactly the path to a slip's payment days " +
    "(`get_working_days_details` reads approved leave and submitted attendance and nothing else); policies, periods, " +
    "earned and compensatory leave only make allocations, which a head's arrive here through the sync as the People " +
    "hat's records. Encashment and overtime change pay through Additional Salaries Capxul does not compute, so a run that " +
    "needs them is the head's (payroll.one-computer-per-run). Everything else reaches the CLI and the SDK through the " +
    "document family (aaron.sdk-reaches-everything). This replaces payroll.frappe-doctypes' leaving leave and " +
    "attendance to a head; organizations' NATIVE_DOCTYPES lists exactly the native ones, with these commands.",
  source: by("aaron.frappe-shape, aaron.sdk-reaches-everything", "/tmp/hrms/hrms/payroll/doctype/salary_slip/salary_slip.py:545; /tmp/hrms/hrms/hr/doctype; organizations/data.ts NATIVE_DOCTYPES"),
  affects: [...HR_TABLES, concept_payroll],
});

export const decision_payroll_hr_commands = defineDecision({
  id: "payroll.hr-commands",
  title: "The HR pack: 45 commands in the one grammar, each one SDK method",
  question: "Which commands reach the native HR, in the grammar of docs/design/new-commands.md?",
  options: [
    {
      label: "forty-five",
      text:
        "Recommended, booked now: `org hr holiday add|remove|list`; `org hr leave-type add|change|list`; `org hr leave " +
        "allocate|unallocate|balance|approve|reject|list`; the Employee's own `hr leave apply|list|cancel|balance`; `org " +
        "hr shift-type add|list|assign|unassign`; the Employee's own `hr attendance checkin|list`; `org hr attendance " +
        "mark|cancel|list`; `org hr expense-type add|list`; the Employee's own `hr expense-claim create|list|get|cancel`; `org " +
        "hr expense-claim approve|reject|pay|cancel|list|get`; the Employee's own `hr advance request|list|cancel`; and `org " +
        "hr advance pay|reject|settle|list|get`. Section 5.9 of new-commands.md lists each with its SDK method, who, budget " +
        "and behaviour.",
    },
    {
      label: "as-asked",
      text:
        "The spelling of the brief: `org leave type`, `expense claim create|submit|list`, `org expense approve|reject|pay`, " +
        "`advance request`, `org advance pay|settle`.",
    },
  ],
  chosen: "forty-five",
  why:
    "For Aaron: these are the HR commands; the recommendation stands until he answers. They keep the grammar: a record " +
    "kind is the DocType's kebab-case name (`leave-type`, `shift-type`, `expense-type` for Expense Claim Type, " +
    "`expense-claim`), as `activity-type` and `project-type` are, or a common word, as G2 names Salary Slip `payslip` " +
    "(`leave` for Leave Application, with its allocations under it as a structure's assignments are under `org payroll " +
    "structure`, and `advance` for Employee Advance); the 215 use none of these words. The Employee's own records begin " +
    "with `hr`, not `org`, and take `--employer`, as `payroll payslip list` does (G1); a lifecycle verb names its machine's transition, so a " +
    "leave is born by `apply` and an advance by `request`, as the 215's `org payroll agreement offer` and `request issue` are " +
    "born by their own verbs; `balance` reads a view by its noun, as the 215's `balance` does and `org crm timeline` " +
    "reads its record's (contacts.conversation-spelling). Claiming sends at once: a claim's lines and receipts are " +
    "given whole, so a draft step would only delay " +
    "it, and Frappe's own Submit is the approver's, which `approve` is. Paying an advance approves it, as Frappe's " +
    "submit-then-pay does in one signature. Left out on purpose (payroll.hr-command-shape): a `get` where the list " +
    "prints the whole record, `change` on shift and expense types, and leave applied for someone else.",
  source: by("aaron.frappe-shape, aaron.sdk-reaches-everything, aaron.departments, aaron.world-clock", "docs/design/new-commands.md (G1 to G10, section 5.9)"),
  affects: [...HR_OPERATIONS],
});

export const decision_payroll_hr_command_shape = defineDecision({
  id: "payroll.hr-command-shape",
  title: "What the HR pack leaves out, and where each record's commands stop",
  question: "Which verbs does each HR record kind get, and which does it not?",
  options: [
    {
      label: "what-a-loop-needs",
      text:
        "Leave applications and an Employee's own advances have no `get`: their lists print every field; an expense claim " +
        "has one on each side for its lines and receipts, and the Organization's advance has one for the claims that " +
        "settled it. Shift types and expense claim types are added, never changed: attendance and claims keep the hours " +
        "and accounts they were decided by, and different ones are a new type (payroll.shift-types, payroll.expense-types). " +
        "Nobody applies for leave for another: an Employee with no account has their days marked by the People hat with " +
        "`org hr attendance mark --status on_leave --leave-type`, which docks pay the same way.",
    },
    { label: "full-grid", text: "Every verb of G3 on every record kind." },
  ],
  chosen: "what-a-loop-needs",
  why:
    "Each command is one SDK method and its own evals; one that adds nothing a reader cannot already see doubles the " +
    "surface without a capability. Frappe lets an HR Manager create leave for anyone, but on Capxul the leave's " +
    "authority is the Employee's own application and an approver's decision; the People hat already records days off " +
    "directly as attendance, which is what a slip reads (payroll.attendance-based).",
  source: by("aaron.frappe-shape", "docs/design/new-commands.md (G3)"),
  affects: [...HR_OPERATIONS],
});

export const decision_payroll_hr_rpc_methods = defineDecision({
  id: "payroll.hr-rpc-methods",
  title: "HR commands are their rpcs (G7); the two that pay and one preview are flows",
  question:
    "payroll.command-flows made every payroll command a flow, one call of its rpc, for its React twin. Do the HR " +
    "commands do the same?",
  options: [
    {
      label: "rpc-unless-composed",
      text:
        "Each HR command is implemented by its one rpc, its SDK method that rpc's (G7); `org hr expense-claim pay` and `org " +
        "hr advance pay` sign and wait, so each is one flow (`client.org.hr.expense-claims.pay`, `client.org.hr.advances.pay`) on " +
        "the CLI and the SDK; `org hr advance settle` previews and asks, since no command takes its deduction back (G5), so " +
        "it is one flow too (`client.org.hr.advances.settle`: read, prompt, settle). The 28 payroll commands keep their " +
        "flows, which already serve the web app.",
    },
    { label: "flows", text: "One flow per HR command, each one call, on the CLI, the SDK and the web app." },
  ],
  chosen: "rpc-unless-composed",
  why:
    "The CLI and the Core SDK reach everything, and the React SDK does not mirror it all (aaron.sdk-reaches-everything): " +
    "the React twin payroll.command-flows built every flow for is no longer a reason, so the HR commands follow G7's " +
    "default and are half the records. The flows of the 28 stay: they are booked, serve `react`, and changing them would " +
    "move 28 SDK methods for nothing.",
  source: by("aaron.sdk-reaches-everything", "docs/design/new-commands.md (G7); payroll.command-flows"),
  affects: [...HR_OPERATIONS, flow_client_org_hr_expense_claims_pay, flow_client_org_hr_advances_pay, flow_client_org_hr_advances_settle],
});

export const decision_payroll_attendance_based = defineDecision({
  id: "payroll.attendance-based",
  title: "Payroll is based on attendance, unmarked days present; `--unpaid` is gone",
  question:
    "Frappe HR's Payroll Settings bases a slip's payment days on leave applications or on attendance. Capxul's was " +
    "leave, with `org payroll run create --unpaid <employee>=<days>` for anything else. Now that leave and attendance " +
    "are native, which is it, and what of `--unpaid`?",
  options: [
    {
      label: "attendance",
      text:
        "`payroll_based_on` attendance, with `consider_unmarked_attendance_as` present, half a day's wage for a half day, " +
        "and marked attendance on holidays not counted. Approving a leave marks its days `on_leave` (Frappe's " +
        "`update_attendance`), so an unpaid type's days are leave without pay; an `absent` mark, by the People hat or by a " +
        "shift's check-ins, is an absent day; an Organization that marks nothing pays every day. `--unpaid` is retired: " +
        "a day to dock is marked.",
    },
    { label: "leave", text: "Keep leave-based: approved unpaid leave docks pay; attendance and check-ins never do." },
    { label: "per-org", text: "A Payroll Settings command choosing leave or attendance per Organization." },
  ],
  chosen: "attendance",
  why:
    "The brief asks that both leave and check-ins reach payment days; only attendance-based payroll does both, and with " +
    "unmarked days present it pays exactly what leave-based pays for an Organization that tracks no attendance, since " +
    "approval writes the same days as marks (`calculate_lwp_ppl_and_absent_days_based_on_attendance` over " +
    "`update_attendance`'s marks). One setting for every Organization keeps Payroll Settings what a head must match " +
    "(payroll.startup). A typed `--unpaid` count was a second source of truth beside the records a head would compute " +
    "from, so a head's recompute and Capxul's would differ; the records now carry it.",
  source: by("aaron.frappe-shape", "/tmp/hrms/hrms/payroll/doctype/salary_slip/salary_slip.py:545, :901; /tmp/hrms/hrms/hr/doctype/leave_application/leave_application.py:300"),
  affects: [table_payroll_settings, table_attendances, table_salary_slips, rpc_payroll_runs_create, rpc_payroll_runs_submit, operation_org_payroll_run_create],
});

export const decision_payroll_hr_approvers = defineDecision({
  id: "payroll.hr-approvers",
  title: "The department's hat decides its people's leave and money; never oneself",
  question: "Who approves leave, expense claims and advances, and may anyone approve their own?",
  options: [
    {
      label: "department-hat",
      text:
        "Leave: a wearer of the Employee's department's hat or of a budget's above it, or the People hat (Frappe's HR " +
        "Manager), read from indexing's hat-wearers. Expense claims and advances: whoever `Budgets.authorised` admits on " +
        "the department's budget, read on chain at the call, the hat that also pays them; not the People hat. Lists read " +
        "by the People hat (all) or a department's hat (its own and below). Nobody decides their own: HR Settings' " +
        "`prevent_self_leave_approval` and `prevent_self_expense_approval` on.",
    },
    { label: "people", text: "The People hat decides all of it, as Frappe's HR and Expense Approver roles." },
    { label: "self-allowed", text: "As above, but a wearer may approve their own, as Frappe's defaults allow." },
  ],
  chosen: "department-hat",
  why:
    "Budgets belong to departments and people move in and out by hat (aaron.departments): a claim or an advance is " +
    "that department's money, so its hat decides it, read on chain as paying is, and someone swapped out cannot. Leave " +
    "spends nothing, so its approver is read from the indexed hats like every People check, and the People hat may " +
    "decide too, as Frappe's HR Manager may. The People hat records pay but holds no budget " +
    "(budgets.role-conflict-people-hat), so it neither approves nor pays a claim, as it pays no run " +
    "(payroll.command-authority). For Aaron: with self-approval refused, a department's only hat wearer's own claims " +
    "and advances wait until another wears its hat or one above it; is that right, or should the Board decide them? " +
    "Recommended: keep refusing; a sole holder who spends on the department pays it as a department payment.",
  source: by("aaron.departments", `${HRMS}/expense_claim/expense_claim.py:207; ${HRMS}/leave_application/leave_application.py:873; docs/design/authority.md`),
  affects: [
    rpc_payroll_leave_approve,
    rpc_payroll_leave_reject,
    rpc_payroll_leave_list,
    rpc_payroll_expense_claims_approve,
    rpc_payroll_expense_claims_reject,
    rpc_payroll_expense_claims_cancel,
    rpc_payroll_expense_claims_pay,
    rpc_payroll_advances_pay,
    rpc_payroll_advances_reject,
    table_hr_settings,
    error_ROLE_PERMISSION_DENIED,
  ],
});

export const decision_payroll_hr_self = defineDecision({
  id: "payroll.hr-self",
  title: "An Employee's own HR commands take `--employer`, and need no Seat",
  question:
    "An Employee need not be a member (Noor has no account; a contractor holds no Seat). How do their own leave, " +
    "check-ins, claims and advances name the employer, and what admits them to the Organization's rows?",
  options: [
    {
      label: "employer",
      text:
        "No prefix, and `--employer <handle>`, never `--org`, which means acting for an Organization, which an Employee " +
        "is not (G1). A write or a balance acts at the employer it names (absent: the one Organization where the caller " +
        "is a live Employee); a list holds every employer's rows and `--employer` filters, exactly as `payroll payslip list " +
        "--employer` (G1); a command on one record takes the employer from its id (G5). The caller is a " +
        "signed-in person whose Party is the Employee's; an agent never is. Each HR row of one Employee carries " +
        "`employee_safe`, their Employee's `payee_safe`, which the row policy admits them by; the Organization's own " +
        "lists (holidays, leave, shift and expense types) admit its Employees by a join on employees.",
    },
    { label: "org", text: "`--org`, as a member's commands, so only an Employee with a Seat may apply or claim." },
  ],
  chosen: "employer",
  why:
    "Frappe HR's self-service is the Employee's, not a desk user's: leave and claims are the employee's own documents " +
    "(`validate_employee_scope`). Keying the row policy on the Safe pay already goes to (payroll.mailbox-for-pay) means " +
    "the same person reads their payslips and their leave by one admission, from every employer, and nothing is " +
    "admitted by a Seat they do not hold. A name that matches no employer is INVALID_INPUT, as `payroll payslip list " +
    "--employer` refuses one. An Employee acts for themselves, as a payee accepting an agreement does, so " +
    "docs/design/authority.md's Seat-first rule, for acting for an Organization with its hats, does not reach them; " +
    "every decision on their records is still a Seat's and a hat's (payroll.hr-approvers).",
  source: by("aaron.frappe-shape", `${HRMS}/expense_claim/expense_claim.py:163; payroll.payee-reads; docs/design/new-commands.md (G1)`),
  affects: [...SELF_RPCS, error_INVALID_INPUT],
});

export const decision_payroll_hr_money = defineDecision({
  id: "payroll.hr-money",
  title: "Claims and advances settle once, through payments, from the department's budget",
  question: "How does a claim's or an advance's money move, and where are its books posted?",
  options: [
    {
      label: "payments-door",
      text:
        "Approving a claim posts its accrual through books' door `books.record-payroll-accrual` (action `expense_claim`: " +
        "each line's expense, advances taken credited to Employee Advances, the rest to the payable, party the Employee, " +
        "reference the Expense Claim; `expense_claim_cancel` reverses it). Paying a claim or an advance is one payment " +
        "command through `payments.prepare-command`, purpose payroll, route budget, from the department's budget to the " +
        "Employee's Safe, one approval from the payer's own Safe, its memo stored by `documents.store`, its source the " +
        "claim (`expense-claim`) or the advance (`employee-advance`) and its `against` the payable or Employee Advances. " +
        "A lapsed approval resumes the same command; a declined one leaves it owed; one process per claim and per advance " +
        "follows `payment_transitioned` to paid. Books posts the settled Payment's entry from payments' fact.",
    },
    { label: "own-transfer", text: "Payroll sends the reimbursement itself, as its own chain call." },
  ],
  chosen: "payments-door",
  why:
    "Every money path settles once, through payments (payroll.pays-through-payments): the same door, approvals and " +
    "settlement a run uses, so K1 (one key, one command) and K3 (funding read first) hold and books sees one fact per " +
    "Payment. It is Frappe's own shape: an Expense Claim posts its payable on submit and a Payment Entry against the " +
    "Employee clears it; an Employee Advance is paid by a Payment Entry to the advance account. Each pay invokes two " +
    "doors of two concepts (`documents.store`, `payments.prepare-command`), within the transaction width " +
    "(rules.transaction-width). Payments' PaymentSource gains the two kinds, and books' accrual door the claim's " +
    "actions, Employee Advances as a role and Expense Claim and Employee Advance as references (for the owners).",
  source: by("aaron.departments, aaron.frappe-shape", `${HRMS}/expense_claim/expense_claim.py:302; ${HRMS}/employee_advance/employee_advance.py:160; payroll.pays-through-payments`),
  affects: [
    rpc_payroll_expense_claims_approve,
    rpc_payroll_expense_claims_cancel,
    rpc_payroll_expense_claims_pay,
    rpc_payroll_advances_pay,
    workflow_payroll_expense_claims_payment,
    workflow_payroll_advances_payment,
    flow_client_org_hr_expense_claims_pay,
    flow_client_org_hr_advances_pay,
    machine_expense_claim,
    machine_employee_advance,
    operation_org_hr_expense_claim_pay,
    operation_org_hr_advance_pay,
  ],
});

export const decision_payroll_advance_recovery = defineDecision({
  id: "payroll.advance-recovery",
  title: "What no claim takes of an advance is recovered from the next salary",
  question: "An advance an Employee's claims do not use up must come back. How?",
  options: [
    {
      label: "salary",
      text:
        "`org hr advance settle` makes one Additional Salary deducting the unclaimed amount under the Organization's advance " +
        "recovery component, its payroll date the first day after the Employee's latest submitted slip, as Frappe's " +
        "`create_return_through_additional_salary`; the next run takes it as a deduction row, its accrual credits Employee " +
        "Advances (`add_advance_deduction_entry`), and the advance is returned when that slip is submitted, paid again if " +
        "the run is cancelled. No command takes the deduction back, so `org hr advance settle` previews it and asks (G5).",
    },
    { label: "transfer", text: "The Employee sends the money back to the company Safe, recorded as Frappe's return Journal Entry." },
  ],
  chosen: "salary",
  why:
    "A recovery from salary moves no money of its own: the run's one payment is lower, so the department's budget simply " +
    "spends less, and nothing waits on the Employee. A transfer back would be a payment from a person's Safe that " +
    "payroll cannot birth, and on a head it is a Journal Entry the books' sync takes in. The payroll date after the " +
    "latest submitted slip makes Capxul's run and a head's take it in the same period. Additional Salary is native for " +
    "this one use; bonuses, arrears and incentives stay a head's (payroll.hr-scope).",
  source: by("aaron.frappe-shape", `${HRMS}/employee_advance/employee_advance.py:309; /tmp/hrms/hrms/payroll/doctype/payroll_entry/payroll_entry.py:481`),
  affects: [
    table_additional_salaries,
    table_salary_components,
    rpc_payroll_advances_settle,
    flow_client_org_hr_advances_settle,
    rpc_payroll_runs_create,
    rpc_payroll_runs_submit,
    rpc_payroll_runs_cancel,
    machine_employee_advance,
    operation_org_hr_advance_settle,
  ],
});

export const decision_payroll_leave_balance = defineDecision({
  id: "payroll.leave-balance",
  title: "Leave balances are counted from allocations and applications, no ledger",
  question: "Frappe keeps a Leave Ledger Entry per allocation, leave and expiry. Does Capxul keep one?",
  options: [
    {
      label: "counted",
      text:
        "No ledger table: a type's balance on a day is its allocation covering the day (new days and carried ones) less " +
        "its approved applications' days inside the allocation, pending the open ones, as `get_leave_details` reads it. " +
        "Carrying forward takes the previous allocation's unused days up to the type's maximum at allocation, and marks " +
        "that previous allocation `expired`, as Frappe's Leave Allocation `on_submit` expires it (`expire_allocation`), " +
        "so its balance is 0 from then on and no carried day is taken twice. Carried days themselves do not expire " +
        "natively; a head's expiry arrives as its own allocations.",
    },
    { label: "ledger", text: "A `leave-ledger-entries` table written at each allocation, approval, cancel and expiry." },
  ],
  chosen: "counted",
  why:
    "Without earned leave, encashment or expiry, which are a head's (payroll.hr-scope), the ledger holds nothing the " +
    "allocations and applications do not, and a second record of the same days could drift. A head builds its own " +
    "ledger from the synced allocations and applications when Frappe submits them, so nothing is lost there; expiring " +
    "the allocation carried from keeps Capxul's count and that rebuilt ledger the same.",
  source: by("aaron.frappe-shape", "hrms leave_application.py:981 (get_leave_details), leave_allocation.py:112 (on_submit), leave_ledger_entry.py:235 (expire_allocation)"),
  affects: [table_leave_allocations, table_leave_applications, machine_leave_allocation, rpc_payroll_leave_allocate, rpc_payroll_leave_balance, rpc_payroll_leave_my_balance],
});

export const decision_payroll_shift_types = defineDecision({
  id: "payroll.shift-types",
  title: "Day shifts, first in to last out, marked per assignment on the world's clock",
  question: "What shifts and attendance rules does Capxul keep, and what marks a day from check-ins?",
  options: [
    {
      label: "per-assignment",
      text:
        "Shift types end after they start on one day; working hours are from the first check-in to the last check-out " +
        "with alternating entries, Frappe's first options; a type is added, never changed; late entry and early exit are " +
        "marked only when a grace is given (Frappe's `enable_late_entry_marking`, `enable_early_exit_marking`). Each " +
        "active Shift Assignment is one durable process whose timer, on the world's clock, marks each day from its start " +
        "day on, 60 minutes after its shift ends, a day with no check-in absent then (Frappe's `absent_buffer_days` 0, " +
        "not its default 1).",
    },
    { label: "sweep", text: "A cron sweep every hour over every shift type, as Frappe's scheduler runs `process_auto_attendance`." },
  ],
  chosen: "per-assignment",
  why:
    "Policy P3 keeps no sweep: a long-lived object owns its timer (rules.durable-processes), and the assignment is the " +
    "object whose days are marked. Its timer on the world's clock means a devnet warped a week marks the week, and a " +
    "shared world running four times fast marks four days an hour (aaron.world-clock). Night shifts across midnight and " +
    "every-check-in counting change which day a check-in belongs to; they are a head's until a customer needs them. " +
    "Never changing a type keeps every marked day explainable by the hours it was marked by. Marking an unchecked day " +
    "absent at its own marking, rather than a day later, keeps one timer per day and a slip's absences final once the " +
    "day's timer has fired; a People hat who knows of an absence marks it before then.",
  source: by("aaron.world-clock", `${HRMS}/shift_type/shift_type.py; ${HRMS}/employee_checkin/employee_checkin.py; P3`),
  affects: [table_shift_types, table_shift_assignments, machine_shift_assignment, rpc_payroll_shift_types_add, workflow_payroll_attendance_auto],
});

export const decision_payroll_hr_world_clock = defineDecision({
  id: "payroll.hr-world-clock",
  title: "A check-in is stamped by the world's clock, never by the caller or device",
  question: "What time does a check-in carry, and what times do HR's days and timers follow?",
  options: [
    {
      label: "world",
      text:
        "The world's clock: the backend's now in that world (a devnet's, staging's or a shared world's, frozen, running or " +
        "at its rate), never a time the caller gives; days are the Organization's time zone on that clock, as every " +
        "Frappe Date is; the shift process's timers are the world's. The one check-in time Capxul does not stamp is a " +
        "connected head's device check-in, pulled with the `time` the head recorded: the head follows the world's clock " +
        "(devnet.head-follows-world), and one later than the world's now at the pull is refused and reported to the head.",
    },
    { label: "device", text: "The time the device sends, as Frappe's mobile check-in posts it." },
  ],
  chosen: "world",
  why:
    "Each world is self-contained and everything in it follows its one clock (aaron.world-clock): a check-in stamped by " +
    "a device would put a devnet's attendance on real time and make every attendance eval depend on when it ran. A " +
    "time the caller chose would let anyone check in for an hour they were not there. A head's biometric device posts " +
    "its own `timestamp` (Frappe's `add_log_based_on_employee_field`), so a head check-in cannot carry Capxul's now; " +
    "refusing one ahead of the world's now keeps no check-in in the world's future, and the pull's People-hat user is " +
    "the authority it arrives under, as every pulled change's is (payroll.head-sync).",
  source: by("aaron.world-clock", `${HRMS}/employee_checkin/employee_checkin.json (time); docs/design/time.md`),
  affects: [table_employee_checkins, rpc_payroll_attendance_checkin, workflow_payroll_attendance_auto, workflow_payroll_head_sync, operation_hr_attendance_checkin],
});

export const decision_payroll_expense_types = defineDecision({
  id: "payroll.expense-types",
  title: "Expense claim types are added, never changed; null is books' default account",
  question: "Does an expense claim type get a `change` command, and what account does a type with none post to?",
  options: [
    {
      label: "add-only",
      text:
        "Added with an optional books expense account, never changed; a claim records the account each line was approved " +
        "with. Null posts to books' default expense account, chosen by books when the accrual is recorded.",
    },
    { label: "changeable", text: "`org hr expense-type change`, the account changing for claims approved after." },
  ],
  chosen: "add-only",
  why:
    "A type has two fields beside its name; a wrong account is a new type, and the old one simply goes unused. Books " +
    "already falls back for a missing or unfit account (books.payroll-defaults), so a start-up's types need no chart.",
  source: by("aaron.frappe-shape", `${HRMS}/expense_claim_type/expense_claim_type.json; books.payroll-defaults`),
  affects: [table_expense_claim_types, rpc_payroll_expense_types_add],
});

export const decision_payroll_hr_head_sync = defineDecision({
  id: "payroll.hr-head-sync",
  title: "HR syncs with a head as payroll does; money and its decisions stay Capxul's",
  question: "How do the native HR DocTypes sync with a connected Frappe HR head, which is the Organization's UI?",
  options: [
    {
      label: "shared-records",
      text:
        "Pushed in seq order by payroll's head sync, by `capxul_id`: holidays, leave types, allocations, shift types and " +
        "assignments, attendance and expense claim types, and pulled as the People hat's edits; leave applications " +
        "pushed while open as Frappe's draft, and a head's own applications and decisions taken in when the head user is " +
        "the Employee, or an approver here; a head device's check-ins taken in; shift types pushed with auto attendance " +
        "off, so only Capxul marks; expense claims and advances pushed once decided, read-only; Additional Salaries " +
        "pushed, and a head run's advance recovery returns the advance here.",
    },
    { label: "push-only", text: "Push everything; take nothing from the head." },
  ],
  chosen: "shared-records",
  why:
    "Frappe is the UI (aaron.erp-on-capxul): an Employee applies for leave in Frappe HR's app and a manager approves it " +
    "there, so those decisions must arrive, checked against Capxul's own authority, as a head's Payroll Entry is " +
    "(payroll.import-run). Claims and advances are money, Capxul's (organizations.head-ownership), so their decisions " +
    "and payments are made here and shown there. Two auto-attendance engines would mark a day twice.",
  source: by("aaron.erp-on-capxul, aaron.frappe-head", "payroll.head-sync; organizations.head-ownership; organizations.head-doorbell"),
  affects: [workflow_payroll_head_sync, workflow_payroll_startup_open, ...HR_TABLES, machine_leave_application, machine_attendance],
});

export const decision_payroll_hr_worlds = defineDecision({
  id: "payroll.hr-worlds",
  title: "Six worlds hold Acme's HR in every state a claim or refusal needs",
  question: "Which worlds do the HR commands' claims and refusals start from?",
  options: [
    {
      label: "six",
      text:
        "org-with-employees, and five built on it with booked commands: org-with-leave, built on a working day at least " +
        "the third of a month whose next month is in the same year, January to November, so this year's weekly offs, " +
        "Founders' Day and allocations cover every day its claims name (holidays with weekly offs and " +
        "Founders' Day; Annual, Sick and Unpaid Leave; allocations; Sam's open Annual Leave and approved unpaid day; Lead, " +
        "now an Employee, with his own open leave; Noor marked absent); org-with-attendance (the Day shift assigned to " +
        "Sam from the next working day, not today, which would be marked absent with no check-in; two days marked from " +
        "his check-ins); org-with-expenses (Travel and Meals; Sam's claims open, approved and " +
        "paid; advances paid and claimed, paid, and requested; Lead's own open claim); and its budget-used, short-safe " +
        "and chain-unreachable variants.",
    },
    { label: "in-eval", text: "Each eval builds what it needs from org-with-employees." },
  ],
  chosen: "six",
  why:
    "The claims share these states, so one build each serves them all. Each authority claim has its actor: Pat holds " +
    "the People hat and no budget, Lead `salaries`' hat and is an Employee too for the self-approval refusals, Plat " +
    "another department's hat, Sam an Employee with no hat, Mia a member who is no Employee, Olga outside. The money " +
    "variants mirror the run worlds so each money code is reached by a real state. A world is built at the eval epoch " +
    "and its warps (devnet.deterministic-worlds), whose month the book does not fix, so a claim that names a day ahead " +
    "stays inside the year its holidays and allocations were made for.",
  source: by("aaron.departments, aaron.world-clock", "books/target/devnet/worlds.ts (org-with-employees, org-with-payroll-*); payroll.command-worlds"),
  affects: [...HR_OPERATIONS],
});

export const decision_payroll_hr_critical = defineDecision({
  id: "payroll.hr-critical",
  title: "Seven HR commands are critical: the leave and claim loops a start-up runs",
  question: "Which HR commands does the build do first?",
  options: [
    {
      label: "seven",
      text:
        "`org hr leave-type add`, `org hr leave allocate`, `hr leave apply`, `org hr leave approve`, `hr expense-claim create`, `org " +
        "hr expense-claim approve` and `org hr expense-claim pay`: define leave, give it, take it and decide it; claim, decide " +
        "and pay an expense. The rest normal.",
    },
    { label: "none", text: "Every HR command normal." },
  ],
  chosen: "seven",
  why:
    "A first payroll month meets leave and expenses at once: the leave loop changes pay, and the claim loop is the only " +
    "HR money that moves by itself. As in payroll.critical-commands, critical orders the build's work and changes no " +
    "budget; none is on the B3 pilots' path.",
  source: by("aaron.frappe-shape", "payroll.critical-commands; docs/design/new-commands.md (G8)"),
  affects: [...HR_CRITICAL],
});

export const decision_payroll_hr_notices = defineDecision({
  id: "payroll.hr-notices",
  title: "HR's events carry who to tell; notices sends, payroll sends nothing",
  question: "Who tells an approver a leave or claim waits, and the Employee how it was decided?",
  options: [
    {
      label: "notices",
      text:
        "Notices, from `leave_application_transitioned`, `expense_claim_transitioned` and `employee_advance_transitioned`, " +
        "which carry the Employee, the department and the decider; payroll sends no mail, as HR Settings turns Frappe's " +
        "own reminders off.",
    },
    { label: "payroll", text: "Payroll mails the approvers and the Employee itself." },
  ],
  chosen: "notices",
  why: "Every notice is notices' (payroll.notices-elsewhere), from a transition's one event (P7); the events carry what it needs to find the department's hat wearers.",
  source: by("aaron.frappe-shape", "payroll.notices-elsewhere; rules.outbox"),
  affects: [machine_leave_application, machine_expense_claim, machine_employee_advance, operation_hr_leave_apply, operation_hr_expense_claim_create, operation_org_hr_leave_approve, operation_org_hr_expense_claim_approve],
});

export const decision_payroll_hr_head_documents = defineDecision({
  id: "payroll.hr-head-documents",
  title: "Head HR documents that write native records: synced, or refused",
  question:
    "Six HR DocTypes stay on the head (payroll.hr-scope) yet write native records when submitted (hrms@8816102): " +
    "Attendance Request makes Attendance, Shift Request a Shift Assignment, Compensatory Leave Request and Leave Policy " +
    "Assignment make or change Leave Allocations, Leave Adjustment writes only Leave Ledger Entries, and Overtime Slip " +
    "makes an Additional Salary. The document family reaches all six (command-surface.md 7.6). Does it refuse them, or " +
    "does the head sync take in what they write?",
  options: [
    {
      label: "sync-and-refuse-ledger",
      text:
        "The sync takes in what four of them write, and the family refuses the one whose effect Capxul does not hold. " +
        "Attendance Request, Shift Request, Compensatory Leave Request and Leave Policy Assignment stay reached: only HR " +
        "User or HR Manager may submit them, which through the family only the People hat gives (organizations.head-users), " +
        "so the Attendance, Shift Assignment and Leave Allocations they write are the People hat's edits, which the sync " +
        "pulls (payroll.hr-head-sync). Leave Adjustment is refused by name (NATIVE_DOCTYPES), naming `org hr leave " +
        "allocate` and `unallocate`: it writes only the head's leave ledger, which Capxul does not keep (a balance is " +
        "allocations less leave taken), so nothing could take it in. Overtime Slip stays reached: no hat gives the roles " +
        "that submit it, and one submitted in the head's own desk makes an Additional Salary, so that period's run is the " +
        "head's (payroll.one-computer-per-run).",
    },
    { label: "refuse-all", text: "Refuse all six by name, naming the native HR commands." },
    { label: "drafts-only", text: "Reach all six, but refuse their submit and cancel through the family." },
  ],
  chosen: "sync-and-refuse-ledger",
  why:
    "The hole was a head writing a native record the sync does not take in. For four of the six it cannot happen through " +
    "the family: Frappe HR's own permissions let only HR User and HR Manager submit them, and only the People hat gives " +
    "a member's head User HR Manager, so what they write arrives as People's edits, which the pull already takes in. " +
    "Leave Adjustment's only effect is ledger entries, outside every native table, so the only safe answer is to refuse " +
    "it and point to the native allocation commands. Overtime Slip's submit needs HR User or Leave Approver, which no " +
    "hat gives, and the desk's own was already decided by one computer per run. refuse-all would take away recruitment's " +
    "neighbours (requests, policies) that reach nothing native but through People; drafts-only would leave submit, the " +
    "point of the document, out of reach.",
  source:
    "Claude, surface pass build, 9 November 2026; evidence: hrms@8816102 attendance_request, shift_request, " +
    "compensatory_leave_request, leave_policy_assignment, leave_adjustment (on_submit), overtime_slip .json permissions; " +
    "organizations.head-users",
  affects: [concept_payroll, workflow_payroll_head_sync, table_leave_allocations, table_attendances, table_shift_assignments],
});

export const decision_payroll_receipt_hashes = defineDecision({
  id: "payroll.receipt-hashes",
  title: "An expense claim answers each receipt's hash pair, so tooling can read it",
  question:
    "`hr expense-claim get` and `org hr expense-claim get` answered each receipt as {documentId, filename}, but " +
    "`document get`, `export` and `render` read a document only by its hash pair (`--document-hash`, " +
    "`--content-hash`), and no command reads one by id. A stored receipt was readable from no tool, though Frappe HR " +
    "shows an Expense Claim's attachments. How is it read?",
  options: [
    {
      label: "hash-pair",
      text:
        "The claim keeps the hash pair `documents.store` already answers (`document_hash`, `content_hash`) on each receipt " +
        "row, and both claim reads answer `documentHash` and `contentHash` beside `documentId`. The claimant and the " +
        "claim's readers then read it with `document get|export --document-hash --content-hash`, which documents already " +
        "admits for a receipt's readers. Documents needs no change.",
    },
    { label: "by-id", text: "Add `document get --id` to documents." },
  ],
  chosen: "hash-pair",
  why:
    "Every document is read by its hash pair (documents' reading), and the store call already returns it, so answering " +
    "it costs one field and no new command. A receipt's hashes are on no chain and only the claim read answers them, " +
    "and that read is the claimant's own or the People or department hat's, so nobody gains a way to a receipt the " +
    "claim read does not already give (unlike a payslip, whose hash its Payment puts on chain).",
  source:
    "Claude, surface pass build, 9 November 2026; evidence: documents/reading.ts (HashPair); documents/procedures.ts " +
    "(Stored); payroll/hr-shapes.ts (Claim.receipts); the money fit review",
  affects: [table_expense_claims, rpc_payroll_expense_claims_create, rpc_payroll_expense_claims_mine_get, rpc_payroll_expense_claims_get],
});

export const decision_payroll_hr_self_rules = defineDecision({
  id: "payroll.hr-self-rules",
  title: "An Employee reads their employer's holidays, leave types and expense types",
  question:
    "payroll.hr-self admits an Employee, with or without a Seat, to read their employer's holidays, leave types, shift " +
    "types and expense types 'to apply and claim', but the only commands that read them are `org hr … list`, which " +
    "need a Seat and `--org`. So an Employee with no Seat can run `hr expense-claim create --type Travel` but cannot " +
    "list the types, or the holidays a leave does not count. Which person-side reads are booked?",
  options: [
    {
      label: "three-reads",
      text:
        "`hr holiday list [--employer] [--year]`, `hr leave-type list [--employer] [--after] [--limit]` and `hr " +
        "expense-type list [--employer] [--after] [--limit]`, each a self rpc over the same rows (payroll.holidays.mine, " +
        "payroll.leave-types.mine, payroll.expense-types.mine) behind the self guard, answering what the member list " +
        "answers. SDK: `client.me.hr.holidays.list`, `client.me.hr.leaveTypes.list`, `client.me.hr.expenseTypes.list`. " +
        "No `hr shift-type list`: the member list answers who works each shift, which is not an Employee's to read, and " +
        "an Employee's own shift shows in their attendance.",
    },
    { label: "four-reads", text: "The same, and `hr shift-type list`, with its assignments cut to the caller's own." },
    { label: "member-lists", text: "Let `org hr … list` admit an Employee of the Organization with no Seat." },
  ],
  chosen: "three-reads",
  why:
    "Applying and claiming are an Employee's own, so the rules they apply under must be readable on the same side, " +
    "without a Seat (aaron.frappe-shape: Frappe HR's Employee role reads Holiday List, Leave Type and Expense Claim " +
    "Type), and from the SDK (aaron.sdk-reaches-everything). member-lists breaks G1, where `--org` is refused from a " +
    "non-member. A shift type matters to an Employee only as their own assignment, so its list stays the " +
    "Organization's. The three sit in the HR group of the tree (surface.hr-group), part of question 50.",
  source:
    "Claude, surface pass build, 9 November 2026, for aaron.frappe-shape and aaron.sdk-reaches-everything; evidence: " +
    "payroll.hr-self; hrms holiday_list, leave_type, expense_claim_type .json (Employee read); the frappe-apps fit review",
  affects: [
    concept_payroll, rpc_payroll_holidays_mine, rpc_payroll_leave_types_mine, rpc_payroll_expense_types_mine,
    operation_hr_holiday_list, operation_hr_leave_type_list, operation_hr_expense_type_list,
  ],
});
