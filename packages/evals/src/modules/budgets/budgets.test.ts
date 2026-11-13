import assert from "node:assert/strict";
import { test } from "node:test";
import { loadTarget } from "../../../../blueprint-engine/scripts/target.ts";
import { budgetOf, judgeBudget, type Sample } from "./service.ts";

const runs = (kind: string, ...ms: number[]): Sample[] => ms.map((m) => ({ kind, ms: m, clock: "host" }));

test("the first sample of each kind is cold, and every kind and the run need warm samples", () => {
  // Counting the cold 9000 ms start would fail a 1000 ms budget.
  const ok = judgeBudget({ p95Ms: 1000 }, [...runs("a", 9000, 100, 120), ...runs("b", 8000, 110)]);
  assert.equal(ok.pass, true, ok.detail);
  assert.equal(ok.n, 3);
  assert.deepEqual(ok.cold.map((s) => s.ms), [9000, 8000]);
  assert.equal(judgeBudget({ p95Ms: 1000 }, runs("a", 9000, 100)).pass, false, "one warm sample is not enough");
  const lone = judgeBudget({ p95Ms: 1000 }, [...runs("a", 50, 100, 120), ...runs("b", 10)]);
  assert.equal(lone.pass, false);
  assert.match(lone.detail, /no warm sample for b/);
});

test("below 20 warm samples the maximum and median decide; from 20 nearest-rank p95 and p50 do", () => {
  // Median 650 > 600 fails, although nearest-rank p50 (500) would pass.
  const small = judgeBudget({ p95Ms: 1000, p50Ms: 600 }, runs("a", 0, 100, 500, 800, 900));
  assert.equal(small.method, "max-median");
  assert.equal(small.p50, 650);
  assert.equal(small.pass, false);
  // 19 warm samples: one 1001 ms outlier is the maximum and fails a 1000 ms budget.
  assert.equal(judgeBudget({ p95Ms: 1000 }, runs("a", 0, ...Array<number>(18).fill(100), 1001)).pass, false);
  // 20 warm samples: the nearest-rank p95 is the 19th smallest, so one outlier no longer decides.
  const large = judgeBudget({ p95Ms: 1000, p50Ms: 600 }, runs("a", 0, ...Array.from({ length: 19 }, (_, i) => 10 * (i + 1)), 5000));
  assert.equal(large.method, "nearest-rank");
  assert.deepEqual([large.n, large.p95, large.p50, large.pass], [20, 190, 100, true]);
  // Two outliers in 20 reach the 19th rank.
  assert.equal(judgeBudget({ p95Ms: 1000 }, runs("a", 0, ...Array<number>(18).fill(100), 5000, 5000)).pass, false);
});

test("only host or span time counts, and declared waits are subtracted", () => {
  const net = judgeBudget({ p95Ms: 15000 }, [{ kind: "w", ms: 1, clock: "host" }, ...[20000, 21000].map((ms) => ({ kind: "w", ms, clock: "span" as const, waitMs: ms - 1000 }))]);
  assert.equal(net.pass, true, net.detail);
  assert.deepEqual(net.warm.map((s) => s.netMs), [1000, 1000]);
  const world = [...runs("a", 1, 1), { kind: "a", ms: 1, clock: "world" } as unknown as Sample];
  assert.equal(judgeBudget({ p95Ms: 1000 }, world).pass, false);
  assert.equal(judgeBudget({ p95Ms: 1000 }, [...runs("a", 1, 1), { kind: "a", ms: 5, clock: "host", waitMs: 6 }]).pass, false);
});

test("the budget comes from the eval's blueprint record", async () => {
  const target = await loadTarget();
  assert.ok(target.ok);
  const b = target.blueprint;
  const op = b.evals.find((e) => e.id.startsWith("bud:") && e.subject.startsWith("operation:"))!;
  const flow = b.evals.find((e) => e.id.startsWith("bud:") && e.subject.startsWith("workflow:"))!;
  const opBudget = budgetOf(b, op.id), flowBudget = budgetOf(b, flow.id);
  // Independently read the numbers back out of the claim text the engine wrote.
  assert.match(op.claim, new RegExp(`p95 ≤ ${opBudget.p95Ms} ms and p50 ≤ ${opBudget.p50Ms} ms`));
  assert.match(flow.claim, new RegExp(`p95 ≤ ${flowBudget.p95Ms} ms`));
  assert.equal(flowBudget.p50Ms, undefined);
  assert.throws(() => budgetOf(b, op.id.replace("bud:", "ret:").replace(/\/p95$/, "")), /not a budget eval/);
});
