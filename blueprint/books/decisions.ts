// Books' own judgments, each a decision record linked to the records it shapes (CONVENTIONS rule
// 10). Made by Claude on 8 November 2026 under A1-A4 and P1-P10, with the old code
// (/home/user/factory, integration/factory), the as-is book (docs/as-is/archive/books/) and ADR-0042 as
// evidence. The architecture's own books decisions are in ../shared/decisions.ts
// (concepts.books, concepts.books-token-scan, dependencies.books-below-money,
// responsibilities.keepers).

import { defineDecision } from "../../packages/blueprint-engine/src/index.ts";
import { component_frappe_app, concept_books } from "../shared/foundation.ts";
import {
  event_book_annotation_transitioned,
  event_book_asset_transitioned,
  machine_book_annotation,
  machine_book_asset,
  table_book_annotations,
  table_book_assets,
  table_book_facts,
  table_book_feeds,
  invariant_books_facts_append_only,
  invariant_books_feed_gap_free,
  invariant_books_one_live_money_fact,
} from "./data.ts";
import {
  procedure_books_record_money_fact,
  procedure_books_reverse_money_fact,
} from "./procedures.ts";
import { rpc_books_annotations_save } from "./annotations.ts";
import { rpc_books_assets_add, rpc_books_assets_list, rpc_books_assets_remove } from "./assets.ts";
import { rpc_books_facts_list } from "./facts.ts";
import { workflow_books_assets_scan_added,  } from "./processes.ts";
import * as ops from "./operations.ts";

const CLAUDE = "Claude, books target design, 8 November 2026";
const by = (evidence: string) => `${CLAUDE}; evidence: ${evidence}`;
const FRAPPE = "Claude, books redesign in ERPNext accounting's shape, 8 November 2026";
const byFrappe = (evidence: string) => `${FRAPPE}; evidence: ${evidence}`;
const B = "packages/backend/src/books";
/** ERPNext's accounting doctypes, read from frappe/erpnext (shallow clone of 8 November 2026). */
const ERP = "erpnext/accounts/doctype";

// ── money facts ─────────────────────────────────────────────────────────────────────────────

export const decision_books_captured_valuation = defineDecision({
  id: "books.captured-valuation",
  title: "Money procedures store captured block valuation, never invent a peg",
  question: "After removing the price-table dependency, where does a same-transaction money fact get its USD evidence?",
  options: [
    {
      label: "captured-evidence",
      text: "The invoker may supply captured block-time USD value, rate and source for a priced asset. Without evidence all three are null. The procedure makes no external call, never assumes USDC is one dollar and never revalues a replay or reversal.",
    },
    {
      label: "provider-in-transaction",
      text: "Call a price provider while holding settlement locks, making chain settlement depend on external availability.",
    },
  ],
  chosen: "captured-evidence",
  why: "The declared procedure has no external calls, errors or price-table dependency. Captured evidence preserves atomic settlement without recreating accounting or silently inventing valuation; the existing fact schema already admits missing USD evidence.",
  source: "Slice-zero books reconciliation, 12 November 2026; books.chart-owner; blueprint/shared/cut-moves.ts removed table_book_prices; blueprint/books/facts.ts permits no USD yet",
  affects: [procedure_books_record_money_fact, procedure_books_reverse_money_fact, table_book_facts],
});

export const decision_books_facts_without_chart = defineDecision({
  id: "books.facts-without-chart",
  title: "The books are an ERPNext Company's accounting from the first money",
  question:
    "Books is redesigned in the shape of ERPNext's accounting, synced with a head when one is connected. What do an " +
    "Organization's books hold before anyone makes a chart or connects a head, and how does that money reach the " +
    "ledger? (Books sits below payments and banking and cannot re-read them.)",
  options: [
    {
      label: "frappe-from-first-money",
      text:
        "From the first money the books are the accounting half of an ERPNext Company (book-companies): every money " +
        "fact is kept, numbered in the feed and valued, chart or no chart, and names no account. The chart is ERPNext's " +
        "Account tree, made by the import (at start-up, by the Organization's agent, or later); at that moment every " +
        "earlier priced fact posts its voucher, so the money before the chart is in the ledger at once. A head connected " +
        "later is pushed everything from the feed's first number. No backfill, no chart stamps.",
    },
    {
      label: "always",
      text:
        "The earlier choice: facts kept whether or not a chart exists, but in Capxul's own shapes (a flat chart, facts " +
        "posted by Capxul's cash rules), with no feed a ledger can follow.",
    },
    {
      label: "backfill-upstream",
      text:
        "Keep 'no chart, no facts'. Payments and banking each own a workflow triggered by the chart's import that " +
        "replays the Organization's settled history into `books.record-money-fact`.",
    },
    { label: "backfill-chain", text: "Keep 'no chart, no facts'; books replays the Safe's PaymentSent and Transfer views from indexing after the import." },
  ],
  chosen: "frappe-from-first-money",
  why:
    "Aaron's ruling of 8 November 2026 (aaron.books-first-principles, with aaron.erp-on-capxul and aaron.frappe-head): " +
    "an Organization's data lives in Frappe's shapes from the moment it starts, whether or not a head is connected, and " +
    "money proven on chain posts the entries. This record had chosen `always`; it keeps what that got right and moves " +
    "it into ERPNext's shape. K10 ('a settled Payment always has its book facts') stays unconditional, the stricter " +
    "version (P10 rung 3). Backfill-upstream adds two cross-concept workflows with ordering races against live " +
    "settlements; backfill-chain cannot rebuild the rows, counterparties and choices only payments knows. With facts " +
    "from the first money, the import is one transaction and balance-sheet line 2 ('Money recorded before the chart gets " +
    "a Safe account per asset when the chart is made') holds word for word, as does every other claim. A chart still " +
    "comes only from the import (frozen: 'no chart until one is made'), so the start-up step should run it for a new " +
    "Organization. Two frozen sentences describe the old mechanism and stay as frozen text: import's `changes` " +
    "('schedules a backfill') and its note 'An Organization without a chart keeps no money facts'.",
  source: byFrappe(`rulings.ts (aaron.books-first-principles, SUPERSEDED); ${B}/facts/writes/backfill.ts:86; K10 in docs/as-is/payments.md`),
  affects: [
    table_book_facts,
    table_book_feeds,
    procedure_books_record_money_fact,
    ops.operation_org_books_facts_list,
  ],
});

export const decision_books_money_key = defineDecision({
  id: "books.money-key",
  title: "A money fact is keyed by the chain occurrence that moved the money",
  question: "What makes a money fact one fact, when payments, banking and books' own scan can each reach the same money, and a reorganization can take it back?",
  options: [
    {
      label: "chain-key",
      text:
        "`money_key` is the chain occurrence: `payment:<v4 payment id>` (consumed once on chain) or `transfer:<chain>:<tx>:<log>`; " +
        "with the Organization and a generation it is unique. Same key, same content: no-op. A Payment, deposit or payout " +
        "side supersedes a standing Movement fact (reversal plus next generation); a Movement side never supersedes theirs.",
    },
    { label: "capxul-id", text: "Keep the old `fct_<kind>_<paymentId>` from Capxul's own ids, each writer with its own id space." },
  ],
  chosen: "chain-key",
  why:
    "The old ids came from each writer's own records, so the same Transfer could be booked by a Deposit and as outside " +
    "money under two ids (M1 in docs/as-is/payments.md). A chain key is the same whoever reaches the money first, so a " +
    "replay, a second writer or a re-settle reaches the one fact, and a reversal finds what it cancels. The precedence " +
    "rule makes the outcome independent of order: the specific writer (a settlement, a deposit, a payout's return) wins " +
    "over a generic outside-money attribution. Both procedures never refuse: a settlement must never fail because of the " +
    "books, so an account choice that no longer fits leaves the row waiting in review.",
  source: by(`${B}/facts/rules.ts:74; ${B}/facts/writes/standing.ts:13; M1 and K10 in docs/as-is/payments.md; IPayments.paymentId`),
  affects: [
    table_book_facts,
    procedure_books_record_money_fact,
    procedure_books_reverse_money_fact,
    workflow_books_assets_scan_added,
    invariant_books_one_live_money_fact,
  ],
});

