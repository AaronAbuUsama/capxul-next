// The as-is book of the old accounts concept: the approvals area (a prepared action waiting for
// its person to sign it with their own key on the approval page).
//
// Every operation registered at `accounts/approvals:*` (packages/backend/convex/accounts/approvals.ts).
// Seven public rows of `approvals` (packages/protocol/src/accounts/operations.ts:162); internal
// mutations and queries that actions run through ctx.runMutation / ctx.runQuery (record-approval,
// consume-approved, reschedule-approved, record-expiry, notice-facts) or that other concepts'
// actions run to open a relayed approval (the five open-for-*); and three scheduled actions, the
// workflows: send-approved (after a recorded approval), expire (at the approval's expiry) and
// notify (the approval request email).
//
// Every open (`openApproval`, approvals/writes.ts:52) schedules the expiry at `expiresAt` (business
// time turned into wall time) and the notice at once. An approval is read and acted on only by
// the person whose key must sign it: another account, or an id that names nothing, is the same
// ROLE_PERMISSION_DENIED (`not_the_signer`). Each operation's wide event names the approval, its
// state, its command, Payments and bank payout (`approvalAnnotated`, events.ts:40). The view
// (`approvalView`, views.ts:20) needs the paired frontend origin (Requests' `documentCheckoutOrigin`,
// ENV_MISSING or INVALID_INPUT when it is not configured) and a known network for the chain (UNKNOWN).
//
// Another concept's operation an action here runs (`organizations.proposals.sendSigned`,
// `payments.executions.complete`, ...) is named in words: an rpc or workflow cannot link an rpc,
// and its tables are not folded in. Paths in `was` are relative to the old repository root.

import { Schema } from "effect";
import { defineRpc, defineWorkflow, type CallRef } from "../../../packages/book/src/index.ts";

import { concept_accounts } from "../shared/foundation.ts";
import { integration_chain_rpc, integration_mail } from "../shared/external.ts";
import {
  error_ENV_MISSING,
  error_FEATURE_NOT_AVAILABLE,
  error_INVALID_INPUT,
  error_NOT_AUTHENTICATED,
  error_ROLE_PERMISSION_DENIED,
  error_SUPERSEDED,
  error_TRANSACTION_FAILED,
  error_UNKNOWN,
  error_WRONG_STATE,
} from "../shared/vocabulary.ts";
import {
  procedure_access_authenticated_user,
  procedure_access_require_authenticated_user,
  procedure_access_require_feature_from_action,
} from "../access/procedures.ts";
import {
  procedure_organizations_read_organization_name_in_tx,
  procedure_organizations_read_safe_proposal_approval_subject_in_tx,
  procedure_organizations_read_safe_proposal_step_in_tx,
} from "../organizations/procedures.ts";
import { procedure_parties_party_by_safe_address, procedure_parties_release_agent_handle } from "../parties/procedures.ts";
import { table_money_executions } from "../payments/data.ts";
import {
  procedure_payments_has_execution_provider_attempt_in_tx,
  procedure_payments_read_approval_execution_in_tx,
  procedure_payments_read_command_join_in_tx,
  procedure_payments_read_payment_payout_deadline_in_tx,
  procedure_payments_read_signing_subject_in_tx,
  procedure_payments_schedule_for_execution_in_tx,
} from "../payments/procedures.ts";
import { procedure_payroll_read_agreement_write_outcome_in_tx } from "../payroll/procedures.ts";
import {
  procedure_permissions_abandon_unsent_permission_command_in_tx,
  procedure_permissions_read_permission_approval_subject_in_tx,
  procedure_permissions_read_permission_execution_outcome_in_tx,
} from "../permissions/procedures.ts";
import {
  procedure_profiles_read_profile_display_name_in_tx,
  procedure_profiles_read_profile_is_ai_in_tx,
} from "../profiles/procedures.ts";
import {
  machine_agent,
  machine_approval,
  table_agent_changes,
  table_agents,
  table_approvals,
  table_smart_accounts,
} from "./data.ts";

const BACKEND = "packages/backend";
const CONVEX = `${BACKEND}/convex/accounts/approvals.ts`;
const A = `${BACKEND}/src/accounts`;
const AP = `${A}/approvals`;
const OPS = `${AP}/operations`;
const ROWS = "packages/protocol/src/accounts/operations.ts";
const SRC = `${BACKEND}/src`;

const rpcCall = (name: string): CallRef =>
  (integration_chain_rpc.c as Record<string, CallRef | undefined>)[name] ?? {
    _kind: "call",
    id: `chain-rpc.${name}`,
    integration: "chain-rpc",
    name,
  };

const S = Schema.String;
const N = Schema.Number;
const NullOr = Schema.NullOr;
const opt = Schema.optionalKey;

const noChain = { calls: [], chain: [], spans: [] } as const;

// ── shapes ──────────────────────────────────────────────────────────────────────────────────

const APPROVAL_KINDS = [
  "payment",
  "payroll_run",
  "payment_cancel",
  "payment_redirect",
  "permission_change",
  "invitation",
  "bank_payout",
  "safe_proposal",
  "payroll_agreement",
  "director_change",
  "agent",
  "vote",
  "share_transfer",
] as const;
const AssetAmount = Schema.Struct({ asset: S, value: S });
/** `WarningSchema` (protocol primitives/warning): read with any code. */
const Warning = Schema.Struct({ code: S, message: S });

