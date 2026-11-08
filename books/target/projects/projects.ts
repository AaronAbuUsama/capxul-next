// The projects area: Frappe's Project, kept by Capxul. Any member lists and reads them; People or a
// Director creates them, changes their fields and moves their status (projects.permissions). Each
// command is one rpc and one transaction; a write behind the hat guard first reads the caller's hat
// live (projects.hat-guard). A project's totals, actual dates and percent complete are never typed:
// its tasks and submitted timesheets make them (projects.derived).

import { Schema } from "effect";
import { budget, defineRpc } from "../../../packages/book/src/index.ts";
import { concept_projects } from "../shared/foundation.ts";
import { table_organizations } from "../organizations/data.ts";
import { machine_project, table_project_types, table_project_users, table_projects, table_tasks } from "./data.ts";
import {
  FRAPPE,
  HAT_CALLS,
  HAT_CHAIN,
  HAT_ERRORS,
  HAT_GUARD,
  MANAGE_ERRORS,
  HAT_READS,
  LOG_LINE,
  LOGGED,
  MEMBER_GUARD,
  MEMBER_READS,
  READ_ERRORS,
  WHO_MANAGER,
  WHO_MEMBER,
} from "./guards.ts";
import { OrgInput, Page, PageInput, Project, ProjectFields, ProjectStatus, ProjectSummary } from "./shapes.ts";

const S = Schema.String;
const Opt = Schema.optionalKey;
const OneProject = Schema.Struct({ ...OrgInput, project: S });
const t = machine_project.t;

/** What a project's view reads: the project, its users and its tasks' counts. */
const VIEW_READS = [table_projects, table_project_users, table_tasks] as const;

const FIELD_RULES =
  "A name is 1 to 140 characters; `type` names one of the Organization's project types; `end` is not before `start`; " +
  "`estimatedCost` is a decimal of at least zero; `percent` one from 0 to 100, only for a project worked out by hand " +
  "(Frappe's Manual; 100 once completed). `customer` is a Party locator (an email, an @handle, a 0x address or a " +
  "Party id), held as that Party with its display name, or any other text, held as the customer's name alone " +
  "(projects.customer-name). A locator that names no Party, or any field that breaks these rules, is INVALID_INPUT " +
  "naming the field. `department` and `cost_center` are names, as a Frappe link holds them (projects.doctypes). ";

export const rpc_projects_projects_create = defineRpc({
  id: "projects.projects.create",
  title: "Create an open project",
  about:
    HAT_GUARD +
    FIELD_RULES +
    "Then it writes one project, born `open` (project.open), with a `prj_` id, the fields given, its percent-complete " +
    "method (`task-completion` when absent), zero totals, a percent complete of zero (or, worked out by hand, the one " +
    "given), and the caller's principal as its creator. " +
    LOG_LINE,
  was: [`${FRAPPE}/project/project.json`, `${FRAPPE}/project/project.py:108`],
  concept: concept_projects,
  kind: "action",
  who: WHO_MANAGER,
  input: Schema.Struct({ ...OrgInput, ...ProjectFields, name: S }),
  output: Project,
  errors: MANAGE_ERRORS,
  reads: [...HAT_READS, table_organizations, table_project_types],
  writes: [table_projects, ...LOGGED],
  drives: [t.open],
  invokes: [],
  emits: [],
  calls: HAT_CALLS,
  chain: HAT_CHAIN,
  spans: [],
  budget: budget("chain-read"),
});

export const rpc_projects_projects_list = defineRpc({
  id: "projects.projects.list",
  title: "List the Organization's projects, newest first",
  about:
    MEMBER_GUARD +
    "One page of the Organization's projects, newest first (`by_org_status_created`), each as its summary: filtered " +
    "by status, project type, customer (a Party locator or a name) and member (an email or @handle; the projects shared " +
    "with them, by `project-users`' `by_org_party`). A filter value that names nothing gives an empty page; a status " +
    "that is no project status, a `limit` outside 1 to 100 or a cursor this list did not give is INVALID_INPUT.",
  concept: concept_projects,
  kind: "query",
  who: WHO_MEMBER,
  input: Schema.Struct({
    ...OrgInput,
    ...PageInput,
    status: Opt(ProjectStatus),
    type: Opt(S),
    customer: Opt(S),
    member: Opt(S),
  }),
  output: Page(ProjectSummary),
  errors: READ_ERRORS,
  reads: [...MEMBER_READS, table_projects, table_project_users],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("read"),
});

