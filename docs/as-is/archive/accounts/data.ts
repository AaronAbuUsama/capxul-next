// The old accounts concept's tables and the state machines that live on them, as the old code
// has them (factory, branch integration/factory). Evidence, not the target design.
//
// Tables: packages/backend/src/accounts/tables.ts, composed by packages/backend/convex/schema.ts:14-21.
// Machines: every state or status column with a literal union (welcomeFundingGrants.status,
// approvals.state, agents.state, agentChanges.state). Transitions are named to_<state>; `from`
// lists every state an old write moves the column from. A birth (an insert) has no source state
// and is said in the machine's `about`. The Safe row (smartAccounts) has a lifecycle but no state
// column: counterfactual (deployedAt null), deployed (deployedAt set), claim locked
// (claimLockId), claimed (claimedAt). It is described on the table, not booked as a machine.
//
// Paths in `was` are relative to the old repository root (/home/user/factory).

import { Schema } from "effect";
import { defineMachine, defineTable } from "../../../packages/book/src/index.ts";
import { concept_accounts } from "../shared/foundation.ts";
import { event_agent_transitioned } from "../shared/vocabulary.ts";

const B = "packages/backend/src/accounts";
const T = `${B}/tables.ts`;
const SCHEMA = "packages/backend/convex/schema.ts";

const KEPT = "Kept indefinitely: no job in the old code deletes or expires these rows.";

const opt = Schema.optionalKey;
const S = Schema.String;
const N = Schema.Number;
const NullOr = Schema.NullOr;

/** `APPROVAL_KINDS` (packages/protocol/src/accounts/approval-schema.ts:44), as tables.ts inlines them. */
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
  "share_transfer",
  "vote",
] as const;

const AssetAmount = Schema.Struct({ asset: S, value: S });
const RecipientWarning = Schema.Struct({ code: Schema.Literals(["RECIPIENT_ON_CAPXUL"]), message: S });

// ── tables ──────────────────────────────────────────────────────────────────────────────────

export const table_accounts = defineTable({
  id: "accounts",
  title: "Accounts (one logical money Account per person and chain)",
  about:
    "The logical money Account (M2 slice S1a): one per authenticated user and chain. `accountId` is an `account_` + ULID " +
    "brand, never the Safe address or an Openfort id; `smartAccountAddress` is the custody Safe, stored lowercase. " +
    "`ensureAccountInTx` creates it idempotently on (authUserId, chainId) during personal provisioning and Organization " +
    "setup, and refuses a second Account at one Safe on one chain. Nothing enforces the uniqueness in the schema: the " +
    "door reads use FIRST, UNIQUE or collect-and-count contracts of their own. An agent's `accountId` is minted in " +
    "`agents` but no `accounts` row is written for it. Other concepts read it directly, not through the door: Payments' " +
    "recipient labels (payments/views/recipients.ts:75) and request intents (payments/commands/writes/requests.ts:31). " +
    "The operator purge (`purgeAccountRowsInTx`) deletes rows; nothing else does.",
  was: [`${T}:15`, `${SCHEMA}:60`, `${B}/writes.ts:24`, `${B}/writes.ts:193`, "packages/backend/src/payments/views/recipients.ts:75"],
  concept: concept_accounts,
  tenancy: "person",
  tenantField: "authUserId",
  fields: Schema.Struct({
    accountId: S,
    authUserId: S,
    smartAccountAddress: S,
    chainId: N,
    createdAt: N,
  }),
  key: ["accountId"],
  indexes: [
    {
      name: "by_account_id",
      fields: ["accountId"],
      for: "One Account by id: recipient Safe, target, reconciliation, purge (`resolveAccountRecipientSafeInTx`, `readExactTargetAccountInTx`, `readAccountPurgeTargetInTx`).",
    },
    {
      name: "by_smart_account_address",
      fields: ["smartAccountAddress"],
      for: "The Accounts at one Safe, filtered by chain (`readAccountsAtSafeInTx`, `readInvitationAccountForSafeInTx`, `readPartyAccountBindingInTx`, `ensureAccountInTx`).",
      crossTenant: true,
    },
    {
      name: "by_auth_user_chain",
      fields: ["authUserId", "chainId"],
      for: "A person's Account on one chain, mostly Base Sepolia (`requirePaymentAccountInTx`, `accountIdForAuthUserOrNull`, `readBinding`).",
    },
  ],
  retention: "Kept indefinitely; only the operator purge (`purgeAccountRowsInTx`) deletes rows.",
});

