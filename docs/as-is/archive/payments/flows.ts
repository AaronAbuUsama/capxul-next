// The as-is Core SDK flows of the old payments concept: every public method of
// `client.payments` and `client.org(orgId).payments` (packages/sdk/src/payments/) that
// composes more than one backend call or does local work. Methods that forward one rpc
// are listed in the comment at the end of this file, with the rpc each forwards.
//
// Paths in `was` are relative to the old repository root (/home/user/factory).

import { Schema } from "effect";
import { defineFlow, type FlowSpec } from "../../../packages/book/src/index.ts";
import { component_core_sdk } from "../shared/foundation.ts";
import { integration_openfort } from "../shared/external.ts";
import {
  error_CANCELLED,
  error_INVALID_INPUT,
  error_NETWORK_ERROR,
  error_NOT_AUTHENTICATED,
  error_NOT_IMPLEMENTED,
  error_PROVIDER_ERROR,
  error_PROVIDER_RESPONSE_INVALID,
  error_SIGNER_REJECTED,
  error_SMART_ACCOUNT_MISSING,
  error_UNKNOWN,
  error_WRONG_STATE,
} from "../shared/vocabulary.ts";
import {
  rpc_payments_commands_prepare,
  rpc_payments_commands_prepare_organization,
  rpc_payments_commands_prepare_request,
} from "./commands.ts";
import { rpc_payments_lifecycles_prepare_scoped } from "./schedules.ts";
import {
  rpc_payments_executions_abandon,
  rpc_payments_executions_submit,
  rpc_payments_executions_submit_command,
} from "./executions.ts";
import { rpc_payments_records_get, rpc_payments_records_get_for_organization } from "./movements.ts";

type Steps = (typeof FlowSpec.Type)["steps"];

const SDK = "packages/sdk/src/payments";

// ── shared shapes ──────────────────────────────────────────────────────────────────────────

/** `PaymentMoney` = `AssetAmount`: an asset id and a decimal string (money/model.ts:9). */
const Money = Schema.Struct({ asset: Schema.String, value: Schema.String });

/**
 * `PaymentsPayOptions` = `InvocationControls` and `onPrepared` (records.ts:134, controls.ts:6): an AbortSignal,
 * time limits, ids and a callback, not data. The pay methods read only signal and onPrepared; the time limits are
 * accepted by the type and ignored (see each flow's about).
 */
const PayOptions = Schema.optionalKey(
  Schema.Struct({
    signal: Schema.optionalKey(Schema.Unknown),
    timeoutMs: Schema.optionalKey(Schema.Number),
    deadlineMs: Schema.optionalKey(Schema.Number),
    onPrepared: Schema.optionalKey(Schema.Unknown),
    correlation_id: Schema.optionalKey(Schema.String),
    journey_id: Schema.optionalKey(Schema.String),
  }),
);

/** The client-side signer every signing flow calls directly (external.ts books it as openfort). */
const signerCalls = [integration_openfort.c.getAddress, integration_openfort.c.signUserOpHash];

/** One item of an Organization payment (organization-payment-requests.ts:31). */
const OrganizationItem = {
  to: Schema.Unknown,
  quoteId: Schema.optionalKey(Schema.String),
  amount: Money,
  externalAddressAcknowledged: Schema.optionalKey(Schema.Literal(true)),
  paymentType: Schema.optionalKey(Schema.String),
  account: Schema.optionalKey(Schema.String),
  suggest: Schema.optionalKey(Schema.String),
  on: Schema.optionalKey(Schema.String),
  document: Schema.optionalKey(Schema.Unknown),
  supportingReceipts: Schema.optionalKey(Schema.Array(Schema.Unknown)),
};

/** `PaymentsPayInput` (records.ts:97): one personal Payment, as pay and approvals.prepare take it. */
const PersonalPayment = {
  requestKey: Schema.optionalKey(Schema.String),
  actor: Schema.optionalKey(Schema.Unknown),
  to: Schema.Unknown,
  quoteId: Schema.optionalKey(Schema.String),
  amount: Money,
  externalAddressAcknowledged: Schema.optionalKey(Schema.Literal(true)),
  paymentType: Schema.optionalKey(Schema.String),
  account: Schema.optionalKey(Schema.String),
  suggest: Schema.optionalKey(Schema.String),
  on: Schema.optionalKey(Schema.String),
  document: Schema.optionalKey(Schema.Unknown),
  supportingReceipts: Schema.optionalKey(Schema.Array(Schema.Unknown)),
};

/** The normalized Payment (records.ts:69): too deep to transcribe. */
const PaymentOut = Schema.Unknown;

const SubscribeInput = Schema.Struct({
  paymentId: Schema.String,
  /** `(snapshot: PaymentSnapshot) => void`: loading, ok (Payment or null) or error. */
  listener: Schema.Unknown,
  /** `PaymentSubscriptionOptions`: InvocationControls without timeoutMs and deadlineMs (records.ts:129). */
  options: Schema.optionalKey(
    Schema.Struct({
      signal: Schema.optionalKey(Schema.Unknown),
      correlation_id: Schema.optionalKey(Schema.String),
      journey_id: Schema.optionalKey(Schema.String),
    }),
  ),
});

// ── steps the prepared-command path shares (executePrepared, command-execution.ts:80) ─────

const commandSession = {
  name: "session",
  local: "cache",
  about:
    "Refuses an aborted signal (CANCELLED, operation payments), reads the held auth session, waiting while it restores " +
    "(none is NOT_AUTHENTICATED, or the faulted session read's own error), and captures its auth lifetime; " +
    "after every later await a changed lifetime answers CANCELLED.",
} as const;

const commandSignerAddress = {
  name: "signer-address",
  local: "sign",
  about:
    "CapxulSigner.getAddress(): the owner EOA; asks the signer, signs nothing. A throw becomes SIGNER_REJECTED " +
    "(code 4001 or passkey cancelled) or PROVIDER_ERROR / PROVIDER_RESPONSE_INVALID (signerFailure).",
} as const;

const commandReplay = {
  name: "replay",
  local: "build",
  about:
    "A settled submission in the prepare's answer (no readAcceptedReplay here): strict decode; execution, command and Payment " +
    "ids, the EntryPoint 0.7 UserOperation hash, and each Payment's status, direction, receipt chain, amount and instruction " +
    "must match, else INVALID_INPUT. Never abandoned.",
} as const;

/** Organization pay and payBatch: the request carries items. */
const commandSignItems = {
  name: "sign",
  local: "sign",
  about:
    "After one payment_transitioned (initiated) per item, awaited, when the backend sets emitPaymentInitiated, " +
    "CapxulSigner.signUserOpHash(digest) signs the SafeOp digest, never the EntryPoint UserOperation hash. " +
    "A throw abandons with signer_rejected.",
} as const;

/** A lifecycle retry: its request is { kind: retry, paymentId }, with no items, so emitPreparedInitiation emits nothing. */
const commandSignRetry = {
  name: "sign",
  local: "sign",
  about:
    "CapxulSigner.signUserOpHash(digest) signs the SafeOp digest, never the EntryPoint UserOperation hash. No " +
    "payment_transitioned: the retry request has no items. A throw returns the signer's error and abandons nothing.",
} as const;

const commandSubmit = {
  name: "submit",
  rpc: rpc_payments_executions_submit_command,
  about:
    "Sends { executionId, signature } once; refused CANCELLED if the auth lifetime changed, " +
    "and not raced against the abort signal, because the backend may already have broadcast.",
} as const;

