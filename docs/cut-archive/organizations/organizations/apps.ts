// Moved out of the built book by the cut, 10 November 2026, from books/target/organizations/apps.ts. The records are intact;
// the imports below are as the file had them, so they point at the folder the file was written in (as docs/as-is/archive does).
// What each record became is in docs/cut-archive/INDEX.md.

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

export const rpc_organizations_apps_list = defineRpc({
  id: "organizations.apps.list",
  title: "The Organization's Frappe apps: native or on its head, and where each stands",
  about:
    `${MEMBER_GUARD} It lists one page of the apps the Organization has a row for, the fundamental apps first (frappe, ` +
    "erpnext, hrms, crm, as FUNDAMENTAL_APPS orders them), then the rest by name: whether it is native, its modules, wanted, installed or removed, the version the connected head " +
    "reports, and who asked for it. A removed app stays listed, so the list says what was given up. Pages are 25 by " +
    "default (`limit` 1 to 100) and `nextCursor` is the `after` of the next page, null on the last, as every list's " +
    "(docs/design/new-commands.md G3, G5, G9); a limit outside 1 to 100, or a cursor this list did not issue, is " +
    "INVALID_INPUT. It never writes.",
  was: [RULING],
  concept: concept_organizations,
  kind: "query",
  who: WHO_MEMBER,
  input: Schema.Struct({ orgId: S, limit: Schema.optionalKey(N), after: Schema.optionalKey(S) }),
  output: Schema.Struct({ items: Schema.Array(AppView), nextCursor: NullOr(S) }),
  errors: [error_NOT_AUTHENTICATED, error_ROLE_PERMISSION_DENIED, error_INVALID_INPUT],
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

export const rpc_organizations_apps_list = defineRpc({
  id: "organizations.apps.list",
  title: "The Organization's Frappe apps: native or on its head, and where each stands",
  about:
    `${MEMBER_GUARD} It lists one page of the apps the Organization has a row for, the fundamental apps first (frappe, ` +
    "erpnext, hrms, crm, as FUNDAMENTAL_APPS orders them), then the rest by name: whether it is native, its modules, wanted, installed or removed, the version the connected head " +
    "reports, and who asked for it. A removed app stays listed, so the list says what was given up. Pages are 25 by " +
    "default (`limit` 1 to 100) and `nextCursor` is the `after` of the next page, null on the last, as every list's " +
    "(docs/design/new-commands.md G3, G5, G9); a limit outside 1 to 100, or a cursor this list did not issue, is " +
    "INVALID_INPUT. It never writes.",
  was: [RULING],
  concept: concept_organizations,
  kind: "query",
  who: WHO_MEMBER,
  input: Schema.Struct({ orgId: S, limit: Schema.optionalKey(N), after: Schema.optionalKey(S) }),
  output: Schema.Struct({ items: Schema.Array(AppView), nextCursor: NullOr(S) }),
  errors: [error_NOT_AUTHENTICATED, error_ROLE_PERMISSION_DENIED, error_INVALID_INPUT],
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

export const rpc_organizations_apps_list = defineRpc({
  id: "organizations.apps.list",
  title: "The Organization's Frappe apps: native or on its head, and where each stands",
  about:
    `${MEMBER_GUARD} It lists one page of the apps the Organization has a row for, the fundamental apps first (frappe, ` +
    "erpnext, hrms, crm, as FUNDAMENTAL_APPS orders them), then the rest by name: whether it is native, its modules, wanted, installed or removed, the version the connected head " +
    "reports, and who asked for it. A removed app stays listed, so the list says what was given up. Pages are 25 by " +
    "default (`limit` 1 to 100) and `nextCursor` is the `after` of the next page, null on the last, as every list's " +
    "(docs/design/new-commands.md G3, G5, G9); a limit outside 1 to 100, or a cursor this list did not issue, is " +
    "INVALID_INPUT. It never writes.",
  was: [RULING],
  concept: concept_organizations,
  kind: "query",
  who: WHO_MEMBER,
  input: Schema.Struct({ orgId: S, limit: Schema.optionalKey(N), after: Schema.optionalKey(S) }),
  output: Schema.Struct({ items: Schema.Array(AppView), nextCursor: NullOr(S) }),
  errors: [error_NOT_AUTHENTICATED, error_ROLE_PERMISSION_DENIED, error_INVALID_INPUT],
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
