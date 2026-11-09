// The leave area: Frappe HR's Holiday List, Leave Type, Leave Allocation and Leave Application, kept by Capxul
// (hr-data.ts). A People hat wearer (Frappe's HR Manager) keeps the Organization's holidays and leave types and
// allocates leave; an Employee applies for leave and cancels it, member or not; whoever wears the Employee's
// department's hat or one above it, or the People hat, approves or rejects it, never the applicant
// (payroll.hr-approvers). Approving marks the leave's days in attendance, which a run reads for payment days
// (payroll.attendance-based). Each command is one rpc and one transaction (payroll.hr-rpc-methods); none touches
// the chain.

import { Schema } from "effect";
import { budget, defineRpc } from "../../../packages/book/src/index.ts";
import { concept_payroll } from "../shared/foundation.ts";
import { error_INVALID_INPUT, error_NOT_AUTHENTICATED, error_ROLE_PERMISSION_DENIED, error_WRONG_STATE } from "../shared/vocabulary.ts";
import { table_organizations } from "../organizations/data.ts";
import { table_budgets } from "../budgets/data.ts";
import { table_parties } from "../parties/data.ts";
import { table_employees, table_salary_slips } from "./data.ts";
import {
  machine_attendance,
  machine_leave_allocation,
  machine_leave_application,
  table_attendances,
  table_holiday_lists,
  table_hr_settings,
  table_leave_allocations,
  table_leave_applications,
  table_leave_types,
} from "./hr-data.ts";
import { HR_ERRORS, HR_GUARD, HR_READS, LOGGED, WHO_HR } from "./employees.ts";
import {
  Allocation,
  AllocateInput,
  AllocationRef,
  ApplyInput,
  Balance,
  HolidayAddInput,
  HolidayList,
  HolidayListInput,
  HolidayRemoveInput,
  Leave,
  LeavePage,
  LeaveRef,
  LeaveType,
  LeaveTypeAddInput,
  LeaveTypeChangeInput,
  LeaveTypeListInput,
  LeaveTypePage,
  MyBalanceInput,
  MyLeaveListInput,
  MyLeaveRef,
  OrgBalanceInput,
  OrgLeaveListInput,
  RejectLeaveInput,
} from "./hr-shapes.ts";

const HR = "/tmp/hrms/hrms/hr/doctype";
const LAP = `${HR}/leave_application/leave_application.py`;
const READ_ERRORS = [error_NOT_AUTHENTICATED, error_ROLE_PERMISSION_DENIED, error_INVALID_INPUT] as const;
/** What every HR write also writes: its rows' change log and HR Settings, born by the first HR write that finds none. */
export const HR_LOGGED = [...LOGGED, table_hr_settings] as const;

/** Who a member command for the Organization's own lists is: any member reads them. */
export const WHO_MEMBER = "A signed-in member of the Organization, person or agent: an active Seat in it.";
export const MEMBER_GUARD = "The caller must hold an active Seat in the Organization (ROLE_PERMISSION_DENIED otherwise). ";

/** Who a self command is: the Employee, by their own Party, member or not (payroll.hr-self). */
export const WHO_SELF_HR =
  "A signed-in person whose Party is a live (not left) Employee: for a write or a balance, of the Organization " +
  "`--employer` names, or of the one Organization that employs them when it is not given; for a list, of every " +
  "Organization that employs them, `--employer` keeping one, as `payslip list` (G1); for a command on one of their " +
  "records, of that record's employer. An Employee needs no Seat. Never an agent as itself: " +
  "Frappe's Employee is a person, and the hosted FDE acts here only for the person who asked it, as them " +
  "(aaron.fde-anyone, organizations.fde-for-the-asker).";
/** The guard every self write and balance runs first: one employer, `--employer` or the only one. */
export const SELF_GUARD =
  "The caller must be signed in (NOT_AUTHENTICATED), a person whose Party is a live Employee of the employer named by " +
  "`--employer`, or of their only employer when absent (INVALID_INPUT for a handle that names no Organization " +
  "employing them, an agent, or several employers and none named); nothing is read or written otherwise. ";
