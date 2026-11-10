// The tasks area: Frappe's Task, with its parent and its Task Depends On rows. Any member creates,
// changes and works tasks, as ERPNext's Projects User may (projects.permissions), so no task command
// reads a hat and none touches the chain. A task's status moves only by its machine's transitions,
// and every move works its project's percent complete out again in the same write: an open project
// at 100 completes, a completed one below 100 opens again (projects.derived). A task's expected end is
// its own process's timer (projects.tasks.watch-due), which each write here wakes.

import { Schema } from "effect";
import { budget, defineRpc, type TransitionRef } from "../../../packages/book/src/index.ts";
import { concept_projects } from "../shared/foundation.ts";
import { table_organizations } from "../organizations/data.ts";
import { machine_project, machine_task, table_projects, table_tasks } from "./data.ts";
import { FRAPPE, LOG_LINE, LOGGED, MEMBER_GUARD, MEMBER_READS, READ_ERRORS, WHO_MEMBER, WRITE_ERRORS } from "./guards.ts";
import { OrgInput, Page, PageInput, Task, TaskFields, TaskStatus, TaskSummary } from "./shapes.ts";

const S = Schema.String;
const Opt = Schema.optionalKey;
const OneTask = Schema.Struct({ ...OrgInput, task: S });
const tt = machine_task.t;
const pt = machine_project.t;

/** What a write reads besides the member guard: the tasks it links and the project whose percent it moves. */
const WRITE_READS = [...MEMBER_READS, table_tasks, table_projects, table_organizations] as const;
const WRITES = [table_tasks, table_projects, ...LOGGED] as const;

const ROLLUP =
  "Its project's percent complete is worked out again by its method in the same write: at 100 an open project " +
  "completes (project.complete), below it a completed one opens again (project.reopen); one on hold, cancelled or " +
  "worked out by hand keeps its status (ERPNext's `update_percent_complete`). ";

const FIELD_RULES =
  "A subject is 1 to 140 characters. `project` is any of the Organization's projects; `parent` a group task of the " +
  "same project that is not completed (a parent alone gives its project); " +
  "`dependsOn` the Organization's tasks, making no cycle of dependencies or parents (`check_recursion`). `start` and " +
  "`end` are instants or days, a day being its 00:00 in the Organization's zone (projects.dates); the end is not " +
  "before the start nor after the parent's expected end, neither is outside its project's expected days, and a " +
  "start with expected hours but no end ends that many hours later (projects.task-dates). Expected hours and weight " +
  "are decimals of at least zero, `percent` one from 0 to 100 (100 once completed), and `type` a Task Type's " +
  "name (projects.doctypes). Any broken is INVALID_INPUT naming the field, and nothing is written. ";

export const rpc_projects_tasks_create = defineRpc({
  id: "projects.tasks.create",
  title: "Create an open task",
  about:
    MEMBER_GUARD +
    FIELD_RULES +
    "Then it writes one task, born `open` (task.open), with a `tsk_` id, the fields given, zero actual time and " +
    "totals, its percent complete zero unless given, and the caller's principal as its creator; its own due timer starts with it. " +
    ROLLUP +
    LOG_LINE,
  was: [`${FRAPPE}/task/task.json`, `${FRAPPE}/task/task.py:84`, `${FRAPPE}/task/task.py:249`, `${FRAPPE}/task/task.py:292`],
  concept: concept_projects,
  kind: "mutation",
  who: WHO_MEMBER,
  input: Schema.Struct({ ...OrgInput, ...TaskFields, subject: S }),
  output: Task,
  errors: READ_ERRORS,
  reads: WRITE_READS,
  writes: WRITES,
  drives: [tt.open, pt.complete, pt.reopen],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("write"),
});

export const rpc_projects_tasks_list = defineRpc({
  id: "projects.tasks.list",
  title: "List the Organization's tasks by expected end",
  about:
    MEMBER_GUARD +
    "One page of the Organization's tasks, earliest expected end first (those with none last), each as its summary: " +
    "filtered by project (`by_org_project_status`), status and parent task (`by_org_parent`). A status that is no task " +
    "status, a `limit` outside 1 to 100 or a cursor this list did not give is INVALID_INPUT.",
  concept: concept_projects,
  kind: "query",
  who: WHO_MEMBER,
  input: Schema.Struct({ ...OrgInput, ...PageInput, project: Opt(S), status: Opt(TaskStatus), parent: Opt(S) }),
  output: Page(TaskSummary),
  errors: READ_ERRORS,
  reads: [...MEMBER_READS, table_tasks],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("read"),
});

