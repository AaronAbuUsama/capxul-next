// The devnet concept's module list: its records, in the order the conventions give. worlds.ts holds
// the eval world catalog as plain data (no records), listed so the book's readers find it.

import * as data from "./data.ts";
import * as procedures from "./procedures.ts";
import * as mail from "./mail.ts";
import * as gates from "./gates.ts";
import * as prices from "./prices.ts";
import * as jobs from "./jobs.ts";
import * as processes from "./processes.ts";
import * as flows from "./flows.ts";
import * as worlds from "./worlds.ts";
import * as operations from "./operations.ts";
import * as worldData from "./world-data.ts";
import * as worldRpcs from "./world-rpcs.ts";
import * as worldOps from "./world-ops.ts";
import * as worldProcesses from "./world-processes.ts";
import * as worldDecisions from "./world-decisions.ts";
import * as decisions from "./decisions.ts";
import * as worldEvidence from "./world-evidence.ts";

export const modules = [data, procedures, mail, gates, prices, jobs, processes, flows, worlds, worldData, worldRpcs, worldOps, worldProcesses, worldDecisions, operations, decisions, worldEvidence] as const;