export const table_smart_accounts = defineTable({
  id: "smart-accounts",
  title: "Smart accounts (a person's Safe and its claimed signer)",
  about:
    "A person's personal Safe per chain, keyed by the BetterAuth user (slice 4.2, PRD #462 derivation v2). " +
    "`smartAccountAddress` is a pure function of the session email (`personalSafeAddress`), stored lowercase; the " +
    "initializer owner is Companies House until the claim role swaps in the person's signer. Lifecycle without a state " +
    "column: born counterfactual (`deployedAt` null) by `accounts.safes.provision`; a claim takes a lock " +
    "(`claimLockId`, `deploymentInFlightAt`, ten-minute lease), records the exact signed transaction " +
    "(`claimUserOpHash`, `claimSignerAddress`, `claimUserOpJson`) before the send, and on confirmation sets " +
    "`signerAddress`, `claimedAt`, `claimTxHash` (and `deployedAt` from the proving block when it was still null). " +
    "`accounts.safes.recordDeployment` stamps a proven deployment. Despite its name, `claimUserOpHash` holds an EOA " +
    "transaction hash on Protocol v4 and `userOpHash` the same. Nothing in the schema makes (authUserId, chainId) unique; " +
    "some reads take the first row (`findSafe`) and some `.unique()` (`requireAccountSignerInTx`). An operator fixture writes rows directly " +
    "(`ensureProofPersonalAccountInTx`) and the purge deletes them.",
  was: [
    `${T}:35`,
    `${SCHEMA}:59`,
    `${B}/safes/writes.ts:24`,
    `${B}/claims/writes/rows.ts:40`,
    `${B}/claims/writes/rows.ts:70`,
    `${B}/claims/rules.ts:66`,
    `${B}/safes/writes.ts:73`,
  ],
  concept: concept_accounts,
  tenancy: "person",
  tenantField: "authUserId",
  fields: Schema.Struct({
    authUserId: S,
    signerAddress: opt(S),
    smartAccountAddress: S,
    chainId: N,
    deployedAt: NullOr(N),
    deploymentInFlightAt: opt(N),
    deployTxHash: opt(S),
    deployedAtBlock: opt(N),
    userOpHash: opt(S),
    claimLockId: opt(S),
    claimUserOpHash: opt(S),
    claimSignerAddress: opt(S),
    claimUserOpJson: opt(S),
    claimedAt: opt(N),
    claimTxHash: opt(S),
    createdAt: N,
  }),
  key: ["authUserId", "chainId"],
  indexes: [
    {
      name: "by_auth_user",
      fields: ["authUserId"],
      for: "A person's first Safe on any chain (`loadByAuthUserId`, `depositInstructions`, `readWorkspaceViewerSafeInTx`, `readSignupSafeAddressInTx`).",
    },
    {
      name: "by_smart_account_address",
      fields: ["smartAccountAddress"],
      for: "The Safe row at one address, for `accounts.safes.loadBySmartAccountAddress`.",
      crossTenant: true,
    },
    {
      name: "by_auth_user_chain",
      fields: ["authUserId", "chainId"],
      for: "A person's Safe on one chain: provision, claim, deployment, binding and the identity reads (`findSafe`, `requireAccountSignerInTx`).",
    },
  ],
  retention: "Kept indefinitely; only the operator purge and `removeFirstProofSafeInTx` delete rows.",
});

