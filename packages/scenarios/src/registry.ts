// Every journey the runner runs, in order: each domain's (domains.ts), domain by domain, each with every operation's
// checks. A journey is registered by listing it in its domain's file (domains/): nothing is found by walking the disk,
// so a journey that is not listed does not run, and the compiler sees every one.
//
// The thin line's journeys (roadmap step 1.14): between them they call all twelve operations, refusals included, and
// every claim of claims.md is checked by an operation's checks or a journey's step (coverage.ts).
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Rec from "effect/Record";
import { operationChecks } from "./checks/all.ts";
import { OperationChecks } from "./checks/format.ts";
import { domains } from "./domains.ts";
import type { Declared, Journey } from "./journey.ts";

/** A declared journey as the runner runs it: with every operation's checks. */
export const registered = (declared: Declared): Journey => ({
  ...declared,
  run: Effect.provideService(declared.run, OperationChecks, operationChecks),
});

export const journeys: ReadonlyArray<Journey> = Arr.map(
  Arr.flatMap(Rec.values(domains), (domain) => domain.journeys),
  registered,
);
