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
import { table_org_apps, table_org_deployments, table_org_members, table_organizations } from "./data.ts";
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
  reads: [table_org_members, table_org_apps],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("live-read"),
});

