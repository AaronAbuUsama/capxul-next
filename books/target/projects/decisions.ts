// The projects concept's own judgments (CONVENTIONS rule 10). Made by Claude on 8 November 2026
// under Aaron's rulings aaron.projects, aaron.frappe-shape, aaron.erp-on-capxul and
// aaron.frappe-head, with ERPNext's Projects module (frappe/erpnext, cloned at /tmp/erpnext) and
// docs/vision/erp.md as evidence. The old system had no projects, so nothing here replaces old code.
// Aaron accepted the two that were his, the commands (a decision pack) and who may use them, on
// 8 November 2026; the commands are now booked (operations.ts), and the judgments made in booking
// them follow the pack.

import { defineDecision } from "../../../packages/book/src/index.ts";
import {
  concept_books,
  concept_organizations,
  concept_parties,
  concept_payroll,
  concept_projects,
  concept_requests,
} from "../shared/foundation.ts";
import { integration_frappe_head } from "../shared/external.ts";
import {
  machine_project,
  machine_task,
  machine_timesheet,
  table_activity_types,
  table_project_changes,
  table_project_head_syncs,
  table_project_settings,
  table_project_types,
  table_project_users,
  table_projects,
  table_tasks,
  table_timesheet_logs,
  table_timesheets,
} from "./data.ts";
import { workflow_projects_head_sync, workflow_projects_startup_open, workflow_projects_tasks_watch_due } from "./processes.ts";
import { procedure_projects_bill_time } from "./procedures.ts";
import {
  CRITICAL,
  OPERATIONS,
  operation_org_projects_change,
  operation_org_projects_complete,
  operation_org_projects_create,
  operation_org_projects_reopen,
  operation_org_projects_resume,
  operation_org_projects_settings_set,
  operation_org_projects_task_change,
  operation_org_projects_task_create,
  operation_org_projects_task_review,
  operation_org_projects_timesheet_cancel,
  operation_org_projects_timesheet_log,
  operation_org_projects_timesheet_submit,
} from "./operations.ts";
import { rpc_projects_tasks_change, rpc_projects_tasks_create, rpc_projects_tasks_review } from "./tasks.ts";
import {
  rpc_projects_projects_cancel,
  rpc_projects_projects_change,
  rpc_projects_projects_complete,
  rpc_projects_projects_create,
  rpc_projects_projects_hold,
  rpc_projects_projects_list,
  rpc_projects_projects_reopen,
  rpc_projects_projects_resume,
} from "./projects.ts";
import { rpc_projects_members_add, rpc_projects_members_remove } from "./members.ts";
import { rpc_projects_settings_set, rpc_projects_settings_show } from "./settings.ts";
import {
  rpc_projects_timesheets_cancel,
  rpc_projects_timesheets_create,
  rpc_projects_timesheets_list,
  rpc_projects_timesheets_log,
  rpc_projects_timesheets_submit,
} from "./timesheets.ts";
import {
  rpc_projects_activity_types_add,
  rpc_projects_activity_types_change,
  rpc_projects_activity_types_disable,
  rpc_projects_activity_types_enable,
} from "./activity-types.ts";
import { rpc_projects_project_types_add } from "./project-types.ts";

const CLAUDE = "Claude, projects design, 8 November 2026";
const by = (evidence: string) => `${CLAUDE}; evidence: ${evidence}`;
const DT = "erpnext/projects/doctype";

const TABLES = [
  table_project_settings, table_activity_types, table_project_types, table_projects, table_project_users, table_tasks,
  table_timesheets, table_timesheet_logs,
];

export const decision_projects_doctypes = defineDecision({
  id: "projects.doctypes",
  title: "Nine of ERPNext's fifteen Projects DocTypes; the rest wait for a need",
  question: "The projects ruling asks for projects, tasks and timesheets, 'or what the real doctypes show'. Which of ERPNext's Projects DocTypes does Capxul hold natively?",
  options: [
    {
      label: "working-set",
      text:
        "Project with Project User, Task with Task Depends On, Timesheet with Timesheet Detail, Activity Type, Project " +
        "Type and Projects Settings: what a business needs to plan work, log time and see a project's cost. Left for later " +
        "or for a head: Project Template and its tasks, Project Update (status emails), Activity Cost (per-employee rates), " +
        "Task Type, the legacy Dependent Task, and Project's sales-order link, reminder schedule and holiday list, and its " +
        "totals worked out from documents above projects (billed amount, sales amount, purchase and material cost, gross " +
        "margin). Timesheet keeps Frappe HR's `salary_slip` field, since every head runs Frappe HR.",
    },
    { label: "all-fifteen", text: "Every DocType of the module, field for field." },
    { label: "three", text: "Only Project, Task and Timesheet, with their child tables." },
  ],
  chosen: "working-set",
  why:
    "Nine of the fifteen DocTypes in erpnext/projects/doctype are held; six (Project Template and Project Template " +
    "Task, Project Update, Activity Cost, Task Type, Dependent Task) wait. The fifteen include three child tables (Project User, Task Depends On, " +
    "Timesheet Detail) without which the three main ones are not Frappe's shape, two naming lists the setup wizard fills " +
    "(Activity Type, Project Type) and one single (Projects Settings) that the timesheet's overlap check reads. Templates, " +
    "update emails and per-employee rates depend on HR's Employee and on mail Capxul's notices own, and no ruling asks " +
    "for them yet; a connected head still has them, and nothing here stops adding them as DocTypes later. Frappe's " +
    "nested-set columns on Task (lft, rgt, old_parent) are an index Frappe keeps for its tree views, not data, so the " +
    "tree is the parent links. `department` and `cost_center` stay names, as a Frappe Link holds them, because HR's " +
    "departments and accounting's cost centres sit above projects. A project's `total_billed_amount` is ERPNext's sum of " +
    "submitted Sales Invoice items for it (ProjectCostQueries.billed_amount), as its sales and purchase totals are of " +
    "orders and invoices; projects cannot read those, and holding a copy the head sends would be a second record of " +
    "money asked, so none of them is held. The timesheet's own billed totals stay: they are sums of its logs. With " +
    "Frappe HR installed, Timesheet is its EmployeeTimesheet, whose `salary_slip` Custom Field decides the payslip and " +
    "completed statuses.",
  source: by(`${DT} (fifteen folders, their JSON); ${DT}/project/costing/queries.py:63; hrms/setup.py:411; hrms/overrides/employee_timesheet.py`),
  affects: [...TABLES, concept_projects],
});

export const decision_projects_ids_and_names = defineDecision({
  id: "projects.ids-and-names",
  title: "Capxul ids, with the head's name beside them",
  question: "Frappe names a Project `PROJ-.####`, a Task `TASK-.YYYY.-.#####` and a Timesheet `TS-.YYYY.-` by naming series. What is a record's id here?",
  options: [
    { label: "capxul-id-and-head-name", text: "A Capxul id (`prj_`, `tsk_`, `ts_` and a ULID); the head's name is stored once a head has it, and the head stores the Capxul id in a Custom Field." },
    { label: "frappe-names", text: "Capxul runs Frappe's naming series itself and the head takes Capxul's names." },
  ],
  chosen: "capxul-id-and-head-name",
  why:
    "A naming series is a per-site counter: an Organization that connects a head after a year, or reconnects another, " +
    "would collide with names the head already gave, and a counter shared across Capxul's tenants is a cross-tenant " +
    "write. A Capxul id is unique without a site, and the head keeps its own naming series, so its users see the names " +
    "they expect (Habitat's sync adds its Capxul fields as Custom Fields in the same way). For the same reason a head " +
    "name is the live head's only: a new connection clears them before its first push, so an old site's names never " +
    "collide with the new one's. Activity Types and Project " +
    "Types are named by their title in Frappe (`autoname: field:...`), so their title is their key here too, and a " +
    "push adopts a head's type of the same name (its setup wizard made the same five and three) by stamping its " +
    "capxul_id, instead of inserting a duplicate Frappe would refuse. A command names a type by its title without " +
    "regard to case, as Frappe's names compare, so `research` finds Research and `add planning` is a duplicate.",
  source: by(`${DT}/project/project.json (naming_series PROJ-.####); ${DT}/task/task.json (autoname TASK-.YYYY.-.#####); ${DT}/activity_type/activity_type.json (field:activity_type)`),
  affects: [table_projects, table_tasks, table_timesheets, table_activity_types, table_project_types],
});

