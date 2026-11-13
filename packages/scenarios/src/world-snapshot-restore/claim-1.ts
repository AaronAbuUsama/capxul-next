// world.snapshot.restore, claim 1: a restore into a separate world leaves the first world untouched and the two
// never see each other. The same calls are made in each world, the first's through its own door and the new one's
// `at` its door; each world's record, General Ledger and company Safe's balance move only with its own calls. A
// document's name may be the same in both (each continues the same naming series), so the books are compared whole.
import { Site, startingWorlds } from "@capxul/blueprint";
import * as Effect from "effect/Effect";
import { expect, given, scenario } from "../scenario.ts";
import { answers, same, sameAmount } from "../support/expect.ts";
import { usdc } from "../support/chain.ts";
import { holdsInOrder } from "../support/record.ts";
import { approve } from "../support/signing.ts";
import { create, holdPayment, ledger, linesOf } from "../support/site.ts";
import { eventually } from "../support/wait.ts";
import { entriesAfter, headOf, view, type Who } from "../support/world.ts";
import { restoreInto, siteReady } from "./restore.ts";

const AMOUNT = 10;
const EVENTS = ["doc_created", "doc_created", "payment_held", "approval_signed", "approval_landed"];

export const worldSnapshotRestore1 = scenario(
  { operation: "world.snapshot.restore", claim: 1 },
  Effect.gen(function* () {
    const facts = yield* given(startingWorlds.withSnapshot);
    const first = yield* view(facts.world.world);
    const org = facts.founded.org;
    const { as, made } = yield* restoreInto(first, "m3", "rs1");
    yield* expect(made.door !== first.door, `the new world answers the first world's door, ${made.door}`);
    yield* same("the new world's parent", made.parent, {
      world: first.world,
      snapshot: "m3",
      recordSeq: facts.m3.recordSeq,
    });
    yield* siteReady(as);

    const own: Who = {};
    const other: Who = { at: made.door };
    const state = (who: Who, world: typeof first) =>
      Effect.all({
        head: headOf(who),
        books: ledger(org, {}, { ...who, as: "sam" }),
        safe: usdc(world, facts.founded.safe, who.at === undefined ? {} : { at: who.at }),
      });
    const pay = (who: Who, label: string) =>
      Effect.gen(function* () {
        const before = yield* headOf(who);
        yield* create(org, "Supplier", Site.supplierFields(`Isolation ${label} Ltd`), { ...who, as: "sam" });
        const { held } = yield* holdPayment(
          org,
          { supplier: facts.supplier.name, invoice: null, amount: AMOUNT },
          { ...who, as: "sam" },
        );
        yield* answers(`sam's signature in the ${label} world`, "Sent", approve(held.approval, who.at));
        yield* holdsInOrder(yield* entriesAfter(before, who), EVENTS);
        yield* eventually(
          `the ${label} world's General Ledger to show ${held.name}`,
          ledger(org, {}, { ...who, as: "sam" }),
          (rows) => linesOf(rows, held.name).length > 0,
        );
      });

    const firstBefore = yield* state(own, first);
    const newBefore = yield* state(other, made);
    yield* pay(own, "first");
    const firstAfter = yield* state(own, first);
    yield* sameAmount(
      "the first world's company Safe after its payment",
      Number(firstAfter.safe),
      Number(firstBefore.safe) - AMOUNT,
    );
    yield* same("the new world after the first world's calls", yield* state(other, made), newBefore);

    yield* pay(other, "new");
    const newAfter = yield* state(other, made);
    yield* sameAmount(
      "the new world's company Safe after its payment",
      Number(newAfter.safe),
      Number(newBefore.safe) - AMOUNT,
    );
    yield* same("the first world after the new world's calls", yield* state(own, first), firstAfter);
  }),
);
