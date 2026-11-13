// Books' door: the two procedures other concepts invoke inside their own transaction (P4,
// rules.procedures, ADR-0042 decision 1). Payments invokes them when a Payment settles, is born from
// a chain fact, is reversed, or attributes a Movement of outside money; banking when a bank deposit
// arrives or a payout comes back. Nothing else crosses into books: reads of books' tables by the
// concepts above it are plain reads, and books' own rpcs and workflows write its tables directly.
//
// Neither procedure ever refuses: a settlement must never fail because of the books. Neither
// reads the chart of accounts, which is ERPNext's on the Organization's site (books.chart-owner):
// the Capxul app there turns the fact into the entry, and a choice of account the site cannot post
// leaves the row unmatched and visible (books.party-lines). Each fact takes the Organization's next
// feed number under its book-feeds row lock (books.feed), so the fact, its number and the money
// commit together or not at all. A call with several Organizations' sides takes their locks in org
// id order, so two settlements between the same two never deadlock; the invoker invokes a books
// procedure after taking its own row locks and takes no other lock after it, so the books' lock is
// always the last one a money transaction waits on.

import { Schema } from "effect";
import { defineProcedure } from "../../packages/blueprint-engine/src/index.ts";
import { concept_books } from "../shared/foundation.ts";
import {
  DocumentRef,
  machine_book_annotation,
  PartyType,
  Reference,
  SourceKind,
  table_book_annotations,
  table_book_facts,
  table_book_feeds,
} from "./data.ts";

const OLD = "packages/backend/src";
const BK = `${OLD}/books`;
const PAY = `${OLD}/payments`;

const S = Schema.String;
const N = Schema.Number;
const NullOr = Schema.NullOr;
const opt = Schema.optionalKey;

/**
 * What the payer, the request or the site said the money is for, when it was instructed: the other side of its
 * entry (books.vouchers), in the site's names. The command that moved the money carries it (`payment send
 * --account`, a request's invoice, a payout's account, a site's "pay this invoice with Capxul").
 */
export const Against = Schema.Struct({
  /** An Account of the site's chart, by its number or its name there (books.chart-owner). */
  account: opt(S),
  suggestion: opt(S),
  same_as: opt(Reference),
  party: opt(Schema.Struct({ type: PartyType, id: S })),
  /** A Cost Center of the site, by its name there. */
  cost_center: opt(S),
  /** A Project of the same Company on the site (books.annotation-project). */
  project: opt(S),
  references: opt(Schema.Array(DocumentRef)),
});

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
  /** The part of the amount a rail kept (a bank payout's or deposit's fee), in the asset's units. */
  fee_raw: opt(S),
  /** Whether the asset is one of Capxul's priced assets; an added token never is. */
  priced: Schema.Boolean,
  /** Independently captured valuation at this block; absence is unvalued, never a synthetic peg. */
  usd: opt(Schema.Struct({ value: S, rate: S, source: S })),
  counterparty: NullOr(S),
  /** The counterparty's Party in the directory, when it has one: the voucher's party. */
  party_id: NullOr(S),
  chain_id: N,
  block_number: N,
  block_time: N,
  tx_hash: S,
  log_index: NullOr(N),
  safe_address: S,
  actor: Schema.Struct({ kind: Schema.Literals(["person", "agent", "system"]), id: NullOr(S) }),
  against: opt(Against),
});

export const procedure_books_record_money_fact = defineProcedure({
  id: "books.record-money-fact",
  title: "Record a money occurrence's book facts",
  about:
    "Repointed (plugs.repoint-money-fact): the chain reader; the plugs' outbox carries each fact to Frappe's books. " +
    "Money fact: a settled Payment, a Payment born from a chain fact, a bank deposit, a payout's return and a Movement of " +
    "outside money always have their book fact, written in the same transaction (K10). For each Organization side the " +
    "invoker passes, one fact under its `money_key` with the Organization's next feed number, taken under its book-feeds " +
    "row lock (the row born if the books have not begun), with the USD value at the rate in force at the block for a " +
    "priced asset when the invoker supplies captured `usd` evidence (unvalued otherwise). The procedure makes no price " +
    "provider call and never assumes a stablecoin peg; its first captured value is immutable (books.captured-valuation). " +
    "A key with a standing fact of the same kind and amount writes nothing (a replay, " +
    "a second writer). A side from a Payment, deposit or payout whose key holds a standing Movement fact reverses it and " +
    "records itself as the next generation; a Movement side never replaces one of theirs (books.money-key). The " +
    "Every recorded Organization side births its row's annotation if it has none: a side with no `against` is born " +
    "waiting (`queue`), so unclassified money is in review (books.every-side-births). The " +
    "`against` choice becomes the row's annotation only if nobody annotated the row yet, kept as given in the site's " +
    "names: this procedure holds no chart and makes no outside call, so it does not check the account. The Capxul app " +
    "on the site resolves it when it posts the entry, and a part it cannot post (an unknown, disabled or group account, " +
    "a receivable or payable account with no party, a document its party type cannot reference, an unknown cost centre " +
    "or project) leaves the line unmatched and visible in review (books.party-lines). Which day the entry posts on, and " +
    "whether that day is closed, is the site's (books.closed-periods). It never refuses.",
  was: [
    `${BK}/facts/writes/money.ts:98`,
    `${BK}/facts/writes/money.ts:130`,
    `${BK}/facts/writes/outside.ts:71`,
    `${BK}/facts/writes/standing.ts:13`,
    `${PAY}/writes/settlements.ts:145`,
    `${PAY}/writes/deposits.ts:117`,
    `${PAY}/writes/rails.ts:62`,
    "docs/as-is/archive/books/procedures.ts",
  ],
  concept: concept_books,
  input: Schema.Struct({ sides: Schema.Array(MoneySide) }),
  output: Schema.Struct({ recorded: Schema.Array(S), unchanged: Schema.Array(S), superseded: Schema.Array(S) }),
  errors: [],
  reads: [table_book_feeds, table_book_facts, table_book_annotations],
  writes: [table_book_feeds, table_book_facts, table_book_annotations],
  drives: [
    machine_book_annotation.t.queue,
    machine_book_annotation.t.assign,
  ],
  invokes: [],
  emits: [],
});

export const procedure_books_reverse_money_fact = defineProcedure({
  id: "books.reverse-money-fact",
  title: "Reverse a money occurrence's book facts",
  about:
    "Money fact: money the chain took back is taken back in the books in the same transaction (K12). For each " +
    "Organization whose standing fact under `money_key` exists, a `reversed` fact `<fact id>_rev` with the next feed " +
    "number and the same amount, asset and USD value, naming the fact it cancels, dated when the reorganization was " +
    "seen; the site takes its entry back the way books.vouchers says. Settling again later is the next generation " +
    "(`record-money-fact`). A key with no " +
    "standing fact writes nothing; a second call is a no-op. It never refuses and makes no outside call.",
  was: [
    `${BK}/facts/writes/money.ts:163`,
    `${BK}/facts/writes/money.ts:180`,
    `${BK}/facts/writes/movements.ts:16`,
    `${BK}/facts/writes/standing.ts:57`,
    `${PAY}/verifications/writes/history.ts:190`,
    `${PAY}/writes/rollbacks.ts:71`,
    "docs/as-is/archive/books/procedures.ts",
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
  reads: [table_book_feeds, table_book_facts],
  writes: [table_book_feeds, table_book_facts],
  drives: [],
  invokes: [],
  emits: [],
});
