// `check.watch`: after a deploy, the same generic checks and measures on what the deployed stage records, layer 8 of
// docs/design/blueprint.md, part 3. Work no door serves: a scheduled job does it. Not built yet. What it watches is
// declared in src/telemetry/watch.ts.
import { log, span, work } from "@capxul/blueprint-tools";
import { StepKind } from "../../telemetry/step-kinds.ts";
import { StageName } from "../cluster/values.ts";
import { Measure } from "./values.ts";

export const checkWatch = work({
  name: "check.watch",
  does: "Run the generic checks and measures on what a deployed stage records; a measure that got worse is a finding.",
  payload: { stage: StageName },
  spans: {
    read: span("check.watch.read", StepKind.poll),
    compare: span("check.watch.compare", StepKind.container),
  },
  logs: { worse: log("check.watch.worse", { stage: StageName, measure: Measure }) },
  budget: {
    ms: 60_000,
    excludes: [],
    provisional: true,
    basis: "off every path (docs/design/blueprint.md, part 3); a first guess",
  },
  breakdown: [],
  examples: [{ payload: { stage: "staging" } }],
});
