// The target agents concept's own judgments, each a decision record linked to what it shapes.
// Made by Claude while designing the concept, under the accepted A1-A4 and P1-P10 and the shared
// decisions (concepts.agents, dependencies.of-agents, dependencies.parties-registration,
// dependencies.agent-seats, dependencies.board-below-proposers, rules.procedures,
// rules.durable-processes, vocabulary.drop-actor-stopped), with the old code (/home/user/factory,
// integration/factory) and the as-is book (docs/as-is/archive/accounts/agents.ts) as evidence.

import { defineDecision } from "../../../packages/book/src/index.ts";
import { concept_agents } from "../shared/foundation.ts";
import { contract_agent_owner, contract_erc20, integration_chain_rpc, integration_indexer } from "../shared/external.ts";
import {
  error_CANCELLED,
  error_FEATURE_NOT_AVAILABLE,
  error_ROLE_PERMISSION_DENIED,
  error_TRANSACTION_FAILED,
  error_WRONG_STATE,
  error_SEAT_LIMIT_REACHED,
} from "../shared/vocabulary.ts";
import { table_principals } from "../access/data.ts";
import { procedure_parties_register, procedure_parties_resolve_recipient } from "../parties/procedures.ts";
import { table_safe_owners, table_safe_balances } from "../indexing/data.ts";
import { procedure_approvals_open } from "../approvals/procedures.ts";
import { procedure_board_propose } from "../board/procedures.ts";
import {
  event_agent_change_transitioned,
  event_agent_transitioned,
  machine_agent,
  machine_agent_change,
  table_agent_changes,
  table_agents,
} from "./data.ts";
import {
  rpc_agents_changes_create,
  rpc_agents_changes_freeze,
  rpc_agents_changes_get,
  rpc_agents_changes_remove,
  rpc_agents_changes_rotate,
  rpc_agents_changes_sweep,
  rpc_agents_changes_unfreeze,
} from "./changes.ts";
import { rpc_agents_roster_list, rpc_agents_roster_show } from "./roster.ts";
import { workflow_agents_changes_carry } from "./processes.ts";
import {
  flow_client_me_agents_create,
  flow_client_me_agents_freeze,
  flow_client_me_agents_remove,
  flow_client_me_agents_rotate_key,
  flow_client_me_agents_sweep,
  flow_client_me_agents_unfreeze,
} from "./flows.ts";
import * as op from "./operations.ts";

import { workflow_agents_fde_follow_setup } from "./processes.ts";
import { table_org_fdes, table_org_members, table_org_setups } from "../organizations/data.ts";
import { concept_organizations, concept_projects } from "../shared/foundation.ts";

const CLAUDE = "Claude, agents design, 8 November 2026";
const by = (evidence: string) => `${CLAUDE}; evidence: ${evidence}`;
const OLD = "packages/backend/src/accounts/agents";

const OPERATIONS = [
  op.operation_agent_create,
  op.operation_agent_freeze,
  op.operation_agent_unfreeze,
  op.operation_agent_key_rotate,
  op.operation_agent_list,
  op.operation_agent_show,
  op.operation_agent_sweep,
  op.operation_agent_remove,
];
const CHANGE_RPCS = [
  rpc_agents_changes_create,
  rpc_agents_changes_freeze,
  rpc_agents_changes_unfreeze,
  rpc_agents_changes_rotate,
  rpc_agents_changes_sweep,
  rpc_agents_changes_remove,
];
const FLOWS = [
  flow_client_me_agents_create,
  flow_client_me_agents_freeze,
  flow_client_me_agents_unfreeze,
  flow_client_me_agents_rotate_key,
  flow_client_me_agents_sweep,
  flow_client_me_agents_remove,
];

// ── data ────────────────────────────────────────────────────────────────────────────────────

export const decision_agents_tables = defineDecision({
  id: "agents.tables",
  title: "Two tables: the agent and its changes; the old copies go",
  question: "Old accounts kept `agents` and `agentChanges` with copies of other concepts' facts and send plumbing. What does the target keep?",
  options: [
    {
      label: "two-lean",
      text:
        "`agents` (whose agent, its Safe, its key now, where the key is kept, its state) and `agent-changes` (one row per " +
        "change: what it asked, its carrier, what the chain made of it). Name and handle are the Party's, the accountId " +
        "access', the owner's email and Safe the owner's own rows; the operation hashes, submission notes, expiries, lanes " +
        "and the frozen and removed flags go.",
    },
    { label: "as-is", text: "Port both tables with every field, including the copies and the send notes." },
    { label: "one-table", text: "One `agents` table holding the last change inline." },
  ],
  chosen: "two-lean",
  why:
    "A copy can disagree with its source: the old row's handle could outlive a released Party, its frozen flag disagree " +
    "with its state. Every copied fact has one owner in the target (parties, access, accounts, organizations), and agents " +
    "depends on each. The send notes (`userOpHash`, submission and hand-back) were the old relay's, and approvals and board " +
    "now own the one send (P3: plumbing goes). A change is its own durable object (rules.durable-processes lists an agent " +
    "change), with its own history, so it needs its own row; an inline last change would lose what earlier changes did. " +
    "Both tables are tenant `owner` because a person or an Organization can own an agent (P8), and every row carries its " +
    "owner, so nothing is scoped by a join.",
  source: by(`packages/backend/convex/schema/accounts.ts:196 and :230; ${OLD}/writes/rows.ts:59; docs/as-is/archive/accounts/data.ts`),
  affects: [table_agents, table_agent_changes, concept_agents],
});

