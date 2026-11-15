// The checks of every invitation.list (claims.md of people, invitation.list 1): every invitation it answers was sent to the
// caller's own email, each once, oldest first, and reading them records nothing.
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import { expect } from "../expectation.ts";
import { millis, same } from "../support/expect.ts";
import { emailOf } from "../support/people.ts";
import { callerOf, nothingRecorded, worldBefore, type Before } from "./common.ts";
import { check, checks } from "./format.ts";

export const invitationList = checks<"invitation.list", Before>({
  before: (asked) => worldBefore(asked.options),
  success: (asked, listed, before) => [
    check(
      "every invitation it answers was sent to the caller's email",
      Effect.forEach(
        listed.invitations,
        (each) => same(`${each.id}'s email`, each.email, emailOf(before.world, callerOf(asked.options))),
        { discard: true },
      ),
    ),
    check(
      "each invitation once, oldest first",
      Effect.gen(function* () {
        const ids = Arr.map(listed.invitations, (each) => each.id);
        yield* same("the invitations' ids, each once", Arr.dedupe(ids), ids);
        const times = Arr.map(listed.invitations, (each) => millis(each.invitedAt));
        yield* expect(
          Arr.every(times, (time, index) => index === 0 || (times[index - 1] ?? time) <= time),
          `the invitations are not oldest first: ${Arr.join(
            Arr.map(listed.invitations, (each) => each.invitedAt),
            ", ",
          )}`,
        );
      }),
    ),
    nothingRecorded("invitation.list", before),
  ],
  refusals: {},
});
