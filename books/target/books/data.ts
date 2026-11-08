// Books' tables, the state machines that live on them, and each machine's one event (P7). The
// target design, not a copy of the old tables: docs/as-is/archive/books/data.ts and the old code
// (packages/backend/src/books/tables.ts, activity/tables.ts) are what each record replaces.
//
// Six tables, all an Organization's except annotations (a person's or an Organization's) and
// prices (the system's):
// - book-charts       one chart per Organization (template, basis)
// - book-accounts     the accounts of a chart, archived, never deleted
// - book-annotations  the account, suggestion and memo whoever you act as gives one row (old activity
//                     annotations and old bookAssignments, one table: books.annotations-one-table)
// - book-facts        the append-only facts: the chart's changes, a row's account, and money
// - book-assets       the ERC-20s an Organization added, with the scan's next block
// - book-prices       USD rates by pair, from the Chainlink sync
// The old bookCursors table goes with the old observer (books.one-observer).
//
// Births are transitions with no source state (`from: []`), so a born row sends its machine's
// event like any other change (books.births-are-transitions). Facts have no machine: they never
// change (books.machines; invariant books.facts-append-only at the end of this file).

import { Schema } from "effect";
import { defineEvent, defineInvariant, defineMachine, defineTable } from "../../../packages/book/src/index.ts";
import { concept_books } from "../shared/foundation.ts";

const OLD = "packages/backend/src";
const BK = `${OLD}/books`;
const T = `${BK}/tables.ts`;
const MODEL = "packages/protocol/src/books/model.ts";

const S = Schema.String;
const N = Schema.Number;
const NullOr = Schema.NullOr;

/** `BOOK_ACCOUNT_TYPES`: a code's first digit follows its type (1 asset … 6 expense). */
export const AccountType = Schema.Literals(["asset", "liability", "equity", "income", "cost_of_services", "expense"]);
/** Why Capxul protects an account: it cannot be archived. */
export const AccountRole = Schema.Literals([
  "safe",
  "uncategorized_income",
  "uncategorized_expense",
  "opening",
  "posting",
]);
/** One activity row: a Payment or a Movement (payments' ids, or a scanned Transfer's chain id). */
export const ReferenceKind = Schema.Literals(["payment", "movement"]);
export const Reference = Schema.Struct({ kind: ReferenceKind, id: S });
/** Every fact kind. Chart facts, a row's account, and money (the last seven). */
export const FactKind = Schema.Literals([
  "account_created",
  "account_renamed",
  "account_archived",
  "account_assigned",
  "recategorized",
  "rows_reclassified",
  "payment_settled",
  "payment_received",
  "deposit_received",
  "payment_sent_outside",
  "payout_returned",
  "opening_balance",
  "reversed",
]);
/** What a money fact came from: the record `--source` lists by. */
export const SourceKind = Schema.Literals(["payment", "deposit", "payout", "movement", "agreement", "asset"]);

const KEPT = "Kept for the Organization's life: books keep their history.";

// ── book charts ─────────────────────────────────────────────────────────────────────────────

export const table_book_charts = defineTable({
  id: "book-charts",
  title: "Book charts: one chart of accounts per Organization",
  about:
    "The Organization's chart, made once by `org books accounts import` from the only template, `us-services`, on the " +
    "only basis, `cash`. Its row is what every chart guard reads (`no_chart`, `already_set_up`). It carries no backfill or " +
    "opening stamps: money facts are kept from the Organization's first money whether or not a chart exists " +
    "(books.facts-without-chart), so making the chart only maps them to accounts.",
  was: [`${T}:20`, `${BK}/accounts/writes/chart.ts:32`, "docs/as-is/archive/books/data.ts"],
  concept: concept_books,
  tenancy: "organization",
  tenantField: "org_id",
  fields: Schema.Struct({
    org_id: S,
    template: Schema.Literal("us-services"),
    basis: Schema.Literal("cash"),
    status: Schema.Literal("active"),
    created_by: S,
    created_at: N,
  }),
  key: ["org_id"],
  indexes: [],
  retention: KEPT,
});