export const decision_agents_machines = defineDecision({
  id: "agents.machines",
  title: "Frozen and removed are states; a change has no `sent`",
  question: "The old agent stored creating, active and failed and read frozen and removed from two flags; a change had waiting, sent, landed and failed. What are the target machines?",
  options: [
    {
      label: "states",
      text:
        "agent: creating, active, frozen, removed, failed, each write a named transition. agent-change: waiting, landed, " +
        "failed; the carrier's own states (sponsoring, signed, sent; awaiting approvals) are the carrier's.",
    },
    { label: "flags", text: "Keep the flags beside a three-state machine, as the old row did." },
  ],
  chosen: "states",
  why:
    "P7 makes every write to a status a transition that sends its machine's one event; a flag written beside the state " +
    "would be a status change with no event, and the funnel could not see a freeze. `sent` and its hand-back to waiting " +
    "were the old send relay's; the approval or the proposal now carries the send, and the change only waits for its " +
    "carrier's end. Removed and failed are terminal: AgentOwner refuses every owner power on a removed agent, and a failed " +
    "create never had a Safe.",
  source: by(`${OLD}/rules.ts:28; ${OLD}/rules.ts:58; ${OLD}/writes/changes.ts:134; docs/as-is/archive/accounts/data.ts`),
  affects: [machine_agent, machine_agent_change, table_agents, table_agent_changes],
});

export const decision_agents_events = defineDecision({
  id: "agents.events",
  title: "One event for the agent's state, one for every change of it",
  question: "The old `agent_transitioned` carried created, frozen, unfrozen, swept, key_rotated and removed. How does it map onto one event per machine?",
  options: [
    { label: "two", text: "agent_transitioned for the agent's state; agent_change_transitioned (with `kind`) for every change, so a sweep and a rotation are proved there." },
    { label: "agent-only", text: "Only agent_transitioned, with sweep and rotation as transitions that do not change state." },
  ],
  chosen: "two",
  why:
    "A sweep and a key rotation change no agent state, so as agent transitions they would be self-loops that send an " +
    "event without a status change. As landings of a change they are real transitions (waiting to landed) with their " +
    "kind on the event. The create's `from` is null at birth on both, and a failure carries its code.",
  source: by(`${OLD}/events.ts:48; books/frozen/operations.ts (agent.* events); docs/decisions/policy-pack.md#p7`),
  affects: [event_agent_transitioned, event_agent_change_transitioned, machine_agent, machine_agent_change],
});

export const decision_agents_one_waiting_change = defineDecision({
  id: "agents.one-waiting-change",
  title: "One change waits for an agent at a time, the create included",
  question: "The frozen notes say only one change waits for an agent at a time. How is that kept, and does it hold for an Organization's slow proposals?",
  options: [
    { label: "unique-waiting", text: "A unique index on (owner, agent) among waiting changes; the create is a change too, so nothing else is opened while it waits." },
    { label: "freeze-jumps", text: "Let a freeze open beside a waiting change, so an Organization can stop an agent while a proposal waits." },
  ],
  chosen: "unique-waiting",
  why:
    "The frozen refusals of freeze, unfreeze, rotate, sweep and remove all say another waiting change is WRONG_STATE, and " +
    "a unique index makes it hold under concurrency. Two waiting changes could also land in either order on chain and " +
    "leave the agent in a state neither asked for. A person's approval lapses within the paymaster's window, so it never " +
    "blocks for long; a Board that must freeze while a proposal waits rejects that proposal first (board's reject), " +
    "which ends the change and frees the agent. The surface wins (P10 rung 1).",
  source: by("books/frozen/operations.ts (agent.freeze, agent.sweep notes and WRONG_STATE refusals); packages/backend/src/accounts/agents/writes/changes.ts:66"),
  affects: [table_agent_changes, machine_agent_change, ...CHANGE_RPCS],
});

// ── ownership and authority ─────────────────────────────────────────────────────────────────

export const decision_agents_org_owned = defineDecision({
  id: "agents.org-owned",
  title: "An Organization can own an agent; every change to it is a Board proposal",
  question: "The top-level text of `agent create` refuses `--org` with FEATURE_NOT_AVAILABLE; its designed v4 text has a Director create the agent for the Organization. Which is built?",
  options: [
    {
      label: "designed",
      text:
        "Build it: with `--org` the company Safe is the AgentOwner owner, and the create and every later change is one " +
        "Board proposal (`board.propose`) whose proposing Director's approval comes with it. FEATURE_NOT_AVAILABLE stays " +
        "reachable through the proposal's own `owner-safe-proposals` gate.",
    },
    { label: "top-level", text: "Refuse `--org` with FEATURE_NOT_AVAILABLE, as the old CLI shipped it." },
  ],
  chosen: "designed",
  why:
    "P10 rung 1: where a designed block exists its v4 text is the surface (P9), and it names `--org`, a Director as who, " +
    "and ROLE_PERMISSION_DENIED for a non-Director. The concept map put agents above board for exactly this " +
    "(concepts.agents, dependencies.of-agents), and AgentOwner takes any Safe as owner. Keeping the frozen refusal as a " +
    "gate costs nothing: a Board proposal needs the Organization's proposals gate, so an Organization without it still " +
    "hears FEATURE_NOT_AVAILABLE. The top-level note that says it is not available yet is the old build's status, kept " +
    "in the frozen text.",
  source: by("books/frozen/operations.ts (agent.create designed W9); apps/cli/src/commands/agent/subcommands/create/execute.ts (organizationOwnerUnavailable); books/target/board/procedures.ts"),
  affects: [
    table_agents, table_agent_changes, rpc_agents_changes_create, procedure_board_propose, op.operation_agent_create,
    error_FEATURE_NOT_AVAILABLE, ...CHANGE_RPCS,
  ],
});

export const decision_agents_who_acts = defineDecision({
  id: "agents.who-acts",
  title: "The owner or a Director acts; not yours and none are one refusal",
  question: "Who may change or read an agent, and how is someone else's agent refused?",
  options: [
    {
      label: "owner-or-director",
      text:
        "A person-owned agent: its owner, from their own Safe. An Organization-owned agent: a Director, whose own Safe is " +
        "an owner of the company Safe on chain (indexing's safe-owners), proposes each change and the Board's approval " +
        "acts, since AgentOwner answers only the company Safe; a Director reads it. `agent show` also admits the agent " +
        "itself. Anyone else, and a ref that names no agent, get the same ROLE_PERMISSION_DENIED.",
    },
    { label: "members", text: "Any member of the owning Organization may read and change its agents." },
  ],
  chosen: "owner-or-director",
  why:
    "AgentOwner's own check is `msg.sender == owner`: only the owner's Safe acts, and an Organization's Safe acts only " +
    "through its Board, so a Director proposes and the Board acts, as one Director alone cannot unless the threshold is " +
    "one (docs/design/authority.md); reading the company Safe's owners from the chain is the same truth board.propose " +
    "checks. One refusal for not-yours and none is the frozen rule ('so a handle never tells " +
    "who owns it'). The agent may read itself (designed `agent show` who: 'or the agent itself'), found by its " +
    "principal's Safe. A member who is no Director reads the Organization's agents only through its Seats.",
  source: by("books/frozen/operations.ts (agent.show refusals, designed who); AgentOwner.sol onlyAgentOwner; books/target/indexing/data.ts (safe-owners)"),
  affects: [...CHANGE_RPCS, rpc_agents_changes_get, rpc_agents_roster_show, rpc_agents_roster_list, table_safe_owners, error_ROLE_PERMISSION_DENIED],
});

