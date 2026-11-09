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

// ── Aaron's fifth batch (8 November 2026): "Yes to all questions" ─────────────────────────────

/** Judgments accepted in the fifth batch; merged into ACCEPTED below. */
const ACCEPTED_5: readonly string[] = ["organizations.agent-cover"]; // payments.claim-escrow-fit: superseded in the sixth batch
(ACCEPTED as string[]).push(...ACCEPTED_5);

export const decision_aaron_claim_trust = defineDecision({
  id: "aaron.claim-trust",
  title: "The beta accepts Companies House as the claim escrow's trust root",
  question:
    "Claim escrows rely on Companies House's claim role to hand an email's Safe only to the person who proved that email; " +
    "its owners (2 of 3 Capxul keys) could redirect an unclaimed Safe. Is that trust accepted for the beta?",
  options: [
    { label: "accept", text: "Yes, for the beta: Capxul hands a Safe only to the person who signed in with that email's code." },
    { label: "harden", text: "No: change the claim before the beta (a recipient-held secret, or a timelock on redirection)." },
  ],
  chosen: "accept",
  why: "Aaron, 8 November 2026: yes to all the open questions, including this one.",
  source: AARON,
  affects: [f.system_capxul],
});

export const decision_aaron_money_waiting_reminders = defineDecision({
  id: "aaron.money-waiting-reminders",
  title: "Waiting money reminds both sides, and admits its recipient to the beta",
  question:
    "Money waiting in a claim escrow has no expiry. Should Capxul remind anyone, and should waiting money admit its " +
    "recipient to the beta (without it, a recipient who is not admitted cannot set up an account, so cannot collect)?",
  options: [
    {
      label: "remind-and-admit",
      text:
        "Yes to both: the recipient is reminded after some days that money is waiting, the payer is told it is still " +
        "uncollected, the recipient is told if the payer takes it back, and waiting money admits its recipient to the beta " +
        "as an invitation does. The days and the wording are designed with the notices, book first.",
    },
    { label: "neither", text: "No reminders and no admission." },
  ],
  chosen: "remind-and-admit",
  why: "Aaron, 8 November 2026: yes to all the open questions, including these two.",
  source: AARON,
  affects: [f.system_capxul],
});

export const decision_aaron_budget_pay_unclaimed = defineDecision({
  id: "aaron.budget-pay-unclaimed",
  title: "A budget holder may pay someone who has no account yet",
  question:
    "Budget spends and dated payments to someone with no account are refused for now, because the escrow's refund would go " +
    "to the company Safe or to the spender. Must a budget holder be able to pay someone with no account?",
  options: [
    {
      label: "yes",
      text:
        "Yes: a budget spend, and a dated payment, may go to someone with no account through a claim escrow. The design " +
        "settles where a refund goes (back to the budget it came from) and who may take it back (the budget's holder or the " +
        "Board), book first.",
    },
    { label: "no", text: "No: the recipient must claim an account first." },
  ],
  chosen: "yes",
  why: "Aaron, 8 November 2026: yes to all the open questions; payroll to new hires needs it.",
  source: AARON,
  affects: [f.system_capxul],
});

export const decision_aaron_buy_seats = defineDecision({
  id: "aaron.buy-seats",
  title: "A company may buy more seats itself",
  question: "Who raises a company's seat limit? Only a Capxul operator, or may a company buy seats?",
  options: [
    {
      label: "buy",
      text:
        "A company may buy more seats itself; a Capxul operator may still raise the limit. The price and how it is paid " +
        "(in stablecoins, from the company Safe) are designed with the organizations concept, book first, and the price is " +
        "Aaron's to set.",
    },
    { label: "operator-only", text: "Only a Capxul operator raises the limit." },
  ],
  chosen: "buy",
  why: "Aaron, 8 November 2026: yes to all the open questions, including whether a company may buy seats itself. The reading of the seat ruling (ten people, one agent per seat, plus the company's own) is confirmed (organizations.agent-cover).",
  source: AARON,
  affects: [f.concept_agents, f.concept_access],
});

// The fifth batch also supersedes two judgments; the next design pass rewrites them, book first.
Object.assign(SUPERSEDED as Record<string, string>, {
  "payments.claim-escrow-routes": "aaron.budget-pay-unclaimed",
  "organizations.seat-limit": "aaron.buy-seats",
});

// ── Aaron's sixth batch (8 November 2026): departments, the general escrow, the hosted FDE, test prices ────────
// He answered the 32 questions in docs/decisions/open-for-aaron.md: "I agree with the ones I didn't mention."

