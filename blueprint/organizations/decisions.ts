// The organizations concept's own judgments (CONVENTIONS rule 10). Made by Claude on 8 November
// 2026 under the accepted decisions A1-A4 and P1-P10 and the shared architecture records, with the
// old code (/home/user/factory, integration/factory) and the as-is book as evidence.

import { defineDecision } from "../../packages/blueprint-engine/src/index.ts";
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
  component_frappe_app,
  system_capxul,
} from "../shared/foundation.ts";
import { contract_agent_owner } from "../shared/external.ts";
import {
  event_seat_purchase_transitioned,
  machine_org_app,
  machine_seat_purchase,
  table_org_apps,
  table_org_seat_purchases,
} from "./data.ts";
import { rpc_organizations_seats_show } from "./members.ts";
import {
  operation_org_seats_show,
} from "./operations.ts";
import {
  machine_org_fde,
  table_org_fdes,
} from "./data.ts";
import { concept_agents, concept_devnet, concept_payments } from "../shared/foundation.ts";

const CLAUDE = "Claude, organizations design, 8 November 2026";
const by = (evidence: string) => `${CLAUDE}; evidence: ${evidence}`;

export const decision_organizations_authenticated_seats = defineDecision({
  id: "organizations.authenticated-seats",
  title: "Seat admission checks the authenticated principal, never the owner label",
  question: "How do restricted-role consumers admit a current Seat and its readable Safes without manufacturing membership from tenant scope?",
  options: [
    { label: "authenticated", text: "requireSeat rechecks the actor against app.person_id and access principals on the caller's Sql. Humans match principal id; agents match their own authoritative Safe, even with a null Seat principal. app.caller_safes() returns the non-released own Party Safe and active Seat organization Party Safes; without an own Party it returns empty. Owner labels and app.org_id are routing scope, never actor identity. Tenant roles only read Seats; restricted workers own writes after route authorization." },
    { label: "scope", text: "Trust supplied owner or organization settings to manufacture an actor or membership." },
  ],
  chosen: "authenticated",
  why: "Access.authenticate alone establishes the actor from an opaque active session. Same-transaction checks stop a supplied actor, Safe or owner label from impersonating another Seat. Fixed-search-path security-definer SQL reads the source-owned directory under forced RLS without recursively reading its own policy. Its execute grant is limited to Core and worker; no Safe authority or Hats cache is duplicated. A company Safe is admitted only through its current Seat and non-released Party, not old transport people rows. Separately, delivery workers read committed membership with readSeatBySafe(Sql, orgId, wearerSafe): the exact Organization and lowercased wearer Safe must match an active Seat, else null. This plain same-Sql reader neither creates an actor nor relaxes tenant RLS or requireSeat; the existing worker role can read without a request session. Access readPrincipalBySafe supplies identity, while Parties lookup(Sql, seat.party_id).display_name supplies the nullable canonical name. Missing identity or name is not invented or recovered from legacy people. This tranche creates only org-members and admission functions; full onboarding schemas and public procedures remain separate, unproved work.",
  source: "aaron.postgres-and-ponder; organizations.fde-seat; Access Principal/session contract; PR50 ownerTransaction; integrator migration composition lease; agreed Plugs worker membership/read contract, 12 November 2026",
  affects: [table_org_members, table_organizations, concept_parties],
});

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
    "label": "current-scope",
    "text": "Organizations keeps company identity, setup, deployment, membership and invitations, not business CRM/HR tables, Directors, proposals or equity. Hosted-site lifecycle lives in sites and role projection in plugs. The historical count of five does not justify restoring optional-head or FDE tables."
  },
  {
    "label": "historical",
    "text": "The former answer to organizations.tables is preserved in docs/cut-archive/decision-review-history.json as historical evidence, not implementation authority."
  }
],
  chosen: "current-scope",
  why:
    "Review, 11 November 2026: Organizations keeps company identity, setup, deployment, membership and invitations, not business CRM/HR tables, Directors, proposals or equity. Hosted-site lifecycle lives in sites and role projection in plugs. The historical count of five does not justify restoring optional-head or FDE tables. Authority: cut.organizations; cut.fde-parked; sites.lifecycle; plugs.roles-follow-hats.",
  source: "The coordinator, round 2, m1-old-decisions; cut.organizations; cut.fde-parked; sites.lifecycle; plugs.roles-follow-hats",
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
    "The concept map gives organizations the deployment ('which officer hat is which') so every concept above can name hats without knowing the install's officer order. The event is emitted once per company and its ids never change, so the row cannot drift, which is what P3's 'nothing copies chain rows' guards against. The install batch is built from it, so the setup needs it anyway. Who wears a hat now, the budgets and the Board's signers stay indexing's views. Review, 11 November 2026: Confirmed organizations.deployment-row; original choice retained.",
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
  source: by("blueprint/baseline/operations.ts (acceptance of the 14 operations); P1"),
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
  source: by("blueprint/approvals/decisions.ts (approvals.machine); blueprint/agents/decisions.ts (agents.failure-codes); org.show.yaml; org.retry.yaml"),
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
  source: BUILDER("blueprint/shared/decisions.ts (vocabulary.declined-preview-cancelled); frozen org.create, org.retry, invite.decline, org.invite.cancel, org.invite.resend notes"),
  affects: [operation_org_create, operation_org_retry, operation_invite_decline, operation_org_invite_cancel, operation_org_invite_resend, error_CANCELLED],
});