export const decision_agents_designed_surface = defineDecision({
  id: "agents.designed-surface",
  title: "Where a designed block exists, its who and its refusal codes are the operation's",
  question: "Six agent operations carry a designed (v4) block whose `who` and refusals differ from the top-level text. Which wins?",
  options: [
    { label: "designed", text: "The designed `who`, and the union of the top-level and designed refusals, each reached from its own world." },
    { label: "top-level", text: "The top-level text, as the old CLI shipped it." },
  ],
  chosen: "designed",
  why:
    "P10 rung 1, as payments.designed-surface reads it. The designed text adds what v4 can answer: a Director for " +
    "`--org`, the agent reading itself, an empty Safe as WRONG_STATE. The top-level refusals stay where they still hold " +
    "(SMART_ACCOUNT_MISSING, a second waiting change), so each operation lists both, a code twice when two worlds reach " +
    "it in different ways. The SDK method `agent show` names (`client.me.agents.get` designed, `show` top-level) does not " +
    "matter here: the operation is one rpc.",
  source: by("docs/decisions/policy-pack.md#p10; books/frozen/operations.ts (designed blocks of agent create, freeze, key rotate, remove, show, sweep)"),
  affects: OPERATIONS,
});

export const decision_agents_account_at_sign_in = defineDecision({
  id: "agents.account-at-first-sign-in",
  title: "An agent's accountId is access' principal, null until its first sign-in",
  question: "The old create minted the agent's accountId at once. Who makes the agent's Account in the target?",
  options: [
    { label: "access", text: "Access makes the agent's principal at its first signed challenge; agents reads it by the agent's Safe and answers null until then." },
    { label: "mint-here", text: "Agents mints the id at create and access adopts it at sign-in." },
  ],
  chosen: "access",
  why:
    "The frozen meaning of `accountId` is 'the Account the agent signs in to; it is bound at the agent's first sign-in', " +
    "and access owns principals and has no procedure for another concept to write one (access.no-procedures). An id " +
    "minted here would be a principal access does not know. Reading by Safe needs nothing new: principals are unique " +
    "by Safe. `agent create`'s answer reads `accountId` null, and `agent show` names it once the agent has signed in.",
  source: by("books/frozen/operations.ts (agent.create returns); books/target/access/data.ts (principals by_safe); docs/as-is/archive/accounts/agents.ts (create mints accountId)"),
  affects: [table_agents, table_principals, rpc_agents_roster_show, rpc_agents_roster_list, op.operation_agent_create],
});

// ── the create ──────────────────────────────────────────────────────────────────────────────

export const decision_agents_create_one_transaction = defineDecision({
  id: "agents.create-one-transaction",
  title: "The birth is one transaction: agent, Party, change and carrier",
  question: "The old create reserved the handle, read the chain, built and sponsored the operation, then recorded the agent and approval in a second mutation. What is the target create?",
  options: [
    {
      label: "one-tx",
      text:
        "One mutation: checks, then `parties.register`, the agent `creating`, its create change `waiting`, and the carrier " +
        "(`approvals.open` or `board.propose`); approvals' process sponsors it afterwards.",
    },
    { label: "action", text: "An action that sponsors the operation first, then writes, as the old one did." },
  ],
  chosen: "one-tx",
  why:
    "A handle and its Safe are one money fact (dependencies.parties-registration), and so are a chain write and its " +
    "carrier (rules.procedures): a create that registered its Party but not its carrier would hold a handle for nothing. " +
    "Sponsorship is approvals' (concepts.approvals), so the create needs no outside call, and the predicted Safe is a pure " +
    "function (agents.safe-address-in-process). Two procedures from two concepts per transaction (parties and approvals, " +
    "or parties and board) stays within sys:tx-width.",
  source: by(`${OLD}/operations/create.ts:35; ${OLD}/writes/rows.ts:59; docs/as-is/archive/accounts/agents.ts (create, record)`),
  affects: [rpc_agents_changes_create, procedure_parties_register, procedure_approvals_open, procedure_board_propose, machine_agent, machine_agent_change],
});

export const decision_agents_safe_address_in_process = defineDecision({
  id: "agents.safe-address-in-process",
  title: "The agent's Safe is AgentOwner's pure address, computed in-process",
  question: "The old create read `AgentOwner.safeAddressFor` with an eth_call. How does the target name the agent's Safe before it exists?",
  options: [
    { label: "in-process", text: "Compute it in-process: CREATE2 of the canonical Safe 1.5.0 proxy factory, the fixed initializer and salt keccak256(owner, signer), at the deployment's AgentOwner address." },
    { label: "eth-call", text: "Call `safeAddressFor` on a node, making the create an action with a chain-read budget." },
  ],
  chosen: "in-process",
  why:
    "`safeAddressFor` is pure over constants and AgentOwner's own address (AgentOwner.sol:327), as organizations found for " +
    "the company Safe (companySafeAddressFor). Computing it keeps the create one write with no node call. A mistake " +
    "cannot misroute money: the Party stays `pending` until AgentCreated names that very Safe, and a mismatch fails the " +
    "create; a conformance eval checks the computation against the contract on the devnet.",
  source: by("AgentOwner.sol:327, :384, :389, :418 (safeAddressFor, _saltNonce, _initializer, _safeAddress); books/target/organizations/decisions.ts (in-process)"),
  affects: [rpc_agents_changes_create, contract_agent_owner, table_agents],
});

