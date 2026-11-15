// world.clock.warp and record.export, served in memory through Core's groups: the sites, the chain and the clock a
// warp moves, and the record an export answers.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { Errors, World } from "@capxul/blueprint";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import { madeFromNothing, memoryChainTime } from "../src/site-ops/door.ts";
import { WARP_STEP_MS, warpSteps } from "../src/site-ops/world.ts";
import type { KeptSpan } from "../src/door.ts";
import { timesOf, WARP_ATTRIBUTES } from "../src/site-ops/warp-times.ts";
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

test("a long warp moves the sites in stretches of at most 14 days, the clock written once at the very end", () =>
  run(
    Effect.gen(function* () {
      const asked: Array<Asked> = [];
      const chain = yield* memoryChainTime(Math.floor(START / 1000) - 60);
      const { call } = yield* world({
        chain: chain.layer,
        record: [madeFromNothing("town", "ci", START)],
        sites: [site("a-town.w", ORG, asked, { warp }), site("b-town.w", "org_b00001", asked, { warp })],
      });
      // 180 days took 147.8 s on one site in one call (packages/platform/records/site-speed), past the site door's 120 s.
      const days = 180;
      const warped = value(yield* call("world.clock.warp", { target: { _tag: "by", seconds: days * 24 * 3600 } }));
      assert.equal(warped.sites, 2);
      const end = START + days * 24 * 3600 * 1000;
      const bodies: ReadonlyArray<Record<string, unknown>> = Arr.map(asked, (each) => ({
        site: each.site,
        ...each.body,
      }));
      assert.equal(bodies.length, 2 * 13, "13 stretches, each through both sites");
      for (const [step, [from, to]] of warpSteps(START, end).entries()) {
        assert.ok(to - from <= WARP_STEP_MS);
        assert.deepEqual(bodies.slice(step * 2, step * 2 + 2), [
          { site: "a-town.w", from_ms: from, to_ms: to, frozen: true, write: false },
          { site: "b-town.w", from_ms: from, to_ms: to, frozen: true, write: step === 12 },
        ]);
      }
      assert.equal(bodies[0]?.from_ms, START);
      assert.equal(bodies[bodies.length - 1]?.to_ms, end);
      assert.equal(yield* Ref.get(chain.head), end / 1000);
    }),
  ));

/** What a site answers a warp when it says where its time went (capxul/core_api.py, `warp`). */
const timedWarp = (body: Record<string, unknown>) => ({
  site: "s",
  stops: 2,
  jobs: 190,
  ms: 1900.5,
  setup_ms: 120,
  stop_ms: [880, 900.5],
  stop_jobs: [95, 95],
  slowest: [
    { job: "erpnext.daily_maintenance", runs: 2, ms: 700 },
    { job: "capxul.clock.daily", runs: 2, ms: 60 },
  ],
  asked: body["to_ms"],
});

test("a warp's record says where its time went: a span per stretch, under it a span per site", () =>
  run(
    Effect.gen(function* () {
      const asked: Array<Asked> = [];
      const spans: Array<KeptSpan> = [];
      const chain = yield* memoryChainTime(Math.floor(START / 1000) - 60);
      const { call } = yield* world({
        chain: chain.layer,
        record: [madeFromNothing("town", "ci", START)],
        sites: [site("a-town.w", ORG, asked, { warp: timedWarp }), site("b-town.w", "org_b00001", asked, { warp })],
        spans,
      });
      value(yield* call(World.clockWarp.rpc._tag, { target: { _tag: "by", seconds: 20 * 24 * 3600 } }));
      const named = (name: string) => Arr.filter(spans, (span) => span.name === name);
      const stretches = named("world.clock.warp.stretch");
      const warped = Arr.findFirst(spans, (span) => span.spanId === stretches[0]?.parentSpanId).pipe(
        Option.getOrUndefined,
      );
      assert.equal(warped?.name, World.clockWarp.rpc._tag);
      const calls = named("world.clock.warp.site");
      assert.equal(stretches.length, 2, "20 days: a stretch of 14 days and one of 6");
      assert.ok(Arr.every(stretches, (stretch) => stretch.parentSpanId === warped?.spanId));
      assert.equal(calls.length, 4, "each stretch through both sites");
      const stretchIds = Arr.map(stretches, (stretch) => stretch.spanId);
      assert.ok(Arr.every(calls, (one) => stretchIds.includes(one.parentSpanId ?? "")));
      // Kept in the record (app.spans): the keys are declared (telemetry/attributes.ts).
      assert.deepEqual(
        Arr.map(stretches, (stretch) => stretch.attributes),
        [
          {
            [WARP_ATTRIBUTES.warpFrom]: "2026-11-13T09:00:00.000Z",
            [WARP_ATTRIBUTES.warpTo]: "2026-11-27T09:00:00.000Z",
          },
          {
            [WARP_ATTRIBUTES.warpFrom]: "2026-11-27T09:00:00.000Z",
            [WARP_ATTRIBUTES.warpTo]: "2026-12-03T09:00:00.000Z",
          },
        ],
      );
      const of = (name: string) => Arr.filter(calls, (one) => one.attributes?.[WARP_ATTRIBUTES.site] === name);
      const times = {
        [WARP_ATTRIBUTES.site]: "a-town.w",
        [WARP_ATTRIBUTES.siteMs]: 1900.5,
        [WARP_ATTRIBUTES.warpSetupMs]: 120,
        [WARP_ATTRIBUTES.warpStopMs]: [880, 900.5],
        [WARP_ATTRIBUTES.warpStopJobs]: [95, 95],
        [WARP_ATTRIBUTES.warpJobs]: ["erpnext.daily_maintenance", "capxul.clock.daily"],
        [WARP_ATTRIBUTES.warpJobRuns]: [2, 2],
        [WARP_ATTRIBUTES.warpJobMs]: [700, 60],
      };
      assert.deepEqual(
        Arr.map(of("a-town.w"), (one) => one.attributes),
        [times, times],
      );
      assert.deepEqual(
        Arr.map(of("b-town.w"), (one) => one.attributes),
        [{ [WARP_ATTRIBUTES.site]: "b-town.w" }, { [WARP_ATTRIBUTES.site]: "b-town.w" }],
        "a site that answers no times still names itself",
      );
    }),
  ));

test("a site's times become its span's attributes, those it answered and no others", () => {
  assert.deepEqual(timesOf(timedWarp({})), [
    [WARP_ATTRIBUTES.siteMs, 1900.5],
    [WARP_ATTRIBUTES.warpSetupMs, 120],
    [WARP_ATTRIBUTES.warpStopMs, [880, 900.5]],
    [WARP_ATTRIBUTES.warpStopJobs, [95, 95]],
    [WARP_ATTRIBUTES.warpJobs, ["erpnext.daily_maintenance", "capxul.clock.daily"]],
    [WARP_ATTRIBUTES.warpJobRuns, [2, 2]],
    [WARP_ATTRIBUTES.warpJobMs, [700, 60]],
  ]);
  assert.deepEqual(timesOf({}), [], "an older site answers no times");
});

test("a warp's stretches follow one another from its start to its end", () => {
  const day = 24 * 3600 * 1000;
  assert.deepEqual(warpSteps(0, 7 * day), [[0, 7 * day]]);
  assert.deepEqual(warpSteps(0, 14 * day), [[0, 14 * day]]);
  assert.deepEqual(warpSteps(0, 15 * day), [
    [0, 14 * day],
    [14 * day, 15 * day],
  ]);
  assert.deepEqual(warpSteps(5, 6), [[5, 6]]);
});

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
