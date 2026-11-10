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

export const operation_org_head_app_list = defineOperation({
  id: "org.head.app.list",
  title: "List the Organization's Frappe apps",
  about:
    "Lists the Frappe apps the Organization runs: the fundamental ones (Frappe, ERPNext's accounting and projects, " +
    "Frappe HR's payroll, Frappe CRM), held natively by Capxul from the first day, head or no head; and every other app " +
    "it asked for, which lives only on a connected head: wanted until the head installs it, installed with the version " +
    "the head runs, or removed. Use it to see what the FDE or a Director added, and what a head still has to install.",
  area: AREA,
  command: "org head app list",
  priority: "critical",
  implementedBy: rpc_organizations_apps_list,
  who: WHO_MEMBER,
  changes: NOTHING_READ,
  acceptance: [
    claim(
      "A new Organization runs the four fundamental apps, installed and native, and nothing else.",
      "cli: from org-ready, `org head app list --json` prints frappe, erpnext, hrms and crm, each `native: true`, `status: installed`, `addedBy: null`, no other app, and `nextCursor: null`.",
    ),
    claim(
      "An app asked for is listed as wanted, with who asked, until a head installs it.",
      "cli: from org-ready, after `org head app add helpdesk`, `org head app list` lists helpdesk once, `native: false`, `status: wanted`, `version: null` and addedBy Dana's member id.",
    ),
    claim(
      "The list is paged as every list is.",
      "cli: from org-ready, `org head app list --limit 2 --json` prints frappe and erpnext and a `nextCursor`; `--after <it>` prints hrms and crm and `nextCursor: null`.",
    ),
  ],
  returns: rpc_organizations_apps_list.output,
  errors: [error_CLI_USAGE],
  refusals: [
    signedOut,
    outsider(),
    { error: error_INVALID_INPUT, given: W_READY, when: "`--limit` is outside 1 to 100, or `--after` is a cursor this list did not issue: nothing is read." },
  ],
  budget: budget("read"),
});

export const operation_org_head_app_add = defineOperation({
  id: "org.head.app.add",
  title: "Add a Frappe app the Organization needs",
  about:
    "Asks for a Frappe app beyond the fundamental ones, such as Helpdesk: one Capxul can ask a head's host to install. " +
    "It lives only on a connected head, so with no head it waits, wanted; with a head on Frappe Cloud, its host is asked " +
    "to install it, and on a self-hosted head its owner installs it with bench; either way it is listed installed once " +
    "the head shows it. Adding an app already wanted, or installed on the head, changes nothing; a fundamental app is " +
    "always installed and is refused. " +
    "A Director runs it, or the Organization's FDE for a Director who asks it in conversation.",
  area: AREA,
  command: "org head app add",
  priority: "critical",
  implementedBy: rpc_organizations_apps_add,
  who: WHO_DIRECTOR_OR_FDE,
  changes: "The app's row, wanted (or wanted again), with who asked; a connected head's process then asks its host to install it.",
  acceptance: [
    claim(
      "A Director adds an app; with no head it waits, wanted, and adding it again changes nothing.",
      "cli: from org-ready, `org head app add helpdesk --json` prints helpdesk `status: wanted` and addedBy Dana's member id; the same command again prints the same; read: `org head app list` lists helpdesk once; world: one row added in all.",
    ),
    claim(
      "The hosted FDE adds an app for a Director who asks it; a member without the Director hat may not, nor the FDE for them.",
      "cli: from org-with-fde with the stand-in host holding turns, after Dana's `org fde ask … --timeout-seconds 1` (CLI_DEADLINE, her ask open), the FDE's `org head app add helpdesk --org acme --json` under it (`capxul-devnet fde run acme --ask <Dana's askId> --`) prints it wanted with addedBy Dana's member id; from org-with-member, Sam's `org head app add helpdesk` exits ROLE_PERMISSION_DENIED and the world does not change.",
    ),
    claim(
      "With a head connected, an added app is installed on the head and listed installed with the head's version.",
      "cli: from org-with-head (a Frappe Cloud head), `org head app add helpdesk`; once the head connection's process has asked the head's host and read the site again, `org head app list` prints helpdesk `status: installed` with the version the stand-in head reports; read: `org head show` lists it installed.",
    ),
  ],
  returns: rpc_organizations_apps_add.output,
  errors: [error_CLI_USAGE],
  refusals: [
    signedOut,
    notDirector(W_MEMBER, "adds an app"),
    {
      error: error_INVALID_INPUT,
      given: W_READY,
      when: "The app is not one Capxul can ask a head's host to install (`nonsense`), or is a fundamental app (`crm`): the refusal names it and nothing is written.",
    },
  ],
  budget: budget("write"),
});

