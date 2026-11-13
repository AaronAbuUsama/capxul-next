import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { warpTarget, warpWorld, type WarpFollowers } from "./warp.ts";

const DAY = 86_400_000, NOW = Date.parse("2026-10-09T15:13:34Z");
const frozen = { nowMs: NOW, clockMode: "stopped" as const, rate: 1 };
const sites = [{ company: "harbourline", name: "harbourline-w.localhost" }, { company: "northwind", name: "northwind-w.localhost" }];

/** Followers that log every move; Core's due work is a list of instants, each settling `lag` openDue calls after its stop. */
function world(due: number[], opts: { lag?: number; failSiteAt?: number; neverSettles?: boolean } = {}) {
  const log: string[] = [];
  let polls = 0;
  const followers: WarpFollowers = {
    async database(clock) { log.push(`db ${clock.nowMs - NOW}`); },
    async nextDue(after, until) { return due.filter((at) => at > after && at <= until).sort((a, b) => a - b)[0] ?? null; },
    async openDue(at) {
      if (opts.neverSettles) return { "app.notice_workflows": 1 };
      return due.some((d) => d <= at) && polls++ < (opts.lag ?? 0) ? { "app.notice_attempts": 1 } : {};
    },
    async chain(nowMs, depth) { log.push(`chain ${nowMs - NOW} +${depth}`); },
    async site(site, from, to) {
      if (to === opts.failSiteAt && site.company === "northwind") throw new Error("bench execute failed");
      log.push(`site ${site.company} ${from - NOW}..${to - NOW}`);
    },
    async bench(clock) { log.push(`bench ${clock.nowMs - NOW}`); },
  };
  return { log, followers };
}
async function inState<T>(run: (dir: string) => Promise<T>) {
  const dir = await mkdtemp(join(tmpdir(), "capxul-warp-"));
  try { return await run(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}

test("a warp's target is a forward duration or a later date, never now or the past", () => {
  assert.equal(warpTarget(NOW, { by: "7d" }), NOW + 7 * DAY);
  assert.equal(warpTarget(NOW, { by: "1d12h30m" }), NOW + DAY + 12 * 3_600_000 + 30 * 60_000);
  assert.equal(warpTarget(NOW, { to: "2026-10-20" }), Date.parse("2026-10-20T00:00:00Z"));
  assert.equal(warpTarget(NOW, { to: "2026-10-09T15:13:35Z" }), NOW + 1000);
  for (const input of [{ by: "-1d" }, { by: "0d" }, { by: "7" }, { by: "1x" }, { to: "2026-10-09" }, { to: "2026-10-09T15:13:34Z" }, { to: "yesterday" }, {}, { by: "1d", to: "2026-12-01" }]) {
    assert.throws(() => warpTarget(NOW, input), /^Error: INVALID_INPUT: /, JSON.stringify(input));
  }
});

test("a warp stops at each of Core's due instants in order, then the target, moving every follower to each stop", async () => {
  const { log, followers } = world([NOW + 3 * DAY, NOW + DAY]);
  const result = await inState((dir) => warpWorld(frozen, NOW + 7 * DAY, followers, { stateDir: dir, sites, finality: 2 }));
  assert.deepEqual(result.stops, [NOW + DAY, NOW + 3 * DAY, NOW + 7 * DAY]);
  assert.equal(result.worldNow, NOW + 7 * DAY);
  const stop = (from: number, to: number) => [`chain ${to * DAY} +2`, `site harbourline ${from * DAY}..${to * DAY}`, `site northwind ${from * DAY}..${to * DAY}`, `bench ${to * DAY}`, `db ${to * DAY}`];
  assert.deepEqual(log, [...stop(0, 1), ...stop(1, 3), ...stop(3, 7)]);
});

test("the clock file and every follower end at the target; Core's busy work is waited for at its stop", async () => {
  await inState(async (dir) => {
    const { followers } = world([NOW + DAY], { lag: 3 });
    const result = await warpWorld(frozen, NOW + 2 * DAY, followers, { stateDir: dir, sites, finality: 0, settleMs: 5000 });
    assert.deepEqual(JSON.parse(await readFile(join(dir, "clock.json"), "utf8")), { ...frozen, nowMs: NOW + 2 * DAY });
    assert.deepEqual(result.stops, [NOW + DAY, NOW + 2 * DAY]);
  });
});

test("Core still busy at a stop refuses WORK_DIED naming the stop and the open work, the authority back at the last settled stop", async () => {
  const { log, followers } = world([NOW + DAY], { neverSettles: true });
  await inState(async (dir) => {
    await assert.rejects(warpWorld(frozen, NOW + 7 * DAY, followers, { stateDir: dir, sites, finality: 0, settleMs: 300 }),
      /^Error: WORK_DIED: Core did not settle at the stop 2026-10-10T15:13:34.000Z: still open app.notice_workflows 1; the clock stays at 2026-10-09T15:13:34.000Z/);
    assert.equal(JSON.parse(await readFile(join(dir, "clock.json"), "utf8")).nowMs, NOW, "the authority is back at the last settled instant");
  });
  assert.deepEqual(log.filter((line) => line.startsWith("db ")), [`db ${DAY}`, "db 0"]);
});

test("a follower that fails at a stop leaves the authority at the last stop that settled and names the follower", async () => {
  const { log, followers } = world([NOW + DAY], { failSiteAt: NOW + 7 * DAY });
  await inState(async (dir) => {
    await assert.rejects(warpWorld(frozen, NOW + 7 * DAY, followers, { stateDir: dir, sites, finality: 0 }),
      /^Error: WORK_DIED: the stop at 2026-10-16T15:13:34.000Z did not settle: site northwind failed \(bench execute failed\); the clock stays at 2026-10-10T15:13:34.000Z/);
    assert.equal(JSON.parse(await readFile(join(dir, "clock.json"), "utf8")).nowMs, NOW + DAY);
  });
  assert.equal(log.filter((line) => line.startsWith("db ")).at(-1), `db ${DAY}`, "the database authority never reached the failed stop");
  assert(!log.includes(`bench ${7 * DAY}`), "the bench entry never reached the failed stop");
});

test("only a frozen world is warped", async () => {
  const { followers } = world([]);
  await assert.rejects(warpWorld({ ...frozen, clockMode: "running" as never }, NOW + DAY, followers, { stateDir: "/nonexistent", sites, finality: 0 }), /^Error: WRONG_STATE: /);
});