export const rpc_projects_projects_get = defineRpc({
  id: "projects.projects.get",
  title: "Read one project, with its members and its tasks' counts",
  about:
    MEMBER_GUARD +
    "The project by its id (INVALID_INPUT when it is not one of the Organization's: there is no not-found code), with " +
    "its members (`project-users`, each named by their Seat's email or @handle), its tasks counted by status " +
    "(`by_org_project_status`), its totals, actual dates and percent complete as its tasks and submitted timesheets " +
    "made them, and its head name and version.",
  concept: concept_projects,
  kind: "query",
  who: WHO_MEMBER,
  input: OneProject,
  output: Project,
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

export const rpc_projects_projects_change = defineRpc({
  id: "projects.projects.change",
  title: "Change a project's fields",
  about:
    HAT_GUARD +
    "The project by its id (INVALID_INPUT otherwise), in any status. " +
    FIELD_RULES +
    "It sets the fields given, empties those `clear` names (not the name: INVALID_INPUT) and keeps the rest; never its " +
    "status, totals or actual dates, nor its percent complete unless worked out by hand (projects.derived, " +
    "projects.percent-by-hand). A new method from its tasks works the percent out again (task progress and weight " +
    "average each task's progress, a completed or cancelled one counting 100) and moves its status as a task would: an " +
    "open project at 100 completes, a completed one below 100 reopens. " +
    LOG_LINE,
  was: [`${FRAPPE}/project/project.py:267`],
  concept: concept_projects,
  kind: "action",
  who: WHO_MANAGER,
  input: Schema.Struct({ ...OneProject.fields, ...ProjectFields, clear: Opt(Schema.Array(S)) }),
  output: Project,
  errors: MANAGE_ERRORS,
  reads: [...HAT_READS, ...VIEW_READS, table_project_types],
  writes: [table_projects, ...LOGGED],
  drives: [t.complete, t.reopen],
  invokes: [],
  emits: [],
  calls: HAT_CALLS,
  chain: HAT_CHAIN,
  spans: [],
  budget: budget("chain-read"),
});

/**
 * One lifecycle step of a project: People or Director moves its status by one transition, and, where ERPNext's
 * `update_percent_complete` would complete it at once, by `complete` after it in the same write.
 */
const step = (
  verb: "hold" | "resume" | "complete" | "reopen" | "cancel",
  title: string,
  what: string,
  then: readonly (typeof t.complete)[] = [],
) =>
  defineRpc({
    id: `projects.projects.${verb}`,
    title,
    about:
      HAT_GUARD +
      "The project by its id (INVALID_INPUT otherwise). " +
      what +
      " A project in any other status is WRONG_STATE, naming its status, and nothing is written. " +
      LOG_LINE,
    was: [`${FRAPPE}/project/project.py:267`, `${FRAPPE}/project/project.py:305`],
    concept: concept_projects,
    kind: "action",
    who: WHO_MANAGER,
    input: OneProject,
    output: Project,
    errors: HAT_ERRORS,
    reads: [...HAT_READS, ...VIEW_READS],
    writes: [table_projects, ...LOGGED],
    drives: [t[verb], ...then],
    invokes: [],
    emits: [],
    calls: HAT_CALLS,
    chain: HAT_CHAIN,
    spans: [],
    budget: budget("chain-read"),
  });

export const rpc_projects_projects_hold = step(
  "hold",
  "Put an open project on hold",
  "An open project goes on hold (project.hold): its percent complete still moves with its tasks, but no longer moves its status.",
);

export const rpc_projects_projects_resume = step(
  "resume",
  "Take a project off hold",
  "A project on hold opens again (project.resume), and its status follows its percent complete again: one its tasks " +
    "make 100 completes in the same write (project.complete), as ERPNext's `update_percent_complete` does when it is " +
    "set open; one worked out by hand stays open.",
  [t.complete],
);

export const rpc_projects_projects_complete = step(
  "complete",
  "Complete a project whose tasks are all done",
  "An open project completes (project.complete) when its percent complete by its method is 100 (by task completion: " +
    "every task under it completed or cancelled), when it is worked out by hand, or when it has no tasks, which makes " +
    "it worked out by hand (`manual`) as ERPNext does, so a task added later moves neither its percent nor its status; its percent " +
    "complete becomes 100 (ERPNext's `update_percent_complete` and `validate_completed_status`). Any other is " +
    "WRONG_STATE, naming each unfinished task and its status.",
);

export const rpc_projects_projects_reopen = step(
  "reopen",
  "Open a completed or cancelled project again",
  "A completed or cancelled project opens again (project.reopen), its tasks and timesheets as they were. One worked " +
    "out by hand keeps its percent; any other's is worked out again from its tasks, and at 100 it completes again in " +
    "the same write (project.complete), as ERPNext's `update_percent_complete` does, so a completed project its tasks " +
    "still complete is WRONG_STATE: reopen or add one of its tasks instead.",
  [t.complete],
);

export const rpc_projects_projects_cancel = step(
  "cancel",
  "Cancel an open or on-hold project",
  "An open or on-hold project is cancelled (project.cancel) and kept: it is listed with `--status cancelled`, its tasks " +
    "and timesheets stay as they are, and its percent complete no longer moves its status.",
);
