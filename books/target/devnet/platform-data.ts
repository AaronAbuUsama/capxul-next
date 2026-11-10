// The worlds platform's data: who may be in a world (grants, invitations, members), what a world is made from and run under (scenarios), the cohorts
// and runs that use them, and the dataset a run leaves behind. These tables sit beside the world tables of ./world-data.ts and reshape nothing in them. Read
// docs/design/worlds-platform.md first: it is the whole design in plain English. The owner's words, 10 November 2026, are quoted in ./platform-decisions.ts.
// Not yet built or run: every table here is a design; each record says what it assumes and the test that will settle it.

import { Schema } from "effect";
import { defineEvent, defineMachine, defineTable } from "../../../packages/book/src/index.ts";
import { concept_devnet } from "../shared/foundation.ts";
import { ClockMode, WorldProfile } from "./world-data.ts";

const DOC = "docs/design/worlds-platform.md";
const S = Schema.String;
const N = Schema.Number;
const Null = Schema.NullOr;
const B = Schema.Boolean;

/** What a key may do in a world. The organiser sets it up and moves it; a player holds a seat; a viewer only watches. */
export const GrantRole = Schema.Literals(["organiser", "player", "viewer"]);
export const SeatKind = Schema.Literals(["human", "agent"]);
export const RunState = Schema.Literals(["planned", "open", "live", "paused", "closed", "accepted", "rejected", "archived"]);
export const CohortState = Schema.Literals(["planned", "running", "closed"]);
/** How a run's clock moves: `stepped` (frozen, moved only by warp or step), `real` (rate 1) or `fast` (rate 2 to 60). */
export const ClockPlanMode = Schema.Literals(["stepped", "real", "fast"]);

/** One seat of a scenario: a person-sized role in one company, the hat it wears there, who may fill it and what it may read beyond its own commands. */
export const SeatSpec = Schema.Struct({ seat: S, company: S, hat: S, filledBy: Schema.Literals(["human", "agent", "either"]), reads: S, agentPolicy: Null(S) });
export const ClockPlan = Schema.Struct({ mode: ClockPlanMode, rate: N, start: S, step: Null(S), warps: Schema.Array(Schema.Struct({ after: S, by: S })) });
export const Measure = Schema.Struct({ id: S, about: S, direction: Schema.Literals(["up", "down"]), weight: N });
/** A scenario as an organiser writes and a run reads: everything a world is made from and run under, with the version that makes a run reproducible. */
export const ScenarioManifest = Schema.Struct({
  name: S, version: N, summary: S, profile: WorldProfile,
  template: Schema.Struct({ snapshot: S, companies: Schema.Array(Schema.Struct({ slug: S, name: S, dateShift: Null(S) })) }),
  seats: Schema.Array(SeatSpec),
  script: Schema.Struct({ ref: S, standIns: Schema.Array(S), events: N }),
  clock: ClockPlan,
  scoring: Schema.Struct({ evals: Schema.Array(S), measures: Schema.Array(Measure) }),
  ends: Schema.Struct({ afterWorldTime: S, orWhen: Null(S) }),
  onDrop: Schema.Literals(["agent", "pause"]),
});

export const table_world_grants = defineTable({
  id: "world-grants",
  title: "World grants: which key may do what in a world",
  about:
    "One row per key per world: the world, the key's address, the role (organiser, player or viewer), the seat a player holds, how the grant came (an invitation's id, or `direct` when an organiser named the key), when it expires and when it was revoked. A grant is the " +
    "supervisor's and sits outside the snapshot, so a restore never re-admits a revoked key (devnet.shared-world). It is checked by the world's gateway on every call to the service and on every company's site address " +
    "(devnet.viewer-grant). A grant holds a public address, never a key. Revoking ends the grant at the gateway at once and, in a `full` world, the site's roles for that person with it (plugs.roles follow hats).",
  was: ["books/target/devnet/decisions.ts (devnet.shared-world, grants by email, now by key)", DOC],
  concept: concept_devnet,
  tenancy: "global",
  scope: "A world's own; the organiser reads them, a person reads their own.",
  fields: Schema.Struct({
    world_id: S, key_address: S, role: GrantRole, seat: Null(S), via: S, created_at: N, expires_at: Null(N), revoked_at: Null(N),
  }),
  key: ["world_id", "key_address"],
  indexes: [{ name: "world-grants-by-key", fields: ["key_address"], for: "`world list` shows the worlds one key may enter, across worlds." }],
  retention: "Kept for ever as the audit of who was let in; a revoked row stays.",
});

