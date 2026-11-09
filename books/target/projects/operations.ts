// The projects commands: 35 new operations beyond the 215, booked under rules.new-operations
// (CONVENTIONS rule 4a) on the pack projects.commands, which serves aaron.projects and
// aaron.frappe-shape and which Aaron accepted on 8 November 2026. They are exactly
// docs/design/new-commands.md section 5.1, in its one grammar: each acts for the Organization
// `--org` names (else `use org`'s), each id is its command's words joined by dots, and each is one
// SDK method under `client.org(orgId)`, implemented by one rpc of this concept, so no flow is needed.
//
// Who may run each follows docs/design/authority.md: a Seat or a hat, never a named person
// (projects.permissions). People-or-Director commands read the caller's hat live, so their budget is
// `chain-read` (projects.hat-guard). The commands a pilot's first engagement needs are `critical`
// (projects.critical-commands); the rest are `normal`.
//
// Every refusal starts from a catalogued world, or from `org-with-projects`, which this concept asks
// devnet to build (projects.worlds): Acme's projects, tasks and timesheets in each state a refusal
// needs, from org-with-member (Dana, founder and Director, with the People hat; Sam, a Seat with no
// hat; Olga outside).

import { budget, defineOperation, type Ref } from "../../../packages/book/src/index.ts";
import {
  error_CLI_USAGE,
  error_INVALID_INPUT,
  error_NOT_AUTHENTICATED,
  error_PROVIDER_ERROR,
  error_ROLE_PERMISSION_DENIED,
  error_WRONG_STATE,
} from "../shared/vocabulary.ts";
import {
  rpc_projects_projects_cancel,
  rpc_projects_projects_change,
  rpc_projects_projects_complete,
  rpc_projects_projects_create,
  rpc_projects_projects_get,
  rpc_projects_projects_hold,
  rpc_projects_projects_list,
  rpc_projects_projects_reopen,
  rpc_projects_projects_resume,
} from "./projects.ts";
import { rpc_projects_members_add, rpc_projects_members_remove } from "./members.ts";
import { rpc_projects_settings_set, rpc_projects_settings_show } from "./settings.ts";
import {
  rpc_projects_tasks_cancel,
  rpc_projects_tasks_change,
  rpc_projects_tasks_complete,
  rpc_projects_tasks_create,
  rpc_projects_tasks_get,
  rpc_projects_tasks_list,
  rpc_projects_tasks_reopen,
  rpc_projects_tasks_review,
  rpc_projects_tasks_start,
} from "./tasks.ts";
import {
  rpc_projects_timesheets_cancel,
  rpc_projects_timesheets_create,
  rpc_projects_timesheets_get,
  rpc_projects_timesheets_list,
  rpc_projects_timesheets_log,
  rpc_projects_timesheets_submit,
} from "./timesheets.ts";
import {
  rpc_projects_activity_types_add,
  rpc_projects_activity_types_change,
  rpc_projects_activity_types_disable,
  rpc_projects_activity_types_enable,
  rpc_projects_activity_types_list,
} from "./activity-types.ts";
import { rpc_projects_project_types_add, rpc_projects_project_types_list } from "./project-types.ts";
import {
  ActivityType,
  Page,
  Project,
  ProjectSummary,
  ProjectType,
  Settings,
  Task,
  TaskSummary,
  Timesheet,
  TimesheetSummary,
} from "./shapes.ts";
import { WHO_MANAGER, WHO_MEMBER, WHO_WORKER } from "./guards.ts";

// ── the worlds every refusal starts from (projects.worlds) ──────────────────────────────────

/** Built from org-with-member by projects commands (and requests' `org projects timesheet bill`); devnet catalogues it. */
export const WORLD = "org-with-projects";
const SIGNED_OUT = "signed-out";
const WITH_MEMBER = "org-with-member";
/** org-with-projects with chain-rpc's fault switch failing every read; devnet catalogues it too. */
export const CHAIN_DOWN = "org-with-projects-chain-unreachable";

const AREA = "projects";
const NOTHING_READ = "Nothing: it only reads.";

const claim = (text: string, observes: string) => ({ claim: text, observes });
/** One refusal: its error, the world it starts from, and when. */
type Refusal = { readonly error: Ref<"error">; readonly given: string; readonly when: string };

const signedOut = {
  error: error_NOT_AUTHENTICATED,
  given: SIGNED_OUT,
  when: "No one is signed in on this machine: nothing is read or written.",
};
const outsider = {
  error: error_ROLE_PERMISSION_DENIED,
  given: WITH_MEMBER,
  when: "Olga, signed in, names Acme with `--org`, where she holds no Seat: nothing is read or written.",
};
/** A member without the People or Director hat runs a People-or-Director command. */
const noHat = (what: string) => ({
  error: error_ROLE_PERMISSION_DENIED,
  given: WORLD,
  when: `Sam, a member of Acme whose Safe wears neither the People hat nor the Director hat, ${what}: nothing is written.`,
});
/** The chain cannot answer the hat guard. */
const hatUnread = (what: string) => ({
  error: error_PROVIDER_ERROR,
  given: CHAIN_DOWN,
  when: `Dana, who wears Acme's People and Director hats, ${what} while every chain node fails, so her hat cannot be read: nothing is written.`,
});
const invalid = (when: string, given: string = WORLD) => ({ error: error_INVALID_INPUT, given, when });
const wrong = (when: string) => ({ error: error_WRONG_STATE, given: WORLD, when });

/** The refusals every People-or-Director command shares. */
const managed = (what: string) => [signedOut, outsider, noHat(what), hatUnread(what)];
/** The refusals every Member command shares. */
const membered = [signedOut, outsider];

/** A list's own bad input. */
const badPage = (filter: string) =>
  invalid(`A cursor this list did not give, a \`--limit\` outside 1 to 100, or ${filter}: nothing is listed.`);

const unknown = (kind: string, id: string) =>
  invalid(`The ${kind} named is none of Acme's (a well-formed \`${id}\` id that names nothing here): there is no not-found code.`);

const ERRORS = [error_CLI_USAGE];
const PAGE_NOTES = ["It shows 25 at a time by default. `--limit` takes 1 to 100.", "When there are more, `nextCursor` is the `--after` value for the next page."];

// ── projects ────────────────────────────────────────────────────────────────────────────────

export const operation_org_projects_create = defineOperation({
  id: "org.projects.create",
  title: "Create a project",
  about:
    "Creates an open project for the Organization: its name and, as you choose, its project type, priority, expected " +
    "start and end days, customer, how its percent complete is worked out (by hand with `--percent`, or from its " +
    "tasks' completion, progress or weight; task completion when not given), department, cost center, estimated cost " +
    "and notes. Its totals and actual dates are worked out from its tasks and submitted timesheets, never typed, and " +
    "so is its percent complete unless it is worked out by hand. A " +
    "customer on Capxul is named as a Party (an email, an @handle, a 0x address or a Party id); any other text is kept " +
    "as the name of a customer who is not on Capxul.",
  area: AREA,
  command: "org projects create",
  priority: "critical",
  implementedBy: rpc_projects_projects_create,
  who: WHO_MANAGER,
  changes: "One open project, and its entry in the Organization's projects change log, which a connected head receives.",
  acceptance: [
    claim(
      "A project is created open with the fields given, zero totals and zero percent complete, and is the first the list shows.",
      "cli: the `--json` output has a `prj_` id, `status: open`, the name, type, priority and days given, " +
        "a percent complete of 0 and zero totals; read: `org projects get <id>` prints the same record, and `org projects " +
        "list` lists it first.",
    ),
    claim(
      "A customer given as a Party is held as that Party; any other text is held as the customer's name alone.",
      "cli: `--customer olga@outside.test` prints `customer.partyId` Olga's Party id; `--customer \"Northwind Ltd\"` " +
        "prints `customer.partyId: null` and `customer.name` \"Northwind Ltd\".",
    ),
    claim(
      "Authority is the hat worn when the command runs: a member is refused without the People hat, admitted once the " +
        "Board grants it to their Safe, and refused again once it is taken back.",
      "cli: in org-with-member, Sam's create is ROLE_PERMISSION_DENIED; after Dana's `org member grant sam@acme.test " +
        "--permission manage-people` executes (she approves its proposal as the one Director), the same command by Sam " +
        "prints an open project; after `org member revoke sam@acme.test --permission manage-people` executes, it is " +
        "ROLE_PERMISSION_DENIED again; world: each refusal's diff is empty.",
    ),
  ],
  returns: Project,
  errors: ERRORS,
  refusals: [
    ...managed("creates a project"),
    invalid(
      "An empty name, a `--type` that is none of Acme's project types, an `--end` before the `--start`, a negative " +
        "`--estimated-cost`, or a `--customer` written as an email, @handle, address or Party id that names no Party: the " +
        "refusal names the field and nothing is written.",
      WITH_MEMBER,
    ),
  ],
  budget: budget("chain-read"),
});

