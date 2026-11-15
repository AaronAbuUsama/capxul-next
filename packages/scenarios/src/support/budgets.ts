// Reading a company's budgets on the world's chain through its door (decisions.md, 34): looks that the budgets
// operations' checks and the journey "give sam a budget at Northwind" share. The chain is the only gate on spending,
// so a budget an operation answers is held against the world's Budgets contract (`contracts.budgets`), never against
// anything Core keeps. Every read goes to the door, and as the operator, a look at that world goes (`whereOf`).
import type { Budgets, Chain } from "@capxul/blueprint";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { Capxul } from "../client.ts";
import { expect } from "../expectation.ts";
import { isAddress, logsOf } from "./chain.ts";
import { present, same, sameAddress, sameAmount } from "./expect.ts";
import { peopleOf } from "./people.ts";
import { ownCast, recordOf, textOf, whereOf, type View, type Who } from "./world.ts";

export type Budget = typeof Budgets.Budget.Type;
export type OnChain = NonNullable<Chain.ReadAnswer<"budget">>;

/** ICalendar's budget periods, in the order of their codes (0, 1, 2). */
export const PERIODS = ["month", "quarter", "year"] as const;

/** The period a chain code names. */
export const periodOf = (code: number): string => PERIODS[code] ?? `the period coded ${code}`;

/** The company Safe of `org`, as its org_founded in the world's record carries it. */
export const companySafeOf = (org: string, who: Who = {}) =>
  Effect.gen(function* () {
    const record = yield* recordOf(who);
    const founded = Arr.findFirst(
      record.entries,
      (each) => each.event === "org_founded" && textOf(each.carried, "org") === org,
    );
    return yield* present(
      `the company Safe of ${org} in its org_founded`,
      Option.getOrNull(Option.map(founded, (each) => textOf(each.carried, "safe"))),
    );
  });

/** Budget `budget` of the world's Budgets, at the latest block or `block`; null when no budget has the id. */
export const onChain = (world: View, budget: string, who: Who = {}, block: number | null = null) =>
  Effect.gen(function* () {
    const capxul = yield* Capxul;
    return yield* capxul.chain.budget({ budgets: world.contracts.budgets, budget, block }, whereOf(who));
  });

/** Budget `budget`, which the chain must hold. */
export const heldOnChain = (world: View, budget: string, who: Who = {}) =>
  Effect.flatMap(onChain(world, budget, who), (held) => present(`budget ${budget} on the chain`, held));

/** Whether the chain holds budget `budget` for the company Safe `safe`. */
export const isBudgetOf = (world: View, budget: string, safe: string, who: Who = {}) =>
  Effect.map(onChain(world, budget, who), (held) => held !== null && isAddress(held.safe, safe));

/** The people of the world's cast whose personal Safe wears `hat` now, in the cast's order. */
export const holdersOf = (world: View, hat: string, who: Who = {}) =>
  Effect.gen(function* () {
    const capxul = yield* Capxul;
    const holders: Array<string> = [];
    for (const each of yield* ownCast(world))
      if (
        each.safe !== null &&
        (yield* capxul.chain.wears({ hats: world.contracts.hats, hat, wearer: each.safe, block: null }, whereOf(who)))
      )
        holders.push(each.person);
    return holders;
  });

/** The BudgetCreated logs of the world's Budgets among `logs`. */
export const budgetsCreated = (world: View, logs: ReadonlyArray<Chain.Log>) =>
  Arr.filter(logsOf(logs, "BudgetCreated"), (log) => isAddress(log.address, world.contracts.budgets));

/** The ids of every budget the chain made for the company Safe `safe`, in the order it made them. */
export const madeFor = (world: View, safe: string, who: Who = {}) =>
  Effect.gen(function* () {
    const capxul = yield* Capxul;
    const logs = yield* capxul.chain.logs(
      { log: "BudgetCreated", address: world.contracts.budgets, fromBlock: null, toBlock: null },
      whereOf(who),
    );
    return Arr.map(
      Arr.filter(budgetsCreated(world, logs), (log) => isAddress(log.safe, safe)),
      (log) => log.id,
    );
  });

/**
 * A budget as an operation answered it is the chain's now: the company Safe's, with the chain's parent, hat, asset,
 * period, figures and closing; held by the people whose Safe wears its hat; and, when it is the top one, named as the
 * company is.
 */
export const asChainHolds = (world: View, budget: Budget, who: Who = {}) =>
  Effect.gen(function* () {
    const what = `budget ${budget.id}`;
    const held = yield* heldOnChain(world, budget.id, who);
    yield* sameAddress(`${what}'s Safe`, held.safe, yield* companySafeOf(budget.org, who));
    yield* same(
      `${what}'s parent, hat, period and closing`,
      [budget.parent, budget.hat, budget.period, budget.closed],
      [held.parent === "0" ? null : held.parent, held.hat, periodOf(held.period), held.closed],
    );
    yield* expect(
      budget.asset === "USDC" && isAddress(held.token, world.contracts.usdc),
      `${what} is in ${budget.asset}; the chain's is in ${held.token}`,
    );
    yield* sameAmount(`${what}'s amount`, budget.amount, held.amount);
    yield* sameAmount(`${what}'s spent`, budget.spent, held.spent);
    yield* sameAmount(`${what}'s committed`, budget.committed, held.committed);
    yield* sameAmount(`${what}'s left`, budget.left, held.left);
    yield* same(`${what}'s holders`, budget.holders, yield* holdersOf(world, held.hat, who));
    if (budget.parent === null) {
      const named = Arr.findFirst(world.companies, (each) => each.org === budget.org);
      yield* same("the top budget's name", budget.name, Option.getOrNull(Option.map(named, (each) => each.name)));
    }
  });

/** Whether `person` is a Director or a member of `org`, as `org.member.list` answers the world's owner. */
export const belongsTo = (org: string, person: string, who: Who = {}) =>
  Effect.map(peopleOf(org, who), (people) => Arr.some(people, (each) => each.person === person));
