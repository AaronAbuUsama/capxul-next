// The projects concept's tables, state machines and each machine's one event (P7), in the shape of
// ERPNext's Projects module (erpnext/projects/doctype, read at /tmp/erpnext): Project with its
// Project User rows, Task with its Task Depends On rows, Timesheet with its Timesheet Detail rows,
// Activity Type, Project Type and the single Projects Settings. Each row carries a Capxul id beside
// the name a connected head gives it, and every write appends one row to the Organization's
// gap-free change log, which the head sync follows (projects.change-log).
//
// Ids: `prj_<ulid>`, `tsk_<ulid>`, `ts_<ulid>`. Instants are epoch milliseconds (UTC); a Frappe Date
// is `YYYY-MM-DD` and a Frappe Datetime is an instant, read in the Organization's time zone
// (organizations.time_zone). Amounts, rates, hours and percentages are exact decimal strings in the
// Organization's default currency, never floats (projects.amounts). Every table is the
// Organization's (tenancy organization, `org_id` first in every key and index).

import { Schema } from "effect";
import { defineEvent, defineMachine, defineTable } from "../../../packages/book/src/index.ts";
import { concept_projects } from "../shared/foundation.ts";

const FRAPPE = "/tmp/erpnext/erpnext/projects/doctype";

const S = Schema.String;
const N = Schema.Number;
const B = Schema.Boolean;
const NullOr = Schema.NullOr;

/** An exact decimal, as Frappe shows a Currency, Float or Percent field at its precision: `"1250.00"`, `"1.5"`. */
const Decimal = S;
/** A Frappe Date: a calendar day in the Organization's time zone. */
const Day = S;

const KEPT = "Kept for the life of the Organization: projects are business records, cancelled but never deleted.";

/** What every synced row carries for the head: its name there, and the version of its last change here. */
const Synced = {
  /**
   * The live head's name for it (`PROJ-0001`, `TASK-2026-00001`, `TS-2026-00001`); null until a head has it. Names are
   * per site, so a new connection's sync clears every row's before its first push (projects.ids-and-names).
   */
  head_name: NullOr(S),
  /** The `seq` of its latest change in project-changes: the version a head's edit is based on. */
  version: N,
};

/** The priority Frappe gives a project; a task adds `urgent`. */
export const ProjectPriority = Schema.Literals(["low", "medium", "high"]);
export const TaskPriority = Schema.Literals(["low", "medium", "high", "urgent"]);

// ── settings and fixtures ───────────────────────────────────────────────────────────────────

export const table_project_settings = defineTable({
  id: "project-settings",
  title: "Projects Settings, one row per Organization",
  about:
    "Frappe's single Projects Settings for the Organization, born by projects' start-up when the Organization begins " +
    "(projects.startup): whether time logs may overlap for one user or one employee, and whether a sales invoice fetches " +
    "timesheets. It also holds the Organization's change counter: every write to a projects table takes the next `seq` " +
    "here, under this row's lock, so the change log has no gap and commits in order (projects.change-log).",
  was: [`${FRAPPE}/projects_settings/projects_settings.json`],
  concept: concept_projects,
  tenancy: "organization",
  tenantField: "org_id",
  fields: Schema.Struct({
    org_id: S,
    ignore_user_time_overlap: B,
    ignore_employee_time_overlap: B,
    fetch_timesheet_in_sales_invoice: B,
    /** The last `seq` taken: the Organization's projects change counter. */
    last_seq: N,
    created_at: N,
    updated_at: N,
  }),
  key: ["org_id"],
  indexes: [],
  retention: KEPT,
});

export const table_activity_types = defineTable({
  id: "activity-types",
  title: "Activity Types: the kinds of work time is logged against",
  about:
    "Frappe's Activity Type, named by its title, with the default costing and billing rates per hour. Start-up creates " +
    "ERPNext's five (Planning, Research, Proposal Writing, Execution, Communication); a disabled one takes no new logs. " +
    "Its name is its title on the head too (Frappe's `field:activity_type`), so a push adopts the head's type of the " +
    "same name, which its setup wizard made, instead of failing on a duplicate (projects.ids-and-names).",
  was: [`${FRAPPE}/activity_type/activity_type.json`, "/tmp/erpnext/erpnext/setup/setup_wizard/operations/install_fixtures.py:270"],
  concept: concept_projects,
  tenancy: "organization",
  tenantField: "org_id",
  fields: Schema.Struct({
    org_id: S,
    activity_type: S,
    costing_rate: Decimal,
    billing_rate: Decimal,
    disabled: B,
    ...Synced,
    created_at: N,
    updated_at: N,
  }),
  key: ["org_id", "activity_type"],
  indexes: [],
  retention: KEPT,
});

