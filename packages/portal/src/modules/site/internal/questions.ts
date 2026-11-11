/** The Questions page: every decision that waits for an answer, with its options and the recommendation. */
import { keyOf, type AnyRecord } from "@capxul/blueprint-engine";

import type { Task } from "@capxul/plan";
import { waitsOnOwner } from "@capxul/plan";
import type { Question, QuestionsPage } from "../types.ts";
import { head, type Ctx } from "./context.ts";
import { refOf } from "./locate.ts";
import { objects, records, text } from "./values.ts";

export const HAND_WRITTEN = "blueprint and packages/portal/content/direction.ts";

export const questionOf = (ctx: Ctx, d: AnyRecord): Question => {
  const chosen = text(d["chosen"]);
  const affects = records(d["affects"]);
  const held = (ctx.input.plan?.plan.tasks ?? []).filter((t) => t.state === "blocked" && t.blockedBy !== undefined && "decision" in t.blockedBy && t.blockedBy.decision === d.id);
  return {
    kind: "decision", key: d.id, details: "", holdsUp: held.map((t) => ({ id: t.id, title: t.title, milestone: t.milestone })),
    id: d.id, ref: { label: d.id, page: "review", anchor: `q-${d.id}` }, title: text(d["title"]),
    question: text(d["question"]), concept: ctx.input.conceptOf.get(keyOf(d)) ?? "shared", holds: affects.length,
    chosen, why: text(d["why"]), source: text(d["source"]),
    options: objects(d["options"]).map((o) => ({ label: text(o["label"]), text: text(o["text"]), recommended: text(o["label"]) === chosen })),
    affects: affects.map(refOf),
  };
};

/** A task blocked on a need of the owner, as an inbox entry. */
const needOf = (ctx: Ctx, t: Task): Question => ({
  details: ctx.input.plan?.files.tasks[t.id] ?? "",
  kind: "need", key: `task-${t.id}`, holdsUp: [{ id: t.id, title: t.title, milestone: t.milestone }],
  id: t.id, ref: { label: t.id, page: "review", anchor: `q-task-${t.id}` }, title: t.title,
  question: t.blockedBy !== undefined && "need" in t.blockedBy ? t.blockedBy.need : "", concept: t.milestone, holds: 1,
  chosen: "", why: t.why, source: "", options: [], affects: [],
});

/** The tasks of the plan blocked on a need whose owner is the reviewer. */
const needs = (ctx: Ctx): readonly Task[] => {
  const owner = ctx.input.direction.settings.reviewer;
  return (ctx.input.plan?.plan.tasks ?? []).filter((t) => waitsOnOwner(t, owner, () => false));
};

/** Everything that waits on the owner, in one list: the blueprint's waiting decisions, then the plan's needs of his. */
export const inbox = (ctx: Ctx): readonly Question[] => [...ctx.waiting.map((d) => questionOf(ctx, d)), ...needs(ctx).map((t) => needOf(ctx, t))];

export const questions = (ctx: Ctx): QuestionsPage => {
  const { settings, questions: words } = ctx.input.direction;
  return {
    ...head("review", "Questions that need you", HAND_WRITTEN, null), type: "questions", commit: ctx.input.commit,
    lead: words.lead, repo: settings.repo, reviewer: settings.reviewer, issueLabel: settings.issueLabel,
    questions: inbox(ctx), steps: words.answerSteps,
  };
};
