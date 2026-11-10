// Requests' records for the target book: its tables and machines, its (empty) door, the issuer's,
// payer's, services', checkout and deposit-match rpcs, the request's durable process and the
// payment followers, the Core SDK flows, the 14 frozen operations and requests' decisions.
// blueprint/index.ts appends `modules` to conceptModules. shapes.ts and guards.ts hold no
// records.

import * as data from "./data.ts";
import * as procedures from "./procedures.ts";
import * as issuing from "./issuing.ts";
import * as inbox from "./inbox.ts";
import * as checkout from "./checkout.ts";
import * as deposits from "./deposits.ts";
import * as processes from "./processes.ts";
import * as flows from "./flows.ts";
import * as operations from "./operations.ts";
import * as decisions from "./decisions.ts";

export const modules = [data, procedures, issuing, inbox, checkout, deposits, processes, flows, operations, decisions] as const;
