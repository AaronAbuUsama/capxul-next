// The world, made first-class (docs/mission/worlds.md, accepted by the coordinator on Aaron's delegation). A WORLD is one chain with every company on it,
// one clock and one record; it is never one company. A company (an Organization) lives in exactly one world. The clock, the record and snapshots belong to
// the world. Kinds: a local devnet (one developer, one machine), and simulated worlds, each with its own companies and clock speed (real time or faster, a
// rate of 1 to 60), or stepped (frozen, moving only by warp or step). Making a whole world is as easy as making a company: `world create`. These records
// reshape the devnet's existing supervisor, clock and snapshot design (devnet.supervisor-owns-time-and-worlds, devnet.clock-rate, devnet.stateful-followers)
// to the hosted-site model; they do not run beside it. What the research note left open is marked as an assumption in each record, unless the spike has since answered it (spikes/skeleton/FINDINGS.md, Worlds and snapshots).

import { Schema } from "effect";
import { defineEvent, defineMachine, defineTable } from "../../packages/blueprint-engine/src/index.ts";
import { concept_devnet } from "../shared/foundation.ts";

const NOTE = "docs/mission/worlds.md";
const S = Schema.String;
const N = Schema.Number;
const Null = Schema.NullOr;
const B = Schema.Boolean;

export const WorldKind = Schema.Literals(["local", "simulated", "staging", "production"]);
/** `core`: chain, lean service and record, no company sites. `full`: also one Frappe site per company on the shared bench. Staging and production are always full. */
export const WorldProfile = Schema.Literals(["core", "full"]);
export const ClockMode = Schema.Literals(["frozen", "running"]);
export const WorldState = Schema.Literals(["creating", "running", "stopped", "restoring", "parked", "closed"]);

export const table_worlds = defineTable({
  id: "worlds",
  title: "Worlds: a chain, its companies, one clock and one record",
  about:
    "One row per world on this machine (and per hosted world the service knows): its id (lower-case letters and digits, no hyphen, at most 12, because a site's address is " +
    "`<company>-<world>.<base>`, a single label under one wildcard certificate), its name, its kind (local, simulated, staging or production), its chain id and the instance serving it, its clock " +
    "(mode frozen or running, rate 1 to 60, the world's now), its profile (core or full) and its service address (`core-<world>.<base>`), its epoch (bumped by an in-place restore), its parent world, snapshot and sequence when it was restored into a separate " +
    "world, and whether it is registered with the hosted service. A company is bound to one world at `org create --world`. Seasons are an optional schedule on a world, deferred, not removed " +
    "(devnet.seasons-on-a-world).",
  was: [`${NOTE} (sections 1, 3 and 4)`],
  concept: concept_devnet,
  tenancy: "global",
  scope: "A world is the system's, not any company's: the supervisor writes it.",
  fields: Schema.Struct({
    world_id: S, name: S, kind: WorldKind, profile: WorldProfile, address: Null(S), template: Null(S), chain_id: N, chain_instance: S, clock_mode: ClockMode, rate: N, world_now: N, epoch: N,
    parent_world: Null(S), parent_snapshot: Null(S), parent_seq: Null(N), hosted: B, state: WorldState, created_at: N, updated_at: N,
  }),
  key: ["world_id"],
  indexes: [{ name: "worlds-by-name", fields: ["name"], unique: true, for: "`world show <name>` and the hosted registration find a world by its name." }],
  retention: "Kept for ever: a closed world stays listed and its record stays readable.",
});

