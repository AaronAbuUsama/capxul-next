// The books concept's own door, as it is: every function packages/backend/src/books/index.ts
// exports that runs inside its caller's Convex transaction (it takes the caller's QueryCtx or
// MutationCtx, or is an Effect over the caller's Database or Transaction, and fails with
// CapxulErrors). Other concepts import these by subpath ("#books/facts/writes/money",
// "#books/assets/reads", "#books/guards", "#books/writes", "#books/reads"), never through the door
// file itself. The door's types (BookActor, BookChoice, BookReference, RowAccount, Classifier,
// BookAssetRecord) are shapes, not procedures.
//
// The README's tree names `grantKeeperInTx` on the door (books/README.md:162); the door has no such
// export and no code defines it, so it is not booked.
//
// Reads and writes are transitive within books: a procedure lists the tables its own helpers touch.
// Another concept's function it calls is an `invokes`. A books door function another door function
// calls (bookAssetByIdInTx under the money writers, managesBooksInTx under requireManagesBooks) is
// an `invokes` too, so the link shows the call.
//
// Inputs that are a whole stored row (`Doc<"payments">`) are `Schema.Unknown`: Books reads payments'
// row shape (`moneySides`, `isCommitment`, `assetId`, `amountValue`, `txHash`).

import { Schema } from "effect";
import { defineProcedure } from "../../../packages/book/src/index.ts";
import { concept_books } from "../shared/foundation.ts";
import { error_INVALID_INPUT, error_ROLE_PERMISSION_DENIED, error_WRONG_STATE } from "../shared/vocabulary.ts";
import {
  procedure_organizations_holds_seat_permission_in_tx,
  procedure_organizations_read_organization_name_in_tx,
  procedure_organizations_read_organization_safe_in_tx,
  procedure_organizations_read_seat_standing_in_tx,
} from "../organizations/procedures.ts";
import {
  table_book_accounts,
  table_book_assets,
  table_book_assignments,
  table_book_charts,
  table_book_facts,
  table_book_prices,
} from "./data.ts";

const SRC = "packages/backend/src";
const BK = `${SRC}/books`;
const PAY = `${SRC}/payments`;
const DOOR = `${BK}/index.ts`;

const opt = Schema.optionalKey;
const S = Schema.String;
const N = Schema.Number;
const B = Schema.Boolean;
const U = Schema.Unknown;
const NullOr = Schema.NullOr;

const none = { drives: [], invokes: [], emits: [] } as const;

// ── shapes the door's callers pass ─────────────────────────────────────────────────────────

/** `BookActor` (books/model.ts:3): whose books a row is classified in. */
const Actor = Schema.Struct({ kind: Schema.Literals(["account", "organization"]), id: S });
/** `BookReference` (books/model.ts:9): one activity row. */
const Reference = Schema.Struct({ kind: Schema.Literals(["payment", "movement"]), id: S });
/** `BookAccountRef` (protocol/src/books/schema.ts:48). */
const AccountRef = Schema.Struct({ accountId: S, code: S, name: S });
/** `BookChoice` (books/model.ts:15): what an annotation or a send asks for. */
const Choice = Schema.Struct({
  account: opt(S),
  suggest: opt(S),
  newAccount: opt(Schema.Struct({ name: S, under: S })),
});
/** `Classifier` (books/writes.ts:210). */
const Classifier = Schema.Struct({ authUserId: S, managesBooks: B });
/** `BookAssetRecord` (books/assets/rules.ts:9). */
const BookAsset = Schema.Struct({
  assetId: S,
  chainId: N,
  tokenAddress: S,
  symbol: S,
  decimals: N,
  deploymentStartBlock: N,
});
/** `CommitmentClaim` (payments/reads/settled.ts:61): one claim of an agreement or stream. */
const CommitmentClaim = Schema.Struct({ logicalEventId: S, rawAmount: S, txHash: S, chainTime: N });

// ── who manages the books ───────────────────────────────────────────────────────────────────

