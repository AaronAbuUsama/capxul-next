// The as-is book of the old accounts concept: the agents area (W9: an agent a person owns, an
// account of its own; CAP-1128 create, CAP-1129 freeze/unfreeze/sweep, CAP-1130 key rotation,
// CAP-1131 removal).
//
// Every operation registered at `accounts/agents:*` (packages/backend/convex/accounts/agents.ts).
// Nine public rows of `agents` (packages/protocol/src/accounts/agent-operations.ts:40); internal
// queries and mutations the agent actions run through ctx.runQuery / ctx.runMutation; the two
// signed-send actions the approvals send_approved workflow runs through ctx.runAction (rpcs);
// the agent_transitioned poster (telemetry only, an rpc); and the two follow actions a noted send
// schedules and that schedule themselves again, the workflows.
//
// The agent's key is made on the caller's machine; the backend sees only its address. The
// owner's claimed personal Safe signs one sponsored UserOperation calling AgentOwner (create,
// freeze, unfreeze, sweep, remove or swapSigner) on the agent's own EntryPoint lane
// (keccak256(`agent:<agentId>`) cut to 192 bits); nothing is on chain until the owner approves it
// on the approval page. Paths in `was` are relative to the old repository root.

import { Schema } from "effect";
import { defineRpc, defineWorkflow, type CallRef, type FunctionRef } from "../../../packages/book/src/index.ts";

import { concept_accounts } from "../shared/foundation.ts";
import {
  contract_agent_owner,
  contract_entry_point,
  contract_erc20,
  contract_multi_send_call_only,
  contract_safe_4337_module,
  integration_chain_rpc,
} from "../shared/external.ts";
import {
  error_ENV_MISSING,
  error_INSUFFICIENT_BALANCE,
  error_INVALID_INPUT,
  error_NOT_AUTHENTICATED,
  error_PROVIDER_ERROR,
  error_PROVIDER_RESPONSE_INVALID,
  error_ROLE_PERMISSION_DENIED,
  error_SMART_ACCOUNT_MISSING,
  error_UNKNOWN,
  error_WRONG_STATE,
  event_agent_transitioned,
} from "../shared/vocabulary.ts";
import {
  procedure_access_authenticated_user,
  procedure_access_require_authenticated_user,
} from "../access/procedures.ts";
import {
  procedure_parties_claim_agent_party,
  procedure_parties_party_by_handle,
  procedure_parties_release_agent_handle,
  procedure_parties_reserve_agent_party,
} from "../parties/procedures.ts";
import { Approval } from "./approvals.ts";
import { AssetPosition } from "./balances.ts";
import {
  machine_agent,
  machine_agent_change,
  table_accounts,
  table_agent_changes,
  table_agents,
  table_approvals,
  table_smart_accounts,
} from "./data.ts";
import {
  procedure_accounts_account_id_for_auth_user_or_null,
  procedure_accounts_read_positions,
  procedure_accounts_read_workspace_setup_signer_in_tx,
} from "./procedures.ts";

const BACKEND = "packages/backend";
const CONVEX = `${BACKEND}/convex/accounts/agents.ts`;
const A = `${BACKEND}/src/accounts`;
const AG = `${A}/agents`;
const OPS = `${AG}/operations`;
const ROWS = "packages/protocol/src/accounts/agent-operations.ts";

const rpcCall = (name: string): CallRef =>
  (integration_chain_rpc.c as Record<string, CallRef | undefined>)[name] ?? {
    _kind: "call",
    id: `chain-rpc.${name}`,
    integration: "chain-rpc",
    name,
  };

const fn = (contract: { readonly id: string; readonly f: object }, name: string): FunctionRef =>
  (contract.f as Record<string, FunctionRef | undefined>)[name] ?? {
    _kind: "function",
    id: `${contract.id}.${name}`,
    contract: contract.id,
    name,
  };

const S = Schema.String;
const N = Schema.Number;
const NullOr = Schema.NullOr;
const opt = Schema.optionalKey;

const noChain = { calls: [], chain: [], spans: [] } as const;

// ── shapes (packages/protocol/src/accounts/agent-schema.ts) ─────────────────────────────────

const AgentSwept = Schema.Struct({ tokenAddress: S, rawAmount: S, to: S });
const AgentChange = Schema.Struct({
  changeId: S,
  kind: Schema.Literals(["freeze", "unfreeze", "sweep", "remove", "rotate"]),
  state: Schema.Literals(["waiting", "sent", "landed", "failed"]),
  txHash: NullOr(S),
  swept: NullOr(Schema.Array(AgentSwept)),
  sweeps: opt(Schema.Array(AgentSwept)),
  signer: opt(S),
});
/** `AgentSchema` (agent-schema.ts:71). */
export const Agent = Schema.Struct({
  agentId: S,
  name: S,
  handle: S,
  accountId: S,
  safe: S,
  signer: S,
  state: Schema.Literals(["creating", "active", "frozen", "removed", "failed"]),
  owner: Schema.Struct({ kind: Schema.Literal("person"), accountId: NullOr(S), email: S, safe: S }),
  txHash: NullOr(S),
  createdAt: N,
  lastChange: opt(AgentChange),
});
/** `AgentLookupSchema` (agent-schema.ts:128): by id or by @handle without the `@`. */
const AgentLookup = Schema.Union([Schema.Struct({ agentId: S }), Schema.Struct({ handle: S })]);
const ChangePrepared = Schema.Struct({ agent: Agent, approval: Approval });
const SweepItem = { symbol: S, decimals: N, tokenAddress: S, rawAmount: S };

// ── what the shared steps touch ─────────────────────────────────────────────────────────────

