// Books' door: the two procedures other concepts invoke inside their own transaction (P4,
// rules.procedures, ADR-0042 decision 1). Payments invokes them when a Payment settles, is born
// from a chain fact, is reversed, or attributes a Movement of outside money; banking when a bank
// deposit arrives or a payout comes back. Nothing else crosses into books: reads of books' tables
// by the concepts above it are plain reads, and books' own rpcs and workflows write its tables
// directly.
//
// Neither procedure ever refuses: a settlement must never fail because of the books. A side whose
// account choice no longer fits the chart is booked and left waiting in review.

import { Schema } from "effect";
import { defineProcedure } from "../../../packages/book/src/index.ts";
import { concept_books } from "../shared/foundation.ts";
import {
  machine_book_account,
  machine_book_annotation,
  Reference,
  SourceKind,
  table_book_accounts,
  table_book_annotations,
  table_book_charts,
  table_book_facts,
  table_book_prices,
} from "./data.ts";

const OLD = "packages/backend/src";
const BK = `${OLD}/books`;
const PAY = `${OLD}/payments`;

const S = Schema.String;
const N = Schema.Number;
const NullOr = Schema.NullOr;
const opt = Schema.optionalKey;

/** One Organization's side of one money occurrence, as the invoker knows it. */
const MoneySide = Schema.Struct({
  org_id: S,
  kind: Schema.Literals(["payment_settled", "payment_received", "deposit_received", "payment_sent_outside", "payout_returned"]),
  direction: Schema.Literals(["in", "out"]),
  /** The chain occurrence: `payment:<v4 payment id>`, or `transfer:<chain id>:<tx hash>:<log index>`. */
  money_key: S,
  reference: Reference,
  source: Schema.Struct({ kind: SourceKind, id: S }),
  asset_id: S,
  symbol: S,
  decimals: N,
  amount_raw: S,
  /** Whether the asset is one of Capxul's priced assets; an added token never is. */
  priced: Schema.Boolean,
  counterparty: NullOr(S),
  chain_id: N,
  block_number: N,
  block_time: N,
  tx_hash: S,
  safe_address: S,
  actor: Schema.Struct({ kind: Schema.Literals(["person", "agent", "system"]), id: NullOr(S) }),
  /** The account the payer chose when sending (`payment send --account`), or the payout's account for its return. */
  account: opt(
    Schema.Struct({ account_id: opt(S), suggestion: opt(S), same_as: opt(Reference) }),
  ),
});

export const procedure_books_record_money_fact = defineProcedure({
  id: "books.record-money-fact",
  title: "Record a money occurrence's book facts",
  about:
    "Money fact: a settled Payment, a Payment born from a chain fact, a bank deposit, a payout's return and a Movement of " +
    "outside money always have their book fact, written in the same transaction (K10). For each Organization side the " +
    "invoker passes, one fact under its `money_key`, with the USD value at the rate in force at the block for a priced " +
    "asset (unpriced otherwise), chart or no chart (books.facts-without-chart). A key with a standing fact of the same " +
    "kind and amount writes nothing (a replay, a second writer). A side from a Payment, deposit or payout whose key holds " +
    "a standing Movement fact reverses it and records itself as the next generation; a Movement side never replaces one " +
    "of theirs (books.money-key). With a chart, the asset's Safe account is made if missing (`account_created`). An " +
    "account choice applies only to a row nobody annotated yet; one that no longer fits the chart is dropped and the row " +
    "waits in review. It never refuses and makes no outside call.",
  was: [
    `${BK}/facts/writes/money.ts:98`,
    `${BK}/facts/writes/money.ts:130`,
    `${BK}/facts/writes/outside.ts:71`,
    `${BK}/facts/writes/standing.ts:13`,
    `${BK}/accounts/writes/chart.ts:163`,
    `${PAY}/writes/settlements.ts:145`,
    `${PAY}/writes/deposits.ts:117`,
    `${PAY}/writes/rails.ts:62`,
    "books/as-is/books/procedures.ts",
  ],
  concept: concept_books,
  input: Schema.Struct({ sides: Schema.Array(MoneySide) }),
  output: Schema.Struct({ recorded: Schema.Array(S), unchanged: Schema.Array(S), superseded: Schema.Array(S) }),
  errors: [],
  reads: [table_book_facts, table_book_prices, table_book_charts, table_book_accounts, table_book_annotations],
  writes: [table_book_facts, table_book_accounts, table_book_annotations],
  drives: [machine_book_account.t.add, machine_book_annotation.t.queue, machine_book_annotation.t.assign],
  invokes: [],
  emits: [],
});

export const procedure_books_reverse_money_fact = defineProcedure({
  id: "books.reverse-money-fact",
  title: "Reverse a money occurrence's book facts",
  about:
    "Money fact: money the chain took back is taken back in the books in the same transaction (K12). For each " +
    "Organization whose standing fact under `money_key` exists, a `reversed` fact `<fact id>_rev` with the same amount, " +
    "asset and USD value, naming the fact it cancels, dated when the reorganization was seen; reports net the two. " +
    "Settling again later is the next generation (`record-money-fact`). A key with no standing fact writes nothing; a " +
    "second call is a no-op. It never refuses and makes no outside call.",
  was: [
    `${BK}/facts/writes/money.ts:163`,
    `${BK}/facts/writes/money.ts:180`,
    `${BK}/facts/writes/movements.ts:16`,
    `${BK}/facts/writes/standing.ts:57`,
    `${PAY}/verifications/writes/history.ts:190`,
    `${PAY}/writes/rollbacks.ts:71`,
    "books/as-is/books/procedures.ts",
  ],
  concept: concept_books,
  input: Schema.Struct({
    money_key: S,
    org_ids: Schema.Array(S),
    seen_at: N,
    reason: Schema.Literals(["reorganized", "claimed_by_payment"]),
  }),
  output: Schema.Struct({ reversed: Schema.Array(S) }),
  errors: [],
  reads: [table_book_facts],
  writes: [table_book_facts],
  drives: [],
  invokes: [],
  emits: [],
});
