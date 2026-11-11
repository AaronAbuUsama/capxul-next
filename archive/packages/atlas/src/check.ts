// The generators work: every page is there, every link inside the site lands on a page, and no page shows a value
// that was never filled. Pure, so the test runs it on the real blueprint.

import { dirname, join, normalize } from "node:path";
import type { Model } from "./model.ts";

export const checkSite = (m: Model, pages: ReadonlyMap<string, string>): string[] => {
  const out: string[] = [];
  for (const want of ["index.html", "work.html", ...m.concepts.map((c) => `concepts/${c.id}.html`), ...m.journeys.map((j) => `journeys/${j.id}.html`)])
    if (!pages.has(want)) out.push(`${want}: missing`);
  for (const [path, html] of pages) {
    for (const [, href = ""] of html.matchAll(/href="([^"#]+)"/g)) {
      if (/^[a-z]+:/.test(href)) continue;
      const target = normalize(join(dirname(path), href));
      if (!pages.has(target)) out.push(`${path}: links to ${href}, which is not a page`);
    }
    const text = html.replace(/<style>[\s\S]*?<\/style>/, "").replace(/<[^>]+>/g, " ");
    for (const bad of ["undefined", "NaN", "[object Object]"]) if (text.includes(bad)) out.push(`${path}: shows "${bad}"`);
  }
  return out;
};
