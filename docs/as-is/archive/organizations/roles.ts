// The as-is book of the old organizations concept: the roles area.
//
// Its one operation, registered at `organizations/roles:list` (packages/backend/convex/organizations/
// roles.ts:3), built from its protocol row (packages/protocol/src/organizations/operations.ts:175-182).

import { Schema } from "effect";
import { defineRpc } from "../../../packages/book/src/index.ts";
import { concept_organizations } from "../shared/foundation.ts";
import {
  error_ENV_MISSING,
  error_INVALID_INPUT,
  error_NOT_AUTHENTICATED,
  error_ROLE_PERMISSION_DENIED,
  error_UNKNOWN,
} from "../shared/vocabulary.ts";
import { table_org_roles } from "./data.ts";
import { procedure_organizations_require_org_participant } from "./procedures.ts";

const O = "packages/backend/src/organizations";

export const rpc_organizations_roles_list = defineRpc({
  id: "organizations.roles.list",
  title: "The roles a member can be invited into",
  about:
    "Row `organizations.roles.list`, the public query `organizations/roles:list`. Signed in, a current participant " +
    "(`requireParticipant`). The Organization's active invitable (manage-shaped) roles from its catalog (by_org, filtered " +
    "by `isInvitable`), oldest first, as role views in one page.",
  was: [`${O}/roles/operations/list.ts:9`, "packages/backend/convex/organizations/roles.ts:3", "packages/protocol/src/organizations/operations.ts:177", `${O}/roles/reads.ts:21`, `${O}/roles/views.ts:7`],
  concept: concept_organizations,
  kind: "query",
  who: "A signed-in current Seat of the Organization.",
  input: Schema.Struct({ orgId: Schema.String }),
  output: Schema.Struct({ items: Schema.Array(Schema.Unknown), nextCursor: Schema.NullOr(Schema.String) }),
  errors: [error_NOT_AUTHENTICATED, error_INVALID_INPUT, error_UNKNOWN, error_ENV_MISSING, error_ROLE_PERMISSION_DENIED],
  reads: [table_org_roles],
  writes: [],
  drives: [],
  invokes: [procedure_organizations_require_org_participant],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});
