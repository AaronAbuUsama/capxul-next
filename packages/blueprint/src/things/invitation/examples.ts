// Example data the invitation's verbs share.
import { Invitation } from "./values.ts";

/**
 * @internal An invitation of the examples, in any state.
 */
export const invitation = (id: string, state: typeof Invitation.Type.state, invitedBy = "dana") => ({
  id,
  org: "org_northwind1",
  handle: "northwind",
  email: "olga@cast.test",
  role: "member" as const,
  invitedBy,
  state,
  invitedAt: "2026-11-13T09:05:00.000Z",
});
