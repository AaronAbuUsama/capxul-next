/** The Questions page: every decision that waits for an answer, with its options and the recommendation. */
import { keyOf, type AnyRecord } from "@capxul/book";

import type { Question, QuestionsPage } from "../types.ts";
import { head, type Ctx } from "./context.ts";
import { refOf } from "./locate.ts";
import { objects, records, text } from "./values.ts";

export const HAND_WRITTEN = "books/target and packages/portal/content/direction.ts";

export const questionOf = (ctx: Ctx, d: AnyRecord): Question => {
  const chosen = text(d["chosen"]);
  const affects = records(d["affects"]);
  return {
    id: d.id, ref: { label: d.id, page: "review", anchor: `q-${d.id}` }, title: text(d["title"]),
    question: text(d["question"]), concept: ctx.input.conceptOf.get(keyOf(d)) ?? "shared", holds: affects.length,
    chosen, why: text(d["why"]), source: text(d["source"]),
    options: objects(d["options"]).map((o) => ({ label: text(o["label"]), text: text(o["text"]), recommended: text(o["label"]) === chosen })),
    affects: affects.map(refOf),
  };
};

export const questions = (ctx: Ctx): QuestionsPage => {
  const { settings, questions: words } = ctx.input.direction;
  return {
    ...head("review", "Questions that need you", HAND_WRITTEN, null), type: "questions", commit: ctx.input.commit,
    lead: words.lead, repo: settings.repo, reviewer: settings.reviewer, issueLabel: settings.issueLabel,
    questions: ctx.waiting.map((d) => questionOf(ctx, d)), steps: words.answerSteps,
  };
};
