// world.clock.warp and record.export: the world's clock and its record, the world owner's alone.
import { CurrentCaller, Errors, Record as RecordOps, Values, World } from "@capxul/blueprint";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import type { SiteDoorFailed } from "../failures.ts";
import { CoreIdentity } from "../telemetry/middleware.ts";
import { ChainTime } from "./chain-time.ts";
import { instantOf, millisOf, WorldClock } from "./clock.ts";
import { entryOf, WorldRecord } from "./record.ts";
import { CompanySites } from "./sites.ts";
import { timesOf, WARP_ATTRIBUTES, WarpTimes } from "./warp-times.ts";

/** Refuses anyone but the world's owner: a person of the world is not its owner. */
const ownerOnly = Effect.flatMap(
  Effect.all([Effect.service(CurrentCaller), Effect.service(CoreIdentity)]),
  ([caller, { world, owner }]) =>
    caller._tag === "person" ? Effect.fail(Errors.NotWorldOwner.make({ world, owner })) : Effect.void,
);

type Target = { readonly _tag: "by"; readonly seconds: number } | { readonly _tag: "to"; readonly at: string };

/** What a site answers a warp: its stops and the jobs it ran (capxul/core_api.py, `warp`), and where its time went. */
const Warped = Schema.Struct({ site: Schema.String, stops: Schema.Int, jobs: Schema.Int, ...WarpTimes.fields });

/**
 * How many sites a stretch of a warp moves at once. Each site steps through its own days in its own process on the
 * bench, and the last site's call writes the world's clock file, which no site reads while it steps (it reads the
 * time it is stepping through, capxul/clock.py `advance`). Bounded so that a world of many companies does not take
 * every one of the bench's web workers at once.
 */
export const SITES_AT_ONCE = 4;

/** One site's part of a stretch, in a span that says which site it was and where the site's own time went. */
const warpSite = Effect.fn("world.clock.warp.site")(function* (
  site: string,
  call: Effect.Effect<unknown, SiteDoorFailed>,
) {
  yield* Effect.annotateCurrentSpan(WARP_ATTRIBUTES.site, site);
  const answer = yield* Effect.flatMap(call, (answered) =>
    Schema.decodeUnknownEffect(Warped)(answered).pipe(Effect.orDie),
  );
  yield* Effect.forEach(timesOf(answer), ([key, value]) => Effect.annotateCurrentSpan(key, value));
  return answer;
});

/** One stretch of a warp through every site, in a span of its own (warpSteps). */
const warpStretch = Effect.fn("world.clock.warp.stretch")(function* (
  [from, to]: readonly [number, number],
  frozen: boolean,
  last: boolean,
) {
  yield* Effect.annotateCurrentSpan(WARP_ATTRIBUTES.warpFrom, instantOf(from));
  yield* Effect.annotateCurrentSpan(WARP_ATTRIBUTES.warpTo, instantOf(to));
  const sites = yield* CompanySites;
  return yield* sites.everySite(
    "warp",
    (index, count) => ({ from_ms: from, to_ms: to, frozen, write: last && index === count - 1 }),
    warpSite,
    SITES_AT_ONCE,
  );
});

/**
 * The most world time one call warps a site through. A site steps through every day and runs what fell due, about
 * 0.8 s a day on the stand-in bench (packages/platform/records/site-speed, Q5: 180 days took 147.8 s), and the call is one HTTP request
 * through the site door, which waits 120 s for the site (packages/platform, door/door.py), and through Cloudflare's
 * tunnel, whose edge waits 100 s for an answer. So a long warp is made as several calls of at most 14 days (about
 * 11 s each there), which leaves the bench host room to be several times slower.
 */
export const WARP_STEP_MS = 14 * 24 * 3600 * 1000;

/** The stretches a warp from `fromMs` to `toMs` is made in: one after another, each at most WARP_STEP_MS. */
export const warpSteps = (fromMs: number, toMs: number): ReadonlyArray<readonly [number, number]> =>
  Arr.map(Arr.range(0, Math.max(0, Math.ceil((toMs - fromMs) / WARP_STEP_MS) - 1)), (step) => [
    fromMs + step * WARP_STEP_MS,
    Math.min(toMs, fromMs + (step + 1) * WARP_STEP_MS),
  ]);

/**
 * Moves the world's clock forward: every company site first, each stepping through the days between and running what
 * fell due on each, in stretches of at most 14 days (the last one writes the world's clock on the bench), the sites of
 * a stretch side by side, then the chain, whose next block is mined at the new time, then the clock Core keeps. Each
 * stretch and each site's call is a span, the site's carrying where its own time went (warpSite). A warp to the clock's time or before it is `ClockBackwards`.
 */
export const clockWarp = (payload: { readonly target: Target }) =>
  Effect.gen(function* () {
    yield* ownerOnly;
    const clock = yield* WorldClock;
    const before = yield* clock.now;
    const { target } = payload;
    const asked = target._tag === "by" ? before.nowMs + target.seconds * 1000 : millisOf(target.at);
    if (asked <= before.nowMs)
      return yield* Errors.ClockBackwards.make({ now: instantOf(before.nowMs), asked: instantOf(asked) });
    // Every site through one stretch, then the next (warpSteps); the world's clock on the bench is written once, by
    // the last site at the end of the last stretch.
    const steps = warpSteps(before.nowMs, asked);
    const followed = yield* Effect.forEach(steps, (stretch, step) =>
      warpStretch(stretch, before.mode === "frozen", step === steps.length - 1),
    );
    yield* Effect.flatMap(Effect.service(ChainTime), (chain) => chain.mineAt(Math.ceil(asked / 1000)));
    const after = yield* clock.moveTo(asked);
    const success = {
      from: instantOf(before.nowMs),
      clock: { mode: after.mode, now: instantOf(after.nowMs) },
      sites: Arr.match(followed, { onEmpty: () => 0, onNonEmpty: (all) => Arr.lastNonEmpty(all).length }),
    };
    yield* Effect.flatMap(Effect.service(WorldRecord), (record) => record.emit(World.clockWarp, { payload, success }));
    return success;
  });

const Made = Schema.Struct({ grade: Values.Grade, parent: Schema.NullOr(Values.Parent) });

/**
 * The world's record, or the part of it from `from` to `to`, with the world it was made from (its latest
 * `world_created`'s parent). A real world's record is not exported (`ExportNotAllowed`).
 */
export const recordExport = (payload: { readonly from: number | null; readonly to: number | null }) =>
  Effect.gen(function* () {
    yield* ownerOnly;
    const record = yield* WorldRecord;
    const made = yield* Effect.flatMap(record.made, (carried) =>
      Option.match(carried, {
        onNone: () => Effect.die("the world's record holds no world_created: it was not made by world.create"),
        onSome: (value) => Schema.decodeUnknownEffect(Made)(value).pipe(Effect.orDie),
      }),
    );
    if (made.grade === "real") return yield* Errors.ExportNotAllowed.make({ grade: made.grade });
    const { head, entries } = yield* record.entries(payload.from ?? 1, payload.to);
    const { world } = yield* CoreIdentity;
    return {
      world,
      lineage: made.parent,
      head,
      entries: Arr.map(entries, entryOf),
    } satisfies typeof RecordOps.exportRecord.rpc.successSchema.Type;
  });
