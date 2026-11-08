// What the projects commands take and print (projects.json-shapes): each record as `get` prints it,
// which every write prints after its change, and a page of them for each list. Ids are Capxul's
// (`prj_`, `tsk_`, `ts_`); an activity type and a project type are named by their title, as Frappe
// names them. Amounts, rates, hours and percentages are exact decimal strings in the Organization's
// currency (projects.amounts); a day is `YYYY-MM-DD` in its time zone and a time an instant, in epoch
// milliseconds (projects.dates).

import { Schema } from "effect";
import { ProjectPriority, TaskPriority } from "./data.ts";

const S = Schema.String;
const N = Schema.Number;
const B = Schema.Boolean;
const NullOr = Schema.NullOr;
const Opt = Schema.optionalKey;

/** An exact decimal string (projects.amounts). */
const Decimal = S;
/** A day in the Organization's time zone (projects.dates). */
const Day = S;
/** A Frappe Datetime as a command takes it: an instant in epoch milliseconds, or a day, read as its 00:00 in the
 * Organization's time zone. */
const DayOrInstant = Schema.Union([N, Day]);

/** Which Organization a command acts for: `--org`, else the one `use org` chose. */
export const OrgInput = { orgId: S };

/** The paging every list takes: `--after <cursor>` and `--limit <n>` (1 to 100, 25 when absent). */
export const PageInput = { after: Opt(S), limit: Opt(Schema.Int) };

/** A page of records and the cursor for the next page, null on the last. */
export const Page = <T extends Schema.Top>(item: T) => Schema.Struct({ items: Schema.Array(item), nextCursor: NullOr(S) });

/** A person or agent as projects shows them: their Party, and how a member is named (an email or an agent's @handle). */
export const Person = Schema.Struct({ partyId: S, name: NullOr(S) });

/** A project's customer: a Party on Capxul, or only a name (projects.customer-name). */
export const Customer = Schema.Struct({ partyId: NullOr(S), name: NullOr(S) });

export const ProjectStatus = Schema.Literals(["open", "on_hold", "completed", "cancelled"]);
export const PercentMethod = Schema.Literals(["manual", "task-completion", "task-progress", "task-weight"]);
export const TaskStatus = Schema.Literals(["open", "working", "pending_review", "overdue", "template", "completed", "cancelled"]);
export const TimesheetStatus = Schema.Literals(["draft", "submitted", "partially_billed", "billed", "payslip", "completed", "cancelled"]);

/** The fields `org project create` sets and `org project change` changes. */
export const ProjectFields = {
  name: Opt(S),
  type: Opt(S),
  priority: Opt(ProjectPriority),
  start: Opt(Day),
  end: Opt(Day),
  /** A Party locator (email, @handle, 0x address, Party id) or, for a company not on Capxul, its name. */
  customer: Opt(S),
  progress: Opt(PercentMethod),
  /** `--percent`: the percent complete typed by hand, only for a project worked out by hand (Frappe's Manual method). */
  percent: Opt(Decimal),
  department: Opt(S),
  costCenter: Opt(S),
  estimatedCost: Opt(Decimal),
  notes: Opt(S),
};

export const ProjectMember = Schema.Struct({ member: Person, viewAttachments: B, hideTimesheets: B });

/** One project in a list. */
export const ProjectSummary = Schema.Struct({
  id: S,
  name: S,
  status: ProjectStatus,
  type: NullOr(S),
  priority: NullOr(ProjectPriority),
  customer: Customer,
  percentComplete: Decimal,
  expectedEnd: NullOr(Day),
  createdAt: N,
  updatedAt: N,
});

/** One project, as `org project get` prints it. */
export const Project = Schema.Struct({
  ...ProjectSummary.fields,
  progress: PercentMethod,
  expectedStart: NullOr(Day),
  actualStart: NullOr(Day),
  actualEnd: NullOr(Day),
  /** Hours logged on its submitted timesheets. */
  actualTime: Decimal,
  department: NullOr(S),
  costCenter: NullOr(S),
  estimatedCost: Decimal,
  totalCosting: Decimal,
  totalBillable: Decimal,
  notes: NullOr(S),
  members: Schema.Array(ProjectMember),
  /** Its tasks by status, and how many in all. */
  tasks: Schema.Struct({ total: N, byStatus: Schema.Record(S, N) }),
  /** The connected head's name for it, once a head has it. */
  headName: NullOr(S),
  version: N,
  createdBy: S,
});

