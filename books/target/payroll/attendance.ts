// The attendance area: Frappe HR's Shift Type, Shift Assignment, Employee Checkin and Attendance, kept by Capxul
// (hr-data.ts). A People hat wearer adds shift types, assigns them, and marks or cancels a day's attendance; an
// Employee checks in and out and reads their own, member or not (payroll.hr-self). Each active shift assignment is
// one durable process that marks its Employee's day from their check-ins when the day's shift is over, on the
// world's clock (aaron.world-clock; payroll.attendance.auto). Payroll is based on attendance, unmarked days
// counted present, so an absent day docks the slip that covers it (payroll.attendance-based).

import { budget, defineRpc, defineWorkflow } from "../../../packages/book/src/index.ts";
import { concept_payroll } from "../shared/foundation.ts";
import { error_INVALID_INPUT, error_NOT_AUTHENTICATED, error_ROLE_PERMISSION_DENIED } from "../shared/vocabulary.ts";
import { table_organizations } from "../organizations/data.ts";
import { table_employees } from "./data.ts";
import {
  event_shift_assignment_transitioned,
  machine_attendance,
  machine_shift_assignment,
  table_attendances,
  table_employee_checkins,
  table_holiday_lists,
  table_leave_types,
  table_shift_assignments,
  table_shift_types,
} from "./hr-data.ts";
import { HR_ERRORS, HR_GUARD, HR_READS, WHO_HR } from "./employees.ts";
import { HR_LOGGED, MEMBER_GUARD, SELF_ERRORS, SELF_GUARD, SELF_LIST_GUARD, SELF_READS, WHO_MEMBER, WHO_SELF_HR } from "./leave.ts";
import {
  Attendance,
  AttendancePage,
  AttendanceRef,
  Checkin,
  CheckinInput,
  MarkInput,
  MyAttendanceInput,
  MyAttendancePage,
  OrgAttendanceListInput,
  ShiftAssignInput,
  ShiftAssignment,
  ShiftAssignmentRef,
  ShiftType,
  ShiftTypeAddInput,
  ShiftTypeListInput,
  ShiftTypePage,
} from "./hr-shapes.ts";

const HR = "/tmp/hrms/hrms/hr/doctype";
const READ_ERRORS = [error_NOT_AUTHENTICATED, error_ROLE_PERMISSION_DENIED, error_INVALID_INPUT] as const;

// ── shift types and assignments ─────────────────────────────────────────────────────────────

export const rpc_payroll_shift_types_add = defineRpc({
  id: "payroll.shift-types.add",
  title: "Add a shift type",
  about:
    HR_GUARD +
    "A Shift Type with its name (unique: WRONG_STATE naming the one that has it), its start and end (`HH:MM` in the " +
    "Organization's time zone, the end after the start: a night shift across midnight is a head's), and, with " +
    "`autoAttendance`, its thresholds: hours of work below which a day is a half day (`halfDayBelow`) or absent " +
    "(`absentBelow`, below the half-day one), and the minutes of grace before an entry is late or an exit early " +
    "(INVALID_INPUT naming the field for a bad value); a grace given turns on Frappe's `enable_late_entry_marking` or " +
    "`enable_early_exit_marking`, and none leaves it off. Check-ins count from 60 minutes before its start to 60 after " +
    "its end, Frappe's defaults; a day with no check-in is marked absent at that day's marking (`absent_buffer_days` " +
    "0); `process_attendance_after` is today. It answers the type.",
  was: [`${HR}/shift_type/shift_type.json`, `${HR}/shift_type/shift_type.py`],
  concept: concept_payroll,
  kind: "mutation",
  who: WHO_HR,
  input: ShiftTypeAddInput,
  output: ShiftType,
  errors: [...HR_ERRORS],
  reads: [...HR_READS, table_shift_types],
  writes: [table_shift_types, ...HR_LOGGED],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("write"),
});

export const rpc_payroll_shift_types_list = defineRpc({
  id: "payroll.shift-types.list",
  title: "List the Organization's shift types and who works them",
  about: MEMBER_GUARD + "The shift types by name, each with its hours, thresholds and its active assignments now. A page at a time. It reads only.",
  was: [`${HR}/shift_type/shift_type.json`],
  concept: concept_payroll,
  kind: "query",
  who: WHO_MEMBER,
  input: ShiftTypeListInput,
  output: ShiftTypePage,
  errors: [...READ_ERRORS],
  reads: [...HR_READS, table_shift_types, table_shift_assignments],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("read"),
});

