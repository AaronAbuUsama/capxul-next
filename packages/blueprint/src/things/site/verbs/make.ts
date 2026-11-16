// `site.make`: give a founded company its site, a ready company copy (Frappe's setup wizard already run) taken from the
// bench's pool and joined to the world (4.8, option 2). Work no door serves as its own operation: the bench's door does
// it behind Core's site request, and the world reads how each site was made.
import { log, span, work } from "@capxul/blueprint-tools";
import { WorldName } from "../../../common/values.ts";
import { StepKind } from "../../../telemetry/step-kinds.ts";
import { MakeFallback, SiteOrigin } from "../values.ts";

export const siteMake = work({
  name: "site.make",
  does: "Give a founded company its site: a ready company copy taken from the bench's pool and joined to the world; with none, made from the blank.",
  payload: { world: WorldName },
  spans: {
    // The world's read of how its sites were made (their origins and the door's steps).
    list: span("site.make.list", StepKind.site),
    // The door taking a ready company copy, or copying the company template when the pool is empty.
    take: span("site.make.take", StepKind.site),
    // The door joining the copy to the world: the world's clock, Core's API user, the scheduler.
    join: span("site.make.join", StepKind.site),
    // Waiting for the site to answer as ready.
    ready: span("site.make.ready", StepKind.poll),
  },
  logs: { fellBack: log("site.make.fell_back", { world: WorldName, origin: SiteOrigin, reason: MakeFallback }) },
  budget: {
    ms: 10_000,
    excludes: [],
    provisional: true,
    basis: "a ready copy renamed and joined, about 2 to 5 s on an idle bench; a first guess until measured",
  },
  breakdown: [],
  examples: [{ payload: { world: "w-shard-1" } }],
});
