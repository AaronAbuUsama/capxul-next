/**
 * HAND-WRITTEN. Everything else on the portal is generated from the blueprint; this one file is not.
 *
 * It holds the words and the picture the blueprint does not hold yet: the direction of 9 November 2026 (START-HERE.md),
 * the re-cut verdict per concept, the architecture diagram, and the settings of the review flow. Each of these
 * leaves this file when the blueprint gains a record for it. Change the words here, never in the renderer.
 */
import type { Direction } from "./shape.ts";

const box = { tone: "plain", note: "", chips: [] } as const;
const down = { direction: "down", tone: "grey", label: "", labelX: 0, labelY: 0 } as const;

export const direction: Direction = {
  settings: { repo: "https://github.com/AaronAbuUsama/capxul-next", reviewer: "aaron", issueLabel: "review" },

  hero: {
    eyebrow: "The design and its recorded progress",
    title: "Capxul is the on-chain company.",
    lead: "A complete business system on Frappe, with Capxul Core built in: identity, the organisation and its authority, budgets, payments, governance and banking.",
    sub: "This portal brings together the blueprint, the plan and recorded eval results at the displayed build. Pages are snapshots: changes appear after regeneration. The questions that need you are in one place.",
  },
  needsYou: "Each has a recommendation. Accept it, choose another option, or change it in your own words.",
  climb: { specify: "", build: "", prove: "" },
  banner: {
    title: "The blueprint follows the Frappe-native direction.",
    text: "Core and the plugs stay in full. What Frappe owns (projects, payroll and HR, the CRM, the chart and reports of the books, printing, sellable services) has left the built blueprint and is reached through the door. Equity, the hosted FDE and the referral and waitlist operations are parked, not decided. Nothing was deleted: docs/cut-archive/INDEX.md lists every record that moved, why, and what carries it. The blueprint now includes plugs, sites and the door; the counts above show recorded progress, not a claim that implementation is complete.",
  },

  // One line per concept once the re-cut decides it: `payments: "core"`. A concept not named here has no verdict.
  verdicts: {
    access: "core", media: "core", parties: "core", indexing: "core", approvals: "core", accounts: "core", organizations: "core",
    board: "core", agents: "core", budgets: "core", payments: "core", banking: "core", requests: "core", applications: "core",
    activity: "core", notices: "core", devnet: "core", documents: "core",
    books: "frappe", contacts: "frappe",
  },
  verdictNote:
    "Core stays in full. Frappe-owned means Frappe holds it and the door reaches it; books keeps only the chain reader and contacts only the payee address book until stage 3. Payroll's pay agreements moved into payments. Projects and payroll left the built blueprint; equity is parked, not decided (cut.equity-parked).",

  questions: {
    lead: "Everything that waits on you, in one list: the decisions only you can make, and the tasks of the plan that need something only you can do or say. On the local portal server, your answer is saved to plan/answers.jsonl; on static hosting, answering opens a prefilled GitHub issue instead. The coordinator applies it, to the record first, then the code.",
    answerSteps: [
      { title: "Saved", text: "With the local portal server, your answer is saved in plan/answers.jsonl and can be undone until applied. Static hosting opens a prefilled GitHub issue; it does not save an answer on this machine." },
      { title: "Applied", text: "The coordinator writes the ruling into the blueprint, or unblocks the task, and marks your answer applied. Nothing is automatic." },
      { title: "Rebuilt", text: "The blueprint rebuilds to 0 problems, with a preview of this portal." },
      { title: "Settled", text: "Checked and merged. The question leaves this page." },
    ],
  },

  architecture: {
    title: "How the pieces fit",
    lead: "A company runs on a Frappe site. Capxul Core sits beside it and holds what only the chain can make true: who may act, and where the money is.",
    diagram: {
      width: 1176, height: 580,
      nodes: [
        { ...box, x: 0, y: 0, w: 280, h: 96, title: "People", text: "Web app, CLI and SDK" },
        { ...box, x: 320, y: 0, w: 280, h: 96, title: "Agents", text: "The same commands, under the same authority as people" },
        { ...box, x: 720, y: 0, w: 456, h: 96, title: "Company staff", text: "The desk: Frappe's own screens, re-skinned" },
        {
          x: 0, y: 176, w: 600, h: 200, tone: "core", title: "Capxul Core", note: "what this repository rebuilds",
          text: "Holds authority and money. Everything it does is one of the blueprint's operations.",
          chips: ["identity and sign-in", "organisation tree", "authority (hats)", "budgets", "payments", "governance", "banking"],
        },
        {
          x: 720, y: 176, w: 456, h: 200, tone: "frappe", title: "Frappe site", note: "one per company",
          text: "ERPNext keeps the company's records. Capxul does not rebuild these.",
          chips: ["books", "HR", "payroll calculation", "CRM", "projects"],
        },
        { ...box, x: 0, y: 480, w: 184, h: 100, title: "Chain", text: "Safes, hats, Budgets and Payments contracts" },
        { ...box, x: 208, y: 480, w: 184, h: 100, title: "OpenFort", text: "Wallets and sign-in" },
        { ...box, x: 416, y: 480, w: 184, h: 100, title: "Bridge", text: "Bank accounts for fiat" },
        {
          x: 720, y: 480, w: 456, h: 100, tone: "rule", title: "The one rule", note: "", chips: [],
          text: "Authority and money flow down from the chain. Facts flow up from Frappe as hashes.",
        },
      ],
      edges: [
        { ...down, x: 132, y: 96, length: 80 },
        { ...down, x: 452, y: 96, length: 80 },
        { ...down, x: 940, y: 96, length: 80 },
        { x: 600, y: 226, length: 120, direction: "right", tone: "blue", label: "permissions mirror authority", labelX: 604, labelY: 190 },
        { x: 600, y: 316, length: 120, direction: "left", tone: "grey", label: "facts, as hashes", labelX: 604, labelY: 336 },
        { ...down, x: 84, y: 376, length: 104 },
        { ...down, x: 292, y: 376, length: 104 },
        { ...down, x: 500, y: 376, length: 104 },
      ],
    },
    portalDecisions: ["portal.hosting", "portal.stack", "portal.read-only", "portal.review-flow"],
    traceOperation: "payment.send",
    // Where the Frappe boundary is found in the blueprint: the component, the outside system, and the word in a record's text.
    boundary: { component: "frappe-app", system: "frappe", word: "DocType" },
    changeSteps: [
      { title: "The record changes", text: "With a decision record beside it. Never the page." },
      { title: "The blueprint rebuilds", text: "To 0 problems, or the change stops here." },
      { title: "A pull request opens", text: "With its own preview of the portal." },
      { title: "A checker reviews it", text: "Then it merges to integration/build." },
      { title: "The portal redeploys", text: "Generated pages reflect the inputs at their build; later changes need regeneration and deployment." },
    ],
  },
};
