// Frappe HR's HR, the part that changes pay or moves money (Aaron's evening answer of 8 November 2026: payroll
// means HR; decisions payroll.hr-in-payroll and payroll.hr-scope). One table per DocType, with Frappe's own field
// names, beside the payroll DocTypes in data.ts, so an Organization with no head has its holidays, leave,
// attendance, expense claims and advances from its first day, and a head connected later is synced by payroll's
// own process (payroll.hr-head-sync):
//
// - `holiday-lists` (Holiday List, its Holiday rows embedded): one per Organization and calendar year.
// - `leave-types`, `leave-allocations`, `leave-applications`: Leave Type, Leave Allocation, Leave Application.
// - `shift-types`, `shift-assignments`, `employee-checkins`, `attendances`: Shift Type, Shift Assignment,
//   Employee Checkin and Attendance. Payroll is based on attendance (payroll.attendance-based), so an approved
//   leave's days, a People hat's mark and a shift's own marking from check-ins all reach a slip's payment days.
// - `expense-claim-types`, `expense-claims`, `employee-advances`: Expense Claim Type, Expense Claim (its Expense
//   Claim Detail and Expense Claim Advance rows embedded) and Employee Advance, paid from the department's budget
//   through payments' door (payroll.hr-money).
// - `additional-salaries`: Additional Salary, for an advance recovered from salary (payroll.advance-recovery).
// - `hr-settings`: HR Settings, the values Capxul works by and a head must match.
//
// Recruitment, appraisal, training and onboarding are not here: they are a head's, reached through the document
// family (aaron.sdk-reaches-everything; payroll.hr-scope).

import { Schema } from "effect";
import { defineEvent, defineMachine, defineTable } from "../../../packages/book/src/index.ts";
import { concept_payroll } from "../shared/foundation.ts";
import { table_employees } from "./data.ts";

const HR = "/tmp/hrms/hrms/hr/doctype";
const HOLIDAY = "/tmp/erpnext/erpnext/setup/doctype/holiday_list/holiday_list.json";

const S = Schema.String;
const N = Schema.Number;
const B = Schema.Boolean;
const Null = Schema.NullOr;

const KEPT =
  "Kept for the Organization's life: leave, attendance and claims are the employer's record of what was owed and paid.";

/** A `YYYY-MM-DD` day in the Organization's time zone, as Frappe's Date fields. */
const Day = S;
/** Frappe's Currency: a decimal string at the token's display precision (2 places), rounded half to even. */
const Money = S;
/** The token a claim or an advance is in: its department budget's, as a structure's is (payroll.money-and-rounding). */
const Token = { currency: S, token_address: S, decimals: Schema.Int } as const;
/** What every Frappe-shaped HR row keeps for a head sync, as data.ts's payroll rows do (payroll.hr-head-sync). */
const Synced = {
  head_name: Null(S),
  /** The `seq` of its last change in `payroll-changes`: the version a head sync pushes and compares. */
  version: N,
  created_at: N,
  updated_at: N,
} as const;

/** The Employee's own Safe, copied from their Employee: what the self commands' row policy matches (payroll.hr-self). */
const ownSafe = (what: string) => ({
  match: "safe" as const,
  field: "employee_safe",
  reads: true,
  writes: false,
  about: `The Employee reads ${what} by their own Safe (payroll.hr-self); only payroll's rpcs and processes write them.`,
});

/** An Organization's own list (holidays, types) that each of its Employees reads, member or not (payroll.hr-self). */
const employeesRead = (what: string) => ({
  match: "safe" as const,
  field: "org_id",
  via: { table: table_employees, on: "org_id", field: "payee_safe" },
  reads: true,
  writes: false,
  about: `An Employee of the Organization, with or without a Seat, reads its ${what} to apply and claim (payroll.hr-self).`,
});

// ── holidays ────────────────────────────────────────────────────────────────────────────────

export const WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;

/** One Holiday row of a list: Frappe's `holiday_date`, `description`, `weekly_off` and `is_half_day`. */
export const HolidayRow = Schema.Struct({ holiday_date: Day, description: S, weekly_off: B, is_half_day: B });

export const table_holiday_lists = defineTable({
  id: "holiday-lists",
  title: "Holiday lists: an Organization's holidays and weekly offs for one year",
  about:
    "One Holiday List per Organization and calendar year, `<Company> <year>` from 1 January to 31 December, the " +
    "Company's default for that year: its `holidays` rows (Frappe's Holiday child table, embedded), each a day, its " +
    "description, whether it is a weekly off and whether it is a half day, and `total_holidays`. Born by the first " +
    "`org holiday add` of a day in that year, and changed only by `org holiday add` and `remove` (or a People hat's edit " +
    "on a connected head). A day in no list is a working day. With Payroll Settings counting holidays as working days, " +
    "holidays never lower a slip's working days: they decide which days a leave counts and which an absence docks " +
    "(payroll.attendance-based). One list for every Employee: Frappe's per-Employee lists and Holiday List Assignments " +
    "are a head's (payroll.hr-scope).",
  was: [HOLIDAY, "/tmp/erpnext/erpnext/setup/doctype/holiday/holiday.json"],
  concept: concept_payroll,
  tenancy: "organization",
  tenantField: "org_id",
  admits: [employeesRead("holidays")],
  fields: Schema.Struct({
    org_id: S,
    holiday_list_id: S,
    holiday_list_name: S,
    from_date: Day,
    to_date: Day,
    holidays: Schema.Array(HolidayRow),
    total_holidays: N,
    ...Synced,
  }),
  key: ["org_id", "holiday_list_id"],
  indexes: [
    {
      name: "by_year",
      fields: ["org_id", "from_date"],
      unique: true,
      for: "The list that holds a day: the one whose year it is, at most one per Organization and year.",
    },
  ],
  retention: KEPT,
});

// ── leave ───────────────────────────────────────────────────────────────────────────────────

