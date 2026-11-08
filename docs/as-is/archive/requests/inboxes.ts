// The as-is book of the old requests concept: the inboxes area (the payer's side: the requests addressed
// to them, the exact terms they confirm, and their decision).
//
// Every operation registered at `requests/inboxes:*` (packages/backend/convex/requests/inboxes.ts): the
// seven public rows of `inboxes` (packages/protocol/src/requests/inbox-operations.ts:56). None is
// internal, scheduled or cron-driven. The current reads fold in the checkouts area's state actions,
// as receivables' do.

import { Schema } from "effect";
import { defineRpc, type Kind, type Ref } from "../../../packages/book/src/index.ts";

import { concept_requests } from "../shared/foundation.ts";
import {
  error_ENV_MISSING,
  error_INVALID_INPUT,
  error_NOT_AUTHENTICATED,
  error_NOT_IMPLEMENTED,
  error_PROVIDER_ERROR,
  error_ROLE_PERMISSION_DENIED,
  error_UNKNOWN,
  error_WRONG_STATE,
} from "../shared/vocabulary.ts";
import { machine_payment_request, table_invoice_checkout_payments, table_payment_requests } from "./data.ts";
import { procedure_requests_invoice_attempt_in_tx } from "./procedures.ts";
import {
  rpc_requests_checkouts_final_links,
  rpc_requests_checkouts_invoice_state,
  rpc_requests_checkouts_request_state,
} from "./checkouts.ts";
import { RequestView } from "./receivables.ts";
import { table_money_executions, table_payment_commands, table_payments } from "../payments/data.ts";
import {
  procedure_payments_prepare_payment_command_in_tx,
  procedure_payments_read_request_payment_in_tx,
  procedure_payments_replay_request_payment_approval_in_tx,
} from "../payments/procedures.ts";
import { procedure_access_actor_from_session } from "../access/procedures.ts";
import { procedure_accounts_require_payment_account_in_tx } from "../accounts/procedures.ts";
import {
  procedure_organizations_read_organization_party_id_in_tx,
  procedure_organizations_require_issue_invoices_in_tx,
} from "../organizations/procedures.ts";
import { procedure_profiles_read_profile_party_id_in_tx } from "../profiles/procedures.ts";

const BACKEND = "packages/backend";
const CONVEX = `${BACKEND}/convex/requests/inboxes.ts`;
const R = `${BACKEND}/src/requests`;
const AREA = `${R}/inboxes`;
const OPS = `${AREA}/operations`;
const ROWS = "packages/protocol/src/requests/inbox-operations.ts";

const S = Schema.String;
const U = Schema.Unknown;
const opt = Schema.optionalKey;

/** Keep each link once, in first-seen order. */
const union = <K extends Kind>(...lists: ReadonlyArray<ReadonlyArray<Ref<K>>>): Ref<K>[] => {
  const seen = new Set<string>();
  const out: Ref<K>[] = [];
  for (const list of lists)
    for (const item of list) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      out.push(item);
    }
  return out;
};

// ── shapes ─────────────────────────────────────────────────────────────────────────────────

/** `RequestActorSchema` (request-schema.ts:16). */
const Actor = opt(Schema.Union([Schema.Struct({ kind: Schema.Literal("account") }), Schema.Struct({ kind: Schema.Literal("org"), orgId: S })]));
const OneRequest = Schema.Struct({ actor: Actor, paymentRequestId: S });
/** `InboxPage` (inbox-operations.ts:20): `cursor` is the page before's `nextCursor`; `limit` 1 to 100, 50 by default. */
const InboxPage = Schema.Struct({ actor: Actor, cursor: opt(S), limit: opt(Schema.Number) });
const RequestPage = Schema.Struct({ items: Schema.Array(RequestView), nextCursor: Schema.NullOr(S) });

/** `RequestPaymentTermsSchema` (payments/schema/requests.ts:40). */
const PaymentTerms = Schema.Struct({
  requestId: S,
  release: Schema.Struct({ kind: Schema.Literal("instant") }),
  issuerSafe: S,
  amount: Schema.Struct({ asset: S, value: S }),
  /** `DocumentRefV3Schema`; too deep to transcribe. */
  instruction: U,
});

// ── errors ─────────────────────────────────────────────────────────────────────────────────

