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
};

/** Judgments Aaron reopened on 8 November 2026: they are redesigned, or asked again with context. */
export const REOPENED: readonly string[] = [];

export const decision_aaron_erp_on_capxul = defineDecision({
  id: "aaron.erp-on-capxul",
  title: "The vision: an agentic ERP on stablecoins, built on Capxul; not built now",
  question: "What is Capxul ultimately for, and how much of that is built now?",
  options: [
    {
      label: "vision-not-build",
      text:
        "The long-term target is an agentic ERP that runs on stablecoins: an opinionated front end to Capxul, tailored to " +
        "real business, built on Frappe and ERPNext (forking only what must feel integrated, accounting most likely, and " +
        "ideally nothing). Running on stablecoins is simply how it runs. All of it is speculative now. The thinking is on the " +
        "main line, so that what is built supports the vision; the work is not. The main line now is the baseline of the new " +
        "product (the rebuilt Capxul) and the starter kit.",
    },
    { label: "build-now", text: "Design and build the ERP layer alongside the baseline." },
  ],
  chosen: "vision-not-build",
  why:
    "Aaron, 8 November 2026: 'the goal is we're going to build an agentic ERP that runs on stablecoins... an opinionated " +
    "front end to Capxul, but tailored to real business. Right now all of this is very speculative. I want the thinking on " +
    "this to be on the main line, making sure that whatever we build supports that longer-term vision, but I don't want that " +
    "to be the thing that we're building right now. The main thing we're building right now is the baseline for the new " +
    "product, and, just as important, the starter kit.' The one clock matters because the larger system will run on it too.",
  source: AARON,
  affects: [f.system_capxul],
});

export const decision_aaron_crm_frappe_shape = defineDecision({
  id: "aaron.crm-frappe-shape",
  title: "The directory of people is global; its Frappe CRM shape is part of the vision",
  question: "parties.directory-tenancy made the directory of people global. What is it, and whose shape does it take?",
  options: [
    {
      label: "global-crm-vision",
      text:
        "Yes, global: one directory of people and companies across every tenant, a global CRM. Its fit with Frappe CRM is " +
        "thought through in the vision note; the baseline keeps its own shape unless that fit touches the core.",
    },
    { label: "global-frappe-now", text: "Global, reshaped now into Frappe CRM's doctypes." },
  ],
  chosen: "global-crm-vision",
  why: "Aaron, 8 November 2026: yes to a global directory of people, a global CRM; the Frappe direction is the speculative vision.",
  source: AARON,
  affects: [f.concept_parties, f.concept_contacts],
});

export const decision_aaron_books_first_principles = defineDecision({
  id: "aaron.books-first-principles",
  title: "Accounting on Frappe is thought through in the vision note, not redesigned now",
  question: "With accounting likely a Frappe fork in the long run, what happens to Capxul's books concept now?",
  options: [
    {
      label: "think-not-redesign",
      text:
        "The books concept keeps its design on the main line. The vision note thinks through accounting on a Frappe fork " +
        "from first principles (what Capxul must record so a ledger can post it, and what the ledger owns). A place where the " +
        "baseline would block that comes back to Aaron as a question before anything changes.",
    },
    { label: "redesign", text: "Redesign the books now as a Capxul-native fork of Frappe's accounting." },
  ],
  chosen: "think-not-redesign",
  why: "Aaron, 8 November 2026: the ERP is speculative; think it through on the main line, do not build it now.",
  source: AARON,
  affects: [f.concept_books],
});

export const decision_aaron_frappe_shape = defineDecision({
  id: "aaron.frappe-shape",
  title: "Frappe shapes are a vision check, adopted on the main line only where core",
  question: "How far does the baseline take Frappe's shapes now?",
  options: [
    {
      label: "vision-check",
      text:
        "The baseline keeps its own design. A speculative vision note (docs/vision/erp.md) thinks through how the ERP on " +
        "Frappe would sit on Capxul (people and companies, accounting, payroll and payslips from on-chain pay, projects) and " +
        "checks the baseline does not block it. A Frappe shape is adopted on the main line only where it touches Capxul's " +
        "core, and then as a decision Aaron takes; everything else stays speculative.",
    },
    { label: "map-now", text: "Map every critical-path concept onto Frappe's doctypes before the build." },
  ],
  chosen: "vision-check",
  why:
    "Aaron, 8 November 2026, correcting the earlier reading: the ERP and Frappe work is very speculative unless it touches the " +
    "core parts; the thinking goes on the main line, the work does not.",
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