export const table_welcome_funding_grants = defineTable({
  id: "welcome-funding-grants",
  title: "Welcome funding grants (staging test-token grants per Safe and asset)",
  about:
    "Staging-only welcome funding: one durable claim per (chain, Safe, asset), so a repeated provision, confirmation, " +
    "scheduled run or repair never mints the same welcome asset twice. `grantKey` is `<chainId>:<safe>:<assetId>`. " +
    "`scheduleWelcomeFunding` inserts one `scheduled` row per synthetic fixture (USDC, USDT 1000 tokens; WETH 1) only when " +
    "SITE_URL is the staging API and CAPXUL_STAGING_WELCOME_FUNDING_ENABLED is `true`, on chain 84532; a scheduling " +
    "failure deletes the rows it inserted. `kind` is personal or organization: Organization setup schedules grants for the " +
    "company Safe through the same door function. `failureReason` is always `welcome_funding_mint_failed`.",
  was: [`${T}:62`, `${SCHEMA}:56`, `${B}/writes.ts:87`, `${B}/rules.ts:57`, `${B}/grants/writes.ts:21`, `${B}/grants/rules.ts:20`],
  concept: concept_accounts,
  tenancy: "owner",
  tenantField: "accountAddress",
  scope: "The owner is the Safe at `accountAddress`: a person's Safe (kind personal) or an Organization's (kind organization).",
  fields: Schema.Struct({
    grantKey: S,
    kind: Schema.Literals(["personal", "organization"]),
    accountAddress: S,
    chainId: N,
    assetId: opt(S),
    tokenAddress: opt(S),
    decimals: opt(N),
    rawAmount: S,
    status: Schema.Literals(["scheduled", "minting", "minted", "failed"]),
    attemptedAt: opt(N),
    completedAt: opt(N),
    txHash: opt(S),
    failureReason: opt(S),
    createdAt: N,
    updatedAt: N,
  }),
  key: ["grantKey"],
  indexes: [
    {
      name: "by_grant_key",
      fields: ["grantKey"],
      for: "The grant of one (chain, Safe, asset) before inserting (`scheduleWelcomeFunding`), and a Safe's grants by key prefix in the operator purge.",
    },
  ],
  retention:
    "Kept indefinitely; a `scheduled` grant is deleted when welcome funding is off at mint time (`releaseWelcomeGrant`), and the operator purge deletes a Safe's grants.",
});

export const table_approvals = defineTable({
  id: "approvals",
  title: "Approvals (a prepared action waiting for its signer)",
  about:
    "Lane 0: one prepared action waiting for its person to sign it on the approval page. The summary is written once by " +
    "the backend (from the stored execution and its Payments or Permission command, or from the caller's summary for the " +
    "open-for-* operations other concepts run) and the signature is the person's own, handed to the one submission; the " +
    "backend never signs. `executionId` is a money execution id for Payment, Permission and invitation approvals, and the " +
    "money execution identity of `<commandId>` and the digest for relayed approvals (Safe proposal steps, agreement writes, " +
    "Board seats, votes, share sales, agent creates and changes), which have no `moneyExecutions` row. `commandId` encodes " +
    "the relayed subject: `<proposalId>:<approve|execute>`, `<agreementId>:<writeId>`, `agent:<agentId>`, " +
    "`agent-change:<changeId>`, or the row's own id. `actor` and `summary.recipients` are optional only for rows written " +
    "before them. A pending or approved row past `expiresAt` reads as expired before the scheduled expiry writes it.",
  was: [`${T}:92`, `${SCHEMA}:62`, `${B}/approvals/writes.ts:52`, `${B}/approvals/rules.ts:47`, `${B}/approvals/rules.ts:299`],
  concept: concept_accounts,
  tenancy: "person",
  tenantField: "authUserId",
  scope: "Rows belong to the person whose key must sign; `actor` names the Organization whose money or Permissions an approval moves.",
  fields: Schema.Struct({
    approvalId: S,
    authUserId: S,
    kind: Schema.Literals(APPROVAL_KINDS),
    state: Schema.Literals(["pending", "approved", "rejected", "consumed", "expired"]),
    actor: opt(
      Schema.Union([
        Schema.Struct({ kind: Schema.Literal("personal") }),
        Schema.Struct({ kind: Schema.Literal("organization"), orgId: S }),
      ]),
    ),
    summary: Schema.Struct({
      title: S,
      from: Schema.Struct({ label: S, address: S }),
      to: Schema.Struct({ label: S }),
      amount: NullOr(AssetAmount),
      recipients: opt(
        Schema.Array(
          Schema.Struct({
            label: S,
            amount: AssetAmount,
            requestedOutput: NullOr(Schema.Struct({ currency: S, value: S, decimals: N })),
            exact: Schema.Boolean,
            rail: Schema.Literals(["wallet", "bank"]),
            warning: NullOr(RecipientWarning),
          }),
        ),
      ),
      warnings: opt(Schema.Array(RecipientWarning)),
    }),
    chainId: N,
    executionId: S,
    commandId: opt(S),
    digest: S,
    unsignedUserOpJson: S,
    paymentIds: Schema.Array(S),
    signerAddress: S,
    signature: opt(S),
    expiresAt: N,
    createdAt: N,
    reviewedAt: opt(N),
    decidedAt: opt(N),
    consumedAt: opt(N),
  }),
  key: ["approvalId"],
  indexes: [
    { name: "by_approval_id", fields: ["approvalId"], for: "One approval by id (`loadApproval`, `.unique()`), for every approval operation and the notice facts." },
    {
      name: "by_execution_id",
      fields: ["executionId"],
      for: "The approval of one execution, so a second open answers with it (`findApprovalForExecution`) and Payments names it (`readExecutionApprovalInTx`).",
    },
    {
      name: "by_command_auth_user",
      fields: ["commandId", "authUserId"],
      for: "A proposal step's open approval for one signer, so a rebuilt step answers with it (CAP-943, `findOpenApprovalForCommand`).",
    },
  ],
  retention: KEPT,
});