export const table_leave_types = defineTable({
  id: "leave-types",
  title: "Leave types: the kinds of leave an Organization allows",
  about:
    "One Leave Type: `leave_type_name`, `max_leaves_allowed` (most days one allocation may give; null for no limit), " +
    "`applicable_after` (calendar days from joining before it may be taken), `max_continuous_days_allowed`, " +
    "`is_carry_forward` with `maximum_carry_forwarded_leaves`, `is_lwp` (leave without pay: each day docks a slip's " +
    "payment days), `is_ppl` with `fraction_of_daily_salary_per_leave` (partly paid: the paid share of each day), " +
    "`include_holiday` (holidays inside a leave count as leave days) and `allow_negative` (taken beyond the balance). " +
    "Frappe's earned, compensatory, optional and encashable leave are a head's: Capxul's commands leave those flags off, " +
    "and a type born on a head with them is kept as the head sends it, its allocations then made there " +
    "(payroll.hr-scope). Changed by `org leave-type change`; an application already decided keeps its days.",
  was: [`${HR}/leave_type/leave_type.json`],
  concept: concept_payroll,
  tenancy: "organization",
  tenantField: "org_id",
  admits: [employeesRead("leave types")],
  fields: Schema.Struct({
    org_id: S,
    leave_type_id: S,
    leave_type_name: S,
    max_leaves_allowed: Null(N),
    applicable_after: Schema.Int,
    max_continuous_days_allowed: Null(Schema.Int),
    is_carry_forward: B,
    maximum_carry_forwarded_leaves: Null(N),
    is_lwp: B,
    is_ppl: B,
    fraction_of_daily_salary_per_leave: Null(N),
    include_holiday: B,
    allow_negative: B,
    is_earned_leave: B,
    is_compensatory: B,
    is_optional_leave: B,
    allow_encashment: B,
    ...Synced,
  }),
  key: ["org_id", "leave_type_id"],
  indexes: [
    { name: "by_name", fields: ["org_id", "leave_type_name"], unique: true, for: "A leave type by its name, unique per Organization as Frappe's name is." },
  ],
  retention: KEPT,
});

export const table_leave_allocations = defineTable({
  id: "leave-allocations",
  title: "Leave allocations: the days of a leave type an Employee may take",
  about:
    "One Leave Allocation, written submitted: `new_leaves_allocated` days of a leave type for an Employee from " +
    "`from_date` to `to_date`, plus `unused_leaves` carried forward from their previous allocation of the type when " +
    "`carry_forward` is set (up to the type's maximum), making `total_leaves_allocated`. An Employee's balance of a " +
    "type on a day is the allocation covering it less the days of their approved applications inside it, as Frappe's " +
    "leave ledger counts it; Capxul keeps no ledger table, and a head rebuilds its Leave Ledger Entries from the synced " +
    "allocations and applications as Frappe does on submit (payroll.leave-balance). Two live allocations of one type " +
    "never overlap. An allocation a later one carried forward from is `expired`, as Frappe's Leave Allocation " +
    "`on_submit` expires it (`expire_allocation`): nothing more is taken from it, so a carried day is never taken twice. " +
    "`docstatus` moves only through machine `leave-allocation`.",
  was: [`${HR}/leave_allocation/leave_allocation.json`, `${HR}/leave_allocation/leave_allocation.py`],
  concept: concept_payroll,
  tenancy: "organization",
  tenantField: "org_id",
  admits: [ownSafe("their own allocations")],
  fields: Schema.Struct({
    org_id: S,
    allocation_id: S,
    employee_id: S,
    employee_safe: S,
    employee_name: S,
    leave_type_id: S,
    from_date: Day,
    to_date: Day,
    new_leaves_allocated: N,
    carry_forward: B,
    unused_leaves: N,
    total_leaves_allocated: N,
    /** Frappe's `expired`: set when a later allocation of the type carried forward from this one; its balance is then 0. */
    expired: B,
    description: Null(S),
    docstatus: Schema.Literals(["submitted", "cancelled"]),
    allocated_by: S,
    ...Synced,
  }),
  key: ["org_id", "allocation_id"],
  indexes: [
    {
      name: "by_employee_type",
      fields: ["org_id", "employee_id", "leave_type_id", "from_date"],
      for: "An Employee's allocations of a type by period: the one covering a day, the previous one to carry from, and the overlap check.",
    },
  ],
  retention: KEPT,
});

/** Leave Application `status`, lowercased. Open is Frappe's draft; approved and rejected are submitted; cancelled is cancelled. */
export const LEAVE_STATUSES = ["open", "approved", "rejected", "cancelled"] as const;

export const table_leave_applications = defineTable({
  id: "leave-applications",
  title: "Leave applications: an Employee's request for days off, and its decision",
  about:
    "One Leave Application: the Employee, the leave type, `from_date` to `to_date`, `half_day` with `half_day_date`, " +
    "`total_leave_days` (the days in the range, less holidays unless the type includes them, less half a day for a " +
    "half day), `description`, `posting_date`, and `status`. The Employee applies (`leave apply`) and cancels " +
    "(`leave cancel`); a wearer of their department's hat or one above it, or of the People hat, approves or rejects, " +
    "never the applicant (payroll.hr-approvers). `leave_approver` is the principal who decided and `decided_at` when. " +
    "Approving marks each leave day's attendance `on_leave` (a half day `half_day`), so an unpaid type's days dock the " +
    "slip that covers them (payroll.attendance-based). `department` is the Employee's when they applied. `status` moves " +
    "only through machine `leave-application`.",
  was: [`${HR}/leave_application/leave_application.json`, `${HR}/leave_application/leave_application.py:110`],
  concept: concept_payroll,
  tenancy: "organization",
  tenantField: "org_id",
  scope: "org_id is the employing Organization. The Employee opens, reads and cancels their own through employee_safe (payroll.hr-self).",
  admits: [
    {
      match: "safe",
      field: "employee_safe",
      reads: true,
      writes: true,
      about: "The Employee applies for, reads and cancels their own leave by their own Safe, member or not (payroll.hr-self).",
    },
  ],
  fields: Schema.Struct({
    org_id: S,
    leave_application_id: S,
    employee_id: S,
    employee_safe: S,
    employee_name: S,
    department: Null(S),
    leave_type_id: S,
    from_date: Day,
    to_date: Day,
    half_day: B,
    half_day_date: Null(Day),
    total_leave_days: N,
    description: Null(S),
    posting_date: Day,
    status: Schema.Literals(LEAVE_STATUSES),
    leave_approver: Null(S),
    decided_at: Null(N),
    rejection_reason: Null(S),
    applied_by: S,
    ...Synced,
  }),
  key: ["org_id", "leave_application_id"],
  indexes: [
    {
      name: "by_employee_dates",
      fields: ["org_id", "employee_id", "from_date"],
      for: "An Employee's applications by date: the overlap check, the days taken against an allocation, and their own list.",
    },
    {
      name: "by_status",
      fields: ["org_id", "status", "from_date"],
      for: "The applications waiting for a decision, and the Organization's list by status.",
    },
    {
      name: "by_employee_safe",
      fields: ["employee_safe", "from_date"],
      crossTenant: true,
      for: "A person's own applications, from every Organization that employs them: `leave list`.",
    },
  ],
  retention: KEPT,
});