export const operation_org_projects_list = defineOperation({
  id: "org.projects.list",
  title: "List the Organization's projects",
  about:
    "Lists the Organization's projects, newest first, a page at a time: each with its status, type, priority, " +
    "customer, percent complete and expected end. Filter by `--status`, `--type`, `--customer` or `--member` (the " +
    "projects shared with that member). Use it to find a project's id for `org projects get`.",
  area: AREA,
  command: "org projects list",
  priority: "critical",
  implementedBy: rpc_projects_projects_list,
  who: WHO_MEMBER,
  changes: NOTHING_READ,
  notes: PAGE_NOTES,
  acceptance: [
    claim(
      "Every member sees every project of the Organization, newest first, filtered as asked.",
      "read: in org-with-projects, Sam (a Seat with no hat) lists Archive, Handover, Retainer and Website, newest first; " +
        "`--status on_hold` lists only Retainer; `--member sam@acme.test` lists only Website.",
    ),
    claim(
      "A page holds at most `--limit` projects and gives the cursor for the next; the last page's cursor is null.",
      "cli: `--limit 2` prints two projects and a `nextCursor`; `--after <it>` prints the other two and `nextCursor: null`.",
    ),
  ],
  returns: Page(ProjectSummary),
  errors: ERRORS,
  refusals: [...membered, badPage("a `--status` that is no project status")],
  budget: budget("read"),
});

export const operation_org_projects_get = defineOperation({
  id: "org.projects.get",
  title: "Show one project",
  about:
    "Shows one project: its fields, its members, its tasks counted by status, its actual dates and time, its costing " +
    "and billable totals and its percent complete, as its tasks and submitted timesheets make them.",
  area: AREA,
  command: "org projects get",
  priority: "critical",
  implementedBy: rpc_projects_projects_get,
  who: WHO_MEMBER,
  changes: NOTHING_READ,
  acceptance: [
    claim(
      "The project shows its members, its tasks by status, the hours of its submitted timesheets and its percent " +
        "complete as its method works it out.",
      "read: in org-with-projects, `org projects get <Website>` lists Sam among its members, counts five tasks (one " +
        "completed, one working, three open), shows `actualTime` the hours of its submitted timesheets, and " +
        "a percent complete of 20: one of five tasks completed or cancelled.",
    ),
    claim(
      "Any member reads any project, shared with them or not, and reading it writes nothing.",
      "read: in org-with-projects, Sam's `org projects get <Retainer>`, which is not shared with him, prints Retainer with " +
        "`status: on_hold` and its fields; world: the diff is empty, and a second `org projects get` prints the same `version`.",
    ),
    claim(
      "A project worked out by hand shows the percent it was given, whatever its tasks.",
      "read: in org-with-projects, `org projects get <Handover>` shows `status: completed`, `progress: manual`, a percent " +
        "complete of 100 and no tasks.",
    ),
  ],
  returns: Project,
  errors: ERRORS,
  refusals: [...membered, unknown("project", "prj_…")],
  budget: budget("read"),
});

export const operation_org_projects_change = defineOperation({
  id: "org.projects.change",
  title: "Change a project's fields",
  about:
    "Changes a project's fields, with the flags `org projects create` takes; `--clear <field>` empties one. The fields " +
    "not given are kept, and a change that gives none is refused. No flag sets its status, which `hold`, `resume`, " +
    "`complete`, `reopen` and `cancel` move, except that a new `--progress` method from its tasks works its percent " +
    "out again and, as a task's change would, completes an open project at 100 or opens a completed one below it. " +
    "Its totals and actual dates are worked out, never set; its percent complete is set with `--percent` only when it " +
    "is worked out by hand (`--progress manual`).",
  area: AREA,
  command: "org projects change",
  priority: "normal",
  implementedBy: rpc_projects_projects_change,
  who: WHO_MANAGER,
  changes: "The project's fields, and its entry in the change log.",
  acceptance: [
    claim(
      "Only the fields given change; `--clear` empties one; the rest are kept.",
      "cli: `--priority high` prints the project with priority high and every other field as before; `--clear customer` " +
        "prints `customer` with both values null; read: `org projects get` agrees with each.",
    ),
    claim(
      "No flag sets a project's status, totals or actual dates, and its percent complete is typed only when it is worked out by hand.",
      "cli: `org projects change <Website> --status completed` is CLI_USAGE, and `--percent 50` on Website, worked out by " +
        "task completion, is INVALID_INPUT naming `percent`; read: `org projects get` shows Website still open at 20; " +
        "world: each diff is empty.",
    ),
    claim(
      "A project worked out by hand takes the percent given and keeps its status; one worked out by task progress " +
        "averages its tasks' typed percents, a completed or cancelled task counting 100.",
      "cli: `org projects change <Retainer> --progress manual --percent 40` prints `progress: manual`, a percent complete " +
        "of 40 and `status: on_hold`; after `org projects task change <Build> --percent 50`, `org projects change <Website> " +
        "--progress task-progress` prints a percent complete of 30 (Spec 100, Build 50, the other three 0).",
    ),
  ],
  returns: Project,
  errors: ERRORS,
  refusals: [
    ...managed("changes Website's priority"),
    unknown("project", "prj_…"),
    invalid(
      "`--clear name`, an empty name, a `--type` that is none of Acme's, an `--end` before the `--start`, a " +
        "`--percent` for Website, which is not worked out by hand, or no flag at all: the refusal names the field, or " +
        "says nothing was given.",
    ),
  ],
  budget: budget("chain-read"),
});

/** One lifecycle command of a project. */
const projectStep = (
  verb: "hold" | "resume" | "complete" | "reopen" | "cancel",
  spec: {
    title: string;
    about: string;
    rpc: typeof rpc_projects_projects_hold;
    claims: readonly { claim: string; observes: string }[];
    wrongState: string;
  },
) =>
  defineOperation({
    id: `org.projects.${verb}`,
    title: spec.title,
    about: spec.about,
    area: AREA,
    command: `org projects ${verb}`,
    priority: "normal",
    implementedBy: spec.rpc,
    who: WHO_MANAGER,
    changes: "The project's status, and its entry in the change log.",
    acceptance: [...spec.claims],
    returns: Project,
    errors: ERRORS,
    refusals: [...managed(`runs \`org projects ${verb}\` on Website`), unknown("project", "prj_…"), wrong(spec.wrongState)],
    budget: budget("chain-read"),
  });

export const operation_org_projects_hold = projectStep("hold", {
  title: "Put a project on hold",
  about:
    "Puts an open project on hold. Its tasks can still be worked and its percent complete still moves, but it no " +
    "longer completes or reopens by itself until it is resumed.",
  rpc: rpc_projects_projects_hold,
  claims: [
    claim(
      "An open project goes on hold, and finishing its tasks no longer completes it.",
      "cli: `org projects hold <Website>` prints `status: on_hold`; read: after its unfinished tasks are completed or " +
        "cancelled, `org projects get` shows a percent complete of 100 and the status still on_hold.",
    ),
    claim(
      "Holding is one status change, recorded once.",
      "cli: in org-with-projects, `org projects hold <Website> --json` prints `status: on_hold` and a `version` above the " +
        "one `org projects get <Website>` printed before; trace: exactly one project_transitioned open → on_hold.",
    ),
    claim(
      "Holding a project again is refused and changes nothing.",
      "cli: in org-with-projects, after `org projects hold <Website>`, the same command again is WRONG_STATE naming " +
        "`on_hold`, and so is `org projects hold <Retainer>`; world: each diff is empty.",
    ),
  ],
  wrongState: "Handover (completed) or Archive (cancelled): only an open project goes on hold. The refusal names its status.",
});

