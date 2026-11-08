// Books' own judgments, each a decision record linked to the records it shapes (CONVENTIONS rule
// 10). Made by Claude on 8 November 2026 under A1-A4 and P1-P10, with the old code
// (/home/user/factory, integration/factory), the as-is book (books/as-is/books/) and ADR-0042 as
// evidence. The architecture's own books decisions are in ../shared/decisions.ts
// (concepts.books, concepts.books-token-scan, dependencies.books-below-money,
// responsibilities.keepers).

import { defineDecision } from "../../../packages/book/src/index.ts";
import { concept_books } from "../shared/foundation.ts";
import {
  event_book_account_transitioned,
  event_book_annotation_transitioned,
  event_book_asset_transitioned,
  event_book_chart_transitioned,
  machine_book_account,
  machine_book_annotation,
  machine_book_asset,
  machine_book_chart,
  table_book_accounts,
  table_book_annotations,
  table_book_assets,
  table_book_charts,
  table_book_facts,
  table_book_prices,
  invariant_books_facts_append_only,
  invariant_books_one_live_money_fact,
  invariant_books_postings_balance,
} from "./data.ts";
import { procedure_books_record_money_fact, procedure_books_reverse_money_fact } from "./procedures.ts";
import {
  rpc_books_accounts_accept,
  rpc_books_accounts_add,
  rpc_books_accounts_archive,
  rpc_books_accounts_import,
  rpc_books_accounts_list,
  rpc_books_accounts_reclassify,
  rpc_books_accounts_rename,
  rpc_books_accounts_review,
} from "./accounts.ts";
import { rpc_books_annotations_save } from "./annotations.ts";
import { rpc_books_assets_add, rpc_books_assets_list, rpc_books_assets_remove } from "./assets.ts";
import { rpc_books_facts_list } from "./facts.ts";
import {
  rpc_books_reports_balance_sheet,
  rpc_books_reports_profit_and_loss,
  rpc_books_reports_reconcile,
  rpc_books_reports_trial_balance,
} from "./reports.ts";
import { rpc_books_exports_quickbooks } from "./exports.ts";
import { workflow_books_assets_scan_added, workflow_books_prices_sync } from "./processes.ts";
import { flow_client_org_books_accounts_review } from "./flows.ts";
import * as ops from "./operations.ts";

const CLAUDE = "Claude, books target design, 8 November 2026";
const by = (evidence: string) => `${CLAUDE}; evidence: ${evidence}`;
const B = "packages/backend/src/books";

// ── money facts ─────────────────────────────────────────────────────────────────────────────

