// Indexing's records for the target book: Ponder's views of the chain, scoped by Safe, and
// indexing's decisions. It owns no procedure, rpc, workflow, flow or operation
// (indexing.tables-only); those modules are kept, empty, so the folder has the usual shape.
// blueprint/index.ts appends `modules` to conceptModules.

import * as data from "./data.ts";
import * as procedures from "./procedures.ts";
import * as processes from "./processes.ts";
import * as flows from "./flows.ts";
import * as operations from "./operations.ts";
import * as decisions from "./decisions.ts";

export const modules = [data, procedures, processes, flows, operations, decisions] as const;