/** The guard every self list runs first: every employer's rows, as `payslip list` holds every payer's (G1). */
export const SELF_LIST_GUARD =
  "The caller must be signed in (NOT_AUTHENTICATED) and a person (INVALID_INPUT for an agent). The list holds their " +
  "rows from every Organization where they are a live Employee, each naming its employer, as `payslip list` holds " +
  "every payer's (G1: `--employer` is a filter); `--employer` keeps one employer's (INVALID_INPUT for a handle that " +
  "names no Organization employing them); nothing is read otherwise. ";
/** The guard every self command on one record runs first: the record's id names its employer (G5). */
export const SELF_RECORD_GUARD =
  "The caller must be signed in (NOT_AUTHENTICATED), a person whose Party is a live Employee of the record's employer " +
  "and the record theirs (INVALID_INPUT for one that is not, or for an agent); the id names the employer, so " +
  "`--employer` is needed by no one with several, and if given must be that employer (INVALID_INPUT); nothing is read " +
  "or written otherwise. ";
/** What the self guard reads: the caller's Party, the employer by handle, and their Employee there. */
export const SELF_READS = [table_parties, table_organizations, table_employees] as const;
export const SELF_ERRORS = [error_NOT_AUTHENTICATED, error_INVALID_INPUT, error_WRONG_STATE] as const;

/** Who decides a leave application (payroll.hr-approvers). */
export const WHO_LEAVE_APPROVER =
  "A signed-in member, person or agent, whose own Safe wears the hat of the Employee's department (the budget their " +
  "Employee names) or of a budget above it, or the People hat (Frappe's HR Manager), read from indexing's " +
  "hat-wearers; never the applicant themselves (HR Settings' `prevent_self_leave_approval`). An Employee with no " +
  "department is decided by the People hat.";
const APPROVER_GUARD =
  "The caller must hold an active Seat whose Safe wears the Employee's department's hat, a hat above it in the budget " +
  "tree, or the People hat (ROLE_PERMISSION_DENIED otherwise), and must not be the applicant (ROLE_PERMISSION_DENIED: " +
  "self-approval is refused). ";
const APPROVER_READS = [...HR_READS, table_budgets] as const;

/** How a leave's days are counted, as Frappe's `get_number_of_leave_days` counts them. */
const DAYS =
  "Its days are the calendar days from start to end, less the holidays of the Organization's list among them unless " +
  "the type includes holidays, less half a day for a half day (on `--half-day-on`, else the start), which may not be a " +
  "holiday; none left is INVALID_INPUT (the days are all holidays).";

// ── holidays ────────────────────────────────────────────────────────────────────────────────

export const rpc_payroll_holidays_add = defineRpc({
  id: "payroll.holidays.add",
  title: "Add a holiday, or a year's weekly offs, to the Organization's list",
  about:
    HR_GUARD +
    "With a day: that day becomes a holiday of the list of its year, with its description (INVALID_INPUT without one) " +
    "and `halfDay` if given; a day already a holiday is WRONG_STATE naming it. With `weekly` and `year`: every such " +
    "weekday of that year not already a holiday becomes a weekly off, its description the weekday's name, as Frappe's " +
    "`get_weekly_off_dates` adds them. Exactly one of the two (INVALID_INPUT). The year's list is born `<Company> " +
    "<year>`, 1 January to 31 December, by the first holiday added to it. Approved leave already counted is not " +
    "counted again, as in Frappe. It answers the year's list.",
  was: ["/tmp/erpnext/erpnext/setup/doctype/holiday_list/holiday_list.py"],
  concept: concept_payroll,
  kind: "mutation",
  who: WHO_HR,
  input: HolidayAddInput,
  output: HolidayList,
  errors: [...HR_ERRORS],
  reads: [...HR_READS, table_organizations, table_holiday_lists],
  writes: [table_holiday_lists, ...HR_LOGGED],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("write"),
});

export const rpc_payroll_holidays_remove = defineRpc({
  id: "payroll.holidays.remove",
  title: "Remove a holiday from the Organization's list",
  about:
    HR_GUARD +
    "The day must be a holiday of its year's list (INVALID_INPUT naming the day otherwise); its row is removed and " +
    "`total_holidays` falls. A day removed is a working day from then on: leave already decided keeps the days it " +
    "counted, as Frappe's does. It answers the year's list.",
  was: ["/tmp/erpnext/erpnext/setup/doctype/holiday_list/holiday_list.py"],
  concept: concept_payroll,
  kind: "mutation",
  who: WHO_HR,
  input: HolidayRemoveInput,
  output: HolidayList,
  errors: [...READ_ERRORS],
  reads: [...HR_READS, table_holiday_lists],
  writes: [table_holiday_lists, ...HR_LOGGED],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("write"),
});