export const event_leave_allocation_transitioned = defineEvent({
  id: "leave_allocation_transitioned",
  about: "A Leave Allocation was made or cancelled.",
  props: Schema.Struct({
    from: Null(Schema.Literals(["submitted", "cancelled"])),
    to: Schema.Literals(["submitted", "cancelled"]),
    transition: S,
    allocation_id: S,
    org_id: S,
    employee_id: S,
    leave_type_id: S,
  }),
  was: [`${HR}/leave_allocation/leave_allocation.py`],
});

export const machine_leave_allocation = defineMachine({
  id: "leave-allocation",
  title: "Leave allocation docstatus",
  about: "Frappe's docstatus for an allocation Capxul writes submitted. Cancelling one is for a mistake, before any approved leave draws on it.",
  table: table_leave_allocations,
  field: "docstatus",
  initial: "submitted",
  states: [
    { id: "submitted", about: "In force for its period: applications of its type draw on it." },
    { id: "cancelled", about: "Withdrawn; no application draws on it.", terminal: true },
  ],
  transitions: {
    allocate: {
      from: [],
      to: "submitted",
      about: "Born by payroll.leave.allocate, or a People hat's allocation on a connected head, taken in by payroll.head.sync.",
      guard: "No live allocation of the same type for the Employee overlaps its period.",
      emits: [event_leave_allocation_transitioned],
    },
    cancel: {
      from: ["submitted"],
      to: "cancelled",
      guard: "No approved application of its type for the Employee falls inside its period.",
      emits: [event_leave_allocation_transitioned],
    },
  },
});

export const event_leave_application_transitioned = defineEvent({
  id: "leave_application_transitioned",
  about:
    "A Leave Application was opened, approved, rejected or cancelled. `approver` is the principal who decided, null " +
    "until then: notices tells the applicant, and the approvers when one opens (payroll.hr-notices).",
  props: Schema.Struct({
    from: Null(Schema.Literals(LEAVE_STATUSES)),
    to: Schema.Literals(LEAVE_STATUSES),
    transition: S,
    leave_application_id: S,
    org_id: S,
    employee_id: S,
    department: Null(S),
    approver: Null(S),
  }),
  was: [`${HR}/leave_application/leave_application.py:130`],
});

export const machine_leave_application = defineMachine({
  id: "leave-application",
  title: "Leave application status",
  about:
    "Frappe's Open, Approved, Rejected and Cancelled. An application is opened by its Employee and decided by an " +
    "approver; approving marks its days' attendance, cancelling an approved one cancels those marks.",
  table: table_leave_applications,
  field: "status",
  initial: "open",
  states: [
    { id: "open", about: "Waiting for an approver; its days are pending against the balance." },
    { id: "approved", about: "Granted: its days are taken from the balance and its attendance is marked." },
    { id: "rejected", about: "Refused by an approver; nothing taken.", terminal: true },
    { id: "cancelled", about: "Withdrawn by its Employee; its marks cancelled and its days back in the balance.", terminal: true },
  ],
  transitions: {
    apply: {
      from: [],
      to: "open",
      about: "Born by payroll.leave.apply, or an Employee's application on a connected head, taken in by payroll.head.sync.",
      emits: [event_leave_application_transitioned],
    },
    approve: {
      from: ["open"],
      to: "approved",
      guard: "The approver is not the applicant; the balance still covers it unless its type is unpaid or allows negative; no other live application overlaps it.",
      emits: [event_leave_application_transitioned],
    },
    reject: { from: ["open"], to: "rejected", guard: "The approver is not the applicant.", emits: [event_leave_application_transitioned] },
    cancel: {
      from: ["open", "approved"],
      to: "cancelled",
      guard:
        "For an approved unpaid leave: no submitted salary slip covers any of its days. Capxul's own rule, stricter than " +
        "Frappe, whose `validate_salary_processed_days` runs at apply and approve but not on cancel (cancel runs no `validate`).",
      emits: [event_leave_application_transitioned],
    },
  },
});

// ── shifts, check-ins and attendance ────────────────────────────────────────────────────────

export const table_shift_types = defineTable({
  id: "shift-types",
  title: "Shift types: the working hours attendance is marked by",
  about:
    "One Shift Type: `start_time` and `end_time` (`HH:MM` in the Organization's time zone), " +
    "`enable_auto_attendance`, and the thresholds Frappe marks attendance by from check-ins: " +
    "`working_hours_threshold_for_half_day` and `working_hours_threshold_for_absent` (hours; null for none), " +
    "`begin_check_in_before_shift_start_time` and `allow_check_out_after_shift_end_time` (minutes, 60 each), " +
    "`late_entry_grace_period` and `early_exit_grace_period` (minutes), each marked only with Frappe's " +
    "`enable_late_entry_marking` or `enable_early_exit_marking` on, which a grace given turns on (no grace: off, unmarked). " +
    "A day with no check-in is marked absent at the same day's marking, Frappe's `absent_buffer_days` 0 rather than its " +
    "default 1, so a People hat's mark for the day is made before the shift's end plus 60 minutes. " +
    "Working hours are from the first check-in to the last check-out, alternating entries counted as in and out, as " +
    "Frappe's first option has it; holidays are never marked. A shift type is added, never changed: attendance already " +
    "marked by it keeps the hours it was marked by, and different hours are a new type (payroll.shift-types). Auto " +
    "attendance runs in Capxul only, on the world's clock (aaron.world-clock): a head's copy is pushed with it off and " +
    "Capxul's own flag in a Custom Field, so a head never marks a second attendance (payroll.hr-head-sync).",
  was: [`${HR}/shift_type/shift_type.json`, `${HR}/shift_type/shift_type.py`],
  concept: concept_payroll,
  tenancy: "organization",
  tenantField: "org_id",
  admits: [employeesRead("shift types")],
  fields: Schema.Struct({
    org_id: S,
    shift_type_id: S,
    name: S,
    start_time: S,
    end_time: S,
    enable_auto_attendance: B,
    working_hours_threshold_for_half_day: Null(N),
    working_hours_threshold_for_absent: Null(N),
    begin_check_in_before_shift_start_time: Schema.Int,
    allow_check_out_after_shift_end_time: Schema.Int,
    enable_late_entry_marking: B,
    late_entry_grace_period: Null(Schema.Int),
    enable_early_exit_marking: B,
    early_exit_grace_period: Null(Schema.Int),
    /** Frappe's `absent_buffer_days`: Capxul marks a day with no check-in absent the same day (payroll.shift-types). */
    absent_buffer_days: Schema.Literal(0),
    determine_check_in_and_check_out: Schema.Literal("alternating"),
    working_hours_calculation_based_on: Schema.Literal("first-check-in-last-check-out"),
    mark_auto_attendance_on_holidays: Schema.Literal(false),
    process_attendance_after: Day,
    ...Synced,
  }),
  key: ["org_id", "shift_type_id"],
  indexes: [{ name: "by_name", fields: ["org_id", "name"], unique: true, for: "A shift type by its name, unique per Organization as Frappe's name is." }],
  retention: KEPT,
});

