// The worlds platform's decisions, part two: scenarios, runs and cohorts, capacity and cost, the dataset and its quality, reproducibility, consent, the environment interface, staging and production, and
// parking. Measured figures are marked measured (spike: spikes/skeleton/FINDINGS.md; cost: docs/mission/world-cost.md) and every estimate says so, with the test that will settle it.

import * as f from "../shared/foundation.ts";
import * as d from "./world-data.ts";
import * as o from "./world-ops.ts";
import * as p from "./platform-data.ts";
import * as life from "./platform-lifecycle.ts";
import * as sc from "./platform-scenarios.ts";
import * as run from "./platform-runs.ts";
import * as ds from "./platform-datasets.ts";
import * as co from "./platform-cohorts.ts";
import * as env from "./platform-env.ts";
import { dec, OWNER } from "./platform-decisions.ts";

const BASE = [f.system_capxul, f.concept_devnet];

export const decision_devnet_scenario = dec({
  id: "devnet.scenario",
  title: "A scenario is a versioned manifest of template, seats, script, clock, scoring",
  question: "What is a world created from and run under?",
  options: [
    { label: "versioned-manifest", text: "A scenario is a manifest (`ScenarioManifest`): the template (a snapshot plus its companies, their sites' data, the people and seats), the seats (company, hat, who may fill it: person, agent or either, what it may read beyond its own commands, the default agent policy), the script of outside events (customers, the bank, suppliers, the calendar: a file drawn with the run's seed), the clock plan (stepped, real or fast; start; step; warps), what is scored (which of the book's evals, and measures with a direction and a weight) and when it ends (a world time or a condition), and what to do when a participant drops out (an agent takes the seat, or the run pauses). A version never changes. The first two are worked from the old product's scenario companies: `solo-bit-connect` (one company, one seat, `core`) and `town-of-four` (Bit Connect, Quillmesh, Kobina Ridge, Tamu Orchards at month three; Tamu starts nine months later than the others, so it carries a date shift; `full`). The old generators are the source of the template's history: each company's facts seeded through the door, checked against its month-end answer key (devnet.first-template). The companies' jurisdictions are properties of the template and are left open (aaron.jurisdiction-open)." },
    { label: "scripts-only", text: "A scenario is a script file; templates and scoring are separate." },
  ],
  chosen: "versioned-manifest",
  why: OWNER + "\"cycling through different scenarios and simulations\" needs a scenario to be one thing that is published, versioned and named by a run. The scenario companies exist as generators (measured: Bit Connect 3,015 facts, Quillmesh 6,275, Kobina Ridge 2,404, Tamu Orchards 4,445; docs/mission/worlds.md, section 5). ASSUMPTION: the seed adapter (an old action to the new door's call) is not built; settled by seeding Bit Connect's months 1 to 3 and checking the month-end answer key. ASSUMPTION: the scoring evals named (`books-agree-with-chain`, `no-unauthorised-payment`) are scenario measures to be derived from the book's evals; settled when the scoreboard (m1-eval-harness) can run an eval against a world.",
  affects: [...BASE, p.table_scenarios, sc.operation_scenario_save, sc.operation_scenario_list, sc.operation_scenario_show, sc.operation_scenario_check],
});

