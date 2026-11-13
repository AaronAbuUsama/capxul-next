// The access concept of the target book: every module of its design. blueprint/index.ts adds
// these to the shared records.

import * as data from "./data.ts";
import * as procedures from "./procedures.ts";
import * as signIn from "./sign-in.ts";
import * as sessions from "./sessions.ts";
import * as assistants from "./assistants.ts";
import * as processes from "./processes.ts";
import * as flows from "./flows.ts";
import * as operations from "./operations.ts";
import * as decisions from "./decisions.ts";
import * as runtime from "./runtime.ts";

export const modules = [data, procedures, signIn, sessions, assistants, processes, flows, operations, decisions, runtime] as const;
