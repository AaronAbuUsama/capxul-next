// The organizations concept's own judgments (CONVENTIONS rule 10). Made by Claude on 8 November
// 2026 under the accepted decisions A1-A4 and P1-P10 and the shared architecture records, with the
// old code (/home/user/factory, integration/factory) and the as-is book as evidence.

import { defineDecision } from "../../../packages/book/src/index.ts";
import { concept_activity, concept_board, concept_budgets, concept_notices, concept_organizations, concept_parties } from "../shared/foundation.ts";
import { error_CANCELLED, error_FEATURE_NOT_AVAILABLE, error_SEAT_LIMIT_REACHED, error_WRONG_STATE } from "../shared/vocabulary.ts";
import {
  event_org_invite_transitioned,
  event_org_member_transitioned,
  event_org_setup_transitioned,
  machine_org_invite,
  machine_org_member,
  machine_org_setup,
  table_org_deployments,
  table_org_invitations,
  table_org_members,
  table_org_setups,
  table_organizations,
} from "./data.ts";
import {
  procedure_organizations_add_bought_seats,
  procedure_organizations_bind_invitation_grants,
  procedure_organizations_return_bought_seats,
} from "./procedures.ts";
import { rpc_organizations_setups_begin, rpc_organizations_setups_get, rpc_organizations_setups_resume } from "./setups.ts";
import { rpc_organizations_workspaces_list, rpc_organizations_workspaces_me } from "./workspaces.ts";
import { rpc_organizations_members_list, rpc_organizations_seats_raise } from "./members.ts";
import {
  rpc_organizations_invitations_accept,
  rpc_organizations_invitations_cancel,
  rpc_organizations_invitations_decline,
  rpc_organizations_invitations_invite,
  rpc_organizations_invitations_list,
  rpc_organizations_invitations_resend,
} from "./invitations.ts";
import {
  workflow_organizations_invitations_follow,
  workflow_organizations_members_end_agent_seats,
  workflow_organizations_setups_set_up,
} from "./processes.ts";
import {
  flow_client_onboarding_begin_organization,
  flow_client_org_members_get,
  flow_client_org_setup_get,
  flow_client_org_setup_resume,
  flow_client_org_setup_subscribe,
  flow_client_orgs_invitations,
  flow_client_operator_organizations_seats_raise,
  flow_client_orgs_use,
} from "./flows.ts";
import {
  operation_invite_decline,
  operation_invite_list,
  operation_org_create,
  operation_org_invite_cancel,
  operation_org_invite_list,
  operation_org_invite_resend,
  operation_org_list,
  operation_org_me,
  operation_org_member_get,
  operation_org_member_list,
  operation_org_retry,
  operation_org_show,
  operation_org_wait,
  operation_use_org,
} from "./operations.ts";

import {
  concept_books,
  concept_contacts,
  concept_payroll,
  concept_projects,
  component_frappe_app,
  system_capxul,
} from "../shared/foundation.ts";
import { contract_agent_owner, integration_frappe_head } from "../shared/external.ts";
import {
  event_org_head_transitioned,
  event_seat_purchase_transitioned,
  machine_org_app,
  machine_org_head,
  machine_seat_purchase,
  table_org_apps,
  table_org_heads,
  table_org_seat_purchases,
} from "./data.ts";
import { rpc_organizations_heads_ring } from "./heads.ts";
import { workflow_organizations_heads_watch as workflow_heads_watch } from "./processes.ts";

const CLAUDE = "Claude, organizations design, 8 November 2026";
const by = (evidence: string) => `${CLAUDE}; evidence: ${evidence}`;

const ALL_OPERATIONS = [
  operation_org_create, operation_org_list, operation_org_me, operation_org_retry, operation_org_show, operation_org_wait,
  operation_use_org, operation_org_member_list, operation_org_member_get, operation_invite_list, operation_invite_decline,
  operation_org_invite_list, operation_org_invite_cancel, operation_org_invite_resend,
];

// ── data ────────────────────────────────────────────────────────────────────────────────────

export const decision_organizations_tables = defineDecision({
  id: "organizations.tables",
  title: "Five tables from the old nineteen: the workspace's own records only",
  question: "Which of the old concept's tables does the target workspace keep, merge or drop?",
  options: [
    {
      label: "five",
      text:
        "organizations, org-setups, org-deployments, org-members and org-invitations. Roles and the Roles-module deployment " +
        "merge into the deployment; Seat permissions and their changes go (officer hats are board's); Directors, proposals, " +
        "equity, rounds and votes leave with their concepts.",
    },
    { label: "port", text: "Port the old workspace tables as they are: orgs, org-lifecycles, org-roles, org-roles-deployments, org-members, seat-permissions, seat-permission-changes, org-invitations." },
  ],
  chosen: "five",
  why:
    "On v4 a permission is a hat and an allowance a budget, so seat-permissions and their changes copied the chain (P9 " +
    "and responsibilities.keepers). The old setup row was mostly plumbing for Convex scheduling (lease, dispatch and send " +
    "tokens, generation, park, unresolved counters) that a durable workflow holds itself (P3). The roles catalog and the " +
    "Roles deployment were pre-v4 shapes; on v4 the deployment's named hats replace them. Every table is tenant-first on " +
    "org_id (P8); the cross-tenant indexes are the caller's own memberships, offers and unfinished setups, an " +
    "Organization by its Party, and Seats by an agent's Safe. The Frappe rulings later added two new ones, the " +
    "Organization's apps and its head connection (organizations.startup, organizations.head-connection).",
  source: by("docs/as-is/archive/organizations/data.ts:140-1055 (19 tables); P3; P8; P9; responsibilities.keepers"),
  affects: [table_organizations, table_org_setups, table_org_deployments, table_org_members, table_org_invitations, concept_board],
});

export const decision_organizations_deployment_row = defineDecision({
  id: "organizations.deployment-row",
  title: "The deployment is one row written once from the indexed MoneyDeployed",
  question: "MoneyDeployed is a chain fact indexing already holds. Does organizations keep its own deployment row?",
  options: [
    { label: "row", text: "Write one row per Organization from the event at finality; it names which hat is which, and never changes." },
    { label: "view", text: "Every reader joins indexing's Installer view by the company Safe and decodes the officer hats by position." },
  ],
  chosen: "row",
  why:
    "The concept map gives organizations the deployment ('which officer hat is which') so every concept above can name " +
    "hats without knowing the install's officer order. The event is emitted once per company and its ids never change, " +
    "so the row cannot drift, which is what P3's 'nothing copies chain rows' guards against. The install batch is built " +
    "from it, so the setup needs it anyway. Who wears a hat now, the budgets and the Board's signers stay indexing's views.",
  source: by("IInstaller.sol:46-60 (MoneyDeployment); packages/backend/src/organizations/setups/external/deploys.ts:213; concepts.organizations"),
  affects: [table_org_deployments, workflow_organizations_setups_set_up],
});

export const decision_organizations_setup_machine = defineDecision({
  id: "organizations.setup-machine",
  title: "Five setup states, the steps as data, and failed only when nothing can finish it",
  question: "The old setup had six statuses (with rechecking after a reorg and a park outside the status). What does the target setup machine hold?",
  options: [
    {
      label: "five",
      text:
        "processing, awaiting_authorization, needs_attention, ready and failed; the finished steps (safe_minted, " +
        "money_deployed, installed) as a column; ready only at finality.",
    },
    { label: "per-step", text: "One state per step: minting, deploying, awaiting_authorization, installing, ready, needs_attention, failed." },
    { label: "as-is", text: "Keep awaitingAuthorization, processing, needsAttention, ready, rechecking and failed." },
  ],
  chosen: "five",
  why:
    "`org show` already reports the steps separately, and `org wait` and `org retry` decide on the status alone, so per-step " +
    "states would multiply the resume transitions without telling a reader more. Rechecking existed because the old " +
    "setup went ready before finality and a reorg could orphan its proof; the target waits for the install's facts at the " +
    "deployment's finality depth, so ready is terminal. Failed is kept for what no retry can fix: a minted company Safe " +
    "that is not owned by the founder's Safe, or a provider answer that will not change (PROVIDER_RESPONSE_INVALID); " +
    "an install the Installer refuses (InvalidInstall) stalls and stays resumable, as the designed text says.",
  source: by("docs/as-is/archive/organizations/data.ts:1067 (org-lifecycle); org.create.yaml (designed refusals); org.show.yaml (steps); org.wait.yaml"),
  affects: [machine_org_setup, table_org_setups, event_org_setup_transitioned],
});

export const decision_organizations_event_names = defineDecision({
  id: "organizations.event-names",
  title: "Machines org-setup, org-member, org-invite; org_invite_transitioned stays",
  question: "What are the three machines called, and so their events (P7)?",
  options: [
    { label: "org-prefixed", text: "org-setup, org-member and org-invite, so the invitation's event stays `org_invite_transitioned`, the name the frozen notes use." },
    { label: "plain", text: "setup, member and invitation, sending setup_transitioned, member_transitioned and invitation_transitioned." },
  ],
  chosen: "org-prefixed",
  why:
    "The frozen notes of `org member invite` name `org_invite_transitioned`, so a journey or a reader of those notes finds " +
    "the same event; the prefix also keeps the ids clear of accounts' personal Safe setup and banking's verification " +
    "invitations. The three old setup events (organization_creation_started, _ready, _failed) fold into " +
    "org_setup_transitioned. Transition names are verbs (send, accept, decline), so the event's `transition` carries " +
    "`send` where the old note said `sent`; the new values are listed on the machine.",
  source: by("org.member.invite.yaml (notes: org_invite_transitioned); P7; docs/as-is/archive/organizations/data.ts:1067"),
  affects: [event_org_setup_transitioned, event_org_member_transitioned, event_org_invite_transitioned, machine_org_invite],
});

