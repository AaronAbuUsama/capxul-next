// The organizations concept's Core SDK flows (A4): one SDK method per operation that composes
// rpcs and local steps. The CLI calls exactly that method. Signing the install batch happens on
// the approval page (approvals' surface, in the browser): the flow opens it and waits; the CLI
// signs nothing itself. Operations whose SDK method is one rpc call are implemented by that rpc
// directly (operations.ts).

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

const SDK = "packages/sdk/src";
const S = Schema.String;
const N = Schema.Number;
const NullOr = Schema.NullOr;

const Lifecycle = Schema.Struct({ organizationId: S, lifecycle: SetupView });
/** The SDK's own deadline over a write and the setup it starts: 120 s by default, 1 to 3600. */
const Deadline = { timeoutSeconds: Schema.optionalKey(N) };
/** How long `org fde ask` waits for the FDE's turn: 300 s by default, 1 to 3600. */
const AskDeadline = { timeoutSeconds: Schema.optionalKey(N) };
/** Without an id, the SDK takes the saved choice, else the one unfinished setup the caller founded. */
const OrgChoice = { orgId: Schema.optionalKey(S) };

export const flow_client_onboarding_begin_organization = defineFlow({
  id: "client.onboarding.begin-organization",
  title: "Create an Organization and follow its setup to ready",
  about:
    "`org create`. It begins the Organization (one write, which starts the setup process), saves its ID on this machine " +
    "at once so a stopped command resumes it by handle, and subscribes to its setup. When the setup waits for the " +
    "founder's authorization it reads the install approval (approvals') until it is sponsored and hands the founder its " +
    "approval page in the browser, where their own signer signs it (approvals' `client.approvals.sign`), then follows " +
    "the setup until it is ready or stops, within one deadline over the write and " +
    "its setup. At the deadline it stops waiting and the setup carries on. The CLI shows the preview and asks before it " +
    "calls this method. Start-up (organizations.startup, organizations.fde-at-start-up): unless `fde` is false " +
    "(`--no-fde`), the setup asks Capxul's FDE host to make the Organization's Forward Deployed Engineer, whose key the " +
    "host keeps (aaron.fde-hosted), so the founder's one install signature also creates the FDE; this machine makes and " +
    "keeps no key for it, and a resume from any machine finds the same FDE.",
  was: [`${SDK}/profiles/organization-onboarding.ts:83`, "docs/as-is/archive/organizations/flows.ts:55"],
  component: component_core_sdk,
  sdk: "client.onboarding.beginOrganization",
  input: Schema.Struct({
    name: S,
    handle: S,
    country: S,
    bio: Schema.optionalKey(S),
    size: Schema.optionalKey(S),
    logoFileId: Schema.optionalKey(S),
    currency: Schema.optionalKey(S),
    timeZone: Schema.optionalKey(S),
    fiscalYearStart: Schema.optionalKey(S),
    apps: Schema.optionalKey(Schema.Array(S)),
    /** False starts the Organization without its hosted FDE (`--no-fde`), and so without paying to host one. */
    fde: Schema.optionalKey(Schema.Boolean),
    ...Deadline,
  }),
  output: Lifecycle,
  steps: [
    { name: "begin", rpc: rpc_organizations_setups_begin, about: "Create the Organization, its Party and its setup, or resume the same intent." },
    { name: "save", local: "cache", about: "Record the Organization ID and handle on this machine before anything else can fail." },
    { name: "watch", rpc: rpc_organizations_setups_get, about: "Subscribe to the setup's changes." },
    { name: "await-authorization", local: "wait", about: "While the Safe is minted and the money deployed (chain), until the install approval is open or setup stops." },
    { name: "approval", rpc: rpc_approvals_signing_get, about: "Read the install approval live until it is sponsored, with its page link." },
    { name: "sign", local: "sign", about: "Hand the founder the approval page in the browser; their own Openfort signer signs the batch there." },
    { name: "await-ready", local: "wait", about: "Follow the setup until ready or stopped, or the deadline." },
  ],
  errors: [],
  calls: [],
  spans: [],
  budget: budget("write"),
});

