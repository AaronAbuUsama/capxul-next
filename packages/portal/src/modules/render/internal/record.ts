/** Any other record's page: its fields, the parts it owns, what it links to, what links to it, its evals. */
import type { ChildSection, RecordPage } from "#src/modules/site/types.ts";

import { chip, crumbs, esc, link, plural, section } from "./html.ts";
import { forAgents } from "./operation.ts";
import { impactView } from "./impact.ts";
import { briefRows, evalsFold, findings, fold, linkGroups } from "./parts.ts";
import { blocks, type Cites } from "./prose.ts";
import { keyValues, value } from "./value.ts";

const child = (at: string, c: ChildSection, cites: Cites): string =>
  `<section class="child" id="${esc(c.anchor)}"><h3><span class="child-kind">${esc(c.kind)}</span> <span class="mono">${esc(c.name)}</span></h3>` +
  `${value(at, c.value, cites)}${findings(c.gaps)}${linkGroups(at, c.linkedBy)}${c.evals.length === 0 ? "" : evalsFold(c.evals)}</section>`;

const parts = (p: RecordPage, cites: Cites): string =>
  p.children.length === 0 ? "" :
    `<section class="block"><h2 id="parts">Its parts</h2><p class="caption">${plural(p.children.length, "part")}: each has its own anchor on this page.</p>` +
    `${p.children.map((c) => child(p.id, c, cites)).join("")}</section>`;

const waits = (p: RecordPage): string =>
  p.waits ? `<p class="waits">${chip("Waiting for you", "chip chip-solid")}<span>This decision's recorded choice stands until you answer.</span>${link(p.id, { ...p.waits, label: "Answer it" })}</p>` : "";

const onPage = (p: RecordPage): string =>
  p.children.length === 0 ? "" :
    `<div class="side-card"><p class="eyebrow eyebrow-muted">On this page</p><ul class="side-parts">` +
    p.children.map((c) => `<li><a class="mono" href="#${esc(c.anchor)}">${esc(c.name)}</a></li>`).join("") + `</ul></div>`;

export const record = (p: RecordPage, cites: Cites): string => {
  const at = p.id;
  const trail = p.concept
    ? [link(at, { label: "Concepts", page: "index", anchor: "concepts" }), link(at, p.concept), esc(p.kind), esc(p.title)]
    : [link(at, { label: "Docs", page: "docs", anchor: "" }), esc(p.kind), esc(p.title)];
  return `<main class="page with-side"><div class="main-col">${crumbs(trail)}` +
    `<p class="eyebrow eyebrow-muted">${esc(p.kind)}</p><h1 class="title">${esc(p.title)}</h1><p class="record-key mono">${esc(p.recordKey)}</p>` +
    blocks(at, p.about, cites, "prose lead-prose") + waits(p) +
    section("fields", "What the record says", p.fields.length === 0 ? "" : keyValues(at, p.fields, cites)) + parts(p, cites) +
    section("links-out", "What it links to", linkGroups(at, p.linksOut)) +
    section("linked-by", "What links to it", linkGroups(at, p.linkedBy)) +
    impactView(at, p.impact) +
    section("evals", "Evals", p.evals.length === 0 ? "" : evalsFold(p.evals), `${plural(p.evals.length, "eval")} on this record.${p.evals.some((e) => e.verdict !== "not_run") ? "" : " None has run."}`) +
    section("gaps", "What the blueprint still lacks here", findings(p.gaps)) +
    section("decisions", "Decisions that name it", p.decisions.length === 0 ? "" : fold(plural(p.decisions.length, "decision"), briefRows(at, p.decisions))) +
    `</div><aside class="side">${onPage(p)}${forAgents(at)}</aside></main>`;
};
