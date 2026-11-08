// The timesheets area: Frappe's Timesheet with its Timesheet Detail rows, as Frappe HR extends it.
// A timesheet is one worker's time: a member's own, or, kept by People or a Director, anyone else's,
// such as an employee or a contractor with no Seat (projects.permissions). A worker keeps their own
// timesheets with no hat; acting on another's reads the caller's hat live (projects.hat-guard).
// Submitting rolls the hours into the tasks and the project, and cancelling takes them out again
// (projects.derived). Billing hours is requests' (`org timesheet bill`, through projects.bill-time),
// and paying them is a salary slip's (projects.billing-and-payslips).

import { Schema } from "effect";
import { budget, defineRpc, type TransitionRef } from "../../../packages/book/src/index.ts";
import { concept_projects } from "../shared/foundation.ts";
import { table_organizations } from "../organizations/data.ts";
import {
  machine_project,
  machine_task,
  machine_timesheet,
  table_activity_types,
  table_project_settings,
  table_projects,
  table_tasks,
  table_timesheet_logs,
  table_timesheets,
} from "./data.ts";
import {
  FRAPPE,
  HAT_CALLS,
  HAT_CHAIN,
  HAT_ERRORS,
  HAT_READS,
  LOG_LINE,
  LOGGED,
  MANAGE_ERRORS,
  MEMBER_GUARD,
  MEMBER_READS,
  READ_ERRORS,
  WHO_MEMBER,
  WHO_WORKER,
  WORKER_GUARD,
} from "./guards.ts";
import { LogInput, OrgInput, Page, PageInput, Timesheet, TimesheetStatus, TimesheetSummary } from "./shapes.ts";

const S = Schema.String;
const Opt = Schema.optionalKey;
const OneTimesheet = Schema.Struct({ ...OrgInput, timesheet: S });
const ts = machine_timesheet.t;
const tk = machine_task.t;
const pr = machine_project.t;
const HRMS = "/tmp/hrms/hrms/overrides/employee_timesheet.py:10";

const VIEW_READS = [table_timesheets, table_timesheet_logs] as const;

export const rpc_projects_timesheets_create = defineRpc({
  id: "projects.timesheets.create",
  title: "Create a draft timesheet for a worker",
  about:
    MEMBER_GUARD +
    "The worker is the caller's own Party, or `for`: a Party locator (an email, an @handle, a 0x address or a Party id) " +
    "resolved read-only through parties' directory, so any Party may be a worker, an employee or contractor with no " +
    "Seat included; a locator that names no Party is INVALID_INPUT, and none is named here (projects.named-people). " +
    "For a worker who is not the caller, it then reads the caller's People or Director hat live (projects.hat-guard): " +
    "neither is ROLE_PERMISSION_DENIED, an unreadable chain PROVIDER_ERROR. `employee` is the worker's Employee name, " +
    "kept as given, as Frappe's link is held (projects.doctypes). `project` is one of the Organization's projects " +
    "(INVALID_INPUT otherwise) and gives the timesheet its customer. Then it writes one timesheet, born `draft` " +
    "(timesheet.draft), with a `ts_` id, no logs, zero totals and the Organization's currency. " +
    LOG_LINE.replace(
      "so a connected head receives it on its next push",
      "and a connected head receives it on the first push after it holds a log: Frappe's Timesheet requires one " +
        "(`time_logs` is mandatory), so the head sync holds an empty timesheet back",
    ),
  was: [`${FRAPPE}/timesheet/timesheet.json`, `${FRAPPE}/timesheet/timesheet.py:69`, HRMS],
  concept: concept_projects,
  kind: "action",
  who: WHO_WORKER,
  input: Schema.Struct({
    ...OrgInput,
    for: Opt(S),
    employee: Opt(S),
    project: Opt(S),
    title: Opt(S),
    note: Opt(S),
  }),
  output: Timesheet,
  errors: MANAGE_ERRORS,
  reads: [...HAT_READS, table_projects, table_organizations],
  writes: [table_timesheets, ...LOGGED],
  drives: [ts.draft],
  invokes: [],
  emits: [],
  calls: HAT_CALLS,
  chain: HAT_CHAIN,
  spans: [],
  budget: budget("chain-read"),
});