export const decision_books_one_observer = defineDecision({
  id: "books.one-observer",
  title: "The old observer folds into payments' Movements; books scans only added tokens",
  question:
    "Every minute the old `books.facts.observe` read each charted Safe's Transfers from Ponder and booked what no Capxul " +
    "Payment explained, beside a second path (`books.facts.outside`, from Movements). P3 sends the observer to a chain " +
    "trigger. Is it books' workflow?",
  options: [
    {
      label: "payments",
      text:
        "Payments, which owns Movements (indexed Transfers attributed to a Payment, or outside money), invokes " +
        "`books.record-money-fact` in the transaction that attributes outside money. Books has no observer of admitted " +
        "assets; its only scan is of added tokens, which Ponder has no source for.",
    },
    {
      label: "books-chain-trigger",
      text: "A books workflow triggered by each indexed ERC-20 Transfer touching an Organization Safe, deciding outside money itself.",
    },
  ],
  chosen: "payments",
  why:
    "Two observers of the same Transfers with their own rules is how the old system lost an Organization's outside money " +
    "(M1: a Deposit row hid it from the observer). ADR-0042 D12 wants one observer; on the target map that is payments, " +
    "whose Movement decides 'Capxul money or outside money' once, from PaymentSent, escrow and Transfer views, and whose " +
    "Movement id is the row an annotation names. The fact then commits with the Movement (P4). The cursor table " +
    "(bookCursors), the 150-block lag and the 30-second outside timer go; native ETH is not booked (every v4 money asset " +
    "is an ERC-20). Pending link: payments must invoke the procedure for outside money and reversals.",
  source: by(`ADR-0042 D12; ${B}/facts/operations/observe.ts:74; ${B}/facts/operations/outside.ts:16; M1 in docs/as-is/payments.md; concepts.payments`),
  affects: [concept_books, procedure_books_record_money_fact, procedure_books_reverse_money_fact, workflow_books_assets_scan_added],
});

export const decision_books_account_at_posting = defineDecision({
  id: "books.account-at-posting",
  title: "A money fact names no account; its voucher reads the row's annotation",
  question: "Does a money fact store the account it books to, or is the account resolved when the books are read?",
  options: [
  {
    "label": "current-scope",
    "text": "A chain money fact records immutable money evidence, not a mutable Core account id. Classification and site account resolution happen on the company site using the event's account-code and cost-centre labels. A correction cannot repost a submitted Safe payment in place: use the plugs reversal/refund and open-period rules."
  },
  {
    "label": "historical",
    "text": "The former answer to books.account-at-posting is preserved in docs/cut-archive/decision-review-history.json as historical evidence, not implementation authority."
  }
],
  chosen: "current-scope",
  why:
    "Review, 11 November 2026: A chain money fact records immutable money evidence, not a mutable Core account id. Classification and site account resolution happen on the company site using the event's account-code and cost-centre labels. A correction cannot repost a submitted Safe payment in place: use the plugs reversal/refund and open-period rules. Authority: cut.books; plugs.repoint-money-fact; plugs.late-and-closed.",
  source: "The coordinator, round 2, m1-old-decisions; cut.books; plugs.repoint-money-fact; plugs.late-and-closed",
  affects: [
    table_book_facts,
    table_book_annotations,
    procedure_books_record_money_fact,
    rpc_books_annotations_save,
    rpc_books_facts_list,
  ],
});

export const decision_books_added_token_opening = defineDecision({
  id: "books.added-token-opening",
  title: "Openings only for an added token, at the add; none for Capxul's assets",
  question: "The old books read each Safe's opening balances once after the backfill (CAP-1047). What is left of the opening on the target?",
  options: [
    {
      label: "added-only",
      text:
        "Capxul's own assets need none: the v4 company Safe is minted fresh and payments attributes every Transfer of an " +
        "admitted asset from its first block. An added token, scanned only from the block it was added, gets one " +
        "`opening_balance` fact for the Safe's balance at that block, read in the same call as its decimals and symbol.",
    },
    { label: "none", text: "No opening: an added token's earlier balance stays an unexplained reconcile difference, as the old README admitted." },
    { label: "as-is", text: "Keep the opening job for every asset after each import." },
  ],
  chosen: "added-only",
  why:
    "The opening existed because a chart could be imported onto a Safe whose history the books had not seen; with facts kept from the first money that cannot happen for admitted assets. For an added token the frozen text says transfers before the add are not scanned, so without an opening `reconcile` could never match (its line 2 reads added tokens too). One more parallel `balanceOf` at the block already read keeps the add in its chain-read class. The opening credits 3990, which the template keeps. Review, 11 November 2026: Confirmed books.added-token-opening; original choice retained.",
  source: by(`${B}/facts/operations/open.ts:93; ${B}/facts/writes/opening.ts:59; ${B}/README.md:127 (a token added later has no opening yet)`),
  affects: [rpc_books_assets_add, table_book_facts, ops.operation_org_books_assets_add],
});

// ── rows and annotations ────────────────────────────────────────────────────────────────────

export const decision_books_annotation_feature = defineDecision({
  id: "books.annotation-feature",
  title: "Organization annotation uses the fail-closed books money feature",
  question: "Which trusted feature catalogue entry gates an Organization's retained annotation RPC?",
  options: [
    { label: "books-organization-money", text: "Gate Organization annotation on books, target organization, money true. Use access' authoritative feature reader and world time; missing, disabled, unsupported or stale money-feature state refuses FEATURE_NOT_AVAILABLE. Personal categories do not require an Organization feature or site." },
    { label: "no-feature", text: "Rely only on Seat and native site roles, ignoring the retained FEATURE_NOT_AVAILABLE refusal." },
  ],
  chosen: "books-organization-money",
  why: "The retained RPC promises a feature refusal. The archived catalogue names books, and the action can change posting intent. A deployment-owned catalogue, never request input, prevents unknown or stale state becoming default-on authority.",
  source: "Access owner source review, 12 November 2026; docs/as-is/archive/access/features.ts:60; books.annotations.save; access.requireFeature",
  affects: [rpc_books_annotations_save],
});

export const decision_books_personal_codes = defineDecision({
  id: "books.personal-codes",
  title: "The fixed personal categories are not an Organization chart replica",
  question: "Which codes does the retained personal annotation contract accept without consulting ERPNext?",
  options: [
    { label: "fixed-personal", text: "Keep personal codes 4000 Salary, 4100 Freelance income, 4900 Other income, 6000 Rent and housing, 6100 Food and groceries, 6200 Transport, 6300 Utilities and phone, 6400 Health, 6500 Shopping, 6600 Travel, 6800 Family and gifts, 1900 Transfers between my accounts, 4999 Uncategorized income and 6999 Uncategorized expense. Store personal_<code>, not a company Account; no company chart, site call or fact is created." },
    { label: "site-personal", text: "Require a person's own ERPNext site and resolve a mutable native chart there." },
  ],
  chosen: "fixed-personal",
  why: "The retained RPC explicitly promises a fixed personal chart and no site call. Naming its codes makes validation testable without bringing back the removed Organization chart. These are behavioral reference data, not copied accounting implementation.",
  source: "Xelmar-tech/infrastructure packages/protocol/src/books/model.ts PERSONAL_CHART, read 12 November 2026; books.annotate-known-rows; books.chart-owner",
  affects: [rpc_books_annotations_save, table_book_annotations],
});

export const decision_books_annotations_one_table = defineDecision({
  id: "books.annotations-one-table",
  title: "A row's account, suggestion and memo are one annotation row",
  question: "Old activity kept a row's memo (activityAnnotations) and old books its account (bookAssignments), written together. One table or two?",
  options: [
    { label: "one", text: "One `book-annotations` row per owner and row, `owner` tenancy, with a machine for waiting or decided." },
    { label: "two", text: "Keep an annotation table and an assignment table, both in books." },
  ],
  chosen: "one",
  why:
    "Both were keyed by the same owner and row and saved by the same mutation (`saveAnnotation` then `classifyRow`); two rows let a save replace one and not the other. The retired free-text fields (`accountingCategory`, `counterpartyLabel`) and their clean-up are not carried (P9). `owner` tenancy because a person's rows and an Organization's share one shape; persons keep no facts (ADR-0042 D6). Review, 11 November 2026: Confirmed books.annotations-one-table; original choice retained.",
  source: by("packages/backend/src/activity/tables.ts:8; packages/backend/src/books/tables.ts:56; packages/backend/src/activity/annotations/writes.ts:24"),
  affects: [table_book_annotations, machine_book_annotation, rpc_books_annotations_save],
});

