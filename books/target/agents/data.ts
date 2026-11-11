// The agents concept's data: two tables, `agents` and `agent-changes`, each with its one state
// machine and that machine's one event (P7).
//
// An agent is an account of its own: a Safe whose one signer is the agent's key, deployed and held
// by AgentOwner for its owner (a person's Safe, or an Organization's company Safe). Its name and its
// `@handle` are its Party's (parties), registered in the agent's birth transaction; its principal,
// once it signs in with its key, is access'. What agents keeps is what only agents knows: whose
// agent it is, which key signs for it now, where its creator's machine keeps that key, and its
// lifecycle. Every change an owner makes (the create, a freeze, an unfreeze, a key rotation, a sweep,
// a removal) is one `agent-changes` row carried by one approval from the owner's Safe, or by one
// Board proposal when an Organization owns the agent, and moved by its one durable process
// (`agents.changes.carry`, in ./processes.ts) on chain proof. Old accounts' `agents` and
// `agentChanges` become these two tables (decision `agents.tables`). Times are UTC instants
// (timestamptz); addresses are lowercase hex strings.

import { Schema } from "effect";
import { defineEvent, defineMachine, defineTable } from "../../../packages/book/src/index.ts";
import { concept_agents } from "../shared/foundation.ts";

const OLD = "packages/backend/src/accounts/agents";
const AS_IS = "docs/as-is/archive/accounts/data.ts";
const TABLES = "packages/backend/convex/schema/accounts.ts";

// ── shapes ──────────────────────────────────────────────────────────────────────────────────

const S = Schema.String;
const NullOr = Schema.NullOr;
const Instant = Schema.DateTimeUtc;

/** Who owns an agent: a person (their principal id) or an Organization (its org_id). */
export const OwnerKind = Schema.Literals(["person", "organization"]);

/**
 * Where the agent's key is kept: on its creator's machine (a private file, or printed once for `CAPXUL_PRIVATE_KEY`),
 * or, for an Organization's hosted FDE, by Capxul's FDE host, which made it (aaron.fde-hosted, agents.fde).
 */
export const KeyStore = Schema.Literals(["file", "env", "host"]);

/** Where a key made on the caller's machine is kept: what `agent create` and `agent key rotate` choose. */
export const LocalKeyStore = Schema.Literals(["file", "env"]);

export const AGENT_STATES = ["creating", "active", "frozen", "removed", "failed"] as const;
export const AgentState = Schema.Literals(AGENT_STATES);

export const CHANGE_KINDS = ["create", "freeze", "unfreeze", "rotate", "sweep", "remove"] as const;
export const ChangeKind = Schema.Literals(CHANGE_KINDS);

export const CHANGE_STATES = ["waiting", "landed", "failed"] as const;
export const ChangeState = Schema.Literals(CHANGE_STATES);

/** What carries a change on chain: the owner's own approval, or a Board proposal of the owning Organization. */
export const CarrierKind = Schema.Literals(["approval", "proposal"]);

/**
 * Why a change failed, as its carrier or the chain ended it: the owner declined, the paymaster's simulation
 * refused it, its approval expired unsent, another operation took its nonce, its opener withdrew it, it landed
 * and reverted, the Board rejected the proposal, or it landed without the AgentOwner event it asked for.
 */
export const ChangeOutcome = Schema.Literals([
  "declined", "refused", "expired", "displaced", "withdrawn", "reverted", "rejected", "mismatch",
]);

/** A failed change's end: what happened and the error code of the shared vocabulary its flow answers with. */
export const ChangeFailure = Schema.Struct({ outcome: ChangeOutcome, code: S, reason: S });

/** One settlement asset a sweep or a removal names, with what the agent's Safe held of it at preparation. */
export const NamedAsset = Schema.Struct({ token: S, symbol: S, decimals: Schema.Int, prepared_raw: S });

/** What one AgentSwept event moved: from the agent's Safe, of one token, to one recipient. */
export const Swept = Schema.Struct({ token: S, to: S, raw_amount: S });

