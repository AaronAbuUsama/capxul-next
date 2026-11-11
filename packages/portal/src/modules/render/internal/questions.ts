/**
 * The Questions page: one article per waiting decision, in the order a person reads it: the question, the options as
 * cards, the recommendation with the first paragraph of its reasoning, and last the source. It reads as a plain list
 * without the script.
 */
import type { Question, QuestionsPage } from "#src/modules/site/types.ts";

import { chip, count, esc, hrefTo, link, plural, prose } from "./html.ts";
import { markdown } from "./markdown.ts";
import { fold } from "./parts.ts";
import { blocks, folded, paragraphs, rich, type Cites } from "./prose.ts";

const item = (q: Question): string =>
  `<a class="q-item" href="#${esc(q.ref.anchor)}" data-for="${esc(q.key)}"><span class="q-item-top"><span class="q-id">${esc(q.id)}</span>` +
  `<span class="q-status">Outstanding at build</span></span><span class="q-item-title">${prose(q.title)}</span></a>`;

/** One option as a card: its words first, readable, and its label as the small id an answer names. */
const option = (at: string, q: Question, o: Question["options"][number], cites: Cites): string =>
  `<label class="option"><input type="radio" name="option-${esc(q.id)}" value="${esc(o.label)}"${o.recommended ? " checked" : ""}>` +
  `<span class="option-body"><span class="option-top"><span class="option-label">${esc(o.label)}</span>` +
  `${o.recommended ? '<span class="badge">Recommended</span>' : ""}</span>` +
  `<span class="option-text">${paragraphs(o.text).map((part) => `<span class="para">${rich(at, part, cites)}</span>`).join("")}</span></span></label>`;

const holds = (at: string, q: Question): string =>
  q.affects.length === 0 ? "" :
    fold(`The ${plural(q.affects.length, "record")} this decision holds`,
      `<p class="held">${q.affects.map((r) => link(at, r, "ref")).join(" ")}</p>`);

/** The buttons, the box for an answer in your own words, and the panel that shows the answer before it is filed. */
const answering = (q: Question): string =>
  `<div class="actions js-only"><button type="button" disabled class="btn btn-blue" data-act="accept">Accept the recommendation</button>` +
  `<button type="button" disabled class="btn btn-line" data-act="change">Change it in my own words</button></div>` +
  `<div class="change" hidden><label class="change-label" for="change-${esc(q.key)}">What should it be instead?</label>` +
  `<textarea id="change-${esc(q.key)}" rows="4" maxlength="2000" placeholder="Say it the way you would say it out loud. An agent turns it into the record."></textarea>` +
  `<button type="button" disabled class="btn btn-ink" data-act="send">Send the change</button></div>`;

/** What an item holds up: the plan's tasks blocked on it. */
const heldUp = (q: Question): string =>
  q.holdsUp.length === 0 ? "" :
    `<p class="held-up">Holds up ${q.holdsUp.map((t) => `${esc(t.title)} <span class="mono">(${esc(t.id)}, ${esc(t.milestone)})</span>`).join(", ")}.</p>`;

/** Where an answer is shown once it is saved, and the line that says why a saved answer is not offered. */
const saved = `<div class="saved" hidden><p class="saved-text"></p><button type="button" disabled class="btn btn-line" data-act="undo">Undo</button></div>` +
  `<p class="fallback-note" hidden>Answers cannot be saved from this page: it is not served by <code>pnpm portal:serve</code>, so your answer is shown as an issue to file on GitHub instead.</p>` +
  `<p class="q-error" role="alert" hidden></p>`;

const filing = `<div class="answer" hidden><p class="answer-title">Your answer, ready to file</p>` +
  `<p class="answer-text">This is exactly what is filed. Nothing is saved from this page: the button opens a GitHub issue with this answer in it, and you submit it there.</p>` +
  `<figure class="code"><figcaption class="code-label">JSON · your answer, as it is filed</figcaption><pre class="code-body"><code class="answer-json"></code></pre></figure><a class="btn btn-blue answer-link" target="_blank" rel="noopener">Open the GitHub issue</a></div>`;

const attrs = (q: Question): string =>
  `id="${esc(q.ref.anchor)}" data-decision="${esc(q.key)}" data-kind="${q.kind}" data-target="${esc(q.id)}" data-chosen="${esc(q.chosen)}"`;