export const rpc_payroll_holidays_list = defineRpc({
  id: "payroll.holidays.list",
  title: "List the Organization's holidays for a year",
  about:
    MEMBER_GUARD +
    "The holidays of one year's list (this year in the Organization's time zone unless `year` is given), in date " +
    "order, weekly offs included and marked; a year with no list answers no holidays and a null list. It reads only.",
  was: ["/tmp/erpnext/erpnext/setup/doctype/holiday_list/holiday_list.json"],
  concept: concept_payroll,
  kind: "query",
  who: WHO_MEMBER,
  input: HolidayListInput,
  output: HolidayList,
  errors: [...READ_ERRORS],
  reads: [table_holiday_lists, ...HR_READS],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("read"),
});

// ── leave types ─────────────────────────────────────────────────────────────────────────────

const TYPE_RULES =
  "`maxDays` and `maxCarry` are more than 0, `applicableAfter` and `maxContinuous` whole days, `partlyPaid` more than " +
  "0 and less than 1, and a type is never both unpaid and partly paid, nor carried forward when unpaid " +
  "(INVALID_INPUT naming the field).";

export const rpc_payroll_leave_types_add = defineRpc({
  id: "payroll.leave-types.add",
  title: "Add a leave type",
  about:
    HR_GUARD +
    "A Leave Type with its name (unique in the Organization: WRONG_STATE naming the one that has it) and the flags " +
    "given, every other off: no day limit, applicable from joining, no continuous limit, not carried forward, paid, " +
    "holidays not counted, no negative balance. " +
    TYPE_RULES +
    " Earned, compensatory, optional and encashable leave are a head's (payroll.hr-scope). It answers the type.",
  was: [`${HR}/leave_type/leave_type.json`, `${HR}/leave_type/leave_type.py`],
  concept: concept_payroll,
  kind: "mutation",
  who: WHO_HR,
  input: LeaveTypeAddInput,
  output: LeaveType,
  errors: [...HR_ERRORS],
  reads: [...HR_READS, table_leave_types],
  writes: [table_leave_types, ...HR_LOGGED],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("write"),
});

export const rpc_payroll_leave_types_change = defineRpc({
  id: "payroll.leave-types.change",
  title: "Change a leave type's rules",
  about:
    HR_GUARD +
    "The type by name or `lvt_` id (INVALID_INPUT for none of the Organization's); the flags given are set and the rest " +
    "kept, `clear` empties a limit; giving nothing is INVALID_INPUT. " +
    TYPE_RULES +
    " Making a type unpaid, or paid again, is WRONG_STATE while any application of it is approved: a slip already " +
    "worked out from it would disagree with its type. New applications and allocations follow the change; decided ones " +
    "keep their days. A type a head made with head-only leave is changed on the head (WRONG_STATE naming the head). It " +
    "answers the type.",
  was: [`${HR}/leave_type/leave_type.py`],
  concept: concept_payroll,
  kind: "mutation",
  who: WHO_HR,
  input: LeaveTypeChangeInput,
  output: LeaveType,
  errors: [...HR_ERRORS],
  reads: [...HR_READS, table_leave_types, table_leave_applications],
  writes: [table_leave_types, ...HR_LOGGED],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("write"),
});

export const rpc_payroll_leave_types_list = defineRpc({
  id: "payroll.leave-types.list",
  title: "List the Organization's leave types",
  about: MEMBER_GUARD + "The leave types by name, each with its rules. A page at a time, as every list's (payroll.command-fit). It reads only.",
  was: [`${HR}/leave_type/leave_type.json`],
  concept: concept_payroll,
  kind: "query",
  who: WHO_MEMBER,
  input: LeaveTypeListInput,
  output: LeaveTypePage,
  errors: [...READ_ERRORS],
  reads: [...HR_READS, table_leave_types],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("read"),
});

// ── allocations and balances ────────────────────────────────────────────────────────────────