export const operation_org_head_app_remove = defineOperation({
  id: "org.head.app.remove",
  title: "Stop wanting a Frappe app",
  about:
    "Stops wanting an app the Organization added, so Capxul no longer asks a head's host to install it; it stays listed " +
    "as removed. The head's owner uninstalls it on the head, and Capxul deletes none of the head's documents. A " +
    "fundamental app is never removed. Adding it again wants it again.",
  area: AREA,
  command: "org head app remove",
  priority: "normal",
  implementedBy: rpc_organizations_apps_remove,
  who: WHO_DIRECTOR_OR_FDE,
  changes: "The app's row moves to removed.",
  acceptance: [
    claim(
      "A removed app stays listed as removed, and adding it again wants it again.",
      "cli: from org-ready, after `org head app add helpdesk`, `org head app remove helpdesk --json` prints `status: removed`; `org head app list` lists it removed; `org head app add helpdesk` then prints it wanted.",
    ),
    claim(
      "A fundamental app is never removed.",
      "cli: from org-ready, `org head app remove crm` exits WRONG_STATE; read: `org head app list` still prints crm installed; world: no diff.",
    ),
  ],
  returns: rpc_organizations_apps_remove.output,
  errors: [error_CLI_USAGE],
  refusals: [
    signedOut,
    notDirector(W_MEMBER, "removes an app"),
    { error: error_INVALID_INPUT, given: W_READY, when: "The Organization never had that app (`helpdesk` in org-ready): nothing is written." },
    { error: error_WRONG_STATE, given: W_READY, when: "The app is fundamental (frappe, erpnext, hrms or crm): every Organization keeps it, and nothing is written." },
  ],
  budget: budget("write"),
});

export const operation_org_head_show = defineOperation({
  id: "org.head.show",
  title: "Show the Organization's head",
  about:
    "Shows the Organization's live head: its site and host, whether it is connecting, connected or failing and why, " +
    "Frappe's and the Capxul app's versions, its time zone, who connected it, when it was last checked and last rang, " +
    "and the Organization's apps as the head runs them. Null when there is none. It never shows a key or a token.",
  area: AREA,
  command: "org head show",
  priority: "normal",
  implementedBy: rpc_organizations_heads_show,
  who: WHO_MEMBER,
  changes: NOTHING_READ,
  acceptance: [
    claim(
      "With no head it prints null; with one, any member reads its state and its apps, and never a secret.",
      "cli: from org-with-member, `org head show --json` prints null; from org-with-head, Sam (a member with no hat) reads `status: connected`, the site, both versions, Acme's time zone and its apps, and no key, token or ring secret.",
    ),
    claim(
      "The head's apps are listed as the head runs them.",
      "cli: from org-with-head, `org head show --json` lists frappe, erpnext, hrms and crm, each `native: true`, `status: installed` and the version the stand-in head reports; read: `org head app list` prints the same four with the same versions.",
    ),
    claim(
      "It reads only what Capxul holds, so it answers while the head is down and never calls it.",
      "cli: from org-with-head-down, `org head show --json` prints `status: connected` and the `checkedAt` of the connection's last check; trace: no frappe-head span; world: no diff.",
    ),
    claim(
      "A head that stops answering shows failing, with the reason, once its daily check has failed, and connected again once a check succeeds.",
      "cli: from org-with-head-down, after `dev time warp 1d` (the connection's daily check, failing past its retries), `org head show --json` prints `status: failing` with issue `unreachable` at the warped day (the stall records the issue's `at`); after `capxul-devnet fault frappe-head clear` and another `dev time warp 1d`, it prints `status: connected`.",
    ),
    claim(
      "When the head last rang is shown on the world's clock.",
      "cli: from org-with-head, after `dev time warp 1h` and an edit by the stand-in head's own Administrator (`capxul-devnet head edit acme Designation new designation_name=Accountant --as Administrator`, which rings), `org head show --json` prints `rungAt` the warped instant.",
    ),
  ],
  returns: rpc_organizations_heads_show.output,
  errors: [error_CLI_USAGE],
  refusals: [signedOut, outsider(W_HEAD)],
  budget: budget("read"),
});

