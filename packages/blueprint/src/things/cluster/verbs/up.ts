// `capxul cluster up` (`cluster.up`): deploy a stage's cluster once (roadmap item 1.15; today `hub up`). Work no
// door serves: `packages/world` does it from the command line.
import { log, span, work } from "@capxul/blueprint-tools";
import { StepKind } from "../../../telemetry/step-kinds.ts";
import { ClusterRefusal, StageName } from "../values.ts";

export const clusterUp = work({
  name: "cluster.up",
  does: "Deploy a stage's cluster: its owner and lifetime recorded first, then one container application per kind.",
  payload: { stage: StageName },
  spans: {
    record: span("cluster.up.record", StepKind.database),
    containers: span("cluster.up.containers", StepKind.deploy),
    ready: span("cluster.up.ready", StepKind.poll),
  },
  logs: { refused: log("cluster.up.refused", { stage: StageName, reason: ClusterRefusal }) },
  budget: {
    ms: 300_000,
    excludes: [],
    provisional: true,
    basis: "three container applications deployed once per stage; a first guess",
  },
  breakdown: [],
  examples: [{ payload: { stage: "staging" } }],
});
