// Runs: one world made from one scenario for a set of participants. `run create|list|show|start|close`, `run seat assign|drop`. A run IS a world (its id is its world's id), so every world command
// works on it. Agents play seats now; a human seat is specified and waits on Capxul Core's sign-in (aaron.sign-in-is-core). See docs/design/worlds-platform.md, "Cohorts and runs".

import { Schema } from "effect";
import { error_CAPABILITY_UNAVAILABLE, error_CAPACITY_REACHED, error_INVALID_INPUT, error_NOT_AUTHENTICATED, error_ROLE_PERMISSION_DENIED, error_WRONG_STATE } from "../shared/vocabulary.ts";
import { ok, refused } from "../shared/examples.ts";
import { machine_world, table_command_records, table_worlds } from "./world-data.ts";
import { machine_run, SeatKind, table_run_seats, table_runs, table_scenarios, table_world_grants } from "./platform-data.ts";
import { addressOf, ADDR, B, make, ms, N, Null, RunView, S, SeatView, siteOf } from "./platform-kit.ts";
import { WorldProfile } from "./world-data.ts";

const ORGANISER = "An organiser of the run (the holder of an organiser grant in its world).";
const W = { out: "signed-out", empty: "empty-devnet", member: "org-with-member", open: "run-open", live: "run-live", closed: "run-closed" } as const;
const OUT = { error: error_NOT_AUTHENTICATED, given: W.out, when: "No one is signed in on this machine." } as const;
const NOT_ORG = { error: error_ROLE_PERMISSION_DENIED, given: W.member, when: "Not an organiser; nothing changes." } as const;
const NO_RUN = { error: error_INVALID_INPUT, given: W.empty, when: "No run has that id." } as const;
const notOrg = (c: string) => refused("A player is not an organiser", c, error_ROLE_PERMISSION_DENIED);

const seats = (over: Record<string, unknown> = {}) => [
  { seat: "bc-finance", company: "bit-connect", hat: "budget-holder", kind: "agent", holder: ADDR.tester1, agentModel: "model-x", state: "filled", ...over },
  { seat: "bc-director", company: "bit-connect", hat: "admin", kind: null, holder: null, agentModel: null, state: "open" },
];
const run = (o: Record<string, unknown> = {}) => ({
  runId: "r00042", scenario: "town-of-four@1", state: "open", profile: "full", cohortId: "beta-1", seed: 7, clockMode: "frozen", worldNow: ms("2026-03-01T09:00:00Z"), address: addressOf("r00042"), seats: seats(),
  sites: [{ company: "bit-connect", url: siteOf("bit-connect", "r00042") }], recordHead: 3, ...o,
});

