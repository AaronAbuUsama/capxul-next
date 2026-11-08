// Annotations: the account, suggestion and memo whoever you act as gives one activity row
// (`activity annotate`). Old activity's annotations and old books' assignments were two tables
// written in one mutation; here they are one row, written in one transaction (decision
// concepts.books; books.annotations-one-table).

import { Schema } from "effect";
import { budget, defineRpc } from "../../../packages/book/src/index.ts";
import { concept_books } from "../shared/foundation.ts";
import {
  error_INVALID_INPUT,
  error_NOT_AUTHENTICATED,
  error_ROLE_PERMISSION_DENIED,
} from "../shared/vocabulary.ts";
import { table_org_deployments, table_org_members } from "../organizations/data.ts";
import { table_hat_wearers } from "../indexing/data.ts";
import {
  machine_book_account,
  machine_book_annotation,
  Reference,
  table_book_accounts,
  table_book_annotations,
  table_book_charts,
  table_book_facts,
} from "./data.ts";

const OLD = "packages/backend/src";

const S = Schema.String;
const N = Schema.Number;
const NullOr = Schema.NullOr;
const opt = Schema.optionalKey;

export const Annotation = Schema.Struct({
  reference: Reference,
  actor: Schema.Struct({ kind: Schema.Literals(["person", "organization"]), id: S }),
  account: NullOr(Schema.Struct({ accountId: S, code: S, name: S })),
  suggestion: NullOr(S),
  memo: NullOr(S),
  lastEditor: Schema.Struct({ kind: Schema.Literals(["person", "agent", "system"]), id: S }),
  updatedAt: N,
});

export const rpc_books_annotations_save = defineRpc({
  id: "books.annotations.save",
  title: "Save a row's annotation",
  about:
    "Replaces the annotation on one Payment or Movement row, in one transaction. An Organization row must be one its " +
    "books hold money for (its facts name the row), else INVALID_INPUT; it takes an active account of its chart by code " +
    "or `acct_` id (no chart or an unknown code: INVALID_INPUT), or a new account made inline under a parent " +
    "(`account_created`). The first account is an `account_assigned` fact and each different one after it " +
    "`recategorized`. A suggestion goes only beside 4999 or 6999. A person's row takes a code of the fixed personal chart " +
    "and keeps no fact; books cannot see a person's Payments, so the annotation lives only in that person's own books " +
    "(books.annotate-known-rows). Old clients' free-text category is refused naming the field. Each committed save is " +
    "one annotation transition.",
  was: [
    `${OLD}/activity/annotations/operations/save.ts:15`,
    `${OLD}/activity/annotations/writes.ts:24`,
    `${OLD}/activity/annotations/guards.ts:41`,
    `${OLD}/activity/annotations/guards.ts:79`,
    `${OLD}/books/writes.ts:223`,
  ],
  concept: concept_books,
  kind: "mutation",
  who:
    "A signed-in person on their own rows. With an Organization, a current Seat (org-members): any Seat may give a row an " +
    "account or put it in 4999 or 6999 with a suggestion; a memo alone and a new account need the Books hat (Manage books), " +
    "else ROLE_PERMISSION_DENIED.",
  input: Schema.Struct({
    actor: Schema.Union([
      Schema.Struct({ kind: Schema.Literal("person") }),
      Schema.Struct({ kind: Schema.Literal("organization"), orgId: S }),
    ]),
    reference: Reference,
    account: opt(S),
    suggest: opt(S),
    newAccount: opt(Schema.Struct({ name: S, under: S })),
    memo: opt(NullOr(S)),
  }),
  output: Schema.Struct({ annotation: Annotation }),
  errors: [error_NOT_AUTHENTICATED, error_INVALID_INPUT, error_ROLE_PERMISSION_DENIED],
  reads: [
    table_org_members,
    table_org_deployments,
    table_hat_wearers,
    table_book_charts,
    table_book_accounts,
    table_book_annotations,
    table_book_facts,
  ],
  writes: [table_book_annotations, table_book_accounts, table_book_facts],
  drives: [
    machine_book_annotation.t.queue,
    machine_book_annotation.t.assign,
    machine_book_annotation.t.requeue,
    machine_book_annotation.t.recategorize,
    machine_book_account.t.add,
  ],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("write"),
});
