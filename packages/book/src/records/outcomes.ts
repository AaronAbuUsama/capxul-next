// The top layer: what people get (journeys), what must always hold (invariants), where it runs
// (environments), and why it is this way (decisions).

import { Schema } from "effect";
import { Common, Id, Line, make, Prose, Ref, Title } from "./base.ts";
import { KINDS } from "./base.ts";

// ── journey ─────────────────────────────────────────────────────────────────────────────────

export const JourneySpec = Schema.Struct({
  ...Common,
  steps: Schema.Array(
    Schema.Struct({
      operation: Ref("operation"),
      /** The system actor who takes the step. */
      as: Id,
      /** The event that proves the step for the funnel. Absent: the step is a gap. */
      proves: Schema.optionalKey(Ref("event")),
    }),
  ),
  /** Ways into the journey: properties of its step events, never journeys of their own. */
  variants: Schema.optionalKey(Schema.Array(Schema.String)),
});
export const defineJourney = make("journey")(JourneySpec);
export type Journey = ReturnType<typeof defineJourney>;

// ── invariant ───────────────────────────────────────────────────────────────────────────────

export const InvariantSpec = Schema.Struct({
  ...Common,
  statement: Line,
  over: Schema.Array(Schema.Union([Ref("table"), Ref("machine")])),
  check: Schema.Literals(["property", "fuzz", "reconcile", "static"]),
  /** For a `reconcile` check: the workflow that checks it in production. */
  by: Schema.optionalKey(Ref("workflow")),
});
export const defineInvariant = make("invariant")(InvariantSpec);
export type Invariant = ReturnType<typeof defineInvariant>;

// ── environment ─────────────────────────────────────────────────────────────────────────────

export const EnvironmentSpec = Schema.Struct({
  ...Common,
  runs: Schema.Array(Schema.Struct({ component: Ref("component"), on: Line })),
  config: Schema.Array(Schema.String),
  secrets: Schema.Array(Schema.String),
  deploy: Prose,
  bootMs: Schema.optionalKey(Schema.Int),
});
export const defineEnvironment = make("environment")(EnvironmentSpec);
export type Environment = ReturnType<typeof defineEnvironment>;

// ── decision ────────────────────────────────────────────────────────────────────────────────

const AnyRef = Schema.Struct({ _kind: Schema.Literals(KINDS), id: Schema.String });

export const DecisionSpec = Schema.Struct({
  id: Id,
  title: Title,
  question: Prose,
  options: Schema.Array(Schema.Struct({ label: Schema.String, text: Prose })),
  chosen: Schema.String,
  why: Prose,
  source: Line,
  affects: Schema.Array(AnyRef),
});
export const defineDecision = make("decision")(DecisionSpec);
export type Decision = ReturnType<typeof defineDecision>;