/** `ApprovalSchema` (protocol accounts/approval-schema.ts:145): the record as its person reads it. */
export const Approval = Schema.Struct({
  approvalId: S,
  url: S,
  kind: Schema.Literals(APPROVAL_KINDS),
  state: Schema.Literals(["pending", "approved", "rejected", "consumed", "expired"]),
  actor: Schema.Union([
    Schema.Struct({ kind: Schema.Literal("personal") }),
    Schema.Struct({ kind: Schema.Literal("organization"), orgId: S }),
  ]),
  summary: Schema.Struct({
    title: S,
    from: Schema.Struct({ kind: Schema.Literals(["personal", "organization"]), label: S, address: S }),
    to: Schema.Struct({ label: S }),
    amount: NullOr(AssetAmount),
    recipients: Schema.Array(
      Schema.Struct({
        label: S,
        amount: AssetAmount,
        requestedOutput: NullOr(Schema.Struct({ currency: S, value: S, decimals: N })),
        exact: Schema.Boolean,
        rail: Schema.Literals(["wallet", "bank"]),
        warning: NullOr(Warning),
      }),
    ),
    network: Schema.Struct({ chainId: N, name: S, explorerUrl: S }),
    warnings: opt(Schema.Array(Warning)),
  }),
  operation: Schema.Struct({
    executionId: S,
    commandId: opt(S),
    digest: S,
    /** `PersonalUnsignedUserOperationSchema`: the payments concept's shape, parsed from unsignedUserOpJson. */
    userOperation: Schema.Unknown,
    paymentIds: Schema.Array(S),
  }),
  signer: Schema.Struct({ address: S }),
  expiresAt: N,
  createdAt: N,
  reviewedAt: NullOr(N),
  decidedAt: NullOr(N),
  consumedAt: NullOr(N),
});

const ApprovalId = Schema.Struct({ approvalId: S });
const SIGNER = "A signed-in person whose key must sign the approval; anyone else, or an unknown id, gets ROLE_PERMISSION_DENIED.";
const CALL_ERRORS = [error_NOT_AUTHENTICATED, error_INVALID_INPUT, error_UNKNOWN, error_ENV_MISSING];

/** What every open-for-* takes beyond its subject: the operation the other concept's action built. */
const RelayedOperation = {
  authUserId: S,
  chainId: N,
  digest: S,
  unsignedUserOpJson: S,
  signerAddress: S,
  expiresAt: N,
};
const RelayedSummary = Schema.Struct({
  title: S,
  from: Schema.Struct({ label: S, address: S }),
  to: Schema.Struct({ label: S }),
});

/** `openApproval` (writes.ts:52): the birth row, the scheduled expiry and the scheduled notice. */
const OPEN_WAS = [`${AP}/writes.ts:52`, `${AP}/writes.ts:75`, `${AP}/writes/notices.ts:17`];

// ── public ──────────────────────────────────────────────────────────────────────────────────

export const rpc_accounts_approvals_request = defineRpc({
  id: "accounts.approvals.request",
  title: "Open the approval for one of the caller's prepared executions",
  about:
    "Public mutation, idempotent per execution. The execution must be the caller's own (Payments' " +
    "`readSigningSubjectInTx`, INVALID_INPUT). An approval already opened for it answers as it stands. Its expiry is the " +
    "earlier of the operation's sponsorship end and a bank payout's deadline (Payments' `readPaymentPayoutDeadlineInTx`); " +
    "an execution not `prepared`, or already past that, is WRONG_STATE. The content is written once from the stored " +
    "command: a Permission or invitation command reads what it changes (Permissions' `readPermissionApprovalSubjectInTx`, " +
    "the Organization's name, the member's or invitee's Party) and carries no Payment; a Payment command (none stored is " +
    "an UNKNOWN defect) is a payment_cancel, payment_redirect, bank_payout (a Payment with rail links), payroll_run or " +
    "payment, from the Organization's name or the person's Profile name (else their email), with one recipient row per " +
    "Payment and a redirect's new recipient named from its Party. It inserts the `pending` row and schedules its expiry " +
    "and its notice.",
  was: [`${CONVEX}:22`, `${OPS}/request.ts:76`, `${OPS}/request.ts:34`, `${AP}/reads.ts:121`, `${AP}/reads.ts:130`, `${AP}/reads.ts:152`, `${AP}/rules.ts:29`, `${AP}/rules.ts:108`, `${AP}/rules.ts:207`, ...OPEN_WAS, `${ROWS}:164`],
  concept: concept_accounts,
  kind: "mutation",
  who: "A signed-in person, for a prepared execution they own.",
  input: Schema.Struct({ executionId: S }),
  output: Approval,
  errors: [...CALL_ERRORS, error_WRONG_STATE],
  reads: [table_approvals],
  writes: [table_approvals],
  drives: [],
  invokes: [
    procedure_access_authenticated_user,
    procedure_payments_read_signing_subject_in_tx,
    procedure_payments_read_payment_payout_deadline_in_tx,
    procedure_permissions_read_permission_approval_subject_in_tx,
    procedure_parties_party_by_safe_address,
    procedure_organizations_read_organization_name_in_tx,
    procedure_profiles_read_profile_display_name_in_tx,
  ],
  emits: [],
  ...noChain,
});

