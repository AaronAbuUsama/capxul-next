// The ways the snapshot's verbs say no, each declared once, here, with its exit code. src/generated/refusals.ts
// gathers them all.
import { refusal } from "@capxul/blueprint-tools";
import * as Schema from "effect/Schema";
import { Instant, SnapshotName, WorldName } from "../../common/values.ts";

export class SnapshotExists extends refusal<SnapshotExists, { readonly brand: unique symbol }>()(
  "SnapshotExists",
  {
    world: WorldName,
    snapshot: SnapshotName,
  },
  2,
) {}

export class SnapshotNotFound extends refusal<SnapshotNotFound, { readonly brand: unique symbol }>()(
  "SnapshotNotFound",
  {
    world: WorldName,
    snapshot: SnapshotName,
  },
  2,
) {}

/**
 * A live world hangs from the snapshot: a world restored from it, or the snapshot's own world once reset to it in
 * place. That world's database is a branch of the snapshot's, which cannot go while it does, so the snapshot stays
 * until those worlds are gone. Nothing changes.
 */
export class SnapshotInUse extends refusal<SnapshotInUse, { readonly brand: unique symbol }>()(
  "SnapshotInUse",
  {
    world: WorldName,
    snapshot: SnapshotName,
    /** The live worlds that hang from it. */
    worlds: Schema.Array(WorldName),
  },
  2,
) {}

/** A world made from a snapshot cannot outlive the world the snapshot belongs to. */
export class ExpiryBeyondSource extends refusal<ExpiryBeyondSource, { readonly brand: unique symbol }>()(
  "ExpiryBeyondSource",
  {
    source: WorldName,
    asked: Instant,
    latest: Instant,
  },
  2,
) {}

export const refusals = { SnapshotExists, SnapshotNotFound, SnapshotInUse, ExpiryBeyondSource } as const;
