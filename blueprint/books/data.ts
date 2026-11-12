// Books' tables, the state machines that live on them, and each machine's one event (P7). ERPNext alone
// holds each Organization's chart of accounts, cost centres and accounting settings on its site
// (books.chart-owner, Aaron's answer of 12 November 2026): Capxul's service keeps only what it alone
// knows, the on-chain money facts, their annotations and the tokens it watches, and the Capxul app
// on the site turns each money fact into the ERPNext entry (plugs.repoint-money-fact). An
// annotation names the site's accounts by their names there; nothing here copies the chart. The
// old tables these replace are in each record's `was`.
//
// Five tables, all an Organization's except annotations (a person's or an Organization's):
// - book-feeds         the counter of each Organization's gap-free fact numbers (books.feed)
// - book-annotations   the other side of a money row's entry, as the site's chart names it: account,
//                      party, cost centre, project, the documents it pays, a memo
//                      (books.annotations-one-table)
// - book-facts         the append-only money facts, numbered without a gap per Organization
// - book-assets        the ERC-20s an Organization added, with the scan's next block
//
// Births are transitions with no source state (`from: []`), so a born row sends its machine's
// event like any other change (books.births-are-transitions). Facts have no machine: they never
// change (books.machines; invariant books.facts-append-only at the end of this file). The feed
// counter has none either: it only counts.

import { Schema } from "effect";
import { defineEvent, defineInvariant, defineMachine, defineTable } from "../../packages/blueprint-engine/src/index.ts";
import { concept_books } from "../shared/foundation.ts";

const OLD = "packages/backend/src";
const BK = `${OLD}/books`;
const T = `${BK}/tables.ts`;
const MODEL = "packages/protocol/src/books/model.ts";

const S = Schema.String;
const N = Schema.Number;
const Int = Schema.Int;
const NullOr = Schema.NullOr;

/** Frappe's Party Type: the role a Party of the directory plays on a receivable or payable line. */
export const PartyType = Schema.Literals(["Customer", "Supplier", "Employee", "Shareholder"]);
/** The documents a Capxul voucher may pay or be paid for: what Payment Entry Reference and Journal Entry Account allow. */
export const ReferenceDoctype = Schema.Literals([
  "Sales Invoice",
  "Purchase Invoice",
  "Journal Entry",
  "Expense Claim",
  "Employee Advance",
  "Payroll Entry",
  "Sales Order",
  "Purchase Order",
]);
/**
 * One allocation of a voucher to a document (Payment Entry Reference, or a Journal Entry Account's reference):
 * `allocated_amount` in the Company's currency, as Frappe's, or null for the whole of what is left (books.vouchers).
 */
export const DocumentRef = Schema.Struct({ reference_doctype: ReferenceDoctype, reference_name: S, allocated_amount: NullOr(S) });
/** One activity row: a Payment or a Movement (payments' ids, or a scanned Transfer's chain id). */
export const ReferenceKind = Schema.Literals(["payment", "movement"]);
export const Reference = Schema.Struct({ kind: ReferenceKind, id: S });
/**
 * Every fact kind: a row's account, a payroll run's accrual, and money (the last seven). The chart's own changes are
 * the site's: ERPNext keeps them on its Accounts (books.chart-owner).
 */
export const FactKind = Schema.Literals([
  "account_assigned",
  "recategorized",
  "rows_reclassified",
  "accrual_posted",
  "accrual_cancelled",
  "payment_settled",
  "payment_received",
  "deposit_received",
  "payment_sent_outside",
  "payout_returned",
  "opening_balance",
  "reversed",
]);
/** What a money fact came from: the record `--source` lists by. */
export const SourceKind = Schema.Literals(["payment", "deposit", "payout", "movement", "agreement", "asset", "payroll_run"]);

const KEPT = "Kept for the Organization's life: books keep their history.";

// ── book feeds ──────────────────────────────────────────────────────────────────────────────

