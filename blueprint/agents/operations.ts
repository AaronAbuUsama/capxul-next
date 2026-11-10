// The target operation records of the eight frozen operations agents designs (OPERATION_OWNERS):
// `agent create`, `freeze`, `unfreeze`, `key rotate`, `sweep`, `remove`, `show` and `list`.
//
// Every record is built from the frozen text (frozenText), never retyped. Where the frozen record
// has a designed (v4) block, its `who` and its refusal codes are the specification (P10 rung 1,
// decision agents.designed-surface): an Organization-owned agent through `--org` is built, so
// `agent create --org` answers ROLE_PERMISSION_DENIED for a non-Director instead of
// FEATURE_NOT_AVAILABLE. Acceptance lines keep the frozen claim word for word, except two `agent
// sweep` lines that name a mechanism a black box cannot see, rewritten as outcomes with the old
// line in `was` (P1, decision agents.acceptance-rewrites). Worlds are the devnet snapshots in
// decision agents.worlds.

import { budget, defineOperation } from "../../packages/blueprint-engine/src/index.ts";
import { frozen, frozenText, type FrozenId } from "../baseline/index.ts";
import {
  error_CLI_STORAGE,
  error_CLI_USAGE,
  error_FEATURE_NOT_AVAILABLE,
  error_INVALID_INPUT,
  error_NOT_AUTHENTICATED,
  error_PROVIDER_ERROR,
  error_ROLE_PERMISSION_DENIED,
  error_SEAT_LIMIT_REACHED,
  error_SMART_ACCOUNT_MISSING,
  error_WRONG_STATE,
} from "../shared/vocabulary.ts";
import {
  flow_client_me_agents_create,
  flow_client_me_agents_freeze,
  flow_client_me_agents_remove,
  flow_client_me_agents_rotate_key,
  flow_client_me_agents_sweep,
  flow_client_me_agents_unfreeze,
} from "./flows.ts";
import { rpc_agents_roster_list, rpc_agents_roster_show } from "./roster.ts";
import { AgentDetail, CreateJson, ListJson, RemoveJson, RotateJson, StateJson, SweepJson } from "./shapes.ts";
import {
  examples_agent_create,
  examples_agent_freeze,
  examples_agent_unfreeze,
  examples_agent_key_rotate,
  examples_agent_list,
  examples_agent_show,
  examples_agent_sweep,
  examples_agent_remove,
} from "./examples.ts";

const page = (id: FrozenId) => `apps/docs/factory/operations/${id}.yaml:1`;

// ── worlds (decision agents.worlds) ─────────────────────────────────────────────────────────

export const WORLDS = {
  /** No session on this machine (shared with every concept). */
  signedOut: "signed-out",
  /** An admitted person whose Safe is not claimed yet (accounts' world). */
  unclaimed: "person-unclaimed",
  /** Dana owns @ledger (active, funded), @spare (active, empty), @paused (frozen) and @gone (removed); Sam owns @scribe. */
  agents: "person-with-agents",
  /** person-with-agents, with a freeze of @ledger and an unfreeze of @paused each waiting for Dana's approval. */
  waiting: "person-with-waiting-agent-change",
  /** Acme, with Directors Dana and Lee, a member Max who is not one, and an agent Acme owns, @acme-bot. */
  org: "org-with-agent",
  /** Acme with Dana its one Director, no agent of its own, and the `owner-safe-proposals` gate off (board's world). */
  gateOff: "org-with-proposals-gate-off",
} as const;
const W = WORLDS;

// ── frozen text helpers ─────────────────────────────────────────────────────────────────────

type FrozenLine = { readonly claim: string; readonly was: readonly string[] };
type FrozenRefusal = { readonly code: string; readonly when: string };
type WithDesigned = { readonly refusals: readonly FrozenRefusal[]; readonly designed: { readonly who: string; readonly refusals: readonly FrozenRefusal[] } | null };

const line = (id: FrozenId, n: number) => {
  const a = (frozen[id].acceptance as unknown as readonly FrozenLine[])[n - 1];
  if (!a) throw new Error(`${id}: no acceptance line ${n}`);
  return a;
};

/** Line n (from 1): the frozen claim word for word, what is observed, and its old test citation. */
const kept = (id: FrozenId, n: number, observes: string) => {
  const a = line(id, n);
  return { claim: a.claim, observes, was: [...a.was] };
};

/** Line n rewritten as an outcome a black box can check (P1); the old claim and its citation move to `was`. */
const rewritten = (id: FrozenId, n: number, claim: string, observes: string) => {
  const a = line(id, n);
  return { claim, observes, was: [a.claim, ...a.was] };
};

