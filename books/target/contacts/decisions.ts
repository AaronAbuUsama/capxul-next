// Every judgment the contacts design makes, as a decision record. Made by Claude on 8 November 2026
// under A1-A4 and P1-P10, with the old code (/home/user/factory, integration/factory: old parties'
// contacts area and the CLI's contact commands) and the frozen book as evidence.

import { defineDecision } from "../../../packages/book/src/index.ts";
import { concept_contacts, concept_parties } from "../shared/foundation.ts";
import { table_org_deployments, table_org_members } from "../organizations/data.ts";
import { table_parties } from "../parties/data.ts";
import { procedure_parties_resolve_recipient } from "../parties/procedures.ts";
import {
  event_contact_transitioned,
  machine_contact,
  table_contact_changes,
  table_contacts,
  table_crm_settings,
} from "./data.ts";
import { integration_mail, integration_whatsapp } from "../shared/external.ts";
import { table_chain_payments, table_escrows } from "../indexing/data.ts";
import {
  rpc_contacts_book_add,
  rpc_contacts_book_get,
  rpc_contacts_book_hide,
  rpc_contacts_book_label,
  rpc_contacts_book_list,
  rpc_contacts_book_record,
  rpc_contacts_book_unhide,
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
  operation_contact_add,
  operation_contact_change,
  operation_contact_create,
  operation_contact_hide,
  operation_contact_label,
  operation_contact_link,
  operation_contact_list,
  operation_contact_unhide,
} from "./operations.ts";

const CLAUDE = "Claude, contacts design, 8 November 2026";
const by = (evidence: string) => `${CLAUDE}; evidence: ${evidence}`;
const FRAPPE_CRM = "Claude, contacts Frappe redesign (crm lane), 8 November 2026";
const crmBy = (evidence: string) => `${FRAPPE_CRM}; evidence: ${evidence}`;
const P = "packages/backend/src/parties";
/** Frappe's sources, read on 8 November 2026. */
const CRM = "frappe/crm@2cecd300 crm";

const OPERATIONS = [
  operation_contact_add, operation_contact_hide, operation_contact_label, operation_contact_list, operation_contact_unhide,
];
const WRITES = [rpc_contacts_book_add, rpc_contacts_book_label, rpc_contacts_book_hide, rpc_contacts_book_unhide];
const READS = [rpc_contacts_book_list, rpc_contacts_book_get];
const FLOWS = [
  flow_client_account_address_book_label, flow_client_account_address_book_hide, flow_client_account_address_book_unhide,
];
const LEAD_RPCS: never[] = [
  
];
const DEAL_RPCS: never[] = [];
const CRM_RPCS = [rpc_contacts_book_record, ...LEAD_RPCS, ...DEAL_RPCS];
const CRM_WRITES = [
  rpc_contacts_book_record, 
  
];
const BOOK_FLOWS = [
  flow_client_account_address_book_create, flow_client_account_address_book_change, flow_client_account_address_book_link,
];
const LEAD_FLOWS: never[] = [
  
  
];
const DEAL_FLOWS: never[] = [
  
  
];
const CRM_FLOWS = [...BOOK_FLOWS, ...LEAD_FLOWS, ...DEAL_FLOWS];
/** The CRM's fourteen commands, operations beyond the 215 (rules.new-operations, contacts.crm-capabilities). */
const BOOK_OPS = [operation_contact_create, operation_contact_change, operation_contact_link];
const LEAD_OPS: never[] = [
  
  
];
const DEAL_OPS: never[] = [
  
];
const CRM_OPERATIONS = [...BOOK_OPS, ...LEAD_OPS, ...DEAL_OPS];
/** The commands an Organization's start-up and its first sale need (contacts.critical-commands). */
const CRITICAL = [
  operation_contact_create, 
  
];

// ── data ────────────────────────────────────────────────────────────────────────────────────

export const decision_contacts_one_book_table = defineDecision({
  id: "contacts.one-book-table",
  title: "One contacts table per owner, an entry per Party, its id the PartyId",
  question: "How is the address book stored, now that it leaves old parties' party edges?",
  options: [
    {
      label: "owner-table",
      text:
        "One `contacts` table with tenancy `owner` (`owner_kind` person or organization, `owner_id` their tenant id), one row " +
        "per owner and entry, keyed by the entry's `contact_id`, which is the PartyId for an entry born from a Party; at " +
        "most one entry per Party in a book (`contacts-by-party`, unique).",
    },
    { label: "two-tables", text: "A person's book and an Organization's book in two tables, each with its own tenant column." },
    {
      label: "party-edges",
      text: "Keep old parties' `partyEdges`: directed edges between the owner's Party and the counterparty's, of kind contact or employed.",
    },
  ],
  chosen: "owner-table",
  why:
    "Every frozen contact command runs the same way for both books, so one table and one set of rpcs serve them, with the " +
    "`owner` tenancy P8 gives a row a person or an Organization can own. Keying by the tenant ids, not by the owner's Party, " +
    "lets the generated row-level security match the session's tenant directly. 'Every locator lands on one party-keyed " +
    "entry' is the unique `contacts-by-party` index, and every entry the frozen commands make is born from a Party, so its " +
    "id is its PartyId, as `contact add` prints. The key is the entry's own id rather than the PartyId because the book is " +
    "also an Organization's CRM, which keeps people and companies before they have a Party (contacts.private-entries). " +
    "The old edge table also held payroll's `employed` engagements and the provenance other concepts wrote; both go " +
    "(contacts.relationships). `owner_id` leads the key and the indexes with `owner_kind` second, so the two kinds' ids " +
    "never need to differ.",
  source: by(`${P}/tables.ts:153 (partyEdges, contact and employed kinds); ${P}/contacts/reads.ts:140; P8`),
  affects: [table_contacts, concept_contacts],
});

export const decision_contacts_relationships = defineDecision({
  id: "contacts.relationships",
  title: "Relationships are `manual` and `member`; last activity is the last change",
  question:
    "The old book merged how you know a counterparty from edges other concepts wrote: paid, paidBy, invoiced, invoicedBy, " +
    "member, manual and employed. Which can the target keep?",
  options: [
    {
      label: "manual-member",
      text:
        "Keep `manual` (added by hand, contacts' own) and `member` (an active Seat, read from organizations, which contacts " +
        "depends on). Drop the rest; `lastActivityAt` is the entry's last change.",
    },
    {
      label: "react-up",
      text:
        "Keep them all: contacts reacts to payments', requests' and payroll's transitions through the outbox and records " +
        "the provenance.",
    },
    {
      label: "procedures",
      text: "Keep them all: payments, requests and payroll invoke a contacts procedure in their own transactions, as old parties' `recordContactEdges` was.",
    },
  ],
  chosen: "manual-member",
  why:
    "The concept map puts contacts below payments, payroll and requests, so contacts may neither read them nor react to " +
    "their transitions (the reacting concept depends on the one that changed), and making it depend on requests would be " +
    "a cycle (requests depends on banking, which depends on contacts). They cannot write the book either: none of them " +
    "depends on contacts, and a relationship is a projection that may lag, never a money fact, so rules.procedures forbids " +
    "a procedure. No frozen acceptance line needs the dropped values: the frozen text names a `relationship` field and " +
    "says 'how you know them', and `manual` and `member` keep that meaning, so the shape is kept and its values narrowed " +
    "(a reader of the old values never sees a new one). Where someone was paid or invoiced is activity's feed. Last " +
    "activity was the last payment or invoice with them; it becomes the entry's own last change, or its member's Seat's.",
  source: by(`${P}/writes/edges.ts:26 and :125 (ensureEmployedEdge, recordContactEdges); packages/protocol/src/parties/schema.ts:43`),
  affects: [
    table_contacts, rpc_contacts_book_list, rpc_contacts_book_get, operation_contact_list, operation_contact_add,
    concept_contacts,
  ],
});

export const decision_contacts_members_derived = defineDecision({
  id: "contacts.members-derived",
  title: "An Organization's members are read from its Seats when the book is read",
  question: "How does an Organization's book show its members?",
  options: [
    {
      label: "read-time",
      text: "Each read joins the Organization's active Seats (organizations' `org-members`) to its rows, by PartyId.",
    },
    {
      label: "projection",
      text: "A contacts workflow triggered by `org_member_transitioned` copies each Seat into `contacts` as a member row.",
    },
  ],
  chosen: "read-time",
  why:
    "The Seat is the one record of membership and contacts depends on organizations, so reading it keeps one source and " +
    "no lag: when a Seat ends, the member relationship is gone on the next read, which is what `contact list` #2 claims. " +
    "A projection would be a second copy that can drift and a workflow whose only job is copying (P3). The read stays on " +
    "indexes: the book's own index and the `org_id` range of the Seats' `by_org_party`. A row is written for a member only " +
    "when the book curates it (a label or hide), and it keeps that curation if the member leaves and returns; an entry " +
    "is in the book while it is `manual` or `member`. The member's label falls back to the Party's name, never the " +
    "invitation's mailbox, which the old book showed.",
  source: by(`${P}/contacts/reads.ts:73 (accumulateMembers from orgMembers); ${P}/contacts/tests/list.test.ts:54`),
  affects: [table_org_members, table_contacts, rpc_contacts_book_list, rpc_contacts_book_get, operation_contact_list],
});

