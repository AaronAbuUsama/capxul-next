// Books' records for the target book: its tables, machines and events, its door, one file per
// area, its durable work, its one Core SDK flow, its 17 operations and its decisions.

import * as data from "./data.ts";
import * as procedures from "./procedures.ts";
import * as accounts from "./accounts.ts";
import * as annotations from "./annotations.ts";
import * as assets from "./assets.ts";
import * as facts from "./facts.ts";
import * as reports from "./reports.ts";
import * as exports from "./exports.ts";
import * as processes from "./processes.ts";
import * as flows from "./flows.ts";
import * as operations from "./operations.ts";
import * as decisions from "./decisions.ts";

export const modules = [
  data,
  procedures,
  accounts,
  annotations,
  assets,
  facts,
  reports,
  exports,
  processes,
  flows,
  operations,
  decisions,
] as const;
