/** The twins module's door: every page of a site as a Markdown file and a JSON file, plus `llms.txt`. */
import { canonical, jsonFile, mdFile } from "#src/modules/site/service.ts";
import type { Page, Site } from "#src/modules/site/types.ts";

import { llms } from "./internal/llms.ts";
import { doc } from "./internal/md.ts";
import { architecture, build, catalogue, overview, questions } from "./internal/pages.ts";
import { concept, operation, record } from "./internal/records.ts";
import { LLMS_FILE } from "./types.ts";

/** The lines of a page's Markdown under its title. */
const body = (page: Page): readonly string[] => {
  switch (page.type) {
    case "overview": return overview(page);
    case "questions": return questions(page);
    case "architecture": return architecture(page);
    case "concept": return concept(page);
    case "operation": return operation(page);
    case "record": return record(page);
    case "build": return build(page);
    case "catalogue": return catalogue(page);
  }
};

/**
 * File path to file content: `<page>.md` and `data/<page>.json` for every page, and `llms.txt`. The JSON twin is
 * the page model itself, so `data/index.json` carries the counts, the commit, the problems, the gaps and the nav.
 */
export const twinsOf = (site: Site): ReadonlyMap<string, string> =>
  new Map([
    ...site.pages.flatMap((page) => [
      [mdFile(page.id), doc(page.id, page.title, page.source, body(page))] as const,
      [jsonFile(page.id), canonical(page)] as const,
    ]),
    [LLMS_FILE, llms(site)] as const,
  ]);
