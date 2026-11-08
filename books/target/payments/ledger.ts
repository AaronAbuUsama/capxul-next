// Area ledger: reading Payments. `get` and `list` are one indexed read each, for either side of a Payment;
// `watch` is the live read every money flow and `payment wait` follow until a Payment (or every Payment of
// an approval) ends. A read changes nothing and sends no event. A Payment carries its own labels, document
// and outcome, so a read touches payments' tables, the caller's own Party (to tell "no Account" from "not
// yours") and, for the execution line, the approval that carries the Payment.

import { Schema } from "effect";
import { budget, defineRpc } from "../../../packages/book/src/index.ts";
import { concept_payments } from "../shared/foundation.ts";
import { error_INVALID_INPUT, error_NOT_AUTHENTICATED, error_ROLE_PERMISSION_DENIED } from "../shared/vocabulary.ts";
import * as approvalsData from "../approvals/data.ts";
import * as orgsData from "../organizations/data.ts";
import * as partiesData from "../parties/data.ts";
import { Outcome, PaymentStatus, Route, table_payments } from "./data.ts";

const OLD = "packages/backend/src/payments";
const S = Schema.String;
const Null = Schema.NullOr;

/** One Payment as a reader of either side sees it (`payment get`, and each item of `payment list`). */
export const PaymentView = Schema.Struct({
  id: S,
  status: PaymentStatus,
  route: Route,
  direction: Schema.Literals(["out", "in"]),
  amount: Schema.Struct({ asset: S, value: S }),
  counterparty: S,
  chain_payment_id: S,
  pay_at: Null(S),
  receipt: Null(Schema.Struct({ chain_id: Schema.Int, tx_hash: S })),
  execution: Schema.Struct({
    approval_id: Null(S),
    proposal_id: Null(S),
    outcome: Null(Outcome),
    needs_retry: Schema.Boolean,
  }),
  documents: Schema.Array(Schema.Struct({ document_id: S, document_hash: S, render: S })),
  timing: Schema.Struct({ created_at: Schema.Number, sent_at: Null(Schema.Number), settled_at: Null(Schema.Number) }),
});

/** What a live follower receives on each change: one Payment, or an approval with the Payments it carries. */
export const Followed = Schema.Union([
  Schema.Struct({ payment: Null(PaymentView) }),
  Schema.Struct({
    approval: Schema.Struct({ id: S, state: S, ended: Schema.Boolean, refusal: Null(Schema.Struct({ code: S, reason: S })) }),
    payments: Schema.Array(PaymentView),
  }),
]);

const READS = [table_payments, partiesData.table_parties, orgsData.table_org_members];
const WHO =
  "A signed-in person or agent who sent or received the Payment (either side's tenant). With `--org`, a current member of " +
  "that Organization (a Seat), for the Organization's side.";

export const rpc_payments_ledger_get = defineRpc({
  id: "payments.ledger.get",
  title: "Read one Payment",
  about:
    "One Payment by its `payment_` id, from whichever side the caller is on: its status, route, amount, counterparty " +
    "label, payment id, receipt (the consumed PaymentSent's transaction) once settled, its execution (the approval or " +
    "proposal that carries it, how it ended and whether it needs a retry) and its document, with the `capxul document " +
    "render` command that saves it. A caller with no Account (no Party of their own) is refused `INVALID_INPUT`, and so is " +
    "an id that names no Payment the caller's side holds: it answers no null. It writes nothing.",
  concept: concept_payments,
  kind: "query",
  who: WHO,
  input: Schema.Struct({ payment_id: S, org: Null(S) }),
  output: PaymentView,
  errors: [error_NOT_AUTHENTICATED, error_INVALID_INPUT, error_ROLE_PERMISSION_DENIED],
  reads: [...READS, approvalsData.table_approvals],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("read"),
  was: [`${OLD}/records/reads.ts:23`, `${OLD}/reads/payments.ts:130`, `${OLD}/views/recipients.ts:22`, "books/as-is/payments/movements.ts"],
});

export const rpc_payments_ledger_list = defineRpc({
  id: "payments.ledger.list",
  title: "List the Payments sent and received",
  about:
    "One page of the Payments the caller's side sent and received, newest first: the union of the owner's index and the " +
    "payee's, merged by birth time. `scheduled` lists only scheduled Payments, soonest first. `limit` takes 1 to 100 " +
    "(25 by default); `after` is the cursor the previous page answered, and a cursor this list did not give is refused. " +
    "The old list read every Payment the Account ever touched into one page (old M14); this one reads one page from the " +
    "index. It writes nothing.",
  concept: concept_payments,
  kind: "query",
  who: WHO,
  input: Schema.Struct({ org: Null(S), scheduled: Schema.Boolean, limit: Schema.Int, after: Null(S) }),
  output: Schema.Struct({ items: Schema.Array(PaymentView), next_cursor: Null(S) }),
  errors: [error_NOT_AUTHENTICATED, error_INVALID_INPUT, error_ROLE_PERMISSION_DENIED],
  reads: READS,
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("read"),
  was: [`${OLD}/reads/payments.ts:163`, "packages/protocol/src/payments/operations.ts:108", "apps/cli/src/runtime/paging.ts:42"],
});

export const rpc_payments_ledger_watch = defineRpc({
  id: "payments.ledger.watch",
  title: "Follow a Payment, or an approval's Payments, live",
  about:
    "A live read: the first frame is the Payment as it stands (or, for an `approval_` id, the approval's state and the " +
    "Payments it carries, empty for an approval that moves no money), and each later frame follows a " +
    "`payment_transitioned` or `approval_transitioned` of what it watches. It never sends anything. A first frame that " +
    "finds nothing the caller can read is refused `INVALID_INPUT`, never answered null. The follower closes it when " +
    "what it follows ends; nothing stays subscribed.",
  concept: concept_payments,
  kind: "live",
  who: WHO,
  input: Schema.Struct({ id: S, org: Null(S) }),
  output: Followed,
  errors: [error_NOT_AUTHENTICATED, error_INVALID_INPUT, error_ROLE_PERMISSION_DENIED],
  reads: [...READS, approvalsData.table_approvals],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("live-read"),
  was: ["packages/sdk/src/payments/methods.ts:28", "apps/cli/src/commands/payment/internal/voids.ts:38", "packages/backend/src/payments/records/reads.ts:39"],
});