export const flow_client_org_setup_resume = defineFlow({
  id: "client.org.setup.resume",
  title: "Resume one Organization's setup",
  about:
    "`org retry`. It reads the setup once: waiting for the founder's authorization, it opens the install approval on the " +
    "approval page; needing attention or still processing, it asks the setup process to carry on (`resume`); ready, it " +
    "returns at once. Then it follows the setup until it is ready or stops, within the deadline. It never creates an " +
    "Organization and never signs anything but the open install approval.",
  was: [`${SDK}/organizations/setup-adapter.ts:118`, "docs/as-is/archive/organizations/setups.ts:318"],
  component: component_core_sdk,
  sdk: "client.org(orgId).setup.resume",
  input: Schema.Struct({ orgId: S, ...Deadline }),
  output: Lifecycle,
  steps: [
    { name: "watch", rpc: rpc_organizations_setups_get, about: "Subscribe to the setup; its first answer decides the next step." },
    { name: "resume", rpc: rpc_organizations_setups_resume, about: "When it needs attention or is processing: ask the process to carry on." },
    { name: "approval", rpc: rpc_approvals_signing_get, about: "When it waits for the founder: read the install approval until it is sponsored." },
    { name: "sign", local: "sign", about: "Hand the founder the approval page in the browser, where their own signer signs." },
    { name: "await-ready", local: "wait", about: "Follow the subscription until ready or stopped, or the deadline." },
  ],
  errors: [],
  calls: [],
  spans: [],
  budget: budget("write"),
});

export const flow_client_org_setup_get = defineFlow({
  id: "client.org.setup.get",
  title: "Read where an Organization's setup stands",
  about:
    "`org show`. With no Organization given and no choice saved on this machine, it lists the caller's Organizations and " +
    "takes the one unfinished setup they founded (several, or none, is the CLI's usage refusal); then it reads the setup " +
    "once. It never writes and never moves the setup on.",
  was: [`${SDK}/organizations/setup-adapter.ts:82`, "docs/as-is/archive/organizations/setups.ts:247"],
  component: component_core_sdk,
  sdk: "client.org(orgId).setup.get",
  input: Schema.Struct(OrgChoice),
  output: SetupView,
  steps: [
    { name: "choice", local: "cache", about: "Read the Organization saved with `use org` on this machine." },
    { name: "find", rpc: rpc_organizations_workspaces_list, about: "With no id and no saved choice: the caller's unfinished setups." },
    { name: "read", rpc: rpc_organizations_setups_get, about: "Read the setup once." },
  ],
  errors: [],
  calls: [],
  spans: [],
  budget: budget("read"),
});

export const flow_client_org_setup_subscribe = defineFlow({
  id: "client.org.setup.subscribe",
  title: "Follow an Organization's setup until it is ready or stops",
  about:
    "`org wait`. It chooses the Organization as `org show` does, then holds one live subscription to its setup and " +
    "returns each change, with no polling, until the setup is ready, failed, waiting for the founder's authorization, or " +
    "needing attention with nothing that will move it but `org retry`. Cancelling it, or its deadline, only stops the " +
    "subscription: it never resumes or submits anything.",
  was: [`${SDK}/organizations/setup-adapter.ts:176`, "apps/cli/src/commands/org/subcommands/wait"],
  component: component_core_sdk,
  sdk: "client.org(orgId).setup.subscribe",
  input: Schema.Struct({ ...OrgChoice, ...Deadline }),
  output: Schema.Struct({ status: S, recovery: S, setup: SetupView }),
  steps: [
    { name: "choice", local: "cache", about: "Read the Organization saved with `use org` on this machine." },
    { name: "find", rpc: rpc_organizations_workspaces_list, about: "With no id and no saved choice: the caller's unfinished setups." },
    { name: "watch", rpc: rpc_organizations_setups_get, about: "Subscribe to the setup." },
    { name: "await-stop", local: "wait", about: "Until a stopping state or the deadline." },
  ],
  errors: [],
  calls: [],
  spans: [],
  budget: budget("live-read"),
});

