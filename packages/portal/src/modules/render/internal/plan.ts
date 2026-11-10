/**
 * The Plan page: the coordinator's latest note, the goal, the milestones, the critical path in the coordinator's order
 * and words, what is blocked with its context, the tasks by state with their threads, and the log. It reads as a plain
 * page without the script.
 */
import type { PlanBlocked, PlanExit, PlanMilestone, PlanPage, PlanTask, Question } from "#src/modules/site/types.ts";

import { chip, count, esc, hrefTo, link, plural, prose, section, table } from "./html.ts";
import { fold } from "./parts.ts";
import { blocks, folded, rich, type Cites } from "./prose.ts";

const REVIEW = { label: "", page: "review", anchor: "" };

const exitRow = (e: PlanExit): string =>
  `<div class="row"><span class="plan-exit">${chip(e.met ? "met" : "open", e.met ? "chip chip-blue" : "chip chip-quiet")}` +
  `<span class="mono">${esc(e.id)}</span></span><span class="plan-claim">${prose(e.claim)}</span>` +
  (e.evidence === "" ? "" : `<span class="row-text">Evidence: ${prose(e.evidence)}</span>`) + `</div>`;

/** The page title, the goal's title as one line under it, and the coordinator's latest note. */
const hero = (p: PlanPage): string =>
  `<p class="eyebrow">Plan</p><h1 class="title">Plan</h1><p class="lead">${esc(p.goal?.title ?? "")}</p>` +
  (p.note ? `<div class="banner plan-note"><div class="banner-words"><p class="banner-title">${prose(p.note.text)}</p>` +
    `<p class="banner-text">${esc(p.note.by)}, ${esc(p.note.date)}</p></div></div>` : "");

const goal = (p: PlanPage): string =>
  p.goal === null ? "" :
    section("goal", "The goal", `<div class="rows">${p.goal.exit.map(exitRow).join("")}</div>`, p.goal.why);

const milestone = (m: PlanMilestone, goalExits: number): string => {
  const met = m.exit.filter((e) => e.met).length;
  const t = m.tasks;
  const exits = m.repeatsGoal
    ? `<p class="plan-claim">The goal's exit lines: ${met} of ${goalExits} met.</p>`
    : m.state === "current"
      ? `<div class="rows">${m.exit.map(exitRow).join("")}</div>`
      : fold(`${plural(m.exit.length, "exit line")}, ${met} met`, `<div class="rows">${m.exit.map(exitRow).join("")}</div>`);
  return `<div class="plan-ms plan-ms-${esc(m.state)}" id="ms-${esc(m.id)}"><div class="climb-top"><span class="climb-step mono">${esc(m.id)}</span>` +
    `<span class="climb-status ${m.state === "current" ? "tone-blue" : "tone-grey"}">${m.state === "current" ? "current" : m.state === "done" ? "done" : "to do"}</span></div>` +
    `<h3>${esc(m.title)}</h3><p class="plan-ms-goal">${prose(m.goal)}</p>` +
    `<p class="climb-sub">${plural(t.todo + t.doing + t.blocked + t.done, "task")}: ` +
    `${t.done} done, ${t.doing} doing, ${t.blocked} blocked, ${t.todo} to do</p>` +
    (m.evals === null ? "" : `<p class="climb-sub">${count(m.evals.passing)} of ${count(m.evals.total)} evals pass in ${m.concepts.length} concepts</p>`) +
    exits + `</div>`;
};

const milestones = (p: PlanPage): string =>
  section("milestones", "The milestones, in order", `<div class="plan-list">${p.milestones.map((m) => milestone(m, p.goal?.exit.length ?? 0)).join("")}</div>`);

const taskName = (t: PlanTask): string => `<span class="row-id plain">${esc(t.title)}</span><span class="row-text"><span class="mono">${esc(t.id)}</span> · ${esc(t.milestone)}</span>`;

const path = (p: PlanPage): string => {
  const pa = p.path;
  if (pa === null || pa.steps.length === 0) return "";
  const steps = pa.steps.map((t, i) =>
    `<li class="plan-step plan-${esc(t.state)}"><span class="plan-n">${i + 1}</span><span class="plan-step-body">${taskName(t)}</span>` +
    `<span class="plan-step-state">${chip(t.state, t.state === "blocked" ? "chip chip-orange" : "chip chip-quiet")}${t.thread === "" ? "" : ` <span class="mono">${esc(t.thread)}</span>`}</span></li>`).join("");
  return section("path", `The critical path through ${pa.milestone}`, `<ol class="plan-path">${steps}</ol>` +
    `<div class="why"><p class="why-title">Why this order, in the coordinator's words, written ${esc(pa.written)}</p><p class="prose">${prose(pa.why)}</p></div>`,
  "Written by the coordinator, never computed from the tasks. Its order is the order of the work.");
};

const options = (at: string, q: Question, cites: Cites): string =>
  `<div class="plan-options">${q.options.map((o) =>
    `<div class="plan-option${o.recommended ? " is-recommended" : ""}"><span class="option-top"><span class="option-label">${esc(o.label)}</span>` +
    `${o.recommended ? '<span class="badge">Recommended</span>' : ""}</span><span class="option-text">${rich(at, o.text, cites)}</span></div>`).join("")}</div>`;