export const table_service_lanes = defineTable({
  id: "service-lanes",
  title: "Service lanes (the Companies House key's one send in flight)",
  about:
    "CAP-1097: one row per chain and sender (the Companies House tier service key). Its `holder` is the one send that may " +
    "sign, broadcast and wait for its receipt; another send is busy until the holder releases (sets `until` to 0) or the " +
    "180-second hold lapses, so two sends never take the same pending nonce. `until` is wall time, so a devnet time warp " +
    "cannot move it. A row is inserted on first reserve and only patched after.",
  was: [`${T}:180`, `${SCHEMA}:57`, `${B}/lanes/writes.ts:19`, `${B}/lanes/writes.ts:31`, `${B}/lanes/writes.ts:53`],
  concept: concept_accounts,
  tenancy: "global",
  fields: Schema.Struct({
    chainId: N,
    sender: S,
    holder: S,
    until: N,
  }),
  key: ["chainId", "sender"],
  indexes: [{ name: "by_sender", fields: ["chainId", "sender"], for: "The lane of one chain and sender (`reserveInTx`, `releaseInTx`, `.unique()`)." }],
  retention: KEPT,
});

export const table_agents = defineTable({
  id: "agents",
  title: "Agents (an account of its own that a person owns)",
  about:
    "W9 (CAP-1128): an agent a person owns. Its key is the one signer of its Safe; the owner's Safe controls it through " +
    "the AgentOwner module. `accountId` is minted here (`account_` + ULID) and meant to be bound when the agent first signs " +
    "in. Its Party (`partyId`) is reserved with the row, so its handle is held from the start, and claimed when the Safe " +
    "lands. A row still `creating` with no `userOpHash` once `expiresAt` passes reads as failed and frees its handle and " +
    "key, before the approval's expiry writes it. `frozen` and `removed` are booleans a landed change sets; the wire state " +
    "derives `frozen` and `removed` from them on an `active` row. A key rotation overwrites `signerAddress`. Addresses are " +
    "lowercased.",
  was: [`${T}:196`, `${SCHEMA}:61`, `${B}/agents/writes/rows.ts:59`, `${B}/agents/rules.ts:28`, `${B}/agents/writes/changes.ts:214`],
  concept: concept_accounts,
  tenancy: "person",
  tenantField: "ownerAuthUserId",
  fields: Schema.Struct({
    agentId: S,
    name: S,
    handle: S,
    accountId: S,
    chainId: N,
    safeAddress: S,
    signerAddress: S,
    ownerAuthUserId: S,
    ownerAccountId: opt(S),
    ownerEmail: S,
    ownerSafe: S,
    ownerSigner: S,
    state: Schema.Literals(["creating", "active", "failed"]),
    approvalId: S,
    expiresAt: N,
    userOpHash: opt(S),
    txHash: opt(S),
    partyId: opt(S),
    frozen: opt(Schema.Boolean),
    removed: opt(Schema.Boolean),
    createdAt: N,
    updatedAt: N,
  }),
  key: ["agentId"],
  indexes: [
    { name: "by_agent_id", fields: ["agentId"], for: "One agent by id (`readAgentInTx`, `.unique()`)." },
    { name: "by_handle", fields: ["handle"], for: "The agent a handle names now, and whether a handle is taken (`readAgentByHandleInTx`, `isHandleTakenInTx`).", crossTenant: true },
    { name: "by_owner", fields: ["ownerAuthUserId"], for: "Every agent one person owns, newest first (`accounts.agents.list`)." },
    { name: "by_safe_address", fields: ["safeAddress"], for: "No query in the accounts code reads it: a gap.", crossTenant: true },
    { name: "by_signer_address", fields: ["signerAddress"], for: "Whether a key already signs for an agent (`isSignerTakenInTx`).", crossTenant: true },
    { name: "by_party_id", fields: ["partyId"], for: "The agent behind a Party whose handle a new create takes back (`staleAgentPartyInTx`).", crossTenant: true },
  ],
  retention: KEPT,
});