export const flow_client_orgs_use = defineFlow({
  id: "client.orgs.use",
  title: "Act as one of your Organizations on this machine",
  about:
    "`use org`. It lists the caller's Organizations, matches the one named by ID or by handle (ignoring case and a " +
    "leading `@`), and saves it as this machine's default only when the caller holds a Seat there. A name that matches " +
    "none leaves the saved choice as it was. Saving grants nothing: every command is still checked by the backend.",
  was: [`${SDK}/organizations/scope.ts:157`, "apps/cli/src/commands/use/subcommands/org/command.ts"],
  component: component_core_sdk,
  sdk: "client.orgs",
  input: Schema.Struct({ org: S }),
  output: Schema.Struct({ actingAs: Schema.Struct({ kind: Schema.Literal("organization"), handle: S, orgId: S }) }),
  steps: [
    { name: "list", rpc: rpc_organizations_workspaces_list, about: "The caller's Organizations, page by page, until the name matches." },
    { name: "save", local: "cache", about: "Save the match as this machine's default Organization." },
  ],
  errors: [],
  calls: [],
  spans: [],
  budget: budget("read"),
});

export const flow_client_org_members_get = defineFlow({
  id: "client.org.members.get",
  title: "Show one member, found by their Account ID",
  about:
    "`org member get`. It reads the same member list as `org member list` and returns the Seat with that Account ID. With " +
    "no ID at a terminal, it offers the members that have an Account ID to pick from; an ID no member has, or nobody to " +
    "pick, is INVALID_INPUT.",
  was: [`${SDK}/organizations/adapter.ts:87`, "apps/cli/src/commands/org/subcommands/member/get"],
  component: component_core_sdk,
  sdk: "client.org(orgId).members",
  input: Schema.Struct({ orgId: S, accountId: Schema.optionalKey(S) }),
  output: MemberView,
  steps: [
    { name: "list", rpc: rpc_organizations_members_list, about: "The Organization's members, page by page." },
    { name: "pick", local: "prompt", about: "At a terminal with no Account ID: pick one of the members that have one." },
  ],
  errors: [error_INVALID_INPUT],
  calls: [],
  spans: [],
  budget: budget("read"),
});

export const flow_client_orgs_invitations = defineFlow({
  id: "client.orgs.invitations",
  title: "List the invitations sent to you, or with an Organization those it sent",
  about:
    "`invite list`. Without an Organization it lists the caller's own offers from every Organization and never uses a " +
    "saved choice; with `--org` it lists that Organization's sent invitations instead, which needs the People hat.",
  was: [`${SDK}/organizations/invitations.ts:1`, "docs/as-is/archive/organizations/invitations.ts:215"],
  component: component_core_sdk,
  sdk: "client.orgs.invitations",
  input: Schema.Struct({
    orgId: Schema.optionalKey(S),
    limit: Schema.optionalKey(N),
    phases: Schema.optionalKey(Schema.Array(Phase)),
    after: Schema.optionalKey(S),
  }),
  output: Schema.Struct({ items: Schema.Array(InvitationView), nextCursor: NullOr(S), observedAt: N }),
  steps: [
    { name: "mine", rpc: rpc_organizations_invitations_list_mine, about: "Without an Organization: the caller's own offers." },
    { name: "sent", rpc: rpc_organizations_invitations_list, about: "With `--org`: the Organization's sent invitations." },
  ],
  errors: [],
  calls: [],
  spans: [],
  budget: budget("read"),
});

export const flow_client_operator_organizations_seats_raise = defineFlow({
  id: "client.operator.organizations.seats.raise",
  title: "The operator's tool raises an Organization's seat limit",
  about:
    "Serves the operator's tool, run with the deployment's operator key, not the CLI: no frozen operation raises a seat " +
    "limit. An Organization buys seats itself through payments (organizations.buy-seats); this is the operator's raise " +
    "beside it (aaron.buy-seats). It sends the Organization, the new limit and the operator's label to " +
    "`organizations.seats.raise` and prints the limit, what counts against it and the seats bought.",
  component: component_core_sdk,
  surfaces: ["sdk"],
  sdk: "client.operator.organizations.seats.raise",
  input: Schema.Struct({ orgId: S, seats: N, by: S }),
  output: SeatsView,
  steps: [{ name: "raise", rpc: rpc_organizations_seats_raise, about: "Raises the limit in one transaction." }],
  errors: [],
  calls: [],
  spans: [],
  budget: budget("write"),
  was: ["books/target/shared/rulings.ts (aaron.seats, aaron.buy-seats)"],
});