export const decision_organizations_members_are_seats = defineDecision({
  id: "organizations.members-are-seats",
  title: "One Seat per Party, born active, ended only by the chain",
  question: "What is a member in the target, and what can end one?",
  options: [
    {
      label: "seat",
      text:
        "One Seat per Party per Organization, born active by the setup (the founder) or an acceptance; it ends only when " +
        "AgentRemoved names an agent's Safe. Authority is the hats the Seat's Safe wears.",
    },
    { label: "as-is", text: "Keep the six member statuses, several rows per email, and the indexer reconciliation's revoke." },
  ],
  chosen: "seat",
  why:
    "No old writer ever inserted pending, pending_safe or pending_grant, and the old revoke came from a reconciliation of " +
    "copied chain state. A person invited and not yet joined is an open invitation, which `org member list` shows as " +
    "pending. No frozen operation removes a person's Seat (`org member revoke` takes a hat back, which is board's), so the " +
    "only end is the agent's removal on chain, which the concept map gives organizations. One Seat per Party gives every " +
    "concept above one guard: a current Seat for the session's principal.",
  source: by("docs/as-is/archive/organizations/data.ts:1146 (org-member: legacy states never written); concept_organizations (AgentRemoved); org.member.revoke.yaml"),
  affects: [table_org_members, machine_org_member, workflow_organizations_members_end_agent_seats, rpc_organizations_members_list],
});

export const decision_organizations_invitation_machine = defineDecision({
  id: "organizations.invitation-machine",
  title: "No pending_grant or revoked: grants are minted before the offer opens",
  question: "On v4 an invitation's grants are a Board batch minting hats to the invitee's Safe. Which phases remain?",
  options: [
    { label: "v4", text: "authorizing, pending, active, revoking, declined, cancelled, expired: an offer with grants opens once the Board's batch executed, and accepting has nothing left to grant." },
    { label: "as-is", text: "Keep pending_grant (consent, then a grant command) and revoked (retired after a late cleanup)." },
  ],
  chosen: "v4",
  why:
    "The designed call mints the offered hats to the personal Safe the invitee's email names as part of the Board batch, " +
    "before the offer is open for acceptance, so acceptance only takes the Seat. Without a grant after consent there is " +
    "no late cleanup, so revoked has no source. Ending an offer whose hats are on chain still needs the Board to take " +
    "them back, so revoking stays, and the offer ends with its recorded reason when the chain shows them gone. The " +
    "frozen returns keep `pending_grant` in their literal lists; the target never produces it.",
  source: by("org.member.invite.yaml (designed call); docs/as-is/archive/organizations/data.ts:1264 (org-invitation); invite.accept.yaml (returns)"),
  affects: [machine_org_invite, table_org_invitations, event_org_invite_transitioned],
});

// ── the door ────────────────────────────────────────────────────────────────────────────────

export const decision_organizations_bind_invitation_grants = defineDecision({
  id: "organizations.bind-invitation-grants",
  title: "New procedure: the proposer binds an invitation to its grants' transaction",
  question:
    "Budgets proposes an invitation's grants to the Board, and organizations cannot follow budgets' or board's " +
    "transitions (it depends on neither). How does the invitation learn which proposal carries its grants, so it can " +
    "open, or be cancelled, from the chain?",
  options: [
    { label: "procedure", text: "Budgets invokes `organizations.bind-invitation-grants` in the transaction that opens the proposal; the invitation then follows that Safe transaction on chain." },
    { label: "hats", text: "The invitation waits until the invitee's Safe wears every offered hat (a new allowance's hat is unknown until it exists)." },
    { label: "proposer-writes", text: "The proposer's process moves the invitation's phase when the proposal executes or ends." },
  ],
  chosen: "procedure",
  why:
    "Money fact: the grants (hats with authority over the company's money) and the Safe transaction that carries them are " +
    "one fact, the rules.procedures case 'a chain write and the proposal that carries it'. Bound in one transaction, the " +
    "invitation never waits on a proposal that does not carry it, and its process decides everything from chain proof: " +
    "ExecutionSuccess of the bound hash opens it, the nonce going to another transaction cancels it, and the cancel rpc " +
    "can tell whether the proposal may still run. Waiting for hats cannot know a new allowance's hat, and letting the " +
    "proposer drive the phase would write organizations' machine from above, a second writer P4 forbids. The invoking " +
    "transaction calls two concepts' procedures (board.propose and this one), within sys:tx-width.",
  source: by("operations.member-invite-in-budgets; org.invite.cancel.yaml (a proposal that may still run); rules.procedures; P4"),
  affects: [procedure_organizations_bind_invitation_grants, table_org_invitations, workflow_organizations_invitations_follow, concept_board, concept_budgets],
});

export const decision_organizations_provisional_party = defineDecision({
  id: "organizations.provisional-party",
  title: "An invitee is resolved through parties, named provisional when new",
  question: "An email may name nobody Capxul knows yet. How does the invite rpc get the invitee's Party?",
  options: [
    { label: "resolve", text: "Invoke `parties.resolve-recipient` in the invite transaction: a new mailbox is named provisional at its email-derived Safe." },
    { label: "refuse", text: "Refuse an email with no Party until the person signs in." },
    { label: "read", text: "Read parties and refuse anything not already there." },
  ],
  chosen: "resolve",
  why:
    "The old invite ensured the Party by email, and an invitee is often someone who has never signed in. Parties' own " +
    "door binds a mailbox to the Safe its money routes to (its money fact), once, with the record that first names it, " +
    "and an invitee is one of the records it names. The invitation keeps the mailbox it was sent to, because parties " +
    "stores only a digest and notices must deliver to it. With `accounts.admit` the transaction invokes two procedures " +
    "of two concepts, within sys:tx-width.",
  source: by("packages/backend/src/organizations/invitations/reads/grantees.ts:72 (ensurePartyByEmail); parties/procedures.ts (resolve-recipient)"),
  affects: [rpc_organizations_invitations_invite, table_org_invitations, concept_parties],
});

// ── time ────────────────────────────────────────────────────────────────────────────────────

export const decision_organizations_setup_process = defineDecision({
  id: "organizations.setup-process",
  title: "One setup process replaces observe, the recovery cron and ten internal rpcs",
  question: "The old setup was a prepare action, a submit action, ten internal rpcs, a scheduled observe and an every-minute recover cron. What is the target?",
  options: [
    {
      label: "process",
      text:
        "One durable process per setup, started by `begin`: the service signer sends the mint and deployMoney once each, " +
        "indexed facts at finality confirm them, the install is one approval opened with approvals.open, and approval_transitioned tells the outcome.",
    },
    { label: "as-is", text: "Keep prepare and submit rpcs that build, sponsor and send the founder's operation, with a check loop and a recovery cron." },
  ],
  chosen: "process",
  why:
    "A3 gives an Organization's setup one durable process that owns its machine, and P3 sends the recovery cron to the " +
    "process's own waits. Sponsoring, signing, sending and following the founder's UserOperation are approvals' for every " +
    "concept (concepts.approvals), so organizations only builds the calls (buildMoney's batch and the officer hat mints) " +
    "and opens the approval in the transaction that writes the deployment. The Party registered at birth turns active " +
    "when the Safe is minted to the founder (`parties.activate`), and is released if it is not (`parties.release`), as " +
    "parties' door asks. The CAP-1097 rule (record the signed bytes " +
    "before broadcast, look a lost answer up, never send deployMoney twice) is the service signer's. The process's only " +
    "signal is `org retry`; reads never wake it.",
  source: by("docs/as-is/archive/organizations/setups.ts:200-751 (17 rpcs, 2 workflows); deploys.ts:1-8 (CAP-1097); A3; P3; concepts.approvals"),
  affects: [
    workflow_organizations_setups_set_up, rpc_organizations_setups_begin, rpc_organizations_setups_get,
    rpc_organizations_setups_resume, table_org_setups,
  ],
});

export const decision_organizations_invitation_process = defineDecision({
  id: "organizations.invitation-process",
  title: "One invitation process: chain proof, its own expiry timer, answers as signals",
  question: "What drives an invitation after it is offered, now that the daily expiry cron, the grant drive and its verify loop are gone?",
  options: [
    {
      label: "process",
      text:
        "One durable process per invitation, started after the invite rpc: it waits on the bound Safe transaction, then on " +
        "accept, decline or cancel (its signals) or its seven-day timer, then on the hats leaving the grantee's Safe.",
    },
    { label: "rpcs-and-cron", text: "Rpcs for the answers and a daily sweep that expires offers past expires_at." },
  ],
  chosen: "process",
  why:
    "An invitation is on rules.durable-processes' list: it waits days for a person and for the Board, and must survive a " +
    "crash. P3 sends the daily expiry to a timer per invitation. Its trigger is `after` the invite rpc because an " +
    "invitation has two births (with and without grants) and a trigger names one transition; the about says why it " +
    "cannot be a step. Every transition it drives is guarded by the phase it leaves, so a replayed step is a no-op.",
  source: by("rules.durable-processes; P3 ('expire pending org invitations' to a timer); docs/as-is/archive/organizations/invitations.ts:427, 586"),
  affects: [workflow_organizations_invitations_follow, rpc_organizations_invitations_accept, rpc_organizations_invitations_decline, rpc_organizations_invitations_cancel],
});

export const decision_organizations_invitation_delivery = defineDecision({
  id: "organizations.invitation-delivery",
  title: "The invitation email and its delivery are notices'; resend is a transition",
  question: "Old invitations sent their own email and kept its delivery outcome. Notices now sends every email. What stays here?",
  options: [
    {
      label: "notices",
      text:
        "Organizations records when it last asked for a send (the resend cooldown) and moves `resend`; notices sends from " +
        "org_invite_transitioned and keeps sent or failed. Views report `none` for an offer to an `@handle`, else `not_confirmed`.",
    },
    { label: "procedure", text: "Notices writes the outcome back into the invitation through a procedure." },
  ],
  chosen: "notices",
  why:
    "No other concept sends mail (concepts.notices), and an email may lag its change, so it is an outbox consumer (P4); " +
    "a delivery outcome is no money fact, so notices cannot write it here. Organizations cannot read notices (it sits " +
    "above), so its views say truthfully that delivery is not confirmed from here. The cooldown needs only the time of " +
    "the last send organizations asked for. The resend acceptance lines are checked against the mail sink.",
  source: by("concepts.notices; P4; org.invite.resend.yaml (returns: delivery); docs/as-is/archive/organizations/data.ts:1346 (delivery machine)"),
  affects: [rpc_organizations_invitations_resend, rpc_organizations_invitations_list, machine_org_invite, concept_notices],
});

