// `site.reset`: put a world's sites back to their site snapshots, as part of `world.reset`. Work no door serves:
// `packages/world` asks the site service for it.
import { log, span, work } from "@capxul/blueprint-tools";
import { OrgHandle, SnapshotName, WorldName } from "../../../common/values.ts";
import { StepKind } from "../../../telemetry/step-kinds.ts";

export const siteReset = work({
  name: "site.reset",
  does: "Put each of a world's company sites back to its site snapshot.",
  payload: { world: WorldName, to: SnapshotName },
  spans: {
    restore: span("site.reset.restore", StepKind.restore),
    ready: span("site.reset.ready", StepKind.poll),
  },
  logs: { failed: log("site.reset.failed", { world: WorldName, snapshot: SnapshotName, company: OrgHandle }) },
  budget: {
    ms: 30_000,
    excludes: [],
    provisional: true,
    basis: "one restore per company site; a first guess",
  },
  breakdown: [],
  examples: [{ payload: { world: "w-shard-1", to: "founded" } }],
});
