// Requests' inbox area: the payer's side. The requests addressed to whoever you act as (your Safe,
// or the company Safe with `--org`), one of them, paying one, and declining one. Paying births the
// Payment through `payments.prepare-command` in the same transaction as the request's `pay`: the
// request and the Payment that pays it are one money fact (decision dependencies.payments-requests).

import { Schema } from "effect";
import { budget, defineRpc } from "../../../packages/book/src/index.ts";
import { concept_requests } from "../shared/foundation.ts";
import {
  error_INSUFFICIENT_BALANCE,
  error_INVALID_INPUT,
  error_NOT_AUTHENTICATED,
  error_PAYROLL_BUDGET_EXCEEDED,
  error_PROVIDER_ERROR,
  error_PROVIDER_RESPONSE_INVALID,
  error_ROLE_PERMISSION_DENIED,
  error_WRONG_STATE,
} from "../shared/vocabulary.ts";
import { contract_budgets, contract_erc20, integration_chain_rpc, integration_indexer } from "../shared/external.ts";
import { machine_request, table_requests } from "./data.ts";
import { Org, PageInput, RequestPage, RequestView } from "./shapes.ts";
import { GUARD_WAS, READER, WRITER } from "./guards.ts";
import { FRESHNESS } from "./issuing.ts";
import { procedure_payments_prepare_command } from "../payments/procedures.ts";
import { table_payments } from "../payments/data.ts";
import { table_chain_budgets } from "../indexing/data.ts";
import { table_budgets } from "../budgets/data.ts";

const R = "packages/backend/src/requests";
const ASIS = "docs/as-is/archive/requests/inboxes.ts";

const S = Schema.String;
const N = Schema.Number;
const opt = Schema.optionalKey;

const READ_ERRORS = [
  error_NOT_AUTHENTICATED,
  error_ROLE_PERMISSION_DENIED,
  error_INVALID_INPUT,
  error_WRONG_STATE,
  error_PROVIDER_ERROR,
  error_PROVIDER_RESPONSE_INVALID,
];

export const rpc_requests_inbox_list = defineRpc({
  id: "requests.inbox.list",
  title: "The requests addressed to whoever you act as",
  about:
    "One page of the requests whose payer is the reader's Safe (`by_payer_created`, across issuers: the payer is another " +
    "tenant than the issuer, and the generated row policy admits the addressed payer), newest first, each as its view with " +
    "its issuer. 25 by default, 1 to 100; an `after` that names no page is INVALID_INPUT and reads nothing. A person the " +
    `requests are not addressed to gets an empty page. ${FRESHNESS} It writes nothing.`,
  was: [`${R}/inboxes/operations/list.ts:11`, `${R}/reads/requests.ts:126`, `${ASIS}:126`, `${ASIS}:174`, ...GUARD_WAS],
  concept: concept_requests,
  kind: "query",
  who: "A signed-in person for their own inbox; with `org`, a current member of the Organization for its inbox.",
  input: Schema.Struct(PageInput),
  output: RequestPage,
  errors: READ_ERRORS,
  reads: [table_requests, table_payments, ...READER],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [integration_indexer.c.head],
  chain: [],
  spans: ["rpc.requests.inbox.list"],
  budget: budget("read"),
});

export const rpc_requests_inbox_get = defineRpc({
  id: "requests.inbox.get",
  title: "One request addressed to whoever you act as",
  about:
    "The request by id when its payer is the reader's Safe, as its view with its document lines; null for one in another " +
    "inbox or none, before anything else is read. A member reads the Organization's inbox and never the person's own. " +
    `${FRESHNESS} It writes nothing.`,
  was: [`${R}/inboxes/operations/get.ts:11`, `${ASIS}:151`, `${ASIS}:195`, ...GUARD_WAS],
  concept: concept_requests,
  kind: "query",
  who: "A signed-in person for their own inbox; with `org`, a current member of the Organization for its inbox.",
  input: Schema.Struct({ org: Org, request_id: S }),
  output: Schema.NullOr(RequestView),
  errors: READ_ERRORS,
  reads: [table_requests, table_payments, ...READER],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [integration_indexer.c.head],
  chain: [],
  spans: ["rpc.requests.inbox.get"],
  budget: budget("read"),
});