/** A sweep's recipient: the Party `--to` named (or the owner's), and the Safe its money lands in. */
export const Recipient = Schema.Struct({ party_id: S, safe_address: S, label: S });

// ── agents ──────────────────────────────────────────────────────────────────────────────────

export const table_agents = defineTable({
  id: "agents",
  title: "Agents: accounts of their own, owned through AgentOwner",
  about:
    "One row per agent, born `creating` in `agent create`'s one transaction with its Party (`parties.register`: its " +
    "handle, its name and the Safe money sent to it lands in) and its create change. `safe_address` is " +
    "AgentOwner.safeAddressFor(signer, owner's Safe), known before the Safe exists and never changed, so it is the " +
    "agent's chain key. `signer_address` is the key that signs for it now: the key it was created with, replaced only " +
    "when a rotation lands on chain naming that new key. `key_store` is where the key is kept, as its creator said: on " +
    "their machine (`file`, `env`), or `host` for an Organization's hosted FDE, whose key Capxul's FDE host made and " +
    "keeps (never the key: the backend only ever sees its address); a landed rotation sets its new key's. The owner is a person (`owner_kind` person, " +
    "`owner_id` their principal id) or an Organization (`owner_kind` organization, `owner_id` its org_id); it never " +
    "changes, because AgentOwner binds the owner's Safe at creation. Name and handle are read from the Party, the " +
    "agent's principal (its accountId) from access by its Safe, the owner's email and Safe from the owner's own rows: " +
    "the old copies of each are gone. Only agents' rpcs and its processes write it. The one live agent an Organization " +
    "owns is its Forward Deployed Engineer (aaron.fde-agent, agents.fde): born with the Organization's setup, its key made " +
    "by Capxul's FDE host and its create in the install batch (aaron.fde-hosted), or later by `agent create --org`, a " +
    "self-run agent of the Organization's own, when it has none.",
  concept: concept_agents,
  tenancy: "owner",
  tenantField: "owner_id",
  scope:
    "`owner_kind` with `owner_id` (a principal id or an org_id): the policy matches the session's person, or an " +
    "Organization its principal is a member of; an agent signed in with its own key sees its own row by `safe_address`.",
  admits: [
    {
      match: "own-safe",
      field: "safe_address",
      reads: true,
      writes: false,
      about:
        "The agent itself, signed in with its own key, reads its own row (`agent show`, found `by-safe`); its changes " +
        "are its owner's rpcs' and its process's (agents.who-acts).",
    },
  ],
  fields: Schema.Struct({
    owner_id: S,
    owner_kind: OwnerKind,
    agent_id: S,
    party_id: S,
    safe_address: S,
    signer_address: S,
    key_store: KeyStore,
    state: AgentState,
    /** The principal who asked for it: the owner, or for an Organization the Director who proposed it. */
    created_by: S,
    created_at: Instant,
    /** When its create landed and it became active; null while creating, or if it failed. */
    activated_at: NullOr(Instant),
    /** When it failed or was removed. */
    ended_at: NullOr(Instant),
    updated_at: Instant,
  }),
  key: ["owner_id", "agent_id"],
  indexes: [
    {
      name: "by-owner-created",
      fields: ["owner_id", "owner_kind", "created_at", "agent_id"],
      for: "`agent list`: one owner's agents, newest first.",
    },
    {
      name: "by-id",
      fields: ["agent_id"],
      unique: true,
      crossTenant: true,
      for:
        "One agent by its `agent_` id, for `agent show` and every change (row-level security still scopes the read to " +
        "its owner), and for its change's process.",
    },
    {
      name: "by-safe",
      fields: ["safe_address"],
      unique: true,
      crossTenant: true,
      for:
        "The agent a Safe is: `agent show` run by the agent itself (its principal names its Safe), and the AgentOwner " +
        "event a change's process reads, which names the agent only by its Safe.",
    },
    {
      name: "by-party",
      fields: ["party_id"],
      unique: true,
      crossTenant: true,
      for: "The agent an `@handle` names: parties resolves the handle to its Party, and this finds the agent behind it.",
    },
    {
      name: "by-signer",
      fields: ["signer_address"],
      crossTenant: true,
      for:
        "Whether a key already signs for a live agent (not failed, not removed), so a create or a rotation refuses a key " +
        "that is not a key of its own.",
    },
  ],
  retention: "Kept for good: its Party, its changes and other concepts' records (Seats, payments) point at it.",
  was: [AS_IS, `${TABLES}:196`, `${OLD}/writes/rows.ts:59`, `${OLD}/rules.ts:28`, `${OLD}/reads/owners.ts:15`],
});