export const decision_projects_amounts = defineDecision({
  id: "projects.amounts",
  title: "Rates, amounts, hours and percentages are exact decimal strings",
  question: "Frappe's Currency, Float and Percent fields are floats at a precision. How are they held?",
  options: [
    { label: "decimal-strings", text: "Exact decimal strings in the Organization's default currency (`\"1250.00\"`, `\"1.5\"`), rounded as Frappe shows them at its precision." },
    { label: "floats", text: "Floats, as Frappe stores them." },
    { label: "raw-integers", text: "Integers of the smallest unit, as Capxul's on-chain amounts are." },
  ],
  chosen: "decimal-strings",
  why:
    "A project's totals are sums of rates times hours; floats drift, and a head would show a total Capxul did not. These " +
    "are business figures in the Company's currency, not token amounts, so the chain's raw integers with a token's " +
    "decimals do not fit them: a rate per hour of 37.50 has no token. The head receives the same strings and stores them " +
    "at its own precision, which matches.",
  source: by(`${DT}/timesheet_detail/timesheet_detail.json (Currency, Float); ${DT}/project/project.json (Percent)`),
  affects: [table_projects, table_tasks, table_timesheets, table_timesheet_logs, table_activity_types],
});

export const decision_projects_dates = defineDecision({
  id: "projects.dates",
  title: "A Frappe Date is a day in the Organization's zone; a Datetime is an instant",
  question: "Frappe keeps Date and Datetime fields in the site's time zone. How does Capxul, whose times are instants, keep them?",
  options: [
    { label: "days-and-instants", text: "A Date is `YYYY-MM-DD`, a day in the Organization's time zone (organizations.time_zone); a Datetime is an instant in UTC, shown in that zone." },
    { label: "all-instants", text: "Every date is an instant at the start of its day." },
  ],
  chosen: "days-and-instants",
  why:
    "A project's expected end is a day the business means, not an instant; turning it into midnight UTC would move it a " +
    "day for anyone west of Greenwich. A time log's from and to are moments, and a task's expected start and end are " +
    "Datetime fields in Frappe, so they stay instants. One zone for the Organization, shared with the head's System " +
    "Settings, is what makes both sides agree on which day an instant falls on (organizations.head-clock). A command " +
    "takes a task's Datetime as an instant or as a day, which the rpc reads as that day's 00:00 in the Organization's " +
    "zone, as Frappe stores a Datetime given only its date; the CLI cannot convert a day itself, since it does not " +
    "know the zone (projects review for fit, 8 November 2026).",
  source: by(`${DT}/project/project.json (expected_end_date Date); ${DT}/task/task.json (exp_end_date Datetime); ${DT}/timesheet_detail/timesheet_detail.json (from_time Datetime)`),
  affects: [table_projects, table_tasks, table_timesheets, table_timesheet_logs],
});

export const decision_projects_dependencies = defineDecision({
  id: "projects.dependencies",
  title: "Projects depends on access, parties and organizations, below money",
  question: "Where does the new projects concept sit in the concept map, and what may it read?",
  options: [
    {
      label: "low",
      text:
        "dependsOn access, parties, organizations; defined after agents and before budgets, so books (a project as an " +
        "accounting dimension), requests (an invoice from billable hours) and payroll (a salary slip from timesheets) can " +
        "each depend on it and read it.",
    },
    { label: "above-requests", text: "Above requests and payroll, so projects itself bills hours and follows the invoices." },
  ],
  chosen: "low",
  why:
    "In ERPNext the higher modules read projects: every GL Entry carries a project dimension, a Sales Invoice fetches " +
    "timesheets and marks them billed, and Frappe HR's salary slip marks them paid. Projects reads none of them back. " +
    "Placing it below lets the books, requests and payroll designs depend on it without a cycle; above them, books could " +
    "never tag a fact with a project. Projects needs the Organization (its Seats, its time zone and currency), parties " +
    "(a customer's Party, a member's Party) and access (a principal), nothing else. Its one door, `projects.bill-time`, " +
    "is how a request marks the hours it bills (projects.bill-time); paying hours through a salary slip will be a " +
    "second when payroll designs it (projects.billing-and-payslips).",
  source: by("/tmp/erpnext/erpnext/accounts/doctype/gl_entry/gl_entry.json (project); /tmp/hrms (salary slip timesheets); books/target/shared/foundation.ts"),
  affects: [concept_projects, concept_books, concept_requests, concept_payroll, concept_organizations, concept_parties],
});

export const decision_projects_startup = defineDecision({
  id: "projects.startup",
  title: "Start-up writes the settings and ERPNext's starting types, and no project",
  question: "The projects ruling: present in every organization from the start. What exists the moment an Organization begins?",
  options: [
    {
      label: "settings-and-fixtures",
      text:
        "Projects' own start-up process, triggered by the setup's `begin`, writes Projects Settings and ERPNext's five " +
        "Activity Types and three Project Types, as the setup wizard does. No project or task: those are the business's.",
    },
    { label: "sample-project", text: "Also a sample project with a few tasks, to show the shape." },
    { label: "on-first-use", text: "Nothing until the first project command." },
  ],
  chosen: "settings-and-fixtures",
  why:
    "It is what a fresh ERPNext site has after its setup wizard, so a head connected later finds the same starting " +
    "records, and a first time log has activity types to name. Starting at `begin`, not at ready, matches the ruling " +
    "that the apps are there whether or not the setup has finished or a head connects. Sample data would have to be " +
    "told apart from the business's own forever after, in the books and on the head. On first use would make the first " +
    "command also a start-up, and a head sync would find nothing to push. Organizations cannot write these rows " +
    "itself (P4): each fundamental app's concept starts itself from the setup's transition.",
  source: by("/tmp/erpnext/erpnext/setup/setup_wizard/operations/install_fixtures.py:270 and :309; books/target/shared/rulings.ts (aaron.projects)"),
  affects: [workflow_projects_startup_open, table_project_settings, table_activity_types, table_project_types],
});

export const decision_projects_change_log = defineDecision({
  id: "projects.change-log",
  title: "Every write takes a gap-free seq from the Organization's counter",
  question: "A head sync must push every change exactly once, in order. How does it find them?",
  options: [
    { label: "change-log", text: "`project-changes`: one row per write, with the next `seq` from the Organization's counter on its Projects Settings row, taken under that row's lock; the changed record keeps the seq as its version." },
    { label: "modified", text: "Push rows by their `updated_at`, as Frappe's own `modified` would be read." },
  ],
  chosen: "change-log",
  why:
    "A time column cannot promise exactly once: a write stamped at T can commit after a reader passed T (the same reason " +
    "activity keeps a gap-free change log, activity.change-log, and the vision's check C5). A seq taken under one row's " +
    "lock commits in order, so paging by it skips nothing and repeats nothing, and the same seq is the version a head's " +
    "edit names, which is how a conflict is seen. Projects writes are a person's or an agent's pace, so one lock per " +
    "Organization costs nothing. The same log is what an outside reader of projects would page, so it is not the head's alone.",
  source: by("books/target/activity/decisions.ts (activity.change-log); docs/vision/erp.md (check C5)"),
  affects: [table_project_changes, table_project_settings, workflow_projects_head_sync],
});

