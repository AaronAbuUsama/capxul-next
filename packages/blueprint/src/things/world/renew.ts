// `capxul world renew` (`world.renew`): move a world's expiry later, within the platform's lifetime limit. Work no
// door serves: `packages/world` does it from the command line.
import { log, span, work } from "@capxul/blueprint-tools";
import { WorldName } from "../../common/values.ts";
import { StepKind } from "../../telemetry/step-kinds.ts";
import { Lifetime, WorkRefusal } from "./values.ts";

export const worldRenew = work({
  name: "world.renew",
  does: "Move a world's expiry later, to the given minutes from now, within the platform's lifetime limit.",
  payload: { world: WorldName, minutes: Lifetime },
  spans: { registry: span("world.renew.registry", StepKind.database) },
  logs: { refused: log("world.renew.refused", { world: WorldName, reason: WorkRefusal }) },
  budget: {
    ms: 1_000,
    excludes: [],
    provisional: true,
    basis: "one write to the registry; a first guess",
  },
  breakdown: [],
  examples: [{ payload: { world: "town", minutes: 120 } }],
});
