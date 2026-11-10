// The world's rpcs: make, list and read worlds, move a world's clock, save, list and restore its snapshots, and read its record. Each that acts asks the
// supervisor through the `devnet-control` integration, as the existing `dev time` and `dev snapshot` rpcs do; they are the same control protocol addressed by world
// (devnet.world-first-class). A world's id has no hyphen. Writes are the supervisor's; a person's grant decides what they may read.

import { Schema } from "effect";
import type { ErrorRecord } from "../../../packages/book/src/index.ts";
import { concept_devnet } from "../shared/foundation.ts";
import { integration_devnet_control } from "../shared/external.ts";
import { error_NOT_AUTHENTICATED, error_ROLE_PERMISSION_DENIED, error_INVALID_INPUT } from "../shared/vocabulary.ts";
import { integration_site_service } from "../plugs/integrations.ts";
import { rpc } from "../plugs/kit.ts";
import {
  ClockMode, machine_world, table_command_records, table_world_registrations, table_world_snapshots, table_worlds, WorldKind, WorldState,
} from "./world-data.ts";

const S = Schema.String;
const N = Schema.Number;
const Null = Schema.NullOr;
const B = Schema.Boolean;
const NOTE = "docs/mission/worlds.md";
const WHO_OWNER = "The world's owner: on a local devnet anyone on the machine; on a hosted world the holder of an owner grant.";
const WHO_READ = "Anyone with a grant in the world (owner, player or viewer); on a local devnet anyone on the machine.";

/** The errors a call of the control protocol fails with, so the rpc declares each (rule call-error-not-declared). */
const errorsOf = (call: keyof typeof integration_devnet_control.calls, more: readonly ErrorRecord[] = []): ErrorRecord[] => {
  const seen = new Map<string, ErrorRecord>();
  for (const f of integration_devnet_control.calls[call].failures as readonly { error: ErrorRecord }[]) seen.set(f.error.id, f.error);
  for (const e of [error_NOT_AUTHENTICATED, error_ROLE_PERMISSION_DENIED, ...more]) seen.set(e.id, e);
  return [...seen.values()];
};

export const WorldView = Schema.Struct({
  worldId: S, name: S, kind: WorldKind, state: WorldState, clockMode: ClockMode, rate: N, worldNow: N, epoch: N, chainId: N, hosted: B,
  parentWorld: Null(S), parentSnapshot: Null(S), parentSeq: Null(N), companies: Schema.Array(Schema.Struct({ orgId: S, name: S, url: Null(S) })), recordHead: N,
});
export const SnapshotView = Schema.Struct({ name: S, worldId: S, epoch: N, recordSeq: N, clockMode: ClockMode, rate: N, worldNow: N, template: B, createdAt: N, sites: N });
export const EntryView = Schema.Struct({
  worldId: S, epoch: N, seq: N, kind: S, worldTime: N, realTime: N, who: S, hats: Schema.Array(S), surface: S, traceId: S, command: Null(S), outcome: S, code: Null(S), causeSeq: Null(N), branchAbandoned: B,
});

export const rpc_devnet_worlds_create = rpc({
  id: "devnet.worlds.create",
  title: "Make a whole world",
  about:
    "Asks for a world: an id (no hyphen), a name, a kind, an optional template, and a clock (frozen or running, a rate of 1 to 60). It writes the world creating and the `born` entry, and its creation process asks the supervisor to make the chain, the service, the " +
    "clock, the record and the stand-ins. A world with a template restores the template's chain state and one site backup per company under the new addresses; without one it deploys the contracts (25 s in the old product). Companies are made after, with `org create --world`.",
  concept: concept_devnet,
  kind: "mutation",
  who: "Anyone on a local devnet's machine; on the hosted service, a signed-in person with a world quota (assumption: the quota is not designed).",
  input: Schema.Struct({ worldId: S, name: S, kind: WorldKind, template: Null(S), clock: ClockMode, rate: N }),
  output: Schema.Struct({ worldId: S, state: Schema.Literal("creating") }),
  errors: errorsOf("worldCreate", [error_INVALID_INPUT]),
  reads: [table_worlds],
  writes: [table_worlds, table_command_records],
  drives: [machine_world.t.create],
  was: [`${NOTE} (section 4)`],
});

export const rpc_devnet_worlds_list = rpc({
  id: "devnet.worlds.list",
  title: "List the worlds",
  about: "The worlds on this machine and, when this one is registered, the hosted service's: id, name, kind, clock mode and rate, world now, companies, epoch and state.",
  concept: concept_devnet, kind: "query", who: WHO_READ,
  input: Schema.Struct({ hostedToo: B }), output: Schema.Struct({ worlds: Schema.Array(WorldView) }),
  errors: [error_NOT_AUTHENTICATED], reads: [table_worlds, table_world_registrations], was: [`${NOTE}`],
});

