// The organizations concept's Core SDK flows (A4): one SDK method per operation that composes
// rpcs and local steps. The CLI calls exactly that method. Signing the install batch happens on
// the approval page (approvals' surface, in the browser): the flow opens it and waits; the CLI
// signs nothing itself. Operations whose SDK method is one rpc call are implemented by that rpc
// directly (operations.ts).

import { Schema } from "effect";
import { budget, defineFlow } from "../../../packages/book/src/index.ts";
import { component_core_sdk } from "../shared/foundation.ts";
import { error_INVALID_INPUT } from "../shared/vocabulary.ts";
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
    "calls this method.",
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
    "limit, and nobody in an Organization may (aaron.seats). It sends the Organization, the new limit and the " +
    "operator's label to `organizations.seats.raise` and prints the limit and what counts against it.",
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
  was: ["books/target/shared/rulings.ts (aaron.seats)"],
});
