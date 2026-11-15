// `capxul cluster down` (`cluster.down`): destroy a stage's cluster once it holds no world. Work no door serves:
// `packages/world` does it from the command line.
import { log, span, work } from "@capxul/blueprint-tools";
import { StepKind } from "../../telemetry/step-kinds.ts";
import { ClusterRefusal, StageName } from "./values.ts";

export const clusterDown = work({
  name: "cluster.down",
  does: "Destroy a stage's cluster and its record, once no world is on it.",
  payload: { stage: StageName },
  spans: {
    containers: span("cluster.down.containers", StepKind.deploy),
    record: span("cluster.down.record", StepKind.database),
  },
  logs: { refused: log("cluster.down.refused", { stage: StageName, reason: ClusterRefusal }) },
  budget: {
    ms: 120_000,
    excludes: [],
    provisional: true,
    basis: "three container applications destroyed; a first guess",
  },
  breakdown: [],
  examples: [{ payload: { stage: "staging" } }],
});
