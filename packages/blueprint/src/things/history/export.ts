// The concept "record": a world's record is the ordered list of the events emitted in it, each once. A world made
// from nothing begins with its `world_created`; a world made from a snapshot begins with its source's record up to
// the snapshot, then its own `world_created`. Exporting reads it through the world's door; the caller writes files.
//
// `capxul history export` (today `record.export`): reading a world's record.
import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import { declare, claim, kept } from "@capxul/blueprint-tools";
import { NotImplemented, NotWorldOwner } from "../../common/refusals.ts";
import { Instant, Json, Parent, Seq, WorldName } from "../../common/values.ts";
import { startingWorlds as w, type ClaimsOf } from "../../starting-points/points.ts";
import { ExportNotAllowed } from "./refusals.ts";

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
    error: Schema.Union([NotWorldOwner, ExportNotAllowed, NotImplemented]),
  }),
  emits: [],
  budget: {
    ms: 1_500,
    excludes: ["waking a parked world"],
    provisional: true,
    basis:
      "one indexed read of the world's database; the pipeline spike's record.export read every entry within its 500 ms budget",
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
            seq: 1,
            event: "world_created",
            at: "2026-11-13T09:00:00Z",
            trace: "4bf92f3577b34da6a3ce929d0e0e4736",
            carried: { world: "town", owner: "ci", grade: "private", expiresAt: "2026-11-13T11:00:00Z", parent: null },
          },
        ],
      },
    },
  ],
});

/** Who serves it: a world's Core, through the world's door (`WorldRpcs`). */
export const server = "world";

/** It moves no thing with a lifecycle (the machine format): why. */
export const stateless = "a read: exports the world's record and changes nothing";

/** What `record.export` promises, each promise checked by the journeys. */
export const promises: ClaimsOf = {
  operation: exportRecord,
  claims: [
    claim(
      "An export carries the lineage and every entry once.",
      w.restored,
      "record.export of the restored world answers a lineage naming the first world, `m3` and its record position, and entries 1 to the head, each once, in order: the first world's entries up to that position, entry for entry as record.export at the first world's door answers them, then `world_created`.",
      { origin: kept("record.export/c-bd1acd26102d2d92"), thinLine: true },
    ),
    claim(
      "The record is the world's events: every event a successful call emitted is one entry, in order, carrying exactly what the event carried, and a refused call or a read adds none.",
      w.paid,
      "For every call made in making the starting world (the `calls` fact) in the world exported, record.export holds that call's declared events under its trace id, carrying what its declaration computes from the call's payload and answer, in the order the calls were made; a refused call and a report.run hold none. A call made in another world, the one whose snapshot a restored world was made from, left its events there: the restored world's record holds under its trace either exactly those events (copied with the snapshot, when the call came before its position) or none. The journey's own successful calls at the exported world's door add their declared events likewise, in the order they were made.",
    ),
    claim(
      "Only the world's owner may export the record.",
      w.fresh,
      "record.export as dana is refused with NotWorldOwner.",
      {
        refusals: [NotWorldOwner],
      },
    ),
    claim(
      "A range answers only the entries from and to the positions asked, and a range past the head answers none.",
      w.paid,
      "record.export from 2 to 3 answers entries 2 and 3; from the head plus one answers no entries and the same head.",
    ),
  ],
  dropped: [],
};
