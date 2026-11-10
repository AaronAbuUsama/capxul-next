// The journeys of the worlds platform, each a list of operations proved by an event or by success (policy P7). An organiser sets up a run for a cohort; an agent plays a seat; a run closes and its data is exported
// and accepted; a learner uses a `core` world as an environment. The journey of a human tester is specified and WAITS on Capxul Core's sign-in design (aaron.sign-in-is-core): it is marked so in its text.

import { defineJourney } from "../../packages/blueprint-engine/src/index.ts";
import * as life from "./platform-lifecycle.ts";
import * as acc from "./platform-access.ts";
import * as sc from "./platform-scenarios.ts";
import * as run from "./platform-runs.ts";
import * as ds from "./platform-datasets.ts";
import * as co from "./platform-cohorts.ts";
import * as env from "./platform-env.ts";
import { event_cohort_transitioned, event_run_transitioned } from "./platform-data.ts";
import { event_world_transitioned } from "./world-data.ts";
import * as w from "./world-ops.ts";

const DOC = "docs/design/worlds-platform.md (Journeys)";

export const journey_organiser_runs_a_cohort = defineJourney({
  id: "organiser_runs_a_cohort",
  title: "An organiser sets up a scenario run for a cohort",
  about: "The organiser publishes a scenario, checks it, plans a cohort from a file of keys, watches the runs open in waves and start, and sees who is in which run and how each is going. Agents fill the seats now; a person's seat is specified and waits on Capxul Core's sign-in (aaron.sign-in-is-core).",
  steps: [
    { operation: sc.operation_scenario_save, as: "operator", proves: "success" },
    { operation: sc.operation_scenario_check, as: "operator", proves: "success" },
    { operation: co.operation_cohort_create, as: "operator", proves: event_cohort_transitioned },
    { operation: acc.operation_world_invite_create, as: "operator", proves: "success" },
    { operation: run.operation_run_start, as: "operator", proves: event_run_transitioned },
    { operation: co.operation_cohort_show, as: "operator", proves: "success" },
    { operation: run.operation_run_seat_drop, as: "operator", proves: event_run_transitioned },
  ],
  was: [DOC],
});

export const journey_agent_plays_a_seat = defineJourney({
  id: "agent_plays_a_seat",
  title: "An agent with a key joins a world and plays a seat",
  about: "The organiser makes an invitation bound to the agent's key; the agent joins (an account and a Safe in this world and nothing from another), makes the world current and works the seat through the CLI under its hats; every command is an entry in the record.",
  steps: [
    { operation: acc.operation_world_invite_create, as: "operator", proves: "success" },
    { operation: acc.operation_world_join, as: "agent", proves: "success" },
    { operation: life.operation_world_use, as: "agent", proves: "success" },
    { operation: life.operation_world_current, as: "agent", proves: "success" },
    { operation: w.operation_record_list, as: "agent", proves: "success" },
  ],
  was: [DOC],
});

export const journey_tester_plays_through_screens = defineJourney({
  id: "tester_plays_through_screens",
  title: "A tester with a key plays a seat through the screens (waits on Core's sign-in)",
  about: "WAITING on Capxul Core's sign-in and signing design (aaron.sign-in-is-core): specified, not opened. A person with a key joins with their consent, opens their company's screens by a one-time link, plays the seat and signs in the pop-up that shows what is being signed. Until that exists, `world viewer link` and a human seat are refused CAPABILITY_UNAVAILABLE.",
  steps: [
    { operation: acc.operation_world_join, as: "person", proves: "success" },
    { operation: acc.operation_world_viewer_link, as: "person", proves: "success" },
    { operation: acc.operation_world_grant_list, as: "person", proves: "success" },
  ],
  was: [DOC],
});

export const journey_run_closes_and_is_accepted = defineJourney({
  id: "run_closes_and_is_accepted",
  title: "A run closes, its data is exported and accepted, and its world is archived",
  about: "The run ends, it is checked (no gap, books agree with the chain, no secret, consent), exported as one dataset with its manifest, accepted or rejected, and its world parked, the data kept.",
  steps: [
    { operation: run.operation_run_close, as: "operator", proves: event_run_transitioned },
    { operation: ds.operation_run_check, as: "operator", proves: "success" },
    { operation: ds.operation_run_export, as: "operator", proves: "success" },
    { operation: ds.operation_run_accept, as: "operator", proves: event_run_transitioned },
    { operation: ds.operation_run_archive, as: "operator", proves: event_run_transitioned },
  ],
  was: [DOC],
});

export const journey_learner_uses_a_core_world = defineJourney({
  id: "learner_uses_a_core_world",
  title: "A learner uses a core world as an environment",
  about: "Reset makes a world from a scenario and a seed, step runs one command and returns the observation, the reward as deltas, done and the entries, state reads without stepping, and close frees the world. Thousands run in parallel on `core`.",
  steps: [
    { operation: env.operation_env_reset, as: "agent", proves: event_run_transitioned },
    { operation: env.operation_env_step, as: "agent", proves: "success" },
    { operation: env.operation_env_state, as: "agent", proves: "success" },
    { operation: env.operation_env_close, as: "agent", proves: "success" },
  ],
  was: [DOC],
});

export const journey_world_parks_and_wakes = defineJourney({
  id: "world_parks_and_wakes",
  title: "An idle world is parked and wakes where it stopped",
  about: "A world is paused, parked to storage only, resumed on demand with every company's data as it was, and finally destroyed, its record kept.",
  steps: [
    { operation: life.operation_world_pause, as: "operator", proves: event_world_transitioned },
    { operation: life.operation_world_park, as: "operator", proves: event_world_transitioned },
    { operation: life.operation_world_resume, as: "operator", proves: event_world_transitioned },
    { operation: life.operation_world_destroy, as: "operator", proves: event_world_transitioned },
  ],
  was: [DOC],
});
