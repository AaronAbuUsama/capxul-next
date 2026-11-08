// Contacts' Core SDK flows.
//
// The commands whose terminal mode composes several calls (A4). At a terminal, `contact label`,
// `hide` and `unhide` let the person pick an entry from the book and show it before the one write;
// the CLI calls only the flow, and the flow asks through the host's prompter (a `wait.person` span,
// never system time). Given an entry's id and `--confirm`, as a script must, each flow makes exactly
// one rpc call. `contact add` and `contact list` are one rpc each, so they have no flow (decision
// contacts.guided-flows). `contact get` is banking's flow, which steps through this concept's list
// and get rpcs (decision contacts.get-moved). The method takes the book as input (`book: { kind:
// "person" }`, or `{ kind: "organization", orgId }` for `--org`), so one SDK method serves both
// books; the old `client.org(id).addressBook` twin goes.
//
// The CRM's methods (recording a person or company, leads, deals) serve the SDK, not the CLI: they
// are new capabilities, not among the 215, used by the Organization's agents (its Forward Deployed
// Engineer first); their CLI commands are the pack's recommendation, booked in the CLI operations
// pass by rules.new-operations (decision contacts.crm-capabilities). Each
// is one rpc. A connected Frappe head syncs through contacts' own process (./processes.ts), not
// these methods.

import { Schema } from "effect";
import { budget, defineFlow, type Rpc } from "../../../packages/book/src/index.ts";
import { component_core_sdk } from "../shared/foundation.ts";
import { error_CANCELLED, error_INVALID_INPUT } from "../shared/vocabulary.ts";
import {
  Book,
  Entry,
  EntryWithDetails,
  rpc_contacts_book_get,
  rpc_contacts_book_record,
  rpc_contacts_book_hide,
  rpc_contacts_book_label,
  rpc_contacts_book_list,
  rpc_contacts_book_unhide,
} from "./book.ts";

import { DealView, rpc_contacts_deals_get, rpc_contacts_deals_list, rpc_contacts_deals_move, rpc_contacts_deals_save } from "./deals.ts";
import {
  LeadView,
  rpc_contacts_leads_convert,
  rpc_contacts_leads_get,
  rpc_contacts_leads_list,
  rpc_contacts_leads_move,
  rpc_contacts_leads_save,
} from "./leads.ts";

const CLI = "apps/cli/src/commands/contact";
const SDK = "packages/sdk/src/parties/contacts.ts";
const CRM = "github.com/frappe/crm@2cecd300:crm";

/** At a terminal, a guided write reads the entry for its preview before the one write. */
const guidedWrite = {
  ...budget("write"),
  p50Ms: 900,
  p95Ms: 1_900,
  excludes: ["wait.person"],
  why: "at a terminal the flow reads the entry for its preview before its one write: two calls in sequence",
};

const pick = (includes: string) =>
  [
    {
      name: "choices",
      rpc: rpc_contacts_book_list,
      about: `Only with no id at a terminal: the book page by page for the picker, ${includes}.`,
    },
    { name: "pick", local: "prompt", about: "Only with no id at a terminal: the person picks one entry; quitting is CANCELLED." },
  ] as const;

const preview = (shows: string) =>
  [
    {
      name: "current",
      rpc: rpc_contacts_book_get,
      about: "Only at a terminal: the entry as it stands; null (not in this book) refuses with INVALID_INPUT before any write.",
    },
    {
      name: "confirm",
      local: "prompt",
      about: `Only at a terminal: shows the book, the entry and ${shows}, and asks; a decline is CANCELLED and writes nothing. \`--confirm\` skips it.`,
    },
  ] as const;

const GuidedInput = Schema.Struct({
  book: Book,
  /** The entry's id (its PartyId, or a private entry's `contact_` id); absent only at a terminal, where the person picks. */
  contactId: Schema.optionalKey(Schema.String),
  /** True from a script (`--confirm`): no preview, no question. */
  confirm: Schema.optionalKey(Schema.Boolean),
});