export const decision_organizations_agent_seats = defineDecision({
  id: "organizations.agent-seats",
  title: "AgentRemoved ends an agent's Seats, as a chain-event workflow",
  question: "The concept map says an agent's Seat ends when the chain shows the agent removed. How?",
  options: [
    { label: "chain-event", text: "A workflow triggered by AgentOwner's AgentRemoved removes every active Seat at the agent's Safe." },
    { label: "agents-transition", text: "Follow agents' transition (organizations would have to depend on agents, which sits above it)." },
  ],
  chosen: "chain-event",
  why:
    "Agents depends on organizations, so organizations cannot follow its transitions; the chain event is the fact both " +
    "concepts agree on, and indexing delivers it (dependencies.of-organizations names AgentRemoved).",
  source: by("concept_organizations; dependencies.of-organizations; AgentOwner.sol (AgentRemoved)"),
  affects: [workflow_organizations_members_end_agent_seats, machine_org_member],
});

// ── reads ───────────────────────────────────────────────────────────────────────────────────

export const decision_organizations_reads_from_chain = defineDecision({
  id: "organizations.reads-from-chain",
  title: "Standing, capabilities and the Board summary are read from the chain",
  question: "`org me`, `org list`, `org member list` and `org show` report roles, capabilities, Directors and waiting proposals. Where from?",
  options: [
    {
      label: "chain",
      text:
        "Indexing's views (hat wearers, the company Safe's owners, threshold and approvals, budgets), named through the " +
        "deployment row; waiting proposals are approved hashes not yet executed at or above the Safe's nonce.",
    },
    { label: "board", text: "Read board's proposals and Directors (organizations would depend on board: a cycle)." },
  ],
  chosen: "chain",
  why:
    "On v4 authority lives only in Hats, the Signer Gate and Budgets ('Capxul reads the permission only from Hats'), and " +
    "the frozen line 'A Director is whoever the Safe's signers name, with no Capxul grant' says the same. Board sits " +
    "above organizations, so a count of waiting proposals comes from ApproveHash and ExecutionSuccess, which every " +
    "Director's approval leaves on chain. The member list's `permissions` are the officer hats the Seat's Safe wears.",
  source: by("org.me.yaml (acceptance 2); org.member.grant.yaml (designed: reads only from Hats); org.show.yaml (designed call)"),
  affects: [rpc_organizations_workspaces_me, rpc_organizations_workspaces_list, rpc_organizations_members_list, rpc_organizations_setups_get],
});

export const decision_organizations_member_kind = defineDecision({
  id: "organizations.member-kind",
  title: "`org member list` keeps `ai` for an agent's Seat; the rest say `agent`",
  question: "The table stores `agent`; the designed invite text replaces `--ai` with `--agent`; `org member list` returns `human` or `ai`. Which does each surface print?",
  options: [
    { label: "per-surface", text: "Member list and get keep their frozen `ai`; invitation views and `org list` use `agent`, as the designed text does." },
    { label: "agent-everywhere", text: "Print `agent` everywhere and change the member list's surface." },
  ],
  chosen: "per-surface",
  why: "P10 rung 1: returns are surface, and `org member list` has no designed block that changes it. The mapping is one line in its view.",
  source: by("org.member.list.yaml (returns: kind human or ai); org.member.invite.yaml (designed: --agent replaces --ai); P10"),
  affects: [rpc_organizations_members_list, operation_org_member_list, operation_org_member_get, table_org_members],
});

export const decision_organizations_treasury = defineDecision({
  id: "organizations.treasury",
  title: "The treasury is the company Safe; its balance is activity's",
  question: "What does the workspace keep of the old treasuries area?",
  options: [
    { label: "safe-only", text: "The Organization's `safe_address`; `balance --org` and the feed are activity's." },
    { label: "keep", text: "Keep a treasury read in organizations." },
  ],
  chosen: "safe-only",
  why:
    "The old treasury read was a balance of the company Safe, which is a read of whoever you act as (activity, with the " +
    "landing map's note). No frozen operation of organizations returns a balance.",
  source: by("docs/as-is/archive/organizations/treasuries.ts:40; landings.ts (organizations/treasuries to activity)"),
  affects: [table_organizations, concept_activity],
});

// ── implementation of operations ───────────────────────────────────────────────────────────

export const decision_organizations_flows = defineDecision({
  id: "organizations.flows",
  title: "Seven flows, seven single rpcs",
  question: "Which operations need a Core SDK flow, and which are one rpc call (A4)?",
  options: [
    {
      label: "by-steps",
      text:
        "Flows: `org create` and `org retry` (rpcs, the approval page, waits), `org show` and `org wait` (find the one " +
        "unfinished setup when no Organization is given), `use org` (list, then save), `org member get` (the list, then a " +
        "pick), `invite list` (its own offers, or with `--org` the Organization's). The other seven are one rpc each.",
    },
    { label: "rpcs", text: "One rpc per operation, with the CLI composing the rest." },
  ],
  chosen: "by-steps",
  why:
    "A4: the CLI calls one SDK method, so whatever composes rpcs or saves local state is the SDK's flow. `org show` and " +
    "`org wait` find 'exactly one unfinished setup' only by listing; `org member get` must 'read the member from the same " +
    "list'; `invite list --org` lists an Organization's invitations instead. The founder signs the install on the approval " +
    "page in the browser, so the flows open it and wait, and call no approvals rpc; `org show` and `org wait` share the " +
    "live setup rpc.",
  source: by("A4; org.show.yaml (notes); org.member.get.yaml (acceptance 1); invite.list.yaml (refusals: --org)"),
  affects: [
    flow_client_onboarding_begin_organization, flow_client_org_setup_resume, flow_client_org_setup_get,
    flow_client_org_setup_subscribe, flow_client_orgs_use, flow_client_org_members_get, flow_client_orgs_invitations,
  ],
});

export const decision_organizations_dropped = defineDecision({
  id: "organizations.dropped",
  title: "Old rpcs and workflows that are not ported",
  question: "The old workspace areas had 46 rpcs and 4 workflows. Which survive?",
  options: [
    {
      label: "reached-only",
      text:
        "Only what a frozen operation, a flow, a signal or a trigger reaches (P2), and no plumbing (P3): 13 rpcs and 3 " +
        "workflows, with the grants, officer hats and treasury in their own concepts.",
    },
    { label: "port", text: "Port every old rpc as an internal rpc." },
  ],
  chosen: "reached-only",
  why:
    "Setups: prepare and submit authorization, the proof receipt and list-mine go to approvals or into `org list`; the ten " +
    "load, record, accept, fence, claim, apply, recover and emit rpcs are steps of the setup process or the runtime's " +
    "outbox. Invitations: preview is the budgets flow's read before it writes, get and retry have no frozen caller (a " +
    "retry has nothing to retry once grants are hats), sweep and expire are each invitation's timer, and the five emit " +
    "rpcs are transitions' events. Members: grant, revoke, permission-target and record-permission-change are board's " +
    "officer hats; advance and the legacy states are gone; the emit and notify rpcs are events and notices. Roles: the " +
    "list is dropped (responsibilities.roles). Treasuries: activity's.",
  source: by("docs/as-is/archive/organizations/{setups,invitations,members,roles,treasuries,workspaces}.ts; P2; P3; responsibilities.roles"),
  affects: [concept_organizations, concept_board, concept_activity, concept_notices],
});

export const decision_organizations_create_refusals = defineDecision({
  id: "organizations.create-refusals",
  title: "`org create` refusals: FEATURE_NOT_AVAILABLE for the waitlist; no GS026",
  question: "The frozen refusals of `org create` name no code for a founder still on the waitlist, and the designed text adds ROLE_PERMISSION_DENIED for a batch approved by the wrong Safe. What does the target refuse with?",
  options: [
    { label: "old-code", text: "FEATURE_NOT_AVAILABLE for the waitlist (the old code's), WRONG_STATE for an unclaimed Safe (the frozen text), and no GS026 path." },
    { label: "wrong-state", text: "WRONG_STATE for the waitlist too." },
  ],
  chosen: "old-code",
  why:
    "P10: where the book is silent, the old code's behaviour stands, and the old begin refused the waitlist with " +
    "FEATURE_NOT_AVAILABLE (requireBetaAccess). An unclaimed Safe is the frozen WRONG_STATE, not SMART_ACCOUNT_MISSING. " +
    "The install approval is only ever opened for the founder's own Safe, which owns the company Safe, so no other Safe " +
    "can approve the batch and the designed GS026 refusal has no world.",
  source: by("docs/as-is/archive/organizations/setups.ts:200 (requireBetaAccess); org.create.yaml (refusals, designed refusals); P10"),
  affects: [operation_org_create, rpc_organizations_setups_begin, error_FEATURE_NOT_AVAILABLE, error_WRONG_STATE],
});

export const decision_organizations_create_budget = defineDecision({
  id: "organizations.create-budget",
  title: "`org create` takes chain-submit at 4 s / 8 s, not the 2 s / 4 s default",
  question: "Which budget does `org create` take end to end, excluding the founder's wait and chain confirmations?",
  options: [
    { label: "override", text: "chain-submit at p50 4,000 ms and p95 8,000 ms." },
    { label: "default", text: "chain-submit's default, 2,000 / 4,000 ms." },
  ],
  chosen: "override",
  why:
    "Before the founder can sign, two service-key transactions are prepared and sent in series (the mint, then deployMoney, " +
    "which needs the minted Safe) at about 1.5 s p95 each, and the install approval is sponsored (about 1.2 s p95), on top " +
    "of the begin write. Confirmations are excluded, the sends are not: three hops of the chain-submit class cannot fit " +
    "its one-hop default.",
  source: by("shared/external.ts (service-signer send p95 1,500; bundler sponsor p95 1,200); P5"),
  affects: [operation_org_create],
});