/** The operation check of an Organization or lifecycle command, after its own request check. */
const commandCheckOperation = {
  name: "check-operation",
  local: "build",
  about:
    "verifiedPreparedCommand: chain, signer, the personal Safe from email, namespace and Companies House, bank targets, one " +
    "signed date, a known V2/V3 router, items, route, rebuilt callData, lane, SafeOp digest, execution id, birth documents; " +
    "else INVALID_INPUT.",
} as const;

/** The budget-route check of a lifecycle retry (preparedBudgetBound, budget-route.ts:97). */
const retryBudgetRoute = {
  name: "budget-route",
  local: "build",
  about:
    "Budget route only: one that cancels dated payments must be a reschedule's retry, one id per item; the budget must be the " +
    "active allowance's or department's of the birth's org and Permission (an Account birth has none: refused), via " +
    "allowances.list or departments.get. A failed read counts as unbound.",
} as const;

/** Organization batch steps (organization-flights.ts:69), shared by pay and payBatch. */
const organizationBatchSteps = (single: boolean): Steps => [
  {
    name: "build-intent",
    local: "build",
    about:
      (single ? "Refuses a non-object input and wraps it as one item; " : "Refuses a non-object input; ") +
      "refuses an aborted signal, a request key the row's schema refuses, an unreadable on/timing and items with two send times; " +
      "strict decode of { orgId, permissionId, items, lineage }.",
  },
  {
    name: "request-key",
    local: "cache",
    about:
      "Needs actor, chain id and signer (else NOT_IMPLEMENTED). Takes the send-once key for organization-pay:<scope>:<actor>: " +
      "a caller key as is, else a pay_<hex> key in localStorage under Web Locks (browser) or an in-memory map (Node).",
  },
  {
    name: "fingerprint",
    local: "build",
    about:
      "keccak256 of the intent's canonical JSON; INVALID_INPUT (actor) when the signed-in user changed meanwhile. " +
      "A port failure is PROVIDER_ERROR (provider sdk); an abort now releases the key unresolved and answers CANCELLED.",
  },
  {
    name: "join-flight",
    local: "cache",
    about:
      "Joins the bundle's in-memory flight for [scope, actor, orgId, key] or starts one; refuses INVALID_INPUT " +
      "when that flight has another fingerprint or its onPrepared registration is closed.",
  },
  commandSession,
  commandSignerAddress,
  {
    name: "prepare",
    rpc: rpc_payments_commands_prepare_organization,
    about: "Sends the decoded intent with requestKey and signerAddress, under the method span; raced against the flight's abort signal.",
  },
  {
    name: "verify",
    local: "build",
    about:
      "An undecodable executionId is INVALID_INPUT, nothing abandoned; then strict decode of PreparedPaymentCommandExecution " +
      "(else INVALID_INPUT, abandoned); the request's fingerprint must be the intent's with its requestKey (matchesIntent), " +
      "else INVALID_INPUT, abandoned.",
  },
  commandCheckOperation,
  {
    name: "budget-route",
    local: "build",
    about:
      "Budget route only: one that cancels dated payments is refused (only a reschedule may); the budget must be the active " +
      "allowance's or department's, read via allowances.list or departments.get outside the signal and the method span. " +
      "A failed read counts as unbound: abandoned.",
  },
  commandReplay,
  {
    name: "abandon",
    rpc: rpc_payments_executions_abandon,
    about:
      "Only on a failed check, an abort or a signer refusal of an execution no replay accepted, while the auth lifetime holds " +
      "(else CANCELLED): reason prepared_mismatch, cancelled or signer_rejected. True closes the error and resolves the key; " +
      "a failed abandon replaces the error.",
  },
  {
    name: "on-prepared",
    local: "wait",
    about:
      "Delivers the verified paymentIds to every active onPrepared registration of the flight in order, awaiting each; a " +
      "registration whose caller aborted is skipped. A callback that throws fails the whole flight, with nothing abandoned. " +
      "A settled replay is returned after this, without signing.",
  },
  commandSignItems,
  commandSubmit,
  {
    name: "await-flight",
    local: "wait",
    about:
      "Each caller awaits the shared flight. An abort answers that caller CANCELLED at once, unless it is the last waiter of " +
      "an unsettled flight: then it aborts the flight and waits for the flight's own answer.",
  },
  {
    name: "release-key",
    local: "cache",
    about:
      "Finishes the key: resolved when the submit succeeded, the abandon closed the execution, or the error is final; " +
      "otherwise kept for a retry. A failed release is swallowed. Each Payment's timing is normalized.",
  },
];

// ── client.payments ────────────────────────────────────────────────────────────────────────

