// The as-is book of the old payroll concept: the runs area.
//
// Every operation registered at `payroll/runs:*` (packages/backend/convex/payroll/runs.ts), as the
// old code does it. Three are public rows of `runs` (packages/protocol/src/payroll/operations.ts);
// prepare, inspectReplay and noticeFacts are internal reads and writes the authorize and notify
// actions run in the same call; emitTransitioned is telemetry plumbing; notify is scheduled by the
// settle flip, so it is a workflow.
//
// How touches are booked: an internal rpc lists what its own transaction does through payroll code;
// a neighbour's in-transaction function it calls is an invoke of that neighbour's procedure; a
// neighbour table payroll code queries by itself is a read of that table (a boundary finding). The
// public authorize action lists what the payroll rpcs it runs touch. Work it hands to payments'
// action helpers (birthFunded, rolesModuleAdmits, budgetAllowanceAdmits, storeBuiltExecution,
// recoverSubmissionClaim) and the payments rpc it runs (`payments.executions.complete`) is named in
// `about`; the chain calls those helpers make inside this action are booked under `calls`.

import { Schema } from "effect";
import { defineRpc, defineWorkflow } from "../../../packages/book/src/index.ts";
import { concept_payroll } from "../shared/foundation.ts";
import {
  error_ENV_MISSING,
  error_FEATURE_NOT_AVAILABLE,
  error_INSUFFICIENT_BALANCE,
  error_INVALID_INPUT,
  error_NOT_AUTHENTICATED,
  error_NOT_IMPLEMENTED,
  error_PROVIDER_ERROR,
  error_PROVIDER_RESPONSE_INVALID,
  error_ROLE_PERMISSION_DENIED,
  error_UNKNOWN,
  error_WRONG_STATE,
  event_payroll_run_transitioned,
} from "../shared/vocabulary.ts";
import {
  contract_budgets,
  contract_entry_point,
  contract_erc20,
  contract_roles,
  integration_chain_rpc,
  integration_mail,
} from "../shared/external.ts";
import { machine_payroll_run, table_payroll_items, table_payroll_runs } from "./data.ts";
import { table_payments } from "../payments/data.ts";
import {
  procedure_payments_find_payment_intent_in_tx,
  procedure_payments_find_payment_replay_source_in_tx,
  procedure_payments_prepare_organization_payment_in_tx,
  procedure_payments_prove_payroll_payment_replay_in_tx,
  procedure_payments_read_active_payment_execution_replay_in_tx,
  procedure_payments_read_organization_payment_batch_facts_in_tx,
  procedure_payments_read_payment_command_completion_in_tx,
  procedure_payments_read_payroll_payment_command_proof_in_tx,
  procedure_payments_read_payroll_payment_view_in_tx,
  procedure_payments_read_prepared_payment_views_in_tx,
} from "../payments/procedures.ts";
import { procedure_access_require_feature_from_action } from "../access/procedures.ts";
import { procedure_accounts_require_payment_account_in_tx } from "../accounts/procedures.ts";
import {
  procedure_organizations_is_payroll_invite_for_party_in_tx,
  procedure_organizations_read_organization_name_in_tx,
  procedure_organizations_read_organization_party_id_in_tx,
  procedure_organizations_require_org_participant,
  procedure_organizations_require_payroll_organization_identity_in_tx,
} from "../organizations/procedures.ts";
import {
  procedure_parties_ensure_employed_edge,
  procedure_parties_ensure_party_by_email,
  procedure_parties_party_by_id,
  procedure_parties_resolve_recipient_in_tx,
} from "../parties/procedures.ts";
import { table_party_edges } from "../parties/data.ts";
import { table_permission_allowances, table_permissions } from "../permissions/data.ts";

const BACKEND = "packages/backend";
const CONVEX = `${BACKEND}/convex/payroll/runs.ts`;
const SRC = `${BACKEND}/src/payroll`;
const RUNS = `${SRC}/runs`;
const OPS = `${RUNS}/operations`;
const ROWS = "packages/protocol/src/payroll/operations.ts";
const SCHEMA = "packages/protocol/src/payroll/schema.ts";