export const decision_agents_key_of_its_own = defineDecision({
  id: "agents.key-of-its-own",
  title: "A new key must be a key of its own, checked before anything is signed",
  question: "Which keys may an agent be created or rotated to?",
  options: [
    {
      label: "own",
      text:
        "Not the zero address, AgentOwner, the owner's Safe or signer, any Party's Safe, the agent's key now, or the key of " +
        "another live agent (`by-signer`): INVALID_INPUT `signer`.",
    },
    { label: "chain-only", text: "Leave it to AgentOwner's own InvalidSigner revert at sponsorship." },
  ],
  chosen: "own",
  why:
    "The frozen claims say a key that is not a key of its own is refused before anything is signed (rotate #3) and name " +
    "its cases (rotate INVALID_INPUT). AgentOwner refuses only the zero address, the sentinel, itself and the owner Safe, " +
    "so a key shared with another agent would pass on chain and let one key sign for two accounts, and access' sign-in " +
    "could not tell which agent signs in. A failed or removed agent's key no longer counts as live.",
  source: by(`${OLD}/writes/new-key.ts:19; AgentOwner.sol:342 (_requireSigner); books/frozen/operations.ts (agent.key.rotate refusals)`),
  affects: [rpc_agents_changes_create, rpc_agents_changes_rotate, table_agents],
});

export const decision_agents_transaction_width = defineDecision({
  id: "agents.transaction-width",
  title: "An Organization's create or sweep spans parties, board and approvals",
  question: "sys:tx-width allows at most 3 procedures from at most 2 other concepts per transaction. An Organization-owned create or sweep invokes parties and board, and board.propose itself invokes approvals. Is that within the rule?",
  options: [
    {
      label: "direct-count",
      text:
        "Count the procedures a transaction invokes directly: 2 from 2 concepts (parties' register or resolve-recipient, " +
        "and approvals.open or board.propose). Board's own approvals.open is board's, and a reviewer reads it as such.",
    },
    { label: "split", text: "Register the Party or resolve the recipient in an earlier transaction, then open the proposal." },
  ],
  chosen: "direct-count",
  why:
    "Each write is forced by a shared decision: a birth registers its Party in its own transaction " +
    "(dependencies.parties-registration), a chain write is born with its carrier (rules.procedures), and a Board proposal " +
    "opens its proposer's approval (board.propose). Splitting any of them would leave a held handle, a named recipient or " +
    "a proposal without the intent it carries. A person's create or sweep is 2 procedures from 2 concepts either way. " +
    "Assembly: rules.transaction-width closes the open question this left: one run counts what it invokes itself, on its " +
    "widest branch, and a door's own invocations count against the door, so both are within sys:tx-width.",
  source: by("CONVENTIONS.md rule 6 (sys:tx-width); books/target/board/procedures.ts (board.propose invokes approvals.open); shared rules.transaction-width"),
  affects: [rpc_agents_changes_create, rpc_agents_changes_sweep, procedure_board_propose, procedure_parties_register, procedure_parties_resolve_recipient],
});

// ── sweep and remove ────────────────────────────────────────────────────────────────────────

export const decision_agents_live_balances = defineDecision({
  id: "agents.live-balances",
  title: "Sweep, remove and show read the agent's balances live from the chain",
  question: "What the agent's Safe holds: from indexing's safe-balances view, or `balanceOf` at `latest`?",
  options: [
    { label: "live", text: "chain-rpc `readContract` of `balanceOf` per settlement asset, in parallel, before the transaction; PROVIDER_ERROR when the node does not answer." },
    { label: "view", text: "indexing's safe-balances, a table read with no outside call." },
  ],
  chosen: "live",
  why:
    "The frozen text says the balances are 'read from the chain' and PROVIDER_ERROR 'when the chain does not answer. No " +
    "balance is made up', and the sweep's empty refusal decides whether anything is signed: a view behind Ponder's head " +
    "could refuse a funded Safe or show a stale amount on the page. A handful of parallel reads fits the chain-read class. " +
    "The amounts on the page are each balance at preparation; the sweep moves whatever the Safe holds at execution, and " +
    "settlement reports that.",
  source: by("books/frozen/operations.ts (agent.show, agent.sweep); books/target/indexing/data.ts (safe-balances: a send reads balanceOf live)"),
  affects: [rpc_agents_changes_sweep, rpc_agents_changes_remove, rpc_agents_roster_show, integration_chain_rpc, contract_erc20, table_safe_balances],
});

export const decision_agents_remove_names_every_asset = defineDecision({
  id: "agents.remove-names-every-asset",
  title: "A removal names every settlement asset, held or not",
  question: "The old removal named only the tokens its Safe held at preparation. What does `AgentOwner.remove(safe, tokens)` name in the target?",
  options: [
    { label: "every", text: "Every settlement asset of the deployment; AgentOwner skips an empty one with no event." },
    { label: "held", text: "Only the assets held at preparation, as the old code did." },
  ],
  chosen: "every",
  why:
    "A removal is final: money that arrives in a settlement asset between preparation and execution would otherwise be " +
    "left in a Safe no key can sign for again, and only AgentOwner could ever move it. Naming every asset still names " +
    "every asset its Safe holds (remove #1), and AgentOwner's sweep returns zero without a call for an empty token " +
    "(AgentOwner.sol:351). P10 rung 3: the stricter version wins for money.",
  source: by(`${OLD}/operations/remove.ts:19; AgentOwner.sol:248 and :351 (remove, _sweep)`),
  affects: [rpc_agents_changes_remove, op.operation_agent_remove, contract_agent_owner],
});

export const decision_agents_sweep_recipient = defineDecision({
  id: "agents.sweep-recipient",
  title: "A sweep's recipient is resolved in the sweep's own transaction",
  question: "The old sweep resolved `--to` through parties' public resolver as a separate read. How is the recipient bound in the target?",
  options: [
    { label: "procedure", text: "`parties.resolve-recipient` inside the sweep's transaction, so the change and the Party its money routes to commit together." },
    { label: "read", text: "Read parties first, outside the transaction, and keep only the address." },
  ],
  chosen: "procedure",
  why:
    "parties.resolve-recipient names 'a sweep's destination' among its invokers: a recipient and the Safe its money routes " +
    "to are one money fact, and an email no Party holds yet is named at its derived Safe in the same transaction, so the " +
    "page, the change and the chain agree on whose Safe it is. Omitted, the owner's own Safe is the recipient, so a " +
    "person's sweep and an Organization's sweep both come home.",
  source: by(`${OLD}/operations/sweep.ts:19; books/target/parties/procedures.ts (parties.resolve-recipient)`),
  affects: [rpc_agents_changes_sweep, procedure_parties_resolve_recipient],
});

