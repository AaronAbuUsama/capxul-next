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
import { LeadView, rpc_contacts_leads_convert, rpc_contacts_leads_list } from "./leads.ts";
import { DealView, rpc_contacts_deals_list } from "./deals.ts";
import {
  flow_client_account_address_book_change,
  flow_client_account_address_book_create,
  flow_client_account_address_book_hide,
  flow_client_account_address_book_label,
  flow_client_account_address_book_link,
  flow_client_account_address_book_unhide,
  flow_client_org_crm_deals_change,
  flow_client_org_crm_deals_create,
  flow_client_org_crm_deals_get,
  flow_client_org_crm_deals_list,
  flow_client_org_crm_deals_move,
  flow_client_org_crm_leads_change,
  flow_client_org_crm_leads_convert,
  flow_client_org_crm_leads_create,
  flow_client_org_crm_leads_get,
  flow_client_org_crm_leads_list,
  flow_client_org_crm_leads_move,
} from "./flows.ts";

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
 * `person-with-contacts` holds as Rex, Acme's agent with a Seat and no hat (decision contacts.members-write).
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
    `Ada, signed in, names Acme with \`--org\`, where she holds no Seat; or Rex, Acme's agent, holds a Seat but its Safe ` +
    `wears no People hat, and ${what}: nothing is written. The right is the hat's: once the Board grants Rex's Safe the ` +
    "hat the same command succeeds, and once it revokes it, it is refused again.",
});
const invalid = (given: string, when: string): Refusal => ({ error: error_INVALID_INPUT, given, when });
const wrong = (when: string): Refusal => ({ error: error_WRONG_STATE, given: CRM_WORLD, when });

/** A write to a book: a person's own, or with `--org` an Organization's. */
const WHO_BOOK_WRITE =
  "A signed-in person, for their own book. With `--org`, a member of the Organization whose Safe wears its People hat " +
  "when the command runs, a person's Seat or an agent's: an officer hat the Board grants and revokes, so the right goes " +
  "with the hat, never with a person (contacts.members-write).";
const WHO_CRM_WRITE_OP =
  "A member of the Organization whose Safe wears its People hat when the command runs, a person's Seat or an agent's " +
  "(the FDE once the Board grants it the hat). The right goes with the hat, never with a person: the Board swaps members " +
  "in and out by granting and revoking it (contacts.crm-permission).";
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
    "detail, and only `contact link` decides where money paid to the entry goes.",
  area: BOOK_AREA,
  command: "contact change",
  priority: "normal",
  implementedBy: flow_client_account_address_book_change,
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
        "`--company` that is not an organization entry of the book; a negative `--revenue`: the refusal names the field and nothing is written.",
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
  who: WHO_BOOK_WRITE,
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
    denied(CRM_WORLD, "links an entry of Acme's book"),
    invalid(
      CRM_WORLD,
      "An id not in the book; an entry that already has a Party; a locator that names nothing, the book's own Party, a " +
        "Party already in the book or a Party of the other kind (an Organization for a person, a mailbox, a person or an " +
        "agent for a company): nothing is written and no Party is named.",
    ),
  ],
  budget: guidedWrite,
});

// ── org crm lead ────────────────────────────────────────────────────────────────────────────