export const decision_contacts_visibility_machine = defineDecision({
  id: "contacts.visibility-machine",
  title: "Hidden or listed is the `contact` machine, with one event",
  question: "Is hiding an entry a status with named transitions, or a plain boolean?",
  options: [
    {
      label: "machine",
      text:
        "A `contact` machine on `contacts.visibility`: listed and hidden, with `hide`, `unhide` and `add_again`, each " +
        "sending `contact_transitioned`.",
    },
    { label: "boolean", text: "Keep a `hidden` boolean that hide, unhide and add set, as the old edge did." },
  ],
  chosen: "machine",
  why:
    "P7: every write to a status is a named transition, and a machine sends one event. Hidden is a status: two verbs and " +
    "contact add change it, and the old system already told its funnel about each change (`contact_relationship_changed`, " +
    "now gone with its emitter). `add_again` is separate from `unhide` because a different command takes it: adding a " +
    "hidden contact by hand lists it again, as the old add did and as `contact add`'s `hidden: false` says. Hiding a " +
    "hidden entry or unhiding a listed one is no transition and returns the entry as it is (`contact unhide` #2). Label " +
    "changes are not a status, so they send nothing. The event carries the book and the entry's id, never a label or mailbox.",
  source: by(`${P}/contacts/operations/add.ts:21; ${P}/contacts/rules.ts:43; ${P}/contacts/events.ts:66; P7`),
  affects: [machine_contact, event_contact_transitioned, rpc_contacts_book_hide, rpc_contacts_book_unhide, rpc_contacts_book_add],
});

export const decision_contacts_ref_and_label = defineDecision({
  id: "contacts.ref-and-label",
  title: "An entry's ref is its party locator; its label the owner's words or a name",
  question: "What does an entry show as `ref` and `label`, and what are a label's rules?",
  options: [
    {
      label: "party-ref",
      text:
        "`ref` is `{kind: party, partyId}` for every entry with a Party (null on a private one). `label` is the owner's " +
        "label, or the primary mailbox they typed (kept in the entry's `email_ids` when they added by email), else the " +
        "Party's display name, handle, then the entry's id. A given label is trimmed and must be 1 to 120 characters.",
    },
    { label: "typed-ref", text: "`ref` is the locator the owner typed (handle, email, address or party)." },
  ],
  chosen: "party-ref",
  why:
    "A party ref is what the money path takes and carries no custody detail; a typed address ref would print a 0x address " +
    "(`contact add` #1 forbids custody evidence on the wire, which the old test checks as no 0x address), and a typed " +
    "email ref would show a mailbox for every locator after a second add by another one. The old code returned the party " +
    "ref too. The label never falls back to a mailbox or an address: a PartyId is public (any address resolves to one), " +
    "so a mailbox fallback would turn an address into an email in two calls (`contact add` #3). An explicit empty label " +
    "on add is INVALID_INPUT, as the frozen refusal says ('the label is empty'); the old code read it as no label. That is " +
    "surface, so the book wins (P10 rung 1). The typed mailbox moved from the label to `email_ids`, Frappe Contact's own " +
    "list of mailboxes, so a label is only ever the owner's own words; it is still shown before the Party's name, so an " +
    "entry added by email with no label shows the mailbox typed, as before.",
  source: by(`${P}/contacts/rules.ts:26 and :36; ${P}/rules.ts:19; ${P}/contacts/tests/add.test.ts:25 and :147`),
  affects: [table_contacts, rpc_contacts_book_add, rpc_contacts_book_label, operation_contact_add, operation_contact_list],
});

// ── behaviour ───────────────────────────────────────────────────────────────────────────────

export const decision_contacts_resolve_in_add = defineDecision({
  id: "contacts.resolve-in-add",
  title: "contact add resolves its Party in its own transaction, through parties' door",
  question: "Adding a mailbox or an address nobody has named yet needs a Party first. Who makes it, and when?",
  options: [
    {
      label: "procedure",
      text: "`contacts.book.add` invokes `parties.resolve-recipient` in its transaction, then writes the entry; `contact add` stays one rpc.",
    },
    {
      label: "flow",
      text: "A Core SDK flow calls a parties rpc that names the Party, then `contacts.book.add` with its PartyId.",
    },
  ],
  chosen: "procedure",
  why:
    "Parties' door already has the procedure for this, and names a contact among its users: its money fact is that the " +
    "first record naming a counterparty binds it to the Safe its money routes to, so every later naming, the person's " +
    "claim and the chain views agree. Invoking it keeps `contact add` one rpc (A4) and one transaction, so a refusal " +
    "after resolution (your own Party) commits nothing, a newly named Party included: 'refused before any write' holds. " +
    "The flow would leave a named Party behind a refused add and need an rpc parties does not offer. The label is checked " +
    "before the procedure runs. One procedure from one other concept is within sys:tx-width.",
  source: by(`books/target/parties/procedures.ts (parties.resolve-recipient); ${P}/contacts/writes.ts:29 (pairByLocator)`),
  affects: [procedure_parties_resolve_recipient, rpc_contacts_book_add, operation_contact_add],
});

export const decision_contacts_guided_flows = defineDecision({
  id: "contacts.guided-flows",
  title: "get, label, hide and unhide are Core SDK flows; add and list are one rpc",
  question: "Which contact commands are one rpc and which compose several calls?",
  options: [
    {
      label: "guided-flows",
      text:
        "The commands that pick an entry and show it before acting at a terminal are flows (list, prompt, get, prompt, " +
        "write); add and list are one rpc each.",
    },
    { label: "cli-composes", text: "Every command is one rpc and the CLI reads the book and the entry itself, as the old CLI did." },
  ],
  chosen: "guided-flows",
  why:
    "A4: the CLI calls exactly one SDK method. At a terminal, label, hide and unhide read the entry for their preview " +
    "before the one write, and get, label, hide and unhide may pick from the book: that composition belongs in the SDK, " +
    "with its questions as prompt steps the host answers (a terminal, or none for a script). Given a PartyId and " +
    "`--confirm`, each flow is one call, so 'an explicit get never lists or prompts'. Add's preview shows only what was " +
    "typed and needs no read, so the CLI shows it before calling one rpc; list pages on the server. The old CLI made two " +
    "or three SDK calls per guided command.",
  source: by("apps/cli/src/commands/contact/internal/write.ts:26; contact/subcommands/get/execute.ts:21; A4"),
  affects: [...FLOWS, ...OPERATIONS],
});

export const decision_contacts_not_in_book_code = defineDecision({
  id: "contacts.not-in-book-code",
  title: "A Party outside the book is INVALID_INPUT at a terminal too",
  question: "label, hide and unhide of a Party not in the book: which code, in a script and at a terminal?",
  options: [
    { label: "invalid-input", text: "INVALID_INPUT in both modes, from the rpc or from the flow's preview read." },
    { label: "as-is", text: "CLI_USAGE at a terminal (the old CLI's own check after its preview read), INVALID_INPUT from a script." },
  ],
  chosen: "invalid-input",
  why:
    "The frozen refusals of all three say INVALID_INPUT when 'the party is not in the book', and `contact unhide` #1 says " +
    "they refuse it, with no mode. Refusal codes are surface, so the book wins (P10 rung 1); the old CLI's terminal-only " +
    "CLI_USAGE was a reviewer's finding, not a design. CLI_USAGE stays for what the CLI checks itself: a malformed id " +
    "(neither a PartyId nor a private entry's `contact_` id, which `contact list` now shows too), a missing ID or " +
    "`--confirm` in a script, an empty `--label`.",
  source: by("apps/cli/src/commands/contact/internal/write.ts:40; docs/as-is/lane-reports/review-agent.json"),
  affects: [flow_client_account_address_book_label, flow_client_account_address_book_hide, flow_client_account_address_book_unhide, operation_contact_unhide],
});

export const decision_contacts_members_write = defineDecision({
  id: "contacts.members-write",
  title: "Only the People hat edits an Organization's book; every member reads it",
  question: "Who may add, label, hide and unhide in an Organization's book?",
  options: [
    { label: "member", text: "Any active Seat, as the frozen `who` says ('a member of the Organization for its book')." },
    {
      label: "people-hat",
      text:
        "Only a member whose Safe wears the Organization's People hat (old managePeople, as old parties' `requireWriter` " +
        "checked); every member may read the book. A member without it is ROLE_PERMISSION_DENIED, nothing written.",
    },
    {
      label: "contacts-permission",
      text: "A new Capxul-side contacts permission on the Seat, granted and taken back by the People hat's wearer.",
    },
  ],
  chosen: "people-hat",
  why:
    "Aaron's ruling (aaron.contacts-permissions, 8 November 2026): 'there should be permissions for editing the contact " +
    "book. It shouldn't just be anyone can do anything.' This record had chosen `member`; it now follows the ruling. The " +
    "People hat is the permission: authority in an Organization is hats (P9), the People hat already decides who may " +
    "invite and manage members, the old code checked exactly it (`requireWriter`), and the founder wears it from setup, " +
    "so no new grant, command or table is needed; a separate permission would be a second authority system beside the " +
    "hats. Behaviour kept: an outsider is still ROLE_PERMISSION_DENIED, and every frozen claim's world still holds (in " +
    "`person-with-contacts` Dan, Acme's founder, writes its book); the frozen `who` is rewritten (a spelling of who, P10 " +
    "rung 1), and the designed refusal 'You cannot write to that book' now has its case: Rex, Acme's agent, holds a Seat " +
    "and no hat. The map needed one edge: whether a Safe wears a hat is indexing's, so contacts depends on indexing " +
    "(shared/foundation.ts, dependencies.of-contacts), and every write reads the hat's id from organizations' " +
    "deployment and its wearers from indexing's `hat-wearers`.",
  source: by(`${P}/guards.ts:41 (requireWriter, requireManager); books/target/shared/rulings.ts (aaron.contacts-permissions); contact.add.yaml (designed refusals)`),
  affects: [...WRITES, ...OPERATIONS.filter((o) => o !== operation_contact_list), concept_contacts],
});