// ── seats (Aaron's ruling aaron.seats) ──────────────────────────────────────────────────────

// The ruling is Aaron's; these records are the design's reading of it, so the judgments report lists them as the
// design's, and the ones that ask him something under "For Aaron".
const AARON_SEATS = by("blueprint/shared/rulings.ts (aaron.seats, Aaron's ruling of 8 November 2026)");

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
  source: by("blueprint/shared/rulings.ts (aaron.seats, aaron.buy-seats: Aaron's rulings of 8 November 2026)"),
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
  "blueprint/shared/rulings.ts (aaron.erp-on-capxul, aaron.frappe-shape, aaron.fde-agent, aaron.frappe-head); docs/vision/erp.md",
);
const WIZARD = "/tmp/erpnext/erpnext/setup/setup_wizard";

export const decision_organizations_company_shape = defineDecision({
  id: "organizations.company-shape",
  title: "The Organization is ERPNext's Company: abbr, currency, time zone, fiscal year",
  question: "ERPNext's setup wizard asks for a company's country, currency, time zone, abbreviation and fiscal year. Where do they live in Capxul?",
  options: [
  {
    "label": "current-scope",
    "text": "The organization supplies company abbreviation, currency, time zone and fiscal-year defaults at creation. Sites provisions ERPNext Company with them; ERPNext is the authority for accounting settings. Do not create an immutable second book-company settings copy or a later optional-head setup wizard."
  },
  {
    "label": "historical",
    "text": "The former answer to organizations.company-shape is preserved in docs/cut-archive/decision-review-history.json as historical evidence, not implementation authority."
  }
],
  chosen: "current-scope",
  why:
    "Review, 11 November 2026: The organization supplies company abbreviation, currency, time zone and fiscal-year defaults at creation. Sites provisions ERPNext Company with them; ERPNext is the authority for accounting settings. Do not create an immutable second book-company settings copy or a later optional-head setup wizard. Authority: cut.organizations; cut.fde-parked; sites.lifecycle; plugs.roles-follow-hats.",
  source: "The coordinator, round 2, m1-old-decisions; cut.organizations; cut.fde-parked; sites.lifecycle; plugs.roles-follow-hats",
  affects: [table_organizations, rpc_organizations_setups_begin, concept_books],
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
  affects: [table_org_apps, machine_org_app, system_capxul],
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
  source: by("blueprint/shared/rulings.ts (aaron.fde-hosted, aaron.fde-agent); AgentOwner.sol:182 (msg.sender == owner); blueprint/board/procedures.ts"),
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
  source: by("blueprint/agents/decisions.ts (agents.account-at-first-sign-in); blueprint/access/data.ts (principals by_safe)"),
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
  source: by("blueprint/parties/procedures.ts (parties.register: handle rules)"),
  affects: [rpc_organizations_setups_begin, table_org_setups],
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
  source: asmBy("blueprint/shared/rulings.ts (aaron.buy-seats); blueprint/payments/procedures.ts (payments.prepare-command)"),
  affects: [
    table_organizations, table_org_seat_purchases, machine_seat_purchase, event_seat_purchase_transitioned,
    procedure_organizations_add_bought_seats, procedure_organizations_return_bought_seats, rpc_organizations_seats_raise,
    
    rpc_organizations_seats_show, operation_org_seats_show, system_capxul,
  ],
});

