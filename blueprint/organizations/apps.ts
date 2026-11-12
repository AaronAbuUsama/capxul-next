// The apps area: which Frappe apps an Organization runs (aaron.frappe-shape). The fundamental apps
// are born installed and native with the Organization; every other app lives only on a connected
// head (organizations.apps-native-or-head), wanted until the head shows it installed. These rpcs
// serve `org head app list|add|remove` (organizations.commands, organizations.app-commands); installing
// a wanted app on the head is the head connection's process (processes.ts).
//
// Who may: any member reads the list; a Director, or the Organization's own agent acting as itself
// (a self-run one), adds and removes an app, because a connected head's host is then asked to install
// it, which is the Organization's choice (docs/design/new-commands.md G4, docs/design/authority.md).
// Hosted-FDE asker impersonation is parked by cut.fde-parked. The Director hat is read from
// indexing's wearers, never remembered.

import { Schema } from "effect";
import { budget, defineRpc } from "../../packages/blueprint-engine/src/index.ts";
import { concept_organizations } from "../shared/foundation.ts";
import {
  error_INVALID_INPUT,
  error_NOT_AUTHENTICATED,
  error_ROLE_PERMISSION_DENIED,
  error_WRONG_STATE,
} from "../shared/vocabulary.ts";
import { machine_org_app, table_org_apps, table_org_deployments, table_org_members } from "./data.ts";
import { table_hat_wearers } from "../indexing/data.ts";

const S = Schema.String;
const N = Schema.Number;
const NullOr = Schema.NullOr;
const RULING = "blueprint/shared/rulings.ts (aaron.frappe-shape, aaron.frappe-head); organizations.app-commands";

/** One app as `org head app list` prints it, and `org head app add|remove` print it after the change. */
export const AppView = Schema.Struct({
  app: S,
  /** True for a fundamental app, whose records Capxul holds natively. */
  native: Schema.Boolean,
  modules: Schema.Array(S),
  status: Schema.Literals(["wanted", "installed", "removed"]),
  /** The head's installed version; null while no head runs it, and for a native app with no head. */
  version: NullOr(S),
  /** The member who asked for it (founder, Director or FDE), by member id; null for a fundamental app. */
  addedBy: NullOr(S),
  installedAt: NullOr(N),
  updatedAt: N,
});

/** The tenant guard every organizations command on an Organization's records runs first. */
export const MEMBER_GUARD =
  "It first finds the authenticated caller's active Seat in the Organization (a person's by principal, an agent's " +
  "by the Safe its principal proved; no hosted act-for token substitutes another person's authority): none, or an " +
  "Organization that does not exist, is ROLE_PERMISSION_DENIED alike and nothing is read or written.";

/** The Director-or-FDE guard of `org head app add|remove`. */
const DIRECTOR_OR_FDE_GUARD =
  `${MEMBER_GUARD} Then the Seat must be the Organization's own agent's (\`seat_use\` organization) acting as itself, ` +
  "which only a self-run one does, or its Safe must wear the Director hat in good standing (indexing's wearers of the " +
  "deployment's Director hat); anyone else is ROLE_PERMISSION_DENIED and nothing is written.";

export const WHO_DIRECTOR_OR_FDE =
  "Director or FDE: a Director of the Organization (a member whose own Safe wears the Director hat, as indexing reads " +
  "the chain), or the Organization's own agent acting as itself, which only a self-run one does (agents.fde-authority). " +
  "Hosted asker impersonation is parked by cut.fde-parked. Authority is the hat's or the " +
  "Seat's, never a named person's.";

export const WHO_MEMBER =
  "Any member of the Organization: an active Seat, a person's or a self-run agent's. No hosted act-for authority.";