const create = make({
  id: "run.create", command: "run create", title: "Make a run from a scenario", rpc: "devnet.runs.create", kind: "action", priority: "critical", cls: "background", p95Ms: 120_000,
  about: "Makes one world from one scenario version: `run create town-of-four@1 --seed 7 --seats bc-finance=agent:ledger-agent@1,bc-director=open`. The world is restored from the scenario's template (core: seconds, estimated; full: about 34 to 42 seconds for one company and 80 seconds for four, measured in the spike), the seed is set for the scenario's stand-ins, and the seats are made. The run waits `open`, its clock frozen, until `run start`. Its id (`r` and five digits) is its world's id and its address is `core-<id>.worlds.capxul.com`.",
  who: ORGANISER, changes: "One run and its world, creating; its seats; a `born` entry naming the scenario, its version and the seed.",
  input: Schema.Struct({ scenario: S, seed: N, profile: Null(WorldProfile), seats: Schema.Array(Schema.Struct({ seat: S, kind: Schema.Literals(["agent", "human", "open"]), policy: Null(S) })), cohort: Null(S) }), output: RunView,
  reads: [table_scenarios, table_worlds], writes: [table_runs, table_run_seats, table_worlds, table_command_records], drives: [machine_run.t.create, machine_world.t.create],
  claims: [{ claim: "A run is a world made from the scenario, with its seats, its seed and a record that begins with its birth.", observes: `cli: \`run create town-of-four@1 --seed 7\` then \`run show\` prints open, the scenario and its manifest hash, seed 7 and the scenario's seats; \`record list --world r00042\` lists a \`born\` entry naming the scenario version and the seed.` },
    { claim: "Two runs of one scenario and seed from the same template start identical.", observes: `cli: two runs made with seed 7 have equal chain state roots, document counts and ledger balances at open (the double-run test).` },
    { claim: "A run is refused when the machine has no room for its profile.", observes: `cli: with the machine full, \`run create\` exits CAPACITY_REACHED and makes nothing.` }],
  refusals: [OUT, NOT_ORG, { error: error_INVALID_INPUT, given: W.empty, when: "No such scenario or version; a seat the scenario does not have; or a profile the scenario cannot run in." }, { error: error_CAPACITY_REACHED, given: W.empty, when: "No room for another world of this profile." }],
  examples: [ok("Make a run of the town for seed 7", "capxul run create town-of-four@1 --seed 7 --seats bc-finance=agent:ledger-agent@1,bc-director=open --json", run({ state: "planned", seats: seats(), recordHead: 1 })),
    refused("No such scenario", "capxul run create town@9 --seed 1 --json", error_INVALID_INPUT, { field: "scenario", name: "town@9" }), refused("No room", "capxul run create town-of-four@1 --seed 8 --json", error_CAPACITY_REACHED, {})],
});
export const rpc_devnet_runs_create = create.rpc;
export const operation_run_create = create.op;

const list = make({
  id: "run.list", command: "run list", title: "List runs", rpc: "devnet.runs.list", kind: "query",
  about: "Runs with their state, scenario, cohort and how many seats are filled. `--cohort`, `--state` and `--scenario` filter.", who: "An organiser sees every run; a player sees their own.", changes: "Nothing: it only reads.",
  input: Schema.Struct({ cohort: Null(S), state: Null(S), scenario: Null(S) }), output: Schema.Struct({ runs: Schema.Array(Schema.Struct({ runId: S, scenario: S, state: S, cohortId: Null(S), filled: N, seatsTotal: N, worldNow: N })) }),
  reads: [table_runs, table_run_seats], claims: [{ claim: "Every run is listed with its state and how many seats are filled.", observes: `cli: with three runs of a cohort, \`run list --cohort beta-1 --json\` lists three with filled and seatsTotal.` }],
  refusals: [OUT], examples: [ok("The cohort's runs", "capxul run list --cohort beta-1 --json", { runs: [{ runId: "r00042", scenario: "town-of-four@1", state: "live", cohortId: "beta-1", filled: 4, seatsTotal: 4, worldNow: ms("2026-03-09T09:00:00Z") }, { runId: "r00043", scenario: "town-of-four@1", state: "open", cohortId: "beta-1", filled: 2, seatsTotal: 4, worldNow: ms("2026-03-01T09:00:00Z") }] })],
});
export const rpc_devnet_runs_list = list.rpc;
export const operation_run_list = list.op;

const show = make({
  id: "run.show", command: "run show", title: "Show one run and how it is going", rpc: "devnet.runs.show", kind: "query", priority: "critical",
  about: "One run: its state and scenario, who plays each seat (person or agent, and the agent's model), the world's now, the record's head and the addresses of the service and of each company's site.", who: "An organiser; a player of the run.", changes: "Nothing: it only reads.",
  input: Schema.Struct({ run: S }), output: RunView, reads: [table_runs, table_run_seats, table_worlds],
  claims: [{ claim: "A run shows who is in which seat and how far the clock has come.", observes: `cli: \`run show r00042 --json\` lists every seat with its holder kind, model and state, and worldNow.` }],
  refusals: [OUT, NO_RUN, { error: error_ROLE_PERMISSION_DENIED, given: W.member, when: "The key has no grant in the run's world." }], examples: [ok("The run", "capxul run show r00042 --json", run()), refused("No such run", "capxul run show r9 --json", error_INVALID_INPUT, { field: "run", name: "r9" })],
});
export const rpc_devnet_runs_show = show.rpc;
export const operation_run_show = show.op;

