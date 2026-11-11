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
import { LeadView, rpc_contacts_leads_convert, rpc_contacts_leads_list } from "./leads.ts";
import { CallItem, EmailItem, NoteItem, TimelinePage, WhatsAppItem, rpc_contacts_timeline_list } from "./timeline.ts";
import { WhatsAppAccount, rpc_contacts_whatsapp_connect, rpc_contacts_whatsapp_show } from "./whatsapp.ts";
import { TaskView, rpc_contacts_tasks_list, rpc_contacts_tasks_move } from "./tasks.ts";
import { rpc_contacts_calls_log } from "./calls.ts";
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
  flow_client_org_crm_emails_send,
  flow_client_org_crm_notes_add,
  flow_client_org_crm_notes_change,
  flow_client_org_crm_tasks_change,
  flow_client_org_crm_tasks_create,
  flow_client_org_crm_whatsapp_connect,
  flow_client_org_crm_whatsapp_disconnect,
  flow_client_org_crm_whatsapp_send,
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

export const operation_org_crm_lead_create = defineOperation({
  id: "org.crm.lead.create",
  title: "Capture a lead",
  about:
    "Captures a lead in the Organization's CRM with status New: a prospect you have not yet qualified, by their name, " +
    "mailbox, numbers and job title, and their company's name, website, industry, territory, size and revenue, with " +
    "where the lead came from (`--source`) and the member who works it (`--owner`, an email or an agent's @handle). A lead needs a " +
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
      "A lead's owner is a member of the Organization, named by email or an agent's @handle, and never the lead's own mailbox.",
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
    "and the rest stay; a change that gives nothing is refused. A lead must still have a first name, a company name or a mailbox. Its status moves only with " +
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
      "An id that names none of the Organization's leads is refused, as there is no not-found code; one that is no lead's id is a usage error.",
      "cli: a well-formed `lead_` id that names no lead of Acme's is INVALID_INPUT, and a deal's id is CLI_USAGE (exit 2), as " +
        "`payment get` refuses an id not starting `payment_`; trace: the second makes no rpc call; world: each diff is empty.",
    ),
  ],
  returns: LeadView,
  errors: [error_CLI_USAGE],
  refusals: [
    signedOut(CRM_WORLD),
    denied(CRM_WORLD, "changes a lead"),
    invalid(
      CRM_WORLD,
      "A lead id that is none of Acme's; a bad value, as for `org crm lead create`; a change that leaves no first " +
        "name, company name or mailbox; or no flag at all: the refusal names the field, or says nothing was given, and nothing is written.",
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
    "day given. The person is the `--contact` given, else the book's person who keeps the lead's mailbox, else the " +
    "entry of that mailbox's Party (named in the directory if new), else a new private one; the company is the " +
    "`--company` given, else the book's company of that " +
    "name, else a new private one. The lead becomes converted, status Qualified. Converting again prints the same deal; " +
    "a lost lead does not convert.",
  area: CRM_AREA,
  command: "org crm lead convert",
  priority: "critical",
  implementedBy: flow_client_org_crm_leads_convert,
  who: WHO_CRM_WRITE_OP,
  changes:
    "One deal in Qualification, the lead converted, and the person and company entries it makes, each with its entry in " +
    "the CRM's change log. A lead's mailbox that no person of the book keeps and no Party holds is named in the directory.",
  acceptance: [
    claim(
      "Converting makes an open deal from the lead, with its company and its person as primary, and marks the lead converted, status Qualified.",
      "cli: `org crm lead convert <Jo's lead> --value 8000 --currency GBP --close-by 2027-01-31 --org acme` prints the " +
        "lead with `stage: converted`, `status: Qualified` and `deal` the new deal's id; read: `org crm deal get <it>` " +
        "shows Qualification, Hooli's new entry as `organization`, Jo's as its primary person, the lead, 8000 GBP and " +
        "that day, and `contact list --org " +
        "acme` shows Jo (a `party_` entry) and Hooli (a `contact_` company); trace: one `lead_transitioned` (convert) and one `deal_transitioned` (start).",
    ),
    claim(
      "The person is matched by the mailbox an entry keeps, private or not, or by that mailbox's Party, and the company by its shown name, so nobody is entered twice.",
      "cli: `org crm lead convert <Kim's lead> --org acme` prints Kim's entry as `contact` and Globex's as " +
        "`organization`; read: `contact list --org acme` shows no new entry, and `org crm deal list --company <Globex>` " +
        "lists the new deal beside the three it had; cli: after `contact create Nia --type person --phone " +
        "+447700900333 --org acme`, `contact change <Nia> --email nia@bakers.test --org acme` and `org crm lead create " +
        "--first-name Nia --email nia@bakers.test --org acme`, converting that lead prints Nia's `contact_` id as " +
        "`contact`; world: that conversion names no Party for nia@bakers.test and adds no person to the book.",
    ),
    claim(
      "A lead converts once: converting again prints the same deal, and a lost lead does not convert.",
      "cli: `org crm lead convert <Ivy's lead> --org acme` prints the Umbrella deal's id; read: `org crm deal list` still " +
        "lists four deals; cli: `convert <Max's lead>` is WRONG_STATE naming `lost`; world: both diffs are empty.",
    ),
    claim(
      "A person or company given must be an entry of the Organization's book, of that kind.",
      "cli: `convert <Pat's lead> --company <Kim>` and `convert <Pat's lead> --contact <Globex>` are each INVALID_INPUT " +
        "naming the field it sets, `organization` or `contact`, as G6 names a field; world: each diff is empty, with no " +
        "Party named for pat@initech.test.",
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
    "Lists the Organization's leads that are not converted, most recent change first, a page at a time, each with its " +
    "status, stage, name, company, mailbox, source and owner, as Frappe CRM's leads list shows them: a converted " +
    "lead's work goes on in its deal. `--stage` shows one stage only: open, ongoing, won, lost, or converted, the one " +
    "way to list converted leads (a converted lead is never listed as won). Use it to find a lead's id.",
  area: CRM_AREA,
  command: "org crm lead list",
  priority: "critical",
  implementedBy: flow_client_org_crm_leads_list,
  who: WHO_CRM_READ_OP,
  changes: NOTHING_READ,
  notes: PAGE_NOTES,
  acceptance: [
    claim(
      "Every member sees the Organization's leads that are not converted, most recent change first, as Frappe CRM's leads list shows them.",
      "read: as Rex (a Seat, no hat), `org crm lead list --org acme` prints Kim's, Max's, Jo's, Quinn's and Pat's leads, " +
        "in that order, and not Ivy's, which is converted.",
    ),
    claim(
      "A stage filter shows that stage only, and a converted lead is listed only under converted, never won.",
      "read: `--stage lost` prints Max's lead alone, `--stage converted` Ivy's alone and `--stage won` Jo's alone.",
    ),
    claim(
      "A page holds at most `--limit` leads and gives the cursor for the next; a cursor from another list is refused.",
      "cli: `--limit 4` prints four and a `nextCursor`; `--after <it>` prints Pat's alone and `nextCursor: null`; a " +
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
      "An id that names none of the Organization's leads is refused, as there is no not-found code; one that is no lead's id is a usage error.",
      "cli: a well-formed `lead_` id that names no lead of Acme's is INVALID_INPUT, never null, and a deal's id is " +
        "CLI_USAGE (exit 2), as `payment get` refuses an id not starting `payment_`; trace: the second makes no rpc call.",
    ),
  ],
  returns: LeadView,
  errors: [error_CLI_USAGE],
  refusals: [
    signedOut(CRM_WORLD),
    outsider(CRM_WORLD),
    invalid(CRM_WORLD, "The id is a well-formed `lead_` id that names none of Acme's leads: there is no not-found code, and nothing is read."),
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
        "--org acme` prints a `deal_` id, `status: Qualification`, `stage: open`, `probability: 10`, Globex's entry as " +
        "`organization`, Kim's as its primary person, `lead: null` and those values; read: `org crm deal list --company <Globex>` lists it first; " +
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
    "rest stay; a change that gives nothing is refused. Its status moves only with `org crm deal move`.",
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
      "An id that names none of the Organization's deals is refused, as there is no not-found code; one that is no deal's id is a usage error.",
      "cli: a well-formed `deal_` id that names no deal of Acme's is INVALID_INPUT, and a lead's id is CLI_USAGE (exit 2), as " +
        "`payment get` refuses an id not starting `payment_`; trace: the second makes no rpc call; world: each diff is empty.",
    ),
  ],
  returns: DealView,
  errors: [error_CLI_USAGE],
  refusals: [
    signedOut(CRM_WORLD),
    denied(CRM_WORLD, "changes a deal"),
    invalid(
      CRM_WORLD,
      "A deal id that is none of Acme's, a bad value, as for `org crm deal create`, or no flag at all: the refusal names " +
        "the field, or says nothing was given, and nothing is written.",
    ),
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
    "status, stage, company, probability, value and expected close day. Filter by `--stage`, `--company` (an " +
    "organization entry) and `--contact` (a person's deals); filters given together all apply. Use it to find a deal's id.",
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
      "A filter picks one stage's, one company's or one person's deals, and filters given together all apply.",
      "read: `--stage won` prints the renewal alone; `--company <Globex>` the three Globex deals; `--contact <Ivy>` the " +
        "Umbrella deal alone; `--company <Globex> --stage open` the Globex pilot alone; `--contact <Ivy> --stage won` none.",
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
      "read: as Rex, `org crm deal get <the Umbrella deal> --org acme` prints Umbrella Corp's entry id as " +
        "`organization`, Ivy's as its primary person, Ivy's lead as `lead` and Dan's Party id as `deal_owner`.",
    ),
    claim(
      "An id that names none of the Organization's deals is refused, as there is no not-found code; one that is no deal's id is a usage error.",
      "cli: a well-formed `deal_` id that names no deal of Acme's is INVALID_INPUT, never null, and a lead's id is " +
        "CLI_USAGE (exit 2), as `payment get` refuses an id not starting `payment_`; trace: the second makes no rpc call.",
    ),
  ],
  returns: DealView,
  errors: [error_CLI_USAGE],
  refusals: [
    signedOut(CRM_WORLD),
    outsider(CRM_WORLD),
    invalid(CRM_WORLD, "The id is a well-formed `deal_` id that names none of Acme's deals: there is no not-found code, and nothing is read."),
  ],
  budget: budget("read"),
});

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

