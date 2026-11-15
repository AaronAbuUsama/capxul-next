// `run.verdict`: write a run's verdict, set its check and archive its telemetry (roadmap item 4.5). Work no door
// serves: the proving job does it, in CI only. Not built yet.
import { log, span, work } from "@capxul/blueprint-tools";
import { StepKind } from "../../../telemetry/step-kinds.ts";
import { NotCounted, RunId } from "../values.ts";

export const runVerdict = work({
  name: "run.verdict",
  does: "Write the run's verdict to the branch `proofs`, set its GitHub check, and archive its telemetry.",
  payload: { run: RunId },
  spans: {
    write: span("run.verdict.write", StepKind.compute),
    check: span("run.verdict.check", StepKind.container),
    archive: span("run.verdict.archive", StepKind.container),
  },
  logs: { notCounted: log("run.verdict.not_counted", { run: RunId, reason: NotCounted }) },
  budget: {
    ms: 15_000,
    excludes: [],
    provisional: true,
    basis:
      "docs/design/blueprint.md, part 8: half of the 30 s held for check.confirm and run.verdict on the critical path",
  },
  breakdown: [],
  examples: [{ payload: { run: "ci-19384756" } }],
});
