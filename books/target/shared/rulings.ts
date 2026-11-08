// Aaron's rulings of 8 November 2026 (his second, third and fourth batches of answers), as decision records with him as
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
  "books.facts-without-chart": "aaron.books-first-principles",
  "payroll.scope": "aaron.frappe-shape",
  "notices.claim-escrow": "aaron.money-waiting",
};

/** Judgments Aaron reopened on 8 November 2026: they are redesigned, or asked again with context. */
export const REOPENED: readonly string[] = [];

export const decision_aaron_erp_on_capxul = defineDecision({
  id: "aaron.erp-on-capxul",
  title: "Capxul's protocol is designed around Frappe, which is its UI",
  question: "What is Capxul ultimately for, and how much does that shape the protocol now?",
  options: [
    {
      label: "around-frappe",
      text:
        "The long-term product is an agentic ERP on stablecoins: an opinionated front end to Capxul, tailored to real " +
        "business, whose UI is Frappe (the head). So the protocol is designed around Frappe now: an organization's data lives " +
        "in Frappe's shapes from the moment it starts, whether or not a Frappe head is connected yet (connecting one is a " +
        "separate step). Forking is kept to the least possible; ideally Capxul is native to Frappe with no fork. Running on " +
        "stablecoins is simply how it runs.",
    },
    { label: "vision-only", text: "Keep the ERP as a speculative vision and the baseline's own shapes." },
  ],
  chosen: "around-frappe",
  why:
    "Aaron, 8 November 2026, correcting the previous reading: 'we should still be redesigning the protocol around Frappe, " +
    "because ultimately that is going to be the UI... ideally Capxul native, we fork as little as possible. When you start a " +
    "Capxul, you start with all of these things, whether the Frappe head has been connected or not yet; that's a separate " +
    "thing altogether.' The one clock matters because the larger system runs on it too.",
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
        "Yes, global: one directory of people and companies across every tenant, a global CRM, in Frappe CRM's shape. CRM " +
        "is one of the two fundamental apps every organization starts with.",
    },
    { label: "global-own-shape", text: "Global, in Capxul's own shape." },
  ],
  chosen: "global-crm-frappe",
  why: "Aaron, 8 November 2026: a global CRM compatible with Frappe; CRM is fundamental to how the product is built.",
  source: AARON,
  affects: [f.concept_parties, f.concept_contacts],
});

export const decision_aaron_books_first_principles = defineDecision({
  id: "aaron.books-first-principles",
  title: "Redesign the books in Frappe accounting's shape, synced, no fork if possible",
  question: "What does Capxul's books concept become?",
  options: [
    {
      label: "frappe-accounting",
      text:
        "Redesign the books from first principles in the shape of Frappe's accounting (its account tree, journal and ledger " +
        "entries, payment entries, fiscal years, cost centres, or what the real doctypes show), so an organization's books " +
        "sync with an ERPNext head when one is connected. Money facts proven on chain post the entries. Keep every frozen " +
        "books operation's behaviour. Fork Frappe's accounting only if Capxul-native cannot feel integrated.",
    },
    { label: "keep", text: "Keep the current books design (facts without a chart, Capxul's own chart and reports)." },
  ],
  chosen: "frappe-accounting",
  why: "Aaron, 8 November 2026: the protocol is redesigned around Frappe, and accounting is synced at the bare minimum.",
  source: AARON,
  affects: [f.concept_books],
});

export const decision_aaron_frappe_shape = defineDecision({
  id: "aaron.frappe-shape",
  title: "Accounting and payroll sync with Frappe; CRM and Projects are fundamental",
  question: "Which Frappe apps does every organization start with, and which are added later?",
  options: [
    {
      label: "core-four",
      text:
        "At the bare minimum, an organization's accounting and payroll are designed to sync with Frappe's (ERPNext " +
        "accounting, Frappe HR payroll), and CRM and Projects are fundamental: every organization starts with them, in " +
        "their Frappe shapes. Every other Frappe app is added as a customer needs it, in the start-up step or in " +
        "conversation with the organization's Forward Deployed Engineer agent. The redesign is on the main line, book first, " +
        "before the build.",
    },
    { label: "vision-check", text: "Keep Frappe shapes as a vision check, adopted only where core." },
  ],
  chosen: "core-four",
  why:
    "Aaron, 8 November 2026: 'Capxul should be designed in such a way that at bare minimum the accounting is too, payroll is " +
    "too, synced. There are two applications that are fundamental to how we build our stuff, and that is the CRM and the " +
    "Projects app from Frappe. All the other apps are added as a customer needs them, either in the initialization start-up " +
    "step or in conversation with an FDE agent.'",
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

export const decision_aaron_projects = defineDecision({
  id: "aaron.projects",
  title: "Projects is fundamental: every organization starts with it, in Frappe's shape",
  question: "The old system had no projects. Does the rebuild?",
  options: [
    {
      label: "projects-concept",
      text:
        "Yes: a projects concept in the shape of Frappe's Projects app (projects, tasks and timesheets, or what the real " +
        "doctypes show), present in every organization from the start and synced with a Frappe head when one is connected. " +
        "Its operations are new capabilities, designed book first with a decision pack; they are not among the 215.",
    },
    { label: "later", text: "Add projects when a customer asks." },
  ],
  chosen: "projects-concept",
  why: "Aaron, 8 November 2026: 'there are two applications that are fundamental to how we build our stuff, and that is the CRM and the Projects app from Frappe.'",
  source: AARON,
  affects: [f.system_capxul],
});

export const decision_aaron_fde_agent = defineDecision({
  id: "aaron.fde-agent",
  title: "Every organization has a Forward Deployed Engineer agent",
  question: "Who sets an organization up and adds the Frappe apps it needs beyond the fundamental ones?",
  options: [
    {
      label: "fde-agent",
      text:
        "Every organization has a Forward Deployed Engineer: an AI agent that sets it up in the start-up step and adds the " +
        "apps a customer needs in conversation. It is the organization's own agent (aaron.seats), acting through the same " +
        "CLI and SDK as every other agent, under the organization's authority.",
    },
    { label: "people-only", text: "People set organizations up; no agent of its own." },
  ],
  chosen: "fde-agent",
  why: "Aaron, 8 November 2026: 'other apps are added as a customer needs them, either in the initialization start-up step or in conversation with an FDE agent: a Forward Deployed Engineer, an AI agent that every organization has.'",
  source: AARON,
  affects: [f.concept_agents, f.system_capxul],
});

export const decision_aaron_frappe_head = defineDecision({
  id: "aaron.frappe-head",
  title: "A Frappe head connects to an organization; Capxul is complete without one",
  question: "How does a Frappe site (the head) relate to a Capxul organization?",
  options: [
    {
      label: "optional-head",
      text:
        "An organization is complete without a head: its data already sits in Frappe's shapes. Connecting a Frappe head is " +
        "a separate step; once connected, accounting and payroll (at the least) and CRM and projects sync between the two, " +
        "with Capxul the system of record for money and identity. The connection is an integration designed book first.",
    },
    { label: "head-required", text: "Every organization needs a Frappe site from the start." },
  ],
  chosen: "optional-head",
  why: "Aaron, 8 November 2026: 'when you start a Capxul, you start with all of these things, whether the Frappe head has been connected or not yet; that's a separate thing altogether.'",
  source: AARON,
  affects: [f.system_capxul],
});
