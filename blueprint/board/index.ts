// The board concept's modules, for blueprint/index.ts (the shape of shared/index.ts).

import * as data from "./data.ts";
import * as procedures from "./procedures.ts";
import * as directors from "./directors.ts";
import * as proposals from "./proposals.ts";
import * as officers from "./officers.ts";
import * as processes from "./processes.ts";
import * as flows from "./flows.ts";
import * as operations from "./operations.ts";
import * as decisions from "./decisions.ts";

export const modules = [data, procedures, directors, proposals, officers, processes, flows, operations, decisions] as const;