export const decision_books_annotate_known_rows = defineDecision({
  id: "books.annotate-known-rows",
  title: "Annotate checks an Organization's rows against its own facts",
  question:
    "`activity annotate` refuses a row the actor does not take part in. The old guard read payments. Books is below " +
    "payments and cannot. How is the row checked?",
  options: [
    {
      label: "own-facts",
      text:
        "An Organization row must be one its books hold a money fact for (books keeps every settled side). A person's " +
        "row is not checked: the annotation lives only in that person's own books and posts nothing. A pending Payment " +
        "gets its account from `payment send --account`, passed with its money fact.",
    },
    { label: "procedure", text: "Payments registers every row with books through a new procedure at the command's birth." },
    { label: "lift", text: "Move annotate above payments (into activity), which then writes books' tables." },
  ],
  chosen: "own-facts",
  why:
    "A registry procedure would be no money fact (rules.procedures), and lifting annotate makes another concept write " +
    "books' annotations and facts, which the map forbids (concepts.books). The old guard already skipped the check for " +
    "chain rows it never stored ('its shape and the scope that owns the annotation are all there is to check'). A " +
    "person annotating a Payment they are not in learns nothing and changes nobody else's books, so no money or " +
    "authority loosens (P10 rung 3). The refusal text keeps its words; an unsettled Payment's row is refused until it settles.",
  source: by("packages/backend/src/activity/annotations/guards.ts:79; activity.annotate.yaml (INVALID_INPUT: not a participant); ADR-0042 D6"),
  affects: [rpc_books_annotations_save, ops.operation_activity_annotate, procedure_books_record_money_fact],
});

// ── state machines ──────────────────────────────────────────────────────────────────────────

export const decision_books_machines = defineDecision({
  id: "books.machines",
  title: "Two machines, one event each: annotations and added tokens",
  question: "Which stored states are machines, now that every product event comes from a transition (P7)?",
  options: [
  {
    "label": "current-scope",
    "text": "Retained Core annotation waiting/decided and added-asset added/removed states emit their machine events; facts stay append-only without a lifecycle. ERPNext owns Account and submitted/cancelled voucher states. The historical five-machine list does not authorize a second Core accounting lifecycle."
  },
  {
    "label": "historical",
    "text": "The former answer to books.machines is preserved in docs/cut-archive/decision-review-history.json as historical evidence, not implementation authority."
  }
],
  chosen: "current-scope",
  why:
    "Review, 11 November 2026: Retained Core annotation waiting/decided and added-asset added/removed states emit their machine events; facts stay append-only without a lifecycle. ERPNext owns Account and submitted/cancelled voucher states. The historical five-machine list does not authorize a second Core accounting lifecycle. Authority: cut.books; plugs.repoint-money-fact; plugs.late-and-closed.",
  source: "The coordinator, round 2, m1-old-decisions; cut.books; plugs.repoint-money-fact; plugs.late-and-closed",
  affects: [
    machine_book_annotation,
    machine_book_asset,
    event_book_annotation_transitioned,
    event_book_asset_transitioned,
    table_book_facts,
    invariant_books_facts_append_only,
  ],
});

export const decision_books_births_are_transitions = defineDecision({
  id: "books.births-are-transitions",
  title: "A row's birth is a transition with no source state",
  question: "An import, an add or a first annotation inserts a row. How does the insert send its machine's event?",
  options: [
    { label: "from-empty", text: "The birth is a named transition with `from: []` (add, queue, assign), emitting like any other." },
    { label: "none-state", text: "Give every machine a `none` state the row never stores." },
  ],
  chosen: "from-empty",
  why: "The schema accepts an empty `from`, the build's state checks pass, and no phantom state is stored or listed. The event's `from` is null for a birth. Review, 11 November 2026: Confirmed books.births-are-transitions; original choice retained.",
  source: by("packages/blueprint-engine/src/records/data.ts (TransitionSpec.from); docs/as-is/archive/books/data.ts (births said only in prose)"),
  affects: [machine_book_annotation, machine_book_asset],
});

export const decision_books_every_side_births = defineDecision({
  id: "books.every-side-births",
  title: "Every recorded money side births its annotation, waiting when nothing was said",
  question: "A recorded money side with no `against` (a payment sent with no account, an outside deposit). Is its annotation row born?",
  options: [
    { label: "always-birth", text: "Yes: the procedure births the row `waiting` (`queue`, no account) when the side says nothing, and with the side's `against` otherwise." },
    { label: "only-with-against", text: "No: a row is born only when the side carries an `against`; otherwise the first save births it." },
  ],
  chosen: "always-birth",
  why: "The review queue is the rows waiting for an account, and the machine's initial state is `waiting`. Without a born row, unclassified money would sit in the facts but never in review, and payment.send would send book_annotation_transitioned only sometimes, while its eval claims it always does. The birth is still once per row: a replay, a re-recorded generation or an existing annotation writes nothing more. Raised by the Core payments lane on 13 November 2026 while binding evt:payment.send/book_annotation_transitioned.",
  source: by("blueprint/books/data.ts (machine_book_annotation initial waiting; the review index); the Core payments lane, 13 November 2026"),
  affects: [procedure_books_record_money_fact, machine_book_annotation, table_book_annotations, event_book_annotation_transitioned],
});

// ── authorization, assets, prices ───────────────────────────────────────────────────────────

export const decision_books_guards = defineDecision({
  id: "books.guards",
  title: "Any Seat reads; the Books hat changes; the books gate stays",
  question: "How does each books rpc authorize its caller on v4?",
  options: [
  {
    "label": "current-scope",
    "text": "Core money/annotation reads remain tenant guarded and changes require the applicable chain hat. Site account and voucher actions use projected roles through the caller's door session. Archive email-matched head-user edits and books head-sync authorization; a site never holds a Core key or gains authority by writing a User email."
  },
  {
    "label": "historical",
    "text": "The former answer to books.guards is preserved in docs/cut-archive/decision-review-history.json as historical evidence, not implementation authority."
  }
],
  chosen: "current-scope",
  why:
    "Review, 11 November 2026: Core money/annotation reads remain tenant guarded and changes require the applicable chain hat. Site account and voucher actions use projected roles through the caller's door session. Archive email-matched head-user edits and books head-sync authorization; a site never holds a Core key or gains authority by writing a User email. Authority: cut.books; plugs.repoint-money-fact; plugs.late-and-closed.",
  source: "The coordinator, round 2, m1-old-decisions; cut.books; plugs.repoint-money-fact; plugs.late-and-closed",
  affects: [
    rpc_books_assets_list,
    rpc_books_assets_add,
    rpc_books_assets_remove,
    rpc_books_facts_list,
    rpc_books_annotations_save,
  ],
});

export const decision_books_capxul_assets = defineDecision({
  id: "books.capxul-assets",
  title: "Capxul's own assets are configuration, not rows",
  question: "Where do Capxul's settlement and held assets (USDC, EURC, WBTC...) live for the books?",
  options: [
    {
      label: "config",
      text:
        "The deployment's admitted-asset list (with each asset's tier and Chainlink pair) is configuration every concept " +
        "reads; only added tokens are rows. Beside the assets it lists the Chainlink USD pair of each Company currency it " +
        "accepts (EUR/USD, GBP/USD), which the price sync reads and the import checks (books.company-settings).",
    },
    { label: "rows", text: "Seed a books table with Capxul's assets per deployment." },
  ],
  chosen: "config",
  why:
    "As in the old code: they change only with a deployment, and payments needs the same list. Only they are priced, so an added token named USDC never takes USDC's price. A Company currency's pair is the same kind of configuration: a voucher in that currency divides each fact's USD value by its rate at the block, so a currency the deployment lists no pair for cannot be valued, and the import refuses it (INVALID_INPUT `currency_not_priced`); organizations starts a country whose currency has none in USD (organizations.company-shape). Review, 11 November 2026: Confirmed books.capxul-assets; original choice retained.",
  source: by(`${B}/assets/rules.ts:9; ${B}/README.md:73; packages/protocol/src/evm/test-assets.ts:21; books.company-settings`),
  affects: [
    rpc_books_assets_list,
    rpc_books_assets_add,
    procedure_books_record_money_fact,
    table_book_assets,
  ],
});

