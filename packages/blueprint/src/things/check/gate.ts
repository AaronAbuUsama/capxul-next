// `capxul check gate` (`check.gate`): the gate every pull request clears, layers 1 to 5 of docs/design/blueprint.md,
// part 3 (today `pnpm check`). Work no door serves: CI's job `gate` runs it. Each rung is one span.
import { log, span, work } from "@capxul/blueprint-tools";
import { StepKind } from "../../telemetry/step-kinds.ts";
import { Rung } from "./values.ts";

export const checkGate = work({
  name: "check.gate",
  does: "Clear the gate's rungs in order, stopping at the first that fails.",
  payload: {},
  spans: {
    shape: span("check.gate.shape", StepKind.compute),
    format: span("check.gate.format", StepKind.compute),
    generate: span("check.gate.generate", StepKind.compute),
    seed: span("check.gate.seed", StepKind.compute),
    lint: span("check.gate.lint", StepKind.compute),
    types: span("check.gate.types", StepKind.compute),
    test: span("check.gate.test", StepKind.compute),
    delta: span("check.gate.delta", StepKind.compute),
  },
  logs: { failed: log("check.gate.failed", { rung: Rung }) },
  budget: {
    ms: 180_000,
    excludes: [],
    provisional: true,
    basis: "docs/design/blueprint.md, part 3: 3 minutes for the job; `check` run 43710528109 on master took 2 min 39 s",
  },
  breakdown: [],
  examples: [{ payload: {} }],
});
