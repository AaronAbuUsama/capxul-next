// Where each claim of claims.md is checked now that scenarios are journeys (docs/roadmap.md, 14 November 2026): in
// the checks of an operation (src/checks/), which run on every call of it in every journey, and in the steps of the
// journeys that call it the way the claim says. One entry per claim, in claims.md's order, in the file of the
// operation's domain (domains/), gathered here; test/coverage.test.ts holds that every claim has one and that every
// step it names exists.
import type { OperationName } from "@capxul/blueprint";
import * as Arr from "effect/Array";
import * as Option from "effect/Option";
import * as Rec from "effect/Record";
import { gather, type Placed } from "./domain.ts";
import { domains } from "./domains.ts";
import type { Declared, Journey } from "./journey.ts";
import { journeys, registered } from "./registry.ts";

/** Where one claim is checked: the operations whose checks hold it, and the journeys' steps (from 1) that call it. */
export interface Covered {
  readonly checks: ReadonlyArray<OperationName>;
  readonly steps: ReadonlyArray<{ readonly journey: Journey; readonly step: number }>;
}

/** The registered journey of that name; a journey registered nowhere is its own, which is in no list. */
const registeredAs = (declared: Declared): Journey =>
  Option.getOrElse(
    Arr.findFirst(journeys, (each) => each.name === declared.name),
    () => registered(declared),
  );

const covered = (place: Placed): Covered => ({
  checks: place.checks,
  steps: Arr.map(place.steps, ({ journey, step }) => ({ journey: registeredAs(journey), step })),
});

const places: { readonly [N in OperationName]: ReadonlyArray<Placed> } = gather(Rec.values(domains), "coverage");

export const coverage: { readonly [N in OperationName]: ReadonlyArray<Covered> } = Rec.map(places, (each) =>
  Arr.map(each, covered),
);
