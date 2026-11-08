// The as-is Core SDK flows of the old accounts concept: every public method of the SDK's
// accounts folder (packages/sdk/src/accounts/) that composes more than one backend call or does
// local work beyond reshaping an answer: client.approvals, client.me.agents, client.account and
// client.holdings. Methods that forward one rpc are listed in the comment at the end, with the
// rpc each forwards.
//
// client.approvals.prepare lives in this folder (accounts/approvals.ts:106) but is booked in
// payments/flows.ts, which owns that flow id; it is re-exported here so this concept's book
// lists it, and not redefined.
//
// A method run through `runIfActive` with no observer opens no SDK span (client.approvals,
// client.me.agents); one run through `runCapxulEffect` or `runPortEffect` opens a span named for
// its CAPXUL_OPERATIONS entry. A step that calls another concept's row this book does not own is
// named by its conventional rpc link. Paths in `was` are relative to the old repository root.

import { Schema } from "effect";
import { defineFlow } from "../../../packages/book/src/index.ts";
import { component_core_sdk } from "../shared/foundation.ts";
import { integration_openfort } from "../shared/external.ts";
import {
  error_CANCELLED,
  error_INVALID_INPUT,
  error_NOT_AUTHENTICATED,
  error_NOT_IMPLEMENTED,
  error_PROVIDER_ERROR,
  error_PROVIDER_RESPONSE_INVALID,
  error_SIGNER_REJECTED,
  error_SMART_ACCOUNT_MISSING,
  error_TRANSACTION_FAILED,
  error_UNKNOWN,
  error_WRONG_STATE,
} from "../shared/vocabulary.ts";
import { rpc_activity_overlays_get } from "../activity/overlays.ts";
import { rpc_operator_diagnostics_clock } from "../operator/diagnostics.ts";
import { rpc_payments_executions_abandon, rpc_payments_executions_submit_command } from "../payments/executions.ts";
import { rpc_payments_records_get, rpc_payments_records_get_for_organization } from "../payments/movements.ts";
import { rpc_permissions_commands_submit_execution } from "../permissions/commands.ts";
import { rpc_permissions_configurations_submit_execution } from "../permissions/configurations.ts";
import {
  Agent,
  rpc_accounts_agents_create,
  rpc_accounts_agents_get,
  rpc_accounts_agents_rotate_key,
} from "./agents.ts";
import {
  Approval,
  rpc_accounts_approvals_approve,
  rpc_accounts_approvals_consume,
  rpc_accounts_approvals_observe,
  rpc_accounts_approvals_reject,
  rpc_accounts_approvals_review,
} from "./approvals.ts";
import { rpc_accounts_balances_read } from "./balances.ts";
import { rpc_accounts_claims_claim } from "./claims.ts";
import { rpc_accounts_safes_load_by_auth_user_id, rpc_accounts_safes_provision } from "./safes.ts";

export { flow_client_approvals_prepare } from "../payments/flows.ts";

const SDK = "packages/sdk/src/accounts";
const PLATFORM = "packages/sdk/src/platform";

const S = Schema.String;
const opt = Schema.optionalKey;

/** The client-side signer the approve flow calls directly (external.ts books it as openfort). */
const signerCalls = [integration_openfort.c.getAddress, integration_openfort.c.signUserOpHash];
/** signerCall (payments signing): every signer throw is folded into these. */
const SIGNER_ERRORS = [error_SIGNER_REJECTED, error_PROVIDER_ERROR, error_PROVIDER_RESPONSE_INVALID];

/** `ApprovalOutcome` (approval-records.ts:262): where an approval ended and its Payments as they stand. */
const ApprovalOutcome = Schema.Struct({ approval: Approval, payments: Schema.Array(Schema.Unknown) });

/** `InvocationControls` (platform/actor/controls): a signal, time limits and observation ids, not data. */
const Controls = opt(Schema.Unknown);

// ── client.approvals ────────────────────────────────────────────────────────────────────────

