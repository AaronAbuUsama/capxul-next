// The members area: the Organization's Seats. A Seat is born by the setup (the founder) or by an
// accepted invitation, and ends only when the chain removes the agent that holds it
// (processes.ts). Granting and revoking an officer hat is board's (`org member grant`,
// `org member revoke`); a spending allowance is budgets'. The old area's grant, revoke,
// permission-target, record-permission-change, advance, emit and notify rpcs go with them or with
// the legacy pending states (decision organizations.members-are-seats).

import { Schema } from "effect";
import { budget, defineRpc } from "../../../packages/book/src/index.ts";
import { concept_organizations } from "../shared/foundation.ts";
import { error_INVALID_INPUT, error_NOT_AUTHENTICATED, error_ROLE_PERMISSION_DENIED } from "../shared/vocabulary.ts";
import { table_org_deployments, table_org_invitations, table_org_members } from "./data.ts";
import { table_principals } from "../access/data.ts";
import { table_parties } from "../parties/data.ts";
import { table_hat_wearers } from "../indexing/data.ts";

const O = "packages/backend/src/organizations";
const AS_IS = "docs/as-is/archive/organizations/members.ts";

const S = Schema.String;
const N = Schema.Number;
const NullOr = Schema.NullOr;

/** One member as `org member list` and `org member get` print it (their frozen returns). */
export const MemberView = Schema.Struct({
  memberId: S,
  email: NullOr(S),
  name: NullOr(S),
  accountId: NullOr(S),
  personalSafeAddress: NullOr(S),
  /** `Director` when the Seat's Safe wears the Director hat, else `Member`; an open invitation is `Member`. */
  role: S,
  /** The target produces `pending` (an open invitation), `active` and `revoked` (a removed agent's Seat). */
  status: Schema.Literals(["pending", "pending_safe", "pending_grant", "active", "revoked", "expired"]),
  /** The frozen surface keeps `ai` for a Seat an agent holds. */
  kind: Schema.Literals(["human", "ai"]),
  /** The officer hats the Seat's Safe wears: Books, Invoicing and People. */
  permissions: Schema.Array(Schema.Literals(["manage-books", "issue-invoices", "manage-people"])),
});

export const rpc_organizations_members_list = defineRpc({
  id: "organizations.members.list",
  title: "The Organization's Seats and the people invited who have not joined",
  about:
    "One page, in join order, of the Organization's Seats, then its open invitations (authorizing or pending) as members " +
    "with status `pending` and no Account. Each Seat shows its principal's email (access) and its Party's name, its principal as the Account ID, " +
    "the Safe it acts from, and the officer hats that Safe wears now (indexing's wearers, named through the deployment). " +
    "Every row has its own memberId, an invitation's being its invitation ID. Only a current member may read it (else " +
    "ROLE_PERMISSION_DENIED); a cursor from another list is INVALID_INPUT.",
  was: [`${AS_IS}:124`, `${O}/members/operations/list.ts:9`, `${O}/members/reads.ts:27`],
  concept: concept_organizations,
  kind: "query",
  who: "Any current member of the Organization.",
  input: Schema.Struct({ orgId: S, limit: Schema.optionalKey(N), after: Schema.optionalKey(S) }),
  output: Schema.Struct({ items: Schema.Array(MemberView), nextCursor: NullOr(S) }),
  errors: [error_NOT_AUTHENTICATED, error_ROLE_PERMISSION_DENIED, error_INVALID_INPUT],
  reads: [table_org_members, table_org_invitations, table_org_deployments, table_principals, table_parties, table_hat_wearers],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("read"),
});