export const rpc_accounts_approvals_get = defineRpc({
  id: "accounts.approvals.get",
  title: "Read one's own approval, its state judged against the clock",
  about:
    "Public query. The caller's own approval (`by_approval_id`, `.unique()`), its state judged against the backend clock " +
    "shim (a query has no business clock, ADR-0041 D3): a pending or approved row past expiresAt reads expired.",
  was: [`${CONVEX}:10`, `${OPS}/get.ts:14`, `${AP}/guards.ts:13`, `${AP}/reads.ts:45`, `${AP}/views.ts:20`, `${ROWS}:171`],
  concept: concept_accounts,
  kind: "query",
  who: SIGNER,
  input: ApprovalId,
  output: Approval,
  errors: [...CALL_ERRORS, error_ROLE_PERMISSION_DENIED],
  reads: [table_approvals],
  writes: [],
  drives: [],
  invokes: [procedure_access_authenticated_user],
  emits: [],
  ...noChain,
});

export const rpc_accounts_approvals_observe = defineRpc({
  id: "accounts.approvals.observe",
  title: "Read whether an approval's signed operation completed",
  about:
    "Public query: the owned approval and whether what it signed is done; it never sends or consumes. Only a consumed " +
    "approval can be complete: a Safe proposal step when Organizations' `readSafeProposalStepInTx` says done (dropped is " +
    "TRANSACTION_FAILED); an agreement write once sent (Payroll's `readAgreementWriteOutcomeInTx`: failed is " +
    "TRANSACTION_FAILED, abandoned, dropped, replaced or unknown SUPERSEDED); a Board seat, vote or share sale at once; an " +
    "agent create or change once sent (a failed one TRANSACTION_FAILED). A money execution (Payments' " +
    "`readApprovalExecutionInTx`): signer refused or a failed, rejected, dropped, replaced or reverted state is " +
    "TRANSACTION_FAILED; expired, superseded, displaced, or prepared past its expiry is SUPERSEDED; a prepared one whose " +
    "dated schedule is stored is done; still sending is not; a Payment is done once its hash is known, a Permission or " +
    "invitation only when Permissions' `readPermissionExecutionOutcomeInTx` says applied (mismatch TRANSACTION_FAILED). A " +
    "pending agreement-write approval already superseded is SUPERSEDED too. The response has no signature.",
  was: [`${CONVEX}:13`, `${OPS}/observe.ts:14`, `${AP}/reads.ts:175`, `${AP}/reads.ts:249`, `${AP}/reads.ts:279`, `${AP}/reads.ts:305`, `${AP}/errors.ts:33`, `${AP}/errors.ts:59`, `${A}/agents/reads/rows.ts:41`, `${A}/agents/reads/rows.ts:83`, `${ROWS}:178`],
  concept: concept_accounts,
  kind: "query",
  who: SIGNER,
  input: ApprovalId,
  output: Schema.Struct({ approval: Approval, completed: Schema.Boolean }),
  errors: [...CALL_ERRORS, error_ROLE_PERMISSION_DENIED, error_SUPERSEDED, error_TRANSACTION_FAILED],
  reads: [table_approvals, table_agents, table_agent_changes],
  writes: [],
  drives: [],
  invokes: [
    procedure_access_authenticated_user,
    procedure_organizations_read_safe_proposal_step_in_tx,
    procedure_payroll_read_agreement_write_outcome_in_tx,
    procedure_payments_read_approval_execution_in_tx,
    procedure_payments_schedule_for_execution_in_tx,
    procedure_permissions_read_permission_execution_outcome_in_tx,
  ],
  emits: [],
  ...noChain,
});

export const rpc_accounts_approvals_review = defineRpc({
  id: "accounts.approvals.review",
  title: "Stamp the first open of a pending approval",
  about:
    "Public mutation, run when the approval page opens. A pending approval (judged at business time) with no reviewedAt is " +
    "stamped, so a waiting agent sees the person reviewing; any later open, or an ended approval, reads unchanged.",
  was: [`${CONVEX}:23`, `${OPS}/review.ts:19`, `${AP}/writes.ts:93`, `${ROWS}:185`],
  concept: concept_accounts,
  kind: "mutation",
  who: SIGNER,
  input: ApprovalId,
  output: Approval,
  errors: [...CALL_ERRORS, error_ROLE_PERMISSION_DENIED],
  reads: [table_approvals],
  writes: [table_approvals],
  drives: [],
  invokes: [procedure_access_authenticated_user],
  emits: [],
  ...noChain,
});