export const flow_client_approvals_approve = defineFlow({
  id: "client.approvals.approve",
  title: "Sign an approval with this client's own signer and record it",
  about:
    "client.approvals.approve signs the approval's digest with the client's own signer. It needs a configured signer " +
    "(INVALID_INPUT signer). It reviews first (stamping the first open); an approved approval answers as it is, any other " +
    "state but pending is WRONG_STATE. The described operation must be the digest it signs: the approval's network must " +
    "be the client's chain and the SafeOp digest of its userOperation must equal the digest and match the execution id " +
    "(INVALID_INPUT approval). The signer's address must be the approval's signer (INVALID_INPUT signer). Then it signs " +
    "the digest and sends the signature to accounts.approvals.approve. Every read is fresh. No SDK span; no signal.",
  component: component_core_sdk,
  sdk: "client.approvals.approve",
  input: Schema.Struct({ approvalId: S }),
  output: Approval,
  steps: [
    { name: "signer", local: "build", about: "No configured signer is INVALID_INPUT signer." },
    { name: "review", rpc: rpc_accounts_approvals_review, about: "Fresh; an approved approval returns at once, a state other than pending is WRONG_STATE." },
    {
      name: "integrity",
      local: "build",
      about: "describedOperation: the approval's chain is the client's and the SafeOp digest of its operation equals the digest it asks to sign.",
    },
    { name: "address", local: "sign", about: "The signer's address (getAddress) must be the approval's signer, else INVALID_INPUT signer." },
    { name: "sign", local: "sign", about: "signUserOpHash over the approval's digest; a refusal is SIGNER_REJECTED." },
    { name: "approve", rpc: rpc_accounts_approvals_approve, about: "Sends { approvalId, signature }; the backend recovers and records it." },
  ],
  errors: [error_INVALID_INPUT, error_WRONG_STATE, ...SIGNER_ERRORS, error_UNKNOWN],
  calls: signerCalls,
  spans: [],
  was: [`${SDK}/approvals.ts:154`, `${SDK}/approvals.ts:45`, `${SDK}/approval-rules.ts:66`, `${PLATFORM}/client/financial-ops.ts:89`],
});

export const flow_client_approvals_reject = defineFlow({
  id: "client.approvals.reject",
  title: "Say no to an approval and close its prepared execution",
  about:
    "client.approvals.reject rejects the approval (accounts.approvals.reject), then, unless the SDK counts it relayed, " +
    "closes its prepared execution with payments.executions.abandon (reason signer_rejected) so the nonce lane frees; a " +
    "failed abandon replaces the result. The SDK's relayed set (approval-rules.ts:19) is safe_proposal, payroll_agreement, " +
    "director_change, vote and share_transfer: unlike the backend's it omits `agent`, so rejecting an agent's approval " +
    "also asks Payments to abandon an execution id no money execution has. No SDK span.",
  component: component_core_sdk,
  sdk: "client.approvals.reject",
  input: Schema.Struct({ approvalId: S }),
  output: Approval,
  steps: [
    { name: "reject", rpc: rpc_accounts_approvals_reject, about: "Fresh; a refusal is returned as it is." },
    { name: "relayed", local: "build", about: "A relayed approval (as the SDK counts them) has no execution to close: returned now." },
    { name: "abandon", rpc: rpc_payments_executions_abandon, about: "Sends { executionId, reason: signer_rejected }; its failure is the result." },
  ],
  errors: [error_UNKNOWN],
  calls: [],
  spans: [],
  was: [`${SDK}/approvals.ts:192`, `${SDK}/approval-rules.ts:19`],
});

