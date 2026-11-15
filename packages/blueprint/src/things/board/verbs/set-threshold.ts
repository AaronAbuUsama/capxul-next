// `capxul board set-threshold` (today `org.threshold.set`): how many Directors must sign.
import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import { verb, claim } from "@capxul/blueprint-tools";
import { NotImplemented, OrgNotFound } from "../../../common/refusals.ts";
import { OrgId } from "../../../common/values.ts";
import { startingWorlds as w, type ClaimsOf } from "../../../starting-points/points.ts";
import { BoardChangeProposed } from "../events.ts";
import { proposed } from "../values.ts";
import { founderApproval } from "../examples.ts";
import { BoardChangeWaiting, CannotChangeBoard, ThresholdTooHigh, ThresholdUnchanged } from "../refusals.ts";
import { Proposed, Threshold } from "../values.ts";

export const thresholdSet = verb({
  rpc: Rpc.make("org.threshold.set", {
    payload: {
      org: OrgId,
      /** How many Directors must sign every transaction of the company Safe, from 1 to the number of Directors. */
      threshold: Threshold,
    },
    success: Proposed,
    error: Schema.Union([
      OrgNotFound,
      CannotChangeBoard,
      ThresholdTooHigh,
      ThresholdUnchanged,
      BoardChangeWaiting,
      NotImplemented,
    ]),
  }),
  emits: [{ event: BoardChangeProposed, carries: proposed }],
  budget: {
    ms: 4_000,
    excludes: ["waking a parked world"],
    provisional: true,
    basis:
      "live reads of the company Safe, the Hats protocol and the Signer Gate on the world's chain, then preparing one UserOperation of the founder's Safe",
  },
  examples: [
    {
      payload: { org: "org_northwind1", threshold: 3 },
      success: {
        change: {
          id: "bch_three001",
          action: "threshold",
          person: null,
          before: { directors: 3, threshold: 2 },
          after: { directors: 3, threshold: 3 },
          state: "proposed",
        },
        approval: founderApproval("apr_three001"),
      },
    },
  ],
});

/** Who serves it: a world's Core, through the world's door (`WorldRpcs`). */
export const server = "world";

/** What `org.threshold.set` promises, each promise checked by the journeys. */
export const promises: ClaimsOf = {
  operation: thresholdSet,
  claims: [
    claim(
      "The founder sets how many Directors must sign: one approval, the founder's own, and its signature alone lands it; the company Safe then needs that many.",
      w.founded,
      "With sam seated, org.threshold.set as dana to 3 answers the change proposed, 3 Directors at 2 before and at 3 after, and one approval, dana's. The record gains one board_change_proposed, and chain.safe still reads threshold 2. approval.sign by dana answers Sent at once: its transaction is one UserOperation of dana's Safe, chain.safe reads threshold 3 with the same three owners, and org.director.list answers 3.",
      { thinLine: true },
    ),
    claim(
      "Every proposal of the Board then needs the new threshold, and the new Director signs it.",
      w.founded,
      "After the threshold is 3, org.member.grant as dana of manage-books to sam answers one approval each for dana, eli and sam and a proposal of threshold 3. approval.sign by dana answers Collected, 1 of 3, and by eli Collected, 2 of 3, where 2 of 2 would have sent it; sam's answers Sent, and his Safe wears the Books hat (chain.wears).",
    ),
    claim(
      "Only the founder sets it: a Director who did not found the company is refused, and nothing is proposed.",
      w.founded,
      "org.threshold.set as sam, a Director once seated, is refused with CannotChangeBoard naming Northwind and sam. record.export shows no new entry.",
      { refusals: [CannotChangeBoard] },
    ),
    claim(
      "A threshold of none, more than the Directors, or the one the Board has, is refused, and nothing is proposed.",
      w.founded,
      "With 3 Directors at 2, a threshold of 0 is rejected by the payload's schema before it is sent (PayloadRejected naming org.threshold.set); 4 is refused with ThresholdTooHigh naming 4 and 3 Directors; 2 with ThresholdUnchanged; a company nobody founded with OrgNotFound. record.export shows no new entry for any of them.",
      { refusals: [ThresholdTooHigh, ThresholdUnchanged, OrgNotFound] },
    ),
    claim(
      "A second change to the Board is refused while one waits.",
      w.founded,
      "While the change to 3 waits for dana's signature, org.threshold.set as dana to 1 is refused with BoardChangeWaiting naming it. record.export shows no new entry.",
      { refusals: [BoardChangeWaiting] },
    ),
  ],
  dropped: [],
};
