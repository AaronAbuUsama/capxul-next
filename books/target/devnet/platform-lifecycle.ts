// A world's life and how a person connects to it: `world pause|park|resume|destroy`, `world use` and `world current`, and `world approve` (the platform owner's one-time approval for production).
// Written beside ./world-ops.ts, which holds create, list, show, the clock and the snapshots. The words and numbers are explained in docs/design/worlds-platform.md.

import { error_CAPACITY_REACHED, error_INVALID_INPUT, error_NOT_AUTHENTICATED, error_ROLE_PERMISSION_DENIED, error_WRONG_ENVIRONMENT, error_WRONG_STATE } from "../shared/vocabulary.ts";
import { ok, refused } from "../shared/examples.ts";
import { machine_world, table_command_records, table_worlds } from "./world-data.ts";
import { table_world_grants } from "./platform-data.ts";
import { addressOf, ADDR, B, BASE, make, ms, N, Null, S, ConnectionView, siteOf } from "./platform-kit.ts";
import { Schema } from "effect";

const ORGANISER = "An organiser of the world: on a local devnet anyone on the machine; on a hosted world the holder of an organiser grant.";
const ANY = "Anyone with a grant in the world; on a local devnet anyone on the machine.";
const OWNER = "The platform owner only (the key the worlds service is configured to trust for production).";
const W = { running: "world-running-fast", frozen: "world-frozen", parked: "world-parked-full", prod: "world-production", member: "org-with-member", out: "signed-out", empty: "empty-devnet", saved: "world-with-snapshot" } as const;
const NOT_ORG = { error: error_ROLE_PERMISSION_DENIED, given: W.member, when: "A player or viewer, not an organiser, tries it; nothing changes." } as const;
const NO_WORLD = { error: error_INVALID_INPUT, given: W.empty, when: "No world has that name." } as const;
const OUT = { error: error_NOT_AUTHENTICATED, given: W.out, when: "No one is signed in on this machine." } as const;
const noWorld = (cmd: string) => refused("No world has that name", cmd, error_INVALID_INPUT, { field: "world", name: "tow" });
const notOrg = (cmd: string) => refused("Priya is a player, not an organiser", cmd, error_ROLE_PERMISSION_DENIED);
const state = (s: string, over: Record<string, unknown> = {}) => ({ worldId: "town", state: s, parked: false, ...over });
const WorldState = Schema.Struct({ worldId: S, state: Schema.Literals(["creating", "running", "stopped", "restoring", "parked", "closed"]), parked: B });

const pause = make({
  id: "world.pause", command: "world pause", title: "Pause a world", rpc: "devnet.worlds.pause", kind: "action", priority: "critical", cls: "write", p95Ms: 15_000,
  about: "Stops a world's chain, service and clock where they are and keeps everything in memory-free form on disk: nothing moves and nothing is lost. A run's world paused pauses the run. A paused world still costs its disk and, in a `full` world, its sites' database share, and no memory. The nightly backup also pauses a world for seconds to copy it consistently.",
  who: ORGANISER, changes: "The world becomes stopped; its clock is frozen at the world's now; a `clock` entry is written to the record.",
  input: Schema.Struct({ world: S }), output: WorldState, reads: [table_worlds], writes: [table_worlds, table_command_records], drives: [machine_world.t.stop],
  claims: [{ claim: "A paused world does not move and loses nothing.", observes: `cli: in \`${W.running}\`, \`world pause town\` then after a real minute \`world show town\` prints the same worldNow; \`world resume town\` and the diff of the record and of every company's documents against before the pause is empty.` }],
  refusals: [OUT, NO_WORLD, NOT_ORG, { error: error_WRONG_ENVIRONMENT, given: W.prod, when: "The world is staging or production: they have no pause verb." }],
  examples: [ok("Pause the world", "capxul world pause town --json", state("stopped")), noWorld("capxul world pause tow --json"), notOrg("capxul world pause town --json"),
    refused("Production has no pause", "capxul world pause live --json", error_WRONG_ENVIRONMENT, {})],
});
export const rpc_devnet_worlds_pause = pause.rpc;
export const operation_world_pause = pause.op;

const park = make({
  id: "world.park", command: "world park", title: "Park a world: storage only", rpc: "devnet.worlds.park", kind: "action", priority: "critical", cls: "background", p95Ms: 90_000,
  about: "Saves a world and takes it down to storage: the chain's state file, the service's database, the record and, in a `full` world, each company's site as a backup, then drops the sites from the bench. A parked world costs disk only. It is restored on demand: `world resume`, or the first call to its address (the gateway wakes it). Waking a `core` world is seconds (estimate); a `full` world is about 33 seconds per company (measured, the spike's site restore). Idle hosted worlds are parked by the park-idle process.",
  who: ORGANISER, changes: "The world becomes parked; its sites are backed up and dropped; the record is closed at its head.",
  input: Schema.Struct({ world: S }), output: WorldState, reads: [table_worlds], writes: [table_worlds, table_command_records], drives: [machine_world.t.park],
  claims: [{ claim: "A parked world costs storage only and comes back exactly as it was.", observes: `cli: \`world park town\` then \`world show town\` prints parked and no company site answers; \`world resume town\` restores it and every document, ledger balance and the record head equal their values before the park.` }],
  refusals: [OUT, NO_WORLD, NOT_ORG, { error: error_WRONG_STATE, given: W.parked, when: "The world is already parked or is closed." }],
  examples: [ok("Park the world", "capxul world park town --json", state("parked", { parked: true })), noWorld("capxul world park tow --json"), refused("Already parked", "capxul world park town --json", error_WRONG_STATE, { state: "parked" })],
});
export const rpc_devnet_worlds_park = park.rpc;
export const operation_world_park = park.op;