export const operation_org_projects_resume = projectStep("resume", {
  title: "Take a project off hold",
  about:
    "Takes a project off hold: it is open again, and its status follows its percent complete from then on, so one " +
    "whose tasks are all done completes at once.",
  rpc: rpc_projects_projects_resume,
  claims: [
    claim(
      "A project on hold is open again.",
      "cli: `org projects resume <Retainer>` prints `status: open`; read: `org projects list --status on_hold` no longer lists it.",
    ),
    claim(
      "A project on hold whose tasks are all done completes as it is resumed.",
      "cli: in org-with-projects, after `org projects hold <Website>` and Design, Build, Announce and Launch each " +
        "completed, `org projects resume <Website>` prints `status: completed` and a percent complete of 100; trace: one " +
        "project_transitioned on_hold → open, then one open → completed.",
    ),
    claim(
      "Resuming a project that is not on hold is refused and changes nothing, so a repeated resume is refused.",
      "cli: in org-with-projects, after `org projects resume <Retainer>`, the same command again is WRONG_STATE naming " +
        "`open`; world: the diff is empty.",
    ),
  ],
  wrongState: "Website, which is open: only a project on hold resumes. The refusal names its status.",
});

export const operation_org_projects_complete = projectStep("complete", {
  title: "Complete a project",
  about:
    "Completes an open project whose tasks make it 100 percent complete (with task completion: all completed or " +
    "cancelled), one worked out by hand, or one with no tasks, which from then on is worked out by hand, as ERPNext " +
    "does; its percent complete becomes 100. A project with an unfinished task is refused, naming each one: finish or " +
    "cancel them first.",
  rpc: rpc_projects_projects_complete,
  claims: [
    claim(
      "An open project with no tasks completes at 100 percent, worked out by hand from then on.",
      "cli: a project just created with no tasks prints `status: completed`, a percent complete of 100 and `progress: " +
        "manual` after `org projects complete`; read: after `org projects task create Review --project <it>`, `org projects get` " +
        "still shows it completed at 100.",
    ),
    claim(
      "A project with an unfinished task stays open, and the refusal names each unfinished task.",
      "cli: `org projects complete <Website>` is WRONG_STATE naming Design, Build, Launch and Announce with their " +
        "statuses; world: the diff is empty.",
    ),
  ],
  wrongState: "Website, with four unfinished tasks (named in the refusal), or Retainer, on hold.",
});

export const operation_org_projects_reopen = projectStep("reopen", {
  title: "Reopen a completed or cancelled project",
  about:
    "Opens a completed or cancelled project again, with its tasks and timesheets as they were. A completed project " +
    "whose tasks still make it 100 percent is refused: reopen or add one of its tasks instead.",
  rpc: rpc_projects_projects_reopen,
  claims: [
    claim(
      "A completed or a cancelled project is open again, its tasks unchanged.",
      "cli: `org projects reopen <Handover>` and `org projects reopen <Archive>` each print `status: open`; read: `org projects task " +
        "list --project <each>` lists the same tasks with the same statuses as before.",
    ),
    claim(
      "A project worked out by hand reopens with the percent it had and stays open.",
      "cli: in org-with-projects, `org projects reopen <Handover>` prints `status: open`, `progress: manual` and a percent " +
        "complete of 100; read: `org projects get <Handover>` still shows it open.",
    ),
    claim(
      "A project its tasks still complete is not reopened, and reopening an open project again is refused; neither changes anything.",
      "cli: in org-with-projects, after Design, Build, Announce and Launch are each completed (Website completes), `org " +
        "projects reopen <Website>` is WRONG_STATE; after `org projects reopen <Archive>`, the same command again is " +
        "WRONG_STATE naming `open`; world: each diff is empty.",
    ),
  ],
  wrongState: "Website, which is open: only a completed or cancelled project reopens.",
});

export const operation_org_projects_cancel = projectStep("cancel", {
  title: "Cancel a project",
  about:
    "Cancels an open or on-hold project. It is kept, with its tasks and timesheets: `org projects list --status " +
    "cancelled` still lists it, and `org projects reopen` opens it again.",
  rpc: rpc_projects_projects_cancel,
  claims: [
    claim(
      "An open or on-hold project is cancelled and kept.",
      "cli: `org projects cancel <Retainer>` prints `status: cancelled`; read: `org projects get <Retainer>` still returns " +
        "it, and `org projects list --status cancelled` lists it beside Archive.",
    ),
    claim(
      "A cancelled project keeps its tasks and timesheets as they were, and finishing its tasks no longer moves its status.",
      "cli: in org-with-projects, `org projects cancel <Website>` prints `status: cancelled`; read: `org projects task " +
        "list --project <Website>` lists the same five tasks with the same statuses and `org projects timesheet list " +
        "--project <Website>` the same timesheets; after Design, Build, Announce and Launch are each completed, `org " +
        "projects get <Website>` shows a percent complete of 100 and `status: cancelled`.",
    ),
    claim(
      "Cancelling a project again is refused and changes nothing.",
      "cli: in org-with-projects, after `org projects cancel <Retainer>`, the same command again is WRONG_STATE naming " +
        "`cancelled`; world: the diff is empty.",
    ),
  ],
  wrongState: "Handover (completed) or Archive (already cancelled): only an open or on-hold project is cancelled.",
});

// ── project members ─────────────────────────────────────────────────────────────────────────

export const operation_org_projects_member_add = defineOperation({
  id: "org.projects.member.add",
  title: "Share a project with a member",
  about:
    "Shares a project with a member of the Organization, named by their email or an agent's @handle: Frappe's Project " +
    "User, which a connected head uses for its portal and project emails. Every member reads every project already; " +
    "sharing says who works on it.",
  area: AREA,
  command: "org projects member add",
  priority: "normal",
  implementedBy: rpc_projects_members_add,
  who: WHO_MANAGER,
  changes: "One Project User row on the project, and the project's entry in the change log.",
  acceptance: [
    claim(
      "The member is shared the project: it lists them, and the project list finds it by them.",
      "cli: `org projects member add <Retainer> sam@acme.test` prints Retainer with Sam among its members; read: `org " +
        "projects list --member sam@acme.test` lists Retainer and Website.",
    ),
    claim(
      "Adding a member the project is already shared with is refused, as adding a department's holder again is.",
      "cli: `org projects member add <Website> sam@acme.test` is WRONG_STATE naming Sam; world: the diff is empty.",
    ),
  ],
  returns: Project,
  errors: ERRORS,
  refusals: [
    ...managed("shares Website with a member"),
    unknown("project", "prj_…"),
    invalid("The member named is Olga, who holds no Seat in Acme, or an email or @handle no Party holds: the refusal names the member."),
    wrong("Website is already shared with Sam: the refusal names him, as `org department holder add` names a holder."),
  ],
  budget: budget("chain-read"),
});