const S = Schema.String;
const N = Schema.Number;
const opt = Schema.optionalKey;

/** Keep each link once, in first-seen order. */
const union = <const L extends ReadonlyArray<ReadonlyArray<{ readonly id: string }>>>(...lists: L): Array<L[number][number]> => {
  const seen = new Set<string>();
  const out: Array<L[number][number]> = [];
  for (const list of lists)
    for (const item of list) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      out.push(item);
    }
  return out;
};

// ── errors ─────────────────────────────────────────────────────────────────────────────────

/** `CALL` and `DEFECTS` (operations.ts:101, protocol/src/operation.ts:54). */
const CALL_DEFECTS = [error_NOT_AUTHENTICATED, error_INVALID_INPUT, error_UNKNOWN, error_ENV_MISSING];
/** `CALL`, `DEFECTS`, `DENIED`, `STATE`: the run reads (operations.ts:91, :101). */
const RUN_READ_ERRORS = [...CALL_DEFECTS, error_ROLE_PERMISSION_DENIED, error_WRONG_STATE];

// ── shapes ─────────────────────────────────────────────────────────────────────────────────

const Money = Schema.Struct({ asset: S, value: S });

/** `PayrollRunSchema` (schema.ts:83). */
const PayrollRun = Schema.Struct({
  id: S,
  status: Schema.Literals(["draft", "authorized", "settled"]),
  periodStart: N,
  periodEnd: N,
  total: Money,
  recipientCount: N,
});

/** `AuthorizePayrollRunExecutionInputSchema` (schema.ts:64); each item's `to` is a PaymentRef, too deep: Unknown. */
const AuthorizeInput = Schema.Struct({
  orgId: S,
  permissionId: S,
  asset: S,
  requestKey: S,
  signerAddress: S,
  period: Schema.Struct({ start: N, end: N }),
  items: Schema.Array(
    Schema.Struct({
      to: Schema.Unknown,
      partyId: S,
      amount: Money,
      gross: S,
      net: S,
      adjustments: Schema.Array(Schema.Struct({ label: S, amount: S })),
    }),
  ),
});

// ── shared touches ─────────────────────────────────────────────────────────────────────────

/** requireParticipant (runs/guards.ts:22): the caller takes part in the Organization. */
const PARTICIPANT_INVOKES = [procedure_organizations_require_org_participant];

/** The run's proof against its saved command (runDetail, runs/reads/details.ts:91). */
const DETAIL = {
  reads: [table_payroll_runs, table_payroll_items, table_party_edges],
  invokes: [
    procedure_payments_read_payroll_payment_command_proof_in_tx,
    procedure_payments_read_payroll_payment_view_in_tx,
  ],
};
const DETAIL_WAS = [
  `${RUNS}/reads/details.ts:30`,
  `${RUNS}/reads/details.ts:47`,
  `${RUNS}/reads/details.ts:52`,
  `${RUNS}/reads/details.ts:63`,
  `${RUNS}/reads/details.ts:91`,
  `${RUNS}/reads/details.ts:96`,
  `${RUNS}/reads/details.ts:113`,
  `${RUNS}/rules/proofs.ts:1`,
];