export const rpc_projects_timesheets_log = defineRpc({
  id: "projects.timesheets.log",
  title: "Add one time log to a draft timesheet",
  about:
    WORKER_GUARD +
    "The timesheet by its id (INVALID_INPUT otherwise), a draft (WRONG_STATE otherwise: a submitted timesheet's logs " +
    "never change). The log is checked as ERPNext's Timesheet and Timesheet Detail check it, each failure INVALID_INPUT " +
    "naming the field: an activity type of the Organization's, named without regard to case, that is not disabled; a " +
    "start and exactly one of an end " +
    "after it and hours above zero (the other is worked out); a task of the Organization's that is not cancelled; a " +
    "project that is the timesheet's own when it has one, and the task's when a task is named (a task alone gives its " +
    "project); and no overlap with another log of the same worker, or of the same employee, in any timesheet that is " +
    "not cancelled, this one included, unless the Projects Settings allow it (read under the settings row's lock). " +
    "Because ERPNext checks every log of a draft each time the draft is saved, the draft's earlier logs must also still " +
    "name an activity type that is not disabled and a task that is not cancelled, and overlap nothing the settings now " +
    "forbid (INVALID_INPUT naming the row). The " +
    "log's rates are its activity type's: costing at its costing rate for its hours, and, when billable, billing hours " +
    "equal to its hours at its billing rate. Then it writes the log and works the timesheet's totals and its start and " +
    "end days out again. " +
    LOG_LINE,
  was: [
    `${FRAPPE}/timesheet/timesheet.py:209`,
    `${FRAPPE}/timesheet/timesheet.py:225`,
    `${FRAPPE}/timesheet/timesheet.py:81`,
    `${FRAPPE}/timesheet_detail/timesheet_detail.py:46`,
    `${FRAPPE}/timesheet_detail/timesheet_detail.py:128`,
  ],
  concept: concept_projects,
  kind: "action",
  who: WHO_WORKER,
  input: Schema.Struct({ ...OneTimesheet.fields, log: LogInput }),
  output: Timesheet,
  errors: HAT_ERRORS,
  reads: [...HAT_READS, ...VIEW_READS, table_activity_types, table_tasks, table_projects, table_project_settings, table_organizations],
  writes: [table_timesheet_logs, table_timesheets, ...LOGGED],
  drives: [],
  invokes: [],
  emits: [],
  calls: HAT_CALLS,
  chain: HAT_CHAIN,
  spans: [],
  budget: budget("chain-read"),
});

export const rpc_projects_timesheets_get = defineRpc({
  id: "projects.timesheets.get",
  title: "Read one timesheet, with its logs and totals",
  about:
    MEMBER_GUARD +
    "The timesheet by its id (INVALID_INPUT when it is not one of the Organization's), with its worker, its logs in " +
    "order, its totals and share billed, what billed each log, and the salary slip that paid it, if any.",
  concept: concept_projects,
  kind: "query",
  who: WHO_MEMBER,
  input: OneTimesheet,
  output: Timesheet,
  errors: READ_ERRORS,
  reads: [...MEMBER_READS, ...VIEW_READS],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("read"),
});