export const procedure_books_manages_books_in_tx = defineProcedure({
  id: "books.manages-books-in-tx",
  title: "Whether the person manages an Organization's books",
  about:
    "True when the person is a current Seat holding the `manage-books` Seat permission, asked through Organizations' " +
    "`holdsSeatPermissionInTx` (which reads the Seat's standing, then its seatPermissions row). Books itself asks it in " +
    "every keeper check (`requireKeeper`). Activity's annotation guard and Payments' send booking pass the answer to " +
    "`classifyRow`, which refuses a new inline account without it.",
  was: [
    `${BK}/guards.ts:48`,
    `${DOOR}:6`,
    `${SRC}/organizations/members/reads/permissions.ts:57`,
    `${BK}/guards.ts:67`,
    `${SRC}/activity/annotations/guards.ts:52`,
    `${PAY}/commands/writes/books.ts:45`,
  ],
  concept: concept_books,
  input: Schema.Struct({ orgId: S, authUserId: S }),
  output: B,
  errors: [],
  reads: [],
  writes: [],
  drives: [],
  invokes: [procedure_organizations_holds_seat_permission_in_tx],
  emits: [],
});

export const procedure_books_require_manages_books = defineProcedure({
  id: "books.require-manages-books",
  title: "Refuse unless the person manages an Organization's books",
  about:
    "An Effect over the caller's Database: `managesBooksInTx`, and when false ROLE_PERMISSION_DENIED " +
    "`manage_books_required`, naming the operation and the Organization (its name, else its id). Activity's annotation " +
    "guard runs it before an annotation that makes a new account inline; Books' own asset keeper check runs it in the " +
    "asset add's target query and admit mutation.",
  was: [
    `${BK}/guards.ts:57`,
    `${DOOR}:6`,
    `${BK}/errors.ts:138`,
    `${SRC}/activity/annotations/guards.ts:49`,
    `${BK}/assets/guards.ts:21`,
  ],
  concept: concept_books,
  input: Schema.Struct({ orgId: S, authUserId: S, operation: S }),
  output: Schema.Void,
  errors: [error_ROLE_PERMISSION_DENIED],
  reads: [],
  writes: [],
  drives: [],
  invokes: [procedure_books_manages_books_in_tx, procedure_organizations_read_organization_name_in_tx],
  emits: [],
});

// ── a row's account ─────────────────────────────────────────────────────────────────────────

export const procedure_books_read_row_account_in_tx = defineProcedure({
  id: "books.read-row-account-in-tx",
  title: "Read the account one actor gave one row",
  about:
    "The account an actor's assignment points a Payment or Movement row to, with its suggestion and assignment time; null " +
    "when there is none. A personal code reads from the fixed personal chart (id `personal_<code>`) and is null if the code " +
    "left that chart; an Organization account reads by id, archived or not. Activity's annotation read and save, and " +
    "Payments' send booking (which skips a row that already has one), call it.",
  was: [
    `${BK}/reads.ts:113`,
    `${BK}/reads.ts:88`,
    `${DOOR}:8`,
    `${SRC}/activity/reads.ts:34`,
    `${SRC}/activity/annotations/writes.ts:73`,
    `${PAY}/commands/writes/books.ts:54`,
  ],
  concept: concept_books,
  input: Schema.Struct({ actor: Actor, reference: Reference }),
  output: NullOr(Schema.Struct({ account: AccountRef, suggestion: NullOr(S), assignedAt: N })),
  errors: [],
  reads: [table_book_assignments, table_book_accounts],
  writes: [],
  ...none,
});