/** buildCreateOperation (agents/external.ts:85): the sponsored build from the owner's Safe on the agent's lane. */
const BUILD_CALLS = [rpcCall("fetchEntryPointNonce"), rpcCall("fetchUserOperationFees"), rpcCall("sponsorUserOperation")];
const BUILD_SPANS = [
  "chain.read eth_call",
  "chain.read eth_maxPriorityFeePerGas",
  "chain.read pm_getPaymasterStubData",
  "chain.read eth_estimateUserOperationGas",
  "chain.read pm_getPaymasterData",
];

/**
 * settleAgentFromChain (agents/writes/settles.ts:136), which get, show and every change read first:
 * a sent create's receipt settles it (accounts.agents.settle), then a sent change's
 * (accounts.agents.settleChange). Its tables, transitions and Party calls are folded in here.
 */
const SETTLE = {
  reads: [table_agents, table_agent_changes],
  writes: [table_agents, table_agent_changes],
  drives: [machine_agent.t.to_active, machine_agent.t.to_failed, machine_agent_change.t.to_landed, machine_agent_change.t.to_failed],
  invokes: [procedure_parties_claim_agent_party, procedure_parties_release_agent_handle],
  emits: [event_agent_transitioned],
  calls: [rpcCall("fetchUserOperationReceipt")],
  spans: ["chain.read eth_getUserOperationReceipt"],
};
const SETTLE_WAS = [`${AG}/writes/settles.ts:18`, `${AG}/writes/settles.ts:55`, `${AG}/writes/settles.ts:136`, `${AG}/external.ts:212`, `${AG}/external.ts:255`];

/**
 * prepareChange (agents/writes/prepare-change.ts:111): the owned agent settled from the chain, its
 * state checked, the AgentOwner call built and sponsored, and accounts.agents.recordChange.
 */
const CHANGE_ERRORS = [
  error_NOT_AUTHENTICATED,
  error_INVALID_INPUT,
  error_UNKNOWN,
  error_ENV_MISSING,
  error_PROVIDER_ERROR,
  error_ROLE_PERMISSION_DENIED,
  error_WRONG_STATE,
  error_PROVIDER_RESPONSE_INVALID,
  error_INSUFFICIENT_BALANCE,
];
const CHANGE_WAS = [`${AG}/writes/prepare-change.ts:97`, `${AG}/writes/prepare-change.ts:111`, `${AG}/writes/prepare-change.ts:57`, `${AG}/writes/changes.ts:66`, `${AG}/rules.ts:58`];
const changeTouches = (calls: readonly FunctionRef[]) => ({
  reads: [...SETTLE.reads, table_approvals],
  writes: [...SETTLE.writes, table_approvals],
  drives: SETTLE.drives,
  invokes: [procedure_access_require_authenticated_user, ...SETTLE.invokes],
  emits: SETTLE.emits,
  calls: [...SETTLE.calls, ...BUILD_CALLS],
  chain: [...calls, contract_entry_point.f.getNonce],
  spans: [...SETTLE.spans, ...BUILD_SPANS],
});

/** admitCreateOperation and sendCreateOperation (agents/external.ts:109, :151). */
const SEND_CALLS = [rpcCall("sendUserOperation"), rpcCall("hasUserOperationByHash")];
const SEND_SPANS = ["chain.read eth_sendUserOperation", "chain.read eth_getUserOperationByHash"];

const RUN_BY_ACTION = "internal: run through ctx.runQuery or ctx.runMutation by the agents actions in the same call.";

// ── public ──────────────────────────────────────────────────────────────────────────────────

export const rpc_accounts_agents_create = defineRpc({
  id: "accounts.agents.create",
  title: "Create an agent the signed-in person owns",
  about:
    "Public action. The trimmed name must not be empty and the handle (the name lower-cased when omitted) valid, 3-30 of " +
    "a-z, 0-9, _ or - and not reserved (INVALID_INPUT). On Base Sepolia it reads the owner (`accounts.agents.loadOwner`): a " +
    "handle another Party or live agent holds, or a key that already signs for one, is INVALID_INPUT; no claimed Safe is " +
    "SMART_ACCOUNT_MISSING; a key that is the owner's signer or Safe is INVALID_INPUT. It names the agent's Safe from " +
    "AgentOwner.safeAddressFor (eth_call; Protocol v4 settings missing are ENV_MISSING), builds the sponsored " +
    "AgentOwner.create(signer, owner) from the owner's Safe (at least 600,000 call gas), takes the expiry from the " +
    "paymaster data (PROVIDER_RESPONSE_INVALID), and records the agent and the owner's approval " +
    "(`accounts.agents.record`), which re-checks the handle and key. It mints the agent's `accountId` but writes no " +
    "accounts row. Returns the creating agent and the approval.",
  was: [`${CONVEX}:5`, `${OPS}/create.ts:35`, `${AG}/rules.ts:21`, `${AG}/errors.ts:8`, `${AG}/external.ts:62`, `${AG}/external.ts:85`, `${ROWS}:48`],
  concept: concept_accounts,
  kind: "action",
  who: "A signed-in person with a claimed personal Safe, for an agent they will own.",
  input: Schema.Struct({ name: S, handle: opt(S), signer: S }),
  output: Schema.Struct({ agent: Agent, approval: Approval }),
  errors: [
    error_NOT_AUTHENTICATED,
    error_INVALID_INPUT,
    error_UNKNOWN,
    error_ENV_MISSING,
    error_PROVIDER_ERROR,
    error_SMART_ACCOUNT_MISSING,
    error_PROVIDER_RESPONSE_INVALID,
    error_INSUFFICIENT_BALANCE,
    // Not in the row: a paymaster refusal the sponsored build does not admit dies as a defect that keeps its code.
    error_ROLE_PERMISSION_DENIED,
  ],
  reads: [table_agents, table_smart_accounts, table_accounts, table_approvals],
  writes: [table_agents, table_approvals],
  drives: [],
  invokes: [
    procedure_access_require_authenticated_user,
    procedure_accounts_read_workspace_setup_signer_in_tx,
    procedure_accounts_account_id_for_auth_user_or_null,
    procedure_parties_party_by_handle,
    procedure_parties_release_agent_handle,
    procedure_parties_reserve_agent_party,
  ],
  emits: [],
  calls: [rpcCall("fetchEthCall"), ...BUILD_CALLS],
  chain: [fn(contract_agent_owner, "safeAddressFor"), fn(contract_agent_owner, "create"), contract_entry_point.f.getNonce],
  spans: BUILD_SPANS,
});