export const rpc_projects_timesheets_list = defineRpc({
  id: "projects.timesheets.list",
  title: "List the Organization's timesheets by start day",
  about:
    MEMBER_GUARD +
    "One page of the Organization's timesheets, latest start day first (drafts with no log last), each as its summary: " +
    "filtered by worker (`for`, a Party locator; `by_org_party_start`), project (`by_org_project_status`) and status. " +
    "A filter that names nothing gives an empty page; a status that is no timesheet status, a `limit` outside 1 to 100 " +
    "or a cursor this list did not give is INVALID_INPUT.",
  concept: concept_projects,
  kind: "query",
  who: WHO_MEMBER,
  input: Schema.Struct({ ...OrgInput, ...PageInput, for: Opt(S), project: Opt(S), status: Opt(TimesheetStatus) }),
  output: Page(TimesheetSummary),
  errors: READ_ERRORS,
  reads: [...MEMBER_READS, table_timesheets],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("read"),
});

/** A step that rolls a timesheet's hours into, or out of, its tasks and projects. */
const rollStep = (
  verb: "submit" | "cancel",
  title: string,
  what: string,
  drives: readonly TransitionRef[],
) =>
  defineRpc({
    id: `projects.timesheets.${verb}`,
    title,
    about: WORKER_GUARD + "The timesheet by its id (INVALID_INPUT otherwise). " + what + " " + LOG_LINE,
    was: [`${FRAPPE}/timesheet/timesheet.py:165`, `${FRAPPE}/timesheet/timesheet.py:186`, `${FRAPPE}/timesheet/timesheet.py:324`, HRMS],
    concept: concept_projects,
    kind: "action",
    who: WHO_WORKER,
    input: OneTimesheet,
    output: Timesheet,
    errors: HAT_ERRORS,
    reads: [...HAT_READS, ...VIEW_READS, table_tasks, table_projects],
    writes: [table_timesheets, table_tasks, table_projects, ...LOGGED],
    drives,
    invokes: [],
    emits: [],
    calls: HAT_CALLS,
    chain: HAT_CHAIN,
    spans: [],
    budget: budget("chain-read"),
  });

export const rpc_projects_timesheets_submit = rollStep(
  "submit",
  "Submit a draft timesheet: its hours roll into its tasks and project",
  "A draft is submitted (timesheet.submit), else WRONG_STATE. It must have a log, and each log a start and an end, " +
    "hours above zero, and an activity type when an employee is named (ERPNext's `validate_mandatory_fields`), an " +
    "activity type that is not disabled and a task that is not cancelled (ERPNext's `validate_time_logs` and " +
    "`validate_tasks_not_cancelled`, which check every log of a draft again on submit), and no overlap the Projects " +
    "Settings forbid: INVALID_INPUT naming the row otherwise. Its logs then never change, except the mark of what " +
    "billed them. In the " +
    "same write each task it logs time on takes its actual time, dates and totals again, and its status as ERPNext's " +
    "`get_task_status` reads the submitted logs: an open or pending-review task becomes working (task.start), one a " +
    "log marks completed completes (task.complete; its dependencies and children must be done, else INVALID_INPUT " +
    "naming them), and an overdue or completed task keeps its status. Each project it logs time on takes its " +
    "actual time, dates and totals again, and its percent complete, which completes an open project at 100 " +
    "(project.complete).",
  [ts.submit, tk.start, tk.complete, pr.complete],
);

export const rpc_projects_timesheets_cancel = rollStep(
  "cancel",
  "Cancel a draft or submitted timesheet, taking its hours back out",
  "A draft or a submitted timesheet is cancelled (timesheet.cancel) and kept, as Frappe never deletes a document " +
    "here. One billed in part or in full, paid by a salary slip, completed or already cancelled is WRONG_STATE, naming " +
    "its status: what billed or paid it is cancelled first. A submitted one's hours leave its tasks and projects in the " +
    "same write: their actual time, dates and totals are worked out again, and each task's status is read again from " +
    "its remaining submitted logs, as ERPNext's `get_task_status` reads them: a working or pending-review task left " +
    "with no submitted time is open again (task.stop), and a pending-review one with some left is working (task.start); " +
    "an overdue task stays overdue (its timer would put it back at once), and a completed or cancelled task keeps its " +
    "status, as `get_task_status` never reopens one.",
  [ts.cancel, tk.stop, tk.start],
);
