// The as-is Core SDK flows of the old payroll concept: every public method of
// `client.org(orgId).payroll`, `client.org(orgId).departments`, `client.org(orgId).agreements` and the
// payee bundle `client.agreements` (the same object is mounted at `client.me.agreements`,
// platform/client/financial-ops.ts:78) that composes more than one backend call or does local work
// (packages/sdk/src/payroll/). Methods that forward one rpc are listed in the comment at the end of
// this file, with the rpc each forwards.
//
// Every method but subscribeRun and authorizeRun runs inside `owning` (owning-calls.ts:49): it refuses
// an already aborted signal (CANCELLED), opens one span named after the backend row, carries the
// caller's parent span into each call (`hop`), and may mark the Organization verified. A write's own
// check runs after the backend prepared it: a failed check returns its error and leaves what the
// backend recorded (a Director proposal, an open approval) as it is.
//
// Paths in `was` are relative to the old repository root (/home/user/factory).

import { Schema } from "effect";
import { defineFlow, type FlowSpec, type Ref } from "../../../packages/book/src/index.ts";
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
  error_TRANSACTION_FAILED,
  error_UNKNOWN,
  error_WRONG_STATE,
} from "../shared/vocabulary.ts";
import { rpc_payroll_runs_authorize, rpc_payroll_runs_get } from "./runs.ts";
import {
  rpc_payroll_departments_add_holder,
  rpc_payroll_departments_close,
  rpc_payroll_departments_create,
  rpc_payroll_departments_freeze_ceiling,
  rpc_payroll_departments_get,
  rpc_payroll_departments_remove_holder,
  rpc_payroll_departments_reopen,
  rpc_payroll_departments_set_budget,
  rpc_payroll_departments_set_ceiling,
  rpc_payroll_departments_unfreeze_ceiling,
} from "./departments.ts";
import {
  rpc_payroll_agreements_accept,
  rpc_payroll_agreements_cancel_change,
  rpc_payroll_agreements_change,
  rpc_payroll_agreements_collect,
  rpc_payroll_agreements_end,
  rpc_payroll_agreements_get,
  rpc_payroll_agreements_offer,
  rpc_payroll_agreements_organization_accept,
  rpc_payroll_agreements_organization_collect,
  rpc_payroll_agreements_organization_show,
  rpc_payroll_agreements_pause,
  rpc_payroll_agreements_resume,
  rpc_payroll_agreements_show,
  rpc_payroll_agreements_withdraw,
} from "./agreements.ts";
import { rpc_payments_executions_abandon, rpc_payments_executions_submit_command } from "../payments/executions.ts";
import { rpc_payments_commands_prepare_organization } from "../payments/commands.ts";
import { rpc_organizations_proposals_request_approval } from "../organizations/proposals.ts";

type Steps = (typeof FlowSpec.Type)["steps"];

const SDK = "packages/sdk/src/payroll";
const PAY_SDK = "packages/sdk/src/payments";

const S = Schema.String;
const N = Schema.Number;
const opt = Schema.optionalKey;

/** `InvocationControls` (platform/actor/controls.ts): a signal, time limits and ids, not data. */
const Controls = opt(
  Schema.Struct({
    signal: opt(Schema.Unknown),
    timeoutMs: opt(N),
    deadlineMs: opt(N),
    correlation_id: opt(S),
    journey_id: opt(S),
  }),
);
/** A follow's options: how long to poll, and for a payee until it landed or its Payment settled. */
const WaitOptions = opt(
  Schema.Struct({
    signal: opt(Schema.Unknown),
    timeoutMs: opt(N),
    until: opt(Schema.Literals(["landed", "settled"])),
  }),
);
const Money = Schema.Struct({ asset: S, value: S });

// ── shared steps ───────────────────────────────────────────────────────────────────────────

const owningStep = {
  name: "owning",
  local: "cache",
  about:
    "owning: an aborted signal is CANCELLED before anything; one span named after the backend row; the caller's parent " +
    "span is carried into each call.",
} as const;

const sessionStep = {
  name: "session",
  local: "cache",
  about:
    "sessionForWrite: the held auth session, read first while a saved session is still restoring; none is " +
    "NOT_AUTHENTICATED (noSessionError) or the faulted read's own error.",
} as const;

const requestApprovalStep = {
  name: "request-approval",
  rpc: rpc_organizations_proposals_request_approval,
  about:
    "Opens the proposer's own approval of the checked proposal ({ orgId, proposalId }), so a 1-of-N Safe executes on the " +
    "first approval and a 2-of-2 waits for the other Director.",
} as const;

const departmentCheck = (what: string) =>
  ({
    name: "check",
    local: "build",
    about:
      `Rebuilds ${what} from the backend's plan and the caller's input; anything else is INVALID_INPUT department ` +
      "`proposal mismatch`, another throw UNKNOWN.",
  }) as const;

const pollStep = (row: string) =>
  ({
    name: "poll",
    local: "poll",
    about: `Reads ${row} again every 2 s until the write lands or 180 s (or timeoutMs) pass; the abort signal ends the wait.`,
  }) as const;

const writeErrors = [error_CANCELLED, error_NOT_AUTHENTICATED, error_INVALID_INPUT, error_UNKNOWN];
const pollErrors = [error_CANCELLED, error_WRONG_STATE, error_TRANSACTION_FAILED];