export const table_world_snapshots = defineTable({
  id: "world-snapshots",
  title: "World snapshots: a saved version of a whole world",
  about:
    "One row per saved snapshot: the world, its name, the epoch and the record's sequence it was taken at, a reference to the chain's saved state, one site backup per company, the people's and agents' keys' references " +
    "(never the keys), the clock's mode, rate and now, and the backend code it was saved with. A snapshot is restored in place (new epoch) or into a separate world (`--as`, a new chain instance with the same chain id). A snapshot meant to be " +
    "copied into new worlds is a template: the same row plus a manifest (docs/mission/worlds.md, section 4).",
  was: [`${NOTE} (sections 4 and 6, 4)`, "blueprint/devnet/flows.ts (the snapshot flows)"],
  concept: concept_devnet,
  tenancy: "global",
  scope: "Written by the supervisor for a world; no company owns it.",
  fields: Schema.Struct({
    world_id: S, name: S, epoch: N, record_seq: N, chain_state_ref: S, site_backups: Schema.Array(Schema.Struct({ org_id: S, backup_ref: S })), clock_mode: ClockMode, rate: N, world_now: N, code_version: S, template: B, created_at: N,
  }),
  key: ["world_id", "name"],
  indexes: [{ name: "world-snapshots-by-created", fields: ["world_id", "created_at"], for: "`world snapshot list`: a world's snapshots, newest first." }],
  retention: "Kept until deleted by the world's owner; 0.2 to 0.4 GiB each (estimate).",
});

export const table_command_records = defineTable({
  id: "command-records",
  title: "The world's record: one wide entry for everything that happens",
  about:
    "One row per entry, as the spike writes it (schema 1, spikes/skeleton/FINDINGS.md, The recorder; one append-only JSON Lines file per world, one entry per command, written by the one entry point so none can be skipped): " +
    "`seq` and `prev` (the sha-256 of the previous line, so tampering shows and an export checks the chain); `v`, `id` and `trace`; the `command` with its `args` (positional and flags); the `actor` (email, address and the hats read from the chain at the start of the command); " +
    "`world`, `org` and `site`; `world_time`, `world_time_end` and `real_time`, so a moved clock shows; `duration_ms`; `outcome` (ok, refused or failed) with `error` (code, reason, detail); `result` (replaced by its size and head above 30 KB); and `changes` (the transactions sent, each with its hash, and the documents changed). " +
    "The join to the chain's own logs is the transaction hash, not the trace id; the trace id is stamped on every document written (a Comment) and on every ledger row (`GL Entry.capxul_trace`). An in-place or separate restore appends a `world snapshot restore` entry with `lineage` (snapshot, from-world, from-record count and head, saved-at world time); the record is never rewound. " +
    "Designed beyond schema 1, null until built: the run id, model and policy version of an agent, the surface, the cause (the entry that triggered it), the epoch and an abandoned branch's flag. Never recorded: any value under a key that looks like a secret, and every secret the process holds by value (the shared secret, every key, with and without 0x); a last check refuses to write a line that still holds one. " +
    "Not redacted yet: personal data in a result (it holds documents). Training data and a product of the system, not a debugging aid (critical-path.md, Priorities).",
  was: [`${NOTE} (section 6, 5)`, "docs/mission/critical-path.md (Priorities: everything is recorded)", "spikes/skeleton/FINDINGS.md (The recorder: the shape of one record)"],
  concept: concept_devnet,
  tenancy: "global",
  scope: "The world's own; a person reads the entries of a world they have a grant in.",
  fields: Schema.Struct({
    world_id: S, epoch: N, seq: N, prev: S, v: N, id: S, trace_id: S,
    kind: Schema.Literals(["command", "tool-call", "reply", "born", "restore", "clock", "event", "join", "handover", "score"]),
    command: Null(S), args: S, actor_email: Null(S), actor_address: Null(S), actor_hats: Schema.Array(S), who_kind: Schema.Literals(["person", "agent", "system"]),
    org_id: Null(S), site: Null(S), world_time: S, world_time_end: S, real_time: S, duration_ms: N,
    outcome: Schema.Literals(["ok", "refused", "failed"]), error_code: Null(S), error_reason: Null(S), error_detail: Null(S), result: Null(S), changes: Null(S),
    run_id: Null(S), model: Null(S), policy_version: Null(S), surface: Null(Schema.Literals(["cli", "sdk", "mcp", "http", "workflow"])), cause_seq: Null(N), branch_abandoned: B,
  }),
  key: ["world_id", "epoch", "seq"],
  indexes: [
    { name: "command-records-by-who", fields: ["world_id", "actor_email", "world_time"], for: "`record list --who`: one person's or agent's entries in world time order." },
    { name: "command-records-by-trace", fields: ["world_id", "trace_id"], for: "`record show` and an eval read every entry of one trace." },
  ],
  retention: "Kept for ever, with the world; an upload from a local devnet is optional and consented.",
});

