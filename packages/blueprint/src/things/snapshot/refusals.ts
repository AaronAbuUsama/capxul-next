// The ways the snapshot's verbs say no, each declared once, here, with its exit code. src/generated/refusals.ts
// gathers them all.
import * as Schema from "effect/Schema";
import type { ExitCode } from "../../generated/refusals.ts";
import { Instant, SnapshotName, WorldName } from "../../common/values.ts";

export class SnapshotExists extends Schema.TaggedError<SnapshotExists, { readonly brand: unique symbol }>()(
  "SnapshotExists",
  {
    world: WorldName,
    snapshot: SnapshotName,
  },
) {}

export class SnapshotNotFound extends Schema.TaggedError<SnapshotNotFound, { readonly brand: unique symbol }>()(
  "SnapshotNotFound",
  {
    world: WorldName,
    snapshot: SnapshotName,
  },
) {}

/**
 * A live world hangs from the snapshot: a world restored from it, or the snapshot's own world once reset to it in
 * place. That world's database is a branch of the snapshot's, which cannot go while it does, so the snapshot stays
 * until those worlds are gone. Nothing changes.
 */
export class SnapshotInUse extends Schema.TaggedError<SnapshotInUse, { readonly brand: unique symbol }>()(
  "SnapshotInUse",
  {
    world: WorldName,
    snapshot: SnapshotName,
    /** The live worlds that hang from it. */
    worlds: Schema.Array(WorldName),
  },
) {}

/** A world made from a snapshot cannot outlive the world the snapshot belongs to. */
export class ExpiryBeyondSource extends Schema.TaggedError<ExpiryBeyondSource, { readonly brand: unique symbol }>()(
  "ExpiryBeyondSource",
  {
    source: WorldName,
    asked: Instant,
    latest: Instant,
  },
) {}

export const refusals = { SnapshotExists, SnapshotNotFound, SnapshotInUse, ExpiryBeyondSource } as const;

export const exitCode: { readonly [Tag in keyof typeof refusals]: ExitCode } = {
  SnapshotExists: 2,
  SnapshotNotFound: 2,
  SnapshotInUse: 2,
  ExpiryBeyondSource: 2,
};
