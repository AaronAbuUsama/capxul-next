/** The Markdown twin of the Blueprint page: the guide as written, with each generated table in its place. */
import type { GuidePage, GuidePart } from "#src/modules/site/types.ts";

import { tableSection } from "./md.ts";

// a `](` in the document's own text is escaped, so the only links in a twin are the ones the site makes
const escaped = (s: string): string => s.replaceAll("](", "]\\(");

const parts = (p: GuidePage, held: readonly GuidePart[]): readonly string[] =>
  held.flatMap((part) => (part.t === "md" ? [escaped(part.text), ""] : tableSection(p.id, part.table, 3)));

export const guide = (p: GuidePage): readonly string[] => {
  if (!p.present) return ["The guide is not in the repository yet."];
  return [
    `Every table on this page is counted from the blueprint at commit \`${p.commit}\`.`, "",
    ...parts(p, p.intro),
    ...p.sections.flatMap((s) => [`## ${s.heading}`, "", ...parts(p, s.parts)]),
  ];
};
