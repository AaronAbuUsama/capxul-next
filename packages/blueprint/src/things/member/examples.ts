// Example data the member's verbs share with others and with the starting points.
import { approval } from "../company/examples.ts";
import type { GrantProposed } from "./values.ts";

/**
 * @internal olga as a member, shared by the examples.
 */
export const olga = { person: "olga", email: "olga@cast.test", role: "member" as const };

/** sam's Manage books, as `org.member.grant`'s first example proposes it. */
export const samBooksGrant: typeof GrantProposed.Type = {
  change: { id: "chg_books1", member: "sam", permission: "manage-books", state: "proposed" },
  proposal: { id: "prp_books1", nonce: 1, threshold: 2 },
  approvals: [approval("apr_books1", "dana", 1), approval("apr_books2", "eli", 2)],
};
