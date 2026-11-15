// A company's site the door did not finish (src/organizations/site.ts, `afterFailure`): one lost only to the site
// door's restart (`interrupted`, door.py) or lost from the door's registry is made again once; a second loss, or a
// site the door could not make (`failed`), stops it. World run 43759314286 (15 November 2026) lost a site to a
// redeploy of the door.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { afterFailure } from "../src/organizations/site.ts";

test("a site interrupted by the door's restart is made again, once", () => {
  assert.equal(afterFailure("interrupted", 0), "again");
});

test("a site interrupted a second time stops", () => {
  assert.equal(afterFailure("interrupted", 1), "stop");
});

test("a site the door could not make stops at once, however often the door restarted before", () => {
  assert.equal(afterFailure("failed", 0), "stop");
  assert.equal(afterFailure("failed", 1), "stop");
});

test("a site the door lost from its registry is made again once, then stops", () => {
  assert.equal(afterFailure("lost", 0), "again");
  assert.equal(afterFailure("lost", 1), "stop");
});

test("a restart and then a failure of the site made again stops it", () => {
  const first = afterFailure("interrupted", 0);
  const restarts = first === "again" ? 1 : 0;
  assert.equal(afterFailure("failed", restarts), "stop");
});
