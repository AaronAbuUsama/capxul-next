// world.clock.warp and record.export, served in memory through Core's groups: the sites, the chain and the clock a
// warp moves, and the record an export answers.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { Errors } from "@capxul/blueprint";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import { madeFromNothing, memoryChainTime } from "../src/site-ops/door.ts";
import { fields, ORG, refusal, run, site, START, value, world, type Asked } from "./support/site-ops.ts";

/** What a site answers a warp of a week. */
const warp = () => ({ site: "s", stops: 8, jobs: 7 });

test("world.clock.warp moves every site, then the chain, then the clock; backwards and a person are refused", () =>
  run(
    Effect.gen(function* () {
      const asked: Array<Asked> = [];
      const chain = yield* memoryChainTime(Math.floor(START / 1000) - 60);
      const { call, record } = yield* world({
        chain: chain.layer,
        record: [madeFromNothing("town", "ci", START)],
        sites: [site("a-town.w", ORG, asked, { warp }), site("b-town.w", "org_b00001", asked, { warp })],
      });
      const week = 7 * 24 * 3600;
      const warped = value(yield* call("world.clock.warp", { target: { _tag: "by", seconds: week } }));
      assert.deepEqual(warped, {
        from: "2026-11-13T09:00:00.000Z",
        clock: { mode: "frozen", now: "2026-11-20T09:00:00.000Z" },
        sites: 2,
      });
      assert.deepEqual(
        Arr.map(asked, (each) => [each.site, each.body]),
        [
          ["a-town.w", { from_ms: START, to_ms: START + week * 1000, frozen: true, write: false }],
          ["b-town.w", { from_ms: START, to_ms: START + week * 1000, frozen: true, write: true }],
        ],
      );
      assert.equal(yield* Ref.get(chain.head), START / 1000 + week);
      const backwards = fields(
        yield* call("world.clock.warp", { target: { _tag: "to", at: "2026-11-13T09:00:00.000Z" } }),
      );
      assert.deepEqual(backwards, {
        _tag: "ClockBackwards",
        now: "2026-11-20T09:00:00.000Z",
        asked: "2026-11-13T09:00:00.000Z",
      });
      const asDana = yield* call("world.clock.warp", { target: { _tag: "by", seconds: 1 } }, "dana");
      assert.ok(asDana.pipe(refusal, Schema.is(Errors.NotWorldOwner)));
      const exported = yield* record();
      assert.equal(exported.head, 2);
      assert.deepEqual(exported.entries[1]?.carried, {
        from: "2026-11-13T09:00:00.000Z",
        to: "2026-11-20T09:00:00.000Z",
      });
      assert.equal(exported.entries[1]?.at, "2026-11-20T09:00:00.000Z");
    }),
  ));

test("record.export answers ranges, the lineage of a restored world, refuses a person and a real world", () =>
  run(
    Effect.gen(function* () {
      const parent = { world: "first", snapshot: "m3", recordSeq: 2 };
      const source = madeFromNothing("first", "ci", START);
      const carried = {
        world: "first",
        owner: "ci",
        grade: "private",
        expiresAt: "2026-11-13T11:00:00.000Z",
        parent: null,
      };
      const restored = { ...source, carried: { ...carried, world: "town", parent } };
      const { call, record } = yield* world({ record: [source, { ...source, event: "doc_created" }, restored] });
      const whole = yield* record();
      assert.deepEqual([whole.world, whole.lineage, whole.head, whole.entries.length], ["town", parent, 3, 3]);
      assert.deepEqual(
        Arr.map((yield* record(2, 3)).entries, (entry: { readonly seq: number }) => entry.seq),
        [2, 3],
      );
      const past = yield* record(4, null);
      assert.deepEqual([past.entries, past.head], [[], 3]);
      const refused = fields(yield* call("record.export", { from: null, to: null }, "dana"));
      assert.deepEqual(refused, { _tag: "NotWorldOwner", world: "town", owner: "ci" });
      const real = yield* world({ record: [{ ...source, carried: { ...carried, grade: "real" } }] });
      const fromReal = yield* real.call("record.export", { from: null, to: null });
      assert.ok(fromReal.pipe(refusal, Schema.is(Errors.ExportNotAllowed)));
    }),
  ));
