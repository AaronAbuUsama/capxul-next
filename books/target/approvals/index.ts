// The approvals concept's module list, for books/target/index.ts.

import * as data from "./data.ts";
import * as procedures from "./procedures.ts";
import * as signing from "./signing.ts";
import * as processes from "./processes.ts";
import * as flows from "./flows.ts";
import * as operations from "./operations.ts";
import * as decisions from "./decisions.ts";

export const modules = [data, procedures, signing, processes, flows, operations, decisions] as const;
