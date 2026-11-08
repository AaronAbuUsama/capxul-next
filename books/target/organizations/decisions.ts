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
import { procedure_organizations_bind_invitation_grants } from "./procedures.ts";
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
    "Organization by its Party, and Seats by an agent's Safe.",
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
  title: "Ten seats on the Organization's row; an offer reserves one; an operator raises",
  question:
    "aaron.seats: a company starts with ten seats, in the beta and after; each seat may hold one agent account, and the " +
    "company may hold one agent of its own. Where is the limit kept, what counts against it, when is it checked, and who " +
    "raises it?",
  options: [
    {
      label: "row-and-offers",
      text:
        "`organizations.seat_limit`, 10 at birth. A person's Seat counts one; an agent's rides on its owner's Seat here " +
        "(one per Seat) or is the Organization's own (one), and any other agent's counts one. A live offer reserves what " +
        "its Seat will take, so the check is at `org member invite`, under the Organization row's lock, and acceptance " +
        "only takes what was reserved; an offer to someone who already holds a Seat here reserves nothing. A Capxul " +
        "operator raises the limit with the operator's tool; it never goes down.",
    },
    { label: "count-at-accept", text: "Count only held Seats, at acceptance: offers are free, and the eleventh invitee to accept is refused." },
    { label: "flag", text: "A deployment-wide number in feature flags, the same for every Organization." },
  ],
  chosen: "row-and-offers",
  why:
    "Refusing at the offer tells the inviter, who can act (cancel an offer, ask for more seats), instead of an invitee " +
    "who did nothing wrong; reserving keeps acceptance a promise the Organization can keep. The row lock makes two " +
    "concurrent offers for the last seat one success and one SEAT_LIMIT_REACHED. A per-Organization number is what " +
    "'raised' needs, and a flag cannot raise one company's. The founder's Seat is the first of the ten. Every frozen " +
    "operation behaves as before: no eval world fills ten seats (the most is seven, Acme's in org-with-budget-tree), " +
    "and no frozen claim invites past ten. Who raises it is not in the ruling: an operator alone, until pricing says " +
    "otherwise (for Aaron: may an Organization buy more seats itself, and at what price?). Not built: lowering a limit, " +
    "and ending a person's Seat, which no target operation does today.",
  source: AARON_SEATS,
  affects: [
    table_organizations,
    table_org_members,
    table_org_invitations,
    rpc_organizations_invitations_invite,
    rpc_organizations_invitations_accept,
    rpc_organizations_seats_raise,
    flow_client_operator_organizations_seats_raise,
    rpc_organizations_setups_begin,
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
