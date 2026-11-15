// `capxul journey run` (`journey.run`): one journey, on one shard's world. Work no door serves: the runner does it.
// Its reset is `world.reset`, its calls are operations with spans of their own, and each call's checks are
// `check.call`; its own span is the waits between steps.
import { log, span, work } from "@capxul/blueprint-tools";
import { WorldName } from "../../../common/values.ts";
import { StepKind } from "../../../telemetry/step-kinds.ts";
import { StartingPointName } from "../../starting-point/values.ts";
import { JourneyName, JourneyStep } from "../values.ts";

export const journeyRun = work({
  name: "journey.run",
  does: "Reset a shard's world to the journey's starting point, take the journey's steps, and check every call.",
  payload: { journey: JourneyName, world: WorldName, from: StartingPointName },
  spans: {
    // The journey's starting point, made by its steps once the world is reset (the runner's part "starting world").
    start: span("journey.run.start", StepKind.compute),
    // One step of the journey, from its beginning to its end.
    step: span("journey.run.step", StepKind.compute),
    // One call of an operation through the endpoint, the operation an attribute; its own spans are the operation's.
    call: span("journey.run.call", StepKind.compute),
    wait: span("journey.run.wait", StepKind.wait),
  },
  logs: { stepFailed: log("journey.run.step_failed", { journey: JourneyName, step: JourneyStep }) },
  budget: {
    ms: 60_000,
    excludes: [],
    provisional: true,
    basis: "a shard's 6 minutes hold several journeys (docs/design/blueprint.md, part 8); a first guess per journey",
  },
  breakdown: [],
  examples: [{ payload: { journey: "found-northwind", world: "w-shard-1", from: "founded" } }],
});