export const flow_client_payments_pay = defineFlow({
  id: "client.payments.pay",
  title: "Pay one personal Payment: prepare, check, sign, submit",
  about:
    "client.payments.pay sends one Payment from the caller's own Account Safe. It decodes the input locally, takes a send-once " +
    "request key and shares one in-flight submission per (scope, actor, key) across concurrent calls. The submission prepares the " +
    "Payment, checks the prepared execution against the request before anything is signed (request key, canonical intent, chain, " +
    "signer, the person's own Safe, the instruction document and receipts, the rebuilt approve-then-send callData for the V2 or a " +
    "V3 router, the signed date, the SafeOp digest, the execution id), signs the SafeOp digest with the configured CapxulSigner and " +
    "submits it once. A failed check, an abort or a signer refusal abandons the prepared execution. A prepare that answers an " +
    "earlier settled Payment for the key is checked and returned without signing. When the backend sets emitPaymentInitiated the " +
    "SDK emits payment_transitioned (transition initiated) through its TelemetryPort before signing; telemetry failures are " +
    "swallowed. As is: this method opens no SDK span (neither makePersonalPay nor executePersonalPayment runs under " +
    "runCapxulEffect, and runIfActive without an observer opens none), so its rpcs carry no client traceparent; methods.ts " +
    "mounts it without invocationControls, so timeoutMs, deadlineMs, correlation_id and journey_id are ignored. Unlike " +
    "executePrepared it fences the auth lifetime only around a settled replay, and its abandon is not fenced at all; it reads " +
    "the session twice; an abort after a settled replay still calls abandon; a missing signer is INVALID_INPUT (field signer) " +
    "while a missing actor or chain id is NOT_IMPLEMENTED. Input: PaymentsPayInput (records.ts:97) " +
    "and its options. Output: the normalized Payment (records.ts:69), too deep to transcribe, so Schema.Unknown; every error " +
    "arrives as a CapxulResult failure.",
  component: component_core_sdk,
  sdk: "client.payments.pay",
  input: Schema.Struct({
    input: Schema.Struct(PersonalPayment),
    options: PayOptions,
  }),
  output: PaymentOut,
  steps: [
    {
      name: "admit",
      local: "build",
      about:
        "No network. Refuses an aborted signal (CANCELLED), a bad request key, lineItems, an unreadable on, on with timing, a raw " +
        "timing other than instant or scheduled, an Organization actor (NOT_IMPLEMENTED), an input the strict intent schema " +
        "refuses, then no actor or chain id (NOT_IMPLEMENTED).",
    },
    {
      name: "request-key",
      local: "cache",
      about:
        "Send-once key for personal-pay:<scope>:<authUserId or signed-out>: a caller key as is, with a no-op finish; else a " +
        "pay_<hex> key in a slot named by keccak({ operation, raw input }), in localStorage under Web Locks (browser) or an " +
        "in-memory map (Node). A port failure is PROVIDER_ERROR.",
    },
    {
      name: "fingerprint",
      local: "build",
      about:
        "keccak256 of the decoded intent's canonical JSON; INVALID_INPUT (actor) when the signed-in user changed while the key was " +
        "taken, and the key is released unresolved.",
    },
    {
      name: "join-flight",
      local: "cache",
      about:
        "Joins the in-memory flight for [scope, actor, key] or starts one; refuses INVALID_INPUT when that flight has another " +
        "fingerprint (requestKey already used) or its onPrepared registration is closed. The flight leaves the map when it settles.",
    },
    {
      name: "session",
      local: "cache",
      about:
        "Refuses an aborted signal (CANCELLED) or no signer (INVALID_INPUT, field signer); reads the held auth session, waiting " +
        "while it restores (none is NOT_AUTHENTICATED, or the faulted session read's own error), and captures its auth lifetime.",
    },
    {
      name: "signer-address",
      local: "sign",
      about:
        "CapxulSigner.getAddress(): the owner EOA; asks the signer, signs nothing. A throw becomes SIGNER_REJECTED " +
        "(code 4001 or passkey cancelled) or PROVIDER_ERROR / PROVIDER_RESPONSE_INVALID (signerFailure).",
    },
    {
      name: "expected-safe",
      local: "build",
      about:
        "Reads the auth session a second time (prepareVerifiedPersonalPayment; none is NOT_AUTHENTICATED) and derives the " +
        "person's own Safe from its email (personalSafeOf).",
    },
    {
      name: "prepare",
      rpc: rpc_payments_commands_prepare,
      about:
        "Sends { requestKey, signerAddress, payment }; raced against the flight's abort signal (runIfActive). " +
        "A refusal is returned as it is, with nothing abandoned.",
    },
    {
      name: "verify",
      local: "build",
      about:
        "An undecodable executionId is INVALID_INPUT, nothing abandoned; then strict decode of PreparedPaymentExecution; request " +
        "key, intent, chain, signer, Safe, documents and receipts, approve+send callData, signed date, SafeOp digest, execution " +
        "id, settled replay. A mismatch is INVALID_INPUT, abandoned.",
    },
    {
      name: "abandon",
      rpc: rpc_payments_executions_abandon,
      about:
        "On a failed check, a signer refusal or an abort (checked around onPrepared, after the telemetry and after signing; the " +
        "first check runs even for a settled replay). Unfenced by the auth lifetime. True closes the error and resolves the key; " +
        "a failed abandon replaces the error.",
    },
    {
      name: "on-prepared",
      local: "wait",
      about:
        "Delivers the paymentId to each active onPrepared registration of the flight in order, awaiting each; one whose caller " +
        "aborted is skipped. A throwing callback fails the whole flight, nothing abandoned. A settled replay is returned next, " +
        "unsigned, unless the auth lifetime changed (CANCELLED).",
    },
    {
      name: "sign",
      local: "sign",
      about:
        "After payment_transitioned (initiated), awaited, when the backend sets emitPaymentInitiated, CapxulSigner.signUserOpHash " +
        "(digest) signs the SafeOp digest, never the EntryPoint hash. A throw abandons with signer_rejected.",
    },
    {
      name: "submit",
      rpc: rpc_payments_executions_submit,
      about:
        "Sends { executionId, signature } once; deliberately not raced against the abort signal, because the backend " +
        "may already have broadcast. Unlike submit-command it is not fenced by the auth lifetime.",
    },
    {
      name: "await-flight",
      local: "wait",
      about:
        "Each caller awaits the shared flight. An abort answers that caller CANCELLED at once, unless it is the last waiter of " +
        "an unsettled flight: then it aborts the flight and waits for the flight's own answer.",
    },
    {
      name: "release-key",
      local: "cache",
      about:
        "Finishes the key: resolved when the submit succeeded, the abandon closed the execution, or the error is final; " +
        "otherwise kept for a retry. A failed release is swallowed. The Payment's timing is normalized.",
    },
  ],
  errors: [
    error_CANCELLED,
    error_INVALID_INPUT,
    error_NOT_IMPLEMENTED,
    error_NOT_AUTHENTICATED,
    error_SIGNER_REJECTED,
    error_PROVIDER_ERROR,
    error_PROVIDER_RESPONSE_INVALID,
    error_UNKNOWN,
  ],
  calls: signerCalls,
  spans: [],
  was: [
    `${SDK}/methods.ts:65`,
    `${SDK}/personal-pay.ts:161`,
    `${SDK}/personal-pay.ts:42`,
    `${SDK}/personal-pay.ts:64`,
    `${SDK}/personal-pay.ts:99`,
    `${SDK}/personal-pay.ts:144`,
    `${SDK}/personal-pay.ts:198`,
    `${SDK}/personal-pay.ts:213`,
    `${SDK}/request-keys.ts:67`,
    `${SDK}/execution.ts:180`,
    `${SDK}/execution.ts:104`,
    `${SDK}/execution.ts:65`,
    `${SDK}/execution.ts:234`,
    `${SDK}/execution.ts:243`,
    `${SDK}/execution.ts:263`,
    `${SDK}/prepared-execution.ts:16`,
    `${SDK}/personal-verification.ts:150`,
    `${SDK}/personal-verification.ts:176`,
    `${SDK}/personal-documents.ts:126`,
    `${SDK}/personal-flights.ts:32`,
    `${SDK}/personal-flights.ts:58`,
    `${SDK}/events.ts:63`,
    `${SDK}/execution.ts:112`,
    `${SDK}/execution.ts:212`,
    `${SDK}/execution.ts:221`,
    `${SDK}/prepared-execution.ts:32`,
    `${SDK}/personal-flights.ts:84`,
    `${SDK}/records.ts:134`,
    `${SDK}/send-dates.ts:45`,
    "packages/sdk/src/platform/result-bridge.ts:100",
    "packages/sdk/src/signing/signer.ts:185",
    "packages/sdk/src/access/session-programs.ts:143",
  ],
});