export const operation_org_head_doc_list = defineOperation({
  id: "org.head.doc.list",
  title: "List documents of a DocType on the Organization's head",
  about:
    "Lists the documents of one DocType that lives only on the connected head, such as `Job Opening` or `Appraisal`, " +
    "as your own User on the head may see them: newest change first, with each one's name, status and list fields. " +
    "`--filter <field><op><value>` (repeatable, all applying together; the operator is the longest of `=`, `!=`, `>`, " +
    "`>=`, `<`, `<=`, `~` like and `!~` not like after the field's name, and `%` in the value is like's wildcard), " +
    "`--field` (repeatable) and `--order-by` shape it. What a native concept holds (projects, the CRM, payroll and HR's " +
    "leave and expenses, the books) has its own commands, and money is never read here.",
  area: DOC_AREA,
  command: "org head doc list",
  priority: "normal",
  implementedBy: rpc_organizations_docs_list,
  who: WHO_HEAD_USER,
  changes: "Nothing on the head: the call is logged (`org head doc-call list`).",
  acceptance: [
    claim(
      "A member lists a head-only DocType's documents as their own head User sees them, newest change first.",
      "cli: from org-with-head-docs, Dana's `org head doc list \"Job Opening\" --org acme --json` prints HR-OPN-2026-0002 then HR-OPN-2026-0001 (the world changed -0002 a second later), each with docstatus 0 and its `modified`; Sam's exits ROLE_PERMISSION_DENIED, since his head User may not read Job Openings.",
    ),
    claim(
      "Filters apply together, and the list pages as every list does.",
      "cli: from org-with-head-docs, `org head doc list \"Job Opening\" --filter status=Open --limit 1 --json` prints one opening and a `nextCursor`; `--after <it>` prints the other open one and `nextCursor: null`.",
    ),
    claim(
      "A DocType a native concept owns is refused, naming its own commands: by Capxul before any call when Capxul names it, by the head's Capxul app when its module is native.",
      "cli: from org-with-head-docs, `org head doc list Employee --org acme` exits INVALID_INPUT naming `org hr employee`, with no frappe-head span in its trace; `org head doc list Project` exits INVALID_INPUT naming `org projects`, refused by the head's Capxul app; read: `org head doc-call list` shows both calls refused.",
    ),
    claim(
      "Every call is logged with whose authority it ran.",
      "read: from org-with-head-docs, after Dana's list, `org head doc-call list --org acme --json` prints one call: verb list, Job Opening, Dana's member id, head user dana@acme.test, outcome done, count 2, `at` the world's now.",
    ),
  ],
  returns: rpc_organizations_docs_list.output,
  errors: DOC_ERRORS,
  refusals: [...docRefusals("The list"), notPermitted("lists Job Openings")],
  budget: budget("vendor"),
});

export const operation_org_head_doc_get = defineOperation({
  id: "org.head.doc.get",
  title: "Show one document on the Organization's head",
  about:
    "Shows one head document by its DocType and its name on the head: every field your head User may read, its child " +
    "rows, whether it is a draft, submitted or cancelled, its Workflow state and the actions you may take, and what you " +
    "may do to it (change, submit, cancel, amend, remove). `--field` (repeatable) prints only those fields.",
  area: DOC_AREA,
  command: "org head doc get",
  priority: "normal",
  implementedBy: rpc_organizations_docs_get,
  who: WHO_HEAD_USER,
  changes: "Nothing on the head: the call is logged.",
  acceptance: [
    claim(
      "A member reads one document with its child rows, its status, and what they may do to it.",
      "cli: from org-with-head-docs, Dana's `org head doc get \"Training Event\" \"Safety training\" --org acme --json` prints docstatus 1, `status: submitted`, its `employees` rows, `permissions.cancel: true` and `permissions.remove: false`.",
    ),
    claim(
      "Under a Workflow, the actions the member may take are listed.",
      "cli: from org-with-head-docs, Dana's `org head doc get \"Job Applicant\" kim@applicants.test --json` (Frappe HR names a Job Applicant by its email) prints `workflowState: Open` and `actions: [Shortlist, Reject]`, the actions her head User's HR Manager role may take.",
    ),
  ],
  returns: rpc_organizations_docs_get.output,
  errors: DOC_ERRORS,
  refusals: [...docRefusals("The read"), unknownDoc],
  budget: budget("vendor"),
});

