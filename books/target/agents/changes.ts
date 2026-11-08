// The agents concept's changes area: every write an owner makes to an agent. Each rpc is one
// transaction that births the agent (create) or one `agent-changes` row (freeze, unfreeze, rotate,
// sweep, remove) together with its carrier: the owner's approval from their own Safe
// (`approvals.open`) or, for an agent an Organization owns, one Board proposal from the company
// Safe (`board.propose`). Nothing is on chain until the owner signs or the Board executes; the
// change's process (`agents.changes.carry`, ./processes.ts) lands or fails it on chain proof. The
// live follow (`agents.changes.get`) is what every change's flow reads until the change ends.
//
// Who acts for the owner: a person-owned agent's owner themselves; an Organization-owned agent's
// Directors, each one whose own Safe is an owner of the company Safe on chain (indexing's
// safe-owners). An agent the caller does not act for and an agent that does not exist are the same
// ROLE_PERMISSION_DENIED, so a handle never tells who owns it (decision agents.who-acts).
//
// The old actions settled the agent from the chain before every change, built and sponsored the
// UserOperation themselves, and recorded the approval in a second internal mutation. Here approvals
// owns sponsorship and the one send, and the process owns settlement (decision agents.one-process).

import { budget, defineRpc } from "../../../packages/book/src/index.ts";
import { concept_agents } from "../shared/foundation.ts";
import { contract_agent_owner, contract_erc20, integration_chain_rpc } from "../shared/external.ts";
import {
  error_FEATURE_NOT_AVAILABLE,
  error_INVALID_INPUT,
  error_NOT_AUTHENTICATED,
  error_PROVIDER_ERROR,
  error_PROVIDER_RESPONSE_INVALID,
  error_ROLE_PERMISSION_DENIED,
  error_SEAT_LIMIT_REACHED,
  error_SMART_ACCOUNT_MISSING,
  error_WRONG_STATE,
} from "../shared/vocabulary.ts";
import { table_principals } from "../access/data.ts";
import { table_parties } from "../parties/data.ts";
import {
  procedure_parties_register,
  procedure_parties_resolve_recipient,
} from "../parties/procedures.ts";
import { table_safe_owners } from "../indexing/data.ts";
import { procedure_approvals_open } from "../approvals/procedures.ts";
import { table_personal_safes } from "../accounts/data.ts";
import { table_org_members, table_organizations } from "../organizations/data.ts";
import { procedure_board_propose } from "../board/procedures.ts";
import { machine_agent, machine_agent_change, table_agent_changes, table_agents } from "./data.ts";
import { ChangeIdInput, CreateInput, Followed, Prepared, RefInput, RotateInput, SweepInput } from "./shapes.ts";

const OLD = "packages/backend/src/accounts/agents";
const CONVEX = "packages/backend/convex/accounts/agents.ts";
const ROWS = "packages/protocol/src/accounts/agent-operations.ts";
const AS_IS = "docs/as-is/archive/accounts/agents.ts";

// ── what every change shares ────────────────────────────────────────────────────────────────

const ACTS =
  "A signed-in person who owns the agent, or a Director of the Organization that owns it (their own Safe is an owner " +
  "of the company Safe). Anyone else, and an agent that does not exist, get the same ROLE_PERMISSION_DENIED.";

const FIND =
  "The agent is named by its `agent_` id or `@handle` (its Party, then the agent behind it, `by-party`). The caller " +
  "must act for its owner: the owner, or for an Organization's agent a Director, whose own Safe (access' principal) is " +
  "among the company Safe's owners (indexing's safe-owners); anyone else, and a ref naming no agent, is " +
  "ROLE_PERMISSION_DENIED.";

const ONE_WAITING =
  "No other change of the agent may wait: a second one while one waits is WRONG_STATE `change_waiting` (the unique " +
  "`by-agent-waiting`).";

const CARRIER =
  "its carrier: the owner's approval from their own Safe (`approvals.open`, the change as its subject, the page's " +
  "summary, a deadline an hour away that the paymaster's window may cut) or, for an Organization's agent, a Board " +
  "proposal of the company Safe (`board.propose`, opener agents), which opens the proposing Director's own approval and " +
  "needs the Organization's `owner-safe-proposals` gate (else FEATURE_NOT_AVAILABLE).";

