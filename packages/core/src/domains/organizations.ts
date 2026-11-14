// Core's handlers of the blueprint's domain "organizations" (src/organizations).
import { orgCreateHandler, orgMemberGrantHandler } from "../organizations/handlers.ts";

/** Its share of the world group. */
export const world = { "org.create": orgCreateHandler, "org.member.grant": orgMemberGrantHandler };