export const decision_agents_removal_seats = defineDecision({
  id: "agents.removal-seats",
  title: "A removal names the Seats it ends; organizations ends them from the chain",
  question: "The designed removal ends every Seat the agent holds and reports `seatsEnded`. Who ends them, and what does the removal report?",
  options: [
    { label: "chain", text: "Organizations ends them from AgentRemoved (dependencies.agent-seats); the removal names the Seats its Safe held at preparation and reports their count." },
    { label: "procedure", text: "Agents ends them in the removal's transaction." },
  ],
  chosen: "chain",
  why:
    "A removal is final only when AgentOwner.remove lands, so the Seats follow the chain (dependencies.agent-seats), and " +
    "organizations sits below agents, so agents could not be invoked from there anyway. The page names the Seats so the " +
    "owner sees what leaves before approving; the frozen note 'agents cannot hold Seats yet' is the old build's status.",
  source: by("books/frozen/operations.ts (agent.remove designed); books/target/organizations/processes.ts (organizations.members.end-agent-seats)"),
  affects: [rpc_agents_changes_remove, op.operation_agent_remove, contract_agent_owner],
});

// ── the process and chain proof ─────────────────────────────────────────────────────────────

export const decision_agents_one_process = defineDecision({
  id: "agents.one-process",
  title: "One process per change replaces the follows and the settle-on-read",
  question: "The old system settled agents in seven places: get, show and every change action read receipts first, two self-rescheduling follows, and two signed-send actions. What survives?",
  options: [
    {
      label: "one-process",
      text:
        "`agents.changes.carry`, one instance per change, triggered by its birth and resumed by its carrier's end through " +
        "the outbox; reads never settle; approvals and board own the send.",
    },
    { label: "settle-on-read", text: "Keep settling from receipts on every read, as the old code did." },
  ],
  chosen: "one-process",
  why:
    "A3 makes each long-lived object one process that owns its machine, and rules.durable-processes lists an agent change. " +
    "A read that writes is a read no caller can trust to be cheap, and it made the old list show a lapsed create as " +
    "creating until someone read it (as-is finding). The follow loops (every ten seconds, sixty reads) were the old " +
    "scheduler's; the carrier's own transition wakes this process. With the process, `agent create` #3 ('whether or not " +
    "anyone reads it') holds by construction. Not ported: load, load-owner, load-change, record, record-submission, " +
    "clear-submission, settle, record-change, record-change-submission, clear-change-submission, settle-change, " +
    "send-signed, send-change-signed, emit-transitioned, follow and follow-change; the agent's own EntryPoint lane " +
    "becomes each approval's own nonce key.",
  source: by(`${OLD}/operations/follow.ts:24, follow-change.ts:23; ${OLD}/writes/settles.ts:136; ${OLD}/rules.ts:86; docs/as-is/archive/accounts/agents.ts`),
  affects: [workflow_agents_changes_carry, rpc_agents_roster_list, rpc_agents_roster_show, rpc_agents_changes_get, ...CHANGE_RPCS],
});

export const decision_agents_chain_proof = defineDecision({
  id: "agents.chain-proof",
  title: "A change lands only on its own AgentOwner event in its carrier's transaction",
  question: "How does the process know a change landed: the carrier's success alone, AgentOwner events as triggers, or the carrier's transaction's facts?",
  options: [
    {
      label: "facts-of-carrier",
      text:
        "When the carrier landed, read every fact of its transaction (`indexer.factsOf`, at finality) and land only on the " +
        "event the change asked for, for this Safe, key, tokens and recipient; anything else is a mismatch.",
    },
    { label: "event-triggers", text: "A workflow per AgentOwner event, finding the change by the agent's Safe." },
    { label: "carrier-success", text: "Land the change whenever its carrier landed." },
  ],
  chosen: "facts-of-carrier",
  why:
    "The frozen claims bind the event to the approved operation ('a landing whose event names another key fails'; " +
    "'settlement binds the successful receipt to the approved operation and owner, checks each event's Safe, token and " +
    "recipient'). An event trigger alone cannot tell whose operation emitted it, so a sweep landed by another path would " +
    "settle the wrong change; the carrier's success alone would land a sweep that moved to another recipient. Reading " +
    "the carrier's transaction is the one settlement path approvals and budgets use too. So AgentCreated, AgentFrozen, " +
    "AgentUnfrozen, AgentSignerSwapped and AgentSwept are read, not triggers; AgentRemoved also triggers organizations.",
  source: by(`${OLD}/external.ts:212; ${OLD}/external.ts:255; ${OLD}/writes/settles.ts:55; books/frozen/operations.ts (agent.key.rotate #2, agent.sweep #3)`),
  affects: [
    workflow_agents_changes_carry, integration_indexer, machine_agent_change,
    contract_agent_owner.e.AgentCreated, contract_agent_owner.e.AgentFrozen, contract_agent_owner.e.AgentUnfrozen,
    contract_agent_owner.e.AgentSignerSwapped, contract_agent_owner.e.AgentSwept, contract_agent_owner.e.AgentRemoved,
  ],
});

