// The checks of every org.budget.show (claims.md of budgets, org.budget.show 1 and 2): the budget asked of the company
// asked, as the chain holds it now, with the people whose Safe wears its hat; a person who asks belongs to the
// company; reading it records nothing. Someone who does not belong, a budget the company does not have and a company
// nobody founded are refused.
import * as Effect from "effect/Effect";
import { expect } from "../expectation.ts";
import { asChainHolds, belongsTo, companySafeOf, isBudgetOf } from "../support/budgets.ts";
import { same } from "../support/expect.ts";
import { callerOf, nothingRecorded, worldBefore, type Before } from "./common.ts";
import { check, checks, type Asked } from "./format.ts";

type Asking = Asked<"org.budget.show"> | Asked<"org.budget.list">;

/** A person who asks is a Director or a member of the company; the world's owner sees every company. */
export const callerBelongs = (asked: Asking, before: Before) =>
  check(
    "a person who asks belongs to the company",
    asked.options.as === undefined
      ? Effect.void
      : Effect.flatMap(belongsTo(asked.payload.org, callerOf(asked.options), before.where), (belongs) =>
          expect(belongs, `${callerOf(asked.options)} read ${asked.payload.org}'s budgets without belonging to it`),
        ),
  );

/** NotAMember names the company and the caller, who does not belong to it. */
export const notAMember = (asked: Asking, refused: { readonly org: string; readonly person: string }, before: Before) =>
  check(
    "NotAMember names the company and the caller, who does not belong to it",
    Effect.gen(function* () {
      yield* same("NotAMember", [refused.org, refused.person], [asked.payload.org, callerOf(asked.options)]);
      yield* expect(
        !(yield* belongsTo(asked.payload.org, refused.person, before.where)),
        `${refused.person} belongs to ${asked.payload.org}`,
      );
    }),
  );

export const orgBudgetShow = checks<"org.budget.show", Before>({
  before: (asked) => worldBefore(asked.options),
  success: (asked, shown, before) => [
    check(
      "it answers the budget asked, of the company asked",
      same("the budget and its company", [shown.id, shown.org], [asked.payload.budget, asked.payload.org]),
    ),
    check("it is the budget as the chain holds it now", asChainHolds(before.world, shown, before.where)),
    callerBelongs(asked, before),
    nothingRecorded("org.budget.show", before),
  ],
  refusals: {
    NotAMember: (asked, refused, before) => [
      notAMember(asked, refused, before),
      nothingRecorded("the refused org.budget.show", before),
    ],
    BudgetNotFound: (asked, refused, before) => [
      check(
        "BudgetNotFound names the company and the budget asked, which the chain does not hold for the company",
        Effect.gen(function* () {
          yield* same("BudgetNotFound", [refused.org, refused.budget], [asked.payload.org, asked.payload.budget]);
          const safe = yield* companySafeOf(asked.payload.org, before.where);
          yield* expect(
            !(yield* isBudgetOf(before.world, asked.payload.budget, safe, before.where)),
            `budget ${asked.payload.budget} is ${asked.payload.org}'s on the chain`,
          );
        }),
      ),
      nothingRecorded("the refused org.budget.show", before),
    ],
    OrgNotFound: (asked, refused, before) => [
      check("OrgNotFound names the company asked", same("its org", refused.org, asked.payload.org)),
      nothingRecorded("the refused org.budget.show", before),
    ],
  },
});
