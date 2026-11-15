// The concept "world": making, showing, saving and restoring whole worlds, and moving a world's clock. The first
// four are served by the platform's world service (`packages/world`), because they must work while a world is
// parked or does not exist yet. `world.clock.warp` acts inside one running world and is served through its door.
import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import {
  ClockBackwards,
  ClockBeforeSeed,
  ExpiryBeyondSource,
  GradeNotOffered,
  NotWorldOwner,
  SnapshotExists,
  SnapshotInUse,
  SnapshotNotFound,
  WorldExists,
  WorldNotFound,
  WorldQuotaReached,
  NotImplemented,
} from "../errors.ts";
import { declare } from "../operation.ts";
import {
  Clock,
  ClockMode,
  Grade,
  Instant,
  OperatorName,
  Parent,
  Seq,
  SnapshotName,
  WorldName,
  WorldView,
} from "../values.ts";
import { exampleWorld } from "./example.ts";

/** The platform's limits on worlds. Agreed by Aaron on 13 November 2026: decisions.md, "Answered by Aaron", 2. */
export const WORLD_LIMITS = { lifetimeMinutes: 7 * 24 * 60, liveWorldsPerOwner: 5 } as const;

const Lifetime = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: WORLD_LIMITS.lifetimeMinutes }));

/** A world was made: from nothing (`parent` null) or from a snapshot. Its record's first new entry. */
export class WorldCreated extends Schema.TaggedClass<WorldCreated, { readonly brand: unique symbol }>()(
  "world_created",
  {
    world: WorldName,
    owner: OperatorName,
    grade: Grade,
    expiresAt: Instant,
    parent: Schema.NullOr(Parent),
  },
) {}

/** A snapshot was saved. The only entry a save adds to the world's record. */
export class SnapshotSaved extends Schema.TaggedClass<SnapshotSaved, { readonly brand: unique symbol }>()(
  "snapshot_saved",
  {
    world: WorldName,
    snapshot: SnapshotName,
    recordSeq: Seq,
    template: Schema.Boolean,
  },
) {}

/** The world's clock moved forward. */
export class ClockWarped extends Schema.TaggedClass<ClockWarped, { readonly brand: unique symbol }>()("clock_warped", {
  from: Instant,
  to: Instant,
}) {}

const created = (view: typeof WorldView.Type) => ({
  world: view.world,
  owner: view.owner,
  grade: view.grade,
  expiresAt: view.expiresAt,
  parent: view.parent,
});

export const create = declare({
  rpc: Rpc.make("world.create", {
    payload: {
      world: WorldName,
      grade: Grade,
      lifetimeMinutes: Lifetime,
      clock: Schema.Struct({
        mode: ClockMode,
        /** World time to begin at; null for host time. */ startAt: Schema.NullOr(Instant),
      }),
    },
    success: WorldView,
    error: Schema.Union([WorldExists, GradeNotOffered, WorldQuotaReached, ClockBeforeSeed, NotImplemented]),
  }),
  emits: [{ event: WorldCreated, carries: ({ success }) => created(success) }],
  budget: {
    ms: 90_000,
    excludes: [],
    provisional: true,
    basis:
      "spikes/containers deployed a world with published images in 39 to 43 s and spikes/hosting made a Neon branch in 8 to 10 s; migrations, Core and the cast are not measured yet",
  },
  examples: [
    {
      payload: { world: "town", grade: "private", lifetimeMinutes: 60, clock: { mode: "frozen", startAt: null } },
      success: exampleWorld,
    },
  ],
});

export const show = declare({
  rpc: Rpc.make("world.show", {
    payload: { world: WorldName },
    success: WorldView,
    error: Schema.Union([WorldNotFound, NotImplemented]),
  }),
  emits: [],
  budget: {
    ms: 2_000,
    excludes: [],
    provisional: true,
    basis:
      "reads the registry and the world's database; spikes/hosting measured 350 to 450 ms for a query that wakes a Neon branch",
  },
  examples: [{ payload: { world: "town" }, success: exampleWorld }],
});