export const decision_contacts_get_bank_accounts = defineDecision({
  id: "contacts.get-bank-accounts",
  title: "contact get's bank accounts are banking's: the operation belongs with banking",
  question:
    "`contact get` returns the bank accounts saved for the contact, which banking owns, and contacts sits below banking. " +
    "How does the operation get them?",
  options: [
    {
      label: "owner-banking",
      text:
        "Move `contact.get` to banking in OPERATION_OWNERS, as `contact.bank.add` already is: banking's flow calls " +
        "`contacts.book.get` (banking depends on contacts) and then its own masked account list for that Party.",
    },
    { label: "flow-up", text: "Contacts' flow calls banking's rpc: contacts would depend on banking, a cycle (rule 8)." },
    { label: "read-up", text: "`contacts.book.get` reads banking's table: a read-boundary problem the build refuses." },
    { label: "drop", text: "Return no bank accounts: the frozen `returns` loses `bankAccounts` (P10 rung 1)." },
  ],
  chosen: "owner-banking",
  why:
    "Only a concept above both can compose the entry and the accounts, and banking is the one above contacts that owns " +
    "the accounts; the frozen command already lives beside `contact bank add` there in spirit (it prints `bank pay`). " +
    "The other options break the concept map, the build or the frozen surface. The architecture review made the move " +
    "(shared operations.contact-get-in-banking), so contacts no longer books the operation or its flow (contacts.get-moved); " +
    "`contacts.book.list` and `contacts.book.get` stay for banking's flow to step through.",
  source: by("apps/cli/src/commands/contact/subcommands/get/execute.ts:50 (a second call, bankAccounts.list); OPERATION_OWNERS"),
  affects: [rpc_contacts_book_get, rpc_contacts_book_list, concept_contacts],
});

export const decision_contacts_server_pages = defineDecision({
  id: "contacts.server-pages",
  title: "The server pages the book with a keyset cursor",
  question: "How is `contact list --limit --after` served?",
  options: [
    {
      label: "server-keyset",
      text:
        "`contacts.book.list` takes `limit` (1 to 100, default 25) and `after`, an opaque cursor over (last change, PartyId) " +
        "bound to the book, and returns `nextCursor`.",
    },
    { label: "client-cut", text: "Return the whole book and let the CLI cut the page, as the old row and CLI did." },
  ],
  chosen: "server-keyset",
  why:
    "The frozen notes promise 25 at a time and a cursor; reading the whole book on every page grows with the book, and " +
    "P5's read budget is per call. A keyset over the book's own index answers any page in the same time. The CLI still " +
    "refuses a `--limit` out of range or a malformed `--after` with CLI_USAGE before calling, as the old CLI did; a cursor " +
    "that decodes but names another book is the rpc's INVALID_INPUT.",
  source: by("apps/cli/src/runtime/paging.ts:82; packages/backend/src/parties/contacts/operations/list.ts:21 (onePage)"),
  affects: [rpc_contacts_book_list, operation_contact_list, table_contacts],
});

export const decision_contacts_acceptance_rewrites = defineDecision({
  id: "contacts.acceptance-rewrites",
  title: "One claim rewritten: contact list #1",
  question: "Which of contacts' 19 frozen acceptance lines name a mechanism a black box cannot see?",
  options: [
    {
      label: "one",
      text:
        "Only `contact list` #1, 'A book read touches no full table scan.', rewritten as: the book lists only its own entries, " +
        "and its read time does not grow with what lies outside it.",
    },
    { label: "none", text: "Keep all 19 verbatim." },
  ],
  chosen: "one",
  why:
    "A table scan is storage: no observer sees one. What its test proved was that seeding many unrelated people does not " +
    "change the answer, and what a scan would cost is time; both are observable (the world and the trace), and the old " +
    "system passes both, since it read by index. The other 18 are outcomes: 'party-keyed' and 'derived' name what the " +
    "output shows (a PartyId, a relationship that goes with the Seat), and 'the wire carries no custody evidence' is " +
    "checked on the CLI's output.",
  source: by(`${P}/contacts/tests/list.test.ts:26; P1`),
  affects: [operation_contact_list],
});

export const decision_contacts_no_door_no_process = defineDecision({
  id: "contacts.no-door-no-process",
  title: "Contacts has no procedures, and one process: the head sync",
  question: "Does contacts need a door for other concepts or a durable process?",
  options: [
    {
      label: "none-but-sync",
      text:
        "No procedure: concepts above read `contacts` and call its rpcs from their flows; every change to an entry, lead " +
        "or deal is inside one rpc. One workflow, the CRM's sync with a connected head (contacts.head-sync), because it " +
        "waits on the head for as long as the head is connected.",
    },
    {
      label: "door",
      text: "A `contacts.add-entry` procedure for banking to add a name-only contact inside its bank account save.",
    },
  ],
  chosen: "none-but-sync",
  why:
    "A procedure needs a money fact (P4, rules.procedures); an entry is not one: if a saved bank account's contact entry " +
    "lagged or was missing, no money would move or be owned unaccounted for, since the account belongs to the Party, not " +
    "the entry; a lead or a deal is a forecast. So banking adds a contact through `contacts.book.add` (by the Party's id) " +
    "from its own flow, and reads the table to find one. Entries, leads and deals are changed only inside an rpc and " +
    "wait on nothing (rules.durable-processes), and membership is read, not copied, so nothing reacts to them. The head " +
    "sync is different: it lives as long as the connection and waits on two systems, so it is a process. Old parties' " +
    "`recordContactEdges`, `ensureEmployedEdge` and the `emitRelationshipChanged` telemetry action are not ported (P2, " +
    "P4, P7).",
  source: by(`${P}/contacts/operations/emit-relationship-changed.ts:1; ${P}/accounts/README.md:26 (a new contact needs a name)`),
  affects: [concept_contacts, table_contacts, rpc_contacts_book_add],
});

export const decision_contacts_no_destinations = defineDecision({
  id: "contacts.no-destinations",
  title: "Contacts holds no receiving destinations",
  question: "Where do a contact's wallet and bank destinations live?",
  options: [
    {
      label: "elsewhere",
      text:
        "A contact's wallet is its Party's Safe (parties); its bank accounts are banking's. Old parties' " +
        "`counterpartyDestinations` and `parties.destinations.*` are not ported into contacts.",
    },
    { label: "here", text: "Keep a destinations table of wallets and bank accounts per contact in contacts." },
  ],
  chosen: "elsewhere",
  why:
    "The concept map gives old parties' destinations and resolution to parties and a contact's bank accounts to banking. " +
    "On v4 money to a Party lands in its one Safe (or the outside address itself), so a per-book wallet list would be a " +
    "second, conflicting answer to where money goes. No frozen operation reaches the old destination rows (P2), and the " +
    "old Solana clean-up and its report were one-off plumbing.",
  source: by(`${P}/tables.ts:215 (counterpartyDestinations); ${P}/README.md:3; books/target/shared/foundation.ts (concept_parties, concept_banking)`),
  affects: [concept_contacts, table_contacts],
});

export const decision_contacts_decline_is_cancelled = defineDecision({
  id: "contacts.decline-is-cancelled",
  title: "Declining a terminal preview is CANCELLED",
  question: "What does a contact command end with when the person answers no to its preview?",
  options: [
    { label: "cancelled", text: "CANCELLED (exit 130): the person stopped it and nothing was written." },
    { label: "as-is", text: "CLI_USAGE (exit 2), as the old CLI's `confirmWrite` refused with 'The write was not confirmed.'" },
  ],
  chosen: "cancelled",
  why:
    "The frozen book does not say (P10 rung 5: the old code is evidence, not specification). A decline is a person's " +
    "choice, not a usage mistake, and the shared vocabulary's CANCELLED says exactly what happened: the command stopped " +
    "before it finished and nothing was sent, as a declined approval already ends (vocabulary.drop-signer-rejected). Scripts " +
    "pass `--confirm` and never see the question, so no script's exit code changes. Other concepts' terminal previews " +
    "should end the same way.",
  source: by("apps/cli/src/commands/org/internal/write.ts:57; apps/cli/src/auth/input.ts:11 (inputRequired is CLI_USAGE)"),
  affects: [...FLOWS, operation_contact_add, operation_contact_hide, operation_contact_label, operation_contact_unhide],
});

// ── worlds and budgets ──────────────────────────────────────────────────────────────────────

export const decision_contacts_worlds = defineDecision({
  id: "contacts.worlds",
  title: "One world for every contacts refusal: person-with-contacts",
  question: "Which devnet world reaches each refusal of the contact commands (contacts' five, and banking's `contact get`)?",
  options: [
    {
      label: "person-with-contacts",
      text:
        "Ada, a signed-in person (claimed, mailbox ada@example.com), whose own book holds: Bea, a claimed person added by " +
        "handle with the label `Bea`; vendor@example.com, a provisional person added by email with no label; Cy, hidden; " +
        "two different Parties both labelled `Sam`. Zed is a claimed person in no book of Ada's. Acme is an active " +
        "Organization Ada holds no Seat in, with Seats for Dan (a person) and Rex (an agent Dan owns); Acme's book holds " +
        "Dan added by hand (`manual` and `member`) and Rex as `member` only, and an unknown handle `nobody` names no Party.",
    },
    { label: "per-refusal", text: "A separate world for each code." },
  ],
  chosen: "person-with-contacts",
  why:
    "Every refusal needs only a signed-in person with a book and an Organization outside it: INVALID_INPUT from adding " +
    "Ada herself, `nobody` or a 121-character label, or curating Zed; ROLE_PERMISSION_DENIED from `--org acme` as Ada; " +
    "CLI_USAGE from a script without `--input` or `--confirm`; NOT_AUTHENTICATED from the same world with no session. " +
    "Acme's Seats and book serve `contact list` #2 and #4 from the same snapshot (Dan acting, then Rex removed on chain).",
  source: by("books/frozen/operations.ts (contact.* refusals and acceptance)"),
  affects: OPERATIONS,
});