export const table_project_types = defineTable({
  id: "project-types",
  title: "Project Types",
  about:
    "Frappe's Project Type, named by its title. Start-up creates ERPNext's three: Internal, External and Other. A push " +
    "adopts the head's type of the same name rather than making a second (projects.ids-and-names).",
  was: [`${FRAPPE}/project_type/project_type.json`, "/tmp/erpnext/erpnext/setup/setup_wizard/operations/install_fixtures.py:309"],
  concept: concept_projects,
  tenancy: "organization",
  tenantField: "org_id",
  fields: Schema.Struct({ org_id: S, project_type: S, description: NullOr(S), ...Synced, created_at: N, updated_at: N }),
  key: ["org_id", "project_type"],
  indexes: [],
  retention: KEPT,
});

// ── projects ────────────────────────────────────────────────────────────────────────────────

export const table_projects = defineTable({
  id: "projects",
  title: "Projects",
  about:
    "Frappe's Project for the Organization (its Company): name, status, type, priority, expected and actual dates, how " +
    "its percent complete is worked out (by hand, or from its tasks' completion, progress or weight), its customer (a " +
    "Party: the CRM's customer in the global directory), its costing and billable totals and notes. The totals and the " +
    "actual dates and time are derived from its submitted timesheets and its tasks, never typed (projects.derived). " +
    "Frappe's totals that come from documents above projects (`total_billed_amount` from Sales Invoices, " +
    "`total_sales_amount` from Sales Orders, `total_purchase_cost`, the consumed material cost and the gross margin) are " +
    "not held: projects cannot read those documents, so the concepts that own them, or a head, work them out " +
    "(projects.doctypes). " +
    "`department` and `cost_center` are names the head's HR and accounting give; they are kept as Frappe keeps a link and " +
    "checked by the concept that owns them when it reads them. Sales orders and the project-update emails are not kept " +
    "(projects.doctypes).",
  was: [`${FRAPPE}/project/project.json`, `${FRAPPE}/project/project.py:267`],
  concept: concept_projects,
  tenancy: "organization",
  tenantField: "org_id",
  fields: Schema.Struct({
    org_id: S,
    project_id: S,
    project_name: S,
    status: Schema.Literals(["open", "on_hold", "completed", "cancelled"]),
    is_active: B,
    project_type: NullOr(S),
    priority: NullOr(ProjectPriority),
    percent_complete_method: Schema.Literals(["manual", "task_completion", "task_progress", "task_weight"]),
    percent_complete: Decimal,
    expected_start_date: NullOr(Day),
    expected_end_date: NullOr(Day),
    actual_start_date: NullOr(Day),
    actual_end_date: NullOr(Day),
    /** Hours logged on its submitted timesheets. */
    actual_time: Decimal,
    /** The customer's Party (parties); null for an internal project. */
    customer_party_id: NullOr(S),
    department: NullOr(S),
    cost_center: NullOr(S),
    estimated_costing: Decimal,
    total_costing_amount: Decimal,
    total_billable_amount: Decimal,
    notes: NullOr(S),
    /** The principal who created it: a member, the FDE, or the head's user it came from. */
    created_by: S,
    ...Synced,
    created_at: N,
    updated_at: N,
  }),
  key: ["org_id", "project_id"],
  indexes: [
    {
      name: "by_org_status_created",
      fields: ["org_id", "status", "created_at", "project_id"],
      for: "The Organization's projects by status, newest first: the project list.",
    },
    {
      name: "by_org_head_name",
      fields: ["org_id", "head_name"],
      unique: true,
      for: "The project a head's change names by its head name, when it carries no capxul_id yet.",
    },
  ],
  retention: KEPT,
});