// ── the commands pass: the new commands, the hosted FDE and its hosting (8 November 2026) ────

const PASS = "Claude, organizations commands pass, 8 November 2026";
const passBy = (evidence: string) => `${PASS}; evidence: ${evidence}`;

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
  source: passBy("blueprint/shared/rulings.ts (aaron.fde-agent, aaron.fde-hosted, aaron.fde-anyone); docs/decisions/open-for-aaron.md (question 36)"),
  affects: [
    
    table_org_fdes,
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
  source: passBy("blueprint/shared/rulings.ts (aaron.buy-seats, aaron.test-prices); docs/design/new-commands.md (section 5.5)"),
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
  source: passBy("blueprint/shared/rulings.ts (aaron.fde-hosted, aaron.machine-login); /home/user/swarmd/docs/SPEC.md (B.15, B.16)"),
  affects: [
    system_capxul, table_org_fdes, workflow_organizations_setups_set_up, 
    concept_agents,
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
  source: passBy("blueprint/shared/rulings.ts (aaron.fde-hosted, aaron.test-prices, aaron.departments); payments.prepare-command"),
  affects: [
    table_org_fdes, machine_org_fde, 
    concept_payments,
    concept_notices,
  ],
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
    "The frozen behaviour holds both: org-ready's founder wears the three officer hats, and ROLE_CONFLICT is a frozen refusal, the separation of duties between who manages people and who spends a department's money. On v4 the People hat grants no money authority (offices and allowances are minted by the Board or an office above), so the conflict guards a product rule, not a chain power (docs/design/authority.md). A solo founder is not blocked: as the Board they pay, schedule and create budgets with their one signature, and an allowance gives them a budget of their own to spend from, which is also what `org seats buy` spends (organizations.buy-seats). Exempting the founder would empty the rule for the person it most often meets; minting no People hat would break the frozen worlds and leave nobody able to invite. So the rule stays and is said where a founder meets it. Review, 11 November 2026: Confirmed organizations.founder-people-hat; original choice retained.",
  source: passBy("docs/design/authority.md (contradiction 9); budgets.role-conflict-people-hat; board.people-hat-role-conflict; aaron.departments"),
  affects: [workflow_organizations_setups_set_up, table_org_deployments, concept_budgets, concept_board],
});

// ── the world pass: anyone talks to the FDE, and the document family (8 November 2026) ──────

import { procedure_accounts_admit } from "../accounts/procedures.ts";
import { procedure_parties_resolve_recipient } from "../parties/procedures.ts";
import { component_core_sdk, concept_accounts, concept_approvals } from "../shared/foundation.ts";
import { integration_fde_host as integration_fde_host_ } from "../shared/external.ts";

const WORLD = "Claude, organizations world pass (doc-family lane), 8 November 2026";
const worldBy = (evidence: string) => `${WORLD}; evidence: ${evidence}`;

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
  source: worldBy("blueprint/shared/rulings.ts (aaron.fde-anyone, aaron.departments); docs/design/authority.md (Agents and the FDE); access.assistants (the person signs every approval)"),
  affects: [
    
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
  source: worldBy("blueprint/shared/rulings.ts (aaron.fde-anyone); organizations.invitation-process; procedures.accounts-admit"),
  affects: [
    
    
    procedure_accounts_admit, procedure_parties_resolve_recipient, concept_accounts, concept_notices,
  ],
});