export const rpc_accounts_agents_get = defineRpc({
  id: "accounts.agents.get",
  title: "Read one agent the person owns, settled from the chain",
  about:
    "Public action. The agent (`accounts.agents.load`) must be the caller's; none and someone else's are the same " +
    "ROLE_PERMISSION_DENIED (`not_agent_owner`). A sent create, then a sent change, is read from its receipt and settled " +
    "first. With a changeId that change of this agent is `lastChange`, else the newest change; a change of another agent " +
    "is dropped. The state is judged at business time.",
  was: [`${CONVEX}:10`, `${OPS}/get.ts:24`, ...SETTLE_WAS, `${AG}/views.ts:39`, `${ROWS}:66`],
  concept: concept_accounts,
  kind: "action",
  who: "A signed-in person, for an agent they own.",
  input: Schema.Struct({ agentId: S, changeId: opt(S) }),
  output: Agent,
  errors: [error_NOT_AUTHENTICATED, error_INVALID_INPUT, error_UNKNOWN, error_ENV_MISSING, error_PROVIDER_ERROR, error_ROLE_PERMISSION_DENIED],
  reads: SETTLE.reads,
  writes: SETTLE.writes,
  drives: SETTLE.drives,
  invokes: [procedure_access_require_authenticated_user, ...SETTLE.invokes],
  emits: SETTLE.emits,
  calls: SETTLE.calls,
  chain: [],
  spans: SETTLE.spans,
});

export const rpc_accounts_agents_show = defineRpc({
  id: "accounts.agents.show",
  title: "Read one agent by id or handle, with what its Safe holds",
  about:
    "Public action. The agent by id, or by the handle it holds at business time, must be the caller's (else " +
    "ROLE_PERMISSION_DENIED, so a handle never tells who owns it); it is settled from the chain as `get` does, then its " +
    "Safe's Base Sepolia settlement-asset positions are read (`readPositions`). No lastChange is returned.",
  was: [`${CONVEX}:25`, `${OPS}/show.ts:24`, `${AG}/reads/rows.ts:24`, ...SETTLE_WAS, `${ROWS}:78`],
  concept: concept_accounts,
  kind: "action",
  who: "A signed-in person, for an agent they own.",
  input: AgentLookup,
  output: Schema.Struct({ ...Agent.fields, positions: Schema.Array(AssetPosition) }),
  errors: [error_NOT_AUTHENTICATED, error_INVALID_INPUT, error_UNKNOWN, error_ENV_MISSING, error_PROVIDER_ERROR, error_ROLE_PERMISSION_DENIED],
  reads: SETTLE.reads,
  writes: SETTLE.writes,
  drives: SETTLE.drives,
  invokes: [procedure_access_require_authenticated_user, procedure_accounts_read_positions, ...SETTLE.invokes],
  emits: SETTLE.emits,
  calls: [...SETTLE.calls, rpcCall("fetchErc20Balance")],
  chain: [contract_erc20.f.balanceOf],
  spans: [...SETTLE.spans, "chain.read eth_call"],
});

export const rpc_accounts_agents_list = defineRpc({
  id: "accounts.agents.list",
  title: "List every agent the person owns",
  about:
    "Public query. Every agent of the owner (`by_owner`), newest first, as stored: a query has no business clock, so a " +
    "creating agent whose approval lapsed unsent still reads creating until the approval's expiry job fails it; frozen and " +
    "removed are still derived from their flags.",
  was: [`${CONVEX}:11`, `${OPS}/list.ts:16`, `${AG}/views.ts:39`, `${ROWS}:149`],
  concept: concept_accounts,
  kind: "query",
  who: "A signed-in person, for the agents they own.",
  input: Schema.Struct({}),
  output: Schema.Array(Agent),
  errors: [error_NOT_AUTHENTICATED, error_INVALID_INPUT, error_UNKNOWN, error_ENV_MISSING],
  reads: [table_agents],
  writes: [],
  drives: [],
  invokes: [procedure_access_authenticated_user],
  emits: [],
  ...noChain,
});

export const rpc_accounts_agents_freeze = defineRpc({
  id: "accounts.agents.freeze",
  title: "Open the owner's approval of freezing an agent",
  about:
    "Public action. The owned agent (by id or handle) is settled from the chain first and must read `active` " +
    "(WRONG_STATE). It builds the sponsored AgentOwner.freeze(safe) from the owner's Safe, which swaps the agent's key out " +
    "of its Safe for AgentOwner, and records the change `waiting` with the owner's approval (`accounts.agents.recordChange`, " +
    "which refuses another open change as WRONG_STATE `<kind>_waiting`). Returns the agent and the approval.",
  was: [`${CONVEX}:9`, `${AG}/operations/freeze.ts:13`, ...CHANGE_WAS, `${ROWS}:90`],
  concept: concept_accounts,
  kind: "action",
  who: "A signed-in person, for an agent they own.",
  input: AgentLookup,
  output: ChangePrepared,
  errors: CHANGE_ERRORS,
  ...changeTouches([fn(contract_agent_owner, "freeze"), contract_safe_4337_module.f.executeUserOpWithErrorString]),
});