export const table_agent_changes = defineTable({
  id: "agent-changes",
  title: "Agent changes (an owner's freeze, unfreeze, sweep, remove or key rotation)",
  about:
    "CAP-1129: an owner's change to an agent: the one call (or batch) from their Safe to AgentOwner, its approval, and what " +
    "the chain made of it. Only one change holds an agent at a time (`waiting` within its approval, or `sent`). A sweep " +
    "keeps its recipient (`to`), approved tokens and the amounts its AgentSwept events report (`swept`); a removal keeps " +
    "the tokens it sweeps to the owner and what each AgentSwept moved (`sweeps`); a rotation keeps the retired key " +
    "(`oldSigner`) and the new one (`signer`). A `waiting` change past `expiresAt` holds nothing but is never written failed.",
  was: [`${T}:230`, `${SCHEMA}:61`, `${B}/agents/writes/changes.ts:66`, `${B}/agents/rules.ts:76`],
  concept: concept_accounts,
  tenancy: "person",
  tenantField: "ownerAuthUserId",
  fields: Schema.Struct({
    changeId: S,
    agentId: S,
    ownerAuthUserId: S,
    kind: Schema.Literals(["freeze", "unfreeze", "sweep", "remove", "rotate"]),
    state: Schema.Literals(["waiting", "sent", "landed", "failed"]),
    approvalId: S,
    expiresAt: N,
    userOpHash: opt(S),
    txHash: opt(S),
    to: opt(S),
    tokens: opt(Schema.Array(S)),
    swept: opt(Schema.Array(Schema.Struct({ token: S, rawAmount: S }))),
    sweeps: opt(Schema.Array(Schema.Struct({ token: S, to: S, raw: S }))),
    oldSigner: opt(S),
    signer: opt(S),
    createdAt: N,
    updatedAt: N,
  }),
  key: ["changeId"],
  indexes: [
    { name: "by_change_id", fields: ["changeId"], for: "One change by id (`readChangeInTx`, `.unique()`)." },
    { name: "by_agent", fields: ["agentId"], for: "An agent's changes, newest first: the open one and `lastChange` (`readChangesInTx`)." },
  ],
  retention: KEPT,
});

// ── state machines ──────────────────────────────────────────────────────────────────────────