export const flow_client_payments_retry = defineFlow({
  id: "client.payments.retry",
  title: "Retry a personal Payment: prepare its retry, check, sign, submit",
  about:
    "client.payments.retry sends again the whole original cohort of a failed Payment from the caller's own Account. It needs an " +
    "actor, a chain id and a signer (else NOT_IMPLEMENTED payments.executionComposition), then runs executePrepared, the shared " +
    "prepare-check-sign-submit of a prepared command: it fences the auth lifetime after every await, asks the signer for its " +
    "address, prepares the retry scoped to the caller's Account, checks the prepared command (lifecycleCommandCheck: the request's " +
    "fingerprint is the retry intent and its source command is a birth in the Account scope; then the full operation check and, " +
    "for a budget route, the allowance's budget), signs the SafeOp digest and submits it once. A settled replay is checked and " +
    "returned without signing. As is: a lifecycle execution passes closePaymentOnExit false, so a failed check, an abort or a " +
    "signer refusal returns its error without abandoning the prepared execution. No request key, no flight sharing and no " +
    "onPrepared. The retry request carries no items (and the method passes no TelemetryPort), so no payment_transitioned is " +
    "emitted. A budget route on an Account birth is always refused: the birth names no orgId or Permission. The method span is " +
    "payments.retry (runCapxulEffect); the rpcs run under it. Output: the cohort's normalized Payments (records.ts:69), " +
    "Schema.Unknown.",
  component: component_core_sdk,
  sdk: "client.payments.retry",
  input: Schema.Struct({
    paymentId: Schema.String,
    options: Schema.optionalKey(Schema.Struct({ signal: Schema.optionalKey(Schema.Unknown) })),
  }),
  output: Schema.Array(PaymentOut),
  steps: [
    commandSession,
    commandSignerAddress,
    {
      name: "prepare",
      rpc: rpc_payments_lifecycles_prepare_scoped,
      about:
        "Sends { signerAddress, intent: { kind: retry, paymentId }, expectedScope: { kind: account } }; " +
        "raced against the abort signal.",
    },
    {
      name: "verify",
      local: "build",
      about:
        "An undecodable executionId is INVALID_INPUT; then strict decode of PreparedPaymentCommandExecution; lifecycleCommandCheck: " +
        "the request's fingerprint is the retry intent and its source command a birth in the Account scope, else INVALID_INPUT " +
        "prepared command mismatch. Nothing is abandoned.",
    },
    commandCheckOperation,
    retryBudgetRoute,
    commandReplay,
    commandSignRetry,
    commandSubmit,
  ],
  errors: [
    error_NOT_IMPLEMENTED,
    error_CANCELLED,
    error_NOT_AUTHENTICATED,
    error_INVALID_INPUT,
    error_SIGNER_REJECTED,
    error_PROVIDER_ERROR,
    error_PROVIDER_RESPONSE_INVALID,
    error_UNKNOWN,
  ],
  calls: signerCalls,
  spans: ["payments.retry"],
  was: [
    `${SDK}/methods.ts:66`,
    `${SDK}/lifecycle-methods.ts:14`,
    `${SDK}/lifecycle-methods.ts:58`,
    `${SDK}/lifecycle-execution.ts:85`,
    `${SDK}/lifecycle-execution.ts:44`,
    `${SDK}/lifecycle-execution.ts:120`,
    `${SDK}/command-execution.ts:80`,
    `${SDK}/command-execution.ts:160`,
    `${SDK}/command-execution.ts:188`,
    `${SDK}/command-execution.ts:226`,
    `${SDK}/command-execution.ts:245`,
    `${SDK}/prepared-execution.ts:96`,
    `${SDK}/prepared-command-checks.ts:102`,
    `${SDK}/prepared-command-checks.ts:20`,
    `${SDK}/operation-verification.ts:104`,
    `${SDK}/budget-route.ts:97`,
    `${SDK}/budget-route.ts:52`,
    `${SDK}/lifecycle-methods.ts:15`,
    "packages/sdk/src/platform/capxul-effect.ts:166",
  ],
});

export const flow_client_payments_subscribe = defineFlow({
  id: "client.payments.subscribe",
  title: "Watch one personal Payment: live query invalidates fresh reads",
  about:
    "client.payments.subscribe streams snapshots of one of the caller's Payments to a listener until unsubscribe, abort, an auth " +
    "change or a terminal error (subscribeFreshQuery). Cached values from a live Convex subscription to payments.records.get only " +
    "invalidate: truth is published from one actor-bound fresh read at a time (CAP-603). A cached value equal to the last " +
    "published fresh value starts no read; a read that a newer cached value superseded runs again unless it returned that same " +
    "value. A lost connection publishes NETWORK_ERROR and forgets the fresh value; reconnecting reads again. A null after a " +
    "readable Payment fails the stream (Payment is no longer readable). Snapshots: loading, ok (Payment or null) or error; a " +
    "listener that throws changes nothing. The SDK opens a payments.subscribe span for the setup, until the subscription is open, " +
    "and another for each fresh read (runPortEffect delegates to runCapxulEffect). As is: the personal path does not decode the " +
    "paymentId before subscribing (the Organization path does). Output: the unsubscribe function, Schema.Unknown.",
  component: component_core_sdk,
  sdk: "client.payments.subscribe",
  input: SubscribeInput,
  output: Schema.Unknown,
  steps: [
    {
      name: "admit",
      local: "cache",
      about:
        "Refuses an aborted signal (CANCELLED), no actor (NOT_IMPLEMENTED payments.subscribe), a signed-out actor or a stale " +
        "auth lifetime (NOT_AUTHENTICATED); registers auth-invalidation and abort listeners and publishes loading.",
    },
    {
      name: "subscribe",
      rpc: rpc_payments_records_get,
      about:
        "Opens the live Convex subscription to the row with { paymentId } and a connection-change observer; a cached value " +
        "whose id is another Payment fails the stream (INVALID_INPUT, scope does not match).",
    },
    {
      name: "compare",
      local: "cache",
      about:
        "Keys each cached value as JSON (an int64 keeps its type, bytes have no key); one equal to the last published fresh " +
        "value is dropped, any other invalidates and starts or queues the fresh read.",
    },
    {
      name: "fresh-read",
      rpc: rpc_payments_records_get,
      about:
        "The same row read past the client cache (fresh: true), one at a time and abortable; NETWORK_ERROR is published " +
        "and the stream stays open, any other error fails it.",
    },
    {
      name: "publish",
      local: "build",
      about:
        "Decodes the reply as a Payment (unknown keys dropped, ADR-0039 D2), checks its id, normalizes its timing and " +
        "publishes ok; null is published only before any readable value.",
    },
    {
      name: "hold",
      local: "wait",
      about:
        "Holds the stream until the caller unsubscribes, the signal aborts, the identity is invalidated or a terminal error; " +
        "then aborts the read in flight and closes the subscription.",
    },
  ],
  errors: [error_CANCELLED, error_NOT_IMPLEMENTED, error_NOT_AUTHENTICATED, error_INVALID_INPUT, error_NETWORK_ERROR],
  calls: [],
  spans: ["payments.subscribe"],
  was: [
    `${SDK}/methods.ts:52`,
    `${SDK}/subscription.ts:43`,
    `${SDK}/subscription.ts:96`,
    `${SDK}/subscription.ts:135`,
    `${SDK}/fresh-query.ts:37`,
    `${SDK}/fresh-query.ts:68`,
    `${SDK}/fresh-query.ts:107`,
    `${SDK}/fresh-query.ts:170`,
    `${SDK}/fresh-query.ts:199`,
    `${SDK}/fresh-query.ts:239`,
    "packages/sdk/src/platform/actor-bridge.ts:149",
  ],
});

// ── client.org(orgId).payments ─────────────────────────────────────────────────────────────