export const operation_org_projects_member_remove = defineOperation({
  id: "org.projects.member.remove",
  title: "Stop sharing a project with a member",
  about:
    "Stops sharing a project with a member. Their tasks, time logs and timesheets on it are kept, and they still read " +
    "it, as every member reads every project.",
  area: AREA,
  command: "org projects member remove",
  priority: "normal",
  implementedBy: rpc_projects_members_remove,
  who: WHO_MANAGER,
  changes: "One Project User row removed, and the project's entry in the change log.",
  acceptance: [
    claim(
      "The member is no longer shared the project, and their time on it is kept.",
      "cli: `org projects member remove <Website> sam@acme.test` prints Website without Sam among its members; read: " +
        "`org projects timesheet list --for sam@acme.test` lists the same timesheets as before, and Sam's `org projects get " +
        "<Website>` still returns it.",
    ),
    claim(
      "The project list no longer finds the project by that member, and removing them again is refused.",
      "read: in org-with-projects, after `org projects member remove <Website> sam@acme.test`, `org projects list --member " +
        "sam@acme.test` is an empty page; cli: the same remove again is WRONG_STATE naming Sam; world: that refusal's diff is empty.",
    ),
  ],
  returns: Project,
  errors: ERRORS,
  refusals: [
    ...managed("stops sharing Website with a member"),
    unknown("project", "prj_…"),
    invalid("The member named is Olga, who holds no Seat in Acme: the refusal names the member."),
    wrong(
      "Retainer is not shared with Dana, the member named: the refusal names her, as `org department holder remove` " +
        "names someone who holds nothing.",
    ),
  ],
  budget: budget("chain-read"),
});

// ── projects settings ───────────────────────────────────────────────────────────────────────

export const operation_org_projects_settings_show = defineOperation({
  id: "org.projects.settings.show",
  title: "Show the Projects Settings",
  about:
    "Shows the Organization's Projects Settings: whether one worker's time logs may overlap, whether one employee's " +
    "may, and whether an invoice fetches timesheets. Every Organization starts with all three off.",
  area: AREA,
  command: "org projects settings show",
  priority: "normal",
  implementedBy: rpc_projects_settings_show,
  who: WHO_MEMBER,
  changes: NOTHING_READ,
  acceptance: [
    claim(
      "A new Organization's settings are all off, and any member reads them.",
      "read: in org-ready, `org projects settings show` prints `allowUserOverlap`, `allowEmployeeOverlap` and " +
        "`fetchTimesheets` false; in org-with-member, Sam reads the same.",
    ),
    claim(
      "It shows the values last set, and reading them writes nothing.",
      "read: in org-with-member, after Dana's `org projects settings set --allow-user-overlap`, Sam's `org projects " +
        "settings show` prints `allowUserOverlap: true` and the other two false; world: the show's diff is empty.",
    ),
  ],
  returns: Settings,
  errors: ERRORS,
  refusals: membered,
  budget: budget("read"),
});

export const operation_org_projects_settings_set = defineOperation({
  id: "org.projects.settings.set",
  title: "Set the Projects Settings",
  about:
    "Sets the Projects Settings given, each with its `--no-` form, and keeps the rest. The next time log is checked " +
    "against the new values, and so are a draft's earlier logs when it next takes a log or is submitted; a submitted " +
    "timesheet's logs are not checked again.",
  area: AREA,
  command: "org projects settings set",
  priority: "normal",
  implementedBy: rpc_projects_settings_set,
  who: WHO_MANAGER,
  changes: "The Organization's Projects Settings.",
  acceptance: [
    claim(
      "The values given are set and the rest kept, and the next time log is checked against them.",
      "cli: `--allow-user-overlap` prints `allowUserOverlap: true` and the other two unchanged; then, in " +
        "org-with-projects, a log by Sam that overlaps his draft's log, which was INVALID_INPUT before, is added.",
    ),
    claim(
      "A `--no-` form turns a setting off, and setting a value it already has is not refused.",
      "cli: in org-ready, after Dana's `--allow-user-overlap`, her `org projects settings set --no-allow-user-overlap` " +
        "prints all three false; running it again prints the same three, exit 0.",
    ),
    claim(
      "A draft is checked against the settings as they are when it is submitted, not as they were when it took its logs.",
      "cli: in org-with-projects, after Dana's `--allow-user-overlap` Sam logs time on his draft that overlaps its first " +
        "log; after her `--no-allow-user-overlap`, his `org projects timesheet submit <his draft>` is INVALID_INPUT naming the " +
        "overlapping row; read: `org projects timesheet get` shows it still a draft.",
    ),
  ],
  returns: Settings,
  errors: ERRORS,
  refusals: [
    ...managed("sets the Projects Settings"),
    invalid("No setting given, neither a flag nor its `--no-` form: the refusal says so and nothing is written.", "org-ready"),
  ],
  budget: budget("chain-read"),
});

// ── tasks ───────────────────────────────────────────────────────────────────────────────────

export const operation_org_projects_task_create = defineOperation({
  id: "org.projects.task.create",
  title: "Create a task",
  about:
    "Creates an open task: its subject and, as you choose, its project, its parent group task, the tasks it depends " +
    "on, its expected start and end (days or times, within its project's days), expected hours, weight, percent " +
    "complete (`--percent`), priority, whether " +
    "it is a group or a milestone, and its type. A parent must be a group task of the same project that is not " +
    "completed, and no dependency or parent may make a cycle. A task created under a project its tasks had completed " +
    "opens the project again.",
  area: AREA,
  command: "org projects task create",
  priority: "critical",
  implementedBy: rpc_projects_tasks_create,
  who: WHO_MEMBER,
  changes: "One open task, its project's percent complete, and their entries in the change log.",
  acceptance: [
    claim(
      "Any member creates an open task with the fields given, and its project counts it.",
      "cli: Sam's `org projects task create Test --project <Website> --depends-on <Build> --hours 3` prints a `tsk_` task, open, " +
        "depending on Build; read: `org projects get <Website>` counts six tasks and a percent complete of 16.67.",
    ),
    claim(
      "A task created under a project its tasks had completed opens the project again.",
      "cli: after Design, Build, Announce and Launch are completed (Website completes), `org projects task create Review " +
        "--project <Website>` prints an open task; read: `org projects get <Website>` shows `status: open` and a percent " +
        "complete of 83.33.",
    ),
  ],
  returns: Task,
  errors: ERRORS,
  refusals: [
    ...membered,
    invalid(
      "An empty subject; a `--project`, `--parent` or `--depends-on` that names nothing of Acme's; a parent that is not " +
        "a group (Design, Spec), or one in another project (Launch, for a task of Retainer); a dependency on the task " +
        "itself or one that makes a cycle; an `--end` before the `--start`: the refusal names the field and nothing is " +
        "written.",
    ),
  ],
  budget: budget("write"),
});

export const operation_org_projects_task_list = defineOperation({
  id: "org.projects.task.list",
  title: "List the Organization's tasks",
  about:
    "Lists the Organization's tasks, earliest expected end first, a page at a time, with their status, priority and " +
    "percent complete. Filter by `--project`, `--status` or `--parent`.",
  area: AREA,
  command: "org projects task list",
  priority: "critical",
  implementedBy: rpc_projects_tasks_list,
  who: WHO_MEMBER,
  changes: NOTHING_READ,
  notes: PAGE_NOTES,
  acceptance: [
    claim(
      "Every member sees the Organization's tasks by expected end, filtered as asked.",
      "read: in org-with-projects, Sam's `org projects task list --project <Website>` lists its five tasks earliest expected end " +
        "first; `--parent <Launch>` lists only Announce; `--status completed` lists only Spec.",
    ),
    claim(
      "A page holds at most `--limit` tasks and gives the cursor for the next; the last page's cursor is null.",
      "cli: in org-with-projects, `org projects task list --project <Website> --limit 2` prints two tasks and a " +
        "`nextCursor`; following each cursor with `--after` prints two more, then the fifth with `nextCursor: null`; " +
        "world: the diff is empty.",
    ),
  ],
  returns: Page(TaskSummary),
  errors: ERRORS,
  refusals: [...membered, badPage("a `--status` that is no task status")],
  budget: budget("read"),
});

export const operation_org_projects_task_get = defineOperation({
  id: "org.projects.task.get",
  title: "Show one task",
  about: "Shows one task: its fields, the tasks it depends on and its children with their statuses, its logged time and totals, and who completed it and when.",
  area: AREA,
  command: "org projects task get",
  priority: "normal",
  implementedBy: rpc_projects_tasks_get,
  who: WHO_MEMBER,
  changes: NOTHING_READ,
  acceptance: [
    claim(
      "A task shows its dependencies and children with their statuses, and the time its submitted timesheets logged.",
      "read: in org-with-projects, `org projects task get <Build>` shows Design, working, as its dependency; `org projects task get " +
        "<Launch>` shows Announce, open, as its child; `org projects task get <Design>` shows `actualTime` the hours of Sam's " +
        "submitted log.",
    ),
    claim(
      "A task of no project, and a cancelled one, reads as it was kept; reading writes nothing.",
      "read: in org-with-projects, Sam's `org projects task get <Old>` prints `project: null` and `status: cancelled`; " +
        "world: the diff is empty.",
    ),
  ],
  returns: Task,
  errors: ERRORS,
  refusals: [...membered, unknown("task", "tsk_…")],
  budget: budget("read"),
});