/** The run's transaction (payroll.runs.prepare). */
const PREPARE = {
  reads: [table_payroll_runs, table_payroll_items],
  writes: [table_payroll_runs, table_payroll_items],
  drives: [machine_payroll_run.t.to_draft],
  invokes: [
    ...PARTICIPANT_INVOKES,
    procedure_organizations_read_organization_party_id_in_tx,
    procedure_parties_party_by_id,
    procedure_payments_find_payment_intent_in_tx,
    procedure_payments_read_payment_command_completion_in_tx,
    procedure_payments_prepare_organization_payment_in_tx,
    procedure_parties_ensure_party_by_email,
    procedure_parties_resolve_recipient_in_tx,
    procedure_organizations_is_payroll_invite_for_party_in_tx,
    procedure_parties_ensure_employed_edge,
    procedure_payments_read_organization_payment_batch_facts_in_tx,
  ],
  emits: [event_payroll_run_transitioned],
};
const PREPARE_WAS = [
  `${OPS}/prepare.ts:27`,
  `${OPS}/prepare.ts:36`,
  `${OPS}/prepare.ts:41`,
  `${RUNS}/guards.ts:30`,
  `${RUNS}/rules/admission.ts:32`,
  `${RUNS}/rules/admission.ts:57`,
  `${RUNS}/rules/admission.ts:72`,
  `${RUNS}/rules/admission.ts:91`,
  `${RUNS}/rules/admission.ts:104`,
  `${RUNS}/writes/runs.ts:46`,
  `${RUNS}/writes/runs.ts:67`,
  `${RUNS}/writes/runs.ts:90`,
  `${RUNS}/writes/runs.ts:119`,
  `${RUNS}/writes/runs.ts:138`,
  `${RUNS}/writes/runs.ts:197`,
  `${RUNS}/writes/runs.ts:233`,
  `${RUNS}/writes/runs.ts:253`,
  `${RUNS}/events.ts:54`,
  `${SRC}/model.ts:24`,
];

/** The replay read (payroll.runs.inspectReplay), which ends in the run detail for an accepted attempt. */
const REPLAY = {
  reads: [table_payroll_runs, ...DETAIL.reads],
  invokes: [
    procedure_payments_find_payment_replay_source_in_tx,
    procedure_accounts_require_payment_account_in_tx,
    procedure_organizations_require_payroll_organization_identity_in_tx,
    procedure_payments_prove_payroll_payment_replay_in_tx,
    procedure_payments_read_active_payment_execution_replay_in_tx,
    procedure_payments_read_prepared_payment_views_in_tx,
    ...DETAIL.invokes,
  ],
};
const REPLAY_WAS = [
  `${OPS}/inspect-replay.ts:13`,
  `${RUNS}/reads/replays.ts:42`,
  `${RUNS}/reads/replays.ts:51`,
  `${RUNS}/reads/replays.ts:57`,
  `${RUNS}/reads/replays.ts:64`,
  `${RUNS}/reads/replays.ts:79`,
  `${RUNS}/reads/replays.ts:109`,
  `${RUNS}/reads/replays.ts:112`,
  `${RUNS}/rules/proofs.ts:1`,
];

/** What the run's payment emails are read from (readRunNoticeFactsInTx, runs/reads/notices.ts:46). */
const NOTICE_FACTS = {
  reads: [table_payroll_runs, table_payments, table_permission_allowances, table_permissions],
  invokes: [procedure_organizations_read_organization_name_in_tx, procedure_parties_party_by_id],
};

/**
 * The chain calls the authorize action's payments helpers make: birthFunded's Budget allowance and
 * balance, rolesModuleAdmits' module code, budgetAllowanceAdmits, storeBuiltExecution's sponsored
 * build, and settleSubmission's bundler lookup.
 */
const AUTHORIZE_CALLS = [
  integration_chain_rpc.c.fetchEthCall,
  integration_chain_rpc.c.fetchLatestBlock,
  integration_chain_rpc.c.fetchErc20Balance,
  integration_chain_rpc.c.fetchCode,
  integration_chain_rpc.c.fetchLatestBlockNumber,
  integration_chain_rpc.c.fetchEntryPointNonce,
  integration_chain_rpc.c.fetchEntryPointUserOperationEvent,
  integration_chain_rpc.c.fetchUserOperationReceipt,
  integration_chain_rpc.c.fetchUserOperationFees,
  integration_chain_rpc.c.sponsorUserOperation,
  integration_chain_rpc.c.hasUserOperationByHash,
];

// ── public rows ────────────────────────────────────────────────────────────────────────────