export const event_agent_transitioned = defineEvent({
  id: "agent_transitioned",
  about:
    "An agent changed state: born creating, became active when its create landed, failed, was frozen, unfrozen or " +
    "removed. `from` is null at birth. The funnel reads it (the agent journey ends at `activate`); the runtime writes it " +
    "to the outbox in the transition's transaction. A sweep and a key rotation change no agent state: they are " +
    "`agent_change_transitioned` with their kind.",
  props: Schema.Struct({
    from: NullOr(AgentState),
    to: AgentState,
    transition: Schema.Literals(["create", "found", "activate", "fail", "freeze", "unfreeze", "remove"]),
    agent_id: S,
    party_id: S,
    owner_kind: OwnerKind,
    owner_id: S,
  }),
  was: ["docs/as-is/archive/shared/vocabulary.ts", `${OLD}/events.ts:48`],
});

const A = [event_agent_transitioned];

export const machine_agent = defineMachine({
  id: "agent",
  title: "Agent: from its create to its removal",
  about:
    "agents.state. Born `creating` with its create change; then only its changes' process moves it, and only on chain " +
    "proof: AgentCreated for its Safe, owner and key makes it `active`; AgentFrozen `frozen`; AgentUnfrozen `active` " +
    "again; AgentRemoved `removed` for good. A create that ends without landing (declined, lapsed unsent, refused, " +
    "reverted, or landed without its AgentCreated) makes it `failed`, and its handle is freed in the same transaction. " +
    "The old row stored only creating, active and failed and read frozen and removed from two flags; here they are " +
    "states, so every write to `state` is one of these transitions and each sends `agent_transitioned`.",
  table: table_agents,
  field: "state",
  initial: "creating",
  states: [
    { id: "creating", about: "Born with its Party pending and its create waiting for its carrier: the owner's approval or the Board." },
    { id: "active", about: "Its Safe is on chain with its key as the one signer and AgentOwner as module and guards; its handle routes money." },
    { id: "frozen", about: "AgentOwner is its Safe's one owner and keeps the key: the key signs nothing until it is unfrozen." },
    { id: "removed", about: "AgentOwner swept it and is its one owner for good: no key can sign for it again. Its handle stays taken.", terminal: true },
    { id: "failed", about: "Its create never landed as asked; its Party is released and its handle free again.", terminal: true },
  ],
  transitions: {
    create: {
      from: [],
      to: "creating",
      about: "`agents.changes.create`: the row, its Party and its create change, in one transaction.",
      guard: "A trimmed name; a free handle; a key of its own; the owner's Safe claimed, or the caller a Director of the owning Organization.",
      emits: A,
    },
    found: {
      from: [],
      to: "creating",
      about:
        "The Organization's hosted FDE, born when Capxul's FDE host has made its key for its Organization's setup (the " +
        "hosting's `provision`): its key is the host's (`host`), its Party is the one the setup registered, and its create " +
        "is the setup's install batch, not a change of its own (agents.fde).",
      emits: A,
    },
    activate: {
      from: ["creating"],
      to: "active",
      about:
        "Its create landed: the carrier's transaction holds AgentCreated naming its Safe, its owner's Safe and its key. For " +
        "the FDE the carrier is its Organization's install, and the setup's completion has activated its Party already.",
      guard: "In the same transaction its Party is activated (`parties.activate`), except the FDE's, which organizations activates.",
      emits: A,
    },
    fail: {
      from: ["creating"],
      to: "failed",
      about:
        "Its create change failed: declined, lapsed unsent, refused, reverted, rejected, or landed without its AgentCreated; " +
        "or, for the FDE, its Organization's setup failed.",
      guard: "In the same transaction its Party is released (`parties.release`), except the FDE's, which organizations releases.",
      emits: A,
    },
    freeze: {
      from: ["active"],
      to: "frozen",
      about: "A freeze landed: the carrier's transaction holds AgentFrozen for its Safe.",
      emits: A,
    },
    unfreeze: {
      from: ["frozen"],
      to: "active",
      about: "An unfreeze landed: the carrier's transaction holds AgentUnfrozen for its Safe.",
      emits: A,
    },
    remove: {
      from: ["active", "frozen"],
      to: "removed",
      about: "A removal landed: the carrier's transaction holds AgentRemoved for its Safe (organizations ends its Seats from that event).",
      emits: A,
    },
  },
  was: [AS_IS, `${OLD}/rules.ts:28`, `${OLD}/writes/rows.ts:209`, `${OLD}/writes/changes.ts:214`],
});

