// The thing "milestone": one part of the plan, with its own goal and what "done" means. Whether it is done is not
// stored: it is derived from its steps.
import * as Schema from "effect/Schema";
import { Machine } from "@capxul/blueprint-tools";
import { Prose, Title, stamp, type Allowed } from "../language.ts";
import { MilestoneId, PlanId } from "./plan.ts";

export const StepId = Schema.String.check(Schema.isPattern(/^(\d{1,2}|[A-Z])\.\d{1,2}$/));

/** What a milestone must say. */
export const MilestoneText = {
  plan: PlanId,
  title: Title,
  /** What it delivers. */
  goal: Prose,
  /** Why it comes at this point of the plan. */
  why: Prose,
  /** What is true when it is done: the test its last step's proof meets. */
  doneWhen: Prose,
  /** Its steps, in order. */
  steps: Schema.NonEmptyArray(StepId),
};

export class MilestonePlanned extends Schema.TaggedClass<MilestonePlanned>()("milestone_planned", { milestone: MilestoneId, ...stamp, ...MilestoneText }) {}
export class MilestoneStarted extends Schema.TaggedClass<MilestoneStarted>()("milestone_started", { milestone: MilestoneId, ...stamp }) {}
export class MilestoneRevised extends Schema.TaggedClass<MilestoneRevised>()("milestone_revised", { milestone: MilestoneId, ...stamp, ...MilestoneText }) {}

export const Milestone = Machine.make({
  name: "milestone",
  key: "milestone",
  states: ["planned", "active"],
  start: { state: "planned", by: "milestone.plan", event: "milestone_planned" },
  moves: {
    start: { from: ["planned"], to: "active", by: "milestone.start", event: "milestone_started", otherwise: { active: "unchanged" } },
    revise: { from: ["planned", "active"], to: "planned", by: "milestone.revise", event: "milestone_revised", otherwise: {} },
  },
});

export const milestoneAllowed: Allowed = {
  milestone_planned: ["agent", "person"],
  milestone_started: ["agent"],
  milestone_revised: ["agent", "person"],
};
