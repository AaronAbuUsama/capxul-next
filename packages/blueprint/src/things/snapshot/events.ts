// What a snapshot announces, and what each event carries.
import { event } from "@capxul/blueprint-tools";
import * as Schema from "effect/Schema";
import { Seq, SnapshotName, WorldName } from "../../common/values.ts";

/** A snapshot was saved. The only entry a save adds to the world's record. */
export class SnapshotSaved extends event<SnapshotSaved, { readonly brand: unique symbol }>()("snapshot_saved", {
  world: WorldName,
  snapshot: SnapshotName,
  recordSeq: Seq,
  template: Schema.Boolean,
}) {}

/** A snapshot was deleted: the last entry it adds to its world's record. `recordSeq` is the position it held. */
export class SnapshotDeleted extends event<SnapshotDeleted, { readonly brand: unique symbol }>()("snapshot_deleted", {
  world: WorldName,
  snapshot: SnapshotName,
  recordSeq: Seq,
}) {}