export const operation_org_crm_lead_create = defineOperation({
  id: "org.crm.lead.create",
  title: "Capture a lead",
  about:
    "Captures a lead in the Organization's CRM with status New: a prospect you have not yet qualified, by their name, " +
    "mailbox, numbers and job title, and their company's name, website, industry, territory, size and revenue, with " +
    "where the lead came from (`--source`) and the member who works it (`--owner`, an email or @handle). A lead needs a " +
    "first name, a company name or a mailbox. Its mailbox stays the Organization's note: nobody is named in the " +
    "directory until the lead converts.",
  area: CRM_AREA,
  command: "org crm lead create",
  priority: "critical",
  implementedBy: flow_client_org_crm_leads_create,
  who: WHO_CRM_WRITE_OP,
  changes: "One new lead, status New, and its entry in the CRM's change log. Nobody is named in the directory.",
  acceptance: [
    claim(
      "A lead is captured with status New, at stage open, with the fields given, and the list shows it first.",
      "cli: `org crm lead create --first-name Nia --company \"Acme Bakers\" --email nia@bakers.test --source Website " +
        "--org acme` prints a `lead_` id, `status: New`, `stage: open`, those fields and `deal: null`; read: `org crm lead " +
        "list --org acme` lists it first and `org crm lead get <id>` prints the same lead; trace: one `lead_transitioned` (capture).",
    ),
    claim(
      "A lead needs a first name, a company name or a mailbox.",
      "cli: `org crm lead create --last-name Ray --phone +447700900111 --org acme` is INVALID_INPUT and `org crm lead " +
        "create --company Initech --org acme` prints a lead; world: the refusal's diff is empty.",
    ),
    claim(
      "A lead's owner is a member of the Organization, named by email or @handle, and never the lead's own mailbox.",
      "cli: `--owner @rex` prints Rex's Party id as `lead_owner`; `--owner ada@example.com` (no Seat in Acme) and " +
        "`--email dan@acme.test --owner dan@acme.test` are each INVALID_INPUT naming `lead_owner`; world: each refusal's diff is empty.",
    ),
    claim(
      "A lead's mailbox names nobody in the directory until the lead converts.",
      "world: the diff of `org crm lead create --first-name Nia --email nia@bakers.test --org acme` holds the lead and " +
        "its change-log row and no Party; read: `contact list --org acme` shows no entry for Nia.",
    ),
    claim(
      "Authority is the People hat worn when the command runs: refused without it, admitted once the Board grants it, refused once it is revoked.",
      "cli: Rex's `org crm lead create --first-name Nia --org acme` is ROLE_PERMISSION_DENIED; " + HAT_FOLLOWS,
    ),
  ],
  returns: LeadView,
  errors: [error_CLI_USAGE],
  refusals: [
    signedOut(CRM_WORLD),
    denied(CRM_WORLD, "captures a lead"),
    invalid(
      CRM_WORLD,
      "No first name, company name or mailbox; a malformed mailbox, a text over 140 characters, an `--employees` outside " +
        "Frappe's ranges or a negative `--revenue`; an `--owner` with no Seat in Acme, or who is the lead's own mailbox: " +
        "the refusal names the field and nothing is written.",
    ),
  ],
  budget: budget("write"),
});

export const operation_org_crm_lead_change = defineOperation({
  id: "org.crm.lead.change",
  title: "Change a lead's fields",
  about:
    "Changes the fields of one lead, named by its id: each flag given replaces the stored value, `--clear` empties one, " +
    "and the rest stay. A lead must still have a first name, a company name or a mailbox. Its status moves only with " +
    "`org crm lead move`, and a converted lead no longer changes: its deal carries the work on.",
  area: CRM_AREA,
  command: "org crm lead change",
  priority: "normal",
  implementedBy: flow_client_org_crm_leads_change,
  who: WHO_CRM_WRITE_OP,
  changes: "The lead's fields, and its entry in the CRM's change log. Its status stays.",
  acceptance: [
    claim(
      "Only the fields given change, `--clear` empties one, and the status never moves here.",
      "cli: `org crm lead change <Pat's lead> --job-title CTO --clear email --org acme` prints `job_title: CTO`, " +
        "`email: null` and `status: New` with the rest as it was; read: `org crm lead get` prints the same.",
    ),
    claim(
      "A change that leaves the lead with no first name, company name or mailbox is refused.",
      "cli: `org crm lead change <Quinn's lead> --clear first-name --clear email --org acme` is INVALID_INPUT; world: the diff is empty.",
    ),
    claim(
      "A converted lead no longer changes.",
      "cli: `org crm lead change <Ivy's lead> --phone +447700900222 --org acme` is WRONG_STATE naming `converted`; world: the diff is empty.",
    ),
    claim(
      "An id that is none of the Organization's leads is refused, as there is no not-found code.",
      "cli: a deal's id, and a well-formed `lead_` id that names no lead of Acme's, are each INVALID_INPUT; world: each diff is empty.",
    ),
  ],
  returns: LeadView,
  errors: [error_CLI_USAGE],
  refusals: [
    signedOut(CRM_WORLD),
    denied(CRM_WORLD, "changes a lead"),
    invalid(
      CRM_WORLD,
      "A lead id that is none of Acme's; a bad value, as for `org crm lead create`; or a change that leaves no first " +
        "name, company name or mailbox: the refusal names the field and nothing is written.",
    ),
    wrong("Dan changes Ivy's lead, which is converted: its deal carries the work on. Nothing is written."),
  ],
  budget: budget("write"),
});

