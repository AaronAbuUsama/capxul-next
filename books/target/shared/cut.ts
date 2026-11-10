// The cut (10 November 2026): the book is re-cut to Aaron's direction (aaron.frappe-native, aaron.one-door, START-HERE
// section 6). These are the coordinator's decisions, taken on Aaron's delegation ("It's yours to own... you tell me what
// needs to be done") and recorded so he can overrule them. Their source starts "The coordinator", never "Aaron", so none
// of them shows as his ruling (shared/waiting.ts); the four that need his answer wait for him there.
//
// CUT is plain data, not records: for each of the 215 frozen operations that is no longer booked in the built book, the
// fate it has and the decision that classified it. tools/check-frozen.ts requires every frozen operation to be booked
// exactly once or to have an entry here. docs/cut-archive/ holds everything that left, with an index (tools/report-cut.ts).

import { defineDecision } from "../../../packages/book/src/index.ts";
import * as f from "./foundation.ts";
import { decision_aaron_frappe_native, decision_aaron_one_door } from "./rulings.ts";

/** What became of a frozen operation: Frappe owns it (reached), the cut removes it (dropped) or it waits outside the built book (parked). */
export type CutFate = "reached" | "dropped" | "parked";
export interface Cut {
  readonly fate: CutFate;
  /** The decision that classified it: its text names the operation and what carries it. */
  readonly decision: string;
  /** The Core operation or plug that carries what it did that still matters, or what replaces it. */
  readonly carriedBy: string;
}