export const operation_org_crm_timeline = defineOperation({
  id: "org.crm.timeline",
  title: "Read a contact's, lead's or deal's timeline",
  about:
    "Shows one record's timeline, newest first, as Frappe CRM's activity timeline does: every email sent or received " +
    "about it or with its people, every WhatsApp message with its number, the calls logged, the notes and tasks, when " +
    "it was created, and the money the chain shows between the Organization and the record's Party (payments either " +
    "way, money waiting for them in a claim escrow, and an invoice they pay through its escrow). A deal's timeline " +
    "includes its lead's. Name the record by its id as `contact " +
    "list`, `org crm lead list` or `org crm deal list` prints it. `--kind` keeps only some kinds.",
  area: CRM_AREA,
  command: "org crm timeline",
  priority: "normal",
  implementedBy: rpc_contacts_timeline_list,
  who: WHO_CRM_READ_OP,
  changes: NOTHING_READ,
  notes: PAGE_NOTES,
  acceptance: [
    claim(
      "A deal's timeline gathers what was said about it newest first, each item as it stands, every time the world's.",
      "read: as Rex (a Seat, no hat) in org-with-conversations, `org crm timeline <the Globex pilot> --org acme` prints, " +
        "newest first, the task `Send the contract` (Backlog), the note `Budget`, Kim's `Re: Pilot proposal` (received, " +
        "`in_reply_to` the sent email's id), the sent `Pilot proposal` and the deal's `record` (created); each `at` is the " +
        "devnet clock's time of its world step.",
    ),
    claim(
      "A contact's timeline shows every email with their kept mailbox, every WhatsApp message with their number, the calls logged with them and the money the chain shows with their Party.",
      "read: `org crm timeline <Kim> --org acme` prints, newest first by `at`, the money item (out, `via: claim-escrow`, " +
        "40 USDC in raw units, `standing: open`), the call (Outgoing, Completed, 600 seconds ending at its step's " +
        "time, its note's id) with that note at the same `at`, Dan's WhatsApp `Yes, from 6 January.`, Kim's `Is the " +
        "pilot still on?`, her reply, the sent email and her entry's `record` (created); " +
        "chain: the escrow's EscrowCreated names Acme's company Safe as sender and Kim's Safe as owner.",
    ),
    claim(
      "A lead's timeline shows the email that made it, and a record with no Party shows no money.",
      "read: `org crm timeline <Nia's lead> --org acme` prints her `Deliveries` email (received) and the lead's `record` " +
        "(created) and no money item; `org crm timeline <Globex Ltd>` (a private company) prints no money item.",
    ),
    claim(
      "`--kind` keeps only the kinds given, and a page continues from its cursor.",
      "read: `org crm timeline <Kim> --kind whatsapp --org acme` prints only the two WhatsApp messages; `--limit 2` prints " +
        "two items and a `nextCursor`, and `--after` it prints the rest, none twice.",
    ),
  ],
  returns: TimelinePage,
  errors: [error_CLI_USAGE],
  refusals: [
    signedOut(TALK_WORLD),
    outsider(TALK_WORLD),
    invalid(
      TALK_WORLD,
      "A well-formed `deal_`, `lead_`, `party_` or `contact_` id that names nothing in Acme's CRM, a `--kind` outside " +
        "email, whatsapp, call, note, task, money and record, a cursor this timeline did not give, or a `--limit` " +
        "outside 1 to 100: nothing is read.",
    ),
  ],
  budget: budget("read"),
});