/** The designed (v4) block's `who`, which P10 makes the specification where it exists. */
const designedWho = (id: FrozenId) => (frozen[id] as unknown as WithDesigned).designed?.who ?? frozenText(id).who;

/** A refusal's text as the frozen top-level text gives it. */
const top = (id: FrozenId, code: string) => {
  const r = (frozen[id] as unknown as WithDesigned).refusals.find((x) => x.code === code);
  if (!r) throw new Error(`${id}: no top-level refusal ${code}`);
  return r.when;
};

/** A refusal's text as the designed (v4) block gives it. */
const designed = (id: FrozenId, code: string) => {
  const r = (frozen[id] as unknown as WithDesigned).designed?.refusals.find((x) => x.code === code);
  if (!r) throw new Error(`${id}: no designed refusal ${code}`);
  return r.when;
};

const signedOut = (id: FrozenId) => ({ error: error_NOT_AUTHENTICATED, given: W.signedOut, when: top(id, "NOT_AUTHENTICATED") });

// ── agent create ────────────────────────────────────────────────────────────────────────────

export const operation_agent_create = defineOperation({
  ...frozenText("agent.create"),
  who: designedWho("agent.create"),
  priority: "normal",
  implementedBy: flow_client_me_agents_create,
  examples: examples_agent_create,
  acceptance: [
    kept(
      "agent.create",
      1,
      "cli: from person-with-agents, `agent create Ledger2 --no-wait --json` answers a `creating` agent whose carrier is an " +
        "approval; chain: once `dev approve` signs it, the one UserOperation from Dana's Safe carries exactly one call, " +
        "AgentOwner.create(the key the CLI made, Dana's Safe).",
    ),
    kept(
      "agent.create",
      2,
      "cli: from person-with-agents an empty name and `--handle ledger` exit 2 INVALID_INPUT, and from person-unclaimed it " +
        "exits SMART_ACCOUNT_MISSING; world: no agent, Party, change or approval row appears in either.",
    ),
    kept(
      "agent.create",
      3,
      "world: after `dev approve`, with no command reading it, the agent row reads `active`, its Party `active`, and " +
        "`agent_transitioned` `activate` is in the outbox; chain: AgentCreated names its Safe, Dana's Safe and its key; read: " +
        "`agent show ledger2` then reads `active` and `@ledger2` resolves to its Safe.",
    ),
    kept(
      "agent.create",
      4,
      "world: a create whose sponsorship the chain refuses (the key already made an agent on chain, AgentExists) and one " +
        "whose approval passes its window unsigned (`dev clock warp`) each read `failed` with the Party released; cli: a " +
        "new `agent create` with the same handle then prepares.",
    ),
  ],
  returns: CreateJson,
  errors: [error_CLI_STORAGE],
  refusals: [
    {
      error: error_INVALID_INPUT,
      given: W.agents,
      when: top("agent.create", "INVALID_INPUT") + " Also a key that already signs for a Safe or an agent.",
    },
    { error: error_SMART_ACCOUNT_MISSING, given: W.unclaimed, when: top("agent.create", "SMART_ACCOUNT_MISSING") },
    { error: error_ROLE_PERMISSION_DENIED, given: W.org, when: designed("agent.create", "ROLE_PERMISSION_DENIED") },
    {
      error: error_SEAT_LIMIT_REACHED,
      given: W.org,
      when:
        "With `--org`, the Organization already owns a live agent (creating, active or frozen): it holds one of its own " +
        "(`agent create Second --org acme` while @acme-bot is active; agents.org-own-agent).",
    },
    {
      error: error_FEATURE_NOT_AVAILABLE,
      // Not W.org: Acme owns @acme-bot there, so the own-agent limit refuses first (agents.org-own-agent).
      given: W.gateOff,
      when:
        top("agent.create", "FEATURE_NOT_AVAILABLE") +
        " In the target: the Organization's `owner-safe-proposals` gate is off (the devnet's gate switch), so it can open no Board proposal.",
    },
    signedOut("agent.create"),
  ],
  budget: budget("chain-submit"),
  was: [page("agent.create"), "apps/cli/src/commands/agent/subcommands/create/execute.ts:1"],
});

// ── agent freeze and unfreeze ───────────────────────────────────────────────────────────────

