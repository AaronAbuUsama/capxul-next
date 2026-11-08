// The old books concept's tables and the state machines that live on them, as the old code has
// them (factory, branch integration/factory). Evidence, not the target design.
//
// Tables: packages/backend/src/books/tables.ts, spread into packages/backend/convex/schema.ts:87.
// The README's tree lists a `bookKeepers` table (books/README.md:205); tables.ts has none and no
// code reads or writes one: Manage books is a Seat permission Organizations keeps (`seatPermissions`).
// No table is booked for it.
//
// Machines: book-account is the one literal status column (bookAccounts.status). The other two
// lifecycles have no status column: a chart's state is which of its stamps `backfilledAt` and
// `openedAt` are set, and an added token's state is whether `removedAt` is set. Both are booked as
// machines because the old code branches on exactly those stamps (observe.ts:100, opening.ts:37,
// assets/reads.ts:65); each `about` says the field is a stamp, not a status. Transitions are named
// to_<state>; a birth (an insert) has no source state and is said in `about`.

import { Schema } from "effect";
import { defineMachine, defineTable } from "../../../packages/book/src/index.ts";
import { concept_books } from "../shared/foundation.ts";
import {
  event_books_account_archived,
  event_books_asset_added,
  event_books_asset_removed,
} from "../shared/vocabulary.ts";

const B = "packages/backend/src/books";
const T = `${B}/tables.ts`;
const PROTOCOL = "packages/protocol/src/books/model.ts";

const KEPT = "Kept indefinitely: no code in the old system deletes or expires these rows.";

const opt = Schema.optionalKey;
const S = Schema.String;
const N = Schema.Number;

const ReferenceKind = Schema.Literals(["payment", "movement"]);

/** `BOOK_ACCOUNT_TYPES` (packages/protocol/src/books/model.ts:7). */
const AccountType = Schema.Literals(["asset", "liability", "equity", "income", "cost_of_services", "expense"]);

// ── tables ──────────────────────────────────────────────────────────────────────────────────

export const table_book_charts = defineTable({
  id: "book-charts",
  title: "Book charts: one chart of accounts per Organization",
  about:
    "One row per Organization that imported a chart (`books.accounts.import`, makeChart), made once from the only template, " +
    "`us-services`, on the only basis, `cash`. Its two optional stamps carry the chart's lifecycle: `backfilledAt` when the " +
    "backfill wrote its last page (the money from before the chart), `openedAt` when the Safe's opening balances were read " +
    "and recorded (CAP-1047). An Organization with no chart keeps no money facts: every fact writer returns at `chartRow`. " +
    "The observer and the opening read every row of the table with no index (observe.ts:83).",
  was: [`${T}:20`, `${T}:27`, `${T}:30`, `${B}/reads.ts:16`, `${B}/accounts/writes/chart.ts:32`, `${B}/facts/operations/observe.ts:83`],
  concept: concept_books,
  tenancy: "organization",
  tenantField: "orgId",
  fields: Schema.Struct({
    orgId: S,
    template: Schema.Literal("us-services"),
    basis: Schema.Literal("cash"),
    createdBy: S,
    createdAt: N,
    openedAt: opt(N),
    backfilledAt: opt(N),
  }),
  key: ["orgId"],
  indexes: [
    {
      name: "by_org",
      fields: ["orgId"],
      for: "The Organization's chart (`chartRow`, .unique()): every guard, money fact, observed page, backfill mark and opening (reads.ts:16).",
    },
  ],
  retention: KEPT,
});

