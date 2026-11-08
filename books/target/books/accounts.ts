// The chart of accounts and its review queue: import, list, add, rename, archive, the queue and its
// accept, and reclassify. Each rpc is one transaction (A3). The old internal emit-* actions go:
// each change is a transition, whose event the runtime sends (P7).
//
// Every rpc here is an Organization's: the caller must hold a current Seat (organizations'
// org-members) while the `books` gate is on (access' feature-flags). A change needs Manage books:
// the caller's Safe wears the Organization's Books hat (organizations' org-deployments names the
// hat, indexing's hat-wearers says who wears it; shared decision responsibilities.keepers).

import { Schema } from "effect";
import { budget, defineRpc } from "../../../packages/book/src/index.ts";
import { concept_books } from "../shared/foundation.ts";
import {
  error_FEATURE_NOT_AVAILABLE,
  error_INVALID_INPUT,
  error_NOT_AUTHENTICATED,
  error_ROLE_PERMISSION_DENIED,
  error_WRONG_STATE,
} from "../shared/vocabulary.ts";
import { table_feature_flags } from "../access/data.ts";
import { table_org_deployments, table_org_members, table_organizations } from "../organizations/data.ts";
import { table_hat_wearers } from "../indexing/data.ts";
import {
  AccountType,
  machine_book_account,
  machine_book_annotation,
  machine_book_chart,
  Reference,
  table_book_accounts,
  table_book_annotations,
  table_book_charts,
  table_book_facts,
} from "./data.ts";

const OLD = "packages/backend/src/books";
const OPS = `${OLD}/accounts/operations`;
const ROWS = "packages/protocol/src/books";

const S = Schema.String;
const N = Schema.Number;
const NullOr = Schema.NullOr;
const opt = Schema.optionalKey;

const SEAT_WHO =
  "A current Seat of the Organization (org-members), while the `books` gate is on for it; anyone else is refused with " +
  "ROLE_PERMISSION_DENIED, naming no account.";
const KEEPER_WHO =
  "A current Seat of the Organization whose Safe wears its Books hat (Manage books), while the `books` gate is on; a " +
  "Seat without the hat is refused ROLE_PERMISSION_DENIED (`manage_books_required`), an outsider ROLE_PERMISSION_DENIED.";

const SEAT_READS = [table_org_members, table_feature_flags] as const;
const KEEPER_READS = [table_org_members, table_feature_flags, table_org_deployments, table_hat_wearers] as const;
const GUARD_ERRORS = [error_NOT_AUTHENTICATED, error_ROLE_PERMISSION_DENIED, error_FEATURE_NOT_AVAILABLE] as const;

const AccountRef = Schema.Struct({ accountId: S, code: S, name: S });
export const BookAccount = Schema.Struct({
  accountId: S,
  code: S,
  name: S,
  type: AccountType,
  parent: NullOr(AccountRef),
  quickbooksDetailType: S,
  status: Schema.Literals(["active", "archived"]),
  protection: NullOr(Schema.Literals(["safe", "uncategorized", "posting", "opening"])),
  safe: NullOr(Schema.Struct({ address: S, asset: S })),
});
const ReviewRow = Schema.Struct({ reference: Reference, account: AccountRef, suggestion: NullOr(S), waitingSince: N });

// ── import ──────────────────────────────────────────────────────────────────────────────────

export const rpc_books_accounts_import = defineRpc({
  id: "books.accounts.import",
  title: "Make the chart from a template",
  about:
    "Makes the Organization's chart once, in one transaction: every `us-services` account, Capxul's 4999, 6999 and 3990, " +
    "and one Safe account per asset: 1010 for the first settlement asset and the next free code for each other asset the " +
    "Organization's money facts already moved, so the money recorded before the chart posts at once " +
    "(books.facts-without-chart). Each account is an `account_created` fact. Nothing is scheduled: there is no backfill.",
  was: [`${OPS}/import.ts:13`, `${OLD}/accounts/writes/chart.ts:32`, `${OLD}/facts/writes/backfill.ts:86`, `${ROWS}/operations.ts:82`],
  concept: concept_books,
  kind: "mutation",
  who: KEEPER_WHO,
  input: Schema.Struct({ orgId: S, template: S }),
  output: Schema.Struct({
    template: Schema.Literal("us-services"),
    added: N,
    protected: Schema.Array(S),
    safeAccounts: Schema.Array(Schema.Struct({ code: S, accountId: S, safe: S, asset: S })),
    basis: Schema.Literal("cash"),
  }),
  errors: [...GUARD_ERRORS, error_WRONG_STATE, error_INVALID_INPUT],
  reads: [...KEEPER_READS, table_organizations, table_book_charts, table_book_facts],
  writes: [table_book_charts, table_book_accounts, table_book_facts],
  drives: [machine_book_chart.t.import, machine_book_account.t.add],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("write"),
});