const OWNING_WAS = [`${SDK}/owning-calls.ts:28`, `${SDK}/owning-calls.ts:30`, `${SDK}/owning-calls.ts:49`];

// ── client.org(orgId).payroll ──────────────────────────────────────────────────────────────

export const flow_client_org_payroll_authorize_run = defineFlow({
  id: "client.org.payroll.authorize-run",
  title: "Authorize a payroll run: stable key, prepare, check the batch, sign, submit",
  about:
    "client.org(orgId).payroll.authorizeRun is the one payroll write. It needs an actor, a chain id and a signer (else " +
    "NOT_IMPLEMENTED payroll.executionComposition), decodes the run input (INVALID_INPUT), and takes its request key from " +
    "payments' paymentRequestKeyLifecycle under `<scope>:payroll.runs.authorize`, fingerprinted on { orgId, input } (with " +
    "onRequestKey: { actorId, orgId, input } and the caller's key managed), never a fresh UUID, so a retry replays the same " +
    "command. onRequestKey is awaited; a changed actor then is NOT_AUTHENTICATED. It then rides payments' executePrepared: " +
    "the backend prepares the run and its batch (payroll.runs.authorize), the prepared batch is checked against the run " +
    "the caller asked for (isAuthorizedRunBatch: org, Budget, key, lineage, period, every item's recipient, amount and " +
    "payslip), an accepted replay is returned without signing, else the SafeOp digest is signed and submitted once. A " +
    "failed check, an abort or a signer refusal abandons the execution. onResolved hears `failed` or `settled` for a " +
    "closed or terminal attempt. The key is released on success or a final answer. Output: the run (PayrollRun).",
  component: component_core_sdk,
  sdk: "client.org(orgId).payroll.authorizeRun",
  input: Schema.Struct({
    input: Schema.Struct({
      permissionId: S,
      asset: S,
      period: Schema.Struct({ start: N, end: N }),
      items: Schema.Array(Schema.Unknown),
      requestKey: opt(S),
    }),
    options: opt(
      Schema.Struct({
        signal: opt(Schema.Unknown),
        onRequestKey: opt(Schema.Unknown),
        onResolved: opt(Schema.Unknown),
      }),
    ),
  }),
  output: Schema.Struct({
    id: S,
    status: Schema.Literals(["draft", "authorized", "settled"]),
    periodStart: N,
    periodEnd: N,
    total: Money,
    recipientCount: N,
  }),
  steps: [
    { name: "admit", local: "cache", about: "An aborted signal is CANCELLED; no actor, chain id or signer is NOT_IMPLEMENTED; the input is decoded." },
    {
      name: "request-key",
      local: "cache",
      about: "paymentRequestKeyLifecycle under `<scope>:payroll.runs.authorize`: the caller's key, else one derived from the intent's fingerprint.",
    },
    { name: "on-request-key", local: "wait", about: "Awaits onRequestKey with the key; the signed-in person must still be the same (else NOT_AUTHENTICATED)." },
    { name: "signer-address", local: "sign", about: "CapxulSigner.getAddress(): the owner EOA the run is prepared for; signs nothing." },
    {
      name: "prepare",
      rpc: rpc_payroll_runs_authorize,
      about: "Sends orgId, permissionId, asset, requestKey, signerAddress, period and items, raced against the abort signal.",
    },
    {
      name: "check-batch",
      local: "build",
      about:
        "isAuthorizedRunBatch: the stored run's period is the caller's, and the batch's org, Budget, key, payroll lineage and run id, " +
        "asset and every item match; then executePrepared's operation check. A mismatch is INVALID_INPUT.",
    },
    {
      name: "abandon",
      rpc: rpc_payments_executions_abandon,
      about: "On a failed check, an abort or a signer refusal of an execution no replay accepted: closes it.",
    },
    { name: "sign", local: "sign", about: "CapxulSigner.signUserOpHash(digest) signs the SafeOp digest; skipped for an accepted replay." },
    { name: "submit", rpc: rpc_payments_executions_submit_command, about: "Sends { executionId, signature } once; payments' submission advances the run." },
    { name: "on-resolved", local: "wait", about: "Awaits onResolved(`failed` or `settled`) for a closed or terminal attempt; a throw is swallowed." },
    { name: "release-key", local: "cache", about: "Finishes the key: resolved on success or a final answer, otherwise kept for a retry." },
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
  calls: [integration_openfort.c.getAddress, integration_openfort.c.signUserOpHash],
  spans: ["payroll.runs.authorize"],
  was: [
    `${SDK}/runs.ts:137`,
    `${SDK}/runs.ts:142`,
    `${SDK}/run-authorization.ts:30`,
    `${SDK}/run-authorization.ts:44`,
    `${SDK}/run-authorization.ts:48`,
    `${SDK}/run-authorization.ts:57`,
    `${SDK}/run-authorization.ts:78`,
    `${SDK}/run-authorization.ts:116`,
    `${SDK}/run-authorization.ts:136`,
    `${SDK}/run-authorization.ts:145`,
    `${SDK}/run-checks.ts:88`,
    `${SDK}/run-checks.ts:119`,
    `${PAY_SDK}/command-execution.ts:80`,
  ],
});

export const flow_client_org_payroll_subscribe_run = defineFlow({
  id: "client.org.payroll.subscribe-run",
  title: "Watch one payroll run: live query invalidates fresh reads",
  about:
    "client.org(orgId).payroll.subscribeRun streams snapshots of one run's detail to a listener (subscribeFreshQuery, as " +
    "client.payments.subscribe does): a live Convex subscription to payroll.runs.get only invalidates, and truth is " +
    "published from one fresh read at a time. The org and run id are validated first (INVALID_INPUT, failing the stream " +
    "at once). Each value is decoded as a PayrollRunDetail (INVALID_INPUT `Invalid Payroll run detail`); one for another " +
    "scope is INVALID_INPUT; a null after a readable run fails the stream (`no longer readable`); a lost connection " +
    "publishes NETWORK_ERROR. No actor is NOT_IMPLEMENTED payroll.subscribeRun. Snapshots: loading, ok (detail or null) " +
    "or error. Output: the unsubscribe function, Schema.Unknown.",
  component: component_core_sdk,
  sdk: "client.org(orgId).payroll.subscribeRun",
  input: Schema.Struct({ runId: S, listener: Schema.Unknown, options: Controls }),
  output: Schema.Unknown,
  steps: [
    { name: "validate", local: "build", about: "validatePayrollRunLookup(orgId, runId); a refusal fails the stream with no subscription." },
    { name: "subscribe", rpc: rpc_payroll_runs_get, about: "Opens the live subscription to { orgId, runId } and a connection observer." },
    { name: "fresh-read", rpc: rpc_payroll_runs_get, about: "The same row read past the client cache, one at a time; NETWORK_ERROR keeps the stream open." },
    { name: "publish", local: "build", about: "Decodes the detail and publishes ok; null only before any readable value." },
    { name: "hold", local: "wait", about: "Until unsubscribe, abort, an identity change or a terminal error." },
  ],
  errors: [error_CANCELLED, error_NOT_IMPLEMENTED, error_NOT_AUTHENTICATED, error_INVALID_INPUT, error_NETWORK_ERROR],
  calls: [],
  spans: ["org.payroll.subscribeRun"],
  was: [`${SDK}/runs.ts:68`, `${SDK}/run-subscription.ts:26`, `${SDK}/run-subscription.ts:55`, `${SDK}/run-decoding.ts:1`, `${PAY_SDK}/fresh-query.ts:37`],
});

// ── client.org(orgId).departments ──────────────────────────────────────────────────────────

const PROPOSE_WAS = [...OWNING_WAS, `${SDK}/departments.ts:84`, `${SDK}/departments.ts:94`, `${SDK}/department-batch.ts:127`];

const departmentWrite = (spec: {
  readonly id: string;
  readonly method: string;
  readonly title: string;
  readonly row: Ref<"rpc">;
  readonly rowName: string;
  readonly check: string;
  readonly about: string;
  readonly input: Schema.Top;
  readonly ceiling?: boolean;
  readonly was: ReadonlyArray<string>;
}) =>
  ({
    id: spec.id,
    title: spec.title,
    about:
      `client.org(orgId).departments.${spec.method} ${spec.about} propose: session, the backend row, the caller's own ` +
      "check of the proposal, then organizations.proposals.requestApproval for the proposer's approval. A failed check " +
      "leaves the recorded proposal waiting; nothing withdraws it. Output: " +
      (spec.ceiling === true
        ? "{ status, approvalId, payoutCeiling, proposal } (PayoutCeilingProposed), Schema.Unknown."
        : "{ status, approvalId, department, proposal, groups, office? } (DepartmentProposed), Schema.Unknown."),
    component: component_core_sdk,
    sdk: `client.org(orgId).departments.${spec.method}`,
    input: spec.input,
    output: Schema.Unknown,
    steps: [
      owningStep,
      sessionStep,
      { name: "propose", rpc: spec.row, about: `${spec.rowName} with the caller's input and note.` },
      departmentCheck(spec.check),
      requestApprovalStep,
    ] satisfies Steps,
    errors: writeErrors,
    calls: [],
    spans: [spec.rowName],
    was: [...PROPOSE_WAS, ...spec.was],
  }) as const;

const NoteOptions = Schema.Struct({ note: opt(S) });

export const flow_client_org_departments_create = defineFlow(
  departmentWrite({
    id: "client.org.departments.create",
    method: "create",
    title: "Propose a department, check its batch, open the proposer's approval",
    row: rpc_payroll_departments_create,
    rowName: "payroll.departments.create",
    check: "the create batch (pre-v4 with the Roles SDK loaded on first use; v4: office hat, mints, ceiling, top budget)",
    about: "proposes a department with its first budget and holders.",
    input: Schema.Struct({
      input: Schema.Struct({ name: S, budget: Schema.Unknown, holders: Schema.Array(S), note: opt(S) }),
      options: Controls,
    }),
    was: [`${SDK}/departments.ts:117`, `${SDK}/department-checks.ts:99`, `${SDK}/budget-checks.ts:152`],
  }),
);

export const flow_client_org_departments_set_budget = defineFlow(
  departmentWrite({
    id: "client.org.departments.set-budget",
    method: "setBudget",
    title: "Propose a department's budget, check it, open the approval",
    row: rpc_payroll_departments_set_budget,
    rowName: "payroll.departments.setBudget",
    check: "the budget set (pre-v4 with the Roles SDK; v4: the top budget's setAmount and the ceiling move)",
    about: "proposes a department's budget in one token.",
    input: Schema.Struct({ department: S, input: Schema.Struct({ budget: Schema.Unknown, note: opt(S) }), options: Controls }),
    was: [`${SDK}/departments.ts:134`, `${SDK}/department-checks.ts:144`, `${SDK}/budget-checks.ts:228`],
  }),
);

export const flow_client_org_departments_set_amount = defineFlow(
  departmentWrite({
    id: "client.org.departments.set-amount",
    method: "setAmount",
    title: "Propose a v4 department's top budget amount, check it, open the approval",
    row: rpc_payroll_departments_set_budget,
    rowName: "payroll.departments.setBudget",
    check: "the v4 top budget's setAmount only (checkTopBudgetAmount: a pre-v4 proposal is refused)",
    about: "is setBudget's v4 form (CAP-1156): it sends amount, per and token as the budget.",
    input: Schema.Struct({
      department: S,
      input: Schema.Struct({ amount: S, per: opt(S), token: opt(S), note: opt(S) }),
      options: Controls,
    }),
    was: [`${SDK}/departments.ts:145`, `${SDK}/budget-checks.ts:228`],
  }),
);

export const flow_client_org_departments_close = defineFlow(
  departmentWrite({
    id: "client.org.departments.close",
    method: "close",
    title: "Propose closing a v4 department, check it, open the approval",
    row: rpc_payroll_departments_close,
    rowName: "payroll.departments.close",
    check: "the one Budgets.close call (checkTopBudgetOpenState)",
    about: "proposes closing a v4 department's top budget (CAP-1160).",
    input: Schema.Struct({ department: S, input: opt(NoteOptions), options: Controls }),
    was: [`${SDK}/departments.ts:162`, `${SDK}/budget-checks.ts:273`],
  }),
);

export const flow_client_org_departments_reopen = defineFlow(
  departmentWrite({
    id: "client.org.departments.reopen",
    method: "reopen",
    title: "Propose reopening a v4 department, check it, open the approval",
    row: rpc_payroll_departments_reopen,
    rowName: "payroll.departments.reopen",
    check: "the one Budgets.reopen call (checkTopBudgetOpenState)",
    about: "proposes reopening a closed v4 department's top budget (CAP-1166).",
    input: Schema.Struct({ department: S, input: opt(NoteOptions), options: Controls }),
    was: [`${SDK}/departments.ts:170`, `${SDK}/budget-checks.ts:273`],
  }),
);

export const flow_client_org_departments_set_ceiling = defineFlow(
  departmentWrite({
    id: "client.org.departments.set-ceiling",
    method: "setCeiling",
    title: "Propose a payout ceiling, check it, open the approval",
    row: rpc_payroll_departments_set_ceiling,
    rowName: "payroll.departments.setCeiling",
    check: "the ceiling resize (checkSetCeiling)",
    about: "proposes a token's payout ceiling.",
    input: Schema.Struct({ input: Schema.Struct({ token: S, amount: S, note: opt(S) }), options: Controls }),
    ceiling: true,
    was: [`${SDK}/departments.ts:178`, `${SDK}/department-checks.ts:257`],
  }),
);

export const flow_client_org_departments_freeze_ceiling = defineFlow(
  departmentWrite({
    id: "client.org.departments.freeze-ceiling",
    method: "freezeCeiling",
    title: "Propose a payout freeze, check it, open the approval",
    row: rpc_payroll_departments_freeze_ceiling,
    rowName: "payroll.departments.freezeCeiling",
    check: "its one Roles call from the reading the backend planned with (checkFreezeCeiling)",
    about: "proposes a payout freeze in one token (CAP-947).",
    input: Schema.Struct({ input: Schema.Struct({ token: S, leave: opt(S), note: opt(S) }), options: Controls }),
    ceiling: true,
    was: [`${SDK}/departments.ts:186`, `${SDK}/ceiling-freeze-checks.ts:75`],
  }),
);

export const flow_client_org_departments_unfreeze_ceiling = defineFlow(
  departmentWrite({
    id: "client.org.departments.unfreeze-ceiling",
    method: "unfreezeCeiling",
    title: "Propose a payout unfreeze, check it, open the approval",
    row: rpc_payroll_departments_unfreeze_ceiling,
    rowName: "payroll.departments.unfreezeCeiling",
    check: "its one Roles call (checkUnfreezeCeiling)",
    about: "proposes the unfreeze of one token's ceiling (CAP-947).",
    input: Schema.Struct({ input: Schema.Struct({ token: S, note: opt(S) }), options: Controls }),
    ceiling: true,
    was: [`${SDK}/departments.ts:199`, `${SDK}/ceiling-freeze-checks.ts:101`],
  }),
);

export const flow_client_org_departments_holders_add = defineFlow(
  departmentWrite({
    id: "client.org.departments.holders.add",
    method: "holders.add",
    title: "Propose a department holder, check it, open the approval",
    row: rpc_payroll_departments_add_holder,
    rowName: "payroll.departments.addHolder",
    check: "the holder call (checkHolder: assignRoles before v4, the office hat mint on v4, the holder's Safe from the email)",
    about: "proposes one more holder.",
    input: Schema.Struct({ department: S, input: Schema.Struct({ holder: S, note: opt(S) }), options: Controls }),
    was: [`${SDK}/departments.ts:208`, `${SDK}/department-checks.ts:205`],
  }),
);

export const flow_client_org_departments_holders_remove = defineFlow(
  departmentWrite({
    id: "client.org.departments.holders.remove",
    method: "holders.remove",
    title: "Propose removing a department holder, check it, open the approval",
    row: rpc_payroll_departments_remove_holder,
    rowName: "payroll.departments.removeHolder",
    check: "the holder call (checkHolder with memberOf false)",
    about: "proposes taking one holder off.",
    input: Schema.Struct({ department: S, input: Schema.Struct({ holder: S, note: opt(S) }), options: Controls }),
    was: [`${SDK}/departments.ts:216`, `${SDK}/department-checks.ts:205`],
  }),
);

export const flow_client_org_departments_pay = defineFlow({
  id: "client.org.departments.pay",
  title: "Pay from a department's v4 budget through an approval",
  about:
    "client.org(orgId).departments.pay (CAP-1165) is bound by the client to its approvals (departmentPayingOrg, " +
    "platform/client/assemble.ts:237); the unbound bundle answers NOT_IMPLEMENTED departments.executionComposition. It reads " +
    "the department (departments.get, which settles the Organization's proposals and keeps a found budget id) and then " +
    "runs client.approvals.prepare with the payment input, organizationId and the department's id as permissionId: the " +
    "Organization branch of that flow (load the caller's Safe, payments.commands.prepare-organization on the v4 budget " +
    "route, the signing check binding the route to the department's top budget, accounts' approval open). Nothing is " +
    "signed here: the person signs on the approval. Output: the Approval, Schema.Unknown.",
  component: component_core_sdk,
  sdk: "client.org(orgId).departments.pay",
  input: Schema.Struct({ department: S, input: Schema.Unknown, options: opt(Schema.Struct({ signal: opt(Schema.Unknown) })) }),
  output: Schema.Unknown,
  steps: [
    owningStep,
    { name: "get", rpc: rpc_payroll_departments_get, about: "{ orgId, department }; a refusal is returned as is." },
    {
      name: "load-safe",
      local: "build",
      about: "client.approvals.prepare's Organization branch: accounts.safes.loadByAuthUserId for the caller's recorded signer.",
    },
    {
      name: "prepare-organization",
      rpc: rpc_payments_commands_prepare_organization,
      about: "The payment with organizationId and permissionId the department's `dep_` id: the v4 budget route.",
    },
    {
      name: "check",
      local: "build",
      about: "The Organization check, with the budget route bound to the department's top budget (budget-route.ts).",
    },
    { name: "open-approval", local: "build", about: "accounts.approvals.request opens the approval; a failed open abandons the execution." },
    { name: "close-mismatch", rpc: rpc_payments_executions_abandon, about: "A failed check or open abandons the prepared execution." },
  ],
  errors: [error_NOT_IMPLEMENTED, error_CANCELLED, error_NOT_AUTHENTICATED, error_INVALID_INPUT, error_UNKNOWN],
  calls: [],
  spans: ["payroll.departments.get"],
  was: [`${SDK}/department-pay.ts:22`, `${SDK}/department-pay.ts:30`, `${SDK}/department-pay.ts:32`, `${SDK}/department-pay.ts:41`, `${SDK}/departments.ts:235`, "packages/sdk/src/platform/client/assemble.ts:237"],
});

// ── client.org(orgId).agreements: the payer's holder writes ────────────────────────────────

const agreementWrite = (spec: {
  readonly id: string;
  readonly method: string;
  readonly title: string;
  readonly row: Ref<"rpc">;
  readonly rowName: string;
  readonly asked: string;
  readonly input: Schema.Top;
  readonly was: ReadonlyArray<string>;
}) =>
  ({
    id: spec.id,
    title: spec.title,
    about:
      `client.org(orgId).agreements.${spec.method}: session; ${spec.asked}; the backend row; then checkAgreementWrite: the ` +
      "approval signs exactly one call from the caller's personal Safe (derived from their email and the salt namespace) " +
      "through the department's role, or on v4 the plain Agreements call, carrying what was asked; else INVALID_INPUT " +
      "`the prepared write does not match`. The Organization is marked verified. Returns at the approval (AgreementPrepared); " +
      "nothing is sent. A failed check leaves the approval open. Output: Schema.Unknown.",
    component: component_core_sdk,
    sdk: `client.org(orgId).agreements.${spec.method}`,
    input: spec.input,
    output: Schema.Unknown,
    steps: [
      owningStep,
      sessionStep,
      { name: "asked", local: "build", about: `${spec.asked}; a value that cannot be is INVALID_INPUT before anything is sent.` },
      { name: "prepare", rpc: spec.row, about: `${spec.rowName} for this Organization.` },
      { name: "check", local: "build", about: "checkAgreementWrite against the caller's email, the agreement id and what was asked." },
    ] satisfies Steps,
    errors: writeErrors,
    calls: [],
    spans: [spec.rowName],
    was: [...OWNING_WAS, `${SDK}/agreements.ts:62`, `${SDK}/agreements.ts:86`, `${SDK}/agreement-checks.ts:228`, ...spec.was],
  }) as const;

const AgreementId = S;

export const flow_client_org_agreements_offer = defineFlow(
  agreementWrite({
    id: "client.org.agreements.offer",
    method: "offer",
    title: "Offer an agreement, check the prepared write, return at the approval",
    row: rpc_payroll_agreements_offer,
    rowName: "payroll.agreements.offer",
    asked: "askedOffer reads the terms in the contract's units (rate, period, dates, release, the payee's Safe from an email or handle)",
    input: Schema.Struct({ input: Schema.Unknown, options: Controls }),
    was: [`${SDK}/agreements.ts:159`, `${SDK}/agreements.ts:46`, `${SDK}/agreement-asks.ts:48`],
  }),
);

export const flow_client_org_agreements_withdraw = defineFlow(
  agreementWrite({
    id: "client.org.agreements.withdraw",
    method: "withdraw",
    title: "Withdraw an offer, check the prepared write, return at the approval",
    row: rpc_payroll_agreements_withdraw,
    rowName: "payroll.agreements.withdraw",
    asked: "asked: { action: withdraw }",
    input: Schema.Struct({ agreementId: AgreementId, options: Controls }),
    was: [`${SDK}/agreements.ts:170`],
  }),
);

export const flow_client_org_agreements_change = defineFlow(
  agreementWrite({
    id: "client.org.agreements.change",
    method: "change",
    title: "Change a rate, check the prepared write, return at the approval",
    row: rpc_payroll_agreements_change,
    rowName: "payroll.agreements.change",
    asked: "askedChange reads the rate and the date",
    input: Schema.Struct({
      agreementId: AgreementId,
      input: Schema.Struct({ rate: Schema.Struct({ amount: S, per: S }), from: opt(S) }),
      options: Controls,
    }),
    was: [`${SDK}/agreements.ts:178`, `${SDK}/agreement-asks.ts:75`],
  }),
);

export const flow_client_org_agreements_cancel_change = defineFlow(
  agreementWrite({
    id: "client.org.agreements.cancel-change",
    method: "cancelChange",
    title: "Cancel a pending lowering, check the prepared write, return at the approval",
    row: rpc_payroll_agreements_cancel_change,
    rowName: "payroll.agreements.cancelChange",
    asked: "asked: { action: cancelChange }",
    input: Schema.Struct({ agreementId: AgreementId, options: Controls }),
    was: [`${SDK}/agreements.ts:196`],
  }),
);

export const flow_client_org_agreements_pause = defineFlow(
  agreementWrite({
    id: "client.org.agreements.pause",
    method: "pause",
    title: "Pause an agreement, check the prepared write, return at the approval",
    row: rpc_payroll_agreements_pause,
    rowName: "payroll.agreements.pause",
    asked: "asked: { action: pause }",
    input: Schema.Struct({ agreementId: AgreementId, options: Controls }),
    was: [`${SDK}/agreements.ts:204`],
  }),
);

export const flow_client_org_agreements_resume = defineFlow(
  agreementWrite({
    id: "client.org.agreements.resume",
    method: "resume",
    title: "Resume an agreement, check the prepared write, return at the approval",
    row: rpc_payroll_agreements_resume,
    rowName: "payroll.agreements.resume",
    asked: "asked: { action: resume }",
    input: Schema.Struct({ agreementId: AgreementId, options: Controls }),
    was: [`${SDK}/agreements.ts:212`],
  }),
);

export const flow_client_org_agreements_end = defineFlow(
  agreementWrite({
    id: "client.org.agreements.end",
    method: "end",
    title: "End an agreement, check the prepared write, return at the approval",
    row: rpc_payroll_agreements_end,
    rowName: "payroll.agreements.end",
    asked: "askedEnd reads the last day",
    input: Schema.Struct({ agreementId: AgreementId, input: Schema.Struct({ on: S }), options: Controls }),
    was: [`${SDK}/agreements.ts:220`, `${SDK}/agreement-asks.ts:86`],
  }),
);

export const flow_client_org_agreements_get = defineFlow({
  id: "client.org.agreements.get",
  title: "Read one agreement the Organization pays, else one that pays it",
  about:
    "client.org(orgId).agreements.get reads payroll.agreements.get (side `pays`); when that refuses, it reads " +
    "payroll.agreements.organizationShow (Payee A, side `paid`); when both refuse it answers the payer side's refusal. " +
    "Output: OrganizationAgreement, Schema.Unknown.",
  component: component_core_sdk,
  sdk: "client.org(orgId).agreements.get",
  input: Schema.Struct({ agreementId: AgreementId, options: Controls }),
  output: Schema.Unknown,
  steps: [
    owningStep,
    { name: "paid", rpc: rpc_payroll_agreements_get, about: "{ orgId, agreementId }: one the Organization pays." },
    { name: "received", rpc: rpc_payroll_agreements_organization_show, about: "Only when the first refused: one that pays the Organization." },
  ],
  errors: [error_CANCELLED],
  calls: [],
  spans: ["payroll.agreements.get"],
  was: [...OWNING_WAS, `${SDK}/agreements.ts:104`, `${SDK}/agreements.ts:229`, `${SDK}/organization-payee.ts:144`],
});

export const flow_client_org_agreements_wait = defineFlow({
  id: "client.org.agreements.wait",
  title: "Follow the Organization's last write on an agreement until it lands",
  about:
    "client.org(orgId).agreements.wait reads the agreement on either side, as get does. One the Organization pays is " +
    "followed by payroll.agreements.get until its last write is `landed`; a failed write is TRANSACTION_FAILED " +
    "chain_refused, an abandoned one WRONG_STATE (`never reached the chain`), no write WRONG_STATE no_write. One that pays " +
    "the Organization is followed by payroll.agreements.organizationShow until its payee write lands (or its Payment " +
    "settles, until: settled). 180 s by default, every 2 s; time up is WRONG_STATE. Output: the settled agreement, " +
    "Schema.Unknown.",
  component: component_core_sdk,
  sdk: "client.org(orgId).agreements.wait",
  input: Schema.Struct({ agreementId: AgreementId, options: WaitOptions }),
  output: Schema.Unknown,
  steps: [
    owningStep,
    { name: "paid", rpc: rpc_payroll_agreements_get, about: "Which side: one the Organization pays." },
    { name: "received", rpc: rpc_payroll_agreements_organization_show, about: "Only when the first refused." },
    pollStep("payroll.agreements.get or payroll.agreements.organizationShow"),
  ],
  errors: pollErrors,
  calls: [],
  spans: ["payroll.agreements.get"],
  was: [...OWNING_WAS, `${SDK}/agreements.ts:115`, `${SDK}/agreements.ts:144`, `${SDK}/agreement-results.ts:58`, `${SDK}/organization-payee.ts:158`],
});

// ── client.org(orgId).agreements: the Organization as payee (Payee A) ──────────────────────

const organizationPayeeWrite = (spec: {
  readonly id: string;
  readonly method: string;
  readonly title: string;
  readonly row: Ref<"rpc">;
  readonly rowName: string;
  readonly extra: string;
  readonly input: Schema.Top;
  readonly was: ReadonlyArray<string>;
}) =>
  ({
    id: spec.id,
    title: spec.title,
    about:
      `client.org(orgId).agreements.${spec.method} (Payee A): ${spec.rowName}; ${spec.extra}checkOrganizationPayeeWrite: the ` +
      "proposal is on this Organization's Safe, the payee the agreement names, with exactly one call to the contract on " +
      "this agreement carrying what was asked (INVALID_INPUT otherwise); then organizations.proposals.requestApproval " +
      "opens the proposer's approval, so a 1-of-1 Safe executes at once. Output: Schema.Unknown.",
    component: component_core_sdk,
    sdk: `client.org(orgId).agreements.${spec.method}`,
    input: spec.input,
    output: Schema.Unknown,
    steps: [
      owningStep,
      { name: "propose", rpc: spec.row, about: `${spec.rowName} for this Organization.` },
      { name: "check", local: "build", about: "checkOrganizationPayeeWrite; the Organization is marked verified." },
      requestApprovalStep,
    ] satisfies Steps,
    errors: [error_CANCELLED, error_INVALID_INPUT],
    calls: [],
    spans: [spec.rowName],
    was: [...OWNING_WAS, `${SDK}/organization-payee.ts:57`, `${SDK}/organization-payee-checks.ts:56`, ...spec.was],
  }) as const;

export const flow_client_org_agreements_accept = defineFlow(
  organizationPayeeWrite({
    id: "client.org.agreements.accept",
    method: "accept",
    title: "Propose the Organization's accept of an offer, check it, open the approval",
    row: rpc_payroll_agreements_organization_accept,
    rowName: "payroll.agreements.organizationAccept",
    extra: "a pinned termsHash is trimmed and sent; ",
    input: Schema.Struct({ agreementId: AgreementId, input: opt(Schema.Struct({ termsHash: opt(S) })), options: Controls }),
    was: [`${SDK}/organization-payee.ts:80`],
  }),
);

export const flow_client_org_agreements_collect = defineFlow(
  organizationPayeeWrite({
    id: "client.org.agreements.collect",
    method: "collect",
    title: "Propose the Organization's collection, check it, open the approval",
    row: rpc_payroll_agreements_organization_collect,
    rowName: "payroll.agreements.organizationCollect",
    extra: "`nothing_released` returns at once with payment null; otherwise ",
    input: Schema.Struct({ agreementId: AgreementId, options: Controls }),
    was: [`${SDK}/organization-payee.ts:97`],
  }),
);

// ── client.agreements (also client.me.agreements): the person payee ───────────────────────

const PAYEE_PATHS = "The same bundle is mounted at client.agreements and client.me.agreements (financial-ops.ts:78).";

export const flow_client_agreements_accept = defineFlow({
  id: "client.agreements.accept",
  title: "Accept an offer: prepare it and check it signs exactly the terms hash",
  about:
    "client.agreements.accept: payroll.agreements.accept with the trimmed termsHash, then checkPayeeWrite for the person " +
    "signed in now (no session: NOT_AUTHENTICATED): one call from the payee's personal Safe straight to the contract, on " +
    "this agreement, carrying the terms hash they meant (v4: Agreements.accept); else INVALID_INPUT. Returns at the " +
    "approval as `awaiting_approval` (PayeeWritePending); nothing is sent. " +
    PAYEE_PATHS +
    " Output: Schema.Unknown.",
  component: component_core_sdk,
  sdk: "client.agreements.accept",
  input: Schema.Struct({ agreementId: AgreementId, input: opt(Schema.Struct({ termsHash: opt(S) })), options: Controls }),
  output: Schema.Unknown,
  steps: [
    owningStep,
    { name: "prepare", rpc: rpc_payroll_agreements_accept, about: "{ agreementId, termsHash? }." },
    { name: "check", local: "build", about: "checkPayeeWrite against the session's email, the agreement and the terms hash." },
  ],
  errors: [error_CANCELLED, error_NOT_AUTHENTICATED, error_INVALID_INPUT],
  calls: [],
  spans: ["payroll.agreements.accept"],
  was: [...OWNING_WAS, `${SDK}/payee-agreements.ts:100`, `${SDK}/payee-agreements.ts:155`, `${SDK}/payee-checks.ts:107`, "packages/sdk/src/platform/client/financial-ops.ts:78"],
});

export const flow_client_agreements_collect = defineFlow({
  id: "client.agreements.collect",
  title: "Collect what is released: prepare it and check it collects exactly that",
  about:
    "client.agreements.collect: payroll.agreements.collect; `nothing_released` returns at once with payment null; " +
    "otherwise checkPayeeWrite: one `collect` call from the payee's personal Safe on this agreement for exactly the amount " +
    "the collection names; else INVALID_INPUT. Returns at the approval (PayeeWritePending). " +
    PAYEE_PATHS +
    " Output: Schema.Unknown.",
  component: component_core_sdk,
  sdk: "client.agreements.collect",
  input: Schema.Struct({ agreementId: AgreementId, options: Controls }),
  output: Schema.Unknown,
  steps: [
    owningStep,
    { name: "prepare", rpc: rpc_payroll_agreements_collect, about: "{ agreementId }." },
    { name: "check", local: "build", about: "checkPayeeWrite against the session's email, the agreement and the amount." },
  ],
  errors: [error_CANCELLED, error_NOT_AUTHENTICATED, error_INVALID_INPUT],
  calls: [],
  spans: ["payroll.agreements.collect"],
  was: [...OWNING_WAS, `${SDK}/payee-agreements.ts:165`, `${SDK}/payee-checks.ts:107`],
});

export const flow_client_agreements_wait = defineFlow({
  id: "client.agreements.wait",
  title: "Follow the payee's last write until it lands, or its Payment settles",
  about:
    "client.agreements.wait polls payroll.agreements.show every 2 s for up to 180 s (or timeoutMs) until the payee's last " +
    "write is `landed` (until: settled also waits for a collection's Payment to settle). No write is WRONG_STATE no_write; " +
    "a failed write TRANSACTION_FAILED chain_refused; an abandoned one WRONG_STATE (`never reached the chain`); time up " +
    "WRONG_STATE. A collection answers with its Payment's state, an acceptance with the agreement's. " +
    PAYEE_PATHS +
    " Output: PayeeWriteSettled, Schema.Unknown.",
  component: component_core_sdk,
  sdk: "client.agreements.wait",
  input: Schema.Struct({ agreementId: AgreementId, options: WaitOptions }),
  output: Schema.Unknown,
  steps: [
    owningStep,
    { name: "read", rpc: rpc_payroll_agreements_show, about: "{ agreementId }: the payee's own view, with its last payee write." },
    pollStep("payroll.agreements.show"),
  ],
  errors: pollErrors,
  calls: [],
  spans: ["payroll.agreements.show"],
  was: [...OWNING_WAS, `${SDK}/payee-agreements.ts:48`, `${SDK}/payee-agreements.ts:118`],
});

/** client.me.agreements is the same bundle as client.agreements (financial-ops.ts:78): the same records. */
export const flow_client_me_agreements_accept = flow_client_agreements_accept;
export const flow_client_me_agreements_collect = flow_client_agreements_collect;
export const flow_client_me_agreements_wait = flow_client_agreements_wait;

// ── Methods that forward one rpc: no flow; the operation names the rpc ───────────────────────
//
// client.org(orgId).payroll.getRun        → payroll.runs.get; validates org and run id first, fences the auth lifetime
//                                          (a changed one is CANCELLED) and checks the detail's scope, membership and
//                                          quantities (checkPayrollRunDetail, INVALID_INPUT) (runs.ts:84, run-checks.ts:134).
// client.org(orgId).payroll.runs          → payroll.runs.list; projects the page (toPayrollRuns) (runs.ts:126).
// client.org(orgId).payroll.terms         → payroll.terms.list (runs.ts:163).
// client.org(orgId).payroll.groups.list   → payroll.groups.list; maps each group (runs.ts:165).
// client.org(orgId).payroll.groups.save   → payroll.groups.save (runs.ts:167).
// client.org(orgId).payroll.groups.remove → payroll.groups.remove; answers undefined (runs.ts:180).
// client.org(orgId).departments.get       → payroll.departments.get (departments.ts:225).
// client.org(orgId).departments.list      → payroll.departments.list (departments.ts:229).
// client.org(orgId).agreements.list       → payroll.agreements.list (agreements.ts:231).
// client.org(orgId).agreements.received   → payroll.agreements.organizationReceived; answers the items (organization-payee.ts:114).
// client.agreements.list                  → payroll.agreements.mine; answers the items (payee-agreements.ts:142).
// client.agreements.get                   → payroll.agreements.show (payee-agreements.ts:151).
// client.agreements.previewCollect        → payroll.agreements.previewCollect (payee-agreements.ts:178).
//
// An unconfigured client (no Convex transport, or no money deps) mounts the unavailable bundles: every verb answers
// NOT_IMPLEMENTED (payroll, departments or agreements executionComposition) and none throws (runs.ts:192,
// departments.ts:245, agreements.ts:253, payee-agreements.ts:193).