export const decision_projects_derived = defineDecision({
  id: "projects.derived",
  title: "Totals, actual time and percent complete are derived, unless typed by hand",
  question: "Frappe recomputes a task's actual time and a project's totals and percent complete when a timesheet is submitted or a task changes. Where here?",
  options: [
    { label: "derived-in-the-write", text: "In the same transaction as the write that changes them: a submitted or cancelled timesheet updates its tasks and project; a task's status or progress updates its project's percent complete and status. Only a project worked out by hand (Frappe's Manual) has its percent typed (projects.percent-by-hand)." },
    { label: "read-time", text: "Computed when read, never stored." },
  ],
  chosen: "derived-in-the-write",
  why:
    "Frappe stores them (actual_time, total_costing_amount, percent_complete) and its reports and the head read them as " +
    "stored, so a head's copy must match Capxul's at each version. Recomputing in the write keeps them one fact with what " +
    "caused them; a value the head sends for one is ignored, because the head computes it from rows it may not have in " +
    "full (its Activity Costs, its Employees). The rules are ERPNext's: percent complete by task completion, progress or " +
    "weight; a project completes at 100 and opens again below it, unless it is on hold, cancelled or worked out by " +
    "hand; a submitted timesheet makes its open or pending-review tasks working, or completes one its log marks " +
    "completed, and cancelling the last one makes a working or pending-review task open again (`get_task_status`).",
  source: by(`${DT}/project/project.py:267; ${DT}/timesheet/timesheet.py:186; ${DT}/timesheet/timesheet.py:324; ${DT}/task/task.py:332`),
  affects: [table_projects, table_tasks, machine_project, machine_task],
});

export const decision_projects_overdue_timer = defineDecision({
  id: "projects.overdue-timer",
  title: "A task falls overdue by its own timer, not by a daily sweep",
  question: "ERPNext marks tasks overdue in a daily scheduled job (`set_tasks_as_overdue`). What does Capxul do?",
  options: [
    { label: "own-timer", text: "One process per task waits until the end of its expected end's day in the Organization's time zone, and marks it overdue then if it is unfinished." },
    { label: "daily-cron", text: "A daily cron over every Organization's tasks, as ERPNext does." },
  ],
  chosen: "own-timer",
  why:
    "P3 keeps only its named crons; everything the old system swept for is a process's own timer or a chain event. A " +
    "timer is also what the one clock can stop at: a warp past a task's due day marks it overdue at that day's end, not " +
    "at whatever second a daily job ran (devnet.warp-barrier), and a simulated year is not a day of stops per " +
    "Organization. A pending review falls due only once its review day has begun too, as ERPNext's job skips one only " +
    "while its review date is still in the future (projects.review-day). A completed or cancelled task disarms its timer without ending it, because ERPNext lets " +
    "either be reopened.",
  source: by(`${DT}/task/task.py:483 and :532; /tmp/erpnext/erpnext/hooks.py:552 (daily); docs/decisions/policy-pack.md (P3)`),
  affects: [workflow_projects_tasks_watch_due, machine_task],
});

export const decision_projects_machines = defineDecision({
  id: "projects.machines",
  title: "Three machines with Frappe's statuses; a draft timesheet is cancelled",
  question: "Frappe's Project, Task and Timesheet statuses are Select fields a user can often set freely. What machines does Capxul keep?",
  options: [
    {
      label: "frappe-statuses-as-transitions",
      text:
        "One machine per status field, with Frappe's states, and a transition for each way ERPNext's code or its forms move " +
        "it. A draft timesheet is cancelled rather than deleted, and a task is reopened rather than edited back.",
    },
    { label: "free-select", text: "Plain columns any write may set, as a Select field." },
  ],
  chosen: "frappe-statuses-as-transitions",
  why:
    "Each status column is one state machine with one event (P7), and the guards are where ERPNext's rules live: a task " +
    "completes only when its dependencies have (`validate_status`), a project only at 100 percent " +
    "(`validate_completed_status`), a timesheet's status only from its docstatus, billing and salary slip (Frappe HR's " +
    "`set_status`, which every head runs). A head's edit that would break a guard is refused and pushed back. Capxul " +
    "never deletes a record that a head, a report or a later invoice may name, so a draft timesheet is cancelled. The " +
    "task's `stop` and the timesheet's `unpay` are the ways back ERPNext's code takes when a timesheet or a salary slip " +
    "is cancelled.",
  source: by(`${DT}/task/task.py:183; ${DT}/project/project.py:305; ${DT}/timesheet/timesheet.py:141; hrms/overrides/employee_timesheet.py`),
  affects: [machine_project, machine_task, machine_timesheet],
});

export const decision_projects_head_sync = defineDecision({
  id: "projects.head-sync",
  title: "Push the change log in order; apply the head's changes as commands would",
  question: "Once a head is connected, how do projects stay the same on both sides?",
  options: [
    {
      label: "push-log-pull-changes",
      text:
        "One process per connection pushes the change log in seq order and pulls the head's changes; a head change based on " +
        "the version Capxul holds is applied as that head user would apply it by command; one based on an older version, " +
        "or one Capxul's checks refuse, loses and is overwritten by Capxul's version. Each push names the last head change " +
        "Capxul read for the document, so the head yields to a change Capxul has seen and reports only an unread one.",
    },
    { label: "write-through", text: "The head calls Capxul on every save and fails the save if Capxul refuses." },
    { label: "head-wins", text: "Once connected, the head is the record for projects and Capxul follows it." },
  ],
  chosen: "push-log-pull-changes",
  why:
    "Projects are business records, not money or identity, so both sides may edit them (organizations.head-ownership); " +
    "the Organization's records existed in Capxul before any head, and Capxul's checks are the ones every command " +
    "passes, so Capxul decides. Write-through would give the head a Capxul key and make every head save wait on Capxul; " +
    "head-wins would let a head bypass the guards and would leave an Organization that disconnects its head with " +
    "records it cannot trust. The head rings a doorbell after a change, so a pull follows within seconds without a " +
    "minute-scale timer the one clock would have to stop at. Without the read change on each push, a document edited on " +
    "both sides would loop (push in conflict, pull loses, push in conflict again). A head user's change carries that " +
    "user's rights under projects.permissions, and a head user who is no member only a member's, so connecting a head " +
    "adds no second permission model. Frappe never un-submits, so a refused submit or cancel is undone the Frappe way, " +
    "by cancelling or amending. ERPNext gives a group task one Task Depends On row per child (`populate_depends_on`), " +
    "which Capxul keeps as the children's parent links, so a group's push sends those rows with its own dependencies " +
    "rather than clearing them (projects review, 8 November 2026).",
  source: by("books/target/shared/rulings.ts (aaron.frappe-head); docs/vision/erp.md (sections 1 and 6)"),
  affects: [workflow_projects_head_sync, table_project_head_syncs, table_project_changes, integration_frappe_head],
});

export const decision_projects_billing_and_payslips = defineDecision({
  id: "projects.billing-and-payslips",
  title: "Billing and paying hours are the higher concepts', through a door later",
  question: "ERPNext's Sales Invoice marks timesheets billed and Frappe HR's salary slip marks them paid. Who does that here?",
  options: [
    {
      label: "higher-concepts-later",
      text:
        "Requests (an invoice from billable logs) and payroll (a salary slip from timesheets) read projects and, when those " +
        "commands are designed, mark the logs through a projects procedure in their own transaction: an invoice and the " +
        "hours it bills are one money fact, as a payslip and the hours it pays are. Until then the head's own invoices and " +
        "slips set the billing and payslip fields through the sync. Either way a log is billed once and a timesheet paid " +
        "once: the guard is on the timesheet's own transitions, so whichever document commits first wins and the other is " +
        "refused (a head's) or never opened (a request's).",
    },
    { label: "projects-bills", text: "Projects issues the invoice itself, depending on requests." },
  ],
  chosen: "higher-concepts-later",
  why:
    "Hours billed twice are money asked twice, so the mark and the invoice must commit together, which P4 allows only " +
    "through a procedure of the concept that owns the timesheet; and the reacting concept must depend on the changed " +
    "one, so requests and payroll sit above projects (projects.dependencies). The billing door is now designed with " +
    "requests' owner (projects.bill-time); the paying one waits until payroll pays timesheets, which its slips, worked " +
    "out from structures rather than hours, do not yet. Two writers of one mark (a head's Sales Invoice now, a Capxul request later) would bill the " +
    "same hours twice unless the mark refuses a second; ERPNext refuses the same (`validate_time_sheets_are_submitted`: " +
    "a log that already names an invoice). For the requests and payroll designers: the fields are " +
    "timesheet-logs.sales_invoice, timesheets.per_billed, the billed totals, salary_slip and status (bill_part, bill, " +
    "unbill, pay, unpay, complete); a request or payslip for hours a head already invoiced or paid must be refused before " +
    "it asks for money.",
  source: by("erpnext/accounts/doctype/sales_invoice/services/timesheet_billing.py:19; hrms salary_slip.py:2402; policy P4"),
  affects: [table_timesheets, table_timesheet_logs, machine_timesheet, concept_requests, concept_payroll],
});

