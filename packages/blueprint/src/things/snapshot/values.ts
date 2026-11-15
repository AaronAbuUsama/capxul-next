// A snapshot's values: a saved state of a world.
import * as Schema from "effect/Schema";
import { Clock, Instant, Seq, SnapshotName, WorldName } from "../../common/values.ts";

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
