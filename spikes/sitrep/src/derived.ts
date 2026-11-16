// What the snapshot carries beside the things: facts derived from their owners at each refresh, never typed and never
// events (docs/design/sitrep.md, "Derived at each refresh"). Each source names the time it was read, so the page can
// show a panel's age and turn it amber past 30 minutes. Declared here so the page shows nothing these shapes refuse.
import * as Schema from "effect/Schema";
import { Instant, Prose, Title, Url } from "./language.ts";
import { StepId } from "./things/milestone.ts";
import { LaneId } from "./things/step.ts";

/** Where a derived fact was read from, and when. */
export const SourceId = Schema.Literals(["roadmap", "github", "conductor"]);
export const Source = Schema.Struct({ id: SourceId, name: Title, read: Instant });

/** `master`'s latest `check` run, and the full runs (`world.yml`) with their wall time. */
export const Health = Schema.Struct({
  master: Schema.Struct({ state: Schema.Literals(["green", "red", "running"]), label: Schema.String, href: Url, at: Instant }),
  runs: Schema.Array(
    Schema.Struct({ slice: Schema.String, outcome: Schema.Literals(["passed", "failed"]), minutes: Schema.Number, at: Instant, href: Url }),
  ),
});

/** A lane's pull request, with its state as GitHub reports it. */
export const PullRequest = Schema.Struct({
  number: Schema.Int,
  title: Title,
  state: Schema.Literals(["open", "draft", "merged", "closed", "queued", "checks running", "checks failed"]),
  lane: LaneId,
  href: Url,
});

/** One ratchet of the blueprint's registry: its count at every change, or null while nothing counts it. */
export const RatchetMeasure = Schema.Struct({
  id: Schema.String.check(Schema.isPattern(/^R\d{1,2}$/)),
  name: Title,
  holds: Prose,
  closes: Schema.String,
  count: Schema.NullOr(Schema.Int),
  countedBy: Schema.optional(Schema.String),
  series: Schema.Array(Schema.Struct({ at: Instant, count: Schema.Int })),
});

/** A budget against what was measured, newest last. A budget is a target: past 1.5 times it raises a review. */
export const Budget = Schema.Struct({
  name: Title,
  budget: Schema.Number,
  unit: Schema.Literals(["min", "s", "ms"]),
  source: SourceId,
  measured: Schema.Array(Schema.Number),
});

/** An eval the plan will measure, by the step that builds it. */
export const Eval = Schema.Struct({ step: StepId, name: Title, what: Prose });

export const Derived = Schema.Struct({
  sources: Schema.Array(Source),
  health: Schema.NullOr(Health),
  pulls: Schema.Array(PullRequest),
  landed: Schema.Array(Schema.Struct({ at: Instant, title: Title, href: Url })),
  measures: Schema.Struct({ ratchets: Schema.Array(RatchetMeasure), budgets: Schema.Array(Budget), evals: Schema.Array(Eval) }),
});
export type Derived = typeof Derived.Type;

/** A refresh with nothing derived yet: what the spike's own example projects with. */
export const NOTHING_DERIVED: Derived = {
  sources: [],
  health: null,
  pulls: [],
  landed: [],
  measures: { ratchets: [], budgets: [], evals: [] },
};
