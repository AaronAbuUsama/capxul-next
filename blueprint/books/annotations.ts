// Annotations: the account, suggestion and memo whoever you act as gives one activity row
// (`activity annotate`). Old activity's annotations and old books' assignments were two tables
// written in one mutation; here they are one row, written in one transaction (decision
// concepts.books; books.annotations-one-table). For an Organization the annotation is the other side
// of the row's entry, in ERPNext's terms and the site's names: account, party, cost centre, project
// and the documents it pays (books.vouchers). The chart is ERPNext's on the Organization's site
// (books.chart-owner): the save checks an account, and makes a new one, through the site's door as
// the person saving (books.annotate-site-chart).

import { Schema } from "effect";
import { budget, defineRpc } from "../../packages/blueprint-engine/src/index.ts";
import { concept_books } from "../shared/foundation.ts";
import {
  error_FEATURE_NOT_AVAILABLE,
  error_INVALID_INPUT,
  error_NOT_AUTHENTICATED,
  error_PROVIDER_ERROR,
  error_PROVIDER_RESPONSE_INVALID,
  error_ROLE_PERMISSION_DENIED,
} from "../shared/vocabulary.ts";
import { integration_frappe_site } from "../plugs/integrations.ts";
import { table_org_deployments, table_org_members } from "../organizations/data.ts";
import { table_hat_wearers } from "../indexing/data.ts";
import {
  DocumentRef,
  machine_book_annotation,
  PartyType,
  Reference,
  table_book_annotations,
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
  /** The site's Account: its name there (`6100 - Cleaning - NW`), its number and its account name. */
  account: NullOr(Schema.Struct({ account: S, number: NullOr(S), name: S })),
  party: NullOr(Schema.Struct({ type: PartyType, id: S })),
  /** The site's Cost Center, by its name there. */
  costCenter: NullOr(S),
  project: NullOr(S),
  references: Schema.Array(DocumentRef),
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
    "books hold money for (its facts name the row), else INVALID_INPUT. Its account is one of the Organization's " +
    "chart, which is ERPNext's on its site (books.chart-owner): given by number or name, the save reads the Account " +
    "through the site's door as the person saving (`doorCall`); one that is not an enabled ledger Account of the " +
    "Company is INVALID_INPUT naming it (books.annotate-site-chart). A new account made inline is inserted on the site " +
    "through the same door, so ERPNext's checks and the person's site roles decide it beside the Books hat. Optionally " +
    "a party, a directory Party with its Frappe party type (none given for a receivable or payable account: the " +
    "counterparty Party the row's money fact proves), a Cost Center and a Project of the site, and the documents it " +
    "pays, each of a type its party may reference in ERPNext, allocating at most the row's value (else INVALID_INPUT; " +
    "books.vouchers). The annotation keeps the site's names, which the Capxul app resolves again when it posts " +
    "(books.party-lines). The first account is an `account_assigned` fact, each later change of account, party or " +
    "documents `recategorized`; the site posts the change, in its first open period if the original's is closed " +
    "(books.closed-periods). A suggestion goes only beside a not-decided account. A person's row takes a code of the " +
    "fixed personal chart, calls no site and keeps no fact (books.annotate-known-rows). Old clients' free-text " +
    "category is refused naming the field. A site that does not answer is PROVIDER_ERROR and nothing is saved. Each " +
    "committed save is one annotation transition.",
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
    party: opt(NullOr(Schema.Struct({ type: PartyType, id: S }))),
    costCenter: opt(NullOr(S)),
    project: opt(NullOr(S)),
    references: opt(Schema.Array(DocumentRef)),
    memo: opt(NullOr(S)),
  }),
  output: Schema.Struct({ annotation: Annotation }),
  errors: [
    error_NOT_AUTHENTICATED,
    error_INVALID_INPUT,
    error_ROLE_PERMISSION_DENIED,
    error_FEATURE_NOT_AVAILABLE,
    error_PROVIDER_ERROR,
    error_PROVIDER_RESPONSE_INVALID,
  ],
  reads: [table_org_members, table_org_deployments, table_hat_wearers, table_book_annotations, table_book_facts],
  writes: [table_book_annotations, table_book_facts],
  drives: [
    machine_book_annotation.t.queue,
    machine_book_annotation.t.assign,
    machine_book_annotation.t.requeue,
    machine_book_annotation.t.recategorize,
  ],
  invokes: [],
  emits: [],
  calls: [integration_frappe_site.c.doorCall],
  chain: [],
  spans: ["rpc.books.annotations.save"],
  budget: budget("vendor"),
});
