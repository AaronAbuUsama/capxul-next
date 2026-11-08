// The chart of accounts and its review queue: import, list, add, rename, archive, the queue and its
// accept, and reclassify. Each rpc is one transaction (A3). The old internal emit-* actions go:
// each change is a transition, whose event the runtime sends (P7).
//
// Every rpc here is an Organization's: the caller must hold a current Seat (organizations'
// org-members) while the `books` gate is on (access' feature-flags). A change needs Manage books:
// the caller's Safe wears the Organization's Books hat (organizations' org-deployments names the
// hat, indexing's hat-wearers says who wears it; shared decision responsibilities.keepers).
//
// The chart is ERPNext's Account tree (books.chart-tree): an account added, renamed or archived in a
// connected head is pulled by books' head sync and applied through these same checks, so Capxul
// assigns every code and id and the head's chart is a copy of Capxul's, never a second chart
// (books.sync). Every
// rpc that records a fact takes the Organization's next feed number (books.feed), so each writes
// book-companies.

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
  FrappeAccountType,
  machine_book_account,
  machine_book_annotation,
  machine_book_company,
  Reference,
  RootType,
  table_book_accounts,
  table_book_annotations,
  table_book_companies,
  table_book_cost_centers,
  table_book_document_vouchers,
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
  rootType: RootType,
  accountType: NullOr(FrappeAccountType),
  isGroup: Schema.Boolean,
  currency: S,
  parent: NullOr(AccountRef),
  quickbooksDetailType: NullOr(S),
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
    "Makes the Organization's chart once, in one transaction, as ERPNext's Account tree (books.chart-tree): the five " +
    "roots and the two Expenses groups that make Capxul's six types, every `us-services` account under its type's group " +
    "with its Frappe account type, Capxul's 4999, 6999 and 3990, the role accounts payroll defaults to (2200 Payroll " +
    "Payable, 5000 salaries: books.payroll-defaults), and one Safe account per asset (type Bank, in the " +
    "token's currency, frozen to all but Capxul): 1010 for the first settlement asset and the next free code for each " +
    "other asset the Organization's money facts already moved, so the money recorded before the chart posts at once " +
    "(books.facts-without-chart). It makes the cost-centre root and Main, the Company's default, and copies the " +
    "Organization's currency, time zone and fiscal year start into the books, fixed from then on " +
    "(books.company-settings); a currency Capxul cannot value (no USD price pair) is INVALID_INPUT " +
    "`currency_not_priced`. Fiscal years, the first included, are derived from that start, never stored. The books are " +
    "born `open` if they had not begun, then `import`ed. Each account and cost centre is a fact with its feed number. " +
    "Nothing is scheduled: there is no backfill. It is the start-up's chart step, which the Organization's FDE or a " +
    "Books-hat wearer runs in the first sitting; nothing makes a chart at the setup's begin (books.startup).",
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
    costCenter: Schema.Struct({ costCenterId: S, name: S }),
    currency: S,
    timeZone: S,
    fiscalYearStart: S,
    basis: Schema.Literal("cash"),
  }),
  errors: [...GUARD_ERRORS, error_WRONG_STATE, error_INVALID_INPUT],
  reads: [...KEEPER_READS, table_organizations, table_book_companies, table_book_facts],
  writes: [table_book_companies, table_book_accounts, table_book_cost_centers, table_book_facts],
  drives: [machine_book_company.t.open, machine_book_company.t.import, machine_book_account.t.add],
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
  about:
    "The chart in code order, archived accounts only with `archived`, each with its protection, its Frappe root and " +
    "account type, whether it is a group, and its currency. The five roots and the two Expenses groups have no code and " +
    "are not listed: they are each account's `type`. An account directly under its type's group shows no parent. " +
    "WRONG_STATE `no_chart` before the import.",
  was: [`${OPS}/list.ts:13`, `${ROWS}/operations.ts:72`],
  concept: concept_books,
  kind: "query",
  who: SEAT_WHO,
  input: Schema.Struct({ orgId: S, archived: opt(Schema.Boolean) }),
  output: Schema.Struct({ basis: Schema.Literal("cash"), accounts: Schema.Array(BookAccount) }),
  errors: [...GUARD_ERRORS, error_WRONG_STATE],
  reads: [...SEAT_READS, table_book_companies, table_book_accounts],
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
    "One new active ledger account, with its `account_created` fact. A sub-account takes its parent's type and, without " +
    "a code, the next code in the parent's ten; its parent becomes a group if it was a ledger account, which needs the " +
    "parent to hold no postings (no money row's voucher posts to it, no annotation names it and no document voucher has " +
    "a line on it: WRONG_STATE `parent_has_postings`), and to have no role and no Frappe account type (WRONG_STATE " +
    "`parent_protected`), since in ERPNext only a ledger account takes GL Entries and an account with a type or a " +
    "Company default never becomes a group (books.chart-tree). A top-level account sits directly under " +
    "its type's group, needs a type and takes the next free hundred in its range. A given code must be free among active " +
    "accounts and start with the type's digit. An `accountType` must fit the root (Bank, Cash or Receivable under " +
    "Assets for money outside Capxul, Payable under Liabilities), else INVALID_INPUT; a Safe account is only ever the " +
    "books' own.",
  was: [`${OPS}/add.ts:13`, `${OLD}/writes.ts:91`, `${OLD}/rules.ts:1`, `${ROWS}/operations.ts:89`],
  concept: concept_books,
  kind: "mutation",
  who: KEEPER_WHO,
  input: Schema.Struct({
    orgId: S,
    name: S,
    type: opt(AccountType),
    under: opt(S),
    code: opt(S),
    /** Frappe's account type, for a head's new account (Tax, Receivable…); none by default. */
    accountType: opt(FrappeAccountType),
  }),
  output: BookAccount,
  errors: [...GUARD_ERRORS, error_INVALID_INPUT, error_WRONG_STATE],
  reads: [
    ...KEEPER_READS,
    table_book_companies,
    table_book_accounts,
    table_book_annotations,
    table_book_facts,
    table_book_document_vouchers,
  ],
  writes: [table_book_companies, table_book_accounts, table_book_facts],
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
  reads: [...KEEPER_READS, table_book_companies, table_book_accounts],
  writes: [table_book_companies, table_book_accounts, table_book_facts],
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
    "free again (a head's copy is disabled and loses its number, since ERPNext keeps numbers unique among all accounts). " +
    "A protected account is WRONG_STATE `protected`, one with active sub-accounts `sub_accounts`.",
  was: [`${OPS}/archive.ts:13`, `${OLD}/accounts/writes/chart.ts:128`, `${OLD}/accounts/guards.ts:38`],
  concept: concept_books,
  kind: "mutation",
  who: KEEPER_WHO,
  input: Schema.Struct({ orgId: S, account: S }),
  output: BookAccount,
  errors: [...GUARD_ERRORS, error_WRONG_STATE],
  reads: [...KEEPER_READS, table_book_companies, table_book_accounts],
  writes: [table_book_companies, table_book_accounts, table_book_facts],
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
    "role. A row that pays payroll (a slip's net, a person's collection) posts on Payroll Payable and does not wait " +
    "(books.payroll-postings). Read from books' own facts, annotations and payroll accruals.",
  was: [`${OPS}/review.ts:11`, `${OLD}/accounts/reads.ts:40`, `${ROWS}/operations.ts:110`],
  concept: concept_books,
  kind: "query",
  who: SEAT_WHO,
  input: Schema.Struct({ orgId: S }),
  output: Schema.Struct({ rows: Schema.Array(ReviewRow) }),
  errors: [...GUARD_ERRORS, error_WRONG_STATE],
  reads: [...SEAT_READS, table_book_companies, table_book_accounts, table_book_annotations, table_book_facts, table_book_document_vouchers],
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
    "type, with its `account_created` fact, and moves the row to it with a `recategorized` fact, which reposts the row's " +
    "voucher. The row is named by its id only: books finds its kind from its own facts. A row not waiting is WRONG_STATE " +
    "`not_in_review`, one whose voucher posts on or before `closed_through` WRONG_STATE `period_closed` " +
    "(books.closed-periods); no suggestion and no name is INVALID_INPUT.",
  was: [`${OPS}/accept.ts:13`, `${OLD}/accounts/writes/review.ts:24`, `${ROWS}/operations.ts:117`],
  concept: concept_books,
  kind: "mutation",
  who: KEEPER_WHO,
  input: Schema.Struct({ orgId: S, rowId: S, name: opt(S), under: opt(S) }),
  output: Schema.Struct({ reference: Reference, account: BookAccount, factIds: Schema.Array(S) }),
  errors: [...GUARD_ERRORS, error_INVALID_INPUT, error_WRONG_STATE],
  reads: [...KEEPER_READS, table_book_companies, table_book_accounts, table_book_annotations, table_book_facts],
  writes: [table_book_companies, table_book_accounts, table_book_annotations, table_book_facts],
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
    "account, under one `rows_reclassified` fact listing every row moved (so the change reverses as one); each moved " +
    "row's voucher reposts. A named row not waiting there, outside the period, with money on both sides of it, or posted " +
    "on or before `closed_through` stays, with its reason. Nothing moved: no fact. Books finds each named row's kind from " +
    "its own facts, so the client passes ids only.",
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
      Schema.Struct({
        reference: Reference,
        reason: Schema.Literals(["not_waiting", "outside_period", "straddles_period", "period_closed"]),
      }),
    ),
  }),
  errors: [...GUARD_ERRORS, error_INVALID_INPUT, error_WRONG_STATE],
  reads: [...KEEPER_READS, table_book_companies, table_book_accounts, table_book_annotations, table_book_facts, table_book_document_vouchers],
  writes: [table_book_companies, table_book_annotations, table_book_facts],
  drives: [machine_book_annotation.t.reclassify, machine_book_annotation.t.assign],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("write"),
});
