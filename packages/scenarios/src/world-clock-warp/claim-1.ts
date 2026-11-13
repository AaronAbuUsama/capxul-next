// world.clock.warp, claim 1: a warp moves the chain and every site together and runs what fell due. The site's
// daily job is read from the Scheduled Job Log as dana, a Director with a site user: some job must have run exactly
// once a day, seven times. Not checked: the chain head's timestamp, which only the door's chain RPC shows.
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import { Capxul } from "../client.ts";
import { expect, scenario } from "../scenario.ts";
import { addSeconds, refusal, same, sameInstant, show } from "../support/expect.ts";
import { report, REPORTS } from "../support/books.ts";
import { northwind, textOf, thisView } from "../support/world.ts";

const WEEK = 7 * 24 * 3600;
/** The Scheduled Job Log's field naming the job that ran. */
const JOB = "scheduled_job_type";

export const worldClockWarp1 = scenario(
  { operation: "world.clock.warp", claim: 1 },
  Effect.gen(function* () {
    const capxul = yield* Capxul;
    const { world, org } = yield* northwind;
    const before = yield* report(org, REPORTS.scheduledJobLog, {}, "dana");
    const warped = yield* capxul["world.clock.warp"]({ target: { _tag: "by", seconds: WEEK } });
    yield* sameInstant("the warp's from", warped.from, world.clock.now);
    yield* sameInstant("the clock after the warp", warped.clock.now, addSeconds(world.clock.now, WEEK));
    yield* same("the sites that followed", warped.sites, 1);
    yield* sameInstant("world.show's clock", (yield* thisView).clock.now, warped.clock.now);

    const after = yield* report(org, REPORTS.scheduledJobLog, {}, "dana");
    const runsOf = (rows: typeof after, job: string) => Arr.filter(rows, (row) => textOf(row, JOB) === job).length;
    const jobs = Arr.filter(Arr.dedupe(Arr.map(after, (row) => textOf(row, JOB))), (job) => job !== "");
    const gained = Arr.map(jobs, (job) => ({ job, runs: runsOf(after, job) - runsOf(before, job) }));
    yield* expect(
      Arr.some(gained, (each) => each.runs === 7),
      `no job ran once for each of the 7 days; the runs each job gained: ${show(gained)}`,
    );

    const backwards = yield* refusal(
      "a warp to an earlier time",
      "ClockBackwards",
      capxul["world.clock.warp"]({ target: { _tag: "to", at: world.clock.now } }),
    );
    yield* sameInstant("ClockBackwards's now", backwards.now, warped.clock.now);
    yield* sameInstant("ClockBackwards's asked", backwards.asked, world.clock.now);
    yield* sameInstant("the clock after the refused warp", (yield* thisView).clock.now, warped.clock.now);
  }),
);