export const flow_client_org_payments_pay = defineFlow({
  id: "client.org.payments.pay",
  title: "Pay one Organization Payment under a Permission",
  about:
    "client.org(orgId).payments.pay sends one Payment from the Organization's Safe under the Permission (an allowance, or a " +
    "department dep_…) it names. It wraps the item as a one-item batch and runs the Organization batch path " +
    "(executeOrganizationBatch, single), so a refusal names the caller's own field rather than items.0. The batch path decodes " +
    "the intent, takes a send-once request key, shares one in-flight submission per (scope, actor, orgId, key) inside the " +
    "bundle, then runs executePrepared over payments.commands.prepare-organization: the prepared request's fingerprint must be " +
    "the intent, the operation is checked in full and a budget route is bound to the Permission's budget, before the SafeOp " +
    "digest is signed and submitted once. Unlike a lifecycle, it abandons the prepared execution on a failed check, an abort or " +
    "a signer refusal. A batch that answers no Payment is UNKNOWN. Its own cancel errors name operation organization-pay, those " +
    "of executePrepared name payments. The method span is organizationPayments.pay (runCapxulEffect), not the org.payments.pay " +
    "name the observability tree also declares. Only the flight starter's controls reach the rpcs (its span is their parent); " +
    "a joined caller contributes only its signal and onPrepared. timeoutMs and deadlineMs bound nothing but the session read " +
    "while it restores. Output: the normalized Payment (records.ts:69), Schema.Unknown.",
  component: component_core_sdk,
  sdk: "client.org(orgId).payments.pay",
  input: Schema.Struct({
    input: Schema.Struct({
      ...OrganizationItem,
      permissionId: Schema.String,
      requestKey: Schema.optionalKey(Schema.String),
      lineage: Schema.optionalKey(Schema.Unknown),
    }),
    options: PayOptions,
  }),
  output: PaymentOut,
  steps: organizationBatchSteps(true),
  errors: [
    error_INVALID_INPUT,
    error_CANCELLED,
    error_NOT_IMPLEMENTED,
    error_NOT_AUTHENTICATED,
    error_SIGNER_REJECTED,
    error_PROVIDER_ERROR,
    error_PROVIDER_RESPONSE_INVALID,
    error_UNKNOWN,
  ],
  calls: signerCalls,
  spans: ["organizationPayments.pay"],
  was: [
    `${SDK}/organization-payments.ts:96`,
    `${SDK}/organization-payments.ts:103`,
    `${SDK}/organization-payments.ts:114`,
    `${SDK}/organization-payments.ts:122`,
    `${SDK}/organization-payments.ts:127`,
    `${SDK}/organization-flights.ts:69`,
    `${SDK}/organization-flights.ts:109`,
    `${SDK}/organization-flights.ts:182`,
    `${SDK}/organization-flights.ts:198`,
    `${SDK}/organization-payment-requests.ts:136`,
    `${SDK}/organization-payment-requests.ts:195`,
    `${SDK}/lifecycle-execution.ts:162`,
    `${SDK}/lifecycle-execution.ts:190`,
    `${SDK}/command-execution.ts:80`,
    `${SDK}/command-execution.ts:121`,
    `${SDK}/prepared-execution.ts:81`,
    `${SDK}/prepared-execution.ts:52`,
    `${SDK}/prepared-command-checks.ts:84`,
    `${SDK}/budget-route.ts:19`,
    `${SDK}/budget-route.ts:31`,
    `${SDK}/prepared-execution.ts:115`,
    `${SDK}/command-execution.ts:208`,
    "packages/sdk/src/organizations/scope.ts:195",
    "packages/sdk/src/platform/capxul-effect.ts:19",
    "packages/observability/src/operations/org.ts:147",
  ],
});

export const flow_client_org_payments_pay_batch = defineFlow({
  id: "client.org.payments.pay-batch",
  title: "Pay a batch of Organization Payments in one signed operation",
  about:
    "client.org(orgId).payments.payBatch sends every item in one prepared command and one signed UserOperation from the " +
    "Organization's Safe, under one Permission. Every item is sent at one time: items that name two send dates are refused. It " +
    "runs the same batch path as pay (executeOrganizationBatch, operation organization-pay-batch) and answers every Payment the " +
    "command carries. A refusal names items.<n>.<field>. One payment_transitioned (initiated) is emitted per item when the " +
    "backend asks. The method span is organizationPayments.payBatch (runCapxulEffect), not the org.payments.payBatch name the " +
    "observability tree also declares. Output: the normalized Payments (records.ts:69), Schema.Unknown.",
  component: component_core_sdk,
  sdk: "client.org(orgId).payments.payBatch",
  input: Schema.Struct({
    input: Schema.Struct({
      permissionId: Schema.String,
      requestKey: Schema.optionalKey(Schema.String),
      items: Schema.Array(Schema.Struct(OrganizationItem)),
      lineage: Schema.optionalKey(Schema.Unknown),
    }),
    options: PayOptions,
  }),
  output: Schema.Array(PaymentOut),
  steps: organizationBatchSteps(false),
  errors: [
    error_INVALID_INPUT,
    error_CANCELLED,
    error_NOT_IMPLEMENTED,
    error_NOT_AUTHENTICATED,
    error_SIGNER_REJECTED,
    error_PROVIDER_ERROR,
    error_PROVIDER_RESPONSE_INVALID,
    error_UNKNOWN,
  ],
  calls: signerCalls,
  spans: ["organizationPayments.payBatch"],
  was: [
    `${SDK}/organization-payments.ts:131`,
    `${SDK}/organization-payments.ts:39`,
    `${SDK}/organization-payments.ts:147`,
    `${SDK}/organization-flights.ts:69`,
    `${SDK}/organization-flights.ts:135`,
    `${SDK}/organization-flights.ts:204`,
    `${SDK}/organization-payment-requests.ts:136`,
    `${SDK}/organization-payment-requests.ts:166`,
    `${SDK}/lifecycle-execution.ts:162`,
    `${SDK}/command-execution.ts:80`,
    `${SDK}/prepared-execution.ts:52`,
  ],
});

export const flow_client_org_payments_retry = defineFlow({
  id: "client.org.payments.retry",
  title: "Retry an Organization Payment: prepare its retry, check, sign, submit",
  about:
    "client.org(orgId).payments.retry sends again the original cohort of one of the Organization's failed Payments. It needs " +
    "an actor, a chain id and a signer (else NOT_IMPLEMENTED organizationPayments.executionComposition), then runs " +
    "executePrepared over payments.lifecycles.prepare-scoped with the Organization as the expected scope: the request's " +
    "fingerprint must be the retry intent and its source command a birth in that Organization, and the operation is checked in " +
    "full, with a budget route bound to the birth's Permission. Unlike the personal retry it takes onPrepared, wrapped so a " +
    "caller's abort answers CANCELLED (operation organizationPayments.retry). As is: closePaymentOnExit is false, so a failed " +
    "check, an abort or a signer refusal abandons nothing; no request key and no flight sharing. The method span is " +
    "organizationPayments.retry (runCapxulEffect). Output: the cohort's normalized Payments (records.ts:69), Schema.Unknown.",
  component: component_core_sdk,
  sdk: "client.org(orgId).payments.retry",
  input: Schema.Struct({
    paymentId: Schema.String,
    options: Schema.optionalKey(
      Schema.Struct({ signal: Schema.optionalKey(Schema.Unknown), onPrepared: Schema.optionalKey(Schema.Unknown) }),
    ),
  }),
  output: Schema.Array(PaymentOut),
  steps: [
    commandSession,
    commandSignerAddress,
    {
      name: "prepare",
      rpc: rpc_payments_lifecycles_prepare_scoped,
      about:
        "Sends { signerAddress, intent: { kind: retry, paymentId }, expectedScope: { kind: organization, orgId } } " +
        "under the method span; raced against the abort signal.",
    },
    {
      name: "verify",
      local: "build",
      about:
        "An undecodable executionId is INVALID_INPUT; then strict decode of PreparedPaymentCommandExecution; lifecycleCommandCheck: " +
        "the request's fingerprint is the retry intent and its source command a birth in this Organization, else INVALID_INPUT " +
        "prepared command mismatch. Nothing is abandoned.",
    },
    commandCheckOperation,
    retryBudgetRoute,
    commandReplay,
    {
      name: "on-prepared",
      local: "wait",
      about:
        "Hands the verified paymentIds to the caller's onPrepared and waits for it, or answers CANCELLED when the caller " +
        "aborts first; a callback that throws answers its error (UNKNOWN unless a CapxulError). A settled replay is returned " +
        "after this, without signing.",
    },
    commandSignRetry,
    commandSubmit,
  ],
  errors: [
    error_NOT_IMPLEMENTED,
    error_CANCELLED,
    error_NOT_AUTHENTICATED,
    error_INVALID_INPUT,
    error_SIGNER_REJECTED,
    error_PROVIDER_ERROR,
    error_PROVIDER_RESPONSE_INVALID,
    error_UNKNOWN,
  ],
  calls: signerCalls,
  spans: ["organizationPayments.retry"],
  was: [
    `${SDK}/organization-payments.ts:48`,
    `${SDK}/organization-payments.ts:59`,
    `${SDK}/organization-payments.ts:62`,
    `${SDK}/organization-payments.ts:74`,
    `${SDK}/organization-payments.ts:92`,
    `${SDK}/lifecycle-execution.ts:85`,
    `${SDK}/lifecycle-execution.ts:108`,
    `${SDK}/lifecycle-execution.ts:120`,
    `${SDK}/command-execution.ts:80`,
    `${SDK}/command-execution.ts:206`,
    `${SDK}/prepared-execution.ts:96`,
    `${SDK}/budget-route.ts:97`,
  ],
});