export const rpc_accounts_agents_unfreeze = defineRpc({
  id: "accounts.agents.unfreeze",
  title: "Open the owner's approval of unfreezing an agent",
  about:
    "Public action. As freeze, from `frozen`: AgentOwner.unfreeze(safe) puts the agent's key back as its Safe's one signer.",
  was: [`${CONVEX}:27`, `${OPS}/unfreeze.ts:13`, ...CHANGE_WAS, `${ROWS}:97`],
  concept: concept_accounts,
  kind: "action",
  who: "A signed-in person, for an agent they own.",
  input: AgentLookup,
  output: ChangePrepared,
  errors: CHANGE_ERRORS,
  ...changeTouches([fn(contract_agent_owner, "unfreeze"), contract_safe_4337_module.f.executeUserOpWithErrorString]),
});

export const rpc_accounts_agents_sweep = defineRpc({
  id: "accounts.agents.sweep",
  title: "Open the owner's approval of sweeping an agent's Safe",
  about:
    "Public action. The owned agent is settled (once here and again inside the change). The asset symbol, when given, must " +
    "be a settlement asset of the agent's chain (INVALID_INPUT); its Safe must hold some of the selected assets " +
    "(`readPositions`; none is WRONG_STATE `empty`). The money goes to the owner's Safe, or to the recipient `to` names " +
    "(an @handle, an email or an address), resolved as the caller through Parties' public `parties.recipients.resolve` " +
    "(INVALID_INPUT). One AgentOwner.sweep(safe, to, token) per held token (several through MultiSendCallOnly), active or " +
    "frozen alike; the summary reads as payments of each whole balance, not exact. Returns the change id and what it moves.",
  was: [`${CONVEX}:26`, `${AG}/operations/sweep.ts:19`, ...CHANGE_WAS, `${AG}/writes/change-summary.ts:22`, `${ROWS}:112`],
  concept: concept_accounts,
  kind: "action",
  who: "A signed-in person, for an agent they own.",
  input: Schema.Union([
    Schema.Struct({ agentId: S, to: opt(S), asset: opt(S) }),
    Schema.Struct({ handle: S, to: opt(S), asset: opt(S) }),
  ]),
  output: Schema.Struct({
    agent: Agent,
    approval: Approval,
    changeId: S,
    sweep: Schema.Array(Schema.Struct({ ...SweepItem, to: S })),
  }),
  errors: CHANGE_ERRORS,
  ...(() => {
    const touches = changeTouches([
      fn(contract_agent_owner, "sweep"),
      contract_multi_send_call_only.f.multiSend,
      contract_safe_4337_module.f.executeUserOpWithErrorString,
    ]);
    return {
      ...touches,
      invokes: [...touches.invokes, procedure_accounts_read_positions],
      calls: [...touches.calls, rpcCall("fetchErc20Balance")],
      chain: [...touches.chain, contract_erc20.f.balanceOf],
    };
  })(),
});

export const rpc_accounts_agents_remove = defineRpc({
  id: "accounts.agents.remove",
  title: "Open the owner's approval of removing an agent for good",
  about:
    "Public action. The owned agent is settled and its Safe's positions read; every held settlement asset goes in " +
    "AgentOwner.remove(safe, tokens), which sweeps each to the owner's Safe and leaves no key that can sign, active or " +
    "frozen alike. A removal with nothing held still goes ahead with no tokens. Returns the change id and what it sweeps.",
  was: [`${CONVEX}:18`, `${AG}/operations/remove.ts:19`, ...CHANGE_WAS, `${ROWS}:126`],
  concept: concept_accounts,
  kind: "action",
  who: "A signed-in person, for an agent they own.",
  input: AgentLookup,
  output: Schema.Struct({ agent: Agent, approval: Approval, changeId: S, sweeps: Schema.Array(Schema.Struct(SweepItem)) }),
  errors: CHANGE_ERRORS,
  ...(() => {
    const touches = changeTouches([fn(contract_agent_owner, "remove"), contract_safe_4337_module.f.executeUserOpWithErrorString]);
    return {
      ...touches,
      invokes: [...touches.invokes, procedure_accounts_read_positions],
      calls: [...touches.calls, rpcCall("fetchErc20Balance")],
      chain: [...touches.chain, contract_erc20.f.balanceOf],
    };
  })(),
});

export const rpc_accounts_agents_rotate_key = defineRpc({
  id: "accounts.agents.rotate-key",
  title: "Open the owner's approval of giving an agent a new key",
  about:
    "Public action. The owned agent is settled; its current key is retired for the new key's address through " +
    "AgentOwner.swapSigner(safe, oldKey, newKey); AgentOwner stays its module and both guards, no owner is added. Only an " +
    "active agent (WRONG_STATE). recordChange refuses a retired key that is no longer the agent's (WRONG_STATE " +
    "key_changed), a new key that is the agent's, its owner's signer or either Safe, or that signs for another agent " +
    "(INVALID_INPUT). Returns both keys.",
  was: [`${CONVEX}:19`, `${AG}/operations/rotate-key.ts:19`, ...CHANGE_WAS, `${AG}/writes/new-key.ts:19`, `${ROWS}:142`],
  concept: concept_accounts,
  kind: "action",
  who: "A signed-in person, for an agent they own.",
  input: Schema.Union([Schema.Struct({ agentId: S, signer: S }), Schema.Struct({ handle: S, signer: S })]),
  output: Schema.Struct({ agent: Agent, approval: Approval, changeId: S, oldSigner: S, signer: S }),
  errors: CHANGE_ERRORS,
  ...changeTouches([fn(contract_agent_owner, "swapSigner"), contract_safe_4337_module.f.executeUserOpWithErrorString]),
});

// ── internal reads ──────────────────────────────────────────────────────────────────────────

export const rpc_accounts_agents_load = defineRpc({
  id: "accounts.agents.load",
  title: "Read one agent's row by id or handle, for an action",
  about:
    "Internal query: by agentId (`.unique()`), else by handle (without its `@`, lower-cased) the agent that holds it at " +
    "the action's business time `now` (0 when omitted), else null.",
  was: [`${CONVEX}:12`, `${OPS}/load.ts:15`, `${AG}/reads/rows.ts:12`, `${AG}/reads/rows.ts:24`],
  concept: concept_accounts,
  kind: "query",
  who: RUN_BY_ACTION,
  input: Schema.Struct({ agentId: opt(S), handle: opt(S), now: opt(N) }),
  output: Schema.Unknown,
  errors: [error_UNKNOWN],
  reads: [table_agents],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  ...noChain,
});

