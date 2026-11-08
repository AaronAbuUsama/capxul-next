// The facts list: what the books recorded and why, oldest first by when it happened. The feed a
// ledger follows, by the order facts were recorded, is `books.sync.feed` (sync.ts); both show a fact
// the same way (`BookFact`).

import { Schema } from "effect";
import { budget, defineRpc } from "../../../packages/book/src/index.ts";
import { concept_books } from "../shared/foundation.ts";
import {
  error_FEATURE_NOT_AVAILABLE,
  error_INVALID_INPUT,
  error_NOT_AUTHENTICATED,
  error_ROLE_PERMISSION_DENIED,
} from "../shared/vocabulary.ts";
import { table_feature_flags } from "../access/data.ts";
import { table_org_members } from "../organizations/data.ts";
import { FactKind, Reference, SourceKind, table_book_accounts, table_book_annotations, table_book_facts } from "./data.ts";

const OLD = "packages/backend/src/books/facts";

const S = Schema.String;
const N = Schema.Number;
const NullOr = Schema.NullOr;
const opt = Schema.optionalKey;

const AccountRef = Schema.Struct({ accountId: S, code: S, name: S });

export const BookFact = Schema.Struct({
  factId: S,
  seq: Schema.Int,
  kind: FactKind,
  occurredAt: N,
  blockTime: NullOr(N),
  postingDate: NullOr(S),
  amount: NullOr(Schema.Struct({ value: S, asset: S })),
  fee: NullOr(S),
  usd: NullOr(Schema.Struct({ value: S, rate: S, source: S })),
  account: NullOr(AccountRef),
  fromAccount: NullOr(AccountRef),
  /** The counterparty as the chain names it (an address or a label), and its directory Party when it has one. */
  party: NullOr(S),
  partyId: NullOr(S),
  safe: NullOr(S),
  reference: NullOr(Reference),
  rows: Schema.Array(Reference),
  source: NullOr(Schema.Struct({ kind: SourceKind, id: S })),
  reverses: NullOr(S),
  chain: NullOr(Schema.Struct({ chainId: Schema.Int, block: Schema.Int, txHash: S, logIndex: NullOr(Schema.Int) })),
  txHash: NullOr(S),
  /** The voucher this money fact posts (its own id), or null: no chart yet, no price, or not a money fact. */
  voucher: NullOr(S),
  actor: Schema.Struct({ kind: Schema.Literals(["person", "agent", "system"]) }),
  recordedAt: N,
});

export const rpc_books_facts_list = defineRpc({
  id: "books.facts.list",
  title: "List the books' facts",
  about:
    "A page of at most `limit` (1 to 200, the CLI's 50) facts, oldest first by when they happened, then by id, with the " +
    "cursor of the next page; following the cursors reads every fact once. `kind`, `since` and `source` narrow it. A " +
    "money fact shows the account its row posts to now (its annotation, else the not-decided account of its direction), " +
    "its USD value at the rate taken or that it has none yet, its block time, Safe, transaction and log, its party, its " +
    "feed number and the voucher it posts; a reversal names the fact it cancels. Needs no chart.",
  was: [`${OLD}/operations/list.ts:10`, `${OLD}/reads/pages.ts:27`, `${OLD}/views.ts:1`],
  concept: concept_books,
  kind: "query",
  who:
    "Any current Seat of the Organization (org-members), while the `books` gate is on; anyone else is refused " +
    "ROLE_PERMISSION_DENIED.",
  input: Schema.Struct({
    orgId: S,
    kind: opt(FactKind),
    since: opt(N),
    source: opt(S),
    cursor: opt(S),
    limit: opt(N),
  }),
  output: Schema.Struct({ facts: Schema.Array(BookFact), next: NullOr(S) }),
  errors: [error_NOT_AUTHENTICATED, error_ROLE_PERMISSION_DENIED, error_FEATURE_NOT_AVAILABLE, error_INVALID_INPUT],
  reads: [table_org_members, table_feature_flags, table_book_facts, table_book_accounts, table_book_annotations],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("read"),
});