export const decision_books_added_token_scan = defineDecision({
  id: "books.added-token-scan",
  title: "The added-token scan: a minute cron, a cursor on the asset, final blocks only",
  question: "How does books' scan of added tokens (shared concepts.books-token-scan) keep its place and survive reorganizations?",
  options: [
  {
    "label": "current-scope",
    "text": "The added-token scanner keeps next_block per added asset, runs each minute and reads only finalized Transfer logs. Writes are keyed by Transfer so replay does not duplicate money. The old no-reversals assumption is rejected: a later reorg must reverse the affected fact and site projection through the same reconciliation path as other money facts."
  },
  {
    "label": "historical",
    "text": "The former answer to books.added-token-scan is preserved in docs/cut-archive/decision-review-history.json as historical evidence, not implementation authority."
  }
],
  chosen: "current-scope",
  why:
    "Review, 11 November 2026: The added-token scanner keeps next_block per added asset, runs each minute and reads only finalized Transfer logs. Writes are keyed by Transfer so replay does not duplicate money. The old no-reversals assumption is rejected: a later reorg must reverse the affected fact and site projection through the same reconciliation path as other money facts. Authority: cut.books; plugs.repoint-money-fact; plugs.late-and-closed.",
  source: "The coordinator, round 2, m1-old-decisions; cut.books; plugs.repoint-money-fact; plugs.late-and-closed",
  affects: [workflow_books_assets_scan_added, table_book_assets, machine_book_asset],
});

// ── operations ──────────────────────────────────────────────────────────────────────────────

export const decision_books_acceptance_rewrites = defineDecision({
  id: "books.acceptance-rewrites",
  title: "Telemetry lines become claims about what is reported (P1)",
  question: "Thirteen frozen books lines name the old telemetry ('posts `books_account_added`', 'schedules nothing', 'delivered once'). Keep or rewrite?",
  options: [
    { label: "rewrite", text: "Rewrite each as 'is reported once' or 'reports nothing', observed as the machine's event in the local collector; the old line moves to `was`." },
    { label: "keep", text: "Keep the old event names, which no longer exist on the target (P7)." },
  ],
  chosen: "rewrite",
  why:
    "P1 rewrites a line that names a mechanism. The rewritten lines still pass against the old system, which posted one event per committed change and none for a refusal. Rewritten: annotate 5; import 2, 3, 4; add 3; rename 4, 5; archive 2, 3; reclassify 4; assets add 4, 5; assets remove 3, 4. Every other line is word for word, including trial balance 4 ('a chart fact posts nothing'), where 'posts' means posting lines, and reclassify 3, whose straddling row on v4 is any row with money facts on both sides of the period. With the books in ERPNext's shape the import is observed as book_company_transitioned (transition import), the chart's machine having become the Company's books (books.machines); every claim keeps its words. Review, 11 November 2026: Confirmed books.acceptance-rewrites; original choice retained.",
  source: by("blueprint/baseline/operations.ts (the 17 books operations' acceptance); P1; P7"),
  affects: [
    ops.operation_activity_annotate,
    ops.operation_org_books_assets_add,
    ops.operation_org_books_assets_remove,
  ],
});

export const decision_books_worlds = defineDecision({
  id: "books.worlds",
  title: "The five worlds books' refusals are reached from",
  question: "Which named devnet snapshots do the books refusals need?",
  options: [
  {
    "label": "current-scope",
    "text": "Keep signed-out, company-without-chart, classified/unclassified money, added-token and node-failure scenarios as coverage obligations. Build site accounting fixtures on real hosted world sites through the door; do not recreate a Core chart-import world. Whole-world snapshots include those site documents and chain facts."
  },
  {
    "label": "historical",
    "text": "The former answer to books.worlds is preserved in docs/cut-archive/decision-review-history.json as historical evidence, not implementation authority."
  }
],
  chosen: "current-scope",
  why:
    "Review, 11 November 2026: Keep signed-out, company-without-chart, classified/unclassified money, added-token and node-failure scenarios as coverage obligations. Build site accounting fixtures on real hosted world sites through the door; do not recreate a Core chart-import world. Whole-world snapshots include those site documents and chain facts. Authority: cut.books; plugs.repoint-money-fact; plugs.late-and-closed.",
  source: "The coordinator, round 2, m1-old-decisions; cut.books; plugs.repoint-money-fact; plugs.late-and-closed",
  affects: [
    ops.operation_activity_annotate,
    ops.operation_org_books_assets_list,
    ops.operation_org_books_assets_add,
    ops.operation_org_books_assets_remove,
    ops.operation_org_books_facts_list,
  ],
});

export const decision_books_straddling_row = defineDecision({
  id: "books.straddling-row",
  title: "A row straddles a period when a payout settles in one and returns in the next",
  question:
    "Reclassify #3 refuses 'a commitment whose claims fall on both sides of the period'. On v4 each agreement collection " +
    "is its own Payment with one money fact, so which row can have money facts in two periods, and does payments need to " +
    "group collections by their agreement?",
  options: [
    {
      label: "payout-return",
      text:
        "A bank payout's Payment: its settlement is one fact, and the bank's return is a second fact on the same row " +
        "(`payout_returned`, which banking books referencing the payout's Payment). A payout settled before a month's end " +
        "and returned after it straddles that month.",
    },
    { label: "collections-by-agreement", text: "Payments references each collection by its agreement, and books treats the agreement as one row." },
    { label: "retire", text: "Retire line 3 as having no v4 case." },
  ],
  chosen: "payout-return",
  why:
    "The claim is kept word for word (P1), so it needs a real v4 row. Grouping collections would make payments know payroll's agreements, which the map keeps apart (dependencies.payments-payroll), and payments keeps one Payment per collection (payments.chain-born-ids). A payout and its return are the same row's two money facts, the shape the old commitment had. The world is org-with-straddling-payout, built on org-with-chart: a payout settled on the last day of a month and returned by Bridge's fake after a `dev time warp` past it (devnet.straddling-payout-world); banking passes the payout's Payment as the return fact's reference (banking.payout-return-reference). Review, 11 November 2026: Confirmed books.straddling-row; original choice retained.",
  source: by("org.books.accounts.reclassify.yaml #3; blueprint/banking/processes.ts (payout_returned); dependencies.payments-payroll"),
  affects: [procedure_books_record_money_fact],
});

export const decision_books_dropped = defineDecision({
  id: "books.dropped",
  title: "What of old books is not ported",
  question: "Which old books functions, rows and tables have no target record?",
  options: [
    {
      label: "drop",
      text:
        "keepers.list (no frozen operation: the Books hat's wearers are a chain view); the backfill, observe, open and " +
        "outside internals; set-price (devnet's); the 9 emit-* actions (P7); assets.target, admit and tokens, and the " +
        "reports' *At queries (steps of one rpc or workflow, P3); activity's clearRetired (P9); the bookCursors and " +
        "bookKeepers tables; the door's read functions (bookAssetInTx and the rest), which become plain reads of books' tables.",
    },
    { label: "port", text: "Port each as an internal rpc." },
  ],
  chosen: "drop",
  why:
    "P2: an rpc with no operation, flow or trigger is not ported; P3: a load, intent, record or emit split becomes steps; " +
    "P4: a concept above books reads its tables directly, so only the two money-fact procedures cross the door.",
  source: by(`${B}/README.md:163 (the tree); ${B}/index.ts:1 (the door); docs/as-is/archive/books/procedures.ts`),
  affects: [concept_books, procedure_books_record_money_fact, procedure_books_reverse_money_fact, rpc_books_assets_add, workflow_books_assets_scan_added],
});