/** `CALL`, `DEFECTS` and `MEMBER` (operation-errors.ts:5, :11; operation.ts:54). */
const ROW_ERRORS = [error_NOT_AUTHENTICATED, error_INVALID_INPUT, error_UNKNOWN, error_ENV_MISSING, error_ROLE_PERMISSION_DENIED];
const CURRENT_ERRORS = [...ROW_ERRORS, error_WRONG_STATE, error_PROVIDER_ERROR];

// ── shared touches ─────────────────────────────────────────────────────────────────────────

const READER = { invokes: [procedure_access_actor_from_session], was: [`${R}/guards.ts:19`] };

/** `partyIdForActor` (reads/requests.ts:50): the reader's Party, which a request addresses as its payer. */
const PARTY_OF_ACTOR = [procedure_organizations_read_organization_party_id_in_tx, procedure_profiles_read_profile_party_id_in_tx];

/** `requestViews` (views.ts:93), as receivables reads it. */
const VIEW = {
  reads: [table_payment_requests, table_payments, table_payment_commands, table_invoice_checkout_payments],
  invokes: [procedure_payments_read_request_payment_in_tx],
  was: [`${R}/views.ts:33`, `${R}/views.ts:93`, `${R}/reads/instructions.ts:21`, `${R}/rules/lifecycle.ts:64`],
};

/** `refreshCheckouts` (external/currents.ts:32): final links, then each other link's state action. */
const REFRESH = {
  reads: union(rpc_requests_checkouts_final_links.reads, rpc_requests_checkouts_invoice_state.reads, rpc_requests_checkouts_request_state.reads),
  writes: union(rpc_requests_checkouts_invoice_state.writes, rpc_requests_checkouts_request_state.writes),
  drives: union(rpc_requests_checkouts_invoice_state.drives, rpc_requests_checkouts_request_state.drives),
  invokes: union(rpc_requests_checkouts_invoice_state.invokes, rpc_requests_checkouts_request_state.invokes),
  calls: union(rpc_requests_checkouts_invoice_state.calls, rpc_requests_checkouts_request_state.calls),
  was: [`${R}/external/currents.ts:20`, `${R}/external/currents.ts:32`, `${R}/errors/checkouts.ts:62`, `${BACKEND}/src/platform/read-as.ts:27`],
};

const CURRENT_ABOUT =
  "Signed in (`signedInAction`). Reads its query row as the caller (`readAs`), checks each asset request with an Invoice or " +
  "Memo instruction whose receipt is not final on chain, one at a time, through requests.checkouts.invoice-state or " +
  "request-state (which record what they prove), and reads again. A check that answers null or unavailable fails the read " +
  "WRONG_STATE `verification_unavailable` named by this row.";

// ── reads ──────────────────────────────────────────────────────────────────────────────────

