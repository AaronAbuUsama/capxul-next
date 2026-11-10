// The worlds platform's durable processes: a cohort opens its runs in waves within the machine's room, and a run is watched for its end and for a silent seat. Both are small and started by a timer.

import { budget, defineWorkflow } from "../../../packages/book/src/index.ts";
import { concept_devnet } from "../shared/foundation.ts";
import { machine_cohort, machine_run, table_cohorts, table_run_seats, table_runs } from "./platform-data.ts";
import { table_worlds } from "./world-data.ts";

const DOC = "docs/design/worlds-platform.md";

export const workflow_devnet_cohorts_waves = defineWorkflow({
  id: "devnet.cohorts.waves",
  title: "Open a cohort's runs in waves within the machine's room",
  about:
    "Every minute, for each cohort that is planned or running: if its start time has come and the machine has room by profile (devnet.world-capacity), open the next planned run (its world is already made from the scenario's template), until `at-once` runs are open or live. The first opened run starts the cohort. " +
    "A cohort whose every run has ended is closed. It never opens a run the machine has no room for: that run waits in the queue and `cohort show` says so.",
  concept: concept_devnet, priority: "normal", trigger: { cron: "* * * * *" }, instance: "singleton",
  steps: [{ name: "find", about: "Finds cohorts with a planned run and room to open it." }, { name: "open", about: "Opens the next planned run and starts the cohort when it is the first." }],
  reads: [table_cohorts, table_runs, table_worlds], writes: [table_cohorts, table_runs], drives: [machine_run.t.open, machine_cohort.t.start, machine_cohort.t.close], invokes: [], emits: [], calls: [], chain: [],
  idempotency: "An open run is not opened again; a started cohort is not started again.", timeoutMs: 60_000, retries: { max: 2, backoff: "fixed" }, budget: budget("background"), was: [DOC],
});

export const workflow_devnet_runs_watch = defineWorkflow({
  id: "devnet.runs.watch",
  title: "Watch a run for its end and for a silent seat",
  about:
    "Every minute, for each live run: if the scenario's end is reached (the world's time passed `afterWorldTime`, or its `orWhen` holds) close the run with the reason `end`; if a human seat's key has been silent longer than the scenario allows, apply the scenario's drop-out policy (an agent takes the seat with a `handover` entry, or the run pauses). " +
    "Agents' seats are never dropped for silence: an agent that stops is the harness's fault, and the run records it.",
  concept: concept_devnet, priority: "normal", trigger: { cron: "* * * * *" }, instance: "singleton",
  steps: [{ name: "end", about: "Closes runs whose end is reached." }, { name: "silent", about: "Applies the drop-out policy to a silent human seat." }],
  reads: [table_runs, table_run_seats, table_worlds], writes: [table_runs, table_run_seats], drives: [machine_run.t.close, machine_run.t.pause], invokes: [], emits: [], calls: [], chain: [],
  idempotency: "A closed run is not closed again; a dropped seat is not dropped again.", timeoutMs: 60_000, retries: { max: 2, backoff: "fixed" }, budget: budget("background"), was: [DOC],
});