export const operation_org_crm_lead_move = defineOperation({
  id: "org.crm.lead.move",
  title: "Move a lead to another status",
  about:
    "Moves one lead to one of Frappe CRM's lead statuses: New; Contacted or Nurture (ongoing); Qualified or Converted " +
    "(won); Unqualified or Junk (lost). A lost status needs `--reason`, one of Frappe's lost reasons, and `Other` also " +
    "needs `--notes`; moving out of lost clears them. Choosing Converted makes no deal: `org crm lead convert` does. A " +
    "converted lead does not move.",
  area: CRM_AREA,
  command: "org crm lead move",
  priority: "normal",
  implementedBy: flow_client_org_crm_leads_move,
  who: WHO_CRM_WRITE_OP,
  changes: "The lead's status, and its stage when the status is of another type, with its entry in the CRM's change log.",
  acceptance: [
    claim(
      "A move to a status of another type changes the lead's stage; a move within its stage changes only its status.",
      "cli: `org crm lead move <Pat's lead> Contacted --org acme` prints `status: Contacted`, `stage: ongoing`, then " +
        "`move <it> Nurture` prints `status: Nurture`, `stage: ongoing`; trace: one `lead_transitioned` (engage) for the first and none for the second.",
    ),
    claim(
      "A lost status needs a reason from Frappe's list, and Other also needs notes; moving out of lost clears them.",
      "cli: `move <Quinn's lead> Junk` and `move <Quinn's lead> Junk --reason Other` are INVALID_INPUT; `--reason Other " +
        "--notes \"moved abroad\"` prints `stage: lost` with that reason and those notes; `move <Max's lead> New` prints " +
        "`stage: open`, `lost_reason: null` and `lost_notes: null`.",
    ),
    claim(
      "Converted is a status like Qualified: moving to it makes no deal.",
      "cli: `org crm lead move <Jo's lead> Converted --org acme` prints `stage: won` and `deal: null`; read: `org crm deal list --org acme` lists the same four deals.",
    ),
    claim(
      "A converted lead does not move.",
      "cli: `org crm lead move <Ivy's lead> New --org acme` is WRONG_STATE naming `converted`; world: the diff is empty.",
    ),
  ],
  returns: LeadView,
  errors: [error_CLI_USAGE],
  refusals: [
    signedOut(CRM_WORLD),
    denied(CRM_WORLD, "moves a lead"),
    invalid(
      CRM_WORLD,
      "A status that is none of Frappe CRM's lead statuses; a lost status with no `--reason`, or `Other` with no " +
        "`--notes`; a lead id that is none of Acme's: nothing is written.",
    ),
    wrong("Dan moves Ivy's lead, which is converted and changes no more. Nothing is written."),
  ],
  budget: budget("write"),
});

