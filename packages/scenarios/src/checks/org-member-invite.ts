// The checks of every org.member.invite (claims.md of people, org.member.invite 1 to 4): an invitation is pending at
// once, of the email and role asked, from the caller, the company's founder, to the company asked; nothing is signed,
// so the record gains one member_invited carrying neither the email nor whose it is, and the chain is not written; its
// invitee, when a person of the world, lists it. A caller who is not the founder (another Director included, for now:
// docs/roadmap.md, "Who may invite"), a person who already belongs, an email already invited and a company nobody
// founded are each refused, and nothing is recorded.
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { expect } from "../expectation.ts";
import { same } from "../support/expect.ts";
import {
  chainBlock,
  chainUntouched,
  founderOf,
  invitationsOf,
  peopleOf,
  personWith,
  recordedOnly,
} from "../support/people.ts";
import { callerOf, nothingRecorded, worldBefore, type Before } from "./common.ts";
import { check, checks, type Asked, type Check } from "./format.ts";

type Asking = Asked<"org.member.invite">;

interface Read extends Before {
  /** The chain's latest block before the call. */
  readonly chain: number;
}

const refusedFor = (before: Read, also: ReadonlyArray<Check>) => [
  ...also,
  nothingRecorded("the refused invitation", before),
];

/** The invitee's own list, when the email is a person's of the world. */
const inviteeLists = (asked: Asking, before: Read, id: string, state: string) =>
  Effect.gen(function* () {
    const invitee = personWith(before.world, asked.payload.email);
    if (Option.isNone(invitee)) return;
    const listed = Arr.filter(yield* invitationsOf(invitee.value, before.where), (each) => each.id === id);
    yield* same(
      `the invitations ${invitee.value} lists with id ${id}`,
      Arr.map(listed, (each) => each.state),
      [state],
    );
  });

export const orgMemberInvite = checks<"org.member.invite", Read>({
  before: (asked) =>
    Effect.gen(function* () {
      const base = yield* worldBefore(asked.options);
      return { ...base, chain: yield* chainBlock(base.where) };
    }),
  success: (asked, invited, before) => [
    check(
      "it answers a pending invitation of the email and role asked, to the company asked, from the caller",
      same(
        "the invitation",
        [invited.org, invited.email, invited.role, invited.invitedBy, invited.state],
        [asked.payload.org, asked.payload.email, asked.payload.role, callerOf(asked.options), "pending"],
      ),
    ),
    check(
      "the caller who invited is the company's founder, as its org_founded names them",
      Effect.flatMap(founderOf(asked.payload.org, before.where), (founder) =>
        same("who invited", invited.invitedBy, founder),
      ),
    ),
    check(
      "the record gains one member_invited, carrying only invitation, org, role and by: nothing is signed",
      recordedOnly(
        "member_invited",
        { invitation: invited.id, org: asked.payload.org, role: asked.payload.role, by: invited.invitedBy },
        before.head,
        before.where,
      ),
    ),
    check(
      "nothing is written to the chain",
      chainUntouched(before.world, before.where, before.chain, asked.payload.org),
    ),
    check(
      "its invitee, when a person of the world, lists it pending",
      inviteeLists(asked, before, invited.id, "pending"),
    ),
  ],
  refusals: {
    CannotManagePeople: (asked, refused, before) =>
      refusedFor(before, [
        check(
          "CannotManagePeople names the company and the caller",
          same("CannotManagePeople", [refused.org, refused.person], [asked.payload.org, callerOf(asked.options)]),
        ),
        check(
          "the caller is not the company's founder, as its org_founded names them",
          Effect.gen(function* () {
            const founder = yield* founderOf(asked.payload.org, before.where);
            yield* expect(
              refused.person !== founder,
              `${refused.person} is ${asked.payload.org}'s founder, who may invite, yet was refused`,
            );
          }),
        ),
      ]),
    AlreadyAMember: (asked, refused, before) =>
      refusedFor(before, [
        check(
          "AlreadyAMember names the company and the person who signs in with the email asked",
          same(
            "AlreadyAMember",
            [refused.org, Option.some(refused.person)],
            [asked.payload.org, personWith(before.world, asked.payload.email)],
          ),
        ),
        check(
          "that person belongs to the company",
          Effect.gen(function* () {
            const people = yield* peopleOf(asked.payload.org, before.where);
            yield* expect(
              Arr.some(people, (each) => each.person === refused.person),
              `${refused.person} is not among ${asked.payload.org}'s people`,
            );
          }),
        ),
      ]),
    AlreadyInvited: (asked, refused, before) =>
      refusedFor(before, [
        check(
          "AlreadyInvited names the company and the email asked",
          same("AlreadyInvited", [refused.org, refused.email], [asked.payload.org, asked.payload.email]),
        ),
        check(
          "the invitation it names is pending, as its invitee lists it",
          inviteeLists(asked, before, refused.invitation, "pending"),
        ),
      ]),
    OrgNotFound: (asked, refused, before) =>
      refusedFor(before, [
        check("OrgNotFound names the company asked", same("its org", refused.org, asked.payload.org)),
      ]),
  },
});