const resume = make({
  id: "world.resume", command: "world resume", title: "Resume a paused or parked world", rpc: "devnet.worlds.resume", kind: "action", priority: "critical", cls: "background", p95Ms: 90_000,
  about: "Brings a paused world back where it stopped, or restores a parked one from storage. The clock continues from the world's now at the rate it had (a frozen clock stays frozen). A call to a parked world's address does this by itself.",
  who: ORGANISER + " A call by any member to a parked world's address also wakes it.", changes: "The world becomes running; a parked world's sites are restored on the bench.",
  input: Schema.Struct({ world: S }), output: WorldState, reads: [table_worlds], writes: [table_worlds, table_command_records], drives: [machine_world.t.resume],
  claims: [{ claim: "A resumed world continues from the world's now.", observes: `cli: in \`${W.parked}\`, \`world resume town\` then \`world show town\` prints running and the worldNow it had when parked.` }, { claim: "A world is refused when the machine has no room for it.", observes: `cli: with the machine full, \`world resume town\` exits CAPACITY_REACHED and the world stays parked.` }],
  refusals: [OUT, NO_WORLD, NOT_ORG, { error: error_WRONG_STATE, given: W.running, when: "The world is already running." }, { error: error_CAPACITY_REACHED, given: W.parked, when: "The machine has no room to run it now." }],
  examples: [ok("Resume a parked world", "capxul world resume town --json", state("running")), refused("No room", "capxul world resume town --json", error_CAPACITY_REACHED, {}), refused("Already running", "capxul world resume town --json", error_WRONG_STATE, { state: "running" })],
});
export const rpc_devnet_worlds_resume = resume.rpc;
export const operation_world_resume = resume.op;

const destroy = make({
  id: "world.destroy", command: "world destroy", title: "Destroy a world", rpc: "devnet.worlds.destroy", kind: "action", priority: "normal", cls: "background", p95Ms: 120_000,
  about: "Removes a stopped or parked world: its chain, service database, sites (about a minute each to drop, measured) and snapshots. Its record stays, closed, and so does an accepted dataset. A run whose dataset is neither accepted nor rejected is refused, so data is never lost by a mistake (`--discard-data` overrides). Production is destroyed only with the platform owner's one-time approval.",
  who: ORGANISER + " Production: only with the platform owner's approval.", changes: "The world becomes closed; its chain, sites and snapshots are removed.",
  input: Schema.Struct({ world: S, discardData: B, ownerApproval: Null(S) }), output: WorldState, reads: [table_worlds], writes: [table_worlds, table_command_records], drives: [machine_world.t.close],
  claims: [{ claim: "A destroyed world is gone and its record stays.", observes: `cli: \`world pause town\`, \`world destroy town\` then \`world show town\` prints closed, no company answers and \`record list --world town\` still lists every entry.` },
    { claim: "Production is never destroyed without the platform owner's approval, and a run's unexported data is never destroyed by accident.", observes: `cli: \`world destroy live\` exits ROLE_PERMISSION_DENIED; \`world destroy r00042\` on a closed run with no accepted dataset exits WRONG_STATE.` }],
  refusals: [OUT, NO_WORLD, NOT_ORG, { error: error_WRONG_STATE, given: W.running, when: "The world is running (pause it first), or its run's dataset is neither accepted nor rejected." }, { error: error_ROLE_PERMISSION_DENIED, given: W.prod, when: "Production without the platform owner's approval." }],
  examples: [ok("Destroy a paused world", "capxul world destroy town --json", state("closed")), refused("The world is running", "capxul world destroy town --json", error_WRONG_STATE, { state: "running" }),
    refused("Production without the owner's approval", "capxul world destroy live --json", error_ROLE_PERMISSION_DENIED)],
});
export const rpc_devnet_worlds_destroy = destroy.rpc;
export const operation_world_destroy = destroy.op;