export const rpc_payroll_runs_authorize = defineRpc({
  id: "payroll.runs.authorize",
  title: "Authorize a payroll run: prepare it and its Payment batch, build its operation",
  about:
    "Row `payroll.runs.authorize`, registered as the public action `payroll/runs:authorize`. Signed in (`signedInAction`), " +
    "then the `payroll-runs` gate for the Organization. Payments' birthFunded refuses a new request key the Budget's " +
    "allowance or the Safe cannot fund (#2403) before anything is written. The internal mutation payroll.runs.prepare then " +
    "writes the run, its items, the engagements and the Organization Payment batch in ONE transaction, or finds the same " +
    "request's saved run. The internal query payroll.runs.inspectReplay reads the run's exact earlier attempt: an accepted " +
    "one is restored, not signed again; one claimed for sending is looked up at the bundler (observed: payments.executions." +
    "complete records the acceptance; not found: WRONG_STATE submission_pending with retryAfter until its sponsorship and " +
    "grace lapse, then payments' recoverSubmissionClaim). Otherwise rolesModuleAdmits, budgetAllowanceAdmits and payments' " +
    "storeBuiltExecution build and store a sponsored Safe UserOperation for the batch. Answers the run, the execution the " +
    "caller signs and `replay`. Submission rides payments' submission, which advances the run. `withChain` provides " +
    "ChainRpcLive.",
  was: [
    `${CONVEX}:6`,
    `${OPS}/authorize.ts:27`,
    `${OPS}/authorize.ts:30`,
    `${OPS}/authorize.ts:31`,
    `${OPS}/authorize.ts:36`,
    `${OPS}/authorize.ts:39`,
    `${OPS}/authorize.ts:40`,
    `${OPS}/authorize.ts:48`,
    `${OPS}/authorize.ts:53`,
    `${RUNS}/writes/attempts.ts:35`,
    `${RUNS}/writes/attempts.ts:52`,
    `${RUNS}/external.ts:44`,
    `${RUNS}/external.ts:87`,
    `${RUNS}/external.ts:118`,
    `${RUNS}/reads/replays.ts:153`,
    `${RUNS}/errors.ts:103`,
    `${RUNS}/events.ts:82`,
    `${ROWS}:74`,
    `${SCHEMA}:153`,
    ...PREPARE_WAS,
    ...REPLAY_WAS,
  ],
  concept: concept_payroll,
  kind: "action",
  who:
    "A signed-in participant of the Organization (`signedInAction`, then requireParticipant in the run's transaction) with the " +
    "`payroll-runs` gate on; the batch's own spend gate requires a Budget in the Organization that covers the total.",
  input: AuthorizeInput,
  output: Schema.Struct({
    run: PayrollRun,
    /** `PreparedPaymentCommandExecutionSchema`: too deep to transcribe. */
    execution: Schema.Unknown,
    replay: Schema.Union([
      Schema.Struct({ kind: Schema.Literals(["prepared"]) }),
      Schema.Struct({
        kind: Schema.Literals(["accepted"]),
        state: Schema.Literals(["submitted", "pending", "included"]),
        submittedAt: N,
        /** `SubmittedPaymentCommandExecutionSchema`: too deep to transcribe. */
        submission: Schema.Unknown,
      }),
    ]),
  }),
  errors: [
    ...RUN_READ_ERRORS,
    error_PROVIDER_ERROR,
    error_PROVIDER_RESPONSE_INVALID,
    error_INSUFFICIENT_BALANCE,
    error_NOT_IMPLEMENTED,
    error_FEATURE_NOT_AVAILABLE,
  ],
  reads: union(PREPARE.reads, REPLAY.reads),
  writes: PREPARE.writes,
  drives: PREPARE.drives,
  invokes: union([procedure_access_require_feature_from_action], PREPARE.invokes, REPLAY.invokes),
  emits: PREPARE.emits,
  calls: AUTHORIZE_CALLS,
  chain: [contract_roles.f.allowances, contract_budgets.f.leftOf, contract_erc20.f.balanceOf, contract_entry_point.f.getNonce],
  spans: [
    "chain.read eth_call",
    "chain.read eth_getCode",
    "chain.read eth_getBlockByNumber",
    "chain.read eth_blockNumber",
    "chain.read eth_getLogs",
    "chain.read eth_getUserOperationReceipt",
    "chain.read eth_getUserOperationByHash",
  ],
});