export const table_world_invitations = defineTable({
  id: "world-invitations",
  title: "World invitations: a join link an organiser makes",
  about:
    "One row per invitation: the world, the role and the seat it gives, the hash of its code (the code is shown once, in the link), the key it is bound to (when the organiser already knows the person's key, the link works for that key only), how many uses it allows and has had, when it expires and when it was revoked. " +
    "The link is `capxul://join/<world>/<code>`. An invitation holds no key and no email. It never outlives its run's end.",
  was: [DOC],
  concept: concept_devnet,
  tenancy: "global",
  scope: "A world's own; the organiser reads them.",
  fields: Schema.Struct({
    invitation_id: S, world_id: S, role: GrantRole, seat: Null(S), code_hash: S, bound_address: Null(S), max_uses: N, uses: N, created_by: S, created_at: N, expires_at: N, revoked_at: Null(N),
  }),
  key: ["invitation_id"],
  indexes: [{ name: "world-invitations-by-world", fields: ["world_id", "created_at"], for: "`world invite list`: a world's invitations, newest first." }],
  retention: "Kept with the world.",
});

export const table_world_members = defineTable({
  id: "world-members",
  title: "World members: the account joining a world creates for a key",
  about:
    "One row per key that joined a world: its account in that world (Capxul Core's own account for the address, with no email and no profile carried), the Safe at the address that follows from the key and the world (the key's address and the world id are the salt, so the same key has a different Safe in every world), " +
    "the seat it plays, the consent it gave (version, hash of the text, when; `run` lets the run be recorded, `train` lets its data be used for training) and, when withdrawn, when. Nothing else is created in the world for the key, and nothing is carried in from another world: " +
    "no balance, no hat, no company membership, no session. Funds and hats come from the scenario's seat, through the same doors as anyone's. The pseudonym an exported dataset uses is a hash of the key and the run, never the address.",
  was: [DOC],
  concept: concept_devnet,
  tenancy: "global",
  scope: "A world's own. A person reads their own row.",
  fields: Schema.Struct({
    world_id: S, key_address: S, account_id: S, safe_address: S, seat: Null(S), pseudonym: S, consent_scope: Schema.Literals(["run", "train"]), consent_version: S, consent_hash: S, consent_at: N, consent_withdrawn_at: Null(N), joined_at: N,
  }),
  key: ["world_id", "key_address"],
  indexes: [],
  retention: "Kept while the world exists; a withdrawal keeps the row and marks it.",
});

export const table_scenarios = defineTable({
  id: "scenarios",
  title: "Scenarios: what a world is made from and run under",
  about:
    "One row per scenario version: its name and version, the hash of its manifest (the manifest is the `ScenarioManifest` shape: template snapshot and companies, seats, script of outside events, clock plan, scoring, end and what to do when a participant drops out), the template snapshot it points at and the profile it needs. " +
    "A version never changes once published; a change is a new version, so a run names exactly what it ran. The script's events are a file of the scenario (customers, the bank, suppliers, the calendar), drawn with the run's seed.",
  was: [DOC, "docs/mission/worlds.md (sections 4 and 5)"],
  concept: concept_devnet,
  tenancy: "global",
  scope: "The worlds service's own; an organiser reads and publishes.",
  fields: Schema.Struct({ scenario_id: S, name: S, version: N, manifest_hash: S, manifest: S, template_snapshot: S, profile: WorldProfile, published_by: S, published_at: N }),
  key: ["scenario_id"],
  indexes: [{ name: "scenarios-by-name", fields: ["name", "version"], unique: true, for: "`scenario show <name>[@version]` finds a version; the latest is the highest." }],
  retention: "Kept for ever: every run's manifest points at one.",
});