export const flow_client_account_address_book_label = defineFlow({
  id: "client.account.address-book.label",
  title: "Rename one contact, with a preview at a terminal",
  about:
    "Picks the entry at a terminal when no id is given (hidden entries included), shows it with the new label and " +
    "asks, then makes the one write. The label is checked by the rpc: blank or over 120 characters after trimming is " +
    "INVALID_INPUT and the entry is unchanged. Only the entry given or picked is renamed, whatever other entries share " +
    "its label.",
  component: component_core_sdk,
  sdk: "client.account.addressBook.label",
  input: Schema.Struct({ ...GuidedInput.fields, label: Schema.String }),
  output: Entry,
  steps: [
    ...pick("hidden entries included"),
    ...preview("the new label"),
    { name: "label", rpc: rpc_contacts_book_label, about: "The one write." },
  ],
  errors: [error_CANCELLED, error_INVALID_INPUT],
  calls: [],
  spans: [],
  budget: guidedWrite,
  was: [`${CLI}/subcommands/label/execute.ts:24`, `${CLI}/internal/write.ts:26`, `${CLI}/internal/write.ts:40`, `${SDK}:172`],
});

export const flow_client_account_address_book_hide = defineFlow({
  id: "client.account.address-book.hide",
  title: "Hide one contact, with a preview at a terminal",
  about:
    "Picks the entry at a terminal when no id is given, shows it with `hidden: yes` and asks, then makes the one " +
    "write. The CLI prints the entry and the `capxul contact unhide` command for the same book that undoes it.",
  component: component_core_sdk,
  sdk: "client.account.addressBook.hide",
  input: GuidedInput,
  output: Entry,
  steps: [
    ...pick("listed entries"),
    ...preview("`hidden: yes`"),
    { name: "hide", rpc: rpc_contacts_book_hide, about: "The one write." },
  ],
  errors: [error_CANCELLED, error_INVALID_INPUT],
  calls: [],
  spans: [],
  budget: guidedWrite,
  was: [`${CLI}/subcommands/hide/execute.ts:3`, `${CLI}/internal/visibility.ts:20`, `${CLI}/internal/write.ts:26`, `${SDK}:168`],
});

export const flow_client_account_address_book_unhide = defineFlow({
  id: "client.account.address-book.unhide",
  title: "List a hidden contact again, with a preview at a terminal",
  about:
    "Picks the entry at a terminal when no id is given, hidden entries included, shows it with `hidden: no` and asks, " +
    "then makes the one write. An entry already listed is returned as it is.",
  component: component_core_sdk,
  sdk: "client.account.addressBook.unhide",
  input: GuidedInput,
  output: Entry,
  steps: [
    ...pick("hidden entries included"),
    ...preview("`hidden: no`"),
    { name: "unhide", rpc: rpc_contacts_book_unhide, about: "The one write." },
  ],
  errors: [error_CANCELLED, error_INVALID_INPUT],
  calls: [],
  spans: [],
  budget: guidedWrite,
  was: [`${CLI}/subcommands/unhide/execute.ts:3`, `${CLI}/internal/visibility.ts:20`, `${CLI}/internal/write.ts:26`, `${SDK}:170`],
});

// ── the CRM's methods: the SDK only, for the Organization's agents ─────────────────────────

const SDK_ONLY =
  "Serves the SDK, not the CLI: a new capability, not among the 215, used by the Organization's agents (its Forward " +
  "Deployed Engineer first, wearing the People hat to write); its CLI command is booked in the CLI operations pass " +
  "(rules.new-operations, contacts.crm-capabilities). One rpc.";

/** One SDK method over one CRM rpc. */
const crm = (spec: {
  id: string;
  title: string;
  about: string;
  sdk: string;
  rpc: Rpc;
  output: Schema.Top;
  read: boolean;
  was: readonly string[];
}) =>
  defineFlow({
    id: spec.id,
    title: spec.title,
    about: `${spec.about} ${SDK_ONLY}`,
    component: component_core_sdk,
    surfaces: ["sdk"],
    sdk: spec.sdk,
    input: spec.rpc.input,
    output: spec.output,
    steps: [{ name: "call", rpc: spec.rpc }],
    errors: [],
    calls: [],
    spans: [],
    budget: budget(spec.read ? "read" : "write"),
    was: spec.was,
  });

export const flow_client_account_address_book_record = crm({
  id: "client.account.address-book.record",
  title: "Record a person or company in a book, or what it keeps about one",
  about:
    "A Contact or CRM Organization with its Frappe fields: a private entry (a company not on Capxul, a person with no " +
    "mailbox), its link to a Party once it has one, or the details any entry keeps.",
  sdk: "client.account.addressBook.record",
  rpc: rpc_contacts_book_record,
  output: EntryWithDetails,
  read: false,
  was: [`${CRM}/api/contact.py:73`],
});

