// The five frozen operations contacts owns (OPERATION_OWNERS): `contact add`, `hide`, `label`,
// `list` and `unhide`. `contact get` and `contact bank add` are banking's, because both carry the
// contact's bank accounts (shared operations.contact-get-in-banking; decision contacts.get-moved).
// Text comes from the frozen book through frozenText, never retyped; acceptance claims are the
// frozen ones word for word except `contact list` #1, rewritten as an outcome (decision
// contacts.acceptance-rewrites).
//
// Every refusal is reached from the world `person-with-contacts` (decision contacts.worlds):
// NOT_AUTHENTICATED by calling there with no session.
//
// The book is now also each Organization's CRM, in Frappe CRM's shapes (decision
// contacts.frappe-shape): an entry is a Contact or a CRM Organization, and may be private, with no
// Party yet. Every entry these five commands make is born from a Party and has its PartyId as its
// id, so each claim below holds as it did. The CRM's own capabilities (recording, changing and
// linking an entry; leads; deals) are the fourteen new operations at the end of this file
// (decision contacts.crm-capabilities).

import { Schema } from "effect";
import { budget, defineOperation, type Ref } from "../../../packages/book/src/index.ts";
import { frozen, frozenRefusals, frozenText, type FrozenId } from "../../frozen/index.ts";
import {
  error_CANCELLED,
  error_CLI_USAGE,
  error_INVALID_INPUT,
  error_NOT_AUTHENTICATED,
  error_PROVIDER_ERROR,
  error_ROLE_PERMISSION_DENIED,
  error_WRONG_STATE,
} from "../shared/vocabulary.ts";
import {
  Entry,
  EntryWithDetails,
  PartyRef,
  rpc_contacts_book_add,
  rpc_contacts_book_list,
} from "./book.ts";
import {
  flow_client_account_address_book_change,
  flow_client_account_address_book_create,
  flow_client_account_address_book_hide,
  flow_client_account_address_book_label,
  flow_client_account_address_book_link,
  flow_client_account_address_book_unhide,
} from "./flows.ts";
import {
  examples_contact_add,
  examples_contact_hide,
  examples_contact_label,
  examples_contact_list,
  examples_contact_unhide,
  examples_contact_create,
  examples_contact_change,
  examples_contact_link,
} from "./examples.ts";

const CLI = "apps/cli/src/commands/contact";
const AS_IS = "docs/as-is/archive/operations/payments.ts";
const page = (id: FrozenId) => `apps/docs/factory/operations/${id}.yaml:1`;

/** The world every refusal here is reached from. */
export const WORLD = "person-with-contacts";

const ERRORS = {
  CLI_USAGE: error_CLI_USAGE,
  INVALID_INPUT: error_INVALID_INPUT,
  NOT_AUTHENTICATED: error_NOT_AUTHENTICATED,
  ROLE_PERMISSION_DENIED: error_ROLE_PERMISSION_DENIED,
} as const;

/** The page's refusals, in its order and words. */
const refusals = (id: FrozenId) =>
  frozenRefusals(id).map(({ code, when }) => {
    const error = (ERRORS as Record<string, (typeof ERRORS)[keyof typeof ERRORS] | undefined>)[code];
    if (error === undefined) throw new Error(`${id}: the refusal code ${code} has no error record here`);
    return { error, given: WORLD, when };
  });

/**
 * A write's refusals: the page's, with ROLE_PERMISSION_DENIED widened to a member without the People hat, whom
 * `person-with-contacts` holds as Rex, Dan's agent with a Seat in Acme and no hat (decision contacts.members-write).
 */
const writeRefusals = (id: FrozenId) =>
  refusals(id).map((r) =>
    r.error === error_ROLE_PERMISSION_DENIED
      ? { ...r, when: `${r.when} Also a member of it whose Safe does not wear its People hat (as Rex in Acme): every member reads the book, only the People hat changes it.` }
      : r,
  );

