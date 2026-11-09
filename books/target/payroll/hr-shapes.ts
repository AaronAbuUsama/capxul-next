// The Effect Schemas the HR rpcs, flows and operations take and give (hr-data.ts). Not records: values the HR
// area files (leave.ts, attendance.ts, expenses.ts) and operations.ts share, so one shape is written once.
// Inputs are camelCase, as every payroll input is; each list pages as every list does (G5, G9).

import { Schema } from "effect";
import { ADVANCE_STATUSES, ATTENDANCE_STATUSES, EXPENSE_CLAIM_STATUSES, LEAVE_STATUSES, WEEKDAYS } from "./hr-data.ts";

const S = Schema.String;
const N = Schema.Number;
const B = Schema.Boolean;
const Null = Schema.NullOr;
const opt = Schema.optionalKey;

/** `YYYY-MM-DD`, a day in the Organization's time zone. */
const Day = S;
/** A decimal string in the token's whole units, at its display precision. */
const Money = S;
/** A page of a list (G5): at most `limit` (1 to 100, 25 by default) after the cursor `after`. */
const PAGE = { after: opt(S), limit: opt(Schema.Int) } as const;
const page = <F extends Schema.Top>(item: F) => Schema.Struct({ items: Schema.Array(item), nextCursor: Null(S) });

/**
 * Who a self command acts as: `--employer <handle>` names the Organization that employs the caller; absent, the one
 * Organization where the caller is a live Employee (payroll.hr-self). Never `--org`, which acts for an Organization (G1).
 */
const Employer = { employer: opt(S) } as const;

// ── holidays ────────────────────────────────────────────────────────────────────────────────

/** `org holiday add (<day> | --weekly <weekday> --year <yyyy>) [--description <text>] [--half-day]`. */
export const HolidayAddInput = Schema.Struct({
  orgId: S,
  day: opt(Day),
  weekly: opt(Schema.Literals(WEEKDAYS)),
  year: opt(Schema.Int),
  description: opt(S),
  halfDay: opt(B),
});
export const HolidayRemoveInput = Schema.Struct({ orgId: S, day: Day });
export const HolidayListInput = Schema.Struct({ orgId: S, year: opt(Schema.Int) });
export const Holiday = Schema.Struct({ day: Day, description: S, weeklyOff: B, halfDay: B });
export const HolidayList = Schema.Struct({
  holidayListId: Null(S),
  name: Null(S),
  year: Schema.Int,
  holidays: Schema.Array(Holiday),
  totalHolidays: N,
});

// ── leave types and allocations ─────────────────────────────────────────────────────────────

/** The flags `org leave-type add` and `change` take: `--max-days`, `--applicable-after`, `--max-continuous`, `--carry-forward`, `--max-carry`, `--without-pay`, `--partly-paid <fraction>`, `--include-holidays`, `--allow-negative`. */
const LeaveTypeFlags = {
  maxDays: opt(N),
  applicableAfter: opt(Schema.Int),
  maxContinuous: opt(Schema.Int),
  carryForward: opt(B),
  maxCarry: opt(N),
  withoutPay: opt(B),
  /** The paid share of each day, more than 0 and less than 1: a partly paid leave. */
  partlyPaid: opt(N),
  includeHolidays: opt(B),
  allowNegative: opt(B),
} as const;
export const LeaveTypeAddInput = Schema.Struct({ orgId: S, name: S, ...LeaveTypeFlags });
export const LeaveTypeChangeInput = Schema.Struct({ orgId: S, leaveType: S, ...LeaveTypeFlags, clear: opt(Schema.Array(S)) });
export const LeaveTypeListInput = Schema.Struct({ orgId: S, ...PAGE });
export const LeaveType = Schema.Struct({
  leaveTypeId: S,
  name: S,
  maxDays: Null(N),
  applicableAfter: Schema.Int,
  maxContinuous: Null(Schema.Int),
  carryForward: B,
  maxCarry: Null(N),
  withoutPay: B,
  partlyPaid: Null(N),
  includeHolidays: B,
  allowNegative: B,
  /** True for a type a head made with earned, compensatory, optional or encashable leave: its allocations are the head's. */
  headOnly: B,
});
export const LeaveTypePage = page(LeaveType);

/** `org leave allocate <employee> --type <leave-type> --days <n> --start <day> --end <day> [--carry-forward] [--description]`. */
export const AllocateInput = Schema.Struct({
  orgId: S,
  employeeId: S,
  leaveType: S,
  days: N,
  startDate: Day,
  endDate: Day,
  carryForward: opt(B),
  description: opt(S),
});
export const AllocationRef = Schema.Struct({ orgId: S, allocationId: S });
export const Allocation = Schema.Struct({
  allocationId: S,
  employeeId: S,
  employeeName: S,
  leaveTypeId: S,
  leaveType: S,
  startDate: Day,
  endDate: Day,
  newDays: N,
  carriedDays: N,
  totalDays: N,
  /** True once a later allocation of the type carried forward from this one: nothing more is taken from it. */
  expired: B,
  status: Schema.Literals(["submitted", "cancelled"]),
});

