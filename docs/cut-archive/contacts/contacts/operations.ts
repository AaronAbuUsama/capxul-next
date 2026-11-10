// Moved out of the built book by the cut, 10 November 2026, from books/target/contacts/operations.ts. The records are intact;
// the imports below are as the file had them, so they point at the folder the file was written in (as docs/as-is/archive does).
// What each record became is in docs/cut-archive/INDEX.md.

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