export const decision_projects_commands = defineDecision({
  id: "projects.commands",
  title: "Decision pack: the projects commands to add (new capabilities)",
  question:
    "Projects' operations are new capabilities, not among the 215, designed book first with a decision pack " +
    "(aaron.projects). Which commands does Capxul add, for people and for agents such as the FDE?",
  options: [
    {
      label: "working-set",
      text:
        "Recommended: exactly the 35 commands of docs/design/new-commands.md (section 5.1), in its one grammar. Each acts " +
        "for the Organization `--org` names (else `use org`'s), is one rpc in projects (`projects.<area>.<verb>`) and one " +
        "SDK method named by its words under `client.org(orgId)`: `org projects create|list|get|change|hold|resume|" +
        "complete|reopen|cancel`; `org projects member add|remove`; `org projects settings show|set`; `org projects task create|list|" +
        "get|change|start|review|complete|reopen|cancel` (parent, depends-on, dates, expected hours, weight, priority, " +
        "milestone; review takes `--by <day>`); `org projects timesheet create|log|get|list|submit|cancel` (a log is activity, " +
        "start, end or hours, task, project, billable, completed); `org projects activity-type add|change|list|disable|enable`; " +
        "`org projects project-type add|list`. Who (projects.permissions): any member reads, and creates and works tasks; a worker " +
        "keeps their own timesheets; the People hat or a Director manages projects, their members, types, rates, " +
        "settings and anyone else's time. Billing hours is requests' `org projects timesheet bill` (requests.bill-time).",
    },
    {
      label: "minimal",
      text:
        "Viable. Thirteen: `project create|list|show|complete|cancel`, `task create|list|show|update|complete`, " +
        "`timesheet log|submit|list`. Everything else through a connected head.",
    },
    {
      label: "generic-documents",
      text:
        "Viable for agents, weak for people. One `doc get|list|set|submit|cancel <DocType>` family over every native " +
        "DocType, in the shape of Frappe's REST API, with the same checks.",
    },
    {
      label: "head-only",
      text: "Weak. No commands: projects change only at start-up and from a connected head; an Organization with no head cannot plan work.",
    },
  ],
  chosen: "working-set",
  why:
    "Aaron accepted the working set on 8 November 2026 and asked for the commands to be designed in the book; they are " +
    "now booked, as 35 operations under rules.new-operations, each implemented by one new rpc of this concept, so no " +
    "flow is needed, and each in this pack's `affects`. The working set is what ERPNext's Projects forms let a user do " +
    "with the nine DocTypes the concept holds, so an Organization with no head can run its projects, and the FDE does " +
    "the same through the CLI. Minimal would leave a headless Organization unable to hold or reopen a project or share " +
    "it. Generic documents read like Frappe's API, which suits agents, but give people no help and no per-command " +
    "refusals. Head-only contradicts the ruling that projects are present from the start. As booked, three things " +
    "differ from the grammar page and each has its decision: the People-or-Director commands read the hat live and so " +
    "take `chain-read` (projects.hat-guard); the commands a pilot's first engagement runs are `critical` " +
    "(projects.critical-commands); and every refusal starts from a world, two of them asked of devnet (projects.worlds). " +
    "Review found two more, each a decision: `org projects create|change` and `org projects task create|change` take `--percent`, " +
    "without which Frappe's Manual, Task Progress and Task Weight methods could not work " +
    "(projects.percent-by-hand); and a pending review falls overdue when its review day comes, as ERPNext's job has it, " +
    "not after it (projects.review-day). A fit review then aligned the booking with the 215: `--percent` is the one " +
    "flag for a typed percent and `--progress` only a project's method; a member shared twice or removed unshared is " +
    "WRONG_STATE, as `org department holder add|remove` refuse it; and a change that gives nothing is INVALID_INPUT " +
    "(projects.refusal-codes). Not in this pack: `org projects timesheet bill` (requests.bill-time, requests' flow) and templates.",
  source: by(
    `${DT} (the forms of Project, Task and Timesheet); books/target/shared/rulings.ts (aaron.projects, aaron.frappe-shape, ` +
      "aaron.fde-agent); docs/design/new-commands.md (section 5.1)",
  ),
  affects: [concept_projects, ...TABLES, machine_project, machine_task, machine_timesheet, ...OPERATIONS],
});

export const decision_projects_permissions = defineDecision({
  id: "projects.permissions",
  title: "Members work their tasks and time; the People hat or a Director manages",
  question:
    "Frappe has the roles Projects User and Projects Manager. Who may read, work and manage an Organization's projects " +
    "once the commands exist?",
  options: [
    {
      label: "members-and-people-hat",
      text:
        "Every member (an active Seat, a person's or an agent's) reads every project, task and timesheet, creates and " +
        "works tasks, and keeps their own timesheets. Creating, changing, holding, completing, reopening and cancelling a " +
        "project, sharing it, setting the Projects Settings, adding project and activity types and their rates, and " +
        "keeping another worker's timesheet need a member whose own Safe wears the People hat or the Director hat, read " +
        "from the chain when the command runs. A head's user acts with the rights of the member matched by mailbox, and " +
        "one who is no member with only what any member may do.",
    },
    { label: "frappe-roles", text: "Off-chain roles per Seat in Frappe's shape (Projects User, Projects Manager), granted by the People hat and synced to the head's users." },
    { label: "projects-hat", text: "A fourth officer hat, Projects, minted by the Installer like Books, Invoicing and People." },
    {
      label: "department-hat",
      text: "As members-and-people-hat, and the wearers of the hat of the budget a project's `department` names also manage that project.",
    },
    { label: "any-member", text: "Every member may do everything." },
  ],
  chosen: "members-and-people-hat",
  why:
    "Aaron accepted it on 8 November 2026, with the commands. Projects move no money, so they need no chain authority " +
    "of their own, but the contact book is not open to anyone (aaron.contacts-permissions); managing projects is the " +
    "same kind of office, and the People hat already exists on every Organization. As the authority model has it " +
    "(docs/design/authority.md, aaron.departments), authority is a hat's, never a person's: a project's creator, its " +
    "members and its customer gain no right over it, and the Board swaps a member in or out of managing projects by " +
    "granting or revoking the People hat, which takes effect at their next command. An agent is a member like any " +
    "other, so a self-run agent works tasks and its own time from its Seat and manages only once the Board grants its " +
    "Safe the People hat, and the hosted FDE does what its asker may (agents.fde-authority). Frappe roles would give Capxul a second permission model beside hats. A " +
    "Projects hat changes the Installer, a v4 contract. A department's hat cannot manage its projects: projects sits " +
    "below budgets, and a project's `department` is a head's name, not a budget. Any member would let one Seat cancel " +
    "every project.",
  source: by("/tmp/erpnext/erpnext/projects/doctype/project/project.json (permissions: Projects User, Projects Manager); books/target/shared/rulings.ts (aaron.contacts-permissions, aaron.departments); docs/design/authority.md"),
  affects: [concept_projects, table_projects, table_tasks, table_timesheets, ...OPERATIONS],
});

// ── the commands as booked (commands-and-escrow pass, 8 November 2026) ──────────────────────

const BOOKED = "Claude, projects commands, 8 November 2026";
const booked = (evidence: string) => `${BOOKED}; evidence: ${evidence}`;