/** The fields `org task create` sets and `org task change` changes. */
export const TaskFields = {
  subject: Opt(S),
  project: Opt(S),
  parent: Opt(S),
  group: Opt(B),
  dependsOn: Opt(Schema.Array(S)),
  /** A Frappe Datetime: an instant in epoch milliseconds, or a day (`YYYY-MM-DD`), which is 00:00 of that day in the
   * Organization's time zone (projects.dates). */
  start: Opt(DayOrInstant),
  end: Opt(DayOrInstant),
  hours: Opt(Decimal),
  weight: Opt(Decimal),
  /** `--percent`: the task's percent complete typed by hand, 0 to 100 (Frappe's Task `progress`), which a project worked
   * out by task progress or weight reads. `--percent` is a typed percent on a project and a task alike, and
   * `--progress` only a project's method (projects.percent-by-hand). */
  percent: Opt(Decimal),
  priority: Opt(TaskPriority),
  milestone: Opt(B),
  type: Opt(S),
};

/** One task in a list. */
export const TaskSummary = Schema.Struct({
  id: S,
  subject: S,
  project: NullOr(S),
  parent: NullOr(S),
  status: TaskStatus,
  priority: NullOr(TaskPriority),
  expectedEnd: NullOr(N),
  /** Frappe's Task `progress`: typed with `--percent`, 100 once completed. */
  percentComplete: Decimal,
  updatedAt: N,
});

/** One task, as `org task get` prints it. */
export const Task = Schema.Struct({
  ...TaskSummary.fields,
  isGroup: B,
  isMilestone: B,
  type: NullOr(S),
  dependsOn: Schema.Array(Schema.Struct({ id: S, subject: S, status: TaskStatus })),
  children: Schema.Array(Schema.Struct({ id: S, subject: S, status: TaskStatus })),
  expectedStart: NullOr(N),
  expectedHours: Decimal,
  weight: Decimal,
  actualStart: NullOr(Day),
  actualEnd: NullOr(Day),
  /** Hours logged on submitted timesheets. */
  actualTime: Decimal,
  totalCosting: Decimal,
  totalBilling: Decimal,
  reviewBy: NullOr(Day),
  completedBy: NullOr(Person),
  completedOn: NullOr(Day),
  headName: NullOr(S),
  version: N,
  createdBy: S,
  createdAt: N,
});

/** One time log of a timesheet. */
export const TimeLog = Schema.Struct({
  idx: N,
  activityType: NullOr(S),
  from: N,
  to: N,
  hours: Decimal,
  completed: B,
  project: NullOr(S),
  task: NullOr(S),
  billable: B,
  billingHours: Decimal,
  billingRate: Decimal,
  billingAmount: Decimal,
  costingRate: Decimal,
  costingAmount: Decimal,
  /** The request (or the head's Sales Invoice) that billed it; null while unbilled. */
  billedBy: NullOr(S),
  note: NullOr(S),
});

/** One timesheet in a list. */
export const TimesheetSummary = Schema.Struct({
  id: S,
  title: NullOr(S),
  status: TimesheetStatus,
  worker: Person,
  project: NullOr(S),
  start: NullOr(Day),
  end: NullOr(Day),
  totalHours: Decimal,
  totalBillableAmount: Decimal,
  updatedAt: N,
});

/** One timesheet, as `org timesheet get` prints it. */
export const Timesheet = Schema.Struct({
  ...TimesheetSummary.fields,
  /** The worker's Employee name, kept as given or as the head names it. */
  employee: NullOr(S),
  customer: Customer,
  totalBillableHours: Decimal,
  totalBilledHours: Decimal,
  totalCosting: Decimal,
  totalBilledAmount: Decimal,
  perBilled: Decimal,
  currency: S,
  /** The salary slip that paid its hours, once one has. */
  salarySlip: NullOr(S),
  note: NullOr(S),
  logs: Schema.Array(TimeLog),
  headName: NullOr(S),
  version: N,
  createdBy: S,
  createdAt: N,
});

/** One time log as `org timesheet log` takes it. */
export const LogInput = Schema.Struct({
  activity: S,
  start: N,
  /** One of `end` and `hours`: the other is worked out. */
  end: Opt(N),
  hours: Opt(Decimal),
  task: Opt(S),
  project: Opt(S),
  billable: Opt(B),
  completed: Opt(B),
  note: Opt(S),
});

export const ActivityType = Schema.Struct({
  name: S,
  costingRate: Decimal,
  billingRate: Decimal,
  disabled: B,
  updatedAt: N,
});

export const ProjectType = Schema.Struct({ name: S, description: NullOr(S), updatedAt: N });

/** Projects Settings, as `org project settings show` prints it. */
export const Settings = Schema.Struct({
  /** Frappe's `ignore_user_time_overlap`: one worker's logs may overlap. */
  allowUserOverlap: B,
  /** Frappe's `ignore_employee_time_overlap`: one employee's logs may overlap. */
  allowEmployeeOverlap: B,
  /** Frappe's `fetch_timesheet_in_sales_invoice`. */
  fetchTimesheets: B,
});
