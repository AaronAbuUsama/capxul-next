// The generic isolation check (src/checks/isolation.ts) on made-up calls: a journey that acts as its own people and
// names only its own, or nobody's, passes; one that acts as, or names, another journey's person, email or company
// fails, by name. Both with today's run, which casts nobody, and with a cast per journey. No stage is needed.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { Cast, People } from "@capxul/blueprint";
import * as Arr from "effect/Array";
import * as Option from "effect/Option";
import { checkIsolation, scopeOf, withIsolation } from "../src/checks/isolation.ts";
import type { Call } from "../src/client.ts";

const INVITE = People.invitationSend.rpc._tag;

const call = (over: Partial<Call>): Call => ({
  operation: INVITE,
  traceId: "t1",
  at: null,
  outcome: "success",
  refusal: null,
  payload: {},
  success: Option.none(),
  callerMs: 1,
  resent: 0,
  failure: null,
  ...over,
});

const found = { key: "found", world: "shared" } as const;
const twoop = { key: "twoop", world: "own" } as const;

/** The person who plays `role` in journey `key`. */
const person = (key: Cast.JourneyKey, role: Cast.CastRole) => Cast.castPerson(key, role);

test("today's run casts nobody: dana, her company and an address outside every cast pass", () => {
  const scope = scopeOf(found, false);
  const fine = call({ as: "dana", payload: { org: "org_x", email: "rex@elsewhere.test", members: ["sam", "zed"] } });
  assert.equal(checkIsolation(scope, fine).passed, true);
});

test("acting as, or naming, another journey's people, email or company fails, by name", () => {
  const scope = scopeOf(found, true);
  const own = call({ as: person("found", "dana"), payload: { members: [person("found", "sam")] } });
  assert.equal(checkIsolation(scope, own).passed, true);
  const theirs = person("pay", "sam");
  const actsAs = checkIsolation(scope, call({ as: theirs }));
  assert.deepEqual([actsAs.passed, actsAs.detail.includes(theirs)], [false, true]);
  const names = checkIsolation(
    scope,
    call({ as: person("found", "dana"), payload: { email: Cast.castEmail(theirs) } }),
  );
  assert.deepEqual([names.passed, names.detail.includes(Cast.castEmail(theirs))], [false, true]);
  const company = checkIsolation(scope, call({ payload: { handle: Cast.castCompany("pay", Cast.CAST_COMPANY) } }));
  assert.equal(company.passed, false);
  assert.equal(checkIsolation(scope, call({ as: "dana" })).passed, false, "the plain dana is no journey's own");
});

test("a journey in a world of its own may also act as that world's own cast", () => {
  assert.equal(checkIsolation(scopeOf(twoop, true), call({ as: "dana", at: "https://door.test" })).passed, true);
  assert.equal(checkIsolation(scopeOf(twoop, true), call({ as: person("seat", "sam") })).passed, false);
});

test("withIsolation adds the check to every call of a journey, and nothing to a run that is no journey's", () => {
  const calls = [call({ as: "dana" }), call({ as: "eli" })];
  const checked = Arr.map(calls, () => ({ checks: [] }));
  assert.deepEqual(
    Arr.map(withIsolation(scopeOf(found, false), calls, checked), (each) => each.checks.length),
    [1, 1],
  );
  assert.deepEqual(withIsolation(undefined, calls, checked), checked);
});
