// The thing "site": a company's Frappe site, given to a world from the bench's pool by the site service (the
// glossary's words, part 12). Capxul's own names on a site stay in src/common/site.ts. Its verbs here are work no door
// serves: the world asks the site service for them.
//
// A site's values.
import * as Schema from "effect/Schema";

/** Why sites could not be taken from the pool. */
export const TakeRefusal = Schema.Literals(["pool empty", "no site template", "site service unavailable"]);