const use = make({
  id: "world.use", command: "world use", title: "Connect to a world and make it the current one", rpc: "devnet.worlds.connect", kind: "action", priority: "critical", cls: "write", p95Ms: 3_000,
  about: "One CLI, many worlds. `world use <world>` signs a challenge with the caller's key, checks the grant, and stores a connection in the CLI's home: the world's address, the caller's key (a reference, never the key itself) and the grant's role. Every later command goes to that world's service. A flag `--world <name>` or the variable `CAPXUL_WORLD` overrides it for one command. A local devnet is a world whose address is on the laptop (`--address http://127.0.0.1:<port>`).",
  who: ANY, changes: "The CLI's stored connection (on the caller's machine); the service issues a short session and writes nothing else.",
  input: Schema.Struct({ world: S, address: Null(S) }), output: ConnectionView, reads: [table_worlds, table_world_grants],
  claims: [{ claim: "After `world use`, every command goes to that world, and a command for another world is addressed by flag or variable only.", observes: `cli: \`world use r00042\` then \`world current\` prints r00042; \`record list\` lists r00042's record; \`record list --world town\` lists town's; \`CAPXUL_WORLD=town record list\` lists town's.` },
    { claim: "A key with no grant in the world cannot connect.", observes: `cli: as a stranger, \`world use r00042\` exits ROLE_PERMISSION_DENIED and stores nothing.` }],
  refusals: [OUT, NO_WORLD, { error: error_ROLE_PERMISSION_DENIED, given: W.member, when: "The key has no grant in that world (or it was revoked)." }],
  examples: [ok("Connect to a run's world", "capxul world use r00042 --json", { worldId: "r00042", address: addressOf("r00042"), siteSuffix: `-r00042.${BASE}`, keyAddress: ADDR.tester1, role: "player", seat: "bc-finance", expiresAt: ms("2026-12-01T17:00:00Z") }),
    refused("No grant in that world", "capxul world use r00042 --json", error_ROLE_PERMISSION_DENIED), noWorld("capxul world use tow --json")],
});
export const rpc_devnet_worlds_connect = use.rpc;
export const operation_world_use = use.op;

const current = make({
  id: "world.current", command: "world current", title: "Show the world the CLI is connected to", rpc: "devnet.worlds.current", kind: "query", priority: "normal", cls: "read",
  about: "The current connection: the world, its address, the caller's key address and role, the seat, and how the world was chosen (flag, variable or `world use`). Reads the CLI's home and asks the service once.",
  who: ANY, changes: "Nothing: it only reads.", input: Schema.Struct({}), output: Schema.Struct({ connection: Null(ConnectionView), chosenBy: Schema.Literals(["flag", "variable", "use", "none"]) }),
  reads: [table_world_grants],
  claims: [{ claim: "The connection is the world's address, the caller's key and a grant, and the flag beats the variable beats `world use`.", observes: `cli: with \`world use r00042\` and CAPXUL_WORLD=town, \`world current --json\` prints town chosenBy variable; with --world r00042 it prints chosenBy flag.` }],
  refusals: [OUT],
  examples: [ok("The current world", "capxul world current --json", { connection: { worldId: "r00042", address: addressOf("r00042"), siteSuffix: `-r00042.${BASE}`, keyAddress: ADDR.tester1, role: "player", seat: "bc-finance", expiresAt: ms("2026-12-01T17:00:00Z") }, chosenBy: "use" }),
    ok("No world chosen", "capxul world current --json", { connection: null, chosenBy: "none" })],
});
export const rpc_devnet_worlds_current = current.rpc;
export const operation_world_current = current.op;

const approve = make({
  id: "world.approve", command: "world approve", title: "Approve creating or destroying production", rpc: "devnet.worlds.approve", kind: "action", priority: "normal", cls: "write",
  about: "The platform owner's one-time approval: signs a statement naming the action (`create` or `destroy`), the world and a 15-minute expiry, and prints a token that `world create --owner-approval` or `world destroy --owner-approval` accepts once. Nothing about production proceeds without it, however the caller is signed in.",
  who: OWNER, changes: "One approval, remembered by the worlds service until it is used or expires; nothing else.",
  input: Schema.Struct({ action: Schema.Literals(["create", "destroy"]), world: S }), output: Schema.Struct({ token: S, action: S, world: S, expiresAt: N }),
  claims: [{ claim: "An approval works once, for one action on one world, for fifteen minutes.", observes: `cli: as the platform owner, \`world approve create live\` prints a token; the first \`world create live --kind production --owner-approval <token>\` is accepted and a second with the same token exits WRONG_STATE.` }],
  refusals: [OUT, { error: error_ROLE_PERMISSION_DENIED, given: W.member, when: "The caller is not the platform owner." }, { error: error_INVALID_INPUT, given: W.empty, when: "The action is neither create nor destroy." }],
  examples: [ok("The owner approves creating production", "capxul world approve create live --json", { token: "appr_7Q2mX0aKc1", action: "create", world: "live", expiresAt: ms("2026-12-01T09:15:00Z") }),
    refused("An organiser who is not the owner", "capxul world approve create live --json", error_ROLE_PERMISSION_DENIED)],
});
export const rpc_devnet_worlds_approve = approve.rpc;
export const operation_world_approve = approve.op;

void siteOf; void N;