// ── org crm email send ──────────────────────────────────────────────────────────────────────

export const operation_org_crm_email_send = defineOperation({
  id: "org.crm.email.send",
  title: "Send an email about a contact, lead or deal",
  about:
    "Sends an email from the Organization's CRM mailbox, `<handle>@<CRM mail domain>`, about one record: to the " +
    "record's own mailbox (a person's primary one, a lead's, a deal's primary person's) unless `--to` names others, " +
    "with `--cc` and `--bcc`. It goes in your name at the Organization, and replies come back to the mailbox and land " +
    "on the same record's timeline, threaded by the email they answer. `--in-reply-to` answers an email on the timeline, named by its id. " +
    "Mail from someone the CRM does not know becomes a new lead. An email cannot be taken back, so at a terminal it " +
    "shows what it will send and asks; `--confirm` answers yes from a script.",
  area: CRM_AREA,
  command: "org crm email send",
  priority: "normal",
  implementedBy: flow_client_org_crm_emails_send,
  who: WHO_CRM_PREVIEW_OP,
  changes: "One email, sent from the CRM mailbox, on the record's timeline and the CRM's change log.",
  acceptance: [
    claim(
      "An email about a record goes from the Organization's CRM mailbox to the record's own mailbox, dated by the world's clock, and stays in the world.",
      `cli: in org-with-crm, \`org crm email send <the Globex pilot> --subject "Pilot proposal" --body "Here is our proposal." --org acme --confirm\` ` +
        `prints a \`comm_\` id, \`direction: sent\`, \`from: ${MAILBOX}\`, \`to: [kim@globex.test]\` and \`delivery_status: sent\`; world: ` +
        `the mail sink holds one message to kim@globex.test from \`Dan Cole at Acme Ltd <${MAILBOX}>\`, Reply-To ${MAILBOX}, ` +
        "Message-ID `<that id>@crm.devnet.test`, dated at the devnet clock's now, and nothing reached Resend; read: " +
        "`org crm timeline <the Globex pilot>` and `<Kim>` list it.",
    ),
    claim(
      "A reply threads back onto the same record by the email it answers, whatever its subject.",
      `world: \`capxul-devnet mail receive --to ${MAILBOX} --from kim@globex.test --subject "Other" --in-reply-to <its Message-ID> Yes\`, ` +
        "then settling; read: `org crm timeline <the Globex pilot>` shows the reply, received, `in_reply_to` the sent " +
        "email's id; trace: one `inbound_mail_transitioned` (thread) and one `communication_transitioned` (receive).",
    ),
    claim(
      "Mail from someone the CRM does not know becomes a new lead, and mail from a kept mailbox lands on its contact.",
      `world: \`capxul-devnet mail receive --to ${MAILBOX} --from "Oli Grant <oli@new.test>" --subject Hello Hi\` and ` +
        "`--from kim@globex.test --subject Thanks Thanks`, then settling; read: `org crm lead list --org acme` lists a " +
        "lead Oli Grant, oli@new.test, `source: Email`, whose timeline shows the email, and Kim's timeline shows `Thanks`.",
    ),
    claim(
      "A send whose answer is lost and is retried sends once.",
      "trace: a run whose first answer the eval drops makes two `contacts.mail.send` calls under one send key, and both " +
        "print the same `comm_` id; world: the mail sink holds one message and the timeline one email.",
    ),
    claim(
      "Only a member whose Safe wears the People hat sends, and every member reads what was sent.",
      "cli: Rex's `org crm email send <Kim> --subject Hi --body Hi --org acme --confirm` is ROLE_PERMISSION_DENIED and the " +
        "sink holds nothing new; read: Rex's `org crm timeline <the Globex pilot>` shows Dan's emails; cli: " + HAT_FOLLOWS,
    ),
  ],
  returns: EmailItem,
  errors: [error_CLI_USAGE],
  refusals: [
    signedOut(CRM_WORLD),
    deniedPreview(CRM_WORLD, "sends an email from Acme's CRM"),
    invalid(
      CRM_WORLD,
      "A record none of Acme's CRM's; no `--to` for a record with no mailbox (Globex Ltd, a company); a malformed mailbox " +
        "or more than 50 in all; a blank subject or body; or an `--in-reply-to` that is no email on the record's timeline: " +
        "nothing is sent or written.",
    ),
    wrong(`\`org crm email send <Ivy's lead> --subject Hi --body Hi --org acme --confirm\`: ${CONVERTED}`),
    {
      error: error_PROVIDER_ERROR,
      given: CRM_WORLD,
      when: "After `dev mail fail --next 1`, the sink refuses the send as Resend down would: nothing is written, and the same command then sends.",
    },
    cancelled(CRM_WORLD, "an email to Kim"),
    noConfirm(CRM_WORLD),
  ],
  budget: budget("vendor"),
});