export const operation_agent_freeze = defineOperation({
  ...frozenText("agent.freeze"),
  who: designedWho("agent.freeze"),
  priority: "normal",
  implementedBy: flow_client_me_agents_freeze,
  examples: examples_agent_freeze,
  acceptance: [
    kept(
      "agent.freeze",
      1,
      "chain: from person-with-agents, `agent freeze ledger` and `dev approve` send one UserOperation from Dana's Safe whose " +
        "one call is AgentOwner.freeze(@ledger's Safe); AgentFrozen follows and the Safe's one owner is AgentOwner; cli and " +
        "read: the command ends `frozen` and `agent show ledger` reads `frozen`.",
    ),
    kept(
      "agent.freeze",
      2,
      "cli: `agent freeze paused` from person-with-agents and `agent freeze ledger` from person-with-waiting-agent-change " +
        "each exit 2 WRONG_STATE; world: no change or approval row appears.",
    ),
  ],
  returns: StateJson,
  refusals: [
    { error: error_ROLE_PERMISSION_DENIED, given: W.agents, when: top("agent.freeze", "ROLE_PERMISSION_DENIED") },
    {
      error: error_ROLE_PERMISSION_DENIED,
      given: W.org,
      when: "The agent is an Organization's and you are not one of its Directors (Max freezing @acme-bot).",
    },
    { error: error_WRONG_STATE, given: W.agents, when: designed("agent.freeze", "WRONG_STATE") },
    { error: error_WRONG_STATE, given: W.waiting, when: top("agent.freeze", "WRONG_STATE") },
    signedOut("agent.freeze"),
  ],
  budget: budget("chain-submit"),
  was: [page("agent.freeze"), "apps/cli/src/commands/agent/subcommands/freeze"],
});

export const operation_agent_unfreeze = defineOperation({
  ...frozenText("agent.unfreeze"),
  priority: "normal",
  implementedBy: flow_client_me_agents_unfreeze,
  examples: examples_agent_unfreeze,
  acceptance: [
    kept(
      "agent.unfreeze",
      1,
      "chain: from person-with-agents, `agent unfreeze paused` and `dev approve` send one call from Dana's Safe, " +
        "AgentOwner.unfreeze(@paused's Safe); AgentUnfrozen follows and the Safe's one owner is its key again; read: " +
        "`agent show paused` reads `active`.",
    ),
    kept("agent.unfreeze", 2, "cli: `agent unfreeze ledger` from person-with-agents exits 2 WRONG_STATE; world: no change or approval row appears."),
  ],
  returns: StateJson,
  refusals: [
    { error: error_ROLE_PERMISSION_DENIED, given: W.agents, when: top("agent.unfreeze", "ROLE_PERMISSION_DENIED") },
    { error: error_WRONG_STATE, given: W.agents, when: "It is not frozen (`agent unfreeze ledger`)." },
    { error: error_WRONG_STATE, given: W.waiting, when: top("agent.unfreeze", "WRONG_STATE") },
    signedOut("agent.unfreeze"),
  ],
  budget: budget("chain-submit"),
  was: [page("agent.unfreeze"), "apps/cli/src/commands/agent/subcommands/unfreeze"],
});

// ── agent key rotate ────────────────────────────────────────────────────────────────────────

