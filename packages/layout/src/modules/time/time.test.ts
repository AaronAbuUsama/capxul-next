import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { checkTime, hostReads, inScope, type Allowlist } from "./service.ts";

const committed = JSON.parse(readFileSync(new URL("../../../time-reads.json", import.meta.url), "utf8")) as Allowlist;
const allow: Allowlist = {
  include: ["packages/*/src/", "packages/frappe-app/capxul/"], exclude: { "packages/evals/": "the harness" }, module: "packages/runtime/src/time/",
  reads: [
    { file: "packages/backend/src/a.ts", line: "const deadline = Date.now() + 60_000;", label: "real-on-purpose", why: "a retry budget" },
    { file: "packages/backend/src/schema.sql", line: "at timestamptz not null default now()", label: "owed", why: "business time", owner: "Core" },
  ],
};
const labelled = [
  { path: "packages/backend/src/a.ts", text: "const deadline = Date.now() + 60_000;\n" },
  { path: "packages/backend/src/schema.sql", text: "create table r (\n  at timestamptz not null default now()\n);\n" },
];
const problems = (extra: { path: string; text: string }[], list = allow) => checkTime([...labelled, ...extra], list).problems;

test("labelled reads pass", () => {
  assert.deepEqual(problems([]), []);
});

test("an unlabelled host clock read fails in TypeScript, JavaScript, SQL and Python, in every spelling", () => {
  for (const [path, line] of [
    ["packages/backend/src/b.ts", "const at = Date.now();"],
    ["packages/backend/src/b.ts", "const at = new Date();"],
    ["packages/backend/src/b.mjs", "export const at = Date.now();"],
    ["packages/backend/src/b.ts", "await db.query(`update t set at=now()`)"],
    ["packages/backend/src/b.ts", "await db.query(`select 1 where due<now()`)"],
    ["packages/backend/src/b.sql", "create table t (due_at timestamptz not null default now());"],
    ["packages/backend/src/b.sql", "select * from t where due < current_date;"],
    ["packages/backend/src/b.sql", "insert into t values (transaction_timestamp());"],
    ["packages/frappe-app/capxul/b.py", "stamp = datetime.now()"],
    ["packages/frappe-app/capxul/b.py", "day = datetime.today()"],
    ["packages/frappe-app/capxul/b.py", "frappe.db.sql(\"update t set modified=NOW() where name=%s\", name)"],
    ["packages/frappe-app/capxul/b.py", "frappe.db.sql(\"select 1 where d <= CURDATE()\")"],
    ["packages/frappe-app/capxul/b.py", "values (%s,NOW(6),NOW(6),%s)"],
    ["packages/backend/src/b.sql", "update t set at = now ( 3 );"],
    ["packages/backend/src/b.ts", "const at = new Date;"],
    ["packages/backend/src/b.ts", "const stamp = Date();"],
    ["packages/backend/src/b.ts", "const origin = performance.timeOrigin;"],
  ] as const) {
    const found = problems([{ path, text: line }]);
    assert.equal(found.length, 1, `${path}: ${line}`);
    assert.match(found[0]!.why, /unlabelled host clock read/);
  }
});

test("an entry labels its whole line only: a new column cannot hide behind an owed one, nor a copied line behind its count", () => {
  // The owed `at ... default now()` must not label `due_at ... default now()`, which contains it.
  const hidden = problems([{ path: "packages/backend/src/schema.sql", text: "  at timestamptz not null default now()\n  due_at timestamptz not null default now()\n" }]);
  assert.ok(hidden.some((p) => /unlabelled host clock read: due_at/.test(p.why)), JSON.stringify(hidden));
  // The same line twice is one more read than labelled.
  const copied = checkTime([labelled[0]!, { path: "packages/backend/src/schema.sql", text: "at timestamptz not null default now()\nat timestamptz not null default now()\n" }], allow).problems;
  assert.match(copied.map((p) => p.why).join("\n"), /occurs on 2 lines, labelled for 1/);
});

