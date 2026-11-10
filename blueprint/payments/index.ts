// The payments concept's records: the Payment ledger of record. blueprint/index.ts appends
// `...payments.modules` to its concept modules.

import * as data from "./data.ts";
import * as procedures from "./procedures.ts";
import * as commands from "./commands.ts";
import * as changes from "./changes.ts";
import * as ledger from "./ledger.ts";
import * as processes from "./processes.ts";
import * as flows from "./flows.ts";
import * as operations from "./operations.ts";
import * as decisions from "./decisions.ts";

export const modules = [data, procedures, commands, changes, ledger, processes, flows, operations, decisions] as const;