export const decision_books_budgets = defineDecision({
  id: "books.budgets",
  title: "Every books record takes its class default",
  question: "Does any books operation, rpc, flow or workflow need a budget other than its class default (P5)?",
  options: [
  {
    "label": "current-scope",
    "text": "Retained Core books reads use read, annotation writes write, chain metadata reads chain-read and token/price background work background. Site door calls use their declared vendor budgets. There is no books head-sync budget: that workflow is superseded by plugs event delivery."
  },
  {
    "label": "historical",
    "text": "The former answer to books.budgets is preserved in docs/cut-archive/decision-review-history.json as historical evidence, not implementation authority."
  }
],
  chosen: "current-scope",
  why:
    "Review, 11 November 2026: Retained Core books reads use read, annotation writes write, chain metadata reads chain-read and token/price background work background. Site door calls use their declared vendor budgets. There is no books head-sync budget: that workflow is superseded by plugs event delivery. Authority: cut.books; plugs.repoint-money-fact; plugs.late-and-closed.",
  source: "The coordinator, round 2, m1-old-decisions; cut.books; plugs.repoint-money-fact; plugs.late-and-closed",
  affects: [
    rpc_books_assets_add,
  ],
});

// ── target assembly (builder) ───────────────────────────────────────────────────────────────

const BUILDER = (evidence: string) => `Claude, target assembly (builder), 8 November 2026; evidence: ${evidence}`;

export const decision_books_annotate_declined_preview = defineDecision({
  id: "books.annotate-declined-preview",
  title: "A declined `activity annotate` preview ends CANCELLED",
  question: "`activity annotate` shows a preview at a terminal and asks before it saves. What does a 'no' end with?",
  options: [
    { label: "cancelled", text: "CANCELLED (exit 130), listed in the operation's `errors` with CLI_USAGE: the CLI asks before its one rpc." },
    { label: "usage", text: "CLI_USAGE, as the old CLI's confirmWrite answered." },
  ],
  chosen: "cancelled",
  why:
    "The shared rule (vocabulary.declined-preview-cancelled) is one answer for every command. A script without " +
    "`--confirm` stays CLI_USAGE, so acceptance #6 is unchanged, and a 'no' saves nothing, as #5's refused save does.",
  source: BUILDER("blueprint/shared/decisions.ts (vocabulary.declined-preview-cancelled); frozen activity.annotate (preview, #6)"),
  affects: [ops.operation_activity_annotate],
});

// ── ERPNext accounting's shape (aaron.books-first-principles) ───────────────────────────────

export const decision_books_frappe_shape = defineDecision({
  id: "books.frappe-shape",
  title: "Archived: Each books table is one ERPNext doctype, with Frappe's field names",
  question:
    "The books are redesigned in the shape of ERPNext's accounting, complete without a head and synced with one. How literally do Capxul's tables take Frappe's shapes?",
  options: [
  {
    "label": "current-scope",
    "text": "Archive one-Core-table-per-ERPNext-DocType. Company, Account, Cost Center, Journal Entry, Payment Entry and GL Entry are real site documents, not Core replicas carrying capxul_id for bidirectional sync. Core retains chain facts, annotations and prices only as money evidence/read models."
  },
  {
    "label": "historical",
    "text": "The former answer to books.frappe-shape is preserved in docs/cut-archive/decision-review-history.json as historical evidence, not implementation authority."
  }
],
  chosen: "current-scope",
  why:
    "Review, 11 November 2026: Archive one-Core-table-per-ERPNext-DocType. Company, Account, Cost Center, Journal Entry, Payment Entry and GL Entry are real site documents, not Core replicas carrying capxul_id for bidirectional sync. Core retains chain facts, annotations and prices only as money evidence/read models. Authority: cut.books; plugs.repoint-money-fact; plugs.late-and-closed.",
  source: "The coordinator, round 2, m1-old-decisions; cut.books; plugs.repoint-money-fact; plugs.late-and-closed",
  affects: [concept_books, table_book_annotations, table_book_facts],
});

export const decision_books_chart_tree = defineDecision({
  id: "books.chart-tree",
  title: "Superseded by books.chart-owner: the chart is the site's Account tree alone",
  question:
    "Capxul's chart had six types by a code's first digit and sub-accounts that could hold their own money. ERPNext's chart is a tree of five root types in which only a ledger account takes GL Entries and an account with entries cannot become a group. How does Capxul's chart sit in that tree without losing a frozen behaviour?",
  options: [
  {
    "label": "current-scope",
    "text": "ERPNext owns the Account tree and its ledger/group checks. Archive Core's six-type code allocator, parent conversion and template-protected account algorithm; chart creation and edits go through the door under site permissions. Safe-account ledger hooks still prohibit credit without chain evidence."
  },
  {
    "label": "historical",
    "text": "The former answer to books.chart-tree is preserved in docs/cut-archive/decision-review-history.json as historical evidence, not implementation authority."
  }
],
  chosen: "current-scope",
  why:
    "Review, 11 November 2026: ERPNext owns the Account tree and its ledger/group checks. Archive Core's six-type code allocator, parent conversion and template-protected account algorithm; chart creation and edits go through the door under site permissions. Safe-account ledger hooks still prohibit credit without chain evidence. Authority: cut.books; plugs.repoint-money-fact; plugs.late-and-closed. " +
    "Superseded on 12 November 2026 by Aaron's answer to books.chart-owner (ERPNext alone holds the chart): the book-accounts table, its machine and its event are gone, and an annotation names the site's Accounts by their names there (books.annotate-site-chart).",
  source: "The coordinator, round 2, m1-old-decisions; cut.books; plugs.repoint-money-fact; plugs.late-and-closed",
  affects: [concept_books, table_book_annotations, rpc_books_annotations_save],
});

export const decision_books_feed = defineDecision({
  id: "books.feed",
  title: "Facts are numbered without a gap per Organization, under its books' row lock",
  question:
    "Vision check C5: a ledger following Capxul's facts by when money happened can skip a fact recorded late, and facts come from several writers in their own transactions (payments' settlements, banking's deposits, books' own scan and rpcs). How does a ledger follow every fact exactly once?",
  options: [
  {
    "label": "current-scope",
    "text": "Ordered money delivery needs a per-organization sequence and idempotent replay; timestamps alone cannot be a cursor because facts arrive late. The current stream and delivery cursors belong to plugs. Archive the old book-companies row-lock allocator and books.sync.feed as the implementation of that stream."
  },
  {
    "label": "historical",
    "text": "The former answer to books.feed is preserved in docs/cut-archive/decision-review-history.json as historical evidence, not implementation authority."
  }
],
  chosen: "current-scope",
  why:
    "Review, 11 November 2026: Ordered money delivery needs a per-organization sequence and idempotent replay; timestamps alone cannot be a cursor because facts arrive late. The current stream and delivery cursors belong to plugs. Archive the old book-companies row-lock allocator and books.sync.feed as the implementation of that stream. Authority: cut.books; plugs.repoint-money-fact; plugs.late-and-closed. " +
    "12 November 2026 (books.chart-owner): book-companies is gone; its counter stays alone as book-feeds, because the facts still carry gap-free numbers (books.feed-gap-free, plugs.repoint-money-fact). The stream the site follows is numbered by the plugs' outbox.",
  source: "The coordinator, round 2, m1-old-decisions; cut.books; plugs.repoint-money-fact; plugs.late-and-closed",
  affects: [
    table_book_feeds,
    table_book_facts,
    invariant_books_feed_gap_free,
    procedure_books_record_money_fact,
    procedure_books_reverse_money_fact,
    workflow_books_assets_scan_added,
  ],
});

export const decision_books_fact_read = defineDecision({
  id: "books.fact-read",
  title: "A money fact's read is enough to post it: block time, Safe, log and Party",
  question:
    "Vision check C6: a fact's read had its block time and transaction but not its Safe, its log index or a counterparty pinned to the directory. What must a fact carry so a ledger can post it without asking anything else?",
  options: [
  {
    "label": "current-scope",
    "text": "A fact read retains the side's Safe, chain, block, transaction, log index, exact amount, fee and known counterparty Party. Payments/banking supply this evidence at record time. The site owns posting date and voucher; those are projection results rather than authority for changing the original chain evidence."
  },
  {
    "label": "historical",
    "text": "The former answer to books.fact-read is preserved in docs/cut-archive/decision-review-history.json as historical evidence, not implementation authority."
  }
],
  chosen: "current-scope",
  why:
    "Review, 11 November 2026: A fact read retains the side's Safe, chain, block, transaction, log index, exact amount, fee and known counterparty Party. Payments/banking supply this evidence at record time. The site owns posting date and voucher; those are projection results rather than authority for changing the original chain evidence. Authority: cut.books; plugs.repoint-money-fact; plugs.late-and-closed.",
  source: "The coordinator, round 2, m1-old-decisions; cut.books; plugs.repoint-money-fact; plugs.late-and-closed",
  affects: [table_book_facts, procedure_books_record_money_fact, rpc_books_facts_list, ops.operation_org_books_facts_list],
});