export const table_book_feeds = defineTable({
  id: "book-feeds",
  title: "Book feeds: the counter of an Organization's fact numbers",
  about:
    "One row per Organization whose books have begun, born by its first fact (its first money or a token added). " +
    "`last_seq` is the number of its latest fact: every fact writer takes this row's lock and the next number inside " +
    "its own transaction, so facts commit in the order they are numbered and no number is skipped (books.feed). It " +
    "holds nothing of the Company's accounting: the chart, the cost centres, the currency, the time zone, the fiscal " +
    "year and the closed periods are ERPNext's, on the Organization's site (books.chart-owner). Replaces the old " +
    "book-companies table, of which only this counter remains.",
  was: [`${T}:20`, `${BK}/accounts/writes/chart.ts:32`, "docs/as-is/archive/books/data.ts"],
  concept: concept_books,
  tenancy: "organization",
  tenantField: "org_id",
  fields: Schema.Struct({
    org_id: S,
    last_seq: Int,
    created_at: N,
    updated_at: N,
  }),
  key: ["org_id"],
  indexes: [],
  retention: KEPT,
});

// ── book annotations ────────────────────────────────────────────────────────────────────────

export const table_book_annotations = defineTable({
  id: "book-annotations",
  title: "Book annotations: the other side of a money row's entry, in the site's names",
  about:
    "The one annotation an owner (a person, or an Organization) keeps on one Payment or Movement row. For an " +
    "Organization it is the meaning ERPNext gives a payment, in the site's own names: the `account` its entry posts " +
    "against (the name of a ledger Account of the Organization's Company on its site, like `6100 - Cleaning - NW`, with " +
    "its `account_number`; for a person `personal_<code>` from the fixed personal chart), the party (`party_type` and the " +
    "directory's `party_id`), the `cost_center` (a Cost Center's name on the site) and project of its profit-and-loss " +
    "line (`project`: a Project of the same Company on the site: books.annotation-project), and the documents it pays " +
    "(`references`: the site's invoice, expense claim or payroll entry, with the amount allocated), beside a suggested " +
    "account name and a memo. Capxul keeps no copy of the chart: the save checks the account against the site as the " +
    "person saving (books.annotate-site-chart), and the Capxul app on the site resolves these names again when it posts " +
    "the entry, leaving a line it cannot post unmatched and visible (books.party-lines). A save replaces it whole, last " +
    "write wins. `status` says whether the row waits in the review queue. A row nobody annotated has no row here. " +
    "Money never comes from here: the site's entry reads it (books.account-at-posting).",
  was: [`${OLD}/activity/tables.ts:8`, `${T}:56`, `${BK}/writes.ts:155`],
  concept: concept_books,
  tenancy: "owner",
  tenantField: "owner_kind",
  fields: Schema.Struct({
    owner_kind: Schema.Literals(["person", "organization"]),
    owner_id: S,
    reference_kind: ReferenceKind,
    reference_id: S,
    account: NullOr(S),
    account_number: NullOr(S),
    party_type: NullOr(PartyType),
    party_id: NullOr(S),
    cost_center: NullOr(S),
    project: NullOr(S),
    references: Schema.Array(DocumentRef),
    suggestion: NullOr(S),
    memo: NullOr(S),
    status: Schema.Literals(["waiting", "decided"]),
    last_editor_kind: Schema.Literals(["person", "agent", "system"]),
    last_editor_id: S,
    created_at: N,
    updated_at: N,
  }),
  key: ["owner_kind", "owner_id", "reference_kind", "reference_id"],
  indexes: [
    {
      name: "by_owner_status_account",
      fields: ["owner_kind", "owner_id", "status", "account", "updated_at"],
      for: "The rows waiting for an account, oldest first: the review queue and a reclassify's candidates.",
    },
  ],
  retention: KEPT,
});

export const event_book_annotation_transitioned = defineEvent({
  id: "book_annotation_transitioned",
  about:
    "A row's annotation was saved, accepted from the queue or reclassified, for a person or an Organization. Replaces " +
    "activity_annotation_saved and books_rows_reclassified (one event per row moved). It never carries a memo or a name.",
  props: Schema.Struct({
    from: NullOr(S),
    to: S,
    transition: S,
    owner_kind: S,
    owner_id: S,
    reference_kind: S,
    reference_id: S,
    account: NullOr(S),
  }),
  was: [`${OLD}/activity/annotations/events.ts:36`, `${BK}/accounts/operations/emit-rows-reclassified.ts:1`],
});

