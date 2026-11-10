// Activity's feed: one page of the Payments and Movements of whoever you act as (`activity list`),
// one row in full (`activity get`) and one window's totals (`activity summary`). Every rpc is a
// live read of other concepts' tables in the one Postgres: payments' Payments (both sides) and
// Movements, parties' directory for a counterparty's name, books' annotation on a row, indexing's
// chain facts for its evidence and Ponder's progress, and documents' records for what a row
// carries. Nothing here writes, schedules or sends anything.
//
// Who a read is for: the caller's own feed (`{ kind: "person" }`, a person's or an agent's), or an
// Organization's they hold an active Seat in (`{ kind: "organization", orgId }`). A scope the
// caller is not in names nothing they can see: the page and the totals are refused INVALID_INPUT,
// and `get` answers null, as their frozen pages name (decision activity.scope-codes).
//
// The old feed merged two stores (Convex rows and Ponder's answer) in the SDK and decorated a page
// through an overlay query; one Postgres makes the page one query over three indexed streams
// (decisions activity.one-read-per-page, responsibilities.overlays).

import { Schema } from "effect";
import { budget, defineRpc } from "../../packages/blueprint-engine/src/index.ts";
import { concept_activity } from "../shared/foundation.ts";
import { error_INVALID_INPUT, error_NOT_AUTHENTICATED } from "../shared/vocabulary.ts";
import { Outcome, PaymentStatus, Route, table_movements, table_payments } from "../payments/data.ts";
import { PaymentView } from "../payments/ledger.ts";
import { table_parties } from "../parties/data.ts";
import { table_org_members } from "../organizations/data.ts";
import { table_book_accounts, table_book_annotations } from "../books/data.ts";
import { Annotation } from "../books/annotations.ts";
import { table_chain_payments, table_indexer_progress, table_transfers } from "../indexing/data.ts";
import { table_documents } from "../documents/data.ts";
import { RowKind } from "./data.ts";

const OLD = "packages/backend/src/activity";
const ITEMS = `${OLD}/items`;
const PROTOCOL = "packages/protocol/src/activity";
const SDK = "packages/sdk/src/activity";

const S = Schema.String;
const N = Schema.Number;
const Int = Schema.Int;
const Null = Schema.NullOr;
const opt = Schema.optionalKey;

// ── wire shapes ─────────────────────────────────────────────────────────────────────────────

/** Whose feed: the caller's own, or an Organization's they hold an active Seat in (`--org`). */
export const Scope = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("person") }),
  Schema.Struct({ kind: Schema.Literal("organization"), orgId: S }),
]);

/** A row's direction for its reader: money in, money out, or a Payment between two of the reader's own Safes. */
export const Direction = Schema.Literals(["in", "out", "self"]);

/** An exact amount of one exact asset, in raw units: two tokens with the same peg are two assets. */
export const Amount = Schema.Struct({
  /** The deployment's id for the token (`usdc`, `eurc`, `weth`), else its address. */
  asset: S,
  chainId: Int,
  tokenAddress: S,
  decimals: Int,
  raw: S,
});

/** A transaction a row's money moved in. */
export const Receipt = Schema.Struct({ chainId: Int, transactionHash: S });

/** One Payment as a feed row: the reader's side of it, never the payer's execution detail. */
export const PaymentItem = Schema.Struct({
  kind: Schema.Literal("payment"),
  id: S,
  status: PaymentStatus,
  outcome: Null(Outcome),
  route: Route,
  direction: Direction,
  amount: Amount,
  /** The other side as the payer named it at birth, and its Safe. */
  counterparty: Schema.Struct({ label: S, safe: S }),
  payAt: Null(N),
  receipt: Null(Receipt),
  createdAt: N,
  updatedAt: N,
});

/** One Movement as a feed row: outside money in or out of one of the reader's Safes. */
export const MovementItem = Schema.Struct({
  kind: Schema.Literal("movement"),
  /** `<chain id>:<tx hash>:<log index>:<side>` (decision activity.row-ids). */
  id: S,
  direction: Schema.Literals(["in", "out"]),
  amount: Amount,
  /** The other address, named by its Party when a Capxul Party holds it, else by itself. */
  counterparty: Schema.Struct({ label: S, address: S }),
  receipt: Receipt,
  /** Its block's time: a Movement is dated by the chain. */
  createdAt: N,
  updatedAt: N,
});

export const Item = Schema.Union([PaymentItem, MovementItem]);

/** `indexer-unavailable`: Ponder's views are rebuilding or behind the chain, so Movements may be missing. */
export const ReadWarning = Schema.Literal("indexer-unavailable");

export const Page = Schema.Struct({
  items: Schema.Array(Item),
  nextCursor: Null(S),
  /** The backend time the first page was read up to; every later page keeps it. */
  checkpoint: N,
  /** When this page was read, by the backend's clock. */
  observedAt: N,
  readWarning: opt(ReadWarning),
});