export const decision_devnet_runs = dec({
  id: "devnet.runs-and-cohorts",
  title: "A run is one world from one scenario; a cohort schedules many runs",
  question: "How does an organiser move a hundred or two hundred participants through scenarios?",
  options: [
    { label: "run-is-a-world", text: "A run is one world made from one scenario version and a seed for a set of participants; its id is its world's id, so every world command works on it. States: planned, open, live, paused, closed, then accepted or rejected, then archived (machine `run`). A cohort is a name, a scenario, a participants file (key addresses and optional seat preferences: no names or emails), seats per run, runs at once, a start and a drop-out policy. `cohort create` makes `ceil(participants / per-run)` runs, binds each key to a seat by an invitation and opens runs in waves, never more at once than the machine has room for by profile (devnet.world-capacity). `cohort show` lists each run with state, seats filled, the world's now and entries and refusals so far. A drop-out: the organiser (or a silent key beyond the scenario's allowance) runs `run seat drop`; the scenario's policy then either puts its agent policy in the seat, with a `handover` entry saying from whom to whom at what world time, or pauses the run until the seat is filled. A closed run is exported, checked and accepted; `run archive` parks or destroys the world and keeps the data." },
    { label: "manual-runs", text: "Each run is made and filled by hand with `world create`." },
  ],
  chosen: "run-is-a-world",
  why: OWNER + "100 to 200 people at four seats a run is 25 to 50 runs: a cohort must make, fill, watch and close them without a hand on each. ASSUMPTION: a silent key can be told from a slow one by a scenario-stated allowance; settled by the first cohort eval with a scripted drop-out.",
  affects: [...BASE, p.table_runs, p.table_run_seats, p.table_cohorts, p.machine_run, p.machine_cohort, run.operation_run_create, run.operation_run_start, run.operation_run_close, run.operation_run_seat_assign, run.operation_run_seat_drop, co.operation_cohort_create, co.operation_cohort_show, co.operation_cohort_close, co.operation_cohort_list, run.operation_run_list, run.operation_run_show],
});

export const decision_devnet_capacity = dec({
  id: "devnet.world-capacity",
  title: "How many worlds fit on the 16 GiB machine, by profile, and when it is full",
  question: "How many worlds of each profile run at once, and what does a request beyond that get?",
  options: [
    { label: "capacity-by-profile", text: "MEASURED (the spike on a MacBook; the bench on the same Mac): a bench with four sites is 0.85 GiB (361 MiB bench, 471 MiB MariaDB, 22 MiB Redis); a site is 60 MB of database and about 1 MB of files; an idle anvil is 12 MiB and the real v4 seeded state file is 5.5 MB. A site restores in 33 s; a world restored with one company 36 s; the four-company world in place 80 s; a snapshot of four companies and the chain saves in 9.4 s and is 9.5 MB; a company from the template 47 s (132 s without); a ten-day advance of four companies 33 to 41 s. The machine is 4 vCPU, 16 GiB, 320 GB, $84 a month (docs/mission/sites-host/STATE.md). ESTIMATES (docs/mission/world-cost.md; none measured on real v4 contracts): with the old stack a world's Capxul part is about 0.6 GiB (about 12 idle, 6 to 8 busy worlds in all); with the lean service (one process, one database file, in-process EVM, indexer folded in) about 0.15 GiB, so about 85 active `core` worlds on 13 GiB (16 less 2 for the system and 0.85 for the bench); a `full` world of four companies is about 0.15 + 4 x 0.1 = 0.55 GiB, so about 20 active; a parked world is storage only (core about 60 MB, a four-company full world about 0.3 GiB), so some hundreds parked on 250 GB. CPU is the second bound: 4 vCPUs allow about 4 clock advances at once. The machine counts worlds by profile, refuses what does not fit (CAPACITY_REACHED, retryable), parks idle worlds (30 minutes) and orders a cohort's waves by it. Cost per active full world-hour is about $0.006 at 20 active (arithmetic: $84 / 730 h / 20)." },
    { label: "no-limit", text: "Accept every world and let the machine swap." },
  ],
  chosen: "capacity-by-profile",
  why: OWNER + "The numbers are marked as the owner asked for a specification he can budget from. ASSUMPTIONS and the tests that settle them: the lean service's 0.15 GiB (build it and run `docker stats` with 20 worlds); the 0.1 GiB per busy site (run four busy sites for an hour); the park and wake times (the first hosted-world eval, m3b-first-shared-world); and that a second machine from the same image doubles every figure (it should: worlds share nothing, devnet.worlds-never-see-each-other).",
  affects: [...BASE, d.table_worlds, o.operation_world_create, life.operation_world_resume, run.operation_run_create, co.operation_cohort_create],
});

