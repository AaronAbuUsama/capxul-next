// The checks of every org.director.add (claims.md of board, org.director.add 1 to 6): it proposes seating the person
// asked, one more Director at the threshold the Board has, with one approval, the caller's own, and records one
// board_change_proposed; nothing changes on the chain until it lands. A caller who may not change the Board, a person
// who is not a member, a member with no Safe, a Director already, a company nobody founded and a second change while
// one waits are each refused, and nothing is proposed.
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Str from "effect/String";
import { expect } from "../expectation.ts";
import { same } from "../support/expect.ts";
import { castMember } from "../support/world.ts";
import {
  boardBefore,
  namesOrgAnd,
  proposedChecks,
  refusedChecks,
  sharedRefusals,
  type BoardBefore,
} from "./board-change.ts";
import { check, checks, type Asked } from "./format.ts";

type Asking = Asked<"org.director.add">;

/** The person asked's personal Safe is, or is not, an owner of the company Safe. */
const ownsCompanySafe = (asked: Asking, before: BoardBefore, owns: boolean) =>
  check(
    `${asked.payload.person}'s Safe ${owns ? "is" : "is not"} an owner of the company Safe`,
    Effect.gen(function* () {
      if (Option.isNone(before.board)) return;
      const member = yield* castMember(before.world, asked.payload.person);
      const safe = member.safe === null ? "" : Str.toLowerCase(member.safe);
      yield* expect(
        Arr.contains(before.board.value.owners, safe) === owns,
        `${asked.payload.person}'s Safe ${safe} ${owns ? "does not sign" : "signs"} the company Safe`,
      );
    }),
  );

export const orgDirectorAdd = checks<"org.director.add", BoardBefore>({
  before: boardBefore,
  success: (asked, proposed, before) => [
    check(
      "it proposes seating the person asked: one more Director, at the threshold the Board has",
      same(
        "the proposed change",
        [proposed.change.action, proposed.change.person, proposed.change.after],
        [
          "add",
          asked.payload.person,
          { directors: proposed.change.before.directors + 1, threshold: proposed.change.before.threshold },
        ],
      ),
    ),
    ownsCompanySafe(asked, before, false),
    ...proposedChecks(asked, proposed, before),
  ],
  refusals: {
    ...sharedRefusals,
    NotAMember: (asked, refused, before) =>
      refusedChecks(asked, before, [namesOrgAnd("NotAMember", refused, asked, asked.payload.person)]),
    MemberHasNoSafe: (asked, refused, before) =>
      refusedChecks(asked, before, [
        namesOrgAnd("MemberHasNoSafe", refused, asked, asked.payload.person),
        check(
          "the member has no claimed personal Safe",
          Effect.flatMap(castMember(before.world, asked.payload.person), (member) =>
            same(`${member.person}'s Safe`, member.safe, null),
          ),
        ),
      ]),
    AlreadyADirector: (asked, refused, before) =>
      refusedChecks(asked, before, [
        namesOrgAnd("AlreadyADirector", refused, asked, asked.payload.person),
        ownsCompanySafe(asked, before, true),
      ]),
  },
});
