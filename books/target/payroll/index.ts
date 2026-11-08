// The payroll concept's module list, for books/target/index.ts. (shapes.ts holds only Schemas, no records.)

import * as data from "./data.ts";
import * as procedures from "./procedures.ts";
import * as holders from "./holders.ts";
import * as payees from "./payees.ts";
import * as writes from "./writes.ts";
import * as processes from "./processes.ts";
import * as flows from "./flows.ts";
import * as operations from "./operations.ts";
import * as decisions from "./decisions.ts";

export const modules = [data, procedures, holders, payees, writes, processes, flows, operations, decisions] as const;
