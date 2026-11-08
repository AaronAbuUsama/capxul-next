// The payroll concept's module list, for books/target/index.ts. (shapes.ts holds only Schemas, no records.)
//
// staged.ts pays a run through payments' door and follows the settled facts back. It is listed now that
// payroll depends on payments (payroll.pays-through-payments, dependencies.payments-payroll).

import * as data from "./data.ts";
import * as procedures from "./procedures.ts";
import * as holders from "./holders.ts";
import * as payees from "./payees.ts";
import * as writes from "./writes.ts";
import * as employees from "./employees.ts";
import * as structures from "./structures.ts";
import * as runs from "./runs.ts";
import * as slips from "./slips.ts";
import * as staged from "./staged.ts";
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
  staged,
  processes,
  flows,
  operations,
  decisions,
] as const;