export const table_project_users = defineTable({
  id: "project-users",
  title: "Project Users: who a project is shared with",
  about:
    "Frappe's Project User rows of a project: each is a member (a Seat, by its Party) the project is shared with, " +
    "whether they see its attachments and whether its timesheets are hidden from them. A head's User for a member is the " +
    "member's mailbox; a head user who is no member (a customer's portal user) is not a project user here, and the push " +
    "never removes one from the head: it writes the rows Capxul holds and the Capxul app keeps the head's other rows, " +
    "merging Project User rows by user.",
  was: [`${FRAPPE}/project_user/project_user.json`],
  concept: concept_projects,
  tenancy: "organization",
  tenantField: "org_id",
  fields: Schema.Struct({
    org_id: S,
    project_id: S,
    party_id: S,
    view_attachments: B,
    hide_timesheets: B,
    created_at: N,
  }),
  key: ["org_id", "project_id", "party_id"],
  indexes: [
    { name: "by_org_party", fields: ["org_id", "party_id", "project_id"], for: "The projects shared with one member." },
  ],
  retention: KEPT,
});

// ── tasks ───────────────────────────────────────────────────────────────────────────────────

export const table_tasks = defineTable({
  id: "tasks",
  title: "Tasks",
  about:
    "Frappe's Task: a subject, its project (or none), its parent task when it sits under a group task, the tasks it " +
    "depends on (Frappe's Task Depends On rows, kept as their ids in order), status, priority, its type's name, expected " +
    "start and end, expected time and weight, progress, whether it is a milestone or a template, actual dates and time " +
    "from submitted timesheets, its costing and billing totals, review and closing dates, and who completed it and when. " +
    "Frappe's nested-set columns (lft, rgt, old_parent) are not kept: the tree is its parent links. A task's expected end " +
    "is its own process's timer (projects.overdue-timer).",
  was: [`${FRAPPE}/task/task.json`, `${FRAPPE}/task/task.py:183`, `${FRAPPE}/task_depends_on/task_depends_on.json`],
  concept: concept_projects,
  tenancy: "organization",
  tenantField: "org_id",
  fields: Schema.Struct({
    org_id: S,
    task_id: S,
    subject: S,
    project_id: NullOr(S),
    parent_task_id: NullOr(S),
    is_group: B,
    is_template: B,
    is_milestone: B,
    depends_on: Schema.Array(S),
    status: Schema.Literals(["open", "working", "pending_review", "overdue", "template", "completed", "cancelled"]),
    priority: NullOr(TaskPriority),
    task_type: NullOr(S),
    exp_start_date: NullOr(N),
    exp_end_date: NullOr(N),
    expected_time: Decimal,
    task_weight: Decimal,
    progress: Decimal,
    act_start_date: NullOr(Day),
    act_end_date: NullOr(Day),
    actual_time: Decimal,
    total_costing_amount: Decimal,
    total_billing_amount: Decimal,
    review_date: NullOr(Day),
    closing_date: NullOr(Day),
    description: NullOr(S),
    /** The member (by Party) who completed it, and the day. */
    completed_by_party_id: NullOr(S),
    completed_on: NullOr(Day),
    created_by: S,
    ...Synced,
    created_at: N,
    updated_at: N,
  }),
  key: ["org_id", "task_id"],
  indexes: [
    {
      name: "by_org_project_status",
      fields: ["org_id", "project_id", "status", "task_id"],
      for: "A project's tasks by status: its percent complete, and whether every task is done before it completes.",
    },
    {
      name: "by_org_parent",
      fields: ["org_id", "parent_task_id", "task_id"],
      for: "A group task's children: a parent completes only when they have.",
    },
    {
      name: "by_org_head_name",
      fields: ["org_id", "head_name"],
      unique: true,
      for: "The task a head's change names by its head name, when it carries no capxul_id yet.",
    },
  ],
  retention: KEPT,
});

// ── timesheets ──────────────────────────────────────────────────────────────────────────────

