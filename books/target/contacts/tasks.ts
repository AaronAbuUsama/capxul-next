// Contacts' tasks area: Frappe CRM's CRM Task on a contact entry, a lead or a deal, made and moved
// through CRM Task's statuses as Frappe CRM's task board moves them (decision contacts.task-verbs).
// Only a member whose Safe wears the People hat makes or changes one; a task's assignee also moves
// their own (decision contacts.task-assignee); every member reads them.

import { Schema } from "effect";
import { budget, defineRpc } from "../../../packages/book/src/index.ts";
import { concept_contacts } from "../shared/foundation.ts";
import {
  error_INVALID_INPUT,
  error_NOT_AUTHENTICATED,
  error_ROLE_PERMISSION_DENIED,
  error_WRONG_STATE,
} from "../shared/vocabulary.ts";
import { TASK_STATUSES, TaskStage, machine_crm_task, table_crm_tasks, table_timeline_links } from "./data.ts";
import { table_parties } from "../parties/data.ts";
import { table_organizations } from "../organizations/data.ts";
import { LOGGED, WHO_CRM_READ, WHO_CRM_WRITE } from "./leads.ts";
import { CONVERSATION_GUARD, GUARD_READS, RECORD_READS, RECORD_RULE } from "./mail.ts";
import { TaskItem } from "./timeline.ts";

const CRM = "github.com/frappe/crm@2cecd300:crm";
const TASK = `${CRM}/fcrm/doctype/crm_task`;
const S = Schema.String;
const NullOr = Schema.NullOr;

const Status = Schema.Literals(Object.keys(TASK_STATUSES) as [keyof typeof TASK_STATUSES, ...(keyof typeof TASK_STATUSES)[]]);
const Priority = Schema.Literals(["Low", "Medium", "High"]);

/** A task as its own writes and its list return it: the timeline's task, with what it is about and its description. */
export const TaskView = Schema.Struct({
  ...TaskItem.fields,
  description: NullOr(S),
  start_date: NullOr(S),
  completedAt: NullOr(Schema.Number),
  updatedAt: Schema.Number,
});

/** The fields a task's save may set: each given replaces the stored one, null clears it. */
export const TaskFields = Schema.Struct({
  title: Schema.optionalKey(S),
  description: Schema.optionalKey(NullOr(S)),
  priority: Schema.optionalKey(Priority),
  start_date: Schema.optionalKey(NullOr(S)),
  /** An ISO 8601 instant, or a day: the end of that day in the Organization's time zone. */
  due_date: Schema.optionalKey(NullOr(S)),
  /** A member, by email or an agent's @handle. */
  assigned_to: Schema.optionalKey(NullOr(S)),
});

const WRITE_ERRORS = [error_NOT_AUTHENTICATED, error_ROLE_PERMISSION_DENIED, error_INVALID_INPUT];
const ASSIGNEE_RULE =
  "`assigned_to` is a member, named by email or an agent's @handle, holding an active Seat of the Organization (kept " +
  "as its PartyId), else INVALID_INPUT naming it. ";

export const rpc_contacts_tasks_save = defineRpc({
  id: "contacts.tasks.save",
  title: "Make a task on a contact, lead or deal, or change one's fields",
  about:
    CONVERSATION_GUARD +
    "With no `task` (`org crm task create`) it makes one on `record` (`create`), status Backlog unless Todo is given, " +
    "priority Medium unless given. " +
    RECORD_RULE +
    "A title is 1 to 140 characters, a description up to 10,000, `start_date` a day, `due_date` an instant or a day (the " +
    "end of that day in the Organization's time zone), each else INVALID_INPUT naming it. " +
    ASSIGNEE_RULE +
    "With `task` (`org crm task change`) it sets the fields given and keeps the rest; a change that gives nothing, or a " +
    "task id not in this CRM, is INVALID_INPUT; its status moves only by `contacts.tasks.move`. One transaction writes " +
    "the task, on a create its timeline link on its record (at its creation), and its change-log row. Returns the task.",
  concept: concept_contacts,
  kind: "mutation",
  who: WHO_CRM_WRITE,
  input: Schema.Struct({
    orgId: S,
    task: Schema.optionalKey(S),
    record: Schema.optionalKey(S),
    status: Schema.optionalKey(Schema.Literals(["Backlog", "Todo"])),
    fields: TaskFields,
  }),
  output: TaskView,
  errors: [...WRITE_ERRORS, error_WRONG_STATE],
  reads: [...GUARD_READS, ...RECORD_READS, table_crm_tasks, table_parties, table_organizations],
  writes: [table_crm_tasks, table_timeline_links, ...LOGGED],
  drives: [machine_crm_task.t.create],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("write"),
  was: [`${TASK}/crm_task.json`, `${TASK}/crm_task.py:30`],
});

