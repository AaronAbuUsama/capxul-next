/** The Markdown twin of the Worlds page: the design document as written, then the records of the worlds design as links. */
import type { WorldsPage } from "#src/modules/site/types.ts";

import { briefs, link, plain, section, table } from "./md.ts";

export const worlds = (p: WorldsPage): readonly string[] => {
  if (!p.present) return ["The design document is not in the repository yet."];
  // a `](` in the document's own text is escaped, so the only links in a twin are the ones the site makes
  const escaped = (s: string): string => s.replaceAll("](", "]\\(");
  return [
    escaped(p.intro), "",
    ...p.sections.flatMap((s) => [`## ${s.heading}`, "", escaped(s.body), ""]),
    ...section("Operations", table(["Command", "Title", "Priority", "Stand"], p.operations.map((o) => [link(p.id, o.ref), plain(o.title), o.priority, o.stand.stand]))),
    ...section("Journeys", briefs(p.id, p.journeys)),
    ...section("Decisions", briefs(p.id, p.decisions)),
    ...section("Tables", briefs(p.id, p.tables)),
  ];
};
