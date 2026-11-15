// `starting-point.make`: the one generic maker of a starting point from its typed steps (roadmap item 7.2, ratchet
// R11; today `packages/runner/src/worlds/*`, by hand). Work no door serves: the runner does it. Each step is an
// operation with spans of its own; this work's own span is the waits between them.
import { log, span, work } from "@capxul/blueprint-tools";
import { WorldName } from "../../../common/values.ts";
import { StepKind } from "../../../telemetry/step-kinds.ts";
import { PointStep, StartingPointName } from "../values.ts";

export const startingPointMake = work({
  name: "starting-point.make",
  does: "Make a starting point in a world by taking its typed steps, each an operation through the endpoint, in order.",
  payload: { world: WorldName, point: StartingPointName },
  spans: { wait: span("starting-point.make.wait", StepKind.wait) },
  logs: {
    stepFailed: log("starting-point.make.step_failed", { world: WorldName, point: StartingPointName, step: PointStep }),
  },
  budget: {
    ms: 90_000,
    excludes: [],
    provisional: true,
    basis: "run.prepare's 2 minutes hold the starting points; making `founded` took 6 minutes before the speed changes",
  },
  breakdown: [],
  examples: [{ payload: { world: "w-shard-1", point: "founded" } }],
});