export const table_shift_assignments = defineTable({
  id: "shift-assignments",
  title: "Shift assignments: which shift an Employee works, from when",
  about:
    "One Shift Assignment, written submitted: an Employee works a shift type from `start_date` to `end_date` (null: " +
    "open-ended), `status` active until unassigned. An Employee has at most one active assignment covering a day " +
    "(HR Settings' `allow_multiple_shift_assignments` off). Each active assignment is one durable process that marks " +
    "its Employee's attendance from their check-ins at the end of each day's shift (payroll.attendance.auto). `status` " +
    "moves only through machine `shift-assignment`.",
  was: [`${HR}/shift_assignment/shift_assignment.json`, `${HR}/shift_assignment/shift_assignment.py`],
  concept: concept_payroll,
  tenancy: "organization",
  tenantField: "org_id",
  admits: [ownSafe("their own shift assignments")],
  fields: Schema.Struct({
    org_id: S,
    shift_assignment_id: S,
    employee_id: S,
    employee_safe: S,
    employee_name: S,
    shift_type_id: S,
    start_date: Day,
    end_date: Null(Day),
    status: Schema.Literals(["active", "inactive"]),
    assigned_by: S,
    ...Synced,
  }),
  key: ["org_id", "shift_assignment_id"],
  indexes: [
    {
      name: "by_employee",
      fields: ["org_id", "employee_id", "status", "start_date"],
      for: "An Employee's active assignment covering a day: the shift a check-in belongs to, and the overlap check.",
    },
  ],
  retention: KEPT,
});

export const table_employee_checkins = defineTable({
  id: "employee-checkins",
  title: "Employee check-ins: each time an Employee checked in or out",
  about:
    "One Employee Checkin: the Employee, `time` (the world's clock at the check-in, never the device's: " +
    "aaron.world-clock), `log_type` (in or out; null lets alternating entries decide), `device_id` (`cli`, `sdk` or " +
    "the head's device), and the shift it falls in (`shift_type_id`, `shift_start`, `shift_end`: the Employee's active " +
    "assignment that day, null when none, and then it never marks attendance, as in Frappe). `attendance_id` is the " +
    "attendance it marked, set once by the shift's process. Never changed or removed: a wrong check-in is outweighed " +
    "by a People hat's mark. A head's own check-ins (a biometric device writing to Frappe) are taken in by " +
    "payroll.head.sync (payroll.hr-head-sync) with the `time` the head recorded, the one check-in time Capxul did not " +
    "stamp: the head follows the world's clock (devnet.head-follows-world), and one later than the world's now at the " +
    "pull is refused and reported to the head (payroll.hr-world-clock).",
  was: [`${HR}/employee_checkin/employee_checkin.json`, `${HR}/employee_checkin/employee_checkin.py`],
  concept: concept_payroll,
  tenancy: "organization",
  tenantField: "org_id",
  scope: "org_id is the employing Organization. The Employee checks in and reads their own through employee_safe (payroll.hr-self).",
  admits: [
    {
      match: "safe",
      field: "employee_safe",
      reads: true,
      writes: true,
      about: "The Employee writes and reads their own check-ins by their own Safe, member or not (payroll.hr-self).",
    },
  ],
  fields: Schema.Struct({
    org_id: S,
    checkin_id: S,
    employee_id: S,
    employee_safe: S,
    employee_name: S,
    time: N,
    log_type: Null(Schema.Literals(["in", "out"])),
    device_id: S,
    shift_type_id: Null(S),
    shift_start: Null(N),
    shift_end: Null(N),
    attendance_id: Null(S),
    skip_auto_attendance: B,
    source: Schema.Literals(["capxul", "head"]),
    ...Synced,
  }),
  key: ["org_id", "checkin_id"],
  indexes: [
    {
      name: "by_employee_time",
      fields: ["org_id", "employee_id", "time"],
      for: "An Employee's check-ins in a shift's window, in order: what the shift's process marks a day by.",
    },
    {
      name: "by_employee_safe",
      fields: ["employee_safe", "time"],
      crossTenant: true,
      for: "A person's own check-ins, from every Organization that employs them: `attendance list`.",
    },
  ],
  retention: KEPT,
});

/** Attendance `status`, lowercased: Frappe's Present, Absent, On Leave, Half Day and Work From Home. */
export const ATTENDANCE_STATUSES = ["present", "absent", "on_leave", "half_day", "work_from_home"] as const;

export const table_attendances = defineTable({
  id: "attendances",
  title: "Attendance: whether an Employee worked on a day",
  about:
    "One Attendance, written submitted: an Employee's `status` on `attendance_date` (present, absent, on leave, half " +
    "day or work from home), with `half_day_status` for the other half, the leave type and application of an approved " +
    "leave's day, the shift, `in_time`, `out_time` and `working_hours` from check-ins, and `late_entry` and " +
    "`early_exit`. `source` says who marked it: a People hat (`mark`), an approved leave (`leave`), a shift's process " +
    "from check-ins (`checkins`) or a head. At most one submitted attendance per Employee and day. Payroll is based on " +
    "attendance, with unmarked days counted present (payroll.attendance-based): an absent day, and an unpaid leave's " +
    "day, dock the slip that covers it. `docstatus` moves only through machine `attendance`.",
  was: [`${HR}/attendance/attendance.json`, `${HR}/attendance/attendance.py`],
  concept: concept_payroll,
  tenancy: "organization",
  tenantField: "org_id",
  scope:
    "org_id is the employing Organization. The Employee reads their own through employee_safe, and their own leave's " +
    "marks are cancelled with it when they cancel the leave (payroll.hr-self).",
  admits: [
    {
      match: "safe",
      field: "employee_safe",
      reads: true,
      writes: false,
      about: "The Employee reads their own attendance by their own Safe, member or not (payroll.hr-self).",
    },
    {
      match: "safe",
      field: "employee_safe",
      where: { source: "leave" },
      reads: true,
      writes: true,
      about: "The Employee's cancelling of their own approved leave cancels the marks it made, and only those (payroll.hr-self).",
    },
  ],
  fields: Schema.Struct({
    org_id: S,
    attendance_id: S,
    employee_id: S,
    employee_safe: S,
    employee_name: S,
    department: Null(S),
    attendance_date: Day,
    status: Schema.Literals(ATTENDANCE_STATUSES),
    half_day_status: Null(Schema.Literals(["present", "absent"])),
    leave_type_id: Null(S),
    leave_application_id: Null(S),
    shift_type_id: Null(S),
    in_time: Null(N),
    out_time: Null(N),
    working_hours: Null(N),
    late_entry: B,
    early_exit: B,
    source: Schema.Literals(["mark", "leave", "checkins", "head"]),
    marked_by: S,
    docstatus: Schema.Literals(["submitted", "cancelled"]),
    ...Synced,
  }),
  key: ["org_id", "attendance_id"],
  indexes: [
    {
      name: "by_employee_date",
      fields: ["org_id", "employee_id", "attendance_date"],
      unique: true,
      for: "Partial on docstatus submitted: one attendance per Employee and day; a run's period's marks; a shift's day already marked.",
    },
    {
      name: "by_date",
      fields: ["org_id", "attendance_date", "status"],
      for: "The Organization's attendance by day and status: `org attendance list`.",
    },
    {
      name: "by_leave",
      fields: ["org_id", "leave_application_id"],
      for: "The marks an approved leave made, cancelled with it.",
    },
    {
      name: "by_employee_safe",
      fields: ["employee_safe", "attendance_date"],
      crossTenant: true,
      for: "A person's own attendance, from every Organization that employs them: `attendance list`.",
    },
  ],
  retention: KEPT,
});

