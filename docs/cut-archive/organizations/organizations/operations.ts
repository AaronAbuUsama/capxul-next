// Moved out of the built book by the cut, 10 November 2026, from books/target/organizations/operations.ts. The records are intact;
// the imports below are as the file had them, so they point at the folder the file was written in (as docs/as-is/archive does).
// What each record became is in docs/cut-archive/INDEX.md.

import { Schema } from "effect";
import { budget, defineOperation, type ErrorRecord } from "../../../packages/book/src/index.ts";
import { frozen, frozenText, type FrozenId } from "../../frozen/index.ts";
import {
  error_CANCELLED,
  error_CLI_DEADLINE,
  error_CLI_STORAGE,
  error_CLI_USAGE,
  error_FEATURE_NOT_AVAILABLE,
  error_INVALID_INPUT,
  error_NOT_AUTHENTICATED,
  error_RATE_LIMITED,
  error_ROLE_PERMISSION_DENIED,
  error_WRONG_STATE,
} from "../shared/vocabulary.ts";
import {
  flow_client_onboarding_begin_organization,
  flow_client_org_members_get,
  flow_client_org_setup_get,
  flow_client_org_setup_resume,
  flow_client_org_setup_subscribe,
  flow_client_orgs_invitations,
  flow_client_orgs_use,
} from "./flows.ts";
import { rpc_organizations_workspaces_list, rpc_organizations_workspaces_me } from "./workspaces.ts";
import { MemberView, rpc_organizations_members_list } from "./members.ts";
import { SetupView } from "./setups.ts";
import { rpc_organizations_apps_add, rpc_organizations_apps_list, rpc_organizations_apps_remove, WHO_DIRECTOR_OR_FDE, WHO_MEMBER } from "./apps.ts";
import { rpc_organizations_heads_show } from "./heads.ts";
import {
  rpc_organizations_fde_guests_add,
  rpc_organizations_fde_guests_list,
  rpc_organizations_fde_guests_remove,
  rpc_organizations_fde_show,
  rpc_organizations_fde_turn,
} from "./fde.ts";
import {
  rpc_organizations_doc_calls_list,
  rpc_organizations_docs_amend,
  rpc_organizations_docs_apply,
  rpc_organizations_docs_cancel,
  rpc_organizations_docs_change,
  rpc_organizations_docs_create,
  rpc_organizations_docs_get,
  rpc_organizations_docs_list,
  rpc_organizations_docs_submit,
  rpc_organizations_doctypes_get,
  rpc_organizations_doctypes_list,
  WHO_HEAD_USER,
} from "./docs.ts";
import { rpc_organizations_seats_show } from "./members.ts";
import { flow_client_org_head_docs_remove, flow_client_org_fde_ask, flow_client_org_head_connect, flow_client_org_head_disconnect } from "./flows.ts";
import { error_PROVIDER_ERROR } from "../shared/vocabulary.ts";
import {
  InvitationView,
  rpc_organizations_invitations_cancel,
  rpc_organizations_invitations_decline,
  rpc_organizations_invitations_list,
  rpc_organizations_invitations_resend,
} from "./invitations.ts";