export const decision_organizations_company_safe_address = defineDecision({
  id: "organizations.company-safe-address",
  title: "`begin` computes the company Safe's address in-process",
  question: "The Party registered at birth needs the company Safe's address before the Safe exists. How does `begin` get it?",
  options: [
    { label: "in-process", text: "Compute the minter's pure `companySafeAddressFor` in-process (CREATE2 from fixed inputs), so `begin` stays one write with no node call." },
    { label: "eth-call", text: "Call the minter's pure function through chain-rpc." },
  ],
  chosen: "in-process",
  why:
    "The function is pure, so the backend's computation is checked once against the contract (an eval on the devnet) and " +
    "never needs a node; a node call would put `begin` in chain-read and make a write fail when a node is down.",
  source: by("CompanySafeMinter.sol:134 (companySafeAddressFor, pure); dependencies.parties-registration"),
  affects: [rpc_organizations_setups_begin],
});

// ── acceptance and worlds ───────────────────────────────────────────────────────────────────

export const decision_organizations_acceptance_rewrites = defineDecision({
  id: "organizations.acceptance-rewrites",
  title: "Twenty-one acceptance lines rewritten as outcomes (P1)",
  question: "Which frozen acceptance lines name a mechanism a black box cannot see, and what replaces them?",
  options: [
    {
      label: "rewrite",
      text:
        "org create 4 (row); org me 1 (fixture), 2 (copied signers), 4 (stored limit); org retry 1 (no-hash attempt); org " +
        "show 3 (authority hold, receipt-backed), 4 (proof); org wait 1, 2 (scheduled attention); invite list 1 (cursor); " +
        "invite decline 1 (configuration), 2 (verified), 4 (dispatch, commands), 5 (scheduled event); org invite list 3 " +
        "(cursor); org invite cancel 1 (triple, configure command), 2 (signed configuration), 3 (verified), 5 (scheduled " +
        "event); org invite resend 2 (records), 3 (records failed).",
    },
    { label: "keep", text: "Keep every line word for word and mark the internal ones unverifiable." },
  ],
  chosen: "rewrite",
  why:
    "P1 option C: keep every claim a black box can check, and turn each line that names a row, a cursor, a scheduled job, " +
    "a command or a copy into the outcome it guarded, checked by cli, read, chain, trace or world; each keeps its old line " +
    "and test citation in `was`. A rewrite must still pass against the old system: each says what the old test observed, " +
    "without the old mechanism (a cursor becomes `--after`, a scheduled event becomes the traced org_invite_transitioned, " +
    "a stored delivery outcome becomes the mail sink).",
  source: by("books/frozen/operations.ts (acceptance of the 14 operations); P1"),
  affects: ALL_OPERATIONS,
});

export const decision_organizations_worlds = defineDecision({
  id: "organizations.worlds",
  title: "The devnet worlds organizations' refusals and acceptance lines start from",
  question: "Which named devnet snapshots does this concept introduce, and what does each hold?",
  options: [
    {
      label: "worlds",
      text:
        "signed-out; person-on-waitlist; person-unclaimed (admitted, Safe not claimed); person-ready (admitted, Safe " +
        "claimed, no Organization); org-awaiting-founder (setup waiting for the founder's signature); " +
        "org-two-unfinished-setups; org-setup-stalled (install approval expired); org-setup-stalled-unsent (stopped before " +
        "the mint was sent); org-setup-failed (a step answered PROVIDER_RESPONSE_INVALID); org-ready (founder is the one Director and wears the three officer hats); " +
        "org-with-member (plus a hatless Seat); org-with-agent-member; org-with-removed-agent; org-with-allowance; " +
        "org-with-uncapped-allowance; org-with-pending-invitation (Seat-only, to a person); org-with-granted-invitation " +
        "(its hats minted, pending); org-with-authorizing-invitation (its proposal open); org-with-rejected-grant-proposal; " +
        "org-with-accepted-invitation; org-with-expired-invitation; two-founders (two ready Organizations).",
    },
    { label: "none", text: "Leave every refusal's world as `?`." },
  ],
  chosen: "worlds",
  why:
    "Each world is built by running operations as the devnet's fixed identities and saved as a snapshot " +
    "(responsibilities.operator-proof-tools), named for what it holds. Two refusals keep `?`: WRONG_STATE for an offer " +
    "whose Organization or grantee no longer matches, which no operation can produce; it is a defect guard.",
  source: by("responsibilities.operator-proof-tools; spec 30 (worlds); the 14 operations' refusals"),
  affects: ALL_OPERATIONS,
});

// ── assembly ────────────────────────────────────────────────────────────────────────────────

export const decision_organizations_invite_grants_in_budgets = defineDecision({
  id: "organizations.invite-grants-in-budgets",
  title: "Budgets proposes an invitation's grants and their return; every Offer stays",
  question:
    "The architecture review moved `org member invite` from board to budgets (operations.member-invite-in-budgets). " +
    "Organizations' records said board proposes the grants, binds their transaction and takes granted hats back, and " +
    "budgets had asked to offer existing allowances only (budgets.invitation-allowance-offers). What does organizations change?",
  options: [
    {
      label: "budgets-proposes",
      text:
        "Name budgets as the proposer and binder everywhere; keep the three Offer kinds (officer hat, existing " +
        "allowance, new allowance with name, asset and limit) and the interface: invite rpc, bind procedure, begin_cleanup.",
    },
    { label: "drop-new", text: "Also drop the `new-allowance` Offer, as budgets had recommended while board owned the flow." },
  ],
  chosen: "budgets-proposes",
  why:
    "The designed synopsis keeps `--new-allowance-name --limit --asset` and its call is the allowance's createHat, " +
    "createChildBudget and mintHat (P10 rung 1); budgets can now plan them, which is why the review moved the flow. " +
    "What `limit` becomes on chain is budgets' to plan. The invitation holds offers as data and learns the minted hats " +
    "from the bound transaction's indexed facts, so a new allowance's unknown hat id is no problem. Budgets' rpc invokes " +
    "`board.propose` and `organizations.bind-invitation-grants` in one transaction (two concepts, sys:tx-width), and " +
    "its own workflow on `org-invite.begin_cleanup` proposes the hats' return; organizations' process ends the offer " +
    "once indexing shows them gone.",
  source: by("shared operations.member-invite-in-budgets; org.member.invite.yaml (designed synopsis and call); budgets.invitation-allowance-offers"),
  affects: [
    table_org_invitations,
    machine_org_invite,
    event_org_invite_transitioned,
    procedure_organizations_bind_invitation_grants,
    rpc_organizations_invitations_invite,
    rpc_organizations_invitations_decline,
    workflow_organizations_invitations_follow,
    concept_budgets,
  ],
});

export const decision_organizations_approval_endings = defineDecision({
  id: "organizations.approval-endings",
  title: "A setup stalled by its install approval keeps approvals' code for the ending",
  question:
    "Approvals asks each opener to map an approval's endings onto the frozen codes (approvals.machine). The setup " +
    "records a stall reason (approval_declined, approval_expired, approval_displaced, install_refused, install_reverted) " +
    "and a code. Which code goes with each?",
  options: [
    { label: "approvals-map", text: "declined CANCELLED; expired and displaced WRONG_STATE; reverted TRANSACTION_FAILED; refused the code approvals stored." },
    { label: "reason-only", text: "Keep the reason and leave the code to the reader." },
  ],
  chosen: "approvals-map",
  why:
    "`org show` and `org wait` print the setup's failure with a code, and agents and board answer their carriers' " +
    "endings with the same mapping, so one CLI says the same thing for the same ending. The reason stays, because " +
    "`org retry` resumes from the step it names. No frozen refusal of the setup operations changes: these are the " +
    "setup's recorded failure, not a refusal.",
  source: by("books/target/approvals/decisions.ts (approvals.machine); books/target/agents/decisions.ts (agents.failure-codes); org.show.yaml; org.retry.yaml"),
  affects: [workflow_organizations_setups_set_up, table_org_setups, machine_org_setup],
});

// ── target assembly (builder) ───────────────────────────────────────────────────────────────

const BUILDER = (evidence: string) => `Claude, target assembly (builder), 8 November 2026; evidence: ${evidence}`;

export const decision_organizations_declined_previews = defineDecision({
  id: "organizations.declined-previews",
  title: "Five organizations commands end CANCELLED on a declined terminal preview",
  question:
    "Under vocabulary.declined-preview-cancelled a 'no' at a terminal preview ends CANCELLED (exit 130). Which " +
    "organizations commands ask, and where is CANCELLED listed?",
  options: [
    {
      label: "operation-errors",
      text:
        "`org create`, `org retry`, `invite decline`, `org invite cancel` and `org invite resend` ask at a terminal before " +
        "they call their one SDK method (their frozen notes: a script must pass `--confirm`; org create 'shows a preview " +
        "and asks first'). CANCELLED goes in each operation's `errors`, with the CLI's own codes, as `contact add` does.",
    },
    { label: "flow-prompt", text: "Move each question into an SDK flow as a `local: \"prompt\"` step and list CANCELLED there." },
  ],
  chosen: "operation-errors",
  why:
    "The CLI asks before it calls the method (org create's flow says so), and three of the five are one rpc with no " +
    "flow; giving them a flow only to ask would break A4's one-call operation is its rpc. A 'no' writes nothing, and a " +
    "script passes `--confirm` and never sees the question, so no frozen refusal or exit of a script changes.",
  source: BUILDER("books/target/shared/decisions.ts (vocabulary.declined-preview-cancelled); frozen org.create, org.retry, invite.decline, org.invite.cancel, org.invite.resend notes"),
  affects: [operation_org_create, operation_org_retry, operation_invite_decline, operation_org_invite_cancel, operation_org_invite_resend, error_CANCELLED],
});

// ── seats (Aaron's ruling aaron.seats) ──────────────────────────────────────────────────────

// The ruling is Aaron's; these records are the design's reading of it, so the judgments report lists them as the
// design's, and the ones that ask him something under "For Aaron".
const AARON_SEATS = by("books/target/shared/rulings.ts (aaron.seats, Aaron's ruling of 8 November 2026)");

