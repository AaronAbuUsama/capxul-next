// Journey: give sam a budget at Northwind. Northwind has the one top budget founding made; dana proposes Office costs,
// 1,000 USDC a month for sam inside it, dana and eli sign, and one company Safe transaction makes the budget and mints
// its own hat to sam's Safe; sam and the Directors read it as the chain holds it, the top budget 1,000 the poorer;
// then a budget goes inside sam's. Who may not propose, whom a budget may not go to, a parent Northwind does not have
// and more than a parent has left are refused along the way. Spending from it comes later.
import { startingWorlds, Values } from "@capxul/blueprint";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import { Capxul } from "../client.ts";
import { expect, given } from "../expectation.ts";
import { Cast } from "../cast.ts";
import { journey, outline } from "../journey.ts";
import { budgetsCreated, heldOnChain, type Budget } from "../support/budgets.ts";
import { mintedTo } from "../support/chain.ts";
import { present, same, sameAddress, sameAmount } from "../support/expect.ts";
import { castMember, viewAt } from "../support/world.ts";
import { signedByDirectors } from "./signatures.ts";
import { steady } from "../support/steady.ts";

const steps = outline({
  budgets: [
    "org.budget.list",
    "Northwind's budgets as founded: its top budget alone, 1,000,000 USDC a month, all of it left, of the Books hat, which nobody wears; the owner sees the same; olga, who does not belong, may not see them",
  ],
  top: [
    "org.budget.show",
    "dana and sam read the top budget as listed; olga may not; a budget Northwind does not have, and a company nobody founded, are refused",
  ],
  refused: [
    "org.budget.create",
    "sam may not propose a budget; olga and zed do not belong and pat has no Safe; a parent Northwind does not have, more than the top budget has, an amount of 0, an empty name and a company nobody founded are refused",
  ],
  propose: [
    "org.budget.create",
    "dana proposes Office costs, 1,000 USDC for sam inside the top budget: monthly in USDC as its parent is, it waits for the Directors and is not listed yet",
  ],
  sign: [
    "approval.sign",
    "dana's signature is kept and eli's sends it: one transaction makes the budget inside the top one, of a hat it minted to sam's Safe",
  ],
  office: ["org.budget.show", "sam's budget as the chain holds it: 1,000 a month, all of it left, held by sam alone"],
  both: ["org.budget.list", "Northwind's two budgets, the top one first, with 1,000 less left"],
  nested: [
    "org.budget.create",
    "999,000.000001 no longer fits inside the top budget; dana proposes Cleaners, 200 USDC for sam, inside Office costs",
  ],
});

/** A company nobody founded, a budget Northwind does not have, and a person who is nobody of the world. */
const NO_ORG = "org_nowhere1";
const NO_BUDGET = "999999";
const NOBODY = "zed";

