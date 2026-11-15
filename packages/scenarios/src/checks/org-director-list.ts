// The checks of every org.director.list (claims.md of board, org.director.list 1 and 2): the company asked, each
// Director once with the personal Safe of their cast entry, the founder first; their Safes are the company Safe's
// owners and the threshold its threshold, on the chain, and each Safe wears the Director hat it names; reading it
// records nothing. Someone who does not belong, and a company nobody founded, are refused.
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { Capxul } from "../client.ts";
import { expect } from "../expectation.ts";
import { foundingOf, onChain, sorted } from "../support/board.ts";
import { same, sameAddress } from "../support/expect.ts";
import { castMember, whereOf } from "../support/world.ts";
import { callerOf, nothingRecorded, worldBefore, type Before } from "./common.ts";
import { check, checks } from "./format.ts";

export const orgDirectorList = checks<"org.director.list", Before>({
  before: (asked) => worldBefore(asked.options),
  success: (asked, listed, before) => [
    check("it answers the company asked", same("its org", listed.org, asked.payload.org)),
    check(
      "each Director once, with the personal Safe of their cast entry",
      Effect.gen(function* () {
        const people = Arr.map(listed.directors, (each) => each.person);
        yield* same("its Directors, each once", Arr.dedupe(people), people);
        for (const each of listed.directors)
          yield* sameAddress(`${each.person}'s Safe`, each.safe, (yield* castMember(before.world, each.person)).safe);
      }),
    ),
    check(
      "the founder comes first, and the Directors' Safes and the threshold are the company Safe's, on the chain",
      Effect.gen(function* () {
        const founding = yield* foundingOf(asked.payload.org);
        if (Option.isNone(founding)) return;
        yield* same(
          "the first Director",
          Option.getOrNull(Option.map(Arr.head(listed.directors), (each) => each.person)),
          founding.value.founder,
        );
        const board = yield* onChain(founding.value.safe, before.where);
        yield* same(
          "the Directors' Safes and the threshold",
          [sorted(Arr.map(listed.directors, (each) => each.safe)), listed.threshold],
          [board.owners, board.threshold],
        );
      }),
    ),
    check(
      "each Director's Safe wears the Director hat it names",
      Effect.gen(function* () {
        const capxul = yield* Capxul;
        for (const each of listed.directors)
          yield* expect(
            yield* capxul.chain.wears(
              { hats: before.world.contracts.hats, hat: listed.directorHat, wearer: each.safe, block: null },
              whereOf(asked.options),
            ),
            `${each.person}'s Safe does not wear the Director hat ${listed.directorHat}`,
          );
      }),
    ),
    nothingRecorded("org.director.list", before),
  ],
  refusals: {
    NotAMember: (asked, refused, before) => [
      check(
        "NotAMember names the company and the caller",
        same("NotAMember", [refused.org, refused.person], [asked.payload.org, callerOf(asked.options)]),
      ),
      nothingRecorded("the refused org.director.list", before),
    ],
    OrgNotFound: (asked, refused, before) => [
      check("OrgNotFound names the company asked", same("its org", refused.org, asked.payload.org)),
      nothingRecorded("the refused org.director.list", before),
    ],
  },
});