const CHANGE_ERRORS = [
  error_NOT_AUTHENTICATED,
  error_ROLE_PERMISSION_DENIED,
  error_WRONG_STATE,
  error_INVALID_INPUT,
  error_FEATURE_NOT_AVAILABLE,
];

/** The reads that find the agent and check the caller acts for its owner. */
const FIND_READS = [table_agents, table_agent_changes, table_parties, table_principals, table_organizations, table_safe_owners];

/** A change's one transaction: the row and its carrier. */
const OPEN = {
  writes: [table_agent_changes],
  drives: [machine_agent_change.t.open],
  invokes: [procedure_approvals_open, procedure_board_propose],
  emits: [],
} as const;

const CHANGE_WAS = [AS_IS, `${OLD}/writes/prepare-change.ts:97`, `${OLD}/writes/prepare-change.ts:111`, `${OLD}/writes/changes.ts:66`, `${OLD}/rules.ts:58`];

// ── create ──────────────────────────────────────────────────────────────────────────────────

export const rpc_agents_changes_create = defineRpc({
  id: "agents.changes.create",
  title: "Create an agent: its row, its Party, its create change and its carrier",
  about:
    "`agent create`'s one transaction. The trimmed name must not be empty (INVALID_INPUT `name`); a missing handle takes " +
    "the name. The key (`signer`, an address: the key itself never leaves the caller's machine) must be a key of its " +
    "own: not the zero address, AgentOwner, the owner's Safe or signer, any Party's Safe, or the key of a live agent " +
    "(`by-signer`); else INVALID_INPUT `signer`. The owner: without `org`, the caller, a person whose own Safe is claimed " +
    "(accounts' personal-safes, claimed; else SMART_ACCOUNT_MISSING); with `org`, the Organization that handle or id " +
    "names, of which the caller must be a Director (else, or when it names none, ROLE_PERMISSION_DENIED), whose " +
    "company Safe must be live on chain (else WRONG_STATE), and which owns no live agent yet (creating, active or " +
    "frozen): an Organization holds one agent of its own (aaron.seats; else SEAT_LIMIT_REACHED, limit `own agent`). The agent's Safe is AgentOwner's pure `safeAddressFor(signer, " +
    "owner Safe)`, computed in-process (CREATE2 over fixed inputs, no node call). Then, in one transaction: the agent's " +
    "Party (`parties.register`, kind agent; a malformed, reserved or taken handle is INVALID_INPUT and nothing is written), " +
    "the agent `creating`, its create change `waiting`, and " + CARRIER + " The carrier holds exactly one call, " +
    "`AgentOwner.create(signer, owner Safe)`. The same name, handle, key and owner again while that create waits answers " +
    "the waiting agent and its carrier unchanged. It answers the agent, the change and the carrier's id and page.",
  was: [`${CONVEX}:5`, `${OLD}/operations/create.ts:35`, `${OLD}/rules.ts:21`, `${OLD}/reads/owners.ts:15`, `${OLD}/writes/rows.ts:59`, `${OLD}/external.ts:62`, `${ROWS}:48`, AS_IS],
  concept: concept_agents,
  kind: "mutation",
  who: "A signed-in person with a claimed personal Safe; with `org`, a Director of that Organization, which then owns the agent.",
  input: CreateInput,
  output: Prepared,
  errors: [...CHANGE_ERRORS, error_SMART_ACCOUNT_MISSING, error_SEAT_LIMIT_REACHED],
  reads: [...FIND_READS, table_personal_safes],
  writes: [table_agents, table_agent_changes],
  drives: [machine_agent.t.create, machine_agent_change.t.open],
  invokes: [procedure_parties_register, procedure_approvals_open, procedure_board_propose],
  emits: [],
  calls: [],
  chain: [contract_agent_owner.f.safeAddressFor, contract_agent_owner.f.create],
  spans: [],
  budget: budget("write"),
});

// ── freeze and unfreeze ─────────────────────────────────────────────────────────────────────

