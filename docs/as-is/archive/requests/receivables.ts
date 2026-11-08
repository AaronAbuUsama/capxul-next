// The as-is book of the old requests concept: the receivables area (the issuer's side: what it sent,
// and its cancellation; and the notices an Invoice sends).
//
// Every operation registered at `requests/receivables:*` (packages/backend/convex/requests/receivables.ts).
// Eight are public rows of `receivables` (packages/protocol/src/requests/operations.ts:70); `emitIssued`
// and `emitTransitioned` are telemetry plumbing a committed write schedules; `noticeFacts` is the
// internal query the notice action runs; `notify` is scheduled by committed transitions to send an
// Invoice's emails, booked as a workflow.
//
// The current reads (`*Current`) are actions that read their query row as the caller (`readAs`), check
// each linked checkout on chain through the checkouts area's state actions, and read again. Their
// touches fold in those of the rpcs they run.

import { Schema } from "effect";
import { defineRpc, defineWorkflow, type Kind, type Ref } from "../../../packages/book/src/index.ts";

import { concept_requests } from "../shared/foundation.ts";
import {
  error_ENV_MISSING,
  error_INVALID_INPUT,
  error_NOT_AUTHENTICATED,
  error_PROVIDER_ERROR,
  error_ROLE_PERMISSION_DENIED,
  error_UNKNOWN,
  error_WRONG_STATE,
  event_invoice_issued,
  event_invoice_request_transitioned,
} from "../shared/vocabulary.ts";
import { contract_safe, integration_chain_rpc, integration_mail } from "../shared/external.ts";
import { machine_payment_request, table_invoice_checkout_payments, table_payment_requests } from "./data.ts";
import {
  rpc_requests_checkouts_final_links,
  rpc_requests_checkouts_invoice_state,
  rpc_requests_checkouts_request_state,
} from "./checkouts.ts";
import { table_payment_commands, table_payments } from "../payments/data.ts";
import { procedure_payments_read_request_payment_in_tx } from "../payments/procedures.ts";
import { procedure_access_actor_from_session, procedure_access_read_scope_safe_address_in_tx } from "../access/procedures.ts";
import { procedure_accounts_require_payment_account_in_tx } from "../accounts/procedures.ts";
import { table_accounts } from "../accounts/data.ts";
import { procedure_banking_require_receiving_account_for_invoice_in_tx } from "../banking/procedures.ts";
import {
  procedure_documents_persist_money_invoice_document,
  procedure_documents_persist_payment_document,
} from "../documents/procedures.ts";
import {
  procedure_organizations_read_contact_roster_in_tx,
  procedure_organizations_read_organization_name_in_tx,
  procedure_organizations_read_organization_party_id_in_tx,
  procedure_organizations_read_organization_safe_in_tx,
  procedure_organizations_require_issue_invoices_in_tx,
} from "../organizations/procedures.ts";
import { table_orgs } from "../organizations/data.ts";
import {
  procedure_parties_ensure_party_for,
  procedure_parties_party_by_id,
  procedure_parties_party_by_safe_address,
  procedure_parties_record_contact_edges,
  procedure_parties_resolve_recipient_in_tx,
} from "../parties/procedures.ts";
import { procedure_payroll_read_department_holder_emails_in_tx } from "../payroll/procedures.ts";
import { procedure_permissions_read_budget_holder_safes_in_tx } from "../permissions/procedures.ts";
import { procedure_profiles_read_profile_party_id_in_tx } from "../profiles/procedures.ts";
import { table_identities } from "../profiles/data.ts";

const BACKEND = "packages/backend";
const CONVEX = `${BACKEND}/convex/requests/receivables.ts`;
const R = `${BACKEND}/src/requests`;
const AREA = `${R}/receivables`;
const OPS = `${AREA}/operations`;
const ROWS = "packages/protocol/src/requests/operations.ts";

const S = Schema.String;
const N = Schema.Number;
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

const RequestParty = Schema.Struct({ kind: Schema.Literal("party"), partyId: S });