export const table_world_registrations = defineTable({
  id: "world-registrations",
  title: "World registrations: a local devnet registered with the hosted service",
  about:
    "One row per world registered with the hosted site service: the id and name issued, the hash of its secret (shown once), when it registered, when it was last seen and when its idle sites were parked. Because every call goes from the " +
    "service to a site (plugs.service-calls-site), a local devnet whose service a hosted bench cannot reach registers instead of being reached: its companies' sites are created on the hosted bench and parked when idle (30 minutes, an assumption the first hosted-world eval measures). " +
    "A core-only world, with no sites, is the offline fallback.",
  was: ["blueprint/plugs/decisions.ts (plugs.service-calls-site)"],
  concept: concept_devnet,
  tenancy: "global",
  scope: "The hosted service's own.",
  fields: Schema.Struct({ world_id: S, name: S, secret_hash: S, registered_at: N, last_seen_at: N, parked_at: Null(N) }),
  key: ["world_id"],
  indexes: [{ name: "world-registrations-by-name", fields: ["name"], unique: true, for: "A registration finds an existing name." }],
  retention: "Kept while the world exists.",
});

export const event_world_transitioned = defineEvent({
  id: "world_transitioned",
  about:
    "A world changed state: began creating, started, stopped, resumed, began restoring, finished restoring, was parked for being idle or closed. Carries the world id, its kind, the new state and the epoch; never a company, an address or a key.",
  props: Schema.Struct({
    from: Null(WorldState), to: WorldState,
    transition: Schema.Literals(["create", "start", "stop", "resume", "restore", "restored", "park", "close"]),
    world_id: S, kind: WorldKind, epoch: N,
  }),
  was: [`${NOTE}`],
});

const WE = [event_world_transitioned];
export const machine_world = defineMachine({
  id: "world",
  title: "A world: creating, running, stopped, restoring, parked or closed",
  about:
    "worlds.state. Born creating by `world create`; it starts when its chain, service, clock and record are up. A running world can be stopped and resumed, restored in place (restoring, then running again with a new epoch) or parked " +
    "when idle (hosted worlds only). A closed world is never run again; its record stays. The clock's mode and rate are columns of the row, not states: a frozen world is running.",
  table: table_worlds,
  field: "state",
  initial: "creating",
  states: [
    { id: "creating", about: "The supervisor is making the chain, the service and the clock." },
    { id: "running", about: "The world is up; its clock is frozen or running." },
    { id: "stopped", about: "Down; its state is kept." },
    { id: "restoring", about: "A snapshot is being restored in place." },
    { id: "parked", about: "Idle: the hosted bench stopped serving its sites; data kept." },
    { id: "closed", about: "Closed for good; the record stays readable.", terminal: true },
  ],
  transitions: {
    create: { from: [], to: "creating", about: "The birth: `world create` (devnet.worlds.create).", emits: WE },
    start: { from: ["creating"], to: "running", about: "Chain, service, clock and record are up.", emits: WE },
    stop: { from: ["running"], to: "stopped", about: "The world is taken down.", emits: WE },
    resume: { from: ["stopped", "parked"], to: "running", about: "The world is brought back, or a call wakes a parked one.", emits: WE },
    restore: { from: ["running"], to: "restoring", about: "`world snapshot restore` in place: the clock freezes at the world's now meanwhile.", emits: WE },
    restored: { from: ["restoring"], to: "running", about: "The snapshot is restored; the epoch is one higher.", emits: WE },
    park: { from: ["running"], to: "parked", about: "A hosted world idle past the stated time (devnet.worlds.park-idle).", emits: WE },
    close: { from: ["stopped", "parked"], to: "closed", about: "The world is destroyed: its chain, sites and snapshots are removed and its record stays (`world destroy`).", emits: WE },
  },
  was: [`${NOTE} (section 4)`],
});
