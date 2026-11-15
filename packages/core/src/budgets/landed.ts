// What the landing of a budget's creation means beyond its transaction (src/approvals/landed.ts gathers it with every
// other domain's): the creation is created, as the budget its transaction's BudgetCreated log names, so the budget is
// known by the name it was proposed with. Nothing here touches the company's site: a budget's Cost Center comes later.
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { decodeEventLog } from "viem";
import { BUDGETS } from "../chain/abi.ts";
import { hex, sameAddress } from "../chain/hex.ts";
import { SEEDED } from "../chain/seeded.ts";
import type { Landed } from "../chain/userop.ts";
import { topicsOf } from "../organizations/found.ts";
import * as Organizations from "../organizations/store.ts";
import { creationOf, markCreated } from "./store.ts";

/** The BudgetCreated logs of the world's Budgets among the transaction's. */
const createdIn = (landed: Landed) =>
  Arr.flatMap(landed.receipt.logs, (log) => {
    if (!sameAddress(log.address, SEEDED.budgets)) return [];
    const decoded = Option.liftThrowable(() =>
      decodeEventLog({ abi: BUDGETS, eventName: "BudgetCreated", topics: topicsOf(log.topics), data: hex(log.data) }),
    )();
    return Option.isSome(decoded) ? [decoded.value.args] : [];
  });

const creationLanded = (id: string, landing: Landed) =>
  Effect.gen(function* () {
    const found = yield* creationOf(id);
    if (Option.isNone(found)) return yield* Effect.void;
    const creation = found.value;
    const organization = yield* Organizations.byOrg(creation.org);
    const safe = Option.getOrElse(
      Option.map(organization, (each) => each.safe),
      () => "",
    );
    const made = Arr.findFirst(
      createdIn(landing),
      (event) =>
        sameAddress(event.safe, safe) &&
        event.parent.toString() === creation.parent &&
        event.hat.toString() === creation.hat,
    );
    return yield* markCreated(id, Option.getOrNull(Option.map(made, (event) => event.id.toString())));
  });

/** The landing of this domain's subject, a budget's creation (blueprint `src/budgets/subjects.ts`). */
export const landings = {
  budget_creation: {
    landed: creationLanded,
    // Its landing tells the company's site nothing, so there is no site to move on.
    orgOf: (_id: string) => Effect.succeed(Option.none<string>()),
  },
};
