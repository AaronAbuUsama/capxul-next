// `capxul world reset` (`world.reset`): put a world back to a saved snapshot, in place, with one clock. Work no door
// serves: `packages/world` does it (today its `world reset`, spanned by part), between a shard's journeys.
import { log, span, work } from "@capxul/blueprint-tools";
import { SnapshotName, WorldName } from "../../common/values.ts";
import { StepKind } from "../../telemetry/step-kinds.ts";
import { ResetPart, WorkRefusal } from "./values.ts";

export const worldReset = work({
  name: "world.reset",
  does: "Put a world back to a saved snapshot, in place, with one clock.",
  payload: { world: WorldName, to: SnapshotName },
  spans: {
    stopIndex: span("world.reset.index.stop", StepKind.container),
    database: span("world.reset.database", StepKind.branch),
    chain: span("world.reset.chain", StepKind.restore),
    clock: span("world.reset.clock", StepKind.chain),
    sites: span("world.reset.sites", StepKind.site),
    api: span("world.reset.api", StepKind.deploy),
    resumeIndex: span("world.reset.index.resume", StepKind.container),
    ready: span("world.reset.ready", StepKind.poll),
  },
  logs: {
    refused: log("world.reset.refused", { world: WorldName, snapshot: SnapshotName, reason: WorkRefusal }),
    partFailed: log("world.reset.part_failed", { world: WorldName, part: ResetPart }),
  },
  budget: {
    ms: 15_000,
    excludes: [],
    provisional: true,
    basis: "docs/design/blueprint.md, part 9: a first guess; a shard's 6 minutes hold its resets and its journeys",
  },
  breakdown: [],
  examples: [{ payload: { world: "w-shard-1", to: "founded" } }],
});
