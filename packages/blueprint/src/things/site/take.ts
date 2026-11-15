// `site.take`: give a world its companies' sites from the bench's pool (the glossary's word; today's site claim).
// Work no door serves: `packages/world` asks the site service for it.
import { log, span, work } from "@capxul/blueprint-tools";
import { WorldName } from "../../common/values.ts";
import { StepKind } from "../../telemetry/step-kinds.ts";
import { StartingPointName } from "../starting-point/values.ts";
import { TakeRefusal } from "./values.ts";

export const siteTake = work({
  name: "site.take",
  does: "Give a world its companies' sites from the bench's pool, each a ready copy of its starting point's site template.",
  payload: { world: WorldName, point: StartingPointName },
  spans: {
    take: span("site.take.take", StepKind.site),
    ready: span("site.take.ready", StepKind.poll),
  },
  logs: { refused: log("site.take.refused", { world: WorldName, reason: TakeRefusal }) },
  budget: {
    ms: 20_000,
    excludes: [],
    provisional: true,
    basis: "a site from the pool is already up; a first guess",
  },
  breakdown: [],
  examples: [{ payload: { world: "w-shard-1", point: "founded" } }],
});
