// The as-is Core SDK flows of the old requests concept: every public method of packages/sdk/src/requests/
// that composes more than one backend call or does local work. Its methods mount at
// `client.account.{services,requests,inbox}` and `client.org(orgId).{services,requests,inbox}`
// (parties/contacts.ts:222, through accounts/account.ts:141 and organizations/scope.ts:213) and at
// `client.checkouts` (platform/client/assemble.ts:208). Methods that forward one rpc are listed in the
// comment at the end of this file, with the rpc each forwards.
//
// Each backend call runs through `runPortEffect`, which opens an SDK span named by its row
// (platform/actor-bridge.ts:118, platform/capxul-effect.ts:166); `spans` lists them.
// Paths in `was` are relative to the old repository root (/home/user/factory).

import { Schema } from "effect";
import { defineFlow, type FlowSpec } from "../../../packages/book/src/index.ts";
import { component_core_sdk } from "../shared/foundation.ts";
import { integration_openfort } from "../shared/external.ts";
import {
  error_CANCELLED,
  error_INVALID_INPUT,
  error_NOT_AUTHENTICATED,
  error_NOT_IMPLEMENTED,
  error_PROVIDER_RESPONSE_INVALID,
  error_SIGNER_REJECTED,
  error_UNKNOWN,
} from "../shared/vocabulary.ts";
import {
  rpc_requests_checkouts_get,
  rpc_requests_checkouts_invoice,
  rpc_requests_checkouts_prepare_request_registered,
  rpc_requests_checkouts_request,
} from "./checkouts.ts";
import { rpc_requests_inboxes_approve, rpc_requests_inboxes_payment_terms } from "./inboxes.ts";
import {
  rpc_payments_commands_prepare_invoice_checkout,
  rpc_payments_commands_prepare_offer_checkout,
  rpc_payments_commands_prepare_request,
} from "../payments/commands.ts";
import { rpc_payments_executions_abandon, rpc_payments_executions_submit_command } from "../payments/executions.ts";
import { rpc_payments_records_get, rpc_payments_records_get_for_organization } from "../payments/movements.ts";

type Steps = (typeof FlowSpec.Type)["steps"];

const SDK = "packages/sdk/src/requests";
const PAY = "packages/sdk/src/payments";

/** The client-side signer every signing flow calls directly (external.ts books it as openfort). */
const signerCalls = [integration_openfort.c.getAddress, integration_openfort.c.signUserOpHash];

/** `InvocationControls` (platform/actor/controls.ts): an AbortSignal, time limits and ids, not data. */
const Controls = Schema.optionalKey(
  Schema.Struct({
    signal: Schema.optionalKey(Schema.Unknown),
    timeoutMs: Schema.optionalKey(Schema.Number),
    deadlineMs: Schema.optionalKey(Schema.Number),
    correlation_id: Schema.optionalKey(Schema.String),
    journey_id: Schema.optionalKey(Schema.String),
  }),
);

/** `InboxFulfillOptions` (inboxes.ts:50): the controls and an `onPrepared` callback. */
const FulfillOptions = Schema.optionalKey(
  Schema.Struct({
    signal: Schema.optionalKey(Schema.Unknown),
    timeoutMs: Schema.optionalKey(Schema.Number),
    deadlineMs: Schema.optionalKey(Schema.Number),
    onPrepared: Schema.optionalKey(Schema.Unknown),
  }),
);

/** `InboxApproveInput` (inboxes.ts:61). */
const ApproveInput = Schema.Struct({
  requestId: Schema.String,
  requestKey: Schema.optionalKey(Schema.String),
  permissionId: Schema.optionalKey(Schema.String),
});

/** `PayInvoiceRegisteredInput` (checkouts.ts:41): the link, the payer, a Permission and the funding wallet. */
const PayLinkInput = Schema.Struct({
  linkToken: Schema.String,
  payer: Schema.Unknown,
  permissionId: Schema.optionalKey(Schema.String),
  sourceWallet: Schema.String,
});

// ── shared steps ───────────────────────────────────────────────────────────────────────────

/**
 * `executePrepared` (payments/command-execution.ts:80), the payments door the registered checkouts run:
 * the session, the signer's address, the row's prepare, the checks, the sign and one submit.
 */