// ── agent changes ───────────────────────────────────────────────────────────────────────────

export const table_agent_changes = defineTable({
  id: "agent-changes",
  title: "Agent changes: one owner's change each, from its carrier to chain proof",
  about:
    "One row per change of an agent: its create, a freeze, an unfreeze, a key rotation, a sweep or a removal. It is " +
    "born `waiting` in the transaction that opens its carrier: the owner's approval from their own Safe " +
    "(`approvals.open`, the change as its subject), or a Board proposal from the company Safe when an Organization owns " +
    "the agent (`board.propose`). Its process (`agents.changes.carry`) then lands it or fails it on chain proof, and " +
    "only one change waits for an agent at a time. It keeps what the change asked for and what the chain made of it: a " +
    "rotation's retired key and new key (a create's key in `signer`), a sweep's recipient, the settlement assets a " +
    "sweep or removal names with the balance each held at preparation, what each AgentSwept moved, the transaction, and " +
    "why it failed. The calls and the summary are the carrier's (approvals or board), never copied here.",
  concept: concept_agents,
  tenancy: "owner",
  tenantField: "owner_id",
  scope: "The agent's owner, carried on the row (`owner_kind`, `owner_id`), never reached through the agent: no tenancy by join.",
  fields: Schema.Struct({
    owner_id: S,
    owner_kind: OwnerKind,
    change_id: S,
    agent_id: S,
    kind: ChangeKind,
    state: ChangeState,
    /** The principal who asked for it: the owner, or the Director who proposed it. */
    requested_by: S,
    carrier_kind: CarrierKind,
    /** The approval's id (`approval_…`) or the Board proposal's id. */
    carrier_id: S,
    /** A rotation's retired key; null for every other kind. */
    old_signer: NullOr(S),
    /** A create's key, or a rotation's new key; null for every other kind. */
    signer: NullOr(S),
    /** Where a create's or a rotation's key is kept, as its creator said; null for every other kind. */
    key_store: NullOr(KeyStore),
    /** A sweep's recipient; null for every other kind (a removal always sweeps to the owner's Safe). */
    recipient: NullOr(Recipient),
    /** A sweep's or a removal's settlement assets, as prepared; empty for every other kind. */
    assets: Schema.Array(NamedAsset),
    /** What each AgentSwept of a landed sweep or removal moved, one per asset that held anything. */
    swept: Schema.Array(Swept),
    transaction_hash: NullOr(S),
    block_number: NullOr(Schema.Int),
    failure: NullOr(ChangeFailure),
    created_at: Instant,
    ended_at: NullOr(Instant),
    updated_at: Instant,
  }),
  key: ["owner_id", "change_id"],
  indexes: [
    {
      name: "by-id",
      fields: ["change_id"],
      unique: true,
      crossTenant: true,
      for:
        "One change by its id: its process resuming on its carrier's `approval_transitioned` or `proposal_transitioned` " +
        "(which name the change as their subject), and the flows' live follow (row-level security still scopes it).",
    },
    {
      name: "by-agent-waiting",
      fields: ["owner_id", "agent_id"],
      unique: true,
      for:
        "Only one change waits for an agent at a time: unique among `waiting` rows, so a second freeze, unfreeze, " +
        "rotation, sweep or removal while one waits is WRONG_STATE.",
    },
    {
      name: "by-agent-created",
      fields: ["owner_id", "agent_id", "created_at", "change_id"],
      for: "An agent's newest change, which `agent show` and `agent list` report as its last change.",
    },
  ],
  retention: "Kept for good: the record of what each owner asked of their agent and what the chain did with it.",
  was: [AS_IS, `${TABLES}:230`, `${OLD}/writes/changes.ts:66`, `${OLD}/rules.ts:76`, `${OLD}/writes/settles.ts:55`],
});

