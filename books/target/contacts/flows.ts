// Contacts' Core SDK flows: the commands whose terminal mode composes several calls (A4). At a
// terminal, `contact get`, `label`, `hide` and `unhide` let the person pick an entry from the book
// and show it before the one write; the CLI calls only the flow, and the flow asks through the
// host's prompter (a `wait.person` span, never system time). Given a PartyId and `--confirm`, as a
// script must, each flow makes exactly one rpc call. `contact add` and `contact list` are one rpc
// each, so they have no flow (decision contacts.guided-flows).
//
// The method takes the book as input (`book: { kind: "person" }`, or `{ kind: "organization",
// orgId }` for `--org`), so one SDK method serves both books; the old `client.org(id).addressBook`
// twin goes.

import { Schema } from "effect";
import { budget, defineFlow } from "../../../packages/book/src/index.ts";
import { component_core_sdk } from "../shared/foundation.ts";
import { error_CANCELLED, error_INVALID_INPUT } from "../shared/vocabulary.ts";
import {
  Book,
  Entry,
  rpc_contacts_book_get,
  rpc_contacts_book_hide,
  rpc_contacts_book_label,
  rpc_contacts_book_list,
  rpc_contacts_book_unhide,
} from "./book.ts";

const CLI = "apps/cli/src/commands/contact";
const SDK = "packages/sdk/src/parties/contacts.ts";

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
      about: `Only with no PartyId at a terminal: the book page by page for the picker, ${includes}.`,
    },
    { name: "pick", local: "prompt", about: "Only with no PartyId at a terminal: the person picks one entry; quitting is CANCELLED." },
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
  /** Absent only at a terminal, where the person picks. */
  partyId: Schema.optionalKey(Schema.String),
  /** True from a script (`--confirm`): no preview, no question. */
  confirm: Schema.optionalKey(Schema.Boolean),
});

export const flow_client_account_address_book_get = defineFlow({
  id: "client.account.address-book.get",
  title: "Show one contact, picking it at a terminal",
  about:
    "Given a PartyId, one call: the entry, or null when the Party is not in this book (the CLI prints `data: null`, " +
    "exit 0). With none at a terminal, the person picks from the whole book, hidden entries included. An explicit get " +
    "never lists or prompts. The bank accounts saved for the contact are banking's: this flow cannot read them (decision " +
    "contacts.get-bank-accounts).",
  component: component_core_sdk,
  sdk: "client.account.addressBook.get",
  input: Schema.Struct({ book: Book, partyId: Schema.optionalKey(Schema.String) }),
  output: Schema.NullOr(Entry),
  steps: [
    ...pick("hidden entries included"),
    { name: "read", rpc: rpc_contacts_book_get, about: "The entry for the PartyId given or picked, or null." },
  ],
  errors: [error_CANCELLED],
  calls: [],
  spans: [],
  budget: {
    ...budget("read"),
    p50Ms: 800,
    p95Ms: 1_600,
    excludes: ["wait.person"],
    why: "a guided get lists the book for the picker before its one read",
  },
  was: [`${CLI}/subcommands/get/execute.ts:21`, `${CLI}/internal/selection.ts:19`, `${SDK}:146`],
});

export const flow_client_account_address_book_label = defineFlow({
  id: "client.account.address-book.label",
  title: "Rename one contact, with a preview at a terminal",
  about:
    "Picks the entry at a terminal when no PartyId is given (hidden entries included), shows it with the new label and " +
    "asks, then makes the one write. The label is checked by the rpc: blank or over 120 characters after trimming is " +
    "INVALID_INPUT and the entry is unchanged. Only the PartyId given or picked is renamed, whatever other entries share " +
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
    "Picks the entry at a terminal when no PartyId is given, shows it with `hidden: yes` and asks, then makes the one " +
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
    "Picks the entry at a terminal when no PartyId is given, hidden entries included, shows it with `hidden: no` and asks, " +
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