const AARON_6 = "Aaron, 8 November 2026, in the build-preparation conversation (sixth batch)";

export const decision_aaron_escrow_general = defineDecision({
  id: "aaron.escrow-general",
  title: "One general escrow: the recipient's future account claims; the sender reclaims",
  question: "How must the claim escrow work, and what changes: the escrow or Budgets?",
  options: [
    {
      label: "general-escrow",
      text:
        "The escrow is deployed counterfactually. Its owner is the recipient's account address before that account exists, " +
        "and the owner may claim the money whenever they want. As an escape hatch the sender may always take the money " +
        "back until it is claimed. It is a general-purpose escrow, used for other things too, and keeps these properties. " +
        "The escrow contract changes; Budgets does not.",
    },
    { label: "budgets-change", text: "Add claim-escrow functions to Budgets.sol (the money group's design)." },
  ],
  chosen: "general-escrow",
  why:
    "Aaron, 8 November 2026: 'You're supposed to be able to deploy a contract counterfactually, which is the escrow " +
    "contract. The owner of that escrow contract is the address of the undeployed owner. They can claim that money " +
    "whenever they want to. As an escape hatch, the sender can always claim the money back until the claimer has. This is " +
    "a generalizable escrow, because we're also going to use it for other things, but it needs those properties. We don't " +
    "need to change the budgets. We need to change the escrow.'",
  source: AARON_6,
  affects: [f.concept_payments, f.concept_budgets],
});

export const decision_aaron_departments = defineDecision({
  id: "aaron.departments",
  title: "Budgets belong to departments; people are swapped in and out by hat",
  question: "Who holds authority over a budget's money: a person, or the department the budget belongs to?",
  options: [
    {
      label: "departments",
      text:
        "A budget belongs to a department, as v4 has it: a budget in the company Safe's tree with its own hat, where " +
        "Budgets.authorised admits the Safe and whoever wears the budget's hat or an ancestor's. People are swapped in and " +
        "out of a department by its hat, so every action on its money is the department's, taken by whoever wears the hat " +
        "at the time. The book's authority statements follow the v4 contracts.",
    },
    { label: "people", text: "Authority over a budget's money follows the person who holds or spent it." },
  ],
  chosen: "departments",
  why:
    "Aaron, 8 November 2026: 'There's a concept of departments. Look at the v4 contract properly. There seems to be a " +
    "misunderstanding with who can do what. The whole purpose of the departments is that budgets belong to departments, " +
    "and you can swap people in and out of departments.'",
  source: AARON_6,
  affects: [f.concept_budgets, f.concept_payments, f.concept_organizations],
});

export const decision_aaron_fde_hosted = defineDecision({
  id: "aaron.fde-hosted",
  title: "Capxul hosts each Organization's FDE as a durable agent; they pay for hosting",
  question: "Where does an Organization's Forward Deployed Engineer run, and who holds its key?",
  options: [
    {
      label: "hosted",
      text:
        "Not on the founder's machine: the FDE is a durable agent on a durable runtime with sandboxes, which Capxul runs " +
        "for the Organization; the Organization pays Capxul for hosting it.",
    },
    { label: "founder-machine", text: "Created in the founder's install, its key made on the founder's machine." },
  ],
  chosen: "hosted",
  why:
    "Aaron, 8 November 2026: 'The FDE is not hosted on their machine. It's hosted on a durable agent that's hosted on a " +
    "durable runtime with sandboxes. That's how it works. And we handle that for the users. They pay us for hosting it.'",
  source: AARON_6,
  affects: [f.concept_organizations, f.concept_agents],
});

export const decision_aaron_test_prices = defineDecision({
  id: "aaron.test-prices",
  title: "Test prices: a seat 10 USDC once; the hosted FDE 20 USDC a month",
  question: "What do an extra seat and a hosted FDE cost?",
  options: [
    {
      label: "made-up",
      text:
        "Made-up prices on the test USDC, both deployment settings changed freely: SEAT_PRICE 10 USDC per seat, paid once; " +
        "FDE_HOSTING_PRICE 20 USDC a month per Organization.",
    },
    { label: "unset", text: "Leave both unset, so buying is refused until Aaron sets them." },
  ],
  chosen: "made-up",
  why: "Aaron, 8 November 2026: 'Pricing and all that kind of stuff, you can just make it up. It doesn't matter. It's fake money. It's fake USDC.'",
  source: AARON_6,
  affects: [f.concept_organizations, f.concept_payments],
});