export const flow_client_approvals_submit = defineFlow({
  id: "client.approvals.submit",
  title: "Send an approved operation once and return its Payments",
  about:
    "client.approvals.submit consumes the approval (accounts.approvals.consume), which hands back the person's signature. " +
    "A relayed approval (the SDK's set) returns with no Payments: Capxul relays it once approved. A permission_change goes " +
    "to permissions.commands.submitExecution and an invitation to permissions.configurations.submitExecution, returning no " +
    "Payments. Anything else goes to payments.executions.submitCommand and returns its Payments with their timing " +
    "normalized. An agent approval is not in the SDK's relayed set, so it reaches submitCommand. Explicit submit stays for " +
    "existing clients; the backend's send_approved job normally sends first. No SDK span.",
  component: component_core_sdk,
  sdk: "client.approvals.submit",
  input: Schema.Struct({ approvalId: S }),
  output: ApprovalOutcome,
  steps: [
    { name: "consume", rpc: rpc_accounts_approvals_consume, about: "Fresh; returns the approval and its signature." },
    { name: "relayed", local: "build", about: "A relayed approval returns { approval, payments: [] }." },
    { name: "submit-permission", rpc: rpc_permissions_commands_submit_execution, about: "permission_change: sends { executionId, signature }." },
    { name: "submit-invitation", rpc: rpc_permissions_configurations_submit_execution, about: "invitation: sends { executionId, signature }." },
    { name: "submit-payment", rpc: rpc_payments_executions_submit_command, about: "Any other: sends { executionId, signature } and normalizes the Payments' timing." },
  ],
  errors: [error_UNKNOWN],
  calls: [],
  spans: [],
  was: [`${SDK}/approvals.ts:203`, `${SDK}/approval-rules.ts:30`],
});

export const flow_client_approvals_wait = defineFlow({
  id: "client.approvals.wait",
  title: "Observe an approval's send until its Payments leave flight",
  about:
    "client.approvals.wait reads, one read per tick, never sending or consuming (CAP-603). It observes the approval " +
    "(accounts.approvals.observe) until it ends: pending, or not closed and not completed, reads again. `onApproved` runs " +
    "once when a read first shows it neither pending nor closed; its failure is swallowed. A rejected or expired approval, " +
    "or one moving no money, ends with no Payments. Otherwise it reads each Payment fresh (payments.records.get, or " +
    "getForOrganization in the approval's Organization scope) until none is pending, settling or in_transit, or the kind " +
    "ends once sent (cancel, redirect, Permission, invitation). A personal read finding no Payment is INVALID_INPUT " +
    "organizationId; another scope's Payment INVALID_INPUT paymentId. Waits start at 2 s and double to 15 s; `timeoutMs` " +
    "ends with CANCELLED reason deadline, also aborting a read in flight; the signal ends with CANCELLED. No SDK span.",
  component: component_core_sdk,
  sdk: "client.approvals.wait",
  input: Schema.Struct({
    approvalId: S,
    options: opt(
      Schema.Struct({
        signal: opt(Schema.Unknown),
        intervalMs: opt(Schema.Number),
        timeoutMs: opt(Schema.Number),
        onApproved: opt(Schema.Unknown),
        organizationId: opt(S),
      }),
    ),
  }),
  output: ApprovalOutcome,
  steps: [
    { name: "observe", rpc: rpc_accounts_approvals_observe, about: "One read of { approval, completed } per tick until the send ends." },
    { name: "approved", local: "build", about: "Calls onApproved once when the approval first reads approved or consumed." },
    { name: "payments", rpc: rpc_payments_records_get, about: "Personal scope: each of the approval's Payments, fresh." },
    { name: "payments-organization", rpc: rpc_payments_records_get_for_organization, about: "Organization scope: { orgId, paymentId } for each Payment." },
    { name: "backoff", local: "wait", about: "Sleeps 2 s, doubling to 15 s, within the deadline; an abort or the deadline is CANCELLED." },
  ],
  errors: [error_CANCELLED, error_INVALID_INPUT, error_UNKNOWN],
  calls: [],
  spans: [],
  was: [`${SDK}/approval-wait.ts:56`, `${SDK}/approval-rules.ts:38`, `${SDK}/approval-rules.ts:53`, `${SDK}/organization-approvals.ts:131`, `${SDK}/approvals.ts:235`],
});

// ── client.me.agents ────────────────────────────────────────────────────────────────────────

/** The agent's key as the SDK returns it once: where the caller keeps it, and the private key itself. */
const AgentKey = Schema.Struct({ store: Schema.Literals(["file", "env"]), privateKey: S });

