// Contacts' second area, an Organization's leads: Frappe CRM's CRM Lead, from capture to a deal
// (decisions contacts.frappe-shape, contacts.crm-statuses, contacts.lead-conversion). Only an
// Organization keeps leads. Every member reads them; only a member whose Safe wears the People hat
// changes them, as with the contact book (decision contacts.crm-permission). These are new
// capabilities, not among the 215: the Core SDK reaches them for the Organization's agents, and
// their CLI commands wait on a decision (contacts.crm-capabilities); a connected head's edits come
// in through contacts.head.sync, by the same rules. Nothing here is signed and no money moves.

import { Schema } from "effect";
import { budget, defineRpc } from "../../../packages/book/src/index.ts";
import { concept_contacts } from "../shared/foundation.ts";
import {
  error_INVALID_INPUT,
  error_NOT_AUTHENTICATED,
  error_ROLE_PERMISSION_DENIED,
  error_WRONG_STATE,
} from "../shared/vocabulary.ts";
import {
  EMPLOYEE_RANGES,
  LEAD_STATUSES,
  LOST_REASONS,
  LeadStage,
  machine_deal,
  machine_lead,
  table_contact_changes,
  table_contacts,
  table_crm_settings,
  table_deal_contacts,
  table_deals,
  table_leads,
} from "./data.ts";
import { table_org_deployments, table_org_members } from "../organizations/data.ts";
import { table_parties } from "../parties/data.ts";
import { procedure_parties_resolve_recipient } from "../parties/procedures.ts";

const CRM = "github.com/frappe/crm@2cecd300:crm";
const LEAD = `${CRM}/fcrm/doctype/crm_lead`;

const S = Schema.String;
const NullOr = Schema.NullOr;

const Status = Schema.Literals(Object.keys(LEAD_STATUSES) as [keyof typeof LEAD_STATUSES, ...(keyof typeof LEAD_STATUSES)[]]);

/** A lead as every read and write returns it, in CRM Lead's field names. */
export const LeadView = Schema.Struct({
  id: S,
  status: Status,
  stage: LeadStage,
  first_name: NullOr(S),
  last_name: NullOr(S),
  email: NullOr(S),
  mobile_no: NullOr(S),
  phone: NullOr(S),
  job_title: NullOr(S),
  organization: NullOr(S),
  website: NullOr(S),
  industry: NullOr(S),
  territory: NullOr(S),
  no_of_employees: NullOr(Schema.Literals(EMPLOYEE_RANGES)),
  /** In the Organization's currency: CRM Lead keeps none of its own. */
  annual_revenue: NullOr(S),
  source: NullOr(S),
  /** The member who works it: their PartyId. */
  lead_owner: NullOr(S),
  lost_reason: NullOr(Schema.Literals(LOST_REASONS)),
  lost_notes: NullOr(S),
  /** The deal its conversion made. */
  deal: NullOr(S),
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
});

/** The fields a save may set: each given replaces the stored one, null clears it. */
const LeadFields = Schema.Struct({
  first_name: Schema.optionalKey(NullOr(S)),
  last_name: Schema.optionalKey(NullOr(S)),
  email: Schema.optionalKey(NullOr(S)),
  mobile_no: Schema.optionalKey(NullOr(S)),
  phone: Schema.optionalKey(NullOr(S)),
  job_title: Schema.optionalKey(NullOr(S)),
  organization: Schema.optionalKey(NullOr(S)),
  website: Schema.optionalKey(NullOr(S)),
  industry: Schema.optionalKey(NullOr(S)),
  territory: Schema.optionalKey(NullOr(S)),
  no_of_employees: Schema.optionalKey(NullOr(Schema.Literals(EMPLOYEE_RANGES))),
  annual_revenue: Schema.optionalKey(NullOr(S)),
  source: Schema.optionalKey(NullOr(S)),
  lead_owner: Schema.optionalKey(NullOr(S)),
});

const READ_ERRORS = [error_NOT_AUTHENTICATED, error_ROLE_PERMISSION_DENIED, error_INVALID_INPUT];
const WRITE_ERRORS = [...READ_ERRORS, error_WRONG_STATE];
const READS = [table_leads, table_org_members];
/** A write also reads the People hat's id from the deployment, and its wearers from indexing once contacts depends on it (contacts.members-write). */
const WRITE_READS = [...READS, table_org_deployments];
export const WHO_CRM_READ =
  "A member of the Organization (an active Seat, a person's or an agent's). Anyone else naming it is ROLE_PERMISSION_DENIED.";