/** The recommendations put to Aaron on 8 November 2026 that he accepted ("I agree with the ones I didn't mention"). */
const ACCEPTED_6: readonly string[] = [
  "environments.staging", "rules.global-tenancy", "rules.new-operations", "system.size", "tooling.branch-protection",
  "swarm.accounts", "parties.mailbox-for-life", "parties.outside-companies", "organizations.apps-native-or-head",
  "organizations.buy-seats", "organizations.commands", "organizations.head-ownership", "board.dropped",
  "board.failed-proposal", "board.no-agent-directors", "agents.fde-authority", "agents.fde-people-hat",
  "projects.commands", "projects.permissions", "books.head-vouchers", "books.capxul-assets", "contacts.crm-capabilities",
  "payroll.hr-surface", "payments.birth-width", "payroll.one-computer-per-run",
];
(ACCEPTED as string[]).push(...ACCEPTED_6);

/** Decisions that carry out one of Aaron's rulings: they cite him, but ask him nothing. */
export const CARRIES_OUT: readonly string[] = [
  "concepts.map", "accounts.door", "accounts.worlds", "projects.bill-time", "books.payroll-accrual", "books.sync",
  "notices.money-waiting-reminders", "devnet.fde-worlds", "devnet.head-stand-in", "devnet.money-waiting-world",
];

// The sixth batch supersedes these; the commands-and-escrow pass rewrites them, book first.
Object.assign(SUPERSEDED as Record<string, string>, {
  "concepts.payroll": "aaron.frappe-shape",
  "payments.claim-escrow-routes": "aaron.escrow-general",
  "budgets.claim-escrows": "aaron.escrow-general",
  "payments.claim-escrow-fit": "aaron.escrow-general",
  "organizations.fde-at-start-up": "aaron.fde-hosted",
});

// Seventh batch (8 November 2026): "Agreed on both. Agree with your recommendation on both."
(ACCEPTED as string[]).push("accounts.money-waiting-admits", "requests.bill-time");

// ── Aaron's eighth batch (8 November 2026, evening and night): the world, the SDK, the claim, the FDE ────────────
const AARON_8 = "Aaron, 8 November 2026, in the build-preparation conversation (eighth batch)";

export const decision_aaron_world_clock = defineDecision({
  id: "aaron.world-clock",
  title: "Each world is self-contained, and everything in it follows its one clock",
  question: "What follows a world's clock, and how fast may a world run?",
  options: [
    {
      label: "everything",
      text:
        "A devnet, a staging network or a shared world is a self-contained world whose clock is controlled, and " +
        "everything in it follows that clock: the chain, the backend, Ponder, emails, WhatsApp, the Frappe head and the " +
        "FDE. A shared world may run faster than real time (every real hour moves its clock four), so the clock has a " +
        "rate beside frozen and running. Outside channels belong to the world: a devnet's mail goes to its sink, WhatsApp " +
        "to a stand-in, and a connected head follows the world's clock.",
    },
    { label: "chain-only", text: "Only the chain and the backend follow the world's clock; outside channels run on real time." },
  ],
  chosen: "everything",
  why:
    "Aaron, 8 November 2026: 'The reason why we focused on the clock so much is partly for this Frappe stuff as well. " +
    "This should be its own self-contained world: a devnet, a staging network, or a shared world where you control the " +
    "clock, where every hour the clock moves forward four. Emails, everything should all sync up with the world clock.'",
  source: AARON_8,
  affects: [f.system_capxul],
});

export const decision_aaron_sdk_reaches_everything = defineDecision({
  id: "aaron.sdk-reaches-everything",
  title: "The Core SDK and the CLI reach every capability, native or on the head",
  question: "Which surfaces reach every capability, including what lives only on a connected Frappe head?",
  options: [
    {
      label: "sdk-and-cli",
      text:
        "The Core SDK and the CLI reach everything: native concepts through their own commands, and what lives only on " +
        "a connected head through a generic document family over the SDK, with the caller's authority, logged, on the " +
        "world's clock. The React SDK does not mirror it all; whoever needs a React screen builds it on the Core SDK.",
    },
    { label: "every-surface", text: "The CLI, the MCP server and the React SDK all reach everything." },
  ],
  chosen: "sdk-and-cli",
  why:
    "Aaron, 8 November 2026: 'Everything is accessible through the SDK or the CLI. You should be able to connect to " +
    "everything from those surfaces.' Then: 'I don't think the React SDK should get everything. Draw the line at the CLI " +
    "and the SDK. If anyone needs to implement something in React, they can. Frappe doesn't even use React.'",
  source: AARON_8,
  affects: [f.system_capxul],
});