export const flow_client_me_agents_create = defineFlow({
  id: "client.me.agents.create",
  title: "Make an agent's key here and open the owner's approval of its create",
  about:
    "client.me.agents.create generates the agent's private key on this machine (viem generatePrivateKey) and sends only its " +
    "address with the name and optional handle to accounts.agents.create. It checks the backend named this key and this " +
    "trimmed name (INVALID_INPUT signer or name), then returns `awaiting_approval` with the agent, the approval and the " +
    "key ({ store: file by default, privateKey }), once; the key is never sent anywhere. Storing it is the caller's job. " +
    "No SDK span.",
  component: component_core_sdk,
  sdk: "client.me.agents.create",
  input: Schema.Struct({
    input: Schema.Struct({ name: S, handle: opt(S), key: opt(Schema.Literals(["file", "env"])) }),
    options: Controls,
  }),
  output: Schema.Struct({
    status: Schema.Literal("awaiting_approval"),
    agent: Agent,
    approvalId: S,
    approval: Approval,
    key: AgentKey,
  }),
  steps: [
    { name: "key", local: "build", about: "Generates the agent's private key and derives its address locally." },
    { name: "create", rpc: rpc_accounts_agents_create, about: "Sends { name, handle?, signer }; a refusal is returned as it is." },
    { name: "check", local: "build", about: "The prepared agent's signer and name must be the ones asked for, else INVALID_INPUT." },
  ],
  errors: [error_INVALID_INPUT, error_CANCELLED, error_UNKNOWN],
  calls: [],
  spans: [],
  was: [`${SDK}/agents.ts:200`, `${SDK}/agents.ts:138`, `${SDK}/summaries.ts:95`],
});

export const flow_client_me_agents_rotate_key = defineFlow({
  id: "client.me.agents.rotate-key",
  title: "Make an agent's new key here and open the owner's approval of the swap",
  about:
    "client.me.agents.rotateKey generates the new key locally, sends only its address with the agent's id or handle to " +
    "accounts.agents.rotateKey, checks the backend named this key (INVALID_INPUT signer), and returns `awaiting_approval` " +
    "with both keys, the change id, the approval and the new private key once. Follow it with waitChange. No SDK span.",
  component: component_core_sdk,
  sdk: "client.me.agents.rotateKey",
  input: Schema.Struct({ ref: S, input: opt(Schema.Struct({ key: opt(Schema.Literals(["file", "env"])) })), options: Controls }),
  output: Schema.Struct({
    status: Schema.Literal("awaiting_approval"),
    agent: Agent,
    approvalId: S,
    approval: Approval,
    changeId: S,
    oldSigner: S,
    signer: S,
    key: AgentKey,
  }),
  steps: [
    { name: "lookup", local: "build", about: "A ref starting `agent_` is an id, anything else a handle without its `@`." },
    { name: "key", local: "build", about: "Generates the new private key and derives its address locally." },
    { name: "rotate", rpc: rpc_accounts_agents_rotate_key, about: "Sends the lookup and the new signer address." },
    { name: "check", local: "build", about: "The prepared new signer must be this key, else INVALID_INPUT signer." },
  ],
  errors: [error_INVALID_INPUT, error_CANCELLED, error_UNKNOWN],
  calls: [],
  spans: [],
  was: [`${SDK}/agent-keys.ts:43`, `${SDK}/agent-keys.ts:73`, `${SDK}/agents.ts:249`, `${SDK}/agents.ts:171`],
});

export const flow_client_me_agents_wait = defineFlow({
  id: "client.me.agents.wait",
  title: "Follow an agent until it reads as the state asked for",
  about:
    "client.me.agents.wait reads the agent (accounts.agents.get, which settles a sent create or change from the chain) every " +
    "2 s until it reads `until` (active by default; frozen or removed). A failed agent is TRANSACTION_FAILED " +
    "(agent_not_created); 180 s by default, or the signal aborting the sleep, ends with WRONG_STATE naming the state it " +
    "last read. A failed read is returned as it is. No SDK span.",
  component: component_core_sdk,
  sdk: "client.me.agents.wait",
  input: Schema.Struct({
    agentId: S,
    options: opt(Schema.Struct({ timeoutMs: opt(Schema.Number), until: opt(Schema.Literals(["active", "frozen", "removed"])), signal: opt(Schema.Unknown) })),
  }),
  output: Agent,
  steps: [
    { name: "read", rpc: rpc_accounts_agents_get, about: "One read of the agent per tick." },
    { name: "sleep", local: "poll", about: "Two seconds between reads, until the deadline or an abort." },
  ],
  errors: [error_TRANSACTION_FAILED, error_WRONG_STATE, error_UNKNOWN],
  calls: [],
  spans: [],
  was: [`${SDK}/agents.ts:255`, `${SDK}/agents.ts:50`],
});