const executePreparedSteps = (prepare: Steps[number], check: string): Steps => [
  {
    name: "session",
    local: "cache",
    about: "Refuses an aborted call (CANCELLED); reads the session for a write (none is NOT_AUTHENTICATED) and fences its auth lifetime.",
  },
  { name: "signer-address", local: "sign", about: "The configured CapxulSigner's address; a failure is the signer's error (SIGNER_REJECTED)." },
  prepare,
  { name: "verify", local: "build", about: check },
  {
    name: "abandon",
    rpc: rpc_payments_executions_abandon,
    about: "A failed check, an abort or a signer refusal abandons the prepared execution before anything is sent.",
  },
  { name: "sign", local: "sign", about: "Signs the SafeOp digest with the CapxulSigner (signUserOpHash)." },
  { name: "submit", rpc: rpc_payments_executions_submit_command, about: "Submits the signed operation once." },
];

const EXECUTE_WAS = [`${PAY}/command-execution.ts:80`, `${PAY}/command-execution.ts:107`, `${PAY}/command-execution.ts:226`, `${PAY}/command-execution.ts:245`];

// ── client.account.inbox / client.org(orgId).inbox ─────────────────────────────────────────

const approveAbout = (scope: string) =>
  `${scope}.inbox.approve approves one request addressed to the scope and returns the Payment it became. A held timing in ` +
  "the input is refused before any call (INVALID_INPUT). It reads the exact terms first (requests.inboxes.payment-terms); a " +
  "Memo request approves with the caller's key as given; an Invoice takes a managed attempt key (`withInvoiceRequestKey`: a " +
  "stored key per actor and intent, kept through uncertain results, renewed once before preparation after an authoritative " +
  "failed-key reply) and approves with it. The prepared command is then checked against the approved Payment read under the " +
  "payer's own record scope: one send item, the Payment's id, outgoing, its token, raw amount, instruction document and " +
  "chain; any mismatch is PROVIDER_RESPONSE_INVALID. A sign-out or change of auth lifetime between calls is CANCELLED. " +
  "Nothing is signed: a new preparation stays pending.";

const approveSteps = (read: Steps[number]): Steps => [
  { name: "timing", local: "build", about: "heldTimingRefusal on the input's timing: anything but instant is INVALID_INPUT." },
  { name: "lifetime", local: "cache", about: "Captures the identity's auth lifetime; every later step returns CANCELLED once it changed." },
  { name: "terms", rpc: rpc_requests_inboxes_payment_terms, about: "Reads the exact terms the payer confirms; a refusal returns as is." },
  {
    name: "attempt-key",
    local: "cache",
    about: "An Invoice only: the managed attempt key for (actor, intent), or the caller's key; a failed default is renewed once.",
  },
  { name: "approve", rpc: rpc_requests_inboxes_approve, about: "Approves with the key and Permission; answers the prepared command." },
  read,
  { name: "check", local: "build", about: "The prepared command and its Payment agree (one send, id, direction, token, amount, documents, chain)." },
];

const APPROVE_WAS = [
  `${SDK}/inboxes.ts:105`,
  `${SDK}/inboxes.ts:107`,
  `${SDK}/inboxes.ts:119`,
  `${SDK}/inboxes.ts:136`,
  `${SDK}/inboxes.ts:145`,
  `${SDK}/inbox-payments.ts:25`,
  `${SDK}/request-keys.ts:7`,
  `${PAY}/send-dates.ts:76`,
  "packages/sdk/src/parties/relationship-calls.ts:70",
];

export const flow_client_account_inbox_approve = defineFlow({
  id: "client.account.inbox.approve",
  title: "Approve a request addressed to the caller's Account",
  about: approveAbout("client.account"),
  component: component_core_sdk,
  sdk: "client.account.inbox.approve",
  input: Schema.Struct({ input: ApproveInput, options: Controls }),
  output: Schema.Unknown,
  steps: approveSteps({ name: "read-payment", rpc: rpc_payments_records_get, about: "Reads the approved Payment by id as the payer's own Account." }),
  errors: [error_INVALID_INPUT, error_CANCELLED, error_PROVIDER_RESPONSE_INVALID, error_UNKNOWN],
  calls: [],
  spans: ["requests.inboxes.paymentTerms", "requests.inboxes.approve", "payments.records.get"],
  was: [...APPROVE_WAS, `${SDK}/inbox-payments.ts:66`],
});

