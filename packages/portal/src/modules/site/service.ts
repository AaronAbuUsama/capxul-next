/** The site module's door: a built Blueprint in, every page of the site out, as plain data. */
import { architecture } from "./internal/architecture.ts";
import { docs } from "./internal/catalogue.ts";
import { concept } from "./internal/concept.ts";
import { contextOf, ofKind } from "./internal/context.ts";
import { evalCatalogue } from "./internal/evalCatalogue.ts";
import { guide } from "./internal/guide.ts";
import { history } from "./internal/history.ts";
import { build } from "./internal/lists.ts";
import { hasPage } from "./internal/locate.ts";
import { operation } from "./internal/operation.ts";
import { overview } from "./internal/overview.ts";
import { inbox, questions } from "./internal/questions.ts";
import { record } from "./internal/record.ts";
import { slicePages } from "./internal/slices.ts";
import { worlds } from "./internal/worlds.ts";
import type { Site, SiteInput } from "./types.ts";

export { htmlFile, jsonFile, mdFile, relative } from "./internal/paths.ts";
export { canonical } from "./internal/schema.ts";
export { parseLog } from "./internal/history.ts";

/**
 * Every page of the portal: the fixed pages, a page per concept, a page per record of every kind that has
 * pages, in the blueprint's order, then the catalogues under Docs and the eval catalogue. The same input always gives
 * the same site.
 */
export const buildSite = (input: SiteInput): Site => {
  const ctx = contextOf(input);
  const rest = [...input.blueprint.records.values()].filter((r) => hasPage(r._kind) && r._kind !== "concept");
  const [index, ...catalogues] = docs(ctx);
  return {
    commit: input.commit, waiting: inbox(ctx).length, problems: input.blueprint.problems.length,
    pages: [
      overview(ctx), ...(input.worlds ? [worlds(ctx)] : []), ...(input.guide ? [guide(ctx)] : []), questions(ctx), architecture(ctx), build(ctx), ...[history(ctx)].filter((p) => p !== null), ...(index ? [index] : []),
      ...ofKind(ctx, "concept").map((c) => concept(ctx, c)),
      ...rest.map((r) => (r._kind === "operation" ? operation(ctx, r) : record(ctx, r))),
      ...catalogues, ...evalCatalogue(ctx), ...slicePages(ctx),
    ],
  };
};
