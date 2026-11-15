// The checks of every org.budget.list (claims.md of budgets, org.budget.list 1 and 2): the company asked, every
// budget the chain made for its Safe and no other, in the order the chain made them, its top budget first, each as the
// chain holds it now; a person who asks belongs to the company; reading it records nothing. Someone who does not
// belong, and a company nobody founded, are refused.
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { asChainHolds, companySafeOf, madeFor } from "../support/budgets.ts";
import { same } from "../support/expect.ts";
import { nothingRecorded, worldBefore, type Before } from "./common.ts";
import { check, checks } from "./format.ts";
import { callerBelongs, notAMember } from "./org-budget-show.ts";

export const orgBudgetList = checks<"org.budget.list", Before>({
  before: (asked) => worldBefore(asked.options),
  success: (asked, listed, before) => [
    check("it answers the company asked", same("its org", listed.org, asked.payload.org)),
    check(
      "it lists every budget the chain made for the company Safe, in the order the chain made them, its top budget first",
      Effect.gen(function* () {
        const safe = yield* companySafeOf(asked.payload.org, before.where);
        yield* same(
          "the company's budgets",
          Arr.map(listed.budgets, (each) => each.id),
          yield* madeFor(before.world, safe, before.where),
        );
        yield* same(
          "the first budget's parent",
          Option.getOrUndefined(Option.map(Arr.head(listed.budgets), (first) => first.parent)),
          null,
        );
      }),
    ),
    check(
      "each budget is as the chain holds it now",
      Effect.forEach(listed.budgets, (each) => asChainHolds(before.world, each, before.where), { discard: true }),
    ),
    callerBelongs(asked, before),
    nothingRecorded("org.budget.list", before),
  ],
  refusals: {
    NotAMember: (asked, refused, before) => [
      notAMember(asked, refused, before),
      nothingRecorded("the refused org.budget.list", before),
    ],
    OrgNotFound: (asked, refused, before) => [
      check("OrgNotFound names the company asked", same("its org", refused.org, asked.payload.org)),
      nothingRecorded("the refused org.budget.list", before),
    ],
  },
});