export const rpc_accounts_approvals_approve = defineRpc({
  id: "accounts.approvals.approve",
  title: "Record the person's signature over the operation's digest",
  about:
    "Public action (key recovery cannot run in a transaction: viem's recoverAddress refused a valid signature inside a " +
    "mutation on the devnet). It reads the approval as the caller (`accounts.approvals.get`). A gated kind re-checks its " +
    "money gate first (Access's `requireFeatureFromAction`: bank_payout `bank-payouts`, safe_proposal " +
    "`owner-safe-proposals`, an Organization's payroll_agreement `payment-agreements`, payroll_run `payroll-runs`; off is " +
    "FEATURE_NOT_AVAILABLE); payments, cancels, redirects, Permission changes, invitations, Board seats, votes, share sales " +
    "and agents are not re-checked. The signature must recover to the approval's signer over the stored digest " +
    "(INVALID_INPUT signature). Then `accounts.approvals.recordApproval` keeps it (and schedules the relay), and the " +
    "approval is read again. The backend never signs.",
  was: [`${CONVEX}:6`, `${OPS}/approve.ts:39`, `${OPS}/approve.ts:22`, `${AP}/errors.ts:66`, `${ROWS}:195`],
  concept: concept_accounts,
  kind: "action",
  who: SIGNER,
  input: Schema.Struct({ approvalId: S, signature: S }),
  output: Approval,
  errors: [...CALL_ERRORS, error_ROLE_PERMISSION_DENIED, error_WRONG_STATE, error_FEATURE_NOT_AVAILABLE],
  reads: [table_approvals],
  writes: [table_approvals],
  drives: [machine_approval.t.to_approved],
  invokes: [
    procedure_access_require_authenticated_user,
    procedure_access_require_feature_from_action,
    procedure_payments_read_signing_subject_in_tx,
    procedure_payments_read_payment_payout_deadline_in_tx,
  ],
  emits: [],
  ...noChain,
});

export const rpc_accounts_approvals_reject = defineRpc({
  id: "accounts.approvals.reject",
  title: "Say no to a pending approval",
  about:
    "Public mutation. A rejected approval answers again; anything not judged pending is WRONG_STATE. It records the " +
    "rejection with decidedAt; a permission_change approval also ends its unsent Permission command (Permissions' " +
    "`abandonUnsentPermissionCommandInTx`), noting abandoned or kept on the wide event. The prepared money execution keeps " +
    "its nonce lane until a client closes it (the SDK's reject calls payments.executions.abandon next) or its " +
    "sponsorship lapses.",
  was: [`${CONVEX}:21`, `${OPS}/reject.ts:16`, `${AP}/writes.ts:106`, `${AP}/writes.ts:119`, `${ROWS}:203`],
  concept: concept_accounts,
  kind: "mutation",
  who: SIGNER,
  input: ApprovalId,
  output: Approval,
  errors: [...CALL_ERRORS, error_ROLE_PERMISSION_DENIED, error_WRONG_STATE],
  reads: [table_approvals],
  writes: [table_approvals],
  drives: [machine_approval.t.to_rejected],
  invokes: [procedure_access_authenticated_user, procedure_permissions_abandon_unsent_permission_command_in_tx],
  emits: [],
  ...noChain,
});

export const rpc_accounts_approvals_consume = defineRpc({
  id: "accounts.approvals.consume",
  title: "Take the signature for the one submission",
  about:
    "Public mutation, the SDK's explicit submit. The approval must be judged approved or consumed and hold a signature " +
    "(else WRONG_STATE). An approved one is marked consumed with consumedAt; a consumed one answers again with the same " +
    "signature, so a submitter that crashed after consuming can finish. The execution itself is sent at most once by " +
    "Payments.",
  was: [`${CONVEX}:7`, `${OPS}/consume.ts:20`, `${AP}/writes.ts:109`, `${ROWS}:210`],
  concept: concept_accounts,
  kind: "mutation",
  who: SIGNER,
  input: ApprovalId,
  output: Schema.Struct({ approval: Approval, signature: S }),
  errors: [...CALL_ERRORS, error_ROLE_PERMISSION_DENIED, error_WRONG_STATE],
  reads: [table_approvals],
  writes: [table_approvals],
  drives: [machine_approval.t.to_consumed],
  invokes: [procedure_access_authenticated_user],
  emits: [],
  ...noChain,
});

// ── internal: the person's signature and its hand-off ───────────────────────────────────────

export const rpc_accounts_approvals_record_approval = defineRpc({
  id: "accounts.approvals.record-approval",
  title: "Keep a signature approve already proved is the signer's",
  about:
    "Internal mutation. The approval must exist and be this person's (ROLE_PERMISSION_DENIED). It judges the state at its " +
    "own business time (the `now` argument is taken and ignored). An approved approval with the same signature answers " +
    "null; anything not pending is WRONG_STATE. A non-relayed approval's execution is checked again (Payments' " +
    "`readSigningSubjectInTx` and the payout deadline: INVALID_INPUT, WRONG_STATE). It writes approved, the signature and " +
    "decidedAt, and schedules accounts.approvals.sendApproved at once.",
  was: [`${CONVEX}:19`, `${OPS}/record-approval.ts:25`, `${AP}/writes.ts:96`, `${AP}/rules.ts:299`],
  concept: concept_accounts,
  kind: "mutation",
  who: "internal: run through ctx.runMutation by accounts.approvals.approve, after the action proved the signature.",
  input: Schema.Struct({ authUserId: S, approvalId: S, signature: S, now: N }),
  output: Schema.Null,
  errors: [error_ROLE_PERMISSION_DENIED, error_WRONG_STATE, error_INVALID_INPUT],
  reads: [table_approvals],
  writes: [table_approvals],
  drives: [machine_approval.t.to_approved],
  invokes: [procedure_payments_read_signing_subject_in_tx, procedure_payments_read_payment_payout_deadline_in_tx],
  emits: [],
  ...noChain,
});

