// The thing "sitrep": one short spoken update. Aaron hearing it is an event too, stamped like any other.
import * as Schema from "effect/Schema";
import { Machine } from "@capxul/blueprint-tools";
import { Title, Url, stamp, type Allowed } from "../language.ts";
import { StepId } from "./milestone.ts";
import { LaneId } from "./step.ts";

export const SitrepId = Schema.String.check(Schema.isPattern(/^\d{8}-\d{4}-[a-z0-9-]{2,40}$/));
/** One part of a sitrep: one or two short spoken sentences, one part of the player. */
export const Part = Schema.String.check(Schema.isMinLength(10), Schema.isMaxLength(300));
export const Link = Schema.Struct({ label: Title, href: Url });

export const SitrepText = {
  title: Title,
  parts: Schema.NonEmptyArray(Part).check(Schema.isMaxLength(5)),
  links: Schema.Array(Link),
  lanes: Schema.Array(LaneId),
  steps: Schema.Array(StepId),
};

export class SitrepSaid extends Schema.TaggedClass<SitrepSaid>()("sitrep_said", { sitrep: SitrepId, ...stamp, ...SitrepText }) {}
export class SitrepHeard extends Schema.TaggedClass<SitrepHeard>()("sitrep_heard", { sitrep: SitrepId, ...stamp }) {}

export const Sitrep = Machine.make({
  name: "sitrep",
  key: "sitrep",
  states: ["said", "heard"],
  start: { state: "said", by: "sitrep.say", event: "sitrep_said" },
  moves: { hear: { from: ["said"], to: "heard", by: "sitrep.hear", event: "sitrep_heard", otherwise: { heard: "unchanged" } } },
});

export const sitrepAllowed: Allowed = { sitrep_said: ["agent"], sitrep_heard: ["person"] };
