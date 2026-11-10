// The plugs concept's modules, for books/target/index.ts. kit.ts is not a module: it only fills what a record repeats.

import * as data from "./data.ts";
import * as integrations from "./integrations.ts";
import * as signin from "./signin.ts";
import * as signer from "./signer.ts";
import * as roles from "./roles.ts";
import * as events from "./events.ts";
import * as processes from "./processes.ts";
import * as flows from "./flows.ts";
import * as operations from "./operations.ts";
import * as decisions from "./decisions.ts";

export const modules = [data, integrations, signin, signer, roles, events, processes, flows, operations, decisions] as const;
