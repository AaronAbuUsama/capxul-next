/** "If this changes": the count of what depends on a record, by kind, and the nearest few. The full list is in the twins. */
import { esc, link, plural, section } from "./html.ts";
import type { ImpactBlock } from "#src/modules/site/types.ts";

/** How many dependents a page names; the rest are in its JSON and Markdown twins. */
export const NEAREST = 5;

export const impactView = (at: string, b: ImpactBlock): string => {
  const names = b.all.slice(0, NEAREST).map((d) =>
    `<li>${link(at, d.ref, "ref")}<span class="muted"> ${esc(d.kind)}, ${esc(d.field)} of ${link(at, d.via, "ref")}, ${d.distance === 1 ? "directly" : `${d.distance} steps away`}</span></li>`);
  const decisions = b.decisions + b.decisionsOnDependents === 0 ? "" :
    ` ${plural(b.decisions, "decision")} name${b.decisions === 1 ? "s" : ""} it; ${plural(b.decisionsOnDependents, "decision")} name${b.decisionsOnDependents === 1 ? "s" : ""} something that depends on it.`;
  const body = b.total === 0
    ? `<p class="silent">Nothing depends on this record.${decisions}</p>`
    : `<p class="impact-kinds">${b.byKind.map((k) => `<span class="token">${esc(k.kind)} ${k.count}</span>`).join(" ")}</p>` +
      `<ul class="impact-list">${names.join("")}</ul>` +
      `<p class="caption">${b.total > NEAREST || !b.complete ? `The nearest ${NEAREST} of ${plural(b.total, "record")}; ${b.complete
      ? "the full list, with each field and distance, is in this page's JSON and Markdown twins."
      : "the twins list the nearest 500 (a decision's, the records it names), and `tools/impact.ts` lists everything."}` : "That is every one."}` +
      `${decisions} ${plural(b.evals, "eval")} belong to it or to them.</p>`;
  return section("impact", "If this changes", body, "Records that name this one, directly or through others.");
};