export const table_timesheets = defineTable({
  id: "timesheets",
  title: "Timesheets",
  about:
    "Frappe's Timesheet as Frappe HR extends it (every head runs Frappe HR, so its EmployeeTimesheet and the `salary_slip` " +
    "Custom Field it adds are the shape): a submittable document of whose time it is (the worker's Party: a member's, or " +
    "an employee's or contractor's in the directory, who need no Seat; and their Employee's name once payroll keeps one), " +
    "its project and customer, its start and end days (from its logs), its hours and its costing, billable and billed " +
    "totals with the share billed, its currency and rate to the Organization's, a note, the salary slip that paid it and " +
    "the timesheet it amends. Its status follows Frappe HR's `set_status`: from docstatus (draft, submitted, cancelled), " +
    "then billed or partially billed by the share billed, payslip once a salary slip names it (whatever is billed), and " +
    "completed when both its own sales-invoice link and a salary slip are set. A request that bills its hours marks " +
    "them through this concept's door, `projects.bill-time`, in its own transaction; paying them is a salary slip's " +
    "(projects.billing-and-payslips).",
  was: [
    `${FRAPPE}/timesheet/timesheet.json`,
    `${FRAPPE}/timesheet/timesheet.py:141`,
    "/tmp/hrms/hrms/overrides/employee_timesheet.py:10",
    "/tmp/hrms/hrms/setup.py:411",
  ],
  concept: concept_projects,
  tenancy: "organization",
  tenantField: "org_id",
  fields: Schema.Struct({
    org_id: S,
    timesheet_id: S,
    title: NullOr(S),
    status: Schema.Literals(["draft", "submitted", "partially_billed", "billed", "payslip", "completed", "cancelled"]),
    /** Frappe's docstatus: 0 draft, 1 submitted, 2 cancelled. */
    docstatus: Schema.Literals([0, 1, 2]),
    /** The worker's Party: a member's, or an employee's or contractor's in the directory (no Seat needed). */
    party_id: S,
    employee: NullOr(S),
    parent_project_id: NullOr(S),
    customer_party_id: NullOr(S),
    start_date: NullOr(Day),
    end_date: NullOr(Day),
    total_hours: Decimal,
    total_billable_hours: Decimal,
    total_billed_hours: Decimal,
    total_costing_amount: Decimal,
    total_billable_amount: Decimal,
    total_billed_amount: Decimal,
    per_billed: Decimal,
    currency: S,
    exchange_rate: Decimal,
    /** ERPNext's own link to a sales invoice for the whole timesheet (legacy: today's billing marks each log instead). */
    sales_invoice: NullOr(S),
    /** Frappe HR's Custom Field: the salary slip that paid its hours (a head's Salary Slip name, or later payroll's id). */
    salary_slip: NullOr(S),
    note: NullOr(S),
    amended_from_id: NullOr(S),
    created_by: S,
    ...Synced,
    created_at: N,
    updated_at: N,
  }),
  key: ["org_id", "timesheet_id"],
  indexes: [
    {
      name: "by_org_party_start",
      fields: ["org_id", "party_id", "start_date", "timesheet_id"],
      for: "One worker's timesheets by day, and the overlap check of a new log against their others.",
    },
    {
      name: "by_org_project_status",
      fields: ["org_id", "parent_project_id", "status", "timesheet_id"],
      for: "A project's submitted timesheets, whose hours and amounts make its totals.",
    },
    {
      name: "by_org_head_name",
      fields: ["org_id", "head_name"],
      unique: true,
      for: "The timesheet a head's change names by its head name, when it carries no capxul_id yet.",
    },
  ],
  retention: KEPT,
});

export const table_timesheet_logs = defineTable({
  id: "timesheet-logs",
  title: "Timesheet Details: one time log each",
  about:
    "Frappe's Timesheet Detail rows of a timesheet, in order: activity type, from and to, hours and expected hours, " +
    "whether the work is completed, the project and task it was for, whether it is billable, the billing hours, rate and " +
    "amount, the costing rate and amount, and the sales invoice that billed it: a request's id when Capxul billed it " +
    "(`projects.bill-time`), or the head's Sales Invoice name when a head did. A log is written with its timesheet, in " +
    "the same transaction, or by that door. A submitted timesheet's logs never change except `sales_invoice` and the " +
    "`billing_amount` the invoice asked, Frappe's fields allowed on submit: a log is billed once, and its link is " +
    "cleared only when that invoice is cancelled or declined.",
  was: [
    `${FRAPPE}/timesheet_detail/timesheet_detail.json`,
    "/tmp/erpnext/erpnext/accounts/doctype/sales_invoice/services/timesheet_billing.py:19",
  ],
  concept: concept_projects,
  tenancy: "organization",
  tenantField: "org_id",
  fields: Schema.Struct({
    org_id: S,
    timesheet_id: S,
    idx: N,
    activity_type: NullOr(S),
    from_time: N,
    to_time: N,
    hours: Decimal,
    expected_hours: Decimal,
    completed: B,
    project_id: NullOr(S),
    task_id: NullOr(S),
    is_billable: B,
    billing_hours: Decimal,
    billing_rate: Decimal,
    billing_amount: Decimal,
    costing_rate: Decimal,
    costing_amount: Decimal,
    sales_invoice: NullOr(S),
    description: NullOr(S),
  }),
  key: ["org_id", "timesheet_id", "idx"],
  indexes: [
    {
      name: "by_org_task",
      fields: ["org_id", "task_id", "timesheet_id"],
      for: "A task's logs, whose submitted hours and amounts make its actual time and totals.",
    },
    {
      name: "by_org_project",
      fields: ["org_id", "project_id", "timesheet_id"],
      for: "A project's logs across timesheets.",
    },
  ],
  retention: KEPT,
});

