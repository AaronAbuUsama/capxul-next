// The documents of the starting worlds from `payment-drafted` on, found in the world's record: a starting world
// hands a scenario nothing else, and every doc_created entry names its document.
import * as Effect from "effect/Effect";
import { lastCreated, northwind, record } from "./world.ts";

/** Northwind's org, and the names of Brightside, its Purchase Invoice and its Payment Entry. */
export const paymentDocuments = Effect.gen(function* () {
  const { world, org } = yield* northwind;
  const { entries } = yield* record;
  return {
    world,
    org,
    supplier: yield* lastCreated(entries, "Supplier"),
    invoice: yield* lastCreated(entries, "Purchase Invoice"),
    payment: yield* lastCreated(entries, "Payment Entry"),
  };
});
