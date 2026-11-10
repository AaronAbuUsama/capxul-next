// Media's records for the target book: the stored files and a file's life, the upload and serving
// rpcs, the identity document's process, the web app's flows, and media's decisions. Its door has
// no procedure and it owns no operation (media.door); those modules are kept, empty, so the folder
// has the usual shape. blueprint/index.ts appends `modules` to conceptModules.

import * as data from "./data.ts";
import * as procedures from "./procedures.ts";
import * as files from "./files.ts";
import * as processes from "./processes.ts";
import * as flows from "./flows.ts";
import * as operations from "./operations.ts";
import * as decisions from "./decisions.ts";

export const modules = [data, procedures, files, processes, flows, operations, decisions] as const;
