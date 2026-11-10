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
import { error_CANCELLED, error_INVALID_INPUT, error_WRONG_STATE } from "../shared/vocabulary.ts";
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
  `Serves \`${command}\` and the SDK alike: the Organization's agents call the same method, its hosted Forward ` +
  "Deployed Engineer first, as its asker with the asker's hats (contacts.crm-capabilities, organizations.fde-for-the-asker).";
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

// ── deals ───────────────────────────────────────────────────────────────────────────────────

// ── conversations: email, WhatsApp, notes and tasks ─────────────────────────────────────────
//
// One SDK method per command (decision contacts.conversation-commands). A send previews at a terminal
// and asks, since an email or a message cannot be taken back, and so do connecting and disconnecting
// WhatsApp, which hand the Organization's conversations to Meta or stop them (G5; decision
// contacts.sends-preview); `--confirm` answers yes from a script, and the hosted FDE never answers
// for its asker (organizations.fde-for-the-asker). A send makes its send key once per invocation and
// repeats it on a retry, so a retried call sends once. Adding and changing a note, and making and
// changing a task, are two methods over one save rpc each, one call apiece. The timeline, `whatsapp
// show`, a task's move and list, and a call's log are each one rpc call, so each is implemented by its
// rpc and has no flow here (G7).

/** A preview flow: a person's wait at a terminal, then one vendor call. */
const vendorWithPreview = { ...budget("vendor"), excludes: ["wait.person"] };
const writeWithPreview = guidedWrite;
const sendKey = {
  name: "key",
  local: "build",
  about: "Makes the send key once per invocation; a retried call repeats it, so the rpc sends once.",
} as const;
const confirmSend = (what: string) =>
  ({
    name: "confirm",
    local: "prompt",
    about: `Only at a terminal: shows ${what}, and asks; a decline is CANCELLED and sends nothing. \`--confirm\` skips it.`,
  }) as const;

