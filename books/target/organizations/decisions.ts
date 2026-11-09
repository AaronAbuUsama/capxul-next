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
import {
  rpc_organizations_heads_connect,
  rpc_organizations_heads_disconnect,
  rpc_organizations_heads_ring,
  rpc_organizations_heads_show,
} from "./heads.ts";
import { workflow_organizations_fde_host, workflow_organizations_heads_watch as workflow_heads_watch } from "./processes.ts";
import { rpc_organizations_apps_add, rpc_organizations_apps_list, rpc_organizations_apps_remove } from "./apps.ts";
import { rpc_organizations_fde_ask, rpc_organizations_fde_show, rpc_organizations_fde_turn } from "./fde.ts";
import { rpc_organizations_seats_show } from "./members.ts";
import { flow_client_org_fde_ask, flow_client_org_head_connect, flow_client_org_head_disconnect } from "./flows.ts";
import {
  NEW_OPERATIONS,
  operation_org_fde_turn_get,
  operation_org_head_app_add,
  operation_org_head_app_list,
  operation_org_head_app_remove,
  operation_org_fde_ask,
  operation_org_fde_show,
  operation_org_head_connect,
  operation_org_head_disconnect,
  operation_org_head_show,
  operation_org_seats_show,
} from "./operations.ts";
import {
  machine_fde_payment,
  machine_org_fde,
  table_org_fde_asks,
  table_org_fde_payments,
  table_org_fdes,
} from "./data.ts";
import { procedure_organizations_extend_fde_hosting, procedure_organizations_return_fde_hosting } from "./procedures.ts";
import { concept_agents, concept_devnet, concept_payments } from "../shared/foundation.ts";

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
        "fiscal-year start, from the country as ERPNext's setup wizard does) and the app list (the fundamental apps " +
        "installed and native, any other asked-for app wanted); the setup's process asks Capxul's FDE host for the FDE " +
        "(organizations.fde-at-start-up). Each fundamental " +
        "app's concept starts itself from the setup's `begin` transition where its frozen behaviour allows: payroll its " +
        "settings, projects its settings and starting types, and the CRM needs nothing written. Books keeps facts from the first money but " +
        "makes no chart until `org books accounts import` runs (frozen: no chart until one is made), which a Books-hat " +
        "wearer runs in the first sitting, with the hosted FDE (`org fde ask`). The install batch creates the FDE on chain.",
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
    "main cost centre (books.startup); for payroll, Payroll Settings only, through payroll.startup.open, and no salary " +
    "components, which a business defines itself (payroll.startup); for the CRM, nothing: its statuses " +
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
  title: "Start-up asks Capxul's FDE host for the FDE; the install batch creates it",
  question:
    "aaron.fde-agent: every Organization has a Forward Deployed Engineer, its own agent (aaron.seats). aaron.fde-hosted: " +
    "it is not on the founder's machine but a durable agent on a durable runtime with sandboxes, which Capxul hosts and " +
    "the Organization pays for. How is it born at start-up, and where is its key?",
  options: [
    {
      label: "hosted-key",
      text:
        "Unless the founder passes `--no-fde`, the setup's process, once the company Safe is the founder's, asks " +
        "Capxul's FDE host (organizations.fde-host) to provision the Organization's FDE: the host makes its key, keeps " +
        "it with the agent's runtime and answers only its address, as the backend sees only an address for every agent. " +
        "In one transaction the setup records it, computes the FDE's Safe, registers its Party pending and births its " +
        "hosting (`org-fdes`). The install batch adds `AgentOwner.create(that key, the company Safe)`, so the founder's " +
        "one signature installs the company and creates the FDE; completion seats it as the Organization's own agent, " +
        "and the hosting's process starts it on the host. Nothing is made or kept on the founder's machine.",
    },
    {
      label: "install-batch",
      text:
        "The earlier choice: `org create`'s flow makes the FDE's key on the founder's machine and passes its address to " +
        "`begin`; the install batch creates the FDE, which runs there as the FDE plugin over the CLI.",
    },
    {
      label: "board-proposal-after",
      text: "After the setup is ready, a Board proposal creates the FDE with a key the host made.",
    },
  ],
  chosen: "hosted-key",
  why:
    "Superseded by aaron.fde-hosted, which answered this record's question to Aaron (where the FDE runs): Capxul hosts " +
    "it, so its key is the host's, never the founder's machine's. The install batch still carries the create: before the " +
    "install the founder's Safe is the company Safe's only owner, so the batch calls AgentOwner.create from the company " +
    "Safe (AgentOwner requires the owner to call) with no Board proposal holding the company Safe's next nonce until the " +
    "founder answered. Asking the host after the mint, not at `begin`, keeps `begin` one transaction with no outside " +
    "call and asks only for an Organization whose company Safe is the founder's; the provision is keyed by the " +
    "Organization's id, so a retried step answers the same key, and a host outage past its retries stalls the setup " +
    "like any provider (`org retry` asks again). Authority is unchanged (docs/design/authority.md): the company Safe owns " +
    "the FDE, it starts with no hat (agents.fde-authority) and is never a Director, and hosted it acts only as each " +
    "turn's asker (organizations.fde-for-the-asker); it is a runtime Capxul operates, and the Board can freeze, re-key " +
    "or remove it at any time. `--no-fde` stays: hosting is paid (organizations.fde-hosting), so a founder may decline it, and the eval " +
    "worlds need Organizations without one (organizations.startup-worlds). An Organization started without one gets no " +
    "hosted FDE later, since no pack lists a command for it; `agent create --org` still makes a self-run agent of its " +
    "own, with its key on its creator's machine and no hosting to pay (agents.fde).",
  source: by("books/target/shared/rulings.ts (aaron.fde-hosted, aaron.fde-agent); AgentOwner.sol:182 (msg.sender == owner); books/target/board/procedures.ts"),
  affects: [
    table_org_setups, table_org_fdes, machine_org_fde, rpc_organizations_setups_begin, workflow_organizations_setups_set_up,
    flow_client_onboarding_begin_organization, operation_org_create, contract_agent_owner,
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
  title: "Decision pack: the app, head and hosted FDE commands to add (new capabilities)",
  question:
    "Adding Frappe apps, connecting a head and reaching the hosted FDE are new capabilities, not among the 215 " +
    "(aaron.frappe-shape, aaron.frappe-head, aaron.fde-hosted). Which commands does Capxul add, and who may run them?",
  options: [
    {
      label: "apps-and-head",
      text:
        "Recommended: exactly the 8 commands of docs/design/new-commands.md (section 5.4), in its one grammar, each one " +
        "SDK method under `client.org(orgId)` over one rpc in organizations (`organizations.<area>.<verb>`), a flow where it " +
        "prompts or waits: `org head app list` " +
        "(any member, read); `org head app add <app>` and `org head app remove <app>` (a Director, or the Organization's own agent, " +
        "its FDE; write; a fundamental app is never removed); `org head connect <site-url> --host frappe-cloud|self-hosted` " +
        "(a Director; vendor: a flow reads the head user's API key, and on Frappe Cloud the team's token, from a prompt " +
        "or a file, never a flag, previews what is shared, and follows the check to connected or failing), `org head " +
        "show` (any member, read: status, versions, time zone, issue and the apps as the head runs them; each app's sync " +
        "position is that app concept's) and `org head disconnect` (a Director, write: a flow previews, then one rpc); and, for the hosted FDE (aaron.fde-hosted), `org fde show` (any member, " +
        "read: its state on the host, its hats, the day its hosting is paid through and FDE_HOSTING_PRICE) and `org fde " +
        "ask <message>` (any member, or a guest the management names, by aaron.fde-anyone; vendor: a flow sends the " +
        "message to the host and prints the FDE's reply when its turn ends; the FDE acts as the asker). Paying for the hosting, `org fde pay`, is organizations.buy-seats', since payments books it as it books " +
        "`org seats buy`.",
    },
    { label: "apps-only", text: "Viable. Only the app commands now; connecting a head waits for its own pack." },
    { label: "fde-only", text: "Weak. No commands: the FDE adds apps and connects heads through a conversation surface of its own." },
  ],
  chosen: "apps-and-head",
  why:
    "A decision pack under rules.new-operations. Aaron accepted its app and head commands as recommended (8 November " +
    "2026, sixth batch, question 10 of docs/decisions/open-for-aaron.md); the two FDE commands were added after his " +
    "answer, under aaron.fde-hosted (docs/design/new-commands.md section 6), and who may ask the FDE is put to him in " +
    "organizations.fde-commands. All eight are booked as operations beyond the 215, with their claims, refusals and " +
    "worlds (organizations.app-commands, organizations.head-commands, organizations.fde-commands, " +
    "organizations.command-worlds). " +
    "The FDE acts through the same CLI as everyone (aaron.fde-agent), so whatever it may do must be a command; an " +
    "FDE-only surface would put an unchecked path beside the CLI. Connecting a head hands the Organization's records to " +
    "an outside system, so it is a Director's step, not the FDE's: the FDE prepares it and a Director runs it. Adding an " +
    "app is reversible and moves no money, so the FDE may do it; any other member may not, because a connected head's " +
    "host is then asked to install it (agents.fde-authority follows this). aaron.fde-hosted adds two commands no pack " +
    "listed: the FDE runs on Capxul's host, not beside the founder's CLI, so the Organization needs `org fde show` to " +
    "see it and `org fde ask` to talk to it through Capxul's own sign-in. Asking was a Director's until aaron.fde-anyone " +
    "let any member, or a guest the management names, ask, the FDE acting as the asker (organizations.fde-commands, " +
    "organizations.fde-for-the-asker). The start-up's two (app list and add) are critical, and the FDE's two are " +
    "not, since it is not on the critical path (organizations.command-priorities). Buying seats and paying the hosting are " +
    "organizations.buy-seats', and organizations books that pack's `org seats show` (organizations.seats-show).",
  source: by(
    "books/target/shared/rulings.ts (aaron.erp-on-capxul, aaron.frappe-shape, aaron.frappe-head, aaron.fde-agent, aaron.fde-hosted); docs/design/new-commands.md (section 5.4); docs/decisions/open-for-aaron.md (question 10)",
  ),
  affects: [
    table_org_apps, table_org_heads, table_org_fdes, table_org_fde_asks, machine_org_app, machine_org_head, event_org_head_transitioned,
    rpc_organizations_apps_list, rpc_organizations_apps_add, rpc_organizations_apps_remove, rpc_organizations_heads_connect,
    rpc_organizations_heads_show, rpc_organizations_heads_disconnect, rpc_organizations_fde_show, rpc_organizations_fde_ask,
    rpc_organizations_fde_turn, flow_client_org_head_connect, flow_client_org_head_disconnect, flow_client_org_fde_ask,
    ...NEW_OPERATIONS, system_capxul,
  ],
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
  title: "Decision pack: a company buys seats and its FDE's hosting from a budget",
  question:
    "aaron.buy-seats: a company may buy more seats itself, paid in stablecoins from the company Safe; a Capxul operator " +
    "may still raise the limit; the price is Aaron's to set. What is the command, who may run it, how is it paid, and " +
    "when does the limit rise?",
  options: [
    {
      label: "payments-command",
      text:
        "Recommended: exactly the 3 commands of docs/design/new-commands.md (section 5.5), in its one grammar: `org seats " +
        "show` (organizations', any member, read: the limit, what counts against it, the seats bought and SEAT_PRICE); " +
        "`org seats buy <n> --from <budget>` (payments', chain-submit: a person whose Safe wears the People hat, the hat " +
        "that invites and so meets the limit, and whom Budgets.authorised admits on the budget, its department's hat or " +
        "an ancestor's, as the chain reads it; never an agent); and, for the hosted FDE (aaron.fde-hosted), `org fde pay " +
        "[<months>] --from <budget>` (payments', chain-submit: a person Budgets.authorised admits on the budget; never " +
        "an agent). Payments books both buys, because organizations sits below payments: each births one command by " +
        "`payments.prepare-command`'s rules (route budget, owner the Organization, one item to Capxul's receiving Safe for " +
        "n seats or months times the price, its source naming the count and, for seats, the buyer, never the Organization), and its settlement invokes an " +
        "organizations door in the settling transaction with the command's owner as the Organization: " +
        "`organizations.add-bought-seats` raises the limit, and `organizations.extend-fde-hosting` moves the FDE's " +
        "paid-through instant on by the months (organizations.fde-hosting); each reversal on a reorg invokes its return door. So what was bought counts exactly when the " +
        "payment settles and only for the company that paid. The prices are the deployment settings SEAT_PRICE (10 USDC " +
        "a seat, paid once; a bought seat is kept for good) and FDE_HOSTING_PRICE (20 USDC a month) on the test USDC " +
        "(aaron.test-prices); a price unset for the budget's token is FEATURE_NOT_AVAILABLE.",
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
    "A decision pack under rules.new-operations, which Aaron accepted as recommended (sixth batch); the prices are set " +
    "(aaron.test-prices: a seat 10 USDC once, the hosted FDE 20 USDC a month). `org.seats.buy` and `org.fde.pay` " +
    "(payments') and `org.seats.show` (organizations', organizations.seats-show) serve aaron.buy-seats, aaron.fde-hosted " +
    "and aaron.test-prices; organizations books the purchases' two doors and the hosting's two " +
    "(`organizations.extend-fde-hosting`, `organizations.return-fde-hosting`). Since a People-hat wearer holds no " +
    "department or team office (ROLE_CONFLICT), a buyer spends from an allowance whose hat their Safe wears now, or one " +
    "above it: a founder who wears only the People hat first has the Board make them an allowance " +
    "(organizations.founder-people-hat). The hosting is paid on the same route because it is a second thing an " +
    "Organization buys from Capxul, from a budget, in a stablecoin, counted when it settles; by the month, in advance " +
    "(organizations.fde-hosting). Organizations cannot birth the payment: `payments.prepare-command` is a door of a " +
    "concept above it, and depending on payments would be a cycle; so what was bought follows the payment only through a " +
    "door payments invokes. Counting it in the settlement's own transaction keeps payments' one settlement path " +
    "(payments.one-settlement-path) and makes 'counted once the payment settles' exact, across a reorg too. A request " +
    "from Capxul would put an issuer in every purchase; a budget is the route the door already has. An agent never buys " +
    "(agents.fde-authority). The Organization counted is the paying command's owner, never a value the source carries, " +
    "so one company cannot buy for another. A seat subscription needs a lapse that lowers a limit, which nothing designs. " +
    "This pack's `affects` cannot list payments' records (a decision imports only its concept's dependencies), so " +
    "payments.seat-purchase and payments.fde-hosting-purchase cite it and list `org.seats.buy` and `org.fde.pay`.",
  source: asmBy("books/target/shared/rulings.ts (aaron.buy-seats); books/target/payments/procedures.ts (payments.prepare-command)"),
  affects: [
    table_organizations, table_org_seat_purchases, machine_seat_purchase, event_seat_purchase_transitioned,
    procedure_organizations_add_bought_seats, procedure_organizations_return_bought_seats, rpc_organizations_seats_raise,
    procedure_organizations_extend_fde_hosting, procedure_organizations_return_fde_hosting, table_org_fde_payments,
    rpc_organizations_seats_show, operation_org_seats_show, system_capxul,
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
        "hat Accounts User; every member Projects User. A role whose hat is gone is taken away at the next push, or " +
        "sooner at the member's next document-family call, which sets them first (organizations.doc-authority); one a " +
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

// ── the commands pass: the new commands, the hosted FDE and its hosting (8 November 2026) ────

const PASS = "Claude, organizations commands pass, 8 November 2026";
const passBy = (evidence: string) => `${PASS}; evidence: ${evidence}`;
const ALL_NEW = [...NEW_OPERATIONS, operation_org_seats_show];

export const decision_organizations_app_commands = defineDecision({
  id: "organizations.app-commands",
  title: "Apps: any member lists; a Director or the FDE adds and removes, from a catalogue",
  question:
    "How do `org head app list|add|remove` behave: who may run them, which app names are accepted, and what do adding twice " +
    "and removing a fundamental app do?",
  options: [
    {
      label: "catalogue",
      text:
        "`org head app list` for any member. `org head app add|remove` for a Director (the Director hat, read from indexing) or " +
        "the Organization's own agent acting as itself (the Seat whose use is `organization`, a self-run one), as " +
        "aaron.frappe-shape and aaron.fde-agent have the FDE add apps in conversation; the hosted FDE never acts as " +
        "itself but as its asker (aaron.fde-anyone), so it adds one for a Director who asks. An app is one of HEAD_APPS, the deployment's catalogue " +
        "of published Frappe apps a host can install; any other name, or a fundamental app, is INVALID_INPUT at add. " +
        "Adding an app already wanted or installed answers it as it stands; a removed one is wanted again. Removing a " +
        "fundamental app is WRONG_STATE, and one the Organization never had INVALID_INPUT. None of them calls the head: " +
        "the head connection's process installs what is wanted.",
    },
    { label: "any-name", text: "Accept any well-formed Frappe app name, so a self-hosted head's own app can be added; the host's installApp refuses one it lacks." },
    { label: "members", text: "Any member adds an app (agents.fde-authority's earlier wording)." },
  ],
  chosen: "catalogue",
  why:
    "Other apps are added at start-up or in conversation with the FDE, so the FDE must be able to add one, and so must a " +
    "person: a Director, because a connected head's host is then asked to install it, which is the Organization's " +
    "choice (docs/design/new-commands.md section 3). The FDE is recognised by its Seat's use, so the guard needs no read " +
    "of agents, which sits above. A catalogue answers the same before any head exists and lets an eval refuse a name; a " +
    "self-hosted head's own app is its owner's to install and is the head's (organizations.apps-native-or-head). Adding " +
    "twice being one want matches `want`, a birth. A fundamental app is in every Organization from its first day, so " +
    "removing one asks for a state none may be in: WRONG_STATE, as G6 gives a forbidden transition.",
  source: passBy("books/target/shared/rulings.ts (aaron.frappe-shape, aaron.fde-agent); docs/design/new-commands.md (G3, G4, G6, section 5.4)"),
  affects: [
    rpc_organizations_apps_list, rpc_organizations_apps_add, rpc_organizations_apps_remove, operation_org_head_app_list,
    operation_org_head_app_add, operation_org_head_app_remove, table_org_apps, machine_org_app,
  ],
});

export const decision_organizations_head_commands = defineDecision({
  id: "organizations.head-commands",
  title: "Head: a Director connects after a preview; any member reads; no secret in a flag",
  question: "How do `org head connect|show|disconnect` behave, and where does the site's check happen?",
  options: [
    {
      label: "flow-and-rpcs",
      text:
        "`org head connect` (aaron.frappe-head) is a flow: it reads the key and secret, and on Frappe Cloud the team's " +
        "token and name, from a prompt or files; previews what is shared and asks; connects in one write that seals the " +
        "secrets and births the connection, whose process checks the site; and follows `organizations.heads.show` live " +
        "until connected or failing, ending with the issue's code (PROVIDER_ERROR unreachable; WRONG_STATE no Capxul " +
        "app, another time zone or currency; ROLE_PERMISSION_DENIED a refused key). `org head show` is that read, once, " +
        "for any member: the connection's own fields and the apps, never a secret, and not each app's sync position. " +
        "`org head disconnect` is a flow that reads the live head (none is WRONG_STATE), previews and asks, then calls one rpc, keeping every record. Connect and disconnect are a " +
        "Director's (the Director hat, from indexing), never an agent's.",
    },
    { label: "check-in-rpc", text: "The connect rpc reads the site before it writes (an action of class vendor), refusing a bad key at once." },
  ],
  chosen: "flow-and-rpcs",
  why:
    "Connecting hands the Organization's records to an outside system, so a person who governs runs it, a Director " +
    "(organizations.head-connection); the FDE prepares it and asks. Leaving the check to the connection's process " +
    "keeps the rpc one transaction and the check in one place, with the same reasons and retries on the first check as " +
    "on any later one; the flow's live follow gives the person the answer the rpc would have. Secrets in flags end up " +
    "in shell history and process lists (G5). Each app's sync position is in its own concept's tables, which " +
    "organizations cannot read (P4): a member reads it through that app's records. Disconnecting keeps Capxul's " +
    "records, which is what makes connecting safe to try. A preview is a prompt the SDK method asks, and the CLI calls " +
    "one method (A4), so both head writes that preview are flows, as `contact link` and `org hr employee leave` are.",
  source: passBy("books/target/shared/rulings.ts (aaron.frappe-head); docs/design/new-commands.md (G5, section 5.4); organizations.head-connection"),
  affects: [
    rpc_organizations_heads_connect, rpc_organizations_heads_show, rpc_organizations_heads_disconnect, flow_client_org_head_connect,
    flow_client_org_head_disconnect,
    operation_org_head_connect, operation_org_head_show, operation_org_head_disconnect, table_org_heads, machine_org_head,
  ],
});

export const decision_organizations_fde_commands = defineDecision({
  id: "organizations.fde-commands",
  title: "FDE: any member or named guest asks it, and it acts as the asker",
  question:
    "The FDE runs on Capxul's host, not beside the founder's CLI. How does the Organization see it and talk to it, " +
    "and who may?",
  options: [
    {
      label: "show-and-ask",
      text:
        "Under aaron.fde-hosted and aaron.fde-agent: `org fde show` for any member, from Capxul's own rows (the hosting, " +
        "what was paid, who last asked) and the chain's (its hats), never a call to the host. `org fde ask <message>` " +
        "for a Director: a flow that sends the message through `organizations.fde.ask` (the host's `send`; the ask " +
        "recorded with the asker and the message's length and hash, never its text), waits for the FDE's turn and reads " +
        "its reply through `organizations.fde.turn`; at the deadline it stops waiting and the FDE carries on. A " +
        "provisioned, paused, resuming or retired FDE, or none, is WRONG_STATE.",
    },
    {
      label: "any-member",
      text:
        "Any member asks, or anyone the Organization's management works with, as a guest it names (`org fde guest " +
        "add|remove|list`); the host passes the asker's Seat, so the FDE does for them only what their own hats allow " +
        "(organizations.fde-for-the-asker). `org fde show` as before; `org fde ask` as show-and-ask's flow, for any " +
        "member or guest; `org fde turn get <turn>` reads a turn its asker stopped waiting for.",
    },
    { label: "host-surface", text: "No ask command: people talk to the FDE on the host's own surface." },
  ],
  chosen: "any-member",
  why:
    "Aaron's ruling aaron.fde-anyone (8 November 2026, night; docs/decisions/open-for-aaron.md question 36): 'I think " +
    "anyone should be able to talk to the FDE, or anyone that the management is speaking to. The FDE is not on the " +
    "critical path anyway.' It supersedes show-and-ask, the Director-only booking, whose reason was that the FDE acted " +
    "with the hats the Board granted its own Safe, so whoever instructed it borrowed them; the ruling removes that " +
    "reason, because the host passes the asker's Seat and the FDE acts as the asker (organizations.fde-for-the-asker): " +
    "a member borrows nothing, and a write that needs a signature is the asker's own to sign. Who the management works " +
    "with is a list it keeps, since Capxul cannot know it otherwise (organizations.fde-guests). A surface on the host " +
    "alone would still put an unchecked path beside the CLI, through which the FDE must act. Recording who asked, but " +
    "not what, gives the Organization its audit beside each traced command without copying the host's conversation " +
    "into Capxul. A turn's reply may hold what only its asker may see, so only its asker reads it. The turn is a wait, " +
    "never system time, so the command's budget is its two host calls.",
  source: passBy("books/target/shared/rulings.ts (aaron.fde-agent, aaron.fde-hosted, aaron.fde-anyone); docs/decisions/open-for-aaron.md (question 36)"),
  affects: [
    rpc_organizations_fde_show, rpc_organizations_fde_ask, rpc_organizations_fde_turn, flow_client_org_fde_ask,
    operation_org_fde_show, operation_org_fde_ask, operation_org_fde_turn_get, table_org_fde_asks, table_org_fdes,
  ],
});

export const decision_organizations_seats_show = defineDecision({
  id: "organizations.seats-show",
  title: "`org seats show`: the limit, what uses it, what was bought, and the seat price",
  question: "A company buys more seats itself. Which command shows where it stands before it buys?",
  options: [
    {
      label: "show",
      text:
        "`org seats show` (aaron.buy-seats), for any member, one rpc over organizations' own rows: the limit, the Seats " +
        "that count one and the offers that reserve one, whether its own agent holds its place, the seats bought, who " +
        "last raised it, and SEAT_PRICE (null when unset).",
    },
    { label: "in-org-show", text: "Add the seats to `org show`'s output." },
  ],
  chosen: "show",
  why:
    "The grammar's singleton read (G3 `show`), booked by the concept that holds the limit: organizations.buy-seats puts " +
    "`org seats show` here and `org seats buy` in payments. `org show` is a frozen operation whose output is the " +
    "setup's, and a new capability does not reshape it. The price is the deployment's SEAT_PRICE (10 USDC, paid once), " +
    "so a buyer sees the cost before payments' command is born.",
  source: passBy("books/target/shared/rulings.ts (aaron.buy-seats, aaron.test-prices); docs/design/new-commands.md (section 5.5)"),
  affects: [rpc_organizations_seats_show, operation_org_seats_show, table_organizations, table_org_seat_purchases],
});

export const decision_organizations_fde_host = defineDecision({
  id: "organizations.fde-host",
  title: "Capxul's FDE host is swarmD: a component and the `fde-host` integration",
  question:
    "The FDE is a durable agent on a durable runtime with sandboxes, which Capxul runs for each Organization. What is " +
    "that runtime in the book, and how does the backend reach it?",
  options: [
    {
      label: "swarmd",
      text:
        "For aaron.fde-hosted: a component `fde-host`, Capxul's own swarmD namespace on Cloudflare (durable agents on " +
        "pi-durable, each worker with its own sandbox): one persistent worker per Organization's FDE, keyed " +
        "`fde:<orgId>`, whose instructions are Capxul's FDE persona and Frappe skills and whose tool is the Capxul CLI " +
        "signed in with the FDE's key (aaron.machine-login). The backend reaches it through an integration `fde-host` " +
        "(Effect service `FdeHost`) with calls `provision` (make the agent and its key, keep the key in the host's " +
        "secret store, answer the key's address), `start`, `pause`, `resume`, `retire`, `send` (post a message with " +
        "its asker; answer the turn) and `turn` (a turn's state and reply), each idempotent by the agent id. Failures " +
        "map as other vendors': unreachable PROVIDER_ERROR, 429 RATE_LIMITED, an undecodable answer " +
        "PROVIDER_RESPONSE_INVALID. Config FDE_HOST_URL; secret FDE_HOST_TOKEN. Its devnet fake is a stand-in host " +
        "(devnet.fde-host-stand-in).",
    },
    { label: "own-containers", text: "A container per Organization on Capxul's own servers, with a scheduler Capxul writes." },
    { label: "founder-machine", text: "Keep the FDE beside the founder's CLI, the earlier choice, which the hosting ruling rules out." },
  ],
  chosen: "swarmd",
  why:
    "swarmD is what the ruling describes: a durable agent whose conversation survives restarts in a Durable Object, a " +
    "sandbox per worker restored from a snapshot, secrets added on the way out so they never enter the sandbox, and an " +
    "SDK, CLI and MCP surface for the backend; Capxul's own build already runs on it (swarm.superset). Booking the host " +
    "as an integration keeps every outside call named (CONVENTIONS rule 9): the setup's provision, the hosting process's " +
    "start, pause, resume and retire, and the ask's send and turn. The backend sees only the FDE key's address, as for " +
    "every agent. The build pass booked integration `fde-host` in shared/external.ts, with swarmD as its outside " +
    "system and the backend hosting the service (no component of its own, as Bridge has none), FDE_HOST_URL and " +
    "FDE_HOST_TOKEN in the environments, and wired each call into its record's `calls`.",
  source: passBy("books/target/shared/rulings.ts (aaron.fde-hosted, aaron.machine-login); /home/user/swarmd/docs/SPEC.md (B.15, B.16)"),
  affects: [
    system_capxul, table_org_fdes, workflow_organizations_fde_host, workflow_organizations_setups_set_up, rpc_organizations_fde_ask,
    rpc_organizations_fde_turn, concept_agents,
  ],
});

export const decision_organizations_fde_hosting = defineDecision({
  id: "organizations.fde-hosting",
  title: "The FDE is paid a month ahead from a budget; an unpaid month pauses it",
  question:
    "The Organization pays Capxul for hosting its FDE, FDE_HOSTING_PRICE a month, a deployment setting. How is it " +
    "charged each month through `payments.prepare-command`, and what happens when it is not paid?",
  options: [
    {
      label: "in-advance",
      text:
        "Under aaron.fde-hosted and aaron.test-prices, in advance by the calendar month, from a budget: `org fde pay " +
        "[<months>] --from <budget>` (payments', organizations.buy-seats) births one command through " +
        "`payments.prepare-command` (route budget, owner the Organization, one item to Capxul's receiving Safe for the " +
        "months times FDE_HOSTING_PRICE, its source naming only the months, 1 to 12), signed by a person Budgets.authorised " +
        "admits on the budget. Its settlement invokes `organizations.extend-fde-hosting`, moving `paid_through` on from " +
        "the later of `paid_through` and the settlement; a reorg's reversal invokes `organizations.return-fde-hosting`, " +
        "which takes back exactly the span that payment added (calendar months from a later start do not subtract back). " +
        "The first month is the start-up's, from the setup's readiness. Each month the hosting falls due seven days " +
        "before `paid_through`, and notices reminds the Directors with the command to run. Unpaid at `paid_through`, the " +
        "host pauses the FDE: it takes no turn and its sandbox stops; the host keeps its key, conversation and " +
        "workspace; nothing on chain changes; `org fde ask` is WRONG_STATE. Paying again wakes it and the host resumes " +
        "it. A paused FDE is kept until paid or removed by the Board. With no price set, hosting is not charged.",
    },
    {
      label: "standing-agreement",
      text: "A standing agreement from a department's budget to Capxul's receiving Safe at the monthly rate, which Capxul collects and the department may end.",
    },
    { label: "dated-payments", text: "`org fde pay --monthly` schedules a dated payment for each month (Budgets.schedule), executed on its day by anyone." },
    { label: "grace", text: "As in-advance, but the first month is due at once, with seven days' grace before the pause." },
  ],
  chosen: "in-advance",
  why:
    "Paying in advance through `payments.prepare-command` is the route seats already take: one settlement path, one " +
    "book fact, counted only when the payment settles and only for the Organization that paid, and nothing for Capxul " +
    "to collect. The payment is the department's whose budget pays: whoever wears its hat, or one above it, now " +
    "(docs/design/authority.md); the FDE never pays for itself, as no agent buys from Capxul (G4). A standing agreement " +
    "makes Capxul a payee that must collect, and dated payments reserve a budget's room months ahead, which a department " +
    "would not expect. Pausing, not retiring, keeps what the FDE learnt and changes nothing on chain, so its authority " +
    "is as before when it resumes; months run from the payment, so a pause is never charged. The start-up month exists " +
    "because the FDE must set the Organization up before anyone can pay: at the install the company's top budget is 0 " +
    "and no budget is funded. No price, no charge, so `org fde pay`'s FEATURE_NOT_AVAILABLE means what it says. " +
    "Payments' booking (payments.fde-hosting-purchase) checks a hosting that is not retired and a price set before " +
    "the command is born. " +
    "For Aaron (docs/design/new-commands.md section 7, question 2): paying in advance by the month stands until he " +
    "answers; the alternative is the standing agreement, an automatic monthly charge.",
  source: passBy("books/target/shared/rulings.ts (aaron.fde-hosted, aaron.test-prices, aaron.departments); payments.prepare-command"),
  affects: [
    table_org_fdes, table_org_fde_payments, machine_org_fde, machine_fde_payment, procedure_organizations_extend_fde_hosting,
    procedure_organizations_return_fde_hosting, workflow_organizations_fde_host, operation_org_fde_show, concept_payments,
    concept_notices,
  ],
});

export const decision_organizations_command_priorities = defineDecision({
  id: "organizations.command-priorities",
  title: "The start-up's commands are critical: app list and add; the FDE's are not",
  question:
    "The grammar makes every new command normal; the commands pass marks the ones a pilot or a start-up needs critical. " +
    "Which of organizations' nine?",
  options: [
    {
      label: "start-up",
      text:
        "Four: `org fde show` and `org fde ask`, since under aaron.fde-hosted the founder reaches the FDE, which sets " +
        "the Organization up, only through them; and `org head app list` and `org head app add`, since aaron.fde-agent has the FDE " +
        "add the apps a business needs in that conversation. The head's three, `org head app remove` and `org seats show` are " +
        "normal: a head connects as a separate step (aaron.frappe-head), and a start-up has ten seats.",
    },
    {
      label: "start-up-without-fde",
      text:
        "Two: `org head app list` and `org head app add`, since a start-up adds the apps its business needs beyond the " +
        "fundamental ones, a Director directly or through the FDE. `org fde show` and `org fde ask` are normal, with the " +
        "head's three, `org head app remove` and `org seats show`.",
    },
    { label: "none", text: "Every command normal, as G8 has it." },
  ],
  chosen: "start-up-without-fde",
  why:
    "Aaron's ruling aaron.fde-anyone (8 November 2026, night, question 36, which named this record): 'The FDE is not " +
    "on the critical path anyway.' So start-up's premise, that `org fde ask` is how a founder's first sitting happens " +
    "at all, no longer holds, and the FDE's two commands are normal: nothing a pilot or a start-up needs waits on them. " +
    "A start-up still adds the apps beyond the fundamental ones, so `org head app list|add` stay critical. Critical orders " +
    "the build's work and the evals a start-up depends on; it changes no budget. projects.critical-commands does the " +
    "same for a pilot's first engagement.",
  source: passBy("docs/design/new-commands.md (G8); books/target/shared/rulings.ts (aaron.fde-anyone, aaron.fde-hosted, aaron.fde-agent, aaron.frappe-head)"),
  affects: ALL_NEW,
});

export const decision_organizations_command_worlds = defineDecision({
  id: "organizations.command-worlds",
  title: "Seven worlds for the new commands: a head's site, a head, a hosted FDE's states",
  question: "Which worlds do the nine commands' claims and refusals start from?",
  options: [
    {
      label: "reuse-and-six",
      text:
        "Reuse signed-out, two-founders (an outsider names Acme), org-ready (a Director, no head, no FDE), " +
        "org-with-member (Sam, a member with no hat; Olga outside) and org-with-pending-invitation. Ask devnet for: " +
        "org-with-head-site (org-with-member plus a stand-in Frappe site for Acme, hosted as on Frappe Cloud, up and not " +
        "connected), org-with-head (that site connected by Dana as a Frappe Cloud head, whose host installs a wanted app), org-with-head-site-down (the site's fault switch down), org-with-fde (rebuilt " +
        "for the hosted FDE of aaron.fde-hosted: its key with the stand-in host, its hosting running in its start-up " +
        "month), org-with-fde-paused (org-with-fde warped past its paid-through instant, unpaid) and " +
        "org-with-fde-host-down (org-with-fde with the stand-in host's fault switch down); and org-with-fde-allowance " +
        "(org-with-fde, funded, with a Board top budget, an allowance under it that Dana wears and the payout ceiling set), from which a hosting payment, and payments' `org fde pay` " +
        "and `org seats buy`, start.",
    },
    { label: "steps-in-evals", text: "Each eval connects a site or warps the FDE itself, from org-ready or org-with-fde." },
  ],
  chosen: "reuse-and-six",
  why:
    "Each refusal needs a state no catalogued world holds: a site to connect, a live head, a hosted FDE paused or " +
    "unreachable. Building the head worlds from org-with-member keeps Sam (no Director hat) and Olga (outside) in each, " +
    "so the authority refusals need no world of their own. The paused world is a warp, so it proves the lapse on the " +
    "one clock (devnet.warp-barrier). A world is shared by every claim that starts from it, so building each once is " +
    "cheaper than repeating its steps in each eval.",
  source: passBy("books/target/devnet/worlds.ts; devnet.head-stand-in; devnet.fde-host-stand-in; aaron.fde-hosted"),
  affects: [...ALL_NEW, concept_devnet],
});

export const decision_organizations_founder_people_hat = defineDecision({
  id: "organizations.founder-people-hat",
  title: "A founder wears the People hat, so holds no department until it is revoked",
  question:
    "The setup mints the People hat to the founder (the founder wears Books, Invoicing and People), and a People-hat " +
    "wearer may hold no department or team office (ROLE_CONFLICT: budgets.role-conflict-people-hat, " +
    "board.people-hat-role-conflict). People are swapped in and out of departments by hat. What may a founder do with " +
    "a department's money, and where is that said?",
  options: [
    {
      label: "keep-and-state",
      text:
        "Keep both (aaron.departments), and say the consequence in the founder's journey: while the founder wears the " +
        "People hat they are never swapped into a department or team. They pay as the Board (while the only Director, a " +
        "Board proposal needs only their signature) or from an allowance, whose hat sits under the Board's top hat and " +
        "is no office, and they offer agreements only from an allowance. To run a department themselves, the Board " +
        "first grants the People hat to another member and revokes the founder's.",
    },
    { label: "founder-exempt", text: "Exempt the founder from ROLE_CONFLICT." },
    { label: "no-people-at-setup", text: "The setup mints no People hat to the founder." },
  ],
  chosen: "keep-and-state",
  why:
    "The frozen behaviour holds both: org-ready's founder wears the three officer hats, and ROLE_CONFLICT is a frozen " +
    "refusal, the separation of duties between who manages people and who spends a department's money. On v4 the " +
    "People hat grants no money authority (offices and allowances are minted by the Board or an office above), so the " +
    "conflict guards a product rule, not a chain power (docs/design/authority.md). A solo founder is not blocked: as the " +
    "Board they pay, schedule and create budgets with their one signature, and an allowance gives them a budget of their " +
    "own to spend from, which is also what `org seats buy` spends (organizations.buy-seats). Exempting the founder would " +
    "empty the rule for the person it most often meets; minting no People hat would break the frozen worlds and leave " +
    "nobody able to invite. So the rule stays and is said where a founder meets it.",
  source: passBy("docs/design/authority.md (contradiction 9); budgets.role-conflict-people-hat; board.people-hat-role-conflict; aaron.departments"),
  affects: [workflow_organizations_setups_set_up, table_org_deployments, concept_budgets, concept_board],
});

// ── the world pass: anyone talks to the FDE, and the document family (8 November 2026) ──────

import {
  machine_fde_guest,
  table_org_doc_calls,
  table_org_fde_guests,
} from "./data.ts";
import {
  rpc_organizations_fde_guests_add,
  rpc_organizations_fde_guests_list,
  rpc_organizations_fde_guests_remove,
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
  rpc_organizations_docs_remove,
  rpc_organizations_docs_submit,
  rpc_organizations_doctypes_get,
  rpc_organizations_doctypes_list,
} from "./docs.ts";
import { flow_client_org_head_docs_remove } from "./flows.ts";
import {
  DOC_OPERATIONS,
  FDE_ANYONE_OPERATIONS,
  operation_org_head_doc_amend,
  operation_org_head_doc_call_list,
  operation_org_head_doc_remove,
  operation_org_head_doc_submit,
  operation_org_head_doctype_get,
  operation_org_head_doctype_list,
  operation_org_fde_guest_add,
  operation_org_fde_guest_list,
  operation_org_fde_guest_remove,
} from "./operations.ts";
import { procedure_accounts_admit } from "../accounts/procedures.ts";
import { procedure_parties_resolve_recipient } from "../parties/procedures.ts";
import { component_core_sdk, concept_accounts, concept_approvals } from "../shared/foundation.ts";
import { integration_fde_host as integration_fde_host_ } from "../shared/external.ts";

const WORLD = "Claude, organizations world pass (doc-family lane), 8 November 2026";
const worldBy = (evidence: string) => `${WORLD}; evidence: ${evidence}`;
const DOC_RPCS = [
  rpc_organizations_docs_list, rpc_organizations_docs_get, rpc_organizations_docs_create, rpc_organizations_docs_change,
  rpc_organizations_docs_submit, rpc_organizations_docs_cancel, rpc_organizations_docs_amend, rpc_organizations_docs_apply,
  rpc_organizations_docs_remove, rpc_organizations_doctypes_list, rpc_organizations_doctypes_get,
];

export const decision_organizations_fde_for_the_asker = defineDecision({
  id: "organizations.fde-for-the-asker",
  title: "The hosted FDE acts as its asker: their Seat and hats, their signature",
  question:
    "aaron.fde-anyone: 'the host passes the asker's Seat, so the FDE does for them only what their own hats allow'. The " +
    "FDE signs in with its own key and its Safe wears its own hats. How does a call it makes for an asker carry the " +
    "asker's authority, and what signs?",
  options: [
    {
      label: "act-as-asker",
      text:
        "Each ask mints a fresh act-for token; Capxul keeps its hash on the ask (`org-fde-asks`) and the host gives the " +
        "token to the FDE's CLI for that turn only (on swarmD, added as a header on the way out, never inside the " +
        "sandbox). A call the FDE makes with it is the asker's: the tenant guard every concept runs first (organizations' " +
        "Seat lookup) answers the asker's Seat, Safe and hats in place of the FDE's, while the ask is open: its asker " +
        "still a member (or an active guest), its turn not read ended, and the world's now before `expires_at` " +
        "(FDE_ASK_HOURS). Otherwise, or with no token, the FDE's call is ROLE_PERMISSION_DENIED: the hosted FDE never " +
        "acts as itself. A write that needs a signature opens its approval for the asker's own Safe, and the FDE's SDK, " +
        "holding no key of the asker's, hands it over (the `--no-wait` answer, or `--json`'s for the payment family) for the asker to sign on the approval " +
        "page. A command that previews and asks (G5) is the asker's own to answer, so its rpc refuses an act-for call " +
        "(ROLE_PERMISSION_DENIED). Every span carries the FDE as actor and the asker; records are written as the asker's.",
    },
    {
      label: "intersection",
      text:
        "The FDE acts as itself, signing with its own Safe, and every guard also checks the asker: it may do only what " +
        "both its own hats and the asker's allow.",
    },
    { label: "own-hats", text: "The FDE acts with its own Seat and hats, whoever asks (the Director-only booking's premise)." },
  ],
  chosen: "act-as-asker",
  why:
    "The ruling's words: the host passes the asker's Seat, and the FDE does only what the asker's hats allow. Acting as " +
    "the asker is exactly that, with nothing for any concept's guard to learn, because the Seat lookup every guard " +
    "already runs is organizations' and answers the asker. The chain enforces it too: what moves money is signed by " +
    "the asker's own Safe, so the FDE's key can never spend a hat the asker lacks, which was the objection to letting " +
    "any member ask (the FDE's Safe holds its own hats, whoever asks). Intersection would make the FDE useless until " +
    "the Board grants it every hat any asker might use, and then needs every guard rewritten to check two Seats. A " +
    "short-lived token per ask, hashed in Capxul and held by the host only for the turn, limits what a leaked token " +
    "could do to one asker for hours on the world's clock, and removal of a guest or the end of a Seat ends it at " +
    "once. So the hosted FDE needs no hat of its own (agents.fde-authority). For Aaron, to confirm the reading: the " +
    "FDE then never acts with hats the Board granted its Safe, and every signature is the asker's. For the shared " +
    "designer: the tenant layer's resolution of an act-for token belongs in the shared rules, and the Core SDK's " +
    "signing steps hand over under an act-for session.",
  source: worldBy("books/target/shared/rulings.ts (aaron.fde-anyone, aaron.departments); docs/design/authority.md (Agents and the FDE); access.assistants (the person signs every approval)"),
  affects: [
    table_org_fde_asks, rpc_organizations_fde_ask, rpc_organizations_fde_turn, flow_client_org_fde_ask, operation_org_fde_ask,
    table_org_members, integration_fde_host_, component_core_sdk, concept_approvals, concept_agents,
  ],
});

export const decision_organizations_fde_guests = defineDecision({
  id: "organizations.fde-guests",
  title: "Guests: People or a Director names the outside people who may talk to the FDE",
  question:
    "aaron.fde-anyone lets 'anyone that the management is speaking to' talk to the FDE. Capxul cannot know who that is. " +
    "Who says, how is an outside person reached, and what may the FDE do for them?",
  options: [
    {
      label: "named-guests",
      text:
        "A list the management keeps: `org fde guest add <email|@handle> [--note]`, `org fde guest remove` and `org fde " +
        "guest list` (organizations' `org-fde-guests`, one row per person, with its machine). People or a Director " +
        "names a person (never a member, an agent or an Organization), resolved as an invitee is (`parties.resolve-" +
        "recipient`) and admitted to the beta in the same transaction (`accounts.admit`, via fde-guest) so they can sign " +
        "in; notices tells them how to ask. A guest asks with `org fde ask --org <handle>`; holding no Seat, the FDE " +
        "acting for them reaches only what their own Party is admitted to. Removing a guest ends their asks at once. " +
        "`org fde turn get` lets any asker read a turn later.",
    },
    { label: "any-party", text: "Anyone the Organization has a record with (a contact, a payee, a payer) may ask, with no list." },
    { label: "members-only", text: "Only members ask; outside people talk to the management, who ask for them." },
  ],
  chosen: "named-guests",
  why:
    "The ruling names two groups: any member, and anyone the management is speaking to. The second is the management's " +
    "to say, so it names them; inferring it from records would let anyone who was once paid run the Organization's " +
    "hosted agent, which it pays for. Management is People or a Director: the People hat already decides who comes " +
    "into the Organization (invitations, Seats), and Directors govern. A guest is a person because a turn is a " +
    "conversation with someone who signs in, and an agent or Organization has its own way in. Admitting a guest to the " +
    "beta in the naming transaction is the invitation's own reason (procedures.accounts-admit): a named guest who " +
    "could not sign in would be named for nothing. The FDE does for a guest only what the guest may do, because the " +
    "ruling says 'only what their own hats allow' and a guest wears none here; a guest's own dealings with the " +
    "Organization are already theirs to read through the admissions (rules.counterparty-reads). Reading a turn later " +
    "closes a gap the ask's deadline left: until now a reply after the deadline could not be read at all. For the " +
    "accounts and shared designers: `accounts.admit` gains `via` fde-guest; for notices, a guest-named email.",
  source: worldBy("books/target/shared/rulings.ts (aaron.fde-anyone); organizations.invitation-process; procedures.accounts-admit"),
  affects: [
    table_org_fde_guests, machine_fde_guest, rpc_organizations_fde_guests_add, rpc_organizations_fde_guests_remove,
    rpc_organizations_fde_guests_list, operation_org_fde_guest_add, operation_org_fde_guest_remove, operation_org_fde_guest_list,
    ...FDE_ANYONE_OPERATIONS, procedure_accounts_admit, procedure_parties_resolve_recipient, concept_accounts, concept_notices,
  ],
});

export const decision_organizations_doc_family = defineDecision({
  id: "organizations.doc-family",
  title: "Decision pack: the document family that reaches what lives only on the head",
  question:
    "aaron.sdk-reaches-everything: the Core SDK and the CLI reach every capability, and what lives only on a connected " +
    "head is reached 'through a generic document family over the SDK (`org doc list|get|create|change|submit|cancel " +
    "<DocType>`), with the caller's authority, logged, on the world clock' (spelt `org head doc` since " +
    "organizations.head-group). Which commands, and what does Frappe's own REST API need that those six lack?",
  options: [
    {
      label: "six-and-what-frappe-needs",
      text:
        "Recommended: twelve commands in the one grammar (docs/design/new-commands.md section 5.7), each one SDK " +
        "method under `client.org(orgId)` over one rpc in organizations (`organizations.docs.*`, `organizations." +
        "doctypes.*`, `organizations.doc-calls.list`): the six ruled, `org head doc list|get|create|change|submit|cancel " +
        "<DocType>`; three Frappe's documents need, `org head doc amend` (a cancelled document's correction), `org head doc apply " +
        "<action>` (a Workflow's step, since a DocType under a Workflow moves only by its actions) and `org head doc " +
        "remove` (Frappe's Delete, for a draft or a document that is never submitted: a flow that previews); two that " +
        "say what can be reached, `org head doctype list|get` (Frappe's meta: fields, child tables, Workflow, the member's " +
        "rights, and why a DocType is not reached); and `org head doc-call list`, the log. Left out: a count (a list pages), " +
        "copy (create and amend cover it), bulk writes (each document is its own authorised, logged call), whitelisted " +
        "methods (they write any DocType, a native or a money one, around the family's guard; a head capability that " +
        "needs one is designed as its own command), and files and comments (Frappe's core module is native).",
    },
    { label: "six-only", text: "Exactly the six commands of the ruling." },
    { label: "rest-proxy", text: "One command that passes any path and body to the head's REST API." },
  ],
  chosen: "six-and-what-frappe-needs",
  why:
    "A pack under rules.new-operations, serving aaron.sdk-reaches-everything; For Aaron: the twelve stand until he " +
    "answers. The six alone cannot finish what Frappe starts: a cancelled document is corrected only by Amend, a " +
    "DocType with an active Workflow moves through its actions, whose transitions carry the roles, conditions and " +
    "self-approval rule the head's approvals are made of, and a draft made in error can only be deleted, since Frappe " +
    "cancels only what was submitted. Frappe's desk offers a Workflow's document only its actions, but its server does " +
    "not refuse a direct submit or cancel: validate_workflow checks only a changed state, and set_workflow_state_on_action " +
    "then sets the state the Workflow gives that docstatus, so the Capxul app refuses `org head doc submit` and `cancel` " +
    "under an active Workflow itself, as the desk does, and `apply` is the only way through. An agent or a program " +
    "using the SDK must also learn what a DocType takes before it writes, which " +
    "is Frappe's meta. A REST proxy would hand the head's whole API, its methods included, to every caller around the " +
    "guards the ruling asks for. Every family command is `vendor` (G8: it calls the head before it answers), " +
    "`normal` priority (no pilot and no start-up runs one), area `organizations`, implemented by its rpc except " +
    "`org head doc remove`, a flow because it previews (G5). The React SDK does not mirror the family: it is the Core SDK's " +
    "and the CLI's (the ruling draws the line there). The head's two methods, `docRead` and `docWrite`, are the " +
    "`frappe-head` integration's (shared/external.ts) and the Capxul app's to serve (component frappe-app).",
  source: worldBy("books/target/shared/rulings.ts (aaron.sdk-reaches-everything, aaron.frappe-head); /tmp/frappe/frappe/api/v2.py; /tmp/frappe/frappe/model/workflow.py"),
  affects: [
    ...DOC_RPCS, rpc_organizations_doc_calls_list, flow_client_org_head_docs_remove, table_org_doc_calls, ...DOC_OPERATIONS,
    integration_frappe_head, component_frappe_app, system_capxul,
  ],
});

export const decision_organizations_doc_reach = defineDecision({
  id: "organizations.doc-reach",
  title: "The family never reaches a native DocType, money, or the head's machinery",
  question:
    "The ruling refuses the family 'for any DocType a native concept owns (those have their own commands) and for money " +
    "(Capxul is the system of record)'. Which DocTypes are those, and who decides, Capxul or the head?",
  options: [
    {
      label: "lists-and-hooks",
      text:
        "Four refusals, all INVALID_INPUT with the reason. Native: every DocType of a native app's modules (`org-apps`' " +
        "`modules`: Frappe's core, ERPNext's accounts and projects, Frappe HR's payroll, Frappe CRM's FCRM), naming " +
        "that module's commands (NATIVE_MODULE_COMMANDS), and each DocType a native concept holds elsewhere " +
        "(NATIVE_DOCTYPES: Company, Department, Employee, Customer, Supplier, Contact, Address, Currency, payroll.hr-" +
        "scope's native HR DocTypes and HR Settings, the WhatsApp app's WA Account and WA Message, and the CRM's email, " +
        "Communication), naming the " +
        "commands that reach it. Money: any DocType the head's installed apps list in LEDGER_HOOKS " +
        "(`accounting_dimension_doctypes`, `period_closing_doctypes`, the advance-payment, bank-reconciliation, " +
        "audit-trail and repost-allowed lists, merged as frappe.get_hooks merges them) and their child tables; the " +
        "DocTypes that post or re-post the ledger though no hook lists them (LEDGER_UNHOOKED: ERPNext's Repost Item " +
        "Valuation); and every DocType of a money module (MONEY_MODULES: Frappe Lending's Loan Management). Machinery: " +
        "HEAD_MACHINERY, what changes who may do what on the head or what a DocType is, runs code there, moves data in " +
        "bulk, lets someone with no User write, holds sign-in or outside credentials, or sends through the head's own " +
        "channels. Child tables: reached only through their parent. Capxul refuses the named lists before any call; the " +
        "Capxul app refuses by module and hooks, which only the head knows.",
    },
    { label: "allowlist", text: "Reach only a list of head-only DocTypes Capxul names (recruitment, appraisal, training, onboarding)." },
    { label: "drafts-of-money", text: "As lists-and-hooks, but let money DocTypes be read and kept as drafts, refusing only their submit." },
  ],
  chosen: "lists-and-hooks",
  why:
    "Native is a fact of Capxul's book, so Capxul's own list says it, before the head is called; a module's DocTypes " +
    "change with each Frappe release, so the app reads them from the head's meta. Money cannot be listed once: an app " +
    "installed later brings its own, and the apps declare most of what posts in these hooks (ERPNext's Stock Entry, " +
    "Delivery Note, Purchase Receipt, Landed Cost Voucher and Asset; the Sales and Purchase Orders that take advances; " +
    "Frappe HR's Expense Claim, Payroll Entry, Leave Encashment and Gratuity), so the rule follows the apps. Not all, " +
    "as reading every posting controller showed: ERPNext's Repost Item Valuation, which the Books hat's Accounts " +
    "Manager may submit, rewrites past vouchers' ledger entries, and Frappe Lending (in HEAD_APPS) posts from Loan " +
    "Accrual Repost, Loan Repayment Repost, Loan Transfer and Process Loan Accounting, listed in none of its hooks; so " +
    "Capxul names the first, takes Loan Management as money whole, and a lane that finds another adds it. An " +
    "allowlist fails 'everything' the day a customer installs Helpdesk. The machinery is refused " +
    "because identity is Capxul's (organizations.head-ownership) and each item reaches native or money records, or " +
    "the world's channels (aaron.world-clock), around the guard: a Custom Field, Property Setter or Workflow changes " +
    "how a native DocType behaves, a Notification sends and sets fields on any document, a Web Form lets someone with " +
    "no User write, and the rest run code, move data in bulk or hold sign-in and credentials; Frappe's core module " +
    "(Server Script, User, Role, Data Import) is native anyway. For Aaron: " +
    "stock, selling and buying documents post to the ledger, so they are money here and are worked in the head's own " +
    "desk (books copies their vouchers, books.head-vouchers); drafts-of-money would let the SDK prepare them. " +
    "NATIVE_DOCTYPES' HR rows are payroll.hr-scope's, and its WhatsApp rows the real app's WA Account and WA Message.",
  source: worldBy(
    "erpnext and hrms hooks.py; erpnext stock/repost_item_valuation; frappe/lending hooks.py, loan_management; " +
      "frappe@1a7ea577 custom, workflow, email, website; frappe/whatsapp WA Account; payroll.hr-scope",
  ),
  affects: [...DOC_RPCS, table_org_apps, integration_frappe_head, component_frappe_app, concept_books, concept_payroll, concept_contacts, concept_projects],
});

export const decision_organizations_doc_authority = defineDecision({
  id: "organizations.doc-authority",
  title: "A family call runs on the head as the member's own User; the head decides",
  question:
    "The ruling: 'the caller's authority mapped (a member's hats to the head's roles; a head user matched by mailbox)'. " +
    "As whom does a family call run on the head, and whose rules decide it?",
  options: [
    {
      label: "as-own-user",
      text:
        "Capxul's backend calls the Capxul app with the connection's key, the member's mailbox and member id, and the " +
        "roles the member's hats give at that moment (indexing's wearers, read at the call, mapped as " +
        "organizations.head-users maps them); the app finds the enabled User carrying that `capxul_id` at that mailbox " +
        "(pushed by organizations.head-users), first brings that User's Capxul-held roles to that set where they differ, " +
        "as the next push would, and runs the call as that User (`frappe.set_user`), so Frappe's own role permissions, " +
        "user permissions, permission query conditions, field levels and validations decide, as in its desk. A missing " +
        "or disabled User is ROLE_PERMISSION_DENIED. Only a person member has a User: an agent's own call is refused, and " +
        "the hosted FDE acts as its asker's User (organizations.fde-for-the-asker). A guest has no Seat and is refused.",
    },
    { label: "connection-user", text: "Every call runs as the connection's own head user, and Capxul checks the member's hats itself." },
    { label: "hats-only", text: "Capxul maps each DocType to a hat and checks it; the head is called as the connection's user." },
  ],
  chosen: "as-own-user",
  why:
    "These documents are the head's (organizations.head-ownership: every other app's documents are the head's), so the " +
    "head's own rules are the authority over them, and running as the member's User applies exactly those rules with " +
    "nothing copied into Capxul. The roles that User holds are the hats' (People gives HR Manager, which Frappe HR's " +
    "recruitment, training and onboarding DocTypes grant nearly everything; an Appraisal's cancel and amend are HR " +
    "User's alone, and a Workflow's actions only its transitions' roles, which Frappe never inherits from another), " +
    "plus any the head's administrator gave it, " +
    "which the head trusts for its own documents; they still never authorise a pulled edit of Capxul's records. The " +
    "hats' roles are set at each call because authority follows the hat at that moment (docs/design/authority.md: a " +
    "person swapped out loses it), and the push alone runs up to a day behind a hat, which a pulled edit survives " +
    "(Capxul judges it again) but a family call would not (the head alone decides it). Running " +
    "as the connection's user would give every member the connection's rights, and a Capxul map of every DocType of " +
    "every app to a hat would be a second permission model that drifts from the head's. Matching by mailbox and member " +
    "id keeps a head administrator's User of the same email from standing in for a member. Agents have no User because " +
    "Frappe keys a User by email (organizations.head-users); an agent works through native commands.",
  source: worldBy("/tmp/frappe/frappe/client.py; /tmp/hrms/hrms/hr/doctype/job_opening/job_opening.json (HR User, HR Manager); organizations.head-users"),
  affects: [...DOC_RPCS, integration_frappe_head, component_frappe_app, table_org_members],
});

export const decision_organizations_doc_log = defineDecision({
  id: "organizations.doc-log",
  title: "Every family call is logged once, by its call id, on the world's clock",
  question: "The ruling says the family is 'logged'. What is logged, when, who reads it, and how does a retry stay one call?",
  options: [
    {
      label: "every-call",
      text:
        "`org-doc-calls`: one row per call, read or write, done or refused, written in one transaction after the head " +
        "answers or Capxul refuses: whose authority (the member, or the FDE's asker with the ask), the head User, the " +
        "verb, the DocType and name, the outcome and code, field and filter names but never values, the count, the " +
        "head's `modified` and docstatus after a write, and `at`, the world's now. The SDK method makes the call id once " +
        "and repeats it on a retry: a logged id answers as logged, and the Capxul app answers a write it already applied " +
        "under that id as the first time. A call the head did not answer (PROVIDER_ERROR, RATE_LIMITED) is logged " +
        "refused but is the one row that may change, once: a retry under its id calls the head again, and the row " +
        "records what the head then answers, with `completed_at`. `org head doc-call list`: a Director reads every call, any " +
        "other member their own.",
    },
    { label: "writes-only", text: "Log only writes; reads appear in traces." },
    { label: "head-versions", text: "Log nothing in Capxul: Frappe's Version and Activity Log already record changes." },
  ],
  chosen: "every-call",
  why:
    "Reads are logged too because the hosted FDE now reads for anyone (aaron.fde-anyone), and an Organization must be " +
    "able to see what was read from its HR records and for whom; Frappe's Version records changes, not reads, and " +
    "lives on a head that may be disconnected. Names but never values keep Capxul from copying the head's documents " +
    "(organizations.head-ownership). One call id per invocation makes a create after a lost answer one document, " +
    "which Frappe's insert alone is not. Logging after the answer, as the FDE's ask does, keeps each rpc to one " +
    "transaction; a crash between the head's write and the log leaves the write unlogged until the SDK's retry, " +
    "which the app answers from its record of the call id. A lost answer is the same case seen from the other side: " +
    "the head may have applied the write, so a PROVIDER_ERROR row that answered every retry as logged would record a " +
    "write as refused for good and leave the SDK's retry unable to learn the document it made; completing that one " +
    "row keeps the log true and the write once. A Director governs, so reads every call; anyone else sees " +
    "what was done with their own authority. `at` is the world's now (aaron.world-clock), and the head stamps its own " +
    "documents with its now, which follows the same clock (organizations.head-clock).",
  source: worldBy("books/target/shared/rulings.ts (aaron.sdk-reaches-everything, aaron.world-clock); organizations.fde-commands (the ask is logged after the host answers)"),
  affects: [table_org_doc_calls, rpc_organizations_doc_calls_list, operation_org_head_doc_call_list, ...DOC_RPCS, component_core_sdk, component_frappe_app],
});

export const decision_organizations_doc_worlds = defineDecision({
  id: "organizations.doc-worlds",
  title: "Worlds for the family and for anyone asking the FDE: head documents, guests",
  question: "Which worlds do the document family's and the FDE commands' claims and refusals start from?",
  options: [
    {
      label: "reuse-and-five",
      text:
        "Reuse signed-out, org-with-member (no head), org-with-head, org-with-fde, org-with-fde-paused, " +
        "org-with-fde-host-down and org-with-fde-allowance. Ask devnet for five: org-with-head-docs (org-with-head plus, " +
        "on the stand-in head, a Designation Accountant; Job Openings HR-OPN-2026-0001 and -0002, both Open, -0002 made " +
        "a second after -0001 so their `modified` differ; Training Events `Onboarding week` (draft), `Safety training` " +
        "(submitted, with an employee row) and `Old induction` (cancelled); a Job Applicant named, as Frappe HR names " +
        "one, by its email, kim@applicants.test, under a Workflow `Applicant Review`, Open to Shortlisted (Shortlist) or " +
        "Rejected (Reject), Shortlisted to Accepted (Accept), its transitions allowed to HR Manager, the role the People " +
        "hat gives Dana's User (organizations.head-users), not HR User, which no hat gives; Sam's User with no HR " +
        "role; the meta's modules, Project in ERPNext's projects; ERPNext's ledger hooks naming Stock Entry), " +
        "org-with-head-down (org-with-head with the stand-in head's " +
        "fault switch down), org-with-fde-member (org-with-fde plus Sam's Seat with no hat and Olga ready outside) and " +
        "org-with-fde-guest (org-with-fde-member with Olga named a guest by Dana, note `Our accountant`), and " +
        "org-with-fde-head-docs (org-with-fde-member with the stand-in head connected by Dana and holding " +
        "org-with-head-docs' documents).",
    },
    { label: "real-bench", text: "Run every family claim against a real bench with Frappe HR, booted as a follower." },
  ],
  chosen: "reuse-and-five",
  why:
    "Each refusal needs a state no catalogued world holds: head documents in each docstatus and a Workflow, a head " +
    "that stops answering after it connected, an FDE with a member who wears no hat, and a named guest. The stand-in " +
    "head must then answer `docRead` and `docWrite` for its documents: Frappe's docstatus rules (submit a draft, " +
    "cancel a submitted one, amend a cancelled one, never delete a submitted one), the fixture DocTypes' role " +
    "permissions, their mandatory fields, the Workflow's transitions, the ledger hooks, and a call id it already " +
    "applied. A real bench (devnet.head-stand-in's escape hatch) stays for a claim that needs Frappe's own validations; " +
    "none of these does. Two facts of the real systems shape the claims. The stand-in host ends a turn as it is " +
    "posted, and an ask closes once its turn is read ended, which `org fde ask` does before it returns; so a claim " +
    "that runs the FDE's commands under an ask holds turns first (`capxul-devnet fault fde-host hold`) and asks with " +
    "`--timeout-seconds 1`, whose CLI_DEADLINE answer gives the ask's id and leaves it open, then runs them with " +
    "`capxul-devnet fde run <org> --ask <askId> --`, which devnet adds to its stand-in host. And the head stamps " +
    "`modified` with the world's now, so on a frozen clock two writes at one instant share a stamp and Frappe's " +
    "timestamp check cannot tell them apart: the `--modified` claim warps between the two writes. For the devnet " +
    "designer: these worlds, the stand-in head's family methods and its `drop-answer` fault (the first answer held " +
    "back once, after the write), and `fde run --ask`.",
  source: worldBy(
    "devnet worlds.ts; devnet.head-stand-in; devnet.fde-host-stand-in; hrms job_applicant.py (autoname); " +
      "frappe workflow.py (get_transitions); document.py (check_if_latest)",
  ),
  affects: [...DOC_OPERATIONS, ...FDE_ANYONE_OPERATIONS, operation_org_fde_ask, concept_devnet],
});

// ── the command surface (surface.tree, surface.head-group; Aaron, 9 November 2026) ──────────────────────────────

const SURFACE_PASS = "Claude, surface pass, 9 November 2026 (question 48)";
const surfaceBy = (evidence: string) => `${SURFACE_PASS}; evidence: ${evidence}`;

/** The fifteen commands surface.head-group moves under `org head`. */
const HEAD_GROUP_OPERATIONS = [operation_org_head_app_list, operation_org_head_app_add, operation_org_head_app_remove, ...DOC_OPERATIONS];

export const decision_organizations_head_group = defineDecision({
  id: "organizations.head-group",
  title: "The head's apps, documents, DocTypes and call log are spelt under `org head`",
  question:
    "Aaron, 9 November 2026: 'The number was not the issue. We need everything you can do on Frappe to be programmatic " +
    "and accessible from our tooling. It's the logical groupings.' surface.head-group puts the Frappe site's commands " +
    "in one group, `org head`. How does organizations apply it to the fifteen commands it booked under `org app`, " +
    "`org doc`, `org doctype` and `org doc-call`?",
  options: [
    {
      label: "spelling-only",
      text:
        "Rename each command, its id and its export to the tree's words, its SDK method and flow with them, and change " +
        "no behaviour, claim or refusal but the commands they quote. `org app list|add|remove` becomes `org head app " +
        "list|add|remove` (ids org.head.app.*); `org doc list|get|create|change|submit|cancel|amend|apply|remove` " +
        "becomes `org head doc …` (org.head.doc.*); `org doctype list|get` becomes `org head doctype list|get` " +
        "(org.head.doctype.*); `org doc-call list` becomes `org head doc-call list` (org.head.doc-call.list). Every SDK " +
        "method gains `.head` (`client.org(orgId).head.apps.list`, `.head.docs.get`, `.head.doctypes.list`, " +
        "`.head.docCalls.list`), so the flow client.org.docs.remove becomes client.org.head.docs.remove. The commands " +
        "a refusal names follow the tree as well: NATIVE_DOCTYPES and NATIVE_MODULE_COMMANDS now name `org hr " +
        "employee`, `hr leave` and `org hr leave`, `org projects`, `org projects task` and `org projects timesheet`, and " +
        "the rest of HR's and payroll's new words.",
    },
    { label: "alias", text: "Book the tree's spelling beside the old one, both answering." },
    { label: "as-booked", text: "Keep the four nouns as booked (surface.head-group's own as-booked option)." },
  ],
  chosen: "spelling-only",
  why:
    "All fifteen are operations beyond the 215 (rules.new-operations), so each id is its command's words and moves " +
    "with them, and no command of the 215 is renamed. An alias gives one capability two commands, which rule 4a " +
    "forbids (a command is no other operation's). The rpcs keep their ids (`organizations.docs.*`), which name the " +
    "concept's area, not a command. Where a decision quotes Aaron or a question as it was asked, the quotation keeps " +
    "its words. What reaches what does not change: organizations.doc-reach stays as accepted until Aaron answers " +
    "question 52 (surface.frappe-reach). The commands still serve aaron.frappe-head (apps) and " +
    "aaron.sdk-reaches-everything (the document family).",
  source: surfaceBy("surface.tree; surface.head-group; docs/design/command-surface.md 4, 5.2, 9; aaron.frappe-head; aaron.sdk-reaches-everything"),
  affects: [...HEAD_GROUP_OPERATIONS, flow_client_org_head_docs_remove, table_org_doc_calls, component_core_sdk],
});

export const decision_organizations_head_claims = defineDecision({
  id: "organizations.head-claims",
  title: "Each head command claims what it really does: its answer, its writes, a retry",
  question:
    "Five of organizations' commands beyond the 215 carried one acceptance claim each: `org head show`, `org head doc " +
    "submit`, `org head doc amend`, `org head doctype list` and `org fde guest list`. Which further claims does each " +
    "behaviour already booked have, observable through the CLI from a catalogued world?",
  options: [
    {
      label: "what-the-rpc-does",
      text:
        "Claim what each one's rpc already books, and nothing else. `org head show`: the apps as the head runs them; it " +
        "reads only Capxul's rows, so it answers while the head is down; failing at the daily check that fails and " +
        "connected at the next good one (organizations.heads.watch's `stall` and `recover`); `rungAt` on the world's " +
        "clock (organizations.heads.ring). `org head doc submit`: the head User and the world's clock in its log row; a " +
        "DocType that is never submitted refused; a retry under the same call id submits once (organizations.doc-log). " +
        "`org head doc amend`: the amendment is a draft to submit, the original stays cancelled; an amendment's " +
        "amendment is `-2`; a retry amends once. `org head doctype list`: `--module`, and a native module naming its " +
        "commands; no child table; paging by name; the call logged. `org fde guest list`: removed guests after active, " +
        "`--status`, paging, no write.",
    },
    { label: "one-each", text: "Keep one claim each: the success path is enough for a read or a single write." },
  ],
  chosen: "what-the-rpc-does",
  why:
    "A claim is an eval, and one claim leaves the rest of a command's booked behaviour untested: what it answers, what " +
    "it changes and what a retry does. Each added claim restates a sentence of its rpc's or process's about, from a " +
    "world the catalog holds (org-with-head, org-with-head-down, org-with-head-docs, org-with-fde-guest) and never an " +
    "invented behaviour. Two were left out as unsure: a submit under an active Workflow (the world's only Workflow " +
    "runs on Job Applicant, which Frappe HR does not submit, so the refusal it would meet first is not booked), and " +
    "amending one cancelled document twice (Frappe would name both amendments `-1`). For the devnet designer: the " +
    "stand-in head's metas need Job Opening not submittable (hrms@8816102: no is_submittable) and Training Event " +
    "Employee a child table of Training Event (istable), Project in module Projects, and its daily check to fail " +
    "while its fault switch is down. Truth review, 9 November 2026: two more for devnet. The stand-in names an amendment of an " +
    "amendment by Frappe's Amend Counter (`Old induction-1` amended is `Old induction-2`, frappe@1a7ea57 naming.py " +
    "`_set_amended_name`), not `<name>-1` again. The world's Training Events carry hrms' mandatory fields (event_status, " +
    "type, location, start_time before end_time, introduction: training_event.json, `validate_period`), since the " +
    "submit and amend claims submit them through the family, which checks them. Here: the per-app versions `org head " +
    "show` prints are the head connection's process's `check` step's, now booked there. `org head show`'s failing " +
    "claim reads the stall's issue `at`, which the stall records, rather than `checkedAt`; the amend retry reads the " +
    "one document amended from `Old induction`.",
  source: surfaceBy("heads.ts, docs.ts, fde.ts, organizations.heads.watch; devnet worlds.ts; hrms@8816102 job_opening, training_event(_employee); frappe@1a7ea57 naming.py, document.py"),
  affects: [
    operation_org_head_show, operation_org_head_doc_submit, operation_org_head_doc_amend, operation_org_head_doctype_list,
    operation_org_fde_guest_list, workflow_heads_watch, concept_devnet,
  ],
});

export const decision_organizations_reach_holes = defineDecision({
  id: "organizations.reach-holes",
  title: "Four holes in the family's guard, closed by its own accepted tests",
  question:
    "Reading every DocType of erpnext@6b946b0, hrms@8816102 and crm@2cecd30 against organizations.doc-reach " +
    "(docs/design/command-surface.md section 7.6) found what the accepted guard reaches though its own tests say it " +
    "should not, or leaves unclear: Transaction Deletion Record, which deletes every transaction of a Company and is " +
    "in no hook; SMS Center, Email Digest, Newsletter and Auto Email Report, which exist to send through the head's own " +
    "mail or SMS; a child table a hook lists under a parent it does not (Material Request Item, Request for Quotation " +
    "Item, Asset Movement Item); and Frappe HR documents that write native HR records on submit. Which does " +
    "organizations close, and how, while Aaron's question 52 is open?",
  options: [
    {
      label: "by-the-accepted-tests",
      text:
        "Close each by the test organizations.doc-reach already applies, and change nothing else. Transaction Deletion " +
        "Record joins LEDGER_UNHOOKED: it rewrites the ledger though no hook says so, as Repost Item Valuation does. The " +
        "four senders join HEAD_MACHINERY, which already refuses what sends through a channel of the head's own " +
        "(Notification). A hooked child makes no money of its parent: the parent is judged by its own listing, and the " +
        "child is reached only through it, so Material Request, Request for Quotation and Asset Movement stay reached. " +
        "The HR documents are payroll's to answer (refuse them, or have payroll.hr-head-sync take in what they write): " +
        "NATIVE_DOCTYPES gains them only when payroll asks.",
    },
    { label: "parent-as-money", text: "As by-the-accepted-tests, but a hooked child makes its parent money too." },
    { label: "wait", text: "Change nothing until Aaron answers question 52." },
  ],
  chosen: "by-the-accepted-tests",
  why:
    "Each fix applies the accepted rule to a DocType it missed, and the rule itself says a lane that finds another " +
    "unhooked writer of the ledger adds it. Transaction Deletion Record, submitted, deletes the Company's GL and stock " +
    "entries with its transactions, which is re-posting the ledger at its widest; under question 52's recommendation it " +
    "is refused as moving money too, so either answer refuses it. The senders are the channel case Notification " +
    "already is, and a world's channels are its own (aaron.world-clock, time.world-channels). The parents post nothing " +
    "(read in erpnext@6b946b0: Material Request updates requested quantities, Request for Quotation emails its " +
    "suppliers through the head's mail, which a world keeps in its sink, and Asset Movement sets an Asset's location " +
    "and custodian); `accounting_dimension_doctypes` lists their items because the items carry dimension fields that " +
    "post only when a listed document takes them up. parent-as-money would refuse three documents that move no money, " +
    "against the 9 November ruling; waiting would leave a Company's ledger deletable through the family. " +
    "surface.frappe-reach's wider narrowing is not applied here: organizations.doc-reach stays as accepted until Aaron " +
    "answers question 52.",
  source: surfaceBy("erpnext@6b946b0 hooks.py and the seven DocTypes named; frappe@1a7ea577 auto_email_report; command-surface.md 7.6; organizations.doc-reach"),
  affects: [...DOC_RPCS, ...DOC_OPERATIONS, component_frappe_app, integration_frappe_head, concept_payroll],
});

export const decision_organizations_head_fit = defineDecision({
  id: "organizations.head-fit",
  title: "A refusal names the record's group and both sides; the FDE reads as its asker",
  question:
    "Fit review of the surface pass (9 November 2026; Aaron: 'It's the logical groupings'). After the rename, the " +
    "commands the family's refusals name still followed the old nouns' pairing, not the tree's groups: the Payroll " +
    "module named `org payroll` and `org hr employee`, Projects three of its group's records, and two HR rows only one " +
    "side. The org-apps index said `org show` lists the installed apps, and `org fde guest list`'s first claim promised " +
    "the order and the paging its two new claims prove, while its about never named `--status`. And the who of every " +
    "member read (`org head show`, `org head app list`, `org fde show`, `org fde guest list`, `org seats show`) said " +
    "'the FDE included', though the hosted FDE never acts as itself. What should each say?",
  options: [
    {
      label: "by-group",
      text:
        "Each pointer names the record's group, with the person's side where one has it, as surface.hr-group places HR. " +
        "Payroll module: `org payroll` and `payroll`, and `org hr advance settle` for an advance's Additional Salary. " +
        "Projects module: `org projects`, with its `member`, `settings`, `task`, `timesheet`, `activity-type` and " +
        "`project-type`. Leave Allocation adds `hr leave balance`; Employee Checkin names `hr attendance checkin` and " +
        "`list`. `org head doctype list`'s claim names both sides of Leave Application and Expense Claim, as the refusal " +
        "does. The index names `org head show`. The guest list's first claim says what its evidence shows (the note and " +
        "who named them), and its about names `--status active|removed` and the paging. A member read's who says the " +
        "hosted FDE reads only as the member who asked it, and a self-run own agent as itself.",
    },
    { label: "as-renamed", text: "Keep the pointers as the rename left them: the old pairs with the new words." },
  ],
  chosen: "by-group",
  why:
    "Employee is ERPNext Setup's (erpnext@6b946b0 employee.json: module Setup), not the Payroll module's, and has its " +
    "own NATIVE_DOCTYPES row naming `org hr employee`. Naming it for the Payroll module sent a Frappe reader asking " +
    "after Salary Slip or Employee Incentive to HR, and left out the person's side (`payroll payslip`, `payroll " +
    "agreement`), while every two-sided HR row names both. The one Payroll-module DocType a command outside the " +
    "payroll group writes is an advance's Additional Salary (payroll.advance-recovery). Projects is one group now, so " +
    "all of it is under " +
    "`org projects`, Activity Type and Project Type included. `hr leave balance` reads Leave Allocations, and `hr " +
    "attendance list` prints your check-ins (payroll's operations). `org show` runs client.org.setup.get, which never " +
    "reads org-apps; `org head show` and `org head app list` do. A claim's title is what its evidence proves, so the " +
    "title no longer repeats what claims 2 and 3 prove. docs/design/authority.md: 'A call with no live token is " +
    "refused, so the hosted FDE never acts as itself', which MEMBER_GUARD already does; only the who said otherwise. " +
    "Text only: no rpc, guard, refusal code or behaviour changes.",
  source: surfaceBy(
    "command-surface.md 3, 4; erpnext@6b946b0 setup/doctype/employee/employee.json; hrms@8816102 payroll/doctype; " +
      "payroll operations hr.leave.balance, hr.attendance.list; organizations flows client.org.setup.get; organizations.fde-guests.list",
  ),
  affects: [
    ...DOC_RPCS, operation_org_head_doctype_list, operation_org_fde_guest_list, table_org_apps, operation_org_head_show,
    operation_org_head_app_list, operation_org_fde_show, operation_org_seats_show, rpc_organizations_apps_list,
    rpc_organizations_seats_show, concept_payroll, concept_projects,
  ],
});
