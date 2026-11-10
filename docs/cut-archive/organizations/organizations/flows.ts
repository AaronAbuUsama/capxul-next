// Moved out of the built book by the cut, 10 November 2026, from books/target/organizations/flows.ts. The records are intact;
// the imports below are as the file had them, so they point at the folder the file was written in (as docs/as-is/archive does).
// What each record became is in docs/cut-archive/INDEX.md.

import { Schema } from "effect";
import { budget, defineFlow } from "../../../packages/book/src/index.ts";
import { component_core_sdk } from "../shared/foundation.ts";
import { error_CANCELLED, error_INVALID_INPUT, error_PROVIDER_ERROR, error_ROLE_PERMISSION_DENIED, error_WRONG_STATE } from "../shared/vocabulary.ts";
import { HeadView, rpc_organizations_heads_connect, rpc_organizations_heads_disconnect, rpc_organizations_heads_show } from "./heads.ts";
import { rpc_organizations_fde_ask, rpc_organizations_fde_turn, TurnView } from "./fde.ts";
import { rpc_organizations_docs_get, rpc_organizations_docs_remove } from "./docs.ts";
import { rpc_organizations_apps_list } from "./apps.ts";
import { rpc_organizations_setups_begin, rpc_organizations_setups_get, rpc_organizations_setups_resume, SetupView } from "./setups.ts";
import { rpc_organizations_workspaces_list } from "./workspaces.ts";
import { rpc_approvals_signing_get } from "../approvals/signing.ts";
import { MemberView, rpc_organizations_members_list, rpc_organizations_seats_raise, SeatsView } from "./members.ts";
import {
  InvitationView,
  Phase,
  rpc_organizations_invitations_list,
  rpc_organizations_invitations_list_mine,
} from "./invitations.ts";

export const flow_client_org_head_connect = defineFlow({
  id: "client.org.head.connect",
  title: "Connect a Frappe site as the head, after a preview, and follow its check",
  about:
    "`org head connect` (organizations.head-commands, aaron.frappe-head). It first reads the live head (one live is " +
    "WRONG_STATE before anything is asked, as `org head disconnect` reads first) and the Organization's apps, for the " +
    "preview. It reads the head user's API key and secret, and on Frappe Cloud the team's token and name, from a prompt " +
    "or from `--key-file` and `--team-token-file`, never from a flag: the key file holds one line, " +
    "`<api_key>:<api_secret>`, as Frappe's token header takes it; the team token file holds two, the team's " +
    "`<api_key>:<api_secret>` and then the team's name. A file not in its form is INVALID_INPUT naming it; with no " +
    "terminal to prompt at and no file for a secret the host needs, it is the CLI's usage refusal. It previews what " +
    "connecting shares (every fundamental app's records, the members as Users with the roles their hats give, and the " +
    "apps wanted) and asks; no is CANCELLED and nothing is sent, and a script without `--confirm` is the CLI's usage " +
    "refusal. Then it connects (one write) and subscribes to the head until it is connected, or failing, when it ends " +
    "with the issue's code (PROVIDER_ERROR for a site that does not answer, WRONG_STATE for one without the Capxul app " +
    "or in another time zone or currency, ROLE_PERMISSION_DENIED for a key the site refuses), within one deadline; " +
    "`--no-wait` returns the connection as the write left it. The secrets leave this machine only in the connect call.",
  component: component_core_sdk,
  sdk: "client.org(orgId).head.connect",
  input: Schema.Struct({
    orgId: S,
    siteUrl: S,
    host: Schema.Literals(["frappe-cloud", "self-hosted"]),
    keyFile: Schema.optionalKey(S),
    teamTokenFile: Schema.optionalKey(S),
    confirm: Schema.optionalKey(Schema.Boolean),
    noWait: Schema.optionalKey(Schema.Boolean),
    ...Deadline,
  }),
  output: HeadView,
  steps: [
    { name: "read", rpc: rpc_organizations_heads_show, about: "Read the live head once: a live one is WRONG_STATE and nothing is asked." },
    { name: "apps", rpc: rpc_organizations_apps_list, about: "The Organization's apps, every page, for the preview: the fundamental ones and those wanted." },
    { name: "secrets", local: "prompt", about: "Read the key and secret (and a Frappe Cloud team's token and name) from a prompt, or from the files named." },
    { name: "preview", local: "prompt", about: "Show what connecting shares and ask; no is CANCELLED, and `--confirm` answers yes." },
    { name: "connect", rpc: rpc_organizations_heads_connect, about: "Seal the secrets and birth the connection, which starts its check." },
    { name: "watch", rpc: rpc_organizations_heads_show, about: "Subscribe to the live head." },
    { name: "await-check", local: "wait", about: "Until the head is connected or failing, or the deadline; skipped with `--no-wait`." },
  ],
  errors: [error_CANCELLED, error_INVALID_INPUT, error_PROVIDER_ERROR, error_ROLE_PERMISSION_DENIED, error_WRONG_STATE],
  calls: [],
  spans: [],
  budget: { ...budget("vendor"), excludes: ["wait.await-check"] },
});

export const flow_client_org_head_disconnect = defineFlow({
  id: "client.org.head.disconnect",
  title: "Disconnect the Organization's live head, after a preview",
  about:
    "`org head disconnect` (organizations.head-commands, aaron.frappe-head). It reads the live head first: with none it " +
    "ends WRONG_STATE before asking anything. At a terminal without `confirm` it shows the site, that every app's sync " +
    "stops and that Capxul and the head both keep their records, and asks; a decline ends CANCELLED with nothing " +
    "written, and `confirm` (`--confirm`) answers yes in a script, which without it is the CLI's CLI_USAGE " +
    "(vocabulary.declined-preview-cancelled). Then it disconnects in one write.",
  component: component_core_sdk,
  sdk: "client.org(orgId).head.disconnect",
  input: Schema.Struct({ orgId: S, confirm: Schema.optionalKey(Schema.Boolean) }),
  output: HeadView,
  steps: [
    { name: "read", rpc: rpc_organizations_heads_show, about: "Read the live head once, for the preview; none is WRONG_STATE and nothing is asked." },
    { name: "confirm", local: "prompt", about: "Only at a terminal without `confirm`: show what disconnecting does and ask; no is CANCELLED and writes nothing." },
    { name: "disconnect", rpc: rpc_organizations_heads_disconnect, about: "Move the live connection to disconnected, in one write." },
  ],
  errors: [error_CANCELLED, error_WRONG_STATE],
  calls: [],
  spans: [],
  budget: budget("write"),
});
