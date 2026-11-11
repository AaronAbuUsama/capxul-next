// The contacts concept's records: the address book of whoever you act as, and each Organization's
// CRM in Frappe CRM's shapes (contacts and organizations, leads, deals) with every conversation on
// one timeline per record (emails, WhatsApp, calls, notes and tasks). books/target/index.ts appends
// `...contacts.modules` to its concept modules.

import * as data from "./data.ts";
import * as procedures from "./procedures.ts";
import * as book from "./book.ts";
import * as leads from "./leads.ts";
import * as deals from "./deals.ts";
import * as timeline from "./timeline.ts";
import * as mail from "./mail.ts";
import * as whatsapp from "./whatsapp.ts";
import * as notes from "./notes.ts";
import * as tasks from "./tasks.ts";
import * as calls from "./calls.ts";
import * as processes from "./processes.ts";
import * as flows from "./flows.ts";
import * as operations from "./operations.ts";
import * as decisions from "./decisions.ts";

export const modules = [
  data, procedures, book, leads, deals, timeline, mail, whatsapp, notes, tasks, calls, processes, flows, operations, decisions,
] as const;
