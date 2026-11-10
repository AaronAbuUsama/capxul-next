// Banking's records for the target book: its tables and machines, its door, the rpcs of each area
// (verification, bank details, saved accounts, deposits, payouts, Bridge's inbox), its durable
// processes, its Core SDK flows, the operation records of the frozen operations it owns, and its
// decisions. blueprint/index.ts appends `modules` to conceptModules.

import * as data from "./data.ts";
import * as procedures from "./procedures.ts";
import * as verification from "./verification.ts";
import * as details from "./details.ts";
import * as accounts from "./accounts.ts";
import * as deposits from "./deposits.ts";
import * as payouts from "./payouts.ts";
import * as inbox from "./inbox.ts";
import * as processes from "./processes.ts";
import * as flows from "./flows.ts";
import * as operations from "./operations.ts";
import * as decisions from "./decisions.ts";

export const modules = [
  data,
  procedures,
  verification,
  details,
  accounts,
  deposits,
  payouts,
  inbox,
  processes,
  flows,
  operations,
  decisions,
] as const;
