/** The Worlds page: the design document in the owner's words first, then the blueprint's operations, journeys, decisions and tables for it. */
import type { WorldsPage } from "#src/modules/site/types.ts";

import { chip, crumbs, esc, section } from "./html.ts";
import { markdown } from "./markdown.ts";
import { briefRows, operationsTable } from "./parts.ts";

export const worldsPage = (p: WorldsPage): string => {
  if (!p.present) {
    return `<main class="page plan"><div class="main-col"><h1 class="title">Worlds</h1><p class="q-none">The design document is not in the repository yet.</p></div></main>`;
  }
  const doc = p.sections.map((s) => `<section class="block" id="${esc(s.heading.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""))}"><h2>${esc(s.heading)}</h2>${markdown(s.body)}</section>`).join("");
  return `<main class="page plan worlds"><div class="main-col">${crumbs([esc("Worlds")])}<h1 class="title">Worlds as a hosted platform</h1>` +
    `<p class="plan-state">${chip("design", "chip chip-blue")} <span class="muted">Read from <code class="path">${esc(p.source)}</code>. Then the blueprint's records, below.</span></p>` +
    markdown(p.intro) + doc +
    section("operations", "Operations", operationsTable(p.id, p.operations), "Every command of the worlds design, with where it stands. Open one for its examples, refusals and acceptance claims.") +
    section("journeys", "Journeys", briefRows(p.id, p.journeys), "One per person or agent who uses a world. The tester's journey waits on Capxul Core's sign-in.") +
    section("decisions", "Decisions", briefRows(p.id, p.decisions), "Every judgment, with what is measured and what is assumed.") +
    section("tables", "Tables", briefRows(p.id, p.tables)) + `</div></main>`;
};