export const decision_organizations_seat_limit = defineDecision({
  id: "organizations.seat-limit",
  title: "Ten seats on the row; an offer reserves one; a purchase or an operator raises it",
  question:
    "aaron.seats: a company starts with ten seats, in the beta and after; each seat may hold one agent account, and the " +
    "company may hold one agent of its own. aaron.buy-seats: a company may buy more seats itself, and a Capxul operator " +
    "may still raise the limit. Where is the limit kept, what counts against it, when is it checked, and what raises it?",
  options: [
    {
      label: "row-offers-and-purchase",
      text:
        "`organizations.seat_limit`, 10 at birth. A person's Seat counts one; an agent's rides on its owner's Seat here " +
        "(one per Seat) or is the Organization's own (one), and any other agent's counts one. A live offer reserves what " +
        "its Seat will take, so the check is at `org member invite`, under the Organization row's lock, and acceptance " +
        "only takes what was reserved; an offer to someone who already holds a Seat here reserves nothing. The limit " +
        "rises when a seat purchase's Payment settles, by the seats it bought (`organizations.add-bought-seats`, invoked " +
        "by payments' settlement; organizations.buy-seats), falls back if a reorg reopens that Payment, and a Capxul " +
        "operator may still set it higher with the operator's tool.",
    },
    {
      label: "row-and-offers",
      text:
        "As row-offers-and-purchase, but only a Capxul operator raises the limit, with the operator's tool; it never goes " +
        "down. The earlier choice, before aaron.buy-seats.",
    },
    { label: "count-at-accept", text: "Count only held Seats, at acceptance: offers are free, and the eleventh invitee to accept is refused." },
    { label: "flag", text: "A deployment-wide number in feature flags, the same for every Organization." },
  ],
  chosen: "row-offers-and-purchase",
  why:
    "Superseded by aaron.buy-seats, which answered this record's question to Aaron (may an Organization buy more seats " +
    "itself?) with yes; this record now follows the ruling, and organizations.buy-seats designs the purchase. Refusing " +
    "at the offer tells the inviter, who can act (cancel an offer, buy seats), instead of an invitee who did nothing " +
    "wrong; reserving keeps acceptance a promise the Organization can keep. The row lock makes two concurrent offers " +
    "for the last seat one success and one SEAT_LIMIT_REACHED, and serialises a purchase's count with them. A " +
    "per-Organization number is what 'raised' and 'bought' need, and a flag cannot raise one company's. The founder's " +
    "Seat is the first of the ten. Every frozen operation behaves as before: no eval world fills ten seats (the most is " +
    "seven, Acme's in org-with-budget-tree), and no frozen claim invites past ten. A limit lowered by a reorg ends no " +
    "Seat and no offer. Not built: lowering a limit by hand, and ending a person's Seat, which no target operation does.",
  source: by("books/target/shared/rulings.ts (aaron.seats, aaron.buy-seats: Aaron's rulings of 8 November 2026)"),
  affects: [
    table_organizations,
    table_org_members,
    table_org_invitations,
    table_org_seat_purchases,
    rpc_organizations_invitations_invite,
    rpc_organizations_invitations_accept,
    rpc_organizations_seats_raise,
    flow_client_operator_organizations_seats_raise,
    rpc_organizations_setups_begin,
    procedure_organizations_add_bought_seats,
  ],
});

export const decision_organizations_agent_cover = defineDecision({
  id: "organizations.agent-cover",
  title: "An agent rides on its owner's Seat, one per Seat; an uncovered agent takes one",
  question:
    "'Every seat can have one agent account, as well as the company's agent.' Whose Seat covers an agent, and what of an " +
    "agent nobody seated here owns, or a seated person's second agent?",
  options: [
    {
      label: "owner-covers",
      text:
        "An agent's Party names its owner. A person who holds a Seat here covers one agent of theirs; the Organization " +
        "covers the one agent it owns. An agent nothing covers (an outsider's, another Organization's, a second of the " +
        "same person's) takes a seat of its own, like a person, while one is free.",
    },
    { label: "refuse-uncovered", text: "Only covered agents may hold a Seat; any other agent's offer is refused." },
    { label: "agents-count", text: "Every Seat counts one, person or agent; the ten are shared by both." },
  ],
  chosen: "owner-covers",
  why:
    "It reads the ruling as ten people, each with an agent, plus the company's: up to 21 members. Refusing uncovered " +
    "agents would take away what `org member invite @handle --agent` does today (any agent can be offered a Seat), so " +
    "they count as a person does instead. The owner is read from the agent's Party (parties), which organizations " +
    "already reads; nothing new is needed from agents, which sits above. A covering Seat is a person's, and a person's " +
    "Seat never ends, so a covered agent never loses its cover; its own Seat ends when the chain removes it, which frees " +
    "the cover for another. For Aaron, to confirm the reading: does an agent take one of the ten, or ride beside its " +
    "person's Seat as here?",
  source: AARON_SEATS,
  affects: [table_org_members, table_org_invitations, rpc_organizations_invitations_invite, concept_parties],
});

export const decision_organizations_seat_limit_error = defineDecision({
  id: "organizations.seat-limit-error",
  title: "One new code, SEAT_LIMIT_REACHED, for both of an Organization's limits",
  question: "Which code refuses an offer past the seat limit, and a second agent of the Organization's own?",
  options: [
    { label: "new-code", text: "A new state code, SEAT_LIMIT_REACHED (exit 2, like the other limits), naming the limit, what is used and what is allowed." },
    { label: "wrong-state", text: "WRONG_STATE, with the limit in its details." },
    { label: "budget-code", text: "PAYROLL_BUDGET_EXCEEDED, the vocabulary's other limit." },
  ],
  chosen: "new-code",
  why:
    "A script must tell 'the Organization is full' (ask Capxul, or free a seat) from a wrong state of the thing it named, " +
    "and the budget code is about money. One code covers both limits because the remedy has the same shape; `limit` " +
    "says which (`seats`, `own agent`), with what is used and allowed, and the message is one plain sentence for both. Its exit is 2, as the designed text gives the other limits (PAYROLL_BUDGET_EXCEEDED, " +
    "INSUFFICIENT_BALANCE). It joins the shared vocabulary under vocabulary.shared-only. Where it surfaces: organizations' " +
    "invite rpc, so `org member invite` (budgets' operation), and agents' create with `--org` (agents.org-own-agent).",
  source: AARON_SEATS,
  affects: [error_SEAT_LIMIT_REACHED, rpc_organizations_invitations_invite],
});

// ── start-up, the FDE and the Frappe head (Aaron's rulings of 8 November 2026) ──────────────

const FRAPPE_RULINGS = by(
  "books/target/shared/rulings.ts (aaron.erp-on-capxul, aaron.frappe-shape, aaron.fde-agent, aaron.frappe-head); docs/vision/erp.md",
);
const WIZARD = "/tmp/erpnext/erpnext/setup/setup_wizard";

export const decision_organizations_startup = defineDecision({
  id: "organizations.startup",
  title: "Start-up: the Company's facts, the fundamental apps, their start-ups, the FDE",
  question:
    "The Frappe rulings: an Organization starts with all of its fundamental apps (accounting, " +
    "payroll, CRM, projects) in Frappe's shapes, whether or not a head is connected. What does `org create`'s start-up " +
    "step create, and who creates each part?",
  options: [
    {
      label: "begin-and-reactions",
      text:
        "`begin`, in its one transaction, writes the Company's facts on the Organization (abbreviation, currency, time zone, " +
        "fiscal-year start, from the country as ERPNext's setup wizard does), the app list (the fundamental apps installed " +
        "and native, any other asked-for app wanted) and, with the founder's FDE key, the FDE's Party. Each fundamental " +
        "app's concept starts itself from the setup's `begin` transition where its frozen behaviour allows: payroll its " +
        "settings, projects its settings and starting types, and the CRM needs nothing written. Books keeps facts from the first money but " +
        "makes no chart until `org books accounts import` runs (frozen: no chart until one is made), which a Books-hat " +
        "wearer runs in the first sitting. The install batch creates the FDE on chain.",
    },
    { label: "one-big-setup", text: "The setup process creates every app's starting records itself." },
    { label: "at-ready", text: "Nothing until the setup is ready; then each app starts." },
  ],
  chosen: "begin-and-reactions",
  why:
    "P4 lets organizations write only its own tables, and the apps sit above it, so each app's starting records are its " +
    "own concept's, started from organizations' transition (the reacting concept depends on the one that changed). " +
    "Starting at `begin` matches the rulings: the books keep facts from the first money, and money can reach the company " +
    "Safe's predicted address before the mint. The Company's facts belong on the Organization because every app reads " +
    "them and a head's Company and System Settings must carry the same ones. What each app creates is each designer's: " +
    "for books, nothing at begin, since a chart comes only from the import (books' own decision, keeping the frozen " +
    "'no chart until one is made'), and the import makes the tree, the fiscal years from `fiscal_year_start` and the " +
    "main cost centre; for payroll, Payroll Settings and the salary components; for the CRM, nothing: its statuses " +
    "are fixed defaults and its counter comes with its first write (contacts.startup); for projects, projects.startup.",
  source: by(`${WIZARD}/setup_wizard.py:get_setup_stages; ${WIZARD}/operations/install_fixtures.py; books/target/shared/rulings.ts (aaron.frappe-shape)`),
  affects: [
    rpc_organizations_setups_begin, table_organizations, table_org_apps, machine_org_setup, concept_books, concept_payroll,
    concept_contacts, concept_projects,
  ],
});

export const decision_organizations_company_shape = defineDecision({
  id: "organizations.company-shape",
  title: "The Organization is ERPNext's Company: abbr, currency, time zone, fiscal year",
  question: "ERPNext's setup wizard asks for a company's country, currency, time zone, abbreviation and fiscal year. Where do they live in Capxul?",
  options: [
    {
      label: "on-the-organization",
      text:
        "On the Organization's row: `abbr` from the name's initials (1 to 5 letters or digits), `default_currency` the " +
        "country's (Frappe's country_info), `time_zone` the country's first, `fiscal_year_start` ERPNext's for the country " +
        "or `01-01`; the founder may give any of them at `org create`.",
    },
    { label: "in-books", text: "In books' own Company table, read by everything above books." },
  ],
  chosen: "on-the-organization",
  why:
    "They are the Company's identity for every app, not accounting's alone: projects dates its tasks in the time zone and " +
    "prices its rates in the currency, payroll's periods follow the fiscal year, and a head's System Settings carries the " +
    "same zone. In books they would be out of reach of projects and the CRM, which sit below books. It also answers the " +
    "vision's check C18: whose day a report cuts at is the Organization's time zone. The currency must be one Capxul can " +
    "value (USD, or one whose USD price pair the deployment lists), because the books value every voucher in it " +
    "(books.company-settings); a country whose currency has none starts in USD rather than with books that cannot post. " +
    "Changing one later is not in this design: a time zone or fiscal year that moves under existing books is the books " +
    "designer's question.",
  source: by(`/tmp/frappe/frappe/geo/country_info.json (currency, timezones); /tmp/erpnext/erpnext/public/js/setup_wizard.js:195 (fiscal_years); docs/vision/erp.md (check C18)`),
  affects: [table_organizations, rpc_organizations_setups_begin, concept_books, concept_projects],
});

