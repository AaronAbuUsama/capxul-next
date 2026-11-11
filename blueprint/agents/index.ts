// The agents concept's records for the target book: the agent and change tables with their
// machines and events, the (empty) door, the changes and roster areas, the change's durable
// process, the Core SDK flows, the eight operations and agents' decisions. shapes.ts holds the rpc,
// flow and operation schemas and no records. blueprint/index.ts appends `modules` to
// conceptModules.

import * as data from "./data.ts";
import * as procedures from "./procedures.ts";
import * as changes from "./changes.ts";
import * as roster from "./roster.ts";
import * as processes from "./processes.ts";
import * as flows from "./flows.ts";
import * as operations from "./operations.ts";
import * as decisions from "./decisions.ts";

export const modules = [data, procedures, changes, roster, processes, flows, operations, decisions] as const;