export const table_runs = defineTable({
  id: "runs",
  title: "Runs: one world made from one scenario for a set of participants",
  about:
    "One row per run. A run IS a world: its id is its world's id (`r` and five digits). It names the scenario and version, the seed, the profile, the cohort if any, the clock plan, the state, when it opened, started and ended, and, once exported, its dataset. " +
    "The seed makes the scenario's stand-ins (prices, bank, customers, the calendar's events) repeat; with a stepped clock and the template snapshot it makes a scripted run reproducible (docs/design/worlds-platform.md, Clean data).",
  was: [DOC],
  concept: concept_devnet,
  tenancy: "global",
  scope: "The organiser's; players read their own run.",
  fields: Schema.Struct({
    run_id: S, scenario_id: S, seed: N, profile: WorldProfile, cohort_id: Null(S), clock_mode: ClockMode, state: RunState, created_at: N, opened_at: Null(N), started_at: Null(N), ended_at: Null(N), end_reason: Null(S), accepted_at: Null(N),
  }),
  key: ["run_id"],
  indexes: [{ name: "runs-by-cohort", fields: ["cohort_id", "state"], for: "`cohort show`: every run of a cohort and how each is going." }],
  retention: "Kept for ever; its dataset is kept with it.",
});

export const table_run_seats = defineTable({
  id: "run-seats",
  title: "Run seats: who plays which seat of a run, person or agent",
  about:
    "One row per seat per run: the seat, whether a person or an agent plays it, the holder's key address, for an agent its model and policy version, the state (open, filled, dropped) and when it last changed. A seat taken over after a drop-out gets a new row and the old one stays `dropped`, so the dataset shows who played when " +
    "(a `handover` entry is written to the record). The agent's model and policy version are what a learner's data is later sorted by.",
  was: [DOC],
  concept: concept_devnet,
  tenancy: "global",
  scope: "The run's; the organiser reads and changes seats.",
  fields: Schema.Struct({
    run_id: S, seat: S, since: N, kind: SeatKind, holder_address: Null(S), agent_model: Null(S), policy_version: Null(S), state: Schema.Literals(["open", "filled", "dropped"]),
  }),
  key: ["run_id", "seat", "since"],
  indexes: [],
  retention: "Kept with the run.",
});

export const table_cohorts = defineTable({
  id: "cohorts",
  title: "Cohorts: a group of participants moved through a scenario's runs",
  about:
    "One row per cohort: its name, the scenario and profile, how many participants and seats per run, the schedule (start, window, how many runs at once), what to do when a participant drops out and the state. A cohort makes its runs and assigns people and agents to their seats; it never runs more at once than the machine has room for by profile (devnet.world-capacity). " +
    "The participant list is a file of keys and optional seat preferences: no names, no emails.",
  was: [DOC],
  concept: concept_devnet,
  tenancy: "global",
  scope: "The organiser's.",
  fields: Schema.Struct({
    cohort_id: S, name: S, scenario_id: S, profile: WorldProfile, participants: N, per_run: N, at_once: N, starts_at: N, on_drop: Schema.Literals(["agent", "pause"]), state: CohortState, created_by: S, created_at: N,
  }),
  key: ["cohort_id"],
  indexes: [{ name: "cohorts-by-name", fields: ["name"], unique: true, for: "`cohort show <name>`." }],
  retention: "Kept for ever.",
});

export const table_run_datasets = defineTable({
  id: "run-datasets",
  title: "Run datasets: what a closed run exports and whether it was accepted",
  about:
    "One row per export of a run: the dataset schema version (`dataset/1`), where its files are, how many entries and score lines it holds, the hash of its manifest, the quality checks and their result (every check passes or the dataset is not accepted), whether it may be used for training (all human seats consented to `train`; agent-only runs always) and the participants withdrawn since. " +
    "The files: `manifest.json`, `entries.jsonl`, `scores.jsonl`, `checks.json` and `ledgers/`. A withdrawal rewrites the export without that participant's free text and marks the row.",
  was: [DOC],
  concept: concept_devnet,
  tenancy: "global",
  scope: "The run's; the organiser reads and exports.",
  fields: Schema.Struct({
    run_id: S, export_no: N, schema_version: S, path: S, entries: N, score_lines: N, manifest_hash: S, checks: S, checks_passed: B, training_ok: B, withdrawn: N, exported_at: N,
  }),
  key: ["run_id", "export_no"],
  indexes: [],
  retention: "Kept for ever; the files are in the worlds machine's backup bucket.",
});