export const operation_org_head_connect = defineOperation({
  id: "org.head.connect",
  title: "Connect a Frappe site as the Organization's head",
  about:
    "Connects a Frappe site, on Frappe Cloud or self-hosted, as the Organization's head: once connected, accounting, " +
    "payroll, the CRM and projects sync with it, and Capxul stays the record of money and identity. It reads the head " +
    "user's API key and secret, and on Frappe Cloud the team's token, from a prompt or from `--key-file` and " +
    "`--team-token-file`, never from a flag; previews what connecting shares and asks (`--confirm` answers yes in a " +
    "script); then follows the site's check until the head is connected, or failing with the reason. An Organization " +
    "has at most one live head.",
  area: AREA,
  command: "org head connect",
  priority: "normal",
  implementedBy: flow_client_org_head_connect,
  who: WHO_DIRECTOR,
  changes:
    "One head connection, its secrets sealed; its process checks the site, installs the wanted apps and pushes the " +
    "members as Users, and every fundamental app's sync starts once it is connected.",
  acceptance: [
    claim(
      "A Director connects a site after a preview, and the command follows the check until the head is connected.",
      "cli: from org-with-head-site, `org head connect <the stand-in's URL> --host frappe-cloud --key-file <its key file> --team-token-file <its team token file> --confirm --json` prints `status: connected` with the stand-in's Frappe and Capxul app versions and Acme's time zone; read: `org head show` prints the same connection.",
    ),
    claim(
      "No key, secret or token is ever printed or read back.",
      "cli: neither the command's `--json` nor `org head show` carries the API key, the secret or the ring secret; trace: no span attribute holds them.",
    ),
    claim(
      "Declining the preview connects nothing.",
      "cli: from org-with-head-site, answering no exits CANCELLED; read: `org head show` prints null; world: no diff.",
    ),
    claim(
      "A site that does not answer leaves the connection failing, and the command says so.",
      "cli: from org-with-head-site-down, the command exits PROVIDER_ERROR once its check fails; read: `org head show` prints `status: failing` with issue `unreachable`.",
    ),
  ],
  returns: flow_client_org_head_connect.output,
  errors: [error_CLI_USAGE, error_CLI_DEADLINE],
  refusals: [
    signedOut,
    notDirector(W_SITE, "connects the site"),
    {
      error: error_INVALID_INPUT,
      given: W_SITE,
      when: "The site URL is not https, or has a path, query or credentials, or the key file or team token file is not in its form: the refusal names the field and nothing is written.",
    },
    { error: error_WRONG_STATE, given: W_HEAD, when: "Acme already has a live head (connecting, connected or failing): disconnect it first. Nothing is written." },
    { error: error_CANCELLED, given: W_SITE, when: "Dana answers no at the preview: nothing is sent or written." },
    {
      error: error_CLI_USAGE,
      given: W_SITE,
      when: "A script runs it without `--confirm`, or with no terminal to prompt at and no `--key-file` (or, for `--host frappe-cloud`, no `--team-token-file`) to read a secret from: nothing is read or sent.",
    },
    { error: error_PROVIDER_ERROR, given: W_SITE_DOWN, when: "The site does not answer: the connection is kept failing, with the reason, and its process checks it again." },
  ],
  budget: budget("vendor"),
});

export const operation_org_head_disconnect = defineOperation({
  id: "org.head.disconnect",
  title: "Disconnect the Organization's head",
  about:
    "After a preview, disconnects the Organization's live head: every sync stops, Capxul keeps every record it holds and " +
    "the head keeps its own documents. The head's key is never used again, and its later rings are refused. A new " +
    "connection can be made afterwards.",
  area: AREA,
  command: "org head disconnect",
  priority: "normal",
  implementedBy: flow_client_org_head_disconnect,
  who: WHO_DIRECTOR,
  changes: "The live connection moves to disconnected, and every app concept's sync of it ends.",
  acceptance: [
    claim(
      "A Director disconnects the live head after a preview; Capxul keeps its records, and the head's next ring is refused.",
      "cli: from org-with-head, `org head disconnect --confirm --json` prints `status: disconnected` and disconnectedBy Dana's member id; read: `org head show` prints null and `org projects list` prints what it printed before; trace: the ring of the stand-in head's next edit (`capxul-devnet head edit acme …`) is answered NOT_AUTHENTICATED.",
    ),
    claim(
      "Declining the preview disconnects nothing.",
      "cli: from org-with-head, answering no exits CANCELLED; read: `org head show` still prints `status: connected`; world: no diff.",
    ),
  ],
  returns: flow_client_org_head_disconnect.output,
  errors: [error_CLI_USAGE],
  refusals: [
    signedOut,
    notDirector(W_HEAD, "disconnects the head"),
    { error: error_WRONG_STATE, given: W_MEMBER, when: "Acme has no live head: nothing is asked or written." },
    { error: error_CANCELLED, given: W_HEAD, when: "Dana answers no at the preview: nothing is written." },
    { error: error_CLI_USAGE, given: W_HEAD, when: "A script runs it without `--confirm`." },
  ],
  budget: budget("write"),
});
