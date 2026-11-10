/** The site module's door: a built Book in, every page of the site out, as plain data. */
import { architecture } from "./internal/architecture.ts";
import { docs } from "./internal/catalogue.ts";
import { concept } from "./internal/concept.ts";
import { contextOf, ofKind } from "./internal/context.ts";
import { evalCatalogue } from "./internal/evalCatalogue.ts";
import { build } from "./internal/lists.ts";
import { hasPage } from "./internal/locate.ts";
import { operation } from "./internal/operation.ts";
import { overview } from "./internal/overview.ts";
import { plan } from "./internal/plan.ts";
import { milestonePage, taskPage } from "./internal/planPages.ts";
import { inbox, questions } from "./internal/questions.ts";
import { record } from "./internal/record.ts";
import { worlds } from "./internal/worlds.ts";
import type { Site, SiteInput } from "./types.ts";

export { htmlFile, jsonFile, mdFile, relative } from "./internal/paths.ts";
export { canonical } from "./internal/schema.ts";

/**
 * Every page of the portal: the six fixed pages, a page per concept, a page per record of every kind that has
 * pages, in the book's order, then the catalogues under Docs and the eval catalogue. The same input always gives
 * the same site.
 */
export const buildSite = (input: SiteInput): Site => {
  const ctx = contextOf(input);
  const rest = [...input.book.records.values()].filter((r) => hasPage(r._kind) && r._kind !== "concept");
  const [index, ...catalogues] = docs(ctx);
  return {
    commit: input.commit, waiting: inbox(ctx).length, problems: input.book.problems.length,
    pages: [
      overview(ctx), plan(ctx), ...(input.worlds ? [worlds(ctx)] : []), ...(input.plan?.plan.milestones ?? []).flatMap((m) => milestonePage(ctx, m.id) ?? []), ...(input.plan?.plan.tasks ?? []).flatMap((t) => taskPage(ctx, t.id) ?? []), questions(ctx), architecture(ctx), build(ctx), ...(index ? [index] : []),
      ...ofKind(ctx, "concept").map((c) => concept(ctx, c)),
      ...rest.map((r) => (r._kind === "operation" ? operation(ctx, r) : record(ctx, r))),
      ...catalogues, ...evalCatalogue(ctx),
    ],
  };
};