export const flow_client_org_payments_subscribe = defineFlow({
  id: "client.org.payments.subscribe",
  title: "Watch one Organization Payment: live query invalidates fresh reads",
  about:
    "client.org(orgId).payments.subscribe streams snapshots of one of the Organization's Payments, as the personal subscribe " +
    "does (subscribeFreshQuery), over payments.records.get-for-organization. It decodes the paymentId first (INVALID_INPUT, " +
    "Provide one exact Payment ID), before any span opens. Every value is the backend-authorized wrapper { orgId, payment }: an " +
    "orgId other than the bundle's fails the stream, as INVALID_INPUT paymentId (scope does not match for a cached value, " +
    "invalid subscription value for a fresh one) whose cause is the orgId refusal; a key a later backend adds is dropped. The SDK opens an " +
    "org.payments.subscribe span for the setup and another for each fresh read. Output: the unsubscribe function, Schema.Unknown.",
  component: component_core_sdk,
  sdk: "client.org(orgId).payments.subscribe",
  input: SubscribeInput,
  output: Schema.Unknown,
  steps: [
    {
      name: "admit",
      local: "cache",
      about:
        "Decodes paymentId (INVALID_INPUT); refuses an aborted signal (CANCELLED), no actor (NOT_IMPLEMENTED payments.subscribe), " +
        "a signed-out actor or a stale auth lifetime (NOT_AUTHENTICATED); registers listeners and publishes loading.",
    },
    {
      name: "subscribe",
      rpc: rpc_payments_records_get_for_organization,
      about:
        "Opens the live Convex subscription to the row with { orgId, paymentId }; a cached wrapper for another Organization " +
        "or another Payment fails the stream (INVALID_INPUT).",
    },
    {
      name: "compare",
      local: "cache",
      about:
        "Keys each cached value as JSON; one equal to the last published fresh value is dropped, any other invalidates and " +
        "starts or queues the fresh read.",
    },
    {
      name: "fresh-read",
      rpc: rpc_payments_records_get_for_organization,
      about:
        "The same row read past the client cache (fresh: true), one at a time and abortable; NETWORK_ERROR is published " +
        "and the stream stays open, any other error fails it.",
    },
    {
      name: "publish",
      local: "build",
      about:
        "Unwraps { orgId, payment } (orgId must be the bundle's), decodes the Payment (unknown keys dropped), checks its id, " +
        "normalizes its timing and publishes ok; null only before any readable value.",
    },
    {
      name: "hold",
      local: "wait",
      about:
        "Holds the stream until the caller unsubscribes, the signal aborts, the identity is invalidated or a terminal error; " +
        "then aborts the read in flight and closes the subscription.",
    },
  ],
  errors: [error_INVALID_INPUT, error_CANCELLED, error_NOT_IMPLEMENTED, error_NOT_AUTHENTICATED, error_NETWORK_ERROR],
  calls: [],
  spans: ["org.payments.subscribe"],
  was: [
    `${SDK}/organization-payment-reads.ts:119`,
    `${SDK}/organization-payment-reads.ts:128`,
    `${SDK}/subscription.ts:66`,
    `${SDK}/subscription.ts:73`,
    `${SDK}/subscription.ts:87`,
    `${SDK}/fresh-query.ts:37`,
    `${SDK}/fresh-query.ts:239`,
    "packages/sdk/src/platform/actor-bridge.ts:149",
  ],
});

// ── client.approvals ───────────────────────────────────────────────────────────────────────
//
// client.approvals.prepare is the accounts folder's method (packages/sdk/src/accounts/approvals.ts:106), but the CLI's
// payment send (personal and --org), retry, cancel and reschedule run it, and flows.ts owns every flow id. A step that
// calls a row of another concept (accounts, permissions, payroll, organizations) is a local step described in words:
// no file of this book owns those rows.

const ACCOUNTS = "packages/sdk/src/accounts";

/** `ApprovalInput` (approval-records.ts:16): one shape per branch the method dispatches on. */
const ApprovalInput = Schema.Union([
  /** RetryApprovalInput (command-approvals.ts:38). */
  Schema.Struct({ retry: Schema.String, organizationId: Schema.optionalKey(Schema.String) }),
  /** CancelApprovalInput (command-approvals.ts:48). */
  Schema.Struct({
    cancel: Schema.String,
    organizationId: Schema.optionalKey(Schema.String),
    requestKey: Schema.optionalKey(Schema.String),
  }),
  /** RescheduleApprovalInput (command-approvals.ts:60). */
  Schema.Struct({ reschedule: Schema.String, on: Schema.String, organizationId: Schema.optionalKey(Schema.String) }),
  /** RequestApprovalInput (command-approvals.ts:67): the RequestPaymentConfirmation is too deep to transcribe. */
  Schema.Struct({ request: Schema.Unknown }),
  /** PayrollRunApprovalInput (command-approvals.ts:72): the AuthorizeRunInput is the payroll concept's. */
  Schema.Struct({ organizationId: Schema.String, payrollRun: Schema.Unknown }),
  /** PermissionApprovalInput (permission-approvals.ts:41): the PermissionWrite is the permissions concept's. */
  Schema.Struct({ organizationId: Schema.String, permission: Schema.Unknown, onPrepared: Schema.optionalKey(Schema.Unknown) }),
  /** InvitationApprovalInput (permission-approvals.ts:54): the InviteInput is the organizations concept's. */
  Schema.Struct({ organizationId: Schema.String, invite: Schema.Unknown, onPrepared: Schema.optionalKey(Schema.Unknown) }),
  /** OrganizationApprovalInput (organization-approvals.ts:35): one item under a Permission. */
  Schema.Struct({
    organizationId: Schema.String,
    permissionId: Schema.String,
    requestKey: Schema.optionalKey(Schema.String),
    lineage: Schema.optionalKey(Schema.Unknown),
    ...OrganizationItem,
  }),
  /** PaymentsPayInput: a personal Payment. */
  Schema.Struct(PersonalPayment),
]);

