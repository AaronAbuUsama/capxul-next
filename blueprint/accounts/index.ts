import * as stateGaps from "./state-gaps.ts";
// The accounts concept's records, as blueprint/index.ts takes them: every module whose exports
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
import * as runtime from "./runtime.ts";

export const modules = [stateGaps, data, procedures, admission, setup, grants, processes, flows, operations, decisions, runtime] as const;
