import * as stateGaps from "./state-gaps.ts";
// The plugs concept's modules, for blueprint/index.ts. kit.ts is not a module: it only fills what a record repeats.

import * as data from "./data.ts";
import * as integrations from "./integrations.ts";
import * as signin from "./signin.ts";
import * as signer from "./signer.ts";
import * as roles from "./roles.ts";
import * as sessions from "./sessions.ts";
import * as events from "./events.ts";
import * as processes from "./processes.ts";
import * as flows from "./flows.ts";
import * as operations from "./operations.ts";
import * as decisions from "./decisions.ts";
import * as evidence from "./evidence.ts";

export const modules = [stateGaps, data, integrations, signin, signer, sessions, roles, events, processes, flows, operations, decisions, evidence] as const;