export const operation_org_crm_lead_convert = defineOperation({
  id: "org.crm.lead.convert",
  title: "Convert a lead to a deal",
  about:
    "Converts one lead to an open deal, as Frappe CRM's Convert to Deal does: the deal, in Qualification, with the " +
    "lead's company and its person as the primary one, its owner and source, and the value, currency and expected close " +
    "day given. The person is the `--contact` given, else the book's entry for the lead's mailbox (named in the " +
    "directory if new), else a new private one; the company is the `--company` given, else the book's company of that " +
    "name, else a new private one. The lead becomes converted, status Qualified. Converting again prints the same deal; " +
    "a lost lead does not convert.",
  area: CRM_AREA,
  command: "org crm lead convert",
  priority: "critical",
  implementedBy: flow_client_org_crm_leads_convert,
  who: WHO_CRM_WRITE_OP,
  changes:
    "One deal in Qualification, the lead converted, and the person and company entries it makes, each with its entry in " +
    "the CRM's change log. A lead's mailbox no Party holds is named in the directory.",
  acceptance: [
    claim(
      "Converting makes an open deal from the lead, with its company and its person as primary, and marks the lead converted, status Qualified.",
      "cli: `org crm lead convert <Jo's lead> --value 8000 --currency GBP --close-by 2027-01-31 --org acme` prints the " +
        "lead with `stage: converted`, `status: Qualified` and `deal` the new deal's id; read: `org crm deal get <it>` " +
        "shows Qualification, Hooli, Jo as its primary person, the lead, 8000 GBP and that day, and `contact list --org " +
        "acme` shows Jo (a `party_` entry) and Hooli (a `contact_` company); trace: one `lead_transitioned` (convert) and one `deal_transitioned` (start).",
    ),
    claim(
      "The person is matched by mailbox and the company by its shown name, so nobody is entered twice.",
      "cli: `org crm lead convert <Kim's lead> --org acme` prints Kim's entry as `contact` and Globex's as " +
        "`organization`; read: `contact list --org acme` shows no new entry, and `org crm deal list --company <Globex>` " +
        "lists the new deal beside the three it had.",
    ),
    claim(
      "A lead converts once: converting again prints the same deal, and a lost lead does not convert.",
      "cli: `org crm lead convert <Ivy's lead> --org acme` prints the Umbrella deal's id; read: `org crm deal list` still " +
        "lists four deals; cli: `convert <Max's lead>` is WRONG_STATE naming `lost`; world: both diffs are empty.",
    ),
    claim(
      "A person or company given must be an entry of the Organization's book, of that kind.",
      "cli: `convert <Pat's lead> --company <Kim>` and `convert <Pat's lead> --contact <Globex>` are each INVALID_INPUT " +
        "naming the flag; world: each diff is empty, with no Party named for pat@initech.test.",
    ),
  ],
  returns: rpc_contacts_leads_convert.output,
  errors: [error_CLI_USAGE],
  refusals: [
    signedOut(CRM_WORLD),
    denied(CRM_WORLD, "converts a lead"),
    invalid(
      CRM_WORLD,
      "A `--contact` that is no Contact entry of Acme's book, a `--company` that is no CRM Organization entry of it, a " +
        "negative `--value`, a `--currency` that is not 3 to 10 capitals, a `--close-by` that is no day, or a lead id " +
        "that is none of Acme's: nothing is written and no Party is named.",
    ),
    wrong("Dan converts Max's lead, which is lost (Junk): Frappe cannot convert a lead whose status is of type Lost. Nothing is written."),
  ],
  budget: budget("write"),
});

export const operation_org_crm_lead_list = defineOperation({
  id: "org.crm.lead.list",
  title: "List the Organization's leads",
  about:
    "Lists the Organization's leads, most recent change first, a page at a time, each with its status, stage, name, " +
    "company, mailbox, source and owner. `--stage` shows one stage only: open, ongoing, won, lost, or converted (a " +
    "converted lead is never listed as won). Use it to find a lead's id.",
  area: CRM_AREA,
  command: "org crm lead list",
  priority: "critical",
  implementedBy: flow_client_org_crm_leads_list,
  who: WHO_CRM_READ_OP,
  changes: NOTHING_READ,
  notes: PAGE_NOTES,
  acceptance: [
    claim(
      "Every member sees the Organization's leads, most recent change first.",
      "read: as Rex (a Seat, no hat), `org crm lead list --org acme` prints Ivy's, Kim's, Max's, Jo's, Quinn's and Pat's leads, in that order.",
    ),
    claim(
      "A stage filter shows that stage only, and a converted lead is under converted, never won.",
      "read: `--stage lost` prints Max's lead alone, `--stage converted` Ivy's alone and `--stage won` Jo's alone.",
    ),
    claim(
      "A page holds at most `--limit` leads and gives the cursor for the next; a cursor from another list is refused.",
      "cli: `--limit 4` prints four and a `nextCursor`; `--after <it>` prints the other two and `nextCursor: null`; a " +
        "cursor `org crm deal list` gave is INVALID_INPUT.",
    ),
  ],
  returns: rpc_contacts_leads_list.output,
  errors: [error_CLI_USAGE],
  refusals: [
    signedOut(CRM_WORLD),
    outsider(CRM_WORLD),
    invalid(CRM_WORLD, "A cursor this list did not give (another list's, another stage's, or a forged one), or a `--limit` outside 1 to 100: nothing is listed."),
  ],
  budget: budget("read"),
});

