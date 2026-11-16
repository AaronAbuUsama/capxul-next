// Where a company site's warp spent its time, as the Capxul app answers it (capxul/core_api.py, `warp`), and the
// attributes it is set as on the span of the site's call (site-ops/world.ts).
//
// The keys and their values' schema (WarpAttributes) are declared once here; telemetry/attributes.ts adds them to the
// declared keys of a span Core exports.
import * as Arr from "effect/Array";
import * as Schema from "effect/Schema";

/** The keys of the attributes a warp's spans carry. */
export const WARP_ATTRIBUTES = {
  /** The company site a site call went to. */
  site: "site.name",
  /** The milliseconds the site itself spent answering, by its own clock: the rest of the span is the way there and back. */
  siteMs: "site.ms",
  /** The world time a stretch of a warp starts from and ends at (site-ops/world.ts, warpSteps). */
  warpFrom: "warp.from",
  warpTo: "warp.to",
  /** What a site spent before its first stop: syncing its job types and setting where they are due from. */
  warpSetupMs: "warp.setup_ms",
  /** Each stop of a site's warp, in order: its milliseconds, and how many jobs it ran (capxul/clock.py, advance). */
  warpStopMs: "warp.stop_ms",
  warpStopJobs: "warp.stop_jobs",
  /** A site's slowest jobs over every stop, the slowest first: each one's method, runs and milliseconds. */
  warpJobs: "warp.jobs",
  warpJobRuns: "warp.job_runs",
  warpJobMs: "warp.job_ms",
} as const;

/**
 * A site's times for one warp: in all (`ms`), before its first stop (`setup_ms`), at each stop with the jobs it ran
 * (`stop_ms`, `stop_jobs`), and its slowest jobs over every stop (`slowest`). A site of an older Capxul app answers
 * none of them.
 */
/** The values a warp's span attributes carry, under their keys. */
export const WarpAttributes = Schema.Struct({
  [WARP_ATTRIBUTES.site]: Schema.String.pipe(Schema.optional),
  [WARP_ATTRIBUTES.siteMs]: Schema.Finite.pipe(Schema.optional),
  [WARP_ATTRIBUTES.warpFrom]: Schema.String.pipe(Schema.optional),
  [WARP_ATTRIBUTES.warpTo]: Schema.String.pipe(Schema.optional),
  [WARP_ATTRIBUTES.warpSetupMs]: Schema.Finite.pipe(Schema.optional),
  [WARP_ATTRIBUTES.warpStopMs]: Schema.Array(Schema.Finite).pipe(Schema.optional),
  [WARP_ATTRIBUTES.warpStopJobs]: Schema.Array(Schema.Int).pipe(Schema.optional),
  [WARP_ATTRIBUTES.warpJobs]: Schema.Array(Schema.String).pipe(Schema.optional),
  [WARP_ATTRIBUTES.warpJobRuns]: Schema.Array(Schema.Int).pipe(Schema.optional),
  [WARP_ATTRIBUTES.warpJobMs]: Schema.Array(Schema.Finite).pipe(Schema.optional),
});

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
      [WARP_ATTRIBUTES.siteMs, times.ms],
      [WARP_ATTRIBUTES.warpSetupMs, times.setup_ms],
      [WARP_ATTRIBUTES.warpStopMs, times.stop_ms],
      [WARP_ATTRIBUTES.warpStopJobs, times.stop_jobs],
      [WARP_ATTRIBUTES.warpJobs, jobs((job) => job.job)],
      [WARP_ATTRIBUTES.warpJobRuns, jobs((job) => job.runs)],
      [WARP_ATTRIBUTES.warpJobMs, jobs((job) => job.ms)],
    ] as const,
    ([, value]) => value !== undefined,
  );
};
