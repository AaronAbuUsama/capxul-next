// Contacts' notes area: Frappe CRM's FCRM Note on a contact entry, a lead or a deal. Only a member whose
// Safe wears the People hat writes one (contacts.crm-permission); every member reads them on the
// record's timeline. A note is changed, never deleted (decision contacts.notes-kept).

import { Schema } from "effect";
import { budget, defineRpc } from "../../../packages/book/src/index.ts";
import { concept_contacts } from "../shared/foundation.ts";
import {
  error_INVALID_INPUT,
  error_NOT_AUTHENTICATED,
  error_ROLE_PERMISSION_DENIED,
  error_WRONG_STATE,
} from "../shared/vocabulary.ts";
import { table_crm_notes, table_timeline_links } from "./data.ts";
import { LOGGED, WHO_CRM_WRITE } from "./leads.ts";
import { CONVERSATION_GUARD, GUARD_READS, RECORD_READS, RECORD_RULE } from "./mail.ts";
import { NoteItem } from "./timeline.ts";

const CRM = "github.com/frappe/crm@2cecd300:crm";
const S = Schema.String;

/** The fields a note's save may set: each given replaces the stored one; content may be cleared with null. */
export const NoteFields = Schema.Struct({
  title: Schema.optionalKey(S),
  content: Schema.optionalKey(Schema.NullOr(S)),
});

export const rpc_contacts_notes_save = defineRpc({
  id: "contacts.notes.save",
  title: "Add a note on a contact, lead or deal, or change one",
  about:
    CONVERSATION_GUARD +
    "With no `note` (`org crm note add`) it adds one on `record`. " +
    RECORD_RULE +
    "A note needs a title, 1 to 140 characters, and takes content up to 10,000. With `note` (`org crm note change`) " +
    "it sets the title or content given and keeps the rest, whoever wrote it; a change that gives nothing, a blank " +
    "title, or a note id not in this CRM is INVALID_INPUT. One transaction writes the note (by the member, at the " +
    "world's now), on an add its timeline link on its record, and its change-log row. Returns the note.",
  concept: concept_contacts,
  kind: "mutation",
  who: WHO_CRM_WRITE,
  input: Schema.Struct({ orgId: S, note: Schema.optionalKey(S), record: Schema.optionalKey(S), fields: NoteFields }),
  output: NoteItem,
  errors: [error_NOT_AUTHENTICATED, error_ROLE_PERMISSION_DENIED, error_INVALID_INPUT, error_WRONG_STATE],
  reads: [...GUARD_READS, ...RECORD_READS, table_crm_notes],
  writes: [table_crm_notes, table_timeline_links, ...LOGGED],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("write"),
  was: [`${CRM}/fcrm/doctype/fcrm_note/fcrm_note.json`, `${CRM}/fcrm/doctype/fcrm_note/fcrm_note.py:13`],
});
