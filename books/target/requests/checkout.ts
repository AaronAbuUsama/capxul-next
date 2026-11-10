// Requests' checkout area: the link checkout, for a payer outside Capxul, served to the checkout
// page with no session. A link names a request (`/pay/<request id>`) or a service
// (`/buy/<service id>`). The payer names their email: a payer on Capxul finds the request in their
// inbox; a payer outside Capxul gets the invoice escrow to fund from any wallet, which the request's
// process pays out once it holds the amount (decision requests.one-checkout-path).

import { Schema } from "effect";
import { budget, defineRpc } from "../../../packages/book/src/index.ts";
import { concept_requests } from "../shared/foundation.ts";
import { error_INVALID_INPUT, error_RATE_LIMITED, error_WRONG_STATE } from "../shared/vocabulary.ts";
import { machine_request, table_requests,  } from "./data.ts";
import { Amount } from "./shapes.ts";
import { procedure_documents_store } from "../documents/procedures.ts";
import { table_parties } from "../parties/data.ts";

const R = "packages/backend/src/requests/checkouts";
const ASIS = "docs/as-is/archive/requests/checkouts.ts";

const S = Schema.String;
const N = Schema.Number;
const NullOr = Schema.NullOr;

/** What anyone holding a link sees: never the note, the payer's mailbox or the document's content. */
const LinkTerms = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("request"),
    requestId: S,
    issuerLabel: S,
    reference: S,
    amount: Amount,
    status: Schema.Literals(["open", "paying", "paid", "declined", "cancelled", "expired"]),
    dueAt: NullOr(N),
    /** Named once a payer is known: the escrow to fund, or `inbox` for a payer on Capxul. */
    payTo: NullOr(Schema.Union([Schema.Struct({ escrow: S, receivedRaw: S }), Schema.Literal("inbox")])),
  }),
  Schema.Struct({
    kind: Schema.Literal("service"),
    offerId: S,
    revision: N,
    issuerLabel: S,
    title: S,
    description: NullOr(S),
    unitLabel: S,
    unitAmount: Amount,
    quantity: Schema.Struct({ min: N, max: N }),
  }),
]);

export const rpc_requests_checkout_get = defineRpc({
  id: "requests.checkout.get",
  title: "A link's public terms",
  about:
    "What the checkout page shows for a link, with no session: a request's issuer, reference, amount, status, due date " +
    "and, once its payer is known, where to pay (its escrow and what the request's process last read it to hold, or the " +
    "payer's inbox); or an active service's current revision. Null for an unknown link or an inactive service; a " +
    "malformed link is INVALID_INPUT. It writes nothing and calls nothing.",
  was: [`${R}/operations/request.ts:10`, `${R}/operations/invoice.ts:9`, `${R}/operations/offer.ts:8`, `${ASIS}:576`, `${ASIS}:739`, `${ASIS}:934`],
  concept: concept_requests,
  kind: "query",
  who: "Anyone holding the link, with no sign-in.",
  input: Schema.Struct({ link: S }),
  output: NullOr(LinkTerms),
  errors: [error_INVALID_INPUT],
  reads: [table_requests, table_parties],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: ["rpc.requests.checkout.get"],
  budget: budget("read"),
});

export const rpc_requests_checkout_open = defineRpc({
  id: "requests.checkout.open",
  title: "Name the payer at a link: fix the escrow, or buy a service",
  about:
    "The payer at a link names their email (and for a service, how many). For a request that names no payer yet, it " +
    "binds the payer (`bind_payer`); for an active service, it births a purchase request (`issue`) for the current revision " +
    "at that quantity, owned by the service's owner. Either way the payer is resolved as `request issue` resolves it: an " +
    "active person Party is on Capxul (the request goes to their inbox), anyone else is outside (the escrow is computed " +
    "from the email Safe, as `predictAddress` and `predictPaymentId` would answer), and the document naming the payer is " +
    "stored through `documents.store` in the same transaction. The buyer's request key makes a repeat return the same " +
    "purchase. A request that already names a payer, is not open, or a service that is inactive or changed revision since " +
    "the page read it, is WRONG_STATE; a quantity out of range or a malformed email is INVALID_INPUT; more than 10 starts " +
    "for one email or 100 for one service in a minute is RATE_LIMITED (retry after 60 s). Nothing is written on chain.",
  was: [`${R}/operations/create.ts:8`, `${R}/operations/prepare-request.ts:10`, "packages/backend/src/requests/writes/purchases.ts:64", `${ASIS}:599`, `${ASIS}:764`],
  concept: concept_requests,
  kind: "mutation",
  who: "Anyone holding the link, with no sign-in: the payer names themselves by email.",
  input: Schema.Struct({ link: S, email: S, quantity: Schema.optionalKey(N), request_key: S }),
  output: Schema.Struct({
    requestId: S,
    amount: Amount,
    payTo: Schema.Union([Schema.Struct({ escrow: S }), Schema.Literal("inbox")]),
  }),
  errors: [error_INVALID_INPUT, error_WRONG_STATE, error_RATE_LIMITED],
  reads: [table_requests, table_parties],
  writes: [table_requests],
  drives: [machine_request.t.issue, machine_request.t.bind_payer],
  invokes: [procedure_documents_store],
  emits: [],
  calls: [],
  chain: [],
  spans: ["rpc.requests.checkout.open"],
  budget: budget("write"),
});