export const rpc_accounts_approvals_consume_approved = defineRpc({
  id: "accounts.approvals.consume-approved",
  title: "Hand an approved signature to its one durable send",
  about:
    "Internal mutation, recorded as the system job `send_approved`. It reads the approval and its bank payout's ids " +
    "(Payments' `readCommandJoinInTx`). A relayed approval is unsent until consumed; any other must still name its exact " +
    "money execution (read straight from Payments' `moneyExecutions` table: authUserId, chain, command kind, command id, " +
    "digest, signer and operation; a mismatch is INVALID_INPUT) and is unsent while that execution is `prepared`. No " +
    "signature, a state other than approved or consumed, or an unsent operation past expiresAt is WRONG_STATE. It marks " +
    "the approval consumed (when not yet) and hands back the person, execution, signature, record and payout.",
  was: [`${CONVEX}:8`, `${OPS}/consume-approved.ts:20`, `${AP}/guards.ts:21`, `${AP}/reads.ts:90`, `${AP}/writes.ts:109`],
  concept: concept_accounts,
  kind: "mutation",
  who: "internal: run through ctx.runMutation by the send_approved workflow.",
  input: Schema.Struct({ approvalId: S, now: N }),
  output: Schema.Struct({ authUserId: S, executionId: S, signature: S, approval: Schema.Unknown, payout: Schema.Unknown }),
  errors: [error_ROLE_PERMISSION_DENIED, error_INVALID_INPUT, error_WRONG_STATE],
  reads: [table_approvals, table_money_executions],
  writes: [table_approvals],
  drives: [machine_approval.t.to_consumed],
  invokes: [procedure_payments_read_command_join_in_tx],
  emits: [],
  ...noChain,
});

export const rpc_accounts_approvals_reschedule_approved = defineRpc({
  id: "accounts.approvals.reschedule-approved",
  title: "Schedule the send again after a pre-dispatch provider failure",
  about:
    "Internal mutation. Only a consumed approval with a signature; the retry is two seconds of business time later. A " +
    "relayed approval is asked again until the retry would reach its expiry. Any other needs its exact execution still " +
    "`prepared` with an expected hash and no sent hash, the retry before both the approval's expiry and the sponsorship's, " +
    "and no provider attempt (Payments' `hasExecutionProviderAttemptInTx`); then it schedules accounts.approvals.sendApproved " +
    "at that time and answers true, else false. Its own execution read reads Payments' `moneyExecutions` table directly.",
  was: [`${CONVEX}:25`, `${OPS}/reschedule-approved.ts:19`, `${AP}/guards.ts:21`],
  concept: concept_accounts,
  kind: "mutation",
  who: "internal: run through ctx.runMutation by the send_approved workflow when a send failed before dispatch.",
  input: ApprovalId,
  output: Schema.Boolean,
  errors: [error_ROLE_PERMISSION_DENIED, error_INVALID_INPUT],
  reads: [table_approvals, table_money_executions],
  writes: [],
  drives: [],
  invokes: [procedure_payments_has_execution_provider_attempt_in_tx],
  emits: [],
  ...noChain,
});

export const workflow_accounts_approvals_send_approved = defineWorkflow({
  id: "accounts.approvals.send-approved",
  title: "Consume an approved signature and relay its exact operation once",
  about:
    "Registered as the internal action `accounts/approvals:sendApproved`, scheduled at once by recordApproval and again two " +
    "seconds later by rescheduleApproved; run as the system job `send_approved`. It consumes the approval " +
    "(`consumeApproved`) and dispatches by kind. A relayed approval goes to its own area's send, as the person: " +
    "safe_proposal to `organizations.proposals.sendSigned`; payroll_agreement to `payroll.agreements.sendPayeeSigned` " +
    "(personal) or `sendSigned`; director_change to `organizations.directors.sendSigned`; agent to " +
    "`accounts.agents.sendSigned` or `sendChangeSigned`; share_transfer to `organizations.equity.sendTransferSigned`; vote " +
    "to `organizations.votes.sendSignedBallot`, `sendSignedExecution` or `sendSigned` by id prefix. A money execution: a " +
    "dated payment's signature is stored for its date (Payments' `scheduledSubmitted`); else Payments' " +
    "`submitStoredExecution` sends the stored operation at most once, and the owning completion runs " +
    "(`payments.executions.complete`, `permissions.commands.completeExecution` or " +
    "`permissions.configurations.completeExecution`). A PROVIDER_ERROR or PROVIDER_RESPONSE_INVALID that is not a " +
    "definitive rejection runs rescheduleApproved; the run then fails with that error (a relay admits INVALID_INPUT, WRONG_STATE, ROLE_PERMISSION_DENIED, SMART_ACCOUNT_MISSING, PROVIDER_ERROR, PROVIDER_RESPONSE_INVALID and FEATURE_NOT_AVAILABLE). Timeout is Convex's action limit.",
  was: [`${CONVEX}:24`, `${OPS}/send-approved.ts:214`, `${OPS}/send-approved.ts:52`, `${OPS}/send-approved.ts:241`, `${OPS}/send-approved.ts:270`, `${AP}/writes.ts:96`, `${OPS}/reschedule-approved.ts:57`],
  concept: concept_accounts,
  priority: "critical",
  trigger: { after: rpc_accounts_approvals_record_approval },
  instance: { per: table_approvals },
  steps: [
    { name: "attribute", about: "Records the run as the system job `send_approved` with the approval id." },
    { name: "consume", about: "Runs accounts.approvals.consumeApproved (INVALID_INPUT, WRONG_STATE admitted)." },
    { name: "relay", about: "A relayed kind: runs its area's sendSigned action as the person with the stored operation and signature." },
    { name: "scheduled", about: "A money execution whose dated schedule takes the signature: stored for its date, nothing sent now." },
    { name: "submit", about: "Otherwise Payments' submitStoredExecution: load, claim, hasUserOperationByHash, sendUserOperation." },
    { name: "complete", about: "Runs the owning completion by command kind: payment, permission or invitation_configuration." },
    { name: "reschedule", about: "A provider failure that is not a definitive rejection runs accounts.approvals.rescheduleApproved." },
  ],
  reads: [table_approvals, table_money_executions],
  writes: [table_approvals],
  drives: [machine_approval.t.to_consumed],
  invokes: [procedure_payments_read_command_join_in_tx, procedure_payments_has_execution_provider_attempt_in_tx],
  emits: [],
  calls: [rpcCall("hasUserOperationByHash"), rpcCall("sendUserOperation")],
  chain: [],
  idempotency:
    "consumeApproved answers a consumed approval again; Payments' execution claim sends one operation once; a relayed area admits the same signed operation again.",
  timeoutMs: 600000,
  retries: { max: 0, backoff: "none" },
  compensation:
    "None: a failure after consumption leaves the approval consumed; only rescheduleApproved retries, and only before dispatch.",
});

