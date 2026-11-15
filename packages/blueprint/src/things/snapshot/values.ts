// A snapshot's values: a saved state of a world.
import * as Schema from "effect/Schema";
import { Clock, Instant, Seq, SnapshotName, WorldName } from "../../common/values.ts";

/**
 * A saved snapshot, as `world.snapshot.save` answers it. Still open for R9 (src/ratchets.ts): it names no block, so
 * `world.snapshot.restore`'s "at the snapshot's block" is checked at the latest block of both worlds, exact only
 * because nothing moves the first world between the save and the comparison; a block number here would make it exact.
 */
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
