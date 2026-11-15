// The thing "lane": a chain of steps climbed on one slice branch by one lead.
import * as Schema from "effect/Schema";
import { Machine } from "@capxul/blueprint-tools";
import { Title, ThreadId, stamp, type Allowed } from "../language.ts";
import { StepId } from "./milestone.ts";
import { LaneId } from "./step.ts";

export const LaneText = {
  title: Title,
  /** Its slice branch. */
  branch: Schema.String.check(Schema.isPattern(/^slice\/[a-z][a-z0-9-]{1,30}$/)),
  steps: Schema.NonEmptyArray(StepId),
};

export class LaneOpened extends Schema.TaggedClass<LaneOpened>()("lane_opened", { lane: LaneId, ...stamp, ...LaneText }) {}
export class LaneLed extends Schema.TaggedClass<LaneLed>()("lane_led", { lane: LaneId, ...stamp, lead: ThreadId }) {}
export class LaneLanded extends Schema.TaggedClass<LaneLanded>()("lane_landed", { lane: LaneId, ...stamp }) {}

export const Lane = Machine.make({
  name: "lane",
  key: "lane",
  states: ["open", "landed"],
  start: { state: "open", by: "lane.open", event: "lane_opened" },
  moves: {
    lead: { from: ["open"], to: "open", by: "lane.lead", event: "lane_led", otherwise: { landed: { refusal: "LaneLanded" } } },
    land: { from: ["open"], to: "landed", by: "lane.land", event: "lane_landed", otherwise: { landed: "unchanged" } },
  },
});

export const laneAllowed: Allowed = { lane_opened: ["agent"], lane_led: ["agent"], lane_landed: ["pipeline", "agent"] };
