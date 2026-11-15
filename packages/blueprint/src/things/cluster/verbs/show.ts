// `capxul cluster show` (`cluster.show`): a stage's cluster as it is now. Work no door serves: `packages/world`
// does it from the command line.
import { log, span, work } from "@capxul/blueprint-tools";
import { StepKind } from "../../../telemetry/step-kinds.ts";
import { ClusterRefusal, StageName } from "../values.ts";

export const clusterShow = work({
  name: "cluster.show",
  does: "Show a stage's cluster as it is now: its containers, the worlds on it and its places left.",
  payload: { stage: StageName },
  spans: {
    registry: span("cluster.show.registry", StepKind.database),
    containers: span("cluster.show.containers", StepKind.poll),
  },
  logs: { refused: log("cluster.show.refused", { stage: StageName, reason: ClusterRefusal }) },
  budget: {
    ms: 2_000,
    excludes: [],
    provisional: true,
    basis: "a read of the registry and the containers' state; a first guess",
  },
  breakdown: [],
  examples: [{ payload: { stage: "staging" } }],
});