export const budgetSam = journey(
  {
    name: "give sam a budget at Northwind",
    world: "shared",
    worlds: 0,
    key: "budget",
    story:
      "dana proposes a monthly budget of 1,000 USDC for sam inside Northwind's top budget, dana and eli sign it onto the chain with a hat of its own on sam's Safe, and everyone who belongs reads it as the chain holds it; whoever may not propose, whom a budget may not go to and what does not fit are refused.",
    given: startingWorlds.founded,
    steps,
  },
  Effect.gen(function* () {
    const cast = yield* Cast;
    const dana = { as: cast.dana } as const;
    const eli = { as: cast.eli } as const;
    const sam = { as: cast.sam } as const;
    const olga = { as: cast.olga } as const;
    const { founded } = yield* given(startingWorlds.founded);
    const capxul = yield* Capxul;
    const org = founded.org;
    const ask = (parent: string, name: string, holder: string, amount: string) =>
      ({ org, parent, name, holder, amount }) as const;

    const { top, world } = yield* steps.budgets.run((op) =>
      Effect.gen(function* () {
        const listed = yield* op.succeeds({ org }, dana);
        const view = yield* viewAt();
        yield* same("Northwind's budgets as founded", listed.budgets.length, 1);
        const first = yield* present("Northwind's top budget", listed.budgets[0]);
        yield* same(
          "the top budget",
          [first.name, first.parent, first.holders, first.asset, first.period, first.closed],
          [founded.profile.name, null, [], "USDC", "month", false],
        );
        yield* sameAmount("the top budget's amount", first.amount, "1000000");
        yield* sameAmount("the top budget's left", first.left, "1000000");
        yield* sameAmount("the top budget's spent", first.spent, "0");
        const hat = yield* steady(capxul.chain).hat({ hats: view.contracts.hats, hat: first.hat, block: null });
        yield* same("the top budget's hat", hat.details, Values.OFFICER_HAT_DETAILS["manage-books"]);
        const owned = yield* op.succeeds({ org });
        yield* same("Northwind's budgets as the world's owner sees them", owned.budgets, listed.budgets);
        yield* op.refused("NotAMember", { org }, olga);
        yield* op.refused("OrgNotFound", { org: NO_ORG }, dana);
        return { top: first, world: view };
      }),
    );

    yield* steps.top.run((op) =>
      Effect.gen(function* () {
        yield* same("the top budget as dana reads it", yield* op.succeeds({ org, budget: top.id }, dana), top);
        yield* same("the top budget as sam reads it", yield* op.succeeds({ org, budget: top.id }, sam), top);
        yield* op.refused("NotAMember", { org, budget: top.id }, olga);
        const missing = yield* op.refused("BudgetNotFound", { org, budget: NO_BUDGET }, dana);
        yield* same("the budget Northwind does not have", missing.budget, NO_BUDGET);
        yield* op.refused("OrgNotFound", { org: NO_ORG, budget: top.id }, dana);
      }),
    );

    yield* steps.refused.run((op) =>
      Effect.gen(function* () {
        const office = ask(top.id, "Office costs", cast.sam, "1000");
        const notDirector = yield* op.refused("NotADirector", office, sam);
        yield* same("who may not propose", notDirector.person, cast.sam);
        for (const holder of [cast.olga, NOBODY]) {
          const outside = yield* op.refused("NotAMember", { ...office, holder }, dana);
          yield* same("the holder who does not belong", outside.person, holder);
        }
        const noSafe = yield* op.refused("MemberHasNoSafe", { ...office, holder: cast.pat }, dana);
        yield* same("the holder with no Safe", noSafe.person, cast.pat);
        const noParent = yield* op.refused("BudgetNotFound", { ...office, parent: NO_BUDGET }, dana);
        yield* same("the parent Northwind does not have", noParent.budget, NO_BUDGET);
        const over = yield* op.refused("ExceedsParent", { ...office, amount: "1000000.000001" }, dana);
        yield* sameAmount("what the top budget has left", over.left, "1000000");
        yield* op.refused("PayloadRejected", { ...office, amount: "0" }, dana);
        yield* op.refused("PayloadRejected", { ...office, name: "  " }, dana);
        yield* op.refused("OrgNotFound", { ...office, org: NO_ORG }, dana);
      }),
    );

    const proposed = yield* steps.propose.run((op) =>
      Effect.gen(function* () {
        const asked = yield* op.succeeds(ask(top.id, "Office costs", cast.sam, "1000"), dana);
        yield* same(
          "the proposed budget",
          [asked.creation.name, asked.creation.holder, asked.creation.asset, asked.creation.period],
          ["Office costs", cast.sam, "USDC", "month"],
        );
        yield* same(
          "the Directors asked",
          Arr.map(asked.approvals, (each) => each.signer),
          [cast.dana, cast.eli],
        );
        const listed = yield* capxul["org.budget.list"]({ org }, dana);
        yield* same(
          "Northwind's budgets while it waits",
          Arr.map(listed.budgets, (each) => each.id),
          [top.id],
        );
        return asked;
      }),
    );

    const made = yield* steps.sign.run((op) =>
      Effect.gen(function* () {
        const sent = yield* signedByDirectors(op, proposed.approvals, {
          kind: "budget_creation",
          id: proposed.creation.id,
        });
        const landed = yield* steady(capxul.chain).transaction({ transaction: sent.transaction });
        const created = budgetsCreated(world, landed.logs);
        yield* same("the budgets the transaction made", created.length, 1);
        const budget = yield* present("the budget the transaction made", created[0]);
        yield* sameAddress("the new budget's Safe", budget.safe, founded.safe);
        yield* same("the new budget's parent", budget.parent, top.id);
        const samSafe = yield* present("sam's Safe", (yield* castMember(world, cast.sam)).safe);
        yield* expect(
          Arr.some(mintedTo(world, landed.logs, samSafe), (minted) => minted.id === budget.hat),
          `the transaction did not mint the new budget's hat ${budget.hat} to sam's Safe`,
        );
        const held = yield* heldOnChain(world, budget.id);
        yield* sameAmount("the new budget's amount on the chain", held.amount, "1000");
        yield* sameAmount("the new budget's left on the chain", held.left, "1000");
        yield* same("the new budget's period on the chain", held.period, 0);
        yield* sameAmount("the top budget's left on the chain", (yield* heldOnChain(world, top.id)).left, "999000");
        return budget;
      }),
    );

    const office = yield* steps.office.run((op) =>
      Effect.gen(function* () {
        const shown: Budget = yield* op.succeeds({ org, budget: made.id }, sam);
        yield* same(
          "sam's budget",
          [shown.name, shown.parent, shown.hat, shown.holders, shown.asset, shown.period, shown.closed],
          ["Office costs", top.id, made.hat, [cast.sam], "USDC", "month", false],
        );
        yield* sameAmount("sam's budget's amount", shown.amount, "1000");
        yield* sameAmount("sam's budget's left", shown.left, "1000");
        yield* sameAmount("sam's budget's spent", shown.spent, "0");
        yield* same("sam's budget as dana reads it", yield* op.succeeds({ org, budget: made.id }, dana), shown);
        return shown;
      }),
    );

    yield* steps.both.run((op) =>
      Effect.gen(function* () {
        const listed = yield* op.succeeds({ org }, eli);
        yield* same(
          "Northwind's budgets",
          Arr.map(listed.budgets, (each) => each.id),
          [top.id, office.id],
        );
        const [first, second] = listed.budgets;
        yield* sameAmount("the top budget's left", (yield* present("the top budget", first)).left, "999000");
        yield* same("sam's budget as listed", second, office);
      }),
    );

    yield* steps.nested.run((op) =>
      Effect.gen(function* () {
        const over = yield* op.refused("ExceedsParent", ask(top.id, "Office costs", cast.sam, "999000.000001"), dana);
        yield* sameAmount("what the top budget has left", over.left, "999000");
        const inside = yield* op.succeeds(ask(office.id, "Cleaners", cast.sam, "200"), dana);
        yield* same(
          "the budget proposed inside sam's",
          [inside.creation.parent, inside.creation.period, inside.creation.state],
          [office.id, "month", "proposed"],
        );
      }),
    );
  }),
);