const meta = (p: QuestionsPage, q: Question, i: number): string =>
  `<p class="q-meta">${chip(q.kind === "need" ? "A need" : "A decision", q.kind === "need" ? "chip chip-orange" : "chip chip-blue")}` +
  `${q.kind === "need" ? `<span class="mono">${esc(q.id)}</span>` : link(p.id, { label: q.id, page: `decision/${q.id}`, anchor: "" }, "mono")}<span class="pill">${esc(q.concept)}</span>` +
  `${q.kind === "need" ? "" : `<span>holds ${plural(q.holds, "record")}</span>`}<span>question ${i + 1} of ${count(p.questions.length)}</span></p>`;

/** A task of the plan blocked on something only the owner can do or say. */
const needArticle = (p: QuestionsPage, q: Question, i: number, cites: Cites): string =>
  `<article class="q" ${attrs(q)}>${meta(p, q, i)}<h2>${prose(q.title)}</h2><p class="eyebrow eyebrow-muted">What is needed</p>` +
  `${blocks(p.id, q.question, cites, "prose q-text")}<p class="eyebrow eyebrow-muted">Why it is needed</p>${blocks(p.id, q.why, cites, "prose")}` +
  (q.details === "" ? "" : fold("The whole task: what is asked, why, and when it is done", markdown(q.details))) +
  `<div class="actions js-only"><button type="button" disabled class="btn btn-blue" data-act="done">I've done this</button>` +
  `<button type="button" disabled class="btn btn-line" data-act="change">Tell the coordinator something</button></div>` +
  `<div class="change" hidden><label class="change-label" for="change-${esc(q.key)}">What should the coordinator know? For example the subdomain.</label>` +
  `<textarea id="change-${esc(q.key)}" rows="4" maxlength="2000"></textarea><button type="button" disabled class="btn btn-ink" data-act="send">Send</button></div>` +
  `${saved}${filing}</article>`;

const article = (p: QuestionsPage, q: Question, i: number, cites: Cites): string =>
  q.kind === "need" ? needArticle(p, q, i, cites) :
  `<article class="q" ${attrs(q)}>${meta(p, q, i)}` +
  `<h2>${prose(q.title)}</h2>${heldUp(q)}<p class="eyebrow eyebrow-muted">The question</p>${blocks(p.id, q.question, cites, "prose q-text")}` +
  `<p class="eyebrow eyebrow-muted">The options</p><div class="options">${q.options.map((o) => option(p.id, q, o, cites)).join("")}</div>` +
  `<div class="why"><p class="why-title">The blueprint recommends <code>${esc(q.chosen)}</code></p>${folded(p.id, q.why, cites, "The rest of the reasoning")}` +
  (q.source === "" ? "" : `<p class="why-source">Source: ${rich(p.id, q.source, cites)}</p>`) + `</div>` +
  `${holds(p.id, q)}${answering(q)}${saved}${filing}</article>`;

const empty = `<p class="q-none">No question is waiting for you. Every decision in the blueprint is made.</p>`;

export const questions = (p: QuestionsPage, cites: Cites): string =>
  `<main class="page" data-commit="${esc(p.commit)}" data-repo="${esc(p.repo)}" data-reviewer="${esc(p.reviewer)}" data-label="${esc(p.issueLabel)}">` +
  `<div class="q-head"><div><h1 class="title-wide">${esc(p.title)}</h1><p class="q-lead">${prose(p.lead)}</p></div>` +
  `<p class="q-count"><span class="q-count-big">${count(p.questions.length)}</span> waiting</p></div>` +
  `<p class="q-serving-mode" role="status">Checking serving mode. Answer buttons stay disabled until the destination is known. Without JavaScript, nothing is saved here; open a GitHub issue to answer.</p>` +
  `<p class="q-answer-counts" aria-live="polite">${count(p.questions.length)} waiting for you</p>` +
  (p.questions.length === 0 ? empty :
    `<div class="master"><nav class="q-list" aria-label="Questions">${p.questions.map(item).join("")}</nav>` +
    `<div class="q-detail">${p.questions.map((q, i) => article(p, q, i, cites)).join("")}</div></div>` +
    `<noscript><p class="note">Without JavaScript this page is a list to read. To answer, open an issue in ` +
    `<a href="${esc(p.repo)}/issues">the repository</a> that names the item and your answer.</p></noscript>`) +
  `<section class="does"><h2 id="what-your-answer-does">What your answer does</h2><p>These steps describe local saving only. In GitHub issue mode, submit the issue first; preparing it here does not save an answer.</p><ol class="steps">` +
  p.steps.map((s) => `<li><span class="step-title">${esc(s.title)}</span><span class="step-text">${prose(s.text)}</span></li>`).join("") +
  `</ol></section><p class="all-kinds">Every other decision is on its concept's page, or in ` +
  `<a href="${esc(hrefTo(p.id, { label: "", page: "docs/decisions", anchor: "" }))}">the decisions catalogue</a>.</p></main>`;