export const table_book_accounts = defineTable({
  id: "book-accounts",
  title: "Book accounts: the accounts of an Organization's chart",
  about:
    "One account of an Organization's chart, by a durable `acct_<ulid>` id that every assignment and fact points to, so a " +
    "rename or a new code never changes history. A code is meant to be unique among active accounts; only the writers check " +
    "it (createAccount, renameAccount), and the Safe-account writer counts archived codes as taken too (chart.ts:172). " +
    "`protection` marks the accounts that cannot be archived: `safe` (holds one Safe's one asset, with `safeAddress` and " +
    "`safeAsset`), `uncategorized` (4999 and 6999, the review queue), `posting` (accounts the posting rules name) and " +
    "`opening` (3990). Rows are inserted by the chart import, an add, an inline account of a classification or an " +
    "acceptance, and by the money-fact writers (`ensureSafeAccountInTx` the first time the Safe holds an asset, " +
    "`ensureOpeningAccountInTx` for a chart imported before 3990 existed). A rename and an archive replace the whole row.",
  was: [
    `${T}:35`,
    `${B}/writes.ts:91`,
    `${B}/accounts/writes/chart.ts:32`,
    `${B}/accounts/writes/chart.ts:99`,
    `${B}/accounts/writes/chart.ts:128`,
    `${B}/accounts/writes/chart.ts:163`,
    `${B}/accounts/writes/chart.ts:208`,
    `${PROTOCOL}:49`,
  ],
  concept: concept_books,
  tenancy: "organization",
  tenantField: "orgId",
  fields: Schema.Struct({
    orgId: S,
    accountId: S,
    code: S,
    name: S,
    type: AccountType,
    parentAccountId: opt(S),
    quickbooksDetailType: S,
    status: Schema.Literals(["active", "archived"]),
    protection: opt(Schema.Literals(["safe", "uncategorized", "posting", "opening"])),
    safeAddress: opt(S),
    safeAsset: opt(S),
    createdAt: N,
    updatedAt: N,
  }),
  key: ["accountId"],
  indexes: [
    {
      name: "by_account",
      fields: ["accountId"],
      for: "One account by id (`accountById`, .unique()): a key that is an acct_ id, a row's account, a parent, a fact page's names (reads.ts:61).",
    },
    {
      name: "by_org_code",
      fields: ["orgId", "code"],
      for: "The whole chart (`accountRows`, prefix orgId) for every list, report and writer, or the accounts with one code (`accountByKey`) (reads.ts:33, :72).",
    },
  ],
  retention: "Kept indefinitely: an account is archived, never deleted.",
});

export const table_book_assignments = defineTable({
  id: "book-assignments",
  title: "Book assignments: the account one actor gives one activity row",
  about:
    "The account one actor gives one Payment or Movement row: an Organization's `accountId`, or a person's `personalCode` " +
    "from the fixed personal chart (D7), with an optional `suggestion` beside a not-decided account. Last write wins: " +
    "`writeAssignment` replaces the row whole (writes.ts:176), so a write that names no suggestion drops the one there. " +
    "Rows belong to an Account or an Organization (`actorKind`). Only an Organization's change records a fact; a person's " +
    "books keep none.",
  was: [`${T}:56`, `${B}/writes.ts:155`, `${B}/reads.ts:88`, `${B}/accounts/reads.ts:40`, `${B}/reports/reads.ts:63`],
  concept: concept_books,
  tenancy: "owner",
  tenantField: "actorId",
  scope: "actorKind says whether actorId is a person's Account or an Organization.",
  fields: Schema.Struct({
    actorKind: Schema.Literals(["account", "organization"]),
    actorId: S,
    referenceKind: ReferenceKind,
    referenceId: S,
    accountId: opt(S),
    personalCode: opt(S),
    suggestion: opt(S),
    assignedBy: S,
    assignedAt: N,
  }),
  key: ["actorKind", "actorId", "referenceKind", "referenceId"],
  indexes: [
    {
      name: "by_actor_reference",
      fields: ["actorKind", "actorId", "referenceKind", "referenceId"],
      for: "The account one actor gave one row (`assignmentRow`, .unique()); with the actor prefix only, every row an Organization gave (review queue, reports) (reads.ts:88, accounts/reads.ts:40, reports/reads.ts:63).",
    },
    {
      name: "by_account",
      fields: ["accountId", "assignedAt"],
      for: "The rows assigned to each not-decided account, for the review queue (accounts/reads.ts:40). It names no actor.",
      crossTenant: true,
    },
  ],
  retention: KEPT,
});