/** The rpcs whose guard reads a hat live. */
const HAT_RPCS = [
  rpc_projects_projects_create, rpc_projects_projects_change, rpc_projects_projects_hold, rpc_projects_projects_resume,
  rpc_projects_projects_complete, rpc_projects_projects_reopen, rpc_projects_projects_cancel, rpc_projects_members_add,
  rpc_projects_members_remove, rpc_projects_settings_set, rpc_projects_timesheets_create, rpc_projects_timesheets_log,
  rpc_projects_timesheets_submit, rpc_projects_timesheets_cancel, rpc_projects_activity_types_add,
  rpc_projects_activity_types_change, rpc_projects_activity_types_disable, rpc_projects_activity_types_enable,
  rpc_projects_project_types_add,
];

export const decision_projects_hat_guard = defineDecision({
  id: "projects.hat-guard",
  title: "The People and Director hats are read live from the chain, not from indexing",
  question:
    "Nineteen commands need the People hat or the Director hat (projects.permissions). Contacts and payroll read a hat's " +
    "wearers from indexing's hat-wearers, but projects does not depend on indexing. How does a projects command learn " +
    "the hat the caller's Safe wears?",
  options: [
    {
      label: "live",
      text:
        "Read it live: after the Seat, `Hats.isWearerOfHat(seat Safe, people_hat)` and, if false, the same for the " +
        "Director hat, through chain-rpc's readContract, with the hat ids from organizations' deployment row. An rpc " +
        "that does is an `action` of class `chain-read`, and fails PROVIDER_ERROR when no node answers. A member's own " +
        "work (reads, tasks, their own time) reads no chain.",
    },
    {
      label: "indexing-edge",
      text: "Projects gains a dependency on indexing and reads hat-wearers, as contacts and payroll do; its writes stay `write`.",
    },
    {
      label: "seat-role",
      text: "Keep a manager flag on the Seat, set when the People hat is granted or revoked.",
    },
  ],
  chosen: "live",
  why:
    "Authority follows the hat as the chain reads it when the command runs (docs/design/authority.md, the grammar's " +
    "Budget and People terms): a live view call sees a Board's swap at once, where an indexed view trails it by the " +
    "finality depth. Whether a Safe wears a hat now is state as of now, a view call chain-rpc serves before a write " +
    "(integrations.chain-rpc-live-reads); the shared rule already admits a live read for a concept with no indexing " +
    "edge, as notices reads the Safe's owners. Projects then stays where projects.dependencies put it, reading only " +
    "access, parties and organizations, and the hat ids come from organizations' deployment row. The cost: those " +
    "nineteen commands take one or two node reads (p95 400 ms each) before their one transaction, so they are " +
    "`chain-read` (900 ms p50, 2 s p95) rather than the grammar's `write`, and they refuse with PROVIDER_ERROR while no " +
    "node answers, the one refusal they add; a worker's own time, every task command and every read stay off the " +
    "chain. The indexing edge would also work and match contacts; it is the better choice if the shared owner adds " +
    "indexing to projects' dependencies for another reason, and the guard is one constant in projects/guards.ts. A " +
    "flag on the Seat would be a second record of a chain fact, wrong whenever the Board acts at the Safe outside " +
    "Capxul. The head sync applies a head user's change with the same guard, so it makes the same reads.",
  source: booked(
    "books/target/shared/decisions.ts (integrations.chain-rpc-live-reads; dependencies.of-projects); docs/design/authority.md " +
      "(the officer hats; Capxul's own checks); aaron.departments; books/target/contacts/book.ts (WRITE_GUARD)",
  ),
  affects: [...HAT_RPCS, workflow_projects_head_sync, concept_projects],
});

export const decision_projects_critical_commands = defineDecision({
  id: "projects.critical-commands",
  title: "The commands of a pilot's first engagement are critical; the rest normal",
  question:
    "The grammar makes every new command `normal`. Which projects commands does a pilot, a small services business " +
    "starting on Capxul, need on its first day, so that they are `critical`?",
  options: [
    {
      label: "first-engagement",
      text:
        "Eleven: `org projects create|list|get`, `org projects task create|list|complete`, and `org projects timesheet create|log|submit|" +
        "list|get`: plan the work, do it, log the time and submit it, so `org projects timesheet bill` can invoice it. Every other " +
        "command is `normal`.",
    },
    { label: "none", text: "Every command `normal`, as the grammar page has it: no B3 pilot runs one." },
    { label: "all", text: "Every projects command `critical`." },
  ],
  chosen: "first-engagement",
  why:
    "The concept is fundamental from an Organization's first day (projects.startup), and the first business a pilot " +
    "runs is an engagement for a customer: a project, its tasks and the time logged on them, which requests then bills. " +
    "Those eleven commands are that loop, and the FDE runs the same ones through the CLI. The rest (hold, resume, " +
    "reopen, review, sharing, types, rates and settings) refine it, and a start-up uses ERPNext's starting types and " +
    "settings. None of these is on the B3 pilots' money path, so `critical` here orders the build's work and the evals " +
    "a pilot depends on; it changes no budget.",
  source: booked("docs/design/new-commands.md (G8, section 5.1); aaron.projects; aaron.fde-agent; CONVENTIONS rule 4 (priority)"),
  affects: [...CRITICAL],
});

export const decision_projects_worlds = defineDecision({
  id: "projects.worlds",
  title: "Two worlds hold Acme's projects in every state a refusal needs",
  question: "No catalogued world holds a project, a task or a timesheet. Which worlds do the projects refusals start from?",
  options: [
    {
      label: "two-worlds",
      text:
        "Catalogued worlds where they reach the refusal (signed-out, org-ready, org-with-member), and two new ones built " +
        "by commands alone: org-with-projects, from org-with-member, holding Acme's projects Website (open, for Olga, " +
        "shared with Sam), Retainer (on hold), Handover (completed with no tasks, so worked out by hand) and Archive " +
        "(cancelled), created in that order; Website's tasks Design (working, due in a week), Build (open, depending on " +
        "Design, due in two), Launch (a group) with its open child Announce, and Spec (completed); Old, a task of no " +
        "project, cancelled; Execution's rates 40 costing and 90 billing, and " +
        "Research disabled; Sam's draft with one Execution log on Design, his submitted timesheet with two billable " +
        "hours of Execution on Design, and his cancelled one; Dana's own draft with no log; and Dana's timesheet for " +
        "Sam on Website, with a billable Execution log on no task, submitted and billed to Olga by `org projects timesheet bill`. And org-with-projects-chain-unreachable: the same, with chain-rpc's fault switch " +
        "failing every read.",
    },
    { label: "unknown", text: "Leave `given` as `?` until devnet designs projects worlds: each refusal a gap." },
  ],
  chosen: "two-worlds",
  why:
    "A refusal is an eval only once a world reaches it, and every WRONG_STATE here needs a record in a given status: a " +
    "completed task, a project on hold, a billed timesheet. One world holds them all, so a refusal names which record " +
    "and an eval switches only who is signed in. It is built from org-with-member, which already gives the three " +
    "people the guards tell apart (Dana with the People and Director hats, Sam with a Seat and no hat, Olga outside), " +
    "by the commands booked here and requests' `org projects timesheet bill`, never a table write (devnet.worlds). The hat " +
    "guard's PROVIDER_ERROR needs a record and a failing chain at once, so its world is the same snapshot with the " +
    "fault switch armed, as org-with-chart-and-node-down is. A refusal that needs no record starts from a catalogued " +
    "world. Devnet owns the catalogue, so both worlds are asked of it, with these contents.",
  source: booked("books/target/devnet/worlds.ts (org-with-member, org-with-budget-tree-chain-unreachable, org-with-chart-and-node-down); devnet.worlds; aaron.projects"),
  affects: [...OPERATIONS],
});

