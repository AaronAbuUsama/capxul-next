/**
 * The Plan page, written to be read from the top: where we are going, where we are, what happens next, what is needed
 * from the owner, the whole plan by milestone, how the work runs, what is not in this goal, and the recent changes.
 */
import type { PlanMilestone, PlanPage, PlanSection, PlanStep, PlanTask } from "#src/modules/site/types.ts";

import { chip, esc, hrefTo, link, plural, prose, section, table } from "./html.ts";
import { markdown } from "./markdown.ts";
import { exitRow, taskState } from "./planParts.ts";

const REVIEW = { label: "", page: "review", anchor: "" };
const named = (sections: readonly PlanSection[], ...headings: string[]): readonly PlanSection[] =>
  sections.filter((s) => headings.some((h) => h.toLowerCase() === s.heading.toLowerCase()));

/** Outline sections as reading text: each its own heading and Markdown. */
const prosey = (id: string, s: PlanSection, level: "h2" | "h3" = "h2"): string =>
  `<section class="block"><${level} id="${esc(id)}">${esc(s.heading)}</${level}>${markdown(s.body)}</section>`;

const going = (p: PlanPage): string => named(p.outline, "Where we are going", "What this goal is").map((s, i) => prosey(i === 0 ? "going" : "goal", s)).join("");

/** One milestone in the row: its state, tasks done of total, and the first sentence of what it delivers. */
const milestoneCell = (m: PlanMilestone): string =>
  `<a class="plan-ms-cell plan-ms-${esc(m.state)}" href="${esc(hrefTo("plan", m.ref))}"><span class="plan-ms-top"><span class="mono">${esc(m.id)}</span>` +
  `${m.state === "current" ? chip("current", "chip chip-blue") : m.state === "done" ? chip("done", "chip chip-quiet") : ""}</span>` +
  `<span class="plan-ms-name">${esc(m.title)}</span><span class="plan-ms-count">${m.tasksDone} of ${m.tasksTotal} tasks done</span>` +
  `<span class="plan-ms-line">${prose(m.delivers)}</span></a>`;

const where = (p: PlanPage): string =>
  `<section class="block"><h2 id="where">Where we are</h2>` +
  (p.note ? `<div class="banner plan-note"><div class="banner-words"><p class="banner-title">${prose(p.note.text)}</p>` +
    `<p class="banner-text">${esc(p.note.by)}, ${esc(p.note.date)}</p></div></div>` : "") +
  `<div class="plan-ms-row">${p.milestones.map(milestoneCell).join("")}</div></section>`;

const step = (s: PlanStep): string =>
  `<li class="plan-step"><div class="plan-step-head"><span class="plan-n">${s.n}</span><a class="plan-step-title" href="${esc(hrefTo("plan", s.task.ref))}">${esc(s.task.title)}</a>` +
  `<span class="plan-step-state">${taskState(s.task)}</span></div>` +
  (s.what === "" ? "" : `<p class="plan-step-what">${prose(s.what)}</p>`) +
  (s.doneWhen.length === 0 ? "" : `<p class="eyebrow eyebrow-muted">Done when</p><ul class="plan-done">${s.doneWhen.map((d) => `<li>${prose(d)}</li>`).join("")}</ul>`) + `</li>`;

const next = (p: PlanPage): string => {
  const pa = p.path;
  if (pa === null || pa.steps.length === 0) return "";
  return `<section class="block"><h2 id="next">What happens next</h2>` +
    `<p class="caption">The critical path through ${esc(pa.milestone)}, in the order the coordinator wrote it. It is written, never computed.</p>` +
    `<ol class="plan-path">${pa.steps.map(step).join("")}</ol>` +
    `<div class="why"><p class="why-title">Why this order, written ${esc(pa.written)}</p><p class="prose">${prose(pa.why)}</p></div></section>`;
};

