// How the platform's handlers keep their declared refusals and nothing else: any other failure of what they call
// (a deploy, a database, the shared state) is a fault, which the caller sees as a defect (decisions.md, 10).
import * as Effect from "effect/Effect";

/** Keeps the failures `is` names as failures, and turns every other into a defect. */
export const refusalsOnly =
  <K>(is: (error: unknown) => error is K) =>
  <A, E, R>(self: Effect.Effect<A, E, R>) =>
    Effect.catchIf(self, (error: E): error is Exclude<E, K> => !is(error), Effect.die);
