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
import { defineEvent, defineMachine, defineTable } from "../../../../packages/book/src/index.ts";
import { concept_payments } from "../../shared/foundation.ts";

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

// ── holidays ────────────────────────────────────────────────────────────────────────────────

export const WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;

/** One Holiday row of a list: Frappe's `holiday_date`, `description`, `weekly_off` and `is_half_day`. */
export const HolidayRow = Schema.Struct({ holiday_date: Day, description: S, weekly_off: B, is_half_day: B });

// ── leave ───────────────────────────────────────────────────────────────────────────────────

/** Leave Application `status`, lowercased. Open is Frappe's draft; approved and rejected are submitted; cancelled is cancelled. */
export const LEAVE_STATUSES = ["open", "approved", "rejected", "cancelled"] as const;

// ── shifts, check-ins and attendance ────────────────────────────────────────────────────────

/** Attendance `status`, lowercased: Frappe's Present, Absent, On Leave, Half Day and Work From Home. */
export const ATTENDANCE_STATUSES = ["present", "absent", "on_leave", "half_day", "work_from_home"] as const;

// ── expense claims and advances ─────────────────────────────────────────────────────────────

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

