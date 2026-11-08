// Aaron's rulings of 8 November 2026 (his second and third batches of answers), as decision records with him as
// the source, plus the design judgments he accepted as recommended and the ones he reopened. The
// judgments report reads ACCEPTED and REOPENED, so an accepted judgment leaves "For Aaron".

import { defineDecision } from "../../../packages/book/src/index.ts";
import * as f from "./foundation.ts";

const AARON = "Aaron, 8 November 2026, in the build-preparation conversation";

/** Judgments Aaron accepted as recommended on 8 November 2026. */
export const ACCEPTED: readonly string[] = [
  "swarm.superset",
  "portal.hosting",
  "portal.stack",
  "devnet.sessions-across-warps",
  "parties.directory-tenancy",
  "agents.org-owned",
  "equity.acceptance",
  "devnet.no-acceptance",
  "accounts.no-acceptance",
  "devnet.time-protocol", // accepted with his change: no support window, everyone cut over at once
  "procedures.accounts-admit",
];

/** Judgments an Aaron ruling replaced; the design pass rewrites each record to its ruling, book first. */
export const SUPERSEDED: Readonly<Record<string, string>> = {
  "portal.stack": "aaron.portal-generator",
  "contacts.members-write": "aaron.contacts-permissions",
  "notices.claim-escrow": "aaron.money-waiting",
  "payroll.scope": "aaron.frappe-shape",
  "books.facts-without-chart": "aaron.books-first-principles",
};

/** Judgments Aaron reopened on 8 November 2026: they are redesigned, or asked again with context. */
export const REOPENED: readonly string[] = [];

export const decision_aaron_erp_on_capxul = defineDecision({
  id: "aaron.erp-on-capxul",
  title: "Capxul sits inside an ERP on Frappe; accounting is the app to fork",
  question: "What is the rebuild for, beyond the frozen operations, and what must its design allow?",
  options: [
    {
      label: "erp-on-capxul",
      text:
        "Capxul is the money, identity and governance layer of a larger system: an ERP whose applications are Frappe's. " +
        "Accounting is the app to fork, because accounting is assumed and works a certain way in Frappe; HR, CRM and " +
        "projects probably need no fork. Every Capxul concept that holds what a Frappe app holds keeps its data in that " +
        "app's shape (frappe-shape). The one clock must be able to drive the rest of that system, not only Capxul.",
    },
    { label: "standalone", text: "Capxul stands alone; any ERP integrates later through its public API." },
  ],
  chosen: "erp-on-capxul",
  why:
    "Aaron, 8 November 2026: the main application to fork is accounting, not payroll; HR, CRM and projects probably do not " +
    "need a fork; 'this is going to be built into a larger system, larger than just Capxul and money. Hence why the time " +
    "and the clock is important, because it's got to be able to permeate and drive other things as well.' A version of that " +
    "system exists elsewhere and is being rebuilt from first principles; it is not the immediate task.",
  source: AARON,
  affects: [f.system_capxul, f.concept_parties, f.concept_contacts, f.concept_books, f.concept_payroll],
});

export const decision_aaron_crm_frappe_shape = defineDecision({
  id: "aaron.crm-frappe-shape",
  title: "The global directory of people is a CRM in Frappe CRM's shape",
  question: "parties.directory-tenancy made the directory of people global. What is it, and whose shape does it take?",
  options: [
    {
      label: "global-crm-frappe",
      text:
        "Yes, global: one directory of people and companies across every tenant, a global CRM, with records shaped to map " +
        "onto Frappe CRM (its contact, organization and lead doctypes and their fields), because Capxul will fork Frappe CRM. " +
        "A design pass maps parties' and contacts' tables onto those doctypes before B4 builds them, book first.",
    },
    { label: "global-own-shape", text: "Global, in Capxul's own shape, with a mapping written later." },
  ],
  chosen: "global-crm-frappe",
  why:
    "Aaron, 8 November 2026: 'yes to a global directory of people... we want to have a global CRM, compatible with Frappe, " +
    "because we're going to end up forking the Frappe CRM anyway, so we want to keep our data in that sort of shape.'",
  source: AARON,
  affects: [f.concept_parties, f.concept_contacts],
});

export const decision_aaron_books_first_principles = defineDecision({
  id: "aaron.books-first-principles",
  title: "Rethink the books from first principles, with Frappe doing the accounting",
  question:
    "books.facts-without-chart keeps money facts from the first money, chart or not. With Frappe doing the accounting, what " +
    "should Capxul's books concept own?",
  options: [
    {
      label: "rethink",
      text:
        "Reopen the books concept and design it again from first principles, with Frappe's accounting as the ledger of " +
        "record: likely Capxul records each money fact once, in a shape Frappe's journal entries and chart of accounts can " +
        "take, and leaves the chart, the periods and the reports to Frappe. The redesign is a decision pack before B4 " +
        "builds books, book first.",
    },
    { label: "keep", text: "Keep the current books design (facts without a chart, Capxul's own chart and reports)." },
  ],
  chosen: "rethink",
  why:
    "Aaron, 8 November 2026: 'we should think about that from first principles, the chart of accounts thing, because again, " +
    "we're gonna use Frappe for that.'",
  source: AARON,
  affects: [f.concept_books],
});