export const rpc_agents_changes_freeze = defineRpc({
  id: "agents.changes.freeze",
  title: "Open the freeze of an agent: its change and its carrier",
  about:
    FIND + " It must be `active` (else WRONG_STATE with its state: already frozen, still creating, failed or removed). " +
    ONE_WAITING + " In one transaction: the freeze change `waiting` and " + CARRIER + " The carrier holds one call, " +
    "`AgentOwner.freeze(safe)`, which swaps the agent's key out of its Safe for AgentOwner, which keeps it. It answers " +
    "the agent as it stands, the change and the carrier.",
  was: [`${CONVEX}:9`, `${OLD}/operations/freeze.ts:13`, `${ROWS}:90`, ...CHANGE_WAS],
  concept: concept_agents,
  kind: "mutation",
  who: ACTS,
  input: RefInput,
  output: Prepared,
  errors: CHANGE_ERRORS,
  reads: FIND_READS,
  ...OPEN,
  calls: [],
  chain: [contract_agent_owner.f.freeze],
  spans: [],
  budget: budget("write"),
});

export const rpc_agents_changes_unfreeze = defineRpc({
  id: "agents.changes.unfreeze",
  title: "Open the unfreeze of a frozen agent: its change and its carrier",
  about:
    FIND + " It must be `frozen` (else WRONG_STATE with its state: an active agent is not frozen). " + ONE_WAITING +
    " In one transaction: the unfreeze change `waiting` and " + CARRIER + " The carrier holds one call, " +
    "`AgentOwner.unfreeze(safe)`, which puts the kept key back as the Safe's one owner.",
  was: [`${CONVEX}:27`, `${OLD}/operations/unfreeze.ts:13`, `${ROWS}:97`, ...CHANGE_WAS],
  concept: concept_agents,
  kind: "mutation",
  who: ACTS,
  input: RefInput,
  output: Prepared,
  errors: CHANGE_ERRORS,
  reads: FIND_READS,
  ...OPEN,
  calls: [],
  chain: [contract_agent_owner.f.unfreeze],
  spans: [],
  budget: budget("write"),
});

// ── rotate ──────────────────────────────────────────────────────────────────────────────────

export const rpc_agents_changes_rotate = defineRpc({
  id: "agents.changes.rotate",
  title: "Open the rotation of an agent's key: its change and its carrier",
  about:
    FIND + " It must be `active`: a frozen agent is unfrozen first, so its owner always knows which key signs once it " +
    "is; frozen, removed, creating or failed is WRONG_STATE. " + ONE_WAITING + " The new key (an address; the key never " +
    "leaves the caller's machine) must be a key of its own: not the agent's key now, its owner's Safe or signer, any " +
    "Party's Safe, AgentOwner, the zero address, or another live agent's key (`by-signer`); else INVALID_INPUT `signer`. " +
    "In one transaction: the rotation change `waiting`, with the retired key (`old_signer`, the agent's key now), the new " +
    "key and where the caller keeps it, and " + CARRIER + " The carrier holds one call, " +
    "`AgentOwner.swapSigner(safe, oldKey, newKey)`: a Safe `swapOwner` from the owner module, which adds no owner and " +
    "delegates nothing. The agent's key does not change until the rotation lands. It answers both keys.",
  was: [`${CONVEX}:19`, `${OLD}/operations/rotate-key.ts:19`, `${OLD}/writes/new-key.ts:19`, `${ROWS}:142`, ...CHANGE_WAS],
  concept: concept_agents,
  kind: "mutation",
  who: ACTS,
  input: RotateInput,
  output: Prepared,
  errors: CHANGE_ERRORS,
  reads: [...FIND_READS, table_personal_safes],
  ...OPEN,
  calls: [],
  chain: [contract_agent_owner.f.swapSigner],
  spans: [],
  budget: budget("write"),
});

// ── sweep and remove ────────────────────────────────────────────────────────────────────────

/** The live balance reads a sweep and a removal make before their transaction. */
const BALANCES =
  "Before its transaction it reads, at `latest` and in parallel, `balanceOf` of the agent's Safe for each settlement " +
  "asset it names (chain-rpc; a node that does not answer is PROVIDER_ERROR, and no balance is made up)";

