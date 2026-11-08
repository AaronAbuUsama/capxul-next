// Contacts' third area, an Organization's deals: Frappe CRM's CRM Deal and its people (CRM
// Contacts), opened by hand or by a lead's conversion (./leads.ts), and moved through Frappe CRM's
// deal statuses to won or lost (decisions contacts.frappe-shape, contacts.crm-statuses). Only an
// Organization keeps deals. Every member reads them; only a member whose Safe wears the People hat
// changes them (decision contacts.crm-permission). New capabilities, reached through the Core SDK
// (decision contacts.crm-capabilities). A deal is a forecast: nothing here is signed and no money
// moves.

import { Schema } from "effect";
import { budget, defineRpc } from "../../../packages/book/src/index.ts";
import { concept_contacts } from "../shared/foundation.ts";
import {
  error_INVALID_INPUT,
  error_NOT_AUTHENTICATED,
  error_ROLE_PERMISSION_DENIED,
} from "../shared/vocabulary.ts";
import { DEAL_STATUSES, DealStage, LOST_REASONS, machine_deal, table_contacts, table_deal_contacts, table_deals } from "./data.ts";
import { table_org_deployments, table_org_members } from "../organizations/data.ts";
import { WHO_CRM_READ, WHO_CRM_WRITE } from "./leads.ts";

const CRM = "github.com/frappe/crm@2cecd300:crm";
const DEAL = `${CRM}/fcrm/doctype/crm_deal`;

const S = Schema.String;
const N = Schema.Number;
const NullOr = Schema.NullOr;

const Status = Schema.Literals(Object.keys(DEAL_STATUSES) as [keyof typeof DEAL_STATUSES, ...(keyof typeof DEAL_STATUSES)[]]);
const DealContact = Schema.Struct({ contact: S, is_primary: Schema.Boolean });

/** A deal as every read and write returns it, in CRM Deal's field names. */
export const DealView = Schema.Struct({
  id: S,
  status: Status,
  stage: DealStage,
  /** The company: an organization entry of the Organization's book. */
  organization: NullOr(S),
  /** Its people: contact entries of the book, at most one primary. */
  contacts: Schema.Array(DealContact),
  lead: NullOr(S),
  /** The member who works it: their PartyId. */
  deal_owner: NullOr(S),
  probability: N,
  deal_value: NullOr(S),
  expected_deal_value: NullOr(S),
  currency: NullOr(S),
  expected_closure_date: NullOr(S),
  closedAt: NullOr(N),
  next_step: NullOr(S),
  source: NullOr(S),
  lost_reason: NullOr(Schema.Literals(LOST_REASONS)),
  lost_notes: NullOr(S),
  createdAt: N,
  updatedAt: N,
});

const DealFields = Schema.Struct({
  organization: Schema.optionalKey(NullOr(S)),
  contacts: Schema.optionalKey(Schema.Array(DealContact)),
  deal_owner: Schema.optionalKey(NullOr(S)),
  probability: Schema.optionalKey(N),
  deal_value: Schema.optionalKey(NullOr(S)),
  expected_deal_value: Schema.optionalKey(NullOr(S)),
  currency: Schema.optionalKey(NullOr(S)),
  expected_closure_date: Schema.optionalKey(NullOr(S)),
  next_step: Schema.optionalKey(NullOr(S)),
  source: Schema.optionalKey(NullOr(S)),
});

const READ_ERRORS = [error_NOT_AUTHENTICATED, error_ROLE_PERMISSION_DENIED, error_INVALID_INPUT];
const READS = [table_deals, table_deal_contacts, table_org_members];
const WRITE_READS = [...READS, table_contacts, table_org_deployments];
const GUARD =
  "It first checks the caller's Seat wears the People hat (the deployment's people hat id, wearers from indexing), " +
  "else ROLE_PERMISSION_DENIED and nothing is written. ";