export const decision_aaron_frappe_shape = defineDecision({
  id: "aaron.frappe-shape",
  title: "Every concept on the critical path is shaped the Frappe way",
  question: "Which Capxul concepts take Frappe's shapes, and when is that mapped?",
  options: [
    {
      label: "critical-path-now",
      text:
        "Every concept on the critical path that holds what a Frappe app holds is mapped onto that app's doctypes before " +
        "the build: people and companies onto Frappe CRM, the books onto the accounting app Capxul forks, pay agreements " +
        "and payslips onto Frappe HR's payroll shapes, and so on. Payroll is shaped the Frappe way, not forked. How a payslip " +
        "relates to on-chain pay (computed by the payroll app, paid and proven by Capxul) is designed in the same pass.",
    },
    { label: "later", text: "Map onto Frappe when the ERP is built." },
  ],
  chosen: "critical-path-now",
  why:
    "Aaron, 8 November 2026: 'the books redesign is on the critical path... payroll should be shaped, all the apps should be " +
    "shaped in the Frappe way... we should map it in the Frappe shape', and 'payslips need to be generated from on-chain data'. " +
    "He corrected an earlier word: the fork is accounting, not payroll.",
  source: AARON,
  affects: [f.concept_parties, f.concept_contacts, f.concept_books, f.concept_payroll],
});

export const decision_aaron_seats = defineDecision({
  id: "aaron.seats",
  title: "Ten seats per company; one agent per seat, plus the company's own",
  question: "How many people and agents may a company have?",
  options: [
    {
      label: "ten-seats",
      text:
        "Every company, in the beta and after, starts with ten seats. Each seat may hold one agent account, and the company " +
        "may hold one agent of its own. Adding a seat past the limit is refused until the limit is raised.",
    },
    { label: "unlimited", text: "No seat limit." },
  ],
  chosen: "ten-seats",
  why: "Aaron, 8 November 2026: 'when you start, you get 10 seats, and every seat can have one agent account, as well as the company's agent.'",
  source: AARON,
  affects: [f.concept_agents, f.concept_access],
});

export const decision_aaron_contacts_permissions = defineDecision({
  id: "aaron.contacts-permissions",
  title: "Editing a company's contact book needs a permission",
  question: "Who may add, label, hide and unhide in an Organization's contact book?",
  options: [
    { label: "permission", text: "Only seats that hold the contact book's edit permission; every member may read it." },
    { label: "member", text: "Any active seat, as the old book's who said." },
  ],
  chosen: "permission",
  why: "Aaron, 8 November 2026: 'there should be permissions for editing the contact book. It shouldn't just be anyone can do anything.'",
  source: AARON,
  affects: [f.concept_contacts],
});

export const decision_aaron_money_waiting = defineDecision({
  id: "aaron.money-waiting",
  title: "Escrowed money sends a money-waiting email; check the escrow fits",
  question: "When a payment goes to someone with no Capxul account yet, how do they learn of it and how do they collect it?",
  options: [
    {
      label: "email-and-escrow",
      text:
        "Send a money-waiting email naming the amount, the payer and how to collect. The escrow contract holds the funds; " +
        "only the recipient's Capxul account can unlock them, once they have one; the sender can refund at any time before " +
        "the recipient accepts. The design pass checks the v4 escrow contract does exactly this.",
    },
    { label: "none", text: "Send nothing; the payer tells the payee." },
  ],
  chosen: "email-and-escrow",
  why:
    "Aaron, 8 November 2026: 'they should get a money is waiting email... this is what the escrow contract is for: it is " +
    "unlockable by the recipient's Capxul; the sender can always refund before the receiver has accepted it; and then of " +
    "course we can send emails.' Assess the contract is fit for purpose.",
  source: AARON,
  affects: [f.system_capxul],
});

export const decision_aaron_machine_login = defineDecision({
  id: "aaron.machine-login",
  title: "Machine login is simple, and a warp never signs a machine out",
  question:
    "People's sessions and sign-in codes run on the one clock, so a warp past a session's life signs a person out. What " +
    "about agents, scripts and simulations such as vending-bench?",
  options: [
    {
      label: "simple-keys",
      text:
        "A machine signs in with a key it holds (the agent's own key, or a key session), in one step and with no " +
        "interactive code, and that sign-in does not lapse with a warp. People's sessions keep following the one clock.",
    },
    { label: "same-as-people", text: "Machines use people's sessions and sign in again after a long warp." },
  ],
  chosen: "simple-keys",
  why:
    "Aaron, 8 November 2026: yes to sign-outs on the one clock, 'but machine login should be simple anyway'. A simulated year " +
    "must not stall on a sign-in, and agents are first-class users of the CLI.",
  source: AARON,
  affects: [f.concept_access, f.concept_agents],
});

export const decision_aaron_portal_generator = defineDecision({
  id: "aaron.portal-generator",
  title: "The portal is the generator's output; Fumadocs is set aside for now",
  question: "Which renders the portal?",
  options: [
    { label: "generator", text: "The book's own generator (as in the prototype and the starter kit) renders the portal. Fumadocs is set aside, to revisit later." },
    { label: "fumadocs", text: "Fumadocs on a Next.js static export renders it." },
  ],
  chosen: "generator",
  why: "Aaron, 8 November 2026: 'let's forget Fumadocs for now and just run the generate; whatever we get generated from that generator, we'll stick with that for now.'",
  source: AARON,
  affects: [f.system_capxul],
});