export const decision_projects_named_people = defineDecision({
  id: "projects.named-people",
  title: "A member is a Seat; a worker is any Party, found read-only",
  question:
    "Commands name people: a project's member, a timesheet's worker (`--for`), a project's customer and a worker's " +
    "employee. How is each resolved, and may a command name a Party that does not exist yet?",
  options: [
    {
      label: "read-only",
      text:
        "A member (`org projects member add`, `--member`) is an email or an agent's @handle, resolved through parties' " +
        "directory to a Party holding an active Seat. A worker (`--for`) is any Party locator, resolved read-only: an " +
        "employee or contractor with no Seat is a worker once they are a Party. A customer is a Party locator, or any " +
        "other text as a name (projects.customer-name). `--employee` is a name, kept as Frappe's link is. A locator " +
        "that names no Party is INVALID_INPUT; projects never names one.",
    },
    {
      label: "name-provisional",
      text: "Resolve through `parties.resolve-recipient`, naming a provisional Party for a mailbox no Party holds, as contacts and payroll do.",
    },
  ],
  chosen: "read-only",
  why:
    "Projects moves no money, so it has no money fact to share with parties' door (rules.procedures): naming a Party " +
    "is how a payee is made ready to be paid, which is payroll's (an Employee) and contacts' (a book entry), and a " +
    "person they name is a worker here at once. Frappe shares a project with a User, so a member must hold a Seat; a " +
    "head user who is not one is the head's own. Frappe's Timesheet names an Employee, which payroll holds above " +
    "projects, so the employee is kept as the name the head gives, as `department` and `cost_center` are " +
    "(projects.doctypes). ERPNext checks a time log's overlap by user and by employee, which here is the worker's " +
    "Party and that name.",
  source: booked(`${DT}/project_user/project_user.json; ${DT}/timesheet/timesheet.py:225; books/target/parties/procedures.ts; rules.procedures; aaron.projects`),
  affects: [rpc_projects_members_add, rpc_projects_members_remove, rpc_projects_timesheets_create, rpc_projects_projects_create, rpc_projects_projects_list, rpc_projects_timesheets_list],
});

export const decision_projects_settings_here = defineDecision({
  id: "projects.settings-here",
  title: "Projects Settings are Capxul's checks, not a record a head receives",
  question: "The change log carries Activity Types, Project Types, Projects, Tasks and Timesheets. Does `org projects settings set` reach a connected head?",
  options: [
    { label: "here", text: "No: the settings are the checks Capxul runs on every change, a head's included, so they stay here and append no change." },
    { label: "pushed", text: "Add Projects Settings to the change log and push it to the head's single." },
  ],
  chosen: "here",
  why:
    "The head sync applies a head's change through the same checks a command uses (projects.head-sync), so the overlap " +
    "check that matters is Capxul's, whatever the head's single says. Pushing a single would let a later head write " +
    "back a value that loosens Capxul's checks. A head's own settings still govern edits it refuses before they reach " +
    "Capxul, which is stricter, never looser.",
  source: booked(`${DT}/projects_settings/projects_settings.json; ${DT}/timesheet/timesheet.py:225; projects.head-sync; aaron.frappe-head`),
  affects: [rpc_projects_settings_set, rpc_projects_settings_show, table_project_settings, table_project_changes],
});

export const decision_projects_refusal_codes = defineDecision({
  id: "projects.refusal-codes",
  title: "WRONG_STATE for the record acted on; INVALID_INPUT for one it names",
  question:
    "ERPNext refuses a log on a cancelled task, a task under a completed parent and a disabled activity type, and a " +
    "transition from the wrong status. Which of the grammar's codes does each take, and what of a repeat?",
  options: [
    {
      label: "acted-on",
      text:
        "WRONG_STATE only when the record the command acts on is in a status (or fails a guard of its own machine) that " +
        "does not allow the step, naming the status or the unfinished tasks; INVALID_INPUT for a record it names that " +
        "cannot take part (a disabled activity type, a cancelled task, a completed or non-group parent, a cycle, an " +
        "overlap), naming the field. A project's members are the project's own state, as a department's holders are " +
        "the department's: sharing with a member already shared and removing one not shared are WRONG_STATE naming the " +
        "member, as are disabling a disabled type and enabling an enabled one. A change or set that gives nothing is " +
        "INVALID_INPUT, as a rate change with no rate is.",
    },
    { label: "all-wrong-state", text: "WRONG_STATE for every status a check reads, whichever record it is." },
  ],
  chosen: "acted-on",
  why:
    "The grammar gives WRONG_STATE to a transition's `from` or its guard, and INVALID_INPUT to a value that names " +
    "something unfit (a disabled activity type is its own example), so a caller tells 'this record cannot move' from " +
    "'fix this argument'. A task's own dependency guard is WRONG_STATE because it is the task's machine; a log naming " +
    "a cancelled task is a bad argument to the timesheet. The grammar models `org projects member` on `org department " +
    "holder` (G2), and the 215 refuse a holder added twice or removed when absent with WRONG_STATE, as they do a hat " +
    "granted twice (`org member grant`) and a department closed twice: so a share, a remove, a disable or an enable " +
    "that would change nothing is WRONG_STATE, and a script learns its picture was wrong. `contact add` returning an " +
    "entry already there is a book's lookup by Party, not a list of people in an office. A change with nothing to " +
    "change is a bad argument, as `org projects activity-type change` with no rate is (fit review, 8 November 2026).",
  source: booked(`docs/design/new-commands.md (G2, G6); org.department.holder.add|remove; ${DT}: timesheet.py:81, task.py:183 and :249, timesheet_detail.py:128; aaron.frappe-shape`),
  affects: [...OPERATIONS],
});

export const decision_projects_json_shapes = defineDecision({
  id: "projects.json-shapes",
  title: "Every write prints the record as `get` does; lists print a page",
  question: "What does each projects command print with `--json`?",
  options: [
    {
      label: "record-as-get",
      text:
        "A write prints its record after the change, exactly as `get` prints it (projects/shapes.ts), so a script reads " +
        "one shape per kind; a list prints a page of summaries and the next cursor; the type lists, which hold a few " +
        "rows, print every row and a null cursor; the settings print the three values.",
    },
    { label: "ack", text: "A write prints only the id and the new status." },
  ],
  chosen: "record-as-get",
  why:
    "It is the grammar's G9 and how the 215's writes print. Derived values (totals, actual time, percent complete, a " +
    "task's new status after a timesheet) change in the same write, so printing the record shows a caller what the " +
    "command caused without a second read. Ids are Capxul's and the head's name sits beside them (projects.ids-and-names).",
  source: booked("docs/design/new-commands.md (G9); books/target/projects/shapes.ts; aaron.projects"),
  affects: [...OPERATIONS],
});

// ── billing hours: the door requests invokes (assembly, 8 November 2026) ────────────────────

export const decision_projects_bill_time = defineDecision({
  id: "projects.bill-time",
  title: "One door marks billed hours; a request bills them in its own transaction",
  question:
    "The invoice-from-timesheets command (`timesheet bill`) is requests' (requests sits above projects). The hours it " +
    "bills are projects' timesheet logs. How does an Invoice mark them billed, and clear them when it ends?",
  options: [
    {
      label: "door",
      text:
        "`projects.bill-time`, a money-fact procedure: `bill` marks each log's `sales_invoice` and moves the timesheet " +
        "`bill_part` or `bill` (a paid one keeps `payslip`, its totals updated); `unbill` clears the marks and moves " +
        "`unbill` or `bill_part`. Requests invokes it in the issue's transaction and in the cancel's or decline's.",
    },
    { label: "outbox", text: "Projects follows `request_transitioned` and marks the logs after the request commits." },
    { label: "head-only", text: "Only a connected head bills hours; Capxul requests never name timesheets." },
  ],
  chosen: "door",
  why:
    "Hours billed twice are money asked twice, so the mark and the Invoice are one money fact (rules.procedures), and " +
    "only the owner's procedure may write projects' tables (P4). The outbox would leave a window for a second Invoice, " +
    "and projects would have to depend on requests (a cycle). Head-only contradicts aaron.projects: an " +
    "Organization with no head must still bill its time. The guards and writes are ERPNext's: a log names one invoice " +
    "(`validate_time_sheets_are_submitted`), only a submitted, partly or wholly billed, or payslip timesheet's billable " +
    "logs are billed, and `update_time_sheet` writes only each log's `sales_invoice` (Timesheet Detail's one field " +
    "allowed on submit; its `billing_amount` is read-only), then the totals from the logs' own hours and amounts and " +
    "Frappe HR's `set_status`. So the hours and amount a request asks per log are the request's, as a Sales Invoice " +
    "Timesheet row's are, and a timesheet a slip already paid keeps `payslip`: no ERPNext path sets a timesheet's own " +
    "sales-invoice link, and neither does Capxul, so `complete` and `uncomplete` stay a head's (its sync drives them), " +
    "and `unpay` also starts from completed for such a head timesheet. A paid request keeps its marks; a declined or " +
    "cancelled one clears them, as cancelling a Sales Invoice does (`unlink_sales_invoice_from_timesheets`); an expired " +
    "one keeps them until it is cancelled. Every mark appends to the change log, so a head learns the hours are billed " +
    "before it could invoice them itself. Open for the head owner: Timesheet Detail's `sales_invoice` is a Link to a " +
    "Sales Invoice, so a log a Capxul request billed reaches a head only once the Capxul app holds a Sales Invoice for " +
    "that request (or another mark its own Make Sales Invoice honours); until then the push would be refused. Requests " +
    "now depends on projects (dependencies.of-requests); the door stays uninvoked until requests books the command " +
    "that bills hours (requests.bill-time).",
  source: by(`erpnext/accounts/doctype/sales_invoice/services/timesheet_billing.py:19; ${DT}/timesheet/timesheet.py:141; hrms employee_timesheet.py`),
  affects: [procedure_projects_bill_time, table_timesheet_logs, table_timesheets, machine_timesheet, concept_requests],
});

