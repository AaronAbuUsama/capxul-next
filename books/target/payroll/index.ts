// The payroll concept's module list, for books/target/index.ts. (shapes.ts holds only Schemas, no records.)
//
// staged.ts is written but not listed: it pays a run through payments' door, and registers once payroll
// depends on payments (decision payroll.pays-through-payments).

import * as data from "./data.ts";
import * as procedures from "./procedures.ts";
import * as holders from "./holders.ts";
import * as payees from "./payees.ts";
import * as writes from "./writes.ts";
import * as employees from "./employees.ts";
import * as structures from "./structures.ts";
import * as runs from "./runs.ts";
import * as slips from "./slips.ts";
import * as processes from "./processes.ts";
import * as flows from "./flows.ts";
import * as operations from "./operations.ts";
import * as decisions from "./decisions.ts";

export const modules = [
  data,
  procedures,
  holders,
  payees,
  writes,
  employees,
  structures,
  runs,
  slips,
  processes,
  flows,
  operations,
  decisions,
] as const;
