// Cohorts: how an organiser moves a hundred or two hundred testers (and agents) through a scenario's runs. `cohort create|list|show|close`. A cohort makes the runs, assigns participants to seats, never opens
// more runs at once than the machine has room for by profile (devnet.world-capacity), and shows who is in which run. Agents are the first participants (aaron.sign-in-is-core); a person's seat is specified
// and waits on Capxul Core's sign-in. See docs/design/worlds-platform.md, "Cohorts and runs".

import { Schema } from "effect";
import { error_CAPACITY_REACHED, error_INVALID_INPUT, error_NOT_AUTHENTICATED, error_ROLE_PERMISSION_DENIED, error_WRONG_STATE } from "../shared/vocabulary.ts";
import { ok, refused } from "../shared/examples.ts";
import { machine_cohort, table_cohorts, table_run_seats, table_runs, table_scenarios } from "./platform-data.ts";
import { WorldProfile } from "./world-data.ts";
import { make, ms, N, Null, S } from "./platform-kit.ts";

const ORGANISER = "An organiser (a key the worlds service admits as an organiser).";
const W = { out: "signed-out", empty: "empty-devnet", member: "org-with-member", cohort: "cohort-running" } as const;
const OUT = { error: error_NOT_AUTHENTICATED, given: W.out, when: "No one is signed in on this machine." } as const;
const NOT_ORG = { error: error_ROLE_PERMISSION_DENIED, given: W.member, when: "Not an organiser; nothing changes." } as const;
const NO_COHORT = { error: error_INVALID_INPUT, given: W.empty, when: "No cohort has that name." } as const;
const RunLine = Schema.Struct({ runId: S, state: S, filled: N, seatsTotal: N, worldNow: N, entries: N, refused: N });
const CohortView = Schema.Struct({
  cohort: S, scenario: S, profile: WorldProfile, state: Schema.Literals(["planned", "running", "closed"]), participants: N, assigned: N, perRun: N, atOnce: N, startsAt: N, onDrop: Schema.Literals(["agent", "pause"]), runs: Schema.Array(RunLine),
});
const cohort = (o: Record<string, unknown> = {}) => ({
  cohort: "beta-1", scenario: "town-of-four@1", profile: "full", state: "running", participants: 8, assigned: 8, perRun: 4, atOnce: 2, startsAt: ms("2026-12-01T09:00:00Z"), onDrop: "agent",
  runs: [{ runId: "r00042", state: "live", filled: 4, seatsTotal: 4, worldNow: ms("2026-03-09T09:00:00Z"), entries: 812, refused: 14 }, { runId: "r00043", state: "open", filled: 4, seatsTotal: 4, worldNow: ms("2026-03-01T09:00:00Z"), entries: 3, refused: 0 }], ...o });

const create = make({
  id: "cohort.create", command: "cohort create", title: "Plan a cohort: many runs for many participants", rpc: "devnet.cohorts.create", kind: "action", priority: "critical", cls: "background", p95Ms: 60_000,
  about: "`cohort create beta-1 --scenario town-of-four@1 --participants beta-1.csv --per-run 4 --at-once 2 --start 2026-12-01T09:00Z --on-drop agent`. The participants file holds a key address and an optional seat preference per line: no names, no emails. The cohort makes `ceil(participants / per-run)` runs, assigns people and agents to seats (a person's seat is specified and waits on Core's sign-in: until then the file's lines are agents), makes the invitations bound to each key and opens runs in waves of `--at-once`, never more than the machine has room for. A participant's one command to enter is `world join`.",
  who: ORGANISER, changes: "One cohort, its runs and their seats and invitations; runs open at the start time in waves.", input: Schema.Struct({ name: S, scenario: S, participants: S, perRun: N, atOnce: N, start: S, onDrop: Schema.Literals(["agent", "pause"]), profile: Null(WorldProfile) }), output: CohortView,
  reads: [table_scenarios], writes: [table_cohorts, table_runs, table_run_seats], drives: [machine_cohort.t.create],
  claims: [{ claim: "A cohort of N participants becomes the right number of runs with every key bound to a seat.", observes: `cli: \`cohort create beta-1 --participants beta-1.csv --per-run 4\` with 8 lines prints 2 runs and assigned 8; \`world grant list <run>\` shows each key with its seat.` },
    { claim: "A cohort never opens more runs at once than the machine has room for.", observes: `cli: with room for one \`full\` run, \`--at-once 2\` opens one, queues the other and \`cohort show\` says so; no run exits CAPACITY_REACHED mid-cohort.` }],
  refusals: [OUT, NOT_ORG, { error: error_INVALID_INPUT, given: W.empty, when: "No such scenario; the participants file does not read or holds a line that is not an address; per-run exceeds the scenario's seats." }, { error: error_CAPACITY_REACHED, given: W.empty, when: "Not even one run of this profile fits on the machine." }],
  examples: [ok("Plan eight participants into two runs of four", "capxul cohort create beta-1 --scenario town-of-four@1 --participants beta-1.csv --per-run 4 --at-once 2 --start 2026-12-01T09:00Z --on-drop agent --json", cohort({ state: "planned", runs: [{ runId: "r00042", state: "planned", filled: 0, seatsTotal: 4, worldNow: ms("2026-03-01T09:00:00Z"), entries: 0, refused: 0 }, { runId: "r00043", state: "planned", filled: 0, seatsTotal: 4, worldNow: ms("2026-03-01T09:00:00Z"), entries: 0, refused: 0 }] })),
    refused("The file holds a line that is not an address", "capxul cohort create beta-1 --scenario town-of-four@1 --participants bad.csv --per-run 4 --at-once 2 --start 2026-12-01T09:00Z --on-drop agent --json", error_INVALID_INPUT, { field: "participants", line: 3 })],
});
export const rpc_devnet_cohorts_create = create.rpc;
export const operation_cohort_create = create.op;