export const event_shift_assignment_transitioned = defineEvent({
  id: "shift_assignment_transitioned",
  about: "A Shift Assignment was made or ended.",
  props: Schema.Struct({
    from: Null(Schema.Literals(["active", "inactive"])),
    to: Schema.Literals(["active", "inactive"]),
    transition: S,
    shift_assignment_id: S,
    org_id: S,
    employee_id: S,
    shift_type_id: S,
  }),
  was: [`${HR}/shift_assignment/shift_assignment.py`],
});

export const machine_shift_assignment = defineMachine({
  id: "shift-assignment",
  title: "Shift assignment status",
  about: "Frappe's Active and Inactive. An assignment is active from its making until it is unassigned; its end date ends its process too.",
  table: table_shift_assignments,
  field: "status",
  initial: "active",
  states: [
    { id: "active", about: "Its Employee works its shift on the days it covers; its process marks them." },
    { id: "inactive", about: "Unassigned: no later day is marked by it.", terminal: true },
  ],
  transitions: {
    assign: {
      from: [],
      to: "active",
      about: "Born by payroll.shift-types.assign, or a People hat's assignment on a connected head.",
      guard: "No other active assignment of the Employee covers any of its days.",
      emits: [event_shift_assignment_transitioned],
    },
    unassign: { from: ["active"], to: "inactive", emits: [event_shift_assignment_transitioned] },
  },
});

export const event_attendance_transitioned = defineEvent({
  id: "attendance_transitioned",
  about: "An Attendance was marked or cancelled. `status` is the day's status as marked.",
  props: Schema.Struct({
    from: Null(Schema.Literals(["submitted", "cancelled"])),
    to: Schema.Literals(["submitted", "cancelled"]),
    transition: S,
    attendance_id: S,
    org_id: S,
    employee_id: S,
    attendance_date: Day,
    status: Schema.Literals(ATTENDANCE_STATUSES),
    source: Schema.Literals(["mark", "leave", "checkins", "head"]),
  }),
  was: [`${HR}/attendance/attendance.py`],
});

export const machine_attendance = defineMachine({
  id: "attendance",
  title: "Attendance docstatus",
  about: "Frappe's docstatus for an attendance Capxul writes submitted: a wrong mark is cancelled, and the day marked again.",
  table: table_attendances,
  field: "docstatus",
  initial: "submitted",
  states: [
    { id: "submitted", about: "The day's attendance: a slip covering it counts it." },
    { id: "cancelled", about: "Withdrawn; the day is unmarked again, counted present.", terminal: true },
  ],
  transitions: {
    mark: {
      from: [],
      to: "submitted",
      about: "By a People hat's mark, an approved leave's day, a shift's process from check-ins, or a head's mark taken in.",
      guard: "The Employee has no submitted attendance that day.",
      emits: [event_attendance_transitioned],
    },
    cancel: { from: ["submitted"], to: "cancelled", emits: [event_attendance_transitioned] },
  },
});

// ── expense claims and advances ─────────────────────────────────────────────────────────────

export const table_expense_claim_types = defineTable({
  id: "expense-claim-types",
  title: "Expense claim types: what an Employee may claim for, and its account",
  about:
    "One Expense Claim Type: `expense_type` (its name), `description`, and `default_account`, the books' expense " +
    "account a claim's line of the type is posted to (Frappe's Expense Claim Account for the Company): a books account " +
    "id, or null for books' own default expense account (books.payroll-defaults). Added, never changed: a claim keeps " +
    "the account its line was approved with, and a different account is a new type (payroll.expense-types).",
  was: [`${HR}/expense_claim_type/expense_claim_type.json`, `${HR}/expense_claim_account/expense_claim_account.json`],
  concept: concept_payroll,
  tenancy: "organization",
  tenantField: "org_id",
  admits: [employeesRead("expense claim types")],
  fields: Schema.Struct({
    org_id: S,
    expense_claim_type_id: S,
    expense_type: S,
    description: Null(S),
    default_account: Null(S),
    ...Synced,
  }),
  key: ["org_id", "expense_claim_type_id"],
  indexes: [{ name: "by_name", fields: ["org_id", "expense_type"], unique: true, for: "A type by its name, unique per Organization as Frappe's name is." }],
  retention: KEPT,
});

/** One Expense Claim Detail row: the day, the type, what it was and its amount, and what the approver sanctioned. */
export const ExpenseRow = Schema.Struct({
  expense_date: Day,
  expense_claim_type_id: S,
  expense_type: S,
  description: Null(S),
  amount: Money,
  sanctioned_amount: Money,
  /** The type's account when the claim was approved; null before, and for books' default. */
  default_account: Null(S),
});

/** One Expense Claim Advance row: a paid advance of the claimant's, what was unclaimed of it, and what this claim takes. */
export const AdvanceRow = Schema.Struct({ employee_advance: S, advance_paid: Money, unclaimed_amount: Money, allocated_amount: Money });

