import assert from "node:assert/strict";
import { test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { realNowIso, realNowMs, stopwatch } from "./door.ts";

test("RealTime reads the host clock; the stopwatch measures elapsed time monotonically", async () => {
  const before = Date.now(), now = realNowMs(), after = Date.now();
  assert(Number.isSafeInteger(now) && before <= now && now <= after, "epoch milliseconds from the host clock");
  const iso = realNowIso();
  assert.equal(new Date(iso).toISOString(), iso); assert(Math.abs(Date.parse(iso) - Date.now()) < 1_000);
  const elapsed = stopwatch();
  await sleep(25);
  const first = elapsed();
  assert(first >= 20 && first < 1_000, `about 25 ms, got ${first}`);
  assert(elapsed() >= first, "never runs backwards");
});