export const CUT = {
  "org.books.accounts.import": { fate: "reached", decision: "cut.books", carriedBy: "ERPNext Accounts through the door (`doc` on Account, Journal Entry; the chart importer)" },
  "org.books.accounts.list": { fate: "reached", decision: "cut.books", carriedBy: "ERPNext Accounts through the door (`doc` on Account, Journal Entry; the chart importer)" },
  "org.books.accounts.add": { fate: "reached", decision: "cut.books", carriedBy: "ERPNext Accounts through the door (`doc` on Account, Journal Entry; the chart importer)" },
  "org.books.accounts.rename": { fate: "reached", decision: "cut.books", carriedBy: "ERPNext Accounts through the door (`doc` on Account, Journal Entry; the chart importer)" },
  "org.books.accounts.archive": { fate: "reached", decision: "cut.books", carriedBy: "ERPNext Accounts through the door (`doc` on Account, Journal Entry; the chart importer)" },
  "org.books.accounts.review": { fate: "reached", decision: "cut.books", carriedBy: "ERPNext Accounts through the door (`doc` on Account, Journal Entry; the chart importer)" },
  "org.books.accounts.reclassify": { fate: "reached", decision: "cut.books", carriedBy: "ERPNext Accounts through the door (`doc` on Account, Journal Entry; the chart importer)" },
  "org.books.export.quickbooks": { fate: "dropped", decision: "cut.books", carriedBy: "nothing: dropped; Frappe has its own exports" },
  "org.books.reports.balance-sheet": { fate: "reached", decision: "cut.books", carriedBy: "an ERPNext report through the door (`report run`: Balance Sheet)" },
  "org.books.reports.profit-and-loss": { fate: "reached", decision: "cut.books", carriedBy: "an ERPNext report through the door (`report run`: Profit and Loss Statement)" },
  "org.books.reports.reconcile": { fate: "reached", decision: "cut.books", carriedBy: "an ERPNext report through the door (`report run`: Bank Reconciliation Tool)" },
  "org.books.reports.trial-balance": { fate: "reached", decision: "cut.books", carriedBy: "an ERPNext report through the door (`report run`: Balance Sheet)" },
  "service.create": { fate: "parked", decision: "cut.requests", carriedBy: "ERPNext Item and Payment Request through the door; `request issue` makes the payer's request" },
  "service.revise": { fate: "parked", decision: "cut.requests", carriedBy: "ERPNext Item and Payment Request through the door; `request issue` makes the payer's request" },
  "service.deactivate": { fate: "parked", decision: "cut.requests", carriedBy: "ERPNext Item and Payment Request through the door; `request issue` makes the payer's request" },
  "service.get": { fate: "parked", decision: "cut.requests", carriedBy: "ERPNext Item and Payment Request through the door; `request issue` makes the payer's request" },
  "service.list": { fate: "parked", decision: "cut.requests", carriedBy: "ERPNext Item and Payment Request through the door; `request issue` makes the payer's request" },
  "document.render": { fate: "reached", decision: "cut.documents", carriedBy: "Frappe Print Format through the door (`doc print`)" },
  "document.export": { fate: "reached", decision: "cut.documents", carriedBy: "Frappe Print Format through the door (`doc print`)" },
  "org.equity.setup": { fate: "parked", decision: "cut.equity", carriedBy: "nothing until Aaron settles equity (cut.equity-parked)" },
  "org.equity.issue": { fate: "parked", decision: "cut.equity", carriedBy: "nothing until Aaron settles equity (cut.equity-parked)" },
  "org.cap-table": { fate: "parked", decision: "cut.equity", carriedBy: "nothing until Aaron settles equity (cut.equity-parked)" },
  "org.options.grant": { fate: "parked", decision: "cut.equity", carriedBy: "nothing until Aaron settles equity (cut.equity-parked)" },
  "org.options.end": { fate: "parked", decision: "cut.equity", carriedBy: "nothing until Aaron settles equity (cut.equity-parked)" },
  "org.options.show": { fate: "parked", decision: "cut.equity", carriedBy: "nothing until Aaron settles equity (cut.equity-parked)" },
  "shares.accept": { fate: "parked", decision: "cut.equity", carriedBy: "nothing until Aaron settles equity (cut.equity-parked)" },
  "shares.exercise": { fate: "parked", decision: "cut.equity", carriedBy: "nothing until Aaron settles equity (cut.equity-parked)" },
  "shares": { fate: "parked", decision: "cut.equity", carriedBy: "nothing until Aaron settles equity (cut.equity-parked)" },
  "shares.convert": { fate: "parked", decision: "cut.equity", carriedBy: "nothing until Aaron settles equity (cut.equity-parked)" },
  "shares.sell": { fate: "parked", decision: "cut.equity", carriedBy: "nothing until Aaron settles equity (cut.equity-parked)" },
  "org.equity.transfer.approve": { fate: "parked", decision: "cut.equity", carriedBy: "nothing until Aaron settles equity (cut.equity-parked)" },
  "org.exit.preview": { fate: "parked", decision: "cut.equity", carriedBy: "nothing until Aaron settles equity (cut.equity-parked)" },
  "org.exit.pay": { fate: "parked", decision: "cut.equity", carriedBy: "nothing until Aaron settles equity (cut.equity-parked)" },
  "org.round.preview": { fate: "parked", decision: "cut.equity", carriedBy: "nothing until Aaron settles equity (cut.equity-parked)" },
  "org.round.create": { fate: "parked", decision: "cut.equity", carriedBy: "nothing until Aaron settles equity (cut.equity-parked)" },
  "org.round.invite": { fate: "parked", decision: "cut.equity", carriedBy: "nothing until Aaron settles equity (cut.equity-parked)" },
  "org.round.allocate": { fate: "parked", decision: "cut.equity", carriedBy: "nothing until Aaron settles equity (cut.equity-parked)" },
  "org.round.close": { fate: "parked", decision: "cut.equity", carriedBy: "nothing until Aaron settles equity (cut.equity-parked)" },
  "org.round.cancel": { fate: "parked", decision: "cut.equity", carriedBy: "nothing until Aaron settles equity (cut.equity-parked)" },
  "org.round.show": { fate: "parked", decision: "cut.equity", carriedBy: "nothing until Aaron settles equity (cut.equity-parked)" },
  "org.safe.create": { fate: "parked", decision: "cut.equity", carriedBy: "nothing until Aaron settles equity (cut.equity-parked)" },
  "org.safe.invite": { fate: "parked", decision: "cut.equity", carriedBy: "nothing until Aaron settles equity (cut.equity-parked)" },
  "org.safe.close": { fate: "parked", decision: "cut.equity", carriedBy: "nothing until Aaron settles equity (cut.equity-parked)" },
  "org.safe.show": { fate: "parked", decision: "cut.equity", carriedBy: "nothing until Aaron settles equity (cut.equity-parked)" },
  "invest": { fate: "parked", decision: "cut.equity", carriedBy: "nothing until Aaron settles equity (cut.equity-parked)" },
  "invest.show": { fate: "parked", decision: "cut.equity", carriedBy: "nothing until Aaron settles equity (cut.equity-parked)" },
  "invest.commit": { fate: "parked", decision: "cut.equity", carriedBy: "nothing until Aaron settles equity (cut.equity-parked)" },
  "invest.pay": { fate: "parked", decision: "cut.equity", carriedBy: "nothing until Aaron settles equity (cut.equity-parked)" },
  "invest.sign": { fate: "parked", decision: "cut.equity", carriedBy: "nothing until Aaron settles equity (cut.equity-parked)" },
  "org.vote.create": { fate: "parked", decision: "cut.equity", carriedBy: "nothing until Aaron settles equity (cut.equity-parked)" },
  "org.vote.execute": { fate: "parked", decision: "cut.equity", carriedBy: "nothing until Aaron settles equity (cut.equity-parked)" },
  "org.vote.list": { fate: "parked", decision: "cut.equity", carriedBy: "nothing until Aaron settles equity (cut.equity-parked)" },
  "org.vote.show": { fate: "parked", decision: "cut.equity", carriedBy: "nothing until Aaron settles equity (cut.equity-parked)" },
  "org.vote.wait": { fate: "parked", decision: "cut.equity", carriedBy: "nothing until Aaron settles equity (cut.equity-parked)" },
  "vote.cast": { fate: "parked", decision: "cut.equity", carriedBy: "nothing until Aaron settles equity (cut.equity-parked)" },
  "vote.delegate": { fate: "parked", decision: "cut.equity", carriedBy: "nothing until Aaron settles equity (cut.equity-parked)" },
  "vote.list": { fate: "parked", decision: "cut.equity", carriedBy: "nothing until Aaron settles equity (cut.equity-parked)" },
  "referral.invite": { fate: "parked", decision: "cut.individuals", carriedBy: "parked until individuals are settled (cut.individuals-parked)" },
  "referral.list": { fate: "parked", decision: "cut.individuals", carriedBy: "parked until individuals are settled (cut.individuals-parked)" },
  "referral.show": { fate: "parked", decision: "cut.individuals", carriedBy: "parked until individuals are settled (cut.individuals-parked)" },
  "waitlist.invites.grant": { fate: "parked", decision: "cut.individuals", carriedBy: "parked until individuals are settled (cut.individuals-parked)" },
  "waitlist.join": { fate: "parked", decision: "cut.individuals", carriedBy: "parked until individuals are settled (cut.individuals-parked)" },
  "waitlist.status": { fate: "parked", decision: "cut.individuals", carriedBy: "parked until individuals are settled (cut.individuals-parked)" },
  // <cut-entries> one line per frozen operation that left the built book, added by the commit that moved it
} as const satisfies Readonly<Record<string, Cut>>;