export const rpc_contacts_deals_save = defineRpc({
  id: "contacts.deals.save",
  title: "Open a deal, or change one",
  about:
    GUARD +
    "With no `deal` it opens a new one by hand (`start`): status Qualification, stage open, the fields given. With " +
    "`deal` it changes the fields given and keeps the rest, whatever its stage, as Frappe lets a won or lost deal be " +
    "edited; its status moves only through `contacts.deals.move`. `organization` must be a CRM Organization entry of the " +
    "Organization's book and each of `contacts` a Contact entry of it, at most one primary and the only one primary " +
    "(Frappe's `set_primary_contact`); `contacts` replaces the deal's people. `deal_owner` is the PartyId of an active " +
    "Seat; `probability` 0 to 100, taken from the status's (Qualification 10) when none is given or 0, as Frappe's " +
    "`update_default_probability`; values non-negative decimals given with `currency` (3 to 10 capitals); " +
    "`expected_closure_date` a calendar date; texts trimmed and at most 140. A bad value, or a deal id not in this " +
    "Organization, is INVALID_INPUT naming the field, and nothing is written. Returns the deal.",
  concept: concept_contacts,
  kind: "mutation",
  who: WHO_CRM_WRITE,
  input: Schema.Struct({ orgId: S, deal: Schema.optionalKey(S), fields: DealFields }),
  output: DealView,
  errors: READ_ERRORS,
  reads: WRITE_READS,
  writes: [table_deals, table_deal_contacts],
  drives: [machine_deal.t.start],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("write"),
  was: [`${DEAL}/crm_deal.json`, `${DEAL}/crm_deal.py:90`, `${DEAL}/crm_deal.py:129`, `${DEAL}/crm_deal.py:254`, `${DEAL}/crm_deal.py:482`],
});

export const rpc_contacts_deals_move = defineRpc({
  id: "contacts.deals.move",
  title: "Move a deal to another status: worked, won or lost",
  about:
    GUARD +
    "Sets the deal's status to one of Frappe CRM's default deal statuses. The status's type names the stage: within the " +
    "same stage only `status` changes, with no transition; to another stage it drives `reopen`, `engage`, `win` or " +
    "`lose`. Winning sets `closed_at` to the one clock's now (Frappe's `closed_date`). A lost status needs a " +
    "`lost_reason` from Frappe's list, and `Other` also needs `lost_notes` (Frappe's `validate_lost_reason`), else " +
    "INVALID_INPUT; moving out of lost clears them. A probability still 0 takes the new status's. The same status again " +
    "returns the deal unchanged. A deal id not in this Organization is INVALID_INPUT. Returns the deal.",
  concept: concept_contacts,
  kind: "mutation",
  who: WHO_CRM_WRITE,
  input: Schema.Struct({
    orgId: S,
    deal: S,
    status: Status,
    lost_reason: Schema.optionalKey(Schema.Literals(LOST_REASONS)),
    lost_notes: Schema.optionalKey(S),
  }),
  output: DealView,
  errors: READ_ERRORS,
  reads: [...READS, table_org_deployments],
  writes: [table_deals],
  drives: [machine_deal.t.reopen, machine_deal.t.engage, machine_deal.t.win, machine_deal.t.lose],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("write"),
  was: [`${CRM}/install.py:97`, `${DEAL}/crm_deal.py:98`, `${DEAL}/crm_deal.py:247`, `${DEAL}/crm_deal.py:282`],
});

export const rpc_contacts_deals_list = defineRpc({
  id: "contacts.deals.list",
  title: "List an Organization's deals, most recent change first",
  about:
    "One page of the Organization's deals with their people, newest change first (`deals-by-activity`), or only those " +
    "at one `stage` (`deals-by-stage`), or one company's (`organization`, by `deals-by-organization`), or one person's " +
    "(`contact`, by `deal-contacts-by-contact`, Frappe's `get_linked_deals`). `limit` is 1 to 100 (25 when absent); " +
    "`after` is the opaque cursor the last page returned, bound to this Organization and filter: another's, or a forged " +
    "one, is INVALID_INPUT. A connected head's sync reads its changes the same way.",
  concept: concept_contacts,
  kind: "query",
  who: WHO_CRM_READ,
  input: Schema.Struct({
    orgId: S,
    stage: Schema.optionalKey(DealStage),
    organization: Schema.optionalKey(S),
    contact: Schema.optionalKey(S),
    limit: Schema.optionalKey(Schema.Int),
    after: Schema.optionalKey(S),
  }),
  output: Schema.Struct({ items: Schema.Array(DealView), nextCursor: NullOr(S) }),
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
  was: [`${DEAL}/crm_deal.py:304`, `${DEAL}/crm_deal.py:371`, `${CRM}/api/contact.py:47`],
});

export const rpc_contacts_deals_get = defineRpc({
  id: "contacts.deals.get",
  title: "Read one deal with its people, or null",
  about:
    "The deal for one id in the Organization with its people, from its key and its `deal-contacts` rows; null when it is " +
    "not this Organization's. An id that is not well formed is INVALID_INPUT.",
  concept: concept_contacts,
  kind: "query",
  who: WHO_CRM_READ,
  input: Schema.Struct({ orgId: S, deal: S }),
  output: NullOr(DealView),
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
  was: [`${DEAL}/crm_deal.json`],
});