export const flow_client_org_crm_leads_save = crm({
  id: "client.org.crm.leads.save",
  title: "Capture a lead, or change one",
  about: "Frappe CRM's lead form: a new lead (status New), or a change to one that is not converted.",
  sdk: "client.org(orgId).crm.leads.save",
  rpc: rpc_contacts_leads_save,
  output: LeadView,
  read: false,
  was: [`${CRM}/fcrm/doctype/crm_lead/crm_lead.json`],
});

export const flow_client_org_crm_leads_move = crm({
  id: "client.org.crm.leads.move",
  title: "Move a lead to another status",
  about: "Frappe CRM's lead status menu and kanban drag: a default status, with a lost reason for a lost one.",
  sdk: "client.org(orgId).crm.leads.move",
  rpc: rpc_contacts_leads_move,
  output: LeadView,
  read: false,
  was: [`${CRM}/install.py:46`],
});

export const flow_client_org_crm_leads_convert = crm({
  id: "client.org.crm.leads.convert",
  title: "Convert a lead to a deal",
  about: "Frappe CRM's Convert to Deal: the deal, its person and its company, once; a retry answers the same deal.",
  sdk: "client.org(orgId).crm.leads.convert",
  rpc: rpc_contacts_leads_convert,
  output: rpc_contacts_leads_convert.output,
  read: false,
  was: [`${CRM}/fcrm/doctype/crm_lead/crm_lead.py:546`],
});

export const flow_client_org_crm_leads_list = crm({
  id: "client.org.crm.leads.list",
  title: "List an Organization's leads",
  about: "Frappe CRM's leads list and kanban: a page, newest change first, or one stage's.",
  sdk: "client.org(orgId).crm.leads.list",
  rpc: rpc_contacts_leads_list,
  output: rpc_contacts_leads_list.output,
  read: true,
  was: [`${CRM}/fcrm/doctype/crm_lead/crm_lead.py:470`],
});

export const flow_client_org_crm_leads_get = crm({
  id: "client.org.crm.leads.get",
  title: "Read one lead",
  about: "Frappe CRM's lead page: one lead, or null.",
  sdk: "client.org(orgId).crm.leads.get",
  rpc: rpc_contacts_leads_get,
  output: rpc_contacts_leads_get.output,
  read: true,
  was: [`${CRM}/fcrm/doctype/crm_lead/crm_lead.json`],
});

export const flow_client_org_crm_deals_save = crm({
  id: "client.org.crm.deals.save",
  title: "Open a deal, or change one",
  about: "Frappe CRM's deal form: a new deal by hand (status Qualification), or a change to one, its people included.",
  sdk: "client.org(orgId).crm.deals.save",
  rpc: rpc_contacts_deals_save,
  output: DealView,
  read: false,
  was: [`${CRM}/fcrm/doctype/crm_deal/crm_deal.py:482`],
});

export const flow_client_org_crm_deals_move = crm({
  id: "client.org.crm.deals.move",
  title: "Move a deal to another status",
  about: "Frappe CRM's deal status menu and pipeline drag: worked, won or lost, with a lost reason for a lost one.",
  sdk: "client.org(orgId).crm.deals.move",
  rpc: rpc_contacts_deals_move,
  output: DealView,
  read: false,
  was: [`${CRM}/install.py:97`],
});

export const flow_client_org_crm_deals_list = crm({
  id: "client.org.crm.deals.list",
  title: "List an Organization's deals",
  about: "Frappe CRM's deals list and pipeline: a page, newest change first, or one stage's, company's or person's.",
  sdk: "client.org(orgId).crm.deals.list",
  rpc: rpc_contacts_deals_list,
  output: rpc_contacts_deals_list.output,
  read: true,
  was: [`${CRM}/fcrm/doctype/crm_deal/crm_deal.py:304`],
});

export const flow_client_org_crm_deals_get = crm({
  id: "client.org.crm.deals.get",
  title: "Read one deal",
  about: "Frappe CRM's deal page: one deal with its people, or null.",
  sdk: "client.org(orgId).crm.deals.get",
  rpc: rpc_contacts_deals_get,
  output: rpc_contacts_deals_get.output,
  read: true,
  was: [`${CRM}/fcrm/doctype/crm_deal/crm_deal.json`],
});
