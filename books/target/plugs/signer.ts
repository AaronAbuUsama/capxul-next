// The signer plug: a payment a person starts in Frappe from the Safe's bank account is held until the chain confirms it. Frappe's form
// calls `plugs.payments.prepare`; Core checks the hat and the budget, opens the approval that carries the signature (payments' own
// command, so the chain's rules decide), and answers whose signature is awaited. Whoever may sign signs with a key, as an agent or
// deterministic code (OpenFort is outside the current path, plugs.no-openfort); the chain's PaymentSent lands it. Frappe never marks money
// moved first: a hook refuses every other credit to the Safe's account (FINDINGS, Frappe half: Paying a document, routes 1 and 4).

import { Schema } from "effect";
import { concept_plugs } from "../shared/foundation.ts";
import {
  error_AUTHORISED_EXCEEDED, error_DOCUMENT_HASH_MISMATCH, error_INSUFFICIENT_BALANCE, error_INVALID_INPUT, error_NOT_AUTHENTICATED,
  error_ROLE_PERMISSION_DENIED, error_WRONG_STATE,
} from "../shared/vocabulary.ts";
import { table_hat_wearers } from "../indexing/data.ts";
import { table_org_deployments } from "../organizations/data.ts";
import { procedure_payments_prepare_command } from "../payments/procedures.ts";
import { machine_payment_request, table_payment_requests, PaymentRequestState, table_site_users } from "./data.ts";
import { N, Null, S, procedure, rpc } from "./kit.ts";

const SPIKE = "spikes/skeleton/FINDINGS.md";

export const PaymentRequestView = Schema.Struct({
  requestId: S, doctype: S, docname: S, documentHash: S, status: PaymentRequestState, awaiting: S, awaitingName: Null(S), requestedBy: S,
  toParty: S, amount: S, asset: S, costCentre: Null(S), accountCode: Null(S), approvalId: S, failureReason: Null(S), txHash: Null(S), createdAt: N,
});

export const procedure_plugs_payments_hold = procedure({
  id: "plugs.payments.hold",
  title: "Hold a Frappe document's payment until the chain confirms it",
  about:
    "Money fact: the request row and the payment command with its approval are born together, or neither is. It resolves the requester and the signer to " +
    "site users (a Frappe user that no hat created, Administrator included, has no signer: ROLE_PERMISSION_DENIED, with the reason, never 'Capxul could not " +
    "be reached'); checks that the signer wears a hat that may pay from the budget; reads the document hash (CANON v1, plugs.document-canon) and refuses " +
    "the zero hash; then invokes `payments.prepare-command` with the hash, the cost centre and the account code, so the chain's payment carries them. " +
    "A second hold for the same draft and hash answers the same request. It answers the request and whose signature is awaited, which is the signer's, not " +
    "necessarily the requester's. It makes no outside call; the signer's key signs the approval elsewhere.",
  concept: concept_plugs,
  input: Schema.Struct({
    org_id: S, doctype: S, docname: S, document_hash: S, requested_by: S, to_party: S, to_address: S, amount: S, asset: S,
    department: Null(S), cost_centre: Null(S), account_code: Null(S), signer: Null(S),
  }),
  output: Schema.Struct({ request_id: S, approval_id: S, awaiting: S, replayed: Schema.Boolean }),
  errors: [error_INVALID_INPUT, error_ROLE_PERMISSION_DENIED, error_AUTHORISED_EXCEEDED, error_INSUFFICIENT_BALANCE],
  reads: [table_site_users, table_hat_wearers, table_org_deployments, table_payment_requests],
  writes: [table_payment_requests],
  drives: [machine_payment_request.t.prepare],
  invokes: [procedure_payments_prepare_command],
  was: [`${SPIKE} (INTERFACE.md: Frappe to Core /prepare; Frappe half: Paying a document)`],
});