// ── the change log the head sync follows ────────────────────────────────────────────────────

export const table_project_changes = defineTable({
  id: "project-changes",
  title: "Projects change log: every write, in commit order",
  about:
    "One row per change to a projects record (an activity type, project type, project, task or timesheet, with its " +
    "users or logs), appended in the writing transaction with the next `seq` from the Organization's counter " +
    "(project-settings, under its lock), so a later `seq` never commits before an earlier one and a reader paging by " +
    "`seq` skips nothing. The changed row keeps that `seq` as its `version`. A head's sync pushes from it in order, and " +
    "a change that came from the head notes it (`origin` head), so the push only confirms its version there. It holds " +
    "ids, not content: the push reads each row as it stands (projects.change-log).",
  concept: concept_projects,
  tenancy: "organization",
  tenantField: "org_id",
  fields: Schema.Struct({
    org_id: S,
    seq: N,
    doctype: Schema.Literals(["Activity Type", "Project Type", "Project", "Task", "Timesheet"]),
    doc_id: S,
    origin: Schema.Literals(["capxul", "head"]),
    /** The principal whose command made it, or the head user (by mailbox) whose edit was applied. */
    by: S,
    at: N,
  }),
  key: ["org_id", "seq"],
  indexes: [],
  retention: "Kept for good: it is the order every head of the Organization replays.",
});

export const table_project_head_syncs = defineTable({
  id: "project-head-syncs",
  title: "Projects' sync with one head",
  about:
    "One row per head connection the projects concept syncs with: how far it has pushed the change log (`pushed_seq`), " +
    "how far it has read the head's own changes (`pulled_change`), when each last ran, and the conflicts it resolved " +
    "(a head edit based on an older version, which Capxul's version overwrote). Its process (`projects.head.sync`) is " +
    "the only writer.",
  concept: concept_projects,
  tenancy: "organization",
  tenantField: "org_id",
  fields: Schema.Struct({
    org_id: S,
    head_id: S,
    pushed_seq: N,
    pulled_change: NullOr(S),
    pushed_at: NullOr(N),
    pulled_at: NullOr(N),
    conflicts: N,
    refused: N,
    created_at: N,
    updated_at: N,
  }),
  key: ["org_id", "head_id"],
  indexes: [],
  retention: KEPT,
});

// ── state machines and their events (P7: one event per machine, defined just above it) ────

const From = NullOr(S);

export const event_project_transitioned = defineEvent({
  id: "project_transitioned",
  about: "A project was opened, held, resumed, completed, reopened or cancelled.",
  props: Schema.Struct({ from: From, to: S, transition: S, org_id: S, project_id: S }),
});

export const machine_project = defineMachine({
  id: "project",
  title: "Project status",
  about:
    "projects.status, as Frappe's Project has it (Open, On hold, Completed, Cancelled). A project completes when its " +
    "percent complete reaches 100 (every task completed or cancelled, or by hand with no tasks), and a task reopened " +
    "under it opens it again, as Frappe's `update_percent_complete` does; on hold and cancelled are set by hand and kept.",
  was: [`${FRAPPE}/project/project.py:267`, `${FRAPPE}/project/project.py:305`],
  table: table_projects,
  field: "status",
  initial: "open",
  states: [
    { id: "open", about: "Work goes on." },
    { id: "on_hold", about: "Paused by hand; its percent complete no longer moves its status." },
    { id: "completed", about: "Percent complete is 100." },
    { id: "cancelled", about: "Stopped by hand; kept." },
  ],
  transitions: {
    open: { from: [], to: "open", about: "Birth.", emits: [event_project_transitioned] },
    hold: { from: ["open"], to: "on_hold", about: "Put on hold.", emits: [event_project_transitioned] },
    resume: { from: ["on_hold"], to: "open", about: "Taken off hold.", emits: [event_project_transitioned] },
    complete: {
      from: ["open"],
      to: "completed",
      about: "Its percent complete reached 100.",
      guard: "Every task under it is completed or cancelled, or it has none.",
      emits: [event_project_transitioned],
    },
    reopen: {
      from: ["completed", "cancelled"],
      to: "open",
      about: "A task under it reopened, or it was opened again by hand.",
      emits: [event_project_transitioned],
    },
    cancel: { from: ["open", "on_hold"], to: "cancelled", about: "Cancelled by hand.", emits: [event_project_transitioned] },
  },
});