export const decision_agents_failure_codes = defineDecision({
  id: "agents.failure-codes",
  title: "How a change's end maps onto the shared codes",
  question: "A carrier can end eight ways without the change landing. Which code does each answer with?",
  options: [
    {
      label: "by-who",
      text:
        "Someone said no (declined, withdrawn, a Board rejection): CANCELLED. It can never run (expired, displaced, a " +
        "replaced proposal): WRONG_STATE. The chain ran it and it did not do what was asked (reverted, a failed proposal, " +
        "a mismatch): TRANSACTION_FAILED. A sponsorship refusal keeps the approval's own code.",
    },
    { label: "one-code", text: "TRANSACTION_FAILED for every failure." },
  ],
  chosen: "by-who",
  why:
    "CANCELLED already covers a person declining on the approval page (vocabulary: SIGNER_REJECTED merged), and a " +
    "Board's rejection is the same no. A lapse or a used nonce is a state that no longer allows the change. A revert or " +
    "a landing without its event means the chain refused what was asked, which is TRANSACTION_FAILED's message. A " +
    "refusal at sponsorship already carries the right code (NotOwner is ROLE_PERMISSION_DENIED, integrations.sponsor-refusals).",
  source: by("books/target/shared/vocabulary.ts (CANCELLED, WRONG_STATE, TRANSACTION_FAILED); books/target/approvals/data.ts; books/target/board/data.ts"),
  affects: [workflow_agents_changes_carry, table_agent_changes, error_CANCELLED, error_WRONG_STATE, error_TRANSACTION_FAILED, ...FLOWS],
});

// ── reads and flows ─────────────────────────────────────────────────────────────────────────

export const decision_agents_roster = defineDecision({
  id: "agents.roster",
  title: "`agent list` adds a Director's Organizations' agents; `agent show` adds Seats",
  question: "What do `agent list` and `agent show` read, now that an Organization can own an agent and an agent can hold a Seat?",
  options: [
    {
      label: "owner-and-director",
      text:
        "list: the caller's own agents, then those of each Organization they are a Director of, each with its owner. show: " +
        "the agent, its live positions and its active Seats with the hats its Safe wears; no balances in list.",
    },
    { label: "own-only", text: "list and show only person-owned agents, as the old code did." },
  ],
  chosen: "owner-and-director",
  why:
    "A Director acts for an Organization's agents (agents.who-acts), so they must be able to find them; adding them keeps " +
    "list #1 and #2 true (another person's agents are still never listed). The designed show names 'the Seats it holds " +
    "and what each Seat was given', which organizations' Seats and indexing's hat views answer without a copy. The " +
    "designed example's 'signed in 2 minutes ago' is access' session of another tenant (the agent), which row-level " +
    "security does not show the owner, so it is left out.",
  source: by("books/frozen/operations.ts (agent.show designed, agent.list); books/target/organizations/data.ts (org-members by_safe)"),
  affects: [rpc_agents_roster_list, rpc_agents_roster_show, op.operation_agent_list, op.operation_agent_show],
});

export const decision_agents_flows = defineDecision({
  id: "agents.flows",
  title: "One flow per change command; it makes the key, signs, hands over and follows",
  question: "Which agent operations are flows, and what does each flow own?",
  options: [
    {
      label: "six-flows",
      text:
        "create, freeze, unfreeze, rotate-key, sweep and remove are flows: prepare (one rpc), sign at once with a key on " +
        "this machine or hand over the approval page, follow live until the change ends. create and rotate-key make the " +
        "key here and keep it before anything is prepared. list and show are one rpc each.",
    },
    { label: "rpcs", text: "Each command calls the prepare rpc, and the CLI does the waiting and key handling itself." },
  ],
  chosen: "six-flows",
  why:
    "A4: the SDK owns every flow and all signing, and the CLI calls one SDK method. The old SDK returned at the approval " +
    "and left the CLI to call `wait`, `waitChange`, `approvals.approve` and its own key file (four calls per command). " +
    "Making the key in the flow keeps the frozen guarantee that only its address leaves the machine (rotate #4), and " +
    "keeping it before preparing means a create that lands always has its key. An Organization's change hands over the " +
    "proposing Director's own approval that board.propose opens.",
  source: by("packages/sdk/src/accounts/agents.ts:1; apps/cli/src/commands/agent/subcommands/create/execute.ts; apps/cli/src/auth/own-key.ts:195; docs/decisions/README.md (A4)"),
  affects: [...FLOWS, op.operation_agent_list, op.operation_agent_show, rpc_agents_changes_get],
});

export const decision_agents_acceptance_rewrites = defineDecision({
  id: "agents.acceptance-rewrites",
  title: "Two `agent sweep` lines name a mechanism and are rewritten as outcomes",
  question: "Which of agents' 26 frozen acceptance lines name a mechanism a black box cannot see (P1)?",
  options: [
    {
      label: "two",
      text:
        "sweep #3 ('only when the provider supplies the operation's logs; omitted or null logs') and sweep #5 ('Aborting " +
        "waitChange during its polling sleep'); the other 24 stay word for word.",
    },
    { label: "none", text: "Keep every line verbatim." },
  ],
  chosen: "two",
  why:
    "Sweep #3 is about the old provider's log payload, which the target does not have: settlement reads the indexed " +
    "facts of the carrier's transaction. Its outcome stays: amounts are the actual ones, an emptied token reports zero, " +
    "and a wrong or doubled event fails the change. Sweep #5 names an SDK method and its sleep; the outcome is that " +
    "cancelling the follow answers CANCELLED and leaves the sweep waiting. Both still hold against the old system. " +
    "Lines that name the CLI or the SDK as the actor (rotate #4 to #6, sweep #6) are observable at the command and stay.",
  source: by("docs/decisions/policy-pack.md#p1; books/frozen/operations.ts (agent.sweep #3, #5)"),
  affects: [op.operation_agent_sweep],
});

export const decision_agents_worlds = defineDecision({
  id: "agents.worlds",
  title: "Three worlds reach agents' refusals and claims",
  question: "Which devnet snapshots does agents introduce, and what does each hold?",
  options: [
    {
      label: "three",
      text:
        "person-with-agents: Dana (dana@acme.test, claimed Safe) owns @ledger (active, 312.50 USDC and 20.00 EURC), @spare " +
        "(active, empty Safe), @paused (frozen) and @gone (removed); Sam (sam@acme.test, claimed Safe) owns @scribe. " +
        "person-with-waiting-agent-change: that world with a freeze of @ledger and an unfreeze of @paused each waiting " +
        "for Dana's approval. org-with-agent: Acme with Directors Dana and Lee (threshold 1), the proposals gate on, a " +
        "member Max who is no Director, and @acme-bot, which Acme owns. Reused: signed-out, accounts' " +
        "person-unclaimed and board's org-with-proposals-gate-off (agent create's gate refusal, agents.org-own-agent).",
    },
    { label: "per-state", text: "One world per agent state." },
  ],
  chosen: "three",
  why:
    "One world with one agent in each stable state reaches most refusals by the handle the command names, and restores " +
    "fast. Waiting changes change what every write refuses and their approvals lapse in minutes, so they are their own " +
    "world, saved with the devnet clock stopped. An Organization's agent needs a Board, a non-Director and the gate. " +
    "The chain-rpc fault switch and the gate switch, not more worlds, reach PROVIDER_ERROR and FEATURE_NOT_AVAILABLE.",
  source: by("books/target/agents/operations.ts (every refusal's given); environments.devnet (worlds are snapshots)"),
  affects: OPERATIONS,
});

