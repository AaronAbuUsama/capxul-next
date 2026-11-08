// Every judgment the contacts design makes, as a decision record. Made by Claude on 8 November 2026
// under A1-A4 and P1-P10, with the old code (/home/user/factory, integration/factory: old parties'
// contacts area and the CLI's contact commands) and the frozen book as evidence.

import { defineDecision } from "../../../packages/book/src/index.ts";
import { concept_contacts } from "../shared/foundation.ts";
import { table_org_members } from "../organizations/data.ts";
import { procedure_parties_resolve_recipient } from "../parties/procedures.ts";
import { event_contact_transitioned, machine_contact, table_contacts } from "./data.ts";
import {
  rpc_contacts_book_add,
  rpc_contacts_book_get,
  rpc_contacts_book_hide,
  rpc_contacts_book_label,
  rpc_contacts_book_list,
  rpc_contacts_book_unhide,
} from "./book.ts";
import {
  flow_client_account_address_book_get,
  flow_client_account_address_book_hide,
  flow_client_account_address_book_label,
  flow_client_account_address_book_unhide,
} from "./flows.ts";
import {
  operation_contact_add,
  operation_contact_get,
  operation_contact_hide,
  operation_contact_label,
  operation_contact_list,
  operation_contact_unhide,
} from "./operations.ts";

const CLAUDE = "Claude, contacts design, 8 November 2026";
const by = (evidence: string) => `${CLAUDE}; evidence: ${evidence}`;
const P = "packages/backend/src/parties";

const OPERATIONS = [
  operation_contact_add, operation_contact_get, operation_contact_hide, operation_contact_label, operation_contact_list,
  operation_contact_unhide,
];
const WRITES = [rpc_contacts_book_add, rpc_contacts_book_label, rpc_contacts_book_hide, rpc_contacts_book_unhide];
const READS = [rpc_contacts_book_list, rpc_contacts_book_get];
const FLOWS = [
  flow_client_account_address_book_get, flow_client_account_address_book_label, flow_client_account_address_book_hide,
  flow_client_account_address_book_unhide,
];

// ── data ────────────────────────────────────────────────────────────────────────────────────

export const decision_contacts_one_book_table = defineDecision({
  id: "contacts.one-book-table",
  title: "One contacts table per owner, keyed by the counterparty's Party",
  question: "How is the address book stored, now that it leaves old parties' party edges?",
  options: [
    {
      label: "owner-table",
      text:
        "One `contacts` table with tenancy `owner` (`owner_kind` person or organization, `owner_id` their tenant id), one row " +
        "per owner and counterparty PartyId.",
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
    "lets the generated row-level security match the session's tenant directly. The key (owner, counterparty PartyId) " +
    "is what 'every locator lands on one party-keyed entry' needs. The old edge table also held payroll's `employed` " +
    "engagements and the provenance other concepts wrote; both go (contacts.relationships), so a plain table of entries " +
    "is all that is left. `owner_id` leads the key and the index with `owner_kind` second, so the two kinds' ids never " +
    "need to differ.",
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
    "changes are not a status, so they send nothing. The event carries the book and the PartyId, never a label or mailbox.",
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
        "`ref` is always `{kind: party, partyId}`. `label` is the owner's label, or the mailbox they typed when adding by " +
        "email with none, else the Party's display name, handle, then PartyId. A given label is trimmed and must be 1 to 120 characters.",
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
    "surface, so the book wins (P10 rung 1).",
  source: by(`${P}/contacts/rules.ts:26 and :36; ${P}/rules.ts:19; ${P}/contacts/tests/add.test.ts:25 and :147`),
  affects: [table_contacts, rpc_contacts_book_add, rpc_contacts_book_label, operation_contact_add, operation_contact_get, operation_contact_list],
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
    "CLI_USAGE was a reviewer's finding, not a design. CLI_USAGE stays for what the CLI checks itself: a malformed PartyId, " +
    "a missing ID or `--confirm` in a script, an empty `--label`.",
  source: by("apps/cli/src/commands/contact/internal/write.ts:40; docs/as-is/lane-reports/review-agent.json"),
  affects: [flow_client_account_address_book_label, flow_client_account_address_book_hide, flow_client_account_address_book_unhide, operation_contact_unhide],
});

export const decision_contacts_members_write = defineDecision({
  id: "contacts.members-write",
  title: "Any member may write an Organization's book",
  question: "Who may add, label, hide and unhide in an Organization's book?",
  options: [
    { label: "member", text: "Any active Seat, as the frozen `who` says ('a member of the Organization for its book')." },
    { label: "manager", text: "Only a manager, as old parties' `requireWriter` checked (old permissions' managePeople, now the People hat)." },
  ],
  chosen: "member",
  why:
    "The frozen `who` of every contact command says a member, and the only Organization refusal is for one 'you are " +
    "outside'. P10 rung 3 (the stricter wins for money and authority) does not apply: an entry moves no money and grants " +
    "nothing, the label never resolves a payee (parties resolves; every payment shows its PartyId and needs its own " +
    "budget authority and approval), and the book cannot hide a member from itself. The stricter check is also not " +
    "buildable here: whether a Safe wears the People hat is an indexing fact, and contacts depends only on access, " +
    "parties and organizations. If a ruling wants the People hat, the map must let contacts read hat wearers.",
  source: by(`${P}/guards.ts:41 (requireWriter, requireManager); packages/protocol/src/parties/operations.ts:100 (ADMIN)`),
  affects: [...WRITES, concept_contacts],
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
    "The other options break the concept map, the build or the frozen surface. Until the map moves it, this book keeps " +
    "the record here with its frozen `returns`, and its flow returns the entry only: the `bankAccounts` step is the gap " +
    "the move closes. The contacts flow and rpc stay as they are for banking's flow to call.",
  source: by("apps/cli/src/commands/contact/subcommands/get/execute.ts:50 (a second call, bankAccounts.list); OPERATION_OWNERS"),
  affects: [operation_contact_get, flow_client_account_address_book_get, rpc_contacts_book_get],
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
  title: "Contacts has no procedures and no workflows",
  question: "Does contacts need a door for other concepts or a durable process?",
  options: [
    {
      label: "none",
      text:
        "No procedure and no workflow: concepts above read `contacts` and call its rpcs from their flows; every change is " +
        "inside one rpc.",
    },
    {
      label: "door",
      text: "A `contacts.add-entry` procedure for banking to add a name-only contact inside its bank account save.",
    },
  ],
  chosen: "none",
  why:
    "A procedure needs a money fact (P4, rules.procedures); an entry is not one: if a saved bank account's contact entry " +
    "lagged or was missing, no money would move or be owned unaccounted for, since the account belongs to the Party, not " +
    "the entry. So banking adds a contact through `contacts.book.add` (by the Party's id) from its own flow, and reads " +
    "the table to find one. Short-lived rows have no process (rules.durable-processes), and membership is read, not " +
    "copied, so nothing reacts to anything. Old parties' `recordContactEdges`, `ensureEmployedEdge` and the " +
    "`emitRelationshipChanged` telemetry action are not ported (P2, P4, P7).",
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
  question: "Which devnet world reaches each refusal of the six contact commands?",
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
        "Reads `read`, writes `write`; the guided get, label, hide and unhide (flow and operation) allow a second call in " +
        "sequence: read 800/1,600 ms, write 900/1,900 ms, excluding `wait.person`.",
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
  affects: [...FLOWS, operation_contact_get, operation_contact_label, operation_contact_hide, operation_contact_unhide, ...READS, ...WRITES],
});
