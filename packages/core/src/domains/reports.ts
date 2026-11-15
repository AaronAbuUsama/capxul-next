// Core's handlers of the blueprint's domain "reports" (src/site-ops).
import { siteOps } from "../site-ops/door.ts";

/** Its share of the world group. */
export const world = { "report.run": siteOps["report.run"] };
