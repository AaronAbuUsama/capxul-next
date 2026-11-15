// `check.confirm`: nothing counts until it is read back, layer 7 of docs/design/blueprint.md, part 3. Work no door
// serves: the proving job does it after the journeys (roadmap items 4.4 and 4.5). Not built yet.
import { log, span, work } from "@capxul/blueprint-tools";
import { Signal } from "../../../telemetry/envelope.ts";
import { StepKind } from "../../../telemetry/step-kinds.ts";
import { RunId } from "../../run/values.ts";

export const checkConfirm = work({
  name: "check.confirm",
  does: "Read the run's telemetry back from the sink: nothing undeclared arrived, nothing was dropped, and as many records arrived as were sent.",
  payload: { run: RunId },
  spans: {
    read: span("check.confirm.read", StepKind.poll),
    compare: span("check.confirm.compare", StepKind.compute),
  },
  logs: {
    missing: log("check.confirm.missing", { run: RunId, signal: Signal }),
    undeclared: log("check.confirm.undeclared", { run: RunId, signal: Signal }),
  },
  budget: {
    ms: 60_000,
    excludes: [],
    provisional: true,
    basis: "docs/design/blueprint.md, part 3: 60 s, off the critical path unless ingest is late",
  },
  breakdown: [],
  examples: [{ payload: { run: "ci-19384756" } }],
});