export const decision_projects_customer_name = defineDecision({
  id: "projects.customer-name",
  title: "A customer with no Party is kept by name, as Frappe's Customer link is",
  question:
    "A project's and a timesheet's customer is a Party (`customer_party_id`), but a company not on Capxul is a private CRM " +
    "entry with no Party (parties.head-parties, parties.outside-companies), and projects sits below contacts, so it cannot " +
    "name the entry. How does a project for a prospect company name its customer?",
  options: [
    {
      label: "name-beside-party",
      text:
        "Beside `customer_party_id`, keep `customer_name`: Frappe's `customer` link as text, the head's Customer name or " +
        "the name a member gave, and null with no customer. With a Party it is the name the head shows for it; without " +
        "one it is the only mark. Nothing checks it: whatever must know the customer checks `customer_party_id`, so " +
        "`projects.bill-time` treats a log whose timesheet names a customer only by name as another customer than any " +
        "payer (INVALID_INPUT), and such hours are billed by a head's own Sales Invoice, or through Capxul once that " +
        "customer has a Party and the timesheet names it.",
    },
    { label: "crm-id", text: "Keep the CRM entry's `contact_` id as opaque text, which projects can neither check nor read." },
    { label: "party-only", text: "A customer must be a Party: a prospect company cannot be a project's customer until it is on Capxul." },
  ],
  chosen: "name-beside-party",
  why:
    "ERPNext's Project and Timesheet carry `customer`, a Link to Customer, and a head sync must round-trip it whether or " +
    "not that Customer has a `capxul_party`. A name is what Frappe shows and what the Capxul app looks the Customer up by " +
    "when it has no Party, and it invents no identity. An opaque CRM id would be a link projects could never check, " +
    "pointing up the map. Party-only would refuse what every services business does first, a project for a prospect. " +
    "Billing stays exact, because a Capxul request is paid by a Party and the door compares Parties, never names.",
  source: by(`${DT}/project/project.json (customer); ${DT}/timesheet/timesheet.json (customer); parties.head-parties`),
  affects: [table_projects, table_timesheets, procedure_projects_bill_time, workflow_projects_head_sync],
});

// ── review against ERPNext (reviewer 1, truth, 8 November 2026) ─────────────────────────────

const REVIEW = "Claude, projects review against ERPNext, 8 November 2026";
const reviewed = (evidence: string) => `${REVIEW}; evidence: ${evidence}`;

export const decision_projects_percent_by_hand = defineDecision({
  id: "projects.percent-by-hand",
  title: "A manual project's percent is typed; one with no tasks completes as manual",
  question:
    "Frappe's Project works its percent complete out four ways: Manual (its user types it), Task Completion, Task " +
    "Progress and Task Weight (both read each task's typed progress). As booked, the commands offered all four but no " +
    "flag typed a project's percent or a task's progress, and completing a project with no tasks kept its method, where " +
    "ERPNext switches it to Manual. What does Capxul do?",
  options: [
    {
      label: "as-erpnext",
      text:
        "As ERPNext's `update_percent_complete`: `--percent` (0 to 100) on `org projects create|change` for a manual " +
        "project only, and `--percent` (0 to 100, Frappe's Task `progress`, printed as `percentComplete`) on `org projects task " +
        "create|change`. Completing a project with no tasks makes " +
        "it manual at 100, and a manual project's status moves only by hand. Resuming or reopening a project whose tasks " +
        "make it 100 completes it in the same write; reopening a completed one its tasks still complete is WRONG_STATE.",
    },
    { label: "two-methods", text: "Offer only task completion and task weight, dropping Manual and Task Progress, with no typed figure." },
    { label: "as-booked", text: "Keep the four methods with no typed figure." },
  ],
  chosen: "as-erpnext",
  why:
    "As booked, a manual project's percent could never change and Task Progress read a progress no command set, so it " +
    "was task completion by another name, while the abouts promised a percent 'by hand'. A head runs ERPNext, which on " +
    "its first save of a completed project with no tasks switches it to Manual: a Capxul copy left on task completion " +
    "would disagree with the head, and the next task added would reopen it here but not there. ERPNext also completes " +
    "on save an open project its tasks make 100, which is why resume and reopen complete it in the same write; a " +
    "completed project its tasks still complete would come straight back, so its reopen is refused rather than doing " +
    "nothing. The flag extends the rows of docs/design/new-commands.md 5.1, whose owner is asked to add it. One flag " +
    "serves both, because the grammar's `--progress` already names a project's method: a task's own `--progress` " +
    "would make one flag a method on one command and a number on its neighbour, and the same in `--json`. " +
    "Dropping methods would leave Frappe's shape, which the rulings ask for, and a head's Manual project unreadable here.",
  source: reviewed(
    `${DT}/project/project.py:267 (update_percent_complete), :305 (validate_completed_status), :319 (get_task_progress); ` +
      `${DT}/task/task.py:205 (validate_progress); aaron.frappe-shape; aaron.projects`,
  ),
  affects: [
    rpc_projects_projects_create, rpc_projects_projects_change, rpc_projects_projects_complete, rpc_projects_projects_reopen,
    rpc_projects_projects_resume, rpc_projects_tasks_create, rpc_projects_tasks_change, machine_project, table_projects,
    table_tasks, operation_org_projects_create, operation_org_projects_change, operation_org_projects_complete,
    operation_org_projects_reopen, operation_org_projects_resume, operation_org_projects_task_create, operation_org_projects_task_change,
  ],
});