// ── org crm whatsapp connect, disconnect, show, send ────────────────────────────────────────

export const operation_org_crm_whatsapp_connect = defineOperation({
  id: "org.crm.whatsapp.connect",
  title: "Connect the Organization's WhatsApp Business number",
  about:
    "Connects the Organization's own WhatsApp Business number, on Meta's WhatsApp Business Cloud API, to its CRM. It " +
    "reads the number's ids and its access token, app secret and verify token from `--key-file` or asks for each (a " +
    "secret is never a flag), checks the number with Meta, subscribes your Meta app to the number's WhatsApp Business " +
    "Account (without which Meta sends it no webhooks), and prints the webhook URL and verify token to set as your " +
    "app's callback; from then on messages to and from the number land on your contacts' timelines. An Organization has one " +
    "number at a time. At a terminal it shows what it will connect and asks; `--confirm` answers yes from a script.",
  area: CRM_AREA,
  command: "org crm whatsapp connect",
  priority: "normal",
  implementedBy: flow_client_org_crm_whatsapp_connect,
  who: WHO_CRM_PREVIEW_OP,
  changes: "The Organization's WhatsApp account, active, with its secrets sealed. Nothing is sent.",
  acceptance: [
    claim(
      "A number is connected once Meta answers for it, and the command prints the webhook to set in Meta and never a secret.",
      "cli: in org-with-crm, after `capxul-devnet whatsapp number add acme`, `org crm whatsapp connect --key-file " +
        "acme-whatsapp.json --org acme --confirm` prints a `wa_` id, `status: active`, `display_number: +447700900100`, a " +
        "`webhook_url` ending `/v1/whatsapp/<that id>` and the verify token, and no output carries the access token or " +
        "the app secret; read: `org crm whatsapp show --org acme` prints the account without the verify token.",
    ),
    claim(
      "Its route takes only what Meta signs with the number's app secret.",
      "world: in org-with-conversations, `capxul-devnet whatsapp receive +447700900100 --from +447700900789 Hi`, then " +
        "settling: `org crm timeline <Kim>` shows it; a post to the route with a signature of another secret is refused " +
        "(NOT_AUTHENTICATED) and the diff is empty.",
    ),
    claim(
      "An Organization has one live number at a time.",
      "cli: in org-with-conversations, `org crm whatsapp connect --key-file acme-whatsapp.json --org acme --confirm` is " +
        "WRONG_STATE naming the live account; world: the diff is empty.",
    ),
    claim(
      "Only a member whose Safe wears the People hat connects one.",
      "cli: in org-with-crm, Rex's `org crm whatsapp connect --key-file acme-whatsapp.json --org acme --confirm` is " +
        "ROLE_PERMISSION_DENIED; " + HAT_FOLLOWS,
    ),
  ],
  returns: rpc_contacts_whatsapp_connect.output,
  errors: [error_CLI_USAGE],
  refusals: [
    signedOut(CRM_WORLD),
    deniedPreview(CRM_WORLD, "connects a number to Acme's CRM"),
    invalid(
      CRM_WORLD,
      "A key file whose token the stand-in refuses (401), whose phone id names no number it serves, or a field not of " +
        "its form (an id that is not digits, an empty secret): the refusal names the field, and nothing is written.",
    ),
    wrongIn(TALK_WORLD, "Acme's number is already connected: the refusal names the live account, and nothing is written."),
    {
      error: error_PROVIDER_ERROR,
      given: CRM_WORLD,
      when: "With `capxul-devnet fault whatsapp down` armed, Meta's stand-in cannot be read: nothing is written.",
    },
    cancelled(CRM_WORLD, "connecting Acme's number"),
    noConfirm(CRM_WORLD),
  ],
  budget: budget("vendor"),
});