export const table_book_facts = defineTable({
  id: "book-facts",
  title: "Book facts: the append-only history of the books",
  about:
    "Append-only facts (ADR-0042): the chart's changes (account_created, account_renamed, account_archived), a row's " +
    "account (account_assigned, recategorized, rows_reclassified) and money (payment_settled, payment_received, " +
    "deposit_received, payment_sent_outside, payout_returned, opening_balance, reversed). A chart fact's id is " +
    "`bkf_<ulid>`; a money fact's id comes from its source so a replay reaches it: `fct_<kind>_<paymentId>` (a claim adds " +
    "`_<logicalEventId>`, outside money uses the Movement or indexer row id), a settle after a reversal is the next " +
    "generation `<id>_g2`, a reversal is `<factId>_rev`, an opening is `fct_opening_balance_<orgId>_<asset>`. Nothing " +
    "enforces a unique factId; the writers read `standingOf` first. `actorIsAgent` is set when the causing Seat is an AI " +
    "(recordFact reads its Seat standing). The Safe-account and opening-account writers insert their `account_created` facts " +
    "directly with no actor (chart.ts:191, :234). A money fact copies its USD value, rate and source once and is never " +
    "revalued.",
  was: [
    `${T}:72`,
    `${B}/writes.ts:47`,
    `${B}/facts/writes/money.ts:66`,
    `${B}/facts/writes/standing.ts:13`,
    `${B}/facts/writes/standing.ts:58`,
    `${B}/facts/writes/outside.ts:71`,
    `${B}/facts/writes/opening.ts:72`,
    `${B}/facts/rules.ts:74`,
    `${PROTOCOL}:189`,
  ],
  concept: concept_books,
  tenancy: "organization",
  tenantField: "orgId",
  fields: Schema.Struct({
    orgId: S,
    factId: S,
    kind: Schema.Literals([
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
    ]),
    accountId: opt(S),
    fromAccountId: opt(S),
    referenceKind: opt(ReferenceKind),
    referenceId: opt(S),
    rows: opt(Schema.Array(Schema.Struct({ kind: ReferenceKind, id: S }))),
    code: opt(S),
    name: opt(S),
    occurredAt: opt(N),
    blockTime: opt(N),
    amountValue: opt(S),
    asset: opt(S),
    usdValue: opt(S),
    usdRate: opt(S),
    usdSource: opt(S),
    partyId: opt(S),
    sourceKind: opt(Schema.Literals(["payment", "deposit", "claim", "movement"])),
    sourceId: opt(S),
    txHash: opt(S),
    reversesFactId: opt(S),
    actorAuthUserId: opt(S),
    actorIsAgent: opt(Schema.Boolean),
    recordedAt: N,
  }),
  key: ["factId"],
  indexes: [
    {
      name: "by_org_recorded",
      fields: ["orgId", "recordedAt"],
      for: "Every asset an Organization's facts moved, for the Safe accounts a chart import makes (`factAssetsInTx`, reads.ts:24).",
    },
    {
      name: "by_org_occurred",
      fields: ["orgId", "occurredAt"],
      for: "An Organization's facts by when they happened: the review queue, the facts list, every report up to its end (accounts/reads.ts:40, facts/reads/pages.ts:27, reports/reads.ts:55).",
    },
    {
      name: "by_org_kind_occurred",
      fields: ["orgId", "kind", "occurredAt"],
      for: "The facts list filtered by kind, from `since` (facts/reads/pages.ts:27).",
    },
    {
      name: "by_org_source",
      fields: ["orgId", "sourceId"],
      for: "The facts list's `--source`: every fact one Payment, claim or Movement wrote, collected unpaged (facts/reads/pages.ts:27).",
    },
    {
      name: "by_fact",
      fields: ["factId"],
      for: "The generations and reversals under one money fact id, as a prefix range (`standingOf`, facts/writes/standing.ts:13).",
      crossTenant: true,
    },
  ],
  retention: "Append-only: never edited or deleted (ADR-0042).",
});

export const table_book_prices = defineTable({
  id: "book-prices",
  title: "Book prices: USD rates by pair, from a time on",
  about:
    "A USD rate per pair (`USDC/USD`) from an epoch ms on, with its source. Two writers: the devnet-only " +
    "`books.facts.set-price` (`devnet:<SYMBOL>/USD`, patching a row at the same pair and time) and the five-minute " +
    "Chainlink sync on staging and production (`chainlink:<feed>`, a round already kept is skipped). A money fact copies " +
    "the latest rate at or before its time once (`priceAt`); with no row, a local or unknown deployment uses the stand-in " +
    "series (USDC and USDT 1.00, EURC 1.08, WETH 3000, WBTC 60000) and staging or production record no USD.",
  was: [`${T}:140`, `${B}/facts/reads/facts.ts:14`, `${B}/facts/rules.ts:88`, `${B}/facts/rules.ts:108`, `${B}/facts/operations/price.ts:23`, `${B}/facts/operations/prices.ts:49`],
  concept: concept_books,
  tenancy: "global",
  fields: Schema.Struct({ pair: S, from: N, rate: S, source: S }),
  key: ["pair", "from"],
  indexes: [
    {
      name: "by_pair_from",
      fields: ["pair", "from"],
      for: "The latest rate of a pair at or before a time (`priceAt`, desc first), and the same-time row a price write replaces or skips (facts/reads/facts.ts:14, operations/price.ts:35, prices.ts:61).",
    },
  ],
  retention: KEPT,
});