/** Payment facts a claim or an advance keeps from its pay, as a slip does (payroll.hr-money). */
const PaymentFacts = {
  attempt: Schema.Int,
  /** `expense:<id>:<attempt>` or `advance:<id>:<attempt>`: the payment command's key. */
  request_key: Null(S),
  /** The caller's `--request-key` the latest attempt was asked under. */
  asked_key: Null(S),
  command_id: Null(S),
  approval_id: Null(S),
  payment_id: Null(S),
  chain_payment_id: Null(S),
  tx_hash: Null(S),
  block_number: Null(Schema.Int),
  paid_at: Null(N),
  /** The memo the Payment carries on chain, stored at the first pay (documents.store). */
  document_id: Null(S),
  document_hash: Null(S),
} as const;

/** Expense Claim `status`: Frappe's Draft, Unpaid, Rejected, Paid and Cancelled, as open, approved, rejected, paid and cancelled, and Capxul's paying. */
export const EXPENSE_CLAIM_STATUSES = ["open", "approved", "rejected", "paying", "paid", "cancelled"] as const;

export const table_expense_claims = defineTable({
  id: "expense-claims",
  title: "Expense claims: what an Employee spent for the Organization, to be paid back",
  about:
    "One Expense Claim: the Employee, their department (`department`, the budget that pays it, and `budget_id`) when " +
    "they claimed, `posting_date`, its `expenses` rows (Expense Claim Detail: day, type, description, amount and " +
    "sanctioned amount), its `receipts` (each stored as a receipt document, subject the claim), and the `advances` it " +
    "settles (Expense Claim Advance: each a paid advance of the claimant's and what this claim takes of it). " +
    "`total_claimed_amount`, `total_sanctioned_amount`, `total_advance_amount` and `grand_total` (sanctioned less " +
    "advances: what is paid) are in its department budget's token, `grand_total_raw` in raw units. `approval_status` " +
    "is Frappe's (draft, approved, rejected) and `status` Capxul's: whoever wears the department's hat or one above it " +
    "approves or rejects, never the claimant (payroll.hr-approvers); approving posts the claim's accrual to the books " +
    "(payroll.hr-money); paying is one payment command from the department's budget through payments' door, followed " +
    "back to paid. `expense_approver` is who decided. `status` moves only through machine `expense-claim`.",
  was: [`${HR}/expense_claim/expense_claim.json`, `${HR}/expense_claim_detail/expense_claim_detail.json`, `${HR}/expense_claim_advance/expense_claim_advance.json`],
  concept: concept_payroll,
  tenancy: "organization",
  tenantField: "org_id",
  scope: "org_id is the employing Organization. The claimant opens, reads and cancels their own through employee_safe (payroll.hr-self).",
  admits: [
    {
      match: "safe",
      field: "employee_safe",
      reads: true,
      writes: true,
      about: "The claimant opens, reads and cancels (while open) their own claims by their own Safe, member or not (payroll.hr-self).",
    },
  ],
  fields: Schema.Struct({
    org_id: S,
    expense_claim_id: S,
    employee_id: S,
    employee_safe: S,
    employee_name: S,
    department: S,
    budget_id: Null(S),
    posting_date: Day,
    ...Token,
    expenses: Schema.Array(ExpenseRow),
    receipts: Schema.Array(Schema.Struct({ document_id: S, document_hash: S, filename: Null(S) })),
    advances: Schema.Array(AdvanceRow),
    total_claimed_amount: Money,
    total_sanctioned_amount: Money,
    total_advance_amount: Money,
    grand_total: Money,
    grand_total_raw: S,
    total_amount_reimbursed: Money,
    approval_status: Schema.Literals(["draft", "approved", "rejected"]),
    status: Schema.Literals(EXPENSE_CLAIM_STATUSES),
    expense_approver: Null(S),
    decided_at: Null(N),
    remark: Null(S),
    rejection_reason: Null(S),
    /** Books' payable the grand total is owed on until paid: null for its role's (books.payroll-defaults). */
    payable_account: Null(S),
    ...PaymentFacts,
    ...Synced,
  }),
  key: ["org_id", "expense_claim_id"],
  indexes: [
    { name: "by_status", fields: ["org_id", "status", "posting_date"], for: "The claims waiting for a decision or a payment, and the Organization's list by status." },
    { name: "by_department", fields: ["org_id", "department", "posting_date"], for: "A department's claims: what its hat wearers list, approve and pay." },
    { name: "by_employee_safe", fields: ["employee_safe", "posting_date"], crossTenant: true, for: "A person's own claims, from every Organization that employs them: `expense-claim list`." },
    { name: "by_command", fields: ["command_id", "payment_id"], crossTenant: true, for: "A Payment's transition, by its command and payment id, to the claim it pays and so to its process." },
  ],
  retention: KEPT,
});

/** Employee Advance `status`: Frappe's Draft as requested, Paid, Claimed, Returned and Partly Claimed and Returned, and Capxul's rejected, cancelled and paying. */
export const ADVANCE_STATUSES = [
  "requested",
  "rejected",
  "cancelled",
  "paying",
  "paid",
  "claimed",
  "returned",
  "partly_claimed_and_returned",
] as const;

export const table_employee_advances = defineTable({
  id: "employee-advances",
  title: "Employee advances: money paid ahead to an Employee, to be claimed or recovered",
  about:
    "One Employee Advance: the Employee, their department (the budget that pays it), `posting_date`, `purpose`, " +
    "`advance_amount` (and `advance_amount_raw`), and what became of it: `paid_amount`, `claimed_amount` (taken by " +
    "their approved expense claims), `return_amount` (recovered from their salary) and the status those make. The " +
    "Employee requests it; whoever wears the department's hat or one above it pays it, which approves it, or rejects " +
    "it, never the requester (payroll.hr-approvers), as one payment command from the budget through payments' door " +
    "(payroll.hr-money). `org advance settle` recovers what no claim took from the Employee's next salary, as Frappe's " +
    "`repay_unclaimed_amount_from_salary` does, by an Additional Salary (payroll.advance-recovery). `advance_account` " +
    "is books' Employee Advances account, null for its role's. `status` moves only through machine `employee-advance`.",
  was: [`${HR}/employee_advance/employee_advance.json`, `${HR}/employee_advance/employee_advance.py:160`],
  concept: concept_payroll,
  tenancy: "organization",
  tenantField: "org_id",
  scope: "org_id is the employing Organization. The Employee requests, reads and cancels (while requested) their own through employee_safe (payroll.hr-self).",
  admits: [
    {
      match: "safe",
      field: "employee_safe",
      reads: true,
      writes: true,
      about: "The Employee requests, reads and cancels (while requested) their own advances by their own Safe (payroll.hr-self).",
    },
  ],
  fields: Schema.Struct({
    org_id: S,
    employee_advance_id: S,
    employee_id: S,
    employee_safe: S,
    employee_name: S,
    department: S,
    budget_id: Null(S),
    posting_date: Day,
    purpose: S,
    ...Token,
    advance_amount: Money,
    advance_amount_raw: S,
    paid_amount: Money,
    claimed_amount: Money,
    return_amount: Money,
    repay_unclaimed_amount_from_salary: B,
    status: Schema.Literals(ADVANCE_STATUSES),
    advance_account: Null(S),
    decided_by: Null(S),
    decided_at: Null(N),
    rejection_reason: Null(S),
    ...PaymentFacts,
    ...Synced,
  }),
  key: ["org_id", "employee_advance_id"],
  indexes: [
    { name: "by_status", fields: ["org_id", "status", "posting_date"], for: "The advances waiting to be paid, and the Organization's list by status." },
    { name: "by_employee", fields: ["org_id", "employee_id", "status"], for: "An Employee's paid advances a claim may take, and those to recover." },
    { name: "by_employee_safe", fields: ["employee_safe", "posting_date"], crossTenant: true, for: "A person's own advances, from every Organization that employs them: `advance list`." },
    { name: "by_command", fields: ["command_id", "payment_id"], crossTenant: true, for: "A Payment's transition, by its command and payment id, to the advance it pays and so to its process." },
  ],
  retention: KEPT,
});