/** `RequestViewSchema` (request-schema.ts:22): a request as its issuer or addressed payer reads it. */
export const RequestView = Schema.Struct({
  id: S,
  status: Schema.Literals(["draft", "sent", "viewed", "pending_settlement", "scheduled", "paid", "declined", "cancelled", "expired"]),
  amount: Schema.Union([Schema.Struct({ asset: S, value: S }), Schema.Struct({ currency: S, value: S, decimals: N })]),
  receivingAccountId: opt(S),
  reference: S,
  memo: Schema.NullOr(S),
  linkToken: S,
  entitlementGranted: Schema.Boolean,
  settledPaymentId: Schema.NullOr(S),
  settledDepositRef: opt(S),
  /** `DocumentRefV3Schema` each; too deep to transcribe. */
  documents: Schema.Array(U),
  expiresAt: Schema.NullOr(N),
  dueAt: opt(N),
  createdAt: N,
  updatedAt: N,
  issuer: RequestParty,
  payer: opt(RequestParty),
  issuerSafe: opt(S),
  escrow: opt(Schema.Struct({ address: S, ownerSafe: S, receivedRaw: opt(S) })),
  /** The wire `Payment`; too deep to transcribe. */
  settledPayment: opt(U),
  settledPaymentStatus: opt(S),
  settledPaymentTiming: opt(U),
  addressedToViewer: opt(Schema.Boolean),
});

const RequestPage = Schema.Struct({ items: Schema.Array(RequestView), nextCursor: Schema.NullOr(S) });
const OneRequest = Schema.Struct({ actor: Actor, paymentRequestId: S });
const ByLink = Schema.Struct({ actor: Actor, linkToken: S });

/** `IssueRequestInputSchema` (request-schema.ts:79): an asset request with an optional Invoice, or a Money Invoice. */
const IssueInput = Schema.Union([
  Schema.Struct({
    actor: Actor,
    reference: S,
    /** `RecipientLocatorSchema`: a handle, email, address or Party; too deep to transcribe. */
    payer: opt(U),
    memo: opt(S),
    expiresAt: opt(N),
    amount: Schema.Struct({ asset: S, value: S }),
    /** `InvoiceDraftSchema`; too deep to transcribe. */
    invoice: opt(U),
  }),
  Schema.Struct({
    actor: Actor,
    reference: S,
    payer: opt(U),
    memo: opt(S),
    expiresAt: opt(N),
    amount: Schema.Struct({ currency: S, value: S, decimals: N }),
    invoice: U,
    receivingAccountId: S,
  }),
]);

// ── errors ─────────────────────────────────────────────────────────────────────────────────

/** `CALL`, `DEFECTS` and `MEMBER`/`ADMIN` (operation-errors.ts:5, :11, :14; operation.ts:54). */
const ROW_ERRORS = [error_NOT_AUTHENTICATED, error_INVALID_INPUT, error_UNKNOWN, error_ENV_MISSING, error_ROLE_PERMISSION_DENIED];
/** The current reads add STATE and CHAIN (operation-errors.ts:17, :20). */
const CURRENT_ERRORS = [...ROW_ERRORS, error_WRONG_STATE, error_PROVIDER_ERROR];

// ── shared touches ─────────────────────────────────────────────────────────────────────────

const READER = { invokes: [procedure_access_actor_from_session], was: [`${R}/guards.ts:19`] };
const WRITER = {
  invokes: [procedure_access_actor_from_session, procedure_organizations_require_issue_invoices_in_tx],
  was: [`${R}/guards.ts:33`, `${R}/guards.ts:44`],
};

/**
 * `requestViews` (views.ts:93): each row following its current Payment and receipt (`currentRequest`, reading
 * Payments' tables directly), the approved Payment through Payments' door, live expiry and the frozen documents.
 */
const VIEW = {
  reads: [table_payment_requests, table_payments, table_payment_commands, table_invoice_checkout_payments],
  invokes: [procedure_payments_read_request_payment_in_tx],
  was: [`${R}/views.ts:33`, `${R}/views.ts:42`, `${R}/views.ts:93`, `${R}/reads/instructions.ts:21`, `${R}/reads/invoices.ts:146`, `${R}/rules/lifecycle.ts:64`],
};

/** `partyIdForActor` (reads/requests.ts:50): whether a link is addressed to the reader. */
const PARTY_OF_ACTOR = [procedure_organizations_read_organization_party_id_in_tx, procedure_profiles_read_profile_party_id_in_tx];

