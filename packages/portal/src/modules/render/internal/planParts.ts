/** Small pieces the plan's pages share: an exit line, a task's state with its thread. */
import type { PlanExit, PlanTask } from "#src/modules/site/types.ts";

import { chip, esc, hrefTo, prose } from "./html.ts";

export const exitRow = (at: string) => (e: PlanExit): string =>
  `<div class="row"><span class="plan-exit">${chip(e.met ? "met" : "open", e.met ? "chip chip-blue" : "chip chip-quiet")}<span class="mono">${esc(e.id)}</span></span>` +
  `<span class="plan-claim">${prose(e.claim)}</span>` +
  (e.evidence === "" ? "" : `<span class="row-text">Evidence: ${prose(e.evidence)}</span>`) +
  (e.evals.length === 0 ? "" : `<span class="row-text">Evals: ${e.evals.map((r) => `<a class="ref" href="${esc(hrefTo(at, r))}">${esc(r.label)}</a>`).join(" ")}</span>`) + `</div>`;

/** A task's state as a chip, and its thread beside it. */
export const taskState = (t: PlanTask): string =>
  `${chip(t.state, t.state === "blocked" ? "chip chip-orange" : t.state === "doing" ? "chip chip-blue" : "chip chip-quiet")}${t.thread === "" ? "" : ` <span class="mono">${esc(t.thread)}</span>`}`;