const list = make({
  id: "cohort.list", command: "cohort list", title: "List cohorts", rpc: "devnet.cohorts.list", kind: "query",
  about: "Cohorts with their scenario, state and how many runs are open, live or done.", who: ORGANISER, changes: "Nothing: it only reads.", input: Schema.Struct({}),
  output: Schema.Struct({ cohorts: Schema.Array(Schema.Struct({ cohort: S, scenario: S, state: S, runs: N, finished: N })) }), reads: [table_cohorts, table_runs],
  claims: [{ claim: "Every cohort is listed with its progress.", observes: `cli: \`cohort list --json\` lists beta-1 with runs 2 and finished 0.` }],
  refusals: [OUT, NOT_ORG], examples: [ok("The cohorts", "capxul cohort list --json", { cohorts: [{ cohort: "beta-1", scenario: "town-of-four@1", state: "running", runs: 2, finished: 0 }] })],
});
export const rpc_devnet_cohorts_list = list.rpc;
export const operation_cohort_list = list.op;

const show = make({
  id: "cohort.show", command: "cohort show", title: "See who is in which run and how each is going", rpc: "devnet.cohorts.show", kind: "query", priority: "critical",
  about: "One cohort: every run with its state, how many seats are filled, the world's now and how many record entries and refusals it has so far. Entries and refusals per run are the quickest sign that a run is moving or stuck.", who: ORGANISER, changes: "Nothing: it only reads.",
  input: Schema.Struct({ cohort: S }), output: CohortView, reads: [table_cohorts, table_runs, table_run_seats],
  claims: [{ claim: "The organiser sees each run's state, seats and progress in one view.", observes: `cli: \`cohort show beta-1 --json\` lists each run with filled, seatsTotal, worldNow, entries and refused.` }],
  refusals: [OUT, NOT_ORG, NO_COHORT], examples: [ok("The cohort", "capxul cohort show beta-1 --json", cohort()), refused("No such cohort", "capxul cohort show beta-9 --json", error_INVALID_INPUT, { field: "cohort", name: "beta-9" })],
});
export const rpc_devnet_cohorts_show = show.rpc;
export const operation_cohort_show = show.op;

const close = make({
  id: "cohort.close", command: "cohort close", title: "Close a cohort", rpc: "devnet.cohorts.close", kind: "action", priority: "normal", cls: "background", p95Ms: 120_000,
  about: "Closes every run of the cohort that has not ended (with the reason `cohort closed`), cancels runs not yet opened and marks the cohort closed. Each closed run still has to be checked and exported (`run check`, `run export`, `run accept`).", who: ORGANISER,
  changes: "The cohort becomes closed; its unfinished runs are closed or cancelled.", input: Schema.Struct({ cohort: S }), output: CohortView, reads: [table_cohorts], writes: [table_cohorts, table_runs], drives: [machine_cohort.t.close],
  claims: [{ claim: "Closing a cohort closes its live runs and keeps their data.", observes: `cli: \`cohort close beta-1\` then \`run list --cohort beta-1\` shows closed runs, and \`record list --world r00042\` still lists every entry.` }],
  refusals: [OUT, NOT_ORG, NO_COHORT, { error: error_WRONG_STATE, given: W.cohort, when: "The cohort is already closed." }],
  examples: [ok("Close", "capxul cohort close beta-1 --json", cohort({ state: "closed" })), refused("Already closed", "capxul cohort close beta-1 --json", error_WRONG_STATE, { state: "closed" })],
});
export const rpc_devnet_cohorts_close = close.rpc;
export const operation_cohort_close = close.op;