export const decision_organizations_begin_gaps = defineDecision({
  id: "organizations.begin-gaps",
  title: "What begin does where the record and ERPNext's data are silent",
  question:
    "organizations.setups.begin takes the time zone from the country's first zone, needs the founder's claimed account and " +
    "stores the name as ERPNext's Company. Frappe's country data has no zone for 38 countries, the record does not say " +
    "which Party is the founder's, and ERPNext's Company name is a 140-character Data field. What does begin do?",
  options: [
    {
      label: "refuse-before-write",
      text:
        "A country with no zone in Frappe 16.54's country data and no `timeZone` given is INVALID_INPUT naming `timeZone`. " +
        "The founder's Party is their own active person Party at their claimed personal Safe; without one the account is not " +
        "set up, WRONG_STATE like an unclaimed Safe. A name over 140 characters after trimming is INVALID_INPUT. All three are " +
        "checked before the first write.",
    },
    {
      label: "invent-defaults",
      text: "Default a zoneless country to UTC, register a person Party for the founder inside begin, and truncate long names.",
    },
  ],
  chosen: "refuse-before-write",
  why:
    "A default zone Capxul invents would date every voucher of that Company in a zone nobody chose, and ERPNext's setup wizard " +
    "offers no default for these countries either. Registering the founder's Party belongs to parties' profile procedures, " +
    "not to organizations, and a truncated name is not the name the founder gave. Each refusal leaves nothing written, as " +
    "begin's other refusals do. A country with no currency in that data, or an unpriced one, starts in USD as begin already says.",
  source:
    "Amp Organizations lane, 13 November 2026; Frappe 16.54.0 frappe/geo/country_info.json and ERPNext 16.54.0 " +
    "erpnext/public/js/setup_wizard.js in the capxul-bench image; blueprint/organizations/setups.ts (rpc_organizations_setups_begin)",
  affects: [rpc_organizations_setups_begin, table_organizations, concept_organizations],
});

export const decision_organizations_admitted_deployment = defineDecision({
  id: "organizations.admitted-deployment",
  title: "The deployment row names its MoneyDeployed log; officer hats stay numeric",
  question:
    "Board and Budgets need to know which finalized MoneyDeployed this Organization owns, and to re-check it in indexing. " +
    "The event carries officer hats only in `MoneyDeploy.officers` order, and which hat means which officer permission is " +
    "the native hat binding still open as a question to Aaron (who may bind a chain hat to a named role: the authorised " +
    "setup, Board or budget intent, or a Director-edited registry). What does the row hold, and what does its door answer?",
  options: [
    {
      label: "occurrence-numeric",
      text:
        "Record the chain and log id of the admitted MoneyDeployed, and the officer hats as a numeric list in the event's " +
        "order. The named officer columns stay null until that binding is answered. `readAdmittedDeployment(sql, {orgId, " +
        "chainId})` answers the row on the caller's Sql, or null until the setup admits it at finality.",
    },
    {
      label: "named-by-order",
      text: "Fill Books, Invoicing and People from the order the setup sent, and give readers only the named columns.",
    },
  ],
  chosen: "occurrence-numeric",
  why:
    "The log id lets Board re-check the row with indexing's `readMoneyDeployment` instead of trusting a copy, and a row " +
    "nobody admitted reads as null, so a reader fails closed. Naming officer hats by install position is the mapping the open " +
    "binding decision has not authorised, and Board will not infer it from Hat details either; until it is answered the named " +
    "columns stay empty and officer grants stay fail-closed. The Director hat, top hats, Roles and Gate are named by the event " +
    "itself, so they need no binding. The row stays written once and never changed, as organizations.deployment-row chose; " +
    "it is never read from the editable `app.hats`.",
  source:
    "Amp Organizations lane, 13 November 2026, agreed with Board (PR58 BoardFacts.deployment) and the integrator; " +
    "IInstaller.sol MoneyDeployment (officerHats in MoneyDeploy.officers order); PR59 indexing/deployment.ts readMoneyDeployment",
  affects: [table_org_deployments, workflow_organizations_setups_set_up, concept_board],
});