/** The four cut decisions that wait for Aaron; every other `cut.*` decision carries out his rulings and needs nothing from him. */
export const CUT_FOR_AARON: readonly string[] = ["cut.equity-parked", "cut.fde-parked", "cut.individuals-parked", "cut.uk-payroll-filing"];

const BY = "The coordinator, 10 November 2026, on Aaron's delegation of the book (aaron.one-door, aaron.frappe-native)";
const rulings = [decision_aaron_one_door, decision_aaron_frappe_native];

export const decision_cut_principle = defineDecision({
  id: "cut.principle",
  title: "The cut: Core and plugs stay in full, Frappe's is reached, nothing is deleted",
  question: "How is a book written for a product that rebuilt everything cut down to a product that sits inside Frappe?",
  options: [
    {
      label: "core-stays-frappe-reached",
      text:
        "Capxul Core (identity, the organisation and its departments, hats, budgets, payments, Bridge banking, governance, " +
        "agents) and the plugs that join it to Frappe (sign-in, the signer, roles that follow hats, books written from the " +
        "chain, site lifecycle, feature switches, the document door) stay in the built book in full: every rpc, flow, table, " +
        "machine, contract, event and error of what stays is kept as it was, none thinned. What Frappe owns (accounts, " +
        "payroll, HR, CRM, projects) is reached through the CLI and SDK door as the calling person; its Capxul-native " +
        "records leave the built book. Nothing is deleted: a record that leaves is moved with its text intact to " +
        "docs/cut-archive/, listed in docs/cut-archive/INDEX.md with its verdict, its reason and what carries it, and " +
        "classified by a `cut.*` decision. What waits on Aaron (equity, the hosted FDE) or on a call about individuals is " +
        "parked under docs/cut-archive/parked/, not dropped. Where there is doubt between dropping and keeping, park.",
    },
    { label: "thin-everything", text: "Keep the old records but thin them to what the plugs need." },
    { label: "rebuild-all", text: "Keep rebuilding every Frappe app natively beside Frappe (the old direction)." },
  ],
  chosen: "core-stays-frappe-reached",
  why:
    "Aaron, 9 and 10 November 2026: 'we should just do the whole thing' and the CLI and SDK are the one door, Frappe " +
    "works normally, the chain owns (aaron.frappe-native, aaron.one-door). The coordinator's proposal in " +
    "docs/design/cut-proposal.md was accepted with one correction in spirit: everything that stays keeps its full " +
    "detail, supporting records included.",
  source: BY,
  affects: [f.system_capxul, f.component_frappe_app, ...rulings],
});