export const rpc_accounts_agents_load_owner = defineRpc({
  id: "accounts.agents.load-owner",
  title: "Read the owner's claimed Safe and whether the handle and key are free",
  about:
    "Internal query: the owner's claimed Safe and signer on the chain (`readWorkspaceSetupSignerInTx`, lowercased) with " +
    "their Account id, or null; whether a Party (Parties' `partyByHandle`, unless it is a failed agent's) or a live agent " +
    "holds the handle; whether a live agent signs with the key.",
  was: [`${CONVEX}:14`, `${OPS}/load-owner.ts:14`, `${AG}/reads/owners.ts:15`, `${AG}/reads/owners.ts:30`, `${AG}/reads/owners.ts:45`, `${AG}/reads/owners.ts:61`],
  concept: concept_accounts,
  kind: "query",
  who: "internal: run through ctx.runQuery by accounts.agents.create.",
  input: Schema.Struct({ authUserId: S, chainId: N, handle: S, signer: S, now: N }),
  output: Schema.Struct({
    owner: NullOr(Schema.Struct({ safe: S, signer: S, accountId: NullOr(S) })),
    handleTaken: Schema.Boolean,
    signerTaken: Schema.Boolean,
  }),
  errors: [],
  reads: [table_agents, table_smart_accounts, table_accounts],
  writes: [],
  drives: [],
  invokes: [
    procedure_accounts_read_workspace_setup_signer_in_tx,
    procedure_accounts_account_id_for_auth_user_or_null,
    procedure_parties_party_by_handle,
  ],
  emits: [],
  ...noChain,
});

export const rpc_accounts_agents_load_change = defineRpc({
  id: "accounts.agents.load-change",
  title: "Read one owner's change, or an agent's newest",
  about: "Internal query: the change by id (`.unique()`), else the agent's newest change, else null.",
  was: [`${CONVEX}:13`, `${OPS}/load-change.ts:14`, `${AG}/reads/rows.ts:59`, `${AG}/reads/rows.ts:70`],
  concept: concept_accounts,
  kind: "query",
  who: RUN_BY_ACTION,
  input: Schema.Struct({ changeId: opt(S), agentId: opt(S) }),
  output: Schema.Unknown,
  errors: [error_UNKNOWN],
  reads: [table_agent_changes],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  ...noChain,
});

// ── internal writes: the create ─────────────────────────────────────────────────────────────

export const rpc_accounts_agents_record = defineRpc({
  id: "accounts.agents.record",
  title: "Write a new agent as creating with its owner's approval",
  about:
    "Internal mutation, recorded as signed in as the owner. In one transaction it re-checks the handle and key (taken: " +
    "INVALID_INPUT), takes back a handle a failed agent's Party still names (Parties' `releaseAgentHandle`), reserves the " +
    "agent's Party (Parties' `reserveAgentParty`, INVALID_INPUT), opens the owner's personal `agent` approval of the " +
    "create call (command id `agent:<agentId>`, from the owner's email and Safe, no amount; it schedules expiry and " +
    "notice), and inserts the agent `creating`.",
  was: [`${CONVEX}:15`, `${OPS}/record.ts:15`, `${AG}/writes/rows.ts:59`, `${AG}/rules.ts:18`, `${A}/approvals/writes.ts:52`],
  concept: concept_accounts,
  kind: "mutation",
  who: "internal: run through ctx.runMutation by accounts.agents.create.",
  input: Schema.Struct({
    agentId: S,
    name: S,
    handle: S,
    accountId: S,
    chainId: N,
    safeAddress: S,
    signerAddress: S,
    owner: Schema.Struct({ authUserId: S, accountId: NullOr(S), email: S, safe: S, signer: S }),
    operation: Schema.Struct({ digest: S, unsignedUserOpJson: S }),
    expiresAt: N,
    now: N,
  }),
  output: Schema.Struct({ agent: Schema.Unknown, approval: Approval }),
  errors: [error_INVALID_INPUT, error_UNKNOWN, error_ENV_MISSING],
  reads: [table_agents, table_approvals],
  writes: [table_agents, table_approvals],
  drives: [],
  invokes: [procedure_parties_party_by_handle, procedure_parties_release_agent_handle, procedure_parties_reserve_agent_party],
  emits: [],
  ...noChain,
});

export const rpc_accounts_agents_record_submission = defineRpc({
  id: "accounts.agents.record-submission",
  title: "Note a create's operation hash before it is sent",
  about:
    "Internal mutation. The agent must exist (WRONG_STATE missing); the same hash noted again answers. It must read " +
    "creating with no hash yet (WRONG_STATE). It notes the hash and schedules accounts.agents.follow ten seconds later, so " +
    "the create settles when it lands whether or not anyone reads the agent.",
  was: [`${CONVEX}:20`, `${OPS}/record-submission.ts:9`, `${AG}/writes/rows.ts:139`, `${AG}/rules.ts:86`],
  concept: concept_accounts,
  kind: "mutation",
  who: "internal: run through ctx.runMutation by accounts.agents.sendSigned.",
  input: Schema.Struct({ agentId: S, userOpHash: S, now: N }),
  output: Schema.Null,
  errors: [error_WRONG_STATE],
  reads: [table_agents],
  writes: [table_agents],
  drives: [],
  invokes: [],
  emits: [],
  ...noChain,
});