export const decision_books_vouchers = defineDecision({
  id: "books.vouchers",
  title: "Each standing priced money fact posts one Journal or Payment Entry",
  question:
    "Money proven on chain must post ERPNext's entries. Which voucher does each kind of money fact make, with which lines, is the voucher stored or derived, and how does a head follow a voucher that changes?",
  options: [
  {
    "label": "current-scope",
    "text": "The site posts real ERPNext vouchers when chain evidence arrives, with exact money labels and idempotent event identity. Archive read-time frappe-v1 voucher derivation and cancel/amend-on-version sync. Posted Safe payments cannot be deleted or cancelled to undo money: a refund is a new chain payment and a matched reversing entry. Late facts use the open period."
  },
  {
    "label": "historical",
    "text": "The former answer to books.vouchers is preserved in docs/cut-archive/decision-review-history.json as historical evidence, not implementation authority."
  }
],
  chosen: "current-scope",
  why:
    "Review, 11 November 2026: The site posts real ERPNext vouchers when chain evidence arrives, with exact money labels and idempotent event identity. Archive read-time frappe-v1 voucher derivation and cancel/amend-on-version sync. Posted Safe payments cannot be deleted or cancelled to undo money: a refund is a new chain payment and a matched reversing entry. Late facts use the open period. Authority: cut.books; plugs.repoint-money-fact; plugs.late-and-closed.",
  source: "The coordinator, round 2, m1-old-decisions; cut.books; plugs.repoint-money-fact; plugs.late-and-closed",
  affects: [
    table_book_facts,
    table_book_annotations,
    procedure_books_record_money_fact,
    procedure_books_reverse_money_fact,
    rpc_books_annotations_save,
    rpc_books_assets_add,
    invariant_books_one_live_money_fact,
  ],
});

export const decision_books_sync = defineDecision({
  id: "books.sync",
  title: "Archived: Books' own process syncs a head, both ways, one author per voucher",
  question:
    "When an ERPNext head is connected, how do the books and the head stay one ledger in both directions, with no voucher posted twice, no second source of truth for money, and the system's one head pattern?",
  options: [
  {
    "label": "current-scope",
    "text": "Archive bidirectional books.head.sync. There is no optional head or shared authorship of chart/annotations across two ledgers. ERPNext is the book of record; the service delivers ordered idempotent chain events through plugs, and site edits remain site edits subject to ledger hooks."
  },
  {
    "label": "historical",
    "text": "The former answer to books.sync is preserved in docs/cut-archive/decision-review-history.json as historical evidence, not implementation authority."
  }
],
  chosen: "current-scope",
  why:
    "Review, 11 November 2026: Archive bidirectional books.head.sync. There is no optional head or shared authorship of chart/annotations across two ledgers. ERPNext is the book of record; the service delivers ordered idempotent chain events through plugs, and site edits remain site edits subject to ledger hooks. Authority: cut.books; plugs.repoint-money-fact; plugs.late-and-closed.",
  source: "The coordinator, round 2, m1-old-decisions; cut.books; plugs.repoint-money-fact; plugs.late-and-closed",
  affects: [
    rpc_books_annotations_save,
  ],
});

export const decision_books_closed_periods = defineDecision({
  id: "books.closed-periods",
  title: "A head's closing freezes the past: late money posts on the first open day",
  question:
    "ERPNext refuses entries and reposts on or before a Period Closing Voucher. Capxul's facts can arrive late (an added token's scan, a deposit credited days after its block) and its rows can be recategorized at any time. What happens to a closed period?",
  options: [
  {
    "label": "current-scope",
    "text": "The site's closing state governs postings. Late chain events post into the first open period while retaining original block time. Closed-period corrections are open-period adjustments, never rewriting history. Do not pull Period Closing Vouchers into a second Core chart or forbid unrelated ERPNext Accounting Period usage through the old sync algorithm."
  },
  {
    "label": "historical",
    "text": "The former answer to books.closed-periods is preserved in docs/cut-archive/decision-review-history.json as historical evidence, not implementation authority."
  }
],
  chosen: "current-scope",
  why:
    "Review, 11 November 2026: The site's closing state governs postings. Late chain events post into the first open period while retaining original block time. Closed-period corrections are open-period adjustments, never rewriting history. Do not pull Period Closing Vouchers into a second Core chart or forbid unrelated ERPNext Accounting Period usage through the old sync algorithm. Authority: cut.books; plugs.repoint-money-fact; plugs.late-and-closed.",
  source: "The coordinator, round 2, m1-old-decisions; cut.books; plugs.repoint-money-fact; plugs.late-and-closed",
  affects: [table_book_facts, procedure_books_record_money_fact, rpc_books_annotations_save],
});

export const decision_books_company_settings = defineDecision({
  id: "books.company-settings",
  title: "Superseded by books.chart-owner: currency, time zone, fiscal year are the site's",
  question:
    "Vision check C18: ERPNext posts by date in the site's time zone, closes by fiscal year and keeps a functional currency, and Capxul's reports cut at 'the end of the day' without saying whose. The Organization now carries the Company's currency, time zone and fiscal year start (organizations.company-shape). How do the books use them, and what if one changes under existing books?",
  options: [
  {
    "label": "current-scope",
    "text": "ERPNext Company owns currency, time zone and fiscal year. Site posting dates use its time zone and functional currency; chain facts keep exact token units and block time. Archive the immutable Core copy made at chart import and the requirement that chart import find a Chainlink currency pair: site accounting is not a duplicate Core USD ledger."
  },
  {
    "label": "historical",
    "text": "The former answer to books.company-settings is preserved in docs/cut-archive/decision-review-history.json as historical evidence, not implementation authority."
  }
],
  chosen: "current-scope",
  why:
    "Review, 11 November 2026: ERPNext Company owns currency, time zone and fiscal year. Site posting dates use its time zone and functional currency; chain facts keep exact token units and block time. Archive the immutable Core copy made at chart import and the requirement that chart import find a Chainlink currency pair: site accounting is not a duplicate Core USD ledger. Authority: cut.books; plugs.repoint-money-fact; plugs.late-and-closed. " +
    "Superseded on 12 November 2026 by books.chart-owner: book-companies, which held the copy, is gone; only its feed counter remains, as book-feeds.",
  source: "The coordinator, round 2, m1-old-decisions; cut.books; plugs.repoint-money-fact; plugs.late-and-closed",
  affects: [concept_books, table_book_feeds],
});

export const decision_books_cost_centers = defineDecision({
  id: "books.cost-centers",
  title: "Superseded by books.chart-owner: every cost centre is the site's",
  question:
    "ERPNext requires a cost centre on every profit-and-loss line. No frozen command makes one. Where do cost centres come from?",
  options: [
  {
    "label": "current-scope",
    "text": "Cost Center documents and the company's default cost centre belong to ERPNext. Posting uses the supplied cost-centre label validated on that site. Archive Core's import-created Main and cost-centre pull mirror; no Core cost-centre machine or edit API is introduced."
  },
  {
    "label": "historical",
    "text": "The former answer to books.cost-centers is preserved in docs/cut-archive/decision-review-history.json as historical evidence, not implementation authority."
  }
],
  chosen: "current-scope",
  why:
    "Review, 11 November 2026: Cost Center documents and the company's default cost centre belong to ERPNext. Posting uses the supplied cost-centre label validated on that site. Archive Core's import-created Main and cost-centre pull mirror; no Core cost-centre machine or edit API is introduced. Authority: cut.books; plugs.repoint-money-fact; plugs.late-and-closed. " +
    "Superseded on 12 November 2026 by books.chart-owner, which settles it the same way.",
  source: "The coordinator, round 2, m1-old-decisions; cut.books; plugs.repoint-money-fact; plugs.late-and-closed",
  affects: [rpc_books_annotations_save],
});

