// world.clock.warp and record.export: the world's clock and its record, the world owner's alone.
import { CurrentCaller, Errors, Record as RecordOps, Values, World } from "@capxul/blueprint";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { CoreIdentity } from "../telemetry/middleware.ts";
import { ChainTime } from "./chain-time.ts";
import { instantOf, millisOf, WorldClock } from "./clock.ts";
import { entryOf, WorldRecord } from "./record.ts";
import { CompanySites } from "./sites.ts";

/** Refuses anyone but the world's owner: a person of the world is not its owner. */
const ownerOnly = Effect.flatMap(
  Effect.all([Effect.service(CurrentCaller), Effect.service(CoreIdentity)]),
  ([caller, { world, owner }]) =>
    caller._tag === "person" ? Effect.fail(Errors.NotWorldOwner.make({ world, owner })) : Effect.void,
);

type Target = { readonly _tag: "by"; readonly seconds: number } | { readonly _tag: "to"; readonly at: string };

/** What a site answers a warp: its stops and the jobs it ran (capxul/core_api.py, `warp`). */
const Warped = Schema.Struct({ site: Schema.String, stops: Schema.Int, jobs: Schema.Int });

/**
 * Moves the world's clock forward: every company site first, each stepping through the days between and running what
 * fell due on each (the last one writes the world's clock on the bench), then the chain, whose next block is mined at
 * the new time, then the clock Core keeps. A warp to the clock's time or before it is `ClockBackwards`.
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
    const sites = yield* CompanySites;
    const followed = yield* sites.everySite("warp", (index, count) => ({
      from_ms: before.nowMs,
      to_ms: asked,
      frozen: before.mode === "frozen",
      write: index === count - 1,
    }));
    yield* Effect.forEach(followed, (answer) => Schema.decodeUnknownEffect(Warped)(answer).pipe(Effect.orDie));
    yield* Effect.flatMap(Effect.service(ChainTime), (chain) => chain.mineAt(Math.ceil(asked / 1000)));
    const after = yield* clock.moveTo(asked);
    const success = {
      from: instantOf(before.nowMs),
      clock: { mode: after.mode, now: instantOf(after.nowMs) },
      sites: followed.length,
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
