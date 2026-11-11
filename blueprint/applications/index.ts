// The applications concept's records: registered applications, their publishable keys, the browser
// bootstrap, the deployment's health and quickstart test keys. blueprint/index.ts appends
// `...applications.modules` to its concept modules.

import * as data from "./data.ts";
import * as procedures from "./procedures.ts";
import * as bootstraps from "./bootstraps.ts";
import * as health from "./health.ts";
import * as keys from "./keys.ts";
import * as quickstarts from "./quickstarts.ts";
import * as processes from "./processes.ts";
import * as flows from "./flows.ts";
import * as operations from "./operations.ts";
import * as decisions from "./decisions.ts";

export const modules = [data, procedures, bootstraps, health, keys, quickstarts, processes, flows, operations, decisions] as const;