// ── internal: the lapse ─────────────────────────────────────────────────────────────────────

export const rpc_accounts_approvals_record_expiry = defineRpc({
  id: "accounts.approvals.record-expiry",
  title: "Write the lapse of an approval nobody finished",
  about:
    "Internal mutation, recorded as the system job `expire_approval`. It reads the approval and its bank payout's ids. An " +
    "already expired row ends its unsent change again (rerun-safe). A row not judged expired at the job's business time is " +
    "left. Otherwise it writes expired; an unsent permission_change ends its command (Permissions' " +
    "`abandonUnsentPermissionCommandInTx`) and an agent create never sent fails and releases its handle " +
    "(`endUnsentAgentCreate`, Parties' `releaseAgentHandle`). Answers whether it expired, with the record and payout.",
  was: [`${CONVEX}:20`, `${OPS}/record-expiry.ts:32`, `${OPS}/record-expiry.ts:17`, `${AP}/writes.ts:112`, `${AP}/writes.ts:119`, `${A}/agents/writes/rows.ts:189`],
  concept: concept_accounts,
  kind: "mutation",
  who: "internal: run through ctx.runMutation by the expire workflow only.",
  input: Schema.Struct({ approvalId: S, now: N }),
  output: Schema.Struct({ expired: Schema.Boolean, approval: Schema.Unknown, payout: Schema.Unknown }),
  errors: [error_ROLE_PERMISSION_DENIED],
  reads: [table_approvals, table_agents],
  writes: [table_approvals, table_agents],
  drives: [machine_approval.t.to_expired, machine_agent.t.to_failed],
  invokes: [
    procedure_payments_read_command_join_in_tx,
    procedure_permissions_abandon_unsent_permission_command_in_tx,
    procedure_parties_release_agent_handle,
  ],
  emits: [],
  ...noChain,
});

export const workflow_accounts_approvals_expire = defineWorkflow({
  id: "accounts.approvals.expire",
  title: "Record an approval's lapse at its expiry",
  about:
    "Registered as the internal action `accounts/approvals:expire`. Every open (request, the five open-for-*, an agent's " +
    "create and change) schedules it at the approval's expiresAt with runAtBusinessTime, which turns business time into " +
    "wall time (a devnet warp moves the backend clock). It runs as the system job `expire_approval`, runs " +
    "accounts.approvals.recordExpiry and names the approval, its Payments and bank payout on its own wide event. An " +
    "action on purpose: a failed scheduled mutation has no reporter (#1828). Nothing retries it.",
  was: [`${CONVEX}:9`, `${OPS}/expire.ts:31`, `${AP}/writes.ts:52`, `${AP}/writes.ts:75`, `${AP}/events.ts:21`],
  concept: concept_accounts,
  priority: "normal",
  trigger: { after: rpc_accounts_approvals_request },
  instance: { per: table_approvals },
  waits: [{ name: "lapse", for: "timer", about: "Until the approval's expiresAt, converted from business time to wall time when it was opened." }],
  steps: [
    { name: "attribute", about: "Records the run as the system job `expire_approval` with the approval id." },
    { name: "record", about: "Runs accounts.approvals.recordExpiry with the business time now." },
    { name: "annotate", about: "Names the approval, its state, Payments and bank payout on the run's wide event." },
  ],
  reads: [table_approvals, table_agents],
  writes: [table_approvals, table_agents],
  drives: [machine_approval.t.to_expired, machine_agent.t.to_failed],
  invokes: [
    procedure_payments_read_command_join_in_tx,
    procedure_permissions_abandon_unsent_permission_command_in_tx,
    procedure_parties_release_agent_handle,
  ],
  emits: [],
  calls: [],
  chain: [],
  idempotency: "recordExpiry leaves a row that is not judged expired, and a rerun on an expired row only repeats the idempotent abandons.",
  timeoutMs: 600000,
  retries: { max: 0, backoff: "none" },
});

// ── internal: the approval request email ────────────────────────────────────────────────────

