// The platform's names: which stages it accepts, and the DNS names and prefixes a stage gets.
import assert from "node:assert/strict";
import { test } from "node:test";
import { isStage, namesOf } from "../src/names.ts";

test("only staging and pr- stages are accepted", () => {
  for (const ok of ["staging", "pr-p1", "pr-a", "pr-0123456789abcdefghij-"]) assert.ok(isStage(ok), ok);
  for (const no of ["prod", "pr-", "pr-UPPER", "pr-a_b", "staging2", "pr-0123456789abcdefghijkl", ""])
    assert.ok(!isStage(no), no);
});

test("every name of a stage is derived from it, one level under the domain", () => {
  const n = namesOf("staging", "worlds.abuusama.dev");
  assert.equal(n.prefix, "cx-platform-staging");
  assert.equal(n.aws, "capxul-bench-staging");
  assert.equal(n.container("web"), "cx-platform-staging-web");
  assert.equal(n.doorHost, "staging-door.worlds.abuusama.dev");
  assert.equal(n.siteWildcard, "*.worlds.abuusama.dev");
  assert.equal(n.hostname("acme-r1"), "acme-r1.worlds.abuusama.dev");
});