export const decision_organizations_apps_native_or_head = defineDecision({
  id: "organizations.apps-native-or-head",
  title: "Fundamental apps live in Capxul; every other Frappe app lives on a head",
  question:
    "aaron.frappe-shape: other apps are added at start-up or through the FDE. Capxul holds the fundamental apps' records " +
    "in their Frappe shapes. Where does an added app (Helpdesk, Stock, Manufacturing) live?",
  options: [
    {
      label: "head-apps",
      text:
        "On a connected head only: Capxul records it in the Organization's app list as wanted, asks the head's host to " +
        "install it once a head is connected, and never copies its documents. Its documents may name Capxul's records by " +
        "Capxul id and ask Capxul for money only through Capxul's commands.",
    },
    { label: "generic-store", text: "Capxul holds every app's documents in a generic DocType store, so an added app works without a head." },
    { label: "native-each", text: "Each added app becomes a Capxul concept in its Frappe shape, as the fundamental ones are." },
  ],
  chosen: "head-apps",
  why:
    "For Aaron. Fork as little as possible: a generic store would make Capxul a second Frappe backend that must run every " +
    "app's controllers to be right, which is a fork in all but name; a concept per app does not scale past a few. The " +
    "fundamental apps are native because the rulings say every Organization has them from the start, head or no head. " +
    "So an Organization with no head can want an app but not use it, and the FDE says so and offers to connect a head. " +
    "Is that the line Aaron means?",
  source: FRAPPE_RULINGS,
  affects: [table_org_apps, machine_org_app, workflow_heads_watch, integration_frappe_head, system_capxul],
});

export const decision_organizations_fde_at_start_up = defineDecision({
  id: "organizations.fde-at-start-up",
  title: "The founder's install signature also creates the FDE, from a key made locally",
  question:
    "aaron.fde-agent: every Organization has a Forward Deployed Engineer, its own agent (aaron.seats), acting through the " +
    "same CLI and SDK under the Organization's authority. How is it born, and where is its key?",
  options: [
    {
      label: "install-batch",
      text:
        "`org create`'s flow makes the FDE's key on the founder's machine (as `agent create` makes a key) and passes its " +
        "address to `begin`; the setup adds `AgentOwner.create(that key, the company Safe)` to the founder's install batch, " +
        "so one signature installs the company and creates the FDE; the setup seats it and agents records it. `--no-fde` " +
        "starts without one, and a Director can later make one with `agent create --org`.",
    },
    {
      label: "board-proposal-after",
      text: "After the setup is ready, agents opens a Board proposal to create the FDE, which the founder approves.",
    },
    {
      label: "hosted-key",
      text: "A Capxul-hosted FDE runtime makes and keeps the key, and the setup asks it for the address (a new component and integration).",
    },
  ],
  chosen: "install-batch",
  why:
    "For Aaron: where the FDE runs. Before the install the founder's Safe is the company Safe's only owner, so the batch " +
    "can call AgentOwner.create from the company Safe (AgentOwner requires the owner to call) with no Board proposal: no " +
    "`owner-safe-proposals` gate, and no proposal holding the company Safe's next nonce, which would block every Board " +
    "proposal after it until the founder answered. The key never reaches Capxul, as with every agent. With the key on the " +
    "founder's machine the FDE runs there, as the FDE plugin over the CLI; moving it to a Capxul-hosted runtime later is " +
    "a key rotation by the Board (`agent key rotate --org`) to a key that runtime made, so the hosted option is not " +
    "closed. If Aaron wants every Organization's FDE hosted by Capxul from day one, the hosted-key option needs a new " +
    "component and an `fde-host` integration (the shared designer's). Also for Aaron: the ruling says every " +
    "Organization has an FDE, and `--no-fde` lets a founder start without one (the eval worlds need it, " +
    "organizations.startup-worlds); keep it as a founder's choice, or make it a devnet-only flag?",
  source: by("/home/user/factory/packages/contracts/v4/src/agents/AgentOwner.sol:82 (msg.sender == owner); books/target/board/procedures.ts (owner-safe-proposals, next nonce)"),
  affects: [
    table_org_setups, rpc_organizations_setups_begin, workflow_organizations_setups_set_up, flow_client_onboarding_begin_organization,
    operation_org_create, contract_agent_owner,
  ],
});

export const decision_organizations_fde_seat = defineDecision({
  id: "organizations.fde-seat",
  title: "The setup seats the FDE before it signs in; it serves only its Organization",
  question: "The FDE's Seat is the Organization's own agent's (seat_use organization). When is it born, and can the FDE sit in another Organization?",
  options: [
    {
      label: "at-completion",
      text:
        "Born with the founder's when the setup completes, `seat_use` organization, its `principal_id` null for good; an " +
        "agent's session is matched to a Seat by its Safe, by every concept's tenant guard. Another Organization's own " +
        "agent is never offered a Seat (INVALID_INPUT at invite).",
    },
    { label: "by-invitation", text: "The FDE accepts an invitation like any agent." },
  ],
  chosen: "at-completion",
  why:
    "An invitation would need someone to invite the FDE and the FDE to accept before it could help, and the ruling says " +
    "it is the Organization's from the start. A null principal is what agents already says of an agent's account before " +
    "its first sign-in (agents.account-at-first-sign-in), and access holds one principal per Safe, so matching an agent " +
    "by its Safe is the same guard. Nothing writes the Seat when the FDE first signs in (access, below, cannot, and a " +
    "reaction would leave a window), so an agent's Seat is looked up by Safe, never by principal. The FDE's owner is " +
    "its Organization's Board, which can freeze, sweep or remove it; " +
    "seated elsewhere, another company's Board would control an agent working inside this one. Ending an FDE's Seat is " +
    "the chain's, as for every agent (AgentRemoved).",
  source: by("books/target/agents/decisions.ts (agents.account-at-first-sign-in); books/target/access/data.ts (principals by_safe)"),
  affects: [table_org_members, machine_org_member, workflow_organizations_setups_set_up, rpc_organizations_invitations_invite],
});

export const decision_organizations_fde_handle = defineDecision({
  id: "organizations.fde-handle",
  title: "The FDE's handle is `<handle>-fde`, or `fde-` and the Organization's id",
  question: "Every agent's Party has a handle (3 to 30 characters). What is the FDE's, and what if it is taken?",
  options: [
    {
      label: "derived",
      text:
        "`<handle>-fde`, from the Organization handle's first 26 characters; when that is taken, `fde-` and the last ten " +
        "characters of the Organization's id (`org_<ulid>`), lowercased. Display name `<name> FDE`.",
    },
    { label: "chosen", text: "The founder chooses it at `org create`." },
  ],
  chosen: "derived",
  why:
    "`org create` must never be refused because of the FDE's name, and a founder should not have to choose one. The " +
    "derived handle is free in practice; the fallback is unique by the id. Its last ten characters are the ULID's random " +
    "part: the first ten are its instant, which two Organizations born at one frozen instant share (time.read-once), so " +
    "a fallback cut from them could collide and refuse the second `org create`. Parties keeps both forms for the " +
    "Organization they name (parties.fde-handles), so nobody else can take an FDE's handle.",
  source: by("books/target/parties/procedures.ts (parties.register: handle rules)"),
  affects: [rpc_organizations_setups_begin, table_org_setups],
});

export const decision_organizations_head_connection = defineDecision({
  id: "organizations.head-connection",
  title: "A head connection is organizations' record and process; each app syncs itself",
  question: "The head ruling: connecting a head is a separate step. What records it, and who syncs what?",
  options: [
    {
      label: "connection-here-sync-per-app",
      text:
        "`org-heads` holds the one live connection (site, host, sealed key, what the site said) and its process checks the " +
        "site and installs wanted apps; each app concept syncs its own records from the connection's `confirm`, through " +
        "the `frappe-head` integration.",
    },
    { label: "head-concept", text: "A new head concept above every app, which syncs all of them." },
  ],
  chosen: "connection-here-sync-per-app",
  why:
    "Every app concept depends on organizations, so each can read the connection and follow its transitions; a head " +
    "concept above them all would have to write every app's tables, which P4 forbids. One live connection at a time " +
    "keeps one head per Organization's data. The API key is sealed under record-bound encryption bound to the row, as " +
    "banking seals bank details, and never returned; so are the ring secret (a signature is checked with the secret, " +
    "not its hash) and, for Frappe Cloud, the team's token its site API needs to install an app, which no site key can. Connecting is a Director's step, because it hands the Organization's " +
    "records to an outside system (organizations.commands).",
  source: FRAPPE_RULINGS,
  affects: [table_org_heads, machine_org_head, workflow_heads_watch, integration_frappe_head, concept_projects],
});

