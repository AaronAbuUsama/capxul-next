/** The Overview: where the book stands, what waits for an answer, what the book holds, and the concepts. */
import type { ClimbCard, ConceptCard, OverviewPage, Question, Ref, Verdict } from "#src/modules/site/types.ts";

import { ARROW, chip, count, esc, hrefTo, link, plural, prose } from "./html.ts";
import { findings, fold } from "./parts.ts";
import { tiles } from "./tables.ts";

const REVIEW: Ref = { label: "", page: "review", anchor: "" };
/** How many waiting questions the Overview lists before it points at the Questions page. */
const SHOWN = 4;

export const VERDICT: Readonly<Record<Verdict, string>> = {
  none: "no verdict", core: "Core", frappe: "Frappe-owned", dropped: "dropped",
};

const hero = (p: OverviewPage): string => {
  const n = p.waiting.length;
  const needs = n === 0
    ? `<p class="needs-title">No question is waiting for your answer</p>`
    : `<p class="needs-title">${plural(n, "question is", "questions are")} waiting for your answer</p>` +
      `<p class="needs-text">${prose(p.needsYou)}</p>` +
      `<a class="btn btn-orange" href="${esc(hrefTo(p.id, REVIEW))}">Answer the questions ${ARROW}</a>`;
  return `<section class="hero"><div class="hero-main"><p class="eyebrow">${esc(p.hero.eyebrow)}</p>` +
    `<h1 class="display">${esc(p.hero.title)}</h1><p class="lead">${prose(p.hero.lead)}</p><p class="sub">${prose(p.hero.sub)}</p></div>` +
    `<aside class="needs"><p class="eyebrow eyebrow-orange">Needs you</p>${needs}</aside></section>`;
};

const climbCard = (c: ClimbCard, i: number): string =>
  `<div class="climb-card"><div class="climb-top"><span class="climb-step">${i + 1}. ${esc(c.step)}</span>` +
  `<span class="climb-status tone-${c.tone}">${esc(c.status)}</span></div>` +
  `<p class="climb-big">${esc(c.big)}</p><p class="climb-sub">${esc(c.sub)}</p><div class="bar bar-${c.bar}"><i></i></div></div>`;

const climb = (p: OverviewPage): string =>
  `<section class="block"><h2 id="climb">The climb</h2><div class="climb">${p.climb.map(climbCard).join("")}</div>` +
  `<div class="banner"><div class="banner-words"><p class="banner-title">${prose(p.banner.title)}</p>` +
  `<p class="banner-text">${prose(p.banner.text)}</p></div>` +
  `<div class="banner-count"><span class="banner-big">${p.verdicts.given} of ${p.verdicts.of}</span>` +
  `<span class="banner-sub">concepts have a verdict</span></div></div></section>`;

const waitingRow = (at: string, q: Question): string =>
  `<a class="wait-row" href="${esc(hrefTo(at, q.ref))}"><span class="wait-title">${prose(q.title)}</span>` +
  `<span class="wait-meta"><span class="mono">${esc(q.id)}</span><span>recommended: <span class="mono">${esc(q.chosen)}</span></span>` +
  `<span>holds ${plural(q.holds, "record")}</span></span></a>`;

const waiting = (p: OverviewPage): string => {
  const n = p.waiting.length;
  const rows = p.waiting.slice(0, SHOWN).map((q) => waitingRow(p.id, q)).join("");
  const more = n > SHOWN ? `<p class="wait-more">${count(n - SHOWN)} more on the Questions page.</p>` : "";
  const body = n === 0 ? `<div class="rows"><p class="wait-more">Nothing waits for you.</p></div>` : `<div class="rows">${rows}${more}</div>`;
  return `<section class="col col-wide"><div class="col-head"><h2 id="waiting">Waiting for you</h2>` +
    (n === 0 ? "" : `<a href="${esc(hrefTo(p.id, REVIEW))}">All ${plural(n, "question")}</a>`) + `</div>${body}</section>`;
};

const holds = (p: OverviewPage): string =>
  `<section class="col"><div class="col-head"><h2 id="holds">What the book holds</h2>` +
  `<span class="caption">Each count opens its list</span></div>${tiles(p.id, p.holds)}</section>`;

const conceptCard = (at: string, c: ConceptCard): string =>
  `<a class="concept-card" href="${esc(hrefTo(at, c.ref))}"><span class="concept-top"><span class="concept-name">${esc(c.title)}</span>` +
  `${chip(VERDICT[c.verdict], c.verdict === "none" ? "chip chip-quiet" : "chip chip-blue")}</span>` +
  `<span class="concept-sub">${plural(c.operations, "operation")}, ${plural(c.decisions, "decision")}</span></a>`;

const concepts = (p: OverviewPage): string =>
  `<section class="block"><div class="col-head"><h2 id="concepts">The ${count(p.concepts.length)} concepts</h2>` +
  `<span class="caption">Operations, decisions, and the re-cut verdict</span></div>` +
  `<div class="cards">${p.concepts.map((c) => conceptCard(p.id, c)).join("")}</div></section>`;

/** What the book itself says is unfinished: problems stop the build, gaps are named and waiting. */
const unfinished = (p: OverviewPage): string => {
  const rows = (held: OverviewPage["gaps"]): string =>
    findings(held.map((f) => ({ ...f, detail: `\`${f.record}\`: ${f.detail}` })));
  const parts = [
    p.problems.length > 0 ? fold(plural(p.problems.length, "problem"), rows(p.problems)) : "",
    p.gaps.length > 0 ? fold(`${plural(p.gaps.length, "gap")} the book names in itself`, rows(p.gaps)) : "",
  ].join("");
  return parts === "" ? "" : `<section class="block"><h2 id="unfinished">What the book still lacks</h2>${parts}</section>`;
};

/** The coordinator's latest note, and the way to the plan. */
const planBlock = (p: OverviewPage): string =>
  p.planNote === null ? "" :
    `<section class="block"><div class="col-head"><h2 id="plan">Where the plan is</h2>` +
    `<a href="${esc(hrefTo(p.id, { label: "", page: "plan", anchor: "" }))}">The whole plan ${ARROW}</a></div>` +
    `<div class="banner"><div class="banner-words"><p class="banner-title">${prose(p.planNote.text)}</p>` +
    `<p class="banner-text">The coordinator, ${esc(p.planNote.date)}</p></div></div></section>`;

export const overview = (p: OverviewPage): string =>
  `<main class="page">${hero(p)}${planBlock(p)}${climb(p)}<div class="cols">${waiting(p)}${holds(p)}</div>${concepts(p)}${unfinished(p)}` +
  `<p class="all-kinds">Every record has a page. Start from a concept, or from ` +
  `${link(p.id, { label: "Docs", page: "docs", anchor: "" })} for the commands and the errors, or ` +
  `${link(p.id, { label: "Build", page: "build", anchor: "" })} for where each operation stands.</p></main>`;