export const procedure_books_classify_row = defineProcedure({
  id: "books.classify-row",
  title: "Classify a row into a book account",
  about:
    "The account an annotation, or a payment that books its row as it is sent, gives its row, in the caller's transaction " +
    "(an Effect over `Transaction`). No account and no new account: nothing is written and null returns (a suggestion alone " +
    "is INVALID_INPUT). An Organization row needs a chart (else WRONG_STATE `no_chart`) and takes an active account by code " +
    "or acct_ id, or a new one made inline by a Seat with Manage books (createAccount, with its `account_created` fact; " +
    "without it ROLE_PERMISSION_DENIED). A suggestion goes only beside a not-decided account, checked after an inline " +
    "account was made, so the refusal rolls it back with the caller. A person's row takes a code of the fixed personal " +
    "chart, which includes 3990, 4999 and 6999; a new account there is INVALID_INPUT. The assignment is replaced whole, last " +
    "write wins, even when the account is the same. Only an Organization row records a fact: `account_assigned` for its " +
    "first account, `recategorized` (with fromAccountId) for a different one, nothing for the same one; a fact a Seat that " +
    "is an AI causes carries `actorIsAgent` (recordFact reads the Seat). `method` defaults to `activity.annotations.save` " +
    "and is the operation a refusal names.",
  was: [
    `${BK}/writes.ts:223`,
    `${BK}/writes.ts:269`,
    `${BK}/writes.ts:186`,
    `${BK}/writes.ts:155`,
    `${BK}/writes.ts:91`,
    `${BK}/writes.ts:47`,
    `${BK}/writes.ts:70`,
    `${DOOR}:9`,
    `${SRC}/activity/annotations/writes.ts:63`,
    `${PAY}/commands/writes/books.ts:56`,
  ],
  concept: concept_books,
  input: Schema.Struct({
    actor: Actor,
    reference: Reference,
    choice: Choice,
    classifier: Classifier,
    method: opt(S),
  }),
  output: NullOr(Schema.Struct({ account: AccountRef, suggestion: NullOr(S) })),
  errors: [error_INVALID_INPUT, error_WRONG_STATE, error_ROLE_PERMISSION_DENIED],
  reads: [table_book_charts, table_book_accounts, table_book_assignments],
  writes: [table_book_accounts, table_book_assignments, table_book_facts],
  drives: [],
  invokes: [procedure_organizations_read_organization_name_in_tx, procedure_organizations_read_seat_standing_in_tx],
  emits: [],
});

// ── the assets the books record ─────────────────────────────────────────────────────────────

export const procedure_books_book_asset_in_tx = defineProcedure({
  id: "books.book-asset-in-tx",
  title: "Read the book asset at a token address",
  about:
    "The asset at a token on a chain: one of Capxul's scanned money assets (configuration, no read), else the first " +
    "`by_chain_token` row of any Organization that added it, removed or not, so money booked before still reads; null " +
    "when unknown. Payments' Deposit writer, Movement admission, Movement activity and outside-money reads, Documents' " +
    "memo writer and Books' own observer resolve a token through it.",
  was: [
    `${BK}/assets/reads.ts:33`,
    `${DOOR}:24`,
    `${PAY}/writes/deposits.ts:64`,
    `${PAY}/movements/writes/admission.ts:29`,
    `${PAY}/movements/reads/activity.ts:48`,
    `${PAY}/movements/reads/outside.ts:78`,
    `${SRC}/documents/memos/writes.ts:37`,
    `${BK}/facts/writes/observed.ts:32`,
  ],
  concept: concept_books,
  input: Schema.Struct({ chainId: N, tokenAddress: S }),
  output: NullOr(BookAsset),
  errors: [],
  reads: [table_book_assets],
  writes: [],
  ...none,
});

export const procedure_books_book_asset_by_id_in_tx = defineProcedure({
  id: "books.book-asset-by-id-in-tx",
  title: "Read the book asset an asset id names",
  about:
    "The asset an asset id names: Capxul's configured one, else the first added row of any Organization (`by_asset`); null " +
    "for an unknown id, and null for a malformed one (toAssetId throws and is caught). Payments' Payment and activity views " +
    "name a Payment's asset with it; Books' money writers, opening and reconcile resolve a fact's asset through it.",
  was: [
    `${BK}/assets/reads.ts:50`,
    `${DOOR}:24`,
    `${PAY}/views/payments.ts:149`,
    `${PAY}/views/activity.ts:30`,
    `${BK}/assets/reads.ts:139`,
    `${BK}/reports/reads.ts:182`,
  ],
  concept: concept_books,
  input: Schema.Struct({ assetId: S }),
  output: NullOr(BookAsset),
  errors: [],
  reads: [table_book_assets],
  writes: [],
  ...none,
});

export const procedure_books_records_added_token_in_tx = defineProcedure({
  id: "books.records-added-token-in-tx",
  title: "Whether an Organization records an added token at a block",
  about:
    "True when the Organization's own row for the token exists, is not removed, and the block is not before its " +
    "`startBlock`. Payments' Movement admission asks it before admitting an added token's Transfer for that Organization.",
  was: [`${BK}/assets/reads.ts:99`, `${BK}/assets/reads.ts:80`, `${DOOR}:24`, `${PAY}/movements/writes/admission.ts:37`],
  concept: concept_books,
  input: Schema.Struct({ orgId: S, asset: Schema.Struct({ chainId: N, tokenAddress: S }), blockNumber: N }),
  output: B,
  errors: [],
  reads: [table_book_assets],
  writes: [],
  ...none,
});