export const flow_client_org_inbox_approve = defineFlow({
  id: "client.org.inbox.approve",
  title: "Approve a request addressed to an Organization",
  about:
    approveAbout("client.org(orgId)") +
    " The Payment is read for the Organization (payments.records.get-for-organization), and a reply for another orgId is " +
    "PROVIDER_RESPONSE_INVALID.",
  component: component_core_sdk,
  sdk: "client.org(orgId).inbox.approve",
  input: Schema.Struct({ orgId: Schema.String, input: ApproveInput, options: Controls }),
  output: Schema.Unknown,
  steps: approveSteps({
    name: "read-payment",
    rpc: rpc_payments_records_get_for_organization,
    about: "Reads the approved Payment by id for the Organization; a reply for another orgId is refused.",
  }),
  errors: [error_INVALID_INPUT, error_CANCELLED, error_PROVIDER_RESPONSE_INVALID, error_UNKNOWN],
  calls: [],
  spans: ["requests.inboxes.paymentTerms", "requests.inboxes.approve", "payments.records.getForOrganization"],
  was: [...APPROVE_WAS, `${SDK}/inbox-payments.ts:68`],
});

const fulfillAbout = (scope: string) =>
  `${scope}.inbox.fulfill confirms the reviewed terms and pays them in one call. It decodes the confirmation strictly ` +
  "(INVALID_INPUT confirmation), refuses a streamed release, and refuses a payer that is not the method's scope " +
  "(INVALID_INPUT payer); no identity, chain or signer is NOT_IMPLEMENTED (inbox.executionComposition). Then the payments " +
  "door's executeRequestPayment (payments/lifecycle-execution.ts:128): payments.commands.prepare-request for the signer, the " +
  "request check (a `payment_request` with exactly this confirmation), onPrepared with the Payment ids before signing, the " +
  "SafeOp signature and one submit. An Invoice runs inside `withInvoiceRequestKey`, so its attempt key is stored and kept " +
  "through uncertainty; a Memo uses the caller's key. Its refusals before the payment name the operation `inbox.fulfill`.";

const fulfillSteps: Steps = [
  { name: "decode", local: "build", about: "Strict RequestPaymentConfirmation decode; a streamed release or a payer outside the scope is INVALID_INPUT." },
  { name: "attempt-key", local: "cache", about: "An Invoice only: the managed attempt key for (actor, intent), or the caller's key." },
  ...executePreparedSteps(
    { name: "prepare", rpc: rpc_payments_commands_prepare_request, about: "Sends { confirmation, signerAddress }." },
    "requestPaymentCheck and verifiedPreparedCommand: the prepared request is this confirmation; then onPrepared with the Payment ids.",
  ),
];

const FULFILL_WAS = [
  `${SDK}/inboxes.ts:160`,
  `${SDK}/inboxes.ts:172`,
  `${SDK}/inboxes.ts:180`,
  `${SDK}/inboxes.ts:191`,
  `${SDK}/inboxes.ts:197`,
  `${SDK}/inboxes.ts:218`,
  `${SDK}/request-keys.ts:7`,
  `${PAY}/lifecycle-execution.ts:75`,
  `${PAY}/lifecycle-execution.ts:128`,
  ...EXECUTE_WAS,
];

const FULFILL_ERRORS = [error_INVALID_INPUT, error_NOT_IMPLEMENTED, error_NOT_AUTHENTICATED, error_CANCELLED, error_SIGNER_REJECTED, error_UNKNOWN];

export const flow_client_account_inbox_fulfill = defineFlow({
  id: "client.account.inbox.fulfill",
  title: "Confirm and pay a request from the caller's Account",
  about: fulfillAbout("client.account"),
  component: component_core_sdk,
  sdk: "client.account.inbox.fulfill",
  input: Schema.Struct({ confirmation: Schema.Unknown, options: FulfillOptions }),
  output: Schema.Unknown,
  steps: fulfillSteps,
  errors: FULFILL_ERRORS,
  calls: signerCalls,
  spans: ["inbox.fulfill", "payments.commands.prepareRequest", "payments.submitCommandExecution"],
  was: FULFILL_WAS,
});

export const flow_client_org_inbox_fulfill = defineFlow({
  id: "client.org.inbox.fulfill",
  title: "Confirm and pay a request from an Organization",
  about: fulfillAbout("client.org(orgId)") + " The confirmation's payer must be this Organization.",
  component: component_core_sdk,
  sdk: "client.org(orgId).inbox.fulfill",
  input: Schema.Struct({ orgId: Schema.String, confirmation: Schema.Unknown, options: FulfillOptions }),
  output: Schema.Unknown,
  steps: fulfillSteps,
  errors: FULFILL_ERRORS,
  calls: signerCalls,
  spans: ["inbox.fulfill", "payments.commands.prepareRequest", "payments.submitCommandExecution"],
  was: FULFILL_WAS,
});

