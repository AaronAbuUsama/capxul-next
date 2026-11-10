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
import { decision_aaron_frappe_native, decision_aaron_jurisdiction_open, decision_aaron_one_door, decision_aaron_us_first } from "./rulings.ts";

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
  "dev.time": { fate: "reached", decision: "devnet.one-world-command-surface", carriedBy: "world show; SDK helpers retained, no dev alias" },
  "dev.time.warp": { fate: "reached", decision: "devnet.one-world-command-surface", carriedBy: "world clock warp; SDK helpers retained, no dev alias" },
  "dev.time.start-at": { fate: "reached", decision: "devnet.one-world-command-surface", carriedBy: "world create --start-at; SDK helpers retained, no dev alias" },
  "dev.snapshot.save": { fate: "reached", decision: "devnet.one-world-command-surface", carriedBy: "world snapshot save; SDK helpers retained, no dev alias" },
  "dev.snapshot.list": { fate: "reached", decision: "devnet.one-world-command-surface", carriedBy: "world snapshot list; SDK helpers retained, no dev alias" },
  "dev.snapshot.restore": { fate: "reached", decision: "devnet.one-world-command-surface", carriedBy: "world snapshot restore; SDK helpers retained, no dev alias" },

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

/** The cut decisions that wait for Aaron. None does now: on 10 November 2026 he accepted three as recommended (they are in ACCEPTED, rulings.ts) and changed the fourth (cut.uk-payroll-filing, superseded by aaron.us-first). Every `cut.*` decision carries out his rulings and needs nothing from him. */
export const CUT_FOR_AARON: readonly string[] = [];

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
    "it. Parking is reversible and costs nothing; dropping 38 operations is hard to undo. It is Aaron's ruling to make. Aaron, 10 November 2026, on the portal's Questions page: accepted as recommended. Whether equity is kept or dropped is still his to settle later; it stays parked meanwhile.",
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
    "operations. aaron.fde-hosted says otherwise. Parking keeps both readings open. Aaron, 10 November 2026, on the portal's Questions page: accepted as recommended.",
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
  title: "HMRC payroll filing is set aside for now; the jurisdiction is open",
  question: "Frappe has no RTI and its PAYE is not HMRC's cumulative method. Provider API, bureau, or build?",
  options: [
    { label: "open", text: "Open. Nothing in the book changes; the coordinator's recommendation was a provider API, one integration record. This was the choice until 10 November 2026." },
    { label: "set-aside-for-now", text: "Set aside by Aaron's ruling aaron.us-first: the build targets the United States first and writes its examples for it, so HMRC filing is neither designed nor built now. Not exclusively and not for ever. Which existing open-source payroll and tax support gives the best start is payroll.open-source-support." },
    { label: "provider-api", text: "A payroll provider's API files the returns." },
    { label: "bureau", text: "A bureau files them." },
  ],
  chosen: "set-aside-for-now",
  why:
    "START-HERE section 11 had listed it under 'Only Aaron'. Aaron, 10 November 2026, dictated: 'I think this is a decision we should revisit actually. I think we should probably avoid HMRC for now. Let's just do this US, not that this is only going to be US, but let's just like pick US for now, US examples for now, especially because the legal path is a bit more straightforward as well, especially for stable coins and stable coin companies.' " +
    "His ruling was aaron.us-first; later the same day he left the jurisdiction open (aaron.jurisdiction-open), which carries its list. It lists the places in the book that assume a UK company; nothing is rewritten yet. Payroll is Frappe's whichever jurisdiction comes first.",
  source: BY,
  affects: [f.system_capxul, ...rulings, decision_aaron_us_first],
});

export const decision_payroll_open_source_support = defineDecision({
  id: "payroll.open-source-support",
  title: "No open-source payroll gives a real head start for the US or the UK",
  question:
    "Frappe HR's payroll calculates from salary structures and formulas; what existing open-source payroll and tax support (a Frappe app, a " +
    "plugin, a tax engine or a filing library) already exists, for the United States, the United Kingdom or any other jurisdiction, that gives the build a start?",
  options: [
    {
      label: "no-head-start-us-uk",
      text:
        "Answered by the research note docs/design/payroll-jurisdiction.md, as far as it goes. For the United States: Frappe HR has no US payroll " +
        "(only ERPNext's 1099 report and a US chart of accounts); no open-source withholding engine exists (the IRS publishes its tables as PDF); the one " +
        "Frappe app, US Payroll by Bizmap (MIT, version-16, created May 2026, one vendor, 5 stars), does federal tax and the W-2, W-3 and 941 forms, has no state " +
        "withholding and no e-filing found, and was not run. For the United Kingdom: nothing in Frappe HR or ERPNext, no Frappe app for HMRC payroll filing. " +
        "Frappe HR's own localisations are India (HRA, tax with marginal relief, provident fund, gratuity) and the United Arab Emirates (three gratuity rules), " +
        "ERPNext's include a UAE VAT report; India's real payroll lives in other apps (India Payroll, version 17 only; India Compliance, GST). So the " +
        "United Arab Emirates starts ahead of the US and the UK on software; everything else about it (payroll rules, filing, what its law says about " +
        "wages in a stablecoin) is unresearched. Which place goes first is payroll.jurisdiction-first.",
    },
  ],
  chosen: "no-head-start-us-uk",
  why:
    "Aaron asked the question himself on 10 November 2026 (aaron.us-first): what open-source tax support exists, and whether a plugin gives a head start for a " +
    "jurisdiction. The research answers it for the two places it covered, from the installed code (frappe 16.55.2, erpnext 16.54.0, hrms 16.53.1) and the marketplace; " +
    "what it could not verify is listed in its section 9 (provider liability terms and prices, SSA onboarding, whether Bizmap caps Social Security or e-files). " +
    "He then left the jurisdiction open (aaron.jurisdiction-open), so this record answers the research question and no longer names a country.",
  source: BY,
  affects: [f.system_capxul, ...rulings, decision_aaron_us_first, decision_aaron_jurisdiction_open],
});

