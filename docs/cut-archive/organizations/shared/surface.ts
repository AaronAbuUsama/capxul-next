// Moved out of the built book by the cut, 10 November 2026, from books/target/shared/surface.ts. The records are intact;
// the imports below are as the file had them, so they point at the folder the file was written in (as docs/as-is/archive does).
// What each record became is in docs/cut-archive/INDEX.md.

import { defineDecision } from "../../../packages/book/src/index.ts";
import * as f from "./foundation.ts";
import * as x from "./external.ts";
import * as payroll from "../payments/agreements/operations.ts";

export const decision_surface_head_group = defineDecision({
  id: "surface.head-group",
  title: "The Frappe site is one group, `org head`: its apps, DocTypes and documents",
  question:
    "The connected Frappe site's commands sit under four nouns of `org`: `org head connect|show|disconnect`, `org app " +
    "list|add|remove`, the document family's nine `org doc` commands, `org doctype list|get` and `org doc-call list`. " +
    "How do they group?",
  options: [
    {
      label: "head-group",
      text:
        "`org head`, the Organization's Frappe site: a singleton's own verbs (`connect`, `show`, `disconnect`), its apps " +
        "(`org head app list|add|remove`), its documents (`org head doc list|get|create|change|submit|cancel|amend|apply|" +
        "remove`), its DocTypes (`org head doctype list|get`) and the log of every call the family made (`org head " +
        "doc-call list`).",
    },
    { label: "site", text: "A new word, `org site`, for what Frappe's framework holds." },
    { label: "as-booked", text: "Keep the four nouns as booked." },
  ],
  chosen: "head-group",
  why:
    "Frappe's framework is the site: its installed apps, its DocTypes and its documents are the site's, and Capxul's " +
    "word for an Organization's site is its head, connected as its own step, so a second word would name one thing twice. An " +
    "app the Organization wants before it has a head is the head-to-be's, installed when one connects, so it reads as " +
    "the head's too. `org doc` was shorter, but `org head doc` says where the document lives: on the head, of which " +
    "Capxul keeps no copy (organizations.head-ownership). All fifteen moved commands are new; each id becomes its new " +
    "words (`org.doc.get` is `org.head.doc.get`).",
  source: by("aaron.frappe-head; organizations.commands; organizations.doc-family; organizations.head-ownership"),
  affects: [f.concept_organizations],
});

export const decision_surface_frappe_reach = defineDecision({
  id: "surface.frappe-reach",
  title: "Everything on Frappe: native as what Capxul writes, money as what moves money",
  question:
    "Every non-child DocType of erpnext@6b946b0, hrms@8816102 and crm@2cecd30 (425), read against the family's guard " +
    "(organizations.doc-reach, with organizations.reach-holes and payroll.hr-head-documents): 53 reached by native " +
    "commands, 229 through the family, 23 left out by design, and 120 by neither. 102 are refused as native though no " +
    "command writes them: 69 of ERPNext's Accounts (Sales and Purchase Invoice, Period Closing Voucher, Cost Center, " +
    "the tax, payment-term and pricing masters; a manual Journal Entry too, since Capxul writes only its own), 18 of " +
    "Payroll, 4 of Projects, 10 of FCRM, and HR's Leave Adjustment. 18 are refused as money: Sales and Purchase " +
    "Order, Supplier Quotation, Delivery Note, Purchase Receipt, Stock Entry, Stock Reconciliation, Landed Cost " +
    "Voucher, Repost Item Valuation, five Asset DocTypes, Subcontracting Order and Receipt, Leave Encashment, " +
    "Transaction Deletion Record. The hooks the money test reads are a proxy: accounting_dimension_doctypes lists what " +
    "carries dimensions, so it refuses documents that post nothing (Supplier Quotation, Sales and Purchase Order) and " +
    "leaves a hooked child's parent (Material Request) unclear. How is every Frappe capability reached, with no second " +
    "record of money?",
  options: [
    {
      label: "authored-and-moves",
      text:
        "Native is what Capxul writes: what its commands write, and every DocType of a module whose figures Capxul " +
        "computes (Payroll, Projects, FCRM); ERPNext Accounts' other DocTypes are the head's to author, books copying " +
        "their vouchers (books.head-vouchers). Money is what moves money: Capxul freezes every Bank and Cash account on the " +
        "head, each Safe's included, to its app user's role (the Company's role_allowed_for_frozen_entries, which no " +
        "hat grants), so ERPNext refuses any line on one from any other User, in the desk or the family; and the " +
        "family refuses by name what pays, receives, allocates or " +
        "re-posts (Payment Entry, Payment Request, Payment Order, Payment Reconciliation and its process, Unreconcile " +
        "Payment, the POS documents, Cashier Closing, Invoice Discounting, the three Reposts, Ledger Merge, Transaction " +
        "Deletion Record, Lending's Loan Management, Leave Encashment, Gratuity). The rest, submit and cancel included, " +
        "is reached as the member's head User.",
    },
    { label: "drafts-of-money", text: "Keep both tests; let the family read money DocTypes and keep drafts of them, submit staying in the head's desk." },
    { label: "native-modules", text: "Make stock, selling, buying and assets native concepts, each with its own commands." },
    { label: "as-accepted", text: "Keep organizations.doc-reach: the 118 stay reachable only in the head's own desk." },
  ],
  chosen: "authored-and-moves",
  why:
    "A head's invoice, delivery or depreciation posts in the head whether a person submits it in the desk or the family " +
    "submits it for them, and books takes its GL lines either way, authored by the head: refusing it through the " +
    "family moves where it is done, not whether it posts. A second record of money is a head recording money that " +
    "moved, which is a line on a Bank or Cash account or a document that pays, allocates or re-posts. Freezing those " +
    "accounts makes ERPNext's own check (validate_frozen_account) refuse every such line for every User but Capxul's; " +
    "today only the Safes' accounts are frozen, so the desk itself is open to other bank and cash lines. Money still " +
    "moves only by Capxul's commands, against the head's documents (`payment send`, `inbox pay`, `request issue`). " +
    "drafts-of-money leaves submit out of reach; native-modules makes Capxul the record of stock, the largest scope, " +
    "reaching nothing until built. What Capxul computes stays native, its gaps native commands (surface.computed-gaps). " +
    "For Aaron: this reverses his acceptance of question 43 in the light of his words of 9 November, so " +
    "organizations.doc-reach stays in force until he answers; the lists are in docs/design/command-surface.md section 7.",
  source: by("DocTypes and hooks.py of erpnext@6b946b0, hrms@8816102, crm@2cecd30; organizations.doc-reach; books.head-vouchers"),
  affects: [f.concept_organizations, f.concept_books, f.component_frappe_app, x.integration_frappe_head],
});