export const rpc_devnet_worlds_show = rpc({
  id: "devnet.worlds.show",
  title: "Read one world",
  about: "One world with its companies and their addresses, its clock and rate, its parent world, snapshot and sequence, and the head of its record. It reads the rows, so it answers while the chain is stopped.",
  concept: concept_devnet, kind: "query", who: WHO_READ,
  input: Schema.Struct({ world: S }), output: WorldView,
  errors: [error_NOT_AUTHENTICATED, error_INVALID_INPUT], reads: [table_worlds, table_command_records], was: [`${NOTE}`],
});

const clockRpc = (verb: "set" | "freeze" | "resume" | "warp", call: "timeRate" | "timeFreeze" | "timeResume" | "timeWarp", title: string, about: string, input: Schema.Struct<Schema.Struct.Fields>) =>
  rpc({
    id: `devnet.worlds.clock-${verb}`, title, about,
    concept: concept_devnet, kind: "action", who: WHO_OWNER, input, output: Schema.Struct({ worldId: S, clockMode: ClockMode, rate: N, worldNow: N }),
    errors: errorsOf(call, [error_INVALID_INPUT]), reads: [table_worlds], writes: [table_worlds, table_command_records], calls: [integration_devnet_control.c[call]], was: [`${NOTE} (section 2)`],
  });

export const rpc_devnet_worlds_clock_set = clockRpc("set", "timeRate", "Set the world's clock running at a rate",
  "Runs the world's clock at a rate of world seconds per real second, 1 to 60 (devnet.clock-rate; the bound is the coordinator's, accepted on Aaron's delegation, and the owner has not ruled on it). The chain, the service and every company's site follow (devnet.site-follows-world).",
  Schema.Struct({ world: S, rate: N }));
export const rpc_devnet_worlds_clock_freeze = clockRpc("freeze", "timeFreeze", "Freeze the world's clock",
  "Stops the clock at the world's now. A frozen world moves only by warp or step, which is how a long history runs deterministically: 22 months in minutes of wall time, speed being commands per minute, not clock rate.",
  Schema.Struct({ world: S }));
export const rpc_devnet_worlds_clock_resume = clockRpc("resume", "timeResume", "Resume a frozen clock at its rate",
  "Starts a frozen clock again at the rate it had; the sites and the chain follow from the world's now.", Schema.Struct({ world: S }));
export const rpc_devnet_worlds_clock_warp = clockRpc("warp", "timeWarp", "Move the world's clock forward to a time",
  "Moves the world's clock forward by a duration or to a date, stopping at every due instant on the way (the warp barrier), mining empty blocks to depth, running due jobs and moving every follower, the company sites included. A time before now is refused.",
  Schema.Struct({ world: S, by: Null(S), to: Null(S) }));

export const rpc_devnet_worlds_snapshot_save = rpc({
  id: "devnet.worlds.snapshot-save",
  title: "Save a snapshot of a whole world",
  about:
    "Saves the world's chain, service state, every company's site, the clock and the place in the record under a name. On the save event each stateful follower saves its own state, including each site's database and files (devnet.stateful-followers). " +
    "A name taken is WRONG_STATE unless `replace` is asked. Assumption, not yet tested: a site's backup (docs/mission/worlds.md: not yet measured).",
  concept: concept_devnet, kind: "action", who: WHO_OWNER, input: Schema.Struct({ world: S, name: S, replace: B, template: B }), output: SnapshotView,
  errors: errorsOf("snapshotSave", [error_INVALID_INPUT]), reads: [table_worlds], writes: [table_world_snapshots, table_command_records], calls: [integration_devnet_control.c.snapshotSave, integration_site_service.c.saveSnapshot],
  budget: { class: "background", p50Ms: 20_000, p95Ms: 60_000, why: "A snapshot saves a chain and a site backup per company: 0.2 to 0.4 GiB (estimate, not measured)." }, was: [`${NOTE} (section 6, 6)`],
});
export const rpc_devnet_worlds_snapshot_list = rpc({
  id: "devnet.worlds.snapshot-list", title: "List a world's snapshots",
  about: "A world's snapshots, newest first, with the epoch and sequence each was taken at and whether it is a template.",
  concept: concept_devnet, kind: "query", who: WHO_READ, input: Schema.Struct({ world: S }), output: Schema.Struct({ snapshots: Schema.Array(SnapshotView) }),
  errors: [error_NOT_AUTHENTICATED, error_INVALID_INPUT], reads: [table_world_snapshots, table_worlds], was: [`${NOTE}`],
});
export const rpc_devnet_worlds_snapshot_restore = rpc({
  id: "devnet.worlds.snapshot-restore",
  title: "Restore a snapshot, in place or into a separate world",
  about:
    "In place: the world's clock freezes, the snapshot is restored, the epoch goes up, a `restore` entry is appended and the abandoned branch stays in the record, flagged. With `--as <new world>`: a separate world is made, keeping the chain id and using a new chain instance, " +
    "every site's address, world name and secret, the sign-in addresses, ports, token, mail addresses and database names renamed, and the new record's `born` entry names the parent world, snapshot and sequence. The old world is untouched. Grants stay outside the snapshot.",
  concept: concept_devnet, kind: "action", who: WHO_OWNER, input: Schema.Struct({ world: S, name: S, as: Null(S) }), output: WorldView,
  errors: errorsOf("restoreAs", [error_INVALID_INPUT]).concat(errorsOf("snapshotRestore")).filter((e, i, a) => a.findIndex((x) => x.id === e.id) === i),
  reads: [table_world_snapshots, table_worlds], writes: [table_worlds, table_command_records], drives: [machine_world.t.restore],
  calls: [integration_devnet_control.c.snapshotRestore, integration_devnet_control.c.restoreAs, integration_site_service.c.restoreSnapshot],
  budget: { class: "background", p50Ms: 30_000, p95Ms: 90_000, why: "A restore replaces a chain and every company's site; 90 s p95 is the estimate for a four-company world (not measured)." }, was: [`${NOTE} (section 6, 4)`],
});

