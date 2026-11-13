// world.clock.warp, claim 1: a warp moves the chain and every site together and runs what fell due. The site's
// daily job (Site.DAILY_JOB) is read from the Scheduled Job Log as dana, a Director with a site user.
import { Site } from "@capxul/blueprint";
import * as Effect from "effect/Effect";
import { Capxul } from "../client.ts";
import { expect, scenario } from "../scenario.ts";
import { addSeconds, millis, refusal, same, sameInstant } from "../support/expect.ts";
import { report } from "../support/site.ts";
import { northwind, thisView } from "../support/world.ts";

const WEEK = 7 * 24 * 3600;

export const worldClockWarp1 = scenario(
  { operation: "world.clock.warp", claim: 1 },
  Effect.gen(function* () {
    const capxul = yield* Capxul;
    const { org } = yield* northwind;
    const world = yield* thisView;
    const runs = report(
      org,
      Site.REPORTS.scheduledJobLog,
      { [Site.FILTERS.scheduledJobLog.job]: Site.DAILY_JOB.jobType },
      { as: "dana" },
    );
    const before = yield* runs;
    const warped = yield* capxul["world.clock.warp"]({ target: { _tag: "by", seconds: WEEK } });
    yield* sameInstant("the warp's from", warped.from, world.clock.now);
    yield* sameInstant("the clock after the warp", warped.clock.now, addSeconds(world.clock.now, WEEK));
    yield* same("the sites that followed", warped.sites, 1);
    yield* sameInstant("world.show's clock", (yield* thisView).clock.now, warped.clock.now);
    const block = yield* capxul.chain.head({});
    yield* expect(
      millis(block.timestamp) >= millis(warped.clock.now),
      `the chain's head is at ${block.timestamp}, before the clock's ${warped.clock.now}`,
    );
    const after = yield* runs;
    yield* same(`the runs of ${Site.DAILY_JOB.jobType} the week added`, after.length - before.length, 7);

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
