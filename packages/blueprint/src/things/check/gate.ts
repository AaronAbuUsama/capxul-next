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
    shape: span("check.gate.shape", StepKind.container),
    format: span("check.gate.format", StepKind.container),
    generate: span("check.gate.generate", StepKind.container),
    seed: span("check.gate.seed", StepKind.container),
    lint: span("check.gate.lint", StepKind.container),
    types: span("check.gate.types", StepKind.container),
    test: span("check.gate.test", StepKind.container),
    delta: span("check.gate.delta", StepKind.container),
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