export const decision_organizations_head_ownership = defineDecision({
  id: "organizations.head-ownership",
  title: "Money and identity are Capxul's; business records shared; the rest the head's",
  question:
    "aaron.frappe-head: once a head is connected, accounting, payroll, CRM and projects sync between the two, with Capxul " +
    "the system of record for money and identity. Who owns what, field by field?",
  options: [
    {
      label: "three-classes",
      text:
        "Capxul's: money and identity (payments and the vouchers posted from book facts, Parties' names, handles and Safes, " +
        "Seats, hats, budgets, agreements' terms): pushed one way, read-only on the head, overwritten if they drift. " +
        "Shared: the fundamental apps' business records (projects, tasks, timesheets, CRM relationship fields, the " +
        "non-money parts of the books and payroll): either side may change them, each change based on a version, and " +
        "Capxul applies a head change through its own checks; an older base or a refused change loses. The head's: every " +
        "other app's documents and the head's customizations, which Capxul never copies. A pulled edit is authorized as " +
        "the member the head user's mailbox matches, with that member's rights and hats, never the connection's own; an " +
        "app may be stricter, never looser. With no member matched, an app may apply only what any member may do " +
        "(projects), or push the edit back: the CRM always does, since editing it needs the People hat by ruling " +
        "(contacts.crm-permission). The members' Users and their roles are identity, pushed one way from the hats " +
        "(organizations.head-users); a role never authorizes a pulled edit, the member's hats do.",
    },
    { label: "capxul-all", text: "Capxul owns everything it holds; the head may only read and ask." },
    { label: "head-all", text: "Once connected, the head owns everything but money and identity, and Capxul follows it." },
  ],
  chosen: "three-classes",
  why:
    "For Aaron, to confirm the reading. Money and identity must never move because a head's database says so: the chain " +
    "decides, and the head books what settled (docs/vision/erp.md). Business records are what people edit in Frappe's " +
    "forms every day, so a head that could not edit them would not be a head; Capxul applying them through its own " +
    "checks keeps the guards and lets an Organization disconnect its head with records it can trust. The three classes " +
    "are what each app's designer follows: projects first (projects.head-sync); books, payroll, contacts and parties " +
    "decide which of their fields fall in each class. Whose authority a pulled edit runs under was asked by the CRM " +
    "lane (identity assembly): the matched member's, because the Organization's permissions are hats worn by members, " +
    "and a connection that edited with its own authority would let every head user do what only a hat allows. The head " +
    "vouches for its own users: a Director who connects one trusts its administrators with the shared records, and the " +
    "match gives an edit a member's rights, never more. Roles pushed from the hats let the head's forms stop most such " +
    "edits before Capxul must push them back.",
  source: FRAPPE_RULINGS,
  affects: [integration_frappe_head, component_frappe_app, table_org_heads, concept_books, concept_payroll, concept_contacts, concept_projects],
});

export const decision_organizations_head_doorbell = defineDecision({
  id: "organizations.head-doorbell",
  title: "The head rings a doorbell with no data; Capxul pulls with its own key",
  question: "How does Capxul learn that something changed on the head, without polling it every minute?",
  options: [
    { label: "doorbell", text: "The Capxul app posts a signed, data-free ring after a change commits; it wakes every app's sync, which pulls; a daily pull catches a lost ring." },
    { label: "poll", text: "Each app's sync polls the head every minute." },
    { label: "webhook-with-data", text: "The head posts each change with its content to Capxul." },
  ],
  chosen: "doorbell",
  why:
    "A minute-scale poll is a timer the one clock would stop at, half a million stops a simulated year " +
    "(devnet.warp-barrier), and a load on every head. A webhook with data would make the head a writer into Capxul " +
    "holding Capxul's trust; a ring carries nothing, so a forged one is refused and a replayed one only causes an extra " +
    "pull, and every change still " +
    "comes through Capxul's own read with Capxul's own key. On a devnet the stand-in head rings at the stop its scripted " +
    "edit happens.",
  source: by("books/target/devnet/decisions.ts (devnet.warp-barrier); books/target/banking/inbox.ts (a signed delivery route)"),
  affects: [rpc_organizations_heads_ring, table_org_heads, workflow_heads_watch, component_frappe_app],
});

export const decision_organizations_head_clock = defineDecision({
  id: "organizations.head-clock",
  title: "A head runs on the one clock: Capxul's times for money, one time zone for days",
  question: "The one clock (time.one-clock) runs the larger system too. How does a connected head follow it?",
  options: [
    {
      label: "follower-and-zone",
      text:
        "Money's times are Capxul's (a voucher is dated at its fact's block); a head's own dates are Frappe's, read through " +
        "frappe.utils; every instant crosses as UTC and every day in the Organization's time zone, which the head must " +
        "share (else the connection stalls). On a devnet the Capxul app is a follower: it sets now_datetime to the clock's " +
        "now, runs Frappe's due jobs at each stop, and reports only daily-or-slower jobs as its next due.",
    },
    { label: "own-clocks", text: "Each side keeps its own clock and the sync converts." },
  ],
  chosen: "follower-and-zone",
  why:
    "ERPNext reads time almost only through Frappe's helpers, and Frappe's tests already freeze them, so following the " +
    "clock is one patch in the Capxul app, not a fork (docs/vision/erp.md section 5). A head in another zone would put a " +
    "task's due day or a fiscal year's first day on another date. Reporting only slow jobs as stops follows the barrier's " +
    "own rule, because Frappe's every-tick and 15-minute jobs would make a simulated year hundreds of thousands of stops; " +
    "which of Frappe's jobs count as stops is the devnet designer's to fix with the stand-in head.",
  source: by("books/target/shared/time.ts (time.one-clock, time.clients-take-server-now); books/target/devnet/decisions.ts (devnet.followers); docs/vision/erp.md (section 5)"),
  affects: [component_frappe_app, integration_frappe_head, table_organizations, workflow_heads_watch],
});

export const decision_organizations_commands = defineDecision({
  id: "organizations.commands",
  title: "Decision pack: the app and head commands to add (new capabilities)",
  question:
    "Adding Frappe apps and connecting a head are new capabilities, not among the 215 (aaron.frappe-shape, " +
    "aaron.frappe-head). Which commands does Capxul add, and who may run them?",
  options: [
    {
      label: "apps-and-head",
      text:
        "Recommended. `org app list`; `org app add <app>` and `org app remove <app>` (a Director or the FDE); `org head " +
        "connect <site-url> --host frappe-cloud|self-hosted` (a Director, with the head user's API key read from a prompt " +
        "or a file, never a flag), `org head show` (any member: status, versions, each app's sync position) and `org head " +
        "disconnect` (a Director). Each is one rpc in organizations, booked with worlds and claims when accepted.",
    },
    { label: "apps-only", text: "Viable. Only the app commands now; connecting a head waits for its own pack." },
    { label: "fde-only", text: "Weak. No commands: the FDE adds apps and connects heads through a conversation surface of its own." },
  ],
  chosen: "apps-and-head",
  why:
    "For Aaron: this is a decision pack, and the recommendation stands until he answers. The FDE acts through the same " +
    "CLI as everyone (aaron.fde-agent), so whatever it may do must be a command; an FDE-only surface would put an " +
    "unchecked path beside the CLI. Connecting a head hands the Organization's records to an outside system, so it is a " +
    "Director's step, not the FDE's: the FDE prepares it and a Director runs it. Adding an app is reversible and moves no " +
    "money, so the FDE may do it. Buying seats (aaron.buy-seats) is its own pack, organizations.buy-seats.",
  source: FRAPPE_RULINGS,
  affects: [table_org_apps, table_org_heads, machine_org_app, machine_org_head, event_org_head_transitioned, system_capxul],
});

export const decision_organizations_startup_worlds = defineDecision({
  id: "organizations.startup-worlds",
  title: "Existing worlds start Acme with `--no-fde`; a new world starts it with its FDE",
  question:
    "With an FDE by default, every Organization world would hold an FDE, so `agent create --org` there would meet the " +
    "own-agent limit and `org member list` would show one more Seat. How do the frozen operations keep their worlds?",
  options: [
    { label: "no-fde-in-old-worlds", text: "Every existing world's `org create` passes `--no-fde`, so each holds what it says; a new world, `org-with-fde`, is `org-ready` with its FDE, for the FDE's own claims." },
    { label: "rewrite-worlds", text: "Rewrite every Organization world around its FDE: Acme's @acme-bot becomes its FDE." },
  ],
  chosen: "no-fde-in-old-worlds",
  why:
    "The worlds are evidence for frozen claims and refusals: `org-with-proposals-gate-off` must hold no agent of Acme's " +
    "own so `agent create --org` reaches FEATURE_NOT_AVAILABLE, and `org-with-agent` makes @acme-bot with `agent create " +
    "--org`, which by the FDE ruling is Acme's FDE anyway. Keeping them unchanged keeps every frozen behaviour where it " +
    "was proved. For the devnet designer: add `--no-fde` to the Organization worlds' `org create` and add `org-with-fde`.",
  source: by("books/target/devnet/worlds.ts (org-ready, org-with-agent, org-with-proposals-gate-off); books/target/agents/operations.ts"),
  affects: [operation_org_create, flow_client_onboarding_begin_organization],
});

// ── the assembly after the Frappe lanes, and aaron.buy-seats (8 November 2026) ──────────────

const ASSEMBLY = "Claude, identity assembly after the Frappe lanes, 8 November 2026";
const asmBy = (evidence: string) => `${ASSEMBLY}; evidence: ${evidence}`;

