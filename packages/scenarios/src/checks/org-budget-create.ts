// The checks of every org.budget.create (claims.md of budgets, org.budget.create 1 and 3 to 6): a creation is a
// Directors' proposal of the budget asked, in its parent's asset and period and within what its parent has left on
// the chain, with one approval per Director at their own signer address; the record gains one budget_proposed
// carrying neither the holder, the name nor the amount, then its proposal_opened; nothing reaches the chain. A caller
// who is not a Director, a holder who does not belong or has no Safe, a parent the company does not have and an
// amount the parent has no room for are each refused, and nothing is proposed.
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Order from "effect/Order";
import * as Rec from "effect/Record";
import { expect } from "../expectation.ts";
import { companySafeOf, isBudgetOf, onChain, periodOf, type OnChain } from "../support/budgets.ts";
import { isAddress } from "../support/chain.ts";
import { amountOf, present, same, sameAddress, sameAmount } from "../support/expect.ts";
import { chainBlock, chainUntouched } from "../support/people.ts";
import { castMember, entriesOfCall, objectOf, type Json } from "../support/world.ts";
import { callerOf, nothingRecorded, worldBefore, type Before } from "./common.ts";
import { check, checks, type Asked, type Check } from "./format.ts";

type Asking = Asked<"org.budget.create">;

/** What a creation reads first: the world, the company asked, the chain's latest block, and the parent on the chain. */
interface Read extends Before {
  readonly org: string;
  readonly chainHead: number;
  readonly parent: OnChain | null;
}

/** A refused creation proposes nothing: the record and the chain are as they were. */
const refusedFor = (before: Read, also: ReadonlyArray<Check>): ReadonlyArray<Check> => [
  ...also,
  nothingRecorded("the refused creation", before),
  check(
    "the refused creation leaves the chain as it was",
    chainUntouched(before.world, before.where, before.chainHead, before.org),
  ),
];

/** A refusal names the company and the person it is about: the caller, or the holder asked. */
const namesOrgAnd = (
  what: string,
  named: { readonly org: string; readonly person: string },
  asked: Asking,
  person: string,
) =>
  check(`${what} names the company and ${person}`, same(what, [named.org, named.person], [asked.payload.org, person]));

