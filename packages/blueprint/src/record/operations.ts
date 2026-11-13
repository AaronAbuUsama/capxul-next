// The concept "record": a world's record is the ordered list of the events emitted in it, each once. A world made
// from nothing begins with its `world_created`; a world made from a snapshot begins with its source's record up to
// the snapshot, then its own `world_created`. Exporting reads it through the world's door; the caller writes files.
import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import { ExportNotAllowed, NotWorldOwner } from "../errors.ts";
import { declare } from "../operation.ts";
import { Instant, Json, Parent, Seq, WorldName } from "../values.ts";

/** One entry of the record: one event, as it was emitted. */
export const Entry = Schema.Struct({
  seq: Seq,
  /** The event's name, such as `doc_created`. */
  event: Schema.String,
  /** World time when the event was emitted. */
  at: Instant,
  /** The trace id of the call or the background step that emitted it. */
  trace: Schema.String,
  /** What the event carried: exactly the event's fields without its name, as a JSON value. */
  carried: Json,
});

export const exportRecord = declare({
  rpc: Rpc.make("record.export", {
    payload: {
      /** The first entry wanted; null for the first. */
      from: Schema.NullOr(Seq),
      /** The last entry wanted; null for the head. */
      to: Schema.NullOr(Seq),
    },
    success: Schema.Struct({
      world: WorldName,
      /** The world and snapshot this world was made from; null for a world made from nothing. */
      lineage: Schema.NullOr(Parent),
      head: Seq,
      entries: Schema.Array(Entry),
    }),
    error: Schema.Union([NotWorldOwner, ExportNotAllowed]),
  }),
  emits: [],
  budget: {
    ms: 1_500,
    excludes: ["waking a parked world"],
    provisional: true,
    basis: "one indexed read of the world's database; the pipeline spike's record.export read every entry within its 500 ms budget",
  },
  examples: [
    {
      payload: { from: null, to: null },
      success: {
        world: "town",
        lineage: null,
        head: 1,
        entries: [
          {
            seq: 1, event: "world_created", at: "2026-11-13T09:00:00Z", trace: "4bf92f3577b34da6a3ce929d0e0e4736",
            carried: { world: "town", owner: "ci", grade: "private", expiresAt: "2026-11-13T11:00:00Z", parent: null },
          },
        ],
      },
    },
  ],
});
