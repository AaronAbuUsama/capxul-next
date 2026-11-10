/** The page of one task and of one milestone of the plan: the whole file, then everything the plan knows about it. */
import type { PlanBlocked, PlanLogRow, PlanMilestonePage, PlanSection, PlanTask, PlanTaskPage } from "#src/modules/site/types.ts";

import { chip, crumbs, esc, hrefTo, link, plural, prose, section, table } from "./html.ts";
import { markdown } from "./markdown.ts";
import { exitRow, taskState } from "./planParts.ts";

const PLAN = { label: "Plan", page: "plan", anchor: "" };

const sectionsHtml = (held: readonly PlanSection[]): string =>
  held.map((s) => `<section class="block"><h2>${esc(s.heading)}</h2>${markdown(s.body)}</section>`).join("");

const history = (held: readonly PlanLogRow[]): string =>
  held.length === 0 ? "" :
    section("history", "History", table(["When", "By", "Change", "About", "Commit"], held.map((l) =>
      `<tr><td class="muted nowrap">${esc(l.at.replace("T", " ").slice(0, 16))}</td><td>${esc(l.by)}</td><td class="mono">${esc(l.action)}</td>` +
      `<td>${prose(l.summary)}</td><td class="mono">${esc(l.commit)}</td></tr>`)), "From plan/log.jsonl: every change that named it.");

const taskList = (at: string, held: readonly PlanTask[]): string =>
  `<div class="rows">${held.map((t) =>
    `<div class="row"><a class="row-id plain" href="${esc(hrefTo(at, t.ref))}">${esc(t.title)}</a><span class="row-text">${taskState(t)} <span class="mono">${esc(t.id)}</span></span></div>`).join("")}</div>`;

const blocker = (at: string, b: PlanBlocked | null): string =>
  b === null ? "" :
    section("blocked", "What it is waiting for", `<p class="plan-claim">${b.who === "" ? "" : `<strong>${esc(b.who)}:</strong> `}${prose(b.need)}` +
      `${b.decisionRef === null ? "" : ` ${link(at, b.decisionRef, "ref")}`}</p>` +
      (b.inbox === null ? "" : `<p class="plan-claim">${link(at, { ...b.inbox, label: "Answer it on the Questions page" })}</p>`));

/**
 * Where a task's runs show: every attempt at it by the loop, newest first. The generator knows no run (they are working
 * data, and live); the page's script asks the loop's host and fills this in, and until it answers the block says so.
 */
const runsBlock = (taskId: string): string =>
  `<section class="block" id="runs-block" data-task="${esc(taskId)}"><h2 id="runs">Runs</h2>` +
  `<p class="caption">Every attempt at this task by the loop, newest first. Open one for its steps and each agent's conversation.</p>` +
  `<div class="rows" id="runs-rows" hidden></div>` +
  `<p class="note" id="runs-none">The loop's host is not answering, so this task's runs are not listed here. Start it with <code>pnpm loop serve</code>; the history below names the runs.</p></section>`;

export const task = (p: PlanTaskPage): string => {
  const t = p.task;
  return `<main class="page plan"><div class="main-col">${crumbs([link(p.id, PLAN), link(p.id, p.milestone.ref), esc(t.id)])}` +
    `<h1 class="title">${esc(t.title)}</h1><p class="plan-state">${taskState(t)} ${chip(p.milestone.id, "chip chip-strong")}` +
    `${p.pathPosition === null ? "" : ` <span class="muted">Step ${p.pathPosition} of ${p.pathLength} on the critical path.</span>`}</p>` +
    `${runsBlock(t.id)}${sectionsHtml(p.sections)}${blocker(p.id, p.blocker)}` +
    (p.task.droppedWhy === "" ? "" : section("dropped", "Why it was dropped", `<p class="plan-claim">${prose(p.task.droppedWhy)}</p>`)) +
    (p.needs.length === 0 ? "" : section("needs", "It needs", taskList(p.id, p.needs))) +
    (p.neededBy.length === 0 ? "" : section("needed-by", "Waiting on it", taskList(p.id, p.neededBy))) +
    (p.records.length === 0 ? "" : section("records", "Records it concerns", `<div class="rows">${p.records.map((r) =>
      `<div class="row">${link(p.id, r.ref, "row-id")}<span class="row-text">${plural(r.evals, "eval")} derived on it</span></div>`).join("")}</div>`)) +
    (t.evidence.length === 0 ? "" : section("evidence", "Evidence", `<ul class="plan-done">${t.evidence.map((e) => `<li><code class="path">${esc(e)}</code></li>`).join("")}</ul>`)) +
    `${history(p.history)}</div></main>`;
};

export const milestone = (p: PlanMilestonePage): string => {
  const m = p.milestone;
  return `<main class="page plan"><div class="main-col">${crumbs([link(p.id, PLAN), esc(m.id)])}<h1 class="title">${esc(m.title)}</h1>` +
    `<p class="plan-state">${chip(m.state === "current" ? "current" : m.state === "done" ? "done" : "to do", m.state === "current" ? "chip chip-blue" : "chip chip-quiet")} ` +
    `<span class="muted">${m.tasksDone} of ${m.tasksTotal} tasks done</span></p>${sectionsHtml(m.sections)}` +
    section("exit", "Exit lines", `<div class="rows">${m.exit.map(exitRow(p.id)).join("")}</div>`) +
    (m.evals === null ? "" : section("evals", "Concepts", `<p class="plan-claim">${m.evals.passing} of ${m.evals.total} evals pass in ` +
      `${m.concepts.map((c) => link(p.id, c, "ref")).join(" ")}.</p>`)) +
    section("tasks", "Its tasks", m.tasks.length === 0 ? `<p class="q-none">No task yet.</p>` : taskList(p.id, m.tasks)) +
    `${history(p.history)}</div></main>`;
};
