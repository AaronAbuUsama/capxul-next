// The sync with a connected ERPNext head (aaron.frappe-head), in both directions, with one author
// per voucher (books.sync; invariant books.one-author-per-voucher):
//
// - Out, Capxul to the head: `books.sync.feed`, the Organization's facts in the order they were
//   recorded, gap-free (books.feed), each with the Frappe documents it makes or changes: an
//   Account, a Cost Center, a Journal Entry or Payment Entry for money, the same voucher again when
//   an annotation reposts it, the voucher cancelled when the chain takes the money back. The head's
//   Capxul app inserts each document by its Capxul id (a unique Custom Field), keeps the last
//   number it applied in the same transaction, and so applies each fact exactly once.
// - In, the head to Capxul: `books.sync.post`, the vouchers the head itself posts (invoices,
//   accruals, closings) as their GL Entries, and its cost centres. A head never posts money in a
//   Safe: it asks Capxul to move money, and the money's own fact posts the voucher. The meaning a
//   head gives Capxul's money (the account, party and documents a payment settles) and every chart
//   change go through the same rpcs the CLI uses (`books.annotations.save`, `books.accounts.*`).
//
// Both are reached from the head's Capxul app through the Core SDK, as the Organization's agent
// (flows.ts). Who may connect a head, and how, is the head connection's design, not books'.

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
import { table_org_deployments, table_org_members } from "../organizations/data.ts";
import { table_hat_wearers } from "../indexing/data.ts";
import {
  GlLine,
  machine_book_head_voucher,
  PartyType,
  table_book_accounts,
  table_book_annotations,
  table_book_companies,
  table_book_cost_centers,
  table_book_facts,
  table_book_head_vouchers,
} from "./data.ts";
import { BookFact } from "./facts.ts";
import { FrappeDoc } from "./frappe.ts";

const S = Schema.String;
const N = Schema.Number;
const Int = Schema.Int;
const NullOr = Schema.NullOr;
const opt = Schema.optionalKey;

const GUARD_ERRORS = [error_NOT_AUTHENTICATED, error_ROLE_PERMISSION_DENIED, error_FEATURE_NOT_AVAILABLE] as const;

export const FeedEntry = Schema.Struct({ seq: Int, fact: BookFact, documents: Schema.Array(FrappeDoc) });

// ── out: the feed ───────────────────────────────────────────────────────────────────────────

