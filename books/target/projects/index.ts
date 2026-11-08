// The projects concept's modules, for books/target/index.ts: its tables, machines and events, its
// door (`projects.bill-time`, the one money fact it shares: an invoice and the hours it bills), its
// durable processes and its decisions. It has no rpcs, flows or operations yet: its commands are a
// decision pack for Aaron (projects.commands).

import * as data from "./data.ts";
import * as procedures from "./procedures.ts";
import * as processes from "./processes.ts";
import * as decisions from "./decisions.ts";

export const modules = [data, procedures, processes, decisions] as const;