export const event_task_transitioned = defineEvent({
  id: "task_transitioned",
  about: "A task was opened, started, sent for review, fell overdue, recovered, completed, reopened or cancelled.",
  props: Schema.Struct({ from: From, to: S, transition: S, org_id: S, task_id: S, project_id: NullOr(S) }),
});

export const machine_task = defineMachine({
  id: "task",
  title: "Task status",
  about:
    "tasks.status, as Frappe's Task has it. A task is working once a submitted timesheet logs time against it or it is " +
    "started by hand, and open again when the last such timesheet is cancelled (ERPNext's `get_task_status`, which also " +
    "puts a pending review back to working; an overdue task stays overdue, since its timer would put it back at once); " +
    "pending review when sent for review; overdue when its expected end passes unfinished (its own timer, not Frappe's " +
    "daily `set_tasks_as_overdue`), and back to open or working when its expected end moves later. A submitted log " +
    "marked completed completes it. It completes only when every task it depends on is completed or cancelled, and a " +
    "group task only when its children have. A template is born a template and stays one.",
  was: [`${FRAPPE}/task/task.py:183`, `${FRAPPE}/task/task.py:532`, `${FRAPPE}/timesheet/timesheet.py:324`],
  table: table_tasks,
  field: "status",
  initial: "open",
  states: [
    { id: "open", about: "Not started." },
    { id: "working", about: "Time is logged, or it was started." },
    { id: "pending_review", about: "Done by its worker; waiting for review by its review date." },
    { id: "overdue", about: "Its expected end passed before it was completed." },
    { id: "template", about: "A template task, copied into projects; never worked.", terminal: true },
    { id: "completed", about: "Completed: who and when are recorded." },
    { id: "cancelled", about: "Cancelled; counts as done for its project and its dependants." },
  ],
  transitions: {
    open: { from: [], to: "open", about: "Birth.", emits: [event_task_transitioned] },
    template: { from: [], to: "template", about: "Birth of a template task.", emits: [event_task_transitioned] },
    start: {
      from: ["open", "pending_review"],
      to: "working",
      about: "A submitted timesheet logged time against it, or it was started by hand.",
      emits: [event_task_transitioned],
    },
    stop: {
      from: ["working"],
      to: "open",
      about: "The last submitted timesheet that logged time against it was cancelled: no submitted time is left.",
      emits: [event_task_transitioned],
    },
    review: {
      from: ["open", "working", "overdue"],
      to: "pending_review",
      about: "Sent for review, with a review date.",
      emits: [event_task_transitioned],
    },
    fall_overdue: {
      from: ["open", "working", "pending_review"],
      to: "overdue",
      about:
        "Its own timer: the end of its expected end's day in the Organization's time zone passed (a pending review: and " +
        "the end of its review date's day too).",
      emits: [event_task_transitioned],
    },
    recover_open: {
      from: ["overdue"],
      to: "open",
      about: "Its expected end moved later and no time is logged.",
      emits: [event_task_transitioned],
    },
    recover_working: {
      from: ["overdue"],
      to: "working",
      about: "Its expected end moved later and time is logged.",
      emits: [event_task_transitioned],
    },
    complete: {
      from: ["open", "working", "pending_review", "overdue"],
      to: "completed",
      about: "Completed by hand, or by a submitted log marked completed: progress 100, completed_by and completed_on recorded.",
      guard: "Every task it depends on, and for a group task every child, is completed or cancelled.",
      emits: [event_task_transitioned],
    },
    reopen: {
      from: ["completed", "cancelled"],
      to: "open",
      about: "Opened again: its completion is cleared, and its project reopens if it had completed.",
      emits: [event_task_transitioned],
    },
    cancel: {
      from: ["open", "working", "pending_review", "overdue"],
      to: "cancelled",
      about: "Cancelled.",
      emits: [event_task_transitioned],
    },
  },
});

