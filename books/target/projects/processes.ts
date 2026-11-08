// The projects concept's durable work: its start-up when an Organization begins, its sync with a
// connected head, and each task's own due timer. Its commands (operations.ts, projects.commands) are
// one rpc each and wait on nothing, so none of them is a process; each write they make wakes the
// processes that follow it (a task's due timer by its row, the head sync by the change log).

import { budget, defineWorkflow } from "../../../packages/book/src/index.ts";
import { concept_projects } from "../shared/foundation.ts";
import { contract_hats, integration_chain_rpc, integration_frappe_head } from "../shared/external.ts";
import {
  event_org_head_transitioned,
  machine_org_head,
  machine_org_setup,
  table_org_deployments,
  table_org_heads,
  table_org_members,
  table_organizations,
} from "../organizations/data.ts";
import { table_parties } from "../parties/data.ts";
import { table_principals } from "../access/data.ts";
import {
  event_task_transitioned,
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

const DAY = 86_400_000;
const INSTALL_FIXTURES = "/tmp/erpnext/erpnext/setup/setup_wizard/operations/install_fixtures.py";

const RECORDS = [table_activity_types, table_project_types, table_projects, table_project_users, table_tasks, table_timesheets, table_timesheet_logs];

export const workflow_projects_startup_open = defineWorkflow({
  id: "projects.startup.open",
  title: "Start the Organization's Projects app",
  about:
    "Started by an Organization setup's `begin`, through the outbox: Projects is a fundamental app, ready from the first " +
    "day whether or not a head is ever connected (aaron.projects, projects.startup). In one transaction it writes the " +
    "Organization's Projects Settings (no overlapping time for one user or one employee; sales invoices do not fetch " +
    "timesheets), ERPNext's starting Activity Types (Planning, Research, Proposal Writing, Execution, Communication; rates " +
    "zero in the Organization's currency) and Project Types (Internal, External, Other), each with its change in the " +
    "change log, as ERPNext's setup wizard installs them. It creates no project and no task: those are the business's. " +
    "It cannot be a step of `begin`, which is organizations' and may not write another concept's tables.",
  concept: concept_projects,
  priority: "normal",
  trigger: { transition: machine_org_setup.t.begin },
  steps: [
    { name: "settings", about: "Write the Projects Settings with the change counter at zero, unless the Organization has them." },
    { name: "fixtures", about: "Write the five activity types and three project types, each with the next seq in the change log." },
  ],
  reads: [table_organizations, table_project_settings],
  writes: [table_project_settings, table_activity_types, table_project_types, table_project_changes],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  idempotency: "One run per Organization (`projects-startup:<orgId>`): a second finds the settings row and writes nothing.",
  timeoutMs: 60_000,
  retries: { max: 5, backoff: "exponential" },
  budget: budget("background"),
  was: [`${INSTALL_FIXTURES}:270`, `${INSTALL_FIXTURES}:309`],
});

export const workflow_projects_head_sync = defineWorkflow({
  id: "projects.head.sync",
  title: "Sync the Organization's projects with its connected head",
  about:
    "Started when a head connection is confirmed, one instance per connection; it waits on two systems for as long as " +
    "the head is connected and must survive a crash. Push: it pages the change log after `pushed_seq` and writes each " +
    "changed record as it stands to the head (`upsertDocs`, in seq order), the first time from seq 1 so the head gets " +
    "the whole history in order. Each document carries its version, the version the head was last given and the last " +
    "head change Capxul has read for it: the head writes over its own edits up to that change and answers conflict only " +
    "for one Capxul has not read, so the next pull settles it and no conflict loops. Pull: it reads the head's own " +
    "changes after `pulled_change` (`listChanges`) and applies each by organizations.head-ownership. A change based on " +
    "the version Capxul holds is applied with its head user's rights (a member matched by mailbox, under " +
    "projects.permissions, the People or Director hat read live as a command reads it, projects.hat-guard; a head " +
    "user who is no member has only what any member may do), through the same checks and transitions a command would " +
    "use, logged `origin` head. One based on an older version loses and Capxul's version is " +
    "pushed back (a conflict); one Capxul's checks refuse is pushed back too (refused). Frappe never un-submits, so a " +
    "refused head cancel is pushed back as an amendment carrying the same capxul_id, and a refused head submit by " +
    "cancelling and amending a draft. Fields Capxul derives (percent complete, actual time, totals, a status a timesheet " +
    "sets) are recomputed, never taken from the head; a head's invoice or salary slip marks a timesheet only through " +
    "the billed-once and paid-once guards (projects.billing-and-payslips). A document born in the head is born here " +
    "with a Capxul id. It wakes on its own changes, on the head's ring, and once a day to catch a missed ring; while the " +
    "head is failing it waits. It ends when the head is disconnected; the records stay.",
  concept: concept_projects,
  priority: "normal",
  trigger: { transition: machine_org_head.t.confirm },
  instance: { per: table_project_head_syncs },
  waits: [
    {
      name: "capxul-change",
      for: "signal",
      key: [{ on: [table_project_changes], props: ["org_id"] }],
      about: "A projects record changed here: push it.",
    },
    {
      name: "ring",
      for: "signal",
      key: [{ on: [table_org_heads], props: ["org_id", "head_id"] }],
      about: "The head rang its doorbell (organizations.heads.ring stamped the connection): pull its changes.",
    },
    { name: "catch-up", for: "timer", timeoutMs: DAY, about: "A day after the last pull: pull, in case a ring was lost." },
    {
      name: "disconnected",
      for: "signal",
      key: [{ on: [event_org_head_transitioned], props: ["org_id", "head_id"] }],
      about: "The head stopped failing, started failing, or was disconnected: carry on, wait, or end.",
    },
  ],
  steps: [
    { name: "forget-names", about: "First run of a new connection only: clear every row's head_name, which named the last head's documents." },
    {
      name: "push",
      about:
        "Page the change log after pushed_seq; upsertDocs in seq order, only the fields Capxul holds (a head-only field, " +
        "such as a Task's issue or a Project's sales order, is never cleared); record the head's names; advance pushed_seq.",
    },
    { name: "pull", about: "listChanges after pulled_change; apply, push back a conflict or a refusal; advance pulled_change." },
    { name: "await", about: "Wait for a change here, a ring, the daily catch-up or the connection's next transition." },
  ],
  reads: [
    table_org_heads, table_organizations, table_org_members, table_org_deployments, table_principals, table_parties,
    table_project_head_syncs, table_project_changes, ...RECORDS,
  ],
  writes: [table_project_head_syncs, table_project_changes, table_project_settings, ...RECORDS],
  drives: [
    machine_project.t.open,
    machine_project.t.hold,
    machine_project.t.resume,
    machine_project.t.complete,
    machine_project.t.reopen,
    machine_project.t.cancel,
    machine_task.t.open,
    machine_task.t.template,
    machine_task.t.start,
    machine_task.t.stop,
    machine_task.t.review,
    machine_task.t.recover_open,
    machine_task.t.recover_working,
    machine_task.t.complete,
    machine_task.t.reopen,
    machine_task.t.cancel,
    machine_timesheet.t.draft,
    machine_timesheet.t.submit,
    machine_timesheet.t.bill_part,
    machine_timesheet.t.bill,
    machine_timesheet.t.unbill,
    machine_timesheet.t.pay,
    machine_timesheet.t.unpay,
    machine_timesheet.t.complete,
    machine_timesheet.t.uncomplete,
    machine_timesheet.t.cancel,
  ],
  invokes: [],
  emits: [],
  calls: [integration_frappe_head.c.upsertDocs, integration_frappe_head.c.listChanges, integration_chain_rpc.c.readContract],
  chain: [contract_hats.f.isWearerOfHat],
  idempotency:
    "One process per head connection (`projects-head:<orgId>:<headId>`). A push is idempotent by version (the head " +
    "answers unchanged), and a pulled change already applied is skipped by its head name and time.",
  timeoutMs: 3650 * DAY,
  retries: { max: 8, backoff: "exponential" },
  budget: budget("background"),
});

export const workflow_projects_tasks_watch_due = defineWorkflow({
  id: "projects.tasks.watch-due",
  title: "One task's expected end: overdue on the one clock",
  about:
    "Started by a task's birth, one instance per task. It replaces ERPNext's daily `set_tasks_as_overdue` with the task's " +
    "own timer (P3: no sweep), so a warp stops at the instant a task falls due. It reads the task's expected end and " +
    "waits until the end of that day in the Organization's time zone (a pending review: until both that day and its " +
    "review date's day have ended, as ERPNext skips a review still ahead); then, if the task is still unfinished and its " +
    "dates have not moved, it marks it overdue. Each write to the task wakes it to read the dates again. A completed or " +
    "cancelled task disarms it without ending it, because either may be reopened: a reopened task arms it again. It " +
    "lives as long as its task; a template task is never armed.",
  concept: concept_projects,
  priority: "normal",
  trigger: { transition: machine_task.t.open },
  instance: { per: table_tasks },
  waits: [
    { name: "due", for: "timer", about: "The end of the expected end's day (and, under review, the review date's) in the Organization's time zone." },
    {
      name: "task-written",
      for: "signal",
      key: [{ on: [table_tasks], props: ["org_id", "task_id"] }],
      about: "The task was written (a date moved, a status changed): read it again and wait for the new instant.",
    },
    {
      name: "task-ended",
      for: "signal",
      key: [{ on: [event_task_transitioned], props: ["org_id", "task_id"] }],
      about: "The task completed or was cancelled: disarm and wait; reopened: arm again.",
    },
  ],
  steps: [
    { name: "arm", about: "Read the expected end (and review date) and the Organization's time zone; with none, or completed or cancelled, wait for a write or a transition." },
    { name: "fire", about: "At the instant, unfinished and the date unchanged: fall_overdue." },
  ],
  reads: [table_tasks, table_organizations],
  writes: [table_tasks, table_project_changes, table_project_settings],
  drives: [machine_task.t.fall_overdue],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  idempotency: "One process per task (`task-due:<orgId>:<taskId>`); the transition is guarded by the status it moves from.",
  timeoutMs: 3650 * DAY,
  retries: { max: 5, backoff: "exponential" },
  budget: budget("background"),
  was: ["/tmp/erpnext/erpnext/projects/doctype/task/task.py:532", "/tmp/erpnext/erpnext/hooks.py:552"],
});