/** Who may run a write, as the ruling has it: the frozen `who` said any member (decision contacts.members-write). */
const WRITE_WHO =
  "A signed-in person for their own book, or a member of the Organization whose Safe wears its People hat for its book.";

type FrozenLine = { readonly claim: string; readonly was: readonly string[] };
const frozenLine = (id: FrozenId, n: number) => (frozen[id].acceptance as readonly FrozenLine[])[n - 1]!;

/** Acceptance line n (from 1), its claim kept word for word, its test citation in `was`. */
const kept = (id: FrozenId, n: number, observes: string) => {
  const a = frozenLine(id, n);
  return { claim: a.claim, observes, was: [...a.was] };
};

/** Acceptance line n rewritten as an outcome: the old claim and its citation move to `was`. */
const rewritten = (id: FrozenId, n: number, claim: string, observes: string) => {
  const a = frozenLine(id, n);
  return { claim, observes, was: [a.claim, ...a.was] };
};

/** At a terminal, a guided command makes a second call before its one write or read. */
const guidedWrite = {
  ...budget("write"),
  p50Ms: 900,
  p95Ms: 1_900,
  excludes: ["wait.person"],
  why: "at a terminal it reads the entry for its preview before its one write: two calls in sequence",
};

// ── contact add ─────────────────────────────────────────────────────────────────────────────

// The CLI reads `--input` (64 KB, strict keys) or asks for each field at a terminal, shows the
// preview from what was typed and asks (a decline is CANCELLED and calls nothing), then calls the
// one SDK method `client.account.addressBook.add`, which is one rpc.
export const operation_contact_add = defineOperation({
  ...frozenText("contact.add"),
  who: WRITE_WHO,
  was: [page("contact.add"), `${AS_IS}:916`, `${CLI}/subcommands/add/execute.ts:23`, `${CLI}/internal/parse.ts:48`],
  priority: "normal",
  implementedBy: rpc_contacts_book_add,
  examples: examples_contact_add,
  acceptance: [
    kept(
      "contact.add",
      1,
      "cli: adding one person by email, then by handle, then by PartyId prints the same `id` (a `party_` id) with `ref` " +
        "{kind: party} each time; read: `contact list` shows one entry for them; cli: no output carries a Safe address, a " +
        "chain id or a transaction hash.",
    ),
    kept(
      "contact.add",
      2,
      "cli: adding yourself (by your own email or handle) and adding with a 121-character label are each INVALID_INPUT; " +
        "world: the diff across each refusal is empty, no new Party included.",
    ),
    kept(
      "contact.add",
      3,
      "cli and read: an entry added by handle, address or PartyId shows no mailbox in `add`, `get` or `list` output, even " +
        "for a person whose mailbox another book typed; one added by email with no label shows the mailbox typed.",
    ),
    kept(
      "contact.add",
      4,
      "cli: the terminal wizard and `--input` with the same fields show the same preview and print the same entry; trace: " +
        "each run makes one `contacts.book.add` call, after the preview; world: a declined preview leaves the diff empty.",
    ),
  ],
  returns: Schema.Struct({
    id: Entry.fields.id, // The contact's stable PartyId.
    ref: PartyRef, // How you named them: the party locator the money path takes; an added entry always has one.
    label: Entry.fields.label, // Its label.
    relationship: Entry.fields.relationship, // How you know them.
    hidden: Entry.fields.hidden, // false.
  }),
  errors: [error_CLI_USAGE, error_CANCELLED],
  refusals: writeRefusals("contact.add"),
  budget: budget("write"),
});

// ── contact hide ────────────────────────────────────────────────────────────────────────────