export const rpc_contacts_tasks_move = defineRpc({
  id: "contacts.tasks.move",
  title: "Move a task to another of CRM Task's statuses",
  about:
    "It first checks the caller's Seat wears the People hat, or that the caller is the task's assignee, moving their " +
    "own task (contacts.task-assignee), else ROLE_PERMISSION_DENIED and nothing is written. It sets the task's status " +
    "to Backlog, Todo, In Progress, Done or Canceled. The status names the stage: within the same stage only `status` " +
    "changes; to another it drives `start`, `complete` (setting `completed_at` to the world's now), `cancel` or " +
    "`reopen`. The same status again returns the task unchanged. A task id not in this CRM is INVALID_INPUT. The change " +
    "goes to the change log (contacts.change-log). Returns the task.",
  concept: concept_contacts,
  kind: "mutation",
  who:
    "A member whose Safe wears the Organization's People hat when the call is made, or the task's assignee for their " +
    "own task, a person's Seat or an agent's. Any other member reads but is ROLE_PERMISSION_DENIED with nothing written.",
  input: Schema.Struct({ orgId: S, task: S, status: Status }),
  output: TaskView,
  errors: WRITE_ERRORS,
  reads: [...GUARD_READS, table_crm_tasks],
  writes: [table_crm_tasks, ...LOGGED],
  drives: [machine_crm_task.t.start, machine_crm_task.t.complete, machine_crm_task.t.cancel, machine_crm_task.t.reopen],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("write"),
  was: [`${TASK}/crm_task.json`],
});

export const rpc_contacts_tasks_list = defineRpc({
  id: "contacts.tasks.list",
  title: "List the Organization's CRM tasks, soonest due first",
  about:
    "One page of the Organization's CRM tasks, as Frappe CRM's Tasks page lists them: soonest due first, tasks with no " +
    "due date after, then newest; by default those open or working, or those at the `stages` given. `assigned_to` (a " +
    "member by email or @handle) keeps one member's, `record` one record's (an entry's, a lead's or a deal's id); the " +
    "filters apply together. `limit` is 1 to 100 (25 when absent); `after` is the cursor the last page gave, bound to " +
    "this Organization and filters, and another, or a forged one, is INVALID_INPUT, as is a member or record not in " +
    "this CRM.",
  concept: concept_contacts,
  kind: "query",
  who: WHO_CRM_READ,
  input: Schema.Struct({
    orgId: S,
    stages: Schema.optionalKey(Schema.Array(TaskStage)),
    assigned_to: Schema.optionalKey(S),
    record: Schema.optionalKey(S),
    limit: Schema.optionalKey(Schema.Int),
    after: Schema.optionalKey(S),
  }),
  output: Schema.Struct({ items: Schema.Array(TaskView), nextCursor: NullOr(S) }),
  errors: [error_NOT_AUTHENTICATED, error_ROLE_PERMISSION_DENIED, error_INVALID_INPUT],
  reads: [table_crm_tasks, table_parties, ...GUARD_READS, ...RECORD_READS],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("read"),
  was: [`${TASK}/crm_task.py:57`],
});