// ── the head and the hosted FDE (organizations.commands) ────────────────────────────────────

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

export const flow_client_org_fde_ask = defineFlow({
  id: "client.org.fde.ask",
  title: "Ask the hosted FDE something, and print its reply when its turn ends",
  about:
    "`org fde ask` (organizations.fde-commands, aaron.fde-hosted, aaron.fde-anyone), for any member or a guest the " +
    "management named. It sends the message to the Organization's hosted FDE through Capxul (one call, which records " +
    "who asked and gives the FDE an act-for token for that turn: whatever the FDE does, it does as the asker), then " +
    "waits for the FDE's turn, reading it from the host every few seconds, until it ends with the FDE's reply, fails " +
    "with the host's reason, or the deadline passes (300 seconds by default, 1 to 3,600). A turn the host answers " +
    "failed ends PROVIDER_ERROR with the host's reason; the ask stays recorded. At the deadline it stops waiting " +
    "(CLI_DEADLINE) and prints the ask's id and the turn's, which `org fde turn get` reads later; the FDE carries on, " +
    "and the ask stays open for it until a read finds the turn ended (or FDE_ASK_HOURS pass). A turn read ended here " +
    "closes the ask at once, so on a devnet, whose stand-in host ends a turn as it is posted, an eval that runs the " +
    "FDE's commands under an ask holds the turn first (`capxul-devnet fault fde-host hold`). When the FDE " +
    "needs the asker's signature it hands the approval to the asker, who signs it on the approval page. The FDE's turn " +
    "is a wait, never system time.",
  component: component_core_sdk,
  sdk: "client.org(orgId).fde.ask",
  input: Schema.Struct({ orgId: S, message: S, ...AskDeadline }),
  output: TurnView,
  steps: [
    { name: "send", rpc: rpc_organizations_fde_ask, about: "Post the message to the FDE's conversation, with its act-for token, and record the ask." },
    { name: "await-turn", local: "wait", about: "Until the FDE's turn ends or fails, or the deadline." },
    { name: "turn", rpc: rpc_organizations_fde_turn, about: "Read the turn from the host, every few seconds while it works, and its reply once it ends." },
  ],
  errors: [error_PROVIDER_ERROR],
  calls: [],
  spans: [],
  budget: { ...budget("vendor"), excludes: ["wait.await-turn"] },
});

// ── the document family (organizations.doc-family) ─────────────────────────────────────────

export const flow_client_org_head_docs_remove = defineFlow({
  id: "client.org.head.docs.remove",
  title: "Delete a head document after a preview",
  about:
    "`org head doc remove` (organizations.doc-family, aaron.sdk-reaches-everything). Deleting a head document cannot be " +
    "undone from Capxul, so it reads the document first (one logged read: a name the head lacks, or one the member may " +
    "not read, ends there), shows its DocType, name, title and status and that it cannot be undone, and asks; no is " +
    "CANCELLED and nothing is deleted, and `--confirm` answers yes in a script, which without it is the CLI's usage " +
    "refusal (vocabulary.declined-preview-cancelled). Then it deletes it in one call, with the same call id on a retry.",
  component: component_core_sdk,
  sdk: "client.org(orgId).head.docs.remove",
  input: Schema.Struct({ orgId: S, doctype: S, name: S, confirm: Schema.optionalKey(Schema.Boolean) }),
  output: rpc_organizations_docs_remove.output,
  steps: [
    { name: "read", rpc: rpc_organizations_docs_get, about: "Read the document once, for the preview." },
    { name: "confirm", local: "prompt", about: "Only at a terminal without `confirm`: show what is deleted and ask; no is CANCELLED." },
    { name: "remove", rpc: rpc_organizations_docs_remove, about: "Delete it on the head, as the member's own User." },
  ],
  errors: [error_CANCELLED],
  calls: [],
  spans: [],
  budget: { ...budget("vendor"), why: "one read and one write of the head, each followed by its log write" },
});
