import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { checkTime, hostReads, inScope, type Allowlist } from "./service.ts";

const reads = JSON.parse(readFileSync(new URL("../../../time-reads.json", import.meta.url), "utf8")) as Allowlist;
const allow: Allowlist = {
  scope: ["packages/backend/src/"],
  reads: [{ file: "packages/backend/src/a.ts", match: "const deadline = Date.now() + 60_000", label: "real-on-purpose", why: "a retry budget" }],
};
const labelled = { path: "packages/backend/src/a.ts", text: "const deadline = Date.now() + 60_000;\n" };

test("a labelled read passes", () => {
  assert.deepEqual(checkTime([labelled], allow).problems, []);
});

test("an unlabelled host clock read in backend/src fails, in TypeScript, SQL and Python", () => {
  for (const [path, line] of [
    ["packages/backend/src/a.ts", "const at = Date.now();"],
    ["packages/backend/src/a.ts", "const at = new Date();"],
    ["packages/backend/src/a.ts", "await db.query(`update t set at=now()`)"],
    ["packages/backend/src/a.sql", "create table t (at timestamptz not null default now());"],
    ["packages/backend/src/a.sql", "select * from t where due < current_date;"],
    ["packages/backend/src/a.py", "stamp = datetime.now()"],
  ] as const) {
    const { problems } = checkTime([labelled, { path, text: line }], allow);
    assert.equal(problems.length, 1, `${path}: ${line}`);
    assert.match(problems[0]!.why, /unlabelled host clock read/);
  }
});

test("an allowlist entry that labels no read fails, so the list cannot go stale", () => {
  assert.match(checkTime([], allow).problems[0]!.why, /labels no read/);
});

test("an owed read must name its owner, and every read needs a reason and a known label", () => {
  const bad: Allowlist = { scope: [], reads: [
    { file: "x.ts", match: "Date.now()", label: "owed", why: "business time" },
    { file: "y.ts", match: "Date.now()", label: "real-on-purpose", why: " " },
    { file: "z.ts", match: "Date.now()", label: "later" as never, why: "?" },
  ] };
  const whys = checkTime([], bad).problems.map((p) => p.why).join("\n");
  assert.match(whys, /names no owner/);
  assert.match(whys, /has no reason/);
  assert.match(whys, /is not one of/);
});

test("an injected clock named now is not a host read; tests and generated code are out of scope", () => {
  assert.deepEqual(hostReads("packages/backend/src/a.ts", "const at = await now();"), []);
  assert.equal(inScope("packages/backend/src/a.test.ts", allow.scope), false);
  assert.equal(inScope("packages/backend/src/generated/a.ts", allow.scope), false);
  assert.equal(inScope("packages/backend/src/a.ts", allow.scope), true);
});

test("the committed allowlist is well formed, and every owed read names its owner", () => {
  assert.deepEqual(checkTime([], { ...reads, reads: [] }).problems, []);
  for (const read of reads.reads) if (read.label === "owed") assert.ok(read.owner, read.match);
});