export const flow_client_me_agents_wait_change = defineFlow({
  id: "client.me.agents.wait-change",
  title: "Follow one owner's change to an agent until it lands",
  about:
    "client.me.agents.waitChange reads the agent with { agentId, changeId } (accounts.agents.get) every 2 s until its " +
    "`lastChange` with that id is landed. Failed is TRANSACTION_FAILED (agent_change_failed); the 180 s deadline is " +
    "WRONG_STATE naming the change's state (or `missing`); an abort is CANCELLED. No SDK span.",
  component: component_core_sdk,
  sdk: "client.me.agents.waitChange",
  input: Schema.Struct({ agentId: S, changeId: S, options: opt(Schema.Struct({ timeoutMs: opt(Schema.Number), signal: opt(Schema.Unknown) })) }),
  output: Schema.Unknown,
  steps: [
    { name: "read", rpc: rpc_accounts_agents_get, about: "One read of the agent with the change id per tick." },
    { name: "sleep", local: "poll", about: "Two seconds between reads, capped at the time left." },
  ],
  errors: [error_TRANSACTION_FAILED, error_WRONG_STATE, error_CANCELLED, error_UNKNOWN],
  calls: [],
  spans: [],
  was: [`${SDK}/agents.ts:242`, `${SDK}/agent-changes.ts:88`],
});

// ── client.account ──────────────────────────────────────────────────────────────────────────

/** `AccountLifecycle` (account-lifecycle.ts:44). */
const AccountLifecycle = Schema.Union([
  Schema.Struct({ status: Schema.Literal("loading") }),
  Schema.Struct({ status: Schema.Literal("settingUp"), step: Schema.Literals(["connecting", "confirmingIdentity", "registering", "activating"]) }),
  Schema.Struct({ status: Schema.Literal("ready"), accountId: S, canTransact: Schema.Boolean }),
  Schema.Struct({
    status: Schema.Literal("failed"),
    at: Schema.Literals(["connecting", "confirmingIdentity", "registering", "activating"]),
    error: Schema.Unknown,
  }),
]);

export const flow_client_account_get_lifecycle = defineFlow({
  id: "client.account.get-lifecycle",
  title: "Report where the person's Account setup stands",
  about:
    "client.account.getLifecycle reads the identity actor's provisioning phase, then the durable status: the session (the " +
    "actor's, else the auth cache, which it restores) and the person's first Safe row (accounts.safes.loadByAuthUserId). " +
    "No session is `loading`. When the client's requirement is met (a deployed requirement needs the row deployed, claimed " +
    "and with a signer) it reads the balance (accounts.balances.read, retried on a reconnect) only to learn the Account " +
    "id, so a failed chain read turns a ready Account into `failed`. A failed actor phase is `failed` at its step; an " +
    "active or idle phase is `settingUp`. A read from a changed auth generation is cancelled. It never starts wallet " +
    "work. The CLI's `account show` and `account retry` read it.",
  component: component_core_sdk,
  sdk: "client.account.getLifecycle",
  input: Schema.Struct({}),
  output: AccountLifecycle,
  steps: [
    { name: "phase", local: "cache", about: "The identity actor's provisioning phase (idle, wallet, identity, provision, deploy, ready or failed)." },
    { name: "session", local: "cache", about: "The actor's session, else the auth cache's, restored into the actor; none is `loading`." },
    { name: "status", rpc: rpc_accounts_safes_load_by_auth_user_id, about: "The person's Safe row, mapped to accountReady, accountPrepared or accountRequired." },
    { name: "account-id", rpc: rpc_accounts_balances_read, about: "Only when the requirement is met: the balance read, for its accountId." },
    { name: "map", local: "build", about: "mapAccountLifecycle: loading, settingUp at a step, ready with canTransact, or failed at a step." },
  ],
  errors: [error_CANCELLED, error_INVALID_INPUT, error_UNKNOWN],
  calls: [],
  spans: ["account.status", "accounts.read"],
  was: [`${SDK}/account.ts:118`, `${SDK}/account-setup.ts:18`, `${SDK}/account-lane.ts:58`, `${SDK}/account-programs.ts:72`, `${SDK}/account-lifecycle.ts:92`, `${SDK}/balance-adapter.ts:49`],
});

