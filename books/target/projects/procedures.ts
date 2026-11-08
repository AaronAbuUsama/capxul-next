// The projects door: the one procedure another concept invokes inside its own transaction (P4,
// rules.procedures). A request that bills logged hours, an Invoice for time (ERPNext's Sales Invoice
// with its timesheets), marks those hours billed in the transaction that issues it, and clears the
// marks in the transaction that ends it (projects.bill-time). Paying hours through a salary slip is
// payroll's, through the head's sync for now (projects.billing-and-payslips).
//
// Everything else the concepts above need from projects they read (a project as an accounting
// dimension; a timesheet's billable logs): the door is for writes only.

import { Schema } from "effect";
import { defineProcedure } from "../../../packages/book/src/index.ts";
import { concept_projects } from "../shared/foundation.ts";
import { error_INVALID_INPUT, error_WRONG_STATE } from "../shared/vocabulary.ts";
import {
  machine_timesheet,
  table_project_changes,
  table_project_settings,
  table_projects,
  table_timesheet_logs,
  table_timesheets,
} from "./data.ts";

const FRAPPE = "/tmp/erpnext/erpnext";
const S = Schema.String;
const N = Schema.Number;
/** An exact decimal string in the Company's currency (projects.amounts). */
const Decimal = S;

/** One time log a request bills, by its timesheet and row, with what it bills of it. */
export const BilledLog = Schema.Struct({
  timesheet_id: S,
  idx: N,
  /** The hours billed: the log's `billing_hours`, or fewer; never more. */
  billing_hours: Decimal,
  /** What the request asks for them, in the Company's currency: hours times the log's billing rate, unless the issuer set it. */
  billing_amount: Decimal,
});

/** Where each timesheet the call touched now stands. */
export const BilledTimesheet = Schema.Struct({
  timesheet_id: S,
  status: Schema.Literals(["submitted", "partially_billed", "billed", "payslip", "completed"]),
  per_billed: Decimal,
  total_billed_hours: Decimal,
  total_billed_amount: Decimal,
});

const t = machine_timesheet.t;

export const procedure_projects_bill_time = defineProcedure({
  id: "projects.bill-time",
  title: "Mark the hours a request bills, or clear the marks when it ends",
  about:
    "Money fact: an invoice and the hours it bills are one fact, so a request for logged time and the marks that say " +
    "those hours are invoiced commit together or not at all, and the same hours are never asked for twice. Requests " +
    "invokes it in the transaction that issues an Invoice for time (`bill`) and in the one that cancels or declines " +
    "it (`unbill`); a paid request keeps its marks, and an expired one keeps them until it is cancelled, as an unpaid " +
    "Sales Invoice keeps its timesheets billed. `bill`, under the Organization's projects lock: every log must be " +
    "the Organization's, billable, of a timesheet that is submitted (or partially billed, billed or paid by a " +
    "payslip) and of no other customer than the request's payer (INVALID_INPUT), and must name no sales invoice yet " +
    "(WRONG_STATE: a log is billed once, whichever side's invoice took it first; ERPNext refuses the same). It writes " +
    "each log's `sales_invoice` (the request's id) and `billing_amount`, then each timesheet's billed totals and " +
    "`per_billed`, and its status as Frappe HR's `set_status` works it out: `bill_part` below 100 percent, `bill` at " +
    "100, or, for a timesheet a salary slip already paid, totals only, unless the bill completes it, when its own " +
    "`sales_invoice` is set and it moves `complete`. `unbill` clears the request's id from its logs and works the " +
    "status out again: `unbill` back to submitted, `bill_part` while another invoice still holds part, or " +
    "`uncomplete` back to payslip. Every write takes the next `seq` and appends to the change log, so a connected " +
    "head's sync pushes the marks in order (projects.change-log). It answers each touched timesheet as it stands. It " +
    "makes no outside call and reads nothing above projects.",
  concept: concept_projects,
  input: Schema.Struct({
    org_id: S,
    action: Schema.Literals(["bill", "unbill"]),
    /** The request that bills the hours (requests' id): ERPNext's Sales Invoice name, here. */
    request_id: S,
    /** The request's payer, a Party: a timesheet or project with another customer cannot be billed to it. */
    customer_party_id: S,
    /** `bill`: the logs and what is billed of each. `unbill`: empty; every log naming the request is cleared. */
    logs: Schema.Array(BilledLog),
    /** The principal whose command it is, for the change log. */
    by: S,
  }),
  output: Schema.Struct({
    billed_hours: Decimal,
    billed_amount: Decimal,
    timesheets: Schema.Array(BilledTimesheet),
  }),
  errors: [error_INVALID_INPUT, error_WRONG_STATE],
  reads: [table_project_settings, table_projects, table_timesheets, table_timesheet_logs],
  writes: [table_timesheet_logs, table_timesheets, table_project_changes, table_project_settings],
  drives: [t.bill_part, t.bill, t.complete, t.unbill, t.uncomplete],
  invokes: [],
  emits: [],
  was: [
    `${FRAPPE}/accounts/doctype/sales_invoice/services/timesheet_billing.py:19`,
    `${FRAPPE}/projects/doctype/timesheet/timesheet.py:141`,
    "/tmp/hrms/hrms/overrides/employee_timesheet.py:10",
  ],
});