export const event_timesheet_transitioned = defineEvent({
  id: "timesheet_transitioned",
  about: "A timesheet was drafted, submitted, billed in part or in full, paid by a payslip, completed or cancelled.",
  props: Schema.Struct({ from: From, to: S, transition: S, org_id: S, timesheet_id: S, party_id: S }),
});

export const machine_timesheet = defineMachine({
  id: "timesheet",
  title: "Timesheet status",
  about:
    "timesheets.status, as Frappe HR's `set_status` works it out: draft and submitted from docstatus; billed in part or " +
    "in full by the share of its billable amount sales invoices took; payslip once a salary slip names it, whatever is " +
    "billed (billing a paid timesheet moves its totals, not its status); completed when its own sales-invoice link and " +
    "its salary slip are both set; cancelled from docstatus 2, which a draft reaches too here, because Capxul never " +
    "deletes a document. Submitting rolls its hours and amounts into its tasks and project. A log is billed once and a " +
    "timesheet paid once, whichever side's document does it (projects.billing-and-payslips).",
  was: [`${FRAPPE}/timesheet/timesheet.py:141`, `${FRAPPE}/timesheet/timesheet.py:171`, "/tmp/hrms/hrms/overrides/employee_timesheet.py:10"],
  table: table_timesheets,
  field: "status",
  initial: "draft",
  states: [
    { id: "draft", about: "Being filled in: docstatus 0." },
    { id: "submitted", about: "Submitted: docstatus 1; its logs no longer change." },
    { id: "partially_billed", about: "Part of its billable amount is on a sales invoice." },
    { id: "billed", about: "All of its billable amount is on sales invoices." },
    { id: "payslip", about: "A salary slip paid its hours; billing it further changes its totals only." },
    { id: "completed", about: "Its own sales-invoice link and its salary slip are both set (Frappe HR)." },
    { id: "cancelled", about: "docstatus 2: undone, its hours taken back out of its tasks and project.", terminal: true },
  ],
  transitions: {
    draft: { from: [], to: "draft", about: "Birth.", emits: [event_timesheet_transitioned] },
    submit: {
      from: ["draft"],
      to: "submitted",
      about: "Submitted: every log has from and to, hours above zero, and an activity type when an employee is named.",
      emits: [event_timesheet_transitioned],
    },
    bill_part: {
      from: ["submitted", "partially_billed", "billed"],
      to: "partially_billed",
      about: "A sales invoice took part of its billable amount, or one that took it all was cancelled in part.",
      guard: "No salary slip names it, and each log the invoice takes has no sales invoice yet: a log is billed once.",
      emits: [event_timesheet_transitioned],
    },
    bill: {
      from: ["submitted", "partially_billed"],
      to: "billed",
      about: "Its billable amount is all invoiced.",
      guard: "No salary slip names it, and each log the invoice takes has no sales invoice yet: a log is billed once.",
      emits: [event_timesheet_transitioned],
    },
    unbill: {
      from: ["partially_billed", "billed"],
      to: "submitted",
      about: "The sales invoices that billed it were cancelled: their links leave its logs.",
      emits: [event_timesheet_transitioned],
    },
    pay: {
      from: ["submitted", "partially_billed", "billed"],
      to: "payslip",
      about: "A salary slip paid its hours (Frappe HR names the slip on it).",
      guard: "No salary slip names it yet: a timesheet is paid once.",
      emits: [event_timesheet_transitioned],
    },
    unpay: {
      from: ["payslip", "completed"],
      to: "submitted",
      about:
        "The salary slip that paid it was cancelled; when part or all of it is billed, bill_part or bill follows in the " +
        "same write, as Frappe HR's set_status recomputes it.",
      emits: [event_timesheet_transitioned],
    },
    complete: {
      from: ["payslip"],
      to: "completed",
      about: "Its own sales-invoice link is set while a salary slip names it (Frappe HR's set_status).",
      emits: [event_timesheet_transitioned],
    },
    uncomplete: {
      from: ["completed"],
      to: "payslip",
      about: "The invoice that completed it was cancelled or declined: its link leaves it, and the salary slip still names it.",
      emits: [event_timesheet_transitioned],
    },
    cancel: {
      from: ["draft", "submitted"],
      to: "cancelled",
      about: "Cancelled: a submitted one's hours leave its tasks and project.",
      guard: "Nothing of it is billed or paid.",
      emits: [event_timesheet_transitioned],
    },
  },
});