export const WHO_CRM_WRITE =
  "A member of the Organization whose Safe wears its People hat, as for its contact book: the founder from setup, or an " +
  "agent of the Organization's given the hat. Any other member reads but is ROLE_PERMISSION_DENIED with nothing written.";
const GUARD =
  "It first checks the caller's Seat wears the People hat (the deployment's people hat id, wearers from indexing), " +
  "else ROLE_PERMISSION_DENIED and nothing is written. Each record it changes is appended to `contact-changes` and " +
  "takes that seq as its `version` (contacts.change-log). ";
/** What a CRM write writes besides its records: the change log and its counter. */
export const LOGGED = [table_contact_changes, table_crm_settings];
const FIELD_RULES =
  "Each text is trimmed and at most 140 characters (a mailbox well formed and at most 254, a website at most 255), " +
  "`annual_revenue` a non-negative decimal in the Organization's currency (CRM Lead has no currency field), `lead_owner` the PartyId of an " +
  "active Seat of the Organization and never the lead's own mailbox (Frappe's `validate_email`); a bad value is " +
  "INVALID_INPUT naming the field, and nothing is written. ";

export const rpc_contacts_leads_save = defineRpc({
  id: "contacts.leads.save",
  title: "Capture a lead, or change one",
  about:
    GUARD +
    "With no `lead` it captures a new one (`capture`): status New, stage open, the fields given. A lead needs a person's " +
    "first name, a company's name or a mailbox, as Frappe's `set_lead_name` requires, else INVALID_INPUT. With `lead` it " +
    "changes the fields given and keeps the rest; its status moves only through `contacts.leads.move`. " +
    FIELD_RULES +
    "A converted lead is WRONG_STATE: its deal carries the work on. The lead's mailbox stays the Organization's private " +
    "note and names nobody in the directory. A lead id not in this Organization is INVALID_INPUT. Returns the lead.",
  concept: concept_contacts,
  kind: "mutation",
  who: WHO_CRM_WRITE,
  input: Schema.Struct({ orgId: S, lead: Schema.optionalKey(S), fields: LeadFields }),
  output: LeadView,
  errors: WRITE_ERRORS,
  reads: WRITE_READS,
  writes: [table_leads, ...LOGGED],
  drives: [machine_lead.t.capture],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("write"),
  was: [`${LEAD}/crm_lead.json`, `${LEAD}/crm_lead.py:91`, `${LEAD}/crm_lead.py:140`, `${LEAD}/crm_lead.py:155`],
});

export const rpc_contacts_leads_move = defineRpc({
  id: "contacts.leads.move",
  title: "Move a lead to another status",
  about:
    GUARD +
    "Sets the lead's status to one of Frappe CRM's default lead statuses. The status's type names the stage: within the " +
    "same stage only `status` changes, with no transition; to another stage it drives `reopen`, `engage`, `qualify` or " +
    "`lose`. Converted is a won status like Qualified, as Frappe's defaults type it; it makes no deal, which only " +
    "`contacts.leads.convert` does. A lost status needs a `lost_reason` from Frappe's list, and `Other` also needs " +
    "`lost_notes` (Frappe's `validate_lost_reason`), else INVALID_INPUT; moving out of lost clears them. A converted " +
    "lead is WRONG_STATE. The same status again returns the lead unchanged. Returns the lead.",
  concept: concept_contacts,
  kind: "mutation",
  who: WHO_CRM_WRITE,
  input: Schema.Struct({
    orgId: S,
    lead: S,
    status: Status,
    lost_reason: Schema.optionalKey(Schema.Literals(LOST_REASONS)),
    lost_notes: Schema.optionalKey(S),
  }),
  output: LeadView,
  errors: WRITE_ERRORS,
  reads: WRITE_READS,
  writes: [table_leads, ...LOGGED],
  drives: [machine_lead.t.reopen, machine_lead.t.engage, machine_lead.t.qualify, machine_lead.t.lose],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("write"),
  was: [`${CRM}/install.py:46`, `${LEAD}/crm_lead.py:173`],
});