export const orgBudgetCreate = checks<"org.budget.create", Read>({
  before: (asked) =>
    Effect.gen(function* () {
      const before = yield* worldBefore(asked.options);
      return {
        ...before,
        org: asked.payload.org,
        chainHead: yield* chainBlock(before.where),
        parent: yield* onChain(before.world, asked.payload.parent, before.where),
      };
    }),
  success: (asked, proposed, before) => [
    check(
      "it proposes the budget asked, in its parent's asset and period",
      Effect.gen(function* () {
        const { creation } = proposed;
        const parent = yield* present(`the parent ${asked.payload.parent} on the chain`, before.parent);
        yield* same(
          "the proposed creation",
          [creation.org, creation.parent, creation.name, creation.holder, creation.state],
          [asked.payload.org, asked.payload.parent, asked.payload.name, asked.payload.holder, "proposed"],
        );
        yield* sameAmount("the proposed amount", creation.amount, asked.payload.amount);
        yield* same("the proposed period", creation.period, periodOf(parent.period));
        yield* expect(
          creation.asset === "USDC" && isAddress(parent.token, before.world.contracts.usdc),
          `the creation is in ${creation.asset}; its parent's token is ${parent.token}`,
        );
      }),
    ),
    check(
      "its parent is the company's on the chain, and has room for it",
      Effect.gen(function* () {
        const parent = yield* present(`the parent ${asked.payload.parent} on the chain`, before.parent);
        yield* sameAddress("the parent's Safe", parent.safe, yield* companySafeOf(asked.payload.org, before.where));
        yield* expect(
          amountOf(asked.payload.amount) <= amountOf(parent.left),
          `${asked.payload.amount} was proposed inside a parent with ${parent.left} left`,
        );
      }),
    ),
    check(
      "it asks each Director once, at their own signer address, the proposer among them, and needs at most as many signatures as it asks",
      Effect.gen(function* () {
        const signers = Arr.map(proposed.approvals, (each) => each.signer);
        yield* same("the Directors asked, each once", Arr.dedupe(signers), signers);
        yield* expect(
          Arr.contains(signers, callerOf(asked.options)),
          `the proposing Director ${callerOf(asked.options)} is not asked to sign`,
        );
        for (const approval of proposed.approvals)
          yield* sameAddress(
            `${approval.signer}'s approval's address`,
            approval.signerAddress,
            (yield* castMember(before.world, approval.signer)).signer,
          );
        yield* expect(
          proposed.proposal.threshold >= 1 && proposed.proposal.threshold <= signers.length,
          `the proposal needs ${proposed.proposal.threshold} of ${signers.length} signatures`,
        );
      }),
    ),
    check(
      "the record gains one budget_proposed carrying only creation, org, parent and proposal, then its proposal_opened",
      Effect.gen(function* () {
        const added = yield* entriesOfCall(before.head, before.where);
        yield* same(
          "the events the creation added",
          Arr.map(added, (each) => each.event),
          ["budget_proposed", "proposal_opened"],
        );
        const carried = objectOf(added[0]?.carried);
        yield* same("the fields budget_proposed carries", Arr.sort(Rec.keys<string, Json>(carried), Order.String), [
          "creation",
          "org",
          "parent",
          "proposal",
        ]);
        yield* same("what budget_proposed carries", carried, {
          creation: proposed.creation.id,
          org: asked.payload.org,
          parent: asked.payload.parent,
          proposal: proposed.proposal.id,
        });
      }),
    ),
    check(
      "nothing reaches the chain until the Directors sign: the parent has what it had left",
      Effect.gen(function* () {
        yield* chainUntouched(before.world, before.where, before.chainHead, before.org);
        const parent = yield* present(`the parent ${asked.payload.parent} on the chain`, before.parent);
        const now = yield* present(
          `the parent ${asked.payload.parent} on the chain`,
          yield* onChain(before.world, asked.payload.parent, before.where),
        );
        yield* sameAmount("the parent's left", now.left, parent.left);
      }),
    ),
  ],
  refusals: {
    NotADirector: (asked, refused, before) =>
      refusedFor(before, [namesOrgAnd("NotADirector", refused, asked, callerOf(asked.options))]),
    NotAMember: (asked, refused, before) =>
      refusedFor(before, [namesOrgAnd("NotAMember", refused, asked, asked.payload.holder)]),
    MemberHasNoSafe: (asked, refused, before) =>
      refusedFor(before, [
        namesOrgAnd("MemberHasNoSafe", refused, asked, asked.payload.holder),
        check(
          "the holder has no claimed personal Safe",
          Effect.flatMap(castMember(before.world, asked.payload.holder), (holder) =>
            same(`${holder.person}'s Safe`, holder.safe, null),
          ),
        ),
      ]),
    BudgetNotFound: (asked, refused, before) =>
      refusedFor(before, [
        check(
          "BudgetNotFound names the company and the parent asked",
          same("BudgetNotFound", [refused.org, refused.budget], [asked.payload.org, asked.payload.parent]),
        ),
        check(
          "the chain holds no budget of the company with that id",
          Effect.gen(function* () {
            const safe = yield* companySafeOf(asked.payload.org, before.where);
            yield* expect(
              !(yield* isBudgetOf(before.world, asked.payload.parent, safe, before.where)),
              `budget ${asked.payload.parent} is ${asked.payload.org}'s on the chain`,
            );
          }),
        ),
      ]),
    ExceedsParent: (asked, refused, before) =>
      refusedFor(before, [
        check(
          "ExceedsParent names the company, the parent and the amount asked, and what the parent has left on the chain, which is less",
          Effect.gen(function* () {
            const parent = yield* present(`the parent ${asked.payload.parent} on the chain`, before.parent);
            yield* same(
              "ExceedsParent's company and parent",
              [refused.org, refused.parent],
              [asked.payload.org, asked.payload.parent],
            );
            yield* sameAmount("ExceedsParent's amount", refused.amount, asked.payload.amount);
            yield* sameAmount("ExceedsParent's left", refused.left, parent.left);
            yield* expect(
              amountOf(refused.amount) > amountOf(refused.left),
              `${refused.amount} fits in the ${refused.left} left`,
            );
          }),
        ),
      ]),
    OrgNotFound: (asked, refused, before) =>
      refusedFor(before, [
        check("OrgNotFound names the company asked", same("its org", refused.org, asked.payload.org)),
      ]),
  },
});