export const rpc_requests_inbox_pay = defineRpc({
  id: "requests.inbox.pay",
  title: "Pay a request from your inbox: birth its Payment and its approval",
  about:
    "The addressed payer pays exactly the amount and token the request fixed. Not in the reader's inbox: INVALID_INPUT, " +
    "which the CLI shows as CLI_USAGE. A request with an escrow is paid only into it (INVALID_INPUT, naming the escrow). " +
    "Not open: WRONG_STATE naming `inbox get`, unless it is paying under this payer's same `pay_key` or `resume`, which " +
    "returns the live attempt (and for a lapsed Payment asks `payments.prepare-command`, under the same key with " +
    "`resume`, for one new approval of the same payment id). A fresh key never starts a second attempt while one is " +
    "live, and the request's terms are its own frozen ones, never the caller's, so no lineage can be dropped. A date " +
    "(`pay_at`) under an hour ahead is INVALID_INPUT before anything is born. Before its transaction it reads the " +
    "funding from the chain: the person's Safe's token balance, or for an Organization the budget `from` names by its " +
    "key (`operations`; budgets' table gives its chain id, and a chain id is taken as it is), from indexing's chain " +
    "budgets, whose office hat, or one above it, the member's Safe wears (else ROLE_PERMISSION_DENIED), and its " +
    "`Budgets.leftOf`. Then, in one transaction: `payments.prepare-command` (purpose request, route personal or budget, " +
    "one item to the issuer's Safe, kind 1, the request's document, `pay_at`, and for an Organization's request its " +
    "`payee_against`: the request's income account, party Customer at the payer's Party and the head's Sales Invoice " +
    "as the reference, requests.income-meaning) births the Payment and its approval, " +
    "refusing short funding (INSUFFICIENT_BALANCE, or PAYROLL_BUDGET_EXCEEDED for a budget), and the request moves " +
    "through `pay` with the Payment and its v4 payment id. It answers `awaiting_approval` with the approval, its deadline " +
    "as the door answered it, and the `payment wait` command; nothing is signed or sent here.",
  was: [`${R}/inboxes/operations/approve.ts:10`, `${R}/writes/approvals.ts:57`, `${R}/writes/approvals.ts:129`, `${ASIS}:245`, ...GUARD_WAS],
  concept: concept_requests,
  kind: "action",
  who: "The addressed payer: a signed-in person for their own inbox; with `org`, a member whose Safe wears the hat of the budget it pays from, or of one above it.",
  input: Schema.Struct({
    org: Org,
    request_id: S,
    /** The payer's request key: the same key resumes the live attempt. */
    pay_key: S,
    /** The budget an Organization pays from (replaces `--permission-id`). */
    from: opt(S),
    /** Pay later (`--on`, `--at`): at least an hour ahead. */
    pay_at: opt(N),
    resume: opt(Schema.Boolean),
  }),
  output: Schema.Struct({
    status: Schema.Literal("awaiting_approval"),
    approvalId: S,
    approvalUrl: S,
    paymentIds: Schema.Array(S),
    /** The approval's deadline as `payments.prepare-command` opened it; the paymaster may cut it when it sponsors. */
    expiresAt: Schema.NullOr(N),
    next: Schema.Struct({ argv: Schema.Array(S) }),
    request: RequestView,
  }),
  errors: [
    error_NOT_AUTHENTICATED,
    error_INVALID_INPUT,
    error_WRONG_STATE,
    error_ROLE_PERMISSION_DENIED,
    error_INSUFFICIENT_BALANCE,
    error_PAYROLL_BUDGET_EXCEEDED,
    error_PROVIDER_ERROR,
    error_PROVIDER_RESPONSE_INVALID,
  ],
  reads: [table_requests, table_payments, table_budgets, table_chain_budgets, ...WRITER],
  writes: [table_requests],
  drives: [machine_request.t.pay],
  invokes: [procedure_payments_prepare_command],
  emits: [],
  calls: [integration_chain_rpc.c.readContract],
  chain: [contract_erc20.f.balanceOf, contract_budgets.f.leftOf],
  spans: ["rpc.requests.inbox.pay"],
  budget: budget("chain-read"),
});

export const rpc_requests_inbox_decline = defineRpc({
  id: "requests.inbox.decline",
  title: "Decline a request addressed to whoever you act as",
  about:
    "The addressed payer turns a request down: not in the reader's inbox is INVALID_INPUT (the CLI's CLI_USAGE), checked " +
    "before anything else; for an Organization the member's Safe must wear its Invoicing hat (ROLE_PERMISSION_DENIED); the " +
    "request must be open and unexpired (WRONG_STATE: already decided). It moves through `decline`; a repeat finds it " +
    "declined and sends nothing more. A personal decline acts for the person only, whatever Organization issued it. No " +
    "Payment is born and nothing is signed. A declined Invoice for logged hours (`billed_logs`) clears their marks in " +
    "the same transaction, through projects' door with `unbill` (projects.bill-time).",
  was: [`${R}/inboxes/operations/decline.ts:11`, `${R}/writes/requests.ts:219`, `${ASIS}:306`, ...GUARD_WAS],
  concept: concept_requests,
  kind: "mutation",
  who: "The addressed payer: a signed-in person for their own inbox; with `org`, a member whose Safe wears the Organization's Invoicing hat.",
  input: Schema.Struct({ org: Org, request_id: S }),
  output: RequestView,
  errors: [error_NOT_AUTHENTICATED, error_INVALID_INPUT, error_ROLE_PERMISSION_DENIED, error_WRONG_STATE],
  reads: [table_requests, ...WRITER],
  writes: [table_requests],
  drives: [machine_request.t.decline],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: ["rpc.requests.inbox.decline"],
  budget: budget("write"),
});