export const operation_contact_hide = defineOperation({
  ...frozenText("contact.hide"),
  who: WRITE_WHO,
  was: [page("contact.hide"), `${AS_IS}:979`, `${CLI}/internal/visibility.ts:20`, `${CLI}/internal/write.ts:26`],
  priority: "normal",
  implementedBy: flow_client_account_address_book_hide,
  examples: examples_contact_hide,
  acceptance: [
    kept(
      "contact.hide",
      1,
      "read: after the hide, `contact list` leaves the entry out and `contact get` still returns it, with `hidden: true`.",
    ),
    kept(
      "contact.hide",
      2,
      "read: the hidden entry keeps its id, ref, label and relationship, and `contact list --include-hidden` lists it.",
    ),
    kept(
      "contact.hide",
      3,
      "cli: the output carries the entry's fields and the `capxul contact unhide` command for the same book (with its " +
        "`--org`); world: a declined preview leaves the diff empty.",
    ),
  ],
  returns: Schema.Struct({
    id: Entry.fields.id, // The contact's PartyId.
    hidden: Entry.fields.hidden, // true.
  }),
  errors: [error_CLI_USAGE],
  refusals: writeRefusals("contact.hide"),
  budget: guidedWrite,
});

// ── contact label ───────────────────────────────────────────────────────────────────────────

export const operation_contact_label = defineOperation({
  ...frozenText("contact.label"),
  who: WRITE_WHO,
  was: [page("contact.label"), `${AS_IS}:949`, `${CLI}/subcommands/label/execute.ts:24`, `${CLI}/internal/write.ts:40`],
  priority: "normal",
  implementedBy: flow_client_account_address_book_label,
  examples: examples_contact_label,
  acceptance: [
    kept(
      "contact.label",
      1,
      "cli: a label of spaces only and a 121-character label are each INVALID_INPUT; read: `contact get` shows the old " +
        "label; world: the diff across each refusal is empty.",
    ),
    kept(
      "contact.label",
      2,
      "read: of two entries with the same label, labelling one by its PartyId changes that entry's label and not the other's.",
    ),
    kept(
      "contact.label",
      3,
      "cli: at a terminal the preview shows the new label before the question; trace: one `contacts.book.label` call, after " +
        "the `wait.person` of the question.",
    ),
  ],
  returns: Schema.Struct({
    id: Entry.fields.id, // The contact's PartyId.
    label: Entry.fields.label, // The new label.
  }),
  errors: [error_CLI_USAGE],
  refusals: writeRefusals("contact.label"),
  budget: guidedWrite,
});

// ── contact list ────────────────────────────────────────────────────────────────────────────

// The CLI checks `--limit` (1 to 100, default 25) and the shape of `--after` (CLI_USAGE), then
// calls the one SDK method `client.account.addressBook.list`, which is one rpc: the server pages.
export const operation_contact_list = defineOperation({
  ...frozenText("contact.list"),
  was: [page("contact.list"), `${AS_IS}:840`, `${CLI}/subcommands/list/execute.ts:23`, "apps/cli/src/runtime/paging.ts:82"],
  priority: "normal",
  implementedBy: rpc_contacts_book_list,
  examples: examples_contact_list,
  acceptance: [
    rewritten(
      "contact.list",
      1,
      "A book lists only its own entries, and reading it takes no longer however many Parties and other books exist outside it.",
      "world: the same book read in this world and in one where other tenants hold thousands of Parties and entries " +
        "returns the same page; trace: the `contacts.book.list` span stays within the read budget in both.",
    ),
    kept(
      "contact.list",
      2,
      "read: in the Organization's book an entry added by hand that is also a member shows `manual` and `member`; once its " +
        "Seat ends (the agent removed on chain) it shows only `manual`, and an entry that was only a member leaves the list.",
    ),
    kept(
      "contact.list",
      3,
      "read: a hidden entry is absent from `contact list` and present in `contact list --include-hidden`.",
    ),
    kept(
      "contact.list",
      4,
      "read: the person's own book and the Organization's list different entries, and neither shows the other's; cli: " +
        "`--org` naming an Organization the caller holds no Seat in is ROLE_PERMISSION_DENIED.",
    ),
  ],
  returns: Schema.Struct({
    items: Schema.Array(Entry), // Each contact with its PartyId, ref, label, relationships, whether hidden, and its last activity.
    nextCursor: Schema.NullOr(Schema.String), // The `--after` value for the next page, or null on the last.
  }),
  errors: [error_CLI_USAGE],
  refusals: refusals("contact.list"),
  budget: budget("read"),
});