export const decision_contacts_budgets = defineDecision({
  id: "contacts.budgets",
  title: "Class budgets, and one override for the guided commands",
  question: "Which budget does each contacts record take?",
  options: [
    {
      label: "class-with-guided",
      text:
        "Reads `read`, writes `write`, the CRM's included; the guided get, label, hide, unhide and link (flow and operation) " +
        "allow a second call in sequence: read 800/1,600 ms, write 900/1,900 ms, excluding `wait.person`.",
    },
    { label: "class-only", text: "Class defaults everywhere, the guided path included." },
  ],
  chosen: "class-with-guided",
  why:
    "No contacts rpc calls the chain, the bundler or a vendor, so `read` and `write` fit (P5). At a terminal the guided " +
    "commands make a second call before their one read or write (the picker's list, the preview's read), which the class " +
    "default does not allow for. The person's picking and answering are `wait.person` spans and never system time. A " +
    "script's run of the same flow makes one call and stays well inside the override.",
  source: by("packages/book/src/budgets.ts; P5; P6 (wait.person for prompt steps)"),
  affects: [
    ...FLOWS, operation_contact_label, operation_contact_hide, operation_contact_unhide, ...READS, ...WRITES, ...CRM_RPCS,
    ...CRM_FLOWS, ...CRM_OPERATIONS,
  ],
});

// ── assembly ────────────────────────────────────────────────────────────────────────────────

export const decision_contacts_get_moved = defineDecision({
  id: "contacts.get-moved",
  title: "`contact get` leaves contacts: banking books it over contacts' rpcs",
  question:
    "OPERATION_OWNERS now gives `contact.get` to banking (shared operations.contact-get-in-banking). Contacts still booked " +
    "the operation and its flow `client.account.address-book.get`. What stays in contacts?",
  options: [
    {
      label: "drop-both",
      text:
        "Remove the operation and its flow; keep `contacts.book.list` (the picker) and `contacts.book.get` (the entry, or " +
        "null) as the rpcs banking's flow steps through before its own masked accounts.",
    },
    { label: "keep-flow", text: "Remove the operation, keep the flow for the SDK's address book." },
    { label: "keep-both", text: "Keep both until banking books its own." },
  ],
  chosen: "drop-both",
  why:
    "A4 gives the operation one SDK flow, and banking's flow is that flow: it alone can add `bankAccounts`. A second " +
    "contacts flow for the same SDK method would be a duplicate record or a second answer to one call, and keeping the " +
    "operation would book it twice. Both rpcs stay reached: label, hide and unhide step through them for their " +
    "picker and preview. The removed acceptance observations (null outside the book, exit 0; the owner reads their " +
    "entry back and `--org` without a Seat is ROLE_PERMISSION_DENIED; a get given a PartyId is one `contacts.book.get` " +
    "call with no list or `wait.person`) and the guided-get budget (p95 1,600 ms) pass to banking's record.",
  source: by("books/target/shared/foundation.ts (OPERATION_OWNERS contact.get); shared operations.contact-get-in-banking; A4; contact.get.yaml"),
  affects: [rpc_contacts_book_get, rpc_contacts_book_list, concept_contacts],
});

// ── the CRM in Frappe CRM's shapes (the crm lane, 8 November 2026) ───────────────────────────

export const decision_contacts_frappe_shape = defineDecision({
  id: "contacts.frappe-shape",
  title: "Each Organization's CRM is Frappe CRM's doctypes, one table each",
  question:
    "Every Organization starts with a CRM, in Frappe CRM's shape, complete without a Frappe head and synced with one " +
    "once it is connected. Frappe CRM keeps a person as a Contact (with Contact Email and Contact Phone rows), a company " +
    "as a CRM Organization, a prospect as a CRM Lead, and a sale as a CRM Deal with its people in CRM Contacts. How does " +
    "the contact book hold them?",
  options: [
    {
      label: "doctype-tables",
      text:
        "One table per doctype, under Frappe's field names: `contacts` holds Contact and CRM Organization entries (a " +
        "`doctype` column, since the frozen commands list, hide and label both alike), `leads` holds CRM Lead, `deals` " +
        "CRM Deal and `deal-contacts` CRM Contacts. Each entry names its Party, the identity the global directory holds; " +
        "everything the business knows about it (its mailboxes, numbers, title, company, website, industry, territory, " +
        "size, revenue) stays in the owner's book. Statuses and lost reasons take Frappe CRM's install defaults; sources, " +
        "industries and territories are free names (contacts.crm-statuses).",
    },
    {
      label: "address-book-only",
      text:
        "Keep the address book as it was (a label and visibility per Party) and leave leads, deals and the business's " +
        "fields to the Frappe head.",
    },
    {
      label: "own-shape",
      text: "A CRM in Capxul's own shape (a contact with free-form notes, an opportunity with its own stages), mapped to Frappe at the head.",
    },
  ],
  chosen: "doctype-tables",
  why:
    "The CRM is one of the two apps every Organization starts with, and its data lives in Frappe's shapes from the first " +
    "day whether or not a head is connected, so the address book alone is not enough: an Organization with no head would " +
    "have no leads or deals. Taking the doctypes table for table, field for field, makes a head's sync a mapping of names " +
    "and ids, never a transformation that could lose what one side holds, and makes Frappe's own rules the book's: a lead " +
    "needs a name, a company or a mailbox; a lost status needs a reason; a won deal records when; one primary contact. " +
    "Contact and CRM Organization share a table because the frozen commands treat every entry alike (one list, one id " +
    "space, one hidden state), as Frappe CRM itself lists both beside each other; the rest are separate, as in Frappe. " +
    "The two layers keep core check C14 fitting (the directory leaks nothing a CRM keeps private) and settle C15 (the " +
    "address book extends to a CRM): the private half is here, the identity there. Only what the CRM needs on its own was " +
    "taken: SLAs, communication status, products, enrichment and social links are left to the head, which can add them " +
    "as its own fields.",
  source: crmBy(`${CRM}/fcrm/doctype/crm_lead|crm_deal|crm_organization|crm_contacts/*.json; frappe/frappe@1a7ea577 frappe/contacts/doctype/contact/contact.json; docs/vision/erp.md (C14, C15)`),
  affects: [
    table_contacts, rpc_contacts_book_record,
    ...LEAD_RPCS, ...DEAL_RPCS, concept_contacts,
  ],
});

export const decision_contacts_private_entries = defineDecision({
  id: "contacts.private-entries",
  title: "A company not on Capxul is a private entry until it has a Party",
  question:
    "The directory holds only identities Capxul can name and pay (parties.outside-companies), so a prospect company, a " +
    "supplier paid only by bank or a person known only by phone has no Party. The CRM must still keep them. How?",
  options: [
    {
      label: "private-entry",
      text:
        "An entry with no Party: `party_id` null, its own id `contact_<ulid>`, `ref` null in every read, so it cannot be " +
        "paid or invoiced through the book until it has a Party. It is linked once, by `contact link` (contacts.book-verbs): " +
        "when the company is on Capxul (its handle), is paid at a wallet (its address), or the person's mailbox is " +
        "given (which names them in the directory), and it keeps its id. Wire inputs that named an entry by `partyId` now name it by `contactId`, the same " +
        "value for every entry born from a Party.",
    },
    {
      label: "re-key",
      text: "A private entry takes its Party's id as its own id when it is linked.",
    },
    { label: "elsewhere", text: "Keep companies without a Party out of the book, in a separate prospects table." },
  ],
  chosen: "private-entry",
  why:
    "One book of people and companies is Frappe CRM's own model and what a business expects: its prospects, its " +
    "bank-paid suppliers and its customers sit in one list. An id that changes at linking would break every lead, deal " +
    "and connected head that points at it, so a private entry keeps its own; every entry the frozen commands make is " +
    "still born from a Party with the PartyId as its id, so their claims hold. A separate prospects table would be a " +
    "second contact book with its own hide and label. A private entry never shares its Party with another entry " +
    "(`contacts-by-party`), and a link is refused rather than merged when the Party is already in the book, so no two " +
    "entries can disagree about where money goes.",
  source: crmBy("books/target/parties/decisions.ts (parties.outside-companies); contact.add.yaml acceptance 1; crm frontend/src/pages/Organization.vue:490"),
  affects: [table_contacts, rpc_contacts_book_record, rpc_contacts_book_get, rpc_contacts_book_list, rpc_contacts_book_add, procedure_parties_resolve_recipient, ...FLOWS],
});

export const decision_contacts_lead_conversion = defineDecision({
  id: "contacts.lead-conversion",
  title: "A lead converts once, naming its person in the directory then",
  question:
    "Frappe CRM's `convert_to_deal` makes a Contact (matched by mailbox only), a CRM Organization (matched by name) and a " +
    "CRM Deal, and marks the lead converted. What does Capxul's conversion do, and when does a lead's mailbox enter the " +
    "global directory?",
  options: [
    {
      label: "convert-once",
      text:
        "One transaction that locks the lead: the person is the entry given, or the book's entry for the lead's mailbox, " +
        "resolved through the directory (naming a provisional Party if new), or a private Contact with no mailbox; the " +
        "company is the entry given, else the book's CRM Organization whose shown name is the lead's typed name, else a " +
        "new private one from it; the deal is born from the lead; the lead becomes converted with the deal's id, status " +
        "Qualified. A lost lead is WRONG_STATE; a converted one answers its deal. A lead names no Party before that.",
    },
    { label: "name-at-capture", text: "Resolve a lead's mailbox in the directory when the lead is captured." },
    { label: "never-by-name", text: "Never match the lead's typed company name: the company is the entry given or a new private one." },
  ],
  chosen: "convert-once",
  why:
    "A lead is an unqualified prospect, often junk; naming every one in the global directory would fill it with digests " +
    "of mailboxes nobody will pay. A converted lead's person is someone the business deals with, which is what a contact " +
    "is, so the directory learns of them exactly when `contact add` would. Matching a person by mailbox is Frappe's own " +
    "rule ('Match only on email which uniquely identifies a person') and the directory's key, so it holds across the " +
    "Organization's book and every other. A company is matched by its name because that is Frappe's own rule " +
    "(`create_organization`) and, on a head, a CRM Organization's name is its identity, unique on the site: a " +
    "conversion made on the head lands on the existing company, so one made here must too, or the two sides would " +
    "split one company in two. A deal names a company and moves no money, and the match never changes an entry's " +
    "Party, so it cannot route a payment; a caller who means another company passes it (Frappe's " +
    "`existing_organization`). Answering the first deal on a second conversion is Frappe's 'Return Existing', which " +
    "makes an agent's retry safe; the lead's lock and its `deal_id` enforce it. `deals-by-lead` is not unique, because " +
    "a head may still make a second deal from one lead (Frappe's default is 'Create'). Revised in review: the first " +
    "pass never matched by name and made `deals-by-lead` unique, which a head's push and pull could not keep.",
  source: crmBy(`${CRM}/fcrm/doctype/crm_lead/crm_lead.py:230, :267 (by organization_name), :335 (by email), :354, :546 ('Create' by default), :583, :600`),
  affects: [table_contacts, procedure_parties_resolve_recipient],
});

