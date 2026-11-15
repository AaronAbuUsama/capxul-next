// Core's handlers of the blueprint's domain "board": a company's Board, its Directors and how many must sign. None is
// built yet: each answers the blueprint's `NotImplemented`, naming itself (decisions.md, entry 33), so the journey
// "seat sam on Northwind's Board" (packages/scenarios) fails at its first step until a builder writes them.
import { Errors } from "@capxul/blueprint";
import * as Effect from "effect/Effect";

/** The answer of an operation that is not built yet. */
const notBuilt = (operation: string) => () => Effect.fail(Errors.NotImplemented.make({ operation }));

/** Its share of the world group. */
export const world = {
  "org.director.list": notBuilt("org.director.list"),
  "org.director.add": notBuilt("org.director.add"),
  "org.threshold.set": notBuilt("org.threshold.set"),
};