export const decision_organizations_setup_send_attempts = defineDecision({
  id: "organizations.setup-send-attempts",
  title: "Setup sends are keyed per attempt; completion waits for the landed install",
  question:
    "The service signer answers the same hash for a key it has seen, so one fixed key per send cannot both survive a " +
    "crash (send once) and retry after a revert (send again). And the install's facts read false while the signed " +
    "install is still unmined. How does the setup key its sends, and when does it judge the install?",
  options: [
    {
      label: "attempts-and-landing",
      text:
        "Count attempts on the setup (mint_attempt, deploy_attempt) and key each send `org-setup:<orgId>:mint:<n>`; a " +
        "crash resends attempt n and gets its hash, and only the transaction that records a final revert, or a lost send (the " +
        "signer no longer knows the hash and the key's nonce is used by another transaction), moves to n+1. Record the " +
        "install transaction and block from approvals' landed ending, and judge the install's facts only at finality " +
        "anchored to that block; final facts that differ fail the setup (install_mismatch), since its batch ran. Provider " +
        "errors, matched by their code, go back to the process's retries; the last one stalls it.",
    },
    {
      label: "fixed-keys",
      text: "Keep one key per send and judge the install whenever the process runs.",
    },
  ],
  chosen: "attempts-and-landing",
  why:
    "A fixed key makes a reverted send's retry return the reverted hash forever, and a fresh key per run sends twice " +
    "after a crash, minting new hats. Counting attempts in the row the revert is recorded in gives both. Judging the " +
    "install before it landed reads an unmined install as reverted, stalls the setup and lets a retry open a second " +
    "batch while the first can still land; once it landed and is final, a retry would run a second batch on a Safe the " +
    "first already changed, so a mismatch is definitive. A lost broadcast never gets a receipt, so without send_lost the " +
    "setup would wait forever. The workflow's own retries (max 5, exponential) cover provider outages, so a first " +
    "PROVIDER_ERROR is not yet a stall.",
  source:
    "Amp Organizations lane, 13 November 2026, from the integrator's independent review of PR122; " +
    "packages/backend/src/shared/service-signer.ts (stored hash per key); approvals TerminalEvent (transaction_hash, block_number)",
  affects: [table_org_setups, workflow_organizations_setups_set_up],
});

export const decision_organizations_setup_runner = defineDecision({
  id: "organizations.setup-runner",
  title: "The setup's runner: tier-key sends, final receipts, and the install's top budget",
  question:
    "The setup process needs a runner with the workflow's retries, Companies House's tier key for the mint and deployMoney, " +
    "a receipt that waits for finality, and an install batch. What does each send, read and build?",
  options: [
    {
      label: "tier-signer-and-runner",
      text:
        "A tier signer beside the claim signer, on its table and lock: signed bytes recorded before broadcast, one send in " +
        "flight per key, the mint through the tier's company role, deployMoney with the founder as the one Director (1 of 1), " +
        "the officers composition gives in Books, Invoicing, People order, and a salt from the company Safe. Its receipt is " +
        "null until the block is final; a dropped send is broadcast again as the same bytes while its nonce is free, and is " +
        "lost once another transaction used it. buildMoney's batch is for the world's USDC with a monthly top budget of 0 " +
        "and ceiling 0, then the officer hats minted to the founder's Safe, then the FDE. The install is judged by reads pinned " +
        "to its block. The runner retries a thrown run with exponential backoff and passes lastTry on the last; a busy key is " +
        "a wait, not a try; each setup's work carries the trace of its last transition.",
    },
    {
      label: "first-receipt",
      text: "Reuse the claim signer's waitForReceipt and send each run afresh, judging the install from indexed rows only.",
    },
  ],
  chosen: "tier-signer-and-runner",
  why:
    "The claim signer can sign only claims, and its waitForReceipt returns the first receipt it sees, which a reorg can " +
    "undo. Re-broadcasting the same bytes cannot send twice, since they carry one nonce. A top amount of 0 gives the Board " +
    "a top budget that pays nothing until it sets one (the blueprint's install), and the monthly period is only that " +
    "budget's starting period. The officers' Hat details are composition's input, not a binding: officer hats stay " +
    "numeric (organizations.admitted-deployment) until the open question to Aaron on native hat binding is answered. " +
    "Reads at the landed block judge exactly what the install did, whatever came after it.",
  source:
    "Amp Organizations lane, 13 November 2026, for the Organizations cut-over, with Runtime; packages/devnet company " +
    "service createCompany (the mint through the tier's company role); proved on the seeded v4 chain (state/core.json)",
  affects: [workflow_organizations_setups_set_up, table_org_setups],
});