export const table_additional_salaries = defineTable({
  id: "additional-salaries",
  title: "Additional salaries: an amount added to or taken from one slip",
  about:
    "One Additional Salary, written submitted: an `amount` of a salary component for an Employee on the slip whose " +
    "period holds `payroll_date`, in its token. Capxul makes one kind only: an advance's recovery (`ref_doctype` " +
    "Employee Advance, `ref_docname` the advance), a deduction of the Organization's advance recovery component, its " +
    "payroll date the first day after the Employee's latest submitted slip, so the next run takes it exactly as a head " +
    "would (payroll.advance-recovery). It is taken when a submitted slip names it, and free again if that slip is " +
    "cancelled. Other Additional Salaries (bonuses, arrears, incentives) are a head's, and a run that needs one is " +
    "computed there (payroll.hr-scope).",
  was: ["/tmp/hrms/hrms/payroll/doctype/additional_salary/additional_salary.json", `${HR}/employee_advance/employee_advance.py:309`],
  concept: concept_payroll,
  tenancy: "organization",
  tenantField: "org_id",
  fields: Schema.Struct({
    org_id: S,
    additional_salary_id: S,
    employee_id: S,
    salary_component_id: S,
    type: Schema.Literal("deduction"),
    amount: Money,
    ...Token,
    payroll_date: Day,
    ref_doctype: Schema.Literal("Employee Advance"),
    ref_docname: S,
    created_by: S,
    ...Synced,
  }),
  key: ["org_id", "additional_salary_id"],
  indexes: [
    { name: "by_employee_date", fields: ["org_id", "employee_id", "payroll_date"], for: "An Employee's additional salaries a run's slip takes: those whose payroll date its period holds." },
    { name: "by_ref", fields: ["org_id", "ref_docname"], unique: true, for: "An advance is recovered once: its one Additional Salary." },
  ],
  retention: KEPT,
});

export const table_hr_settings = defineTable({
  id: "hr-settings",
  title: "HR Settings: the HR values every Organization works by",
  about:
    "Frappe HR's HR Settings, one row per Organization, born with Payroll Settings by payroll's start-up " +
    "(payroll.startup.open), or by the first HR write that finds none. Its values are the same for every Organization, " +
    "because they are what Capxul works by and what a head must match: self-approval refused for leave and expenses " +
    "(payroll.hr-approvers), no approver named on an application or claim (the department's hat decides), backdated " +
    "leave allowed, one shift assignment per day, check-ins from the CLI and SDK allowed and no geolocation, eight " +
    "standard working hours, and Frappe's reminder mails off (notices sends mail).",
  was: [`${HR}/hr_settings/hr_settings.json`],
  concept: concept_payroll,
  tenancy: "organization",
  tenantField: "org_id",
  fields: Schema.Struct({
    org_id: S,
    prevent_self_leave_approval: Schema.Literal(true),
    prevent_self_expense_approval: Schema.Literal(true),
    leave_approver_mandatory_in_leave_application: Schema.Literal(false),
    expense_approver_mandatory_in_expense_claim: Schema.Literal(false),
    restrict_backdated_leave_application: Schema.Literal(false),
    allow_multiple_shift_assignments: Schema.Literal(false),
    allow_employee_checkin_from_mobile_app: Schema.Literal(true),
    allow_geolocation_tracking: Schema.Literal(false),
    standard_working_hours: Schema.Literal(8),
    send_holiday_reminders: Schema.Literal(false),
    send_birthday_reminders: Schema.Literal(false),
    send_work_anniversary_reminders: Schema.Literal(false),
    created_at: N,
    updated_at: N,
  }),
  key: ["org_id"],
  indexes: [],
  retention: KEPT,
});

export const event_expense_claim_transitioned = defineEvent({
  id: "expense_claim_transitioned",
  about:
    "An Expense Claim was opened, approved, rejected, cancelled, sent, paid, lapsed, returned unsent or reversed. " +
    "`occurred_at` is the block's time when the chain moved it. `decider` is the principal who approved, rejected, " +
    "cancelled or paid it, null for the claimant's own create and cancel and for the chain's moves: notices tells the " +
    "claimant who decided, and the department's approvers when one opens (payroll.hr-notices).",
  props: Schema.Struct({
    from: Null(Schema.Literals(EXPENSE_CLAIM_STATUSES)),
    to: Schema.Literals(EXPENSE_CLAIM_STATUSES),
    transition: S,
    expense_claim_id: S,
    org_id: S,
    employee_id: S,
    department: S,
    decider: Null(S),
    occurred_at: N,
  }),
  was: [`${HR}/expense_claim/expense_claim.py:127`],
});