export const decision_projects_draft_rechecks = defineDecision({
  id: "projects.draft-rechecks",
  title: "A draft's every log is checked again; an empty timesheet waits for a log",
  question:
    "ERPNext checks every time log of a draft Timesheet each time it is saved (an activity type not disabled, a task " +
    "not cancelled, no overlap the settings forbid), and Frappe refuses any Timesheet without a time log. As booked, " +
    "`org projects timesheet log` and `submit` checked only the new log, and the head sync pushed a draft with none. What holds?",
  options: [
    {
      label: "every-save",
      text:
        "`org projects timesheet log` and `org projects timesheet submit` check every log of the draft again (INVALID_INPUT naming the " +
        "row); a submitted timesheet's logs are not checked again. The head sync holds back a timesheet with no log " +
        "until it has one, and never pushes one cancelled before its first log.",
    },
    { label: "new-log-only", text: "Check only the new log, and push every timesheet as written." },
  ],
  chosen: "every-save",
  why:
    "A draft Capxul lets through that ERPNext would refuse cannot reach a head: its push fails `validate_time_logs`, " +
    "`validate_tasks_not_cancelled` or the mandatory `time_logs` table, and its hours would be submitted here on a type " +
    "the Organization had disabled or a task it had cancelled. Checking on each save is what ERPNext does, and costs " +
    "one read of a draft's few logs. Holding back an empty draft keeps the grammar's two steps (`org projects timesheet create`, " +
    "then `log`) while a head only ever sees a Timesheet it can save. The Projects Settings follow the same rule: a " +
    "draft's logs meet the settings in force when it is next saved.",
  source: reviewed(
    `${DT}/timesheet/timesheet.py:69, :81 (validate_tasks_not_cancelled), :209 (validate_time_logs); ` +
      `timesheet.json (time_logs reqd); frappe/model/document.py:1821; aaron.frappe-head`,
  ),
  affects: [
    rpc_projects_timesheets_create, rpc_projects_timesheets_log, rpc_projects_timesheets_submit, rpc_projects_settings_set,
    workflow_projects_head_sync, operation_org_projects_timesheet_log, operation_org_projects_timesheet_submit, operation_org_projects_settings_set,
  ],
});

export const decision_projects_review_day = defineDecision({
  id: "projects.review-day",
  title: "A pending review falls overdue when its review day comes, as in ERPNext",
  question:
    "ERPNext's daily `set_tasks_as_overdue` skips a Pending Review task only while its review date is after today. As " +
    "booked, the task's timer waited until its review day had ended, a day later, which the grammar page also said. " +
    "Which holds?",
  options: [
    { label: "erpnext", text: "Overdue once its expected end's day has ended and its review day has begun." },
    { label: "after-the-day", text: "Overdue only after its review day has ended, as the grammar page wrote." },
  ],
  chosen: "erpnext",
  why:
    "On a connected head, ERPNext's own job marks the task overdue on its review day; a Capxul task still pending would " +
    "refuse that head change and push it back, then fall overdue a day later itself, one conflict for every reviewed " +
    "task. Projects' rules are ERPNext's (projects.derived, projects.machines), and the timer already follows ERPNext " +
    "for the expected end, overdue once its day has ended (`is_overdue`). The acceptance claim holds either way; the " +
    "grammar row's 'after that day' is asked to change.",
  source: reviewed(`${DT}/task/task.py:532 (set_tasks_as_overdue), :483 (is_overdue); erpnext/hooks.py:552 (daily); aaron.frappe-head`),
  affects: [rpc_projects_tasks_review, workflow_projects_tasks_watch_due, machine_task, operation_org_projects_task_review],
});

export const decision_projects_cancel_reads_logs = defineDecision({
  id: "projects.cancel-reads-logs",
  title: "Cancelling a timesheet reads each task's status from the logs left",
  question:
    "ERPNext's `get_task_status`, run for each task of a cancelled timesheet, makes a Pending Review task Working while " +
    "submitted time is left and Open when none is. As booked, a cancel moved only a working task back to open. What " +
    "does a cancel do?",
  options: [
    {
      label: "get-task-status",
      text:
        "As ERPNext: `stop` also from pending review; a pending review with submitted time left `start`s; an overdue task " +
        "stays overdue (its own timer would put it back at once); a completed or cancelled task keeps its status.",
    },
    { label: "working-only", text: "Move only a working task back to open, and leave a pending review as it is." },
  ],
  chosen: "get-task-status",
  why:
    "A pending review whose only logged time was cancelled has no work behind it, and ERPNext opens it; keeping it " +
    "pending would also disagree with a connected head, which recomputes the task when the cancel reaches it. Overdue " +
    "is the one exception the task machine already makes, because the timer is the overdue rule here.",
  source: reviewed(`${DT}/timesheet/timesheet.py:324 (get_task_status), :186 (update_task_and_project); aaron.frappe-shape`),
  affects: [rpc_projects_timesheets_cancel, machine_task, operation_org_projects_timesheet_cancel],
});

export const decision_projects_task_dates = defineDecision({
  id: "projects.task-dates",
  title: "A task's dates sit within its project's; a start with hours gives its end",
  question:
    "ERPNext refuses a task whose expected start or end falls outside its project's expected dates, and sets a missing " +
    "expected end from the start and expected hours. As booked, the task commands checked only the parent's end. Which " +
    "of these does Capxul keep?",
  options: [
    {
      label: "both",
      text:
        "Both: when a task is created or its dates, parent or project change, a start or end outside its project's " +
        "expected days is INVALID_INPUT, as ERPNext's `report_date_conflict` refuses it; and a start with expected " +
        "hours and no end gives the end, start plus the hours.",
    },
    { label: "parent-only", text: "Check only the parent task's end; set no default end." },
  ],
  chosen: "both",
  why:
    "A task Capxul accepts outside its project's dates would be refused by the head on its push " +
    "(`validate_parent_project_dates` throws on a new task or a changed date), and one with no end would gain one there " +
    "and fall overdue on the head while it never could here. Taking ERPNext's two rules keeps both sides on one task. " +
    "Left out: ERPNext's `reschedule_dependent_tasks`, which moves a dependant's dates when a task's end passes its " +
    "start; a connected head does it on the push and the sync brings the new dates back, and without a head the " +
    "dates stay as typed.",
  source: reviewed(`${DT}/task/task.py:132 (validate_parent_project_dates), :168 (report_date_conflict), :111, :392; aaron.frappe-shape`),
  affects: [rpc_projects_tasks_create, rpc_projects_tasks_change, operation_org_projects_task_create, operation_org_projects_task_change],
});

// ── the command tree (surface pass, 9 November 2026) ────────────────────────────────────────

export const decision_projects_surface_moves = defineDecision({
  id: "projects.surface-moves",
  title: "The projects commands take the tree's words: `org projects …`",
  question:
    "The command surface groups ERPNext's Projects module under one word (surface.projects-group). The 35 commands of " +
    "projects.commands were booked under five nouns of `org`. How do they read now, and what are their ids?",
  options: [
    {
      label: "tree",
      text:
        "As the tree spells them. `org project create|list|get|change|hold|resume|complete|reopen|cancel` becomes `org " +
        "projects create|…|cancel`; `org project member add|remove` and `org project settings show|set` become `org projects " +
        "member …` and `org projects settings …`; `org task …`, `org timesheet …`, `org activity-type …` and `org " +
        "project-type …` become `org projects task …`, `org projects timesheet …`, `org projects activity-type …` and `org " +
        "projects project-type …`. Each id is its new words joined by dots (`org.task.create` is `org.projects.task.create`), " +
        "as rules.new-operations requires, and each export name follows.",
    },
    { label: "as-booked", text: "Keep the five nouns of `org` as booked, and leave projects outside the tree." },
  ],
  chosen: "tree",
  why:
    "Aaron, 9 November 2026: everything Frappe can do must be reachable from Capxul's tooling, and what matters is the " +
    "logical groupings. The tree (surface.tree, surface.projects-group) gives each Frappe app one group word, so a person " +
    "or the FDE finds a project's tasks, time and types where ERPNext's Projects workspace keeps them. The move is " +
    "spelling only: every claim, refusal, world, rpc, budget and authority of the 35 is as it was (aaron.projects, " +
    "projects.permissions), and each claim and refusal that quoted a command quotes the new words, here and in the " +
    "shapes and decisions that name them. Each command is still one rpc of this concept, so no flow changes; the SDK " +
    "method follows the words (G7): the Project's own, its members and its settings keep `client.org(orgId).projects.*`, " +
    "and the task, timesheet, activity-type and project-type methods gain `.projects` " +
    "(`client.org(orgId).projects.tasks.create`). Requests' `org timesheet bill` moves with them, to `org projects " +
    "timesheet bill`, in requests. For Aaron, as part of question 50 (surface.tree): the recommendation stands until he " +
    "answers, and if he keeps the booked nouns the words move back with no change of behaviour.",
  source: by("books/target/shared/surface.ts (surface.tree, surface.projects-group); docs/design/command-surface.md sections 4, 5.2 and 9; aaron.projects"),
  affects: [...OPERATIONS],
});
