import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { withLock } from "./lock.ts";

const fresh = (): string => join(mkdtempSync(join(tmpdir(), "plan-lock-")), "plan.lock");

test("the work runs under the lock, and the lock is gone after", () => {
  const path = fresh();
  const r = withLock(path, () => existsSync(path));
  assert.deepEqual(r, { ok: true, value: true });
  assert.equal(existsSync(path), false);
});

test("the lock is released when the work throws", () => {
  const path = fresh();
  assert.throws(() => withLock(path, () => { throw new Error("boom"); }));
  assert.equal(existsSync(path), false);
});

test("a held lock makes a second writer wait, then refuse", () => {
  const path = fresh();
  mkdirSync(path);
  let clock = Date.now();
  const r = withLock(path, () => "ran", { waitMs: 100, staleMs: 60_000, now: () => clock, sleep: (ms) => { clock += ms; } });
  assert.equal(r.ok, false);
  assert.equal(existsSync(path), true);
});

test("a lock left by a writer that died is taken over", () => {
  const path = fresh();
  mkdirSync(path);
  const old = new Date(Date.now() - 120_000);
  utimesSync(path, old, old);
  assert.deepEqual(withLock(path, () => "ran", { staleMs: 30_000 }), { ok: true, value: "ran" });
});