const blockedCard = (p: PlanPage, b: PlanBlocked, cites: Cites): string => {
  const q = b.decision;
  const head = `<div class="q-meta"><span class="mono">${esc(b.task.id)}</span><span class="pill">${esc(b.task.milestone)}</span>` +
    `${b.waitsOnOwner ? chip(`waits on ${p.owner}`, "chip chip-orange") : ""}</div><h3>${esc(b.task.title)}</h3><p class="plan-why">${prose(b.task.why)}</p>`;
  if (q !== null && b.decisionRef !== null) {
    const where = b.decisionWaits
      ? `${link(p.id, b.decisionRef, "mono")} on the Questions page`
      : `${link(p.id, b.decisionRef, "mono")}, already decided`;
    return `<article class="plan-block" id="blocked-${esc(b.task.id)}">${head}<p class="eyebrow eyebrow-muted">Blocked on a decision</p>` +
      `<p class="plan-claim">${prose(q.title)} (${where})</p>${blocks(p.id, q.question, cites, "prose")}${options(p.id, q, cites)}` +
      `<div class="why"><p class="why-title">The book recommends <code>${esc(q.chosen)}</code></p>${folded(p.id, q.why, cites, "The rest of the reasoning")}</div></article>`;
  }
  return `<article class="plan-block" id="blocked-${esc(b.task.id)}">${head}<p class="eyebrow eyebrow-muted">Blocked on a need</p>` +
    `<p class="plan-claim">${b.who === "" ? "" : `<strong>${esc(b.who)}:</strong> `}${prose(b.need)}</p></article>`;
};

/** Every blocked task in full, those that wait on the owner first. */
const blocked = (p: PlanPage, cites: Cites): string => {
  const ordered = [...p.blocked.filter((b) => b.waitsOnOwner), ...p.blocked.filter((b) => !b.waitsOnOwner)];
  const title = p.waitsOnOwner > 0 ? `Waiting for ${p.owner === "aaron" ? "Aaron" : p.owner}: ${p.waitsOnOwner}` : "What is blocked";
  return ordered.length === 0
    ? section("blocked", "What is blocked", `<p class="q-none">Nothing is blocked.</p>`)
    : section("blocked", title, `<div class="plan-blocks">${ordered.map((b) => blockedCard(p, b, cites)).join("")}</div>`,
      `${plural(p.blocked.length, "task is", "tasks are")} blocked, each with what it waits for. A decision is shown with its question, its options and the book's recommendation.`);
};

const taskTable = (held: readonly PlanTask[]): string =>
  table(["Task", "Milestone", "Thread", "Updated"], held.map((t) =>
    `<tr id="task-${esc(t.id)}"><td>${esc(t.title)}<span class="cell-sub mono">${esc(t.id)}${t.needs.length ? ` · needs ${esc(t.needs.join(", "))}` : ""}</span></td>` +
    `<td class="mono">${esc(t.milestone)}</td><td class="mono">${esc(t.thread)}</td><td class="muted">${esc(t.updated)}</td></tr>`));

const inProgress = (p: PlanPage): string => {
  const doing = p.groups.find((g) => g.state === "doing")?.tasks ?? [];
  return doing.length === 0 ? "" : section("doing", "In progress", taskTable(doing), "Each with the thread working on it.");
};

/** The rest, by state; what is blocked and what is in progress are above. */
const tasks = (p: PlanPage): string =>
  section("tasks", "The other tasks", p.groups.filter((g) => g.state !== "doing" && g.state !== "blocked" && g.tasks.length > 0).map((g) =>
    g.state === "todo"
      ? `<div class="sub-block"><div class="col-head"><h3>${esc(g.title)}</h3><span class="caption">${plural(g.tasks.length, "task")}</span></div>${taskTable(g.tasks)}</div>`
      : fold(`${g.title}, ${plural(g.tasks.length, "task")}`, taskTable(g.tasks))).join(""));

const log = (p: PlanPage): string =>
  p.log.length === 0 ? "" :
    section("log", "The last changes", table(["When", "By", "Change", "About", "Commit"], p.log.map((l) =>
      `<tr><td class="muted nowrap">${esc(l.at.replace("T", " ").slice(0, 16))}</td><td>${esc(l.by)}</td><td class="mono">${esc(l.action)}</td>` +
      `<td>${prose(l.summary)}</td><td class="mono">${esc(l.commit)}</td></tr>`)),
    "Every change is one line of plan/log.jsonl, which is never rewritten.");

const problems = (p: PlanPage): string =>
  p.problems.length === 0 ? "" :
    section("check", "What the plan check says", `<ul class="findings">${p.problems.map((x) => `<li>${chip(x.at, "chip chip-orange")}<span>${prose(x.why)}</span></li>`).join("")}</ul>`,
      "The check reports; it never reorders or rewrites the plan.");

export const plan = (p: PlanPage, cites: Cites): string =>
  !p.present
    ? `<main class="page"><p class="eyebrow eyebrow-muted">Plan</p><h1 class="title">Plan</h1><p class="q-none">There is no plan yet: <code>plan/plan.json</code> is absent. ` +
      `The coordinator writes it with <code>pnpm plan</code>.</p></main>`
    : `<main class="page">${hero(p)}${blocked(p, cites)}${path(p)}${problems(p)}${inProgress(p)}${goal(p)}${milestones(p)}${tasks(p)}${log(p)}` +
      `<p class="all-kinds">This page is read from <code>plan/plan.json</code>; the coordinator changes it with <code>pnpm plan</code>. Questions for you are on ` +
      `<a href="${esc(hrefTo(p.id, REVIEW))}">the Questions page</a>.</p></main>`;
