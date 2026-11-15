// org.budget.show and org.budget.list: a company's budgets as the chain holds them now (./chain.ts), with the people
// whose Safe wears each one's hat, named as Core keeps them: the top budget as its company is, any other as it was
// proposed. Its Directors and members may read them, and so may the world's owner. Reading records nothing.
import { Errors, type Budgets as Ops } from "@capxul/blueprint";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { caller } from "../organizations/caller.ts";
import * as Organizations from "../organizations/store.ts";
import { belongs } from "../people/roster.ts";
import { sameAddress } from "../chain/hex.ts";
import { SEEDED } from "../chain/seeded.ts";
import { budgetOf, holdersOf, periodOf, treeOf, usdc, type OnChain } from "./chain.ts";
import { companyNameOf, nameOf } from "./store.ts";

type Budget = typeof Ops.Budget.Type;

/**
 * The company `org`, which the caller may read: refused when nobody founded it or its setup has not landed (it has no
 * budget on the chain yet), and when a person who is neither a Director nor a member asks.
 */
export const readable = Effect.fn("budgets.readable")(function* (org: string) {
  const who = yield* caller;
  const found = yield* Organizations.byOrg(org);
  if (Option.isNone(found) || found.value.setup !== "ready") return yield* Errors.OrgNotFound.make({ org });
  if (who.person && !(yield* belongs(found.value, who.name)))
    return yield* Errors.NotAMember.make({ org, person: who.name });
  return found.value;
});

/** A budget of the company as the blueprint answers it. */
const viewOf = Effect.fn("budgets.view")(function* (org: string, held: OnChain) {
  if (!sameAddress(held.token, SEEDED.usdc)) return yield* Effect.die(`budget ${held.id} is in ${held.token}`);
  const id = held.id.toString();
  const named = held.parent === 0n ? yield* companyNameOf(org) : yield* nameOf(org, id);
  return {
    id,
    org,
    name: Option.getOrElse(named, () => `Budget ${id}`),
    parent: held.parent === 0n ? null : held.parent.toString(),
    hat: held.hat.toString(),
    holders: yield* holdersOf(held.hat),
    asset: "USDC",
    period: yield* periodOf(held.period),
    amount: usdc(held.amount),
    spent: usdc(held.spent),
    committed: usdc(held.committed),
    left: usdc(held.left),
    closed: held.closed,
  } satisfies Budget;
});

export const budgetShow = Effect.fn("org.budget.show.read")(function* (asked: typeof Ops.show.rpc.payloadSchema.Type) {
  const organization = yield* readable(asked.org);
  const held = yield* budgetOf(BigInt(asked.budget), organization.safe);
  if (Option.isNone(held)) return yield* Errors.BudgetNotFound.make({ org: asked.org, budget: asked.budget });
  return yield* viewOf(asked.org, held.value);
});

export const budgetList = Effect.fn("org.budget.list.read")(function* (asked: typeof Ops.list.rpc.payloadSchema.Type) {
  const organization = yield* readable(asked.org);
  const top = organization.budget;
  const ids = top === null ? [] : yield* treeOf(BigInt(top));
  const budgets = yield* Effect.forEach(
    ids,
    (id) =>
      Effect.flatMap(budgetOf(id, organization.safe), (held) =>
        Option.match(held, {
          onNone: () => Effect.die(`budget ${id} of ${asked.org}'s tree is not its Safe's`),
          onSome: (budget) => viewOf(asked.org, budget),
        }),
      ),
    { concurrency: 4 },
  );
  return { org: asked.org, budgets };
});
