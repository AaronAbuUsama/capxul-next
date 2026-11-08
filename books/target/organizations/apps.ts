// The apps area: which Frappe apps an Organization runs (aaron.frappe-shape). The fundamental apps
// are born installed and native with the Organization; every other app lives only on a connected
// head (organizations.apps-native-or-head), wanted until the head shows it installed. These rpcs
// serve `org app list|add|remove` (organizations.commands, organizations.app-commands); installing
// a wanted app on the head is the head connection's process (processes.ts).
//
// Who may: any member reads the list; a Director, or the Organization's own agent (its FDE), adds
// and removes an app, because a connected head's host is then asked to install it, which is the
// Organization's choice (docs/design/new-commands.md G4, docs/design/authority.md). The Director
// hat is read from indexing's wearers, never remembered.

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

/** One app as `org app list` prints it, and `org app add|remove` print it after the change. */
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
  "It first finds the caller's active Seat in the Organization (by principal, an agent's by its Safe): none, or an " +
  "Organization that does not exist, is ROLE_PERMISSION_DENIED alike and nothing is read or written.";

/** The Director-or-FDE guard of `org app add|remove`. */
const DIRECTOR_OR_FDE_GUARD =
  `${MEMBER_GUARD} Then the Seat must be the Organization's own agent's (\`seat_use\` organization: its FDE), or its ` +
  "Safe must wear the Director hat in good standing (indexing's wearers of the deployment's Director hat); anyone else " +
  "is ROLE_PERMISSION_DENIED and nothing is written.";

export const WHO_DIRECTOR_OR_FDE =
  "Director or FDE: a Director of the Organization (a member whose own Safe wears the Director hat, as indexing reads " +
  "the chain), or the Organization's own agent, its FDE. Authority is the hat's or the Seat's, never a named person's.";

export const WHO_MEMBER =
  "Any member of the Organization: an active Seat, a person's or an agent's (the FDE included).";

export const rpc_organizations_apps_list = defineRpc({
  id: "organizations.apps.list",
  title: "The Organization's Frappe apps: native or on its head, and where each stands",
  about:
    `${MEMBER_GUARD} It lists every app the Organization has a row for, fundamental apps first, then the rest by name: ` +
    "whether it is native, its modules, wanted, installed or removed, the version the connected head reports, and who " +
    "asked for it. A removed app stays listed, so the list says what was given up. It never writes.",
  was: [RULING],
  concept: concept_organizations,
  kind: "query",
  who: WHO_MEMBER,
  input: Schema.Struct({ orgId: S }),
  output: Schema.Struct({ items: Schema.Array(AppView) }),
  errors: [error_NOT_AUTHENTICATED, error_ROLE_PERMISSION_DENIED],
  reads: [table_org_members, table_org_apps],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("read"),
});

export const rpc_organizations_apps_add = defineRpc({
  id: "organizations.apps.add",
  title: "Want a Frappe app beyond the fundamental ones",
  about:
    `${DIRECTOR_OR_FDE_GUARD} One transaction. The app must be one Capxul can ask a head's host to install (HEAD_APPS, ` +
    "the deployment's catalogue of published Frappe apps): any other name, or a fundamental app, is INVALID_INPUT " +
    "naming it, and nothing is written. An app the Organization has never had is born wanted (`want`); a removed one is " +
    "wanted again (`want_again`); one already wanted or installed is answered as it stands and nothing is written, so " +
    "adding twice is one want. Each records the member who asked. A wanted app is installed by the head connection's " +
    "process: at once when a head is connected, which asks the head's host (Frappe Cloud's site API) to install it and " +
    "marks it installed when the site lists it; with no head, it waits for one. It never calls the head itself.",
  was: [RULING],
  concept: concept_organizations,
  kind: "mutation",
  who: WHO_DIRECTOR_OR_FDE,
  input: Schema.Struct({ orgId: S, app: S }),
  output: AppView,
  errors: [error_NOT_AUTHENTICATED, error_ROLE_PERMISSION_DENIED, error_INVALID_INPUT],
  reads: [table_org_members, table_org_deployments, table_hat_wearers, table_org_apps],
  writes: [table_org_apps],
  drives: [machine_org_app.t.want, machine_org_app.t.want_again],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("write"),
});

export const rpc_organizations_apps_remove = defineRpc({
  id: "organizations.apps.remove",
  title: "No longer want a Frappe app",
  about:
    `${DIRECTOR_OR_FDE_GUARD} One transaction. A wanted or installed app moves to removed (\`remove\`), so Capxul stops ` +
    "asking the head's host for it; the head's owner uninstalls it there, and Capxul never deletes a head's documents. " +
    "A fundamental app is WRONG_STATE: every Organization keeps CRM, Projects, accounting and payroll. An app the " +
    "Organization has no row for is INVALID_INPUT; one already removed is answered as it stands. Nothing else is written.",
  was: [RULING],
  concept: concept_organizations,
  kind: "mutation",
  who: WHO_DIRECTOR_OR_FDE,
  input: Schema.Struct({ orgId: S, app: S }),
  output: AppView,
  errors: [error_NOT_AUTHENTICATED, error_ROLE_PERMISSION_DENIED, error_INVALID_INPUT, error_WRONG_STATE],
  reads: [table_org_members, table_org_deployments, table_hat_wearers, table_org_apps],
  writes: [table_org_apps],
  drives: [machine_org_app.t.remove],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("write"),
});
