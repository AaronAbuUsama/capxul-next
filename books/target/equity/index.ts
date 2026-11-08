// Equity's records for the target book: its tables and machines, its (empty) door, the installs',
// issues', grants', rounds', SAFE rounds', investors', holdings', sales', exits', votes' and writes' rpcs,
// the durable processes, the Core SDK flows, the 38 frozen operations and equity's decisions.
// books/target/index.ts appends `modules` to conceptModules. shapes.ts and guards.ts hold no records;
// links.ts holds the pending links to board and documents.

import * as data from "./data.ts";
import * as procedures from "./procedures.ts";
import * as installs from "./installs.ts";
import * as issues from "./issues.ts";
import * as grants from "./grants.ts";
import * as rounds from "./rounds.ts";
import * as safes from "./safes.ts";
import * as investments from "./investments.ts";
import * as holdings from "./holdings.ts";
import * as sales from "./sales.ts";
import * as exits from "./exits.ts";
import * as votes from "./votes.ts";
import * as writes from "./writes.ts";
import * as processes from "./processes.ts";
import * as flows from "./flows.ts";
import * as operations from "./operations.ts";
import * as decisions from "./decisions.ts";

export const modules = [
  data,
  procedures,
  installs,
  issues,
  grants,
  rounds,
  safes,
  investments,
  holdings,
  sales,
  exits,
  votes,
  writes,
  processes,
  flows,
  operations,
  decisions,
] as const;