/** One leave type's balance on a day: what its allocation gave, what approved leave took, what open applications ask, and what is left. */
export const BalanceRow = Schema.Struct({
  leaveTypeId: S,
  leaveType: S,
  allocationId: Null(S),
  allocated: N,
  taken: N,
  pending: N,
  balance: N,
  withoutPay: B,
});
export const OrgBalanceInput = Schema.Struct({ orgId: S, employeeId: S, on: opt(Day) });
export const MyBalanceInput = Schema.Struct({ ...Employer, on: opt(Day) });
export const Balance = Schema.Struct({ employeeId: S, employeeName: S, employer: S, on: Day, types: Schema.Array(BalanceRow) });

// ── leave applications ──────────────────────────────────────────────────────────────────────

/** `leave apply --type <leave-type> --start <day> --end <day> [--half-day [--half-day-on <day>]] [--reason <text>] [--employer <handle>]`. */
export const ApplyInput = Schema.Struct({
  ...Employer,
  leaveType: S,
  startDate: Day,
  endDate: Day,
  halfDay: opt(B),
  halfDayOn: opt(Day),
  reason: opt(S),
});
export const LeaveStatus = Schema.Literals(LEAVE_STATUSES);
export const Leave = Schema.Struct({
  leaveApplicationId: S,
  employer: S,
  employeeId: S,
  employeeName: S,
  department: Null(S),
  leaveTypeId: S,
  leaveType: S,
  startDate: Day,
  endDate: Day,
  halfDay: B,
  halfDayOn: Null(Day),
  days: N,
  reason: Null(S),
  status: LeaveStatus,
  /** Who decided it, by mailbox or `@handle`, and when (ISO 8601). */
  decidedBy: Null(S),
  decidedAt: Null(S),
  rejectionReason: Null(S),
  /** The balance of its type on its first day, after it. */
  balanceAfter: Null(N),
});
export const MyLeaveRef = Schema.Struct({ ...Employer, leaveApplicationId: S });
export const MyLeaveListInput = Schema.Struct({ ...Employer, status: opt(LeaveStatus), ...PAGE });
export const LeaveRef = Schema.Struct({ orgId: S, leaveApplicationId: S });
export const RejectLeaveInput = Schema.Struct({ orgId: S, leaveApplicationId: S, reason: opt(S) });
export const OrgLeaveListInput = Schema.Struct({
  orgId: S,
  employeeId: opt(S),
  department: opt(S),
  status: opt(LeaveStatus),
  startDate: opt(Day),
  endDate: opt(Day),
  ...PAGE,
});
export const LeavePage = page(Leave);

// ── shifts, check-ins and attendance ────────────────────────────────────────────────────────

/** `org shift-type add <name> --start <HH:MM> --end <HH:MM> [--auto-attendance] [--half-day-below <hours>] [--absent-below <hours>] [--late-grace <minutes>] [--early-grace <minutes>]`. */
export const ShiftTypeAddInput = Schema.Struct({
  orgId: S,
  name: S,
  start: S,
  end: S,
  autoAttendance: opt(B),
  halfDayBelow: opt(N),
  absentBelow: opt(N),
  lateGrace: opt(Schema.Int),
  earlyGrace: opt(Schema.Int),
});
export const ShiftType = Schema.Struct({
  shiftTypeId: S,
  name: S,
  start: S,
  end: S,
  autoAttendance: B,
  halfDayBelow: Null(N),
  absentBelow: Null(N),
  lateGrace: Null(Schema.Int),
  earlyGrace: Null(Schema.Int),
  /** The Employees it is assigned to now. */
  assigned: Schema.Array(Schema.Struct({ shiftAssignmentId: S, employeeId: S, employeeName: S, startDate: Day, endDate: Null(Day) })),
});
export const ShiftTypeListInput = Schema.Struct({ orgId: S, ...PAGE });
export const ShiftTypePage = page(ShiftType);
/** `org shift-type assign <shift-type> <employee> --start <day> [--end <day>]`. */
export const ShiftAssignInput = Schema.Struct({ orgId: S, shiftType: S, employeeId: S, startDate: Day, endDate: opt(Day) });
export const ShiftAssignmentRef = Schema.Struct({ orgId: S, shiftAssignmentId: S });
export const ShiftAssignment = Schema.Struct({
  shiftAssignmentId: S,
  shiftTypeId: S,
  shiftType: S,
  employeeId: S,
  employeeName: S,
  startDate: Day,
  endDate: Null(Day),
  status: Schema.Literals(["active", "inactive"]),
});

