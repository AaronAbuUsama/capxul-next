import { test } from "node:test";
import assert from "node:assert/strict";
import { watchAll } from "./service.ts";
import { rig } from "./testing.ts";

test("until-idle exits after sixty idle seconds, not at the first empty look", async () => {
  const r = rig(), base = r.ctx(); let ticks = 0;
  const ctx = { ...base, now: () => new Date(++ticks * 20_000) };
  await watchAll(ctx, { untilIdle: true, intervalMs: 1 });
  assert.ok(ticks >= 4, `clock read ${ticks} times`);
});
