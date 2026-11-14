// Every claim of claims.md is checked: by the checks of an operation, which run on every call of it, and by the steps
// of the journeys that call it the way the claim says (src/coverage.ts). No claim is left out, and every step named
// exists.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { allClaims, operations, type OperationName } from "@capxul/blueprint";
import * as Arr from "effect/Array";
import * as Rec from "effect/Record";
import { coverage, journeys } from "../src/door.ts";

test("every claim of every operation has its place, and no place names a claim the blueprint does not declare", () => {
  for (const operation of Rec.keys(operations) as ReadonlyArray<OperationName>)
    assert.equal(
      coverage[operation].length,
      allClaims[operation].claims.length,
      `${operation} declares ${allClaims[operation].claims.length} claims; coverage.ts places ${coverage[operation].length}`,
    );
});

test("every claim is checked by a journey's step that exists, and the journey is registered", () => {
  for (const [operation, places] of Rec.toEntries(coverage))
    for (const [index, place] of places.entries()) {
      assert.ok(place.steps.length > 0, `${operation} claim ${index + 1} is in no journey`);
      for (const { journey, step } of place.steps) {
        assert.ok(Arr.contains(journeys, journey), `${journey.name} is not registered`);
        assert.ok(step >= 1 && step <= journey.outline.length, `${journey.name} has no step ${step}`);
      }
    }
});