export const decision_organizations_buy_seats = defineDecision({
  id: "organizations.buy-seats",
  title: "Decision pack: a company buys seats from a budget; payments pays and counts them",
  question:
    "aaron.buy-seats: a company may buy more seats itself, paid in stablecoins from the company Safe; a Capxul operator " +
    "may still raise the limit; the price is Aaron's to set. What is the command, who may run it, how is it paid, and " +
    "when does the limit rise?",
  options: [
    {
      label: "payments-command",
      text:
        "Recommended. `org seats buy <n> --from <budget>`, and `org seats` to read the limit, what counts against it, " +
        "the seats bought and the price. A person whose Safe wears the People hat (the hat that invites, so the one who " +
        "meets the limit) pays from a budget they hold: the company Safe's money under the authority the Board gave that " +
        "budget, checked by the chain. Payments books `org seats buy`, because organizations sits below payments: it " +
        "births one command by `payments.prepare-command`'s rules (purpose seats, route budget, owner the Organization, " +
        "one item to Capxul's seat Safe for n times the price, its source naming only n), and its settlement invokes " +
        "`organizations.add-bought-seats` in the settling transaction with the command's owner as the Organization, so " +
        "the limit rises exactly when the payment settles and only for the company that paid; its reversal on a reorg " +
        "invokes `organizations.return-bought-seats`. `org seats` reads only organizations' rows and the price, so it is " +
        "organizations' own. The price is the deployment " +
        "setting SEAT_PRICE, the price of one seat in each stablecoin the deployment sells seats in, with Capxul's " +
        "receiving Safe beside it; while it is unset for the budget's token, buying is FEATURE_NOT_AVAILABLE. A bought seat " +
        "is kept for good.",
    },
    {
      label: "board-batch",
      text: "As payments-command, but a Director buys and the company Safe pays by a Board proposal, which needs a board route in `payments.prepare-command`.",
    },
    {
      label: "capxul-request",
      text: "Capxul issues a request for the seats, which the Organization pays from its inbox (`inbox pay --from`); requests follows the payment and invokes organizations' door when it is paid.",
    },
    {
      label: "organizations-approval",
      text: "Organizations opens the spend approval itself and follows the indexed PaymentSent to raise the limit.",
    },
    { label: "subscription", text: "As payments-command, but seats are priced per month and lapse unless paid again." },
  ],
  chosen: "payments-command",
  why:
    "For Aaron: the price (SEAT_PRICE is his to set; this design chooses no number, and buying stays off until he sets " +
    "it), whether a seat is bought once or by the month, the commands' names, and who may buy (the People hat from a " +
    "budget, or a Director by Board batch). It is a decision pack under rules.new-operations: `org.seats.buy` (payments') " +
    "and `org.seats` (organizations') cite aaron.buy-seats and are booked on this recommendation, which stands until " +
    "he answers, in the commands pass, with claims and worlds; organizations has booked the purchases and their two " +
    "doors. Organizations cannot birth the payment: " +
    "`payments.prepare-command` is a door of a concept above it, and depending on payments would be a cycle. For the " +
    "same reason the limit can follow the payment only through a door payments invokes. Counting the seats in the " +
    "settlement's own transaction keeps payments' one settlement path (payments.one-settlement-path), which the " +
    "organizations-approval option would duplicate without a book fact, and makes 'raised once the payment settles' " +
    "exact: no seat without its settled payment, none paid for and missing, and the reversal keeps that across a reorg. " +
    "A request from Capxul would put an issuer in every purchase. A budget is the route the door already has. An agent " +
    "never buys (agents.fde-authority). The Organization counted is the paying command's owner, never a value the " +
    "source carries, so one company cannot raise another's limit (the ruling: a company buys for itself). A " +
    "subscription needs a lapse that lowers a limit, which nothing designs yet.",
  source: asmBy("books/target/shared/rulings.ts (aaron.buy-seats); books/target/payments/procedures.ts (payments.prepare-command)"),
  affects: [
    table_organizations, table_org_seat_purchases, machine_seat_purchase, event_seat_purchase_transitioned,
    procedure_organizations_add_bought_seats, procedure_organizations_return_bought_seats, rpc_organizations_seats_raise,
    system_capxul,
  ],
});

export const decision_organizations_frappe_app_fields = defineDecision({
  id: "organizations.frappe-app-fields",
  title: "The Capxul app's Custom Fields, one Party field, and what listChanges reports",
  question:
    "The four Frappe lanes each asked the Capxul app for Frappe for Custom Fields and changes, under names that differ " +
    "(the CRM's and the books' `capxul_party`, payroll's `capxul_party_id` on Employee). Which fields does the app add, " +
    "and what must `listChanges` catch?",
  options: [
    {
      label: "one-set",
      text:
        "`capxul_id` and `capxul_version` on every synced DocType. One Party field, `capxul_party`, on Contact, CRM " +
        "Organization, Customer, Supplier and Employee (payroll's `capxul_party_id` takes this name); a Party in any " +
        "other role is named by role (`capxul_payee_party` on Salary Component). `capxul_hidden` on Contact and CRM " +
        "Organization. Each app concept's own fields by its decisions (payroll.head-sync's on Salary Structure " +
        "Assignment, Payroll Entry and Salary Slip); on User, a member's `capxul_id` and `capxul_party` " +
        "(organizations.head-users). The app finds or creates a document Capxul names by `capxul_party` " +
        "(parties.head-parties) and makes the link records it names first (CRM Industry, CRM Lead Source, CRM " +
        "Territory, Currency). `listChanges` reports every synced DocType (the CRM's Contact, CRM Organization, CRM " +
        "Lead, CRM Deal; projects', payroll's and the books') and every write path: a document event (`on_change`, " +
        "which Frappe runs for a save, a submit, a cancel and a `db_set`) appends a change row naming the document, and " +
        "`frappe.db.set_value`, which runs no event, is caught by `listChanges` itself, which first appends a row for " +
        "each synced document whose `modified` is later than its own last row recorded. A row names the document; its fields are " +
        "read as they stand when `listChanges` answers, so a raw write in the same request as a recorded change (Frappe " +
        "CRM restoring a new deal's `deal_owner` with `update_modified=False`) is reported with it. On a connection's " +
        "first call it lists every document the site already holds.",
    },
    { label: "per-app-names", text: "Each app's lane keeps the names it chose; the app carries both Party fields on Employee." },
  ],
  chosen: "one-set",
  why:
    "The component is one app and one seam, so one name per meaning: two Party fields on Employee would let them " +
    "disagree, and a lookup by Party must work the same for a voucher's party, a contact and an employee. Reporting " +
    "every write path matters because Frappe CRM converts a lead with `db_set` and `set_value`, which run no `on_update`, " +
    "so a hook on saves alone would lose a conversion; reporting what the site already holds on the first call lets a " +
    "head connected late be adopted (contacts.head-mapping). Renaming a CRM Organization also rewrites the " +
    "`company_name` of its Contacts, a Data field `rename_doc` does not follow. Every person's Seat is a User whose " +
    "Contact carries the member's `capxul_party` (organizations.head-users), and a won deal's Customer the head makes " +
    "(`create_customer_on_status_change`) is the head's, given the `capxul_party` of what Frappe makes it from: the " +
    "deal's CRM Organization (a Company customer) or, with none, its primary Contact (an Individual), and none when " +
    "that has no Party. The `modified` sweep is needed because Frappe CRM writes CRM Lead (`update_lead_contact`) and " +
    "CRM Deal (a Contact's mailbox change) with `frappe.db.set_value`, which no hook sees. Payroll's own field list is " +
    "payroll's; this records only the shared names.",
  source: asmBy("docs/design/frappe/crm.md (head and organizations); docs/design/frappe/accounting.md (capxul_party); books/target/payroll/decisions.ts"),
  affects: [component_frappe_app, integration_frappe_head, table_org_heads, concept_contacts, concept_payroll, concept_books, concept_projects],
});

export const decision_organizations_head_users = defineDecision({
  id: "organizations.head-users",
  title: "Each person's Seat is a User on the head, with the roles its hats give",
  question:
    "A connected head needs each member as a User: Frappe CRM names a lead's or deal's owner by User, Frappe makes a " +
    "Contact for every User, and a pulled edit is judged as the member the head user's mailbox matches. The CRM lane " +
    "asked that every Seat be a User and that the head's roles follow the hats, but no process pushed them. Who makes " +
    "the members' Users, with which roles, and when?",
  options: [
    {
      label: "heads-watch",
      text:
        "Organizations' own head process (`organizations.heads.watch`) pushes the members as identity, one way: at " +
        "`confirm`, on each `org_member_transitioned` and at each daily check, `upsertDocs` writes a User for each person " +
        "holding a current Seat (their email, name, the member's `capxul_id` and `capxul_party`, enabled) and disables " +
        "the User of a Seat that ended, never deleting it. An agent's Seat has no User: Frappe keys a User by email and " +
        "an agent has none, and an agent works through the CLI and SDK; a record naming an agent member names no User " +
        "there. A User's roles are what its member's hats give, as Has Role rows Capxul holds: the People hat Sales User, " +
        "Sales Manager, HR Manager and Projects Manager; the Books hat Accounts User and Accounts Manager; the Invoicing " +
        "hat Accounts User; every member Projects User. A role whose hat is gone is taken away at the next push; one a " +
        "head administrator gives by hand is the head's and authorizes nothing in Capxul. Frappe makes the User's " +
        "Contact after the User commits (`create_contact`, enqueued), or finds the one that already holds its email, " +
        "and the Capxul app copies the User's `capxul_party` onto it: the same Party a person's entry by that " +
        "mailbox already names.",
    },
    { label: "per-app", text: "Each app concept pushes the Users it needs, with the roles its own records need." },
    { label: "head-admin", text: "The head's administrator makes the Users and gives the roles; Capxul only matches mailboxes." },
  ],
  chosen: "heads-watch",
  why:
    "Seats and hats are identity, which is Capxul's (organizations.head-ownership), and organizations holds both, so " +
    "it pushes them; one owner keeps three app concepts from writing the same User. A role is a convenience that lets " +
    "the head's own forms stop an edit early: a pulled edit is still judged by the member's hats when it is applied, " +
    "so a role up to a day behind a hat (hats are chain facts this process reads at each check, not events it follows) " +
    "only means the head accepts an edit Capxul then pushes back, or refuses one a new hat would allow until the next " +
    "push. The mapping follows each app's own decision: contacts.crm-permission (Sales User and Sales Manager follow " +
    "the People hat), payroll.hr-authority (the People hat is HR Manager), projects.permissions (members work tasks and " +
    "time; the People hat manages projects) and ERPNext's own permissions (Accounts User makes Journal Entries and Sales " +
    "Invoices; only Accounts Manager makes Cost Centers). Frappe's roles are coarser than Capxul's checks (a Projects " +
    "User may make a Project there, which projects then pushes back), which is why roles never authorize. Head-admin " +
    "would let a head admit someone with no Seat. Found in the identity review.",
  source: by("/tmp/frappe/frappe/core/doctype/user/user.py:349 (on_update, create_contact); /tmp/erpnext account, cost_center, journal_entry, sales_invoice, project, task .json permissions"),
  affects: [
    workflow_heads_watch, integration_frappe_head, component_frappe_app, table_org_heads, table_org_members, concept_contacts,
    concept_payroll, concept_projects, concept_books,
  ],
});
