// The checks of every org.threshold.set (claims.md of board, org.threshold.set 1 to 5): it proposes the threshold
// asked for the Directors the Board has, with one approval, the caller's own, and records one board_change_proposed;
// nothing changes on the chain until it lands. A caller who may not change the Board, a threshold more than the
// Directors or the one the Board has, a company nobody founded and a second change while one waits are each refused,
// and nothing is proposed. A threshold of 0 never leaves the caller: the payload's schema rejects it.
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { expect } from "../expectation.ts";
import { same } from "../support/expect.ts";
import { boardBefore, proposedChecks, refusedChecks, sharedRefusals, type BoardBefore } from "./board-change.ts";
import { check, checks } from "./format.ts";

export const orgThresholdSet = checks<"org.threshold.set", BoardBefore>({
  before: boardBefore,
  success: (asked, proposed, before) => [
    check(
      "it proposes the threshold asked, for the Directors the Board has",
      same(
        "the proposed change",
        [proposed.change.action, proposed.change.person, proposed.change.after],
        ["threshold", null, { directors: proposed.change.before.directors, threshold: asked.payload.threshold }],
      ),
    ),
    ...proposedChecks(asked, proposed, before),
  ],
  refusals: {
    ...sharedRefusals,
    ThresholdTooHigh: (asked, refused, before) =>
      refusedChecks(asked, before, [
        check(
          "ThresholdTooHigh names the threshold asked and the Directors the company Safe has, fewer than it",
          Effect.gen(function* () {
            yield* same(
              "ThresholdTooHigh's company and threshold",
              [refused.org, refused.threshold],
              [asked.payload.org, asked.payload.threshold],
            );
            yield* expect(
              refused.threshold > refused.directors,
              `the threshold ${refused.threshold} is no more than the ${refused.directors} Directors`,
            );
            if (Option.isSome(before.board))
              yield* same("the Directors ThresholdTooHigh counts", refused.directors, before.board.value.owners.length);
          }),
        ),
      ]),
    ThresholdUnchanged: (asked, refused, before) =>
      refusedChecks(asked, before, [
        check(
          "ThresholdUnchanged names the threshold asked, which is the company Safe's",
          Effect.gen(function* () {
            yield* same(
              "ThresholdUnchanged's company and threshold",
              [refused.org, refused.threshold],
              [asked.payload.org, asked.payload.threshold],
            );
            if (Option.isSome(before.board))
              yield* same("the company Safe's threshold", before.board.value.threshold, asked.payload.threshold);
          }),
        ),
      ]),
  },
});
