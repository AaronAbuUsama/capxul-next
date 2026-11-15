// `check.call`: the generic checks on one call of a journey, layer 6 of docs/design/blueprint.md, part 3, read from
// the tap (AGENTS.md, "How it is measured"). Work no door serves: the runner does it, while the next step runs.
import { log, span, work } from "@capxul/blueprint-tools";
import { TraceId } from "../../common/values.ts";
import { StepKind } from "../../telemetry/step-kinds.ts";
import { CallCheck } from "./values.ts";

export const checkCall = work({
  name: "check.call",
  does: "Judge one call from its record: its events, its declared spans, its deciding logs, its machine's path and its timings.",
  payload: { trace: TraceId },
  spans: {
    read: span("check.call.read", StepKind.database),
    events: span("check.call.events", StepKind.container),
    spans: span("check.call.spans", StepKind.container),
    logs: span("check.call.logs", StepKind.container),
    path: span("check.call.path", StepKind.container),
    timings: span("check.call.timings", StepKind.container),
  },
  logs: { failed: log("check.call.failed", { trace: TraceId, check: CallCheck }) },
  budget: {
    ms: 500,
    excludes: [],
    provisional: true,
    basis:
      "docs/design/blueprint.md, part 3: 30 s of a run's critical path for every call's checks; a first guess per call",
  },
  breakdown: [],
  examples: [{ payload: { trace: "4bf92f3577b34da6a3ce929d0e0e4736" } }],
});