export const decision_agents_no_door = defineDecision({
  id: "agents.no-door",
  title: "Agents' door has no procedures",
  question: "Which procedures do other concepts invoke on agents?",
  options: [
    { label: "none", text: "None: no concept above agents writes an agent or a change with a money fact of its own." },
    { label: "seats", text: "A procedure for organizations to end Seats, or for payments to check an agent is live." },
  ],
  chosen: "none",
  why:
    "A procedure exists only for one money fact (rules.procedures). Concepts that pay or name an agent name its Party, " +
    "whose state parties already keeps (`pending` until the create lands); organizations ends Seats from the chain " +
    "(dependencies.agent-seats); access proves an agent's sign-in on chain (concepts.access).",
  source: by("books/target/shared/decisions.ts (rules.procedures, dependencies.agent-seats, concepts.access); docs/as-is/archive/accounts/procedures.ts"),
  affects: [concept_agents, table_agents],
});

// ── seats (Aaron's ruling aaron.seats) ──────────────────────────────────────────────────────

export const decision_agents_org_own_agent = defineDecision({
  id: "agents.org-own-agent",
  title: "An Organization owns one live agent; a second create is SEAT_LIMIT_REACHED",
  question: "The seats ruling: 'the company may hold one agent of its own'. Where is that held, and what does a second `agent create --org` do?",
  options: [
    {
      label: "at-create",
      text:
        "Agents refuses a create with `--org` while the Organization owns a live agent (creating, active or frozen), " +
        "SEAT_LIMIT_REACHED with limit `own agent`, before any Party, change or proposal is written. A removed or failed " +
        "agent frees the place. Organizations covers that agent's Seat (organizations.agent-cover).",
    },
    { label: "at-seat", text: "Let an Organization own any number of agents; only one may hold a covered Seat, the rest take seats." },
  ],
  chosen: "at-create",
  why:
    "The ruling limits the agents the company holds, not only their Seats, and agents is where an Organization's agents " +
    "are born and counted (`by-owner-created`). Checking before the Board proposal opens tells the Director at once, " +
    "instead of after the Directors approve a create that would then hold nothing. A person's own agents are not limited " +
    "here: the ruling limits what a company holds, and a person's agent rides on their Seat in a company " +
    "(organizations.agent-cover). It is reached from the world `org-with-agent`, where Acme already owns @acme-bot; no " +
    "frozen claim creates a second agent for one Organization. Because it comes before the Board proposal, the gate " +
    "refusal (FEATURE_NOT_AVAILABLE, from `board.propose`) is reached from `org-with-proposals-gate-off`, whose Acme " +
    "owns no agent, not from `org-with-agent`. Two creates at once are serialised per Organization, so one makes the " +
    "agent and the other is refused. The agent the ruling's 'company's agent' names is the Organization's own, whatever it does.",
  source: by("books/target/shared/rulings.ts (aaron.seats, Aaron's ruling of 8 November 2026); books/target/agents/data.ts (by-owner-created)"),
  affects: [rpc_agents_changes_create, op.operation_agent_create, error_SEAT_LIMIT_REACHED, table_agents],
});

// ── the Forward Deployed Engineer (Aaron's ruling aaron.fde-agent) ──────────────────────────

const FDE_RULING = by("books/target/shared/rulings.ts (aaron.fde-agent, aaron.seats, aaron.machine-login); books/target/organizations/decisions.ts");

export const decision_agents_fde = defineDecision({
  id: "agents.fde",
  title: "The Organization's own agent is its FDE; Capxul hosts the one its setup makes",
  question:
    "Every Organization has a Forward Deployed Engineer, its own agent, which Capxul hosts (its key on Capxul's FDE " +
    "host, never the founder's machine). agents.org-own-agent limits an Organization to one live agent of its own. How " +
    "are the two the same agent, how is the FDE recorded, and what of an own agent made later with `agent create --org`?",
  options: [
    {
      label: "own-agent-is-fde",
      text:
        "Under aaron.fde-agent and aaron.fde-hosted: the one live agent an Organization owns is its FDE. The one its " +
        "setup makes is hosted: Capxul's FDE host makes its key (organizations.fde-at-start-up), and agents' " +
        "`agents.fde.follow-setup`, started by the hosting's `provision`, writes its row (`found`, key store `host`) and " +
        "activates or fails it when the setup completes or fails, because its create is the install batch, not a change " +
        "of its own. With `--no-fde`, or after the FDE is removed, `agent create --org` makes the Organization's own " +
        "agent through a Board proposal, as before, with its key on the Director's machine: a self-run agent, which " +
        "pays no hosting and which `org fde show` does not show. Rotating a hosted FDE's key to one the host did not " +
        "make takes it off the host (its hosting retires: organizations.fde-hosting).",
    },
    { label: "separate-fde", text: "The FDE is a second, special kind of agent beside the Organization's own one." },
    { label: "host-every-own-agent", text: "`agent create --org` also asks the host for the key, so every own agent is hosted." },
  ],
  chosen: "own-agent-is-fde",
  why:
    "The seat ruling names the Organization's own agent, and the FDE is it, so a second kind would need a second limit " +
    "the ruling does not give. Writing the row from the hosting's `provision` keeps agents the writer of its own table, " +
    "while organizations, which builds the install batch and asks the host, keeps the Party, the Seat and the hosting. " +
    "Starting from `provision` rather than the setup's `begin` is needed now that the key is made after the mint, by " +
    "the host. No change row is born: a change is carried by an approval or proposal agents opened, and the install is " +
    "organizations'; its later freeze, key rotation, sweep and removal are ordinary changes by Board proposal " +
    "(agents.org-owned). `agent create --org` keeps its frozen behaviour, a key made on the creating machine, so the " +
    "hosted FDE is the setup's; hosting a later own agent needs a command no pack lists. Every frozen claim keeps its " +
    "world, because the worlds start Acme with `--no-fde` (organizations.startup-worlds).",
  source: FDE_RULING,
  affects: [table_agents, machine_agent, workflow_agents_fde_follow_setup, rpc_agents_changes_create, table_org_setups, table_org_fdes, op.operation_agent_create],
});