// ── client.checkouts ───────────────────────────────────────────────────────────────────────

const CHECKOUT_ERRORS = [error_NOT_IMPLEMENTED, error_NOT_AUTHENTICATED, error_INVALID_INPUT, error_CANCELLED, error_SIGNER_REJECTED, error_UNKNOWN];

const linkAbout = (method: string, frozen: string, prepare: string) =>
  `client.checkouts.${method} pays a link as a registered payer from its own Safe. No convex port or no execution ` +
  "composition is NOT_IMPLEMENTED; no session is NOT_AUTHENTICATED; the funding wallet must be an address (INVALID_INPUT). " +
  `It reads the frozen terms first (${frozen}); a sign-out meanwhile is CANCELLED, none or another link is INVALID_INPUT, ` +
  "and a bank Invoice is INVALID_INPUT `Pay this Invoice by bank transfer.`. Then the payments door's executePrepared: " +
  `${prepare} for the signer's address, refused when its terms differ from the frozen ones (INVALID_INPUT), checked as an ` +
  "`invoice_checkout` request for this link, payer and Permission, signed and submitted once.";

const LINK_WAS = [`${SDK}/checkout-payments.ts:82`, `${SDK}/checkout-payments.ts:94`, `${SDK}/checkout-payments.ts:100`, `${SDK}/checkout-payments.ts:122`, `${SDK}/checkout-payments.ts:134`, ...EXECUTE_WAS];

export const flow_client_checkouts_pay_invoice_registered = defineFlow({
  id: "client.checkouts.pay-invoice-registered",
  title: "Pay an Invoice link as a registered payer",
  about: linkAbout("payInvoiceRegistered", "requests.checkouts.invoice; a Memo reply is refused", "payments.commands.prepare-invoice-checkout"),
  component: component_core_sdk,
  sdk: "client.checkouts.payInvoiceRegistered",
  input: Schema.Struct({ input: PayLinkInput, options: Controls }),
  output: Schema.Unknown,
  steps: [
    { name: "wallet", local: "build", about: "Decodes the funding wallet as an address." },
    { name: "frozen", rpc: rpc_requests_checkouts_invoice, about: "Reads the Invoice link's public terms; a Memo is refused." },
    ...executePreparedSteps(
      { name: "prepare", rpc: rpc_payments_commands_prepare_invoice_checkout, about: "Prepares the sponsored Payment for the signer." },
      "The prepared Invoice summary equals the frozen one; the request is this link's `invoice_checkout`.",
    ),
  ],
  errors: CHECKOUT_ERRORS,
  calls: signerCalls,
  spans: ["requests.checkouts.invoice", "payments.commands.prepareInvoiceCheckout", "payments.submitCommandExecution"],
  was: [`${SDK}/checkouts.ts:163`, ...LINK_WAS],
});

export const flow_client_checkouts_pay_request_registered = defineFlow({
  id: "client.checkouts.pay-request-registered",
  title: "Pay a request link as a registered payer",
  about: linkAbout("payRequestRegistered", "requests.checkouts.request", "requests.checkouts.prepare-request-registered"),
  component: component_core_sdk,
  sdk: "client.checkouts.payRequestRegistered",
  input: Schema.Struct({ input: PayLinkInput, options: Controls }),
  output: Schema.Unknown,
  steps: [
    { name: "wallet", local: "build", about: "Decodes the funding wallet as an address." },
    { name: "frozen", rpc: rpc_requests_checkouts_request, about: "Reads the request link's public terms." },
    ...executePreparedSteps(
      { name: "prepare", rpc: rpc_requests_checkouts_prepare_request_registered, about: "Prepares the sponsored Payment for the signer." },
      "The prepared request summary equals the frozen one; the request is this link's `invoice_checkout`.",
    ),
  ],
  errors: CHECKOUT_ERRORS,
  calls: signerCalls,
  spans: ["requests.checkouts.request", "requests.checkouts.prepareRequestRegistered", "payments.submitCommandExecution"],
  was: [`${SDK}/checkouts.ts:164`, ...LINK_WAS],
});