export const rpc_payroll_shift_types_assign = defineRpc({
  id: "payroll.shift-types.assign",
  title: "Assign a shift type to an Employee from a day",
  about:
    HR_GUARD +
    "The type by name or `sht_` id and the Employee must be the Organization's (INVALID_INPUT), the Employee not left " +
    "(WRONG_STATE), the end, if given, on or after the start (INVALID_INPUT). Another active assignment of the Employee " +
    "covering any of its days is WRONG_STATE naming it (one shift a day, HR Settings). Then it is born `active` " +
    "(shift-assignment.assign), which starts its process (payroll.attendance.auto). It answers the assignment.",
  was: [`${HR}/shift_assignment/shift_assignment.py`],
  concept: concept_payroll,
  kind: "mutation",
  who: WHO_HR,
  input: ShiftAssignInput,
  output: ShiftAssignment,
  errors: [...HR_ERRORS],
  reads: [...HR_READS, table_employees, table_shift_types, table_shift_assignments],
  writes: [table_shift_assignments, ...HR_LOGGED],
  drives: [machine_shift_assignment.t.assign],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("write"),
});

export const rpc_payroll_shift_types_unassign = defineRpc({
  id: "payroll.shift-types.unassign",
  title: "End a shift assignment",
  about:
    HR_GUARD +
    "The assignment must be the Organization's (INVALID_INPUT) and active (WRONG_STATE naming the status). It becomes " +
    "`inactive` (shift-assignment.unassign), and its process marks no later day; days already marked keep their " +
    "attendance. It answers the assignment.",
  was: [`${HR}/shift_assignment/shift_assignment.py`],
  concept: concept_payroll,
  kind: "mutation",
  who: WHO_HR,
  input: ShiftAssignmentRef,
  output: ShiftAssignment,
  errors: [...HR_ERRORS],
  reads: [...HR_READS, table_shift_assignments, table_shift_types],
  writes: [table_shift_assignments, ...HR_LOGGED],
  drives: [machine_shift_assignment.t.unassign],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("write"),
});

// ── check-ins ───────────────────────────────────────────────────────────────────────────────

export const rpc_payroll_attendance_checkin = defineRpc({
  id: "payroll.attendance.checkin",
  title: "Check in or out",
  about:
    SELF_GUARD +
    "Their Employee must be active (WRONG_STATE naming the status). One Employee Checkin is written at the world's " +
    "clock now, never a time the caller gives (aaron.world-clock), with `log` (in or out) if given, else left for " +
    "alternating entries to decide, the device (`cli` or `sdk`), and the shift it falls in: the Employee's active " +
    "assignment whose shift window (60 minutes either side) holds now, or none, and then it never marks attendance, as " +
    "in Frappe. Nothing else is written; the shift's process reads it at the day's end. It answers the check-in.",
  was: [`${HR}/employee_checkin/employee_checkin.py`],
  concept: concept_payroll,
  kind: "mutation",
  who: WHO_SELF_HR,
  input: CheckinInput,
  output: Checkin,
  errors: [...SELF_ERRORS],
  reads: [...SELF_READS, table_shift_assignments, table_shift_types],
  writes: [table_employee_checkins, ...HR_LOGGED],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("write"),
});

export const rpc_payroll_attendance_mine = defineRpc({
  id: "payroll.attendance.mine",
  title: "Your own attendance and check-ins",
  about:
    SELF_LIST_GUARD +
    "Their attendance, each naming its employer, in a day range (this month in each employer's time zone unless given), " +
    "newest day first, each with its status, its hours and late entry or early exit, and who marked it; and their " +
    "check-ins on the same days, with the attendance each marked. A page of days at a time. It reads only.",
  was: [`${HR}/attendance/attendance.json`, `${HR}/employee_checkin/employee_checkin.json`],
  concept: concept_payroll,
  kind: "query",
  who: WHO_SELF_HR,
  input: MyAttendanceInput,
  output: MyAttendancePage,
  errors: [error_NOT_AUTHENTICATED, error_INVALID_INPUT],
  reads: [...SELF_READS, table_attendances, table_employee_checkins, table_shift_types, table_leave_types],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("read"),
});

// ── attendance ──────────────────────────────────────────────────────────────────────────────

export const rpc_payroll_attendance_mark = defineRpc({
  id: "payroll.attendance.mark",
  title: "Mark an Employee's attendance for a day",
  about:
    HR_GUARD +
    "The Employee must be the Organization's (INVALID_INPUT) and the day inside their employment (on or after joining, " +
    "on or before any relieving day: INVALID_INPUT). `on_leave` and `half_day` take a leave type of the Organization's " +
    "(INVALID_INPUT without one for `on_leave`), which counts as Frappe's attendance-based payroll counts it: an unpaid " +
    "type's day docks pay. A day already marked is WRONG_STATE naming its attendance: cancel it first, as Frappe's " +
    "duplicate check refuses; a day an approved leave marked is cancelled only by cancelling that leave. Then one " +
    "attendance is born submitted (attendance.mark), source `mark`. It answers the attendance.",
  was: [`${HR}/attendance/attendance.py`],
  concept: concept_payroll,
  kind: "mutation",
  who: WHO_HR,
  input: MarkInput,
  output: Attendance,
  errors: [...HR_ERRORS],
  reads: [...HR_READS, table_employees, table_attendances, table_leave_types],
  writes: [table_attendances, ...HR_LOGGED],
  drives: [machine_attendance.t.mark],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("write"),
});

