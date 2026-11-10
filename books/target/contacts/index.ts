// The contacts concept's records: the address book of whoever you act as, and each Organization's
// CRM in Frappe CRM's shapes (contacts and organizations, leads, deals) with every conversation on
// one timeline per record (emails, WhatsApp, calls, notes and tasks). books/target/index.ts appends
// `...contacts.modules` to its concept modules.

import * as data from "./data.ts";
import * as procedures from "./procedures.ts";
import * as book from "./book.ts";
import * as flows from "./flows.ts";
import * as operations from "./operations.ts";
import * as decisions from "./decisions.ts";

export const modules = [
  data, procedures, book, flows, operations, decisions,
] as const;