export const decision_contacts_crm_permission = defineDecision({
  id: "contacts.crm-permission",
  title: "The People hat edits the whole CRM; every member reads it",
  question:
    "Editing an Organization's contact book needs its edit permission, the People hat (contacts.members-write). Leads " +
    "and deals are part of the same CRM. Who may read and change them, and who may own a lead or deal?",
  options: [
    {
      label: "people-hat",
      text:
        "The same as the book: every member reads the CRM; only a member whose Safe wears the People hat records, " +
        "changes, moves or converts, whether in Capxul or on a connected head. A lead's or deal's owner is a member (an " +
        "active Seat's Party).",
    },
    {
      label: "sales-hat",
      text: "A separate sales permission (Frappe's Sales User and Sales Manager), as a new hat in each Organization's tree.",
    },
    { label: "any-member", text: "Any member edits leads and deals; only the contact book needs the hat." },
  ],
  chosen: "people-hat",
  why:
    "The CRM is the Organization's contact book in Frappe's shape, so its edit permission is the book's, and one " +
    "permission for one app keeps who-may-change-what one answer. The hat is already the Organization's authority " +
    "(P9), the founder wears it from setup, and an agent given it works the CRM with no new grant; the hosted Forward " +
    "Deployed Engineer needs none, since it acts as an asker who wears it (aaron.fde-anyone, organizations.fde-for-the-asker). A sales hat would need a hat in every Organization's tree and an officer command to grant " +
    "it, which nothing asks for yet; it can split from the People hat later without changing a table. Letting any member " +
    "edit leads would bring back the rule the book's own permission replaced. The owner must be a member because " +
    "Frappe's `lead_owner` and `deal_owner` are site users who work the record. A connected head's edits arrive through " +
    "`contacts.head.sync` and are held to the same rule: applied as the member the head user's mailbox matches, only if " +
    "that member's Safe wears the People hat, else pushed back. Projects applies a head edit under the connection's " +
    "authority when no member matches; the CRM cannot, because editing the contact book is a permission by ruling " +
    "(contacts.members-write), and because the book is where money paid to an entry is aimed (only `contact link`, " +
    "in Capxul, names an entry's Party: contacts.book-verbs). Revised in review: the first pass let the connection's authority apply " +
    "an edit no member made. The head's own roles (Sales User, Sales Manager) should follow the hat, so its forms stop " +
    "other users before Capxul has to push back.",
  source: crmBy("books/target/contacts/decisions.ts (contacts.members-write); frappe crm_organization.json and contact.json permissions (Sales User, Sales Manager)"),
  affects: [
    ...CRM_WRITES, 
    table_org_deployments, table_org_members, 
    // the conversations' writes keep the same rule (contacts.conversation-commands)
    
    
  ],
});

export const decision_contacts_crm_capabilities = defineDecision({
  id: "contacts.crm-capabilities",
  title: "The CRM's new capabilities get their CLI commands now, in one grammar",
  question:
    "Recording a person or company, and capturing, moving and converting leads and deals, are new capabilities: none is " +
    "among the 215 frozen operations. Rule rules.new-operations now books a new operation for an Aaron ruling, with a " +
    "decision pack naming its commands. How does an Organization with no head work its CRM now, and how do the CRM and " +
    "projects, which booked their new capabilities differently, become one approach?",
  options: [
    {
      label: "sdk-now-cli-later",
      text:
        "Book the rpcs now, each behind one Core SDK method (`client.account.addressBook.record`, " +
        "`client.org(orgId).crm.leads.*`, `.crm.deals.*`) that serves the SDK: the Organization's Forward Deployed " +
        "Engineer and any other SDK client use them (a connected head syncs through contacts' own process instead). The " +
        "CLI commands (for example `contact record`, `crm lead add`, " +
        "`move`, `convert`, `list`, `get` and `crm deal add`, `move`, `list`, `get`) are this decision pack's " +
        "recommendation, booked as operations by rules.new-operations in the CLI operations pass, each one call to the " +
        "SDK method already booked. Projects follows the same shape: its rpcs and SDK methods first, then its pack's " +
        "commands.",
    },
    {
      label: "cli-now",
      text:
        "Recommended: book now, under rules.new-operations, exactly the 14 commands of docs/design/new-commands.md " +
        "(section 5.2), in its one grammar, each calling one SDK method that keeps its other surfaces and adds `cli`: " +
        "`contact create <label> --type person|company`, `contact change <contact>` and `contact link <contact> " +
        "<locator>` (the caller's own book, or with `--org` the Organization's; three flows " +
        "`client.account.addressBook.create|change|link` over `contacts.book.record`, which records, changes and links; " +
        "`link` previews and asks, since it chooses where money paid to the entry goes); `org crm lead " +
        "create|change|move|convert|list|get` (`client.org(orgId).crm.leads.*`; create and change are two flows over " +
        "`contacts.leads.save`); and `org crm deal create|change|move|list|get` (`client.org(orgId).crm.deals.*`; create " +
        "and change over `contacts.deals.save`). Who (contacts.crm-permission): every member reads the CRM; only a member " +
        "whose Safe wears the People hat records, changes, moves or converts, the hosted FDE only for such an asker; a person's own " +
        "book is theirs. Reads are `read`, the rest `write`, all `normal`.",
    },
    { label: "head-only", text: "No CRM capabilities in Capxul: leads and deals are worked only in a connected Frappe head." },
  ],
  chosen: "cli-now",
  why:
    "Aaron asked on 8 November 2026 for the new commands to be designed in the book, and accepted this recommendation " +
    "in his sixth batch; the fourteen are booked under rules.new-operations in ./operations.ts, each in this pack's " +
    "affects, with its verbs (contacts.book-verbs, contacts.crm-verbs), its priority (contacts.critical-commands, which " +
    "makes six of them `critical` in place of this option's 'all `normal`') and its worlds (contacts.crm-worlds) decided apart. The capability serves aaron.crm-frappe-shape and " +
    "aaron.frappe-shape: an Organization with no head works its CRM through these commands, and the FDE through the " +
    "same CLI (aaron.fde-agent). The rpcs and flows were booked SDK-first (sdk-now-cli-later); the commands now follow " +
    "the one grammar every new command keeps (docs/design/new-commands.md): `org` for what only an Organization has, " +
    "`create` for a document with a lifecycle (a lead, a deal, a new book entry; `add` keeps `contact add`'s meaning), " +
    "`change` for fields, `get` for one record, and one SDK method per command, so an rpc that both creates and " +
    "changes is two commands. Head-only would leave an Organization without a head with no leads or deals.",
  source: crmBy("packages/book/scripts/check-frozen.ts ('a target operation that is none of the 215'); books/target/shared/rulings.ts (aaron.crm-frappe-shape, aaron.frappe-shape, aaron.fde-agent)"),
  affects: [...CRM_OPERATIONS, ...CRM_RPCS, ...CRM_FLOWS, concept_contacts],
});

export const decision_contacts_head_sync = defineDecision({
  id: "contacts.head-sync",
  title: "Contacts syncs its own CRM with a connected head, one process per head",
  question:
    "When a Frappe head is connected, its CRM and the Organization's must stay one. Who syncs the CRM's records, how, " +
    "and what stays Capxul's alone?",
  options: [
    {
      label: "own-process",
      text:
        "Contacts' own process, `contacts.head.sync`, as every app concept syncs its own records: started at the " +
        "connection's `confirm`, it pushes `contact-changes` in seq order (`upsertDocs`) and pulls the head's changes " +
        "(`listChanges`), applying each through the CRM's own checks and transitions by the version rule of " +
        "organizations.head-ownership, as a member wearing the People hat (contacts.crm-permission); what it does not " +
        "apply (a conflict, a refusal, a deletion) it pushes back. Each Frappe record carries its `capxul_id`, and a " +
        "Contact or CRM Organization its `capxul_party`. An entry's Party, and so where money goes, is set only in " +
        "Capxul. How each record meets its document on the head is contacts.head-mapping.",
    },
    {
      label: "sdk-agent",
      text: "The head's sync runs outside the backend as an agent of the Organization, reading the lists and writing through the SDK methods.",
    },
    { label: "head-master", text: "Once a head is connected, the head's CRM is the record and Capxul's copy follows it." },
  ],
  chosen: "own-process",
  why:
    "The connected head is one integration that each app concept follows for its own records (the `frappe-head` " +
    "integration, organizations.head-ownership), so the CRM syncs as projects do: one ordered change log, cursors per " +
    "connection, and a version on every record so a stale head edit never overwrites a newer Capxul one. Applying pulled " +
    "changes through the CRM's own checks and transitions keeps Frappe's rules and the frozen claims in one place " +
    "whoever writes, and every stage change still sends its machine's event. An outside agent would need its own " +
    "credentials, its own cursor and a time-ordered read that can miss a late commit; a gap-free `seq` is what makes " +
    "the push exact. Head-master would let a head repoint an entry to another Party, which would redirect payments, so " +
    "`capxul_party` is never taken from the head: a Contact born there with a primary mailbox is named in the " +
    "directory exactly as a recorded person is, and one whose Party already has an entry is refused, never merged, so " +
    "one Party is one entry. Capxul never deletes a CRM record, so a head's deletion is pushed back like any refused " +
    "edit; a refused document born in the head has no Capxul version to push, so it stays there unadopted. Statuses " +
    "map one to one by name; a custom status the head adds is refused and pushed back until per-Organization lists " +
    "exist (contacts.crm-statuses).",
  source: crmBy("books/target/shared/external.ts (integration frappe-head); books/target/projects/processes.ts (projects.head.sync); organizations/data.ts (org-heads)"),
  affects: [
    table_contact_changes, table_contacts, 
    table_parties, procedure_parties_resolve_recipient, concept_parties,
  ],
});