const start = make({
  id: "run.start", command: "run start", title: "Start a run's clock plan", rpc: "devnet.runs.start", kind: "action", priority: "critical", cls: "write",
  about: "Starts the scenario's clock plan: a stepped clock is unfrozen to its first step, a real or fast clock begins running at its rate. Seats that are still open are filled by the scenario's agent policy if the run was made with `--fill-open agent`, otherwise the run refuses to start.",
  who: ORGANISER, changes: "The run becomes live; the world's clock begins; a `clock` entry is written.", input: Schema.Struct({ run: S, fillOpen: Schema.Literals(["agent", "refuse"]) }), output: RunView,
  reads: [table_runs, table_run_seats], writes: [table_runs, table_run_seats, table_command_records], drives: [machine_run.t.start],
  claims: [{ claim: "A run does not start with an open seat unless told to fill it with an agent.", observes: `cli: \`run start r00043\` with an open seat exits WRONG_STATE naming it; with \`--fill-open agent\` the seat is filled by the scenario's policy, a \`handover\` entry says so, and the run is live.` }],
  refusals: [OUT, NO_RUN, NOT_ORG, { error: error_WRONG_STATE, given: W.open, when: "The run is not open, or a seat is open and fill-open is refuse." }],
  examples: [ok("Start the run", "capxul run start r00042 --json", run({ state: "live" })), refused("A seat is open", "capxul run start r00043 --json", error_WRONG_STATE, { seat: "bc-director" })],
});
export const rpc_devnet_runs_start = start.rpc;
export const operation_run_start = start.op;

const close = make({
  id: "run.close", command: "run close", title: "Close a run", rpc: "devnet.runs.close", kind: "action", priority: "critical", cls: "background", p95Ms: 30_000,
  about: "Ends a run: when the scenario's end is reached (the world's time, or its `orWhen`), or when the organiser says so with a reason. The world is frozen, no more commands are accepted, the record is closed at its head and the run waits to be exported and checked.",
  who: ORGANISER, changes: "The run becomes closed; the world is frozen; the end and its reason are recorded.", input: Schema.Struct({ run: S, reason: S }), output: RunView,
  reads: [table_runs], writes: [table_runs, table_command_records], drives: [machine_run.t.close],
  claims: [{ claim: "A closed run takes no more commands and keeps its record.", observes: `cli: \`run close r00042 --reason end\`; any command in r00042 is refused WRONG_STATE; \`record list --world r00042\` still lists every entry.` }],
  refusals: [OUT, NO_RUN, NOT_ORG, { error: error_WRONG_STATE, given: W.closed, when: "The run is already closed or later." }],
  examples: [ok("Close the run", "capxul run close r00042 --reason end --json", run({ state: "closed" })), refused("Already closed", "capxul run close r00042 --reason end --json", error_WRONG_STATE, { state: "closed" })],
});
export const rpc_devnet_runs_close = close.rpc;
export const operation_run_close = close.op;

