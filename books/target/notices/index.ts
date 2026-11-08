// The notices concept's modules, for books/target/index.ts (the shape of shared/index.ts). kit.ts and
// links.ts are not modules: kit.ts builds workflow records for the area files, links.ts re-exports
// board's records by their conventional names.

import * as data from "./data.ts";
import * as procedures from "./procedures.ts";
import * as accounts from "./accounts.ts";
import * as organizations from "./organizations.ts";
import * as budgets from "./budgets.ts";
import * as board from "./board.ts";
import * as payments from "./payments.ts";
import * as payroll from "./payroll.ts";
import * as banking from "./banking.ts";
import * as requests from "./requests.ts";
import * as equity from "./equity.ts";
import * as processes from "./processes.ts";
import * as flows from "./flows.ts";
import * as operations from "./operations.ts";
import * as decisions from "./decisions.ts";

export const modules = [
  data,
  procedures,
  accounts,
  organizations,
  budgets,
  board,
  payments,
  payroll,
  banking,
  requests,
  equity,
  processes,
  flows,
  operations,
  decisions,
] as const;
