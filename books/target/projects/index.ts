// The projects concept's modules, for books/target/index.ts: its tables, machines and events, its
// durable processes and its decisions. It has no door, rpcs, flows or operations yet: its commands
// are a decision pack for Aaron (projects.commands).

import * as data from "./data.ts";
import * as processes from "./processes.ts";
import * as decisions from "./decisions.ts";

export const modules = [data, processes, decisions] as const;
