// The projects concept's modules, for books/target/index.ts: its tables, machines and events, its
// door (`projects.bill-time`, the one money fact it shares: an invoice and the hours it bills), the
// rpcs of its seven areas, its durable processes, its 35 commands (new operations beyond the 215,
// projects.commands) and its decisions. The shapes and guards the rpcs share are plain exports.

import * as data from "./data.ts";
import * as procedures from "./procedures.ts";
import * as projects from "./projects.ts";
import * as members from "./members.ts";
import * as settings from "./settings.ts";
import * as tasks from "./tasks.ts";
import * as timesheets from "./timesheets.ts";
import * as activityTypes from "./activity-types.ts";
import * as projectTypes from "./project-types.ts";
import * as processes from "./processes.ts";
import * as operations from "./operations.ts";
import * as decisions from "./decisions.ts";

export const modules = [
  data,
  procedures,
  projects,
  members,
  settings,
  tasks,
  timesheets,
  activityTypes,
  projectTypes,
  processes,
  operations,
  decisions,
] as const;
