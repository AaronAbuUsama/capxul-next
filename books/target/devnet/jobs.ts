// Devnet's jobs area: run the backend's scheduled work now, without moving the clock. The jobs are
// the crons P3 keeps, each another concept's singleton workflow (access' flag sync and session sweep,
// banking's Bridge catch-up, books' price sync and added-token scan, and notices' daily agreement
// notices when they land), and the due timers of every durable process. The rpc asks the workflow
// engine to start one run of each and waits for them; it never writes another concept's table
// itself (decision devnet.jobs).

import { Schema } from "effect";
import { budget, defineRpc } from "../../../packages/book/src/index.ts";
import { concept_devnet } from "../shared/foundation.ts";
import { error_INVALID_INPUT, error_WORK_DIED } from "../shared/vocabulary.ts";

const OP = "packages/backend/src/operator/jobs";

const S = Schema.String;

/** One job's outcome, as `dev jobs run` prints it. */
export const JobOutcome = Schema.Struct({
  name: S,
  outcome: Schema.Literals(["succeeded", "failed"]),
  detail: Schema.optionalKey(S),
});

export const rpc_devnet_jobs_run = defineRpc({
  id: "devnet.jobs.run",
  title: "Run every cron once, now, and wake the timers that are due",
  about:
    "Starts one run of each cron workflow at once, whether or not it is due (they overlap as they do in production, so it " +
    "waits for the slowest, not their sum), each given now as its scheduled instant, and fires every durable timer due at " +
    "now that the timer pump has not fired yet, counting them. `only` limits it to the named crons and fires no timer: " +
    "the `dev gates set` and `dev prices set` flows run access' flag sync and books' price sync this way, and an unknown " +
    "name is INVALID_INPUT. A warp does not call it: the warp's barrier runs only what fell due, at the instant it fell " +
    "due (decision devnet.warp-barrier). A failed job is reported by name with the first 300 characters of its error " +
    "while the others finish, and the rpc then fails with WORK_DIED naming it and carrying the report. The clock does " +
    "not move. Each run is the workflow's own durable run, with its own idempotency and its own execution id " +
    "(`cron/<name>/manual/<request id>`), so a second call at one frozen instant runs again.",
  was: [`${OP}/operations/run.ts:50`, `${OP}/operations/run.ts:90`, `${OP}/rules.ts:42`, "packages/backend/src/platform/jobs.ts:57"],
  concept: concept_devnet,
  kind: "action",
  who: "devnet only: anyone on the machine that runs the local devnet; no sign-in.",
  input: Schema.Struct({ only: Schema.optionalKey(Schema.Array(S)) }),
  output: Schema.Struct({ at: Schema.DateTimeUtc, jobs: Schema.Array(JobOutcome), timersFired: Schema.Int }),
  errors: [error_INVALID_INPUT, error_WORK_DIED],
  reads: [],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: ["rpc.devnet.jobs.run"],
  budget: budget("background"),
});