export const operation_org_crm_whatsapp_disconnect = defineOperation({
  id: "org.crm.whatsapp.disconnect",
  title: "Disconnect the Organization's WhatsApp number",
  about:
    "Disconnects the Organization's WhatsApp number from its CRM: nothing more is sent from it, and Meta's deliveries " +
    "for it are refused. Every message stays on its records' timelines. Connecting a number again starts afresh. At a " +
    "terminal it shows the number and asks; `--confirm` answers yes from a script.",
  area: CRM_AREA,
  command: "org crm whatsapp disconnect",
  priority: "normal",
  implementedBy: flow_client_org_crm_whatsapp_disconnect,
  who: WHO_CRM_PREVIEW_OP,
  changes: "The account, disconnected for good, its secrets erased. Its messages are kept.",
  acceptance: [
    claim(
      "Disconnecting stops every send and every delivery, and keeps every message.",
      "cli: in org-with-conversations, `org crm whatsapp disconnect --org acme --confirm` prints `status: " +
        "disconnected`, then `org crm whatsapp send <Kim> --text Hi --org acme --confirm` is WRONG_STATE; world: " +
        "`capxul-devnet whatsapp receive +447700900100 --from +447700900789 Hi` is refused at the route and stores " +
        "nothing; read: `org crm timeline <Kim> --kind whatsapp` still shows both messages.",
    ),
    claim(
      "Connecting again makes a new account.",
      "cli: `org crm whatsapp connect --key-file acme-whatsapp.json --org acme --confirm` then prints another `wa_` id, " +
        "`status: active`.",
    ),
    claim(
      "At a terminal it shows the number before it writes, and a decline changes nothing.",
      "cli: at a terminal, `org crm whatsapp disconnect --org acme` shows +447700900100 and asks; answering no is " +
        "CANCELLED (exit 130); world: the diff is empty.",
    ),
  ],
  returns: WhatsAppAccount,
  errors: [error_CLI_USAGE],
  refusals: [
    signedOut(TALK_WORLD),
    deniedPreview(TALK_WORLD, "disconnects Acme's number"),
    wrong("No number is connected to Acme's CRM: nothing is written."),
    cancelled(TALK_WORLD, "disconnecting Acme's number"),
    noConfirm(TALK_WORLD),
  ],
  budget: guidedWrite,
});

export const operation_org_crm_whatsapp_show = defineOperation({
  id: "org.crm.whatsapp.show",
  title: "Show the Organization's WhatsApp number",
  about:
    "Shows the WhatsApp number connected to the Organization's CRM: its status (active, failing while Meta refuses it, " +
    "or disconnected), the number and its verified name, the webhook URL to set in Meta, who connected it and when, " +
    "and its last check. Never a token, a secret or the verify token. Null when none was ever connected.",
  area: CRM_AREA,
  command: "org crm whatsapp show",
  priority: "normal",
  implementedBy: rpc_contacts_whatsapp_show,
  who: WHO_CRM_READ_OP,
  changes: NOTHING_READ,
  acceptance: [
    claim(
      "Every member reads the connected number, its status and its webhook, never a secret; with none it prints null.",
      "read: as Rex in org-with-conversations, `org crm whatsapp show --org acme` prints `status: active`, " +
        "+447700900100 and its `webhook_url`, and no token, secret or verify token; in org-with-crm it prints null.",
    ),
    claim(
      "After a disconnect it shows the last number as disconnected, until another is connected; reading writes nothing.",
      "read: in org-with-conversations, after `org crm whatsapp disconnect --org acme --confirm`, `org crm whatsapp show " +
        "--org acme` prints +447700900100 with `status: disconnected`; after `org crm whatsapp connect --key-file " +
        "acme-whatsapp.json --org acme --confirm`, it prints the new `wa_` account, active; world: each show's diff is empty.",
    ),
  ],
  returns: Schema.NullOr(WhatsAppAccount),
  errors: [error_CLI_USAGE],
  refusals: [signedOut(TALK_WORLD), outsider(TALK_WORLD)],
  budget: budget("read"),
});

export const operation_org_crm_whatsapp_send = defineOperation({
  id: "org.crm.whatsapp.send",
  title: "Send a WhatsApp message about a contact, lead or deal",
  about:
    "Sends a WhatsApp message from the Organization's connected number about one record: to the record's own number (a " +
    "person's primary mobile or phone, a lead's, a deal's primary person's) unless `--to` names one. A free-form " +
    "`--text` goes only within 24 hours of the last message that number sent you, as WhatsApp allows; outside that " +
    "window send an approved `--template`. `--in-reply-to` answers a message on the timeline. The message, its replies " +
    "and its delivery land on the record's timeline. A " +
    "message cannot be taken back, so at a terminal it shows what it will send and asks; `--confirm` answers yes from a " +
    "script.",
  area: CRM_AREA,
  command: "org crm whatsapp send",
  priority: "normal",
  implementedBy: flow_client_org_crm_whatsapp_send,
  who: WHO_CRM_PREVIEW_OP,
  changes: "One WhatsApp message, sent from the connected number, on the record's timeline and the CRM's change log.",
  acceptance: [
    claim(
      "Inside the window a text goes to the record's own number and its delivery shows on the timeline, on the world's clock.",
      "cli: in org-with-conversations, `org crm whatsapp send <Kim> --text \"See you then.\" --org acme --confirm` prints " +
        "a `wam_` id, `direction: sent`, `counterpart: +447700900789`, `status: sent`; world: the stand-in holds it from " +
        "+447700900100 at the devnet clock's now and its delivered status follows; read: `org crm timeline <Kim> --kind " +
        "whatsapp` shows it `delivered`.",
    ),
    claim(
      "Outside the 24-hour window, counted on the world's clock, a text is refused and a template goes.",
      "cli: `org crm whatsapp send <Ivy> --text Hi --org acme --confirm` (Ivy never wrote) is WRONG_STATE naming the " +
        "window and `--template hello_world --language en_US` (Meta's sample template, approved in en_US only) instead " +
        "sends; after `dev time warp 25h`, Kim's text is WRONG_STATE too; " +
        "world: each refusal's diff is empty.",
    ),
    claim(
      "A message from a number the CRM does not know becomes a new lead; one from a contact's number lands on that contact.",
      "world: `capxul-devnet whatsapp receive +447700900100 --from +447700900555 --name Sol Hello`, then settling; read: " +
        "`org crm lead list --org acme` lists a lead Sol, `mobile_no: +447700900555`, `source: WhatsApp`, whose timeline " +
        "shows the message; Kim's message of the world is on Kim's timeline.",
    ),
    claim(
      "Only a member whose Safe wears the People hat sends.",
      "cli: Rex's `org crm whatsapp send <Kim> --text Hi --org acme --confirm` is ROLE_PERMISSION_DENIED and the stand-in " +
        "holds nothing new; " + HAT_FOLLOWS,
    ),
  ],
  returns: WhatsAppItem,
  errors: [error_CLI_USAGE],
  refusals: [
    signedOut(TALK_WORLD),
    deniedPreview(TALK_WORLD, "sends from Acme's number"),
    invalid(
      TALK_WORLD,
      "A record none of Acme's CRM's; no `--to` for a record with no number (Globex Ltd); both `--text` and `--template`, " +
        "or neither; a text over 4,096 characters; a number not in E.164: nothing is sent or written.",
    ),
    wrongIn(TALK_WORLD, "A text to Ivy, who never wrote to Acme's number, is outside the 24-hour window: nothing is sent. (In org-with-crm no number is connected, the same code.)"),
    {
      error: error_PROVIDER_ERROR,
      given: TALK_WORLD,
      when: "With `capxul-devnet fault whatsapp down` armed, the send fails: nothing is written.",
    },
    cancelled(TALK_WORLD, "a message to Kim"),
    noConfirm(TALK_WORLD),
  ],
  budget: budget("vendor"),
});

