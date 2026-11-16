// The thing "step": one piece of the plan that a proof shows done. Only the pipeline proves a step (a verdict of a CI
// run); only Aaron drops one. An agent starts it.
import * as Schema from "effect/Schema";
import { Prose, Title, Url, stamp, type Allowed, machine } from "../language.ts";
import { StepId } from "./milestone.ts";
import { MilestoneId } from "./plan.ts";

export const LaneId = Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9-]{1,30}$/));
export const Units = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 50 }));

/** What a step must say. */
export const StepText = {
  milestone: MilestoneId,
  title: Title,
  /** What it builds or proves. */
  what: Prose,
  /** Why the plan needs it. */
  why: Prose,
  /** The proof that shows it done. */
  doneWhen: Prose,
  /** The steps that must be done first. */
  needs: Schema.Array(StepId),
  /** How many like things it is (twelve scenarios is 12); 1 otherwise. */
  units: Units,
};

export class StepPlanned extends Schema.TaggedClass<StepPlanned>()("step_planned", { step: StepId, ...stamp, ...StepText }) {}
export class StepStarted extends Schema.TaggedClass<StepStarted>()("step_started", { step: StepId, ...stamp, lane: LaneId }) {}
export class StepProven extends Schema.TaggedClass<StepProven>()("step_proven", { step: StepId, ...stamp, proof: Url }) {}
export class StepReopened extends Schema.TaggedClass<StepReopened>()("step_reopened", { step: StepId, ...stamp, why: Prose }) {}
export class StepDropped extends Schema.TaggedClass<StepDropped>()("step_dropped", { step: StepId, ...stamp, why: Prose }) {}

const done = { refusal: "StepDone" } as const;
const dropped = { refusal: "StepDropped" } as const;

export const Step = machine({
  name: "step",
  key: "step",
  states: ["planned", "active", "done", "dropped"],
  start: { state: "planned", by: "step.plan", event: StepPlanned },
  moves: {
    start: { from: ["planned"], to: "active", by: "step.start", event: StepStarted, otherwise: { active: "unchanged", done, dropped } },
    prove: { from: ["planned", "active"], to: "done", by: "step.prove", event: StepProven, otherwise: { done: "unchanged", dropped } },
    reopen: { from: ["done"], to: "active", by: "step.reopen", event: StepReopened, otherwise: { planned: "unchanged", active: "unchanged", dropped } },
    drop: { from: ["planned", "active"], to: "dropped", by: "step.drop", event: StepDropped, otherwise: { done, dropped: "unchanged" } },
  },
});

export const stepAllowed: Allowed = {
  step_planned: ["agent", "person"],
  step_started: ["agent"],
  step_proven: ["pipeline"],
  step_reopened: ["pipeline"],
  step_dropped: ["person"],
};