export const rpc_requests_inboxes_list = defineRpc({
  id: "requests.inboxes.list",
  title: "One page of the requests addressed to this scope",
  about:
    "Row `requests.inboxes.list`, registered as `requests/inboxes:list`. Reader guard. The scope's Party (none: an empty page), " +
    "then one page of the requests naming it as payer, newest first, `limit` rows (50 by default) read by index however long " +
    "the history; a bad cursor is INVALID_INPUT. Each as its view; cancelled and declined ones are dropped from the page " +
    "afterwards, so a page can come back short or empty with a cursor still to follow.",
  was: [`${CONVEX}:7`, `${OPS}/list.ts:11`, `${OPS}/list.ts:18`, `${ROWS}:28`, `${AREA}/reads.ts:21`, `${R}/reads/requests.ts:115`, ...READER.was, ...VIEW.was],
  concept: concept_requests,
  kind: "query",
  who: "A signed-in person for their own Account, or for an Organization they currently take part in, as the payer.",
  input: InboxPage,
  output: RequestPage,
  errors: ROW_ERRORS,
  reads: VIEW.reads,
  writes: [],
  drives: [],
  invokes: union(READER.invokes, PARTY_OF_ACTOR, VIEW.invokes),
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_requests_inboxes_get = defineRpc({
  id: "requests.inboxes.get",
  title: "One request addressed to this scope",
  about:
    "Row `requests.inboxes.get`, registered as `requests/inboxes:get`. Reader guard. The request when its payer Party is the " +
    "scope's, as its view; null for any other, and for one that reads cancelled or declined.",
  was: [`${CONVEX}:5`, `${OPS}/get.ts:11`, `${OPS}/get.ts:20`, `${ROWS}:42`, `${AREA}/reads.ts:30`, `${R}/reads/requests.ts:59`, ...READER.was, ...VIEW.was],
  concept: concept_requests,
  kind: "query",
  who: "A signed-in person for their own Account, or for an Organization they currently take part in, as the payer.",
  input: OneRequest,
  output: Schema.NullOr(RequestView),
  errors: ROW_ERRORS,
  reads: VIEW.reads,
  writes: [],
  drives: [],
  invokes: union(READER.invokes, PARTY_OF_ACTOR, VIEW.invokes),
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_requests_inboxes_list_current = defineRpc({
  id: "requests.inboxes.list-current",
  title: "One Inbox page, after checking each checkout on chain",
  about: `Row \`requests.inboxes.listCurrent\`, registered as \`requests/inboxes:listCurrent\`: \`list\`, current. ${CURRENT_ABOUT}`,
  was: [`${CONVEX}:8`, `${OPS}/list-current.ts:10`, `${ROWS}:35`, ...REFRESH.was],
  concept: concept_requests,
  kind: "action",
  who: "A signed-in person for their own Account, or for an Organization they currently take part in, as the payer.",
  input: InboxPage,
  output: RequestPage,
  errors: CURRENT_ERRORS,
  reads: union(rpc_requests_inboxes_list.reads, REFRESH.reads),
  writes: REFRESH.writes,
  drives: REFRESH.drives,
  invokes: union(rpc_requests_inboxes_list.invokes, REFRESH.invokes),
  emits: [],
  calls: REFRESH.calls,
  chain: [],
  spans: [],
});

export const rpc_requests_inboxes_get_current = defineRpc({
  id: "requests.inboxes.get-current",
  title: "One addressed request, after checking its checkout on chain",
  about: `Row \`requests.inboxes.getCurrent\`, registered as \`requests/inboxes:getCurrent\`: \`get\`, current; null when \`get\` is. ${CURRENT_ABOUT}`,
  was: [`${CONVEX}:6`, `${OPS}/get-current.ts:10`, `${ROWS}:49`, ...REFRESH.was],
  concept: concept_requests,
  kind: "action",
  who: "A signed-in person for their own Account, or for an Organization they currently take part in, as the payer.",
  input: OneRequest,
  output: Schema.NullOr(RequestView),
  errors: CURRENT_ERRORS,
  reads: union(rpc_requests_inboxes_get.reads, REFRESH.reads),
  writes: REFRESH.writes,
  drives: REFRESH.drives,
  invokes: union(rpc_requests_inboxes_get.invokes, REFRESH.invokes),
  emits: [],
  calls: REFRESH.calls,
  chain: [],
  spans: [],
});

export const rpc_requests_inboxes_payment_terms = defineRpc({
  id: "requests.inboxes.payment-terms",
  title: "The exact terms the addressed payer confirms",
  about:
    "Row `requests.inboxes.paymentTerms`, registered as `requests/inboxes:paymentTerms`. Reader guard. The request addressed " +
    "to the scope's Party (INVALID_INPUT `payment request not found` otherwise); for an Account its payment Account (not " +
    "ready is INVALID_INPUT). The terms: request id, instant release, issuer Safe, amount and the frozen instruction (its Memo " +
    "snapshot, else its Invoice, only for the Invoice's named debtor: INVALID_INPUT otherwise). A request with neither " +
    "predates frozen issuance and is INVALID_INPUT `request has no frozen instruction`; a Money request is INVALID_INPUT " +
    "`Pay this Invoice by bank transfer.`; a broken stored document is UNKNOWN. Creates nothing.",
  was: [`${CONVEX}:9`, `${OPS}/payment-terms.ts:10`, `${ROWS}:56`, `${AREA}/reads.ts:40`, `${R}/reads/instructions.ts:57`, `${R}/reads/instructions.ts:73`, `${R}/reads/instructions.ts:127`, ...READER.was],
  concept: concept_requests,
  kind: "query",
  who: "A signed-in person for their own Account, or for an Organization they currently take part in, as the named payer.",
  input: OneRequest,
  output: PaymentTerms,
  errors: ROW_ERRORS,
  reads: [table_payment_requests],
  writes: [],
  drives: [],
  invokes: union(READER.invokes, PARTY_OF_ACTOR, [procedure_accounts_require_payment_account_in_tx]),
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

// ── decisions ──────────────────────────────────────────────────────────────────────────────

export const rpc_requests_inboxes_approve = defineRpc({
  id: "requests.inboxes.approve",
  title: "Approve: prepare the Payment that pays the request, or replay it",
  about:
    "Row `requests.inboxes.approve`, registered as `requests/inboxes:approve`. Refuses NOT_IMPLEMENTED before reading anything " +
    "while the payment writer is disabled. Reader guard only: no Seat authority is checked here; for an Organization, Payments " +
    "proves the Permission that may pay. A `timing` other than instant is INVALID_INPUT `the inbox approves a payment sent " +
    "now`. The request must exist and, when it names a payer, be addressed to the scope (INVALID_INPUT); an unaddressed link " +
    "may be approved by anyone. Then `prepareApprovedRequest`: no stream release, an asset request, an Invoice only for its " +
    "named debtor with its attempt key (`invoiceAttemptInTx`), a replay of the earlier Payment when pending_settlement or paid " +
    "(payments' `replayRequestPaymentApprovalInTx`), else assertTransition collect (WRONG_STATE) and a new `payment_request` " +
    "birth through payments' own `preparePaymentCommandInTx` (a Memo request's frozen Memo, else a memo of reference and " +
    "note), patching the request pending_settlement. A first approval schedules `invoice_request_transitioned` " +
    "(`approval_prepared`, naming the Organization only when Payments proved its authority). Answers the prepared command; " +
    "preparation, not settlement.",
  was: [
    `${CONVEX}:3`,
    `${OPS}/approve.ts:10`,
    `${OPS}/approve.ts:12`,
    `${OPS}/approve.ts:24`,
    `${ROWS}:63`,
    `${AREA}/writes.ts:21`,
    `${AREA}/writes.ts:26`,
    `${AREA}/writes.ts:44`,
    `${AREA}/writes.ts:55`,
    `${R}/writes/requests.ts:206`,
    `${R}/writes/approvals.ts:57`,
    `${R}/writes/approvals.ts:129`,
    `${R}/errors/requests.ts:115`,
    `${R}/reads/attempts.ts:62`,
    ...READER.was,
  ],
  concept: concept_requests,
  kind: "mutation",
  who: "A signed-in person for their own Account or an Organization they take part in, as the named payer or any holder of an unaddressed link.",
  input: Schema.Struct({
    actor: Actor,
    paymentRequestId: S,
    requestKey: opt(S),
    /** `PaymentTiming`: instant, or scheduled at a time (refused here). */
    timing: opt(U),
    permissionId: opt(S),
  }),
  /** `PreparedPaymentCommandSchema`; too deep to transcribe. */
  output: U,
  errors: [...ROW_ERRORS, error_WRONG_STATE, error_NOT_IMPLEMENTED],
  reads: union(VIEW.reads, [table_money_executions]),
  writes: [table_payment_requests],
  drives: [machine_payment_request.t.to_pending_settlement],
  invokes: union(READER.invokes, PARTY_OF_ACTOR, [
    procedure_accounts_require_payment_account_in_tx,
    procedure_requests_invoice_attempt_in_tx,
    procedure_payments_replay_request_payment_approval_in_tx,
    procedure_payments_prepare_payment_command_in_tx,
  ]),
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_requests_inboxes_decline = defineRpc({
  id: "requests.inboxes.decline",
  title: "Turn a request down",
  about:
    "Row `requests.inboxes.decline`, registered as `requests/inboxes:decline`. Reader guard. The request must exist and be " +
    "addressed to the scope when it names a payer or when an Organization declines (INVALID_INPUT `payment request not " +
    "found`); then, for an Organization, a Seat that holds issue invoices (ROLE_PERMISSION_DENIED); then assertTransition " +
    "decline on the current status, unexpired (WRONG_STATE). Patched declined; schedules `invoice_request_transitioned` " +
    "(`declined`). Creates no Payment.",
  was: [
    `${CONVEX}:4`,
    `${OPS}/decline.ts:11`,
    `${OPS}/decline.ts:17`,
    `${ROWS}:76`,
    `${AREA}/writes.ts:82`,
    `${R}/writes/requests.ts:206`,
    `${R}/writes/requests.ts:219`,
    `${R}/guards.ts:33`,
    ...READER.was,
    ...VIEW.was,
  ],
  concept: concept_requests,
  kind: "mutation",
  who: "The named payer: a signed-in person for their own Account, or an Organization Seat that holds issue invoices.",
  input: OneRequest,
  output: RequestView,
  errors: [...ROW_ERRORS, error_WRONG_STATE],
  reads: VIEW.reads,
  writes: [table_payment_requests],
  drives: [machine_payment_request.t.to_declined],
  invokes: union(READER.invokes, PARTY_OF_ACTOR, [procedure_organizations_require_issue_invoices_in_tx], VIEW.invokes),
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});