export const decision_payroll_route = defineDecision({
  id: "payroll.route",
  title: "Payroll: buy calculation and filing, Frappe is the record",
  question:
    "Whatever place goes first, how is payroll built? Calculate and file ourselves, adopt an open-source engine, or buy it from a provider's API?",
  options: [
    {
      label: "buy-record-in-frappe",
      text:
        "The coordinator's recommendation, not the owner's ruling (he said of the research's recommendations on 10 November 2026 that he agreed, then " +
        "left the jurisdiction open, so only what does not depend on a country is kept). (1) Calculation and filing are bought from a payroll provider with an API " +
        "where one exists for the place, not built: the filing doors are many, the calculation is the part most easily bought, and wrong withholding is the " +
        "product's fault if it is built. (2) Frappe HR is the record of staff and pay: a Salary Slip is approved there and the provider's net pay, taxes and filing status " +
        "are written back to it. (3) The first company's payroll is run by an accountant while a provider's test environment is tried. (4) Wages are paid in the local " +
        "fiat at first. (5) Paying contractors in a stablecoin is the first stablecoin pay flow. (6) Whether wages may be paid in a stablecoin, and whether running payroll " +
        "makes Capxul a payroll provider, a reporting agent or a money transmitter, wait on a lawyer in the chosen place (docs/design/payroll-jurisdiction.md, what a lawyer must confirm). " +
        "Which provider is open: terms, liability and prices are not public; the first question to any provider is who pays a penalty for a wrong filing. " +
        "Not on the owner's list.",
    },
    { label: "build-calculation", text: "Build the calculation on Frappe HR, federal or national only, and file by hand: high exposure, rejected by the research." },
    { label: "adopt-open-source", text: "Adopt an open-source engine: none gives a real head start for the US or the UK (payroll.open-source-support)." },
  ],
  chosen: "buy-record-in-frappe",
  why:
    "docs/design/payroll-jurisdiction.md sections 5 to 8: the United States has dozens of authorities and the UK one, and in neither does an open-source engine exist; a " +
    "provider API (Check, Gusto Embedded and similar) takes on calculation, deposit and filing; none was shown to accept a stablecoin, so funds arrive as fiat first. " +
    "The coordinator's recommendation as Aaron said he agreed with it; it stays open to him to change. The route's two open things are NOT on his list yet: which provider, " +
    "and the lawyer's questions.",
  source: BY,
  affects: [f.system_capxul, f.component_frappe_app, decision_payroll_open_source_support, decision_aaron_jurisdiction_open],
});

export const decision_payroll_jurisdiction_first = defineDecision({
  id: "payroll.jurisdiction-first",
  title: "Which jurisdiction goes first: open, waiting on a comparison",
  question:
    "aaron.jurisdiction-open leaves the first jurisdiction open, prefers a crypto-friendly or blockchain-friendly place and names the United Arab Emirates as a candidate. Which place?",
  options: [
    {
      label: "open-comparison-first",
      text:
        "Open, and not waiting on Aaron: it waits on a short comparison the coordinator owns, of the UAE and the other crypto-friendly places worth naming: what Frappe " +
        "HR and ERPNext already have for each, what payroll and tax filing each needs, and what each says about paying wages in a stablecoin. The one fact in hand: Frappe HR " +
        "ships UAE support (three gratuity rules, a VAT 201 report in ERPNext), so the UAE starts ahead of the US and the UK on software. Everything else about it is " +
        "unresearched. When the comparison is in, this record is rewritten to its recommendation and the places that assume a country (the lists in aaron.jurisdiction-open) are made neutral or revisited. " +
        "Until then the book assumes no country and nothing is rewritten.",
    },
  ],
  chosen: "open-comparison-first",
  why:
    "Aaron, 10 November 2026: 'Maybe the UAE might be a good place, or anywhere else that's like crypto friendly.' He asked for no particular place, so the choice is " +
    "the coordinator's to recommend from evidence; it goes to him only if the comparison leaves a call that is his. Not on his list.",
  source: BY,
  affects: [f.system_capxul, ...rulings, decision_aaron_jurisdiction_open, decision_payroll_route, decision_payroll_open_source_support],
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
  why: "GROUNDING sells to companies of 15 to 25 people. A person with no company has no Frappe site, so the book's personal features have no place to land. Aaron, 10 November 2026, on the portal's Questions page: accepted as recommended.",
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
