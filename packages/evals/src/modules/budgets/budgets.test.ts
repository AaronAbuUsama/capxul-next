import assert from "node:assert/strict";
import { test } from "node:test";
import { loadTarget } from "../../../../blueprint-engine/scripts/target.ts";
import { budgetOf, judgeBudget, type Budget, type Sample } from "./service.ts";

let clock = 0;
const runs = (kind: string, ...ms: number[]): Sample[] => ms.map((m) => ({ kind, ms: m, clock: "host", startedAt: ++clock }));
const p95 = (p95Ms: number, p50Ms?: number, excludes: string[] = []): Budget => ({ p95Ms, ...(p50Ms === undefined ? {} : { p50Ms }), excludes });

test("the earliest sample of each kind by host-clock start is cold, and every kind and the run need warm samples", () => {
  // Counting the cold 9000 ms start would fail a 1000 ms budget.
  const ok = judgeBudget(p95(1000), [...runs("a", 9000, 100, 120), ...runs("b", 8000, 110)]);
  assert.equal(ok.pass, true, ok.detail);
  assert.equal(ok.n, 3);
  assert.deepEqual(ok.cold.map((s) => s.ms), [9000, 8000]);
  // The order passed does not choose the cold sample: the 5000 ms run started last, so it is warm and fails.
  const late = judgeBudget(p95(1000), [{ kind: "a", ms: 5000, clock: "host", startedAt: 3 }, { kind: "a", ms: 100, clock: "host", startedAt: 1 }, { kind: "a", ms: 120, clock: "host", startedAt: 2 }]);
  assert.deepEqual([late.pass, late.cold.map((s) => s.ms)], [false, [100]]);
  // A missing start or two starts of one kind at the same moment leave the cold sample unknown.
  assert.equal(judgeBudget(p95(1000), [...runs("a", 1, 1, 1), { kind: "a", ms: 1, clock: "host" } as unknown as Sample]).pass, false);
  const tie = judgeBudget(p95(1000), [...runs("a", 1, 1), { kind: "a", ms: 1, clock: "host", startedAt: clock }]);
  assert.match(tie.detail, /share a start/);
  assert.equal(judgeBudget(p95(1000), [...runs("a", 1, 1), { kind: "b", ms: 1, clock: "host", startedAt: clock }, ...runs("b", 1)]).pass, true);
  assert.equal(judgeBudget(p95(1000), runs("a", 9000, 100)).pass, false, "one warm sample is not enough");
  const lone = judgeBudget(p95(1000), [...runs("a", 50, 100, 120), ...runs("b", 10)]);
  assert.equal(lone.pass, false);
  assert.match(lone.detail, /no warm sample for b/);
});

test("below 20 warm samples the maximum and median decide; from 20 nearest-rank p95 and p50 do", () => {
  // Median 650 > 600 fails, although nearest-rank p50 (500) would pass.
  const small = judgeBudget(p95(1000, 600), runs("a", 0, 100, 500, 800, 900));
  assert.equal(small.method, "max-median");
  assert.equal(small.p50, 650);
  assert.equal(small.pass, false);
  // 19 warm samples: one 1001 ms outlier is the maximum and fails a 1000 ms budget.
  assert.equal(judgeBudget(p95(1000), runs("a", 0, ...Array<number>(18).fill(100), 1001)).pass, false);
  // 20 warm samples: the nearest-rank p95 is the 19th smallest, so one outlier no longer decides.
  const large = judgeBudget(p95(1000, 600), runs("a", 0, ...Array.from({ length: 19 }, (_, i) => 10 * (i + 1)), 5000));
  assert.equal(large.method, "nearest-rank");
  assert.deepEqual([large.n, large.p95, large.p50, large.pass], [20, 190, 100, true]);
  // Two outliers in 20 reach the 19th rank.
  assert.equal(judgeBudget(p95(1000), runs("a", 0, ...Array<number>(18).fill(100), 5000, 5000)).pass, false);
  // 21 warm samples: ⌈0.95·21⌉ = 20, so p95 is the 20th smallest (2000), not the 19th (100).
  const odd = judgeBudget(p95(1000), runs("a", 0, ...Array<number>(19).fill(100), 2000, 5000));
  assert.deepEqual([odd.n, odd.p95, odd.pass], [21, 2000, false]);
});