export const operation_org_projects_task_change = defineOperation({
  id: "org.projects.task.change",
  title: "Change a task's fields",
  about:
    "Changes a task's fields, with the flags `org projects task create` takes; `--clear <field>` empties one. Its status moves " +
    "only by its lifecycle commands, except that moving an overdue task's expected end to a day that has not yet " +
    "ended, or clearing it, takes it back to open, or to working if time is logged on it.",
  area: AREA,
  command: "org projects task change",
  priority: "normal",
  implementedBy: rpc_projects_tasks_change,
  who: WHO_MEMBER,
  changes: "The task's fields, the percent complete of each project it leaves or joins, and their entries in the change log.",
  acceptance: [
    claim(
      "Only the fields given change; the rest are kept.",
      "cli: `org projects task change <Build> --priority urgent --clear depends-on` prints Build urgent with no dependency and " +
        "every other field as before; read: `org projects task get <Build>` agrees.",
    ),
    claim(
      "An overdue task whose expected end moves to a later day is open again, or working with time logged, and falls " +
        "overdue again when that day ends unfinished.",
      "read: after `dev time warp` past the end of Build's expected end day, `org projects task get <Build>` shows overdue; cli: " +
        "`org projects task change <Build> --end <a later day>` prints `status: open`; read: after `dev time warp` past the end of " +
        "that day, `org projects task get <Build>` shows it overdue again.",
    ),
  ],
  returns: Task,
  errors: ERRORS,
  refusals: [
    ...membered,
    unknown("task", "tsk_…"),
    invalid(
      "A dependency that makes a cycle (Design depending on Build), a parent that is not a group, making Launch not a " +
        "group while Announce is its child, `--clear subject`, or no flag at all: the refusal names the field, or says " +
        "nothing was given.",
    ),
  ],
  budget: budget("write"),
});

/** One lifecycle command of a task, which any member runs. */
const taskStep = (
  verb: "start" | "review" | "complete" | "reopen" | "cancel",
  spec: {
    title: string;
    about: string;
    rpc: typeof rpc_projects_tasks_start;
    claims: readonly { claim: string; observes: string }[];
    wrongState: string;
    priority?: "critical";
    changes: string;
    extra?: readonly Refusal[];
  },
) =>
  defineOperation({
    id: `org.projects.task.${verb}`,
    title: spec.title,
    about: spec.about,
    area: AREA,
    command: `org projects task ${verb}`,
    priority: spec.priority ?? "normal",
    implementedBy: spec.rpc,
    who: WHO_MEMBER,
    changes: spec.changes,
    acceptance: [...spec.claims],
    returns: Task,
    errors: ERRORS,
    refusals: [...membered, unknown("task", "tsk_…"), ...(spec.extra ?? []), wrong(spec.wrongState)],
    budget: budget("write"),
  });

const TASK_STATUS = "The task's status, and its entry in the change log.";
const TASK_AND_PROJECT = "The task's status, its project's percent complete and perhaps its status, and their entries in the change log.";

export const operation_org_projects_task_start = taskStep("start", {
  title: "Start a task",
  about: "Marks an open or pending-review task as working, as logging time on it would.",
  rpc: rpc_projects_tasks_start,
  changes: TASK_STATUS,
  claims: [
    claim("An open task is working.", "cli: `org projects task start <Build>` prints `status: working`; read: `org projects task list --status working` lists Build and Design."),
    claim(
      "A task pending review is working again, and the start is recorded once.",
      "cli: in org-with-projects, after `org projects task review <Design> --by <a day after its expected end>`, `org " +
        "projects task start <Design>` prints `status: working`; trace: one task_transitioned pending_review → working.",
    ),
    claim(
      "Starting a task that is already working is refused and changes nothing.",
      "cli: in org-with-projects, after `org projects task start <Build>`, the same command again is WRONG_STATE naming " +
        "`working`; world: the diff is empty.",
    ),
  ],
  wrongState: "Spec, completed: only an open or pending-review task starts. The refusal names its status.",
});

export const operation_org_projects_task_review = taskStep("review", {
  title: "Send a task for review",
  about:
    "Sends a task for review by a day (`--by`). Unfinished, it falls overdue once its expected end's day has ended and " +
    "the review day has come, as ERPNext's daily overdue job has it.",
  rpc: rpc_projects_tasks_review,
  changes: TASK_STATUS,
  claims: [
    claim(
      "The task is pending review by that day, and does not fall overdue while the review day is ahead.",
      "cli: `org projects task review <Design> --by <a day after its expected end>` prints `status: pending_review` and that " +
        "`reviewBy`; read: after `dev time warp` past its expected end day, `org projects task get <Design>` shows it pending " +
        "review, and after `dev time warp` to the start of the review day, overdue.",
    ),
    claim(
      "An overdue task goes for review, and a task already pending review is not sent again.",
      "cli: in org-with-projects, after `dev time warp` past the end of Build's expected end day, `org projects task " +
        "review <Build> --by <a later day>` prints `status: pending_review`; the same command again is WRONG_STATE naming " +
        "`pending_review`; world: that refusal's diff is empty.",
    ),
  ],
  extra: [invalid("A `--by` that is not a day: the refusal names `--by`.")],
  wrongState: "Spec, completed: only an open, working or overdue task goes for review.",
});

export const operation_org_projects_task_complete = taskStep("complete", {
  title: "Complete a task",
  about:
    "Completes a task, recording who completed it and when. A task whose dependencies, or a group task whose children, " +
    "are not all completed or cancelled is refused, naming them. Its project's percent complete moves, and at 100 the " +
    "project completes.",
  rpc: rpc_projects_tasks_complete,
  priority: "critical",
  changes: TASK_AND_PROJECT,
  claims: [
    claim(
      "The task is completed, with who completed it and when, and its project's percent complete moves.",
      "cli: Sam's `org projects task complete <Design>` prints `status: completed`, `percentComplete` 100, `completedBy` Sam and " +
        "today's day; read: `org projects get <Website>` shows a percent complete of 40.",
    ),
    claim(
      "Completing the last unfinished task of an open project completes the project.",
      "cli: after Design, Build, Announce and Launch are each completed, in that order, `org projects get <Website>` " +
        "shows `status: completed` and a percent complete of 100.",
    ),
  ],
  wrongState:
    "Build, while Design (its dependency) is working; Launch, while its child Announce is open; or Spec, already " +
    "completed. The refusal names each unfinished task, or the status.",
});

export const operation_org_projects_task_reopen = taskStep("reopen", {
  title: "Reopen a task",
  about:
    "Opens a completed or cancelled task again, clearing who completed it. A project its tasks had completed opens again.",
  rpc: rpc_projects_tasks_reopen,
  changes: TASK_AND_PROJECT,
  claims: [
    claim(
      "A completed task is open again, its completion cleared.",
      "cli: `org projects task reopen <Spec>` prints `status: open`, `percentComplete` 0 and `completedBy` null; read: `org projects " +
        "get <Website>` shows a percent complete of 0.",
    ),
    claim(
      "A cancelled task reopens keeping its percent, and a project its tasks had completed opens again.",
      "cli: in org-with-projects, `org projects task reopen <Old>` prints `status: open` and the `percentComplete` it " +
        "had; after Design, Build, Announce and Launch are each completed (Website completes), `org projects task reopen " +
        "<Spec>` prints Spec open; read: `org projects get <Website>` shows `status: open` and a percent complete of 80.",
    ),
    claim(
      "Reopening a task that is open is refused and changes nothing, so a repeated reopen is refused.",
      "cli: in org-with-projects, after `org projects task reopen <Spec>`, the same command again is WRONG_STATE naming " +
        "`open`; world: the diff is empty.",
    ),
  ],
  wrongState: "Build, which is open: only a completed or cancelled task reopens.",
});