export const event_book_chart_transitioned = defineEvent({
  id: "book_chart_transitioned",
  about: "A chart changed: today only its birth by an import. Replaces books_chart_imported.",
  props: Schema.Struct({ from: NullOr(S), to: S, transition: S, org_id: S, template: S, accounts: N }),
  was: [`${BK}/accounts/operations/emit-chart-imported.ts:1`],
});

export const machine_book_chart = defineMachine({
  id: "book-chart",
  title: "Book chart",
  about:
    "A chart is born active and stays so. Later slices (the month-end lock, another basis) add states here; the old " +
    "imported, backfilled and opened stamps are gone with the backfill and the Safe opening (books.facts-without-chart).",
  was: [`${T}:27`, "docs/as-is/archive/books/data.ts"],
  table: table_book_charts,
  field: "status",
  initial: "active",
  states: [{ id: "active", about: "The chart exists: accounts can be added, rows given accounts and reports read." }],
  transitions: {
    import: {
      from: [],
      to: "active",
      about: "`org books accounts import` makes the chart with every template account and Capxul's own.",
      guard: "The Organization has no chart; the caller wears the Books hat.",
      emits: [event_book_chart_transitioned],
    },
  },
});

// ── book accounts ───────────────────────────────────────────────────────────────────────────

export const table_book_accounts = defineTable({
  id: "book-accounts",
  title: "Book accounts: the accounts of an Organization's chart",
  about:
    "One account of a chart, by a durable `acct_<ulid>` id every annotation and fact points to, so a rename or a new code " +
    "never changes history. A code is unique among the chart's active accounts and its first digit follows the type; a " +
    "sub-account takes its parent's type. `role` marks the accounts Capxul protects and finds by role, never by code: " +
    "`safe` (one per company Safe and asset, with `asset_id`), `uncategorized_income` (4999) and `uncategorized_expense` " +
    "(6999), which form the review queue, `opening` (3990) and `posting` (accounts the posting rules write to). An " +
    "archive keeps the row.",
  was: [`${T}:35`, `${BK}/writes.ts:91`, `${BK}/accounts/writes/chart.ts:99`, `${BK}/accounts/writes/chart.ts:163`, `${MODEL}:49`],
  concept: concept_books,
  tenancy: "organization",
  tenantField: "org_id",
  fields: Schema.Struct({
    org_id: S,
    account_id: S,
    code: S,
    name: S,
    type: AccountType,
    parent_account_id: NullOr(S),
    quickbooks_detail_type: S,
    status: Schema.Literals(["active", "archived"]),
    role: NullOr(AccountRole),
    safe_address: NullOr(S),
    asset_id: NullOr(S),
    created_at: N,
    updated_at: N,
  }),
  key: ["org_id", "account_id"],
  indexes: [
    {
      name: "by_org_code",
      fields: ["org_id", "code"],
      unique: true,
      for: "The chart in code order (list, reports, export, next free code) and an account by its code; partial on status = active, so an archived code is free again.",
    },
    {
      name: "by_org_role",
      fields: ["org_id", "role", "asset_id"],
      for: "A protected account by its role: the not-decided account of a direction, 3990, and the Safe account of an asset.",
    },
    {
      name: "by_org_parent",
      fields: ["org_id", "parent_account_id"],
      for: "A parent's sub-accounts: the next code in its ten, an archive refused while active sub-accounts remain.",
    },
  ],
  retention: "Kept for the Organization's life: an account is archived, never deleted.",
});

export const event_book_account_transitioned = defineEvent({
  id: "book_account_transitioned",
  about:
    "An account was added (by an add, an import, an inline account, an accepted suggestion or the first money of a new " +
    "asset), renamed or archived. Replaces books_account_added, books_account_renamed, books_account_archived and " +
    "books_suggestion_accepted. It never carries an account's name.",
  props: Schema.Struct({ from: NullOr(S), to: S, transition: S, org_id: S, account_id: S, code: S, type: S }),
  was: [`${BK}/accounts/events.ts:1`],
});

