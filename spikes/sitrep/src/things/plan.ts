// The thing "plan": the written plan the whole rebuild follows. In the blueprint's layout this file is
// src/things/plan/{values,events,lifecycle}.ts; one file here to keep the spike readable.
import * as Schema from "effect/Schema";
import { Machine } from "@capxul/blueprint-tools";
import { Prose, Title, stamp, type Allowed } from "../language.ts";

export const PlanId = Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9-]{1,40}$/));
export const MilestoneId = Schema.String.check(Schema.isPattern(/^(\d{1,2}|[A-Z])$/));

/** What a plan must say. Every section is required: a plan without them cannot be written. */
export const PlanText = {
  title: Title,
  /** Why we are doing this at all. */
  why: Prose,
  /** What we will build, in paragraphs. */
  what: Prose,
  /** Where it ends: what is true when the plan is finished. */
  endState: Prose,
  /** What this plan does not do. */
  outOfScope: Prose,
  /** Its milestones, in order. */
  milestones: Schema.NonEmptyArray(MilestoneId),
};

export class PlanWritten extends Schema.TaggedClass<PlanWritten>()("plan_written", { plan: PlanId, ...stamp, ...PlanText }) {}
export class PlanAgreed extends Schema.TaggedClass<PlanAgreed>()("plan_agreed", { plan: PlanId, ...stamp }) {}
export class PlanRevised extends Schema.TaggedClass<PlanRevised>()("plan_revised", { plan: PlanId, ...stamp, ...PlanText }) {}

/** A plan is a draft until Aaron agrees it; any revision makes it a draft again until he agrees the new one. */
export const Plan = Machine.make({
  name: "plan",
  key: "plan",
  states: ["draft", "agreed"],
  start: { state: "draft", by: "plan.write", event: "plan_written" },
  moves: {
    agree: { from: ["draft"], to: "agreed", by: "plan.agree", event: "plan_agreed", otherwise: { agreed: "unchanged" } },
    revise: { from: ["draft", "agreed"], to: "draft", by: "plan.revise", event: "plan_revised", otherwise: {} },
  },
});

export const planAllowed: Allowed = {
  plan_written: ["agent", "person"],
  plan_agreed: ["person"],
  plan_revised: ["agent", "person"],
};
