/** Build: where every operation stands. Each count at the top links to the list it counts. */
import type { BuildPage } from "#src/modules/site/types.ts";

import { esc, link, plural } from "./html.ts";
import { operationsTable } from "./parts.ts";
import { tiles } from "./tables.ts";

const byStand = (p: BuildPage): string =>
  p.byStand.map((s) => s.rows.length === 0 ? "" :
    `<section class="block"><div class="col-head"><h2 id="${esc(s.anchor)}">${esc(s.title)}</h2>` +
    `<span class="caption">${plural(s.rows.length, "operation")}</span></div>${operationsTable(p.id, s.rows, true)}</section>`).join("");

const byConcept = (p: BuildPage): string =>
  p.concepts.length === 0 ? "" :
    `<section class="block"><h2 id="by-concept" class="h-big">Every operation, by concept</h2>` +
    p.concepts.map((c) =>
      `<div class="sub-block"><div class="col-head"><h3 id="concept-${esc(c.ref.page.replace(/^concept\//, ""))}">${esc(c.title)}</h3>` +
      `${link(p.id, { ...c.ref, label: `${plural(c.rows.length, "operation")}` })}</div>${operationsTable(p.id, c.rows)}</div>`).join("") +
    `</section>`;

export const build = (p: BuildPage): string =>
  `<main class="page"><p class="eyebrow eyebrow-muted">Build</p><h1 class="title">Where every operation stands</h1>` +
  `<p class="lead lead-wide">An operation is specified when the book has no gap on it, decided when no question about it waits for you, ` +
  `built when its code exists, and proven when its evals pass against that code. No code exists yet, so nothing is past decided.</p>` +
  `${tiles(p.id, p.tiles)}${byStand(p)}${byConcept(p)}</main>`;
