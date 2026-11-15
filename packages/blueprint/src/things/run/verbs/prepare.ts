// `run.prepare`: make a run's worlds, one per shard, all at once, and restore the run's saved starting points into
// each. Work no door serves: the runner does it, with `packages/world` (today ad hoc spans in both).
import { log, span, work } from "@capxul/blueprint-tools";
import { StepKind } from "../../../telemetry/step-kinds.ts";
import { PreparePart, RunId, Shard, ShardCount } from "../values.ts";

export const runPrepare = work({
  name: "run.prepare",
  does: "Make the run's worlds, one per shard, all at once, and give each the run's starting points.",
  payload: { run: RunId, shards: ShardCount },
  spans: {
    worlds: span("run.prepare.worlds", StepKind.deploy),
    branches: span("run.prepare.branches", StepKind.branch),
    index: span("run.prepare.index", StepKind.container),
    restore: span("run.prepare.restore", StepKind.restore),
    // A made starting point saved as a snapshot of its world, by a call of the snapshot's save.
    save: span("run.prepare.save", StepKind.compute),
    // The facts a made starting point leaves, kept in its world's database for the journeys that start from it.
    keepFacts: span("run.prepare.facts.keep", StepKind.database),
    // The facts a kept world holds, moved to the format the blueprint decodes now.
    moveFacts: span("run.prepare.facts.move", StepKind.database),
  },
  logs: { shardFailed: log("run.prepare.shard_failed", { run: RunId, shard: Shard, part: PreparePart }) },
  budget: {
    ms: 120_000,
    excludes: [],
    provisional: true,
    basis: "docs/design/blueprint.md, part 8: 2 of the run's 10 minutes; a quiet run took about 9 minutes",
  },
  breakdown: [],
  examples: [{ payload: { run: "ci-19384756", shards: 2 } }],
});
