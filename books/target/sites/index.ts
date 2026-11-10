// The sites concept's modules, for books/target/index.ts.

import * as data from "./data.ts";
import * as sites from "./sites.ts";
import * as door from "./door.ts";
import * as processes from "./processes.ts";
import * as operations from "./operations.ts";
import * as decisions from "./decisions.ts";

export const modules = [data, sites, door, processes, operations, decisions] as const;