export const flow_client_checkouts_pay_registered = defineFlow({
  id: "client.checkouts.pay-registered",
  title: "Pay a frozen Offer purchase as a registered payer",
  about:
    "client.checkouts.payRegistered pays an Offer purchase as a registered payer from its own Safe. No convex port or no " +
    "execution composition is NOT_IMPLEMENTED; no session is NOT_AUTHENTICATED. It reads the frozen purchase first " +
    "(requests.checkouts.get); a sign-out meanwhile is CANCELLED, none or another checkout is INVALID_INPUT. Then the " +
    "payments door's executePrepared: payments.commands.prepare-offer-checkout for the signer's address, refused when its " +
    "checkout differs from the frozen purchase (INVALID_INPUT), checked as an `offer_checkout` request for this checkout, " +
    "payer and Permission, signed and submitted once.",
  component: component_core_sdk,
  sdk: "client.checkouts.payRegistered",
  input: Schema.Struct({
    input: Schema.Struct({ checkoutId: Schema.String, payer: Schema.Unknown, permissionId: Schema.optionalKey(Schema.String) }),
    options: Controls,
  }),
  output: Schema.Unknown,
  steps: [
    { name: "frozen", rpc: rpc_requests_checkouts_get, about: "Reads the frozen purchase." },
    ...executePreparedSteps(
      { name: "prepare", rpc: rpc_payments_commands_prepare_offer_checkout, about: "Prepares the sponsored Payment for the signer." },
      "The prepared checkout equals the frozen purchase; the request is this checkout's `offer_checkout`.",
    ),
  ],
  errors: [error_NOT_IMPLEMENTED, error_NOT_AUTHENTICATED, error_INVALID_INPUT, error_CANCELLED, error_SIGNER_REJECTED, error_UNKNOWN],
  calls: signerCalls,
  spans: ["requests.checkouts.get", "payments.commands.prepareOfferCheckout", "payments.submitCommandExecution"],
  was: [`${SDK}/checkouts.ts:165`, `${SDK}/checkout-payments.ts:181`, `${SDK}/checkout-payments.ts:192`, `${SDK}/checkout-payments.ts:212`, ...EXECUTE_WAS],
});

// Forwarders: each method below sends one rpc (its row, as `book` or `call` does, under a span named by the row)
// and maps its reply; no convex port is NOT_IMPLEMENTED (missingConvexCall, services `missing`).
//
// client.account.services.create / get / list / revise / deactivate → requests.offers.create / get / list / revise /
//                                          deactivate, actor { kind: account } (services.ts:70).
// client.org(orgId).services.*           → the same rows, actor { kind: org, orgId }.
// client.account.requests.issue          → requests.receivables.issue; the payer Ref is normalized first
//                                          (normalizeRefForBackend: INVALID_INPUT naming payer) (receivables.ts:102).
// client.account.requests.list           → requests.receivables.list-current (receivables.ts:139).
// client.account.requests.get            → requests.receivables.get-current (receivables.ts:143).
// client.account.requests.getByLink      → requests.receivables.get-by-link-current (receivables.ts:147).
// client.account.requests.cancel         → requests.receivables.cancel (receivables.ts:151).
// client.account.inbox.paymentTerms      → requests.inboxes.payment-terms (inboxes.ts:88).
// client.account.inbox.list              → requests.inboxes.list-current, with cursor and limit (inboxes.ts:90).
// client.account.inbox.get               → requests.inboxes.get-current (inboxes.ts:101).
// client.account.inbox.decline           → requests.inboxes.decline (inboxes.ts:231).
// client.org(orgId).requests.* and inbox.* (but approve and fulfill) → the same rows, actor { kind: org, orgId }.
// client.checkouts.request / prepareRequest / requestState / reconcileRequest → requests.checkouts.request /
//                                          prepare-request / request-state / reconcile-request (checkouts.ts:136).
// client.checkouts.invoice / prepareInvoice / invoiceState / reconcileInvoice → requests.checkouts.invoice /
//                                          prepare-invoice / invoice-state / reconcile-invoice; a reply naming a Memo is
//                                          INVALID_INPUT `Invoice checkout cannot use a Memo` (checkouts.ts:144).
// client.checkouts.service / create / get / prepare / state / reconcile → requests.checkouts.offer / create / get /
//                                          prepare / state / reconcile (checkouts.ts:166).
