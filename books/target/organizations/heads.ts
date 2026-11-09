// The heads area: an Organization's connected Frappe head (aaron.frappe-head). Connecting, reading
// and disconnecting a head serve `org head connect|show|disconnect` (organizations.commands,
// organizations.head-commands); the head's doorbell is the head's own route. The connection's
// durable process is in processes.ts, and each app concept syncs its own records with the head
// (organizations.head-ownership). Connecting and disconnecting are a Director's: they hand the
// Organization's records to an outside system, or stop doing so.

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

const S = Schema.String;
const N = Schema.Number;
const NullOr = Schema.NullOr;
const RULING = "books/target/shared/rulings.ts (aaron.frappe-head); organizations.head-commands";

/** The Organization's live head, as `org head show` prints it and `org head connect|disconnect` print it after the change. */
export const HeadView = Schema.Struct({
  headId: S,
  siteUrl: S,
  host: Schema.Literals(["frappe-cloud", "self-hosted"]),
  status: Schema.Literals(["connecting", "connected", "failing", "disconnected"]),
  frappeVersion: NullOr(S),
  capxulAppVersion: NullOr(S),
  timeZone: NullOr(S),
  issue: NullOr(Schema.Struct({ reason: S, code: S, at: N })),
  /** The member who connected it, and who disconnected it. */
  connectedBy: S,
  disconnectedBy: NullOr(S),
  checkedAt: NullOr(N),
  rungAt: NullOr(N),
  /** The Organization's apps as the head reports them: each one's status and the version the head runs. */
  apps: Schema.Array(AppView),
  createdAt: N,
});

const DIRECTOR_GUARD =
  `${MEMBER_GUARD} Then the Seat's Safe must wear the Director hat in good standing (indexing's wearers of the ` +
  "deployment's Director hat): anyone else, an agent included, is ROLE_PERMISSION_DENIED and nothing is written; so is " +
  "the hosted FDE's call for a Director, since the preview is the Director's own (organizations.fde-for-the-asker).";

const WHO_DIRECTOR =
  "A Director of the Organization: a member whose own Safe wears the Director hat, as indexing reads the chain. Never " +
  "an agent (board.no-agent-directors), and never the hosted FDE acting for a Director, since the preview is the " +
  "Director's own: the FDE prepares a connection and asks a Director to run it.";

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

export const rpc_organizations_heads_show = defineRpc({
  id: "organizations.heads.show",
  title: "The Organization's live head, read once or followed live",
  about:
    `${MEMBER_GUARD} A live query: \`org head show\` reads it once, and \`org head connect\`'s flow subscribes to it ` +
    "until the connection is connected or failing. It answers the live connection (connecting, connected or failing), " +
    "or null when there is none: the site and its host, its status and the issue it stopped on, Frappe's and the " +
    "Capxul app's versions, its time zone, who connected it, when it was last checked and last rang, and the " +
    "Organization's apps as the head runs them. It never returns a key, a token or the ring secret. Each app concept's " +
    "own sync position is that concept's, above organizations, so it is not here. It never writes and never calls the site.",
  was: [RULING],
  concept: concept_organizations,
  kind: "live",
  who: WHO_MEMBER,
  input: Schema.Struct({ orgId: S }),
  output: NullOr(HeadView),
  errors: [error_NOT_AUTHENTICATED, error_ROLE_PERMISSION_DENIED],
  reads: [table_org_members, table_org_heads, table_org_apps],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("live-read"),
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
