// The checks of every org.member.list (claims.md of people, org.member.list 1 and 2): the company asked, each person
// once under the email of their cast entry, its Directors before its members, the caller among them when the caller is
// a person; reading it records nothing. Someone who does not belong, and a company nobody founded, are refused.
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import { expect } from "../expectation.ts";
import { same } from "../support/expect.ts";
import { emailOf } from "../support/people.ts";
import { callerOf, nothingRecorded, worldBefore, type Before } from "./common.ts";
import { check, checks } from "./format.ts";

export const orgMemberList = checks<"org.member.list", Before>({
  before: (asked) => worldBefore(asked.options),
  success: (asked, listed, before) => [
    check("it answers the company asked", same("its org", listed.org, asked.payload.org)),
    check(
      "each person once, under the email of their cast entry",
      Effect.gen(function* () {
        const people = Arr.map(listed.members, (each) => each.person);
        yield* same("its people, each once", Arr.dedupe(people), people);
        for (const each of listed.members)
          yield* same(`${each.person}'s email`, each.email, emailOf(before.world, each.person));
      }),
    ),
    check(
      "its Directors come before its members",
      Effect.gen(function* () {
        const roles = Arr.map(listed.members, (each) => each.role);
        const firstMember = Arr.findFirstIndex(roles, (role) => role === "member");
        const lastDirector = Arr.findLastIndex(roles, (role) => role === "director");
        yield* expect(
          firstMember._tag === "None" || lastDirector._tag === "None" || lastDirector.value < firstMember.value,
          `a Director follows a member: ${Arr.join(roles, ", ")}`,
        );
      }),
    ),
    check(
      "a person who asks is among them",
      asked.options.as === undefined
        ? Effect.void
        : expect(
            Arr.some(listed.members, (each) => each.person === callerOf(asked.options)),
            `${callerOf(asked.options)} saw ${asked.payload.org}'s people without being among them`,
          ),
    ),
    nothingRecorded("org.member.list", before),
  ],
  refusals: {
    NotAMember: (asked, refused, before) => [
      check(
        "NotAMember names the company and the caller",
        same("NotAMember", [refused.org, refused.person], [asked.payload.org, callerOf(asked.options)]),
      ),
      nothingRecorded("the refused org.member.list", before),
    ],
    OrgNotFound: (asked, refused, before) => [
      check("OrgNotFound names the company asked", same("its org", refused.org, asked.payload.org)),
      nothingRecorded("the refused org.member.list", before),
    ],
  },
});