export const machine_expense_claim = defineMachine({
  id: "expense-claim",
  title: "Expense claim status",
  about:
    "A claim is opened by its Employee, decided by whoever wears its department's hat or one above it, and paid as one " +
    "Payment from the department's budget, back to approved when its approval lapses or is declined, and paid when " +
    "payments settles it (payroll.hr-money). A claim its advances cover in full is paid at its approval.",
  table: table_expense_claims,
  field: "status",
  initial: "open",
  states: [
    { id: "open", about: "Waiting for a decision (Frappe's Draft); nothing owed yet." },
    { id: "approved", about: "Sanctioned and owed on the books' payable (Frappe's Unpaid); not yet paid." },
    { id: "rejected", about: "Refused; nothing owed.", terminal: true },
    { id: "paying", about: "Its grand total is a Payment from the department's budget, on its way." },
    { id: "paid", about: "Paid back: its Payment settled, or its advances covered it." },
    { id: "cancelled", about: "Withdrawn while open by its claimant, or cancelled once approved before any payment.", terminal: true },
  ],
  transitions: {
    create: { from: [], to: "open", about: "Born by payroll.expense-claims.create.", emits: [event_expense_claim_transitioned] },
    approve: {
      from: ["open"],
      to: "approved",
      about: "Its accrual is posted and its advances' claimed amounts rise, in one transaction.",
      guard: "The approver is not the claimant, and something is left to pay after its advances.",
      emits: [event_expense_claim_transitioned],
    },
    approve_covered: {
      from: ["open"],
      to: "paid",
      about: "Approved with nothing left to pay: its advances cover the sanctioned total, as Frappe's status Paid at a zero grand total.",
      guard: "The approver is not the claimant.",
      emits: [event_expense_claim_transitioned],
    },
    reject: { from: ["open"], to: "rejected", guard: "The approver is not the claimant.", emits: [event_expense_claim_transitioned] },
    cancel: {
      from: ["open", "approved"],
      to: "cancelled",
      about: "Open: by its claimant. Approved: by the department's hat, its accrual and its advances' claims reversed.",
      guard: "No Payment of it is held: never sent, or returned unsent.",
      emits: [event_expense_claim_transitioned],
    },
    pay: { from: ["approved"], to: "paying", about: "Its grand total is one Payment of a new command, or its lapsed command resumed.", emits: [event_expense_claim_transitioned] },
    lapse: {
      from: ["paying"],
      to: "approved",
      about: "Its approval lapsed unsent: it keeps its payment id and command, so the next pay resumes that command.",
      emits: [event_expense_claim_transitioned],
    },
    unsend: {
      from: ["paying"],
      to: "approved",
      about: "Its Payment was cancelled before any money moved (the approval declined, refused or withdrawn): its payment fields clear.",
      emits: [event_expense_claim_transitioned],
    },
    settle: { from: ["paying"], to: "paid", about: "Its Payment settled to the claimant, at the block's time.", emits: [event_expense_claim_transitioned] },
    reverse: { from: ["paid"], to: "paying", about: "A reorg below finality reopened its Payment; it settles again.", emits: [event_expense_claim_transitioned] },
  },
});

export const event_employee_advance_transitioned = defineEvent({
  id: "employee_advance_transitioned",
  about:
    "An Employee Advance was requested, rejected, cancelled, sent, paid, lapsed, returned unsent, reversed, claimed or " +
    "recovered. `decider` is the principal who paid (so approved) or rejected it, null for the Employee's own request " +
    "and cancel and for the chain's, the claims' and the runs' moves (payroll.hr-notices).",
  props: Schema.Struct({
    from: Null(Schema.Literals(ADVANCE_STATUSES)),
    to: Schema.Literals(ADVANCE_STATUSES),
    transition: S,
    employee_advance_id: S,
    org_id: S,
    employee_id: S,
    department: S,
    decider: Null(S),
    occurred_at: N,
  }),
  was: [`${HR}/employee_advance/employee_advance.py:160`],
});

export const machine_employee_advance = defineMachine({
  id: "employee-advance",
  title: "Employee advance status",
  about:
    "An advance is requested by its Employee and paid, which approves it, or rejected, by whoever wears its " +
    "department's hat or one above it; then claimed by the Employee's approved expense claims, or recovered from their " +
    "salary when settled, as Frappe's statuses read (payroll.advance-recovery).",
  table: table_employee_advances,
  field: "status",
  initial: "requested",
  states: [
    { id: "requested", about: "Waiting to be paid or rejected (Frappe's Draft); nothing paid." },
    { id: "rejected", about: "Refused; nothing paid.", terminal: true },
    { id: "cancelled", about: "Withdrawn by its Employee before it was paid.", terminal: true },
    { id: "paying", about: "Its amount is a Payment from the department's budget, on its way." },
    { id: "paid", about: "Paid to the Employee; some or none of it claimed yet." },
    { id: "claimed", about: "All of it taken by the Employee's approved expense claims." },
    { id: "returned", about: "None of it claimed, and all of it recovered from a submitted slip." },
    { id: "partly_claimed_and_returned", about: "Part of it claimed and the rest recovered from a submitted slip." },
  ],
  transitions: {
    request: { from: [], to: "requested", about: "Born by payroll.advances.request.", emits: [event_employee_advance_transitioned] },
    reject: { from: ["requested"], to: "rejected", guard: "The decider is not the requester, and no Payment of it is held.", emits: [event_employee_advance_transitioned] },
    cancel: { from: ["requested"], to: "cancelled", guard: "No Payment of it is held.", emits: [event_employee_advance_transitioned] },
    pay: {
      from: ["requested"],
      to: "paying",
      about: "Approved and sent: one Payment of a new command, or its lapsed command resumed.",
      guard: "The payer is not the requester.",
      emits: [event_employee_advance_transitioned],
    },
    lapse: { from: ["paying"], to: "requested", about: "Its approval lapsed unsent; it keeps its payment id, so the next pay resumes that command.", emits: [event_employee_advance_transitioned] },
    unsend: { from: ["paying"], to: "requested", about: "Its Payment was cancelled before any money moved; its payment fields clear.", emits: [event_employee_advance_transitioned] },
    settle: { from: ["paying"], to: "paid", about: "Its Payment settled to the Employee.", emits: [event_employee_advance_transitioned] },
    reverse: { from: ["paid"], to: "paying", about: "A reorg below finality reopened its Payment.", guard: "Nothing of it is claimed or recovered yet.", emits: [event_employee_advance_transitioned] },
    claim: { from: ["paid"], to: "claimed", about: "An approved claim took the last of it.", emits: [event_employee_advance_transitioned] },
    unclaim: { from: ["claimed"], to: "paid", about: "A claim that took part of it was cancelled.", emits: [event_employee_advance_transitioned] },
    recover: { from: ["paid"], to: "returned", about: "A submitted slip recovered all of it, none claimed.", emits: [event_employee_advance_transitioned] },
    recover_partly: { from: ["paid"], to: "partly_claimed_and_returned", about: "A submitted slip recovered what no claim took.", emits: [event_employee_advance_transitioned] },
    unrecover: { from: ["returned", "partly_claimed_and_returned"], to: "paid", about: "The run whose slip recovered it was cancelled.", emits: [event_employee_advance_transitioned] },
  },
});