/** `attendance checkin [--log in|out] [--employer <handle>]`. */
export const CheckinInput = Schema.Struct({ ...Employer, log: opt(Schema.Literals(["in", "out"])) });
export const Checkin = Schema.Struct({
  checkinId: S,
  employer: S,
  employeeId: S,
  /** The world's clock at the check-in, ISO 8601 (aaron.world-clock). */
  time: S,
  log: Null(Schema.Literals(["in", "out"])),
  shiftType: Null(S),
  attendanceId: Null(S),
});
export const AttendanceStatus = Schema.Literals(ATTENDANCE_STATUSES);
export const Attendance = Schema.Struct({
  attendanceId: S,
  employer: S,
  employeeId: S,
  employeeName: S,
  day: Day,
  status: AttendanceStatus,
  halfDayStatus: Null(Schema.Literals(["present", "absent"])),
  leaveType: Null(S),
  leaveApplicationId: Null(S),
  shiftType: Null(S),
  inTime: Null(S),
  outTime: Null(S),
  workingHours: Null(N),
  lateEntry: B,
  earlyExit: B,
  source: Schema.Literals(["mark", "leave", "checkins", "head"]),
  docstatus: Schema.Literals(["submitted", "cancelled"]),
});
export const MyAttendanceInput = Schema.Struct({ ...Employer, startDate: opt(Day), endDate: opt(Day), ...PAGE });
/** What `attendance list` prints: a page of the caller's own marks, and their check-ins in the same days. */
export const MyAttendancePage = Schema.Struct({ items: Schema.Array(Attendance), checkins: Schema.Array(Checkin), nextCursor: Null(S) });
/** `org attendance mark <employee> --on <day> --status present|absent|half_day|work_from_home|on_leave [--leave-type <type>]`: the status as it prints, as `org project list --status on_hold`. */
export const MarkInput = Schema.Struct({ orgId: S, employeeId: S, on: Day, status: AttendanceStatus, leaveType: opt(S) });
export const AttendanceRef = Schema.Struct({ orgId: S, attendanceId: S });
export const OrgAttendanceListInput = Schema.Struct({
  orgId: S,
  employeeId: opt(S),
  department: opt(S),
  status: opt(AttendanceStatus),
  startDate: opt(Day),
  endDate: opt(Day),
  ...PAGE,
});
export const AttendancePage = page(Attendance);

// ── expense claims ──────────────────────────────────────────────────────────────────────────

export const ExpenseTypeAddInput = Schema.Struct({ orgId: S, name: S, account: opt(S), description: opt(S) });
export const ExpenseType = Schema.Struct({ expenseClaimTypeId: S, name: S, description: Null(S), account: Null(S) });
export const ExpenseTypeListInput = Schema.Struct({ orgId: S, ...PAGE });
export const ExpenseTypePage = page(ExpenseType);

/** One line as `--type --amount [--on] [--description]` gives it, or one row of `--file`'s `expenses`. */
export const ExpenseLineInput = Schema.Struct({ type: S, amount: Money, on: opt(Day), description: opt(S) });
/**
 * `expense-claim create (--type <expense-type> --amount <a> [--on <day>] [--description <text>] | --file <path>)
 * [--receipt <path>]… [--advance <advance>]… [--remark <text>] [--employer <handle>]`: the CLI reads `--file` and each
 * `--receipt` and passes their contents.
 */