// ── list ────────────────────────────────────────────────────────────────────────────────────

export const rpc_books_accounts_list = defineRpc({
  id: "books.accounts.list",
  title: "Read the chart of accounts",
  about: "The chart in code order, archived accounts only with `archived`, each with its protection. WRONG_STATE `no_chart` before the import.",
  was: [`${OPS}/list.ts:13`, `${ROWS}/operations.ts:72`],
  concept: concept_books,
  kind: "query",
  who: SEAT_WHO,
  input: Schema.Struct({ orgId: S, archived: opt(Schema.Boolean) }),
  output: Schema.Struct({ basis: Schema.Literal("cash"), accounts: Schema.Array(BookAccount) }),
  errors: [...GUARD_ERRORS, error_WRONG_STATE],
  reads: [...SEAT_READS, table_book_charts, table_book_accounts],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("read"),
});

// ── add ─────────────────────────────────────────────────────────────────────────────────────

export const rpc_books_accounts_add = defineRpc({
  id: "books.accounts.add",
  title: "Add an account to the chart",
  about:
    "One new active account, with its `account_created` fact. A sub-account takes its parent's type and, without a code, " +
    "the next code in the parent's ten; a top-level account needs a type and takes the next free hundred in its range. A " +
    "given code must be free among active accounts and start with the type's digit.",
  was: [`${OPS}/add.ts:13`, `${OLD}/writes.ts:91`, `${OLD}/rules.ts:1`, `${ROWS}/operations.ts:89`],
  concept: concept_books,
  kind: "mutation",
  who: KEEPER_WHO,
  input: Schema.Struct({ orgId: S, name: S, type: opt(AccountType), under: opt(S), code: opt(S) }),
  output: BookAccount,
  errors: [...GUARD_ERRORS, error_INVALID_INPUT, error_WRONG_STATE],
  reads: [...KEEPER_READS, table_book_charts, table_book_accounts],
  writes: [table_book_accounts, table_book_facts],
  drives: [machine_book_account.t.add],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("write"),
});

// ── rename ──────────────────────────────────────────────────────────────────────────────────

export const rpc_books_accounts_rename = defineRpc({
  id: "books.accounts.rename",
  title: "Rename or renumber an account",
  about:
    "A new name (trimmed), a new code, or both, for an active account named by code or `acct_` id, with an " +
    "`account_renamed` fact. Its own code may be given again and a freed code taken. A call that changes nothing records " +
    "no fact and drives no transition.",
  was: [`${OPS}/rename.ts:13`, `${OLD}/accounts/writes/chart.ts:99`, `${ROWS}/operations.ts:96`],
  concept: concept_books,
  kind: "mutation",
  who: KEEPER_WHO,
  input: Schema.Struct({ orgId: S, account: S, name: opt(S), code: opt(S) }),
  output: BookAccount,
  errors: [...GUARD_ERRORS, error_INVALID_INPUT, error_WRONG_STATE],
  reads: [...KEEPER_READS, table_book_charts, table_book_accounts],
  writes: [table_book_accounts, table_book_facts],
  drives: [machine_book_account.t.rename],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("write"),
});

// ── archive ─────────────────────────────────────────────────────────────────────────────────

export const rpc_books_accounts_archive = defineRpc({
  id: "books.accounts.archive",
  title: "Archive an account",
  about:
    "Archives an active account that has no role and no active sub-account, with an `account_archived` fact; its code is " +
    "free again. A protected account is WRONG_STATE `protected`, one with active sub-accounts `sub_accounts`.",
  was: [`${OPS}/archive.ts:13`, `${OLD}/accounts/writes/chart.ts:128`, `${OLD}/accounts/guards.ts:38`],
  concept: concept_books,
  kind: "mutation",
  who: KEEPER_WHO,
  input: Schema.Struct({ orgId: S, account: S }),
  output: BookAccount,
  errors: [...GUARD_ERRORS, error_WRONG_STATE],
  reads: [...KEEPER_READS, table_book_charts, table_book_accounts],
  writes: [table_book_accounts, table_book_facts],
  drives: [machine_book_account.t.archive],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("write"),
});

