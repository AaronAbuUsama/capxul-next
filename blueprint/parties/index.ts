// Parties' records for the target book: the directory and the profile, the door's procedures, the
// profile rpcs and the web app's flows over them, and parties' decisions. blueprint/index.ts
// appends `modules` to conceptModules.

import * as data from "./data.ts";
import * as procedures from "./procedures.ts";
import * as profiles from "./profiles.ts";
import * as processes from "./processes.ts";
import * as flows from "./flows.ts";
import * as operations from "./operations.ts";
import * as decisions from "./decisions.ts";

export const modules = [data, procedures, profiles, processes, flows, operations, decisions] as const;