// ── contact unhide ──────────────────────────────────────────────────────────────────────────

export const operation_contact_unhide = defineOperation({
  ...frozenText("contact.unhide"),
  who: WRITE_WHO,
  was: [page("contact.unhide"), `${AS_IS}:1007`, `${CLI}/internal/visibility.ts:20`, `${CLI}/internal/write.ts:40`],
  priority: "normal",
  implementedBy: flow_client_account_address_book_unhide,
  examples: examples_contact_unhide,
  acceptance: [
    kept(
      "contact.unhide",
      1,
      "cli: hide, unhide and label of a PartyId outside the book are each INVALID_INPUT, from a script and at a terminal " +
        "alike; world: the diff across each refusal is empty.",
    ),
    kept(
      "contact.unhide",
      2,
      "read: after unhide the entry has the id, ref, label and relationship it had before the hide; cli: unhiding a listed " +
        "entry prints it unchanged, with `hidden: false`.",
    ),
  ],
  returns: Schema.Struct({
    id: Entry.fields.id, // The contact's PartyId.
    hidden: Entry.fields.hidden, // false.
  }),
  errors: [error_CLI_USAGE],
  refusals: writeRefusals("contact.unhide"),
  budget: guidedWrite,
});

// ═══ The CRM's commands: fourteen operations beyond the 215 ═══════════════════════════════════
//
// Booked under rules.new-operations (CONVENTIONS rule 4a) on the pack contacts.crm-capabilities, which
// serves aaron.crm-frappe-shape and aaron.frappe-shape and which Aaron accepted on 8 November 2026. They
// are exactly docs/design/new-commands.md section 5.2, in its one grammar: each id is its command's
// words joined by dots, and each calls one SDK method (./flows.ts) that the Organization's agents call
// through the SDK too. The `contact` commands are area `payments`, as the frozen ones are; the rest are
// area `contacts`. Who may run each is a hat or a Seat, never a named person (docs/design/authority.md):
// every member reads the CRM, and only a member whose Safe wears the People hat when the command runs
// changes it (contacts.crm-permission). The commands an Organization's start-up and its first sale
// need are `critical` (contacts.critical-commands); the rest `normal`. Refusals start from
// person-with-contacts or org-with-crm (contacts.crm-worlds), and every one names who runs it there.

/** Acme's CRM worked by Dan, its People hat wearer; Lou private in Ada's book (contacts.crm-worlds). */
export const CRM_WORLD = "org-with-crm";
const BOOK_AREA = "payments";
const CRM_AREA = "contacts";
const NOTHING_READ = "Nothing: it only reads.";

const claim = (text: string, observes: string) => ({ claim: text, observes });
type Refusal = { readonly error: Ref<"error">; readonly given: string; readonly when: string };

const signedOut = (given: string): Refusal => ({
  error: error_NOT_AUTHENTICATED,
  given,
  when: "No one is signed in on this machine: nothing is read or written.",
});
const outsider = (given: string): Refusal => ({
  error: error_ROLE_PERMISSION_DENIED,
  given,
  when: "Ada, signed in, names Acme with `--org`, where she holds no Seat: nothing is read or written.",
});
/**
 * A write's one ROLE_PERMISSION_DENIED: an outsider naming the Organization, or a member whose Safe wears no People hat
 * (contacts.crm-permission). One refusal per code, so each code is one eval, as the frozen contact commands keep it.
 */