export const event_run_transitioned = defineEvent({
  id: "run_transitioned",
  about: "A run changed state: planned, opened, started, paused, resumed, closed, accepted, rejected or archived. Carries the run id, the new state and the cohort id; never a key, an address or a participant.",
  props: Schema.Struct({
    from: Null(RunState), to: RunState, transition: Schema.Literals(["create", "open", "start", "pause", "resume", "close", "accept", "reject", "archive"]), run_id: S, cohort_id: Null(S),
  }),
  was: [DOC],
});
export const event_cohort_transitioned = defineEvent({
  id: "cohort_transitioned",
  about: "A cohort changed state: planned, started running or closed. Carries the cohort id and the new state.",
  props: Schema.Struct({ from: Null(CohortState), to: CohortState, transition: Schema.Literals(["create", "start", "close"]), cohort_id: S }),
  was: [DOC],
});

export const machine_run = defineMachine({
  id: "run",
  title: "A run: planned, open, live, paused, closed, accepted or rejected, then archived",
  about:
    "runs.state. Born planned by `run create` (its world is being made). Open when the world is up and seats may fill; live when its clock plan starts; paused and live again by `world pause` and `world resume` on its world; closed when its end is reached or the organiser closes it (the world is frozen and no more commands). " +
    "A closed run is exported and checked: accepted if every quality check passes, rejected if not. Accepted and rejected runs are archived: the world is parked or destroyed and the dataset stays.",
  table: table_runs,
  field: "state",
  initial: "planned",
  states: [
    { id: "planned", about: "Created; its world is being made from the scenario's template." },
    { id: "open", about: "The world is up; seats are being filled; the clock plan has not started." },
    { id: "live", about: "The clock plan is running; participants play." },
    { id: "paused", about: "The world is paused: nothing moves, nothing is lost." },
    { id: "closed", about: "Ended; the world is frozen; the dataset can be exported and checked." },
    { id: "accepted", about: "Every quality check passed; the dataset is the product." },
    { id: "rejected", about: "A quality check failed; the dataset is kept and marked, and is not used." },
    { id: "archived", about: "The world is parked or destroyed; the dataset and record stay.", terminal: true },
  ],
  transitions: {
    create: { from: [], to: "planned", about: "`run create`: the run and its world begin.", emits: [event_run_transitioned] },
    open: { from: ["planned"], to: "open", about: "The world is up.", emits: [event_run_transitioned] },
    start: { from: ["open"], to: "live", about: "`run start`: the clock plan begins.", emits: [event_run_transitioned] },
    pause: { from: ["live"], to: "paused", about: "`world pause` on the run's world, or a drop-out with the policy `pause`.", emits: [event_run_transitioned] },
    resume: { from: ["paused"], to: "live", about: "`world resume`, or the seat is filled again.", emits: [event_run_transitioned] },
    close: { from: ["open", "live", "paused"], to: "closed", about: "`run close`, or the scenario's end is reached.", emits: [event_run_transitioned] },
    accept: { from: ["closed"], to: "accepted", about: "`run accept`: every quality check passes.", emits: [event_run_transitioned] },
    reject: { from: ["closed"], to: "rejected", about: "`run accept` found a failed check.", emits: [event_run_transitioned] },
    archive: { from: ["closed", "accepted", "rejected"], to: "archived", about: "`run archive`: the world is parked or destroyed.", emits: [event_run_transitioned] },
  },
  was: [DOC],
});

export const machine_cohort = defineMachine({
  id: "cohort",
  title: "A cohort: planned, running, closed",
  about: "cohorts.state. Planned by `cohort create`; running when its first run opens; closed when its runs have all ended or the organiser closes it (an open run is closed with it).",
  table: table_cohorts,
  field: "state",
  initial: "planned",
  states: [
    { id: "planned", about: "Created; no run yet." },
    { id: "running", about: "At least one run has opened." },
    { id: "closed", about: "Every run has ended.", terminal: true },
  ],
  transitions: {
    create: { from: [], to: "planned", about: "`cohort create`.", emits: [event_cohort_transitioned] },
    start: { from: ["planned"], to: "running", about: "The first run opens, at the cohort's start.", emits: [event_cohort_transitioned] },
    close: { from: ["planned", "running"], to: "closed", about: "`cohort close`, or every run has ended.", emits: [event_cohort_transitioned] },
  },
  was: [DOC],
});
