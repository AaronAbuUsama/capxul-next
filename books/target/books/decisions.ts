// Books' own judgments, each a decision record linked to the records it shapes (CONVENTIONS rule
// 10). Made by Claude on 8 November 2026 under A1-A4 and P1-P10, with the old code
// (/home/user/factory, integration/factory), the as-is book (docs/as-is/archive/books/) and ADR-0042 as
// evidence. The architecture's own books decisions are in ../shared/decisions.ts
// (concepts.books, concepts.books-token-scan, dependencies.books-below-money,
// responsibilities.keepers).

import { defineDecision } from "../../../packages/book/src/index.ts";
import { component_frappe_app, concept_books } from "../shared/foundation.ts";
import {
  event_book_account_transitioned,
  event_book_annotation_transitioned,
  event_book_asset_transitioned,
  event_book_company_transitioned,
  machine_book_account,
  machine_book_annotation,
  machine_book_asset,
  machine_book_company,
  table_book_accounts,
  table_book_annotations,
  table_book_assets,
  table_book_companies,
  table_book_facts,
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
    table_book_companies,
    machine_book_company,
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
      label: "at-posting",
      text:
        "The fact records the money; its voucher's other side is the row's annotation now (account, party, cost centre, " +
        "project, documents), else its direction's not-decided account at Main; a change reposts the voucher in place.",
    },
    { label: "on-the-fact", text: "Store the account on the fact at record time, as the old writer did, and override it from the assignment when reading." },
  ],
  chosen: "at-posting",
  why:
    "The old reports already posted 'to the account it has now, else the one its fact was booked with, else 4999 or " +
    "6999', so the stored account was only a fallback, and a stored account is a copy that disagrees after every " +
    "recategorization. With facts kept before a chart (books.facts-without-chart) there is no account to store yet. The " +
    "history of a row's accounts is its account_assigned, recategorized and rows_reclassified facts. A head follows a " +
    "repost as a new version of the same voucher, which its app applies by cancelling the document and amending it on " +
    "the voucher's own posting date (books.vouchers): ERPNext cannot change a submitted entry's account in place " +
    "(Journal Entry Account's `account`, `party` and reference are not allow-on-submit, and Repost Accounting Ledger only " +
    "remakes the GL from the document as it stands).",
  source: by(`${B}/README.md:312; ${B}/postings/rules.ts:96; ${ERP}/journal_entry_account (allow_on_submit); repost_accounting_ledger.py:425`),
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
    "The opening existed because a chart could be imported onto a Safe whose history the books had not seen; with facts " +
    "kept from the first money that cannot happen for admitted assets. For an added token the frozen text says transfers " +
    "before the add are not scanned, so without an opening `reconcile` could never match (its line 2 reads added tokens " +
    "too). One more parallel `balanceOf` at the block already read keeps the add in its chain-read class. The opening " +
    "credits 3990, which the template keeps.",
  source: by(`${B}/facts/operations/open.ts:93; ${B}/facts/writes/opening.ts:59; ${B}/README.md:127 (a token added later has no opening yet)`),
  affects: [rpc_books_assets_add, table_book_facts, ops.operation_org_books_assets_add],
});

// ── rows and annotations ────────────────────────────────────────────────────────────────────

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
    "Both were keyed by the same owner and row and saved by the same mutation (`saveAnnotation` then `classifyRow`); two " +
    "rows let a save replace one and not the other. The retired free-text fields (`accountingCategory`, " +
    "`counterpartyLabel`) and their clean-up are not carried (P9). `owner` tenancy because a person's rows and an " +
    "Organization's share one shape; persons keep no facts (ADR-0042 D6).",
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
  title: "Five machines, one event each; facts and cost centres have none",
  question: "Which stored states are machines, now that every product event comes from a transition (P7)?",
  options: [
    {
      label: "five",
      text:
        "book-company (recording, charted), book-account (active, archived), book-annotation (waiting, decided), " +
        "book-document-voucher (submitted, cancelled: Frappe's docstatus) and book-asset (added, removed), each with its " +
        "`<machine>_transitioned`. Facts are append-only rows with no state; a cost centre has no lifecycle Capxul acts on.",
    },
    { label: "as-is", text: "The old three: account status, the chart's stamps, the asset's removedAt; annotations and reclassify keep their own events." },
  ],
  chosen: "five",
  why:
    "The frozen lines check that each committed add, rename, archive, import, save and reclassify is reported once; under " +
    "P7 only a transition reports. The old 8 books events (chart imported, account added, renamed, archived, suggestion " +
    "accepted, rows reclassified, asset added, removed) and activity's annotation event fold into these. The chart's " +
    "machine becomes the Company's books (book-company): born `open` by the first fact, so the feed's counter row exists " +
    "before the chart, and `import`ed once. The chart's backfilled and opened stamps go with the backfill. A reclassify " +
    "reports each row it moves. A document voucher (a head's, a payroll run's accrual) gets a machine because its " +
    "docstatus is a status the reports read. The head sync's cursor row has no machine: it is a process's own state.",
  source: by(`${B}/accounts/events.ts:1; ${B}/assets/events.ts:1; packages/backend/src/activity/annotations/events.ts:36; P7`),
  affects: [
    machine_book_company,
    machine_book_account,
    machine_book_annotation,
    machine_book_asset,
    event_book_company_transitioned,
    event_book_account_transitioned,
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
    { label: "from-empty", text: "The birth is a named transition with `from: []` (open, add, queue, assign, post), emitting like any other." },
    { label: "none-state", text: "Give every machine a `none` state the row never stores." },
  ],
  chosen: "from-empty",
  why: "The schema accepts an empty `from`, the build's state checks pass, and no phantom state is stored or listed. The event's `from` is null for a birth.",
  source: by("packages/book/src/records/data.ts (TransitionSpec.from); docs/as-is/archive/books/data.ts (births said only in prose)"),
  affects: [machine_book_company, machine_book_account, machine_book_annotation, machine_book_asset],
});

// ── authorization, assets, prices ───────────────────────────────────────────────────────────

