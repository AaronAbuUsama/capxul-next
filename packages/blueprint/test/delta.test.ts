// The delta check run over the blueprint itself (docs/roadmap.md, steps 3.5 and 3.10): every operation has every
// format the toolkit's registry holds, or is on that format's `unmigrated` list (src/ratchets.ts), and each list is
// under its ceiling, which may only fall. The toolkit imports nothing of the blueprint: the blueprint passes itself in
// here, and the toolkit's own tests run the check on made-up domains. Moved from packages/blueprint-tools' tests by
// item 3.10, unchanged but for the formats it added. Run with `pnpm test`.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { deltaCheck, formats } from "@capxul/blueprint-tools";
import * as Arr from "effect/Array";
import * as Rec from "effect/Record";
import * as Blueprint from "../src/index.ts";

/**
 * The most operations each format's `unmigrated` list may hold. Set by the lead; each may only fall. Item 3.10 added
 * allowed, spans and logs at today's count, every operation but the invitation's four, and promises at the eight
 * whose promises do not yet name every refusal they decide.
 */
const CEILINGS: { readonly [format: string]: number } = {
  machine: 13,
  allowed: 22,
  spans: 22,
  logs: 22,
  budget: 0,
  promises: 8,
  telemetry: 0,
};

const registry = formats(Blueprint);

test("the blueprint: every operation has every format, or is on its unmigrated list", () => {
  const findings = deltaCheck({ operations: Rec.keys(Blueprint.operations), formats: registry });
  assert.deepEqual(
    Arr.map(findings, (each) => `${each.operation} (${each.format}): ${each.reason}`),
    [],
  );
});

test("the blueprint: every format's unmigrated list is under its ceiling, which may only fall, and has no repeats", () => {
  assert.deepEqual(Rec.keys(registry), Rec.keys(CEILINGS), "every format has a ceiling, and only formats do");
  for (const [name, format] of Rec.toEntries(registry)) {
    const ceiling = CEILINGS[name] ?? 0;
    assert.ok(format.unmigrated.length <= ceiling, `${name}: ${format.unmigrated.length} over ${ceiling}`);
    assert.equal(Arr.dedupe(format.unmigrated).length, format.unmigrated.length, `${name}: an entry twice`);
  }
});