export const rpc_books_sync_feed = defineRpc({
  id: "books.sync.feed",
  title: "Read the books' facts after a number, with their Frappe documents",
  about:
    "The facts numbered after `after` (0 for the first), in number order, at most `limit` (1 to 500, default 100), and " +
    "`through`, the books' last number now: a reader that keeps the last number it applied and asks again reads every " +
    "fact exactly once, whatever order money happened in (vision check C5). Each fact comes as the facts list shows it " +
    "(block time, Safe, transaction, log, party: check C6) with the documents it makes or changes, as they stand now: " +
    "`account_*` an Account; `cost_center_created` a Cost Center; a priced money fact its voucher (books.vouchers); " +
    "`account_assigned`, `recategorized` and `rows_reclassified` each voucher they repost, at `capxul_version` this " +
    "number; `reversed` the voucher cancelled, dated when the money was taken back. Before the chart a money fact has no " +
    "document, so a reader that began before the import reads again from 0 once it sees the import's facts; a head is " +
    "connected to charted books only. An unpriced fact (an added token) posts no voucher. It writes nothing: the reader " +
    "keeps its own place.",
  concept: concept_books,
  kind: "query",
  who:
    "A current Seat of the Organization (org-members), while the `books` gate is on: the head reads as the " +
    "Organization's agent. Anyone else is refused ROLE_PERMISSION_DENIED.",
  input: Schema.Struct({ orgId: S, after: Int, limit: opt(Int) }),
  output: Schema.Struct({ entries: Schema.Array(FeedEntry), last: Int, through: Int, asOf: N }),
  errors: [...GUARD_ERRORS, error_INVALID_INPUT],
  reads: [
    table_org_members,
    table_feature_flags,
    table_book_companies,
    table_book_facts,
    table_book_accounts,
    table_book_cost_centers,
    table_book_annotations,
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

// ── in: what the head posts ─────────────────────────────────────────────────────────────────

/** A cost centre the head made or changed, by its Frappe name; its parent by Capxul id, or by the head's name. */
const HeadCostCenter = Schema.Struct({
  kind: Schema.Literal("cost_center"),
  headName: S,
  name: S,
  number: NullOr(S),
  parent: Schema.Union([Schema.Struct({ costCenterId: S }), Schema.Struct({ headName: S })]),
  isGroup: Schema.Boolean,
  disabled: Schema.Boolean,
  modified: N,
});

/** A voucher the head submitted or cancelled, with its GL Entries as the head posted them. */
const HeadVoucher = Schema.Struct({
  kind: Schema.Literal("voucher"),
  voucherType: S,
  voucherNo: S,
  postingDate: S,
  docstatus: Schema.Literals([1, 2]),
  party: NullOr(Schema.Struct({ type: PartyType, id: S })),
  remarks: NullOr(S),
  /** A Period Closing Voucher's end: on submit, nothing on or before it changes again. */
  periodEndDate: NullOr(S),
  lines: Schema.Array(GlLine),
  modified: N,
});

export const rpc_books_sync_post = defineRpc({
  id: "books.sync.post",
  title: "Take the vouchers and cost centres a head posted into the books",
  about:
    "Applies each item in order, in one transaction, and answers what it did with each. A cost centre is made or updated " +
    "by its head name (`cost_center_created` fact on its birth), under a parent of the tree. A voucher is born `receive` " +
    "with its lines, replaced by a newer `modified`, `cancel`led with its reversing lines appended, or left alone when " +
    "not newer. A voucher is refused, naming its reason, when a line names an account or cost centre Capxul's chart does " +
    "not have, a group account or a Safe account (only Capxul posts money in a Safe: books.one-author-per-voucher), when " +
    "its number is a Capxul voucher's id, when its USD debits and credits differ, or when it posts on or before " +
    "`closed_through` and is not itself a closing. A submitted Period Closing Voucher moves `closed_through` to its " +
    "period's end (books.closed-periods). Every applied item is in every report from then on (books.head-vouchers).",
  concept: concept_books,
  kind: "mutation",
  who:
    "A current Seat of the Organization whose Safe wears its Books hat (Manage books), while the `books` gate is on: the " +
    "head's agent wears it. A Seat without the hat is refused ROLE_PERMISSION_DENIED, an outsider ROLE_PERMISSION_DENIED.",
  input: Schema.Struct({ orgId: S, items: Schema.Array(Schema.Union([HeadCostCenter, HeadVoucher])) }),
  output: Schema.Struct({
    applied: Schema.Array(S),
    unchanged: Schema.Array(S),
    refused: Schema.Array(
      Schema.Struct({
        item: S,
        reason: Schema.Literals([
          "unknown_account",
          "unknown_cost_center",
          "group_account",
          "safe_account",
          "capxul_voucher",
          "unbalanced",
          "period_closed",
        ]),
      }),
    ),
    closedThrough: NullOr(S),
  }),
  errors: [...GUARD_ERRORS, error_WRONG_STATE, error_INVALID_INPUT],
  reads: [
    table_org_members,
    table_feature_flags,
    table_org_deployments,
    table_hat_wearers,
    table_book_companies,
    table_book_accounts,
    table_book_cost_centers,
    table_book_facts,
    table_book_head_vouchers,
  ],
  writes: [table_book_companies, table_book_cost_centers, table_book_facts, table_book_head_vouchers],
  drives: [machine_book_head_voucher.t.receive, machine_book_head_voucher.t.cancel],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("write"),
});
