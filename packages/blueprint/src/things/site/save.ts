// `site.save`: save a world's sites as site snapshots, beside a snapshot of the world. Work no door serves:
// `packages/world` asks the site service for it.
import { log, span, work } from "@capxul/blueprint-tools";
import { OrgHandle, SnapshotName, WorldName } from "../../common/values.ts";
import { StepKind } from "../../telemetry/step-kinds.ts";

export const siteSave = work({
  name: "site.save",
  does: "Save each of a world's company sites as a site snapshot, under the world's snapshot's name.",
  payload: { world: WorldName, snapshot: SnapshotName },
  spans: {
    save: span("site.save.save", StepKind.site),
    ready: span("site.save.ready", StepKind.poll),
  },
  logs: { failed: log("site.save.failed", { world: WorldName, snapshot: SnapshotName, company: OrgHandle }) },
  budget: {
    ms: 30_000,
    excludes: [],
    provisional: true,
    basis: "one backup per company site; a first guess",
  },
  breakdown: [],
  examples: [{ payload: { world: "w-shard-1", snapshot: "founded" } }],
});