export const operation_org_crm_lead_get = defineOperation({
  id: "org.crm.lead.get",
  title: "Show one lead",
  about: "Shows one lead of the Organization by its id: its status and stage, its fields, its owner, why it was lost, and the deal its conversion made.",
  area: CRM_AREA,
  command: "org crm lead get",
  priority: "normal",
  implementedBy: flow_client_org_crm_leads_get,
  who: WHO_CRM_READ_OP,
  changes: NOTHING_READ,
  acceptance: [
    claim(
      "One lead, with the deal its conversion made; every member reads it.",
      "read: as Rex, `org crm lead get <Ivy's lead> --org acme` prints `stage: converted`, `status: Qualified`, `deal` " +
        "the Umbrella deal's id, and her mailbox and company as they were captured.",
    ),
    claim(
      "An id that is none of the Organization's leads is refused, as there is no not-found code.",
      "cli: a deal's id, and a well-formed `lead_` id that names no lead of Acme's, are each INVALID_INPUT.",
    ),
  ],
  returns: LeadView,
  errors: [error_CLI_USAGE],
  refusals: [
    signedOut(CRM_WORLD),
    outsider(CRM_WORLD),
    invalid(CRM_WORLD, "The id is none of Acme's leads (a well-formed `lead_` id that names nothing here, or another kind's id): nothing is read."),
  ],
  budget: budget("read"),
});

// ── org crm deal ────────────────────────────────────────────────────────────────────────────

export const operation_org_crm_deal_create = defineOperation({
  id: "org.crm.deal.create",
  title: "Open a deal",
  about:
    "Opens a deal by hand in the Organization's CRM, in Qualification: a sale you are working towards with one company " +
    "(`--company`, an organization entry of its book), with its people (`--contact`, repeated; `--primary` names the " +
    "one primary person, and a lone person is primary), the member who works it (`--owner`), its probability (from its " +
    "status when not given), value and expected value with their currency, its expected close day, next step and " +
    "source. A deal is a forecast: it moves no money.",
  area: CRM_AREA,
  command: "org crm deal create",
  priority: "normal",
  implementedBy: flow_client_org_crm_deals_create,
  who: WHO_CRM_WRITE_OP,
  changes: "One new deal in Qualification, its people, and its entry in the CRM's change log.",
  acceptance: [
    claim(
      "A deal opens in Qualification, at stage open with probability 10, for its company, with the people and values given.",
      "cli: `org crm deal create --company <Globex> --contact <Kim> --value 5000 --currency GBP --close-by 2027-03-31 " +
        "--org acme` prints a `deal_` id, `status: Qualification`, `stage: open`, `probability: 10`, Globex, Kim as its " +
        "primary person, `lead: null` and those values; read: `org crm deal list --company <Globex>` lists it first; " +
        "trace: one `deal_transitioned` (start).",
    ),
    claim(
      "A deal has at most one primary person: `--primary` names it, and a lone person is primary.",
      "cli: `--contact <Kim> --contact <Ivy> --primary <Ivy>` prints Ivy primary and Kim not; `--contact <Kim>` alone prints Kim primary.",
    ),
    claim(
      "Its company and people must be entries of the book of that kind, its owner a member, and its numbers in range.",
      "cli: `--company <Kim>`, `--contact <Globex>`, `--owner ada@example.com`, `--probability 120` and `--value -5` are " +
        "each INVALID_INPUT naming the field; world: each diff is empty.",
    ),
  ],
  returns: DealView,
  errors: [error_CLI_USAGE],
  refusals: [
    signedOut(CRM_WORLD),
    denied(CRM_WORLD, "opens a deal"),
    invalid(
      CRM_WORLD,
      "A `--company` that is no CRM Organization entry of Acme's book, a `--contact` or `--primary` that is no Contact " +
        "entry of it, an `--owner` with no Seat, a `--probability` outside 0 to 100, a negative value, a `--currency` " +
        "that is not 3 to 10 capitals or a `--close-by` that is no day: the refusal names the field and nothing is written.",
    ),
  ],
  budget: budget("write"),
});