export const decision_books_payroll_accrual = defineDecision({
  id: "books.payroll-accrual",
  title: "Archived: A run Capxul computed accrues through a books door; a head's run is th",
  question:
    "Payroll keeps Frappe HR's runs and slips from the first day, head or no head, and asks books to post a run's accrual (payroll.accrual), since a slip's net is paid by a Bank Entry on Payroll Payable. Books sits below payroll and cannot read it. Who posts the accrual, and how does it reach the books?",
  options: [
  {
    "label": "current-scope",
    "text": "Frappe HR owns run submission, cancellation and its accrual Journal Entry. Archive books.record-payroll-accrual and payroll document-voucher/feed copies; no Core submit/cancel transaction posts another accrual. Chain payment settlement arrives separately through plugs and clears the appropriate site payable once."
  },
  {
    "label": "historical",
    "text": "The former answer to books.payroll-accrual is preserved in docs/cut-archive/decision-review-history.json as historical evidence, not implementation authority."
  }
],
  chosen: "current-scope",
  why:
    "Review, 11 November 2026: Frappe HR owns run submission, cancellation and its accrual Journal Entry. Archive books.record-payroll-accrual and payroll document-voucher/feed copies; no Core submit/cancel transaction posts another accrual. Chain payment settlement arrives separately through plugs and clears the appropriate site payable once. Authority: cut.books; plugs.repoint-money-fact; plugs.late-and-closed.",
  source: "The coordinator, round 2, m1-old-decisions; cut.books; plugs.repoint-money-fact; plugs.late-and-closed",
  affects: [
    table_book_facts,
  ],
});

// ── the assembly after the Frappe lanes (8 November 2026) ───────────────────────────────────

const ASSEMBLY = "Claude, assembly of the Frappe lanes (ledger: books and payroll), 8 November 2026";
const byAssembly = (evidence: string) => `${ASSEMBLY}; evidence: ${evidence}`;

export const decision_books_startup = defineDecision({
  id: "books.startup",
  title: "Superseded by books.chart-owner: the site's setup makes the chart",
  question:
    "organizations.startup has each fundamental app start itself from the setup's `begin`. The projects lane asked books for a start-up there: the account tree from a template, the first Fiscal Year and the main Cost Center, reading `abbr`, `default_currency`, `time_zone` and `fiscal_year_start` from the Organization. What does books do at begin?",
  options: [
  {
    "label": "current-scope",
    "text": "Company setup provisions the hosted site and initializes ERPNext accounting there. Archive the lazy Core Company birth at first money fact and org books accounts import first-sitting requirement, including the hosted FDE chart step. Recording a chain fact must not depend on an editable Core chart already existing."
  },
  {
    "label": "historical",
    "text": "The former answer to books.startup is preserved in docs/cut-archive/decision-review-history.json as historical evidence, not implementation authority."
  }
],
  chosen: "current-scope",
  why:
    "Review, 11 November 2026: Company setup provisions the hosted site and initializes ERPNext accounting there. Archive the lazy Core Company birth at first money fact and org books accounts import first-sitting requirement, including the hosted FDE chart step. Recording a chain fact must not depend on an editable Core chart already existing. Authority: cut.books; plugs.repoint-money-fact; plugs.late-and-closed. " +
    "Superseded on 12 November 2026 by books.chart-owner: the setup wizard of the Capxul app makes the Company and its chart (component frappe-app, capxul/setup.py); the books' only row born at the first fact is its feed counter.",
  source: "The coordinator, round 2, m1-old-decisions; cut.books; plugs.repoint-money-fact; plugs.late-and-closed",
  affects: [concept_books, table_book_feeds, component_frappe_app],
});

export const decision_books_payroll_defaults = defineDecision({
  id: "books.payroll-defaults",
  title: "Archived: Payroll's default accounts are books' role accounts: 2200, 5000 and ea",
  question:
    "Payroll stores books' account ids on its records (a component's expense and liability, a run's and an assignment's Payroll Payable, a run's treasury account), and asks books for the defaults. Which accounts are they, and where does a payroll line go when its account is missing or unfit?",
  options: [
  {
    "label": "current-scope",
    "text": "Payroll Payable, salary expense and treasury defaults are configured in Frappe HR/ERPNext Company and structures. Archive Core role-account lookups by 2200/5000 and null-before-chart filling. A Safe ledger account is still guarded by the chain-payment hook, not made editable by setting a default."
  },
  {
    "label": "historical",
    "text": "The former answer to books.payroll-defaults is preserved in docs/cut-archive/decision-review-history.json as historical evidence, not implementation authority."
  }
],
  chosen: "current-scope",
  why:
    "Review, 11 November 2026: Payroll Payable, salary expense and treasury defaults are configured in Frappe HR/ERPNext Company and structures. Archive Core role-account lookups by 2200/5000 and null-before-chart filling. A Safe ledger account is still guarded by the chain-payment hook, not made editable by setting a default. Authority: cut.books; plugs.repoint-money-fact; plugs.late-and-closed.",
  source: "The coordinator, round 2, m1-old-decisions; cut.books; plugs.repoint-money-fact; plugs.late-and-closed",
  affects: [concept_books],
});

export const decision_books_payroll_postings = defineDecision({
  id: "books.payroll-postings",
  title: "How payroll's money posts: a slip's Bank Entry, a collection's accrual",
  question:
    "Payroll asks for one Bank Entry per settled payroll Payment, a collection posted as expense with party Employee (a Supplier Payment Entry for an Organization payee), and remittances on their liabilities. Accounting saw that a collection reaches books unclassified, since payments does not know agreements. Books can read neither payroll nor payments. How does each of payroll's money facts post?",
  options: [
  {
    "label": "current-scope",
    "text": "A site payroll net is paid by a held Core payment; settlement submits the matching site entry once with chain transaction and document hash. Frappe owns the accrual and Employee payable. Archive collection-created Core salary slips, duplicate accruals and Core-generated Payroll Entry allocation algorithms; refunds and late postings follow plugs rules."
  },
  {
    "label": "historical",
    "text": "The former answer to books.payroll-postings is preserved in docs/cut-archive/decision-review-history.json as historical evidence, not implementation authority."
  }
],
  chosen: "current-scope",
  why:
    "Review, 11 November 2026: A site payroll net is paid by a held Core payment; settlement submits the matching site entry once with chain transaction and document hash. Frappe owns the accrual and Employee payable. Archive collection-created Core salary slips, duplicate accruals and Core-generated Payroll Entry allocation algorithms; refunds and late postings follow plugs rules. Authority: cut.books; plugs.repoint-money-fact; plugs.late-and-closed.",
  source: "The coordinator, round 2, m1-old-decisions; cut.books; plugs.repoint-money-fact; plugs.late-and-closed",
  affects: [
    procedure_books_record_money_fact,
    table_book_annotations,
  ],
});

export const decision_books_escrow_held = defineDecision({
  id: "books.escrow-held",
  title: "Money waiting in a claim escrow posts nothing until claimed; no clearing account",
  question:
    "Payroll asked for escrow clearing entries: into a Capxul Escrow account when a new hire's net is funded into a " +
    "claim escrow, to Payroll Payable on the claim, back to the treasury on a refund. Books' rule is that money waiting " +
    "in a claim escrow posts nothing until the escrow pays. Which holds?",
  options: [
    {
      label: "held-until-claim",
      text:
        "Nothing posts while the money waits: the Payment settles at the claim, and its voucher (a slip's Bank Entry) " +
        "posts then; a refund cancels the Payment and posts nothing, so the net stays owed on Payroll Payable. The " +
        "reconcile shows the waiting money as `held` (books.reconcile-held).",
    },
    {
      label: "clearing-account",
      text:
        "A protected Capxul Escrow asset account: the funding posts Dr Escrow, Cr Safe; the claim Dr Payroll Payable, Cr " +
        "Escrow; a refund Dr Safe, Cr Escrow.",
    },
  ],
  chosen: "held-until-claim",
  why:
    "Both keep total assets right, since a refundable escrow is still the Organization's money; they differ only in which asset account shows it. A clearing account needs money facts for the funding and the refund, which payments sets aside on purpose because a Payment, not a Transfer, explains them (K17), and would add two vouchers to every claim escrow, not only payroll's. The frozen reconcile claim already explains the difference with `held` while an escrow is open. Both the payroll and the accounting designs (docs/design/frappe) read it this way; only the assembly list asked for the account. Review, 11 November 2026: Confirmed books.escrow-held; original choice retained.",
  source: byAssembly("books.reconcile-held; org.books.reports.reconcile line 1; payments.movements.record (K17); docs/design/frappe/payroll.md"),
  affects: [procedure_books_record_money_fact, ],
});

