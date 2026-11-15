// Each journey's own cast (src/starting-points/cast.ts): every person, email and company handle is one the contract
// takes, and no two journeys share a person, a company or a test key, nor any key the world's own cast and services use.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import * as Arr from "effect/Array";
import * as Schema from "effect/Schema";
import * as Cast from "../src/starting-points/cast.ts";
import { OrgHandle } from "../src/common/ids.ts";
import { PersonId } from "../src/common/values.ts";
import { Email } from "../src/things/invitation/values.ts";

const casts = Arr.map(Cast.JOURNEY_KEYS, (key) => Cast.journeyCast(key, "northwind"));
const people = Arr.flatMap(casts, (cast) => cast.people);

test("every person, email and handle of every journey's cast is one the contract takes", () => {
  for (const each of people) {
    assert.ok(Schema.is(PersonId)(each.person), `${each.person} is not a PersonId`);
    assert.ok(Schema.is(Email)(each.email), `${each.email} is not an Email`);
  }
  for (const cast of casts) assert.ok(Schema.is(OrgHandle)(cast.company), `${cast.company} is not a handle`);
});

/** No item of `items` is there twice. */
const unique = (items: ReadonlyArray<string | number>) => assert.equal(Arr.dedupe(items).length, items.length);

test("no two journeys share a person, a company or a test key, and no key is the world's own", () => {
  unique(Arr.map(people, (each) => each.person));
  unique(Arr.map(casts, (cast) => cast.company));
  unique(Arr.map(people, (each) => each.keyIndex));
  for (const each of people) {
    assert.ok(each.keyIndex >= Cast.CAST_KEY_BASE, `${each.person} signs with account ${each.keyIndex}`);
    assert.ok(each.keyIndex < Cast.CAST_KEY_ACCOUNTS, `${each.person}'s account ${each.keyIndex} is past the last`);
  }
});

test("journey 4 is found: its sam is sam-j4, at sam-j4@cast.test, and its company northwind-j4", () => {
  const found = Cast.journeyCast("found", "northwind");
  const sam = Arr.findFirst(found.people, (each) => each.role === "sam");
  assert.deepEqual(
    [sam._tag === "Some" ? [sam.value.person, sam.value.email, sam.value.keyIndex] : null, found.company],
    [["sam-j4", "sam-j4@cast.test", 54], "northwind-j4"],
  );
});
