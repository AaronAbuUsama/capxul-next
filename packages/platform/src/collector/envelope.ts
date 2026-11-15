// INTERIM. The resource attribute keys the collector stamps, and the runner's run attribute, named once here until
// the blueprint's telemetry envelope (#301, `packages/blueprint/src/telemetry/envelope.ts`) reaches master; then they
// are imported from it and this file goes. The names are #301's (docs/design/blueprint.md, part 10); the lead allowed
// them here as the one exception to "no new `capxul.*` string".
import * as Rec from "effect/Record";

/** The keys the collector owns on every resource: a caller's value under any of them is dropped for the collector's. */
export const STAMPED = {
  /** The world the record came from. */
  world: "capxul.world",
  /** The platform stage whose collector took it. */
  stage: "capxul.stage",
  /** The world's grade, `private`, `shared` or `real`, under OpenTelemetry's name for a deployment environment. */
  grade: "deployment.environment.name",
} as const;

/** Every stamped key. */
export const STAMPED_KEYS: ReadonlyArray<string> = Rec.values(STAMPED);

/** On a run's resource (the runner's): whether it may prove, and which code and CI run made it. */
export const RUN_ATTRIBUTES = {
  /** `true` for a run in CI, `false` from an agent's container (a boolean attribute). */
  trusted: "capxul.run.trusted",
  revision: "vcs.ref.head.revision",
  ref: "vcs.ref.head.name",
  pipelineRun: "cicd.pipeline.run.id",
} as const;
