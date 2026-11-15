// The checks of every invite.decline (claims.md of people, invite.decline 1 and 2): the caller's pending invitation is
// declined and they do not join; the record gains one invitation_declined, carrying neither who declined nor the
// email, and the chain is not written. Another's invitation, one no longer pending and one nobody sent are each
// refused, and nothing is recorded.
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { expect } from "../expectation.ts";
import { same } from "../support/expect.ts";
import { chainUntouched, peopleOf, recordedOnly } from "../support/people.ts";
import { callerOf } from "./common.ts";
import { check, checks } from "./format.ts";
import { answerRefusals, answeringBefore, mineBefore, type Answering } from "./invite-answer.ts";

export const inviteDecline = checks<"invite.decline", Answering>({
  before: (asked) => answeringBefore(asked.options),
  success: (asked, declined, before) => [
    check(
      "it answers the caller's pending invitation asked, now declined and otherwise as it was",
      same(
        "the declined invitation",
        Option.some(declined),
        Option.map(mineBefore(before, asked.payload.invitation), (each) =>
          each.state === "pending" ? { ...each, state: "declined" } : each,
        ),
      ),
    ),
    check(
      "the record gains one invitation_declined, carrying only invitation and org",
      recordedOnly("invitation_declined", { invitation: declined.id, org: declined.org }, before.head, before.where),
    ),
    check("nothing is written to the chain", chainUntouched(before.world, before.where, before.chain, declined.org)),
    check(
      "the caller does not belong to the company",
      Effect.gen(function* () {
        const people = yield* peopleOf(declined.org, before.where);
        yield* expect(
          !Arr.some(people, (each) => each.person === callerOf(asked.options)),
          `${callerOf(asked.options)} is among ${declined.org}'s people after declining`,
        );
      }),
    ),
  ],
  refusals: answerRefusals("the refused decline"),
});