export const decision_contacts_change_log = defineDecision({
  id: "contacts.change-log",
  title: "Every Organization-owned CRM write is logged in commit order",
  question:
    "A connected head must receive every change to an Organization's CRM, in order, exactly once, including the whole " +
    "history when it connects late. What records the order?",
  options: [
    {
      label: "seq-log",
      text:
        "`contact-changes`: one row per change to an Organization's book entry, lead or deal, appended in the writing " +
        "transaction with the next `seq` from `crm-settings` under its lock; the record keeps that seq as its `version`. " +
        "A person's own book logs nothing.",
    },
    { label: "updated-at", text: "Page each table by `updated_at`, as the lists do." },
    { label: "outbox", text: "Follow the machines' events through the outbox." },
  ],
  chosen: "seq-log",
  why:
    "A time column cannot promise exactly once: a write that commits after a reader passed its time is skipped, the gap " +
    "the vision's core check C5 finds in the books. A counter taken under one row lock commits in order, so paging by " +
    "`seq` skips nothing, and the version it gives each record is what the head's edits are compared against. The " +
    "outbox carries only stage changes, not a label or a phone number. The log holds ids, so it stays small and the " +
    "push reads each record as it stands. The counter row costs one lock per CRM write, which an Organization's CRM, " +
    "written by people and a few agents, never feels. Only Organizations have heads, so a person's book stays unlogged.",
  source: crmBy("books/target/projects/data.ts (project-changes, the same pattern); docs/vision/erp.md (C5)"),
  affects: [table_contact_changes, table_crm_settings, table_contacts, ...WRITES, ...CRM_WRITES],
});

export const decision_contacts_head_mapping = defineDecision({
  id: "contacts.head-mapping",
  title: "Each CRM record meets its head document by Frappe's own rules",
  question:
    "The CRM's tables carry Frappe CRM's field names, but a head has rules no table shows: a CRM Organization is named " +
    "by its `organization_name`, unique on the site, and Contact's `company_name` and CRM Deal's `organization` name it; " +
    "Frappe makes a Contact for every User; CRM Lead's `first_name` is mandatory in its form; Frappe's own conversion " +
    "marks a lead `converted`, sets it Qualified and makes another deal if asked again; and a site connected late may " +
    "already hold a CRM. How does each record meet its document there?",
  options: [
    {
      label: "frappe-rules",
      text:
        "Follow Frappe's own rules. An organization entry is pushed with its shown name (its label, else its Party's " +
        "display name) as `organization_name`; when another document on the head holds that name, with ` - 2`, ` - 3` " +
        "and on (the first free), as Frappe numbers a Contact's name, kept as `head_name`; a label change renames it " +
        "there. A Contact's `first_name` is the shown name, with no last name, and Frappe names it. A pulled " +
        "`full_name` or `organization_name` becomes the entry's label only when it differs from the name Capxul shows; " +
        "a Party's display name is never taken from a head. A member is a User on the head with the Contact Frappe made " +
        "for it: a deal naming a member names that Contact, found by its `capxul_party`, and a lead's or deal's owner is " +
        "the owner's User; an agent has no User (organizations.head-users), so an agent owner goes as null and a pulled " +
        "null owner leaves Capxul's agent owner as it is; a member's own row (its label " +
        "or hide) is not pushed while the member holds a Seat, and a change to a User's Contact is not pulled. A lead " +
        "with no first name is written as Frappe's Data Import writes one (mandatory fields not enforced), the path " +
        "`set_lead_name` serves. A converted lead is `converted` there with status Qualified; a lead the head converts " +
        "is pulled as `convert` with the first deal whose `lead` names it, which Frappe writes first (with no such deal " +
        "it is refused), and later deals from it are kept as deals. On a site that already holds a CRM, the first push adopts a Contact with no " +
        "`capxul_id` whose primary mailbox is an entry's, and a CRM Organization whose name is an organization entry's " +
        "shown name (Frappe's own keys), instead of making a second; the rest is pulled as documents born there.",
    },
    {
      label: "push-as-is",
      text:
        "Push every record under its own label and let the head refuse what it cannot hold (a second organization of " +
        "one name, a lead with no first name, a second Contact for a User).",
    },
    {
      label: "customize-naming",
      text: "Change CRM Organization's naming on the head to a hash with a Property Setter, so names need not be unique.",
    },
  ],
  chosen: "frappe-rules",
  why:
    "Each rule is one the head enforces whether Capxul knows it or not. CRM Organization is named by `organization_name` " +
    "(autoname by field), and Contact's `company_name` is a Data field holding that name, so two companies of one name " +
    "cannot both exist there; the frozen book lets two entries share a label (`contact label` #2), so the push must " +
    "tell them apart, and Frappe's own numbering of Contact names is the least surprising way. Renaming a CRM " +
    "Organization does not rewrite Contacts' `company_name`, so the head's Capxul app must. Changing CRM Organization's " +
    "naming would break Frappe CRM's pages, which show and link organizations by that name, and is a customization the " +
    "ruling asks to avoid. Frappe makes a Contact for every User (`create_contact`), so pushing a member as another " +
    "Contact would split one person in two, and that Contact's mailbox is the member's own, which a book never shows " +
    "(contacts.members-derived). Frappe's `convert_to_deal` makes the deal first and then sets the lead's `converted` " +
    "check with `db_set`, and by default makes another deal on a second conversion, so the pull takes the first and " +
    "keeps the rest. Frappe's form needs a lead's first name, but `set_lead_name` serves imports that hold only a " +
    "company or a mailbox, and Capxul's leads follow it. Adopting by mailbox and by name is how Frappe CRM itself " +
    "dedupes (`contact_exists`, `create_organization`). None of this touches money: an entry's Party is still set only " +
    "in Capxul. Added in review: the first pass said only that a sync renames fields, which left all of this to the build.",
  source: crmBy(
    `${CRM} crm_organization.json (autoname by field), crm_lead.json, crm_lead.py:140, :546, :600; frappe@1a7ea577 ` +
      "user.py:1615 (create_contact), contact.py:57, document.py:2287 (db_set)",
  ),
  affects: [
    table_contacts, table_org_members,
    table_parties, 
  ],
});

// ── the assembly after the Frappe lanes (8 November 2026) ────────────────────────────────────

const ASSEMBLY = "Claude, identity assembly after the Frappe lanes, 8 November 2026";
const asmBy = (evidence: string) => `${ASSEMBLY}; evidence: ${evidence}`;

export const decision_contacts_startup = defineDecision({
  id: "contacts.startup",
  title: "The CRM starts empty at begin; a business's contacts come in by command",
  question:
    "Every fundamental app starts itself from organizations' `org-setup.begin` (organizations.startup). What does the " +
    "CRM create when an Organization begins, and how does a business's existing list of people and companies get in?",
  options: [
    {
      label: "nothing-to-seed",
      text:
        "No start-up process: an Organization's CRM is complete at `begin` with nothing written. Its status lists are " +
        "fixed defaults (contacts.crm-statuses), its `crm-settings` counter is inserted by its first write under that " +
        "row's lock, and its members are read from Seats, never copied (contacts.members-derived). The Organization " +
        "itself is no CRM Organization: Frappe CRM's organizations are counterparties, and the Organization is ERPNext's " +
        "Company (organizations.company-shape). Existing contacts are imported in the start-up sitting one record at a " +
        "time, through `contact add` (a person or company with a Party) and `contact create` (a private entry, or a person " +
        "by mailbox, with Frappe's fields), by a People hat wearer: the founder, or the hosted FDE for one who asks it (agents.fde-people-hat). " +
        "A head connected later receives the whole CRM from seq 1 (contacts.head.sync).",
    },
    {
      label: "startup-process",
      text: "A workflow triggered by `org-setup.begin` that writes `crm-settings` and a CRM Organization for the Organization itself.",
    },
    { label: "bulk-import", text: "As nothing-to-seed, plus a bulk import rpc that takes a file of contacts in one transaction." },
  ],
  chosen: "nothing-to-seed",
  why:
    "A process whose only write would be a counter row that the first write inserts anyway is a process with nothing to " +
    "do, and P3 keeps no process for what a transaction can do. organizations.startup had listed 'the Organization's own " +
    "CRM Organization' for the CRM; Frappe CRM has no own-company record (its CRM Organization is a company you sell to " +
    "or buy from), so writing one would make the Organization a counterparty of itself in its own CRM and in a head's. " +
    "Importing through the booked writes keeps every check (the People hat, `parties.resolve-recipient` naming each " +
    "person, the change log) on every imported record, which a bulk path would have to repeat; a bulk import is a new " +
    "capability for the CRM's decision pack (contacts.crm-capabilities), not needed for the start-up, whose contact lists " +
    "are small. Answers the projects and start-up lane's ask for a CRM start-up from `begin`, and the CRM lane's for the " +
    "start-up import.",
  source: asmBy("docs/design/frappe/crm.md (FDE and organizations); docs/design/frappe/projects-and-startup.md (section 1 table); books/target/organizations/decisions.ts (organizations.startup)"),
  affects: [table_crm_settings, table_contacts, rpc_contacts_book_add, rpc_contacts_book_record, concept_contacts],
});

// ── the CRM's commands, booked under rules.new-operations (8 November 2026) ──────────────────

const COMMANDS = "Claude, CRM commands pass (contacts), 8 November 2026";
const cmdBy = (evidence: string) => `${COMMANDS}; evidence: ${evidence}`;