export const machine_book_annotation = defineMachine({
  id: "book-annotation",
  title: "Book annotation: waiting in review or decided",
  about:
    "Whether a row waits in the review queue (`waiting`: no account, or the site's not-decided account for its " +
    "direction, with or without a suggestion) or has an account of the site's chart someone decided. Every committed save is one transition, so it is reported once.",
  was: [`${BK}/writes.ts:223`, `${BK}/accounts/writes/review.ts:24`, `${BK}/accounts/writes/review.ts:98`],
  table: table_book_annotations,
  field: "status",
  initial: "waiting",
  states: [
    { id: "waiting", about: "The site posts it to its direction's not-decided account, or leaves it unmatched; listed by `org books accounts review`." },
    { id: "decided", about: "Posts against the account, party and documents it names." },
  ],
  transitions: {
    queue: {
      from: [],
      to: "waiting",
      about: "The first save leaves the row waiting: a memo alone, or 4999 or 6999 with or without a suggestion.",
      emits: [event_book_annotation_transitioned],
    },
    assign: {
      from: [],
      to: "decided",
      about: "The first account the row gets (an `account_assigned` fact), by a save, a payment's choice, an accept or a reclassify.",
      emits: [event_book_annotation_transitioned],
    },
    requeue: {
      from: ["waiting", "decided"],
      to: "waiting",
      about: "A later save that leaves or puts the row waiting; a change of account is a `recategorized` fact.",
      emits: [event_book_annotation_transitioned],
    },
    recategorize: {
      from: ["waiting", "decided"],
      to: "decided",
      about: "A later save that gives the row an account, party or documents; a change of any is a `recategorized` fact.",
      emits: [event_book_annotation_transitioned],
    },
    accept: {
      from: ["waiting"],
      to: "decided",
      about: "`review --accept`: the suggestion becomes a new Account on the site and the row moves to it (`recategorized`).",
      guard: "The caller wears the Books hat; the row waits for an account.",
      emits: [event_book_annotation_transitioned],
    },
    reclassify: {
      from: ["waiting"],
      to: "decided",
      about: "`accounts reclassify` moves the row with every other in one change, under one `rows_reclassified` fact.",
      guard: "The caller wears the Books hat; the row waits in the from-account and its money falls inside the period.",
      emits: [event_book_annotation_transitioned],
    },
  },
});

// ── book facts ──────────────────────────────────────────────────────────────────────────────