export const rpc_payroll_leave_allocate = defineRpc({
  id: "payroll.leave.allocate",
  title: "Allocate days of a leave type to an Employee for a period",
  about:
    HR_GUARD +
    "The Employee must be the Organization's and not left (INVALID_INPUT; WRONG_STATE for one who left), the type its " +
    "own and not unpaid (INVALID_INPUT: unpaid leave needs no allocation, as Frappe's LWP draws on none), the end on or " +
    "after the start, and the days more than 0 and within the type's `max_leaves_allowed` (INVALID_INPUT naming the " +
    "field). A live allocation of the type for the Employee overlapping the period is WRONG_STATE naming it. With " +
    "`carryForward` on a carry-forward type, the days left of their previous allocation of the type (the one ending " +
    "before this starts), up to the type's `maximum_carry_forwarded_leaves` and with the total no more than its " +
    "`max_leaves_allowed`, are carried in as `unused_leaves`, as Frappe's `get_carry_forwarded_leaves` and " +
    "`limit_carry_forward_based_on_max_allowed_leaves` do; on another type it is INVALID_INPUT. Then, in one " +
    "transaction, the allocation is born submitted (leave-allocation.allocate) and the one it carried from is marked " +
    "`expired`, as Frappe's `on_submit` expires it (`expire_allocation`), so nothing more is taken from it and no " +
    "carried day is taken twice (payroll.leave-balance). It answers the allocation.",
  was: [`${HR}/leave_allocation/leave_allocation.py`],
  concept: concept_payroll,
  kind: "mutation",
  who: WHO_HR,
  input: AllocateInput,
  output: Allocation,
  errors: [...HR_ERRORS],
  reads: [...HR_READS, table_employees, table_leave_types, table_leave_allocations, table_leave_applications],
  writes: [table_leave_allocations, ...HR_LOGGED],
  drives: [machine_leave_allocation.t.allocate],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("write"),
});

export const rpc_payroll_leave_unallocate = defineRpc({
  id: "payroll.leave.unallocate",
  title: "Cancel a leave allocation no approved leave draws on",
  about:
    HR_GUARD +
    "The allocation must be the Organization's (INVALID_INPUT) and submitted, with no approved application of its type " +
    "for the Employee inside its period (WRONG_STATE naming the application or the status). This is Capxul's own " +
    "guard: Frappe refuses only lowering an allocation below the leave taken against it " +
    "(`validate_against_leave_applications`, on update after submit), not its cancel, which would leave approved days " +
    "with nothing behind them. Open applications that would have drawn on it stay open, and " +
    "are refused at approval for want of balance. Then it is cancelled (leave-allocation.cancel). It answers the allocation.",
  was: [`${HR}/leave_allocation/leave_allocation.py`],
  concept: concept_payroll,
  kind: "mutation",
  who: WHO_HR,
  input: AllocationRef,
  output: Allocation,
  errors: [...HR_ERRORS],
  reads: [...HR_READS, table_leave_allocations, table_leave_applications],
  writes: [table_leave_allocations, ...HR_LOGGED],
  drives: [machine_leave_allocation.t.cancel],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("write"),
});

/** How a balance is counted, as Frappe's `get_leave_details` counts it from its ledger (payroll.leave-balance). */
const BALANCE =
  "For each leave type the Employee has an allocation of covering the day (today in the Organization's time zone " +
  "unless `on` is given), and each unpaid type: what the allocation gave (new and carried days), what approved " +
  "applications of the type inside the allocation's period took, what open ones ask, and the balance, allocated less " +
  "taken, which is 0 once a later allocation carried forward from it (`expired`); an unpaid type shows only what was " +
  "taken. It reads only.";

export const rpc_payroll_leave_balance = defineRpc({
  id: "payroll.leave.balance",
  title: "An Employee's leave balances on a day",
  about: HR_GUARD + "The Employee must be the Organization's (INVALID_INPUT). " + BALANCE,
  was: [`${LAP}:981`, `${LAP}:1028`],
  concept: concept_payroll,
  kind: "query",
  who: WHO_HR,
  input: OrgBalanceInput,
  output: Balance,
  errors: [...READ_ERRORS],
  reads: [...HR_READS, table_employees, table_leave_types, table_leave_allocations, table_leave_applications],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("read"),
});

