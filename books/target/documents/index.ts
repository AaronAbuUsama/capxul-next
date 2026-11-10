// The documents concept's records: the exact content behind every document hash, its readers, and
// reading it (get, verify, render, export). books/target/index.ts appends `...documents.modules` to its
// concept modules.

import * as data from "./data.ts";
import * as procedures from "./procedures.ts";
import * as reading from "./reading.ts";
import * as processes from "./processes.ts";
import * as operations from "./operations.ts";
import * as decisions from "./decisions.ts";

export const modules = [data, procedures, reading, processes, operations, decisions] as const;
