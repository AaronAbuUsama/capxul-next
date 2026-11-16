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
    // One JSON-RPC request of a chain read a step or its checks make, its method and its block range attributes.
    chain: span("journey.run.chain", StepKind.chain),
    // A check's observation read sent again after a transport error: the backoff, then the send again, once per resend.
    resend: span("journey.run.resend", StepKind.wait),
    // Waiting for a world's place, under the runner's worlds at once and the hub's free places (4.8 b).
    place: span("journey.run.place", StepKind.wait),
    // Waiting for a site's slot from the bench's blank pool before the journey founds its company (4.8 b).
    sites: span("journey.run.sites", StepKind.wait),
    // A journey played in the run's shared world waiting for that world to be made and to answer steadily, while
    // journeys in worlds of their own start at once (4.8, the own-world track's A-1).
    shared: span("journey.run.shared", StepKind.wait),
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
