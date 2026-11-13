// The thin line's scenarios prove every claim of its twelve operations: one scenario for each claim in claims.md.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { allClaims, type ClaimsOf } from "@capxul/blueprint";
import * as Arr from "effect/Array";
import * as Order from "effect/Order";
import * as Rec from "effect/Record";
import { scenarios } from "../src/door.ts";

test("every claim of every operation is proved by a scenario", () => {
  const claimed = Arr.flatMap(Rec.toEntries<string, ClaimsOf>(allClaims), ([operation, of]) =>
    Arr.map(of.claims, (_, index) => `${operation} claim ${index + 1}`),
  );
  const proved = Arr.flatMap(scenarios, (each) =>
    each.proves === null ? [] : [`${each.proves.operation} claim ${each.proves.claim}`],
  );
  assert.deepEqual(Arr.sort(proved, Order.String), Arr.sort(claimed, Order.String));
});