export const decision_devnet_dataset = dec({
  id: "devnet.dataset",
  title: "The record is the product: entry, episode, manifest, dataset, quality checks",
  question: "What is a run's clean data, and when is it accepted?",
  options: [
    { label: "episode-manifest-dataset", text: "The ENTRY is the record's own (table command-records, the spike's schema 1: seq and prev hash, trace, command and arguments, actor with hats read from the chain, world, org, site, world time, real time, duration, outcome and error, result, changes with transaction hashes) plus, now designed in, the run id, the seat's kind, the agent's model and policy version, the surface and the cause; new kinds `join`, `handover` and `score`. The EPISODE is a run. Its MANIFEST (`RunManifest`, `dataset/1`) names the scenario and version and its hash, the template snapshot id, the seed, the clock plan, each seat's occupant by role (human or agent, a pseudonym, the agent's model and policy version, the consent version for a person, from and to), the software versions (Capxul, contracts, bench image digest, book commit), lineage across restored worlds (parent world, snapshot, sequence), the counts and the start and end. A DATASET is one folder: `manifest.json`, `entries.jsonl` (lineage first), `scores.jsonl` (the measures after each step or day: the rewards), `checks.json` and `ledgers/` (month-end books and chain balances). QUALITY before acceptance (`run check`): the sequence has no gap and the hash chain verifies; the books agree with the chain; no secret is in the data, searched by value; the manifest is complete; the clock plan was kept; every human seat consented; the lineage resolves; no abandoned branch is mixed in unflagged; a redaction pass found no email or phone that is not a pseudonym. Every check passes or the run is rejected (kept, marked, not used)." },
    { label: "raw-record", text: "Hand out the record export and let users judge it." },
  ],
  chosen: "episode-manifest-dataset",
  why: OWNER + "\"we need clean data\": clean means a manifest says what produced it and a check says it is whole. The entry and the redaction by value are measured in the spike (179 commands, 179 entries; 0 hits for every test key). ASSUMPTIONS: the agent's model and policy version reach the entry (the CLI must receive them from the harness; settled by the first agent run); the redaction pass for personal data in results is not built (only secrets are redacted today: FINDINGS, What the design must now decide, 3); the quality checks are designed, not run.",
  affects: [...BASE, d.table_command_records, p.table_run_datasets, ds.operation_run_check, ds.operation_run_export, ds.operation_run_accept, ds.operation_run_archive, o.operation_record_export],
});

export const decision_devnet_reproducible = dec({
  id: "devnet.reproducible",
  title: "What makes a run reproducible, and what cannot be",
  question: "Which runs can be replayed to the same result, and which not?",
  options: [
    { label: "stepped-seeded-snapshot", text: "REPRODUCIBLE: a scripted run on a stepped clock (frozen; moved only by warp or step), the scenario's seeded stand-ins (prices, bank, customers, calendar, mail), the template snapshot id and pinned software versions. Replaying the recorded commands in a fresh world from the same template should give equal chain state, document counts and ledger balances (the double-run test). NOT REPRODUCIBLE: a person's choices; an agent's output unless its sampling is fixed and even then not guaranteed; any run on a `real` or `fast` clock (host time enters); the host-time calls that remain on the site (86 counted: database `NOW()`, Redis timeouts, session lifetime, the browser's own date); parallel scheduled jobs' order inside a warp; random ids (trace ids, approval ids). A run records which of these applies in its manifest (`clock.mode`)." },
    { label: "all-reproducible", text: "Claim every run is reproducible." },
  ],
  chosen: "stepped-seeded-snapshot",
  why: "docs/mission/worlds.md section 5 and FINDINGS, The clock: what follows the clock and what stays on the host's time are measured; the replay equality is NOT: ASSUMPTION, settled by the double-run test (two worlds, one template, one seed, one command list, equal dumps).",
  affects: [...BASE, p.table_runs, ds.operation_run_export, run.operation_run_create],
});

