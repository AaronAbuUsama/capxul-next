/** A concept's page: the rail of concepts, then its operations, machines, tables, events and errors. */
import type { ConceptPage, MachineCard } from "#src/modules/site/types.ts";

import { chip, crumbs, esc, hrefTo, link, plural, prose, section } from "./html.ts";
import { VERDICT } from "./overview.ts";
import { briefRows, evalsFold, fold, operationsTable } from "./parts.ts";
import { blocks, type Cites } from "./prose.ts";
import { tiles } from "./tables.ts";

const STATE_ARROW =
  '<svg class="state-arrow" width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.6" ' +
  'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 7h10M8 3l4 4-4 4"/></svg>';

const rail = (p: ConceptPage): string =>
  `<nav class="rail" aria-label="Concepts"><p class="rail-label">Concepts</p>${p.rail.map((r) =>
    `<a class="rail-item${r.active ? " is-active" : ""}" href="${esc(hrefTo(p.id, r.ref))}"><span>${esc(r.title)}</span>` +
    `<span class="rail-n">${r.operations}</span></a>`).join("")}</nav>`;

const machine = (at: string, m: MachineCard): string =>
  `<div class="machine"><div class="machine-top">${link(at, { ...m.ref, label: m.title }, "machine-title")}` +
  `<span class="machine-sub">${plural(m.states.length, "state")}, ${plural(m.transitions, "transition")}</span></div>` +
  `<div class="states">${m.states.map((s) =>
    `<span class="state${s.terminal ? " state-end" : ""}"${s.initial ? ' title="initial state"' : ""}>${esc(s.id)}</span>`).join(STATE_ARROW)}</div></div>`;

const intro = (p: ConceptPage, cites: Cites): string =>
  crumbs([link(p.id, { label: "Concepts", page: "index", anchor: "concepts" }), esc(p.title)]) +
  `<h1 class="title">${esc(p.title)}</h1>${blocks(p.id, p.about, cites, "prose lead-prose")}` +
  `<div class="verdict">${chip(p.verdict === "none" ? "No verdict yet" : VERDICT[p.verdict], p.verdict === "none" ? "chip chip-strong" : "chip chip-blue")}` +
  `<span class="verdict-text">${p.verdict === "none" ? prose(p.verdictNote) : ""}</span></div>` +
  tiles(p.id, p.counts, "cells cells-small") +
  (p.dependsOn.length === 0 ? "" :
    `<p class="depends"><span class="depends-label">Depends on</span>${p.dependsOn.map((r) => link(p.id, r, "token")).join("")}</p>`);

export const concept = (p: ConceptPage, cites: Cites): string => {
  const at = p.id;
  const machines = p.machines.map((m) => machine(at, m)).join("");
  const errors = p.errors.length === 0 ? "" : `<p class="error-chips">${p.errors.map((r) => link(at, r, "error-chip")).join("")}</p>`;
  const pair =
    (p.tables.length === 0 && p.events.length === 0 ? "" :
      `<div class="pair">` +
      (p.tables.length === 0 ? "" : `<section class="pair-col"><h2 id="tables">Tables</h2>${briefRows(at, p.tables)}</section>`) +
      (p.events.length === 0 ? "" : `<section class="pair-col"><h2 id="events">Events</h2>${briefRows(at, p.events)}</section>`) + `</div>`);
  const more = p.more.map((m) =>
    section(m.anchor, m.title, fold(`${plural(m.items.length, "record")}`, briefRows(at, m.items)))).join("");
  return `<main class="page with-rail">${rail(p)}<div class="main-col">${intro(p, cites)}` +
    section("operations", "Operations", p.operations.length === 0 ? "" : operationsTable(at, p.operations)) +
    section("machines", "State machines", machines, "Every status a record can have, and every move between them.") +
    pair + section("errors", "Errors it can answer with", errors) + more +
    section("evals", "Evals on the concept itself", p.evals.length === 0 ? "" : evalsFold(p.evals)) +
    `</div></main>`;
};