export const machine_book_account = defineMachine({
  id: "book-account",
  title: "Book account",
  about: "An account is born active, may be renamed while active, and is archived for good; nothing brings it back.",
  was: [`${T}:43`, `${BK}/accounts/writes/chart.ts:128`, "docs/as-is/archive/books/data.ts"],
  table: table_book_accounts,
  field: "status",
  initial: "active",
  states: [
    { id: "active", about: "Takes new rows; its code is held against the chart's other active accounts." },
    { id: "archived", about: "Takes no new rows; history, reports and exports keep it; its code is free again.", terminal: true },
  ],
  transitions: {
    add: {
      from: [],
      to: "active",
      about: "Born by an import, an add, an inline account, an accepted suggestion, or the first money of an asset with no Safe account.",
      guard: "A free code that fits the type; a sub-account's parent is active and gives its type.",
      emits: [event_book_account_transitioned],
    },
    rename: {
      from: ["active"],
      to: "active",
      about: "A new name, a new code, or both; a call that changes neither is not a transition.",
      guard: "A new code is free among active accounts and fits the type.",
      emits: [event_book_account_transitioned],
    },
    archive: {
      from: ["active"],
      to: "archived",
      guard: "The account has no role and no active sub-account.",
      emits: [event_book_account_transitioned],
    },
  },
});

// ── book annotations ────────────────────────────────────────────────────────────────────────

export const table_book_annotations = defineTable({
  id: "book-annotations",
  title: "Book annotations: the account and memo whoever you act as gives a row",
  about:
    "The one annotation an owner (a person, or an Organization) keeps on one Payment or Movement row: its account (an " +
    "Organization's `acct_` id, or `personal_<code>` from the fixed personal chart), the account name suggested beside a " +
    "not-decided account, and a memo. A save replaces it whole, last write wins. `status` says whether the row waits in " +
    "the review queue. A row nobody annotated has no row here and posts to its direction's not-decided account. Money " +
    "never comes from here: posting reads it (books.account-at-posting).",
  was: [`${OLD}/activity/tables.ts:8`, `${T}:56`, `${BK}/writes.ts:155`, `${OLD}/activity/annotations/writes.ts:24`],
  concept: concept_books,
  tenancy: "owner",
  tenantField: "owner_kind",
  fields: Schema.Struct({
    owner_kind: Schema.Literals(["person", "organization"]),
    owner_id: S,
    reference_kind: ReferenceKind,
    reference_id: S,
    account_id: NullOr(S),
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
      fields: ["owner_kind", "owner_id", "status", "account_id", "updated_at"],
      for: "The rows waiting in one not-decided account, oldest first: the review queue and a reclassify's candidates.",
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
    account_id: NullOr(S),
  }),
  was: [`${OLD}/activity/annotations/events.ts:36`, `${BK}/accounts/operations/emit-rows-reclassified.ts:1`],
});

