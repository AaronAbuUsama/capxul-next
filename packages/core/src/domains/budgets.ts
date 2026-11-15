// Core's handlers of the blueprint's domain "budgets": a company's budgets on the world's chain, and proposing a new
// one. None is built yet: each answers the blueprint's `NotImplemented`, naming itself (decisions.md, entry 33), so the
// journey "give sam a budget" (packages/scenarios) fails at its first step until a builder writes them.
import { Errors } from "@capxul/blueprint";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

/** The answer of an operation that is not built yet. */
const notBuilt = (operation: string) => () => Effect.fail(Errors.NotImplemented.make({ operation }));

/** Its share of the world group. */
export const world = {
  "org.budget.create": notBuilt("org.budget.create"),
  "org.budget.show": notBuilt("org.budget.show"),
  "org.budget.list": notBuilt("org.budget.list"),
};

/**
 * The landing of its subject, a budget's creation (blueprint `src/budgets/subjects.ts`). Not built: no approval of
 * that kind is opened while `org.budget.create` answers `NotImplemented`, so neither is ever reached.
 */
export const landings = {
  budget_creation: {
    landed: (id: string) => Effect.die(`the landing of budget_creation ${id} is not built`),
    orgOf: (_id: string) => Effect.succeed(Option.none<string>()),
  },
};