export const operation_org_head_doc_create = defineOperation({
  id: "org.head.doc.create",
  title: "Create a document on the Organization's head",
  about:
    "Creates a document of a DocType that lives only on the head, as your own User there, with `--set <field>=<value>` " +
    "(repeatable; the value sent as text, for the head to read as its field's type) and `--file <path>` (a JSON object " +
    "of fields with their types, child tables as arrays of rows); with both, each `--set` overrides the file's field " +
    "of that name. The head names it, " +
    "fills its defaults and runs its own checks; a submittable one is made a draft. It is the head's document: Capxul " +
    "keeps no copy of it, only the call in its log.",
  area: DOC_AREA,
  command: "org head doc create",
  priority: "normal",
  implementedBy: rpc_organizations_docs_create,
  who: WHO_HEAD_USER,
  changes: "One document on the head, made by the member's head User; one call logged.",
  acceptance: [
    claim(
      "A member creates a head document as their own head User, and Capxul keeps only the call.",
      "cli: from org-with-head-docs, Dana's `org head doc create \"Job Opening\" --set job_title=Bookkeeper --set designation=Accountant --set company=\"Acme Ltd\" --org acme --json` prints a draft named HR-OPN-2026-0003 owned by dana@acme.test; read: `org head doc get` prints it; world: no Capxul table changes but `org-doc-calls`.",
    ),
    claim(
      "The head's own checks refuse a document they would refuse in its desk, and nothing is made.",
      "cli: from org-with-head-docs, the same without `--set job_title` exits INVALID_INPUT naming the field; read: `org head doc list \"Job Opening\"` still prints two; `org head doc-call list` shows the call refused with the head's message.",
    ),
    claim(
      "It is made on the world's clock.",
      "cli: from org-with-head-docs after `dev time warp 3d`, Dana's create prints `creation` on the warped day; read: `org head doc-call list` prints `at` the warped instant.",
    ),
    claim(
      "A retried create makes one document.",
      "trace: from org-with-head-docs with the stand-in head holding its first answer back (`capxul-devnet fault frappe-head drop-answer`), the first attempt is logged refused PROVIDER_ERROR, the SDK's retry repeats the call id, the head answers the document it made, and that row is completed; read: `org head doc list \"Job Opening\"` prints three, not four, and `org head doc-call list` prints the create once, done, with `completedAt`.",
    ),
  ],
  returns: rpc_organizations_docs_create.output,
  errors: DOC_ERRORS,
  refusals: [
    ...docRefusals("The create"),
    notPermitted("creates a Job Opening"),
    { error: error_INVALID_INPUT, given: W_HEAD_DOCS, when: "A mandatory field is missing, a link names nothing, or `--file` is not a JSON object of fields: the refusal names it and nothing is made." },
  ],
  budget: budget("vendor"),
});

export const operation_org_head_doc_change = defineOperation({
  id: "org.head.doc.change",
  title: "Change a document on the Organization's head",
  about:
    "Changes a head document's fields with `--set`, `--file` or `--clear <field>` (repeatable; as create takes them, " +
    "a `--set` over the file's field and a field both set and cleared CLI_USAGE), keeping the rest. Its " +
    "status never changes here: `org head doc submit`, `cancel` and `apply` do that. A submitted document takes only the " +
    "fields its DocType lets change after submission. `--modified <stamp>`, from `org head doc get`, refuses the change if " +
    "someone changed the document since.",
  area: DOC_AREA,
  command: "org head doc change",
  priority: "normal",
  implementedBy: rpc_organizations_docs_change,
  who: WHO_HEAD_USER,
  changes: "The document's fields on the head; one call logged with the field names.",
  acceptance: [
    claim(
      "A member changes the fields given and keeps the rest.",
      "cli: from org-with-head-docs, Dana's `org head doc change \"Job Opening\" HR-OPN-2026-0001 --set planned_vacancies=2 --org acme --json` prints `planned_vacancies: 2` and the same job title; read: `org head doc-call list` names the field, not its value.",
    ),
    claim(
      "A change based on an older read is refused, and nothing is written.",
      "cli: from org-with-head-docs, Dana reads HR-OPN-2026-0001's `modified` (`org head doc get`), and after `dev time warp 90s` changes it (`--set planned_vacancies=2`); then `org head doc change \"Job Opening\" HR-OPN-2026-0001 --modified <the stamp first read> --set planned_vacancies=3` exits WRONG_STATE; read: `org head doc get` prints planned_vacancies 2. The warp is needed: the head stamps with the world's now, so on a frozen clock both changes would carry one stamp.",
    ),
  ],
  returns: rpc_organizations_docs_change.output,
  errors: DOC_ERRORS,
  refusals: [
    ...docRefusals("The change"),
    notPermitted("changes a Job Opening"),
    unknownDoc,
    { error: error_WRONG_STATE, given: W_HEAD_DOCS, when: "The document is cancelled, or submitted and the field is not one it allows after submission, or it changed since `--modified`: nothing is written." },
  ],
  budget: budget("vendor"),
});