export const flow_client_account_retry_setup = defineFlow({
  id: "client.account.retry-setup",
  title: "Resume or retry the person's Account setup",
  about:
    "client.account.retrySetup drives the identity actor. A restored session whose Account is unknown resumes: the status " +
    "must show a Safe row (else SMART_ACCOUNT_MISSING), a met requirement just reports, else the actor's EnsureAccount " +
    "runs (it loads the Safe row, provisions one when missing, and with a deployed requirement and a signer asks the " +
    "signer's address and claims). A retryable failure resets the signer's session when it can (a failure there is the " +
    "signer's error) and runs RetryAccount. Any other state is WRONG_STATE. It then reports the lifecycle as " +
    "getLifecycle does. A changed auth generation or an abort is cancelled.",
  component: component_core_sdk,
  sdk: "client.account.retrySetup",
  input: Schema.Struct({ options: Controls }),
  output: AccountLifecycle,
  steps: [
    { name: "state", local: "cache", about: "The actor's state: authenticated with an unknown Account resumes; failed and retryable retries." },
    { name: "status", rpc: rpc_accounts_safes_load_by_auth_user_id, about: "The person's Safe row (the actor's lane reads it again before provisioning)." },
    { name: "provision", rpc: rpc_accounts_safes_provision, about: "The actor's lane, when no Safe row exists: { authUserId, chainId, email }." },
    { name: "signer-address", local: "sign", about: "The actor's claim step asks the signer's address; the signer signs nothing." },
    { name: "claim", rpc: rpc_accounts_claims_claim, about: "The actor's claim step, with a deployed requirement and a signer: { chainId, signerAddress }." },
    { name: "reset-signer", local: "sign", about: "Before a retry, the signer's resetSession when it has one." },
    { name: "lifecycle", rpc: rpc_accounts_balances_read, about: "The report, as getLifecycle: the balance read only when the requirement is met." },
  ],
  errors: [error_SMART_ACCOUNT_MISSING, error_WRONG_STATE, error_CANCELLED, error_NOT_AUTHENTICATED, ...SIGNER_ERRORS, error_UNKNOWN],
  calls: [integration_openfort.c.getAddress],
  spans: ["account.retrySetup", "account.status", "accounts.read"],
  was: [`${SDK}/account.ts:121`, `${SDK}/account-setup.ts:86`, `${SDK}/account-setup.ts:63`, `${SDK}/account-lane.ts:72`, "packages/sdk/src/access/identity/account-lane.ts:102", "packages/sdk/src/access/identity/account-lane.ts:41"],
});

// ── client.holdings ─────────────────────────────────────────────────────────────────────────

