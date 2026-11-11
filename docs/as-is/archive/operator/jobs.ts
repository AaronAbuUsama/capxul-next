// The as-is book of the old operator concept: the jobs area.
//
// Every operation registered at `operator/jobs:*` (packages/backend/convex/operator/jobs.ts): an internal
// action and the internal mutation it pages through, run with `convex run` (`capxul dev jobs run` and
// every devnet warp). Run by hand, not scheduled, so both are rpcs. The scheduled functions it moves live
// in Convex's system table `_scheduled_functions`, which no concept owns and this book has no record of.

import { Schema } from "effect";
import { defineRpc } from "../../../packages/book/src/index.ts";

import { concept_operator } from "../shared/foundation.ts";
import { error_INVALID_INPUT, error_UNKNOWN } from "../shared/vocabulary.ts";

const BACKEND = "packages/backend";
const CONVEX = `${BACKEND}/convex/operator/jobs.ts`;
const J = `${BACKEND}/src/operator/jobs`;
const OPS = `${J}/operations`;

/** requireLocalDevnet (operator/guards.ts:10): INVALID_INPUT `environment` anywhere but a local devnet. */
const LOCAL_WAS = [`${BACKEND}/src/operator/guards.ts:10`, `${BACKEND}/src/operator/errors.ts:6`];

const WHO = "internal: the devnet guardian with `convex run` (`capxul dev jobs run`, every warp); a local devnet only.";

export const rpc_operator_jobs_run = defineRpc({
  id: "operator.jobs.run",
  title: "Run every scheduled job once, now, after a warp",
  about:
    "The internal action `operator/jobs:run` (G7). Local devnet only. With `shiftMs` (or `anchor`) it first walks " +
    "operator.jobs.shift page by page, oldest first, up to the moment the shift began, so the scheduled functions " +
    "waiting for a backend time move with the warp; `since` limits the walk to what an earlier shift created. Then, " +
    "unless `crons: false`, it runs every job `cronJobs()` lists (platform/jobs.ts:57) through `ctx.runAction`, four at " +
    "a time (CAP-1226), each retried up to three calls on a transient Convex failure; a failed job is reported by name " +
    "with the first 300 characters of its message and the others still run. The jobs it runs are other concepts' " +
    "workflows (the Bridge catch-up, payment sweeps, the Movement scan, the drift cycle, …); the schema has no link " +
    "from an rpc to a workflow, so they are named here only. Answers the backend time, each job's outcome, how many " +
    "functions fired now and when the shift began.",
  was: [
    `${CONVEX}:5`,
    `${OPS}/run.ts:50`,
    `${OPS}/run.ts:63`,
    `${OPS}/run.ts:70`,
    `${OPS}/run.ts:90`,
    `${OPS}/run.ts:103`,
    `${J}/rules.ts:42`,
    `${J}/rules.ts:54`,
    `${BACKEND}/src/platform/jobs.ts:57`,
    ...LOCAL_WAS,
  ],
  concept: concept_operator,
  kind: "action",
  who: WHO,
  input: Schema.Struct({
    shiftMs: Schema.optionalKey(Schema.Number),
    since: Schema.optionalKey(Schema.Number),
    anchor: Schema.optionalKey(Schema.Boolean),
    crons: Schema.optionalKey(Schema.Boolean),
  }),
  output: Schema.Struct({
    atMs: Schema.Number,
    jobs: Schema.Array(
      Schema.Struct({
        name: Schema.String,
        outcome: Schema.Literals(["succeeded", "failed"]),
        detail: Schema.optionalKey(Schema.String),
      }),
    ),
    scheduledRun: Schema.Number,
    shiftedFrom: Schema.NullOr(Schema.Number),
  }),
  errors: [error_INVALID_INPUT, error_UNKNOWN],
  reads: [],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_operator_jobs_shift = defineRpc({
  id: "operator.jobs.shift",
  title: "Move one page of backend-time functions by a warp",
  about:
    "The internal mutation `operator/jobs:shift`. Local devnet only; with no positive `byMs` and no `anchor` it does " +
    "nothing. Reads 256 rows of Convex's `_scheduled_functions` created before `before` (and from `since`), and for " +
    "each pending one whose args carry a business due time cancels it and schedules it again `byMs` sooner (or, with " +
    "`anchor`, at the wall time of its business due time), or now when that time has passed. Answers how many fired now " +
    "and the next page's cursor. It writes the Convex scheduler's own system table and creates a scheduled function per " +
    "moved row.",
  was: [`${CONVEX}:6`, `${OPS}/shift.ts:18`, `${OPS}/shift.ts:29`, `${J}/writes.ts:18`, `${J}/writes.ts:35`, `${J}/writes.ts:65`, `${J}/rules.ts:13`, `${J}/rules.ts:23`, `${J}/rules.ts:33`, ...LOCAL_WAS],
  concept: concept_operator,
  kind: "mutation",
  who: "internal: run by operator.jobs.run, page by page (jobs/operations/run.ts:73).",
  input: Schema.Struct({
    byMs: Schema.Number,
    anchor: Schema.optionalKey(Schema.Boolean),
    before: Schema.Number,
    since: Schema.optionalKey(Schema.Number),
    cursor: Schema.optionalKey(Schema.String),
  }),
  output: Schema.Struct({ firedNow: Schema.Number, cursor: Schema.NullOr(Schema.String) }),
  errors: [error_INVALID_INPUT, error_UNKNOWN],
  reads: [],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});
