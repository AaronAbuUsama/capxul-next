/** A page of tables: Docs, each of its catalogues, and the eval catalogue. */
import type { CataloguePage } from "#src/modules/site/types.ts";

import { crumbs, esc, link } from "./html.ts";
import { rich, type Cites } from "./prose.ts";
import { tableSection, tiles } from "./tables.ts";

export const catalogue = (p: CataloguePage, cites: Cites): string =>
  `<main class="page">${p.crumbs.length === 0 ? "" : crumbs([...p.crumbs.map((r) => link(p.id, r)), esc(p.title)])}` +
  `<p class="eyebrow eyebrow-muted">${esc(p.eyebrow)}</p><h1 class="title">${esc(p.title)}</h1>` +
  `<p class="lead lead-wide">${rich(p.id, p.lead, cites)}</p>${tiles(p.id, p.tiles)}` +
  p.sections.map((s) => tableSection(p.id, s, cites)).join("") + `</main>`;