export const operation_org_projects_task_cancel = taskStep("cancel", {
  title: "Cancel a task",
  about:
    "Cancels a task and keeps it. It counts as done for its project's percent complete and for the tasks that depend on it.",
  rpc: rpc_projects_tasks_cancel,
  changes: TASK_AND_PROJECT,
  claims: [
    claim(
      "A cancelled task counts as done for its project and its dependants.",
      "cli: `org projects task cancel <Design>` prints `status: cancelled`; then `org projects task complete <Build>`, refused before, " +
        "prints Build completed; read: `org projects get <Website>` counts both as done.",
    ),
    claim(
      "Cancelling the last unfinished task of an open project completes the project.",
      "cli: in org-with-projects, after Design, Build and Announce are each completed, `org projects task cancel " +
        "<Launch>` prints Launch cancelled; read: `org projects get <Website>` shows `status: completed` and a percent " +
        "complete of 100.",
    ),
    claim(
      "A cancelled task never falls overdue, and cancelling it again is refused.",
      "read: in org-with-projects, after `org projects task cancel <Design>` and `dev time warp` past the end of its " +
        "expected end day, `org projects task get <Design>` shows it still cancelled; cli: the same cancel again is " +
        "WRONG_STATE naming `cancelled`; world: that refusal's diff is empty.",
    ),
  ],
  wrongState: "Spec, completed: only an unfinished task is cancelled.",
});

// ── timesheets ──────────────────────────────────────────────────────────────────────────────

export const operation_org_projects_timesheet_create = defineOperation({
  id: "org.projects.timesheet.create",
  title: "Create a draft timesheet",
  about:
    "Creates a draft timesheet for your own time, or with `--for`, for another worker: any Party, such as an employee " +
    "or a contractor who has no Seat, named by email, @handle, address or Party id. `--employee` records their " +
    "Employee name, `--project` the project and customer it is for. Log time on it with `org projects timesheet log`.",
  area: AREA,
  command: "org projects timesheet create",
  priority: "critical",
  implementedBy: rpc_projects_timesheets_create,
  who: WHO_WORKER,
  changes: "One draft timesheet, and its entry in the change log.",
  acceptance: [
    claim(
      "A member creates a draft timesheet for their own time, with no logs and zero totals.",
      "cli: Sam's `org projects timesheet create --project <Website>` prints a `ts_` timesheet, `status: draft`, Sam as its " +
        "worker, Olga as its customer and no logs; read: `org projects timesheet list --for sam@acme.test` lists it.",
    ),
    claim(
      "People or a Director keeps a timesheet for another worker, who needs no Seat; any other member may not.",
      "cli: Dana's `org projects timesheet create --for olga@outside.test` prints a draft with Olga as its worker; Sam's `org " +
        "projects timesheet create --for dana@acme.test` is ROLE_PERMISSION_DENIED; world: that refusal's diff is empty.",
    ),
  ],
  returns: Timesheet,
  errors: ERRORS,
  refusals: [
    ...membered,
    {
      error: error_ROLE_PERMISSION_DENIED,
      given: WORLD,
      when: "Sam, a member with neither the People hat nor the Director hat, names another worker with `--for`: nothing is written.",
    },
    hatUnread("creates a timesheet for Sam"),
    invalid("A `--for` that names no Party, or a `--project` that is none of Acme's: the refusal names the field and nothing is written."),
  ],
  budget: budget("chain-read"),
});

export const operation_org_projects_timesheet_log = defineOperation({
  id: "org.projects.timesheet.log",
  title: "Log time on a draft timesheet",
  about:
    "Adds one time log to a draft timesheet: its activity type, its start, its end or its hours, and as you choose the " +
    "task and project it was for, whether it is billable, whether it completed the task, and a note. Its rates are " +
    "the activity type's. A log that overlaps another of the same worker's, unless the Projects Settings allow it, a " +
    "disabled activity type and a cancelled task are refused.",
  area: AREA,
  command: "org projects timesheet log",
  priority: "critical",
  implementedBy: rpc_projects_timesheets_log,
  who: WHO_WORKER,
  changes: "One time log on the draft, its totals and days, and its entry in the change log.",
  acceptance: [
    claim(
      "The log is added with its hours, and costing and billing amounts at its activity type's rates; the draft's " +
        "totals and days follow.",
      "cli: after `org projects activity-type change Execution --costing-rate 40 --billing-rate 90`, Sam's `org projects timesheet log " +
        "<his draft> --activity Execution --start <a time> --hours 1.5 --task <Build> --billable` prints the draft " +
        "with a second log of 1.5 hours, costing 60 and billing 135, and `totalHours` the sum of both logs.",
    ),
    claim(
      "A log overlapping another of the same worker's is refused unless the settings allow it; a disabled activity " +
        "type is refused.",
      "cli: a log by Sam that overlaps his draft's first log is INVALID_INPUT naming the overlapping timesheet; " +
        "`--activity Research` is INVALID_INPUT naming the activity type; world: each refusal's diff is empty.",
    ),
  ],
  returns: Timesheet,
  errors: ERRORS,
  refusals: [
    ...membered,
    unknown("timesheet", "ts_…"),
    {
      error: error_ROLE_PERMISSION_DENIED,
      given: WORLD,
      when: "Sam logs time on Dana's own draft: he is not its worker and wears neither the People hat nor the Director hat.",
    },
    hatUnread("logs time on Sam's draft"),
    invalid(
      "A disabled activity type (Research); an end not after the start, or hours not above zero; a task that is " +
        "cancelled (Old) or none of Acme's; a project other than the timesheet's; or a log overlapping another of the " +
        "worker's: the refusal names the field and nothing is written.",
    ),
    wrong("Sam's submitted timesheet: only a draft takes logs. The refusal names its status."),
  ],
  budget: budget("chain-read"),
});

export const operation_org_projects_timesheet_get = defineOperation({
  id: "org.projects.timesheet.get",
  title: "Show one timesheet",
  about: "Shows one timesheet: its worker, its logs in order with their hours, rates and amounts, its totals and the share billed, and what billed or paid it.",
  area: AREA,
  command: "org projects timesheet get",
  priority: "critical",
  implementedBy: rpc_projects_timesheets_get,
  who: WHO_MEMBER,
  changes: NOTHING_READ,
  acceptance: [
    claim(
      "A timesheet shows its logs, its totals and what billed each log.",
      "read: in org-with-projects, `org projects timesheet get` of Dana's timesheet for Sam shows `status: billed`, 100 percent " +
        "billed, and each billable log's `billedBy` the request that billed it; Sam's draft shows its one log and " +
        "`billedBy` null.",
    ),
    claim(
      "A submitted timesheet shows its logged hours as its totals, and a cancelled one is still read; reading writes nothing.",
      "read: in org-with-projects, `org projects timesheet get` of Sam's submitted timesheet shows `status: submitted`, two " +
        "hours in `totalHours` and in `totalBillableHours`, and `perBilled` 0; of his cancelled one, `status: cancelled`; " +
        "world: the diff is empty.",
    ),
  ],
  returns: Timesheet,
  errors: ERRORS,
  refusals: [...membered, unknown("timesheet", "ts_…")],
  budget: budget("read"),
});

