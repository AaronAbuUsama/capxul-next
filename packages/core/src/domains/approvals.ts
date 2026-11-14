// Core's handlers of the blueprint's domain "approvals" (src/approvals, served through src/organizations/handlers.ts).
import { approvalSignHandler } from "../organizations/handlers.ts";

/** Its share of the world group. */
export const world = { "approval.sign": approvalSignHandler };