export const decision_cut_equity_parked = defineDecision({
  id: "cut.equity-parked",
  title: "Equity is parked, not built and not deleted, until Aaron settles it",
  question: "aaron.frappe-native keeps governance and equity; START-HERE and GROUNDING drop equity. What happens to the equity concept now?",
  options: [
    {
      label: "park",
      text:
        "Move every equity record out of the built book to docs/cut-archive/parked/equity/ with its text intact (38 operations, " +
        "its tables, machines, rpcs, flows, processes, events, contracts and decisions). Aaron still has to settle " +
        "kept-or-dropped. The Board, its proposals and its officer hats stay: they are governance, and they are Core.",
    },
    { label: "drop", text: "Archive equity for good." },
    { label: "keep", text: "Keep equity in the built book as written." },
  ],
  chosen: "park",
  why:
    "GROUNDING and START-HERE drop equity ('not the direction', 'dropped for now'), while aaron.frappe-native still names " +
    "it. Parking is reversible and costs nothing; dropping 38 operations is hard to undo. It is Aaron's ruling to make.",
  source: BY,
  affects: [f.system_capxul, f.concept_board, ...rulings],
});

export const decision_cut_fde_parked = defineDecision({
  id: "cut.fde-parked",
  title: "The hosted FDE is parked until Aaron settles whether it is a feature",
  question: "Is the hosted FDE a feature of the book, or an upsell sold and run outside it (GROUNDING)?",
  options: [
    {
      label: "park",
      text:
        "Move the hosted FDE's records (the seven `org fde` operations and `org fde pay`, their tables, machines, processes, " +
        "notices and decisions) to docs/cut-archive/parked/fde-hosted/. Aaron's own FDE rulings (aaron.fde-agent, " +
        "aaron.fde-anyone, aaron.fde-hosted, aaron.test-prices) stay in rulings.ts untouched.",
    },
    { label: "keep", text: "Keep the hosted FDE as a durable agent in every organisation." },
    { label: "drop", text: "Archive it for good: the FDE works through the CLI like any agent." },
  ],
  chosen: "park",
  why:
    "GROUNDING calls the FDE the upsell, not the base product; START-HERE says it sets Capxul up and does not run daily " +
    "operations. aaron.fde-hosted says otherwise. Parking keeps both readings open.",
  source: BY,
  affects: [f.system_capxul, f.concept_organizations, ...rulings],
});

export const decision_cut_agreements_in_payments = defineDecision({
  id: "cut.agreements-in-payments",
  title: "On-chain pay agreements stay as Core and belong to payments",
  question: "Payroll is Frappe HR's. Do the on-chain pay agreements (offer, accept, collect) stay?",
  options: [
    {
      label: "keep-in-payments",
      text:
        "Keep them in full as Core and move them from the payroll concept into payments: the eleven operations, the " +
        "agreements and agreement-writes tables, their machines, rpcs, flows, process, events and the Agreements contract. " +
        "They are money and authority on chain, which is Core by Aaron's rule, and they are not payroll calculation.",
    },
    { label: "drop", text: "Payroll runs are the only salary path." },
  ],
  chosen: "keep-in-payments",
  why: "Money and authority on chain are Core (START-HERE section 2). A contractor or a stream can be paid with no payroll.",
  source: BY,
  affects: [f.system_capxul, f.concept_payments, ...rulings],
});