export const rpc_projects_tasks_get = defineRpc({
  id: "projects.tasks.get",
  title: "Read one task, with its dependencies, children and logged time",
  about:
    MEMBER_GUARD +
    "The task by its id (INVALID_INPUT when it is not one of the Organization's), with each task it depends on and " +
    "each child, by subject and status, its actual time and totals from submitted timesheets, its review day, and who " +
    "completed it and when.",
  concept: concept_projects,
  kind: "query",
  who: WHO_MEMBER,
  input: OneTask,
  output: Task,
  errors: READ_ERRORS,
  reads: [...MEMBER_READS, table_tasks],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("read"),
});

export const rpc_projects_tasks_change = defineRpc({
  id: "projects.tasks.change",
  title: "Change a task's fields",
  about:
    MEMBER_GUARD +
    "The task by its id (INVALID_INPUT otherwise). " +
    FIELD_RULES +
    "Also INVALID_INPUT: ungrouping a task with children, or moving it away from its children's project " +
    "(`validate_children_project`), and giving nothing. It sets the fields given and empties those `clear` names " +
    "(not the subject), never " +
    "its status, except that an overdue task whose expected end moves to a day not yet ended, or is cleared, is open " +
    "again, or working with time logged (ERPNext's `validate_status`), its timer re-armed. " +
    ROLLUP.replace("Its project's", "Each project it leaves or joins has its") +
    LOG_LINE,
  was: [`${FRAPPE}/task/task.py:183`, `${FRAPPE}/task/task.py:259`, `${FRAPPE}/task/task.py:277`],
  concept: concept_projects,
  kind: "mutation",
  who: WHO_MEMBER,
  input: Schema.Struct({ ...OneTask.fields, ...TaskFields, clear: Opt(Schema.Array(S)) }),
  output: Task,
  errors: READ_ERRORS,
  reads: WRITE_READS,
  writes: WRITES,
  drives: [tt.recover_open, tt.recover_working, pt.complete, pt.reopen],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("write"),
});

/** One lifecycle step of a task, which any member takes. */
const step = (
  verb: "start" | "review" | "complete" | "reopen" | "cancel",
  title: string,
  what: string,
  projectMoves: readonly TransitionRef[],
  input: Schema.Top = OneTask,
) =>
  defineRpc({
    id: `projects.tasks.${verb}`,
    title,
    about:
      MEMBER_GUARD +
      "The task by its id (INVALID_INPUT otherwise). " +
      what +
      " A task in any other status is WRONG_STATE, naming its status, and nothing is written. " +
      (projectMoves.length ? ROLLUP : "") +
      LOG_LINE,
    was: [`${FRAPPE}/task/task.py:183`, `${FRAPPE}/project/project.py:267`],
    concept: concept_projects,
    kind: "mutation",
    who: WHO_MEMBER,
    input,
    output: Task,
    errors: WRITE_ERRORS,
    reads: WRITE_READS,
    writes: WRITES,
    drives: [tt[verb], ...projectMoves],
    invokes: [],
    emits: [],
    calls: [],
    chain: [],
    spans: [],
    budget: budget("write"),
  });

export const rpc_projects_tasks_start = step(
  "start",
  "Start a task by hand",
  "An open or pending-review task becomes working (task.start), as a submitted time log on it would make it.",
  [],
);

export const rpc_projects_tasks_review = step(
  "review",
  "Send a task for review by a day",
  "An open, working or overdue task becomes pending review (task.review), with `by` as its review day (a day in the " +
    "Organization's time zone, else INVALID_INPUT). It falls overdue only once its expected end's day has ended and " +
    "its review day has begun: ERPNext's daily `set_tasks_as_overdue` skips a pending review only while its review " +
    "date is still in the future.",
  [],
  Schema.Struct({ ...OneTask.fields, by: S }),
);

export const rpc_projects_tasks_complete = step(
  "complete",
  "Complete a task whose dependencies are done",
  "An open, working, pending-review or overdue task completes (task.complete): percent complete 100, and the caller's Party " +
    "and today (the Organization's day on the one clock) recorded as who completed it and when. It is WRONG_STATE " +
    "while a task it depends on, or for a " +
    "group task a child, is neither completed nor cancelled, naming each (ERPNext's `validate_status`).",
  [pt.complete],
);

export const rpc_projects_tasks_reopen = step(
  "reopen",
  "Open a completed or cancelled task again",
  "A completed or cancelled task opens again (task.reopen); a completed one's completion (who and when) is cleared " +
    "and its percent complete zeroed, as ERPNext's `clear_completion_on_reopen` does, and a cancelled one keeps its percent. " +
    "Its due timer arms again.",
  [pt.reopen],
);

export const rpc_projects_tasks_cancel = step(
  "cancel",
  "Cancel a task",
  "An open, working, pending-review or overdue task is cancelled (task.cancel) and kept. It counts as done for its " +
    "project's percent complete and for the tasks that depend on it, and its due timer disarms.",
  [pt.complete],
);