// ── the review queue ────────────────────────────────────────────────────────────────────────

export const rpc_books_accounts_review = defineRpc({
  id: "books.accounts.review",
  title: "Read the review queue",
  about:
    "The rows waiting in 4999 or 6999, oldest first, with their suggestion: every row whose annotation waits, and every " +
    "money row of the Organization nobody annotated (an outside deposit), at its direction's not-decided account found by " +
    "role. Read from books' own facts and annotations.",
  was: [`${OPS}/review.ts:11`, `${OLD}/accounts/reads.ts:40`, `${ROWS}/operations.ts:110`],
  concept: concept_books,
  kind: "query",
  who: SEAT_WHO,
  input: Schema.Struct({ orgId: S }),
  output: Schema.Struct({ rows: Schema.Array(ReviewRow) }),
  errors: [...GUARD_ERRORS, error_WRONG_STATE],
  reads: [...SEAT_READS, table_book_charts, table_book_accounts, table_book_annotations, table_book_facts],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("read"),
});

export const rpc_books_accounts_accept = defineRpc({
  id: "books.accounts.accept",
  title: "Accept a suggestion from the queue",
  about:
    "Makes a waiting row's suggestion (or `name`) a new account under `under`, else at the top of the waiting account's " +
    "type, with its `account_created` fact, and moves the row to it with a `recategorized` fact. The row is named by its " +
    "id only: books finds its kind from its own facts. A row not waiting is WRONG_STATE `not_in_review`; no suggestion " +
    "and no name is INVALID_INPUT.",
  was: [`${OPS}/accept.ts:13`, `${OLD}/accounts/writes/review.ts:24`, `${ROWS}/operations.ts:117`],
  concept: concept_books,
  kind: "mutation",
  who: KEEPER_WHO,
  input: Schema.Struct({ orgId: S, rowId: S, name: opt(S), under: opt(S) }),
  output: Schema.Struct({ reference: Reference, account: BookAccount, factIds: Schema.Array(S) }),
  errors: [...GUARD_ERRORS, error_INVALID_INPUT, error_WRONG_STATE],
  reads: [...KEEPER_READS, table_book_charts, table_book_accounts, table_book_annotations, table_book_facts],
  writes: [table_book_accounts, table_book_annotations, table_book_facts],
  drives: [machine_book_account.t.add, machine_book_annotation.t.accept, machine_book_annotation.t.assign],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("write"),
});

// ── reclassify ──────────────────────────────────────────────────────────────────────────────

export const rpc_books_accounts_reclassify = defineRpc({
  id: "books.accounts.reclassify",
  title: "Move the rows waiting in a not-decided account",
  about:
    "Moves every row waiting in 4999 or 6999, or only the rows named by id, whose money falls inside the period, to one " +
    "account, under one `rows_reclassified` fact listing every row moved (so the change reverses as one). A named row not " +
    "waiting there, outside the period, or with money on both sides of it stays, with its reason. Nothing moved: no fact. " +
    "Books finds each named row's kind from its own facts, so the client passes ids only.",
  was: [`${OPS}/reclassify.ts:16`, `${OLD}/accounts/writes/review.ts:98`, `${ROWS}/operations.ts:129`],
  concept: concept_books,
  kind: "mutation",
  who: KEEPER_WHO,
  input: Schema.Struct({
    orgId: S,
    fromAccount: S,
    toAccount: S,
    from: opt(N),
    to: opt(N),
    rows: opt(Schema.Array(S)),
  }),
  output: Schema.Struct({
    fromAccount: AccountRef,
    toAccount: AccountRef,
    factId: NullOr(S),
    moved: Schema.Array(Reference),
    refused: Schema.Array(
      Schema.Struct({ reference: Reference, reason: Schema.Literals(["not_waiting", "outside_period", "straddles_period"]) }),
    ),
  }),
  errors: [...GUARD_ERRORS, error_INVALID_INPUT, error_WRONG_STATE],
  reads: [...KEEPER_READS, table_book_charts, table_book_accounts, table_book_annotations, table_book_facts],
  writes: [table_book_annotations, table_book_facts],
  drives: [machine_book_annotation.t.reclassify, machine_book_annotation.t.assign],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("write"),
});
