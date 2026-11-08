// Activity's modules, in the order the concept is read: its table, its (empty) door, its three
// areas (the feed, the change feed, holdings), its change-log workflows, its one SDK flow, the six
// frozen operations it designs, and its decisions. links.ts re-exports pending links to documents
// and is not a module of records.

import * as data from "./data.ts";
import * as procedures from "./procedures.ts";
import * as feed from "./feed.ts";
import * as changes from "./changes.ts";
import * as holdings from "./holdings.ts";
import * as processes from "./processes.ts";
import * as flows from "./flows.ts";
import * as operations from "./operations.ts";
import * as decisions from "./decisions.ts";

export const modules = [data, procedures, feed, changes, holdings, processes, flows, operations, decisions] as const;
