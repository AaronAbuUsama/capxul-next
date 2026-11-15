// `ratchet.count` (`pnpm ratchets`): count every ratchet's list (docs/design/blueprint.md, part 4). Work no door serves:
// the gate runs it on every pull request, and each count is the metric `capxul.ratchet.remaining`. Not built yet.
import { log, span, work } from "@capxul/blueprint-tools";
import { StepKind } from "../../telemetry/step-kinds.ts";
import { ItemCount, RatchetName } from "./values.ts";

export const ratchetCount = work({
  name: "ratchet.count",
  does: "Count every ratchet's list; a list that grew fails, and one that shrank must be committed smaller.",
  payload: {},
  spans: { lists: span("ratchet.count.lists", StepKind.container) },
  logs: { grew: log("ratchet.count.grew", { ratchet: RatchetName, was: ItemCount, now: ItemCount }) },
  budget: {
    ms: 10_000,
    excludes: [],
    provisional: true,
    basis: "lint and file reads in one process; a first guess inside the gate's 3 minutes",
  },
  breakdown: [],
  examples: [{ payload: {} }],
});