export const operation_agent_key_rotate = defineOperation({
  ...frozenText("agent.key.rotate"),
  who: designedWho("agent.key.rotate"),
  priority: "normal",
  implementedBy: flow_client_me_agents_rotate_key,
  examples: examples_agent_key_rotate,
  acceptance: [
    kept(
      "agent.key.rotate",
      1,
      "chain: from person-with-agents, the one call from Dana's Safe is AgentOwner.swapSigner(@ledger's Safe, old key, new " +
        "key); once it lands the Safe's owners are exactly [new key], its threshold, modules and guards are unchanged, and " +
        "AgentSignerSwapped names both keys; cli: `auth login --own-key` signs in as @ledger with the new key, and the old " +
        "key is NOT_AUTHENTICATED.",
    ),
    kept(
      "agent.key.rotate",
      2,
      "world: a rotation whose landed transaction's AgentSignerSwapped names another new key (scripted with the devnet's " +
        "chain fault switch) ends `failed` with TRANSACTION_FAILED, and the agent row keeps its key; read: `agent show " +
        "ledger` names the old key.",
    ),
    kept(
      "agent.key.rotate",
      3,
      "cli: from person-with-agents, `agent key rotate paused` and `agent key rotate gone` exit WRONG_STATE, a new key " +
        "that is @scribe's key exits INVALID_INPUT, and `agent key rotate scribe` exits ROLE_PERMISSION_DENIED; world: no " +
        "change or approval row appears.",
    ),
    kept(
      "agent.key.rotate",
      4,
      "trace: the rotate rpc's input carries the new key's address and no private key; cli: with the devnet's fault switch " +
        "making the rpc's answer name another key, the command exits INVALID_INPUT and no approval is signed.",
    ),
    kept(
      "agent.key.rotate",
      5,
      "cli: at a terminal, the output names the retired key and the new key before the approval link; with `--json`, " +
        "`oldSigner` and `signer`.",
    ),
    kept(
      "agent.key.rotate",
      6,
      "cli: the key file beside the session holds the old key in use and the new one waiting until the rotation lands, " +
        "then only the new one; after a declined rotation only the old one; a second rotate replaces the waiting key, and " +
        "the file never holds two waiting keys.",
    ),
  ],
  returns: RotateJson,
  errors: [error_CLI_STORAGE],
  refusals: [
    { error: error_ROLE_PERMISSION_DENIED, given: W.agents, when: top("agent.key.rotate", "ROLE_PERMISSION_DENIED") },
    { error: error_WRONG_STATE, given: W.agents, when: "The agent is frozen or removed (`agent key rotate paused`, `gone`)." },
    { error: error_WRONG_STATE, given: W.waiting, when: top("agent.key.rotate", "WRONG_STATE") },
    { error: error_INVALID_INPUT, given: W.agents, when: top("agent.key.rotate", "INVALID_INPUT") },
    signedOut("agent.key.rotate"),
  ],
  budget: budget("chain-submit"),
  was: [page("agent.key.rotate"), "apps/cli/src/commands/agent/internal/rotate.ts:1"],
});

// ── agent list and show ─────────────────────────────────────────────────────────────────────

export const operation_agent_list = defineOperation({
  ...frozenText("agent.list"),
  priority: "normal",
  implementedBy: rpc_agents_roster_list,
  examples: examples_agent_list,
  acceptance: [
    kept(
      "agent.list",
      1,
      "cli: from person-with-agents, Dana's `agent list` names @gone, @paused, @spare and @ledger newest first with states " +
        "removed, frozen, active and active; world: the before-and-after diff is empty.",
    ),
    kept("agent.list", 2, "cli: Dana's list holds no @scribe, and Sam's holds only @scribe; trace: the rpc's read is scoped to the caller's tenant."),
  ],
  returns: ListJson,
  refusals: [signedOut("agent.list")],
  budget: budget("read"),
  was: [page("agent.list"), "apps/cli/src/commands/agent/subcommands/list"],
});

export const operation_agent_show = defineOperation({
  ...frozenText("agent.show"),
  who: designedWho("agent.show"),
  priority: "normal",
  implementedBy: rpc_agents_roster_show,
  examples: examples_agent_show,
  acceptance: [
    kept(
      "agent.show",
      1,
      "cli: from person-with-agents, `agent show ledger` and `agent show <its agent_ id>` print the same agent, with " +
        "positions of 312.50 USDC and 20.00 EURC; chain: those are its Safe's balanceOf; world: the diff is empty.",
    ),
    kept(
      "agent.show",
      2,
      "cli: Dana's `agent show scribe` and `agent show nobody` both exit 4 ROLE_PERMISSION_DENIED with the same message and " +
        "no field of @scribe.",
    ),
  ],
  returns: AgentDetail,
  refusals: [
    { error: error_ROLE_PERMISSION_DENIED, given: W.agents, when: top("agent.show", "ROLE_PERMISSION_DENIED") },
    signedOut("agent.show"),
    {
      error: error_PROVIDER_ERROR,
      given: W.agents,
      when: top("agent.show", "PROVIDER_ERROR") + " (The devnet's chain-rpc fault switch takes the node down.)",
    },
  ],
  budget: budget("chain-read"),
  was: [page("agent.show"), "apps/cli/src/commands/agent/subcommands/show"],
});

// ── agent sweep ─────────────────────────────────────────────────────────────────────────────

