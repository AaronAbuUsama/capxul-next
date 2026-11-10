import * as stateGaps from "./state-gaps.ts";
// The devnet concept's module list: its records, in the order the conventions give. worlds.ts holds
// the eval world catalog as plain data (no records), listed so the book's readers find it.

import * as recordEntry from "./record-entry.ts";
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
import * as platformData from "./platform-data.ts";
import * as platformLifecycle from "./platform-lifecycle.ts";
import * as platformAccess from "./platform-access.ts";
import * as platformScenarios from "./platform-scenarios.ts";
import * as platformRuns from "./platform-runs.ts";
import * as platformDatasets from "./platform-datasets.ts";
import * as platformCohorts from "./platform-cohorts.ts";
import * as platformEnv from "./platform-env.ts";
import * as platformProcesses from "./platform-processes.ts";
import * as platformJourneys from "./platform-journeys.ts";
import * as platformDecisions from "./platform-decisions.ts";
import * as platformDecisionsData from "./platform-decisions-data.ts";

export const modules = [stateGaps, recordEntry, data, procedures, mail, gates, prices, jobs, processes, flows, worlds, worldData, worldRpcs, worldOps, worldProcesses, worldDecisions, operations, decisions, worldEvidence, platformData, platformLifecycle, platformAccess, platformScenarios, platformRuns, platformDatasets, platformCohorts, platformEnv, platformProcesses, platformJourneys, platformDecisions, platformDecisionsData] as const;