export const rpc_payroll_attendance_cancel = defineRpc({
  id: "payroll.attendance.cancel",
  title: "Cancel a day's attendance",
  about:
    HR_GUARD +
    "The attendance must be the Organization's (INVALID_INPUT) and submitted (WRONG_STATE naming the status); one an " +
    "approved leave marked is WRONG_STATE naming the leave, whose cancelling cancels it. It is cancelled " +
    "(attendance.cancel), so the day is unmarked, counted present, and may be marked again. A slip already submitted " +
    "keeps the days it was worked out with. It answers the attendance.",
  was: [`${HR}/attendance/attendance.py`],
  concept: concept_payroll,
  kind: "mutation",
  who: WHO_HR,
  input: AttendanceRef,
  output: Attendance,
  errors: [...HR_ERRORS],
  reads: [...HR_READS, table_attendances],
  writes: [table_attendances, ...HR_LOGGED],
  drives: [machine_attendance.t.cancel],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("write"),
});

export const rpc_payroll_attendance_list = defineRpc({
  id: "payroll.attendance.list",
  title: "List the Organization's attendance",
  about:
    HR_GUARD +
    "Submitted attendance by day, newest first; `employeeId`, `department`, `status` and a day range filter " +
    "(INVALID_INPUT for one that names nothing). Unmarked days are not listed: they count present. A page at a time. " +
    "It reads only.",
  was: [`${HR}/attendance/attendance.json`],
  concept: concept_payroll,
  kind: "query",
  who: WHO_HR,
  input: OrgAttendanceListInput,
  output: AttendancePage,
  errors: [...READ_ERRORS],
  reads: [...HR_READS, table_employees, table_attendances, table_leave_types, table_shift_types],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("read"),
});

// ── auto attendance ─────────────────────────────────────────────────────────────────────────

export const workflow_payroll_attendance_auto = defineWorkflow({
  id: "payroll.attendance.auto",
  title: "Mark an assigned Employee's days from their check-ins",
  about:
    "Started when a shift is assigned (shift-assignment.assign, through the outbox), one instance per assignment, as " +
    "Frappe's Shift Type `process_auto_attendance` does for each shift, but owned by the assignment and timed by it " +
    "rather than swept hourly (rules.durable-processes, P3). Its timer is on the world's clock (aaron.world-clock): " +
    "60 minutes after each day's shift end, in the Organization's time zone, from the assignment's start (and the " +
    "type's `process_attendance_after`) to its end. The start day is itself a shift day: an assignment from today " +
    "whose Employee has not checked in marks today absent, as Frappe's `mark_absent_for_dates_with_no_attendance` " +
    "does, so a People hat assigns from the next working day to leave today unmarked. For that day it marks nothing when the type's auto attendance is " +
    "off, the day is a holiday, the Employee is not active then, or the day is already marked (a leave, a People hat's " +
    "mark); otherwise it reads their check-ins in the shift's window and marks the day (attendance.mark, source " +
    "`checkins`): none, `absent`; working hours from the first check-in to the last check-out below `absentBelow`, " +
    "`absent`, below `halfDayBelow`, `half_day`, else `present`; with `in_time`, `out_time`, `working_hours`, and late " +
    "entry or early exit past the grace minutes where the type marks them; and links each check-in to the attendance. It ends after its end " +
    "day's mark, or when the assignment is unassigned. A world warped past several days marks each in order, each " +
    "step reading its timer's due instant (time.durable-timers). Its `timeoutMs` bounds one step's work in real time, " +
    "as every process's does; its life is the assignment's, ended by its end day or the unassigned signal, never a timeout.",
  concept: concept_payroll,
  priority: "normal",
  trigger: { transition: machine_shift_assignment.t.assign },
  instance: { per: table_shift_assignments },
  waits: [
    { name: "day-end", for: "timer", about: "Until 60 minutes after the next day's shift end, on the world's clock." },
    {
      name: "unassigned",
      for: "signal",
      key: [{ on: [event_shift_assignment_transitioned], props: ["shift_assignment_id"] }],
      about: "The assignment was unassigned: mark no later day, and end.",
    },
  ],
  steps: [
    { name: "mark-day", about: "The day just over: skip, or mark it from the check-ins in its window and link them to the attendance." },
    { name: "next", about: "Wait for the next day's end, until the assignment's end day is marked or it is unassigned." },
  ],
  reads: [table_shift_assignments, table_shift_types, table_employees, table_employee_checkins, table_attendances, table_holiday_lists, table_organizations],
  writes: [table_attendances, table_employee_checkins, ...HR_LOGGED],
  drives: [machine_attendance.t.mark],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  idempotency:
    "One instance per shift_assignment_id; a day is marked once, by the one submitted attendance per Employee and day " +
    "(`by_employee_date`): a step run again finds the day marked and writes nothing.",
  timeoutMs: 60_000,
  retries: { max: 5, backoff: "exponential" },
  compensation: "None: a day it marked wrong is cancelled by a People hat and marked again.",
  budget: budget("background"),
  was: [`${HR}/shift_type/shift_type.py`, `${HR}/employee_checkin/employee_checkin.py`],
});