const denied = (given: string, what: string): Refusal => ({
  error: error_ROLE_PERMISSION_DENIED,
  given,
  when:
    `Ada, signed in, names Acme with \`--org\`, where she holds no Seat; or Rex, Dan's agent, holds a Seat in Acme but ` +
    `its Safe wears no People hat, and ${what}: nothing is written. The right is the hat's: once the Board grants Rex's Safe the ` +
    "hat the same command succeeds, and once it revokes it, it is refused again.",
});
/**
 * A previewing write's one ROLE_PERMISSION_DENIED: denied's cases, and the hosted FDE's act-for call under its asker's
 * open ask, which the rpc refuses because the preview is the asker's own (organizations.fde-for-the-asker).
 */
const deniedPreview = (given: string, what: string): Refusal => {
  const d = denied(given, what);
  return {
    ...d,
    when:
      `${d.when} So is the hosted FDE's run of it while Dan's \`org fde ask\` is open (the stand-in host holding the ` +
      "turn, `capxul-devnet fault fde-host hold`): the preview is Dan's own to answer, so nothing is sent or written " +
      "(organizations.fde-for-the-asker).",
  };
};
const invalid = (given: string, when: string): Refusal => ({ error: error_INVALID_INPUT, given, when });
const wrong = (when: string): Refusal => ({ error: error_WRONG_STATE, given: CRM_WORLD, when });

/** A write to a book: a person's own, or with `--org` an Organization's. */
const WHO_BOOK_WRITE =
  "A signed-in person, for their own book. With `--org`, a member of the Organization whose Safe wears its People hat " +
  "when the command runs, a person's Seat or an agent's: an officer hat the Board grants and revokes, so the right goes " +
  "with the hat, never with a person (contacts.members-write).";
const WHO_CRM_WRITE_OP =
  "A member of the Organization whose Safe wears its People hat when the command runs, a person's Seat or an agent's " +
  "(the hosted FDE only as its asker, with the asker's hat: organizations.fde-for-the-asker). The right goes with the " +
  "hat, never with a person: the Board swaps members in and out by granting and revoking it (contacts.crm-permission).";
/** A command that previews and asks (G5) is the asker's own to answer (organizations.fde-for-the-asker). */
const NOT_FOR_ASKER =
  " Never the hosted FDE for its asker: the preview is the member's own to answer (organizations.fde-for-the-asker).";
const WHO_CRM_PREVIEW_OP = WHO_CRM_WRITE_OP + NOT_FOR_ASKER;
const WHO_CRM_READ_OP = "Any member of the Organization: an active Seat, a person's or an agent's.";

const PAGE_NOTES = ["It shows 25 at a time by default; `--limit` takes 1 to 100.", "When there are more, `nextCursor` is the `--after` value for the next page."];
const LOGGED = "In an Organization's book the change also goes to the CRM's change log, which a connected head receives.";
const HAT_FOLLOWS =
  "after `org member grant @rex --permission manage-people --org acme` executes, Rex's same command succeeds; after " +
  "`org member revoke @rex --permission manage-people --org acme` executes it is ROLE_PERMISSION_DENIED again; world: " +
  "each refusal's diff is empty.";

// ── contact create, change and link: the book's own fields and its one link ─────────────────