export const event_agent_change_transitioned = defineEvent({
  id: "agent_change_transitioned",
  about:
    "A change of an agent was opened, landed or failed. `kind` says which change, so a landed sweep and a landed " +
    "rotation, which change no agent state, are proved here (the old `agent_transitioned` swept and key_rotated). A " +
    "failure carries its code. The runtime writes it to the outbox in the transition's transaction.",
  props: Schema.Struct({
    from: NullOr(ChangeState),
    to: ChangeState,
    transition: Schema.Literals(["open", "land", "fail"]),
    change_id: S,
    agent_id: S,
    kind: ChangeKind,
    owner_kind: OwnerKind,
    owner_id: S,
    failure_code: NullOr(S),
  }),
  was: ["docs/as-is/archive/shared/vocabulary.ts", `${OLD}/events.ts:48`],
});

const C = [event_agent_change_transitioned];

export const machine_agent_change = defineMachine({
  id: "agent-change",
  title: "Agent change: from its carrier to chain proof",
  about:
    "agent-changes.state. Born `waiting` with its carrier. Only its process ends it, from what its carrier became: a " +
    "carrier that landed is read on chain, and the change lands only when that transaction holds the AgentOwner event " +
    "it asked for, for this agent's Safe (and a rotation's new key, a sweep's tokens and recipient); else it fails as a " +
    "mismatch. A carrier that ended any other way fails it with that outcome. The old `sent` state, its noted hash and " +
    "its hand-back to `waiting` were the old send relay's: approvals owns the one send now.",
  table: table_agent_changes,
  field: "state",
  initial: "waiting",
  states: [
    { id: "waiting", about: "Its carrier is open: the owner's approval waits for a signature or the chain, or the Board proposal for its Directors." },
    { id: "landed", about: "Its carrier's transaction holds the AgentOwner event it asked for; the agent moved with it.", terminal: true },
    { id: "failed", about: "Its carrier ended without landing, or landed without its event; `failure` says how. The agent is as it was.", terminal: true },
  ],
  transitions: {
    open: {
      from: [],
      to: "waiting",
      about: "In the preparing rpc's transaction, with the carrier it opened (`approvals.open` or `board.propose`).",
      guard: "The agent admits the kind (create at birth; freeze from active; unfreeze from frozen; rotate from active; sweep and remove from active or frozen) and no other change waits for it.",
      emits: C,
    },
    land: {
      from: ["waiting"],
      to: "landed",
      about: "The carrier landed and its indexed transaction holds the expected AgentOwner event; the agent's transition, if any, commits with it.",
      emits: C,
    },
    fail: {
      from: ["waiting"],
      to: "failed",
      about: "The carrier ended without landing (declined, refused, expired, displaced, withdrawn, reverted, rejected), or landed without its event.",
      guard: "A failed create fails its agent and releases its Party in the same transaction.",
      emits: C,
    },
  },
  was: [AS_IS, `${OLD}/writes/changes.ts:134`, `${OLD}/writes/changes.ts:186`, `${OLD}/writes/settles.ts:55`],
});
