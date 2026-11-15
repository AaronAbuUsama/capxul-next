// Example data the snapshot's verbs share with the starting points.
import type { WorldView } from "../../common/values.ts";
import { exampleWorld } from "../world/examples.ts";
import { Snapshot } from "./values.ts";

/** The snapshot `m3` of the example world, as world.snapshot.save's example saves it. */
export const saved: typeof Snapshot.Type = {
  world: "town",
  snapshot: "m3",
  recordSeq: 14,
  clock: exampleWorld.clock,
  template: true,
  savedAt: "2026-11-13T10:05:00Z",
  companies: 1,
  migrations: "0004_documents",
};

/** The world `town3`, as `world.snapshot.restore`'s example restores it from `m3`. */
export const restoredWorld: typeof WorldView.Type = {
  ...exampleWorld,
  world: "town3",
  recordHead: 15,
  parent: { world: "town", snapshot: "m3", recordSeq: 14 },
};
