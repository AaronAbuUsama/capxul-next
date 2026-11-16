// `check.isolation`: each journey's records stay its own when every journey runs at once in one shared world (roadmap
// item 4.8, part B; its check is the 4.11 author's). Work no door serves: the runner reads the whole run once, after
// the journeys, and the check compares each journey's events and traces with what it alone could have made.
import { log, span, work } from "@capxul/blueprint-tools";
import { WorldName } from "../../../common/values.ts";
import { StepKind } from "../../../telemetry/step-kinds.ts";
import { JourneyName } from "../../journey/values.ts";

export const checkIsolation = work({
  name: "check.isolation",
  does: "Read a shared world's whole run, its events and its traces, so each journey's records can be checked as its own.",
  payload: { world: WorldName },
  spans: {
    // Two queries of the world's database: every row of app.events, and every trace's service and root span.
    read: span("check.isolation.read", StepKind.database),
  },
  // Written when a journey's events or traces hold a record another journey made.
  logs: { leaked: log("check.isolation.leaked", { world: WorldName, journey: JourneyName }) },
  budget: {
    ms: 5_000,
    excludes: [],
    provisional: true,
    basis: "a first guess: two reads of one world's database after the run, off the critical path",
  },
  breakdown: [],
  examples: [{ payload: { world: "shared-a1b2c3" } }],
});