export const decision_books_guards = defineDecision({
  id: "books.guards",
  title: "Any Seat reads; the Books hat changes; the books gate stays",
  question: "How does each books rpc authorize its caller on v4?",
  options: [
    {
      label: "seat-hat-gate",
      text:
        "Reads need a current Seat (organizations' org-members); changes need the Seat's Safe to wear the Books hat " +
        "(org-deployments' `books_hat`, indexing's hat-wearers); every rpc but annotate refuses FEATURE_NOT_AVAILABLE " +
        "while the `books` gate is off (access' feature-flags). The feed follows the same rule as a read. A connected " +
        "head holds no Capxul key: its users' changes reach the books through books' head sync, each applied with the " +
        "rights of the member the head user is, matched by mailbox (books.sync).",
    },
    { label: "no-gate", text: "As above, without the gate." },
  ],
  chosen: "seat-hat-gate",
  why:
    "Manage books is the Books hat (shared responsibilities.keepers), read from the chain, never a books table. The gate " +
    "stays because import's line 4 checks 'the books gate off' is refused; annotate never read it (it was activity's). " +
    "FEATURE_NOT_AVAILABLE is in each rpc's errors but in no refusal list, since the frozen pages list none.",
  source: by(`${B}/guards.ts:48; ${B}/accounts/operations/import.ts:16; packages/backend/src/access/features/guards.ts:121`),
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
    "As in the old code: they change only with a deployment, and payments needs the same list. Only they are priced, so " +
    "an added token named USDC never takes USDC's price. A Company currency's pair is the same kind of configuration: " +
    "a voucher in that currency divides each fact's USD value by its rate at the block, so a currency the deployment " +
    "lists no pair for cannot be valued, and the import refuses it (INVALID_INPUT `currency_not_priced`); organizations " +
    "starts a country whose currency has none in USD (organizations.company-shape).",
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
      label: "final-only",
      text:
        "A singleton cron each minute; each `added` row keeps its `next_block`; it reads Transfer logs only to the " +
        "finality depth below the head and books each as outside money keyed by the Transfer; no reversals.",
    },
    { label: "head", text: "Read to the head as the old Movement scanner did, and reverse what a reorganization removes." },
  ],
  chosen: "final-only",
  why:
    "Reading only final blocks makes every fact it writes permanent, so the scan needs no reversal path; the minute it " +
    "trails costs nothing for tokens Capxul never pays in. The cursor sits on the asset row (one per token per " +
    "Organization), replacing the old indexing checkpoint and bookCursors. Its facts are what activity shows for an " +
    "added token, since no Movement exists for it.",
  source: by("packages/backend/src/platform/jobs.ts:139; packages/backend/src/indexing/movements/operations/scan-added.ts:32; P3"),
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
    "P1 rewrites a line that names a mechanism. The rewritten lines still pass against the old system, which posted one " +
    "event per committed change and none for a refusal. Rewritten: annotate 5; import 2, 3, 4; add 3; rename 4, 5; " +
    "archive 2, 3; reclassify 4; assets add 4, 5; assets remove 3, 4. Every other line is word for word, including " +
    "trial balance 4 ('a chart fact posts nothing'), where 'posts' means posting lines, and reclassify 3, whose " +
    "straddling row on v4 is any row with money facts on both sides of the period. With the books in ERPNext's shape " +
    "the import is observed as book_company_transitioned (transition import), the chart's machine having become the " +
    "Company's books (books.machines); every claim keeps its words.",
  source: by("books/frozen/operations.ts (the 17 books operations' acceptance); P1; P7"),
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
      label: "five",
      text:
        "org-without-chart: an Organization whose Safe has settled money in and out, a Director wearing the Books hat, a " +
        "Seat without it and an outsider, no chart. org-with-chart: the same after the import, with a row waiting in 6999 " +
        "with a suggestion, an outside deposit nobody annotated, a sub-account and an archived account. " +
        "org-with-chart-and-added-token: plus an ERC-20 the Safe holds, added. org-with-chart-and-node-down: " +
        "org-with-chart with chain-rpc's fault switch on. signed-out: no sign-in on the machine.",
    },
    { label: "per-refusal", text: "One world per refusal." },
  ],
  chosen: "five",
  why:
    "Each refusal is reached by one command from one of these, as one of its identities, with no other setup. " +
    "`assets list`'s INVALID_INPUT (an empty id) stays `?`: the CLI's scope refuses an empty `--org` with CLI_USAGE " +
    "first. Reclassify line 3 needs, in org-with-chart, a row with money on both sides of a month: a bank payout's " +
    "Payment settled before the month's end and returned after it (books.straddling-row). Add's line 1 needs 6100 to " +
    "hold no postings in org-with-chart, since only an account with none can become a group (books.chart-tree).",
  source: by("docs/as-is/archive/operations/books.ts (the as-is worlds after-s1 and ?); CONVENTIONS rule 9"),
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
    "The claim is kept word for word (P1), so it needs a real v4 row. Grouping collections would make payments know " +
    "payroll's agreements, which the map keeps apart (dependencies.payments-payroll), and payments keeps one Payment per " +
    "collection (payments.chain-born-ids). A payout and its return are the same row's two money facts, the shape the old " +
    "commitment had. The world is org-with-straddling-payout, built on org-with-chart: a payout settled on the last day of " +
    "a month and returned by Bridge's fake after a `dev time warp` past it (devnet.straddling-payout-world); banking passes " +
    "the payout's Payment as the return fact's reference (banking.payout-return-reference).",
  source: by("org.books.accounts.reclassify.yaml #3; books/target/banking/processes.ts (payout_returned); dependencies.payments-payroll"),
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
      label: "defaults",
      text:
        "Reads `read`, changes `write`, the two chain reads `chain-read`, the review flow `write`, the feed's follow " +
        "flow `read` (its waits excluded), the two crons and the head sync `background`.",
    },
    { label: "override-reports", text: "Give the reports a slower read budget, since they post every fact to their end." },
  ],
  chosen: "defaults",
  why:
    "The reports post from the indexed facts in one query per report; an Organization's facts number in the thousands, " +
    "well inside a 100 ms server share. The asset add and the reconcile make two dependent chain hops (the head, then " +
    "parallel reads at it), inside chain-read. An override can come with a measurement.",
  source: by("packages/book/src/budgets.ts; P5 hop table"),
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
  source: BUILDER("books/target/shared/decisions.ts (vocabulary.declined-preview-cancelled); frozen activity.annotate (preview, #6)"),
  affects: [ops.operation_activity_annotate],
});

// ── ERPNext accounting's shape (aaron.books-first-principles) ───────────────────────────────

