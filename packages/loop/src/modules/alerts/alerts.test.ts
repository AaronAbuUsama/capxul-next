import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { reconcile, type Alert, type Snapshot } from "./service.ts";
import { alertRuns } from "./inputs.ts";

const fixture = () => {
  const dir = mkdtempSync(join(tmpdir(), "alerts-")), file = join(dir, "alerts.json");
  let time = 0;
  const sent: Alert[] = [];
  return { dir, file, sent, now: () => new Date(time++ * 1000), sender: async (a: Alert) => { sent.push(a); }, close: () => rmSync(dir, { recursive: true, force: true }) };
};
test("dead views are superseded by later runs or a closed task even though inspect preserves running status", () => {
  const dead = { id: "old", task: "task", status: "dead", superseded: null, startedAt: "2026-01-01" };
  assert.ok(alertRuns([dead, { ...dead, id: "new", startedAt: "2026-02-01", status: "running" }], new Set())[0]!.superseded);
  assert.ok(alertRuns([dead], new Set(["task"]))[0]!.superseded);
  assert.equal(alertRuns([dead], new Set())[0]!.superseded, null);
});

const question = { id: "q1", text: "Which option?" };
const run = { id: "r1", task: "t1", status: "failed", superseded: null };
const snapshot: Snapshot = { questions: [question], runs: [run] };

test("startup catches up old questions and failures; restart deduplicates; new questions while offline catch up", async () => {
  const f = fixture();
  try {
    await reconcile(f, snapshot);
    assert.equal(f.sent.length, 2);
    assert.match(f.sent[0]!.url, /https:\/\/macbook.tail4b9a40.ts.net:8443\/review\//);
    assert.match(f.sent[1]!.url, /\/runs\//);
    const restart = { file: f.file, now: f.now, sender: f.sender };
    await reconcile(restart, snapshot);
    assert.equal(f.sent.length, 2);
    await reconcile(restart, { ...snapshot, questions: [question, { id: "q2", text: "New?" }] });
    assert.equal(f.sent.length, 3);
    assert.equal(f.sent[2]!.body, "New?");
  } finally { f.close(); }
});

test("one alert per status/question episode, including recovery and changed need", async () => {
  const f = fixture();
  try {
    await reconcile(f, snapshot);
    await reconcile(f, snapshot);
    await reconcile(f, { questions: [], runs: [{ ...run, status: "running" }] });
    await reconcile(f, snapshot);
    assert.equal(f.sent.length, 4);
    await reconcile(f, { questions: [{ ...question, text: "Different?" }], runs: [{ ...run, status: "dead" }] });
    await reconcile(f, { questions: [{ ...question, text: "Different?" }], runs: [{ ...run, status: "dead" }] });
    assert.equal(f.sent.length, 6);
  } finally { f.close(); }
});

test("superseded runs and coordinator-only states are ignored, including pending cancellations", async () => {
  const f = fixture();
  try {
    const bad = { ...f, sender: async () => { throw new Error("offline"); } };
    await assert.rejects(reconcile(bad, { questions: [], runs: [run] }));
    await reconcile(f, { questions: [], runs: [
      { ...run, superseded: "newer run" }, { ...run, id: "dead", status: "dead", superseded: "closed task" },
      { ...run, id: "blocked", status: "blocked" }, { ...run, id: "model", status: "running" },
    ] });
    assert.equal(f.sent.length, 0);
  } finally { f.close(); }
});

test("pending intent survives sender failure and restart; successful siblings are not repeated", async () => {
  const f = fixture();
  try {
    await assert.rejects(reconcile({ ...f, sender: async (a) => {
      const disk = JSON.parse(readFileSync(f.file, "utf8"));
      assert.equal(Object.values(disk.episodes).length, 2);
      if (a.url.endsWith("/runs/")) throw new Error("unavailable");
      f.sent.push(a);
    } }, snapshot));
    await reconcile({ file: f.file, now: f.now, sender: f.sender }, snapshot);
    await reconcile(f, snapshot);
    assert.equal(f.sent.length, 2);
  } finally { f.close(); }
});

test("--once previews without sending or consuming alerts", async () => {
  const f = fixture();
  try {
    assert.equal((await reconcile(f, snapshot, true)).length, 2);
    assert.equal(f.sent.length, 0);
    await reconcile(f, snapshot);
    const saved = readFileSync(f.file, "utf8");
    assert.equal((await reconcile(f, snapshot, true)).length, 0);
    assert.equal(readFileSync(f.file, "utf8"), saved);
  } finally { f.close(); }
});