export const decision_contacts_book_verbs = defineDecision({
  id: "contacts.book-verbs",
  title: "`contact create`, `change` and `link` share one write; only `link` names a Party",
  question:
    "The CRM's one book write, `contacts.book.record`, records a new entry, changes its details and links its Party. The " +
    "grammar gives each its own verb and SDK method (docs/design/new-commands.md, G3 and G7). What does each command do, " +
    "and which of them may decide where money paid to an entry goes?",
  options: [
    {
      label: "three-verbs",
      text:
        "`contact create <label> --type person|company` records a new entry: a person given a primary mailbox is born " +
        "from its Party, and one whose Party already has an entry in the book is INVALID_INPUT naming it, never merged. " +
        "`contact change <contact>` sets details only and never names a Party: a mailbox given to a private person stays " +
        "a detail, and a change that gives nothing is INVALID_INPUT, as projects' `change` commands refuse it. `contact link <contact> <locator>` names a private entry's Party once, after a preview at a terminal " +
        "(`--confirm` from a script), and refuses an entry that has one, a Party already in the book and a Party of the " +
        "other kind (an Organization's for a person; a mailbox, a person's or an agent's for a company). The label stays " +
        "`contact label`'s. Three flows over the one rpc, area `payments` as the frozen contact commands are.",
    },
    { label: "one-command", text: "`contact record`, one command over the one SDK method `client.account.addressBook.record`, as it was booked SDK-first." },
    { label: "change-links", text: "As three-verbs, but `contact change` giving a private person a primary mailbox links it, as `contacts.book.record` first did." },
  ],
  chosen: "three-verbs",
  why:
    "G3 gives each verb one meaning and G7 one SDK method per command, so one rpc that creates, changes and links serves " +
    "three commands, as `contact hide` and `unhide` share one machine. Linking is the one step that decides where money " +
    "paid to an entry goes and cannot be undone, so it is its own command with a preview, as the grammar asks of every " +
    "command that cannot be undone (vocabulary.declined-preview-cancelled). Letting `change` link by mailbox, as the " +
    "SDK-first rpc did, would aim payments without that preview, and a head's edit of a mailbox, which the sync applies " +
    "through the same checks, would do it from outside Capxul, where contacts.head-sync already says a head never sets " +
    "an entry's Party. A create whose person's Party already has an entry is refused rather than merged, as a head-born " +
    "Contact is, because a merge would overwrite details another member typed; `contact add` keeps its frozen landing " +
    "on the existing entry. A company on Capxul is an Organization's Party or a wallet (parties.outside-companies), and " +
    "the preview shows the locator only as typed, so the rpc holds the kinds apart. The label keeps its frozen command. " +
    "The rulings it serves, in its source: the book is Frappe CRM's Contact and CRM Organization, and in an " +
    "Organization's book each of these writes is the People hat's.",
  source: cmdBy("serves aaron.crm-frappe-shape and aaron.contacts-permissions; docs/design/new-commands.md (G3, G5, G7, 5.2); contacts.head.sync; parties.outside-companies"),
  affects: [...BOOK_OPS, ...BOOK_FLOWS, rpc_contacts_book_record],
});

export const decision_contacts_critical_commands = defineDecision({
  id: "contacts.critical-commands",
  title: "The CRM commands a start-up and its first sale need are critical",
  question:
    "The grammar makes every new command `normal`. Which CRM commands does an Organization need from its first day, so " +
    "that they are `critical`?",
  options: [
    {
      label: "startup-and-first-sale",
      text:
        "Six: `contact create`, with which the start-up sitting brings in the business's people and companies " +
        "(contacts.startup); and `org crm lead create`, `list` and `convert` and `org crm deal list` and `move`: capture " +
        "a prospect, see the pipeline, convert it, and win or lose the deal. The other eight are `normal`.",
    },
    { label: "none", text: "Every command `normal`, as the grammar page has it: no B3 pilot runs one." },
    { label: "all", text: "Every CRM command `critical`." },
  ],
  chosen: "startup-and-first-sale",
  why:
    "The CRM is fundamental from an Organization's first day, and the FDE sets it up in the start-up sitting (the two " +
    "rulings in its source): the business's existing contacts come in then, one `contact create` or `contact add` at " +
    "a time (`contact add` is frozen and `normal` by rule 4). A pilot's first sale is the loop of the other five: " +
    "capture, list, convert, list the deals, move one to won. `change`, `link`, `get` and a lead's `move` refine it, and " +
    "`create` and `list` print every id the loop needs. None is on the B3 pilots' money path, so `critical` orders the " +
    "build's work and the evals a pilot depends on; it changes no budget. Projects marks its first engagement the same " +
    "way (projects.critical-commands). It changes one line of the pack's accepted recommendation, 'all `normal`' " +
    "(contacts.crm-capabilities), because the commands pass asked for the commands a pilot or start-up needs to be " +
    "marked critical; no command, flag or budget changes.",
  source: cmdBy("serves aaron.frappe-shape and aaron.fde-agent; docs/design/new-commands.md (G8); contacts.startup; CONVENTIONS rule 4 (priority)"),
  affects: CRITICAL,
});

export const decision_contacts_crm_worlds = defineDecision({
  id: "contacts.crm-worlds",
  title: "The CRM's refusals start from person-with-contacts or a new org-with-crm",
  question:
    "Every refusal of the fourteen commands needs a world. person-with-contacts holds a person's book and Acme with Dan " +
    "(People hat) and Rex (no hat), but no lead, deal or private person. Which worlds do the refusals and claims start from?",
  options: [
    {
      label: "one-more-world",
      text:
        "`contact create` starts from person-with-contacts. The other thirteen start from a new world, org-with-crm, " +
        "built from it by the commands themselves: Lou, a private person in Ada's book known by a phone number; in " +
        "Acme's book Globex Ltd (a private company) and Kim Park (kim@globex.test, born from her mailbox, at Globex); six " +
        "leads (Pat New, Quinn Contacted, Jo of Hooli Qualified, Max lost as Junk for Poor Fit, Kim's own Nurture with " +
        "company `globex ltd`, and Ivy of Umbrella Corp, owned by Dan, converted into the Umbrella deal); and three " +
        "Globex deals (a pilot in Qualification, a renewal won, an upsell lost for Pricing); Dan current. " +
        "person-with-contacts' private company is now recorded by `contact create`.",
    },
    { label: "per-command", text: "A world per command." },
    { label: "extend", text: "Add the leads, deals and private person to person-with-contacts itself." },
  ],
  chosen: "one-more-world",
  why:
    "One more snapshot reaches every remaining refusal: NOT_AUTHENTICATED with no session, ROLE_PERMISSION_DENIED as Ada " +
    "(no Seat) or Rex (no People hat), INVALID_INPUT from bad values and foreign ids, and WRONG_STATE from Ivy's " +
    "converted lead and Max's lost one; Kim's lead is there to show a conversion matching by mailbox and by name. " +
    "Building it with the new commands keeps a world a black box (devnet.deterministic-worlds: steps never write a " +
    "table) and makes the world a first proof of create, move and convert. Extending person-with-contacts would change " +
    "what the frozen contact commands and banking's `contact get` read there. The Board's grant and revoke of the " +
    "People hat to Rex, which the hat claims make, are steps of those evals, not of the world, so Rex starts with no hat.",
  source: cmdBy("books/target/devnet/worlds.ts (person-with-contacts, org-with-crm); devnet.deterministic-worlds; contacts.worlds"),
  affects: CRM_OPERATIONS,
});

// ── the CRM review (truth), 8 November 2026 ─────────────────────────────────────────────────

const REVIEW = "Claude, CRM review (truth), 8 November 2026";
const reviewBy = (evidence: string) => `${REVIEW}; evidence: ${evidence}`;

export const decision_contacts_convert_by_kept_mailbox = defineDecision({
  id: "contacts.convert-by-kept-mailbox",
  title: "A conversion first takes the person whose entry keeps the lead's mailbox",
  question:
    "`contacts.leads.convert` found the lead's person only through the Party of its mailbox. Since `contact change` " +
    "no longer links (contacts.book-verbs), and a head's edit of a private Contact's mailbox comes in through the same " +
    "checks, a private person can keep that mailbox as a detail with no Party. Frappe's `convert_to_deal` finds the " +
    "person by Contact Email (`contact_exists`). Which entry does a conversion take?",
  options: [
    {
      label: "kept-mailbox",
      text:
        "The `--contact` given; else the book's Contact that keeps the lead's mailbox among its `email_ids`, case aside " +
        "(the latest changed if several), private or not, never linked by the match; else the entry of the mailbox's " +
        "Party, resolved through `parties.resolve-recipient` (an entry added by handle keeps no mailbox), or a new one " +
        "born from it; else, with no mailbox, a new private Contact. A new entry keeps the lead's mailbox, numbers and " +
        "job title, as Frappe's `create_contact` copies them.",
    },
    {
      label: "party-only",
      text:
        "As first booked: the Party's entry or a new one. A private person who keeps the mailbox is not found, and the " +
        "conversion enters them a second time.",
    },
    { label: "link-on-convert", text: "Take the private person and link it to the mailbox's Party in the conversion." },
  ],
  chosen: "kept-mailbox",
  why:
    "Refuted in review: with party-only, a private person who keeps nia@bakers.test as a detail is entered again by " +
    "converting a lead with that mailbox, against the conversion's own claim that nobody is entered twice, and against " +
    "Frappe, whose `contact_exists` matches 'only on email which uniquely identifies a person' in Contact Email, the " +
    "rows the book's `email_ids` are. Two entries for one person would also reach a head as two Contacts with one " +
    "mailbox. Matching the kept mailbox first finds every entry Frappe would; the Party's entry next finds one added by " +
    "handle, which keeps no mailbox (`contact add` #3) but is the same person. Link-on-convert would choose where money " +
    "paid to the entry goes without `contact link`'s preview, which contacts.book-verbs keeps for that step alone. A " +
    "match changes no Party, so a private person stays private and the lead's mailbox then names nobody in the " +
    "directory. Refines contacts.lead-conversion, whose person was the mailbox's entry.",
  source: reviewBy("frappe/crm@2cecd300 crm_lead.py:230 (create_contact), :335 (contact_exists, by Contact Email); contacts.book-verbs; contacts.head.sync"),
  affects: [table_contacts],
});