export const flow_client_approvals_prepare = defineFlow({
  id: "client.approvals.prepare",
  title: "Prepare a Payment or a lifecycle step and open its approval",
  about:
    "client.approvals.prepare prepares one operation for the signer the backend recorded when the person's Safe was claimed, " +
    "checks it as the signed path does and opens its approval. Nothing is signed or sent: the person signs on approval.url, " +
    "and the CLI then follows it (client.approvals.wait). It dispatches on the input's keys: retry, cancel or reschedule " +
    "(payments.lifecycles.prepare-scoped), request (payments.commands.prepare-request), payrollRun (payroll.runs.authorize), " +
    "invite, permission, organizationId (payments.commands.prepare-organization), else a personal Payment " +
    "(payments.commands.prepare). Every branch but invite loads the caller's Safe (accounts.safes.loadByAuthUserId), prepares " +
    "for its recorded signer, checks the prepared execution and opens the approval (accounts.approvals.request); a Payment to a " +
    "party account (a bank payout) is then read back and checked against its quote. The invitation and Permission branches " +
    "are other concepts' compositions, named here and not booked. As is: the method is mounted without runCapxulEffect " +
    "(financial-ops.ts:89) and runIfActive without an observer opens no span, so it opens no SDK span and its rpcs carry no " +
    "client traceparent. The personal and Organization branches take the caller's requestKey as is or a fresh pay_<uuid>, " +
    "with no send-once store and no flight sharing, unlike client.payments.pay. A failed lifecycle or request check is " +
    "returned without abandoning the prepared execution; a failed Organization, personal, payroll or Permission check, a " +
    "failed open and a mismatched bank approval abandon it. The Safe load reads the held session without waiting while it " +
    "restores. The approval open, the abandons and the bank reads are not raced against the abort signal. Input: ApprovalInput " +
    "(approval-records.ts:16) and { signal }. Output: the Approval (protocol accounts/approval-schema), too deep to " +
    "transcribe, so Schema.Unknown; every error arrives as a CapxulResult failure.",
  component: component_core_sdk,
  sdk: "client.approvals.prepare",
  input: Schema.Struct({
    input: ApprovalInput,
    options: Schema.optionalKey(Schema.Struct({ signal: Schema.optionalKey(Schema.Unknown) })),
  }),
  output: Schema.Unknown,
  steps: [
    {
      name: "route",
      local: "build",
      about:
        "Dispatches on the input's keys in this order: retry, cancel, reschedule, request or payrollRun; invite (the " +
        "organizations' proposeInvitation authors and proposes it and returns its approval: no step below runs); permission; " +
        "organizationId; else a personal Payment.",
    },
    {
      name: "personal-intent",
      local: "build",
      about:
        "Personal only, before any network: paymentExecutionIntent refuses lineItems, an unreadable on, on with timing and held " +
        "timing (INVALID_INPUT), an Organization actor (NOT_IMPLEMENTED) and an input the strict intent schema refuses " +
        "(INVALID_INPUT naming the field).",
    },
    {
      name: "session",
      local: "cache",
      about:
        "openApproval reads the held auth session without waiting while it restores; no actor or chain id is NOT_IMPLEMENTED " +
        "(approvals.prepareComposition); no session is NOT_AUTHENTICATED, or the faulted session read's own error.",
    },
    {
      name: "load-safe",
      local: "build",
      about:
        "accounts.safes.loadByAuthUserId { authUserId }, fresh and raced against the signal: an accounts row. Null is " +
        "SMART_ACCOUNT_MISSING; no signerAddress is WRONG_STATE (unclaimed). That recorded signer is prepared for; the " +
        "client's own signer is never asked.",
    },
    {
      name: "lifecycle-intent",
      local: "build",
      about:
        "Retry, cancel or reschedule: the intent { kind, paymentId }; a cancel carries the caller's requestKey or cancel_<uuid>; " +
        "a reschedule's on must be a UTC day or an ISO time with its zone (scheduledOn), else INVALID_INPUT on.",
    },
    {
      name: "prepare-lifecycle",
      rpc: rpc_payments_lifecycles_prepare_scoped,
      about:
        "Sends { signerAddress, intent, expectedScope }: { kind: account }, or { kind: organization, orgId } with " +
        "organizationId; raced against the signal.",
    },
    {
      name: "request-confirmation",
      local: "build",
      about:
        "Request only: strict decode of the RequestPaymentConfirmation (INVALID_INPUT confirmation); a streamed release is " +
        "refused; an invoice takes its send-once key through the requests folder's withInvoiceRequestKey.",
    },
    {
      name: "prepare-request",
      rpc: rpc_payments_commands_prepare_request,
      about: "Sends { confirmation, signerAddress }; raced against the signal.",
    },
    {
      name: "authorize-run",
      local: "build",
      about:
        "payrollRun only: decodes the run input (a refusal keeps its code, else UNKNOWN), then payroll.runs.authorize { orgId, " +
        "permissionId, asset, requestKey or payroll_<uuid>, signerAddress, period, items }, raced against the signal: a payroll row.",
    },
    {
      name: "check-command",
      local: "build",
      about:
        "Re-reads the held session (none, or no chain id: NOT_AUTHENTICATED); lifecycleCommandCheck, the request's check or " +
        "isAuthorizedRunBatch, then verifiedPreparedCommand; no budget-route check. Else INVALID_INPUT execution (prepared " +
        "command mismatch); a lifecycle or request is not abandoned.",
    },
    {
      name: "permission-write",
      local: "build",
      about:
        "permission only: re-reads the session, builds and checks the command, prepares it through " +
        "permissions.commands.prepareExecution or permissions.replacements.prepareExecution (permissions rows), verifies it and " +
        "hands it to onPrepared.",
    },
    {
      name: "organization-intent",
      local: "build",
      about:
        "organizationId only: organizationPaymentIntent decodes the item as a one-item batch (INVALID_INPUT naming the " +
        "caller's field); re-reads the session (none, or no chain id: NOT_AUTHENTICATED); the key is the caller's or pay_<uuid>.",
    },
    {
      name: "prepare-organization",
      rpc: rpc_payments_commands_prepare_organization,
      about: "Sends the intent with its requestKey and signerAddress; raced against the signal.",
    },
    {
      name: "check-organization",
      local: "build",
      about:
        "matchesIntent, verifiedPreparedCommand, then a budget route's budget must be the active allowance's " +
        "(permissions.allowances.list) or department's (payroll.departments.get); a failed read counts as unbound. Else " +
        "INVALID_INPUT execution, abandoned.",
    },
    {
      name: "personal-prepare",
      local: "cache",
      about:
        "Personal only: no actor or chain id is NOT_IMPLEMENTED; sessionForWrite waits while the session restores (none is " +
        "NOT_AUTHENTICATED); the expected Safe is derived from its email; the key is the caller's requestKey or pay_<uuid>.",
    },
    {
      name: "prepare",
      rpc: rpc_payments_commands_prepare,
      about: "Sends { requestKey, signerAddress, payment }; raced against the signal. A refusal is returned as it is.",
    },
    {
      name: "check-personal",
      local: "build",
      about:
        "An undecodable executionId is INVALID_INPUT, nothing abandoned; then strict decode of PreparedPaymentExecution; request " +
        "key and canonical intent, chain, signer, Safe, document, operation, settled replay. A mismatch is INVALID_INPUT, abandoned.",
    },
    {
      name: "close-mismatch",
      rpc: rpc_payments_executions_abandon,
      about:
        "On a failed Organization, personal or Permission check, or a payroll run's unless its replay was accepted: reason " +
        "prepared_mismatch. True marks the error closed, false returns it as it is, and a failed abandon replaces it.",
    },
    {
      name: "initiated",
      local: "build",
      about:
        "After a verified personal or Organization preparation, when the backend sets emitPaymentInitiated: one " +
        "payment_transitioned (initiated) per Payment through the TelemetryPort, awaited, before the approval opens; failures " +
        "are swallowed.",
    },
    {
      name: "open-approval",
      local: "build",
      about:
        "accounts.approvals.request { executionId }: an accounts row. An approval that names another execution is " +
        "INVALID_INPUT approval; a failed open returns its own error.",
    },
    {
      name: "close-unopened",
      rpc: rpc_payments_executions_abandon,
      about:
        "After the open: reason prepared_mismatch when the approval names another execution, cancelled when the open failed, " +
        "so no execution holds the Safe's nonce without an approval.",
    },
    {
      name: "bank-read",
      rpc: rpc_payments_records_get,
      about:
        "A personal Payment to a party account only, once its approval opened: each of the approval's Payments, read fresh. A " +
        "null read is INVALID_INPUT organizationId, another id INVALID_INPUT paymentId; a failed read returns its error, " +
        "nothing abandoned.",
    },
    {
      name: "bank-read-organization",
      rpc: rpc_payments_records_get_for_organization,
      about:
        "The same read for an Organization Payment to a party account, with { orgId, paymentId }; a null read or a reply for " +
        "another orgId or Payment is INVALID_INPUT paymentId.",
    },
    {
      name: "bank-check",
      local: "build",
      about:
        "The approval must be a bank_payout of one Payment to the same party account and quote, with the asked amount in its " +
        "summary and in the stored Payment, and a recipient warning shown as RECIPIENT_ON_CAPXUL; else INVALID_INPUT approval.",
    },
    {
      name: "close-bank",
      rpc: rpc_payments_executions_abandon,
      about: "A bank approval that fails the check: reason prepared_mismatch. Only the execution is abandoned; no approvals row is called.",
    },
  ],
  errors: [
    error_NOT_IMPLEMENTED,
    error_NOT_AUTHENTICATED,
    error_SMART_ACCOUNT_MISSING,
    error_WRONG_STATE,
    error_INVALID_INPUT,
    error_CANCELLED,
    error_UNKNOWN,
  ],
  calls: [],
  spans: [],
  was: [
    `${ACCOUNTS}/approvals.ts:106`,
    `${ACCOUNTS}/approval-records.ts:58`,
    "packages/sdk/src/platform/client/financial-ops.ts:89",
    `${ACCOUNTS}/approvals.ts:108`,
    `${ACCOUNTS}/approvals.ts:113`,
    `${ACCOUNTS}/approvals.ts:117`,
    `${ACCOUNTS}/approvals.ts:124`,
    `${ACCOUNTS}/approvals.ts:132`,
    `${SDK}/records.ts:139`,
    `${ACCOUNTS}/approvals.ts:67`,
    `${ACCOUNTS}/approvals.ts:72`,
    `${ACCOUNTS}/approvals.ts:74`,
    "packages/sdk/src/platform/actor-bridge.ts:199",
    `${ACCOUNTS}/approvals.ts:75`,
    `${ACCOUNTS}/approvals.ts:83`,
    `${ACCOUNTS}/approvals.ts:87`,
    "packages/protocol/src/accounts/operations.ts:81",
    `${ACCOUNTS}/command-approvals.ts:129`,
    `${ACCOUNTS}/command-approvals.ts:137`,
    `${ACCOUNTS}/command-approvals.ts:149`,
    `${SDK}/send-dates.ts:19`,
    `${ACCOUNTS}/command-approvals.ts:173`,
    `${ACCOUNTS}/command-approvals.ts:186`,
    `${ACCOUNTS}/command-approvals.ts:206`,
    `${ACCOUNTS}/command-approvals.ts:249`,
    `${ACCOUNTS}/command-approvals.ts:268`,
    `${ACCOUNTS}/command-approvals.ts:85`,
    `${ACCOUNTS}/command-approvals.ts:115`,
    `${SDK}/lifecycle-execution.ts:44`,
    `${SDK}/prepared-command-checks.ts:102`,
    `${ACCOUNTS}/permission-approvals.ts:67`,
    `${ACCOUNTS}/permission-approvals.ts:162`,
    `${ACCOUNTS}/organization-approvals.ts:40`,
    `${SDK}/organization-payment-requests.ts:136`,
    `${ACCOUNTS}/organization-approvals.ts:62`,
    `${ACCOUNTS}/organization-approvals.ts:74`,
    `${SDK}/budget-route.ts:19`,
    `${ACCOUNTS}/organization-approvals.ts:91`,
    `${ACCOUNTS}/approvals.ts:138`,
    `${SDK}/execution.ts:104`,
    `${SDK}/execution.ts:112`,
    `${SDK}/execution.ts:128`,
    `${SDK}/execution.ts:145`,
    `${SDK}/prepared-execution.ts:16`,
    `${SDK}/execution.ts:162`,
    `${SDK}/prepared-execution.ts:52`,
    `${ACCOUNTS}/approvals.ts:96`,
    `${ACCOUNTS}/approvals.ts:98`,
    `${ACCOUNTS}/approvals.ts:103`,
    "packages/protocol/src/accounts/operations.ts:164",
    `${ACCOUNTS}/bank-approvals.ts:12`,
    `${ACCOUNTS}/organization-approvals.ts:131`,
    `${ACCOUNTS}/bank-approvals.ts:56`,
    "packages/sdk/src/platform/result-bridge.ts:100",
    "packages/sdk/src/platform/transport/call-operation.ts:67",
  ],
});