export const decision_agents_fde_authority = defineDecision({
  id: "agents.fde-authority",
  title: "The FDE may do what its Seat and hats allow, through the CLI; never govern",
  question:
    "aaron.fde-agent: the FDE sets the Organization up and adds the apps it needs, acting through the same CLI and SDK " +
    "under the Organization's authority. What may it do, and what may it never do?",
  options: [
    {
      label: "seat-and-hats",
      text:
        "It runs on Capxul's FDE host (aaron.fde-hosted), whose runtime holds its key, and acts only through the CLI and " +
        "SDK, signed in with that key, as a member: it reads what any member reads, runs the commands any member may " +
        "(projects' member commands), adds or removes a Frappe app (`org app add|remove`: a Director or the FDE, " +
        "organizations.app-commands), and whatever the hats and allowances the Board grants it allow (Books to set up the " +
        "chart, People to keep the contact book, an allowance to pay within its limit). It starts with no hat and no " +
        "allowance. It may never be a Director or wear the Shareholders' top hat, approve or execute a Board proposal, " +
        "sign the company Safe, change its own key, freeze, sweep or removal, raise or buy seats, pay its own hosting " +
        "(`org fde pay` needs a person), connect or disconnect a head, ask itself (`org fde ask` is a Director's), or sit " +
        "in another Organization.",
    },
    {
      label: "officer-at-start",
      text: "As seat-and-hats, but the install batch also mints the Books, Invoicing and People hats to the FDE, so it can set up the books and the CRM in its first conversation.",
    },
    { label: "unbounded", text: "The FDE acts with the founder's authority in everything." },
  ],
  chosen: "seat-and-hats",
  why:
    "Accepted by Aaron as recommended (8 November 2026, sixth batch): the FDE starts with no hat. Under the seats ruling " +
    "it is an agent like any other, so " +
    "its authority is what the chain lets its Safe do, and every action it takes is an ordinary command with its own " +
    "trace, refusals and evals; nothing it does is invisible to the Organization. Governing (the Board, the Safe, the " +
    "seats, a head that receives all the records) stays with people. Officer hats at start would let it set up the " +
    "books and the CRM at once, but give an AI agent officer authority no person granted by choice; the founder can " +
    "grant them in one Board proposal (`org member grant`) when the FDE asks. The cost is concrete: the books' chart " +
    "comes only from `org books accounts import`, which needs the Books hat, so with no hat the FDE's first sitting " +
    "either asks the founder to run the import or to grant it Books first. The People hat alone, which the CRM needs, is " +
    "agents.fde-people-hat. Hosted by Capxul, whatever the Board grants it is exercised by a runtime Capxul operates for " +
    "the Organization, which the Board can freeze, re-key or remove at any time; an app's add is the Organization's " +
    "choice, so the FDE and a Director make it and no other member does (organizations.commands).",
  source: FDE_RULING,
  affects: [table_agents, table_org_members, concept_organizations, concept_projects],
});

// ── the assembly after the Frappe lanes (8 November 2026) ────────────────────────────────────

const ASSEMBLY = "Claude, identity assembly after the Frappe lanes, 8 November 2026";
const asmBy = (evidence: string) => `${ASSEMBLY}; evidence: ${evidence}`;

export const decision_agents_fde_people_hat = defineDecision({
  id: "agents.fde-people-hat",
  title: "The setup grants the FDE no People hat; the founder grants it when needed",
  question:
    "Only a People hat wearer edits an Organization's contact book and CRM (aaron.contacts-permissions), so the FDE " +
    "cannot work the CRM, or import a business's contacts at start-up, without it. Does the setup grant it, or does the " +
    "founder?",
  options: [
    {
      label: "founder-grants",
      text:
        "The setup grants no hat (agents.fde-authority). When the FDE first needs the CRM it asks the founder to run `org " +
        "member grant @<its handle> --permission manage-people` (an agent named by its handle: board.agent-officer-hats), " +
        "whose Board proposal, while the founder is the only Director, needs that one signature. Until then the FDE " +
        "reads the CRM like any member, and a People hat wearer imports.",
    },
    {
      label: "install-batch",
      text:
        "The install batch also calls `Hats.mintHat(people, fdeSafe)`, so the founder's one signature installs the " +
        "company, creates the FDE and lets it work the CRM from its first sitting.",
    },
    { label: "create-flag", text: "As install-batch, but only when the founder passes `org create --fde-people`." },
  ],
  chosen: "founder-grants",
  why:
    "For Aaron, with agents.fde-authority's question: whether the FDE starts with the People hat. The People hat is " +
    "more than the CRM: it invites members and offers Seats, manages projects (projects.permissions), and is Frappe HR's " +
    "HR Manager for payroll's employees, components and runs, so granting it at install gives an AI agent people and " +
    "payroll authority no person chose. A dedicated sales permission would be the narrow grant, but none exists " +
    "(contacts.crm-permission keeps one permission for the CRM). The cost of waiting is one Board approval the FDE " +
    "asks the founder for, in the same sitting as the start-up import (contacts.startup). If Aaron wants the FDE to start working " +
    "the CRM unasked, install-batch adds one call to the batch the founder already signs and no new record.",
  source: asmBy("docs/design/frappe/crm.md (FDE and organizations); books/target/contacts/decisions.ts (contacts.crm-permission); books/target/agents/decisions.ts (agents.fde-authority)"),
  affects: [table_agents, table_org_members, table_org_setups, concept_organizations, concept_projects],
});