/** One line: how many things wait on the owner, which, and the way to answer them. Each links to its entry on Questions. */
const needs = (p: PlanPage): string => {
  const waiting = p.blocked.filter((b) => b.waitsOnOwner && b.inbox !== null);
  return `<section class="block"><h2 id="you">What I need from you</h2><p class="plan-claim">` +
    (p.inbox === 0 ? "Nothing waits on you." :
      `${plural(p.inbox, "thing waits", "things wait")} on you` +
      `${waiting.length === 0 ? "" : `: ${waiting.map((b) => link(p.id, { ...(b.inbox as NonNullable<typeof b.inbox>), label: b.task.title })).join(", ")}`}. ` +
      `<a href="${esc(hrefTo(p.id, REVIEW))}">Answer ${p.inbox === 1 ? "it" : "them"} on the Questions page.</a>`) + `</p></section>`;
};

const taskRow = (t: PlanTask): string =>
  `<tr class="plan-task-${esc(t.state)}"><td><a href="${esc(hrefTo("plan", t.ref))}">${esc(t.title)}</a><span class="cell-sub">${prose(t.what)}</span></td>` +
  `<td>${taskState(t)}</td><td class="mono">${esc(t.thread)}</td></tr>`;

const milestone = (p: PlanPage, m: PlanMilestone): string => {
  const sec = named(m.sections, "What it delivers", "How we know it is done");
  const exits = m.repeatsGoal && p.goal !== null
    ? `<h3>The goal's exit lines</h3><p class="caption">${m.exit.filter((e) => e.met).length} of ${p.goal.exit.length} met.</p><div class="rows">${p.goal.exit.map(exitRow(p.id)).join("")}</div>` : "";
  return `<div class="plan-whole plan-ms-${esc(m.state)}" id="ms-${esc(m.id)}"><div class="col-head"><h3><a href="${esc(hrefTo("plan", m.ref))}">${esc(m.id)}: ${esc(m.title)}</a></h3>` +
    `<span class="caption">${m.state === "current" ? "current · " : ""}${m.tasksDone} of ${m.tasksTotal} tasks done</span></div>` +
    sec.map((s) => `<p class="eyebrow eyebrow-muted">${esc(s.heading)}</p>${markdown(s.body)}`).join("") + exits +
    (m.tasks.length === 0 ? "" : `<p class="eyebrow eyebrow-muted">Its tasks</p>${table(["Task", "State", "Thread"], m.tasks.map(taskRow), "plan-tasks")}`) + `</div>`;
};

const whole = (p: PlanPage): string =>
  `<section class="block"><h2 id="whole">The whole plan</h2><p class="caption">Each milestone with what it delivers and how we know it is done, then its tasks.</p>` +
  `<div class="plan-wholes">${p.milestones.map((m) => milestone(p, m)).join("")}</div></section>`;

const problems = (p: PlanPage): string =>
  p.problems.length === 0 ? "" :
    section("check", "What the plan check says", `<ul class="findings">${p.problems.map((x) => `<li>${chip(x.at, "chip chip-orange")}<span>${prose(x.why)}</span></li>`).join("")}</ul>`,
      "The check reports; it never reorders or rewrites the plan.");

const recent = (p: PlanPage): string =>
  p.log.length === 0 ? "" :
    section("log", "Recent changes", table(["When", "By", "Change", "About", "Commit"], p.log.map((l) =>
      `<tr><td class="muted nowrap">${esc(l.at.replace("T", " ").slice(0, 16))}</td><td>${esc(l.by)}</td><td class="mono">${esc(l.action)}</td>` +
      `<td>${prose(l.summary)}</td><td class="mono">${esc(l.commit)}</td></tr>`)),
    "Every change is one line of plan/log.jsonl, which is never rewritten.");

export const plan = (p: PlanPage): string =>
  !p.present
    ? `<main class="page"><p class="eyebrow eyebrow-muted">Plan</p><h1 class="title">Plan</h1><p class="q-none">There is no plan yet: <code>plan/plan.json</code> is absent. ` +
      `The coordinator writes it with <code>pnpm plan</code>.</p></main>`
    : `<main class="page plan"><p class="eyebrow">Plan</p><h1 class="title">Plan</h1><p class="lead">${esc(p.goal?.title ?? "")}</p>` +
      `${going(p)}${where(p)}${next(p)}${problems(p)}${needs(p)}${whole(p)}` +
      `${named(p.outline, "How the work runs", "What is not in this goal").map((s, i) => prosey(i === 0 ? "runs" : "not", s)).join("")}${recent(p)}</main>`;