export const operation_org_projects_timesheet_list = defineOperation({
  id: "org.projects.timesheet.list",
  title: "List the Organization's timesheets",
  about:
    "Lists the Organization's timesheets, latest start day first, a page at a time, with their worker, project, " +
    "status and totals. Filter by `--for` (a worker), `--project` or `--status`.",
  area: AREA,
  command: "org projects timesheet list",
  priority: "critical",
  implementedBy: rpc_projects_timesheets_list,
  who: WHO_MEMBER,
  changes: NOTHING_READ,
  notes: PAGE_NOTES,
  acceptance: [
    claim(
      "Every member sees the Organization's timesheets by start day, filtered as asked.",
      "read: in org-with-projects, `org projects timesheet list --for sam@acme.test` lists Sam's four, latest start day first; " +
        "`--status billed` lists only Dana's timesheet for Sam; `--project <Website>` lists every timesheet for Website.",
    ),
    claim(
      "A page holds at most `--limit` timesheets and gives the cursor for the next; a filter that matches none gives an empty page.",
      "cli: in org-with-projects, `org projects timesheet list --for sam@acme.test --limit 2` prints two and a " +
        "`nextCursor`, and `--after <it>` the other two with `nextCursor: null`; `--status payslip` prints no timesheet " +
        "and `nextCursor: null`; world: the diff is empty.",
    ),
  ],
  returns: Page(TimesheetSummary),
  errors: ERRORS,
  refusals: [...membered, badPage("a `--status` that is no timesheet status")],
  budget: budget("read"),
});

export const operation_org_projects_timesheet_submit = defineOperation({
  id: "org.projects.timesheet.submit",
  title: "Submit a timesheet",
  about:
    "Submits a draft timesheet. Its logs no longer change, and its hours roll into its tasks and projects: a task it " +
    "logs time on becomes working, one a log marks completed completes, and their projects' time, totals and percent " +
    "complete follow. Every log needs its times and hours, and an activity type when an employee is named; and, as " +
    "ERPNext checks a draft's every log again, none may name a type since disabled or a task since cancelled.",
  area: AREA,
  command: "org projects timesheet submit",
  priority: "critical",
  implementedBy: rpc_projects_timesheets_submit,
  who: WHO_WORKER,
  changes: "The timesheet's status; its tasks' and projects' time, totals and statuses; their entries in the change log.",
  acceptance: [
    claim(
      "The draft is submitted and its hours roll into its tasks and project.",
      "cli: Sam's `org projects timesheet submit <his draft>` prints `status: submitted`; read: `org projects task get <Design>` and `org " +
        "projects get <Website>` each show `actualTime` grown by the draft's hours and their totals by its amounts.",
    ),
    claim(
      "An open task that a submitted log names becomes working, and one a log marks completed completes.",
      "cli: a draft with a log on Build, then one with a log marked `--completed` on Announce, each submitted; read: `org " +
        "projects task get` shows Build working and Announce completed.",
    ),
  ],
  returns: Timesheet,
  errors: ERRORS,
  refusals: [
    ...membered,
    unknown("timesheet", "ts_…"),
    {
      error: error_ROLE_PERMISSION_DENIED,
      given: WORLD,
      when: "Sam submits Dana's own draft: he is not its worker and wears neither the People hat nor the Director hat.",
    },
    hatUnread("submits Sam's draft"),
    invalid(
      "Dana's own draft, which has no log; Sam's draft after `org projects activity-type disable Execution`, since its log names " +
        "Execution; or a log marked completed on a task whose dependency is unfinished: the refusal names the row.",
    ),
    wrong("Sam's submitted or cancelled timesheet: only a draft is submitted."),
  ],
  budget: budget("chain-read"),
});

export const operation_org_projects_timesheet_cancel = defineOperation({
  id: "org.projects.timesheet.cancel",
  title: "Cancel a timesheet",
  about:
    "Cancels a draft or submitted timesheet and keeps it. A submitted one's hours leave its tasks and projects: a " +
    "working or pending-review task left with no submitted time is open again, and a pending-review one with some left " +
    "is working. A timesheet billed in part or in full, or paid by a salary slip, is refused: cancel what billed or " +
    "paid it first.",
  area: AREA,
  command: "org projects timesheet cancel",
  priority: "normal",
  implementedBy: rpc_projects_timesheets_cancel,
  who: WHO_WORKER,
  changes: "The timesheet's status; a submitted one's tasks' and projects' time, totals and statuses; their entries in the change log.",
  acceptance: [
    claim(
      "A submitted timesheet is cancelled and kept, and its hours leave its tasks and project.",
      "cli: Sam's `org projects timesheet cancel <his submitted timesheet>` prints `status: cancelled`; read: `org projects task get " +
        "<Design>` shows `actualTime` without its hours, and Design open again; `org projects timesheet get` still returns it.",
    ),
    claim(
      "A draft is cancelled and kept, and moves no task, since its hours were never rolled in.",
      "cli: in org-with-projects, Sam's `org projects timesheet cancel <his draft>` prints `status: cancelled`; read: " +
        "`org projects task get <Design>` shows the same `actualTime` and status as before.",
    ),
    claim(
      "Cancelling a timesheet again is refused and changes nothing.",
      "cli: in org-with-projects, Sam's `org projects timesheet cancel <his cancelled timesheet>` is WRONG_STATE naming " +
        "`cancelled`; world: the diff is empty.",
    ),
  ],
  returns: Timesheet,
  errors: ERRORS,
  refusals: [
    ...membered,
    unknown("timesheet", "ts_…"),
    {
      error: error_ROLE_PERMISSION_DENIED,
      given: WORLD,
      when: "Sam cancels Dana's own draft: he is not its worker and wears neither the People hat nor the Director hat.",
    },
    hatUnread("cancels Sam's draft"),
    wrong("Dana's timesheet for Sam, which is billed, or Sam's cancelled one. The refusal names its status."),
  ],
  budget: budget("chain-read"),
});

// ── activity types ──────────────────────────────────────────────────────────────────────────

const typeWrite = (
  verb: "add" | "change" | "disable" | "enable",
  spec: {
    title: string;
    about: string;
    rpc: typeof rpc_projects_activity_types_add;
    claims: readonly { claim: string; observes: string }[];
    refusals: readonly Refusal[];
    changes: string;
  },
) =>
  defineOperation({
    id: `org.projects.activity-type.${verb}`,
    title: spec.title,
    about: spec.about,
    area: AREA,
    command: `org projects activity-type ${verb}`,
    priority: "normal",
    implementedBy: spec.rpc,
    who: WHO_MANAGER,
    changes: spec.changes,
    acceptance: [...spec.claims],
    returns: ActivityType,
    errors: ERRORS,
    refusals: [...managed(`runs \`org projects activity-type ${verb}\``), ...spec.refusals],
    budget: budget("chain-read"),
  });

export const operation_org_projects_activity_type_add = typeWrite("add", {
  title: "Add an activity type",
  about: "Adds a kind of work that time is logged against, named by its title, with default hourly costing and billing rates (zero when not given).",
  rpc: rpc_projects_activity_types_add,
  changes: "One activity type, and its entry in the change log.",
  claims: [
    claim(
      "The type is added, enabled, with the rates given, and a log may name it at once.",
      "cli: `org projects activity-type add Design --billing-rate 120` prints Design enabled, billing 120 and costing 0; read: " +
        "`org projects activity-type list` lists it; a log with `--activity Design` is added.",
    ),
    claim(
      "A type with no rates given has both at zero, and a name already used, in any case, is not added again.",
      "cli: in org-ready, `org projects activity-type add Review` prints Review enabled at costing 0 and billing 0; the " +
        "same command again, and `org projects activity-type add review`, are each INVALID_INPUT naming the name; world: " +
        "each refusal's diff is empty.",
    ),
  ],
  refusals: [invalid("A name already used, in any case (`planning`, beside start-up's Planning), or a negative rate: the refusal names the field.", "org-ready")],
});

export const operation_org_projects_activity_type_change = typeWrite("change", {
  title: "Change an activity type's rates",
  about: "Changes an activity type's default hourly rates. Logs already made keep their own rates; the next log takes the new ones.",
  rpc: rpc_projects_activity_types_change,
  changes: "The type's rates, and its entry in the change log.",
  claims: [
    claim(
      "The new rates apply to the next log, and logs already made keep theirs.",
      "cli: `org projects activity-type change Execution --billing-rate 100` prints Execution billing 100; read: Sam's " +
        "submitted log of Execution keeps its billing rate in `org projects timesheet get`, and his next Execution log takes 100.",
    ),
    claim(
      "Only the rate given changes, the type is named in any case, and a disabled type's rates change too.",
      "cli: in org-with-projects, `org projects activity-type change execution --billing-rate 100` prints Execution " +
        "billing 100 and costing 40; `org projects activity-type change Research --costing-rate 10` prints Research " +
        "costing 10 and still `disabled: true`.",
    ),
  ],
  refusals: [invalid("A name no activity type of Acme's has, no rate given, or a negative rate: the refusal names the field.", "org-ready")],
});

