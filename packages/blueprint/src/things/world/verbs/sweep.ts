// `capxul world sweep` (`world.sweep`): destroy what expired. Work no door serves: `packages/world` does it on a
// schedule and from the command line (today its `world sweep`).
import { log, span, work } from "@capxul/blueprint-tools";
import { WorldName } from "../../../common/values.ts";
import { StepKind } from "../../../telemetry/step-kinds.ts";
import { WorldPart } from "../values.ts";

export const worldSweep = work({
  name: "world.sweep",
  does: "Destroy every world past its expiry, and every part of a world the registry no longer holds.",
  payload: {},
  spans: {
    find: span("world.sweep.find", StepKind.database),
    api: span("world.sweep.api", StepKind.deploy),
    branches: span("world.sweep.branches", StepKind.branch),
    sites: span("world.sweep.sites", StepKind.site),
  },
  logs: {
    swept: log("world.sweep.swept", { world: WorldName, part: WorldPart }),
    left: log("world.sweep.left", { world: WorldName, part: WorldPart }),
  },
  budget: {
    ms: 60_000,
    excludes: [],
    provisional: true,
    basis: "a few worlds destroyed one after another, each about 4 s (roadmap item 1.15); a first guess",
  },
  breakdown: [],
  examples: [{ payload: {} }],
});