export const decision_devnet_consent = dec({
  id: "devnet.consent-and-privacy",
  title: "Testers are real people: consent, pseudonyms, withdrawal, no secret ever",
  question: "What is stored about a participant, and what may the data be used for?",
  options: [
    { label: "explicit-consent", text: "Joining requires consent, in two scopes: `run` (the participant's commands in the run are recorded and used for evaluation) and `train` (the run's data may be used for training). The version and the hash of the consent text and the time are stored. Stored about a person: a key address, a pseudonym (a hash of the key and the run), the seat and the consent; no name or email is required. An export uses the pseudonym and a redaction pass removes email addresses, phone numbers and the participant's free text unless they chose `train`. A dataset is training-ready only if every human seat chose `train` (agent-only runs always); otherwise it is evaluation-only. `run redact` withdraws a participant: their free text leaves every export and the training flag falls. The record itself is never edited. Never in any record or export: a key, seed, grant, session or bearer token, sign-in code, password, HMAC secret or encryption key. A real customer's world is never exported without this consent (devnet.record-readers stays open on who reads)." },
    { label: "implied-consent", text: "Joining implies consent." },
  ],
  chosen: "explicit-consent",
  why: OWNER + "Testers are real people (the coordinator's brief). ASSUMPTION: the jurisdiction's data-protection rules are not assessed and the first jurisdiction is open (aaron.jurisdiction-open); settled by a short legal read before the first human tester joins, which is after Core's sign-in exists in any case (aaron.sign-in-is-core).",
  affects: [...BASE, p.table_world_members, ds.operation_run_redact, ds.operation_run_export],
});

export const decision_devnet_env = dec({
  id: "devnet.env-interface",
  title: "A world as an RL environment: reset, step, observation, reward, done, info",
  question: "How does a learner use a world, what does it cost, and how could it be faster?",
  options: [
    { label: "reset-step-by-profile", text: "RESET is `env reset` (a run created from a scenario and a seed). STEP is `env step`: one command through the door, or one agent turn. OBSERVATION is what the command returned plus what the scenario lets the seat read. REWARD is the change in the scenario's weighted measures since the last step, as deltas, plus each measure's before, after and delta. DONE is the scenario's end. INFO is the record entries the step produced, whether it was refused and the code. COST, measured: a step 0.1 to 0.7 s (signing 0.6 s); a `full` reset 34 to 42 s for one company, 80 s for four; a ten-day advance 33 to 41 s for four companies (about a minute for six, the coordinator's figure, not in the spike). ESTIMATED: a `core` reset 1 to 3 s from the 5.5 MB state; a `core` one-day advance well under a second; about 10 to 30 steps a second for the whole machine (4 vCPUs), tens of thousands of steps an hour. So: many parallel `core` worlds for learning on money and authority paths; `full` worlds for evaluation and human runs, not millions of steps. TO GO FASTER: the lean service (in-process EVM instead of anvil's RPC, indexer folded in, in-process signer, in-EVM mock bundler: an estimated 10 times, unmeasured and needing the differential replay of docs/mission/world-cost.md), a pool of warm worlds restored from the template, batching a day's steps, more machines (each $84 a month, nothing shared), and, only if one machine's Frappe is the limit, the Capxul part as a Durable Object per world." },
    { label: "no-env", text: "Do not offer an environment interface." },
  ],
  chosen: "reset-step-by-profile",
  why: OWNER + "\"as we progress into doing things like RL, we need clean data, we need RL environments. So this has got to serve as that.\" Every verb maps to something the book already has: reset to run.create, step to the door, observation to the command's return and the seat's reads, reward to the scenario's scoring, info to command-records. ASSUMPTIONS: the 10 to 30 steps a second and the 1 to 3 s core reset (settled by building the lean service and timing 1,000 steps and 100 resets); the reward from the book's evals needs the scoreboard (m1-eval-harness).",
  affects: [...BASE, env.operation_env_reset, env.operation_env_step, env.operation_env_state, env.operation_env_close, p.table_runs],
});