export const operation_org_head_doc_submit = defineOperation({
  id: "org.head.doc.submit",
  title: "Submit a draft document on the Organization's head",
  about:
    "Submits a draft of a submittable DocType on the head, such as a Training Event or an Appraisal, as your own User " +
    "there: it becomes submitted and its fields are fixed, as Frappe's Submit does. A DocType under a Workflow moves by " +
    "`org head doc apply` instead.",
  area: DOC_AREA,
  command: "org head doc submit",
  priority: "normal",
  implementedBy: rpc_organizations_docs_submit,
  who: WHO_HEAD_USER,
  changes: "The document's docstatus on the head becomes submitted; one call logged.",
  acceptance: [
    claim(
      "A draft is submitted, and submitting it again is refused.",
      "cli: from org-with-head-docs, Dana's `org head doc submit \"Training Event\" \"Onboarding week\" --org acme --json` prints docstatus 1, `status: submitted`; the same again exits WRONG_STATE naming submitted.",
    ),
    claim(
      "It submits as the member's own head User, on the world's clock, and the call is logged with the docstatus it left.",
      "cli: from org-with-head-docs after `dev time warp 1d`, Dana's submit of \"Onboarding week\" prints `modified` on the warped day; read: `org head doc-call list --doctype \"Training Event\" --name \"Onboarding week\" --org acme --json` prints it: verb submit, outcome done, head user dana@acme.test, docstatus 1 and headModified that `modified`.",
    ),
    claim(
      "A DocType that is never submitted is refused, and its document stays as it was.",
      "cli: from org-with-head-docs, `org head doc submit \"Job Opening\" HR-OPN-2026-0001 --org acme` exits INVALID_INPUT; read: `org head doc get \"Job Opening\" HR-OPN-2026-0001` still prints docstatus 0; world: no diff on the head.",
    ),
    claim(
      "A retried submit submits once.",
      "trace: from org-with-head-docs with the stand-in head holding its first answer back (`capxul-devnet fault frappe-head drop-answer`), the submit of \"Onboarding week\" is logged refused PROVIDER_ERROR on its first attempt, the SDK's retry repeats the call id and the head's Capxul app answers the submit it already applied; cli: the command prints docstatus 1; read: `org head doc-call list --doctype \"Training Event\" --name \"Onboarding week\"` prints the submit once, done, with `completedAt`.",
    ),
  ],
  returns: rpc_organizations_docs_submit.output,
  errors: DOC_ERRORS,
  refusals: [
    ...docRefusals("The submit"),
    notPermitted("submits a Training Event"),
    unknownDoc,
    { error: error_WRONG_STATE, given: W_HEAD_DOCS, when: "The document is already submitted or cancelled, or its DocType is under an active Workflow: nothing is written." },
  ],
  budget: budget("vendor"),
});

export const operation_org_head_doc_cancel = defineOperation({
  id: "org.head.doc.cancel",
  title: "Cancel a submitted document on the Organization's head",
  about:
    "Cancels a submitted head document, as Frappe's Cancel does: it is kept, cancelled for good, and `org head doc amend` " +
    "makes its correction. A document that submitted documents still link to cannot be cancelled until they are, and " +
    "one under a Workflow moves only by `org head doc apply`.",
  area: DOC_AREA,
  command: "org head doc cancel",
  priority: "normal",
  implementedBy: rpc_organizations_docs_cancel,
  who: WHO_HEAD_USER,
  changes: "The document's docstatus on the head becomes cancelled; one call logged.",
  acceptance: [
    claim(
      "A submitted document is cancelled and kept.",
      "cli: from org-with-head-docs, Dana's `org head doc cancel \"Training Event\" \"Safety training\" --org acme --json` prints docstatus 2, `status: cancelled`; read: `org head doc get` still prints it.",
    ),
    claim(
      "A draft cannot be cancelled.",
      "cli: from org-with-head-docs, `org head doc cancel \"Training Event\" \"Onboarding week\"` exits WRONG_STATE naming draft; world: no diff on the head.",
    ),
  ],
  returns: rpc_organizations_docs_cancel.output,
  errors: DOC_ERRORS,
  refusals: [
    ...docRefusals("The cancel"),
    notPermitted("cancels a Training Event"),
    unknownDoc,
    { error: error_WRONG_STATE, given: W_HEAD_DOCS, when: "The document is a draft or already cancelled, under an active Workflow, or still linked from a submitted document: nothing is written." },
  ],
  budget: budget("vendor"),
});