export const rpc_devnet_records_list = rpc({
  id: "devnet.records.list", title: "List the world's record",
  about: "The world's entries in sequence order, filtered by who, kind, a world-time range or a trace. It lists entries; `record show` reads one in full. An abandoned branch is listed only when asked.",
  concept: concept_devnet, kind: "query", who: WHO_READ,
  input: Schema.Struct({ world: S, who: Null(S), kind: Null(S), from: Null(N), to: Null(N), trace: Null(S), includeAbandoned: B, limit: N }), output: Schema.Struct({ entries: Schema.Array(EntryView) }),
  errors: [error_NOT_AUTHENTICATED, error_ROLE_PERMISSION_DENIED, error_INVALID_INPUT], reads: [table_command_records, table_worlds], was: [`${NOTE} (section 6, 5)`],
});
export const rpc_devnet_records_show = rpc({
  id: "devnet.records.show", title: "Read one entry of the record in full",
  about: "One entry with its redacted arguments, what it returned, what it changed, its pointers and its cause. Hidden reasoning appears only when the run was flagged to keep it. No key, token, secret or password is ever in an entry.",
  concept: concept_devnet, kind: "query", who: WHO_READ, input: Schema.Struct({ world: S, epoch: N, seq: N }),
  output: Schema.Struct({ entry: EntryView, args: Null(S), returned: Null(S), changed: Null(S), pointers: Null(S) }),
  errors: [error_NOT_AUTHENTICATED, error_ROLE_PERMISSION_DENIED, error_INVALID_INPUT], reads: [table_command_records], was: [`${NOTE} (section 6, 5)`],
});
export const rpc_devnet_records_export = rpc({
  id: "devnet.records.export", title: "Export the world's record as lines of JSON",
  about: "Every entry of a world, or of a range, as newline-delimited JSON for training and analysis, with the lineage (parent world, snapshot, sequence) in the first line. The same redaction applies; an export of a real customer's world needs the consent rule (assumption: not designed).",
  concept: concept_devnet, kind: "query", who: WHO_OWNER, input: Schema.Struct({ world: S, from: Null(N), to: Null(N) }),
  output: Schema.Struct({ lines: N, bytes: N, lineage: Schema.Struct({ parentWorld: Null(S), parentSnapshot: Null(S), parentSeq: Null(N) }) }),
  errors: [error_NOT_AUTHENTICATED, error_ROLE_PERMISSION_DENIED, error_INVALID_INPUT], reads: [table_command_records, table_worlds],
  budget: { class: "read", p50Ms: 600, p95Ms: 1200 }, was: [`${NOTE} (section 6, 5)`],
});

export const rpc_devnet_worlds_register = rpc({
  id: "devnet.worlds.register",
  title: "Register a local devnet's world with the hosted site service",
  about:
    "A local devnet's service cannot be reached by the hosted bench, and every call goes from the service to a site (plugs.service-calls-site), so the world registers: the hosted service issues a world id, a secret (shown once) and a name, and the world's companies' sites are created " +
    "on the hosted bench. Idle sites are parked after a stated time. A core-only world, with no sites, is the offline fallback. Assumption, not yet tested.",
  concept: concept_devnet, kind: "action", who: WHO_OWNER, input: Schema.Struct({ world: S, name: S }),
  output: Schema.Struct({ worldId: S, name: S, secret: S }),
  errors: [error_NOT_AUTHENTICATED, error_ROLE_PERMISSION_DENIED, error_INVALID_INPUT, ...integration_site_service.calls.registerWorld.failures.map((f) => f.error)],
  reads: [table_worlds], writes: [table_world_registrations, table_worlds], calls: [integration_site_service.c.registerWorld], was: ["books/target/plugs/decisions.ts (plugs.service-calls-site)"],
});
