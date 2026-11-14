// Every journey the runner runs, in order. A journey is registered by adding it here: nothing is found by walking the
// disk, so a journey that is not listed does not run, and the compiler sees every one.
//
// The thin line's journeys (roadmap step 1.14): between them they call all twelve operations, refusals included, and
// every claim of claims.md is checked by an operation's checks or a journey's step (coverage.ts).
import type { Journey } from "./journey.ts";
import { foundNorthwind } from "./journeys/found-northwind.ts";
import { payAndBranch } from "./journeys/pay-and-branch.ts";
import { twoOperators } from "./journeys/two-operators.ts";

export const journeys: ReadonlyArray<Journey> = [twoOperators, foundNorthwind, payAndBranch];