export const decision_organizations_world_company_hosts = defineDecision({
  id: "organizations.world-company-hosts",
  title: "World inventory reads each site host from Sites, in that Organization's scope",
  question:
    "The target app.organizations has no site column: Sites keeps each Organization's host in app.sites, whose policy " +
    "admits one Organization at a time, even to the worker. Where does readWorldCompanies get a company's site?",
  options: [
    {
      label: "scoped-sites-read",
      text:
        "readWorldCompanies(db, hosts) reads every Organization's id and name as the worker, then each one's host in that " +
        "Organization's own scoped worker transaction, through `hosts` (Sites' readSiteHosts), taking only that " +
        "Organization's entry; null when it has no site. A non-worker connection is still refused.",
    },
    {
      label: "cross-tenant-sites-function",
      text: "Sites declares a cross-tenant read of every host, like app.site_by_host, and the reader calls it once.",
    },
  ],
  chosen: "scoped-sites-read",
  why:
    "It keeps Sites' policy as it is and needs no new cross-tenant function; a world has few companies, so one short " +
    "transaction each is cheap. It refines organizations.world-company-reader, whose site was the legacy column: the " +
    "inventory still includes companies with no site, and still never invents a URL.",
  source:
    "Amp Organizations lane, 13 November 2026, for the cut-over, agreed with Sites (readSiteHosts on sites-provision-bearer; " +
    "app.sites RLS org_id = app.org_id for capxul_core and capxul_worker)",
  affects: [concept_organizations, table_organizations],
});

export const decision_organizations_setup_composition = defineDecision({
  id: "organizations.setup-composition",
  title: "Core composes the setups' routes and runs the setup runner in its worker tick",
  question:
    "Core's main must mount organizations.setups.* and run the setup process. Where does the runner run, and what does " +
    "composition bind for the gate catalogue, the install window, the approval page, the Board read and the FDE host?",
  options: [
    {
      label: "worker-tick",
      text:
        "The runner ticks inside Core's worker loop, so it never writes while Core is paused for a snapshot or closing. " +
        "Begin's eligibility reads the `beta-access` person gate from deployment code's catalogue. The founder has 7 days " +
        "to sign the install; an expired approval stalls and `org retry` reopens it. Approvals.open runs at the world's " +
        "instant with SITE_URL's approval page. The Board read is the company Safe's indexed owners, threshold and nonce " +
        "with Board's waiting proposals when Board is migrated. With no FDE host composed in the world, provisioning " +
        "fails closed (provider_unavailable after the retries).",
    },
    {
      label: "own-timer",
      text: "Run the runner on its own timer beside Core, and stub the FDE host with a generated key.",
    },
  ],
  chosen: "worker-tick",
  why:
    "A timer of its own would keep writing during a snapshot's pause and cut it inconsistently. A generated FDE key would " +
    "be a key Capxul holds, which aaron.fde-hosted rules out: the host makes and keeps it. Seven days matches a person " +
    "signing at their own pace and costs nothing to retry. Board's proposals are read only where Board's table exists, so " +
    "a world without Board reads none rather than failing.",
  source: "Amp Organizations lane, 13 November 2026, for the cut-over, at the integrator's direction (each lane composes itself)",
  affects: [workflow_organizations_setups_set_up, rpc_organizations_setups_begin, rpc_organizations_setups_get],
});