test("only host or span time counts, and only the claim's named waits are subtracted", () => {
  const span = (ms: number, waits: NonNullable<Sample["waits"]>): Sample => ({ kind: "w", ms, clock: "span", startedAt: ++clock, waits });
  const net = judgeBudget(p95(15000, undefined, ["wait.person"]), [...runs("w", 1), span(20000, [{ name: "wait.person", ms: 19000 }]), span(21000, [{ name: "wait.person", ms: 20000 }])]);
  assert.equal(net.pass, true, net.detail);
  assert.deepEqual(net.warm.map((s) => s.netMs), [1000, 1000]);
  // A wait the claim does not exclude, or more waiting than the sample took, is refused rather than subtracted.
  const unnamed = judgeBudget(p95(1000), [...runs("w", 1), span(9000, [{ name: "wait.person", ms: 8999 }]), span(9000, [{ name: "wait.person", ms: 8999 }])]);
  assert.equal(unnamed.pass, false);
  assert.equal(unnamed.n, 0, "N counts warm samples only");
  assert.equal(unnamed.samples.length, 3);
  const over = judgeBudget(p95(1000, undefined, ["wait.person"]), [...runs("w", 1, 1), span(5, [{ name: "wait.person", ms: 6 }])]);
  assert.match(over.detail, /not host-clock/);
  const world = [...runs("a", 1, 1), { kind: "a", ms: 1, clock: "world", startedAt: ++clock } as unknown as Sample];
  assert.equal(judgeBudget(p95(1000), world).pass, false);
});

test("the budget and its exclusions come from the eval's blueprint record", async () => {
  const target = await loadTarget();
  assert.ok(target.ok);
  const b = target.blueprint;
  const record = (id: string) => b.records.get(b.evals.find((e) => e.id === id)!.subject) as unknown as { budget: { excludes?: string[] } };
  const ops = b.evals.filter((e) => e.id.startsWith("bud:") && e.subject.startsWith("operation:"));
  const op = ops.find((e) => !record(e.id).budget.excludes)!, opWaits = ops.find((e) => record(e.id).budget.excludes?.length)!;
  const flow = b.evals.find((e) => e.id.startsWith("bud:") && e.subject.startsWith("workflow:"))!;
  const opBudget = budgetOf(b, op.id), flowBudget = budgetOf(b, flow.id);
  // Independently read the numbers and the workflow's exclusions back out of the claim text the engine wrote.
  assert.match(op.claim, new RegExp(`p95 ≤ ${opBudget.p95Ms} ms and p50 ≤ ${opBudget.p50Ms} ms`));
  assert.deepEqual(opBudget.excludes, []);
  assert.deepEqual(budgetOf(b, opWaits.id).excludes, record(opWaits.id).budget.excludes);
  assert.match(flow.claim, new RegExp(`p95 ≤ ${flowBudget.p95Ms} ms`));
  assert.deepEqual(flowBudget.excludes, /excluding its waits \((.*)\)$/.exec(flow.claim)![1]!.split(", "));
  assert.equal(flowBudget.p50Ms, undefined);
  // A client flow excludes its local wait steps.
  const sdk = b.evals.find((e) => e.id.startsWith("flw:") && e.id.endsWith("/budget") &&
    ((b.records.get(e.subject) as unknown as { steps: { local?: string }[] }).steps.some((s) => s.local === "wait")))!;
  const steps = (b.records.get(sdk.subject) as unknown as { steps: { name: string; local?: string }[] }).steps.filter((s) => s.local === "wait");
  for (const s of steps) assert.ok(budgetOf(b, sdk.id).excludes.includes(`wait.${s.name}`), sdk.id);
  assert.throws(() => budgetOf(b, op.id.replace("bud:", "ret:").replace(/\/p95$/, "")), /not a budget eval/);
});