// ── org crm note add, change ────────────────────────────────────────────────────────────────

export const operation_org_crm_note_add = defineOperation({
  id: "org.crm.note.add",
  title: "Add a note on a contact, lead or deal",
  about:
    "Adds a note on one record of the Organization's CRM, a contact, a lead or a deal, named by its id: its title, " +
    "which a note needs, as the second argument, and its text with `--content`. It shows on the record's timeline. A " +
    "converted lead takes no new note: write on its deal.",
  area: CRM_AREA,
  command: "org crm note add",
  priority: "normal",
  implementedBy: flow_client_org_crm_notes_add,
  who: WHO_CRM_WRITE_OP,
  changes: "One note, on the record's timeline and the CRM's change log.",
  acceptance: [
    claim(
      "A note is added on a record and its timeline shows it first.",
      "cli: in org-with-crm, `org crm note add <the Globex pilot> Budget --content \"5000 GBP approved.\" --org " +
        "acme` prints a `note_` id, that title and content and `by` Dan's Party; read: `org crm timeline <the Globex " +
        "pilot>` lists it first.",
    ),
    claim(
      "A note needs a title, and a converted lead takes none.",
      "cli: `org crm note add <the Globex pilot> \"\" --org acme` is INVALID_INPUT naming `title`; `org crm note " +
        "add <Ivy's lead> X --org acme` is WRONG_STATE naming the Umbrella deal; world: each diff is empty.",
    ),
    claim(
      "Only a member whose Safe wears the People hat adds one.",
      "cli: Rex's `org crm note add <the Globex pilot> X --org acme` is ROLE_PERMISSION_DENIED; " + HAT_FOLLOWS,
    ),
  ],
  returns: NoteItem,
  errors: [error_CLI_USAGE],
  refusals: [
    signedOut(CRM_WORLD),
    denied(CRM_WORLD, "adds a note in Acme's CRM"),
    invalid(CRM_WORLD, "A record none of Acme's CRM's, a blank or 141-character title, or content over 10,000 characters: nothing is written."),
    wrong(`\`org crm note add <Ivy's lead> X --org acme\`: ${CONVERTED}`),
  ],
  budget: budget("write"),
});

export const operation_org_crm_note_change = defineOperation({
  id: "org.crm.note.change",
  title: "Change a note's title or text",
  about:
    "Changes the title or text of one note, named by its id: what is given replaces what was there, `--clear content` " +
    "empties the text, and the rest stays. The note keeps its place on the timeline. A note is never deleted.",
  area: CRM_AREA,
  command: "org crm note change",
  priority: "normal",
  implementedBy: flow_client_org_crm_notes_change,
  who: WHO_CRM_WRITE_OP,
  changes: "The note's title or text, and its entry in the CRM's change log.",
  acceptance: [
    claim(
      "Only what is given changes, and the note keeps its place on the timeline.",
      "cli: in org-with-conversations, `org crm note change <the Budget note> --content \"5500 GBP approved.\" --org " +
        "acme` prints the new text with its title and `at` as they were and a later `changedAt`; read: `org crm timeline " +
        "<the Globex pilot>` shows it in the same place.",
    ),
    claim(
      "A change that gives nothing is refused.",
      "cli: `org crm note change <the Budget note> --org acme` is INVALID_INPUT; world: the diff is empty.",
    ),
    claim(
      "Only a member whose Safe wears the People hat changes one.",
      "cli: Rex's `org crm note change <the Budget note> --title X --org acme` is ROLE_PERMISSION_DENIED; " + HAT_FOLLOWS,
    ),
  ],
  returns: NoteItem,
  errors: [error_CLI_USAGE],
  refusals: [
    signedOut(TALK_WORLD),
    denied(TALK_WORLD, "changes a note in Acme's CRM"),
    invalid(TALK_WORLD, "A note id none of Acme's, a blank title, or no flag at all: nothing is written."),
  ],
  budget: budget("write"),
});