// ── money facts ─────────────────────────────────────────────────────────────────────────────

const MONEY_FACT_READS = [
  table_book_charts,
  table_book_facts,
  table_book_assets,
  table_book_prices,
  table_book_assignments,
  table_book_accounts,
];

const MONEY_FACT_INVOKES = [procedure_books_book_asset_by_id_in_tx, procedure_organizations_read_organization_safe_in_tx];

export const procedure_books_record_settled_payment_in_tx = defineProcedure({
  id: "books.record-settled-payment-in-tx",
  title: "Record a settled Payment's money facts",
  about:
    "A2: for each Organization side of a settled Payment or an arrived Deposit, one money fact in the same transaction as " +
    "the Payment's write. Sides (`moneySides`): an Organization sender books `payment_settled` (out, with the Payment's " +
    "counterparty Party), an Organization recipient other than the sender `payment_received` (in), a Deposit to an " +
    "Organization `deposit_received`; a person's side keeps none. A commitment (any row with `claimedRaw`) records nothing " +
    "here. A side with no chart records nothing; a side whose fact id already stands writes nothing (a replay, the second " +
    "seam or the backfill). The fact takes the row's assigned account, else the not-decided account of its direction " +
    "found by role, else none; it is dated by `chainTime`, else `fallbackAt`, else Capxul's time; a Capxul asset takes a " +
    "USD value at `priceAt` once. The Safe account for the asset's symbol is made first if the chart has none " +
    "(`ensureSafeAccountInTx`, with an actorless `account_created` fact); an unknown asset is named, and gets a Safe " +
    "account, by its asset id. Payments' indexed-fact settle, verified send, commitment completion, bank delivery and " +
    "Deposit writers call it; Books' backfill calls it with the Payment's last change as `fallbackAt`.",
  was: [
    `${BK}/facts/writes/money.ts:98`,
    `${BK}/facts/writes/money.ts:49`,
    `${BK}/facts/writes/money.ts:29`,
    `${BK}/facts/rules.ts:39`,
    `${BK}/facts/writes/standing.ts:13`,
    `${BK}/facts/reads/facts.ts:14`,
    `${BK}/accounts/writes/chart.ts:163`,
    `${BK}/assets/reads.ts:135`,
    `${DOOR}:13`,
    `${PAY}/writes/settlements.ts:145`,
    `${PAY}/verifications/writes/sends.ts:228`,
    `${PAY}/verifications/writes/commitments.ts:173`,
    `${PAY}/writes/rails.ts:62`,
    `${PAY}/writes/deposits.ts:117`,
    `${BK}/facts/writes/backfill.ts:47`,
  ],
  concept: concept_books,
  input: Schema.Struct({ payment: U, chainTime: NullOr(N), fallbackAt: opt(N) }),
  output: Schema.Void,
  errors: [],
  reads: MONEY_FACT_READS,
  writes: [table_book_facts, table_book_accounts],
  drives: [],
  invokes: MONEY_FACT_INVOKES,
  emits: [],
});

export const procedure_books_record_commitment_claim_in_tx = defineProcedure({
  id: "books.record-commitment-claim-in-tx",
  title: "Record one commitment claim's money facts",
  about:
    "One claim of an agreement or stream: its raw amount in the asset's configured decimals, as a `claim` money fact per " +
    "Organization side, dated by the claiming block, under `fct_<kind>_<paymentId>_<logicalEventId>` so a replay writes " +
    "nothing; its source is the commitment, so `--source <paymentId>` lists every claim. An asset with no configured " +
    "decimals (any added token) records nothing. Same sides, account, price and Safe-account rules as a settled Payment. " +
    "It does not check that the row is a commitment. Payments' claim and commitment verifications call it; the backfill " +
    "calls it for each standing claim.",
  was: [
    `${BK}/facts/writes/money.ts:130`,
    `${BK}/facts/rules.ts:78`,
    `${DOOR}:13`,
    `${PAY}/verifications/writes/claims.ts:81`,
    `${PAY}/verifications/writes/commitments.ts:164`,
    `${BK}/facts/writes/backfill.ts:43`,
  ],
  concept: concept_books,
  input: Schema.Struct({ payment: U, claim: CommitmentClaim }),
  output: Schema.Void,
  errors: [],
  reads: MONEY_FACT_READS,
  writes: [table_book_facts, table_book_accounts],
  drives: [],
  invokes: MONEY_FACT_INVOKES,
  emits: [],
});