export const decision_books_frappe_shape = defineDecision({
  id: "books.frappe-shape",
  title: "Each books table is one ERPNext doctype, with Frappe's field names",
  question:
    "The books are redesigned in the shape of ERPNext's accounting, complete without a head and synced with one. How " +
    "literally do Capxul's tables take Frappe's shapes?",
  options: [
    {
      label: "doctype-per-table",
      text:
        "One table per doctype the books need, with Frappe's field names wherever the content is the same: " +
        "book-companies (Company's accounting fields), book-accounts (Account), book-cost-centers (Cost Center), the " +
        "money vouchers (Journal Entry, Payment Entry) and their GL Entry lines derived from book-facts and " +
        "book-annotations, and book-document-vouchers (the GL Entries of a head's own vouchers and of a payroll run's " +
        "accrual). Capxul keeps its own durable ids, which a head holds in the Custom Field `capxul_id` (component " +
        "frappe-app), and its own spellings only where the frozen surface uses them (code, type).",
    },
    {
      label: "own-shape-and-mapper",
      text: "Keep Capxul's own tables and translate them into Frappe's documents only when a head connects.",
    },
    {
      label: "erpnext-schema",
      text: "Store ERPNext's tables verbatim, every field of every doctype, as if Capxul were a Frappe site.",
    },
  ],
  chosen: "doctype-per-table",
  why:
    "The ruling is that an Organization's data lives in Frappe's shapes from the start, head or no head, and that its " +
    "books sync with a head (books-first-principles). A mapper written at connection time is a second model that " +
    "drifts and is first tested when a customer connects; ERPNext's whole schema would bring in stock, tax, " +
    "subscriptions and the bank-statement machinery that Capxul's exact, on-chain bank makes needless. So the books take " +
    "the doctypes they need, field for field, and leave out on purpose: Bank Transaction, Bank Clearance and the Bank " +
    "Reconciliation Tool (a Capxul voucher is cleared when posted: there is no statement to match), Payment Ledger Entry " +
    "(ERPNext derives it from the GL), Fiscal Year documents (derived from the Company's start, books.company-settings), " +
    "Accounting Period and Budget (budgets is Capxul's own concept, on chain). Field names are Frappe's (`account_name`, " +
    "`root_type`, `is_group`, `cost_center_name`, `posting_date`, `debit_in_account_currency`), so the sync is a copy, " +
    "not a translation.",
  source: byFrappe(`${ERP}/account, cost_center, journal_entry, journal_entry_account, payment_entry, gl_entry (DocType JSON); erpnext/setup/doctype/company/company.json`),
  affects: [
    concept_books,
    table_book_companies,
    table_book_accounts,
    table_book_annotations,
    table_book_facts,
  ],
});

export const decision_books_chart_tree = defineDecision({
  id: "books.chart-tree",
  title: "The chart is ERPNext's Account tree; only ledger accounts take postings",
  question:
    "Capxul's chart had six types by a code's first digit and sub-accounts that could hold their own money. ERPNext's " +
    "chart is a tree of five root types in which only a ledger account takes GL Entries and an account with entries " +
    "cannot become a group. How does Capxul's chart sit in that tree without losing a frozen behaviour?",
  options: [
    {
      label: "tree-with-type-groups",
      text:
        "Five roots (Assets, Liabilities, Equity, Income, Expenses) and two groups under Expenses (Cost of services, " +
        "Operating expenses) are Capxul's six types; they have no number and are not listed. A top-level account sits " +
        "directly under its type's group; a sub-account under a parent that becomes a group, which needs the parent to " +
        "hold no postings (else WRONG_STATE `parent_has_postings`) and to have no role and no Frappe account type (else " +
        "WRONG_STATE `parent_protected`). Codes keep Capxul's rule (first digit by type, unique " +
        "among active accounts, next in the parent's ten, next free hundred). Protected accounts fill the Company's " +
        "defaults by role, and each template account carries its Frappe account type.",
    },
    {
      label: "parents-hold-money",
      text:
        "Keep parents that hold money and translate at sync, giving each such parent a hidden ledger child in the head.",
    },
    { label: "erpnext-standard", text: "Adopt ERPNext's Standard chart with numbers (1000 assets … 5000 expenses), renumbering us-services." },
  ],
  chosen: "tree-with-type-groups",
  why:
    "Frappe refuses a GL Entry on a group and refuses to turn an account with entries into a group " +
    "(`validate_group_or_ledger`), so a parent that holds money has no honest Frappe shape: hidden children would be " +
    "accounts nobody made, with codes the unique number would have to invent. Renumbering to ERPNext's chart would " +
    "rewrite every claim that names 1010, 4999, 6999, 3990 or 6100. With type groups every frozen claim keeps its words: " +
    "add's 'a sub-account takes the next code under its parent and the parent's type' and 'a top-level account takes " +
    "the next free hundred in its range', the P&L's 'a sub-account's balance rolls into its parent's total, counted " +
    "once' (a group's total is its children's). One behaviour narrows that no claim covers: a sub-account can no longer " +
    "be added under an account that already holds money, or under one ERPNext will not make a group: an account with a " +
    "Frappe account type ('Cannot convert to Group because Account Type is selected') or one that fills a Company " +
    "default, which every role account does. Capxul refuses those itself, so the head never receives a tree it would " +
    "refuse and its sync never stalls on one. The remedy is a sibling, then a reclassify. An archived account frees its " +
    "code in Capxul; in a head, where numbers are unique among all accounts, its copy is disabled and loses its number. " +
    "Account types are set only where ERPNext needs one: 1000 and the Safe accounts Bank, 1200 Receivable, 2000 and " +
    "2200 Payable, 1500 Fixed Asset, 1510 Accumulated Depreciation, 6500 Chargeable; every other account has none, so " +
    "it can still take sub-accounts (Equity's type would only have stopped 3000 and 3900 from doing so). Payroll " +
    "Payable fills the Company's `default_payroll_payable_account`, the field Frappe HR adds to Company.",
  source: byFrappe(`${ERP}/account/account.py:264, :320 (group or ledger, account type), :334 (Company default), :401; hrms setup.py:171; ${B}/README.md:73`),
  affects: [
    table_book_accounts,
    machine_book_account,
    rpc_books_annotations_save,
  ],
});

