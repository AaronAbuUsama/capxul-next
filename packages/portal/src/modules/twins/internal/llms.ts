/** `llms.txt`: the map of the site for a language model, in the llms.txt convention. */
import { mdFile } from "#src/modules/site/service.ts";
import type { Page, Site } from "#src/modules/site/types.ts";

import { plain } from "./md.ts";

const FIXED: Readonly<Record<string, string>> = {
  overview: "where the blueprint stands, what waits for an answer, what the blueprint holds",
  guide: "the blueprint explained: the idea, how the build works, one record followed to its verdict, how to add to it, what happens when something is wrong, and the workflow",
  questions: "every decision that waits for an answer, with its options and the recommendation",
  architecture: "the system's parts, how it is deployed, and how the architecture changes",
  build: "every operation with its evals and where it stands",
};

const entry = (page: Page, about: string): string => `- [${plain(page.title)}](${mdFile(page.id)})${about === "" ? "" : `: ${about}`}`;

export const llms = (site: Site): string => {
  const fixed = site.pages.flatMap((p) => (p.type in FIXED ? [entry(p, FIXED[p.type] ?? "")] : []));
  const catalogues = site.pages.flatMap((p) => (p.type === "catalogue" ? [entry(p, plain(p.lead))] : []));
  const concepts = site.pages.flatMap((p) => (p.type === "concept" ? [entry(p, `${p.operations.length} operations. ${plain(p.about)}`)] : []));
  const kinds = site.pages.flatMap((p) => (p.type === "overview" ? Object.entries(p.sitemap) : []))
    .map(([kind, ids]) => `- ${kind}: ${ids.length} pages, each at \`${kind}/<id>.md\``)
    .sort();
  return [
    "# Capxul portal", "",
    `> The blueprint of the rebuilt Capxul as a site, generated at commit ${site.commit}. Nothing here is typed by hand: every page is read from the blueprint.`, "",
    "Every page has three files: `<page>/index.html` for a person, `<page>.md` with the same content as Markdown, and `data/<page>.json` with the page as data.",
    `${site.waiting} decisions wait for an answer; the blueprint has ${site.problems} problems.`, "",
    "## Pages", "", ...fixed, "", "## Catalogues", "", ...catalogues, "", "## Concepts", "", ...concepts, "", "## Records", "", ...kinds, "",
    "## Data", "", "- [The whole site's counts, findings and sitemap](data/index.json)", "- [The waiting decisions](data/review.json)", "",
  ].join("\n");
};
