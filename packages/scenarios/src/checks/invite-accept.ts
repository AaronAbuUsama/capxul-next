// The checks of every invite.accept (claims.md of people, invite.accept 1 to 3): the caller's pending invitation is
// accepted and the caller is a member at once, as a member, under the email they sign in with; the record gains one
// invitation_accepted and the chain is not written. Accepting again answers the same and records nothing. Another's
// invitation, one no longer pending and one nobody sent are each refused, and nothing is recorded.
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { same } from "../support/expect.ts";
import { chainUntouched, emailOf, peopleOf, recordedOnly } from "../support/people.ts";
import { callerOf, nothingRecorded } from "./common.ts";
import { check, checks, type Asked } from "./format.ts";
import { answerRefusals, answeringBefore, mineBefore, type Answering } from "./invite-answer.ts";

type Asking = Asked<"invite.accept">;
type Answer = { readonly invitation: { readonly id: string; readonly state: string; readonly org: string } } & {
  readonly member: { readonly person: string; readonly email: string; readonly role: string };
};

/** What both kinds of success answer: the invitation asked, accepted, and the caller as a member. */
const acceptedChecks = (asked: Asking, answer: Answer, before: Answering) => [
  check(
    "it answers the invitation asked, accepted, and the caller a member under the email they sign in with",
    same(
      "the acceptance",
      [answer.invitation.id, answer.invitation.state, answer.member],
      [
        asked.payload.invitation,
        "accepted",
        { person: callerOf(asked.options), email: emailOf(before.world, callerOf(asked.options)), role: "member" },
      ],
    ),
  ),
  check(
    "the company lists the caller once, as a member",
    Effect.gen(function* () {
      const people = yield* peopleOf(answer.invitation.org, before.where);
      yield* same(
        `${callerOf(asked.options)} among ${answer.invitation.org}'s people`,
        Arr.filter(people, (each) => each.person === callerOf(asked.options)),
        [answer.member],
      );
    }),
  ),
];

export const inviteAccept = checks<"invite.accept", Answering>({
  before: (asked) => answeringBefore(asked.options),
  success: (asked, answer, before) => [
    ...acceptedChecks(asked, answer, before),
    ...(answer._tag === "Accepted"
      ? [
          check(
            "the invitation was the caller's, pending",
            same(
              "the caller's invitation before",
              Option.map(mineBefore(before, asked.payload.invitation), (each) => each.state),
              Option.some("pending"),
            ),
          ),
          check(
            "the record gains one invitation_accepted, carrying only invitation, org, person and role",
            recordedOnly(
              "invitation_accepted",
              {
                invitation: answer.invitation.id,
                org: answer.invitation.org,
                person: answer.member.person,
                role: answer.invitation.role,
              },
              before.head,
              before.where,
            ),
          ),
          check("nothing is written to the chain", chainUntouched(before.world, before.where, before.chain)),
        ]
      : [
          check(
            "the caller had accepted it already",
            same(
              "the caller's invitation before",
              Option.map(mineBefore(before, asked.payload.invitation), (each) => each.state),
              Option.some("accepted"),
            ),
          ),
          nothingRecorded("accepting again", before),
        ]),
  ],
  refusals: answerRefusals("the refused acceptance"),
});