export const decision_books_annotation_project = defineDecision({
  id: "books.annotation-project",
  title: "An annotation's project is one of the Organization's projects",
  question:
    "A voucher's other side carries a project, as a GL Entry does. It was opaque text while books could not read projects; books now depends on projects (dependencies.of-books). What does books check?",
  options: [
  {
    "label": "current-scope",
    "text": "A project classification must resolve to a Project of the same company on the site. Do not validate it against a removed Core projects table or sync head_name. An invalid cross-company project cannot post; unmatched money remains visible for review rather than disappearing."
  },
  {
    "label": "historical",
    "text": "The former answer to books.annotation-project is preserved in docs/cut-archive/decision-review-history.json as historical evidence, not implementation authority."
  }
],
  chosen: "current-scope",
  why:
    "Review, 11 November 2026: A project classification must resolve to a Project of the same company on the site. Do not validate it against a removed Core projects table or sync head_name. An invalid cross-company project cannot post; unmatched money remains visible for review rather than disappearing. Authority: cut.books; plugs.repoint-money-fact; plugs.late-and-closed.",
  source: "The coordinator, round 2, m1-old-decisions; cut.books; plugs.repoint-money-fact; plugs.late-and-closed",
  affects: [rpc_books_annotations_save, procedure_books_record_money_fact, table_book_annotations],
});

export const decision_books_party_lines = defineDecision({
  id: "books.party-lines",
  title: "A voucher line names a party only on an account ERPNext lets carry one",
  question:
    "A bank payout's side carries a party (the contact's Party as Supplier) and no account, and a paid request's or a payer's side may too. Until someone annotates the row it waits in 6999, and a payout to your own bank account (scope self) carries no party. ERPNext refuses a party on an account whose type is not Receivable, Payable or Equity. What does the voucher post for such a row?",
  options: [
  {
    "label": "current-scope",
    "text": "The site resolves a known Party to Customer, Supplier or Employee and uses ERPNext's permitted party/account combinations. Unknown counterparties or invalid classifications remain unmatched and visible. Archive the fixed 6999 waiting account and Core-generated unallocated advance algorithm; own-bank transfers must not become expenses merely because no party exists."
  },
  {
    "label": "historical",
    "text": "The former answer to books.party-lines is preserved in docs/cut-archive/decision-review-history.json as historical evidence, not implementation authority."
  }
],
  chosen: "current-scope",
  why:
    "Review, 11 November 2026: The site resolves a known Party to Customer, Supplier or Employee and uses ERPNext's permitted party/account combinations. Unknown counterparties or invalid classifications remain unmatched and visible. Archive the fixed 6999 waiting account and Core-generated unallocated advance algorithm; own-bank transfers must not become expenses merely because no party exists. Authority: cut.books; plugs.repoint-money-fact; plugs.late-and-closed.",
  source: "The coordinator, round 2, m1-old-decisions; cut.books; plugs.repoint-money-fact; plugs.late-and-closed",
  affects: [procedure_books_record_money_fact, table_book_annotations, rpc_books_annotations_save],
});

export const decision_books_head_setup = defineDecision({
  id: "books.head-setup",
  title: "Superseded by books.chart-owner: Capxul pushes no chart to a site",
  question:
    "A head's ERPNext Company already has a chart, a root cost centre and Main, default accounts and settings of its " +
    "own. What does a connected head's accounting look like before books pushes its first voucher, who sets it, and may a " +
    "head connect before the books are charted?",
  options: [
    {
      label: "site-owns-chart",
      text:
        "Nothing is pushed. Every Organization's site is Capxul's and its chart is ERPNext's alone (books.chart-owner): " +
        "the Capxul app's setup makes the Company with its chart, its Main cost centre and its defaults, adds the Safe's " +
        "ledger Account and Bank Account (capxul/setup.py), and refuses any credit to the Safe's account that the chain " +
        "did not prove (capxul/payments.py). Capxul's service sends only money facts, through the plugs' outbox.",
    },
    {
      label: "app-setup-before-push",
      text:
        "The earlier choice: books pushes the chart it keeps through `upsertDocs` in tree order, each Account with its " +
        "`capxul_id`, adopts the site's root cost centre and Main, and sets the Company's defaults to its role accounts.",
    },
    {
      label: "importer",
      text: "Replace the head's chart with ERPNext's Chart of Accounts Importer, which a Company with no transactions accepts.",
    },
    { label: "head-agent", text: "The head's own agent, on a Seat wearing the Books hat, sets the head up from the books' feed." },
  ],
  chosen: "site-owns-chart",
  why:
    "Aaron answered books.chart-owner on 12 November 2026 (frappe-owns-chart, a-20261112T060739-819d79): ERPNext alone " +
    "holds the chart, and Capxul's service keeps only the on-chain money facts, their annotations and the tokens it " +
    "watches. With no Capxul copy there is nothing to push, so `app-setup-before-push` (chosen on 8 November, when a " +
    "head was optional and books kept the chart) no longer holds. What it got right stays in the Capxul app: the Safe's " +
    "account is guarded on the site itself, not only by Capxul.",
  source: `Aaron's answer to books.chart-owner, 12 November 2026; packages/frappe-app/capxul/setup.py; packages/frappe-app/capxul/payments.py; earlier: ${ASSEMBLY}`,
  affects: [component_frappe_app, concept_books],
});

// ── the chart on the site (12 November 2026): books.chart-owner ────────────────────────────

export const decision_books_annotate_site_chart = defineDecision({
  id: "books.annotate-site-chart",
  title: "An annotation names the site's Accounts, checked through the site's door",
  question:
    "Aaron answered books.chart-owner: ERPNext alone holds the chart, on the Organization's site. `activity annotate` " +
    "still refuses an unknown account and lets a Books hat wearer make a new account inline (frozen claims), and a " +
    "payment's `--account` names one too. With no copy of the chart in Capxul, how does an annotation name an account, " +
    "and who checks it?",
  options: [
    {
      label: "site-names-door-check",
      text:
        "The annotation keeps the site's own names (the Account's name, like `6100 - Cleaning - NW`, with its number; a " +
        "Cost Center's and a Project's names). `books.annotations.save` reads the Account through the site's door as the " +
        "person saving (`frappe-site.doorCall`): not a ledger Account of the Company, or disabled, is INVALID_INPUT. A new " +
        "account is inserted on the site through the same door, so ERPNext's checks and the person's site roles decide " +
        "it. The money-fact procedures make no outside call, so a payment's `--account` is kept as given and the Capxul " +
        "app resolves it when it posts; one it cannot post stays unmatched and visible (books.party-lines).",
    },
    {
      label: "no-check",
      text:
        "Save whatever is given; the site resolves it when it posts the entry and leaves an unknown account unmatched. " +
        "The frozen refusal of an unknown account code is dropped.",
    },
    {
      label: "cached-copy",
      text: "Keep a read-only copy of the site's Account list in Capxul, refreshed from the site, and check against it.",
    },
  ],
  chosen: "site-names-door-check",
  why:
    "It keeps the frozen behaviour (an unknown account is refused, a new account needs Manage books) without a second " +
    "copy of the chart, which is exactly what Aaron's answer removed; `cached-copy` would bring the copy back by another " +
    "name. The door already exists for calls a person makes on the site (plugs.service-calls-site), and the site's own " +
    "permissions then apply, as books.guards says. The cost is that an Organization's annotate now needs its site to " +
    "answer (PROVIDER_ERROR when it does not, nothing saved); a person's own rows call no site. Names, not ids: ERPNext " +
    "links Accounts by name, and books.account-at-posting already has the site resolve the event's account labels.",
  source: "Thread \"Move chart of accounts into ERPNext\", 12 November 2026; books.chart-owner; activity.annotate (frozen refusals and claims 1 to 3); plugs.service-calls-site; frappe-site integration (doorCall)",
  affects: [concept_books, table_book_annotations, table_book_facts, rpc_books_annotations_save, procedure_books_record_money_fact, ops.operation_activity_annotate],
});

// ── the world pass's build (9 November 2026): payroll's HR money (payroll.hr-money) ─────────
