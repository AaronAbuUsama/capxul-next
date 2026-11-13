// What the compiler cannot hold about the registry: names are unique, each scenario proves a claim the blueprint
// declares and begins from that claim's starting world, and no claim is proved twice.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Str from "effect/String";
import { claimOf, scenarios } from "../src/door.ts";

test("every scenario has its own name and a run", () => {
  const names = Arr.map(scenarios, (each) => each.name);
  assert.deepEqual(Arr.dedupe(names), names);
  for (const each of scenarios) assert.ok(Effect.isEffect(each.run), `${each.name} has no run`);
});

test("every scenario proves a declared claim from that claim's starting world, and no claim twice", () => {
  const proved = Arr.flatMap(scenarios, (each) => (each.proves === null ? [] : [{ ...each, proves: each.proves }]));
  for (const each of proved) {
    const claim = claimOf(each.proves);
    assert.ok(Option.isSome(claim), `${each.name} names a claim the blueprint does not declare`);
    assert.equal(each.given, claim.value.given, `${each.name} does not begin from its claim's starting world`);
  }
  const keys = Arr.map(proved, (each) => `${each.proves.operation} ${each.proves.claim}`);
  assert.deepEqual(Arr.dedupe(keys), keys, "a claim is proved by two scenarios");
});

test("the registry holds the example, which proves no claim", () => {
  assert.ok(Arr.some(scenarios, (each) => each.proves === null && Str.startsWith("example: ")(each.name)));
});
