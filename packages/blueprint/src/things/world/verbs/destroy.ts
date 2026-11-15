// `capxul world destroy` (`world.destroy`): destroy one world and everything of it. Work no door serves:
// `packages/world` does it from the command line (today its `world destroy`).
import { log, span, work } from "@capxul/blueprint-tools";
import { WorldName } from "../../../common/values.ts";
import { StepKind } from "../../../telemetry/step-kinds.ts";
import { WorkRefusal, WorldPart } from "../values.ts";

export const worldDestroy = work({
  name: "world.destroy",
  does: "Destroy one world and everything of it: its API, its objects' state, its branch, its sites and its entry in the registry.",
  payload: { world: WorldName },
  spans: {
    api: span("world.destroy.api", StepKind.deploy),
    objects: span("world.destroy.objects", StepKind.deploy),
    branch: span("world.destroy.branch", StepKind.branch),
    sites: span("world.destroy.sites", StepKind.site),
    registry: span("world.destroy.registry", StepKind.database),
  },
  logs: {
    refused: log("world.destroy.refused", { world: WorldName, reason: WorkRefusal }),
    left: log("world.destroy.left", { world: WorldName, part: WorldPart }),
  },
  budget: {
    ms: 10_000,
    excludes: [],
    provisional: true,
    basis: "roadmap item 1.15's proof destroyed three worlds on the cluster in 3.6 to 3.9 s; a guess above that",
  },
  breakdown: [],
  examples: [{ payload: { world: "town" } }],
});
