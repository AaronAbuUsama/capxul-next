// Aaron's rulings of 8 November 2026 (his second batch of answers), as decision records with him as
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
];

/** Judgments Aaron reopened on 8 November 2026: they are redesigned, or asked again with context. */
export const REOPENED: readonly string[] = ["books.facts-without-chart", "payroll.scope"];

export const decision_aaron_erp_on_capxul = defineDecision({
  id: "aaron.erp-on-capxul",
  title: "The ERP is built on top of Capxul, with Frappe as its application layer",
  question: "What is the rebuild for, beyond the frozen operations, and what must its data model allow?",
  options: [
    {
      label: "erp-on-capxul",
      text:
        "Capxul is the money, identity and governance layer under an ERP built on Frappe: Frappe CRM for people and " +
        "companies, Frappe's accounting for the books, and possibly a fork of Frappe HR's payroll made Capxul-native. " +
        "Where Capxul and Frappe hold the same things (people, companies, contacts, money facts, pay), Capxul keeps its " +
        "data in shapes that map onto Frappe's doctypes, so the ERP reads Capxul without a translation layer of its own.",
    },
    { label: "standalone", text: "Capxul stands alone; any ERP integrates later through its public API." },
  ],
  chosen: "erp-on-capxul",
  why:
    "Aaron, 8 November 2026: 'the idea of how this rebuild is going to be used is, we are going to build the ERP on top of " +
    "Capxul', with the CRM and accounting from Frappe and payroll a candidate to fork. Designing the shared shapes now costs " +
    "little; a translation layer later is a second system to keep in step.",
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

export const decision_aaron_payroll_frappe = defineDecision({
  id: "aaron.payroll-frappe",
  title: "Payroll may be a fork of Frappe HR's payroll, made Capxul-native",
  question: "How does Capxul's payroll relate to the ERP's?",
  options: [
    {
      label: "consider-fork",
      text:
        "Treat Frappe HR's payroll app as the candidate to fork and make Capxul-native (pay moving on Capxul's rails), and " +
        "design Capxul's payroll concept so that fork can sit on it. Whether to fork is a decision pack before B4 builds " +
        "payroll; payroll.scope is reopened with it.",
    },
    { label: "own-payroll", text: "Capxul designs its own payroll in full." },
  ],
  chosen: "consider-fork",
  why:
    "Aaron, 8 November 2026: payroll is 'one of the areas that we can potentially think about forking their payroll app, so " +
    "we can make it Capxul native.'",
  source: AARON,
  affects: [f.concept_payroll],
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

export const decision_aaron_portal_fumadocs = defineDecision({
  id: "aaron.portal-fumadocs",
  title: "Keep Fumadocs for the portal",
  question: "The starter kit renders its portal with a small generator and no dependencies. Does Capxul's portal follow it?",
  options: [
    {
      label: "keep-fumadocs",
      text:
        "Keep Fumadocs (portal.stack). How the starter kit's light generator relates to it (the same generated content " +
        "rendered by both, or Fumadocs for the full portal and the generator for quick local views) is asked again.",
    },
    { label: "generator-only", text: "Use the dependency-free generator for Capxul's portal too." },
  ],
  chosen: "keep-fumadocs",
  why: "Aaron, 8 November 2026: agreed with the light approach, 'but we should also keep Fumadocs'.",
  source: AARON,
  affects: [f.system_capxul],
});
