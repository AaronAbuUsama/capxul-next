/** Build: where every operation stands. Each count at the top links to the list it counts. */
import type { BuildPage } from "#src/modules/site/types.ts";

import { esc, link, plural } from "./html.ts";
import { operationsTable } from "./parts.ts";
import { tiles } from "./tables.ts";

const TELEMETRY: Readonly<Record<string, string>> = {
  "no-span": "operations naming no span", "state-change-without-event": "operations that change state and send no event",
};

/** The gaps the blueprint counts for what an operation shows beyond its design, apart from every other gap. */
const gaps = (p: BuildPage): string => {
  const g = p.gapCounts;
  return `<section class="block"><h2 id="gaps">What the blueprint still lacks</h2>` +
    `<p class="caption">${plural(g.total, "gap")} in all. Telemetry and examples are counted by their own rules, so none of them hides in the rest.</p>` +
    tiles(p.id, [
      ...g.telemetry.map((t) => ({ big: String(t.count), name: TELEMETRY[t.rule] ?? t.rule, to: null })),
      { big: String(g.examples), name: "operations with no example", to: null },
      { big: String(g.other), name: "other gaps", to: null },
    ]) + `</section>`;
};

const byStand = (p: BuildPage): string =>
  p.byStand.map((s) => s.rows.length === 0 ? "" :
    `<section class="block"><div class="col-head"><h2 id="${esc(s.anchor)}">${esc(s.title)}</h2>` +
    `<span class="caption">${plural(s.rows.length, "operation")}</span></div>${operationsTable(p.id, s.rows, true)}</section>`).join("");

const byConcept = (p: BuildPage): string =>
  p.concepts.length === 0 ? "" :
    `<section class="block"><h2 id="by-concept" class="h-big">Every operation, by concept</h2>` +
    p.concepts.map((c) =>
      `<div class="sub-block"><div class="col-head"><h3 id="concept-${esc(c.ref.page.replace(/^concept\//, ""))}">${esc(c.title)}</h3>` +
      `<span>${link(p.id, { ...c.ref, label: `${plural(c.rows.length, "operation")}` })}<span class="muted"> · ${c.passing.passing} / ${c.passing.total} evals passing</span></span></div>${operationsTable(p.id, c.rows)}</div>`).join("") +
    `</section>`;

export const build = (p: BuildPage): string =>
  `<main class="page"><p class="eyebrow eyebrow-muted">Build</p><h1 class="title">Where every operation stands</h1>` +
  `<p class="lead lead-wide">The stand shows what remains: specify means a problem or a stand-relevant gap exists under the operation; decide means an affecting decision waits for an answer. ` +
  `Build means specified and decided, with L1 evals still not passing; observe means every L1 eval under it passes; done also requires its defined live evals to hold. These are recorded stands, not a code inventory or proof at the built commit. ` +
  (p.recorded ? `${plural(p.passing.passing, "eval")} of ${plural(p.passing.total, "eval")} pass in the status document.` : "No recorded verdict is available; implementation existence is not inferred.") +
  `</p>${tiles(p.id, p.tiles)}${gaps(p)}${byStand(p)}${byConcept(p)}</main>`;