export const procedure_books_reverse_settled_payment_in_tx = defineProcedure({
  id: "books.reverse-settled-payment-in-tx",
  title: "Reverse a settled Payment's money facts",
  about:
    "A reorganization took back the occurrence that settled a Payment, or the Movement a Deposit came from: each side's " +
    "standing fact gets a `reversed` fact `<factId>_rev` (CAP-970) with the same amount, USD value and account, naming it " +
    "in `reversesFactId`; settling again writes the next generation. The reversal is dated when it is recorded, not at a " +
    "block. A commitment reverses nothing here; a side with no standing fact (no chart, never booked) writes nothing. " +
    "Payments' history correction and Deposit rollback call it.",
  was: [
    `${BK}/facts/writes/money.ts:163`,
    `${BK}/facts/writes/standing.ts:39`,
    `${BK}/facts/writes/standing.ts:57`,
    `${DOOR}:13`,
    `${PAY}/verifications/writes/history.ts:190`,
    `${PAY}/writes/rollbacks.ts:71`,
  ],
  concept: concept_books,
  input: Schema.Struct({ payment: U }),
  output: Schema.Void,
  errors: [],
  reads: [table_book_facts],
  writes: [table_book_facts],
  ...none,
});

export const procedure_books_reverse_commitment_claim_in_tx = defineProcedure({
  id: "books.reverse-commitment-claim-in-tx",
  title: "Reverse one commitment claim's money facts",
  about:
    "A reorganization took back one claim of a commitment: each side's standing claim fact gets a `reversed` fact, dated " +
    "when it is recorded. Payments' history correction calls it for a removed claim.",
  was: [`${BK}/facts/writes/money.ts:180`, `${BK}/facts/writes/standing.ts:39`, `${DOOR}:13`, `${PAY}/verifications/writes/history.ts:189`],
  concept: concept_books,
  input: Schema.Struct({ payment: U, logicalEventId: S }),
  output: Schema.Void,
  errors: [],
  reads: [table_book_facts],
  writes: [table_book_facts],
  ...none,
});

export const procedure_books_reverse_outside_money_in_tx = defineProcedure({
  id: "books.reverse-outside-money-in-tx",
  title: "Reverse a Movement's outside-money facts",
  about:
    "A reorganization, or a Capxul Payment that claimed the Transfer, took a Movement back: for each Organization named, " +
    "its standing `payment_sent_outside` and `payout_returned` facts under the Movement id are reversed (CAP-969). A " +
    "`deposit_received` fact is not looked for. Payments' Movement removal calls it with the Organizations it reads first.",
  was: [`${BK}/facts/writes/movements.ts:16`, `${BK}/facts/rules.ts:82`, `${DOOR}:21`, `${PAY}/movements/writes/overlays.ts:51`],
  concept: concept_books,
  input: Schema.Struct({ orgIds: Schema.Array(S), movementId: S }),
  output: Schema.Void,
  errors: [],
  reads: [table_book_facts],
  writes: [table_book_facts],
  ...none,
});

export const procedure_books_schedule_outside_money_in_tx = defineProcedure({
  id: "books.schedule-outside-money-in-tx",
  title: "Schedule a Movement's outside money to be booked",
  about:
    "Schedules Books' internal mutation `books.facts.outside` for the Movement after 30 seconds, or 5 minutes on staging " +
    "and production, so a Capxul Payment's verification can claim the Transfer first and a quick pay is never booked as " +
    "money sent outside and then reversed. Writes no table itself. Payments' Movement projection calls it when an " +
    "attribution it inserts is outside money.",
  was: [`${BK}/facts/writes/movements.ts:39`, `${DOOR}:21`, `${PAY}/movements/writes/projections.ts:64`],
  concept: concept_books,
  input: Schema.Struct({ movementId: S }),
  output: Schema.Void,
  errors: [],
  reads: [],
  writes: [],
  ...none,
});