/** A saved snapshot, as `world.snapshot.save` answers it. */
export const Snapshot = Schema.Struct({
  world: WorldName,
  snapshot: SnapshotName,
  /** The last entry of the world's record that the snapshot holds. The save's own entry follows it. */
  recordSeq: Seq,
  clock: Clock,
  template: Schema.Boolean,
  /** Host time. */
  savedAt: Instant,
  companies: Schema.Int,
  /** The last migration applied to the saved database. */
  migrations: Schema.String,
});

export const snapshotSave = declare({
  rpc: Rpc.make("world.snapshot.save", {
    payload: {
      world: WorldName,
      snapshot: SnapshotName,
      /** Replace a snapshot of this name instead of refusing. */
      replace: Schema.Boolean,
      /** Anyone on the platform may restore from it, not only the world's owner. */
      template: Schema.Boolean,
    },
    success: Snapshot,
    /** SnapshotInUse: `replace` of a snapshot a live world hangs from, which cannot go while that world lives. */
    error: Schema.Union([WorldNotFound, NotWorldOwner, SnapshotExists, SnapshotInUse, NotImplemented]),
  }),
  emits: [
    {
      event: SnapshotSaved,
      carries: ({ success }) => ({
        world: success.world,
        snapshot: success.snapshot,
        recordSeq: success.recordSeq,
        template: success.template,
      }),
    },
  ],
  budget: {
    ms: 30_000,
    excludes: ["waking a parked world"],
    provisional: true,
    basis:
      "a Neon branch takes 8 to 10 s (spikes/hosting) and saving the chain 0.8 to 2.1 s (spikes/containers); a site's backup is not measured",
  },
  examples: [
    {
      payload: { world: "town", snapshot: "m3", replace: false, template: true },
      success: {
        world: "town",
        snapshot: "m3",
        recordSeq: 14,
        clock: exampleWorld.clock,
        template: true,
        savedAt: "2026-11-13T10:05:00Z",
        companies: 1,
        migrations: "0004_documents",
      },
    },
  ],
});

export const snapshotRestore = declare({
  rpc: Rpc.make("world.snapshot.restore", {
    payload: { world: WorldName, snapshot: SnapshotName, as: WorldName, lifetimeMinutes: Lifetime },
    success: WorldView,
    error: Schema.Union([
      WorldNotFound,
      SnapshotNotFound,
      NotWorldOwner,
      WorldExists,
      ExpiryBeyondSource,
      WorldQuotaReached,
      NotImplemented,
    ]),
  }),
  emits: [{ event: WorldCreated, carries: ({ success }) => created(success) }],
  budget: {
    ms: 120_000,
    excludes: [],
    provisional: true,
    basis:
      "a branch fork took 10 s (spikes/hosting) and a deploy 39 to 43 s (spikes/containers); restoring sites onto a bench is not measured",
  },
  examples: [
    {
      payload: { world: "town", snapshot: "m3", as: "town3", lifetimeMinutes: 60 },
      success: {
        ...exampleWorld,
        world: "town3",
        recordHead: 15,
        parent: { world: "town", snapshot: "m3", recordSeq: 14 },
      },
    },
  ],
});

export const clockWarp = declare({
  rpc: Rpc.make("world.clock.warp", {
    payload: {
      target: Schema.Union([
        Schema.TaggedStruct("by", { seconds: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)) }),
        Schema.TaggedStruct("to", { at: Instant }),
      ]),
    },
    success: Schema.Struct({
      from: Instant,
      clock: Clock,
      /** Company sites that followed the clock. */ sites: Schema.Int,
    }),
    error: Schema.Union([NotWorldOwner, ClockBackwards, NotImplemented]),
  }),
  emits: [{ event: ClockWarped, carries: ({ success }) => ({ from: success.from, to: success.clock.now }) }],
  budget: {
    ms: 30_000,
    excludes: ["waking a parked world"],
    provisional: true,
    basis:
      "a guess for a warp of up to a month that stops at every due instant; spikes/bench-clocks proved the sites follow but timed no warp",
  },
  examples: [
    {
      payload: { target: { _tag: "by", seconds: 7 * 24 * 3600 } },
      success: { from: "2026-11-13T09:00:00Z", clock: { mode: "frozen", now: "2026-11-20T09:00:00Z" }, sites: 1 },
    },
  ],
});
