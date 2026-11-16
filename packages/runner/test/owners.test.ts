// Side by side, each journey with worlds of its own has two operators of its own (worlds/owners.ts), so journeys
// about worlds never fill each other's quotas (world run 43782964738: inventory's WorldQuotaReached at 5 of 5). Their
// names are operators' names the blueprint accepts, even under CI's longest owner, and only the run's own count as its.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { Cast, startingWorlds } from "@capxul/blueprint";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { ownersOf, runOwns } from "../src/worlds/owners.ts";

const run = { owner: "ci-43782964738-12", secondOwner: "ci-43782964738-12-2" };

test("every journey's own operators are names the platform accepts, and no two journeys share one", () => {
  const all = Arr.flatMap(Cast.JOURNEY_KEYS, (key) => {
    const own = ownersOf(run, key);
    const operators = { first: own.owner, second: own.secondOwner };
    Effect.runSync(Schema.decodeEffect(startingWorlds.nothing.facts)({ operators, calls: [] }));
    return [own.owner, own.secondOwner];
  });
  assert.equal(Arr.dedupe([...all, run.owner, run.secondOwner]).length, all.length + 2);
});

test("the run's own operators and its journeys' are the run's; another run's are not", () => {
  const ours = runOwns(run);
  assert.ok(Arr.every([run.owner, run.secondOwner, ownersOf(run, "invent").secondOwner], ours));
  assert.ok(!ours("ci-43782964738-123"), "another run's attempt");
  assert.ok(!ours("ci-43782964738-1"), "a shorter run id");
  assert.ok(!ours("amp-7"));
});