export const operation_org_projects_activity_type_disable = typeWrite("disable", {
  title: "Disable an activity type",
  about: "Disables an activity type: no new log may name it. Logs that already name it are kept.",
  rpc: rpc_projects_activity_types_disable,
  changes: "The type's disabled flag, and its entry in the change log.",
  claims: [
    claim(
      "A disabled type takes no new log, and the logs that name it are kept.",
      "cli: `org projects activity-type disable Execution` prints `disabled: true`; then a log with `--activity Execution` is " +
        "INVALID_INPUT; read: Sam's submitted Execution log is unchanged in `org projects timesheet get`.",
    ),
    claim(
      "A draft whose log names a disabled type is not submitted until the type is enabled again.",
      "cli: in org-with-projects, after `org projects activity-type disable Execution`, Sam's `org projects timesheet " +
        "submit <his draft>` is INVALID_INPUT naming the row; after `org projects activity-type enable Execution`, the " +
        "same submit prints `status: submitted`.",
    ),
    claim(
      "Disabling a type again is refused and changes nothing; the list shows a disabled type after the enabled ones.",
      "cli: in org-with-projects, after `org projects activity-type disable Execution`, the same command again is " +
        "WRONG_STATE; world: that diff is empty; read: `org projects activity-type list` lists Execution and Research, " +
        "disabled, after the other three.",
    ),
  ],
  refusals: [
    invalid("A name no activity type of Acme's has: the refusal names it.", "org-ready"),
    wrong("Research, already disabled."),
  ],
});

export const operation_org_projects_activity_type_enable = typeWrite("enable", {
  title: "Enable an activity type",
  about: "Enables a disabled activity type, so time can be logged against it again.",
  rpc: rpc_projects_activity_types_enable,
  changes: "The type's disabled flag, and its entry in the change log.",
  claims: [
    claim(
      "An enabled type takes logs again.",
      "cli: `org projects activity-type enable Research` prints `disabled: false`; then a log with `--activity Research`, refused " +
        "before, is added.",
    ),
    claim(
      "An enabled type keeps its rates, and enabling it again is refused and changes nothing.",
      "cli: in org-with-projects, `org projects activity-type enable Research` prints Research with the rates it had; " +
        "the same command again is WRONG_STATE; world: that refusal's diff is empty; read: `org projects activity-type " +
        "list` lists Research among the enabled types, by name.",
    ),
  ],
  refusals: [
    invalid("A name no activity type of Acme's has: the refusal names it.", "org-ready"),
    wrong("Planning, already enabled."),
  ],
});

export const operation_org_projects_activity_type_list = defineOperation({
  id: "org.projects.activity-type.list",
  title: "List the activity types",
  about: "Lists the Organization's activity types with their default rates, enabled ones first.",
  area: AREA,
  command: "org projects activity-type list",
  priority: "normal",
  implementedBy: rpc_projects_activity_types_list,
  who: WHO_MEMBER,
  changes: NOTHING_READ,
  acceptance: [
    claim(
      "A new Organization has ERPNext's five activity types, enabled, at zero rates.",
      "read: in org-ready, `org projects activity-type list` prints Communication, Execution, Planning, Proposal Writing and " +
        "Research, each enabled at rates of 0, and `nextCursor: null`; in org-with-projects Research is listed last, disabled.",
    ),
    claim(
      "Any member reads every type with its current rates, enabled first and then by name, on one page; reading writes nothing.",
      "read: in org-with-projects, Sam's `org projects activity-type list` prints Communication, Execution (costing 40, " +
        "billing 90), Planning and Proposal Writing enabled, then Research disabled, and `nextCursor: null`; world: the diff is empty.",
    ),
  ],
  returns: Page(ActivityType),
  errors: ERRORS,
  refusals: membered,
  budget: budget("read"),
});

// ── project types ───────────────────────────────────────────────────────────────────────────

export const operation_org_projects_project_type_add = defineOperation({
  id: "org.projects.project-type.add",
  title: "Add a project type",
  about: "Adds a project type, named by its title, with an optional description. A project names its type with `--type`.",
  area: AREA,
  command: "org projects project-type add",
  priority: "normal",
  implementedBy: rpc_projects_project_types_add,
  who: WHO_MANAGER,
  changes: "One project type, and its entry in the change log.",
  acceptance: [
    claim(
      "The type is added and a project may name it at once.",
      "cli: `org projects project-type add Retainer --description \"Monthly work\"` prints it; read: `org projects project-type list` lists " +
        "it; `org projects create Support --type Retainer` prints a project of that type.",
    ),
    claim(
      "A type needs no description, and a name already used, in any case, is not added again.",
      "cli: in org-ready, `org projects project-type add Support` prints Support with `description: null`; the same " +
        "command again, and `org projects project-type add support`, are each INVALID_INPUT naming the name; world: each " +
        "refusal's diff is empty.",
    ),
  ],
  returns: ProjectType,
  errors: ERRORS,
  refusals: [...managed("adds a project type"), invalid("A name already used, in any case (`internal`, beside start-up's Internal), or an empty name.", "org-ready")],
  budget: budget("chain-read"),
});

export const operation_org_projects_project_type_list = defineOperation({
  id: "org.projects.project-type.list",
  title: "List the project types",
  about: "Lists the Organization's project types with their descriptions.",
  area: AREA,
  command: "org projects project-type list",
  priority: "normal",
  implementedBy: rpc_projects_project_types_list,
  who: WHO_MEMBER,
  changes: NOTHING_READ,
  acceptance: [
    claim(
      "A new Organization has ERPNext's three project types.",
      "read: in org-ready, `org projects project-type list` prints External, Internal and Other, and `nextCursor: null`.",
    ),
    claim(
      "Any member reads every type by name, one added since included; reading writes nothing.",
      "read: in org-with-member, after Dana's `org projects project-type add Retainer`, Sam's `org projects project-type " +
        "list` prints External, Internal, Other and Retainer, each with its description; world: the list's diff is empty.",
    ),
  ],
  returns: Page(ProjectType),
  errors: ERRORS,
  refusals: membered,
  budget: budget("read"),
});

/** Every operation this concept books, for its pack's `affects` (projects.commands). */
export const OPERATIONS = [
  operation_org_projects_create,
  operation_org_projects_list,
  operation_org_projects_get,
  operation_org_projects_change,
  operation_org_projects_hold,
  operation_org_projects_resume,
  operation_org_projects_complete,
  operation_org_projects_reopen,
  operation_org_projects_cancel,
  operation_org_projects_member_add,
  operation_org_projects_member_remove,
  operation_org_projects_settings_show,
  operation_org_projects_settings_set,
  operation_org_projects_task_create,
  operation_org_projects_task_list,
  operation_org_projects_task_get,
  operation_org_projects_task_change,
  operation_org_projects_task_start,
  operation_org_projects_task_review,
  operation_org_projects_task_complete,
  operation_org_projects_task_reopen,
  operation_org_projects_task_cancel,
  operation_org_projects_timesheet_create,
  operation_org_projects_timesheet_log,
  operation_org_projects_timesheet_get,
  operation_org_projects_timesheet_list,
  operation_org_projects_timesheet_submit,
  operation_org_projects_timesheet_cancel,
  operation_org_projects_activity_type_add,
  operation_org_projects_activity_type_change,
  operation_org_projects_activity_type_list,
  operation_org_projects_activity_type_disable,
  operation_org_projects_activity_type_enable,
  operation_org_projects_project_type_add,
  operation_org_projects_project_type_list,
] as const;

/** The operations a pilot's first engagement runs (projects.critical-commands). */
export const CRITICAL = OPERATIONS.filter((o) => o.priority === "critical");
