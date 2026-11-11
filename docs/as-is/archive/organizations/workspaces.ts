// The as-is book of the old organizations concept: the workspaces area.
//
// Every operation registered at `organizations/workspaces:*` (packages/backend/convex/organizations/
// workspaces.ts:3-4): two public queries built from their protocol rows
// (packages/protocol/src/organizations/operations.ts:142-156). Neither writes.

import { Schema } from "effect";
import { defineRpc } from "../../../packages/book/src/index.ts";
import { concept_organizations } from "../shared/foundation.ts";
import {
  error_ENV_MISSING,
  error_INVALID_INPUT,
  error_NOT_AUTHENTICATED,
  error_ROLE_PERMISSION_DENIED,
  error_UNKNOWN,
  error_WRONG_STATE,
} from "../shared/vocabulary.ts";
import { table_org_lifecycles, table_org_members, table_org_roles, table_orgs, table_seat_permissions } from "./data.ts";
import {
  procedure_organizations_current_org_participation,
  procedure_organizations_require_claimed_org_party,
  procedure_organizations_require_org_participant,
} from "./procedures.ts";
import {
  procedure_accounts_read_workspace_account_safe_in_tx,
  procedure_accounts_read_workspace_founder_safe_in_tx,
  procedure_accounts_read_workspace_member_account_in_tx,
} from "../accounts/procedures.ts";
import { procedure_parties_party_by_id } from "../parties/procedures.ts";
import {
  procedure_permissions_find_people_authority_in_tx,
  procedure_permissions_list_spend_authorities,
  procedure_permissions_org_bootstrap_authority_usable,
  procedure_permissions_read_account_assignments_in_tx,
  procedure_permissions_read_worn_allowances_in_tx,
} from "../permissions/procedures.ts";

const O = "packages/backend/src/organizations";
const W = `${O}/workspaces`;
const CONVEX = "packages/backend/convex/organizations/workspaces.ts";
const ROWS = "packages/protocol/src/organizations/operations.ts";

const S = Schema.String;
const U = Schema.Unknown;
const CALL = [error_NOT_AUTHENTICATED, error_INVALID_INPUT];
const DEFECTS = [error_UNKNOWN, error_ENV_MISSING];

/** `memberIdentity` (workspaces/views.ts:61): the Party, the member's Account and its assignments. */
const IDENTITY_INVOKES = [
  procedure_parties_party_by_id,
  procedure_accounts_read_workspace_member_account_in_tx,
  procedure_permissions_read_account_assignments_in_tx,
];
/** The authorities a workspace and a standing show: people, spending, worn allowances. */
const AUTHORITY_INVOKES = [
  procedure_permissions_find_people_authority_in_tx,
  procedure_permissions_list_spend_authorities,
  procedure_permissions_read_worn_allowances_in_tx,
];

export const rpc_organizations_workspaces_list = defineRpc({
  id: "organizations.workspaces.list",
  title: "The Organizations the caller takes part in or is founding",
  about:
    "Row `organizations.workspaces.list`, the public query `organizations/workspaces:list`. Signed in. Every membership " +
    "row of the caller that is active, pending_safe or pending_grant projects a workspace (a later row of the same " +
    "Organization wins): the Organization with its claimed Party (WRONG_STATE when missing) and logo URL, the setup, the " +
    "viewer's role label, identity and Account, people and spend authorities and worn allowances; then each uncompleted " +
    "setup the caller founds that no membership covers. A missing lifecycle, Organization or founder Safe is WRONG_STATE; " +
    "a projection the wire schema refuses is WRONG_STATE (projectionMalformed). Sorted by orgId, one page.",
  was: [`${W}/operations/list.ts:9`, `${CONVEX}:3`, `${ROWS}:144`, `${W}/reads/workspaces.ts:31`, `${W}/reads/workspaces.ts:43`, `${W}/views.ts:97`],
  concept: concept_organizations,
  kind: "query",
  who: "A signed-in person; only their own memberships and setups.",
  input: Schema.Struct({}),
  output: Schema.Struct({ items: Schema.Array(U), nextCursor: Schema.NullOr(S) }),
  errors: [...CALL, ...DEFECTS, error_WRONG_STATE],
  reads: [table_org_members, table_orgs, table_org_lifecycles, table_org_roles],
  writes: [],
  drives: [],
  invokes: [
    procedure_organizations_current_org_participation,
    procedure_organizations_require_claimed_org_party,
    procedure_permissions_org_bootstrap_authority_usable,
    procedure_accounts_read_workspace_account_safe_in_tx,
    procedure_accounts_read_workspace_founder_safe_in_tx,
    ...IDENTITY_INVOKES,
    ...AUTHORITY_INVOKES,
  ],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_organizations_workspaces_me = defineRpc({
  id: "organizations.workspaces.me",
  title: "The caller's own standing in one Organization",
  about:
    "Row `organizations.workspaces.me`, the public query `organizations/workspaces:me`. Signed in, a current participant " +
    "(`requireParticipant`). The role label (the catalog's for the Seat's role key, else the row's role), people " +
    "authority, the active spending allowances with their Budget labels and amounts, the identity and the worn " +
    "allowances, from the same checks the writes make. A vanished member or Organization row is UNKNOWN; a projection " +
    "the wire schema refuses is WRONG_STATE.",
  was: [`${W}/operations/me.ts:9`, `${CONVEX}:4`, `${ROWS}:151`, `${W}/reads/standing.ts:35`, `${W}/reads/standing.ts:47`],
  concept: concept_organizations,
  kind: "query",
  who: "A signed-in current Seat of the Organization.",
  input: Schema.Struct({ orgId: S }),
  /** `OrgMeSchema` (protocol organizations/schema.ts): role, capabilities, allowances; too deep to transcribe. */
  output: U,
  errors: [...CALL, ...DEFECTS, error_ROLE_PERMISSION_DENIED, error_WRONG_STATE],
  reads: [table_org_members, table_orgs, table_org_roles, table_seat_permissions],
  writes: [],
  drives: [],
  invokes: [procedure_organizations_require_org_participant, ...IDENTITY_INVOKES, ...AUTHORITY_INVOKES],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});
