// The accounts concept's records, as books/target/index.ts takes them: every module whose exports
// are this concept's records.

import * as data from "./data.ts";
import * as procedures from "./procedures.ts";
import * as admission from "./admission.ts";
import * as setup from "./setup.ts";
import * as grants from "./grants.ts";
import * as processes from "./processes.ts";
import * as flows from "./flows.ts";
import * as operations from "./operations.ts";
import * as decisions from "./decisions.ts";

export const modules = [data, procedures, admission, setup, grants, processes, flows, operations, decisions] as const;