export const table_book_facts = defineTable({
  id: "book-facts",
  title: "Book facts: the append-only, gap-free history of an Organization's books",
  about:
    "Every fact the books keep (ADR-0042): a row's account, a payroll run's accrual posted or cancelled (`source` the " +
    "run: books.payroll-accrual), and money. Never edited or deleted: a wrong account is a `recategorized` fact, money " +
    "the chain took back a `reversed` fact naming the one it cancels. `seq` numbers an Organization's facts from 1 with " +
    "no gap, in the order they commit (books.feed), so a reader that follows the numbers reads every fact once. A money " +
    "fact is keyed by the chain occurrence that moved the money (`money_key`) and a generation (books.money-key). It " +
    "records amount, asset, direction, the Safe it moved in or out of, the counterparty (the chain's name for it, and " +
    "its directory `party_id` when known: the entry's party), the part a rail kept as a fee (`fee_raw`), source, chain, " +
    "block, transaction and log, and the USD value at the rate in force at its block, once, never revalued; it names no " +
    "account (books.account-at-posting). An account fact names the site's Accounts by their names there (`account`, " +
    "`from_account`). The entry a money fact becomes, its posting date and whether its day is closed are the site's: " +
    "the Capxul app posts it from the plugs' outbox (plugs.repoint-money-fact, books.closed-periods). The chart's own " +
    "changes are not facts here: ERPNext keeps them (books.chart-owner). Only Organizations keep facts; a person's rows " +
    "keep none.",
  was: [`${T}:72`, `${BK}/writes.ts:47`, `${BK}/facts/writes/money.ts:66`, `${BK}/facts/writes/standing.ts:13`, `${MODEL}:189`],
  concept: concept_books,
  tenancy: "organization",
  tenantField: "org_id",
  fields: Schema.Struct({
    org_id: S,
    fact_id: S,
    seq: Int,
    kind: FactKind,
    occurred_at: N,
    recorded_at: N,
    // a row's account, by the site's Account names
    account: NullOr(S),
    from_account: NullOr(S),
    reference_kind: NullOr(ReferenceKind),
    reference_id: NullOr(S),
    rows: Schema.Array(Reference),
    // money
    money_key: NullOr(S),
    generation: NullOr(N),
    direction: NullOr(Schema.Literals(["in", "out"])),
    asset_id: NullOr(S),
    symbol: NullOr(S),
    decimals: NullOr(N),
    amount_raw: NullOr(S),
    fee_raw: NullOr(S),
    usd_value: NullOr(S),
    usd_rate: NullOr(S),
    usd_source: NullOr(S),
    safe_address: NullOr(S),
    counterparty: NullOr(S),
    party_id: NullOr(S),
    source_kind: NullOr(SourceKind),
    source_id: NullOr(S),
    chain_id: NullOr(N),
    block_number: NullOr(N),
    tx_hash: NullOr(S),
    log_index: NullOr(N),
    reverses_fact_id: NullOr(S),
    // who caused it
    actor_kind: Schema.Literals(["person", "agent", "system"]),
    actor_id: NullOr(S),
  }),
  key: ["org_id", "fact_id"],
  indexes: [
    {
      name: "by_org_seq",
      fields: ["org_id", "seq"],
      unique: true,
      for: "The feed: an Organization's facts in the order they were recorded, read after a number with nothing skipped.",
    },
    {
      name: "by_org_occurred",
      fields: ["org_id", "occurred_at", "fact_id"],
      for: "Facts oldest first by when they happened: the facts list's pages and cursor, every report to its end, the export's window.",
    },
    {
      name: "by_org_kind_occurred",
      fields: ["org_id", "kind", "occurred_at", "fact_id"],
      for: "The facts list's `--kind`, from `--since`.",
    },
    {
      name: "by_org_source",
      fields: ["org_id", "source_kind", "source_id", "occurred_at"],
      for: "The facts list's `--source`: every fact one Payment, deposit, payout, agreement or Movement wrote.",
    },
    {
      name: "by_org_money_key",
      fields: ["org_id", "money_key", "generation", "kind"],
      unique: true,
      for: "The standing fact of one money occurrence: a replay is a no-op, a reversal finds what it cancels, a re-settle takes the next generation.",
    },
    {
      name: "by_org_reference",
      fields: ["org_id", "reference_kind", "reference_id"],
      for: "A row's facts: whether a row is the Organization's (annotate) and its direction (review, reclassify).",
    },
    {
      name: "by_org_asset",
      fields: ["org_id", "asset_id", "occurred_at"],
      for: "The assets an Organization's money moved and each asset's units for the reconcile.",
    },
  ],
  retention: "Append-only: never edited or deleted (ADR-0042).",
});

// ── book assets ─────────────────────────────────────────────────────────────────────────────

export const table_book_assets = defineTable({
  id: "book-assets",
  title: "Book assets: the ERC-20s an Organization added to its books",
  about:
    "A token an Organization added (`org books assets add`): held, scanned and booked, never paid in, never priced. " +
    "Capxul's own assets are the deployment's configuration, not rows (books.capxul-assets). The scan of added tokens reads " +
    "each `added` row's Transfers to and from `safe_address` from `next_block` and moves it forward (books.added-token-scan). " +
    "A removal keeps the row, so the money it booked still reads; adding it again re-arms the same row from the head.",
  was: [`${T}:149`, `${BK}/assets/writes.ts:31`, `${BK}/assets/writes.ts:64`, `${OLD}/indexing/movements/operations/scan-added.ts:32`],
  concept: concept_books,
  tenancy: "organization",
  tenantField: "org_id",
  fields: Schema.Struct({
    org_id: S,
    asset_id: S,
    chain_id: N,
    token_address: S,
    symbol: S,
    decimals: N,
    safe_address: S,
    start_block: N,
    next_block: N,
    status: Schema.Literals(["added", "removed"]),
    first_added_at: N,
    added_by: S,
    added_at: N,
    removed_at: NullOr(N),
  }),
  key: ["org_id", "chain_id", "token_address"],
  indexes: [
    {
      name: "by_org_status_added",
      fields: ["org_id", "status", "first_added_at"],
      for: "The tokens one Organization records, in the order first saved: the assets list and the reconcile's tokens.",
    },
    {
      name: "by_status_chain",
      fields: ["status", "chain_id", "token_address"],
      crossTenant: true,
      for: "Every added token of every Organization, for the scan's work list each minute.",
    },
  ],
  retention: "Kept for the Organization's life: removal sets `removed`, so the money the token booked still reads.",
});

