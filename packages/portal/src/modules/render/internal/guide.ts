/** The Blueprint page: the guide in plain words, a contents list, and the tables made from the blueprint where it marks them. */
import type { GuidePage, GuidePart } from "#src/modules/site/types.ts";

import { chip, crumbs, esc } from "./html.ts";
import { markdown } from "./markdown.ts";
import type { Cites } from "./prose.ts";
import { tableSection } from "./tables.ts";

const parts = (p: GuidePage, held: readonly GuidePart[], cites: Cites): string =>
  held.map((part) => (part.t === "md" ? markdown(part.text) : tableSection(p.id, part.table, cites, 3))).join("");

export const guidePage = (p: GuidePage, cites: Cites): string => {
  if (!p.present) {
    return `<main class="page plan guide"><div class="main-col"><h1 class="title">The blueprint</h1><p class="q-none">The guide is not in the repository yet.</p></div></main>`;
  }
  const contents = `<nav class="guide-toc" aria-label="On this page"><p class="eyebrow eyebrow-muted">On this page</p><ol>` +
    p.sections.map((s) => `<li><a href="#${esc(s.anchor)}">${esc(s.heading)}</a></li>`).join("") + `</ol></nav>`;
  const body = p.sections.map((s) => `<section class="block" id="${esc(s.anchor)}"><h2>${esc(s.heading)}</h2>${parts(p, s.parts, cites)}</section>`).join("");
  return `<main class="page plan guide"><div class="main-col">${crumbs([esc("Blueprint")])}<h1 class="title">The blueprint, explained</h1>` +
    `<p class="plan-state">${chip("guide", "chip chip-blue")} <span class="muted">The words are read from <code class="path">${esc(p.source)}</code>; ` +
    `every table is counted from the blueprint at commit <code>${esc(p.commit)}</code>.</span></p>` +
    parts(p, p.intro, cites) + contents + body + `</div></main>`;
};