export const rpc_payroll_runs_get = defineRpc({
  id: "payroll.runs.get",
  title: "Read one saved payroll run with its Payslips and Payments",
  about:
    "Row `payroll.runs.get`, registered as the public query `payroll/runs:get`. Signed in; requireParticipant; then the " +
    "Organization's identity for payroll (its claimed Party, Safe and chain: requirePayrollOrganizationIdentityInTx, " +
    "INVALID_INPUT or WRONG_STATE). A run id with no row is null; two rows, or a run of another employer, is INVALID_INPUT " +
    "`Payroll run does not match the Organization`. The detail is assembled only from the run's exact stored membership: " +
    "payments proves the command at batchRef is this Organization's birth of one Payment per item, each frozen Payslip is " +
    "matched to one item row whose `employed` edge (read straight from Parties' `partyEdges`) runs from this employer to " +
    "that employee, and each Payment is projected through payments' proof. Any mismatch is INVALID_INPUT `Saved Payroll " +
    "run proof is missing or contradictory`; an asset this deployment does not configure is WRONG_STATE.",
  was: [`${CONVEX}:8`, `${OPS}/get.ts:10`, `${OPS}/get.ts:13`, `${OPS}/get.ts:14`, `${RUNS}/guards.ts:22`, `${RUNS}/guards.ts:40`, `${RUNS}/views.ts:16`, `${ROWS}:91`, ...DETAIL_WAS],
  concept: concept_payroll,
  kind: "query",
  who: "A signed-in current participant of the Organization (`signedIn`, requireOrgParticipant).",
  input: Schema.Struct({ orgId: S, runId: S }),
  output: Schema.NullOr(
    Schema.Struct({
      orgId: S,
      run: PayrollRun,
      command: Schema.Struct({
        commandId: S,
        requestKey: S,
        state: Schema.Literals(["prepared", "submitted"]),
        verificationState: Schema.Literals(["not_started", "scheduled", "verifying", "retry_wait", "mismatch", "applied", "unresolved", "failed"]),
        completionOutcome: opt(Schema.Literals(["settled", "failed"])),
        terminalOutcome: opt(Schema.Literals(["settled", "failed", "unresolved", "superseded"])),
        userOpHash: opt(S),
      }),
      items: Schema.Array(
        Schema.Struct({
          itemIndex: N,
          employeeRef: S,
          engagementEdgeId: S,
          gross: S,
          net: S,
          adjustments: Schema.Array(Schema.Unknown),
          amount: Money,
          /** The wire Payment: too deep to transcribe. */
          payment: Schema.Unknown,
        }),
      ),
      createdAt: N,
      updatedAt: N,
      settledAt: opt(N),
    }),
  ),
  errors: RUN_READ_ERRORS,
  reads: DETAIL.reads,
  writes: [],
  drives: [],
  invokes: [...PARTICIPANT_INVOKES, procedure_organizations_require_payroll_organization_identity_in_tx, ...DETAIL.invokes],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_payroll_runs_list = defineRpc({
  id: "payroll.runs.list",
  title: "Read one page of an Organization's payroll runs and what settled this month",
  about:
    "Row `payroll.runs.list`, registered as the public query `payroll/runs:list`. Signed in; requireParticipant. An " +
    "Organization with no Party reads empty rather than writing a Party from a read. Otherwise one page of the employer's " +
    "runs, newest first (50 when no limit; 1 to 100), each stated from its own items (total and recipient count), and the " +
    "totals of every run settled since the first instant of this UTC calendar month by its own indexed read, so a busy " +
    "month is not under-counted. A cursor the paginator refuses is INVALID_INPUT; an unconfigured asset is WRONG_STATE. " +
    "Annotates row_count.",
  was: [
    `${CONVEX}:10`,
    `${OPS}/list.ts:16`,
    `${OPS}/list.ts:21`,
    `${RUNS}/reads/runs.ts:15`,
    `${RUNS}/reads/runs.ts:48`,
    `${RUNS}/reads/runs.ts:64`,
    `${RUNS}/reads/runs.ts:78`,
    `${RUNS}/views.ts:1`,
    `${RUNS}/events.ts:103`,
    `${ROWS}:101`,
    `${SCHEMA}:139`,
  ],
  concept: concept_payroll,
  kind: "query",
  who: "A signed-in current participant of the Organization (`signedIn`, requireOrgParticipant).",
  input: Schema.Struct({ orgId: S, cursor: opt(S), limit: opt(N) }),
  output: Schema.Struct({ items: Schema.Array(PayrollRun), nextCursor: Schema.NullOr(S), settledThisMonth: Schema.Array(Money) }),
  errors: RUN_READ_ERRORS,
  reads: [table_payroll_runs, table_payroll_items],
  writes: [],
  drives: [],
  invokes: [...PARTICIPANT_INVOKES, procedure_organizations_read_organization_party_id_in_tx],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

// ── internal ───────────────────────────────────────────────────────────────────────────────

export const rpc_payroll_runs_prepare = defineRpc({
  id: "payroll.runs.prepare",
  title: "Write a payroll run, its items, engagements and Payment batch in one transaction",
  about:
    "Registered as the internal mutation `payroll/runs:prepare`. Decodes the run row's input strictly, then admitRun: items " +
    "not empty, period ordered, each item's net the asset's exact raw units and gross plus every adjustment and positive, " +
    "one asset. requireEmployer: requireParticipant, then the Organization's Party (missing: INVALID_INPUT). The run id is " +
    "the request digest; a Party repeated is INVALID_INPUT. The same request's saved intent returns its saved run and " +
    "replayed batch before any mutable lookup. Otherwise each item's employee is derived from its recipient only (an email " +
    "ensures that person's Party; a party Ref resolves it), must be a person or a payroll invitee and must equal the " +
    "asserted partyId; the `employed` edge is ensured at the period start. The run (draft) and its items are inserted unless " +
    "the run id exists; payments prepares the Organization batch (lineage payroll, one Payslip per item, an invitee paid at " +
    "the invited mailbox); a completed command of the same request is WRONG_STATE; the run is bound to its command and a " +
    "new run schedules payroll_run_transitioned `prepared`. A refusal rolls all of it back.",
  was: [`${CONVEX}:13`, ...PREPARE_WAS, `${RUNS}/errors.ts:11`, `${RUNS}/errors.ts:57`],
  concept: concept_payroll,
  kind: "mutation",
  who: "internal: payroll.runs.authorize runs it with ctx.runMutation for the signed-in caller (authUserId), with the call's linkage.",
  input: Schema.Struct({ authUserId: S, input: AuthorizeInput, observationContext: opt(Schema.Unknown) }),
  output: Schema.Struct({
    run: PayrollRun,
    /** `PreparedPaymentCommand`: too deep to transcribe. */
    prepared: Schema.Unknown,
    /** The Organization batch request echoed back: too deep to transcribe. */
    request: Schema.Unknown,
    recipientObservations: Schema.Array(Schema.Unknown),
  }),
  errors: [error_INVALID_INPUT, error_WRONG_STATE, error_ROLE_PERMISSION_DENIED, error_UNKNOWN],
  ...PREPARE,
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_payroll_runs_inspect_replay = defineRpc({
  id: "payroll.runs.inspect-replay",
  title: "Read a payroll run's exact earlier attempt",
  about:
    "Registered as the internal query `payroll/runs:inspectReplay`. Decodes the input; reads the run, payments' replay " +
    "source for the command and the caller's own Account; the run must be this request's source and birth, of this " +
    "Organization's Party. Payments proves the saved Payments and the caller's submission authority. No active execution: " +
    "`prepared` (a command with a hash or not prepared is refused). Otherwise payments' execution replay answers " +
    "`prepared`, `submitting` (execution id, chain, sponsorship end and expected hash) or `accepted`, whose Payments must be " +
    "the proof's in order and whose run detail is read as payroll.runs.get reads it. Every contradiction is INVALID_INPUT " +
    "`Stored Payroll replay proof is missing or contradictory`.",
  was: [`${CONVEX}:9`, ...REPLAY_WAS, ...DETAIL_WAS, `${RUNS}/errors.ts:73`],
  concept: concept_payroll,
  kind: "query",
  who: "internal: payroll.runs.authorize runs it with ctx.runQuery after the run's transaction, for the same caller.",
  input: Schema.Struct({ authUserId: S, input: AuthorizeInput, runId: S, commandId: S }),
  output: Schema.Union([
    Schema.Struct({ kind: Schema.Literals(["prepared"]) }),
    Schema.Struct({
      kind: Schema.Literals(["submitting"]),
      execution: Schema.Struct({ executionId: S, chainId: N, sponsorshipValidUntil: opt(N) }),
      expectedHash: S,
    }),
    Schema.Struct({
      kind: Schema.Literals(["accepted"]),
      run: PayrollRun,
      execution: Schema.Unknown,
      state: S,
      submittedAt: N,
      submission: Schema.Unknown,
    }),
  ]),
  errors: [error_INVALID_INPUT, error_WRONG_STATE, error_UNKNOWN],
  reads: union(REPLAY.reads),
  writes: [],
  drives: [],
  invokes: REPLAY.invokes,
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_payroll_runs_notice_facts = defineRpc({
  id: "payroll.runs.notice-facts",
  title: "Read what a settled run's payment emails are built from",
  about:
    "Registered as the internal query `payroll/runs:noticeFacts`. Null unless the run is settled and has a batchRef. " +
    "Reads payments' `payments` rows straight from the table (`by_payroll_run`), keeping only the run's own command's " +
    "settled ones; none is null. The payer is the first Payment's Organization name, else the employer Party's name, else " +
    "`Your employer`; the purpose is the spending allowance's label, read straight from Permissions' `permissionAllowances` " +
    "(a v4 `allowance_` id) or `permissions` (a v3 Budget's label), else `pay run`; each payee's mailbox is their Party's " +
    "email, with the Payment's raw amount and decimals.",
  was: [
    `${CONVEX}:11`,
    `${OPS}/notice-facts.ts:12`,
    `${RUNS}/reads/notices.ts:21`,
    `${RUNS}/reads/notices.ts:28`,
    `${RUNS}/reads/notices.ts:46`,
    `${RUNS}/reads/notices.ts:55`,
    `${RUNS}/reads/notices.ts:60`,
  ],
  concept: concept_payroll,
  kind: "query",
  who: "internal: the payroll.runs.notify workflow runs it with ctx.runQuery.",
  input: Schema.Struct({ runId: S }),
  output: Schema.NullOr(
    Schema.Struct({
      payerName: S,
      purpose: S,
      assetSymbol: S,
      payees: Schema.Array(Schema.Struct({ email: Schema.NullOr(S), amount: S, decimals: N })),
    }),
  ),
  errors: [error_UNKNOWN],
  reads: NOTICE_FACTS.reads,
  writes: [],
  drives: [],
  invokes: NOTICE_FACTS.invokes,
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_payroll_runs_emit_transitioned = defineRpc({
  id: "payroll.runs.emit-transitioned",
  title: "Deliver one payroll run transition event after its write commits",
  about:
    "Telemetry plumbing: registered as the internal action `payroll/runs:emitTransitioned`. scheduleRunTransitionInTx " +
    "schedules it through scheduleTelemetryEmit from the transaction that moved the run (prepared from prepare, authorized " +
    "from the submission flip, settled from the settle flip), with the batch command's facts, so a failed delivery never " +
    "rolls back or repeats the transition. It attributes the event to the command's person, else to the system job " +
    "`payment_writer`, marks the Organization verified and posts payroll_run_transitioned (transition, run, command, " +
    "Payment count, occurredAt) awaited, continuing the trace. It reads and writes no table.",
  was: [`${CONVEX}:7`, `${OPS}/emit-transitioned.ts:12`, `${RUNS}/events.ts:27`, `${RUNS}/events.ts:39`, `${RUNS}/events.ts:54`, `${RUNS}/events.ts:109`],
  concept: concept_payroll,
  kind: "action",
  who: "internal: scheduled by scheduleRunTransitionInTx from the transaction that moved the run.",
  input: Schema.Struct({
    transition: Schema.Literals(["prepared", "authorized", "settled"]),
    runId: S,
    commandId: S,
    paymentCount: N,
    organizationId: S,
    occurredAt: N,
    authUserId: opt(S),
    observationContext: opt(Schema.Unknown),
  }),
  output: Schema.Void,
  errors: [],
  reads: [],
  writes: [],
  drives: [],
  invokes: [],
  emits: [event_payroll_run_transitioned],
  calls: [],
  chain: [],
  spans: [],
});

// ── workflows ──────────────────────────────────────────────────────────────────────────────

export const workflow_payroll_runs_notify = defineWorkflow({
  id: "payroll.runs.notify",
  title: "Email each payee of a settled payroll run",
  about:
    "Registered as the internal action `payroll/runs:notify` (G5). The settle flip's own transaction schedules it " +
    "(scheduleRunNoticeInTx, runAfter 0, attempt 0), so a failed send never stops or repeats the settlement. Attributed " +
    "to the system job `pay_run_notices`. It reads the facts (payroll.runs.notice-facts; null sends nothing), plans one " +
    "`pay-run-payment` email per payee Capxul has a mailbox for, and sends them through deliverNotices with the notice key " +
    "`payroll.runs.notify:<runId>`. Recipients the provider did not take are retried by scheduling this action again " +
    "(runAfterBusinessDelay) for them only, while attempts remain. Returns { sent, failed }.",
  was: [
    `${CONVEX}:12`,
    `${OPS}/notify.ts:20`,
    `${OPS}/notify.ts:24`,
    `${RUNS}/writes/notices.ts:17`,
    `${RUNS}/external/notices.ts:23`,
    `${RUNS}/rules/notices.ts:24`,
    `${RUNS}/reads/notices.ts:92`,
    "packages/backend/src/integrations/mail/notices.ts:132",
  ],
  concept: concept_payroll,
  priority: "low",
  trigger: { transition: machine_payroll_run.t.to_settled },
  instance: { per: table_payroll_runs },
  steps: [
    { name: "attribute", about: "Records the run as the system job `pay_run_notices`." },
    { name: "facts", about: "Runs payroll.runs.notice-facts for the run; null ends with { sent: 0, failed: 0 }." },
    { name: "plan", about: "One `pay-run-payment` email per payee with a mailbox: payer, purpose, amount, decimals, symbol." },
    { name: "send", about: "deliverNotices: each email to its recipients, or only to `only` on a retry." },
    { name: "retry", about: "Recipients the provider did not take: this action again after the retry delay, attempt + 1, only them." },
  ],
  reads: NOTICE_FACTS.reads,
  writes: [],
  drives: [],
  invokes: NOTICE_FACTS.invokes,
  emits: [],
  calls: [integration_mail.c.deliverNotices],
  chain: [],
  idempotency:
    "None stops a resend: the notice key only names the delivery record. A run no longer settled sends nothing, and a retry sends only to `only`.",
  timeoutMs: 600000,
  retries: { max: 2, backoff: "exponential" },
});