/** `from` and `to` in whole epoch milliseconds, both ends included. */
export const Window = Schema.Struct({ from: opt(N), to: opt(N) });

export const Filter = Schema.Struct({
  kind: opt(RowKind),
  direction: opt(Direction),
  /** Payment statuses, each at most once; a status filter leaves Movements out (they have none). */
  status: opt(Schema.Array(PaymentStatus)),
});

/** The chain fact a settled Payment consumed: its PaymentSent, the Transfer beside it, and what it came through. */
export const PaymentEvidence = Schema.Struct({
  chainId: Int,
  /** The Payments contract that emitted the PaymentSent. */
  contractAddress: S,
  /** What sent it through Payments: the payer's Safe directly, Budgets, an escrow, or Agreements. */
  settledThrough: Schema.Literals(["payments", "budgets", "escrow", "agreements"]),
  tokenAddress: S,
  transactionHash: S,
  blockNumber: Int,
  blockHash: S,
  paymentEventLogIndex: Int,
  transferLogIndex: Int,
  source: S,
  destination: S,
  rawAmount: S,
  /** Its block is the deployment's finality depth behind what Ponder has indexed. */
  final: Schema.Boolean,
});

/** The Transfer a Movement is one side of. */
export const MovementEvidence = Schema.Struct({
  chainId: Int,
  tokenAddress: S,
  transactionHash: S,
  blockNumber: Int,
  blockHash: S,
  transferLogIndex: Int,
  source: S,
  destination: S,
  rawAmount: S,
  final: Schema.Boolean,
});

/** A document a row carries, as documents names it; its bytes are `document get`'s. */
export const DocumentRef = Schema.Struct({ documentId: S, documentHash: S, kind: S });

export const Detail = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("payment"),
    /** The Payment as `payment get` shows it, from the reader's side: a payee sees no approval or proposal of the payer's. */
    payment: PaymentView,
    annotation: Null(Annotation),
    /** Null until the Payment settles. */
    evidence: Null(PaymentEvidence),
    viewer: Scope,
  }),
  Schema.Struct({
    kind: Schema.Literal("movement"),
    movementId: S,
    movement: MovementItem,
    documents: Schema.Array(DocumentRef),
    /**
     * `ready`: its Memo read back, as it does once payments has recorded the Movement (the Memo is stored in that
     * transaction); `unavailable`: it did not read back for this reader or failed its integrity check. `pending` stays
     * in the frozen shape and is never answered: no Movement is recorded before its Memo.
     */
    documentState: Schema.Literals(["ready", "pending", "unavailable"]),
    annotation: Null(Annotation),
    evidence: MovementEvidence,
    viewer: Scope,
  }),
]);

/** One exact asset's totals over a window, in raw units; `net` is `in - out` and may be negative. */
export const Total = Schema.Struct({
  asset: S,
  chainId: Int,
  tokenAddress: S,
  in: S,
  out: S,
  net: S,
  pendingIn: S,
});

export const Summary = Schema.Struct({
  window: Schema.Struct({ from: Null(N), to: Null(N) }),
  /** One bucket per exact asset the window touches; empty when the window holds no activity. */
  totals: Schema.Array(Total),
  /** Every row in the window, whatever its direction or status. */
  count: Int,
  observedAt: N,
});

const WHO =
  "A signed-in person or agent, for their own feed; or a current member of an Organization (an active Seat, a person's " +
  "or an agent's), for its feed. Reading grants no authority over the rows.";

const errors = [error_NOT_AUTHENTICATED, error_INVALID_INPUT];

const SCOPE =
  "The scope comes first: the caller's own feed, or an Organization whose active Seat the caller's principal holds " +
  "(organizations' `by_org_principal`); any other Organization is INVALID_INPUT before a row is read. ";

// ── list ────────────────────────────────────────────────────────────────────────────────────