const assign = make({
  id: "run.seat.assign", command: "run seat assign", title: "Put a person or an agent in a seat", rpc: "devnet.runs.seat-assign", kind: "action", priority: "critical", cls: "write",
  about: "Assigns a seat: `run seat assign r00042 bc-director --agent ledger-agent@1 --key 0x…` or, for a person, `--key 0x…` alone. It makes the invitation bound to that key and, if the key has joined, gives it the seat at once. A person's key and account in the world are the same as an agent's. A seat for a person is specified now and opened after Capxul Core's sign-in exists (aaron.sign-in-is-core): until then a human seat is refused CAPABILITY_UNAVAILABLE and every seat is an agent's.",
  who: ORGANISER, changes: "A seat row (filled); the key's grant; a `handover` entry when it replaces another holder.", input: Schema.Struct({ run: S, seat: S, kind: SeatKind, key: S, policy: Null(S), model: Null(S) }), output: Schema.Struct({ seat: SeatView }),
  reads: [table_runs, table_run_seats], writes: [table_run_seats, table_world_grants, table_command_records],
  claims: [{ claim: "An agent is put in a seat under its own key, with its model and policy version recorded.", observes: `cli: \`run seat assign r00042 bc-director --agent --key <K> --policy ledger-agent@1 --model model-x\`; \`run show\` lists the seat filled by an agent with that model; the manifest of the exported dataset repeats it.` },
    { claim: "A seat for a person is refused until Core's sign-in exists.", observes: `cli (waits on the Core sign-in design): \`run seat assign r00042 bc-director --human --key <K>\` exits CAPABILITY_UNAVAILABLE.` }],
  refusals: [OUT, NO_RUN, NOT_ORG, { error: error_INVALID_INPUT, given: W.open, when: "The run has no such seat, or the key is not a key." }, { error: error_WRONG_STATE, given: W.closed, when: "The run has ended." }, { error: error_CAPABILITY_UNAVAILABLE, given: W.open, when: "A seat for a person was asked for: Capxul Core's sign-in does not exist yet (aaron.sign-in-is-core)." }],
  examples: [ok("An agent takes the director's seat", `capxul run seat assign r00042 bc-director --agent --key ${ADDR.tester2} --policy ledger-agent@1 --model model-x --json`, { seat: { seat: "bc-director", company: "bit-connect", hat: "admin", kind: "agent", holder: ADDR.tester2, agentModel: "model-x", state: "filled" } }),
    refused("A person's seat is not opened yet", `capxul run seat assign r00042 bc-director --human --key ${ADDR.tester2} --json`, error_CAPABILITY_UNAVAILABLE, {}),
    refused("No such seat", `capxul run seat assign r00042 cfo --agent --key ${ADDR.tester2} --json`, error_INVALID_INPUT, { field: "seat", name: "cfo" })],
});
export const rpc_devnet_runs_seat_assign = assign.rpc;
export const operation_run_seat_assign = assign.op;

const drop = make({
  id: "run.seat.drop", command: "run seat drop", title: "A participant drops out: apply the run's drop-out policy", rpc: "devnet.runs.seat-drop", kind: "action", priority: "critical", cls: "write",
  about: "Marks a seat's holder gone (the organiser says so, or the seat's key stopped answering for longer than the scenario allows) and applies the scenario's policy: `agent`: the scenario's agent policy takes the seat, a `handover` entry in the record says from whom to whom and at what world time, and the run goes on; `pause`: the run's world is paused until the seat is filled. The dropped holder's earlier entries stay.",
  who: ORGANISER, changes: "The old seat row is dropped; a new row is filled by an agent, or the run is paused; a `handover` entry.", input: Schema.Struct({ run: S, seat: S }), output: Schema.Struct({ policy: Schema.Literals(["agent", "pause"]), run: RunView }),
  reads: [table_runs, table_run_seats], writes: [table_runs, table_run_seats, table_world_grants, table_command_records], drives: [machine_run.t.pause],
  claims: [{ claim: "A dropped seat is taken by an agent or the run pauses, as the scenario says, and the record shows when.", observes: `cli: for a scenario with onDrop agent, \`run seat drop r00042 bc-finance\` leaves the run live with the seat held by an agent and a \`handover\` entry; for onDrop pause the run prints paused.` }],
  refusals: [OUT, NO_RUN, NOT_ORG, { error: error_WRONG_STATE, given: W.closed, when: "The run has ended, or the seat is not filled." }],
  examples: [ok("The finance tester drops; an agent takes the seat", "capxul run seat drop r00042 bc-finance --json", { policy: "agent", run: run({ state: "live", seats: seats({ kind: "agent", agentModel: "model-y" }) }) }), refused("The seat is not filled", "capxul run seat drop r00043 bc-director --json", error_WRONG_STATE, { seat: "bc-director" })],
});
export const rpc_devnet_runs_seat_drop = drop.rpc;
export const operation_run_seat_drop = drop.op;

void B;
