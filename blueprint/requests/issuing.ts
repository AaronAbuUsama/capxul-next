// Requests' issuing area: the issuer's side. Issue a request or an Invoice, list and read what you
// issued, and cancel one. Every rpc is one transaction (A3). The reads follow the chain only
// through the request's own state: its process records what the chain proved, so a read checks
// nothing on chain and writes nothing (decision requests.reads-write-nothing).

import { Schema } from "effect";
import { budget, defineRpc } from "../../packages/blueprint-engine/src/index.ts";
import { concept_requests } from "../shared/foundation.ts";
import {
  error_INVALID_INPUT,
  error_NOT_AUTHENTICATED,
  error_PROVIDER_ERROR,
  error_PROVIDER_RESPONSE_INVALID,
  error_ROLE_PERMISSION_DENIED,
  error_TOKEN_NOT_SUPPORTED,
  error_WRONG_STATE,
} from "../shared/vocabulary.ts";
import { integration_indexer } from "../shared/external.ts";
import { machine_request, table_requests } from "./data.ts";
import { Org, PageInput, RequestPage, RequestView } from "./shapes.ts";
import { GUARD_WAS, READER, WRITER } from "./guards.ts";
import { procedure_documents_store } from "../documents/procedures.ts";
import { table_payments } from "../payments/data.ts";
import { procedure_parties_resolve_recipient } from "../parties/procedures.ts";

const R = "packages/backend/src/requests";
const ASIS = "docs/as-is/archive/requests/receivables.ts";

const S = Schema.String;
const N = Schema.Number;
const opt = Schema.optionalKey;

/** What every current read declares: the guard, the cursor, the indexer's progress. */
const READ_ERRORS = [
  error_NOT_AUTHENTICATED,
  error_ROLE_PERMISSION_DENIED,
  error_INVALID_INPUT,
  error_WRONG_STATE,
  error_PROVIDER_ERROR,
  error_PROVIDER_RESPONSE_INVALID,
];

/** How fresh a read is: a request whose status follows the chain is stated only while Ponder keeps up. */
export const FRESHNESS =
  "When a request it returns follows the chain (an escrow, or a Payment in flight) it asks the indexer how far Ponder " +
  "has indexed (`indexer.head`): reindexing, or behind the chain head by more than the deployment's finality depth, is " +
  "WRONG_STATE `verification_unavailable`, never a stale or empty answer.";

export const rpc_requests_issuing_issue = defineRpc({
  id: "requests.issuing.issue",
  title: "Issue a request or an Invoice",
  about:
    "Asks a payer for an exact token amount. The guard: yourself, or with `org` the Invoicing hat. The request key makes it " +
    "idempotent: the same owner and key return the request it made, with nothing written again. It checks the reference " +
    "(1 to 120 characters), the note (up to 280), the expiry (in the future) and the asset (an admitted asset Payments moves " +
    "exactly, USDC by default; else TOKEN_NOT_SUPPORTED), then resolves the payer through parties' directory: an `@handle` " +
    "or a mailbox whose person Party is active is on Capxul (payer `capxul`, paid from its inbox); a mailbox with no active " +
    "Party is outside (payer `outside`): its email Safe is CompaniesHouseClaimer's pure `safeAddressFor`, and the request's " +
    "invoice escrow is computed as `EscrowFactory.predictAddress(terms, salt)` and `predictPaymentId` would answer (kind 1, " +
    "condition amount-reached, the email Safe as sender, the issuer's Safe as owner, the document's hash). No payer " +
    "is a link request with no escrow. An Invoice to a bare address, or to no payer, is INVALID_INPUT; so is any payer " +
    "given as a bare address. When the payer is known it stores the request's document through `documents.store` (the " +
    "issuer and the payer as its participants) and births the request through `issue`, in one transaction. With `org`, " +
    "`account` (an income account of the Organization's chart, by its id as `org books accounts list` shows it) and `sales_invoice` (the head's Sales " +
    "Invoice, when a connected head asks for the payment) are kept as the request's `income`, which its payment " +
    "carries to the books (requests.income-meaning); either on a person's request is INVALID_INPUT. Nothing is " +
    "written on chain and no mail is sent here: notices follow `request_transitioned`.",
  was: [`${R}/receivables/operations/issue.ts:12`, `${R}/writes/requests.ts:55`, `${R}/writes/escrows.ts:20`, `${ASIS}:211`, ...GUARD_WAS],
  concept: concept_requests,
  kind: "mutation",
  who: "A signed-in person for themselves; with `org`, a member whose Safe wears the Organization's Invoicing hat.",
  input: Schema.Struct({
    org: Org,
    request_key: S,
    /** An email or an `@handle`; absent for a link request. */
    payer: opt(S),
    asset: opt(S),
    amount: S,
    reference: S,
    note: opt(S),
    expires_at: opt(N),
    invoice: opt(
      Schema.Struct({
        due_at: opt(N),
        lines: opt(Schema.Array(Schema.Struct({ description: S, quantity: N, unit_amount: S }))),
      }),
    ),
    /** With `org`: the income account its payment posts to (`--account`), kept for the books (requests.income-meaning). */
    account: opt(S),
    /** With `org`: the connected head's Sales Invoice this request collects, by its head name. */
    sales_invoice: opt(S),
  }),
  output: Schema.Struct({
    scope: Schema.Literals(["person", "organization"]),
    direction: Schema.Literal("issued"),
    item: RequestView,
  }),
  errors: [error_NOT_AUTHENTICATED, error_INVALID_INPUT, error_ROLE_PERMISSION_DENIED, error_TOKEN_NOT_SUPPORTED],
  reads: [table_requests, ...WRITER],
  writes: [table_requests],
  drives: [machine_request.t.issue],
  invokes: [procedure_documents_store],
  emits: [],
  calls: [],
  chain: [],
  spans: ["rpc.requests.issuing.issue"],
  budget: budget("write"),
});