export const operation_org_crm_deal_change = defineOperation({
  id: "org.crm.deal.change",
  title: "Change a deal's fields or its people",
  about:
    "Changes one deal, named by its id, whatever its stage, as Frappe lets a won or lost deal be edited: each flag " +
    "given replaces the stored value, `--contact` (repeated) replaces its people, `--clear` empties a field, and the " +
    "rest stay. Its status moves only with `org crm deal move`.",
  area: CRM_AREA,
  command: "org crm deal change",
  priority: "normal",
  implementedBy: flow_client_org_crm_deals_change,
  who: WHO_CRM_WRITE_OP,
  changes: "The deal's fields or people, and its entry in the CRM's change log. Its status stays.",
  acceptance: [
    claim(
      "Only the fields given change, `--contact` replaces the deal's people, and the status never moves here.",
      "cli: `org crm deal change <the Globex pilot> --next-step \"Send the proposal\" --contact <Kim> --contact <Ivy> " +
        "--primary <Kim> --org acme` prints that next step, Kim primary with Ivy beside her, and `status: Qualification`; " +
        "read: `org crm deal get` prints the same.",
    ),
    claim(
      "A won or lost deal can still be changed; its stage and the day it was won stay.",
      "cli: `org crm deal change <the Globex renewal> --value 9000 --currency GBP --org acme` prints 9000 GBP, `stage: won` and the `closedAt` it had.",
    ),
    claim(
      "`--clear` empties a field.",
      "cli: `org crm deal change <the Globex pilot> --clear close-by --org acme` prints `expected_closure_date: null` with its value kept.",
    ),
    claim(
      "An id that is none of the Organization's deals is refused, as there is no not-found code.",
      "cli: a lead's id, and a well-formed `deal_` id that names no deal of Acme's, are each INVALID_INPUT; world: each diff is empty.",
    ),
  ],
  returns: DealView,
  errors: [error_CLI_USAGE],
  refusals: [
    signedOut(CRM_WORLD),
    denied(CRM_WORLD, "changes a deal"),
    invalid(CRM_WORLD, "A deal id that is none of Acme's, or a bad value, as for `org crm deal create`: the refusal names the field and nothing is written."),
  ],
  budget: budget("write"),
});

export const operation_org_crm_deal_move = defineOperation({
  id: "org.crm.deal.move",
  title: "Move a deal to another status",
  about:
    "Moves one deal to one of Frappe CRM's deal statuses: Qualification (open); Demo/Making, Proposal/Quotation, " +
    "Negotiation or Ready to Close (ongoing); Won; Lost. Winning records when the deal was won. Lost needs `--reason`, " +
    "one of Frappe's lost reasons, and `Other` also needs `--notes`; moving out of lost clears them.",
  area: CRM_AREA,
  command: "org crm deal move",
  priority: "critical",
  implementedBy: flow_client_org_crm_deals_move,
  who: WHO_CRM_WRITE_OP,
  changes: "The deal's status, its stage when the status is of another type, when it was won, and its entry in the CRM's change log.",
  acceptance: [
    claim(
      "A move to a status of another type changes the deal's stage; a move within its stage changes only its status.",
      "cli: `org crm deal move <the Globex pilot> Demo/Making --org acme` prints `stage: ongoing`, then `move <it> " +
        "Negotiation` prints `status: Negotiation`, `stage: ongoing`; trace: one `deal_transitioned` (engage) for the first and none for the second.",
    ),
    claim(
      "Winning records when the deal was won.",
      "cli: `org crm deal move <the Globex pilot> Won --org acme` prints `stage: won` and `closedAt` the devnet clock's " +
        "now; read: `org crm deal list --stage won` lists it with the renewal.",
    ),
    claim(
      "Lost needs a reason, and Other also needs notes; moving out of lost clears them.",
      "cli: `move <the Umbrella deal> Lost` is INVALID_INPUT and `--reason Competition` prints `stage: lost` with that " +
        "reason; `move <the Globex upsell> Qualification` prints `stage: open` and `lost_reason: null`.",
    ),
  ],
  returns: DealView,
  errors: [error_CLI_USAGE],
  refusals: [
    signedOut(CRM_WORLD),
    denied(CRM_WORLD, "moves a deal"),
    invalid(
      CRM_WORLD,
      "A status that is none of Frappe CRM's deal statuses, Lost with no `--reason`, `Other` with no `--notes`, or a " +
        "deal id that is none of Acme's: nothing is written.",
    ),
  ],
  budget: budget("write"),
});

