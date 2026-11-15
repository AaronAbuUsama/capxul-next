// The thing "ask": a decision an agent needs from Aaron. Every section is required, so no agent can ask a bare
// question: the problem, its context, the rubric it should be judged by, two to four options each with its trade-offs,
// and the recommendation with its reason. Aaron answers with an option or in his own words, and can undo.
import * as Schema from "effect/Schema";
import { Machine } from "@capxul/blueprint-tools";
import { Instant, Prose, ThreadId, Title, stamp, type Allowed } from "../language.ts";
import { StepId } from "./milestone.ts";
import { LaneId } from "./step.ts";

export const AskId = Schema.String.check(Schema.isPattern(/^ask-[a-z0-9-]{3,60}$/));
export const Letter = Schema.Literals(["A", "B", "C", "D"]);

export const Criterion = Schema.Struct({ name: Title, why: Prose });
export const AskOption = Schema.Struct({ key: Letter, title: Title, detail: Prose, tradeoffs: Prose });

export const AskText = {
  /** The question, as one sentence. */
  question: Title,
  /** What is wrong or undecided. */
  problem: Prose,
  /** What Aaron needs to know to decide. */
  context: Prose,
  /** How to judge the options. */
  rubric: Schema.NonEmptyArray(Criterion),
  options: Schema.Array(AskOption).check(Schema.isMinLength(2), Schema.isMaxLength(4)),
  recommended: Letter,
  /** Why the recommendation. */
  because: Prose,
  /** Where it comes from. */
  lane: Schema.optional(LaneId),
  step: Schema.optional(StepId),
  /** When the asking thread is blocked from, if it is. */
  needBy: Schema.optional(Instant),
};

/** An answer: one of the options, with an optional note, or Aaron's own words. */
export const Answer = Schema.Union([
  Schema.Struct({ chose: Letter, note: Schema.optional(Schema.String) }),
  Schema.Struct({ own: Prose }),
]);

export class AskOpened extends Schema.TaggedClass<AskOpened>()("ask_opened", { ask: AskId, ...stamp, from: ThreadId, ...AskText }) {}
export class AskAnswered extends Schema.TaggedClass<AskAnswered>()("ask_answered", { ask: AskId, ...stamp, answer: Answer }) {}
export class AskReopened extends Schema.TaggedClass<AskReopened>()("ask_reopened", { ask: AskId, ...stamp }) {}
export class AskWithdrawn extends Schema.TaggedClass<AskWithdrawn>()("ask_withdrawn", { ask: AskId, ...stamp, why: Prose }) {}

const withdrawn = { refusal: "AskWithdrawn" } as const;

export const Ask = Machine.make({
  name: "ask",
  key: "ask",
  states: ["open", "answered", "withdrawn"],
  start: { state: "open", by: "ask.open", event: "ask_opened" },
  moves: {
    answer: { from: ["open"], to: "answered", by: "ask.answer", event: "ask_answered", otherwise: { answered: { refusal: "AskAnswered" }, withdrawn } },
    reopen: { from: ["answered"], to: "open", by: "ask.reopen", event: "ask_reopened", otherwise: { open: "unchanged", withdrawn } },
    withdraw: { from: ["open"], to: "withdrawn", by: "ask.withdraw", event: "ask_withdrawn", otherwise: { answered: { refusal: "AskAnswered" }, withdrawn: "unchanged" } },
  },
});

export const askAllowed: Allowed = {
  ask_opened: ["agent"],
  ask_answered: ["person"],
  ask_reopened: ["person"],
  ask_withdrawn: ["agent"],
};