export const rpc_agents_changes_sweep = defineRpc({
  id: "agents.changes.sweep",
  title: "Open the sweep of an agent's Safe: its change and its carrier",
  about:
    FIND + " It must be `active` or `frozen` (a frozen agent stays frozen; else WRONG_STATE). " + ONE_WAITING + " `asset`, " +
    "when given, must be a settlement asset of the deployment by symbol (INVALID_INPUT `asset`); omitted, all are " +
    "selected. " + BALANCES + "; a Safe holding none of them is WRONG_STATE `empty`, and nothing is opened. The " +
    "recipient: `to` (an email, `@handle` or 0x address) through `parties.resolve-recipient`, which names it if new; " +
    "malformed, unresolved, released or the agent's own Safe is INVALID_INPUT `to`; omitted, the owner's Safe. In one " +
    "transaction: the recipient's Party, the sweep change `waiting` with its recipient and each held asset's balance at " +
    "preparation, and " + CARRIER + " The carrier holds one `AgentOwner.sweep(safe, to, token)` per held asset, approved " +
    "together; each moves the whole balance at execution as one `Payments.send` from the agent's Safe.",
  was: [`${CONVEX}:26`, `${OLD}/operations/sweep.ts:19`, `${OLD}/writes/change-summary.ts:22`, `${ROWS}:112`, ...CHANGE_WAS],
  concept: concept_agents,
  kind: "action",
  who: ACTS,
  input: SweepInput,
  output: Prepared,
  errors: [...CHANGE_ERRORS, error_PROVIDER_ERROR, error_PROVIDER_RESPONSE_INVALID],
  reads: FIND_READS,
  ...OPEN,
  invokes: [procedure_parties_resolve_recipient, procedure_approvals_open, procedure_board_propose],
  calls: [integration_chain_rpc.c.readContract],
  chain: [contract_erc20.f.balanceOf, contract_agent_owner.f.sweep],
  spans: [],
  budget: budget("chain-read"),
});

export const rpc_agents_changes_remove = defineRpc({
  id: "agents.changes.remove",
  title: "Open the removal of an agent: its change and its carrier",
  about:
    FIND + " It must be `active` or `frozen` (removed, creating or failed is WRONG_STATE). " + ONE_WAITING + " A removal " +
    "names every settlement asset of the deployment, held or not: AgentOwner sweeps each to the owner's Safe and skips " +
    "an empty one, so money that arrives after preparation is not left behind. " + BALANCES + ", for the page and the " +
    "change's assets. It names the Seats the agent's Safe holds (organizations' org-members by Safe), which organizations " +
    "ends once AgentRemoved is on chain. In one transaction: the removal change `waiting` with every asset and its " +
    "balance at preparation, and " + CARRIER + " The carrier holds one call, `AgentOwner.remove(safe, tokens)`, which " +
    "sweeps, leaves AgentOwner as the Safe's one owner and marks the agent removed for good. There is no undo; the CLI " +
    "confirms before it calls.",
  was: [`${CONVEX}:18`, `${OLD}/operations/remove.ts:19`, `${ROWS}:126`, ...CHANGE_WAS],
  concept: concept_agents,
  kind: "action",
  who: ACTS,
  input: RefInput,
  output: Prepared,
  errors: [...CHANGE_ERRORS, error_PROVIDER_ERROR, error_PROVIDER_RESPONSE_INVALID],
  reads: [...FIND_READS, table_org_members],
  ...OPEN,
  calls: [integration_chain_rpc.c.readContract],
  chain: [contract_erc20.f.balanceOf, contract_agent_owner.f.remove],
  spans: [],
  budget: budget("chain-read"),
});

// ── the live follow ─────────────────────────────────────────────────────────────────────────

export const rpc_agents_changes_get = defineRpc({
  id: "agents.changes.get",
  title: "Follow one change of an agent, live",
  about:
    "A live query: the first frame is the change and its agent as they stand, and each transition of either pushes the " +
    "next. Every change's flow reads it to follow the change to its end (`landed` with its transaction and, for a sweep " +
    "or removal, what each AgentSwept moved; or `failed` with its outcome and code), and the agent to the state it lands " +
    "in. The caller must act for the agent's owner; anyone else, and an id that names no change, is " +
    "ROLE_PERMISSION_DENIED. It never writes or reads the chain: the process has already settled what it shows.",
  was: [`${CONVEX}:10`, `${OLD}/operations/get.ts:24`, `${OLD}/operations/load-change.ts:14`, `${OLD}/views.ts:9`, "packages/sdk/src/accounts/agent-changes.ts:1"],
  concept: concept_agents,
  kind: "live",
  who: ACTS,
  input: ChangeIdInput,
  output: Followed,
  errors: [error_NOT_AUTHENTICATED, error_ROLE_PERMISSION_DENIED],
  reads: FIND_READS,
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("live-read"),
});
