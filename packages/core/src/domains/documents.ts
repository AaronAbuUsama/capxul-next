// Core's handlers of the blueprint's domain "documents" (src/site-ops).
import { siteOps } from "../site-ops/door.ts";

/** Its share of the world group. */
export const world = { "doc.create": siteOps["doc.create"], "doc.submit": siteOps["doc.submit"] };
