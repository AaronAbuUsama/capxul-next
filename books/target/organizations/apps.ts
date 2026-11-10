// The apps area: which Frappe apps an Organization runs (aaron.frappe-shape). The fundamental apps
// are born installed and native with the Organization; every other app lives only on a connected
// head (organizations.apps-native-or-head), wanted until the head shows it installed. These rpcs
// serve `org head app list|add|remove` (organizations.commands, organizations.app-commands); installing
// a wanted app on the head is the head connection's process (processes.ts).
//
// Who may: any member reads the list; a Director, or the Organization's own agent acting as itself
// (a self-run one), adds and removes an app, because a connected head's host is then asked to install
// it, which is the Organization's choice (docs/design/new-commands.md G4, docs/design/authority.md).
// The hosted FDE never acts as itself: it acts as its asker (organizations.fde-for-the-asker), so it
// does so only for a Director, and the tenant guard refuses its call with no act-for token. The
// Director hat is read from indexing's wearers, never remembered.

import { Schema } from "effect";
import { budget, defineRpc } from "../../../packages/book/src/index.ts";
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
const RULING = "books/target/shared/rulings.ts (aaron.frappe-shape, aaron.frappe-head); organizations.app-commands";

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
  "It first finds the caller's active Seat in the Organization (by principal, an agent's by its Safe; for the hosted " +
  "FDE, only with an act-for token, its open ask's asker's, organizations.fde-for-the-asker): none, or an " +
  "Organization that does not exist, is ROLE_PERMISSION_DENIED alike and nothing is read or written.";

/** The Director-or-FDE guard of `org head app add|remove`. */
const DIRECTOR_OR_FDE_GUARD =
  `${MEMBER_GUARD} Then the Seat must be the Organization's own agent's (\`seat_use\` organization) acting as itself, ` +
  "which only a self-run one does, or its Safe must wear the Director hat in good standing (indexing's wearers of the " +
  "deployment's Director hat); anyone else is ROLE_PERMISSION_DENIED and nothing is written.";

export const WHO_DIRECTOR_OR_FDE =
  "Director or FDE: a Director of the Organization (a member whose own Safe wears the Director hat, as indexing reads " +
  "the chain), or the Organization's own agent acting as itself, which only a self-run one does (agents.fde-authority). " +
  "The hosted FDE acts as whoever asked it " +
  "(aaron.fde-anyone), so it adds or removes an app only for a Director who asks. Authority is the hat's or the " +
  "Seat's, never a named person's.";

export const WHO_MEMBER =
  "Any member of the Organization: an active Seat, a person's or an agent's. The hosted FDE reads only as the member " +
  "who asked it (aaron.fde-anyone), never as itself; a self-run own agent reads as itself.";