export const operation_contact_create = defineOperation({
  id: "contact.create",
  title: "Record a new person or company in a book",
  about:
    "Records a new entry in your book, or with `--org` in the Organization's: a person (`--type person`) with their " +
    "mailboxes, numbers, job title and the company they work for, or a company (`--type company`) with its website, " +
    "industry, territory, size, annual revenue and description, as Frappe CRM keeps a Contact and a CRM Organization. A " +
    "person given a mailbox (the first `--email` is the primary one) is named in the directory as `contact add` names " +
    "them, so they can be paid. Any other entry is private: it has no Party, cannot be paid until `contact link` names " +
    "one, and is listed like every other. Use `contact add` to add someone already on Capxul by handle or address.",
  area: BOOK_AREA,
  command: "contact create",
  priority: "critical",
  implementedBy: flow_client_account_address_book_create,
  examples: examples_contact_create,
  who: WHO_BOOK_WRITE,
  changes:
    "One new entry in the book, listed. A person given a mailbox no Party holds yet also names one in the directory, as " +
    `\`contact add\` does. ${LOGGED}`,
  acceptance: [
    claim(
      "A company is recorded as a private entry, with no Party, and the book lists it with the details given.",
      "cli: as Ada, `contact create \"Globex Ltd\" --type company --website globex.test --industry Manufacturing " +
        "--employees 11-50` prints an id starting `contact_`, `ref: null`, `doctype: organization` and those details; " +
        "read: `contact list` lists it first and `contact get <id>` prints the same details.",
    ),
    claim(
      "A person given a mailbox is born from that mailbox's Party, as `contact add` by email names them; a person with no mailbox is private.",
      "cli: `contact create \"Ivo Petrov\" --type person --email ivo@example.com --phone +447700900456` prints a " +
        "`party_` id and `ref {kind: party}`; `contact create Lou --type person --phone +447700900123` prints a " +
        "`contact_` id and `ref: null`; world: the first names one Party for ivo@example.com, the second names none.",
    ),
    claim(
      "One Party is one entry: a person whose mailbox's Party is already in the book is refused, naming that entry, and nothing is merged.",
      "cli: as Ada, `contact create \"B. Bea\" --type person --email bea@example.com` is INVALID_INPUT naming Bea's " +
        "entry; read: `contact list` still shows one entry for Bea, labelled `Bea`; world: the diff across the refusal is empty.",
    ),
    claim(
      "A field of the other type, a bad value, or a company that is not an organization entry of the book is refused naming the field.",
      "cli: `--type person --website x.test` names `website`; `--type company --designation CEO` names `designation`; a " +
        "121-character label, `--email not-a-mailbox` and `--company <Bea>` (a Contact) are each INVALID_INPUT naming " +
        "the field; world: each diff is empty.",
    ),
    claim(
      "In an Organization's book only a member whose Safe wears the People hat when the command runs records, and every member reads the entry.",
      "cli: `contact create \"Globex Ltd\" --type company --org acme` as Rex (a Seat, no hat) is ROLE_PERMISSION_DENIED " +
        "and as Dan prints the entry; read: Rex's `contact list --org acme` shows it; cli: " + HAT_FOLLOWS,
    ),
  ],
  returns: EntryWithDetails,
  errors: [error_CLI_USAGE],
  refusals: [
    signedOut(WORLD),
    denied(WORLD, "records an entry in Acme's book"),
    invalid(
      WORLD,
      "A blank or 121-character label; a field of the other `--type`; a malformed mailbox or number, or more than 10 of " +
        "either; a `--company` that is not an organization entry of the book; a negative `--revenue`; or a person whose " +
        "mailbox's Party is already in the book, or is the book's own: the refusal names the field or the entry, and nothing is written.",
    ),
  ],
  budget: budget("write"),
});