export const rpc_accounts_agents_clear_submission = defineRpc({
  id: "accounts.agents.clear-submission",
  title: "Hand a create the bundler refused back to its approval",
  about: "Internal mutation. A creating agent with exactly this noted hash forgets it; anything else is left. A missing agent is WRONG_STATE.",
  was: [`${CONVEX}:4`, `${OPS}/clear-submission.ts:9`, `${AG}/writes/rows.ts:165`],
  concept: concept_accounts,
  kind: "mutation",
  who: "internal: run through ctx.runMutation by accounts.agents.sendSigned when the bundler definitively refused and does not hold the send.",
  input: Schema.Struct({ agentId: S, userOpHash: S, now: N }),
  output: Schema.Null,
  errors: [error_WRONG_STATE],
  reads: [table_agents],
  writes: [table_agents],
  drives: [],
  invokes: [],
  emits: [],
  ...noChain,
});

export const rpc_accounts_agents_settle = defineRpc({
  id: "accounts.agents.settle",
  title: "Record what a sent create's receipt says",
  about:
    "Internal mutation. A row not creating, or with another noted hash, answers as it stands. Landed: claims the reserved " +
    "Party (Parties' `claimAgentParty`; no partyId is an UNKNOWN stored-row defect), writes active with the hash, and " +
    "schedules agent_transitioned (created). Failed: writes failed with the hash and releases the handle.",
  was: [`${CONVEX}:23`, `${OPS}/settle.ts:10`, `${AG}/writes/rows.ts:209`, `${AG}/events.ts:48`],
  concept: concept_accounts,
  kind: "mutation",
  who: "internal: run through ctx.runMutation by settleFromChain in get, show, the change actions and the follow workflow.",
  input: Schema.Struct({ agentId: S, userOpHash: S, outcome: Schema.Literals(["landed", "failed"]), txHash: S, now: N }),
  output: Schema.Unknown,
  errors: [error_WRONG_STATE, error_UNKNOWN],
  reads: [table_agents],
  writes: [table_agents],
  drives: [machine_agent.t.to_active, machine_agent.t.to_failed],
  invokes: [procedure_parties_claim_agent_party, procedure_parties_release_agent_handle],
  emits: [event_agent_transitioned],
  ...noChain,
});

// ── internal writes: an owner's change ──────────────────────────────────────────────────────

export const rpc_accounts_agents_record_change = defineRpc({
  id: "accounts.agents.record-change",
  title: "Write an owner's change as waiting with their approval",
  about:
    "Internal mutation, recorded as signed in as the owner. The agent must be the caller's (ROLE_PERMISSION_DENIED), read " +
    "as a state the change admits (freeze from active, unfreeze from frozen, sweep and remove from active or frozen, " +
    "rotate from active; else WRONG_STATE) and hold no open change (WRONG_STATE `<kind>_waiting`); a rotation's keys are " +
    "checked (`checkNewKey`). It opens the owner's personal `agent` approval (command id `agent-change:<changeId>`; a " +
    "sweep or removal reads as the payments it makes, one row per asset) and inserts the change `waiting`.",
  was: [`${CONVEX}:16`, `${OPS}/record-change.ts:15`, `${AG}/writes/changes.ts:66`, `${AG}/writes/new-key.ts:19`, `${AG}/writes/change-summary.ts:22`, `${AG}/rules.ts:58`],
  concept: concept_accounts,
  kind: "mutation",
  who: "internal: run through ctx.runMutation by the freeze, unfreeze, sweep, remove and rotate-key actions (`prepareChange`).",
  input: Schema.Struct({
    changeId: S,
    agentId: S,
    authUserId: S,
    kind: Schema.Literals(["freeze", "unfreeze", "sweep", "remove", "rotate"]),
    tokens: opt(Schema.Array(S)),
    oldSigner: opt(S),
    signer: opt(S),
    to: opt(S),
    moves: opt(Schema.Array(Schema.Struct({ asset: S, value: S, toLabel: S }))),
    returns: opt(Schema.Array(Schema.Struct({ asset: S, value: S }))),
    chainId: N,
    operation: Schema.Struct({ digest: S, unsignedUserOpJson: S }),
    expiresAt: N,
    now: N,
  }),
  output: Schema.Struct({ agent: Schema.Unknown, approval: Approval }),
  errors: [error_ROLE_PERMISSION_DENIED, error_WRONG_STATE, error_INVALID_INPUT, error_UNKNOWN, error_ENV_MISSING],
  reads: [table_agents, table_agent_changes, table_approvals],
  writes: [table_agent_changes, table_approvals],
  drives: [],
  invokes: [],
  emits: [],
  ...noChain,
});

export const rpc_accounts_agents_record_change_submission = defineRpc({
  id: "accounts.agents.record-change-submission",
  title: "Note a change's operation hash before it is sent",
  about:
    "Internal mutation. The change must exist (WRONG_STATE missing); the same hash answers. It must be waiting and not past " +
    "its expiry (WRONG_STATE). It writes sent with the hash and schedules accounts.agents.followChange ten seconds later.",
  was: [`${CONVEX}:17`, `${OPS}/record-change-submission.ts:9`, `${AG}/writes/changes.ts:134`],
  concept: concept_accounts,
  kind: "mutation",
  who: "internal: run through ctx.runMutation by accounts.agents.sendChangeSigned.",
  input: Schema.Struct({ changeId: S, userOpHash: S, now: N }),
  output: Schema.Null,
  errors: [error_WRONG_STATE],
  reads: [table_agent_changes],
  writes: [table_agent_changes],
  drives: [machine_agent_change.t.to_sent],
  invokes: [],
  emits: [],
  ...noChain,
});

export const rpc_accounts_agents_clear_change_submission = defineRpc({
  id: "accounts.agents.clear-change-submission",
  title: "Hand a change the bundler refused back to its approval",
  about: "Internal mutation. A sent change with exactly this hash goes back to waiting and forgets it; anything else is left.",
  was: [`${CONVEX}:3`, `${OPS}/clear-change-submission.ts:9`, `${AG}/writes/changes.ts:163`],
  concept: concept_accounts,
  kind: "mutation",
  who: "internal: run through ctx.runMutation by accounts.agents.sendChangeSigned when the bundler definitively refused and does not hold the send.",
  input: Schema.Struct({ changeId: S, userOpHash: S, now: N }),
  output: Schema.Null,
  errors: [error_WRONG_STATE],
  reads: [table_agent_changes],
  writes: [table_agent_changes],
  drives: [machine_agent_change.t.to_waiting],
  invokes: [],
  emits: [],
  ...noChain,
});