// ── org crm task create, change, move, list ─────────────────────────────────────────────────

export const operation_org_crm_task_create = defineOperation({
  id: "org.crm.task.create",
  title: "Make a task on a contact, lead or deal",
  about:
    "Makes a task on one record of the Organization's CRM, as Frappe CRM's tasks are: a title, a description, a " +
    "priority (low, medium, high), a start day and a due time (`--due` takes an instant, or a day, meaning its end in " +
    "the Organization's time zone), and the member it is assigned to (`--assigned-to`, an email or an agent's @handle). It " +
    "starts in Backlog, or Todo with `--status todo`. It shows on the record's timeline and in `org crm task list`.",
  area: CRM_AREA,
  command: "org crm task create",
  priority: "normal",
  implementedBy: flow_client_org_crm_tasks_create,
  who: WHO_CRM_WRITE_OP,
  changes: "One task, Backlog or Todo, on the record's timeline and the CRM's change log.",
  acceptance: [
    claim(
      "A task is made on a record in Backlog, and the task list and the record's timeline show it.",
      "cli: in org-with-crm, `org crm task create <the Globex pilot> \"Send the contract\" --assigned-to @rex --due " +
        "2027-01-06 --priority high --org acme` prints a `ctask_` id, `status: Backlog`, `priority: High`, " +
        "`assigned_to` Rex's Party and `due` the end of 6 January 2027 in Acme's time zone; read: `org crm task list " +
        "--org acme` and `org crm timeline <the Globex pilot>` list it; trace: one `crm_task_transitioned` (create).",
    ),
    claim(
      "Its assignee is a member, by email or an agent's @handle.",
      "cli: `--assigned-to ada@example.com` (no Seat in Acme) is INVALID_INPUT naming `assigned_to`; world: the diff is empty.",
    ),
    claim(
      "Only a member whose Safe wears the People hat makes one.",
      "cli: Rex's `org crm task create <the Globex pilot> X --org acme` is ROLE_PERMISSION_DENIED; " + HAT_FOLLOWS,
    ),
  ],
  returns: TaskView,
  errors: [error_CLI_USAGE],
  refusals: [
    signedOut(CRM_WORLD),
    denied(CRM_WORLD, "makes a task in Acme's CRM"),
    invalid(
      CRM_WORLD,
      "A record none of Acme's CRM's; a blank or 141-character title; a `--due` that is no instant or day; an `--assigned-to` " +
        "with no Seat in Acme; a `--status` other than backlog or todo: the refusal names the field, and nothing is written.",
    ),
    wrong(`\`org crm task create <Ivy's lead> X --org acme\`: ${CONVERTED}`),
  ],
  budget: budget("write"),
});

export const operation_org_crm_task_change = defineOperation({
  id: "org.crm.task.change",
  title: "Change a task's fields",
  about:
    "Changes the fields of one task, named by its id: `--title` (which create takes as its argument) and create's " +
    "other flags each replace the stored value, `--clear` empties one, and the rest stay. Its status moves only with " +
    "`org crm task move`.",
  area: CRM_AREA,
  command: "org crm task change",
  priority: "normal",
  implementedBy: flow_client_org_crm_tasks_change,
  who: WHO_CRM_WRITE_OP,
  changes: "The task's fields, and its entry in the CRM's change log.",
  acceptance: [
    claim(
      "Only the fields given change, and its status stays.",
      "cli: in org-with-conversations, `org crm task change <Send the contract> --due 2027-01-13 --clear description " +
        "--org acme` prints the new `due`, `description: null` and `status: Backlog`, the rest as it was.",
    ),
    claim(
      "A change that gives nothing is refused.",
      "cli: `org crm task change <Send the contract> --org acme` is INVALID_INPUT; world: the diff is empty.",
    ),
    claim(
      "Its assignee moves it but does not change it: only the People hat changes a task.",
      "cli: Rex's `org crm task change <Send the contract> --priority low --org acme` is ROLE_PERMISSION_DENIED; " + HAT_FOLLOWS,
    ),
  ],
  returns: TaskView,
  errors: [error_CLI_USAGE],
  refusals: [
    signedOut(TALK_WORLD),
    denied(TALK_WORLD, "changes a task in Acme's CRM"),
    invalid(TALK_WORLD, "A task id none of Acme's, a bad value as for `org crm task create`, or no flag at all: nothing is written."),
  ],
  budget: budget("write"),
});

export const operation_org_crm_task_move = defineOperation({
  id: "org.crm.task.move",
  title: "Move a task to another status",
  about:
    "Moves one task to one of Frappe CRM's task statuses: Backlog, Todo, In Progress, Done or Canceled. Done records " +
    "when. Any status may follow any, as on Frappe CRM's task board. The member a task is assigned to may move it " +
    "themselves.",
  area: CRM_AREA,
  command: "org crm task move",
  priority: "normal",
  implementedBy: rpc_contacts_tasks_move,
  who:
    "A member of the Organization whose Safe wears its People hat when the command runs, or the task's assignee for " +
    "their own task, a person's Seat or an agent's (contacts.task-assignee).",
  changes: "The task's status, and its entry in the CRM's change log.",
  acceptance: [
    claim(
      "A task moves through CRM Task's statuses, and Done records when, on the world's clock.",
      "cli: in org-with-conversations, `org crm task move <Send the contract> \"In Progress\" --org acme` prints " +
        "`status: In Progress`; `move <it> Done` prints `completedAt` the devnet clock's now; `move <it> Todo` prints " +
        "it open again; trace: `crm_task_transitioned` start, complete and reopen.",
    ),
    claim(
      "Its assignee moves their own task without the People hat, and no one else's.",
      "cli: as Rex (no hat), `org crm task move <Send the contract> \"In Progress\" --org acme` succeeds; after Dan's " +
        "`org crm task create <Kim> Call --assigned-to dan@acme.test --org acme`, Rex's move of that task is " +
        "ROLE_PERMISSION_DENIED; world: that refusal's diff is empty.",
    ),
    claim(
      "The same status again changes nothing.",
      "cli: `org crm task move <Send the contract> \"In Progress\" --org acme` twice prints the same task and `updatedAt`; " +
        "trace: one `crm_task_transitioned` (start), not two; a move within one stage (Backlog to Todo) sends none.",
    ),
  ],
  returns: TaskView,
  errors: [error_CLI_USAGE],
  refusals: [
    signedOut(TALK_WORLD),
    {
      error: error_ROLE_PERMISSION_DENIED,
      given: TALK_WORLD,
      when:
        "Ada, signed in, names Acme with `--org`, where she holds no Seat; or Rex, with no People hat, moves a task " +
        "assigned to someone else: nothing is written.",
    },
    invalid(TALK_WORLD, "A task id none of Acme's, or a status that is none of CRM Task's five: nothing is written."),
  ],
  budget: budget("write"),
});