export const decision_surface_head_methods = defineDecision({
  id: "surface.head-methods",
  title: "Reports, next documents and prints: three family additions for Frappe's methods",
  question:
    "The family reaches DocTypes, not methods (organizations.doc-family leaves whitelisted methods out). Three things " +
    "every Frappe app does are methods: running a report (General Ledger, Accounts Receivable, Stock Balance, Salary " +
    "Register: frappe.desk.query_report.run), making the next document from one (Quotation to Sales Order to Delivery " +
    "Note to Sales Invoice, Material Request to Purchase Order, Work Order to Stock Entry: each app's make_* mappers) " +
    "and printing one (frappe.utils.print_format.download_pdf). None is reachable from the CLI or the SDK. How are they " +
    "reached?",
  options: [
    {
      label: "three-additions",
      text:
        "Three additions to the family, each one rpc to the head's Capxul app, run as the member's head User and logged " +
        "(organizations.doc-log): `org head report list [--module]` and `org head report run <Report> " +
        "[--filter <field><op><value>]… [--after] [--limit]`, read only; `org head doc create <DocType> --from " +
        "<DocType> <name>`, the mapper the source's app declares for that pair, from an allowlist the Capxul app keeps, " +
        "making a draft the family's guard then checks like any other; and `org head doc render <DocType> <name> " +
        "[--format <print format>] [--out <path>]`, a PDF as `document render` saves one. Their verbs are G3's: `list`, " +
        "`run` (as `dev jobs run`), `create`, and `render` (as `document render`).",
    },
    { label: "per-capability", text: "One command per method, booked as each capability is needed." },
    { label: "none", text: "Leave methods out; the head's desk runs them." },
  ],
  chosen: "three-additions",
  why:
    "These are the methods behind most of what a Frappe user does after entering data: reading reports, moving a " +
    "document down its chain, and sending a printed copy. They are generic, as the family is: one runner reaches every " +
    "report of every app with the User's own permissions, and one mapper flag every 'Create' button the allowlist names, " +
    "without letting a method write around the guard. Booking them is organizations' (organizations.doc-family), with " +
    "acceptance claims, once Aaron agrees; files and comments wait on contacts.attachments-later. For Aaron: the " +
    "recommendation stands until he answers.",
  source: by("aaron.sdk-reaches-everything; organizations.doc-family; organizations.doc-log; the make_* mappers of erpnext@6b946b0"),
  affects: [f.concept_organizations, f.component_frappe_app],
});