export const decision_books_facts_without_chart = defineDecision({
  id: "books.facts-without-chart",
  title: "Money facts are kept from the first money, chart or not; no backfill",
  question:
    "The old books kept no money fact for an Organization without a chart, and the import scheduled a backfill that " +
    "re-read Payments, Deposits and Movements. Books now sits below payments and banking and cannot read them. How does " +
    "money from before the chart reach the books?",
  options: [
    {
      label: "always",
      text:
        "`books.record-money-fact` records every Organization side whether or not a chart exists; a money fact names no " +
        "account, so the chart only maps facts to accounts. The import makes a Safe account for each asset the facts " +
        "already moved. No backfill, no chart stamps.",
    },
    {
      label: "backfill-upstream",
      text:
        "Keep 'no chart, no facts'. Payments and banking each own a workflow triggered by `book_chart_transitioned` that " +
        "replays the Organization's settled history into `books.record-money-fact`.",
    },
    { label: "backfill-chain", text: "Keep 'no chart, no facts'; books replays the Safe's PaymentSent and Transfer views from indexing after the import." },
  ],
  chosen: "always",
  why:
    "Rung 3 of P10: K10 ('a settled Payment always has its book facts') becomes unconditional instead of exempting " +
    "Organizations without a chart, so the stricter version wins. Backfill-upstream adds two cross-concept workflows that " +
    "re-run money writes on a books transition, with ordering races against live settlements. Backfill-chain cannot " +
    "rebuild the row references, counterparties and account choices only payments knows, so its facts would not link to " +
    "annotations. With `always` the import is one transaction and balance-sheet line 2 ('Money recorded before the chart " +
    "gets a Safe account per asset when the chart is made') holds literally. Every acceptance line still holds. Two " +
    "frozen sentences describe the old mechanism and stay as frozen text: import's `changes` ('schedules a backfill') and " +
    "its note 'An Organization without a chart keeps no money facts'; on the target `facts list` shows money facts before " +
    "the import. This is a data-model change for Aaron's per-concept review (W1).",
  source: by(`${B}/facts/writes/backfill.ts:86; ${B}/facts/writes/money.ts:59; K10 in docs/as-is/payments.md; org.books.reports.balance-sheet acceptance 2`),
  affects: [
    table_book_facts,
    table_book_charts,
    machine_book_chart,
    procedure_books_record_money_fact,
    rpc_books_accounts_import,
    ops.operation_org_books_accounts_import,
    ops.operation_org_books_reports_balance_sheet,
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
  title: "A money fact names no account; posting reads the row's annotation",
  question: "Does a money fact store the account it books to, or is the account resolved when the books are read?",
  options: [
    { label: "at-posting", text: "The fact records the money; a row posts to its annotation's account now, else its direction's not-decided account by role." },
    { label: "on-the-fact", text: "Store the account on the fact at record time, as the old writer did, and override it from the assignment when reading." },
  ],
  chosen: "at-posting",
  why:
    "The old reports already posted 'to the account it has now, else the one its fact was booked with, else 4999 or " +
    "6999', so the stored account was only a fallback, and a stored account is a copy that disagrees after every " +
    "recategorization. With facts kept before a chart (books.facts-without-chart) there is no account to store yet. The " +
    "history of a row's accounts is its account_assigned, recategorized and rows_reclassified facts.",
  source: by(`${B}/README.md:312 (a row posts to the account it has now); ${B}/postings/rules.ts:96; ${B}/facts/writes/money.ts:66`),
  affects: [
    table_book_facts,
    table_book_annotations,
    procedure_books_record_money_fact,
    rpc_books_reports_trial_balance,
    rpc_books_reports_profit_and_loss,
    rpc_books_reports_balance_sheet,
    rpc_books_exports_quickbooks,
    rpc_books_facts_list,
    invariant_books_postings_balance,
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
  affects: [rpc_books_assets_add, table_book_facts, ops.operation_org_books_assets_add, ops.operation_org_books_reports_reconcile],
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

export const decision_books_rows_by_id = defineDecision({
  id: "books.rows-by-id",
  title: "Accept and reclassify take a row's id; books finds its kind",
  question: "The old CLI read the review queue to find each `--row` and `--accept` id's kind before calling. Who resolves it now?",
  options: [
    { label: "books", text: "The rpcs take ids only and find each row's kind from books' own facts and annotations." },
    { label: "client", text: "The SDK reads the queue first, then calls with kinds." },
  ],
  chosen: "books",
  why: "Books holds every row it can move, so resolving there removes a client round trip and keeps reclassify a single rpc behind its SDK method (A4).",
  source: by("apps/cli/src/commands/org/subcommands/books/subcommands/accounts/subcommands/reclassify/execute.ts:34; review/execute.ts:26"),
  affects: [rpc_books_accounts_reclassify, rpc_books_accounts_accept],
});

export const decision_books_review_flow = defineDecision({
  id: "books.review-flow",
  title: "`org books accounts review` is one SDK flow: the queue, then an accept",
  question: "The old command called `books.accounts.review`, and with `--accept` also `books.accounts.accept`. A4 allows the CLI one SDK method. Which?",
  options: [
    { label: "flow", text: "One flow: read the queue; with `accept`, accept a row only if the queue lists it, else return `notInQueue` for the CLI's CLI_USAGE." },
    { label: "rpc", text: "One rpc that reads or accepts depending on its input." },
  ],
  chosen: "flow",
  why:
    "An rpc is one kind (a query or a mutation); a read that sometimes writes would blur both. The frozen surface keeps " +
    "CLI_USAGE for an `--accept` id not in the queue (P10 rung 1), so the flow reads the queue first and the CLI, not the " +
    "SDK, turns `notInQueue` into its own code (the SDK never returns CLI codes). The frozen note naming two SDK methods " +
    "stays as frozen text.",
  source: by("apps/cli/src/commands/org/subcommands/books/subcommands/accounts/subcommands/review/execute.ts:21; A4; org.books.accounts.review.yaml notes"),
  affects: [flow_client_org_books_accounts_review, rpc_books_accounts_review, rpc_books_accounts_accept, ops.operation_org_books_accounts_review],
});

// ── state machines ──────────────────────────────────────────────────────────────────────────

export const decision_books_machines = defineDecision({
  id: "books.machines",
  title: "Four machines, one event each; facts have none",
  question: "Which stored states are machines, now that every product event comes from a transition (P7)?",
  options: [
    {
      label: "four",
      text:
        "book-chart (active), book-account (active, archived), book-annotation (waiting, decided) and book-asset (added, " +
        "removed), each with its `<machine>_transitioned`. Facts are append-only rows with no state.",
    },
    { label: "as-is", text: "The old three: account status, the chart's stamps, the asset's removedAt; annotations and reclassify keep their own events." },
  ],
  chosen: "four",
  why:
    "The frozen lines check that each committed add, rename, archive, import, save and reclassify is reported once; under " +
    "P7 only a transition reports. The old 8 books events (chart imported, account added, renamed, archived, suggestion " +
    "accepted, rows reclassified, asset added, removed) and activity's annotation event fold into these four. The chart's " +
    "backfilled and opened stamps go with the backfill. A reclassify reports each row it moves.",
  source: by(`${B}/accounts/events.ts:1; ${B}/assets/events.ts:1; packages/backend/src/activity/annotations/events.ts:36; P7`),
  affects: [
    machine_book_chart,
    machine_book_account,
    machine_book_annotation,
    machine_book_asset,
    event_book_chart_transitioned,
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
    { label: "from-empty", text: "The birth is a named transition with `from: []` (import, add, queue, assign), emitting like any other." },
    { label: "none-state", text: "Give every machine a `none` state the row never stores." },
  ],
  chosen: "from-empty",
  why: "The schema accepts an empty `from`, the build's state checks pass, and no phantom state is stored or listed. The event's `from` is null for a birth.",
  source: by("packages/book/src/records/data.ts (TransitionSpec.from); books/as-is/books/data.ts (births said only in prose)"),
  affects: [machine_book_chart, machine_book_account, machine_book_annotation, machine_book_asset],
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
        "while the `books` gate is off (access' feature-flags).",
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
    rpc_books_accounts_import,
    rpc_books_accounts_list,
    rpc_books_accounts_add,
    rpc_books_accounts_rename,
    rpc_books_accounts_archive,
    rpc_books_accounts_review,
    rpc_books_accounts_accept,
    rpc_books_accounts_reclassify,
    rpc_books_assets_list,
    rpc_books_assets_add,
    rpc_books_assets_remove,
    rpc_books_facts_list,
    rpc_books_reports_trial_balance,
    rpc_books_reports_profit_and_loss,
    rpc_books_reports_balance_sheet,
    rpc_books_reports_reconcile,
    rpc_books_exports_quickbooks,
    rpc_books_annotations_save,
  ],
});

export const decision_books_capxul_assets = defineDecision({
  id: "books.capxul-assets",
  title: "Capxul's own assets are configuration, not rows",
  question: "Where do Capxul's settlement and held assets (USDC, EURC, WBTC...) live for the books?",
  options: [
    { label: "config", text: "The deployment's admitted-asset list (with each asset's tier and Chainlink pair) is configuration every concept reads; only added tokens are rows." },
    { label: "rows", text: "Seed a books table with Capxul's assets per deployment." },
  ],
  chosen: "config",
  why: "As in the old code: they change only with a deployment, and payments needs the same list. Only they are priced, so an added token named USDC never takes USDC's price.",
  source: by(`${B}/assets/rules.ts:9; ${B}/README.md:73; packages/protocol/src/evm/test-assets.ts:21`),
  affects: [rpc_books_assets_list, rpc_books_assets_add, rpc_books_reports_reconcile, procedure_books_record_money_fact, table_book_assets],
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

export const decision_books_prices_sync = defineDecision({
  id: "books.prices-sync",
  title: "One price writer: the Chainlink sync; devnet prices come through its fake",
  question: "The old prices had two writers (the devnet-only set-price and the five-minute Chainlink sync) and a stand-in series. What stays?",
  options: [
    { label: "one-writer", text: "Only the five-minute sync writes `book-prices`; on a devnet the Chainlink fake answers the devnet's scripted rates." },
    { label: "as-is", text: "Keep a devnet set-price rpc in books and the stand-in series." },
  ],
  chosen: "one-writer",
  why:
    "Scripted prices are devnet's (concepts.devnet), read by the integration's fake, so books keeps no devnet rpc and one " +
    "code path writes rates everywhere. The stand-in series hid a missing price on a devnet that staging would show as " +
    "unpriced. P3 keeps this cron.",
  source: by(`${B}/facts/operations/price.ts:23; ${B}/facts/operations/prices.ts:35; ${B}/facts/rules.ts:108; P3`),
  affects: [workflow_books_prices_sync, table_book_prices],
});

export const decision_books_reconcile_held = defineDecision({
  id: "books.reconcile-held",
  title: "On v4, 'money in agreements' is money held outside the Safe: open escrows",
  question:
    "The reconcile shows 'what open agreements hold' and its line 1 says the chain's balance and the money in " +
    "agreements explain the books. On v4 an agreement reserves its money in Budgets, inside the Safe. What fills the column?",
  options: [
    {
      label: "escrows",
      text:
        "`held` is what the Organization's open escrows hold (money that left the Safe and is booked out only when the " +
        "escrow pays); agreements hold nothing outside the Safe. Line 1 stays word for word.",
    },
    { label: "reserved", text: "Show what Budgets reserves for open agreements, and subtract it." },
  ],
  chosen: "escrows",
  why:
    "Subtracting a reservation would count money twice: it is still in the Safe's balance and in the books. A claim " +
    "escrow is the v4 case the old column covered: money funded out of the Safe before its Payment settles. The frozen " +
    "claim still holds, since agreements now explain a zero difference. The balance is read live with chain-rpc for " +
    "every asset, added tokens included, which Ponder does not index.",
  source: by(`${B}/reports/operations/reconcile.ts:7; ${B}/README.md:330 (readAgreementHoldingsInTx); packages/contracts/v4/src/interfaces/IEscrow.sol:8`),
  affects: [rpc_books_reports_reconcile, ops.operation_org_books_reports_reconcile],
});

export const decision_books_export_files_by_cli = defineDecision({
  id: "books.export-files-by-cli",
  title: "The SDK returns the two export files; the CLI writes them",
  question: "Who writes `chart-of-accounts.csv` and `journal-entries.csv`, and so who refuses CLI_STORAGE?",
  options: [
    { label: "cli", text: "The SDK method returns both files' text and counts; the CLI writes them, never over a file, and removes the chart if the journal fails." },
    { label: "sdk", text: "An SDK flow with a local step writes the files (the shared landing note's reading)." },
  ],
  chosen: "cli",
  why:
    "The shared vocabulary says the SDK never returns the CLI's own codes, and the frozen refusal is CLI_STORAGE; MCP and " +
    "browser hosts want the text, not a file on the host. Writing output is the CLI's printing, not orchestration (A4). " +
    "The shared landing for books/exports says 'written by the SDK': this decision reads it as 'produced by the SDK'.",
  source: by("books/target/shared/vocabulary.ts (the CLI's own codes); books/target/shared/landings.ts (books/exports); quickbooks.yaml notes"),
  affects: [rpc_books_exports_quickbooks, ops.operation_org_books_export_quickbooks],
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
    "straddling row on v4 is any row with money facts on both sides of the period.",
  source: by("books/frozen/operations.ts (the 17 books operations' acceptance); P1; P7"),
  affects: [
    ops.operation_activity_annotate,
    ops.operation_org_books_accounts_import,
    ops.operation_org_books_accounts_add,
    ops.operation_org_books_accounts_rename,
    ops.operation_org_books_accounts_archive,
    ops.operation_org_books_accounts_reclassify,
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
    "Payment settled before the month's end and returned after it (books.straddling-row).",
  source: by("books/as-is/operations/books.ts (the as-is worlds after-s1 and ?); CONVENTIONS rule 9"),
  affects: [
    ops.operation_activity_annotate,
    ops.operation_org_books_accounts_import,
    ops.operation_org_books_accounts_list,
    ops.operation_org_books_accounts_add,
    ops.operation_org_books_accounts_rename,
    ops.operation_org_books_accounts_archive,
    ops.operation_org_books_accounts_review,
    ops.operation_org_books_accounts_reclassify,
    ops.operation_org_books_assets_list,
    ops.operation_org_books_assets_add,
    ops.operation_org_books_assets_remove,
    ops.operation_org_books_export_quickbooks,
    ops.operation_org_books_facts_list,
    ops.operation_org_books_reports_balance_sheet,
    ops.operation_org_books_reports_profit_and_loss,
    ops.operation_org_books_reports_reconcile,
    ops.operation_org_books_reports_trial_balance,
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
    "commitment had. For the world, org-with-chart gets a payout settled on the last day of a month and returned by " +
    "Bridge's fake after a `dev time warp` past it; banking must pass the payout's Payment as the return fact's reference.",
  source: by("org.books.accounts.reclassify.yaml #3; books/target/banking/processes.ts (payout_returned); dependencies.payments-payroll"),
  affects: [ops.operation_org_books_accounts_reclassify, rpc_books_accounts_reclassify, procedure_books_record_money_fact],
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
  source: by(`${B}/README.md:163 (the tree); ${B}/index.ts:1 (the door); books/as-is/books/procedures.ts`),
  affects: [concept_books, procedure_books_record_money_fact, procedure_books_reverse_money_fact, rpc_books_assets_add, workflow_books_assets_scan_added],
});

export const decision_books_budgets = defineDecision({
  id: "books.budgets",
  title: "Every books record takes its class default",
  question: "Does any books operation, rpc, flow or workflow need a budget other than its class default (P5)?",
  options: [
    { label: "defaults", text: "Reads `read`, changes `write`, the two chain reads `chain-read`, the review flow `write`, the two crons `background`." },
    { label: "override-reports", text: "Give the reports a slower read budget, since they post every fact to their end." },
  ],
  chosen: "defaults",
  why:
    "The reports post from the indexed facts in one query per report; an Organization's facts number in the thousands, " +
    "well inside a 100 ms server share. The asset add and the reconcile make two dependent chain hops (the head, then " +
    "parallel reads at it), inside chain-read. An override can come with a measurement.",
  source: by("packages/book/src/budgets.ts; P5 hop table"),
  affects: [rpc_books_reports_trial_balance, rpc_books_reports_balance_sheet, rpc_books_assets_add, rpc_books_reports_reconcile, flow_client_org_books_accounts_review],
});