test("scope is every package's src, so a new package is scanned; only named tooling is excluded", () => {
  assert.equal(inScope("packages/newthing/src/a.ts", allow), true, "a package added later is scanned without editing the list");
  assert.equal(inScope("packages/newthing/src/a.js", allow), true);
  assert.equal(inScope("packages/evals/src/a.ts", allow), false);
  assert.equal(inScope("packages/backend/src/a.test.ts", allow), false);
  assert.equal(inScope("packages/backend/src/a.native.ts", allow), false, "opt-in native proofs are tests");
  assert.equal(inScope("packages/backend/src/generated/a.ts", allow), false);
  assert.deepEqual(hostReads("packages/backend/src/a.ts", "const at = await now();"), [], "an injected clock named now is the caller's clock");
  assert.deepEqual(hostReads("packages/backend/src/a.ts", "const at = clock.now();"), [], "a member named now is not SQL's now()");
});

test("only the clock module reads a clock unlabelled; a label inside it is refused", () => {
  assert.deepEqual(problems([{ path: "packages/runtime/src/time/real-time.ts", text: "export const realNowMs = () => Date.now();" }]), []);
  assert.match(problems([{ path: "packages/runtime/src/other.ts", text: "export const at = Date.now();" }])[0]!.why, /unlabelled host clock read/);
  const inside = { ...allow, reads: [...allow.reads, { file: "packages/runtime/src/time/real-time.ts", line: "Date.now()", label: "real-on-purpose" as const, why: "x" }] };
  assert.match(problems([{ path: "packages/runtime/src/time/real-time.ts", text: "Date.now()" }], inside).map((p) => p.why).join("\n"), /needs no labels/);
});

test("the list cannot go stale or vague: unused entries, owed reads or work without an owner, unexplained exclusions all fail", () => {
  assert.match(checkTime([], allow).problems[0]!.why, /labels no read/);
  const bad: Allowlist = { include: [], exclude: { "packages/x/": " " }, module: "", reads: [
    { file: "x.ts", line: "Date.now()", label: "owed", why: "business time" },
    { file: "y.ts", line: "Date.now()", label: "real-on-purpose", why: " " },
    { file: "z.ts", line: "Date.now()", label: "later" as never, why: "?" },
  ], work: [{ id: "w", owner: "", what: "x" }] };
  const whys = checkTime([], bad).problems.map((p) => p.why).join("\n");
  for (const expected of [/names no owner/, /has no reason/, /is not one of/, /owed work needs an owner/, /excluded path needs its reason/]) assert.match(whys, expected);
});

test("the committed list is well formed and reports its owed work", () => {
  const { problems: found, owed } = checkTime([], { ...committed, reads: [] });
  assert.deepEqual(found, []);
  for (const read of committed.reads) if (read.label === "owed") assert.ok(read.owner, read.line);
  assert.ok(owed.some((o) => "id" in o && o.id.startsWith("devnet.site-follows-world")), "unbuilt clock work in decisions is listed as owed");
});

test("every host clock read time.no-direct-reads names is found, and the list is the decision's own", () => {
  const decision = readFileSync(new URL("../../../../../blueprint/shared/time.ts", import.meta.url), "utf8");
  for (const [token, line] of [
    ["Date.now()", "const at = Date.now();"], ["new Date() without an argument", "const at = new Date();"],
    ["performance.now()", "const t = performance.now();"], ["process.hrtime", "const t = process.hrtime.bigint();"],
    ["Clock.currentTimeMillis", "const t = yield* Clock.currentTimeMillis;"], ["currentTimeNanos", "const t = yield* Clock.currentTimeNanos;"],
    ["DateTime.now", "const t = yield* DateTime.now;"], ["nowAsDate", "const t = yield* DateTime.nowAsDate;"], ["nowUnsafe", "const t = DateTime.nowUnsafe();"],
    ["Postgres now()", "select now();"], ["current_timestamp", "select current_timestamp;"],
    ["clock_timestamp()", "select clock_timestamp();"], ["transaction_timestamp()", "select transaction_timestamp();"],
  ] as const) {
    assert.ok(decision.includes(token), `time.no-direct-reads no longer names ${token}; update this list from the decision`);
    assert.equal(hostReads("packages/backend/src/b.ts", line).length, 1, `${token}: ${line}`);
  }
  assert.deepEqual(hostReads("packages/backend/src/b.ts", "const at = new Date(input.at);"), [], "a date from a value is not a clock read");
});
