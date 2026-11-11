// Roles follow hats: a hat granted or revoked on chain updates a person's Frappe roles; Frappe never grants authority on its own
// (START-HERE section 3). The map from a hat to roles ships with the Capxul app and is decided from the jobs each hat does, one eval per
// job. A person's Frappe user carries their Capxul account address and exists only because a hat created it. A hand edit of a person's
// roles is refused on the site, for every user, Administrator included; the only things that can still bypass it are the bench operator
// and the database, which is why a nightly drift check compares the site with the chain (FINDINGS, Frappe half: Roles follow hats).

import { Schema } from "effect";
import { concept_plugs } from "../shared/foundation.ts";
import { error_NOT_AUTHENTICATED, error_ROLE_PERMISSION_DENIED, error_PROVIDER_ERROR, error_PROVIDER_RESPONSE_INVALID, error_WRONG_STATE } from "../shared/vocabulary.ts";
import { table_hat_wearers } from "../indexing/data.ts";
import { table_org_deployments, table_org_members } from "../organizations/data.ts";
import { integration_frappe_site } from "./integrations.ts";
import { table_hat_role_map, table_role_grants, table_site_users } from "./data.ts";
import { N, Null, S, rpc } from "./kit.ts";

const SPIKE = "spikes/skeleton/FINDINGS.md";
const WHO_ADMIN = "The wearer of the Organization's Director hat (the skeleton's admin hat), read from indexing's wearers now.";

export const MapRow = Schema.Struct({ hat: S, job: S, role: S, scope: Schema.Literals(["organization", "department"]) });
export const GrantView = Schema.Struct({
  grantId: S, hat: S, department: Null(S), roles: Schema.Array(S), mapVersion: S, status: Schema.Literals(["pending", "applied", "failed", "revoked"]), createdAt: N,
});

export const rpc_plugs_roles_map = rpc({
  id: "plugs.roles.map",
  title: "Read which Frappe roles each hat's jobs give",
  about:
    "The map that shipped with the site's Capxul app, by hat and job: the role each job needs and whether it is limited to the person's department. It answers the version " +
    "and every row, so a person can see why a hat gives a role. It cannot be changed here or on the site.",
  concept: concept_plugs,
  kind: "query",
  who: "Any member of the Organization.",
  input: Schema.Struct({ orgId: S, hat: Null(S) }),
  output: Schema.Struct({ mapVersion: S, rows: Schema.Array(MapRow) }),
  errors: [error_NOT_AUTHENTICATED],
  reads: [table_hat_role_map, table_org_members],
  was: [`${SPIKE} (What the design must now decide, 6 and 7)`],

  spans: ["rpc.plugs.roles.map"],
});

export const rpc_plugs_roles_show = rpc({
  id: "plugs.roles.show",
  title: "Read a person's hats and the Frappe roles they gave",
  about:
    "For the caller, or for another member when the caller wears the Director hat: each hat the person's grants record, its department, the roles it added and its state, " +
    "and the union of the roles now applied on the site. A role two hats give is listed once, with both hats named.",
  concept: concept_plugs,
  kind: "query",
  who: "A member for themselves; the Director-hat wearer for another member.",
  input: Schema.Struct({ orgId: S, person: Null(S) }),
  output: Schema.Struct({ person: S, frappeUser: Null(S), grants: Schema.Array(GrantView), roles: Schema.Array(S) }),
  errors: [error_NOT_AUTHENTICATED, error_ROLE_PERMISSION_DENIED],
  reads: [table_role_grants, table_site_users, table_org_members, table_org_deployments, table_hat_wearers],
  was: [`${SPIKE} (Frappe half: A role two hats give stays while one remains)`],

  spans: ["rpc.plugs.roles.show"],
});

export const rpc_plugs_roles_drift = rpc({
  id: "plugs.roles.drift",
  title: "Compare the site's roles with the chain's hats",
  about:
    "Reads the site and the chain's wearers and lists every difference: a person with a role no hat gives (a bypass: raw SQL, the bench console, a Server Script), a person whose hat " +
    "gives a role they lack, a site user with no hat and a hat with no site user. It changes nothing; the nightly process of the same name repairs what the chain says and " +
    "reports the rest. A site that does not answer is PROVIDER_ERROR.",
  concept: concept_plugs,
  kind: "action",
  who: WHO_ADMIN,
  input: Schema.Struct({ orgId: S }),
  output: Schema.Struct({
    checkedAt: N,
    differences: Schema.Array(Schema.Struct({ person: S, kind: Schema.Literals(["extra-role", "missing-role", "user-without-hat", "hat-without-user"]), detail: S })),
  }),
  errors: [error_NOT_AUTHENTICATED, error_ROLE_PERMISSION_DENIED, error_PROVIDER_ERROR, error_PROVIDER_RESPONSE_INVALID, error_WRONG_STATE],
  reads: [table_role_grants, table_site_users, table_hat_role_map, table_hat_wearers, table_org_deployments, table_org_members],
  calls: [integration_frappe_site.c.readSite],
  budget: { class: "vendor", p50Ms: 1500, p95Ms: 4000 },
  was: [`${SPIKE} (Frappe half: Cannot be locked; What the design must now decide, 5)`],

  spans: ["rpc.plugs.roles.drift"],
});