export const machine_welcome_funding_grant = defineMachine({
  id: "welcome-funding-grant",
  title: "Welcome funding grant status",
  about:
    "welcomeFundingGrants.status: scheduled → minting → minted or failed (grants/rules.ts:68). Born `scheduled` by " +
    "`scheduleWelcomeFunding` (writes.ts:114). Each transition applies only from the state before it, so a repeated or " +
    "late call changes nothing. A `scheduled` grant is deleted, not transitioned, when welcome funding is off at mint time " +
    "(`releaseWelcomeGrant`) or when scheduling failed after it was inserted. A `minting` grant whose action died stays " +
    "`minting`: nothing retries or times it out.",
  was: [`${T}:71`, `${B}/grants/rules.ts:68`, `${B}/writes.ts:114`, `${B}/grants/writes.ts:21`],
  table: table_welcome_funding_grants,
  field: "status",
  initial: "scheduled",
  states: [
    { id: "scheduled", about: "Inserted for one asset of a newly provisioned Safe; waits for the mint batch." },
    { id: "minting", about: "Claimed by a mint action; the mint is on its way." },
    { id: "minted", about: "The mint landed; `txHash` and `completedAt` are kept.", terminal: true },
    { id: "failed", about: "The mint failed; kept with `welcome_funding_mint_failed` so an operator sees what never arrived.", terminal: true },
  ],
  transitions: {
    to_minting: {
      from: ["scheduled"],
      to: "minting",
      about: "accounts.grants.claimWelcomeGrant stamps attemptedAt (grants/writes.ts:21).",
      guard: "The grant is `scheduled` and carries its assetId, tokenAddress and decimals (`isClaimable`); otherwise the claim answers null.",
      emits: [],
    },
    to_minted: {
      from: ["minting"],
      to: "minted",
      about: "accounts.grants.completeWelcomeGrant records the landed mint's hash (grants/writes.ts:31).",
      guard: "Only a `minting` grant moves; anything else is left.",
      emits: [],
    },
    to_failed: {
      from: ["minting"],
      to: "failed",
      about: "accounts.grants.failWelcomeGrant (grants/writes.ts:41); the minting action then posts faucet_failed.",
      guard: "Only a `minting` grant moves; anything else is left.",
      emits: [],
    },
  },
});

export const machine_approval = defineMachine({
  id: "approval",
  title: "Approval state",
  about:
    "approvals.state (APPROVAL_STATES, approval-schema.ts:67). Born `pending` by `openApproval` (approvals/writes.ts:52) " +
    "from accounts.approvals.request, the five open-for-* operations, accounts.agents.record and recordChange. " +
    "`judgedState` (rules.ts:47) reads a pending or approved row past `expiresAt` as expired before any write, so every " +
    "operation acts on the judged state; the stored state moves only through the writes below. `review` stamps " +
    "`reviewedAt` without a state change. No product event is emitted by any transition; each operation's wide event " +
    "names the approval and its state.",
  was: [`${T}:110`, `${B}/approvals/writes.ts:93`, `${B}/approvals/rules.ts:47`, "packages/protocol/src/accounts/approval-schema.ts:67"],
  table: table_approvals,
  field: "state",
  initial: "pending",
  states: [
    { id: "pending", about: "Waits for its person on the approval page." },
    { id: "approved", about: "Holds the person's signature, which recovered to the signer over the stored digest." },
    { id: "rejected", about: "The person said no; nothing is signed or sent.", terminal: true },
    { id: "consumed", about: "The signature was handed to the one submission; it reads again with the same signature.", terminal: true },
    { id: "expired", about: "Nobody finished it before its operation's sponsorship (or payout deadline) lapsed.", terminal: true },
  ],
  transitions: {
    to_approved: {
      from: ["pending"],
      to: "approved",
      about: "accounts.approvals.recordApproval keeps the signature and decidedAt, and schedules send_approved at once (writes.ts:96).",
      guard: "The person's own row, judged pending at backend time; a non-relayed approval's execution must still pass the payout deadline check.",
      emits: [],
    },
    to_rejected: {
      from: ["pending"],
      to: "rejected",
      about: "accounts.approvals.reject (writes.ts:106); a Permission change approval also abandons its unsent command.",
      guard: "Judged pending; a rejected row answers again unchanged.",
      emits: [],
    },
    to_consumed: {
      from: ["approved"],
      to: "consumed",
      about: "accounts.approvals.consume (a client's submit) or consumeApproved (the send_approved job) (writes.ts:109).",
      guard: "consume: judged approved. consumeApproved: approved with a signature, and not past expiresAt while its operation is unsent.",
      emits: [],
    },
    to_expired: {
      from: ["pending", "approved"],
      to: "expired",
      about: "accounts.approvals.recordExpiry from the scheduled expire job (writes.ts:112); an unsent Permission change or agent create ends with it.",
      guard: "Judged expired at the job's business time; any other row is left.",
      emits: [],
    },
  },
});