export const decision_aaron_payment_claim = defineDecision({
  id: "aaron.payment-claim",
  title: "The recipient claims waiting money with `payment claim`; the sender cancels",
  question: "What is the command a recipient runs to take waiting money, whenever they want?",
  options: [
    { label: "payment-claim", text: "`payment claim`; the sender's take-back stays `payment cancel`." },
    { label: "account-collect", text: "`account collect`." },
  ],
  chosen: "payment-claim",
  why: "Aaron, 8 November 2026: 'I don't think it should be called collect. Claim, that's fine. Payment claim sounds fine. Payment cancel is fine.'",
  source: AARON_8,
  affects: [f.concept_payments],
});

export const decision_aaron_fde_anyone = defineDecision({
  id: "aaron.fde-anyone",
  title: "Anyone in the Organization may talk to its FDE, within their own hats",
  question: "Who may talk to an Organization's hosted FDE?",
  options: [
    {
      label: "anyone",
      text:
        "Any member, or anyone the Organization's management works with: the host passes the asker's Seat, so the FDE " +
        "does for them only what their own hats allow. The FDE is not on the critical path.",
    },
    { label: "director", text: "Only a Director." },
  ],
  chosen: "anyone",
  why: "Aaron, 8 November 2026: 'I think anyone should be able to talk to the FDE, or anyone that the management is speaking to. The FDE is not on the critical path anyway.'",
  source: AARON_8,
  affects: [f.concept_organizations],
});

(ACCEPTED as string[]).push("organizations.fde-hosting", "payments.seat-authority", "payments.seat-purchase");
Object.assign(SUPERSEDED as Record<string, string>, {
  "accounts.collect-any-time": "aaron.payment-claim",
  "organizations.fde-commands": "aaron.fde-anyone",
});

// The world pass's decisions that carry out the eighth batch: they cite Aaron and ask him nothing.
(CARRIES_OUT as string[]).push(
  "time.world-channels",
  "organizations.command-priorities",
  "organizations.doc-log",
  "organizations.fde-guests",
  "contacts.conversations-head-sync",
  "contacts.conversations-on-the-world-clock",
  "contacts.crm-mailbox",
  "contacts.crm-permission",
  "contacts.timeline",
  "contacts.whatsapp-connect",
  "contacts.whatsapp-window",
  "payments.claim-command",
  "payroll.hr-head-sync",
  "payroll.hr-rpc-methods",
  "payroll.hr-scope",
  "payroll.hr-world-clock",
  "payroll.shift-types",
  "devnet.fde-host-follows-world",
  "devnet.follow-at-a-rate",
  "devnet.head-follows-world",
  "devnet.whatsapp-stand-in",
);

// ── Aaron's ninth batch (9 November 2026): the world pass's questions, and seasons ──────────────────────────────
const AARON_9 = "Aaron, 9 November 2026, in the build-preparation conversation (ninth batch)";

export const decision_aaron_seasons = defineDecision({
  id: "aaron.seasons",
  title: "A shared world runs in seasons, like a game: time jumps, then a reset",
  question: "How does a shared world's time move, and how does it end?",
  options: [
    {
      label: "seasons",
      text:
        "A shared world runs in seasons, like a game. A season starts from a known world, runs its clock at a rate, " +
        "jumps time on a schedule, and ends in a reset, after which the next season starts. Players join a season.",
    },
    { label: "open-ended", text: "A shared world runs for as long as its owner keeps it, and only the owner moves its clock." },
  ],
  chosen: "seasons",
  why: "Aaron, 9 November 2026: 'Agreed with all, but we need a shared world that gets time jumps and resets, as part of a season, like a game sort of thing.'",
  source: AARON_9,
  affects: [f.system_capxul],
});

// He accepted the world pass's questions, except the shared world (seasons above) and HR's commands (asked again).
(ACCEPTED as string[]).push(
  "devnet.clock-rate", "time.worlds", "organizations.doc-family", "organizations.doc-reach",
  "organizations.fde-for-the-asker", "contacts.conversation-commands", "contacts.timeline-money",
  "contacts.attachments-later", "payroll.hr-approvers",
);
Object.assign(SUPERSEDED as Record<string, string>, { "devnet.shared-world": "aaron.seasons" });