export const rpc_accounts_approvals_notice_facts = defineRpc({
  id: "accounts.approvals.notice-facts",
  title: "Read what one approval's email is built from",
  about:
    "Internal query: the approval (null when none), whether it is still pending, the signer's mailbox (none for an AI, " +
    "Profiles' `readProfileIsAiInTx`; else the Party at the person's first Safe row on the approval's chain, Parties' " +
    "`partyBySafeAddress`), the title, the Organization's name (else the summary's from label), the page link (null " +
    "without a paired frontend), the recipient count and the total in minor units when it names one registered asset.",
  was: [`${CONVEX}:11`, `${OPS}/notice-facts.ts:12`, `${AP}/reads/notices.ts:63`, `${AP}/reads/notices.ts:40`],
  concept: concept_accounts,
  kind: "query",
  who: "internal: run through ctx.runQuery by the notify workflow.",
  input: ApprovalId,
  output: Schema.NullOr(
    Schema.Struct({
      approvalId: S,
      kind: Schema.Literals(APPROVAL_KINDS),
      pending: Schema.Boolean,
      email: NullOr(S),
      title: S,
      organizationName: S,
      url: NullOr(S),
      recipients: N,
      total: NullOr(Schema.Struct({ minor: S, decimals: N, symbol: S })),
    }),
  ),
  errors: [],
  reads: [table_approvals, table_smart_accounts],
  writes: [],
  drives: [],
  invokes: [
    procedure_profiles_read_profile_is_ai_in_tx,
    procedure_parties_party_by_safe_address,
    procedure_organizations_read_organization_name_in_tx,
  ],
  emits: [],
  ...noChain,
});

export const workflow_accounts_approvals_notify = defineWorkflow({
  id: "accounts.approvals.notify",
  title: "Email the person an opened approval waits for (G5)",
  about:
    "Registered as the internal action `accounts/approvals:notify`; every open schedules it at once in the opening's own " +
    "transaction, so a failed send never stops the approval. Run as the system job `approval_notices`. It reads the notice " +
    "facts; a pending approval with a mailbox gets one email: a payroll_run with a single-asset total the pay-run-approval " +
    "template, any other kind approval-pending (title, from, amount when known, link). An approval already decided, or a " +
    "person with no mailbox, sends nothing. Mail delivery (the Resend component) is tried three times; the failed " +
    "recipients are handed to a retry that schedules notify again with `attempt + 1` for them only. Answers sent and " +
    "failed counts.",
  was: [`${CONVEX}:12`, `${OPS}/notify.ts:20`, `${AP}/rules/notices.ts:34`, `${AP}/external.ts:23`, `${AP}/writes/notices.ts:17`],
  concept: concept_accounts,
  priority: "normal",
  trigger: { after: rpc_accounts_approvals_request },
  instance: { per: table_approvals },
  steps: [
    { name: "attribute", about: "Records the run as the system job `approval_notices`." },
    { name: "facts", about: "Runs accounts.approvals.noticeFacts; none ends the run with nothing sent." },
    { name: "plan", about: "Plans no email unless pending with a mailbox; pay-run-approval or approval-pending otherwise." },
    { name: "deliver", about: "Sends through the mail owner; a recipient the provider did not take is scheduled again, attempt + 1." },
  ],
  reads: [table_approvals, table_smart_accounts],
  writes: [],
  drives: [],
  invokes: [
    procedure_profiles_read_profile_is_ai_in_tx,
    procedure_parties_party_by_safe_address,
    procedure_organizations_read_organization_name_in_tx,
  ],
  emits: [],
  calls: [integration_mail.c.deliverNotices],
  chain: [],
  idempotency:
    "The notice key `accounts.approvals.notify:<approvalId>` names the send; a retry carries only the recipients that failed.",
  timeoutMs: 600000,
  retries: { max: 2, backoff: "exponential" },
});

// ── internal: relayed approvals other concepts open ─────────────────────────────────────────

const RELAYED_ERRORS = [error_WRONG_STATE, error_INVALID_INPUT, error_UNKNOWN, error_ENV_MISSING];

export const rpc_accounts_approvals_open_for_proposal = defineRpc({
  id: "accounts.approvals.open-for-proposal",
  title: "Open a Director's approval of a Safe proposal step",
  about:
    "Internal mutation, recorded as signed in as the Director. The command id is `<proposalId>:<approve|execute>` and the " +
    "execution id the money execution identity of it and the digest; no money execution stands behind it. The approval of " +
    "that execution, or the Director's still-open approval of the same step (a rebuild has a new digest, CAP-943), answers " +
    "with `opened: false`. The proposal (Organizations' `readSafeProposalApprovalSubjectInTx`) must be awaiting approvals " +
    "and the expiry ahead, else WRONG_STATE. It writes a `safe_proposal` approval for the Organization, its summary from " +
    "the proposal (Approve or Execute, the target's Party label, no amount), schedules expiry and notice, and answers " +
    "`opened: true`.",
  was: [`${CONVEX}:18`, `${OPS}/open-for-proposal.ts:36`, `${AP}/reads.ts:75`, `${AP}/rules.ts:249`, ...OPEN_WAS, `${SRC}/organizations/proposals/operations/request-approval.ts:42`],
  concept: concept_accounts,
  kind: "mutation",
  who: "internal: run through ctx.runMutation by Organizations' organizations.proposals.requestApproval.",
  input: Schema.Struct({ ...RelayedOperation, proposalId: S, step: Schema.Literals(["approve", "execute"]) }),
  output: Schema.Struct({ ...Approval.fields, opened: Schema.Boolean }),
  errors: RELAYED_ERRORS,
  reads: [table_approvals],
  writes: [table_approvals],
  drives: [],
  invokes: [
    procedure_organizations_read_safe_proposal_approval_subject_in_tx,
    procedure_parties_party_by_safe_address,
    procedure_organizations_read_organization_name_in_tx,
  ],
  emits: [],
  ...noChain,
});