export const operation_org_head_doc_amend = defineOperation({
  id: "org.head.doc.amend",
  title: "Amend a cancelled document on the Organization's head",
  about:
    "Makes the correction of a cancelled head document, as Frappe's Amend does: a new draft copied from it, whose " +
    "`amended_from` names it and whose name, by Frappe's default, is the old one with `-1` (an amendment's amendment " +
    "`-2`). Change and submit the draft as any other.",
  area: DOC_AREA,
  command: "org head doc amend",
  priority: "normal",
  implementedBy: rpc_organizations_docs_amend,
  who: WHO_HEAD_USER,
  changes: "One new draft on the head; one call logged.",
  acceptance: [
    claim(
      "A cancelled document is amended into a new draft that names it.",
      "cli: from org-with-head-docs, Dana's `org head doc amend \"Training Event\" \"Old induction\" --org acme --json` prints a draft named `Old induction-1` with `amendedFrom: Old induction`; amending a submitted one exits WRONG_STATE.",
    ),
    claim(
      "The amendment is a draft like any other, and the cancelled document it corrects stays cancelled.",
      "cli: from org-with-head-docs, after Dana's amend of \"Old induction\", `org head doc submit \"Training Event\" \"Old induction-1\" --org acme --json` prints docstatus 1; read: `org head doc get \"Training Event\" \"Old induction\"` still prints `status: cancelled`.",
    ),
    claim(
      "An amendment's amendment takes the next number.",
      "cli: from org-with-head-docs, after amending \"Old induction\", submitting `Old induction-1` and cancelling it (`org head doc cancel`), `org head doc amend \"Training Event\" \"Old induction-1\" --org acme --json` prints a draft named `Old induction-2` with `amendedFrom: Old induction-1`.",
    ),
    claim(
      "A retried amend makes one amendment.",
      "trace: from org-with-head-docs with the stand-in head holding its first answer back (`capxul-devnet fault frappe-head drop-answer`), the amend's first attempt is logged refused PROVIDER_ERROR, the SDK's retry repeats the call id and the head answers the draft it made; cli: the command prints the draft `Old induction-1` with `amendedFrom: Old induction`; read: `org head doc list \"Training Event\" --filter \"amended_from=Old induction\" --org acme` lists one document, `Old induction-1`, and `org head doc-call list` prints the amend once, done, with `completedAt`.",
    ),
  ],
  returns: rpc_organizations_docs_amend.output,
  errors: DOC_ERRORS,
  refusals: [
    ...docRefusals("The amend"),
    notPermitted("amends a Training Event"),
    unknownDoc,
    { error: error_WRONG_STATE, given: W_HEAD_DOCS, when: "The document is not cancelled: nothing is made." },
  ],
  budget: budget("vendor"),
});

export const operation_org_head_doc_apply = defineOperation({
  id: "org.head.doc.apply",
  title: "Take a Workflow action on a document on the Organization's head",
  about:
    "Takes one action of the Workflow a head DocType runs under (such as Shortlist or Reject on a Job Applicant), as " +
    "your own User there: the document moves to the action's next state, submitting or cancelling it when that state " +
    "says so. `org head doc get` lists the actions you may take.",
  area: DOC_AREA,
  command: "org head doc apply",
  priority: "normal",
  implementedBy: rpc_organizations_docs_apply,
  who: WHO_HEAD_USER,
  changes: "The document's Workflow state on the head, and its docstatus where the next state sets one; one call logged.",
  acceptance: [
    claim(
      "An action moves the document to its next state.",
      "cli: from org-with-head-docs, Dana's `org head doc apply \"Job Applicant\" kim@applicants.test Shortlist --org acme --json` prints `workflowState: Shortlisted` and its next actions.",
    ),
    claim(
      "An action the document's state does not offer is refused.",
      "cli: from org-with-head-docs, `org head doc apply \"Job Applicant\" kim@applicants.test Accept` while it is Open exits WRONG_STATE naming Open; world: no diff on the head.",
    ),
  ],
  returns: rpc_organizations_docs_apply.output,
  errors: DOC_ERRORS,
  refusals: [
    ...docRefusals("The action"),
    notPermitted("shortlists a Job Applicant"),
    unknownDoc,
    { error: error_WRONG_STATE, given: W_HEAD_DOCS, when: "The action is not one the document's current state offers: the refusal names the state and nothing is written." },
  ],
  budget: budget("vendor"),
});

