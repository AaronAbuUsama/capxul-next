import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { Site } from "./door.ts";
import type { WorldClock } from "./clock.ts";

/** What a warp moves. Each is one follower of the one world clock (devnet.one-world-clock); the composition supplies the real ones. */
export type WarpFollowers = {
  /** The authority row in the world database. */
  database(clock: WorldClock): Promise<void>;
  /** Core's open due work: the next instant after `after` up to `until`, and what is still open at `at` (devnet.warp-barrier). */
  nextDue(after: number, until: number): Promise<number | null>;
  openDue(at: number): Promise<Record<string, number>>;
  /** The chain's head and next block, both dated at `nowMs`, mined `depth` blocks past the stop so the indexer finalizes it. */
  chain(nowMs: number, depth: number): Promise<void>;
  /** One site's due jobs from `fromMs` to `toMs`, stopping at each of its own midnights (capxul.clock.advance). */
  site(site: Site, fromMs: number, toMs: number): Promise<void>;
  /** The bench's clock entry for the world, which every site's web and job workers read. */
  bench(clock: WorldClock): Promise<void>;
};
export type WarpOptions = { stateDir: string; sites: readonly Site[]; finality: number; settleMs?: number; maxStops?: number };
export type WarpResult = { clockMode: "stopped"; rate: number; worldNow: number; stops: number[] };

const UNITS: Record<string, number> = { w: 7 * 86_400_000, d: 86_400_000, h: 3_600_000, m: 60_000, s: 1000 };
/** `--by 7d`, `1d12h`, `90m` or `--to` an ISO date or instant, relative to the world's now. Not backwards. */
export function warpTarget(nowMs: number, input: { by?: string | null | undefined; to?: string | null | undefined }): number {
  if (!!input.by === !!input.to) throw new Error("INVALID_INPUT: give exactly one of --by DURATION or --to DATE");
  let target: number;
  if (input.by) {
    const parts = [...input.by.matchAll(/(\d+)([wdhms])/g)];
    if (!/^(\d+[wdhms])+$/.test(input.by) || !parts.length) throw new Error(`INVALID_INPUT: ${input.by} is not a forward duration such as 7d, 1d12h or 90m`);
    target = nowMs + parts.reduce((sum, [, n, unit]) => sum + Number(n) * UNITS[unit!]!, 0);
  } else {
    target = /^\d{4}-\d{2}-\d{2}$/.test(input.to!) ? Date.parse(`${input.to}T00:00:00Z`) : Date.parse(input.to!);
    if (!Number.isFinite(target)) throw new Error(`INVALID_INPUT: ${input.to} is not a date`);
  }
  if (!Number.isSafeInteger(target) || target <= nowMs) throw new Error(`INVALID_INPUT: the target ${new Date(target).toISOString()} is not later than the world's now ${new Date(nowMs).toISOString()}`);
  return target;
}

/**
 * devnet.warp-barrier, on a frozen world: from the world's now to `target`, stopping at every instant Core's due work falls at and at
 * the target. At each stop the followers move first (the chain mined to depth, each site through its own midnights, the bench entry)
 * and the authority last (clock file and database row), then the warp waits until Core has no open due work at or before the stop.
 * A follower that fails leaves the authority at the last stop that settled, and the refusal names the stop and the follower; the chain
 * cannot go back, so followers that already moved are ahead until a retried warp brings the authority to them. Core needs the stop's
 * time to run its due work, so the authority moves before the wait; Core still busy after `settleMs` puts it back to the last stop that
 * settled and refuses, naming what stayed open.
 */
export async function warpWorld(from: WorldClock, target: number, followers: WarpFollowers, options: WarpOptions): Promise<WarpResult> {
  if (from.clockMode !== "stopped") throw new Error("WRONG_STATE: only a frozen world is warped; freeze it first");
  const stops: number[] = [], at = (ms: number) => new Date(ms).toISOString();
  const authority = async (clock: WorldClock) => {
    await writeFile(join(options.stateDir, "clock.json"), JSON.stringify(clock), { mode: 0o600 });
    await followers.database(clock);
  };
  let now = from.nowMs;
  while (now < target) {
    if (stops.length >= (options.maxStops ?? 10_000)) throw new Error(`WORK_DIED: more than ${options.maxStops ?? 10_000} due stops before the target; the clock stays at ${at(now)}`);
    const stop = (await followers.nextDue(now, target)) ?? target, clock: WorldClock = { ...from, nowMs: stop };
    const follower = async (name: string, move: () => Promise<void>) => {
      try { await move(); } catch (error) {
        throw new Error(`WORK_DIED: the stop at ${at(stop)} did not settle: ${name} failed (${(error as Error).message}); the clock stays at ${at(now)}`, { cause: error });
      }
    };
    await follower("chain", () => followers.chain(stop, options.finality));
    for (const site of options.sites) await follower(`site ${site.company}`, () => followers.site(site, now, stop));
    await follower("bench clock", () => followers.bench(clock));
    await authority(clock);
    const deadline = performance.now() + (options.settleMs ?? 60_000);
    let open = await followers.openDue(stop);
    while (Object.keys(open).length && performance.now() < deadline) { await delay(200); open = await followers.openDue(stop); }
    if (Object.keys(open).length) {
      await authority({ ...from, nowMs: now });
      throw new Error(`WORK_DIED: Core did not settle at the stop ${at(stop)}: still open ${Object.entries(open).map(([t, n]) => `${t} ${n}`).join(", ")}; the clock stays at ${at(now)}`);
    }
    stops.push(stop); now = stop;
  }
  return { clockMode: "stopped", rate: from.rate, worldNow: now, stops };
}
