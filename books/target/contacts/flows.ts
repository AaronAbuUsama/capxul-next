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
// The CRM's methods (recording, changing and linking a person or company; leads; deals) are new
// capabilities, not among the 215, booked under rules.new-operations (decision
// contacts.crm-capabilities): one SDK method per command, which the CLI calls and the
// Organization's agents (its Forward Deployed Engineer first) call through the SDK. `contact link`
// previews at a terminal, as the guided writes do; every other is one rpc call. A connected Frappe
// head syncs through contacts' own process (./processes.ts), not these methods.

import { Schema } from "effect";
import { budget, defineFlow, type Rpc } from "../../../packages/book/src/index.ts";
import { component_core_sdk } from "../shared/foundation.ts";
import { error_CANCELLED, error_INVALID_INPUT } from "../shared/vocabulary.ts";
import { Doctype } from "./data.ts";
import {
  Book,
  DetailsInput,
  Entry,
  EntryWithDetails,
  Locator,
  rpc_contacts_book_get,
  rpc_contacts_book_record,
  rpc_contacts_book_hide,
  rpc_contacts_book_label,
  rpc_contacts_book_list,
  rpc_contacts_book_unhide,
} from "./book.ts";

import {
  DealFields,
  DealView,
  rpc_contacts_deals_get,
  rpc_contacts_deals_list,
  rpc_contacts_deals_move,
  rpc_contacts_deals_save,
} from "./deals.ts";
import {
  LeadFields,
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

// ── the CRM's methods: one per command, for the CLI and the SDK ────────────────────────────

const CRM_SURFACES = ["cli", "sdk"] as const;
/** Every CRM method serves its command and the SDK alike (rules.new-operations, contacts.crm-capabilities). */
const serves = (command: string) =>
  `Serves \`${command}\` and the SDK alike: the Organization's agents (its Forward Deployed Engineer first, wearing ` +
  "the People hat to write) call the same method (contacts.crm-capabilities).";
const S = Schema.String;

/** One SDK method that is one call to one CRM rpc. */
const crm = (spec: {
  id: string;
  title: string;
  about: string;
  command: string;
  sdk: string;
  rpc: Rpc;
  input?: Schema.Top;
  output: Schema.Top;
  read: boolean;
  /** Errors the flow raises itself: a get's null answer is INVALID_INPUT (contacts.crm-verbs). */
  errors?: readonly (typeof error_INVALID_INPUT)[];
  was: readonly string[];
}) =>
  defineFlow({
    id: spec.id,
    title: spec.title,
    about: `${spec.about} One rpc call. ${serves(spec.command)}`,
    component: component_core_sdk,
    surfaces: CRM_SURFACES,
    sdk: spec.sdk,
    input: spec.input ?? spec.rpc.input,
    output: spec.output,
    steps: [{ name: "call", rpc: spec.rpc }],
    errors: spec.errors ?? [],
    calls: [],
    spans: [],
    budget: budget(spec.read ? "read" : "write"),
    was: spec.was,
  });

// ── recording, changing and linking a book entry: three methods over contacts.book.record ──

export const flow_client_account_address_book_create = crm({
  id: "client.account.address-book.create",
  title: "Record a new person or company in a book",
  about:
    "A new Contact or CRM Organization with its Frappe fields, in the caller's book or, with the Organization's id, its " +
    "book: `contacts.book.record` with no `contactId`. A person given a primary mailbox is born from that mailbox's " +
    "Party; any other entry is private, with no Party (contacts.book-verbs).",
  command: "contact create",
  sdk: "client.account.addressBook.create",
  rpc: rpc_contacts_book_record,
  input: Schema.Struct({ book: Book, doctype: Doctype, label: S, details: Schema.optionalKey(DetailsInput) }),
  output: EntryWithDetails,
  read: false,
  was: [`${CRM}/api/contact.py:73`, `${CRM}/fcrm/doctype/crm_organization/crm_organization.json`],
});

export const flow_client_account_address_book_change = crm({
  id: "client.account.address-book.change",
  title: "Change what a book keeps about one entry",
  about:
    "Sets the details given on one entry of the book and keeps the rest: `contacts.book.record` with the entry's id and " +
    "`details`. It never names a Party: a mailbox given to a private person is only a detail, and `contact link` alone " +
    "chooses where money paid to the entry goes (contacts.book-verbs). The label is `contact label`'s.",
  command: "contact change",
  sdk: "client.account.addressBook.change",
  rpc: rpc_contacts_book_record,
  input: Schema.Struct({ book: Book, contactId: S, details: DetailsInput }),
  output: EntryWithDetails,
  read: false,
  was: [`${CRM}/api/contact.py:73`],
});

/** The guided link: a preview at a terminal, then the one write (contacts.book-verbs). */
export const flow_client_account_address_book_link = defineFlow({
  id: "client.account.address-book.link",
  title: "Name a private entry's Party, once, with a preview at a terminal",
  about:
    "At a terminal it reads the entry, shows it with the locator as typed (it resolves nothing before the write) and " +
    "that money paid to the entry will reach the Party it names from then on, for good, and asks; a decline is " +
    "CANCELLED and writes nothing. Then, or straight " +
    "away with `--confirm`, the one write: `contacts.book.record` with the entry's id and `link`, which refuses an entry " +
    "that already has a Party, a Party already in the book and a Party of the other kind (contacts.book-verbs). A " +
    "script without `--confirm` is the CLI's CLI_USAGE. " +
    serves("contact link"),
  component: component_core_sdk,
  surfaces: CRM_SURFACES,
  sdk: "client.account.addressBook.link",
  input: Schema.Struct({ book: Book, contactId: S, link: Locator, confirm: Schema.optionalKey(Schema.Boolean) }),
  output: EntryWithDetails,
  steps: [
    ...preview("the locator it will be linked to, and that money paid to it then reaches that Party for good"),
    { name: "link", rpc: rpc_contacts_book_record, about: "The one write." },
  ],
  errors: [error_CANCELLED, error_INVALID_INPUT],
  calls: [],
  spans: [],
  budget: guidedWrite,
  was: [`${CRM}/api/contact.py:73`, "packages/backend/src/parties/rules.ts:19"],
});

// ── leads ───────────────────────────────────────────────────────────────────────────────────

export const flow_client_org_crm_leads_create = crm({
  id: "client.org.crm.leads.create",
  title: "Capture a lead",
  about: "Frappe CRM's new lead form: `contacts.leads.save` with no lead, a new lead with status New.",
  command: "org crm lead create",
  sdk: "client.org(orgId).crm.leads.create",
  rpc: rpc_contacts_leads_save,
  input: Schema.Struct({ orgId: S, fields: LeadFields }),
  output: LeadView,
  read: false,
  was: [`${CRM}/fcrm/doctype/crm_lead/crm_lead.json`, `${CRM}/fcrm/doctype/crm_lead/crm_lead.py:140`],
});

export const flow_client_org_crm_leads_change = crm({
  id: "client.org.crm.leads.change",
  title: "Change a lead's fields",
  about: "Frappe CRM's lead form on a saved lead: `contacts.leads.save` with the lead's id; a converted lead is WRONG_STATE.",
  command: "org crm lead change",
  sdk: "client.org(orgId).crm.leads.change",
  rpc: rpc_contacts_leads_save,
  input: Schema.Struct({ orgId: S, lead: S, fields: LeadFields }),
  output: LeadView,
  read: false,
  was: [`${CRM}/fcrm/doctype/crm_lead/crm_lead.json`],
});

export const flow_client_org_crm_leads_move = crm({
  id: "client.org.crm.leads.move",
  title: "Move a lead to another status",
  about: "Frappe CRM's lead status menu and kanban drag: a default status, with a lost reason for a lost one.",
  command: "org crm lead move",
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
  command: "org crm lead convert",
  sdk: "client.org(orgId).crm.leads.convert",
  rpc: rpc_contacts_leads_convert,
  output: rpc_contacts_leads_convert.output,
  read: false,
  was: [`${CRM}/fcrm/doctype/crm_lead/crm_lead.py:546`],
});

export const flow_client_org_crm_leads_list = crm({
  id: "client.org.crm.leads.list",
  title: "List an Organization's leads",
  about: "Frappe CRM's leads list and kanban: a page of the leads not converted, newest change first, or one stage's (converted the only way to list converted ones).",
  command: "org crm lead list",
  sdk: "client.org(orgId).crm.leads.list",
  rpc: rpc_contacts_leads_list,
  output: rpc_contacts_leads_list.output,
  read: true,
  was: [`${CRM}/fcrm/doctype/crm_lead/crm_lead.py:470`],
});

export const flow_client_org_crm_leads_get = crm({
  id: "client.org.crm.leads.get",
  title: "Read one lead",
  about: "Frappe CRM's lead page: one lead; an id that is none of the Organization's leads is INVALID_INPUT, never null.",
  command: "org crm lead get",
  sdk: "client.org(orgId).crm.leads.get",
  rpc: rpc_contacts_leads_get,
  output: LeadView,
  read: true,
  errors: [error_INVALID_INPUT],
  was: [`${CRM}/fcrm/doctype/crm_lead/crm_lead.json`],
});

// ── deals ───────────────────────────────────────────────────────────────────────────────────

export const flow_client_org_crm_deals_create = crm({
  id: "client.org.crm.deals.create",
  title: "Open a deal",
  about: "Frappe CRM's new deal form: `contacts.deals.save` with no deal, a new deal in Qualification for its company.",
  command: "org crm deal create",
  sdk: "client.org(orgId).crm.deals.create",
  rpc: rpc_contacts_deals_save,
  input: Schema.Struct({ orgId: S, fields: DealFields }),
  output: DealView,
  read: false,
  was: [`${CRM}/fcrm/doctype/crm_deal/crm_deal.py:482`],
});

export const flow_client_org_crm_deals_change = crm({
  id: "client.org.crm.deals.change",
  title: "Change a deal's fields or its people",
  about: "Frappe CRM's deal form on a saved deal: `contacts.deals.save` with the deal's id, whatever its stage.",
  command: "org crm deal change",
  sdk: "client.org(orgId).crm.deals.change",
  rpc: rpc_contacts_deals_save,
  input: Schema.Struct({ orgId: S, deal: S, fields: DealFields }),
  output: DealView,
  read: false,
  was: [`${CRM}/fcrm/doctype/crm_deal/crm_deal.json`],
});

export const flow_client_org_crm_deals_move = crm({
  id: "client.org.crm.deals.move",
  title: "Move a deal to another status",
  about: "Frappe CRM's deal status menu and pipeline drag: worked, won or lost, with a lost reason for a lost one.",
  command: "org crm deal move",
  sdk: "client.org(orgId).crm.deals.move",
  rpc: rpc_contacts_deals_move,
  output: DealView,
  read: false,
  was: [`${CRM}/install.py:97`],
});

export const flow_client_org_crm_deals_list = crm({
  id: "client.org.crm.deals.list",
  title: "List an Organization's deals",
  about: "Frappe CRM's deals list and pipeline: a page, newest change first, filtered by stage, company and person, together when given.",
  command: "org crm deal list",
  sdk: "client.org(orgId).crm.deals.list",
  rpc: rpc_contacts_deals_list,
  output: rpc_contacts_deals_list.output,
  read: true,
  was: [`${CRM}/fcrm/doctype/crm_deal/crm_deal.py:304`],
});

export const flow_client_org_crm_deals_get = crm({
  id: "client.org.crm.deals.get",
  title: "Read one deal",
  about: "Frappe CRM's deal page: one deal with its people; an id that is none of the Organization's deals is INVALID_INPUT.",
  command: "org crm deal get",
  sdk: "client.org(orgId).crm.deals.get",
  rpc: rpc_contacts_deals_get,
  output: DealView,
  read: true,
  errors: [error_INVALID_INPUT],
  was: [`${CRM}/fcrm/doctype/crm_deal/crm_deal.json`],
});