export const rpc_payroll_leave_my_balance = defineRpc({
  id: "payroll.leave.my-balance",
  title: "Your leave balances on a day",
  about: SELF_GUARD + BALANCE,
  was: [`${LAP}:981`],
  concept: concept_payroll,
  kind: "query",
  who: WHO_SELF_HR,
  input: MyBalanceInput,
  output: Balance,
  errors: [error_NOT_AUTHENTICATED, error_INVALID_INPUT],
  reads: [...SELF_READS, table_leave_types, table_leave_allocations, table_leave_applications],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("read"),
});

// ── applications ────────────────────────────────────────────────────────────────────────────

/** The checks an application meets at apply and again at approval, as Frappe's `validate` runs on both. */
const LEAVE_CHECKS =
  "The type must be the employer's (INVALID_INPUT), the end on or after the start, the range inside the Employee's " +
  "employment (on or after joining, on or before any relieving day: INVALID_INPUT), and the type applicable by then " +
  "(`applicable_after` calendar days from joining: INVALID_INPUT naming it). " +
  DAYS +
  " Past `max_continuous_days_allowed`, counting an approved or open leave of the type that runs straight into it, is " +
  "INVALID_INPUT naming the limit. A paid type needs one allocation covering the whole range (INVALID_INPUT: outside, " +
  "or across two allocations), and a balance there, less open applications' days (stricter than Frappe's " +
  "`validate_balance_leaves`, which counts approved leave only), that covers it unless the type " +
  "allows negative (INVALID_INPUT naming the balance). Another open or approved application of theirs overlapping it " +
  "is WRONG_STATE naming it, as is a day already marked present or working from home; for an unpaid type, a " +
  "submitted salary slip covering any of its days is WRONG_STATE naming the slip (`validate_salary_processed_days`).";

export const rpc_payroll_leave_apply = defineRpc({
  id: "payroll.leave.apply",
  title: "Apply for leave",
  about:
    SELF_GUARD +
    "Their Employee must be active (WRONG_STATE naming the status). " +
    LEAVE_CHECKS +
    " Backdated leave is allowed (HR Settings). Then the application is born `open` (leave-application.apply) with " +
    "their department; its approvers are told by notices from its event. It answers the application with the type's " +
    "balance after it.",
  was: [`${LAP}:110`, `${LAP}:949`],
  concept: concept_payroll,
  kind: "mutation",
  who: WHO_SELF_HR,
  input: ApplyInput,
  output: Leave,
  errors: [...SELF_ERRORS],
  reads: [...SELF_READS, table_leave_types, table_leave_allocations, table_leave_applications, table_holiday_lists, table_attendances, table_salary_slips],
  writes: [table_leave_applications, ...HR_LOGGED],
  drives: [machine_leave_application.t.apply],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("write"),
});

export const rpc_payroll_leave_cancel = defineRpc({
  id: "payroll.leave.cancel",
  title: "Cancel your own leave application",
  about:
    SELF_RECORD_GUARD +
    "The application must be open or approved (WRONG_STATE naming the " +
    "status). Cancelling an approved unpaid leave is WRONG_STATE naming the slip while a submitted salary slip covers " +
    "any of its days: that pay is fixed. This is Capxul's own guard, stricter than Frappe, which checks salary already " +
    "processed (`validate_salary_processed_days`) at apply and approve but runs no `validate` on cancel. Then, in one " +
    "transaction, it is `cancelled` " +
    "(leave-application.cancel) and every attendance its approval marked is cancelled (attendance.cancel), so those " +
    "days are unmarked again and its days return to the balance. It answers the application.",
  was: [`${LAP}:158`, `${LAP}:368`],
  concept: concept_payroll,
  kind: "mutation",
  who: WHO_SELF_HR,
  input: MyLeaveRef,
  output: Leave,
  errors: [...SELF_ERRORS],
  reads: [...SELF_READS, table_leave_applications, table_attendances, table_salary_slips, table_leave_types],
  writes: [table_leave_applications, table_attendances, ...HR_LOGGED],
  drives: [machine_leave_application.t.cancel, machine_attendance.t.cancel],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("write"),
});

