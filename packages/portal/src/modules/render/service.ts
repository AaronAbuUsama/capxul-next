/** The render module's door: every page of a site as an HTML file, plus the stylesheet and the script. */
import { htmlFile } from "#src/modules/site/service.ts";
import type { Page, Site } from "#src/modules/site/types.ts";

import { architecture } from "./internal/architecture.ts";
import { catalogue } from "./internal/catalogue.ts";
import { shell } from "./internal/chrome.ts";
import { concept } from "./internal/concept.ts";
import { guidePage } from "./internal/guide.ts";
import { build } from "./internal/lists.ts";
import { operation } from "./internal/operation.ts";
import { overview } from "./internal/overview.ts";
import { plan } from "./internal/plan.ts";
import { milestone as planMilestone, task as planTask } from "./internal/planPages.ts";
import type { Cites } from "./internal/prose.ts";
import { questions } from "./internal/questions.ts";
import { record } from "./internal/record.ts";
import { worldsPage } from "./internal/worlds.ts";
import { SCRIPT_FILE, STYLE_FILE, type Assets } from "./types.ts";

/** Which kind's record a bare id means when several kinds share it: a decision first, then what a reader meets most. */
const CITED = ["decision", "operation", "error", "event", "table", "machine", "rpc", "flow", "workflow", "procedure", "invariant", "journey"];

/** A record's id to its page: what a bracketed citation in the blueprint's text is looked up in. */
const citesOf = (site: Site): Cites => {
  const out = new Map<string, string>();
  for (const kind of CITED) {
    for (const page of site.pages) {
      if (!page.recordKey.startsWith(`${kind}:`)) continue;
      const id = page.recordKey.slice(kind.length + 1);
      if (!out.has(id)) out.set(id, page.id);
    }
  }
  return out;
};

/** The part of a page between the top bar and the footer. */
const body = (page: Page, cites: Cites): string => {
  switch (page.type) {
    case "overview": return overview(page);
    case "worlds": return worldsPage(page);
    case "guide": return guidePage(page, cites);
    case "plan": return plan(page);
    case "plan-task": return planTask(page);
    case "plan-milestone": return planMilestone(page);
    case "questions": return questions(page, cites);
    case "architecture": return architecture(page, cites);
    case "concept": return concept(page, cites);
    case "operation": return operation(page, cites);
    case "record": return record(page, cites);
    case "build": return build(page);
    case "catalogue": return catalogue(page, cites);
  }
};

/** File path to file content: one `index.html` per page, `assets/style.css` and `assets/site.js`. */
export const renderSite = (site: Site, assets: Assets): ReadonlyMap<string, string> => {
  const nav = site.pages.flatMap((p) => (p.type === "overview" ? p.nav : []));
  const cites = citesOf(site);
  return new Map([
    ...site.pages.map((page) => [htmlFile(page.id), shell(site, page, nav, body(page, cites))] as const),
    [STYLE_FILE, assets.css] as const,
    [SCRIPT_FILE, assets.js] as const,
  ]);
};