export const flow_client_holdings_current = defineFlow({
  id: "client.holdings.current",
  title: "Read the acting Safe's holdings from the Ponder indexer",
  about:
    "client.holdings.current needs the client's indexer origin (none is NOT_IMPLEMENTED). It asks the backend which Safe " +
    "the actor reads (activity.overlays.get, personal or an Organization's); no Safe is SMART_ACCOUNT_MISSING. It reads " +
    "the Ponder `balance` view for that Safe (the signed sum of indexed transfers) and the indexer's status, which only " +
    "dates the read: a failed status read makes it stale. Rows are the configured settlement assets with a non-negative " +
    "amount. The chain comes from the first balance or the status; neither is the status failure or " +
    "PROVIDER_RESPONSE_INVALID. Business time (operator.diagnostics.clock, a 2 s cached offset, the wall on failure) " +
    "dates freshness: stale past 60 s of block age. The two indexer reads go through the SDK's own Ponder reader (`/sql/db` and " +
    "`/status` with the session JWT, indexing/ponder/reads.ts:188 and :237), which no integration record books: a gap.",
  component: component_core_sdk,
  sdk: "client.holdings.current",
  input: Schema.Struct({ input: opt(Schema.Struct({ actor: opt(Schema.Unknown) })), options: opt(Schema.Struct({ signal: opt(Schema.Unknown) })) }),
  output: Schema.Struct({
    actor: Schema.Unknown,
    chainId: Schema.Number,
    observedAt: Schema.Number,
    stale: Schema.Boolean,
    rows: Schema.Array(
      Schema.Struct({ assetKind: Schema.Literal("erc20"), tokenAddress: S, symbol: S, decimals: Schema.Number, rawBalance: S }),
    ),
  }),
  steps: [
    { name: "scope", rpc: rpc_activity_overlays_get, about: "The actor's verified scope and Safe." },
    { name: "balances", local: "build", about: "The Ponder `balance` rows for the Safe, at the indexer's maximum page (an HTTP read the SDK makes itself)." },
    { name: "status", local: "build", about: "The indexer's per-chain sync head; a failure is tolerated and reads as stale." },
    { name: "clock", rpc: rpc_operator_diagnostics_clock, about: "The backend's business-time offset, cached for 2 s; a failure falls back to the wall." },
    { name: "freshness", local: "build", about: "observedAt is the head's block time; stale when it is over 60 s old or unknown." },
  ],
  errors: [error_NOT_IMPLEMENTED, error_SMART_ACCOUNT_MISSING, error_PROVIDER_RESPONSE_INVALID, error_PROVIDER_ERROR, error_CANCELLED, error_UNKNOWN],
  calls: [],
  spans: ["holdings.current"],
  was: [`${SDK}/holdings.ts:131`, `${SDK}/holdings.ts:43`, `${SDK}/holdings.ts:31`, `${PLATFORM}/clock/business.ts:25`, "packages/sdk/src/indexing/ponder/reads.ts:188", "packages/sdk/src/indexing/ponder/reads.ts:237"],
});

// ── Methods that forward one rpc: no flow; an operation names the rpc ─────────────────────────
//
// client.approvals.get                 → accounts.approvals.get, fresh (approvals.ts:61).
// client.approvals.review              → accounts.approvals.review, fresh (approvals.ts:231).
// client.me.agents.get                 → accounts.agents.get (agents.ts:196).
// client.me.agents.show                → accounts.agents.show, the ref as id or handle (agents.ts:227).
// client.me.agents.list                → accounts.agents.list (agents.ts:254).
// client.me.agents.freeze / unfreeze   → accounts.agents.freeze / unfreeze, reshaped as awaiting_approval (agents.ts:228).
// client.me.agents.sweep               → accounts.agents.sweep with to and asset (agents.ts:230, agent-changes.ts:40).
// client.me.agents.remove              → accounts.agents.remove (agents.ts:248, agent-changes.ts:69).
// client.me.get                        → accounts.summaries.me (summaries.ts:96).
// client.me.home                       → accounts.summaries.home with the client's chain; no chain is NOT_IMPLEMENTED;
//                                        positions lifted, invisible activity rows dropped (summaries.ts:106).
// client.me.depositInstructions        → accounts.summaries.depositInstructions, annotated (summaries.ts:133).
// client.me.signer                     → no call: the composed signer's kind and store (summaries.ts:82).
// client.accounts.read                 → accounts.balances.read, retried on a reconnect, valued with the mock rates;
//                                        a failure posts account_balance_failed (balances.ts:50, balance-adapter.ts:49).
// client._internal.accounts.fund       → accounts.grants.faucetMint after faucet_requested; an unknown asset is
//                                        INVALID_INPUT before the call; a failure posts faucet_failed (balance-adapter.ts:91).
// client.smartAccount.loadCurrent      → accounts.safes.loadByAuthUserId for the session (safe-programs.ts:78).
// client.smartAccount.provision        → accounts.safes.provision, then provisioning_safe_created (safe-programs.ts:108).