export const rpc_accounts_agents_settle_change = defineRpc({
  id: "accounts.agents.settle-change",
  title: "Record what a sent change's receipt says",
  about:
    "Internal mutation. A change not sent, or with another hash, answers as it stands. It writes landed or failed with the " +
    "hash and what a sweep or removal moved. A landing moves the agent: remove sets `removed`, rotate overwrites " +
    "`signerAddress` (with an empty string when no signer was kept), freeze and unfreeze set `frozen`, a sweep leaves the " +
    "agent; then it schedules agent_transitioned (frozen, unfrozen, swept, removed or key_rotated). A missing agent is " +
    "WRONG_STATE.",
  was: [`${CONVEX}:24`, `${OPS}/settle-change.ts:10`, `${AG}/writes/changes.ts:186`, `${AG}/writes/changes.ts:214`, `${AG}/rules.ts:58`],
  concept: concept_accounts,
  kind: "mutation",
  who: "internal: run through ctx.runMutation by settleChangeFromChain in get, show, the change actions and the followChange workflow.",
  input: Schema.Struct({
    changeId: S,
    userOpHash: S,
    outcome: Schema.Literals(["landed", "failed"]),
    txHash: S,
    swept: opt(Schema.Array(Schema.Struct({ token: S, rawAmount: S }))),
    sweeps: opt(Schema.Array(Schema.Struct({ token: S, to: S, raw: S }))),
    now: N,
  }),
  output: Schema.Unknown,
  errors: [error_WRONG_STATE],
  reads: [table_agent_changes, table_agents],
  writes: [table_agent_changes, table_agents],
  drives: [machine_agent_change.t.to_landed, machine_agent_change.t.to_failed],
  invokes: [],
  emits: [event_agent_transitioned],
  ...noChain,
});

// ── internal: the signed sends the approvals relay runs ─────────────────────────────────────

const SignedSend = { authUserId: S, unsignedUserOpJson: S, signature: S };
const SEND_ERRORS = [
  error_ROLE_PERMISSION_DENIED,
  error_WRONG_STATE,
  error_INVALID_INPUT,
  error_UNKNOWN,
  error_ENV_MISSING,
  error_PROVIDER_ERROR,
  error_PROVIDER_RESPONSE_INVALID,
];

export const rpc_accounts_agents_send_signed = defineRpc({
  id: "accounts.agents.send-signed",
  title: "Send the owner's signed create",
  about:
    "Internal action, recorded as signed in as the owner. The stored operation must decode (UNKNOWN); the agent must be the " +
    "owner's (ROLE_PERMISSION_DENIED) and read creating (WRONG_STATE). The signed operation must be exactly the " +
    "AgentOwner.create call from the owner's Safe with no factory (WRONG_STATE `changed`), a 65-byte signature " +
    "(INVALID_INPUT) that recovers to the owner's signer (INVALID_INPUT). It notes the hash first " +
    "(`accounts.agents.recordSubmission`), then sends; a send the bundler definitively refused and does not hold clears " +
    "the hash (`accounts.agents.clearSubmission`) before the refusal returns; a bundler that acknowledges another hash is " +
    "PROVIDER_RESPONSE_INVALID. An uncertain failure keeps it sent, so the follow still reads its receipt.",
  was: [`${CONVEX}:22`, `${OPS}/send-signed.ts:36`, `${AG}/external.ts:109`, `${AG}/external.ts:151`, `${BACKEND}/src/integrations/chain-rpc/errors.ts:46`],
  concept: concept_accounts,
  kind: "action",
  who: "internal: run through ctx.runAction by the accounts.approvals.sendApproved workflow for an `agent:` approval.",
  input: Schema.Struct({ ...SignedSend, agentId: S }),
  output: Schema.Struct({ userOpHash: S }),
  errors: SEND_ERRORS,
  reads: [table_agents],
  writes: [table_agents],
  drives: [],
  invokes: [],
  emits: [],
  calls: SEND_CALLS,
  chain: [fn(contract_agent_owner, "create"), contract_safe_4337_module.f.executeUserOpWithErrorString],
  spans: SEND_SPANS,
});

export const rpc_accounts_agents_send_change_signed = defineRpc({
  id: "accounts.agents.send-change-signed",
  title: "Send the owner's signed change",
  about:
    "Internal action, recorded as signed in as the owner. As send-signed, for a change: it must be the owner's and waiting " +
    "within its expiry (WRONG_STATE), and the operation exactly its AgentOwner call or batch from the owner's Safe. A " +
    "replay of an already noted send is sent again only when its hash matches the noted one (a first send that never " +
    "reached the bundler would otherwise leave it waiting).",
  was: [`${CONVEX}:21`, `${OPS}/send-change-signed.ts:36`, `${AG}/writes/prepare-change.ts:57`, `${AG}/external.ts:109`, `${AG}/external.ts:151`],
  concept: concept_accounts,
  kind: "action",
  who: "internal: run through ctx.runAction by the accounts.approvals.sendApproved workflow for an `agent-change:` approval.",
  input: Schema.Struct({ ...SignedSend, changeId: S }),
  output: Schema.Struct({ userOpHash: S }),
  errors: SEND_ERRORS,
  reads: [table_agents, table_agent_changes],
  writes: [table_agent_changes],
  drives: [machine_agent_change.t.to_sent, machine_agent_change.t.to_waiting],
  invokes: [],
  emits: [],
  calls: SEND_CALLS,
  chain: [
    fn(contract_agent_owner, "freeze"),
    fn(contract_agent_owner, "unfreeze"),
    fn(contract_agent_owner, "sweep"),
    fn(contract_agent_owner, "remove"),
    fn(contract_agent_owner, "swapSigner"),
    contract_multi_send_call_only.f.multiSend,
    contract_safe_4337_module.f.executeUserOpWithErrorString,
  ],
  spans: SEND_SPANS,
});