export const table_book_assets = defineTable({
  id: "book-assets",
  title: "Book assets: tokens an Organization added to its books",
  about:
    "A token an Organization added (CAP-979): held, scanned from `startBlock` (the head when it was added) and booked, " +
    "never paid in, never priced. Capxul's own assets are configuration, not rows. Nothing enforces one row per " +
    "Organization and token: the writer reads by `by_chain_token` and takes the Organization's first row. A removal stamps " +
    "`removedAt`; adding it again replaces the same row with a new start block. `bookAssetInTx` and `bookAssetByIdInTx` " +
    "take the first row of any Organization, so a token two Organizations added reads with whichever row the index gives " +
    "first. The Movement scanner reads every row with no index (`addedTokensInTx`).",
  was: [`${T}:149`, `${B}/assets/writes.ts:31`, `${B}/assets/writes.ts:64`, `${B}/assets/reads.ts:33`, `${B}/assets/reads.ts:50`, `${B}/assets/reads.ts:80`, `${B}/assets/reads.ts:113`],
  concept: concept_books,
  tenancy: "organization",
  tenantField: "orgId",
  fields: Schema.Struct({
    orgId: S,
    chainId: N,
    tokenAddress: S,
    assetId: S,
    symbol: S,
    decimals: N,
    startBlock: N,
    addedBy: S,
    addedAt: N,
    removedAt: opt(N),
  }),
  key: ["orgId", "chainId", "tokenAddress"],
  indexes: [
    {
      name: "by_org",
      fields: ["orgId"],
      for: "The tokens one Organization records, removed ones filtered out in memory (`addedAssetRows`): the asset list and the reconcile's tokens (assets/reads.ts:71).",
    },
    {
      name: "by_chain_token",
      fields: ["chainId", "tokenAddress"],
      for: "The asset at a token address, any Organization's (`bookAssetInTx`, .first()), and the Organization's own row (`ownAssetRow`) (assets/reads.ts:33, :80).",
      crossTenant: true,
    },
    {
      name: "by_asset",
      fields: ["assetId"],
      for: "The added asset an asset id names, any Organization's (`bookAssetByIdInTx`, .first()) (assets/reads.ts:50).",
      crossTenant: true,
    },
  ],
  retention: "Kept indefinitely: removal stamps `removedAt` and the row stays, so the money it booked still reads.",
});

export const table_book_cursors = defineTable({
  id: "book-cursors",
  title: "Book cursors: how far Books has read a Safe from the indexer",
  about:
    "The next block of one Organization Safe's indexer rows still to book (CAP-979), one row per Organization and indexer " +
    "table (`transfer` for the ERC-20s, `native_transfer` for ETH). Inserted by the first observed page that names a next " +
    "block, then patched only forward (`nextBlock > cursor.nextBlock`). A Safe with no row is read from block 0.",
  was: [`${T}:168`, `${B}/facts/writes/observed.ts:88`, `${B}/facts/operations/observe.ts:90`],
  concept: concept_books,
  tenancy: "organization",
  tenantField: "orgId",
  fields: Schema.Struct({
    orgId: S,
    table: Schema.Literals(["transfer", "native_transfer"]),
    nextBlock: N,
    updatedAt: N,
  }),
  key: ["orgId", "table"],
  indexes: [
    {
      name: "by_org_table",
      fields: ["orgId", "table"],
      for: "A Safe's floors for the observer (prefix orgId) and the cursor one page moves (observe.ts:90, facts/writes/observed.ts:89).",
    },
  ],
  retention: KEPT,
});

// ── machines ────────────────────────────────────────────────────────────────────────────────