export const decision_cut_department_budgets = defineDecision({
  id: "cut.department-budgets",
  title: "Budgets are enforced per department: a design for stage 3",
  question: "The skeleton's stand-in contracts enforce one budget per organisation, and a department is only a label on the event. Is a department a budget authority?",
  options: [
    {
      label: "per-department",
      text:
        "Yes: budgets are enforced per department, as envelopes that follow Frappe's cost-centre tree with the same periods " +
        "(START-HERE section 4). This is recorded as the call only. Stage 3 designs the contract change; nothing about the " +
        "Budgets contract or payments.prepare-command is changed by the cut.",
    },
    { label: "one-budget", text: "Department stays a label." },
  ],
  chosen: "per-department",
  why: "The spike's four hats did the work; its one real gap was that a department is not authority (spikes/skeleton/FINDINGS.md).",
  source: BY,
  affects: [f.system_capxul, f.concept_budgets, ...rulings],
});

export const decision_cut_uk_payroll_filing = defineDecision({
  id: "cut.uk-payroll-filing",
  title: "How a UK company files payroll with HMRC stays Aaron's",
  question: "Frappe has no RTI and its PAYE is not HMRC's cumulative method. Provider API, bureau, or build?",
  options: [
    { label: "open", text: "Open. Nothing in the book changes. Aaron decides (START-HERE section 11); the coordinator's recommendation is a provider API, one integration record." },
    { label: "provider-api", text: "A payroll provider's API files the returns." },
    { label: "bureau", text: "A bureau files them." },
  ],
  chosen: "open",
  why: "START-HERE section 11 lists it under 'Only Aaron'. Payroll is Frappe's whichever he chooses.",
  source: BY,
  affects: [f.system_capxul, ...rulings],
});

export const decision_cut_individuals_parked = defineDecision({
  id: "cut.individuals-parked",
  title: "People with no company are parked: companies only for now",
  question: "Is Capxul still sold to people with no company (referrals, a waitlist, a personal address book, a personal inbox)?",
  options: [
    {
      label: "companies-only-now",
      text:
        "Companies only for now. The personal account and its Safe stay: they are identity and every signer needs one. " +
        "The referral and waitlist operations and the personal contact book are parked under " +
        "docs/cut-archive/parked/individuals/. The payer's inbox stays, because an organisation uses it too.",
    },
    { label: "both", text: "Keep individuals as written." },
  ],
  chosen: "companies-only-now",
  why: "GROUNDING sells to companies of 15 to 25 people. A person with no company has no Frappe site, so the book's personal features have no place to land.",
  source: BY,
  affects: [f.system_capxul, f.concept_accounts, f.concept_contacts, ...rulings],
});

export const decision_cut_park_when_unsure = defineDecision({
  id: "cut.park-when-unsure",
  title: "Where the cut is unsure between dropping and keeping, it parks",
  question: "What happens to a record whose fate the coordinator cannot call from the data?",
  options: [
    { label: "park", text: "Move it to docs/cut-archive/parked/<set>/ and list it in the index. Nothing is dropped on a guess." },
    { label: "drop", text: "Drop it with a reason." },
  ],
  chosen: "park",
  why: "Moving a record back is one move; recovering a dropped design is a redesign. The cut proposal marked its doubtful verdicts low confidence.",
  source: BY,
  affects: [f.system_capxul, ...rulings],
});

export const decision_cut_plug_placeholders = defineDecision({
  id: "cut.plug-placeholders",
  title: "What carries what the cut removes: the plugs stage 3 writes",
  question: "Where an operation that Frappe now owns still moves money or changes authority, what carries that part?",
  options: [
    {
      label: "core-or-plug",
      text:
        "Paying a payroll run, an advance or an expense claim (`org payroll run pay`, `org hr advance pay`, `org hr " +
        "expense-claim pay`): a Frappe Payment Entry held by the signer plug, then paid by the Core operation " +
        "`org department pay`. The twelve HR approvals and releases (leave, expense claims, advances, payslips, employee " +
        "status): a Frappe action allowed by a role that follows a hat (the roles-follow-hats plug); the hat is granted by " +
        "`org member grant`. Stage 3 writes these plugs in full, in this order of need: the signer and the held payment, " +
        "roles follow hats, sign-in, books written from the chain, site lifecycle, feature switches, the document door " +
        "(replacing `org head doc`), then bank account opening and identity checks through Bridge, which are known later " +
        "needs and not on the critical path. docs/design/cut-proposal.json lists 64 records they need.",
    },
  ],
  chosen: "core-or-plug",
  why: "START-HERE sections 3 and 8 and the skeleton in spikes/skeleton proved the shape. The cut only names what carries each removed operation, so none is lost.",
  source: BY,
  affects: [f.system_capxul, f.component_frappe_app, f.concept_payments, f.concept_budgets, ...rulings],
});