export const operation_org_head_doc_remove = defineOperation({
  id: "org.head.doc.remove",
  title: "Delete a document on the Organization's head",
  about:
    "Deletes a head document that is not submitted (a draft, a cancelled one, or one of a DocType that is never " +
    "submitted), as Frappe's Delete does, after a preview, since it cannot be undone from Capxul; `--confirm` answers " +
    "yes in a script. A submitted document is cancelled, never deleted.",
  area: DOC_AREA,
  command: "org head doc remove",
  priority: "normal",
  implementedBy: flow_client_org_head_docs_remove,
  who: `${WHO_HEAD_USER} Never the hosted FDE for its asker: the preview is the member's own (organizations.fde-for-the-asker).`,
  changes: "The document is deleted on the head (which keeps its own Deleted Document record); two calls logged, the read and the delete.",
  acceptance: [
    claim(
      "A draft is deleted after a preview.",
      "cli: from org-with-head-docs, Dana's `org head doc remove \"Training Event\" \"Onboarding week\" --confirm --org acme --json` prints `removed: true`; read: `org head doc get` of it then exits INVALID_INPUT.",
    ),
    claim(
      "A submitted document is never deleted, and declining the preview deletes nothing.",
      "cli: from org-with-head-docs, removing \"Safety training\" exits WRONG_STATE; answering no at the preview for \"Onboarding week\" exits CANCELLED; world: no diff on the head after either.",
    ),
  ],
  returns: flow_client_org_head_docs_remove.output,
  errors: [error_CLI_USAGE],
  refusals: [
    ...docRefusals("The delete"),
    notPermitted("deletes a Training Event"),
    unknownDoc,
    { error: error_WRONG_STATE, given: W_HEAD_DOCS, when: "The document is submitted, or a document that is not cancelled still links to it: nothing is deleted." },
    { error: error_CANCELLED, given: W_HEAD_DOCS, when: "Dana answers no at the preview: nothing is deleted." },
    {
      error: error_ROLE_PERMISSION_DENIED,
      given: "org-with-fde-head-docs",
      when: "The hosted FDE runs it under Dana's open ask (the stand-in host holding her turn, `capxul-devnet fault fde-host hold`): the preview is Dana's own to answer (organizations.fde-for-the-asker), and nothing is deleted.",
    },
    { error: error_CLI_USAGE, given: W_HEAD_DOCS, when: "A script runs it without `--confirm`: nothing is read or deleted." },
  ],
  budget: budget("vendor"),
});

export const operation_org_head_doctype_list = defineOperation({
  id: "org.head.doctype.list",
  title: "List the head's DocTypes that the document family reaches",
  about:
    "Lists the DocTypes of the apps on the connected head that `org head doc` reaches, by name, with each one's app and " +
    "module and whether it is submitted. `--all` lists every other one too, with why it is not reached: a native one " +
    "names the commands that reach it, a money one is Capxul's, and the head's machinery is never reached. `--app` and " +
    "`--module` narrow it.",
  area: DOC_AREA,
  command: "org head doctype list",
  priority: "normal",
  implementedBy: rpc_organizations_doctypes_list,
  who: WHO_HEAD_USER,
  changes: "Nothing on the head: the call is logged.",
  acceptance: [
    claim(
      "A member sees which head DocTypes the family reaches, and with `--all` why the rest are not.",
      "cli: from org-with-head-docs, `org head doctype list --app hrms --org acme --json` lists Job Opening, Job Applicant and Training Event `reach: reachable` and no Leave Application; with `--all` it also lists Leave Application `reach: native` naming `hr leave` and `org hr leave`, and Expense Claim `reach: native` naming `hr expense-claim` and `org hr expense-claim`; `--app erpnext --all` lists Stock Entry `reach: money`.",
    ),
    claim(
      "`--module` narrows it, and a native module's DocType names that module's commands.",
      "cli: from org-with-head-docs, `org head doctype list --app erpnext --module Projects --all --org acme --json` lists Project `reach: native` with `commands` naming `org projects`, and no DocType of another module.",
    ),
    claim(
      "Child tables are never listed: each is reached only through its parent.",
      "cli: from org-with-head-docs, `org head doctype list --app hrms --all --org acme --json` lists Training Event and no Training Event Employee, whose rows `org head doc get \"Training Event\" \"Safety training\"` prints under `employees`.",
    ),
    claim(
      "The list pages by name.",
      "cli: from org-with-head-docs, `org head doctype list --app hrms --limit 2 --org acme --json` prints two DocTypes in name order and a `nextCursor`; `--after <it>` prints those that follow them by name, neither repeated.",
    ),
    claim(
      "Every call is logged, as a read of the head.",
      "read: from org-with-head-docs, after Dana's `org head doctype list --app hrms`, `org head doc-call list --org acme --json` prints the call: verb doctypes, outcome done, Dana's member id and head user dana@acme.test; world: no Capxul table changes but `org-doc-calls`, and none on the head.",
    ),
  ],
  returns: rpc_organizations_doctypes_list.output,
  errors: DOC_ERRORS,
  refusals: [
    signedOut,
    outsider(W_HEAD),
    { error: error_WRONG_STATE, given: W_MEMBER, when: "Acme has no connected head: the head is not called." },
    { error: error_INVALID_INPUT, given: W_HEAD_DOCS, when: "`--app` or `--module` names none the head has, or `--limit` or `--after` is not one this list takes: nothing is read." },
    { error: error_PROVIDER_ERROR, given: W_HEAD_DOWN, when: "The head does not answer." },
  ],
  budget: budget("vendor"),
});