export const decision_devnet_production = dec({
  id: "devnet.production-is-a-world",
  title: "Staging and production are worlds too: another kind, the owner's approval",
  question: "How are staging and production made, and what do they not have?",
  options: [
    { label: "same-commands-different-kind", text: "`world create --kind staging|production` makes them with the same commands. What differs: a public chain, the real clock, real services (no stand-ins), always the `full` profile, and no snapshot, restore, clock, pause, `scenario` or `env` verbs (WRONG_ENVIRONMENT). Creating or destroying production always needs the platform owner: `world approve` mints a single-use, 15-minute approval for one action on one world, and `world create` and `world destroy` accept it as `--owner-approval`; without it they are refused ROLE_PERMISSION_DENIED. Staging needs an organiser. A real chain cannot be copied or moved (FINDINGS, Worlds and snapshots), which is why those verbs are absent." },
    { label: "separate-tooling", text: "Production has its own tooling." },
  ],
  chosen: "same-commands-different-kind",
  why: "The coordinator's brief; aaron.world-clock (a real chain cannot be moved, so a world with a moving clock never shares a chain with a real company). ASSUMPTION: the platform owner is one configured key; settled when production is first made.",
  affects: [...BASE, d.table_worlds, o.operation_world_create, life.operation_world_destroy, life.operation_world_approve],
});

export const decision_devnet_parking = dec({
  id: "devnet.parking",
  title: "Parking: a parked world costs storage only and wakes on demand",
  question: "How are idle worlds kept cheap?",
  options: [
    { label: "park-and-wake", text: "`world park` saves the chain's state file, the service database, the record and, in a `full` world, each company's site as a backup, then drops the sites from the bench. The gateway wakes a parked world on the first call to its address or on `world resume`: a `core` world in seconds (estimate), a `full` world in about 33 s per company (measured: the spike's site restore). Idle hosted worlds are parked after 30 minutes by the park-idle process (an assumption the first hosted-world eval measures); a world with a running clock that a viewer is watching is not parked. Dropping a site takes about a minute (measured) and is not on the wake path. `world pause` is the lighter state: stopped in place, no memory, sites left on the bench." },
    { label: "always-on", text: "Keep every world running." },
  ],
  chosen: "park-and-wake",
  why: OWNER + "\"having that heavy infrastructure on every sandbox just doesn't make sense\". Measured times above; the park and the wake as a whole are not in the spike (ASSUMPTION; m3b-first-shared-world settles it).",
  affects: [...BASE, d.machine_world, life.operation_world_park, life.operation_world_resume, life.operation_world_pause],
});

export const decision_devnet_platform_placement = dec({
  id: "devnet.platform-placement",
  title: "The worlds platform stays in devnet; the portal's Worlds page gathers it",
  question: "Should the worlds platform be a concept of its own?",
  options: [
    { label: "stay-in-devnet", text: "No. Its records are devnet's: the same supervisor, the same world tables and rpcs, the same `world` commands. A new concept would change the foundation's list of concepts, the operation owners and the frozen check for no gain in clarity. What the owner could not find was a single place to read it: the portal's Worlds page (top navigation) opens docs/design/worlds-platform.md and then lists the concept's operations, journeys and decisions that are the worlds design (the book's `WORLDS_PAGE` list, devnet/platform-index.ts)." },
    { label: "new-concept-worlds", text: "Move the records to a `worlds` concept." },
  ],
  chosen: "stay-in-devnet",
  why: OWNER + "\"I don't know where all of that stuff is\": the answer is one page, not one folder. Changing the concept is cheap later if the portal's page is not enough.",
  affects: [...BASE],
});
