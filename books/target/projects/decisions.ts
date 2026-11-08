// The projects concept's own judgments (CONVENTIONS rule 10). Made by Claude on 8 November 2026
// under Aaron's rulings aaron.projects, aaron.frappe-shape, aaron.erp-on-capxul and
// aaron.frappe-head, with ERPNext's Projects module (frappe/erpnext, cloned at /tmp/erpnext) and
// docs/vision/erp.md as evidence. The old system had no projects, so nothing here replaces old code.
// Two of them are for Aaron: the commands (a decision pack) and who may use them.

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
    "capxul_id, instead of inserting a duplicate Frappe would refuse.",
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
    "Settings, is what makes both sides agree on which day an instant falls on (organizations.head-clock).",
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
  title: "Totals, actual time and percent complete are derived, never typed",
  question: "Frappe recomputes a task's actual time and a project's totals and percent complete when a timesheet is submitted or a task changes. Where here?",
  options: [
    { label: "derived-in-the-write", text: "In the same transaction as the write that changes them: a submitted or cancelled timesheet updates its tasks and project; a task's status updates its project's percent complete and status." },
    { label: "read-time", text: "Computed when read, never stored." },
  ],
  chosen: "derived-in-the-write",
  why:
    "Frappe stores them (actual_time, total_costing_amount, percent_complete) and its reports and the head read them as " +
    "stored, so a head's copy must match Capxul's at each version. Recomputing in the write keeps them one fact with what " +
    "caused them; a value the head sends for one is ignored, because the head computes it from rows it may not have in " +
    "full (its Activity Costs, its Employees). The rules are ERPNext's: percent complete by task completion, progress or " +
    "weight; a project completes at 100 and opens again below it, unless it is on hold or cancelled; a submitted " +
    "timesheet makes its open or pending-review tasks working, or completes one its log marks completed, and cancelling " +
    "the last one makes a working task open again (`get_task_status`).",
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
    "Organization. A pending review falls due only once its review date's day has ended too, as ERPNext skips one whose " +
    "review date is still ahead. A completed or cancelled task disarms its timer without ending it, because ERPNext lets " +
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
    "by cancelling or amending.",
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
        "SDK method named by its words under `client.org(orgId)`: `org project create|list|get|change|hold|resume|" +
        "complete|reopen|cancel`; `org project member add|remove`; `org project settings show|set`; `org task create|list|" +
        "get|change|start|review|complete|reopen|cancel` (parent, depends-on, dates, expected hours, weight, priority, " +
        "milestone; review takes `--by <day>`); `org timesheet create|log|get|list|submit|cancel` (a log is activity, " +
        "start, end or hours, task, project, billable, completed); `org activity-type add|change|list|disable|enable`; " +
        "`org project-type add|list`. Who (projects.permissions): any member reads, and creates and works tasks; a worker " +
        "keeps their own timesheets; the People hat or a Director manages projects, their members, types, rates, " +
        "settings and anyone else's time. Reads are `read`, the rest `write`, all `normal`. Billing hours is requests' " +
        "`org timesheet bill` (requests.bill-time).",
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
    "For Aaron: this is a decision pack, and the recommendation stands until he answers. The working set is what ERPNext's " +
    "Projects forms let a user do with the nine DocTypes the concept holds, so an Organization with no head can run its " +
    "projects, and the FDE does the same through the CLI. Minimal would leave a headless Organization unable to hold or " +
    "reopen a project or share it. Generic documents read like Frappe's API, which suits agents, but give people no " +
    "help and no per-command refusals. Head-only contradicts the ruling that projects are present from the start. Aaron " +
    "accepted the working set and asked on 8 November 2026 for the commands to be designed in the book, so its list " +
    "is now docs/design/new-commands.md's, in the one grammar of every new command. Not in this pack: `org timesheet " +
    "bill` (requests.bill-time, requests' flow) and templates.",
  source: by(`${DT} (the forms of Project, Task and Timesheet); books/target/shared/rulings.ts (aaron.projects, aaron.fde-agent)`),
  affects: [concept_projects, ...TABLES, machine_project, machine_task, machine_timesheet],
});

export const decision_projects_permissions = defineDecision({
  id: "projects.permissions",
  title: "Members work their tasks and time; the People hat manages projects",
  question:
    "Frappe has the roles Projects User and Projects Manager. Who may read, work and manage an Organization's projects " +
    "once the commands exist?",
  options: [
    {
      label: "members-and-people-hat",
      text:
        "Every member reads every project and task and logs and submits their own time; any member creates and works tasks. " +
        "Creating, holding, completing, reopening and cancelling a project, its users, its types and rates, and another " +
        "member's timesheet need the People hat (or a Director). A head's user acts with the rights of the member matched by " +
        "mailbox, and one who is no member with only what any member may do.",
    },
    { label: "frappe-roles", text: "Off-chain roles per Seat in Frappe's shape (Projects User, Projects Manager), granted by the People hat and synced to the head's users." },
    { label: "projects-hat", text: "A fourth officer hat, Projects, minted by the Installer like Books, Invoicing and People." },
    { label: "any-member", text: "Every member may do everything." },
  ],
  chosen: "members-and-people-hat",
  why:
    "For Aaron, with the commands. Projects move no money, so they need no chain authority of their own, but Aaron ruled " +
    "that the contact book is not open to anyone (aaron.contacts-permissions); managing projects is the same kind of " +
    "office, and the People hat already exists on every Organization. Frappe roles would give Capxul a second permission " +
    "model beside hats. A Projects hat changes the Installer, a v4 contract. Any member would let one Seat cancel every " +
    "project.",
  source: by("/tmp/erpnext/erpnext/projects/doctype/project/project.json (permissions: Projects User, Projects Manager); books/target/shared/rulings.ts (aaron.contacts-permissions)"),
  affects: [concept_projects, table_projects, table_tasks, table_timesheets],
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