export const rpc_payroll_leave_mine = defineRpc({
  id: "payroll.leave.mine",
  title: "Your own leave applications",
  about:
    SELF_LIST_GUARD +
    "Their applications, newest first, `status` filtering; each with its employer, type, days, status, who " +
    "decided and when, and its type's balance after it. A page at a time, as every list's. It reads only.",
  was: [`${HR}/leave_application/leave_application.json`],
  concept: concept_payroll,
  kind: "query",
  who: WHO_SELF_HR,
  input: MyLeaveListInput,
  output: LeavePage,
  errors: [error_NOT_AUTHENTICATED, error_INVALID_INPUT],
  reads: [...SELF_READS, table_leave_applications, table_leave_types, table_leave_allocations],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("read"),
});

export const rpc_payroll_leave_approve = defineRpc({
  id: "payroll.leave.approve",
  title: "Approve a leave application, marking its days",
  about:
    APPROVER_GUARD +
    "The application must be the Organization's (INVALID_INPUT) and `open` (WRONG_STATE naming the status). Its " +
    "apply checks run again on what stands now, as Frappe's `validate` does on submit: the type, range, days, " +
    "allocation and balance (INVALID_INPUT), and no overlapping leave, marked working day or submitted slip over an " +
    "unpaid day (WRONG_STATE)." +
    " Then, in one transaction, it is `approved` (leave-application.approve) with the caller as `leave_approver`, and " +
    "each of its days that is not a holiday (every day, for a type that includes holidays) is marked in attendance " +
    "(attendance.mark): `on_leave` with the type, a half day `half_day`. A day the apply checks let through that is " +
    "already marked (absent, a half day from check-ins or a mark, or on leave by a People hat's mark) is cancelled and " +
    "marked again (attendance.cancel), as Frappe's `update_attendance` overwrites any attendance of the day; a mark on a " +
    "holiday inside the leave of a type that does not count holidays is cancelled, as Frappe cancels it " +
    "(payroll.attendance-based). It answers the application.",
  was: [`${LAP}:135`, `${LAP}:300`, `${LAP}:873`],
  concept: concept_payroll,
  kind: "mutation",
  who: WHO_LEAVE_APPROVER,
  input: LeaveRef,
  output: Leave,
  errors: [...HR_ERRORS],
  reads: [
    ...APPROVER_READS,
    table_employees,
    table_leave_types,
    table_leave_allocations,
    table_leave_applications,
    table_holiday_lists,
    table_attendances,
    table_salary_slips,
  ],
  writes: [table_leave_applications, table_attendances, ...HR_LOGGED],
  drives: [machine_leave_application.t.approve, machine_attendance.t.mark, machine_attendance.t.cancel],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("write"),
});

export const rpc_payroll_leave_reject = defineRpc({
  id: "payroll.leave.reject",
  title: "Reject a leave application",
  about:
    APPROVER_GUARD +
    "The application must be the Organization's (INVALID_INPUT) and `open` (WRONG_STATE naming the status). It is " +
    "`rejected` (leave-application.reject) with the caller as `leave_approver` and `reason`, if given; nothing is taken " +
    "from the balance and no day is marked. It answers the application.",
  was: [`${LAP}:135`],
  concept: concept_payroll,
  kind: "mutation",
  who: WHO_LEAVE_APPROVER,
  input: RejectLeaveInput,
  output: Leave,
  errors: [...HR_ERRORS],
  reads: [...APPROVER_READS, table_employees, table_leave_applications, table_leave_types],
  writes: [table_leave_applications, ...HR_LOGGED],
  drives: [machine_leave_application.t.reject],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("write"),
});

export const rpc_payroll_leave_list = defineRpc({
  id: "payroll.leave.list",
  title: "List the leave applications the caller may decide",
  about:
    "The caller must hold an active Seat whose Safe wears the People hat, which lists every Employee's, or a " +
    "department's hat, which lists the Employees of that department and those below it (ROLE_PERMISSION_DENIED for " +
    "neither). Newest first; `employeeId`, `department`, `status` and a day range (`startDate`, `endDate`: those " +
    "overlapping it) filter (INVALID_INPUT for one that names nothing). A page at a time, as every list's. It reads only.",
  was: [`${HR}/leave_application/leave_application.json`],
  concept: concept_payroll,
  kind: "query",
  who: WHO_LEAVE_APPROVER,
  input: OrgLeaveListInput,
  output: LeavePage,
  errors: [...READ_ERRORS],
  reads: [...APPROVER_READS, table_employees, table_leave_applications, table_leave_types],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("read"),
});