export const decision_books_feed = defineDecision({
  id: "books.feed",
  title: "Facts are numbered without a gap per Organization, under its books' row lock",
  question:
    "Vision check C5: a ledger following Capxul's facts by when money happened can skip a fact recorded late, and facts " +
    "come from several writers in their own transactions (payments' settlements, banking's deposits, books' own scan " +
    "and rpcs). How does a ledger follow every fact exactly once?",
  options: [
    {
      label: "seq-under-lock",
      text:
        "Every fact takes its Organization's next number (`seq`) from its book-companies row, which the writer locks in " +
        "its own transaction, so numbers commit in order and a rollback leaves no hole. `books.sync.feed` reads after a " +
        "number; the reader keeps its own place.",
    },
    { label: "recorded-at", text: "Index `recorded_at` and let a reader page by it, with a replay window." },
    {
      label: "activity-log",
      text: "Extend activity's gap-free change log to every fact kind, triggered by books' transitions.",
    },
  ],
  chosen: "seq-under-lock",
  why:
    "A time column cannot promise exactly once: a transaction that stamps time T can commit after a reader has passed T, " +
    "which is why activity gave its feed a `seq` (activity.change-log); books needs the same thing for its own facts. " +
    "Activity's log cannot carry them: facts have no machine and so no event (books.machines), and activity sits above " +
    "books. The lock serializes one Organization's fact writes only, which are few a minute; payments and banking already " +
    "write the fact inside their settlement's transaction (K10), so the number commits with the money. The facts list " +
    "keeps its order by when money happened (its line 2); the feed is the order of recording. Invariant " +
    "books.feed-gap-free is its property test.",
  source: byFrappe("vision check C5 in docs/vision/erp.md; books/target/activity/decisions.ts (activity.change-log); K10 in docs/as-is/payments.md"),
  affects: [
    table_book_companies,
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
    "Vision check C6: a fact's read had its block time and transaction but not its Safe, its log index or a counterparty " +
    "pinned to the directory. What must a fact carry so a ledger can post it without asking anything else?",
  options: [
    {
      label: "full-proof",
      text:
        "The fact stores and shows the Safe it moved in or out of, the chain, block, transaction and log index, the " +
        "counterparty's directory `party_id` beside the chain's own name for it, the fee a rail kept, its feed number, " +
        "its posting date when moved by a closing, and the voucher it posts. Payments and banking pass the Safe, the log " +
        "index, the Party and the fee when they record it.",
    },
    { label: "join-later", text: "Keep the fact lean; a ledger reads the Payment, the Movement and the directory beside it." },
  ],
  chosen: "full-proof",
  why:
    "A ledger must post from the feed alone (the head sync pushes the same documents), and books cannot read payments or banking to fill the gaps " +
    "later (dependencies.books-below-money). A Party id makes the voucher's party resolvable in any head (a Customer, " +
    "Supplier or Employee carries `capxul_party`), while the chain's name stays as evidence in `counterparty`; this " +
    "answers the CRM lane's check C6 (a fact's counterparty pinned to a Party id). The log index makes two transfers " +
    "in one transaction distinct proofs. These are columns the invoker already knows when it records.",
  source: byFrappe("vision check C6 in docs/vision/erp.md; books/target/payments/processes.ts (settle, record); books/target/banking/processes.ts"),
  affects: [table_book_facts, procedure_books_record_money_fact, rpc_books_facts_list, ops.operation_org_books_facts_list],
});

export const decision_books_vouchers = defineDecision({
  id: "books.vouchers",
  title: "Each standing priced money fact posts one Journal or Payment Entry",
  question:
    "Money proven on chain must post ERPNext's entries. Which voucher does each kind of money fact make, with which " +
    "lines, is the voucher stored or derived, and how does a head follow a voucher that changes?",
  options: [
    {
      label: "derived-frappe-v1",
      text:
        "Derived when read by the versioned rules `frappe-v1`; its id is the fact's. The Safe line credits (out) or " +
        "debits (in) the Safe account in the token's currency at the block's rate; the other side is the annotation. A " +
        "receivable or payable account with a party makes a Payment Entry (Pay or Receive) allocated to the documents " +
        "named, as ERPNext lets each party type reference them (Customer: Sales Order, Sales Invoice, Journal Entry; " +
        "Supplier: Purchase Order, Purchase Invoice, Journal Entry; Employee, with Frappe HR: Expense Claim, Employee " +
        "Advance, Journal Entry); a Payroll Entry, which no Payment Entry may reference, takes a Journal Entry line; any " +
        "other account makes a Journal Entry `Bank Entry`, cheque number the transaction. A rail's fee is a line, or a " +
        "positive deduction, on bank charges (6500). A `reversed` fact cancels the voucher on the day it was seen; the " +
        "next generation's voucher is `amended_from` it. An unpriced fact (an added token, its opening included) posts " +
        "nothing. A head follows a new version by cancelling and amending, never by editing a submitted document.",
    },
    { label: "stored-gl", text: "Write the vouchers and GL Entry rows with each fact, and repost them on every annotation change." },
    { label: "journal-only", text: "Every money fact a Journal Entry, never a Payment Entry." },
  ],
  chosen: "derived-frappe-v1",
  why:
    "Derived vouchers keep one source of truth (the fact and the annotation) and keep the procedures that run inside a " +
    "settlement small; a recategorization is a new version of the same voucher. Journal-only would hide party payments " +
    "from ERPNext's Payment Reconciliation and aging. Allocations are in the Company's currency (Payment Entry " +
    "Reference's `allocated_amount`) and total at most the row's value; when the Company's currency is the token's peg " +
    "(USD for USDC, EUR for EURC) they may total the token amount at par, the difference from the block's value posting " +
    "to exchange gain or loss (6510) as a deduction, so 1,000 USDC pays a 1,000 USD invoice in full instead of leaving " +
    "cents outstanding on every bill. Rates are the block's (C19), and token units keep the asset's decimals, so every " +
    "voucher balances exactly (books.postings-balance). In a head, a submitted entry's account, party and reference " +
    "cannot change, and Repost Accounting Ledger under the immutable ledger reverses the rebuilt lines dated today, not " +
    "the old ones; so the app cancels the live document with its reversal dated on the voucher's posting date (the date " +
    "the immutable ledger reads from the request) and submits the amendment on that date with the same `capxul_id`, or " +
    "a new document when the type changes. Each day's GL in the head then nets to Capxul's in-place voucher.",
  source: byFrappe(`payment_entry.py:869, gl_composer.py:284, journal_entry.py:764, journal_entry_account.json, general_ledger.py:760 (erpnext/accounts); hrms employee_payment_entry.py:22, payroll_entry.py:1093`),
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
  title: "Books' own process syncs a head, both ways, one author per voucher",
  question:
    "When an ERPNext head is connected, how do the books and the head stay one ledger in both directions, with no " +
    "voucher posted twice, no second source of truth for money, and the system's one head pattern?",
  options: [
    {
      label: "head-sync-process",
      text:
        "Books' own process per connection (`books.head.sync`), as every app concept syncs (organizations.head-connection): " +
        "it pushes the feed's documents by `capxul_id` through the `frappe-head` integration once the books are charted, " +
        "and pulls the head's changes when the head rings. Money vouchers and payroll accruals are Capxul's, read-only on " +
        "the head and overwritten if they drift; the chart and the meaning of money are shared, a head user's change " +
        "applied through books' own checks with that member's rights; the head's own vouchers are its, kept as GL. A head " +
        "line on a Safe account is refused on both sides.",
    },
    {
      label: "head-follows-with-key",
      text:
        "The head's Capxul app follows `books.sync.feed` and posts its vouchers back through a books rpc, as the " +
        "Organization's agent on a Seat wearing the Books hat.",
    },
    {
      label: "head-is-ledger",
      text: "Once connected, the head is the ledger: Capxul only pushes its facts, and its own reports read the head.",
    },
  ],
  chosen: "head-sync-process",
  why:
    "This record first chose the head-follows-with-key reading. It contradicted the head connection every other app " +
    "uses: `frappe-head` says Capxul always calls and the head only rings, the Capxul app 'holds no Capxul key', and " +
    "projects and contacts sync through their own processes (organizations.head-doorbell, projects.head-sync). Two sync " +
    "designs would leave the build to choose, and a head holding an agent's key with the Books hat could rewrite the chart " +
    "and the meaning of every payment from a compromised site; it would also spend one of ten Seats (aaron.seats). Under " +
    "the one pattern, Capxul stays the system of record for money and identity (aaron.frappe-head): every movement of " +
    "money has one voucher, keyed by its fact (books.one-author-per-voucher), and a head can neither post nor edit one. " +
    "The head's users still give money its meaning and change the chart, through the app's own action, applied as " +
    "Capxul's commands would be. Head-is-ledger makes Capxul incomplete when the head is down, against 'complete without " +
    "a head'. The feed stays an rpc, for any other ledger that follows the books.",
  source: byFrappe("shared external.ts (frappe-head) and foundation.ts (frappe-app); organizations.head-connection, head-ownership, head-doorbell; projects.head-sync"),
  affects: [
    rpc_books_annotations_save,
  ],
});

export const decision_books_closed_periods = defineDecision({
  id: "books.closed-periods",
  title: "A head's closing freezes the past: late money posts on the first open day",
  question:
    "ERPNext refuses entries and reposts on or before a Period Closing Voucher. Capxul's facts can arrive late (an " +
    "added token's scan, a deposit credited days after its block) and its rows can be recategorized at any time. What " +
    "happens to a closed period?",
  options: [
    {
      label: "freeze-and-refuse",
      text:
        "`closed_through` is the latest `period_end_date` of the head's submitted Period Closing Vouchers, as ERPNext's own " +
        "check reads it; cancelling the latest moves it back. A money fact whose block's day is on or before it posts on " +
        "the first open day (`posting_date`, its block time kept on the voucher). Recategorizing, accepting or " +
        "reclassifying a row posted on or before it is refused (WRONG_STATE `period_closed`; reclassify lists the row); the " +
        "correction is an adjusting entry the head posts in the open period. Only a closing closes: the Capxul app refuses " +
        "an Accounting Period that closes Journal or Payment Entries.",
    },
    { label: "adjusting-entry", text: "Capxul posts its own adjusting Journal Entry in the open period for a closed row's recategorization." },
    { label: "repost-anyway", text: "Repost in Capxul regardless; the head keeps its closed figures." },
  ],
  chosen: "freeze-and-refuse",
  why:
    "A closed period must read the same in Capxul and the head, and repost-anyway breaks that. Capxul has no operation " +
    "that makes a Journal Entry, and an adjusting entry is an accountant's judgment, which the head is for. ERPNext " +
    "refuses a posting on or before the latest submitted closing (`validate_against_pcv`), so Capxul's late vouchers " +
    "must move to the first open day or the head sync would stall on them; an Accounting Period closing Journal or " +
    "Payment Entries would stall it the same way, and Capxul does not mirror it, so the app forbids it. Without a head " +
    "nothing closes, so every frozen claim reads as before; the refusal is a new case under a code the operations " +
    "already produce (activity annotate and accept gain WRONG_STATE `period_closed` on the rpc), never a dropped one.",
  source: byFrappe("erpnext/accounts: services/gl_validator.py:137 (validate_against_pcv), general_ledger.py:53 (validate_accounting_period), repost_accounting_ledger.py:63"),
  affects: [
    table_book_companies,
    table_book_facts,
    procedure_books_record_money_fact,
    rpc_books_annotations_save,
  ],
});

export const decision_books_company_settings = defineDecision({
  id: "books.company-settings",
  title: "The Organization's currency, time zone and fiscal year, fixed at the chart",
  question:
    "Vision check C18: ERPNext posts by date in the site's time zone, closes by fiscal year and keeps a functional " +
    "currency, and Capxul's reports cut at 'the end of the day' without saying whose. The Organization now carries the " +
    "Company's currency, time zone and fiscal year start (organizations.company-shape). How do the books use them, and " +
    "what if one changes under existing books?",
  options: [
    {
      label: "copy-at-import",
      text:
        "The import copies the Organization's `default_currency`, `time_zone` and `fiscal_year_start` into book-companies " +
        "and the books keep that copy for good. Every posting date and report day is in that time zone; a fiscal year is " +
        "derived from the start (named as ERPNext names it); vouchers are in that currency, converted from each fact's " +
        "USD value by the currency's USD rate at the block (EUR/USD), from book-prices' kept history. A currency with no " +
        "price pair refuses the import (INVALID_INPUT `currency_not_priced`).",
    },
    { label: "read-live", text: "Read the Organization's values on every report and voucher." },
    { label: "usd-only", text: "Keep the books in USD whatever the Organization's currency; its head converts and revalues." },
  ],
  chosen: "copy-at-import",
  why:
    "No voucher exists before the chart, so taking the values at the import never moves a date anyone saw, and keeping " +
    "a copy means a later change on the Organization can never re-date, re-year or re-value a posted voucher, which " +
    "ERPNext forbids too (a Company's currency is fixed once it has entries). Reading live would let one edit move every " +
    "report. USD-only would leave a head whose Company is in EUR posting Capxul's vouchers in the wrong currency, and " +
    "European law keeps books in euros. Each fact still records its USD value once, as the frozen facts list shows; the " +
    "Company's amount is a pure function of it and a kept rate, so EURC in a euro Company is exact. Fiscal years as " +
    "rows would need a command no frozen operation has; the head's Fiscal Year documents are made to match the start.",
  source: byFrappe(`erpnext/setup/doctype/company/company.json (default_currency); ${ERP}/fiscal_year/fiscal_year.json; organizations.company-shape; checks C18, C19`),
  affects: [
    table_book_companies,
  ],
});

export const decision_books_cost_centers = defineDecision({
  id: "books.cost-centers",
  title: "Main from the import; every other cost centre is the head's",
  question:
    "ERPNext requires a cost centre on every profit-and-loss line. No frozen command makes one. Where do cost centres " +
    "come from?",
  options: [
    {
      label: "main-then-head",
      text:
        "The import makes the root (the Organization) and Main, the Company's default, and every Capxul voucher's " +
        "profit-and-loss line posts to Main unless its annotation names another; a head makes the rest and the head " +
        "sync pulls them. A cost centre has no machine and Capxul never edits a head's.",
    },
    { label: "capxul-commands", text: "Add commands to make, rename and disable cost centres in Capxul." },
  ],
  chosen: "main-then-head",
  why:
    "A new command would be a capability outside the 215, which needs its own decision pack; Main is all an " +
    "Organization without a head needs. A head is where a business divides its costs, so its cost centres are its own, " +
    "and Capxul keeps them so that an annotation can name one and a head's voucher's lines resolve.",
  source: byFrappe(`${ERP}/cost_center/cost_center.json; ${ERP}/gl_entry/gl_entry.py:179 (cost centre required on P&L)`),
  affects: [rpc_books_annotations_save],
});

export const decision_books_payroll_accrual = defineDecision({
  id: "books.payroll-accrual",
  title: "A run Capxul computed accrues through a books door; a head's run is the head's",
  question:
    "Payroll keeps Frappe HR's runs and slips from the first day, head or no head, and asks books to post a run's accrual " +
    "(payroll.accrual), since a slip's net is paid by a Bank Entry on Payroll Payable. Books sits below payroll and cannot " +
    "read it. Who posts the accrual, and how does it reach the books?",
  options: [
    {
      label: "door-one-author",
      text:
        "A third procedure, `books.record-payroll-accrual`, which payroll's run submit and cancel invoke in their own " +
        "transaction: the accrual Journal Entry Frappe HR's `make_accrual_jv_entry` makes, as a `payroll` document voucher " +
        "with an `accrual_posted` or `accrual_cancelled` fact on the feed, so a head receives it like money. One author: " +
        "the side that computed the run. A run a head computed accrues in the head, and comes back as the head's voucher.",
    },
    { label: "head-only", text: "Leave every accrual to a head: without one, a run posts no expense until its slips are paid." },
    { label: "cash-basis", text: "No accrual: each slip's net posts straight to salary expense, and each deduction when it is remitted." },
  ],
  chosen: "door-one-author",
  why:
    "Head-only, this lane's first reading, leaves an Organization without a head with payroll that never reaches its " +
    "profit and loss: each net is paid against Payroll Payable that nothing credited, so 2200 runs a debit balance and " +
    "the books are not complete without a head (aaron.frappe-head). Cash basis would make payroll's Bank Entry on " +
    "Payroll Payable wrong and is not Frappe's shape (aaron.books-first-principles). The door passes P4's test " +
    "(rules.procedures): if the run and its accrual disagreed at a commit, money would leave the Safe against a " +
    "liability the books never recorded. Books cannot follow payroll's events, since payroll sits above payments " +
    "and payments above books, so a door is the only way down. The procedure never refuses: an unfit account falls " +
    "back to its role's, and without a chart the voucher waits, as money facts do. The books' basis reads `accrual` " +
    "once one exists. Payroll now depends on books and invokes the door from `runs.submit` and `runs.cancel`, only for " +
    "runs Capxul computed, and for a landed collection's paid slip (books.payroll-postings).",
  source: byFrappe("payroll.accrual (books/target/payroll/decisions.ts); hrms payroll_entry.py:619, :1093; rules.procedures"),
  affects: [
    table_book_facts,
  ],
});

// ── the assembly after the Frappe lanes (8 November 2026) ───────────────────────────────────

const ASSEMBLY = "Claude, assembly of the Frappe lanes (ledger: books and payroll), 8 November 2026";
const byAssembly = (evidence: string) => `${ASSEMBLY}; evidence: ${evidence}`;

export const decision_books_startup = defineDecision({
  id: "books.startup",
  title: "No books step at the setup's begin: the chart is the first sitting's import",
  question:
    "organizations.startup has each fundamental app start itself from the setup's `begin`. The projects lane asked books " +
    "for a start-up there: the account tree from a template, the first Fiscal Year and the main Cost Center, reading " +
    "`abbr`, `default_currency`, `time_zone` and `fiscal_year_start` from the Organization. What does books do at begin?",
  options: [
    {
      label: "import-in-first-sitting",
      text:
        "Nothing at begin. The books begin recording at the Organization's first fact, whose writer births the Company " +
        "row. The chart is `org books accounts import`, which the Organization's FDE or a Books-hat wearer runs in the " +
        "first sitting as the start-up's chart step: ERPNext's tree from the template, the root and Main cost centres, " +
        "and the Organization's currency, time zone and fiscal year start, read from it then and kept fixed " +
        "(books.company-settings). Fiscal years, the first included, are derived from the start. Account and cost centre " +
        "names stay Frappe's bare `account_name`; a head names each document with its Company's `abbr` suffix, as ERPNext " +
        "does, from organizations' value.",
    },
    {
      label: "chart-at-begin",
      text: "A books process triggered by `machine_org_setup.t.begin` makes the chart, the first Fiscal Year and Main for every new Organization.",
    },
    {
      label: "company-at-begin",
      text: "A books process triggered by `begin` births only the Company row (`recording`), so the feed's lock row exists before any money.",
    },
  ],
  chosen: "import-in-first-sitting",
  why:
    "The frozen books operations keep 'no chart until one is made': `org books accounts import` makes the chart, a " +
    "second import is WRONG_STATE, and the chart's reads refuse `no_chart` before it. A chart made at begin would make " +
    "every Organization's import a refusal and leave those claims no world to run in, so it is a behaviour change no " +
    "ruling asks for. organizations.startup already reads it this way: books makes nothing at begin and a Books-hat " +
    "wearer runs the import in the first sitting. The books are still complete before the chart, because facts are " +
    "kept from the first money and the import posts them at once (books.facts-without-chart). Birthing only the " +
    "Company row buys nothing: money can reach the company Safe's predicted address in the same second as the begin, " +
    "so every fact writer must birth the row if it is missing anyway. The Organization's values are read, not " +
    "duplicated, until the import; the copy the import takes is the Company's fixed accounting settings, which ERPNext " +
    "also fixes once there are entries. ERPNext adds the abbreviation to a document's name, never to `account_name`, " +
    "so Capxul keeps none.",
  source: byAssembly("organizations.startup; books/frozen (org.books.accounts.import, list, review); erpnext/accounts/doctype/account/account.py:107 (autoname)"),
  affects: [
    concept_books,
    table_book_companies,
    machine_book_company,
  ],
});

export const decision_books_payroll_defaults = defineDecision({
  id: "books.payroll-defaults",
  title: "Payroll's default accounts are books' role accounts: 2200, 5000 and each Safe",
  question:
    "Payroll stores books' account ids on its records (a component's expense and liability, a run's and an assignment's " +
    "Payroll Payable, a run's treasury account), and asks books for the defaults. Which accounts are they, and where " +
    "does a payroll line go when its account is missing or unfit?",
  options: [
    {
      label: "roles",
      text:
        "Books' role accounts, found by role, never by code: Payroll Payable is `payroll_payable` (2200, the Company's " +
        "`default_payroll_payable_account`); the treasury is the `safe` account of the company Safe and the run's token; " +
        "the salary expense is a new role, `salaries`, on the template's 5000 (US salaries and wages). Payroll fills a " +
        "run's and an assignment's payable and treasury from them when the books are charted, null before. In the " +
        "accrual door an earning or employer cost with no fit account posts to `salaries`, and a deduction's liability " +
        "or a net to Payroll Payable.",
    },
    { label: "review", text: "No salary default: an expense line with no account posts to 6999, the not-decided expense account." },
    { label: "by-code", text: "Payroll picks 5000 and 2200 by their codes." },
  ],
  chosen: "roles",
  why:
    "Frappe HR refuses to accrue a component with no account; Capxul's door never refuses (books.payroll-accrual), so " +
    "it needs a fallback. 6999 is the review queue of money rows, but an accrual line is not a row: no annotation, " +
    "accept or reclassify can move it, so salaries posted there would stay unclassified for good, and a component " +
    "made before the chart (its accounts null) would accrue there every run. A role is how books already finds every " +
    "account it posts to by itself (books.chart-tree), and codes can be renumbered. The role protects 5000 as roles do: " +
    "it cannot be archived or take sub-accounts, so a fallback is never a group; a business that wants its salaries " +
    "split adds siblings (the template already has 5100 and 5200). Payroll Payable is one account per Company, as " +
    "ERPNext's Payroll Entry defaults it, so a run's accrual and its slips' Bank Entries always meet on it.",
  source: byAssembly("docs/design/frappe/payroll.md (For other lanes: Books); hrms payroll_entry.py:408, :810 (accounts required); packages/protocol/src/books/model.ts:113 (5000)"),
  affects: [
    table_book_accounts,
  ],
});

export const decision_books_payroll_postings = defineDecision({
  id: "books.payroll-postings",
  title: "How payroll's money posts: a slip's Bank Entry, a collection's accrual",
  question:
    "Payroll asks for one Bank Entry per settled payroll Payment, a collection posted as expense with party Employee (a " +
    "Supplier Payment Entry for an Organization payee), and remittances on their liabilities. Accounting saw that a " +
    "collection reaches books unclassified, since payments does not know agreements. Books can read neither payroll " +
    "nor payments. How does each of payroll's money facts post?",
  options: [
    {
      label: "against-and-door",
      text:
        "A run slip's net: payroll gives each item of a run's command its `against` (party Employee and the Employee's " +
        "Party, a reference to the Payroll Entry, and Payroll Payable when the books are charted), which payments keeps " +
        "from birth and passes at settlement (payments.payroll-door). Its voucher is the Bank Entry Frappe HR's " +
        "`make_bank_entry` makes, one per slip: Dr Payroll Payable, party Employee, reference the Payroll Entry; Cr the " +
        "company Safe's account for the token; cheque number the transaction, dated at the block. The reference is " +
        "allocated the whole of what is left (null), so the Employee's payable closes at par. A Payroll Entry named " +
        "with no account (paid before the chart) posts on Payroll Payable too. A collection to a person: payroll's " +
        "agreement process, recording the paid slip, invokes `books.record-payroll-accrual` (action collection): Dr the " +
        "agreement component's expense, Cr Payroll Payable, party the Employee, naming the collection's Payment, whose " +
        "voucher is then a Payment Entry (Pay, party the Employee) on Payroll Payable allocated to that Journal Entry, " +
        "whichever commits first: when the Payment's fact came first, the accrual's fact carries its new version. A " +
        "Payment already posted in a closed period keeps its voucher, and the door records nothing. A collection to an " +
        "Organization payee waits in review, or a head's Purchase Invoice and classification make it a Supplier Payment " +
        "Entry. A remittance posts on the liability account its payer names. An annotation, when given, wins.",
    },
    {
      label: "pays-on-fact",
      text: "Payments passes the Payment's payroll `source` as a new field of the book fact, and books posts by it.",
    },
    { label: "review", text: "Every payroll Payment waits in review for a Books-hat wearer, as any unclassified money does." },
  ],
  chosen: "against-and-door",
  why:
    "The meaning of money reaches books in one of two ways the design already has: what the payer said when the money " +
    "was commanded (`against`, kept from birth), and a money fact's own door. A run's Payments are commanded by " +
    "payroll, so `against` carries them, and payments chose that rather than a second field (payments.payroll-door). " +
    "Run before the chart, payroll has no account id to give, so the Payroll Entry reference itself decides the " +
    "account: in ERPNext only Payroll Payable lines reference one. A collection is born from a chain fact, so nobody " +
    "commands it, and only payroll knows its Employee and its component's account; the door, already a money fact, " +
    "posts the slip's accrual and names the Payment, so the pay and its liability meet on Payroll Payable as a " +
    "Frappe slip's do. An Organization payee has no slip (payroll.collection-slips): its meaning is a Purchase " +
    "Invoice, which only a head makes. Review alone would leave every salary unclassified. Such a row is not waiting, " +
    "so review and reclassify read the accruals too.",
  source: byAssembly("docs/design/frappe/assembly-items.md (accounting, payroll); payments.payroll-door; hrms payroll_entry.py:1093, :1196"),
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
    "Both keep total assets right, since a refundable escrow is still the Organization's money; they differ only in " +
    "which asset account shows it. A clearing account needs money facts for the funding and the refund, which payments " +
    "sets aside on purpose because a Payment, not a Transfer, explains them (K17), and would add two vouchers to every " +
    "claim escrow, not only payroll's. The frozen reconcile claim already explains the difference with `held` while an " +
    "escrow is open. Both the payroll and the accounting designs (docs/design/frappe) read it this way; only the " +
    "assembly list asked for the account.",
  source: byAssembly("books.reconcile-held; org.books.reports.reconcile line 1; payments.movements.record (K17); docs/design/frappe/payroll.md"),
  affects: [procedure_books_record_money_fact, ],
});

export const decision_books_annotation_project = defineDecision({
  id: "books.annotation-project",
  title: "An annotation's project is one of the Organization's projects",
  question:
    "A voucher's other side carries a project, as a GL Entry does. It was opaque text while books could not read " +
    "projects; books now depends on projects (dependencies.of-books). What does books check?",
  options: [
    {
      label: "checked-id",
      text:
        "The project is a projects id of the same Organization: `activity annotate` and a head's classification refuse " +
        "another (INVALID_INPUT), a payer's `against` drops it and the row waits in review, and the push writes the " +
        "project's head name, as ERPNext links a Project by name.",
    },
    { label: "text", text: "Keep the project as free text, unchecked." },
  ],
  chosen: "checked-id",
  why:
    "ERPNext's GL Entry links a Project, and a head refuses a name it does not have, which would stall the sync; a " +
    "checked id also survives a rename. Projects sits below books, so the read makes no cycle. The refusal is a new " +
    "case under a code `activity annotate` already produces, never a dropped behaviour.",
  source: byAssembly("erpnext/accounts/doctype/gl_entry/gl_entry.json (project: Link to Project); projects.dependencies; dependencies.of-books"),
  affects: [rpc_books_annotations_save, procedure_books_record_money_fact, table_book_annotations],
});

export const decision_books_party_lines = defineDecision({
  id: "books.party-lines",
  title: "A voucher line names a party only on an account ERPNext lets carry one",
  question:
    "A bank payout's side carries a party (the contact's Party as Supplier) and no account, and a paid request's or a " +
    "payer's side may too. Until someone annotates the row it waits in 6999, and a payout to your own bank account (scope " +
    "self) carries no party. ERPNext refuses a party on an account whose type is not Receivable, Payable or Equity. What " +
    "does the voucher post for such a row?",
  options: [
    {
      label: "party-where-allowed",
      text:
        "The fact and the annotation keep the party as given, so the review shows it as the suggestion and the CRM's " +
        "link (`party_id`) holds. The voucher names it only on a line whose account ERPNext lets carry one: a " +
        "Receivable, Payable or Equity account, or one with no account type. On any other, 6999 waiting included, the " +
        "line names no party. When a reviewer moves the row to the payable account, its voucher becomes a Payment Entry " +
        "Pay to that Supplier, unallocated, as ERPNext records an advance (books.vouchers). A payout to the payer's own " +
        "bank account has no party: it waits in review, and the Books hat moves it to an asset account of the chart " +
        "(money between the company's own accounts, never an expense).",
    },
    { label: "advance", text: "Post every payout with a Supplier party as a Payment Entry Pay on Creditors at once, an advance until an invoice." },
    { label: "drop-party", text: "Drop the party from the fact whenever no account is given." },
  ],
  chosen: "party-where-allowed",
  why:
    "ERPNext's `validate_account_party_type` refuses a GL line with a party on an account typed other than Receivable, " +
    "Payable or Equity, and allows one with no type, so a voucher that kept the party on 6999 would be refused by the " +
    "head. Posting an advance at once would choose the bookkeeping for the Organization: a payout to a supplier can be " +
    "an expense paid on the spot, and an unallocated advance sits on Creditors until someone reconciles it. Dropping " +
    "the party from the fact would lose what the payer told Capxul and the counterparty's Party the CRM pins (C6). " +
    "Keeping it on the fact and the annotation and off the line costs nothing and posts what ERPNext accepts. A " +
    "transfer to one's own bank account is neither income nor expense, and books has no account for the off-chain " +
    "bank until the Books hat makes one, so it waits like any row nobody has classified.",
  source: byAssembly(`/tmp/erpnext/erpnext/accounts/party.py:939 (validate_account_party_type); ${ERP}/payment_entry/payment_entry.json (payment_type); banking.payout-books`),
  affects: [procedure_books_record_money_fact, table_book_annotations, rpc_books_annotations_save],
});

export const decision_books_head_setup = defineDecision({
  id: "books.head-setup",
  title: "Before the first push, the Capxul app sets a head's accounting to match",
  question:
    "A head's ERPNext Company already has a chart, a root cost centre and Main, default accounts and settings of its " +
    "own. What does a connected head's accounting look like before books pushes its first voucher, who sets it, and may a " +
    "head connect before the books are charted?",
  options: [
    {
      label: "app-setup-before-push",
      text:
        "A head connects at any time; books pushes nothing until the books are charted (books.sync). The first push " +
        "then writes the chart through `upsertDocs` in tree order, each Account with its `capxul_id`, and the Capxul " +
        "app adopts ERPNext's own root cost centre and Main (made with the Company) as Capxul's, by `capxul_id`, " +
        "instead of making a second Main. With them it sets the Company's defaults to the role accounts (receivable, " +
        "payable, Payroll Payable, round off and exchange gain or loss, Main as the default and round-off cost " +
        "centre), the Fiscal Years derived from the fiscal year start, a Currency per token, each Safe account " +
        "frozen with the app's own role as the Company's `role_allowed_for_frozen_entries`, and Accounts Settings " +
        "`enable_immutable_ledger` on. A head user cannot then post on a Safe account, and a repost never edits a " +
        "past day's GL.",
    },
    {
      label: "importer",
      text: "Replace the head's chart with ERPNext's Chart of Accounts Importer, which a Company with no transactions accepts.",
    },
    { label: "head-agent", text: "The head's own agent, on a Seat wearing the Books hat, sets the head up from the books' feed." },
  ],
  chosen: "app-setup-before-push",
  why:
    "The accounting lane asked for a head set up before any transaction. The importer works only on an empty Company, " +
    "and a head is often connected to a site already in use; writing the tree through the one seam, by `capxul_id`, " +
    "works on either, and keeps a head-born account Capxul's to number (books.head.sync). ERPNext makes its root " +
    "cost centre and Main with every Company (`create_default_cost_center`), so adopting them keeps one Main on both " +
    "sides. A head's agent on a Seat was rejected by books.sync: Capxul calls, the head only rings, and the app holds " +
    "no Capxul key. Freezing the Safe accounts and turning on the immutable ledger are what make 'money vouchers are " +
    "Capxul's alone' hold on the head itself, not only in Capxul's push-back. Refusing a connection before the chart " +
    "would hold back the CRM, projects and payroll, which sync from the first day.",
  source: byAssembly(`accounting.md (the head connection); erpnext/setup/doctype/company/company.py:927, company.json; ${ERP}/accounts_settings/accounts_settings.json; hrms/setup.py:171`),
  affects: [component_frappe_app, table_book_accounts, table_book_companies],
});

// ── the world pass's build (9 November 2026): payroll's HR money (payroll.hr-money) ─────────