export const ClaimCreateInput = Schema.Struct({
  ...Employer,
  expenses: Schema.Array(ExpenseLineInput),
  receipts: opt(Schema.Array(Schema.Struct({ filename: S, mediaType: S, bytes: Schema.Uint8Array }))),
  advances: opt(Schema.Array(S)),
  remark: opt(S),
});
export const ClaimStatus = Schema.Literals(EXPENSE_CLAIM_STATUSES);
export const ClaimLine = Schema.Struct({ line: Schema.Int, day: Day, type: S, description: Null(S), amount: Money, sanctioned: Money });
export const Claim = Schema.Struct({
  expenseClaimId: S,
  employer: S,
  employeeId: S,
  employeeName: S,
  department: S,
  postingDate: Day,
  token: S,
  lines: Schema.Array(ClaimLine),
  receipts: Schema.Array(Schema.Struct({ documentId: S, filename: Null(S) })),
  advances: Schema.Array(Schema.Struct({ employeeAdvanceId: S, allocated: Money })),
  claimed: Money,
  sanctioned: Money,
  advanced: Money,
  grandTotal: Money,
  status: ClaimStatus,
  decidedBy: Null(S),
  decidedAt: Null(S),
  remark: Null(S),
  rejectionReason: Null(S),
  /** Once sent: the Payment (`payment get` takes it), and once paid its settled facts. */
  paymentId: Null(S),
  txHash: Null(S),
  paidAt: Null(S),
});
export const ClaimPage = page(Claim);
export const MyClaimRef = Schema.Struct({ ...Employer, expenseClaimId: S });
export const MyClaimListInput = Schema.Struct({ ...Employer, status: opt(ClaimStatus), ...PAGE });
export const ClaimRef = Schema.Struct({ orgId: S, expenseClaimId: S });
/** `org expense-claim approve <claim> [--sanction <line>=<amount>]…`: absent, each line sanctioned at its amount. */
export const ClaimApproveInput = Schema.Struct({
  orgId: S,
  expenseClaimId: S,
  sanction: opt(Schema.Array(Schema.Struct({ line: Schema.Int, amount: Money }))),
});
export const ClaimRejectInput = Schema.Struct({ orgId: S, expenseClaimId: S, reason: S });
export const OrgClaimListInput = Schema.Struct({ orgId: S, employeeId: opt(S), department: opt(S), status: opt(ClaimStatus), ...PAGE });
/** `org expense-claim pay <claim> [--request-key <key>]`, and the flow's `--timeout-seconds` and `--no-wait`. */
export const ClaimPayInput = Schema.Struct({ orgId: S, expenseClaimId: S, requestKey: opt(S) });
export const ClaimPayFlowInput = Schema.Struct({ ...ClaimPayInput.fields, timeoutSeconds: opt(Schema.Int), noWait: opt(B) });

// ── advances ────────────────────────────────────────────────────────────────────────────────

/** `advance request --amount <a> --purpose <text> [--employer <handle>]`. */
export const AdvanceRequestInput = Schema.Struct({ ...Employer, amount: Money, purpose: S });
export const AdvanceStatus = Schema.Literals(ADVANCE_STATUSES);
export const Advance = Schema.Struct({
  employeeAdvanceId: S,
  employer: S,
  employeeId: S,
  employeeName: S,
  department: S,
  postingDate: Day,
  purpose: S,
  token: S,
  amount: Money,
  paid: Money,
  claimed: Money,
  returned: Money,
  /** What no claim took and no slip recovered yet. */
  unclaimed: Money,
  /** Set once settled: the Additional Salary that recovers the rest, and the payroll date its slip holds. */
  recovery: Null(Schema.Struct({ additionalSalaryId: S, amount: Money, payrollDate: Day })),
  status: AdvanceStatus,
  decidedBy: Null(S),
  rejectionReason: Null(S),
  paymentId: Null(S),
  txHash: Null(S),
  paidAt: Null(S),
});
export const AdvancePage = page(Advance);
export const MyAdvanceRef = Schema.Struct({ ...Employer, employeeAdvanceId: S });
export const MyAdvanceListInput = Schema.Struct({ ...Employer, status: opt(AdvanceStatus), ...PAGE });
export const AdvanceRef = Schema.Struct({ orgId: S, employeeAdvanceId: S });
/** `org advance settle <advance> [--confirm]`: `confirm` true from a script (`--confirm`), with no preview (G5). */
export const AdvanceSettleFlowInput = Schema.Struct({ orgId: S, employeeAdvanceId: S, confirm: opt(B) });
export const AdvanceRejectInput = Schema.Struct({ orgId: S, employeeAdvanceId: S, reason: S });
export const OrgAdvanceListInput = Schema.Struct({ orgId: S, employeeId: opt(S), department: opt(S), status: opt(AdvanceStatus), ...PAGE });
export const AdvancePayInput = Schema.Struct({ orgId: S, employeeAdvanceId: S, requestKey: opt(S) });
export const AdvancePayFlowInput = Schema.Struct({ ...AdvancePayInput.fields, timeoutSeconds: opt(Schema.Int), noWait: opt(B) });

/** What a money step answers (prepare), as `org payroll run pay`'s rpc does: the approval it opened and whether it replayed a key. */
export const Prepared = { approvalId: S, expiresAt: S, replayed: B } as const;
/** What a money command prints (G9): as `payment send` does, the approval with `--no-wait`, else the record as it stands. */
export const moneyOutcome = (record: Schema.Top, status: Schema.Top) =>
  Schema.Struct({
    status: Schema.Union([Schema.Literal("awaiting_approval"), status]),
    approvalId: S,
    approvalUrl: S,
    expiresAt: S,
    record,
    next: Null(Schema.Array(S)),
  });