/** `refreshCheckouts` (external/currents.ts:32): final links, then each other link's state action. */
const REFRESH = {
  reads: union(rpc_requests_checkouts_final_links.reads, rpc_requests_checkouts_invoice_state.reads, rpc_requests_checkouts_request_state.reads),
  writes: union(rpc_requests_checkouts_invoice_state.writes, rpc_requests_checkouts_request_state.writes),
  drives: union(rpc_requests_checkouts_invoice_state.drives, rpc_requests_checkouts_request_state.drives),
  invokes: union(rpc_requests_checkouts_invoice_state.invokes, rpc_requests_checkouts_request_state.invokes),
  calls: union(rpc_requests_checkouts_invoice_state.calls, rpc_requests_checkouts_request_state.calls),
  was: [
    `${R}/external/currents.ts:20`,
    `${R}/external/currents.ts:32`,
    `${R}/errors/checkouts.ts:62`,
    `${BACKEND}/src/platform/read-as.ts:27`,
    `${BACKEND}/src/platform/session.ts:24`,
  ],
};

const CURRENT_ABOUT =
  "Signed in (`signedInAction`). Reads its query row as the caller (`readAs`), then checks each asset request whose " +
  "instruction is an Invoice or Memo and whose receipt is not final on chain, one at a time, through " +
  "requests.checkouts.invoice-state or request-state (which record what they prove), and reads the row again. A check " +
  "that answers null or unavailable fails the read WRONG_STATE `verification_unavailable` named by this row. A bank " +
  "Invoice or one paid by deposit is not checked.";

// ── public rows ────────────────────────────────────────────────────────────────────────────