// ── the CRM review (fit), 8 November 2026 ───────────────────────────────────────────────────

const FIT = "Claude, CRM review (fit), 8 November 2026";
const fitBy = (evidence: string) => `${FIT}; evidence: ${evidence}`;

// ── the CRM's conversations (8 November 2026) ───────────────────────────────────────────────

const TALK = "Claude, CRM conversations pass (crm-conversations), 8 November 2026";
const talkBy = (evidence: string) => `${TALK}; evidence: ${evidence}`;
const WA_SRC = "frappe/whatsapp@59bf368";
const FRAPPE_SRC = "frappe/frappe@1a7ea577";

const TALK_TABLES: never[] = [
  
  
];
const SENDS: never[] = [];

export const decision_contacts_conversations_shape = defineDecision({
  id: "contacts.conversations-shape",
  title: "Each conversation kind is its Frappe doctype, one table each, with links",
  question:
    "Frappe keeps an email as a Communication (with its Communication Link rows), a WhatsApp message as the WhatsApp " +
    "app's WA Message on a WA Account, a call as CRM Call Log, a note as FCRM Note and a task as CRM Task, each with a " +
    "reference to the lead or deal it is about. How does the CRM hold them?",
  options: [
    {
      label: "doctype-tables",
      text:
        "One table per doctype under Frappe's field names (communications, wa-accounts, wa-messages, crm-call-logs, " +
        "crm-notes, crm-tasks), each with Frappe's `reference_doctype` and `reference_name`, plus `timeline-links`, " +
        "Frappe's Dynamic Link rows, which put each item on every record whose timeline shows it; and `inbound-mails`, " +
        "the ids of what reached the mailbox before it is read.",
    },
    { label: "activities", text: "One `activities` table with a kind column and a JSON body for every kind." },
    { label: "head-only", text: "Keep conversations only on a connected head." },
  ],
  chosen: "doctype-tables",
  why:
    "contacts.frappe-shape took Frappe CRM table for table so a head syncs by mapping names; conversations follow it, " +
    "so a head's Frappe CRM shows them where it shows its own, and Frappe's rules are the book's (one primary " +
    "reference; a call's note is an FCRM Note; a task's statuses are CRM Task's). One activities table would hide each " +
    "kind's rules in JSON and make the sync a transformation. The links table is how Frappe itself puts a Communication " +
    "on several Contacts' timelines (`set_timeline_links`), and it lets one index serve every record's timeline. " +
    "Statuses that change are machines with one event each (communication, wa-message, wa-account, crm-task); a call's " +
    "outcome is a fact written once (contacts.call-logs). Only an Organization keeps them, as only an Organization has " +
    "a CRM. Head-only would leave the native CRM mute, against the evening answer.",
  source: talkBy(`${FRAPPE_SRC} communication.json, communication.py:428; ${WA_SRC} wa_message.json, wa_account.json; ${CRM} crm_call_log.json, fcrm_note.json, crm_task.json`),
  affects: [...TALK_TABLES, table_contact_changes],
});

export const decision_contacts_timeline_money = defineDecision({
  id: "contacts.timeline-money",
  title: "A timeline shows the money the chain proves with the record's Party",
  question:
    "This pass's brief asks for payments and requests to a contact to show on its timeline; Aaron's evening answer " +
    "names email, WhatsApp, calls, notes and tasks, not money, so this is the pass's own extension. Contacts sits below payments and " +
    "requests (banking depends on contacts, requests on banking), so it can read neither's rows, and a flow belongs " +
    "higher up when it needs a concept its own does not depend on (CONVENTIONS rule 8). Contacts does depend on " +
    "indexing, whose views hold every PaymentSent and every escrow. What money does the timeline show?",
  options: [
    {
      label: "chain-now",
      text:
        "The chain's: each PaymentSent between the Organization's company Safe and the record's Party's Safe, either " +
        "way, with its token, amount, payment id and document hash; each claim escrow the company Safe sent that the " +
        "Party's Safe owns; and each invoice escrow the Party's Safe sends that the company Safe owns, each with its " +
        "standing, read from indexing's chain-payments and escrows. A request paid from the Party's Safe shows as its " +
        "payment, carrying its Invoice's hash; one an outside payer pays shows as its invoice escrow, since its payout's " +
        "PaymentSent names the escrow as sender. A request not yet funded, and a payment not yet sent (scheduled, " +
        "awaiting approval), do not show.",
    },
    {
      label: "activity-flow",
      text:
        "Book the timeline as activity's flow, with activity gaining contacts and requests as dependencies: contacts' " +
        "timeline rpc, then activity's feed of Payments with the Party (every status), then requests' issued to it.",
    },
    { label: "contacts-above-payments", text: "Make contacts depend on payments, so it reads every Payment; requests still cannot be read." },
  ],
  chosen: "chain-now",
  why:
    "For Aaron: whether a timeline must also show what is not on the chain yet, an Invoice issued but unpaid and a " +
    "payment scheduled or awaiting approval. Recommended: chain-now, which needs no new edge between concepts and " +
    "shows every payment once it moves, both ways, every paid Invoice by its hash (by its escrow when an outside payer " +
    "paid it) and money waiting for the contact; " +
    "unpaid requests stay one command away in `request list --org`. If he wants them on the timeline, activity-flow " +
    "is the way that keeps the concept map acyclic: it moves the command to activity (the read model of money) and " +
    "adds contacts and requests to activity's dependencies, a foundation change. Contacts-above-payments would still " +
    "miss requests and reorder the concept map for half the answer. A lead and a private entry have no Party, so their " +
    "timelines show no money. Money is read through indexing's chain views, which already scope each row to the " +
    "Safes the tenant owns.",
  source: talkBy("docs/decisions/open-for-aaron.md (evening); books/target/shared/foundation.ts (contacts, banking, requests, activity dependsOn); CONVENTIONS rule 8"),
  affects: [table_chain_payments, table_escrows],
});

export const decision_contacts_conversations_head_sync = defineDecision({
  id: "contacts.conversations-head-sync",
  title: "Notes, tasks and calls sync both ways; emails and messages only to the head",
  question:
    "A connected head runs Frappe CRM, which keeps the same doctypes. Which conversations does `contacts.head.sync` " +
    "push and pull, and what does a head never change?",
  options: [
    {
      label: "channel-is-capxul",
      text:
        "Every conversation record goes into the change log and is pushed. Notes, tasks and call logs are pulled back " +
        "by the CRM's rules, a People hat wearer's edit applied. Emails and WhatsApp messages are pushed only: a head " +
        "never sends through its own Email Account or WA Account for the Organization's CRM, so a Communication or WA " +
        "Message born on the head is refused and left unadopted. A WA Account is never synced: its secrets are Capxul's.",
    },
    { label: "all-both-ways", text: "Sync every conversation both ways, a head's own sends included." },
  ],
  chosen: "channel-is-capxul",
  why:
    "The mailbox and the number are Capxul's channels, held to the world (aaron.world-clock): a head sending through " +
    "its own would put mail outside the world's clock and channels, and would not thread back, since only Capxul writes " +
    "the Message-IDs. Notes, tasks and calls are records people type, and Frappe CRM's pages edit them, so they come " +
    "back as leads and deals do. Email Account is already the head's machinery that the document family refuses " +
    "(organizations.doc-reach).",
  source: talkBy("contacts.head-sync; organizations.head-ownership; books/target/organizations/data.ts (HEAD_MACHINERY: Email Account)"),
  affects: [table_contact_changes, ...TALK_TABLES],
});

export const decision_contacts_sends_preview = defineDecision({
  id: "contacts.sends-preview",
  title: "A send, and connecting or disconnecting WhatsApp, preview at a terminal",
  question:
    "G5: a command that cannot be undone, or that hands records to an outside system, previews and asks. Which of the " +
    "conversation commands do?",
  options: [
    {
      label: "sends-and-channel",
      text:
        "`org crm email send` and `org crm whatsapp send` (a message cannot be taken back), and `org crm whatsapp " +
        "connect` and `disconnect` (they hand the CRM's conversations to Meta, or stop them). `--confirm` answers yes " +
        "from a script; a decline is CANCELLED; the hosted FDE never answers one for its asker. Notes, tasks and call " +
        "logs, which stay in Capxul and can be changed, do not.",
    },
    { label: "none", text: "No preview: a send is what the person asked for." },
  ],
  chosen: "sends-and-channel",
  why:
    "An email or message reaches a person outside Capxul and cannot be recalled, as `request issue` reaches its payer " +
    "after its own `--confirm`; a script confirms as every other such command does. A preview is the asker's own to " +
    "answer (new-commands G4, organizations.fde-for-the-asker), so each of the four rpcs, and `contact link`'s, refuses " +
    "the hosted FDE's act-for call with ROLE_PERMISSION_DENIED: the FDE drafts the message and the member sends it. " +
    "Revised in review (fit): the first pass let the FDE confirm. The preview resolves nothing before the write, as " +
    "`contact link`'s does, so a terminal run makes the same one call a script makes.",
  source: talkBy("docs/design/new-commands.md (G4, G5); aaron.fde-anyone; organizations.fde-for-the-asker; vocabulary.declined-preview-cancelled; contacts.book-verbs"),
  affects: [
    ...SENDS, operation_contact_link,
    
    rpc_contacts_book_record,
  ],
});

// ── review, crm-conversations (truth): what the real systems do ─────────────────────────────

const TRUTH_REVIEW = "Claude, review of crm-conversations (truth lens), 8 November 2026";

// ── review, crm-conversations (fit): the grammar and the rulings ────────────────────────────

const FIT_REVIEW = "Claude, review of crm-conversations (fit lens), 9 November 2026";

// ── the world pass's build (9 November 2026): staging's WhatsApp stays in its world ─────────

import { environment_staging } from "../shared/foundation.ts";

