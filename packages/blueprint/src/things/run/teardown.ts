// `run.teardown`: destroy what a run made. Work no door serves: the runner does it, with `packages/world` (today
// spanned in part).
import { log, span, work } from "@capxul/blueprint-tools";
import { WorldName } from "../../common/values.ts";
import { StepKind } from "../../telemetry/step-kinds.ts";
import { LeftBehind, RunId } from "./values.ts";

export const runTeardown = work({
  name: "run.teardown",
  does: "Destroy everything the run made: its worlds, their branches and their sites.",
  payload: { run: RunId },
  spans: {
    worlds: span("run.teardown.worlds", StepKind.deploy),
    branches: span("run.teardown.branches", StepKind.branch),
    sites: span("run.teardown.sites", StepKind.site),
  },
  logs: { left: log("run.teardown.left", { run: RunId, world: WorldName, part: LeftBehind }) },
  budget: {
    ms: 60_000,
    excludes: [],
    provisional: true,
    basis: "docs/design/blueprint.md, part 8: 1 of the run's 10 minutes; a quiet run took about 1 minute",
  },
  breakdown: [],
  examples: [{ payload: { run: "ci-19384756" } }],
});
