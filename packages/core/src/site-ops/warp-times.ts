// Where a company site's warp spent its time, as the Capxul app answers it (capxul/core_api.py, `warp`), and the
// attributes it is recorded as on the span of the site's call (site-ops/world.ts, telemetry/attributes.ts).
import * as Arr from "effect/Array";
import * as Schema from "effect/Schema";
import { SPAN_ATTRIBUTES } from "../telemetry/attributes.ts";

/**
 * A site's times for one warp: in all (`ms`), before its first stop (`setup_ms`), at each stop with the jobs it ran
 * (`stop_ms`, `stop_jobs`), and its slowest jobs over every stop (`slowest`). A site of an older Capxul app answers
 * none of them.
 */
export const WarpTimes = Schema.Struct({
  ms: Schema.Finite.pipe(Schema.optional),
  setup_ms: Schema.Finite.pipe(Schema.optional),
  stop_ms: Schema.Array(Schema.Finite).pipe(Schema.optional),
  stop_jobs: Schema.Array(Schema.Int).pipe(Schema.optional),
  slowest: Schema.Array(Schema.Struct({ job: Schema.String, runs: Schema.Int, ms: Schema.Finite })).pipe(
    Schema.optional,
  ),
});
export type WarpTimes = typeof WarpTimes.Type;

/** The span attributes of a site's times: those it answered, each under its declared key. */
export const timesOf = (times: WarpTimes): ReadonlyArray<readonly [string, unknown]> => {
  const { slowest } = times;
  const jobs = <B>(of: (job: NonNullable<WarpTimes["slowest"]>[number]) => B) =>
    slowest === undefined ? undefined : Arr.map(slowest, of);
  return Arr.filter(
    [
      [SPAN_ATTRIBUTES.siteMs, times.ms],
      [SPAN_ATTRIBUTES.warpSetupMs, times.setup_ms],
      [SPAN_ATTRIBUTES.warpStopMs, times.stop_ms],
      [SPAN_ATTRIBUTES.warpStopJobs, times.stop_jobs],
      [SPAN_ATTRIBUTES.warpJobs, jobs((job) => job.job)],
      [SPAN_ATTRIBUTES.warpJobRuns, jobs((job) => job.runs)],
      [SPAN_ATTRIBUTES.warpJobMs, jobs((job) => job.ms)],
    ] as const,
    ([, value]) => value !== undefined,
  );
};