export const decision_organizations_cutover_migrate_order = defineDecision({
  id: "organizations.cutover-migrate-order",
  title: "Core's schema splits around Organizations: base first, per-org tables after",
  question:
    "Core's one schema.sql created the legacy app.organizations (site, token, delivery cursors) together with the " +
    "per-organization tables that reference it, and ran before every concept. The target app.organizations needs Parties " +
    "and Access first and refuses to migrate over the legacy shape. Where do Organizations and those tables go in the " +
    "world's migration?",
  options: [
    {
      label: "split-around-organizations",
      text:
        "Split schema.sql into the world's base (schema app, schema_version, world, world_record, indexer_observation), " +
        "applied first, and schema-per-org.sql (people, hats, the site payment approvals, site_events, consumed_facts, " +
        "site_request_answers, transaction_traces, records), applied right after Organizations. Order: base, outbox, " +
        "Access, Accounts, Parties, Organizations, the per-organization tables and their tenant policy, then Approvals, " +
        "payments and Activity. The legacy app.organizations is no longer created; the target keeps its name and org_id, " +
        "so every `references app.organizations` stays as it is.",
    },
    {
      label: "drop-foreign-keys",
      text: "Keep one schema.sql first and drop its foreign keys to app.organizations, so Organizations can come later.",
    },
  ],
  chosen: "split-around-organizations",
  why:
    "Dropping the foreign keys would let rows for no Organization in, in Core's tables and in other lanes' (Board, Plugs, " +
    "Sites), which reference app.organizations too. Splitting keeps every reference and only moves when each table is " +
    "created. Organizations keeps its own policies and grants, so it leaves the legacy tenant loop, which re-run would " +
    "otherwise undo. Approvals must still run after the per-organization tables, because it renames the legacy " +
    "app.approvals to site_payment_approvals. A world is created fresh by the migration, so nothing is moved or dropped.",
  source:
    "Amp Organizations lane, 13 November 2026, ruled by the Wave Zero integrator for the Organizations cut-over; " +
    "packages/backend/src/migrate.ts, packages/backend/src/schema.sql",
  affects: [table_organizations],
});

// ── the command surface (surface.tree, surface.head-group; Aaron, 9 November 2026) ──────────────────────────────

const SURFACE_PASS = "Claude, surface pass, 9 November 2026 (question 48)";
const surfaceBy = (evidence: string) => `${SURFACE_PASS}; evidence: ${evidence}`;

export const decision_organizations_world_company_reader = defineDecision({
  id: "organizations.world-company-reader",
  title: "World inventory reads actual companies, including those without sites",
  question: "How does world.show enumerate companies without mistaking a tenant list or the site's routing configuration for the world's inventory?",
  options: [
    { label: "worker-reader", text: "Organizations exposes readWorldCompanies on the selected world's existing worker Sql: orgId, name and nullable verbatim site metadata, ordered by orgId, including released companies. Refuse other roles instead of returning a tenant-filtered partial list." },
    { label: "site-inventory", text: "Enumerate configured sites and infer company identity and names from their routing entries." },
  ],
  chosen: "worker-reader",
  why: "devnet.worlds.create admits core worlds with companies but no sites; WorldView still requires their identities and names. The Organizations table is the inventory, not the site's configuration or financial record heads. The existing capxul_worker RLS policy already admits world-scoped reads; the door checks that actual database role and neither changes RLS nor invents actor or tenant settings. Its caller must authorize the public world read and select the correct world's connection. Site metadata is nullable in the runtime adapter so a core-only company needs no placeholder; existing registration still requires a real site. The reader does not manufacture a URL: Runtime owns the separate public routing projection. It does not read private company configuration, migrate on read, mutate rows or emit events.",
  source: "blueprint/devnet/world-rpcs.ts (WorldView, devnet.worlds.create); packages/backend/src/migrate.ts (restricted worker RLS policy); Wave0 Recovery world.show source contract, 12 November 2026",
  affects: [concept_organizations, table_organizations],
});