export const rpc_accounts_approvals_open_for_agreement = defineRpc({
  id: "accounts.approvals.open-for-agreement",
  title: "Open a holder's or payee's approval of an agreement write",
  about:
    "Internal mutation, recorded as signed in as the person. The command id is `<agreementId>:<writeId>`; the same " +
    "operation answers with its approval. An expiry already past is WRONG_STATE. It writes a `payroll_agreement` approval " +
    "with the summary the caller built (title, from, to, an optional amount, no recipient rows): for the Organization when " +
    "an orgId is given, else personal (a payee's accept or collect), and schedules expiry and notice.",
  was: [`${CONVEX}:14`, `${OPS}/open-for-agreement.ts:29`, ...OPEN_WAS, `${SRC}/payroll/agreements/writes/actions.ts:164`, `${SRC}/payroll/agreements/writes/payee-actions.ts:77`],
  concept: concept_accounts,
  kind: "mutation",
  who: "internal: run through ctx.runMutation by Payroll's agreement writes and payee actions.",
  input: Schema.Struct({
    ...RelayedOperation,
    orgId: opt(S),
    agreementId: S,
    writeId: S,
    summary: Schema.Struct({ ...RelayedSummary.fields, amount: opt(AssetAmount) }),
  }),
  output: Approval,
  errors: RELAYED_ERRORS,
  reads: [table_approvals],
  writes: [table_approvals],
  drives: [],
  invokes: [],
  emits: [],
  ...noChain,
});

export const rpc_accounts_approvals_open_for_director_change = defineRpc({
  id: "accounts.approvals.open-for-director-change",
  title: "Open a founder's approval of a v4 Board seat",
  about:
    "Internal mutation (CAP-1150). The founder's own Safe, wearing the Shareholders' top hat, seats a Director: the " +
    "command id is the change id; the same operation answers with its approval; an expiry already past is WRONG_STATE. " +
    "It writes a personal `director_change` approval with the caller's summary and no amount, and schedules expiry and " +
    "notice. Once consumed it reads as handed off; organizations.directors.get reports whether the seat landed.",
  was: [`${CONVEX}:15`, `${OPS}/open-for-director-change.ts:27`, ...OPEN_WAS, `${SRC}/organizations/directors/writes.ts:192`],
  concept: concept_accounts,
  kind: "mutation",
  who: "internal: run through ctx.runMutation by Organizations' organizations.directors.add.",
  input: Schema.Struct({ ...RelayedOperation, changeId: S, summary: RelayedSummary }),
  output: Approval,
  errors: RELAYED_ERRORS,
  reads: [table_approvals],
  writes: [table_approvals],
  drives: [],
  invokes: [],
  emits: [],
  ...noChain,
});

export const rpc_accounts_approvals_open_for_vote = defineRpc({
  id: "accounts.approvals.open-for-vote",
  title: "Open a shareholder's approval of a v4 vote call",
  about:
    "Internal mutation (CAP-1202). The shareholder's own Safe proposes to, votes on or executes through the company " +
    "Governor: the command id is the vote, ballot (`bl_`) or execution (`ex_`) id; otherwise as open-for-director-change, " +
    "writing a personal `vote` approval.",
  was: [`${CONVEX}:17`, `${A}/approvals/operations/open-for-vote.ts:27`, ...OPEN_WAS, `${SRC}/organizations/votes/writes.ts:126`],
  concept: concept_accounts,
  kind: "mutation",
  who: "internal: run through ctx.runMutation by Organizations' votes writes.",
  input: Schema.Struct({ ...RelayedOperation, voteId: S, summary: RelayedSummary }),
  output: Approval,
  errors: RELAYED_ERRORS,
  reads: [table_approvals],
  writes: [table_approvals],
  drives: [],
  invokes: [],
  emits: [],
  ...noChain,
});

export const rpc_accounts_approvals_open_for_share_transfer = defineRpc({
  id: "accounts.approvals.open-for-share-transfer",
  title: "Open a shareholder's approval of their share sale",
  about:
    "Internal mutation (CAP-1217). The shareholder's personal Safe consents to the transfer and offers it on Exits: the " +
    "command id is the transfer id; otherwise as open-for-director-change, writing a personal `share_transfer` approval.",
  was: [`${CONVEX}:16`, `${OPS}/open-for-share-transfer.ts:27`, ...OPEN_WAS, `${SRC}/organizations/equity/writes/transfers.ts:107`],
  concept: concept_accounts,
  kind: "mutation",
  who: "internal: run through ctx.runMutation by Organizations' equity transfer writes.",
  input: Schema.Struct({ ...RelayedOperation, transferId: S, summary: RelayedSummary }),
  output: Approval,
  errors: RELAYED_ERRORS,
  reads: [table_approvals],
  writes: [table_approvals],
  drives: [],
  invokes: [],
  emits: [],
  ...noChain,
});