export const rpc_requests_issuing_list = defineRpc({
  id: "requests.issuing.list",
  title: "The requests you, or the Organization, issued",
  about:
    "One page of the requests this scope issued, newest first (`by_owner_created`), each as its view: its status, amount, " +
    "reference, documents, escrow and checkout link, and for a paid one its Payment as payments holds it with the " +
    "`payment get` and `payment wait` commands. 25 by default, 1 to 100; `after` must be a cursor this list gave, else " +
    `INVALID_INPUT. A person who issued nothing gets an empty page. ${FRESHNESS} It writes nothing.`,
  was: [`${R}/receivables/operations/list.ts:12`, `${R}/receivables/operations/list-current.ts:10`, `${ASIS}:272`, `${ASIS}:383`, ...GUARD_WAS],
  concept: concept_requests,
  kind: "query",
  who: "A signed-in person for themselves; with `org`, a current member of the Organization.",
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
  spans: ["rpc.requests.issuing.list"],
  budget: budget("read"),
});

export const rpc_requests_issuing_get = defineRpc({
  id: "requests.issuing.get",
  title: "One request you, or the Organization, issued",
  about:
    "The request when this scope issued it, as its view; null for a request this scope did not issue or that does not " +
    "exist, before anything else is read, so it reveals nothing. A member reads the Organization's request and never the " +
    `person's own. ${FRESHNESS} It writes nothing.`,
  was: [`${R}/receivables/operations/get.ts:11`, `${R}/receivables/operations/get-current.ts:10`, `${ASIS}:297`, `${ASIS}:404`, ...GUARD_WAS],
  concept: concept_requests,
  kind: "query",
  who: "A signed-in person who issued the request; with `org`, a current member of the Organization that issued it.",
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
  spans: ["rpc.requests.issuing.get"],
  budget: budget("read"),
});

export const rpc_requests_issuing_cancel = defineRpc({
  id: "requests.issuing.cancel",
  title: "Cancel a request you issued",
  about:
    "The issuer withdraws a request: the request this scope issued (INVALID_INPUT `request not found` otherwise, which the " +
    "CLI shows as CLI_USAGE), open or expired (WRONG_STATE when it is being paid, paid, declined or cancelled), moved " +
    "through `cancel`. It writes nothing on chain: the request's process, signalled by the transition, reads its escrow " +
    "once more, and an escrow that already holds the amount still pays out. It moves no money. An Invoice for logged " +
    "hours (`billed_logs`) clears their marks in the same transaction, through projects' door with `unbill` " +
    "(projects.bill-time), so the hours can be billed again.",
  was: [`${R}/receivables/operations/cancel.ts:11`, `${R}/writes/requests.ts:190`, `${ASIS}:344`, ...GUARD_WAS],
  concept: concept_requests,
  kind: "mutation",
  who: "The request's issuer; with `org`, a member whose Safe wears the Organization's Invoicing hat.",
  input: Schema.Struct({ org: Org, request_id: S }),
  output: RequestView,
  errors: [error_NOT_AUTHENTICATED, error_INVALID_INPUT, error_WRONG_STATE, error_ROLE_PERMISSION_DENIED],
  reads: [table_requests, ...WRITER],
  writes: [table_requests],
  drives: [machine_request.t.cancel],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: ["rpc.requests.issuing.cancel"],
  budget: budget("write"),
});

// ── billing logged hours (`org projects timesheet bill`; requests.bill-time) ─────────────────────────