export const machine_book_account = defineMachine({
  id: "book-account",
  title: "Book account status",
  about:
    "bookAccounts.status. Every writer inserts an account active (the import, an add, an inline account, an acceptance, " +
    "the Safe and opening accounts). An archive replaces the row as archived; no write brings an account back. An archived " +
    "account still answers `accountByKey` (an acct_ id, or its code when no active account has it), and every writer that " +
    "uses one refuses it with WRONG_STATE (`requireActiveAccount`).",
  was: [`${T}:43`, `${B}/accounts/writes/chart.ts:128`, `${B}/writes.ts:70`, `${B}/reads.ts:72`],
  table: table_book_accounts,
  field: "status",
  initial: "active",
  states: [
    { id: "active", about: "Takes new rows; codes are checked against the other active accounts." },
    { id: "archived", about: "Takes no new rows; history, reports and exports keep it.", terminal: true },
  ],
  transitions: {
    to_archived: {
      from: ["active"],
      to: "archived",
      about: "`books.accounts.archive` (archiveAccount, accounts/writes/chart.ts:128) with its `account_archived` fact; the committed archive schedules books_account_archived.",
      guard: "The account is active, has no protection and no active sub-account (requireArchivable, accounts/guards.ts:38). Its balance is not checked.",
      emits: [event_books_account_archived],
    },
  },
});

export const machine_book_asset = defineMachine({
  id: "book-asset",
  title: "Added token: recorded or removed",
  about:
    "bookAssets has no status column: the state is whether `removedAt` is set (`active`, assets/reads.ts:65). Born added " +
    "(admitToken inserts, assets/writes.ts:56). A removal stamps removedAt; adding the token again replaces the same row " +
    "whole, with a new start block and no removedAt.",
  was: [`${T}:160`, `${B}/assets/reads.ts:65`, `${B}/assets/writes.ts:31`, `${B}/assets/writes.ts:64`],
  table: table_book_assets,
  field: "removedAt",
  initial: "added",
  states: [
    { id: "added", about: "removedAt unset: the Movement scanner reads it from startBlock and its Transfers are admitted." },
    { id: "removed", about: "removedAt set: no longer scanned or admitted; its facts and Activity still read." },
  ],
  transitions: {
    to_added: {
      from: ["removed"],
      to: "added",
      about: "Born by `books.assets.admit` (assets/writes.ts:56); a removed row is replaced whole (assets/writes.ts:53). The admit mutation schedules books_asset_added.",
      guard: "Not one of Capxul's assets, not a known external token behind one of their symbols, not already added by this Organization (assets/writes.ts:36-45).",
      emits: [event_books_asset_added],
    },
    to_removed: {
      from: ["added"],
      to: "removed",
      about: "`books.assets.remove` patches removedAt (assets/writes.ts:75) and schedules books_asset_removed.",
      guard: "The Organization's own row exists and is not removed (assets/writes.ts:73).",
      emits: [event_books_asset_removed],
    },
  },
});

export const machine_book_chart = defineMachine({
  id: "book-chart",
  title: "Book chart: imported, backfilled, opened",
  about:
    "bookCharts has no status column: the state is which of the stamps `backfilledAt` and `openedAt` are set. Born " +
    "imported by `books.accounts.import` (makeChart, accounts/writes/chart.ts:32). The backfill's last page stamps " +
    "backfilledAt; the observer then schedules the opening every minute while openedAt is unset, and the opening stamps it " +
    "once, whether or not the Safe held anything. A chart whose every equity code is taken stays backfilled.",
  was: [`${T}:27`, `${T}:30`, `${B}/facts/writes/backfill.ts:95`, `${B}/facts/writes/opening.ts:59`, `${B}/facts/operations/observe.ts:145`],
  table: table_book_charts,
  field: "backfilledAt, openedAt",
  initial: "imported",
  states: [
    { id: "imported", about: "Neither stamp: the backfill is still paging through the money from before the chart." },
    { id: "backfilled", about: "backfilledAt set: the money from before the chart is booked; the opening has not been read." },
    { id: "opened", about: "openedAt set: the Safe's opening balances are recorded; nothing reads it again.", terminal: true },
  ],
  transitions: {
    to_backfilled: {
      from: ["imported"],
      to: "backfilled",
      about: "`markBackfilled` after the last `movements` page of `books.facts.backfill` (facts/writes/backfill.ts:95).",
      guard: "Only a chart with no backfilledAt is stamped (facts/writes/backfill.ts:99).",
      emits: [],
    },
    to_opened: {
      from: ["backfilled"],
      to: "opened",
      about: "`books.facts.record-opening` (recordOpeningInTx, facts/writes/opening.ts:59), after its opening_balance facts.",
      guard: "openedAt unset and an opening equity account found or made; the open action passes only backfilled charts (open.ts:100).",
      emits: [],
    },
  },
});
