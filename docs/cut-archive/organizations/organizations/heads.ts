// Moved out of the built book by the cut, 10 November 2026, from books/target/organizations/heads.ts. The records are intact;
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
import { machine_org_head, table_org_apps, table_org_deployments, table_org_heads, table_org_members, table_organizations } from "./data.ts";
import { table_hat_wearers } from "../indexing/data.ts";
import { AppView, MEMBER_GUARD, WHO_MEMBER } from "./apps.ts";

export const rpc_organizations_heads_ring = defineRpc({
  id: "organizations.heads.ring",
  title: "A connected head rings: something changed there",
  about:
    "The head's doorbell route. The Capxul app for Frappe posts it after a change to a synced DocType commits, signed " +
    "with the secret the connection gave it (HMAC-SHA256 over the head id and timestamp, checked with the connection's " +
    "unsealed ring secret, five minutes of skew on the one clock). It carries no data: one transaction stamps the live " +
    "connection's `rung_at`, which wakes every app concept's sync of that head to pull the head's changes with " +
    "Capxul's own key (organizations.head-doorbell). A repeated ring only causes an extra pull. A ring for an unknown " +
    "or disconnected head, or whose signature or time does not check, is NOT_AUTHENTICATED alike and writes nothing, " +
    "so a caller cannot learn which heads exist.",
  concept: concept_organizations,
  kind: "mutation",
  who: "frappe-head: the Capxul app on a connected head, signing with its connection's ring secret; no session is involved.",
  input: Schema.Struct({ headId: S, timestamp: S, signature: S }),
  output: Schema.Struct({ accepted: Schema.Boolean }),
  errors: [error_NOT_AUTHENTICATED],
  reads: [table_org_heads],
  writes: [table_org_heads],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("write"),
});

export const rpc_organizations_heads_connect = defineRpc({
  id: "organizations.heads.connect",
  title: "Connect a Frappe site as the Organization's head",
  about:
    `${DIRECTOR_GUARD} One transaction under the Organization row's lock. The site URL must be an https URL with no ` +
    "path, query or credentials (else INVALID_INPUT); the head user's API key and secret are required, and for a " +
    "Frappe Cloud head the team's API token and team name too, which its site API takes to install apps (missing, " +
    "INVALID_INPUT). A live connection (connecting, connected or failing) is WRONG_STATE: disconnect it first. " +
    "Otherwise it seals the key and secret, the team's token and a fresh ring secret under record-bound encryption " +
    "bound to the new row, never returning any of them, and births the connection (`connect`), which starts its " +
    "durable process: that reads the site, gives the head's Capxul app its ring secret, confirms the head or stalls it " +
    "with the reason, installs every wanted app and pushes the members' Users. It answers the new connection, " +
    "connecting; the flow follows it to connected or failing. It never calls the site itself.",
  was: [RULING],
  concept: concept_organizations,
  kind: "mutation",
  who: WHO_DIRECTOR,
  input: Schema.Struct({
    orgId: S,
    siteUrl: S,
    host: Schema.Literals(["frappe-cloud", "self-hosted"]),
    apiKey: S,
    apiSecret: S,
    /** Frappe Cloud only: the team's API key and secret, and the team's name. */
    teamToken: Schema.optionalKey(S),
    team: Schema.optionalKey(S),
  }),
  output: HeadView,
  errors: [error_NOT_AUTHENTICATED, error_ROLE_PERMISSION_DENIED, error_INVALID_INPUT, error_WRONG_STATE],
  reads: [table_org_members, table_org_deployments, table_hat_wearers, table_organizations, table_org_heads, table_org_apps],
  writes: [table_org_heads],
  drives: [machine_org_head.t.connect],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("write"),
});

export const rpc_organizations_heads_disconnect = defineRpc({
  id: "organizations.heads.disconnect",
  title: "Disconnect the Organization's live head",
  about:
    `${DIRECTOR_GUARD} One transaction: the live connection moves to disconnected (\`disconnect\`) and records who ` +
    "disconnected it, which ends its process and every app concept's sync of it. Capxul keeps every record it holds, " +
    "the head keeps its own documents, and the sealed key, token and ring secret are never used again, so a later ring " +
    "from that head is refused. No live connection is WRONG_STATE and nothing is written. It answers the disconnected " +
    "connection. It never calls the site.",
  was: [RULING],
  concept: concept_organizations,
  kind: "mutation",
  who: WHO_DIRECTOR,
  input: Schema.Struct({ orgId: S }),
  output: HeadView,
  errors: [error_NOT_AUTHENTICATED, error_ROLE_PERMISSION_DENIED, error_WRONG_STATE],
  reads: [table_org_members, table_org_deployments, table_hat_wearers, table_org_heads, table_org_apps],
  writes: [table_org_heads],
  drives: [machine_org_head.t.disconnect],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("write"),
});