export const operation_agent_sweep = defineOperation({
  ...frozenText("agent.sweep"),
  who: designedWho("agent.sweep"),
  priority: "normal",
  implementedBy: flow_client_me_agents_sweep,
  examples: examples_agent_sweep,
  acceptance: [
    kept(
      "agent.sweep",
      1,
      "chain: from person-with-agents, `agent sweep ledger` is one UserOperation from Dana's Safe with two AgentOwner.sweep " +
        "calls (USDC, EURC), `--asset USDC` one call, and after a USDC-only sweep a plain sweep of the EURC-only Safe one " +
        "EURC call; cli: each opens one approval.",
    ),
    kept(
      "agent.sweep",
      2,
      "cli: `--to sam@acme.test`, `--to @scribe` and `--to` Sam's Safe address each show Sam's or @scribe's Safe before the " +
        "approval; a malformed email and `--to @nobody` exit INVALID_INPUT; world: those open no change or approval.",
    ),
    rewritten(
      "agent.sweep",
      3,
      "Settlement binds the landed operation to the approved one and its owner, checks each AgentSwept's Safe, token and " +
        "recipient, and reports the actual amounts. A selected token that became empty before execution reports zero; an " +
        "event for another Safe, token or recipient, or a second event for one token, fails the change.",
      "chain and cli: a sweep whose USDC is moved out before it executes lands with USDC 0 and the EURC AgentSwept amount; " +
        "world: a landing scripted with a mismatching or doubled AgentSwept (the devnet's chain fault switch) ends the " +
        "change `failed` with TRANSACTION_FAILED.",
    ),
    kept(
      "agent.sweep",
      4,
      "cli: `agent sweep paused` lands and `agent show paused` still reads `frozen`; `agent sweep spare`, `--asset DOGE` " +
        "and `agent sweep scribe` exit WRONG_STATE, INVALID_INPUT and ROLE_PERMISSION_DENIED with nothing signed.",
    ),
    rewritten(
      "agent.sweep",
      5,
      "Cancelling the command while it follows the sweep returns CANCELLED, and the sweep keeps waiting as it was.",
      "cli: an interrupt during the follow exits 130 CANCELLED; read: `agent show ledger` names the sweep as its last " +
        "change, still `waiting`; world: its approval is unchanged.",
    ),
    kept(
      "agent.sweep",
      6,
      "cli: the preparation lists USDC and EURC each with its balance at preparation; after landing each is listed with " +
        "the amount its AgentSwept moved.",
    ),
  ],
  returns: SweepJson,
  refusals: [
    { error: error_ROLE_PERMISSION_DENIED, given: W.agents, when: top("agent.sweep", "ROLE_PERMISSION_DENIED") },
    { error: error_WRONG_STATE, given: W.agents, when: designed("agent.sweep", "WRONG_STATE") },
    { error: error_WRONG_STATE, given: W.waiting, when: top("agent.sweep", "WRONG_STATE") },
    { error: error_INVALID_INPUT, given: W.agents, when: top("agent.sweep", "INVALID_INPUT") },
    signedOut("agent.sweep"),
  ],
  budget: budget("chain-submit"),
  was: [page("agent.sweep"), "apps/cli/src/commands/agent/internal/sweep.ts:1"],
});

// ── agent remove ────────────────────────────────────────────────────────────────────────────

export const operation_agent_remove = defineOperation({
  ...frozenText("agent.remove"),
  who: designedWho("agent.remove"),
  priority: "normal",
  implementedBy: flow_client_me_agents_remove,
  examples: examples_agent_remove,
  acceptance: [
    kept(
      "agent.remove",
      1,
      "chain: from person-with-agents, `agent remove ledger --confirm` and `dev approve` send one call from Dana's Safe, " +
        "AgentOwner.remove(@ledger's Safe, tokens) naming every settlement asset; AgentSwept moves 312.50 USDC and 20.00 " +
        "EURC to Dana's Safe and AgentRemoved follows; cli and read: it ends `removed` and `agent show ledger` reads " +
        "`removed`.",
    ),
    kept(
      "agent.remove",
      2,
      "cli: `agent remove paused --confirm` lands `removed`; then its freeze, unfreeze, sweep and remove each exit " +
        "WRONG_STATE; world: none of them writes a change row.",
    ),
  ],
  returns: RemoveJson,
  errors: [error_CLI_USAGE],
  refusals: [
    { error: error_ROLE_PERMISSION_DENIED, given: W.agents, when: top("agent.remove", "ROLE_PERMISSION_DENIED") },
    { error: error_WRONG_STATE, given: W.agents, when: "It is already removed (`agent remove gone`)." },
    { error: error_WRONG_STATE, given: W.waiting, when: top("agent.remove", "WRONG_STATE") },
    { error: error_CLI_USAGE, given: W.agents, when: top("agent.remove", "CLI_USAGE") },
    signedOut("agent.remove"),
  ],
  budget: budget("chain-submit"),
  was: [page("agent.remove"), "apps/cli/src/commands/agent/internal/remove.ts:1"],
});