// ── Methods that forward one rpc: no flow; the operation names the rpc ───────────────────────
//
// client.payments.quote                  → payments.quotes.quote, actor { kind: account }; annotates its span with
//                                          party_account_id (quotes.ts:23). The row is implemented by the banking
//                                          concept (packages/backend/src/banking/payouts/operations/quote.ts).
// client.payments.payoutStage            → payments.records.payout-stage, actor { kind: account }; decodes paymentId
//                                          first (INVALID_INPUT) and refuses an answer naming another Payment with
//                                          PROVIDER_RESPONSE_INVALID (payout-stage.ts:28, :47).
// client.payments.list                   → payments.records.list; normalizes each Payment's timing (methods.ts:68).
// client.payments.get                    → payments.records.get; normalizes the Payment's timing (methods.ts:84).
// client.org(orgId).payments.quote       → payments.quotes.quote, actor { kind: org, orgId } (organization-payments.ts:46).
// client.org(orgId).payments.payoutStage → payments.records.payout-stage, actor { kind: org, orgId }
//                                          (organization-payments.ts:47).
// client.org(orgId).payments.previewRetry → payments.lifecycles.preview-retry; decodes paymentId and refuses a preview
//                                          for another Organization, without the id, with duplicate ids or a Payment
//                                          that is not outgoing (INVALID_INPUT) (organization-payment-reads.ts:39).
// client.org(orgId).payments.list        → payments.records.list-for-organization; refuses a page for another orgId
//                                          (organization-payment-reads.ts:73).
// client.org(orgId).payments.get         → payments.records.get-for-organization; decodes paymentId, refuses a reply
//                                          for another orgId or Payment (organization-payment-reads.ts:92).
//
// Not booked here, because no client.payments method mounts them: the door's compositions that other SDK folders
// run under their own methods. executeRequestPayment (lifecycle-execution.ts:128: payments.commands.prepare-request,
// then payments.executions.submit-command, no abandon) is run by requests/inboxes.ts:197; executePrepared
// (command-execution.ts:80) is run by payroll/run-authorization.ts:78 and requests/checkout-payments.ts:134, :212;
// prepareVerifiedPersonalPayment (execution.ts:104: payments.commands.prepare and the personal check, no signing) is
// run by accounts/approvals.ts:141 under client.approvals.prepare, booked above as flow_client_approvals_prepare
// because the payment commands run it.
//
// The old operation book names client.payments.cancel and client.payments.reschedule
// (apps/docs/factory/operations/payment.cancel.yaml:41, payment.reschedule.yaml:37), but PaymentsMethods has no such
// methods (methods.ts:28); both books' own sdk line is client.approvals.prepare. The lifecycle intents cancel and
// reschedule (lifecycle-execution.ts:24) are typed but no client.payments method sends them.