export const procedure_plugs_payments_abandon = procedure({
  id: "plugs.payments.abandon",
  title: "Let go of a held payment the person cancelled",
  about:
    "The person cancels the Payment Entry draft while its payment waits. A waiting request moves to abandoned and the approval is withdrawn so nobody can " +
    "still sign it. A request already sent is WRONG_STATE: money cannot be un-sent, and a cancel of a paid document is a reversal (plugs.reversal-not-deletion).",
  concept: concept_plugs,
  input: Schema.Struct({ org_id: S, request_id: S, by: S }),
  output: Schema.Struct({ request_id: S, status: Schema.Literal("abandoned") }),
  errors: [error_WRONG_STATE, error_INVALID_INPUT],
  reads: [table_payment_requests],
  writes: [table_payment_requests],
  drives: [machine_payment_request.t.abandon],
  was: [`${SPIKE} (Frappe half: Cancel of a posted Safe payment is refused)`],
});

export const rpc_plugs_payments_prepare = rpc({
  id: "plugs.payments.prepare",
  title: "Prepare a payment a Frappe user asked for",
  about:
    "The site's form posts the document, its hash, the requester and the payee; the body is signed with the site's secret (a call without a valid signature is " +
    "refused with NOT_AUTHENTICATED). It holds the payment (plugs.payments.hold) and answers the request, the approval and whose signature is awaited. A refusal " +
    "carries its reason to the person: no hat, no budget room, an unknown user, a hash that does not match a draft already prepared (DOCUMENT_HASH_MISMATCH). " +
    "The Payment Entry stays a draft in Frappe until the chain's PaymentSent lands it.",
  concept: concept_plugs,
  kind: "mutation",
  who: "A hosted site's server, signing the body, for a Frappe user a hat created.",
  input: Schema.Struct({
    org: S, doctype: S, name: S, document_hash: S, requested_by: S, to_party: S, to_address: S, amount: S, asset: S,
    department: Null(S), cost_centre: Null(S), account_code: Null(S),
  }),
  output: Schema.Struct({ request_id: S, approval_id: S, awaiting: S, awaiting_name: Null(S), approval_url: S }),
  errors: [error_NOT_AUTHENTICATED, error_ROLE_PERMISSION_DENIED, error_INVALID_INPUT, error_AUTHORISED_EXCEEDED, error_INSUFFICIENT_BALANCE, error_DOCUMENT_HASH_MISMATCH],
  reads: [table_site_users],
  invokes: [procedure_plugs_payments_hold],
  budget: { class: "chain-read", p50Ms: 900, p95Ms: 2000 },
  was: [`${SPIKE} (INTERFACE.md: Frappe to Core)`],
});

export const rpc_plugs_payments_awaiting = rpc({
  id: "plugs.payments.awaiting",
  title: "List the payments waiting for a signature",
  about:
    "What a signer has been asked to sign, oldest first: each waiting request with its document, payee, amount, who asked and the approval to sign. A person or an agent " +
    "lists their own address's; a member of the Organization lists another's with `--for`. A request already sent, failed or abandoned is not listed. The list is " +
    "the answer to 'whose signature does this payment await?' that the person in Frappe could not see before (FINDINGS, What the design must now decide, 4).",
  concept: concept_plugs,
  kind: "query",
  who: "A signed-in person or agent, for their own address; a member of the Organization for another signer's.",
  input: Schema.Struct({ orgId: S, for: Null(S), limit: N }),
  output: Schema.Struct({ requests: Schema.Array(PaymentRequestView) }),
  errors: [error_NOT_AUTHENTICATED, error_ROLE_PERMISSION_DENIED],
  reads: [table_payment_requests, table_site_users],
  was: [`${SPIKE} (What the design must now decide, 4)`],
});

export const rpc_plugs_payments_get = rpc({
  id: "plugs.payments.get",
  title: "Read one held payment and its state",
  about:
    "A request by id, or by document and name, with its state, the approval, whose signature is awaited and, once landed, the transaction hash. The site reads it to show the " +
    "person where their payment stands, and refreshes it while it waits.",
  concept: concept_plugs,
  kind: "query",
  who: "A member of the Organization, or the site's server, signing the call.",
  input: Schema.Struct({ orgId: S, requestId: Null(S), doctype: Null(S), docname: Null(S) }),
  output: PaymentRequestView,
  errors: [error_NOT_AUTHENTICATED, error_INVALID_INPUT],
  reads: [table_payment_requests],
  was: [`${SPIKE} (Frappe half: Paying a document, route 2)`],
});
