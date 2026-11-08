// The members area: Frappe's Project User rows, who a project is shared with. People or a Director
// adds and removes them (projects.permissions). A member is named as everywhere in the CLI, by an
// email or an agent's @handle, and must hold an active Seat: Frappe shares a project with a user, and
// a head user who is no member is the head's own (projects.named-people).

import { Schema } from "effect";
import { budget, defineRpc } from "../../../packages/book/src/index.ts";
import { concept_projects } from "../shared/foundation.ts";
import { table_project_users, table_projects, table_tasks } from "./data.ts";
import { FRAPPE, HAT_CALLS, HAT_CHAIN, HAT_ERRORS, HAT_GUARD, HAT_READS, LOG_LINE, LOGGED, WHO_MANAGER } from "./guards.ts";
import { OrgInput, Project } from "./shapes.ts";

const S = Schema.String;
const OneMember = Schema.Struct({ ...OrgInput, project: S, member: S });

const RESOLVE =
  "The project by its id, in any status, and the member by an email or an agent's @handle, resolved through parties' " +
  "directory to a Party that holds an active Seat here (INVALID_INPUT naming the field otherwise: someone outside the " +
  "Organization is shared nothing). ";

export const rpc_projects_members_add = defineRpc({
  id: "projects.members.add",
  title: "Share a project with a member",
  about:
    HAT_GUARD +
    RESOLVE +
    "It writes one Project User row for them (not seeing attachments, timesheets not hidden, as Frappe's row defaults). " +
    "A member it is already shared with is WRONG_STATE, naming them, and nothing is written, as `org department holder " +
    "add` refuses a holder (projects.refusal-codes). " +
    LOG_LINE,
  was: [`${FRAPPE}/project_user/project_user.json`, `${FRAPPE}/project/project.py:422`],
  concept: concept_projects,
  kind: "action",
  who: WHO_MANAGER,
  input: OneMember,
  output: Project,
  errors: HAT_ERRORS,
  reads: [...HAT_READS, table_projects, table_project_users, table_tasks],
  writes: [table_project_users, ...LOGGED],
  drives: [],
  invokes: [],
  emits: [],
  calls: HAT_CALLS,
  chain: HAT_CHAIN,
  spans: [],
  budget: budget("chain-read"),
});

export const rpc_projects_members_remove = defineRpc({
  id: "projects.members.remove",
  title: "Stop sharing a project with a member",
  about:
    HAT_GUARD +
    RESOLVE +
    "It deletes their Project User row; a member the project is not shared with is WRONG_STATE, naming them, as `org " +
    "department holder remove` refuses one who holds nothing (projects.refusal-codes). Their tasks, time " +
    "logs and timesheets on the project are kept, and they still read it as any member reads every project " +
    "(projects.permissions): sharing is Frappe's list of the project's users, which a head uses for its portal and " +
    "its project emails. " +
    LOG_LINE,
  was: [`${FRAPPE}/project_user/project_user.json`, `${FRAPPE}/project/project.py:422`],
  concept: concept_projects,
  kind: "action",
  who: WHO_MANAGER,
  input: OneMember,
  output: Project,
  errors: HAT_ERRORS,
  reads: [...HAT_READS, table_projects, table_project_users, table_tasks],
  writes: [table_project_users, ...LOGGED],
  drives: [],
  invokes: [],
  emits: [],
  calls: HAT_CALLS,
  chain: HAT_CHAIN,
  spans: [],
  budget: budget("chain-read"),
});