export const operation_org_crm_deal_list = defineOperation({
  id: "org.crm.deal.list",
  title: "List the Organization's deals",
  about:
    "Lists the Organization's deals with their people, most recent change first, a page at a time: each with its " +
    "status, stage, company, probability, value and expected close day. Filter by one of `--stage`, `--company` (an " +
    "organization entry) or `--contact` (a person's deals). Use it to find a deal's id.",
  area: CRM_AREA,
  command: "org crm deal list",
  priority: "critical",
  implementedBy: flow_client_org_crm_deals_list,
  who: WHO_CRM_READ_OP,
  changes: NOTHING_READ,
  notes: PAGE_NOTES,
  acceptance: [
    claim(
      "Every member sees the Organization's deals with their people, most recent change first.",
      "read: as Rex (a Seat, no hat), `org crm deal list --org acme` prints the Globex upsell, the Globex renewal, the " +
        "Globex pilot and the Umbrella deal, in that order, each with its people.",
    ),
    claim(
      "A filter picks one stage's, one company's or one person's deals.",
      "read: `--stage won` prints the renewal alone; `--company <Globex>` the three Globex deals; `--contact <Ivy>` the Umbrella deal alone.",
    ),
    claim(
      "A page holds at most `--limit` deals and gives the cursor for the next; a cursor from another list is refused.",
      "cli: `--limit 2` prints two and a `nextCursor`; `--after <it>` prints the other two and `nextCursor: null`; a " +
        "cursor `org crm lead list` gave is INVALID_INPUT.",
    ),
  ],
  returns: rpc_contacts_deals_list.output,
  errors: [error_CLI_USAGE],
  refusals: [
    signedOut(CRM_WORLD),
    outsider(CRM_WORLD),
    invalid(CRM_WORLD, "A cursor this list did not give (another list's, another filter's, or a forged one), or a `--limit` outside 1 to 100: nothing is listed."),
  ],
  budget: budget("read"),
});

export const operation_org_crm_deal_get = defineOperation({
  id: "org.crm.deal.get",
  title: "Show one deal",
  about: "Shows one deal of the Organization by its id, with its people, its company, the lead it came from, its owner and why it was lost.",
  area: CRM_AREA,
  command: "org crm deal get",
  priority: "normal",
  implementedBy: flow_client_org_crm_deals_get,
  who: WHO_CRM_READ_OP,
  changes: NOTHING_READ,
  acceptance: [
    claim(
      "One deal with its people, its lead and its owner; every member reads it.",
      "read: as Rex, `org crm deal get <the Umbrella deal> --org acme` prints Umbrella Corp, Ivy as its primary person, " +
        "Ivy's lead and Dan's Party id as `deal_owner`.",
    ),
    claim(
      "An id that is none of the Organization's deals is refused, as there is no not-found code.",
      "cli: a lead's id, and a well-formed `deal_` id that names no deal of Acme's, are each INVALID_INPUT.",
    ),
  ],
  returns: DealView,
  errors: [error_CLI_USAGE],
  refusals: [
    signedOut(CRM_WORLD),
    outsider(CRM_WORLD),
    invalid(CRM_WORLD, "The id is none of Acme's deals (a well-formed `deal_` id that names nothing here, or another kind's id): nothing is read."),
  ],
  budget: budget("read"),
});