export const event_book_asset_transitioned = defineEvent({
  id: "book_asset_transitioned",
  about: "A token was added to an Organization's books, added again after a removal, or removed. Replaces books_asset_added and books_asset_removed.",
  props: Schema.Struct({ from: NullOr(S), to: S, transition: S, org_id: S, asset_id: S, chain_id: N, token_address: S }),
  was: [`${BK}/assets/events.ts:1`],
});

export const machine_book_asset = defineMachine({
  id: "book-asset",
  title: "Added token: recorded or removed",
  about: "A token is born added, may be removed, and may be added again; the old `removedAt` stamp becomes a status.",
  was: [`${T}:160`, `${BK}/assets/reads.ts:65`, "docs/as-is/archive/books/data.ts"],
  table: table_book_assets,
  field: "status",
  initial: "added",
  states: [
    { id: "added", about: "Scanned from `next_block`; its Transfers become money facts under its symbol, with no USD." },
    { id: "removed", about: "No longer scanned; the facts it booked stay." },
  ],
  transitions: {
    add: {
      from: [],
      to: "added",
      about: "`org books assets add`: the token's decimals, symbol and balance read at the head, its opening recorded.",
      guard: "An ERC-20 that answers decimals and symbol; not one of Capxul's assets; not already recorded by this Organization.",
      emits: [event_book_asset_transitioned],
    },
    readd: {
      from: ["removed"],
      to: "added",
      about: "Adding a removed token again re-arms its row from the head, with a new opening for what the Safe holds then.",
      emits: [event_book_asset_transitioned],
    },
    remove: {
      from: ["added"],
      to: "removed",
      about: "`org books assets remove` stops the scan.",
      emits: [event_book_asset_transitioned],
    },
  },
});

// ── invariants over the books ───────────────────────────────────────────────────────────────

export const invariant_books_one_live_money_fact = defineInvariant({
  id: "books.one-live-money-fact",
  title: "One live money fact per Organization and money occurrence",
  about:
    "What `books.record-money-fact` and `books.reverse-money-fact` keep (K10, P4): however many writers reach the same " +
    "money, and however often, the books count it once, so the site posts it once. Checked by a property test over random " +
    "interleavings of settlements, replays, Movement attributions and reversals.",
  statement: "For each Organization and money key, at most one money fact stands that no `reversed` fact cancels.",
  over: [table_book_facts],
  check: "property",
});

export const invariant_books_feed_gap_free = defineInvariant({
  id: "books.feed-gap-free",
  title: "An Organization's facts are numbered 1, 2, 3 … in the order they commit",
  about:
    "What makes the feed followable (vision check C5): every fact writer takes the Organization's book-feeds row lock " +
    "and the next number inside its own transaction, so a later number never commits before an earlier one and a rolled " +
    "back transaction leaves no hole. Checked by a property test of concurrent writers from payments, banking and books.",
  statement: "For each Organization, the facts' seq values are exactly 1 … last_seq, and every reader that saw n saw 1 … n−1.",
  over: [table_book_facts, table_book_feeds],
  check: "property",
});

export const invariant_books_facts_append_only = defineInvariant({
  id: "books.facts-append-only",
  title: "Facts are never edited or deleted",
  about: "ADR-0042 decision 2: a wrong account is a new fact, money taken back a reversal. The generated access to book-facts has inserts only.",
  statement: "No statement updates or deletes a row of book-facts.",
  over: [table_book_facts],
  check: "static",
});