export const machine_book_annotation = defineMachine({
  id: "book-annotation",
  title: "Book annotation: waiting in review or decided",
  about:
    "Whether a row waits in the review queue (`waiting`: no account, or a not-decided account, with or without a " +
    "suggestion) or has an account someone decided. Every committed save is one transition, so it is reported once.",
  was: [`${BK}/writes.ts:223`, `${BK}/accounts/writes/review.ts:24`, `${BK}/accounts/writes/review.ts:98`],
  table: table_book_annotations,
  field: "status",
  initial: "waiting",
  states: [
    { id: "waiting", about: "Posts to its direction's not-decided account; listed by `org books accounts review`." },
    { id: "decided", about: "Posts to the account it names." },
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
      about: "A later save that gives the row an account; a different account is a `recategorized` fact.",
      emits: [event_book_annotation_transitioned],
    },
    accept: {
      from: ["waiting"],
      to: "decided",
      about: "`review --accept`: the suggestion becomes a new account and the row moves to it (`recategorized`).",
      guard: "The caller wears the Books hat; the row waits in a not-decided account.",
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
  title: "Book facts: the append-only history of an Organization's books",
  about:
    "Every fact the books keep (ADR-0042): the chart's changes, a row's account, and money. Never edited or deleted: a " +
    "wrong account is a `recategorized` fact, money the chain took back a `reversed` fact naming the one it cancels. A " +
    "money fact is keyed by the chain occurrence that moved the money (`money_key`: the v4 payment id and side, or the " +
    "Transfer's chain, hash and log) and a generation, so a replay, a second writer or a re-settle reaches the same key " +
    "(books.money-key). It records amount, asset, direction, counterparty, source and the USD value at the rate in force " +
    "at its block, once, never revalued; it names no account (books.account-at-posting). Chart facts carry the code and " +
    "name they set. Only Organizations keep facts; a person's rows keep none.",
  was: [`${T}:72`, `${BK}/writes.ts:47`, `${BK}/facts/writes/money.ts:66`, `${BK}/facts/writes/standing.ts:13`, `${MODEL}:189`],
  concept: concept_books,
  tenancy: "organization",
  tenantField: "org_id",
  fields: Schema.Struct({
    org_id: S,
    fact_id: S,
    kind: FactKind,
    occurred_at: N,
    recorded_at: N,
    // a chart fact, or a row's account
    account_id: NullOr(S),
    from_account_id: NullOr(S),
    code: NullOr(S),
    name: NullOr(S),
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
    usd_value: NullOr(S),
    usd_rate: NullOr(S),
    usd_source: NullOr(S),
    counterparty: NullOr(S),
    source_kind: NullOr(SourceKind),
    source_id: NullOr(S),
    chain_id: NullOr(N),
    block_number: NullOr(N),
    tx_hash: NullOr(S),
    reverses_fact_id: NullOr(S),
    // who caused it
    actor_kind: Schema.Literals(["person", "agent", "system"]),
    actor_id: NullOr(S),
  }),
  key: ["org_id", "fact_id"],
  indexes: [
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
      for: "A row's money facts: whether a row is the Organization's (annotate), its direction (review, reclassify), its kind from its id.",
    },
    {
      name: "by_org_asset",
      fields: ["org_id", "asset_id", "occurred_at"],
      for: "The assets an Organization's money moved (the Safe accounts an import makes) and each asset's units for the reconcile.",
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

// ── book prices ─────────────────────────────────────────────────────────────────────────────

export const table_book_prices = defineTable({
  id: "book-prices",
  title: "Book prices: USD rates by pair, from a time on",
  about:
    "A USD rate per pair (`USDC/USD`, `EUR/USD`, `ETH/USD`, `BTC/USD`) from the time Chainlink last updated it, with its " +
    "source (`chainlink:<feed>`) and round. Written only by the price sync (books.prices-sync). A money fact of one of " +
    "Capxul's assets copies the latest rate at or before its block's time, once. On a devnet the Chainlink fake answers " +
    "the devnet's scripted rates, so the same writer stores them; the old stand-in series and the devnet set-price row go.",
  was: [`${T}:140`, `${BK}/facts/operations/prices.ts:35`, `${BK}/facts/reads/facts.ts:14`, `${BK}/facts/rules.ts:108`],
  concept: concept_books,
  tenancy: "global",
  fields: Schema.Struct({ pair: S, from_at: N, rate: S, source: S, round_id: S }),
  key: ["pair", "from_at"],
  indexes: [],
  retention: "Kept: a fact's rate stays explainable from the history it was taken from.",
});

// ── invariants over the facts ───────────────────────────────────────────────────────────────

export const invariant_books_one_live_money_fact = defineInvariant({
  id: "books.one-live-money-fact",
  title: "One live money fact per Organization and money occurrence",
  about:
    "What `books.record-money-fact` and `books.reverse-money-fact` keep (K10, P4): however many writers reach the same " +
    "money, and however often, the books count it once. Checked by a property test over random interleavings of " +
    "settlements, replays, Movement attributions and reversals.",
  statement: "For each Organization and money key, at most one money fact stands that no `reversed` fact cancels.",
  over: [table_book_facts],
  check: "property",
});

export const invariant_books_postings_balance = defineInvariant({
  id: "books.postings-balance",
  title: "Every fact posts balanced lines",
  about: "The cash rules turn each money fact into lines whose debits equal their credits, so every trial balance balances at any time and in any window.",
  statement: "For every fact, the posting rules' debits equal their credits; a chart or row fact posts nothing.",
  over: [table_book_facts, table_book_annotations, table_book_accounts],
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
