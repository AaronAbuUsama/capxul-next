// A span the runner records under a name the blueprint declares (roadmap 4.7): its name from `Pipeline`, never written
// here as a string, and its kind under the envelope's `capxul.step.kind`. A piece of work's own span (`run.start`,
// `journey.run`, `cluster.up`, ...) has a name and no kind: the blueprint gives kinds to the spans inside a work.
import { Envelope, Pipeline } from "@capxul/blueprint";

/** A declared span: its name, and its kind when the blueprint gives it one. */
export interface Declared {
  readonly name: string;
  readonly kind?: string | undefined;
}

/** A piece of work's own span, by the work's declaration: its name only. */
export const workSpan = (work: { readonly name: string }): Declared => ({ name: work.name });

/** The attributes of a declared span: its kind, when it has one, and `more`. */
export const stepAttributes = (span: Declared, more: Record<string, unknown> = {}): Record<string, unknown> => ({
  ...(span.kind === undefined ? {} : { [Envelope.attributes.stepKind.name]: span.kind }),
  ...more,
});

/** The options of a declared span, for `Effect.withSpan`, `Effect.fn` and `Effect.makeSpan`. */
export const stepOptions = (span: Declared, more: Record<string, unknown> = {}) => ({
  attributes: stepAttributes(span, more),
});

/** The spans of the run itself, as the blueprint declares them: its root, and each step of a journey. */
export const RUN_SPANS = {
  /** The root of a run's trace (main.ts, in-world.ts, run.ts, scenario-runs.ts), its mode an attribute. */
  run: workSpan(Pipeline.runStart),
  /** One step of a journey, from the journey's `begin` to its `end` (steps.ts). */
  step: Pipeline.journeyRun.spans.step,
  /** One call a journey makes, its operation an attribute (client.ts). */
  call: Pipeline.journeyRun.spans.call,
} as const;
