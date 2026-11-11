// Contacts' calls area: Frappe CRM's CRM Call Log, logged by hand (telephony medium Manual), with its
// FCRM Note, on a contact entry, a lead or a deal (decision contacts.call-logs). Only a member whose
// Safe wears the People hat logs one; every member reads them on the record's timeline.

import { Schema } from "effect";
import { budget, defineRpc } from "../../../packages/book/src/index.ts";
import { concept_contacts } from "../shared/foundation.ts";
import {
  error_INVALID_INPUT,
  error_NOT_AUTHENTICATED,
  error_ROLE_PERMISSION_DENIED,
  error_WRONG_STATE,
} from "../shared/vocabulary.ts";
import { CALL_STATUSES, table_crm_call_logs, table_crm_notes, table_timeline_links } from "./data.ts";
import { LOGGED, WHO_CRM_WRITE } from "./leads.ts";
import { CONVERSATION_GUARD, GUARD_READS, RECORD_READS, RECORD_RULE } from "./mail.ts";
import { CallItem } from "./timeline.ts";

const CRM = "github.com/frappe/crm@2cecd300:crm";
const S = Schema.String;

export const rpc_contacts_calls_log = defineRpc({
  id: "contacts.calls.log",
  title: "Log a call with a contact, lead or deal",
  about:
    CONVERSATION_GUARD +
    RECORD_RULE +
    "`type` is Incoming or Outgoing and `status` the call's outcome (Completed, No Answer, Busy, Failed, Canceled). The " +
    "number: as given (E.164), else the record's own primary mobile or phone, else none. The member is the caller " +
    "(CRM Call Log's `caller` for an outgoing call, `receiver` for an incoming one). A log records a call that is over, " +
    "so it ends no later than the world's now: `end` or `duration` (whole seconds, at most a day), not both, 0 when " +
    "neither; with no `start` the call ended now and started `duration` before; with `start` (an instant) it ended " +
    "`duration` after it, or at `end`. A start or end after the world's now, an end before the start, or another bad " +
    "value is INVALID_INPUT naming it. A `note` (1 to 10,000 characters) becomes an FCRM Note titled `Call with " +
    "<record>` on the same record, linked as the log's note. One transaction writes the log, its note, their timeline " +
    "links (the record, and the contact entry keeping the number; placed at the world's now, as Frappe CRM orders a " +
    "call by its creation) and their change-log rows. Returns the call.",
  concept: concept_contacts,
  kind: "mutation",
  who: WHO_CRM_WRITE,
  input: Schema.Struct({
    orgId: S,
    record: S,
    type: Schema.Literals(["Incoming", "Outgoing"]),
    status: Schema.Literals(CALL_STATUSES),
    number: Schema.optionalKey(S),
    start: Schema.optionalKey(S),
    end: Schema.optionalKey(S),
    duration: Schema.optionalKey(Schema.Int),
    note: Schema.optionalKey(S),
  }),
  output: CallItem,
  errors: [error_NOT_AUTHENTICATED, error_ROLE_PERMISSION_DENIED, error_INVALID_INPUT, error_WRONG_STATE],
  reads: [...GUARD_READS, ...RECORD_READS],
  writes: [table_crm_call_logs, table_crm_notes, table_timeline_links, ...LOGGED],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("write"),
  was: [`${CRM}/fcrm/doctype/crm_call_log/crm_call_log.json`, `${CRM}/fcrm/doctype/crm_call_log/crm_call_log.py:50`],
});