export const operation_contact_change = defineOperation({
  id: "contact.change",
  title: "Change what a book keeps about one entry",
  about:
    "Changes the details your book, or with `--org` the Organization's, keeps about one entry, named by its id as " +
    "`contact list` prints it: a person's mailboxes, numbers, job title and company, or a company's website, industry, " +
    "territory, size, annual revenue and description. Each detail given replaces the stored one, `--clear` empties one, " +
    "and the rest stay. `--email` and `--phone`, when given, replace the whole list, the first primary. The entry keeps " +
    "its id, its label (`contact label` changes it) and its Party: a mailbox given to a private person is only a " +
    "detail, and only `contact link` decides where money paid to the entry goes. A change that gives nothing is refused.",
  area: BOOK_AREA,
  command: "contact change",
  priority: "normal",
  implementedBy: flow_client_account_address_book_change,
  examples: examples_contact_change,
  who: WHO_BOOK_WRITE,
  changes: `The entry's details. Its id, label and Party stay as they were. ${LOGGED}`,
  acceptance: [
    claim(
      "Only the details given change; the entry keeps its id, its label and its Party.",
      "cli: `contact change <Kim> --phone +447700900789 --designation \"Head of Buying\" --org acme` prints Kim's new " +
        "number and title with her mailbox, company, label and `ref` as they were; read: `contact get <Kim> --org acme` shows the same.",
    ),
    claim(
      "A mailbox given to a private person is only a detail: the entry stays private until `contact link`, and nobody is named in the directory.",
      "cli: as Ada, `contact change <Lou> --email lou@example.com` prints Lou's `contact_` id, `ref: null` and the " +
        "mailbox among its `email_ids`; world: the diff names no Party for lou@example.com.",
    ),
    claim(
      "`--clear` empties a field, and a field of the other type is refused naming it.",
      "cli: `contact change <Globex> --clear website --org acme` prints `website: null` and keeps its industry; " +
        "`contact change <Globex> --designation CEO --org acme` is INVALID_INPUT naming `designation`; world: the refusal's diff is empty.",
    ),
    claim(
      "An entry outside the book is refused, as there is no not-found code.",
      "cli: as Ada, `contact change <Kim's id> --phone +447700900789` in her own book, where Kim has no entry, is " +
        "INVALID_INPUT; world: the diff is empty.",
    ),
  ],
  returns: EntryWithDetails,
  errors: [error_CLI_USAGE],
  refusals: [
    signedOut(CRM_WORLD),
    denied(CRM_WORLD, "changes an entry of Acme's book"),
    invalid(
      CRM_WORLD,
      "An id not in the book; a field of the other doctype; a malformed mailbox or number, or more than 10 of either; a " +
        "`--company` that is not an organization entry of the book; a negative `--revenue`; or no detail and no `--clear` " +
        "at all: the refusal names the field, or says nothing was given, and nothing is written.",
    ),
  ],
  budget: budget("write"),
});

export const operation_contact_link = defineOperation({
  id: "contact.link",
  title: "Name the Party a private entry is, once",
  about:
    "Names the Party a private entry of your book, or with `--org` the Organization's, is: a person by their mailbox, " +
    "@handle, address or Party id; a company by its Organization's @handle, its address or its Party id. From then on " +
    "money paid to the entry reaches that Party, and the entry keeps its id. It cannot be undone, so at a terminal it " +
    "shows the entry and what it will be linked to and asks; `--confirm` answers yes from a script. An entry that " +
    "already has a Party, a Party already in the book, and a Party of the other kind are refused.",
  area: BOOK_AREA,
  command: "contact link",
  priority: "normal",
  implementedBy: flow_client_account_address_book_link,
  examples: examples_contact_link,
  who: WHO_BOOK_WRITE + NOT_FOR_ASKER,
  changes:
    "The entry's Party, once and for good. A mailbox or address no Party holds yet is named in the directory. " + LOGGED,
  acceptance: [
    claim(
      "A private entry is linked once to the Party its locator names; it keeps its id, and is then paid as that Party.",
      "cli: as Ada, `contact link <Lou> zed@example.com --confirm` prints Lou's `contact_` id with `ref` Zed's Party; " +
        "read: `contact get <Lou>` and `contact list` show the same `ref`.",
    ),
    claim(
      "A company is linked by an @handle, an address or a Party id, never by a mailbox; a Party of the other kind is refused.",
      "cli: as Ada, `contact link <Northwind> 0x00000000000000000000000000000000000a11ce --confirm` prints Northwind's " +
        "`contact_` id with a `party_` ref; `contact link <Lou> @acme --confirm` (an Organization for a person) and, as " +
        "Dan, `contact link <Globex> sales@globex.test --org acme --confirm` are each INVALID_INPUT; world: each refusal's diff is empty.",
    ),
    claim(
      "An entry's Party never changes: linking an entry that has one, or naming a Party already in the book, is refused.",
      "cli: as Ada, `contact link <Bea> zed@example.com --confirm` (Bea has a Party) and `contact link <Lou> @bea " +
        "--confirm` (Bea's Party is in the book) are each INVALID_INPUT; world: each diff is empty.",
    ),
    claim(
      "At a terminal it shows the entry and what it will be linked to before it writes; a decline writes nothing, and a script must confirm.",
      "cli: at a terminal, `contact link <Lou> zed@example.com` shows Lou, zed@example.com and that money paid to Lou " +
        "will reach that Party, then asks; answering no is CANCELLED (exit 130); from a script without `--confirm` it is " +
        "CLI_USAGE; world: both diffs are empty; trace: the declined run makes one `contacts.book.get` call and no `contacts.book.record` call.",
    ),
  ],
  returns: EntryWithDetails,
  errors: [error_CLI_USAGE],
  refusals: [
    signedOut(CRM_WORLD),
    deniedPreview(CRM_WORLD, "links an entry of Acme's book"),
    invalid(
      CRM_WORLD,
      "An id not in the book; an entry that already has a Party; a locator that names nothing, the book's own Party, a " +
        "Party already in the book or a Party of the other kind (an Organization for a person, a mailbox, a person or an " +
        "agent for a company): nothing is written and no Party is named.",
    ),
    { error: error_CANCELLED, given: CRM_WORLD, when: "At a terminal, Ada answers no to the preview of linking Lou: nothing is written and no Party is named." },
    { error: error_CLI_USAGE, given: CRM_WORLD, when: "A script runs it without `--confirm`: nothing is read or written." },
  ],
  budget: guidedWrite,
});

