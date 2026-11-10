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

/**
 * One time log a request bills, by its timesheet and row. Only the log is named: the hours and amount the request asks
 * for it are the request's own, as a Sales Invoice Timesheet row's are, and never written to the log (projects.bill-time).
 */
export const BilledLog = Schema.Struct({
  timesheet_id: S,
  idx: N,
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
    "the Organization's, billable and of no other customer than the request's payer (INVALID_INPUT), of a timesheet " +
    "that is submitted, partly or wholly billed or paid by a payslip, and name no sales invoice yet (WRONG_STATE: a " +
    "log is billed once, whichever side's invoice took it first; ERPNext refuses both). It writes " +
    "each log's `sales_invoice` (the request's id) and nothing else of the log, as ERPNext's `update_time_sheet` does: " +
    "a log's `billing_amount` stays its rate times its billing hours, and what the request asks for it is the " +
    "request's. Then each timesheet's billed totals count every billed log's own billing hours and amount, " +
    "`per_billed` is worked out again, and its status follows Frappe HR's `set_status`: `bill_part` below 100 percent, " +
    "`bill` at 100; a timesheet a salary slip already paid keeps `payslip` and changes its totals only, since a bill " +
    "sets no timesheet's own sales-invoice link. `unbill` clears the request's id from every log that names it " +
    "(`by_org_sales_invoice`) and works the totals and status out again: `unbill` back to submitted, or `bill_part` " +
    "while another invoice still holds part. Every write takes the next `seq` and appends to the change log, so a " +
    "connected head's sync pushes the marks in order (projects.change-log). It answers the billed logs' own hours and " +
    "amount, which the request's lines start from, and each touched timesheet. No outside call; nothing above projects.",
  concept: concept_projects,
  input: Schema.Struct({
    org_id: S,
    action: Schema.Literals(["bill", "unbill"]),
    /** The request that bills the hours (requests' id): ERPNext's Sales Invoice name, here. */
    request_id: S,
    /** The request's payer, a Party: a timesheet or project with another customer cannot be billed to it. */
    customer_party_id: S,
    /** `bill`: the logs it bills. `unbill`: empty; every log naming the request is cleared. */
    logs: Schema.Array(BilledLog),
    /** The principal whose command it is, for the change log. */
    by: S,
  }),
  output: Schema.Struct({
    /** The billed logs' own billing hours and amount (Frappe's totals), from which the request's lines start. */
    billed_hours: Decimal,
    billed_amount: Decimal,
    timesheets: Schema.Array(BilledTimesheet),
  }),
  errors: [error_INVALID_INPUT, error_WRONG_STATE],
  reads: [table_project_settings, table_projects, table_timesheets, table_timesheet_logs],
  writes: [table_timesheet_logs, table_timesheets, table_project_changes, table_project_settings],
  drives: [t.bill_part, t.bill, t.unbill],
  invokes: [],
  emits: [],
  was: [
    `${FRAPPE}/accounts/doctype/sales_invoice/services/timesheet_billing.py:19`,
    `${FRAPPE}/projects/doctype/timesheet/timesheet.py:141`,
    "/tmp/hrms/hrms/overrides/employee_timesheet.py:10",
  ],
});