export const rpc_activity_feed_list = defineRpc({
  id: "activity.feed.list",
  title: "One page of a feed, newest first",
  about:
    SCOPE +
    "Then one page, newest first, merged in one query from three indexed streams of payments' rows: the Payments the " +
    "feed owns (`by-owner-created`), those it receives from another owner (`by-payee-created`; a Payment to oneself " +
    "comes once, as `self`), and its Movements (`by-owner-time`, dated by their block). Order is time, then a Payment " +
    "before a Movement at one instant, then id, so every row has one place. The first page fixes the checkpoint (the " +
    "backend's time now); every later page reads at or below it and after its cursor, so pages never repeat a row and a " +
    "row born after the first page waits for the next listing. `limit` is 1 to 100 (25 by default); `range` bounds " +
    "the row's time, both ends included, in whole milliseconds; `filter` takes a kind, a direction and Payment statuses " +
    "(a status filter leaves Movements out). `after` is the sealed cursor the last page answered, bound to this feed and " +
    "these filters: one from another feed, filter or read, or a forged one, is INVALID_INPUT. A Movement's counterparty " +
    "is named from parties' directory by its address. `readWarning` is `indexer-unavailable` when indexing's progress " +
    "says Ponder's views are not ready or its indexed block is more than a minute behind the head it saw: the Payments are " +
    "all there, Movements may be missing.",
  was: [
    `${ITEMS}/operations/list.ts:12`,
    `${ITEMS}/reads/pages.ts:1`,
    `${ITEMS}/rules/pages.ts:96`,
    `${OLD}/guards.ts:28`,
    `${PROTOCOL}/operations.ts:42`,
    `${SDK}/items.ts:132`,
  ],
  concept: concept_activity,
  kind: "query",
  who: WHO,
  input: Schema.Struct({
    scope: Scope,
    limit: opt(Int),
    after: opt(S),
    range: opt(Window),
    filter: opt(Filter),
  }),
  output: Page,
  errors,
  reads: [table_org_members, table_payments, table_movements, table_parties, table_indexer_progress],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("read"),
});

// ── get ─────────────────────────────────────────────────────────────────────────────────────

export const rpc_activity_feed_get = defineRpc({
  id: "activity.feed.get",
  title: "One Payment or Movement in full, or null",
  about:
    "One row of the feed by its kind and id, as its reader may see it, or null when the row does not exist, is not in " +
    "this feed, or the scope is one the caller is not in: one answer for all three, so a read never tells whether " +
    "someone else's row exists. A Payment comes as payments' own view of it from the reader's side: the payee's side " +
    "carries no approval, proposal or command of the payer's. Its evidence, once it is settled, is the PaymentSent it " +
    "consumed (indexing's `chain-payments` by its payment id) with the Transfer beside it (`transfers` by its " +
    "transaction), the Payments contract that emitted it, and what sent it through (the payer's Safe, Budgets, an " +
    "escrow or Agreements, from the fact's `budget_id`, `escrow_address` and `agreement_id`). A Movement comes with its " +
    "Transfer's evidence and its Memo, which documents finds by the Transfer (`by_subject`, both sides alike). `final` compares the " +
    "block with Ponder's progress at the deployment's finality depth. The reader's annotation (books' " +
    "`book-annotations`, its account named from `book-accounts` or the personal chart) is shown beside the row and " +
    "never changes its evidence. A malformed id is INVALID_INPUT.",
  was: [
    `${ITEMS}/operations/get.ts:9`,
    `${ITEMS}/reads/details.ts:27`,
    `${ITEMS}/reads/details.ts:61`,
    `${OLD}/reads.ts:1`,
    `${OLD}/overlays/reads.ts:45`,
    `${PROTOCOL}/schema.ts:189`,
  ],
  concept: concept_activity,
  kind: "query",
  who: `${WHO} A Payment reads from either side of it.`,
  input: Schema.Struct({ scope: Scope, kind: RowKind, id: S }),
  output: Null(Detail),
  errors,
  reads: [
    table_org_members,
    table_payments,
    table_movements,
    table_parties,
    table_book_annotations,
    table_book_accounts,
    table_chain_payments,
    table_transfers,
    table_indexer_progress,
    table_documents,
  ],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("read"),
});

// ── summary ─────────────────────────────────────────────────────────────────────────────────

export const rpc_activity_feed_summary = defineRpc({
  id: "activity.feed.summary",
  title: "One window's totals per exact asset",
  about:
    SCOPE +
    "Then one aggregate over the same three streams `activity.feed.list` reads, bounded by the window (both ends " +
    "included, whole milliseconds, either open): one bucket per exact asset (chain and token address, so two tokens with " +
    "one peg stay apart), in raw units. `in` adds settled Payments received and Movements in (a bank deposit arrives " +
    "as one); `out` adds settled Payments sent and Movements out; `net` is `in - out`; `pendingIn` adds Payments " +
    "received that are still on their way (prepared, scheduled, due, escrowed, submitted, needs_retry). A Payment to " +
    "oneself opens its asset's bucket and adds nothing, so a window of only self activity keeps a zero bucket, and a " +
    "window with no rows answers no buckets. `count` is every row in the window, whatever its direction or status. The " +
    "sums are taken in SQL over the indexes; nothing is pre-aggregated.",
  was: [`${ITEMS}/operations/summary.ts:11`, `${ITEMS}/reads/summaries.ts:30`, `${ITEMS}/rules/totals.ts:30`, `${PROTOCOL}/operations.ts:72`],
  concept: concept_activity,
  kind: "query",
  who: WHO,
  input: Schema.Struct({ scope: Scope, window: opt(Window) }),
  output: Summary,
  errors,
  reads: [table_org_members, table_payments, table_movements],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("read"),
});
