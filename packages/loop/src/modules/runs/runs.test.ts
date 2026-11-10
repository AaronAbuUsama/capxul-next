import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { open, script } from "./die.fixture.ts";
import { acquire, alive, ledgerLines, listRuns, play, readInfo, spendText, stop, table, tryAcquire, work } from "./service.ts";

const rig = () => { const dir = mkdtempSync(join(tmpdir(), "loop-runs-")); return { dir, run: join(dir, "r1"), counter: join(dir, "counter"), marker: join(dir, "marker") }; };
const steps = (counter: string): string => readFileSync(counter, "utf8").split("\n").filter(Boolean).join("");

test("a run killed in step b resumes at b: a is not redone, b is, c follows", async () => {
  const r = rig();
  const child = spawnSync("node", ["--experimental-strip-types", "--no-warnings", join(import.meta.dirname, "die.fixture.ts"), "child", r.run, r.counter, r.marker]);
  assert.equal(child.signal, "SIGKILL");
  const dead = readInfo(r.run);
  assert.equal(dead.status, "running");
  assert.equal(dead.step, "b");
  assert.equal(alive(dead.pid), false);
  assert.match(table([dead], new Date()), /dead \(resume\)/);
  assert.equal(steps(r.counter), "ab");

  const info = await play({ dir: r.run, id: "r1", subject: "t", open: open(r.run), script: script(r.counter, r.marker) });
  assert.equal(info.status, "ready");
  assert.equal(steps(r.counter), "abbc");               // a once; b in flight, so again; c once
  const host = await open(r.run)();
  assert.match((await ledgerLines(host)).join("\n"), /end\s+ready/);
  await host.close();
});

test("a step repeated by name does no harm, and a finished run played again changes nothing", async () => {
  const r = rig();
  let calls = 0;
  const twice = async (run: Parameters<typeof play>[0]["script"] extends (r: infer R) => unknown ? R : never) => {
    assert.equal(await run.step("same", async () => ++calls), 1);
    assert.equal(await run.step("same", async () => ++calls), 1);
    await run.end("answered", ["x"]);
  };
  await play({ dir: r.run, id: "r1", subject: "t", open: open(r.run), script: twice });
  await play({ dir: r.run, id: "r1", subject: "t", open: open(r.run), script: twice });
  assert.equal(calls, 1);
  assert.equal(listRuns(r.dir).length, 1);
});

test("stop ends a run at its next step; a run whose process is gone is marked stopped", async () => {
  const r = rig();
  const info = await play({
    dir: r.run, id: "r1", subject: "t", open: open(r.run),
    script: async (run) => { await run.step("one", async () => 1); stop(r.run); await run.step("two", async () => 2); },
  });
  assert.equal(info.status, "stopped");
  assert.equal(readInfo(r.run).step, "one");           // step two never started
  assert.match(stop(r.run), /is stopped/);
});

test("the worker resumes dead runs first, then starts ready tasks, up to its concurrency, and ends when idle", async () => {
  const log: string[] = [];
  let ready = ["t1", "t2", "t3"];
  await work({
    concurrency: 2, wait: false, pause: 5, say: () => undefined, dead: () => (log.includes("resume:d1") ? [] : ["d1"]),
    ready: () => ready, resume: async (id) => { log.push(`resume:${id}`); }, start: async (s) => { log.push(`start:${s}`); ready = ready.filter((x) => x !== s); },
  });
  assert.deepEqual(log.slice(0, 2), ["resume:d1", "start:t1"]);
  assert.deepEqual(log.filter((l) => l.startsWith("start")).sort(), ["start:t1", "start:t2", "start:t3"]);
});

test("what was used reads as dollars when there is a price and as tokens when there is none, never as $0.00", () => {
  assert.equal(spendText(1.234, 5000), "$1.23");
  assert.equal(spendText(0, 1_774_290), "1.77M tokens");
  assert.equal(spendText(0, 196_938), "197k tokens");
  assert.equal(spendText(0, 963), "963 tokens");
  assert.equal(spendText(0, 0), "-");
  const row = table([{ id: "r1", subject: "t", status: "ready", step: null, round: 1, startedAt: "2026-11-10T13:23:45.530Z", updatedAt: "", endedAt: "2026-11-10T13:37:22.100Z", pid: 0, spentUsd: 0, tokens: 1_774_290, reasons: [], extra: {} }], new Date());
  assert.match(row, /1\.77M tokens/);
  assert.doesNotMatch(row, /\$0/);
});

test("a run that was stopped ends a waiting worker: it starts nothing more; a start that throws is said and the worker goes on", async () => {
  const said: string[] = [], started: string[] = [];
  let ready = ["boom", "t1", "t2"];
  await work({
    concurrency: 1, wait: true, pause: 5, say: (l) => said.push(l), dead: () => [], ready: () => ready, resume: async () => undefined,
    start: async (s) => { started.push(s); ready = ready.filter((x) => x !== s); if (s === "boom") throw new Error("cannot start boom"); return { status: s === "t1" ? "stopped" : "ready" }; },
  });                                                                    // returns although `wait` is set
  assert.deepEqual(started, ["boom", "t1"]);                             // t2 was never started
  assert.ok(said.includes("cannot start boom"));
  assert.ok(said.some((l) => /^t1 was stopped: the worker starts nothing more/.test(l)));
});

test("slots: no more than the limit hold one at a time; a release or a dead holder frees one; a stop ends the wait", async () => {
  const dir = mkdtempSync(join(tmpdir(), "loop-slots-"));
  const a = await acquire(dir, 2), b = await acquire(dir, 2);
  assert.equal(tryAcquire(dir, 2), undefined);
  let waited = false;
  const third = acquire(dir, 2, { pollMs: 5, waiting: () => { waited = true; } });
  await new Promise((r) => setTimeout(r, 20));
  a();
  const c = await third;
  assert.equal(waited, true);
  assert.equal(tryAcquire(dir, 2), undefined);
  b(); c();
  writeFileSync(join(dir, "slot-0"), "999999");                       // a holder whose process is gone
  writeFileSync(join(dir, "slot-1"), String(process.pid));            // and one that is alive
  const d = tryAcquire(dir, 2);
  assert.ok(d, "the dead holder's slot is free");
  await assert.rejects(acquire(dir, 2, { pollMs: 5, stopped: () => true }), /stopped/);
  d();
});