export const machine_agent = defineMachine({
  id: "agent",
  title: "Agent state (stored)",
  about:
    "agents.state as stored: creating, active, failed. Born `creating` by accounts.agents.record (agents/writes/rows.ts:113). " +
    "The wire state (`agentState`, rules.ts:28) adds three derived states the column never holds: a `creating` row with " +
    "no userOpHash past expiresAt reads `failed`; an `active` row with `removed` reads `removed`, with `frozen` reads " +
    "`frozen`. Freeze, unfreeze, remove and rotate land on the agent as patches of `frozen`, `removed` and " +
    "`signerAddress` by settleChange, not as state transitions.",
  was: [`${T}:209`, `${B}/agents/rules.ts:28`, `${B}/agents/writes/rows.ts:209`, `${B}/agents/writes/rows.ts:189`, "packages/protocol/src/accounts/agent-schema.ts:29"],
  table: table_agents,
  field: "state",
  initial: "creating",
  states: [
    { id: "creating", about: "Waits for the owner's approval of the AgentOwner.create call, then for its receipt." },
    { id: "active", about: "Its Safe landed with its key as the one signer; its Party is claimed. Frozen and removed are flags on this state." },
    { id: "failed", about: "The chain refused the create, or its approval lapsed unsent; its handle and Party are released.", terminal: true },
  ],
  transitions: {
    to_active: {
      from: ["creating"],
      to: "active",
      about: "accounts.agents.settle with outcome landed claims the reserved Party and schedules agent_transitioned (created) (writes/rows.ts:235).",
      guard: "The row is creating with the noted userOpHash, and the AgentCreated event names the agent's Safe; a row without a partyId is a stored-row defect.",
      emits: [event_agent_transitioned],
    },
    to_failed: {
      from: ["creating"],
      to: "failed",
      about:
        "accounts.agents.settle with outcome failed (writes/rows.ts:223), or `endUnsentAgentCreate` from accounts.approvals.recordExpiry when the create was never sent (writes/rows.ts:195). Both release the agent's handle.",
      guard: "settle: creating with the noted hash. Expiry: creating, no userOpHash, past expiresAt.",
      emits: [],
    },
  },
});

export const machine_agent_change = defineMachine({
  id: "agent-change",
  title: "Agent change state",
  about:
    "agentChanges.state: waiting → sent → landed or failed. Born `waiting` by accounts.agents.recordChange " +
    "(agents/writes/changes.ts:110). A send the bundler definitively refused, and does not hold, returns it to waiting. " +
    "A waiting change past its approval's expiry is never written failed: it simply stops holding the agent (`changeOpen`). " +
    "A landed change moves the agent (frozen flag, removed flag or signer) and schedules agent_transitioned.",
  was: [`${T}:235`, `${B}/agents/writes/changes.ts:134`, `${B}/agents/writes/changes.ts:163`, `${B}/agents/writes/changes.ts:186`, `${B}/agents/rules.ts:76`],
  table: table_agent_changes,
  field: "state",
  initial: "waiting",
  states: [
    { id: "waiting", about: "Waits for the owner's approval of its calls." },
    { id: "sent", about: "Its operation hash is noted and the operation sent; the follow job reads its receipt." },
    { id: "landed", about: "The receipt carried the expected AgentOwner event for the agent's Safe.", terminal: true },
    { id: "failed", about: "The chain refused it, or its receipt lacks the expected event; the agent is left as it was.", terminal: true },
  ],
  transitions: {
    to_sent: {
      from: ["waiting"],
      to: "sent",
      about: "accounts.agents.recordChangeSubmission notes the hash and schedules followChange in 10 s (changes.ts:147).",
      guard: "Waiting and not past expiresAt; the same hash noted again answers as is.",
      emits: [],
    },
    to_waiting: {
      from: ["sent"],
      to: "waiting",
      about: "accounts.agents.clearChangeSubmission hands a change the bundler refused back to its approval (changes.ts:176).",
      guard: "Sent with the same noted hash.",
      emits: [],
    },
    to_landed: {
      from: ["sent"],
      to: "landed",
      about: "accounts.agents.settleChange with outcome landed (changes.ts:213); it patches the agent and schedules agent_transitioned.",
      guard: "Sent with the same hash; the settling action decided the expected event names the agent's Safe (and a rotation's new key).",
      emits: [event_agent_transitioned],
    },
    to_failed: {
      from: ["sent"],
      to: "failed",
      about: "accounts.agents.settleChange with outcome failed (changes.ts:213).",
      guard: "Sent with the same hash.",
      emits: [],
    },
  },
});