export const operation_org_head_doctype_get = defineOperation({
  id: "org.head.doctype.get",
  title: "Show one of the head's DocTypes: its fields, Workflow and your rights",
  about:
    "Shows one DocType on the connected head: its fields and child tables with their types and which are mandatory, " +
    "whether it is submitted, its Workflow's states and actions, what your head User may do with it, and whether " +
    "`org head doc` reaches it or which commands do. Use it to know what `org head doc create --set` takes.",
  area: DOC_AREA,
  command: "org head doctype get",
  priority: "normal",
  implementedBy: rpc_organizations_doctypes_get,
  who: WHO_HEAD_USER,
  changes: "Nothing on the head: the call is logged.",
  acceptance: [
    claim(
      "A member reads a DocType's fields, child tables, Workflow and their own rights on it.",
      "cli: from org-with-head-docs, Dana's `org head doctype get \"Job Opening\" --org acme --json` prints `reach: reachable`, job_title, company and designation `required: true`, and `permissions.create: true`; Sam's prints `permissions.create: false`.",
    ),
    claim(
      "A native DocType is described, with the commands that reach it.",
      "cli: from org-with-head-docs, `org head doctype get Employee --json` prints `reach: native` and `commands` naming `org hr employee`.",
    ),
  ],
  returns: rpc_organizations_doctypes_get.output,
  errors: DOC_ERRORS,
  refusals: [
    signedOut,
    outsider(W_HEAD),
    { error: error_WRONG_STATE, given: W_MEMBER, when: "Acme has no connected head: the head is not called." },
    { error: error_INVALID_INPUT, given: W_HEAD_DOCS, when: "The head has no DocType of that name: nothing is read." },
    { error: error_PROVIDER_ERROR, given: W_HEAD_DOWN, when: "The head does not answer." },
  ],
  budget: budget("vendor"),
});

export const operation_org_head_doc_call_list = defineOperation({
  id: "org.head.doc-call.list",
  title: "List the document family's calls to the head: who, what and when",
  about:
    "Lists the calls `org head doc` and `org head doctype` made to the head, newest first: whose authority each ran with (a " +
    "member's, or the FDE's for the member who asked it), the head User, what it did to which document, and whether it " +
    "was done or refused and why; never a field's value. A Director sees every call; any other member sees the calls " +
    "made with their own authority. `--doctype`, `--name` and, for a Director, `--member` narrow it.",
  area: DOC_AREA,
  command: "org head doc-call list",
  priority: "normal",
  implementedBy: rpc_organizations_doc_calls_list,
  who: "Any member: a Director reads every call; anyone else the calls made with their own authority (organizations.doc-log).",
  changes: NOTHING_READ,
  acceptance: [
    claim(
      "A Director sees every call; another member sees only their own.",
      "cli: from org-with-head-docs, after Dana's and Sam's `org head doc list \"Job Opening\"`, Dana's `org head doc-call list --org acme --json` prints both calls, Sam's refused; Sam's prints only his own.",
    ),
    claim(
      "A call the FDE made for a member is logged under that member, with the ask.",
      "cli: from org-with-fde-head-docs with turns held, after Dana's `org fde ask … --timeout-seconds 1` (CLI_DEADLINE, her ask open), the FDE's `org head doc list \"Job Opening\"` under her ask (`capxul-devnet fde run acme --ask <it> --`) is printed by `org head doc-call list` with memberId Dana's, her askId and head user dana@acme.test.",
    ),
  ],
  returns: rpc_organizations_doc_calls_list.output,
  errors: [error_CLI_USAGE],
  refusals: [
    signedOut,
    outsider(W_HEAD),
    { error: error_INVALID_INPUT, given: W_HEAD_DOCS, when: "`--name` without `--doctype`, `--member` from someone who is not a Director or naming no member, or a bad `--limit` or `--after`: nothing is read." },
  ],
  budget: budget("read"),
});

/** The eight operations of the pack organizations.commands, for its `affects`; `org seats show` is organizations.buy-seats'. */
export const NEW_OPERATIONS = [
  operation_org_head_app_list, operation_org_head_app_add, operation_org_head_app_remove, operation_org_head_show,
  
];

/** The document family's twelve operations, the pack organizations.doc-family's. */
export const DOC_OPERATIONS = [
  operation_org_head_doc_list, operation_org_head_doc_get, operation_org_head_doc_create, operation_org_head_doc_change, operation_org_head_doc_submit,
  operation_org_head_doc_cancel, operation_org_head_doc_amend, operation_org_head_doc_apply, operation_org_head_doc_remove,
  operation_org_head_doctype_list, operation_org_head_doctype_get, operation_org_head_doc_call_list,
];