export const operation_org_crm_task_list = defineOperation({
  id: "org.crm.task.list",
  title: "List the Organization's CRM tasks",
  about:
    "Lists the CRM's tasks, as Frappe CRM's Tasks page does: those not done or cancelled, soonest due first, tasks " +
    "with no due time after. `--stage` (open, working, done, cancelled) lists others, `--assigned-to` one member's, and " +
    "`--record` one record's; filters apply together.",
  area: CRM_AREA,
  command: "org crm task list",
  priority: "normal",
  implementedBy: rpc_contacts_tasks_list,
  who: WHO_CRM_READ_OP,
  changes: NOTHING_READ,
  notes: PAGE_NOTES,
  acceptance: [
    claim(
      "Every member lists the CRM's open and working tasks, soonest due first.",
      "read: as Rex in org-with-conversations, `org crm task list --org acme` prints `Send the contract` with its record, " +
        "status and due time; after `org crm task move <it> Done`, it is listed only with `--stage done`.",
    ),
    claim(
      "Filters apply together.",
      "read: `org crm task list --assigned-to @rex --record <the Globex pilot> --org acme` prints `Send the contract`, and " +
        "`--assigned-to dan@acme.test` prints none.",
    ),
  ],
  returns: rpc_contacts_tasks_list.output,
  errors: [error_CLI_USAGE],
  refusals: [
    signedOut(TALK_WORLD),
    outsider(TALK_WORLD),
    invalid(TALK_WORLD, "A cursor this list did not give, a `--limit` outside 1 to 100, or an `--assigned-to` or `--record` not in Acme's CRM: nothing is listed."),
  ],
  budget: budget("read"),
});

// ── org crm call log ────────────────────────────────────────────────────────────────────────

export const operation_org_crm_call_log = defineOperation({
  id: "org.crm.call.log",
  title: "Log a call with a contact, lead or deal",
  about:
    "Logs a call you made or took about one record, as Frappe CRM's call log does: its direction (`--type incoming` " +
    "or `outgoing`), its outcome (`--status completed`, `no-answer`, `busy`, `failed` or `canceled`), the other " +
    "party's number (the record's own when not given), how long it took (`--duration` in seconds, or `--end`) and when " +
    "it started (with no `--start`, it ended just now), with an optional `--note`. A call is over when it is logged, " +
    "so it ends no later than now. It shows on the record's timeline when it is logged.",
  area: CRM_AREA,
  command: "org crm call log",
  priority: "normal",
  implementedBy: rpc_contacts_calls_log,
  who: WHO_CRM_WRITE_OP,
  changes: "One call log and its note, on the record's timeline and the CRM's change log.",
  acceptance: [
    claim(
      "A call is logged on a record with its note, and the record's timeline shows it.",
      "cli: in org-with-conversations, `org crm call log <Kim> --type outgoing --status completed --duration 300 --note " +
        "\"Talked about the start date.\" --org acme` prints a `call_` id, `type: Outgoing`, `status: Completed`, " +
        "`counterpart: +447700900789`, `member` Dan's Party, `duration: 300` and `note` a `note_` id; read: `org crm " +
        "timeline <Kim>` lists the call and its note.",
    ),
    claim(
      "A call is over when it is logged: it ends no later than the world's now, and takes a duration or an end, not both.",
      "cli: with no `--start`, `--duration 300` prints `end` the devnet clock's now and `start` 300 seconds before; " +
        "`--start 2099-01-01T00:00:00Z` is INVALID_INPUT naming `start`, a `--start` 60 seconds ago with `--duration " +
        "600` INVALID_INPUT naming `duration`, and `--duration 60 --end <a time>` INVALID_INPUT; world: each refusal's " +
        "diff is empty.",
    ),
    claim(
      "Only a member whose Safe wears the People hat logs one.",
      "cli: Rex's `org crm call log <Kim> --type incoming --status no-answer --org acme` is ROLE_PERMISSION_DENIED; " + HAT_FOLLOWS,
    ),
  ],
  returns: CallItem,
  errors: [error_CLI_USAGE],
  refusals: [
    signedOut(TALK_WORLD),
    denied(TALK_WORLD, "logs a call in Acme's CRM"),
    invalid(
      TALK_WORLD,
      "A record none of Acme's CRM's; a start or an end after the world's now; both `--duration` and `--end`; a " +
        "duration over a day or below 0; a number not in E.164: the refusal names the field, and nothing is written.",
    ),
    wrongIn(TALK_WORLD, `\`org crm call log <Ivy's lead> --type outgoing --status busy --org acme\`: ${CONVERTED}`),
  ],
  budget: budget("write"),
});
