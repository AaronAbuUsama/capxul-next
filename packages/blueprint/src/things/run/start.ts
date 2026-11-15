// `capxul run start` (`run.start`): one CI or container run, from its start to its verdict. Work no door serves: the
// runner does it. Its budget is the run's 10 minutes (docs/design/blueprint.md, part 8), broken down below: a target,
// never a gate. A measured p95 over 1.5 times it (15 minutes) raises an architecture review (src/telemetry/watch.ts).
import { log, span, work } from "@capxul/blueprint-tools";
import { StepKind } from "../../telemetry/step-kinds.ts";
import { checkConfirm } from "../check/confirm.ts";
import { runPrepare } from "./prepare.ts";
import { runTeardown } from "./teardown.ts";
import { RunId, RunPart, ShardCount, Trusted } from "./values.ts";
import { runVerdict } from "./verdict.ts";

const ci = span("run.start.ci", StepKind.container);

export const runStart = work({
  name: "run.start",
  does: "One CI or container run, from its start to its verdict: prepare, the journeys by shard, confirm, verdict, teardown.",
  payload: { shards: ShardCount, trusted: Trusted },
  spans: { ci },
  logs: { partFailed: log("run.start.part_failed", { run: RunId, part: RunPart }) },
  budget: {
    ms: 600_000,
    excludes: [],
    provisional: true,
    basis: "Aaron's 10 minutes (docs/design/blueprint.md, part 8); a quiet run took about 36 minutes",
  },
  breakdown: [
    { part: ci.name, ms: 30_000 },
    { part: runPrepare.name, ms: runPrepare.budget.ms },
    { part: "the journeys, on the longest shard", ms: 360_000 },
    { part: `${checkConfirm.name} and ${runVerdict.name}, on the critical path`, ms: 30_000 },
    { part: runTeardown.name, ms: runTeardown.budget.ms },
  ],
  examples: [{ payload: { shards: 2, trusted: true } }],
});