export const rpc_contacts_leads_convert = defineRpc({
  id: "contacts.leads.convert",
  title: "Convert a lead to a deal, with its contact and organization",
  about:
    GUARD +
    "Frappe CRM's `convert_to_deal`, in one transaction that locks the lead first. A lost lead is WRONG_STATE (Frappe: " +
    "'Cannot convert a lead with status' of type Lost); a converted one answers the deal it made (its `deal_id`, read " +
    "under the lock: Frappe's 'Return Existing'), so a retry never makes a second. The person: the `contact` entry given " +
    "(a Contact of this book), else the lead's mailbox " +
    "resolved through `parties.resolve-recipient` (named in the directory if new, as `contact add` by email) and the " +
    "book's entry for that Party or a new one born from it, else, with no mailbox, a new private Contact; a new entry " +
    "takes the lead's name as its label and its numbers and job title as details. The company: the `organization` entry " +
    "given (a CRM Organization of this book), else, when the lead names a company, the book's CRM Organization entry " +
    "whose shown name is that name (trimmed, case aside, as Frappe's `create_organization` finds one by " +
    "`organization_name`), else a new private CRM Organization labelled with it and holding its website, industry, " +
    "territory, size and revenue (with no currency, as Frappe copies it). The person's entry takes the company when it " +
    "has none. Then the deal is born (`start`): " +
    "status Qualification, the company, the person as its primary, the lead, its owner as `deal_owner`, its source, and " +
    "the `deal` fields given (`deal_value`, `expected_deal_value`, `currency`, `expected_closure_date`). Last the lead " +
    "drives `convert` with the deal's id, status Qualified (Frappe's `mark_converted`). A given entry not in this " +
    "book, or of the other doctype, is INVALID_INPUT and nothing is written, the named Party included. Returns the lead " +
    "and the deal.",
  concept: concept_contacts,
  kind: "mutation",
  who: WHO_CRM_WRITE,
  input: Schema.Struct({
    orgId: S,
    lead: S,
    contact: Schema.optionalKey(S),
    organization: Schema.optionalKey(S),
    deal: Schema.optionalKey(Schema.Struct({
      deal_value: Schema.optionalKey(S),
      expected_deal_value: Schema.optionalKey(S),
      currency: Schema.optionalKey(S),
      expected_closure_date: Schema.optionalKey(S),
    })),
  }),
  output: Schema.Struct({ lead: LeadView, deal: S, contact: S, organization: NullOr(S) }),
  errors: WRITE_ERRORS,
  reads: [...WRITE_READS, table_contacts, table_deals, table_parties],
  writes: [table_leads, table_deals, table_deal_contacts, table_contacts, ...LOGGED],
  drives: [machine_lead.t.convert, machine_deal.t.start],
  invokes: [procedure_parties_resolve_recipient],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("write"),
  was: [`${LEAD}/crm_lead.py:546`, `${LEAD}/crm_lead.py:230`, `${LEAD}/crm_lead.py:267`, `${LEAD}/crm_lead.py:354`, `${LEAD}/crm_lead.py:583`],
});

export const rpc_contacts_leads_list = defineRpc({
  id: "contacts.leads.list",
  title: "List an Organization's leads, most recent change first",
  about:
    "One page of the Organization's leads, newest change first (`leads-by-activity`), or only those at one `stage` " +
    "(`leads-by-stage`), as Frappe CRM's list and kanban read them. `limit` is 1 to 100 (25 when absent); `after` is the " +
    "opaque cursor the last page returned, bound to this Organization and stage: another's, or a forged one, is " +
    "INVALID_INPUT.",
  concept: concept_contacts,
  kind: "query",
  who: WHO_CRM_READ,
  input: Schema.Struct({
    orgId: S,
    stage: Schema.optionalKey(LeadStage),
    limit: Schema.optionalKey(Schema.Int),
    after: Schema.optionalKey(S),
  }),
  output: Schema.Struct({ items: Schema.Array(LeadView), nextCursor: NullOr(S) }),
  errors: READ_ERRORS,
  reads: READS,
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("read"),
  was: [`${LEAD}/crm_lead.py:470`, `${LEAD}/crm_lead.py:537`],
});

export const rpc_contacts_leads_get = defineRpc({
  id: "contacts.leads.get",
  title: "Read one lead, or null",
  about:
    "The lead for one id in the Organization, from its key; null when it is not this Organization's. An id that is not " +
    "well formed is INVALID_INPUT.",
  concept: concept_contacts,
  kind: "query",
  who: WHO_CRM_READ,
  input: Schema.Struct({ orgId: S, lead: S }),
  output: NullOr(LeadView),
  errors: READ_ERRORS,
  reads: READS,
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("read"),
  was: [`${LEAD}/crm_lead.json`],
});
