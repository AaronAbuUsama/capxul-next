// Budgets' records for the target book: the budget and change tables with their machines and
// events, the (empty) door, the departments, tree, offices, ceilings, allowances and changes areas,
// the invitations area (the grants of `org member invite`), the change's durable process and the
// return of an ended invitation's grants, the Core SDK flows, the 19 operations and budgets' decisions.
// shapes.ts holds the rpc and flow schemas and no records. books/target/index.ts appends `modules`
// to conceptModules.

import * as data from "./data.ts";
import * as procedures from "./procedures.ts";
import * as departments from "./departments.ts";
import * as tree from "./tree.ts";
import * as offices from "./offices.ts";
import * as ceilings from "./ceilings.ts";
import * as allowances from "./allowances.ts";
import * as changes from "./changes.ts";
import * as invitations from "./invitations.ts";
import * as processes from "./processes.ts";
import * as flows from "./flows.ts";
import * as operations from "./operations.ts";
import * as decisions from "./decisions.ts";

export const modules = [
  data,
  procedures,
  departments,
  tree,
  offices,
  ceilings,
  allowances,
  changes,
  invitations,
  processes,
  flows,
  operations,
  decisions,
] as const;