export const rpc_requests_receivables_issue = defineRpc({
  id: "requests.receivables.issue",
  title: "Ask a payer for money, or anyone holding the link",
  about:
    "Row `requests.receivables.issue`, registered as `requests/receivables:issue`. Writer guard. Normalizes the reference " +
    "(1 to 120 characters), memo (up to 280) and amount (an asset amount through Payments' amount rule, or a Money amount in " +
    "USD, EUR or GBP with exact cents), resolves a named payer (Parties) and ensures both Parties. Freezes the request's terms: " +
    "a Money Invoice (registered payer only, the issuer's owned bank receiving account through Banking, an envelope-v5 stored " +
    "through Documents); an asset Invoice (a registered payer Account or Organization read from Accounts', Organizations' and " +
    "Profiles' tables directly, or an email not on Capxul whose Safe funds an escrow; a bare address is INVALID_INPUT); a " +
    "named basic request's private Memo (on v4 with an escrow for an email payer); or nothing for an unaddressed link. Inserts " +
    "the request `sent` with `preq_` and `plink_` ids and the caller's linkage, and records contact edges (`invoiced`, " +
    "`invoicedBy`). An Invoice to an Organization or with an escrow schedules `requests.receivables.notify` `issued`. Schedules " +
    "`invoice_issued`. Unusable v4 settings are ENV_MISSING. No email is sent here.",
  was: [
    `${CONVEX}:13`,
    `${OPS}/issue.ts:12`,
    `${OPS}/issue.ts:18`,
    `${OPS}/issue.ts:24`,
    `${ROWS}:72`,
    `${AREA}/writes.ts:21`,
    `${AREA}/writes.ts:34`,
    `${R}/writes/requests.ts:55`,
    `${R}/writes/requests.ts:141`,
    `${R}/writes/requests.ts:176`,
    `${R}/writes/invoices.ts:41`,
    `${R}/writes/invoices.ts:75`,
    `${R}/writes/money-invoices.ts:20`,
    `${R}/writes/memos.ts:31`,
    `${R}/writes/escrows.ts:20`,
    `${R}/rules/lifecycle.ts:86`,
    `${R}/rules/lifecycle.ts:109`,
    `${R}/events.ts:87`,
    ...WRITER.was,
    ...VIEW.was,
  ],
  concept: concept_requests,
  kind: "mutation",
  who: "A signed-in person for their own Account, or for an Organization they hold a Seat with issue invoices in.",
  input: IssueInput,
  output: RequestView,
  errors: ROW_ERRORS,
  reads: union(VIEW.reads, [table_orgs, table_accounts, table_identities]),
  writes: [table_payment_requests],
  drives: [],
  invokes: union(WRITER.invokes, VIEW.invokes, [
    procedure_parties_resolve_recipient_in_tx,
    procedure_parties_ensure_party_for,
    procedure_parties_record_contact_edges,
    procedure_accounts_require_payment_account_in_tx,
    procedure_access_read_scope_safe_address_in_tx,
    procedure_documents_persist_payment_document,
    procedure_documents_persist_money_invoice_document,
    procedure_banking_require_receiving_account_for_invoice_in_tx,
  ]),
  emits: [event_invoice_issued],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_requests_receivables_list = defineRpc({
  id: "requests.receivables.list",
  title: "The requests this scope issued",
  about:
    "Row `requests.receivables.list`, registered as `requests/receivables:list`. Reader guard. An Organization's requests by " +
    "its issuer key; an Account's by its owner, keeping only rows whose issuer is that Account (rows written before requests " +
    "named their issuer included). Read whole, newest first, as one page with no cursor; each as its view (current status, " +
    "live expiry). A view that breaks its wire shape is UNKNOWN.",
  was: [`${CONVEX}:14`, `${OPS}/list.ts:12`, `${ROWS}:79`, `${AREA}/reads.ts:19`, `${R}/reads/requests.ts:92`, ...READER.was, ...VIEW.was],
  concept: concept_requests,
  kind: "query",
  who: "A signed-in person for their own Account, or for an Organization they currently take part in.",
  input: Schema.Struct({ actor: Actor }),
  output: RequestPage,
  errors: ROW_ERRORS,
  reads: VIEW.reads,
  writes: [],
  drives: [],
  invokes: union(READER.invokes, VIEW.invokes),
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_requests_receivables_get = defineRpc({
  id: "requests.receivables.get",
  title: "One request this scope issued",
  about:
    "Row `requests.receivables.get`, registered as `requests/receivables:get`. Reader guard. The request when this scope " +
    "issued it, as its view; null for any other or none.",
  was: [`${CONVEX}:9`, `${OPS}/get.ts:11`, `${ROWS}:86`, `${AREA}/reads.ts:26`, ...READER.was, ...VIEW.was],
  concept: concept_requests,
  kind: "query",
  who: "A signed-in person for their own Account, or for an Organization they currently take part in.",
  input: OneRequest,
  output: Schema.NullOr(RequestView),
  errors: ROW_ERRORS,
  reads: VIEW.reads,
  writes: [],
  drives: [],
  invokes: union(READER.invokes, VIEW.invokes),
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_requests_receivables_get_by_link = defineRpc({
  id: "requests.receivables.get-by-link",
  title: "The request behind a link, for its issuer or addressed payer",
  about:
    "Row `requests.receivables.getByLink`, registered as `requests/receivables:getByLink`. Reader guard. Resolves a protected " +
    "QR link: the request's view with `addressedToViewer` when this scope issued it or its Party is the named payer; null for " +
    "anyone else and for a malformed or unknown token.",
  was: [`${CONVEX}:10`, `${OPS}/get-by-link.ts:12`, `${ROWS}:93`, `${AREA}/reads.ts:34`, `${R}/reads/requests.ts:38`, `${R}/reads/requests.ts:59`, ...READER.was, ...VIEW.was],
  concept: concept_requests,
  kind: "query",
  who: "A signed-in person for their own Account or an Organization they take part in, as the request's issuer or named payer.",
  input: ByLink,
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

export const rpc_requests_receivables_cancel = defineRpc({
  id: "requests.receivables.cancel",
  title: "Withdraw a request nobody has approved",
  about:
    "Row `requests.receivables.cancel`, registered as `requests/receivables:cancel`. Writer guard. The request this scope " +
    "issued (INVALID_INPUT `payment request not found` otherwise), cancellable from draft, sent or viewed as `currentRequest` " +
    "reads it, whatever its expiry (WRONG_STATE otherwise): patched cancelled. Schedules `invoice_request_transitioned` " +
    "(`cancelled`, naming the Organization when it acted). Writes nothing on chain, so an escrow already holding the amount " +
    "still pays out (CAP-1212).",
  was: [
    `${CONVEX}:6`,
    `${OPS}/cancel.ts:11`,
    `${OPS}/cancel.ts:17`,
    `${ROWS}:100`,
    `${AREA}/writes.ts:40`,
    `${R}/reads/requests.ts:27`,
    `${R}/writes/requests.ts:190`,
    `${R}/rules/lifecycle.ts:74`,
    `${R}/events.ts:138`,
    `${R}/README.md:47`,
    ...WRITER.was,
    ...VIEW.was,
  ],
  concept: concept_requests,
  kind: "mutation",
  who: "The request's issuer: a signed-in person for their own Account, or an Organization Seat that holds issue invoices.",
  input: OneRequest,
  output: RequestView,
  errors: [...ROW_ERRORS, error_WRONG_STATE],
  reads: VIEW.reads,
  writes: [table_payment_requests],
  drives: [machine_payment_request.t.to_cancelled],
  invokes: union(WRITER.invokes, VIEW.invokes),
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_requests_receivables_list_current = defineRpc({
  id: "requests.receivables.list-current",
  title: "The requests this scope issued, after checking each checkout on chain",
  about: `Row \`requests.receivables.listCurrent\`, registered as \`requests/receivables:listCurrent\`: \`list\`, current. ${CURRENT_ABOUT}`,
  was: [`${CONVEX}:15`, `${OPS}/list-current.ts:10`, `${ROWS}:107`, ...REFRESH.was],
  concept: concept_requests,
  kind: "action",
  who: "A signed-in person for their own Account, or for an Organization they currently take part in.",
  input: Schema.Struct({ actor: Actor }),
  output: RequestPage,
  errors: CURRENT_ERRORS,
  reads: union(rpc_requests_receivables_list.reads, REFRESH.reads),
  writes: REFRESH.writes,
  drives: REFRESH.drives,
  invokes: union(rpc_requests_receivables_list.invokes, REFRESH.invokes),
  emits: [],
  calls: REFRESH.calls,
  chain: [],
  spans: [],
});

export const rpc_requests_receivables_get_current = defineRpc({
  id: "requests.receivables.get-current",
  title: "One issued request, after checking its checkout on chain",
  about: `Row \`requests.receivables.getCurrent\`, registered as \`requests/receivables:getCurrent\`: \`get\`, current; null when \`get\` is. ${CURRENT_ABOUT}`,
  was: [`${CONVEX}:12`, `${OPS}/get-current.ts:10`, `${ROWS}:114`, ...REFRESH.was],
  concept: concept_requests,
  kind: "action",
  who: "A signed-in person for their own Account, or for an Organization they currently take part in.",
  input: OneRequest,
  output: Schema.NullOr(RequestView),
  errors: CURRENT_ERRORS,
  reads: union(rpc_requests_receivables_get.reads, REFRESH.reads),
  writes: REFRESH.writes,
  drives: REFRESH.drives,
  invokes: union(rpc_requests_receivables_get.invokes, REFRESH.invokes),
  emits: [],
  calls: REFRESH.calls,
  chain: [],
  spans: [],
});

export const rpc_requests_receivables_get_by_link_current = defineRpc({
  id: "requests.receivables.get-by-link-current",
  title: "The request behind a link, after checking its checkout on chain",
  about: `Row \`requests.receivables.getByLinkCurrent\`, registered as \`requests/receivables:getByLinkCurrent\`: \`getByLink\`, current; null when \`getByLink\` is. ${CURRENT_ABOUT}`,
  was: [`${CONVEX}:11`, `${OPS}/get-by-link-current.ts:10`, `${ROWS}:121`, ...REFRESH.was],
  concept: concept_requests,
  kind: "action",
  who: "A signed-in person for their own Account or an Organization they take part in, as the request's issuer or named payer.",
  input: ByLink,
  output: Schema.NullOr(RequestView),
  errors: CURRENT_ERRORS,
  reads: union(rpc_requests_receivables_get_by_link.reads, REFRESH.reads),
  writes: REFRESH.writes,
  drives: REFRESH.drives,
  invokes: union(rpc_requests_receivables_get_by_link.invokes, REFRESH.invokes),
  emits: [],
  calls: REFRESH.calls,
  chain: [],
  spans: [],
});

// ── internal ───────────────────────────────────────────────────────────────────────────────

const EventFacts = {
  authUserId: S,
  requestId: S,
  occurredAt: N,
  organizationId: opt(S),
  observationContext: opt(U),
};
const ScopeKind = Schema.Literals(["account", "organization"]);

export const rpc_requests_receivables_emit_issued = defineRpc({
  id: "requests.receivables.emit-issued",
  title: "Deliver invoice_issued after a request commits",
  about:
    "Telemetry plumbing: registered as the internal action `requests/receivables:emitIssued`; its handler is " +
    "`issuedDelivered` (events.ts:188). requests.receivables.issue schedules it through `scheduleTelemetryEmit` with the " +
    "committed snapshot, so the issue never waits on it. It marks the person signed in and the Organization the issue " +
    "verified, drops unverified client hints, and posts `invoice_issued` (request id, issuer scope, payer Party, time) to " +
    "PostHog, awaited, continuing the caller's trace. Reads and writes no table; the event reports a row exists, never that " +
    "mail left. The PostHog post has no integration record in this book.",
  was: [`${CONVEX}:7`, `${OPS}/emit-issued.ts:12`, `${R}/events.ts:87`, `${R}/events.ts:161`, `${R}/events.ts:181`, `${R}/events.ts:188`],
  concept: concept_requests,
  kind: "action",
  who: "internal: scheduled by requests.receivables.issue (`requestIssued`, events.ts:87) from the mutation that issued it.",
  input: Schema.Struct({ ...EventFacts, issuerScopeKind: ScopeKind, issuerScopeId: S, payerPartyId: opt(S) }),
  output: Schema.Void,
  errors: [error_UNKNOWN],
  reads: [],
  writes: [],
  drives: [],
  invokes: [],
  emits: [event_invoice_issued],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_requests_receivables_emit_transitioned = defineRpc({
  id: "requests.receivables.emit-transitioned",
  title: "Deliver invoice_request_transitioned after a decision commits",
  about:
    "Telemetry plumbing: registered as the internal action `requests/receivables:emitTransitioned`; its handler is " +
    "`transitionedDelivered` (events.ts:201). Scheduled by `scheduleTransitioned` from the mutation that made one guarded " +
    "decision: an approval's first preparation (`approval_prepared`, from requests.inboxes.approve or Payments' " +
    "confirmed-request prepare), a decline or a cancel. Posts `invoice_request_transitioned` (request id, transition, the " +
    "acting scope, time), attributed to the person and the Organization the mutation verified. Reads and writes no table.",
  was: [`${CONVEX}:8`, `${OPS}/emit-transitioned.ts:12`, `${R}/events.ts:108`, `${R}/events.ts:138`, `${R}/events.ts:201`],
  concept: concept_requests,
  kind: "action",
  who: "internal: scheduled by `scheduleTransitioned` (events.ts:108) from the approve, decline, cancel or confirmed-request mutation.",
  input: Schema.Struct({
    ...EventFacts,
    transition: Schema.Literals(["approval_prepared", "declined", "cancelled"]),
    actorScopeKind: ScopeKind,
    actorScopeId: S,
  }),
  output: Schema.Void,
  errors: [error_UNKNOWN],
  reads: [],
  writes: [],
  drives: [],
  invokes: [],
  emits: [event_invoice_request_transitioned],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_requests_receivables_notice_facts = defineRpc({
  id: "requests.receivables.notice-facts",
  title: "What one Invoice's notices are built from",
  about:
    "The internal query `requests/receivables:noticeFacts`: null when the request is gone or carries no Invoice. Otherwise " +
    "whether it is paid now (`currentRequest`) and still open, its number (from the frozen Invoice; null when unreadable), " +
    "amount and symbol, the payee (an Organization's name and its current Seats' mailboxes, or the issuing person's Party) and " +
    "the payer: a payer Organization's name, Safe and the people who can pay it (the given Directors' mailboxes by Safe, " +
    "active allowance holders' Safes from Permissions and department holders' emails from Payroll), or a customer not on " +
    "Capxul with the escrow address and network.",
  was: [
    `${CONVEX}:16`,
    `${OPS}/notice-facts.ts:12`,
    `${AREA}/reads/notices.ts:33`,
    `${AREA}/reads/notices.ts:60`,
    `${AREA}/reads/notices.ts:90`,
    `${AREA}/reads/notices.ts:104`,
    `${AREA}/reads/notices.ts:146`,
    `${R}/reads/instructions.ts:21`,
  ],
  concept: concept_requests,
  kind: "query",
  who: "internal: run by requests.receivables.notify, once plain and once with the payer Safe's Directors.",
  input: Schema.Struct({ requestId: S, owners: opt(Schema.Array(S)) }),
  output: Schema.NullOr(U),
  errors: [error_UNKNOWN],
  reads: [table_payment_requests, table_payments, table_payment_commands, table_invoice_checkout_payments],
  writes: [],
  drives: [],
  invokes: [
    procedure_parties_party_by_id,
    procedure_parties_party_by_safe_address,
    procedure_organizations_read_organization_name_in_tx,
    procedure_organizations_read_organization_safe_in_tx,
    procedure_organizations_read_contact_roster_in_tx,
    procedure_permissions_read_budget_holder_safes_in_tx,
    procedure_payroll_read_department_holder_emails_in_tx,
  ],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

// ── workflow: an Invoice's notices ─────────────────────────────────────────────────────────

export const workflow_requests_receivables_notify = defineWorkflow({
  id: "requests.receivables.notify",
  title: "Send the emails one Invoice's committed transition calls for",
  about:
    "Registered as the internal action `requests/receivables:notify` (G5), attributed to the system job `request_notices`. " +
    "Scheduled at once (`runAfter(0)`) by `scheduleRequestNoticeInTx` in the transaction it reports: requests.receivables.issue " +
    "(`issued`: an Invoice to an Organization or with an escrow), requests.checkouts.record-escrow (`part_received`, `paid`), " +
    "Banking's deposit match (`paid`) and Payments' settlement through `scheduleRequestPaidNoticeInTx` (`paid`). The schema " +
    "has no trigger for several callers: the trigger names the first. Reads the notice facts; for `issued` also the payer " +
    "Organization Safe's Directors on chain now, then the facts again with them. Plans the notices (pure): issued to a payer " +
    "Organization's paying people (`invoice-received`) or the escrow customer (`invoice-to-pay`); a part payment below the " +
    "amount to an open escrow's customer; paid to the payee (`invoice-paid`) and to an escrow customer (`invoice-receipt`). " +
    "Delivers through mail with a notice key per request, event and received amount; recipients the provider did not take " +
    "are retried by rescheduling this action for them only (one minute, then four, three attempts in all). A chain read that " +
    "fails fails the run. Returns `{ sent, failed }`. Timeout is Convex's action limit; the code sets none.",
  was: [
    `${CONVEX}:17`,
    `${OPS}/notify.ts:22`,
    `${OPS}/notify.ts:32`,
    `${OPS}/notify.ts:36`,
    `${AREA}/external.ts:19`,
    `${AREA}/external.ts:41`,
    `${AREA}/rules.ts:44`,
    `${AREA}/rules.ts:74`,
    `${AREA}/writes.ts:34`,
    `${R}/writes/notices.ts:29`,
    `${R}/writes/notices.ts:48`,
    `${R}/writes/escrows.ts:81`,
    `${R}/writes/deposits.ts:118`,
    `${BACKEND}/src/integrations/mail/notices.ts:17`,
    `${BACKEND}/src/integrations/mail/notices.ts:20`,
    `${BACKEND}/src/platform/schedule.ts:29`,
  ],
  concept: concept_requests,
  priority: "normal",
  trigger: { after: rpc_requests_receivables_issue },
  steps: [
    { name: "attribute", about: "Records the run as the system job `request_notices`." },
    { name: "facts", about: "Runs `requests.receivables.notice-facts`; null ends the run with nothing sent." },
    { name: "directors", about: "For `issued` with a payer Organization Safe: reads its owners on chain (`getOwners`), then the facts again with them." },
    { name: "plan", about: "Decides the notices for the event from the facts; none when the Invoice does not call for one." },
    { name: "deliver", about: "Sends each planned notice through mail and records each recipient's outcome." },
    { name: "retry", about: "Reschedules this action for the recipients the provider did not take, after one minute then four, up to three attempts." },
  ],
  reads: rpc_requests_receivables_notice_facts.reads,
  writes: [],
  drives: [],
  invokes: rpc_requests_receivables_notice_facts.invokes,
  emits: [],
  calls: [integration_chain_rpc.c.fetchSafeOwners, integration_mail.c.deliverNotices],
  chain: [contract_safe.f.getOwners],
  idempotency:
    "Each delivery is keyed `requests.receivables.notify:<requestId>:<event>[:<receivedRaw>]:<template>`; a retry carries " +
    "only the recipients that failed. The facts are read again on every run, so a paid notice goes out only for a paid Invoice.",
  timeoutMs: 600000,
  retries: { max: 2, backoff: "exponential" },
  compensation: "None: a failed send never stops, rolls back or repeats the money action that scheduled it.",
});
