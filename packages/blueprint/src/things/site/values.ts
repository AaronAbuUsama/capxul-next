// The thing "site": a company's Frappe site, given to a world from the bench's pool by the site service (the
// glossary's words, part 12). Capxul's own names on a site stay in src/common/site.ts. Its verbs here are work no door
// serves: the world asks the site service for them.
//
// A site's values.
import * as Schema from "effect/Schema";

/** Why sites could not be taken from the pool. */
export const TakeRefusal = Schema.Literals(["pool empty", "no site template", "site service unavailable"]);

/**
 * Where a founded company's site came from (4.8, option 2): a ready company copy taken from the bench's pool, a copy
 * made from the company template on the request's path, a ready blank copy, a copy of the blank, or made from nothing.
 */
export const SiteOrigin = Schema.Literals(["company pool", "company copy", "blank pool", "blank copy", "from nothing"]);

/** Why a founded company's site was not taken from the pool of ready company copies. */
export const MakeFallback = Schema.Literals(["no company template", "company pool empty", "no blank"]);