export const rpc_accounts_agents_emit_transitioned = defineRpc({
  id: "accounts.agents.emit-transitioned",
  title: "Post agent_transitioned",
  about:
    "Telemetry plumbing: an internal action a committed transition schedules (settle, settleChange), so a delivery failure " +
    "never rolls back or repeats the write. It posts agent_transitioned attributed to the owner (owner_kind person), with " +
    "the agent, the transition and when it happened, carrying the observation context and the current span's trace ids.",
  was: [`${CONVEX}:6`, `${OPS}/emit-transitioned.ts:12`, `${AG}/events.ts:48`, `${AG}/events.ts:69`],
  concept: concept_accounts,
  kind: "action",
  who: "internal: scheduled by accounts.agents.settle and accounts.agents.settleChange (`agentTransitioned`).",
  input: Schema.Struct({
    ownerAuthUserId: S,
    agentId: S,
    transition: Schema.Literals(["created", "frozen", "unfrozen", "swept", "removed", "key_rotated"]),
    occurredAt: N,
    observationContext: opt(Schema.Unknown),
  }),
  output: Schema.Void,
  errors: [],
  reads: [],
  writes: [],
  drives: [],
  invokes: [],
  emits: [event_agent_transitioned],
  ...noChain,
});

// ── workflows: following a sent create or change ────────────────────────────────────────────

export const workflow_accounts_agents_follow = defineWorkflow({
  id: "accounts.agents.follow",
  title: "Follow a sent agent create until its receipt settles it",
  about:
    "Registered as the internal action `accounts/agents:follow`. accounts.agents.recordSubmission schedules it ten seconds " +
    "after a create's hash is noted; each run that finds no receipt schedules itself again ten seconds later with " +
    "`read + 1`, up to 60 reads (ten minutes). A PROVIDER_ERROR counts as a read and leaves the create as it was. Run as " +
    "the system job `follow_agent`. accounts.agents.get still settles a create that outlives the reads.",
  was: [`${CONVEX}:7`, `${OPS}/follow.ts:24`, `${AG}/writes/rows.ts:156`, `${AG}/rules.ts:86`, `${AG}/rules.ts:89`, `${AG}/writes/settles.ts:18`],
  concept: concept_accounts,
  priority: "normal",
  trigger: { after: rpc_accounts_agents_record_submission },
  instance: { per: table_agents },
  waits: [{ name: "next-read", for: "timer", timeoutMs: 10000, about: "Ten seconds of wall time between receipt reads." }],
  steps: [
    { name: "attribute", about: "Records the run as the system job `follow_agent` with the agent id." },
    { name: "load", about: "Runs accounts.agents.load; a missing agent ends the follow." },
    { name: "settle", about: "settleFromChain: reads the create's receipt and runs accounts.agents.settle when it landed or failed." },
    { name: "again", about: "Still creating and under 60 reads: schedules itself again in 10 s with read + 1." },
  ],
  reads: [table_agents],
  writes: [table_agents],
  drives: [machine_agent.t.to_active, machine_agent.t.to_failed],
  invokes: [procedure_parties_claim_agent_party, procedure_parties_release_agent_handle],
  emits: [event_agent_transitioned],
  calls: [rpcCall("fetchUserOperationReceipt")],
  chain: [],
  idempotency: "settle answers a row that is no longer creating, or names another hash, as it stands.",
  timeoutMs: 600000,
  retries: { max: 59, backoff: "fixed" },
});

export const workflow_accounts_agents_follow_change = defineWorkflow({
  id: "accounts.agents.follow-change",
  title: "Follow a sent agent change until its receipt settles it",
  about:
    "Registered as the internal action `accounts/agents:followChange`. accounts.agents.recordChangeSubmission schedules it " +
    "ten seconds after a change is sent; as the create's follow, it reads the receipt (the expected AgentOwner event must " +
    "name the agent's Safe, a rotation's the new key, a sweep's every event its tokens and recipient) and schedules itself " +
    "again while the change is still sent, up to 60 reads. Run as the system job `follow_agent`.",
  was: [`${CONVEX}:8`, `${OPS}/follow-change.ts:23`, `${AG}/writes/changes.ts:153`, `${AG}/writes/settles.ts:55`, `${AG}/external.ts:255`],
  concept: concept_accounts,
  priority: "normal",
  trigger: { after: rpc_accounts_agents_record_change_submission },
  instance: { per: table_agent_changes },
  waits: [{ name: "next-read", for: "timer", timeoutMs: 10000, about: "Ten seconds of wall time between receipt reads." }],
  steps: [
    { name: "attribute", about: "Records the run as the system job `follow_agent`." },
    { name: "load", about: "Runs accounts.agents.loadChange and accounts.agents.load; either missing ends the follow." },
    { name: "settle", about: "settleChangeFromChain: reads the receipt and runs accounts.agents.settleChange when it landed or failed." },
    { name: "again", about: "Still sent and under 60 reads: schedules itself again in 10 s with read + 1." },
  ],
  reads: [table_agent_changes, table_agents],
  writes: [table_agent_changes, table_agents],
  drives: [machine_agent_change.t.to_landed, machine_agent_change.t.to_failed],
  invokes: [],
  emits: [event_agent_transitioned],
  calls: [rpcCall("fetchUserOperationReceipt")],
  chain: [],
  idempotency: "settleChange answers a change that is no longer sent, or names another hash, as it stands.",
  timeoutMs: 600000,
  retries: { max: 59, backoff: "fixed" },
});