// ── org crm lead ────────────────────────────────────────────────────────────────────────────

// ── org crm deal ────────────────────────────────────────────────────────────────────────────

// ═══ The CRM's conversations: thirteen more operations beyond the 215 ═════════════════════════
//
// Booked under rules.new-operations on the pack contacts.conversation-commands, which serves
// aaron.crm-frappe-shape, aaron.world-clock and aaron.sdk-reaches-everything and carries out Aaron's
// evening answer (the CRM tracks every conversation). They are docs/design/new-commands.md section
// 5.8, in its one grammar; each calls one SDK method: a flow (./flows.ts) where it previews or shares
// its rpc with another method, else its one rpc (G7). Every member reads; only a member whose Safe
// wears the People hat writes, and a task's assignee also moves their own (contacts.crm-permission,
// contacts.task-assignee); a command that previews is never the hosted FDE's for its asker
// (organizations.fde-for-the-asker). Every channel is the world's: on a devnet mail
// goes to the sink and WhatsApp to the stand-in, each dated at the world's now (aaron.world-clock).
// Refusals start from org-with-crm or org-with-conversations (contacts.conversation-worlds).

/** org-with-crm plus Acme's conversations: its WhatsApp number, a thread on the Globex pilot, Nia's emailed lead (contacts.conversation-worlds). */
export const TALK_WORLD = "org-with-conversations";
const MAILBOX = "acme@crm.devnet.test";
const wrongIn = (given: string, when: string): Refusal => ({ error: error_WRONG_STATE, given, when });
const cancelled = (given: string, what: string): Refusal => ({
  error: error_CANCELLED,
  given,
  when: `At a terminal, Dan answers no to the preview of ${what}: nothing is sent or written.`,
});
const noConfirm = (given: string): Refusal => ({
  error: error_CLI_USAGE,
  given,
  when: "A script runs it without `--confirm`: nothing is read, sent or written.",
});
const CONVERTED =
  "`<Ivy's lead>` is converted: the refusal names the Umbrella deal, which carries its conversations on, and nothing is written.";

// ── org crm timeline ────────────────────────────────────────────────────────────────────────

// ── org crm email send ──────────────────────────────────────────────────────────────────────

// ── org crm whatsapp connect, disconnect, show, send ────────────────────────────────────────

// ── org crm note add, change ────────────────────────────────────────────────────────────────

// ── org crm task create, change, move, list ─────────────────────────────────────────────────

// ── org crm call log ────────────────────────────────────────────────────────────────────────

