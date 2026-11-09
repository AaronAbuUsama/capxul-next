// The organizations concept's durable work (A2, A3, P3): one process per Organization's setup, one
// per invitation, and one reaction to an agent's removal on chain. Each process owns its machine;
// the rpcs that resume it are its signals. What they wait on is their own: no cron sweeps for them
// (the old every-minute setup recovery and the daily invitation expiry are gone, P3).

import { budget, defineWorkflow } from "../../../packages/book/src/index.ts";
import { concept_organizations } from "../shared/foundation.ts";
import {
  contract_agent_owner,
  contract_company_safe_minter,
  contract_hats,
  contract_installer,
  contract_safe,
  integration_chain_rpc,
  integration_fde_host,
  integration_frappe_head,
  integration_indexer,
  integration_service_signer,
} from "../shared/external.ts";
import {
  event_fde_payment_transitioned,
  event_org_fde_transitioned,
  event_org_setup_transitioned,
  machine_org_fde,
  table_org_fde_payments,
  table_org_fdes,
  event_org_app_transitioned,
  event_org_head_transitioned,
  event_org_member_transitioned,
  machine_org_app,
  machine_org_head,
  table_org_apps,
  table_org_heads,
  machine_org_invite,
  machine_org_member,
  machine_org_setup,
  table_org_deployments,
  table_org_invitations,
  table_org_members,
  table_org_setups,
  table_organizations,
} from "./data.ts";
import { rpc_organizations_setups_resume } from "./setups.ts";
import {
  rpc_organizations_invitations_accept,
  rpc_organizations_invitations_cancel,
  rpc_organizations_invitations_decline,
  rpc_organizations_invitations_invite,
} from "./invitations.ts";
import { procedure_approvals_open } from "../approvals/procedures.ts";
import { procedure_parties_activate, procedure_parties_register, procedure_parties_release } from "../parties/procedures.ts";
import { table_hat_wearers, table_safe_executions } from "../indexing/data.ts";
import { event_approval_transitioned } from "../approvals/data.ts";
import { table_indexer_progress } from "../indexing/data.ts";
import { rpc_organizations_heads_ring } from "./heads.ts";
import { table_principals } from "../access/data.ts";
import { table_parties } from "../parties/data.ts";

const O = "packages/backend/src/organizations";
const DAY = 86_400_000;

export const workflow_organizations_setups_set_up = defineWorkflow({
  id: "organizations.setups.set-up",
  title: "One Organization's setup: mint the Safe, deploy, install, ready",
  about:
    "The one durable process of an Organization's setup, started by its `begin`. Companies House's company-Safe role " +
    "mints the company Safe for the founder's Safe; the process " +
    "waits for CompanySafeMinted at finality: the founder's Safe as owner activates the Organization's Party " +
    "(`parties.activate`, its handle now routes money), any other owner fails the setup and releases the Party " +
    "(`parties.release`). The tier key " +
    "sends `Installer.deployMoney` once (founder as the one Director, threshold 1 of 1, officers Books, Invoicing and " +
    "People); at finality MoneyDeployed names the deployment, which is written with the install approval in one " +
    "transaction (`approvals.open`: the founder's Safe calls the company Safe's `execTransaction` of `buildMoney`'s batch " +
    "for USDC, top amount 0, then `Hats.mintHat` of the three officer hats to the founder's Safe). It waits for the " +
    "founder's signature and the approval's outcome, both told by approval_transitioned: signed moves it to processing, " +
    "landed at finality completes it and seats the founder; refused (by the paymaster's simulation), declined, " +
    "expired, reverted or displaced stalls it with that reason and approvals' code (organizations.approval-endings). A " +
    "provider outage that outlasts a step's retries stalls it too. `org retry` resumes it from its last finished step. " +
    "With `with_fde`, once the company Safe is the founder's, it asks Capxul's FDE host to provision the FDE " +
    "(organizations.fde-at-start-up, aaron.fde-hosted): the host makes and keeps its key and answers its address; one " +
    "transaction records it with the FDE's Safe, registers its Party pending (`parties.register`) and births its hosting " +
    "(`org-fdes`). The install batch also calls `AgentOwner.create(that key, the company Safe)`, so one signature creates " +
    "the FDE, which completion seats and activates. A failed setup releases the FDE's Party, and the Organization's " +
    "while pending. It replaces the old observe workflow, its recovery cron and ten internal rpcs.",
  was: [
    "docs/as-is/archive/organizations/setups.ts:709",
    "docs/as-is/archive/organizations/setups.ts:751",
    `${O}/setups/external/deploys.ts:191`,
    `${O}/setups/external/installs.ts:80`,
  ],
  concept: concept_organizations,
  priority: "normal",
  trigger: { transition: machine_org_setup.t.begin },
  instance: { per: table_org_setups },
  signals: [rpc_organizations_setups_resume],
  waits: [
    {
      name: "safe-minted",
      for: "indexer",
      events: [contract_company_safe_minter.e.CompanySafeMinted],
      key: [{ on: [contract_company_safe_minter.e.CompanySafeMinted], props: ["chain_id", "tx_hash"] }],
      about: "CompanySafeMinted of the mint transaction, at the deployment's finality depth.",
    },
    {
      name: "money-deployed",
      for: "indexer",
      events: [contract_installer.e.MoneyDeployed],
      key: [{ on: [contract_installer.e.MoneyDeployed], props: ["chain_id", "tx_hash"] }],
      about: "MoneyDeployed of the deployMoney transaction, at finality.",
    },
    {
      name: "founder-signature",
      for: "person",
      key: [{ on: [event_approval_transitioned], props: ["opener", "subject_kind", "subject_id"] }],
      about: "The founder signs the install approval on the approval page; approval_transitioned (opener organizations, the setup as subject) resumes it.",
    },
    {
      name: "install-landed",
      for: "chain",
      key: [{ on: [event_approval_transitioned], props: ["opener", "subject_kind", "subject_id"] }],
      about: "The install approval lands, reverts or expires on chain proof; approval_transitioned (opener organizations, the setup as subject) resumes it.",
    },
    {
      name: "install-final",
      for: "indexer",
      key: [{ on: [table_indexer_progress], props: ["chain_id"], reaches: "indexed_block" }],
      about: "The install's facts at finality: the Gate as module and guard, the hats minted, and the FDE's AgentCreated when it carries one.",
    },
    {
      name: "retry",
      for: "signal",
      key: [{ on: [rpc_organizations_setups_resume], props: ["orgId"] }],
      about: "From needs_attention, `org retry` wakes it to run its next unfinished step again.",
    },
  ],
  steps: [
    { name: "mint", about: "Send CompanySafeMinter.mint with the company-Safe role, unless mint_tx_hash is recorded; then follow that one." },
    { name: "confirm-mint", about: "At finality, read the mint's facts: steps gains safe_minted and the Party is activated, or the setup fails and the Party is released." },
    {
      name: "host-fde",
      about:
        "With `with_fde` and no FDE recorded: ask the FDE host to provision the FDE; record its key's address and Safe, register its Party, birth its hosting.",
    },
    { name: "deploy", about: "Send Installer.deployMoney with the tier key, unless deploy_tx_hash is recorded: it mints new hats each time it runs." },
    { name: "confirm-deploy", about: "At finality, read MoneyDeployed; write the deployment; steps gains money_deployed." },
    { name: "open-install", about: "Read buildMoney's batch, add AgentOwner.create of the host's FDE key when one is recorded, open the founder's install approval; request_authorization." },
    { name: "await-founder", about: "Wait for the founder's signature; authorize once the approval is signed." },
    { name: "complete", about: "At finality, check the install's facts (AgentCreated for the FDE's Safe too); complete; seat the founder (`seat`) and the FDE (`organization`); activate the FDE's Party." },
  ],
  reads: [table_org_setups, table_organizations, table_org_deployments, table_org_fdes],
  writes: [table_org_setups, table_org_deployments, table_org_members, table_org_fdes],
  drives: [
    machine_org_setup.t.request_authorization,
    machine_org_setup.t.authorize,
    machine_org_setup.t.complete,
    machine_org_setup.t.stall,
    machine_org_setup.t.fail,
    machine_org_member.t.seat,
    machine_org_fde.t.provision,
  ],
  invokes: [procedure_approvals_open, procedure_parties_activate, procedure_parties_release, procedure_parties_register],
  emits: [],
  calls: [
    integration_service_signer.c.send,
    integration_service_signer.c.waitForReceipt,
    integration_indexer.c.awaitBlock,
    integration_indexer.c.factsOf,
    integration_chain_rpc.c.readContract,
    integration_fde_host.c.provision,
  ],
  chain: [
    contract_company_safe_minter.f.mint,
    contract_installer.f.deployMoney,
    contract_installer.f.buildMoney,
    contract_safe.f.execTransaction,
    contract_hats.f.mintHat,
    contract_agent_owner.f.create,
    contract_agent_owner.f.safeAddressFor,
  ],
  idempotency:
    "One process per Organization (`org-setup:<orgId>`). The mint and deployMoney are each sent once (the service " +
    "signer records the signed bytes before broadcast, CAP-1097); one install approval at a time; the host's provision " +
    "is keyed by the Organization's id.",
  // Real time bounding one run's work between its waits (time.real-elapsed): sends, receipts and a host call with retries.
  timeoutMs: 30 * 60_000,
  retries: { max: 5, backoff: "exponential" },
  compensation:
    "None. A minted Safe and a deployment are kept: a stalled setup resumes from them, and a second deployMoney is never " +
    "sent for a deployment already recorded.",
  budget: budget("background"),
});

export const workflow_organizations_invitations_follow = defineWorkflow({
  id: "organizations.invitations.follow",
  title: "One invitation's life: grants, answer, expiry, cleanup",
  about:
    "The one durable process of an invitation, started after the invite rpc commits: it cannot be a step of it, because " +
    "it waits days for a person, for the Board's proposal on chain and for a seven-day timer, and must survive a crash. " +
    "Authorizing: it waits for budgets to bind the company Safe transaction that carries the grants, then for that " +
    "transaction's ExecutionSuccess at finality, reads which hats it minted to the grantee's Safe, and opens the offer " +
    "with its expiry; if the Safe's nonce goes to another transaction (a rejection or a replacement), it cancels the " +
    "offer, which has nothing on chain. Pending: it waits for accept, decline or cancel (its signals), or for its timer at " +
    "expires_at, which expires an offer with nothing on chain or begins the cleanup of one with hats. Revoking: budgets " +
    "proposes taking the hats back, and the process ends the offer with its recorded reason when the grantee's Safe " +
    "wears none of them. It replaces the old grant drive, retry and verify loops and the daily expiry cron.",
  was: ["docs/as-is/archive/organizations/invitations.ts:427", "docs/as-is/archive/organizations/invitations.ts:586", `${O}/invitations/writes/endings.ts:175`],
  concept: concept_organizations,
  priority: "normal",
  trigger: { after: rpc_organizations_invitations_invite },
  instance: { per: table_org_invitations },
  signals: [rpc_organizations_invitations_accept, rpc_organizations_invitations_decline, rpc_organizations_invitations_cancel],
  waits: [
    {
      name: "grants-executed",
      for: "indexer",
      events: [contract_safe.e.ExecutionSuccess, contract_safe.e.ExecutionFailure],
      key: [{ on: [table_safe_executions], props: ["chain_id", "safe_address", "safe_nonce"] }],
      about: "Authorizing: the bound Safe transaction's ExecutionSuccess at finality, or its nonce taken by another.",
    },
    {
      name: "invitee",
      for: "person",
      key: [
        {
          on: [rpc_organizations_invitations_accept, rpc_organizations_invitations_decline, rpc_organizations_invitations_cancel],
          props: ["orgId", "invitationId"],
        },
      ],
      about: "Pending: the invitee accepts or declines, or the Organization cancels.",
    },
    { name: "expiry", for: "timer", timeoutMs: 7 * DAY, about: "Seven days after the offer opened; a resend never moves it." },
    {
      name: "hats-removed",
      for: "indexer",
      events: [contract_hats.e.WearerStandingChanged, contract_hats.e.TransferSingle],
      key: [
        { on: [contract_hats.e.WearerStandingChanged], props: ["chain_id", "wearer"] },
        { on: [contract_hats.e.TransferSingle], props: ["chain_id", "from"] },
      ],
      about: "Revoking: the grantee's Safe wears none of the granted hats.",
    },
  ],
  steps: [
    { name: "await-grants", about: "Authorizing only: wait for the binding, then for the transaction or its nonce to pass." },
    { name: "open", about: "Read the executed transaction's facts for the hats minted to the grantee's Safe; open, with expires_at." },
    { name: "await-answer", about: "Wait for a signal or the expiry timer." },
    { name: "expire", about: "At the timer: expire, or begin_cleanup when hats are on chain." },
    { name: "await-cleanup", about: "Revoking: when no granted hat is worn, finish with the recorded reason." },
  ],
  reads: [table_org_invitations, table_safe_executions, table_hat_wearers],
  writes: [table_org_invitations],
  drives: [
    machine_org_invite.t.open,
    machine_org_invite.t.cancel,
    machine_org_invite.t.expire,
    machine_org_invite.t.begin_cleanup,
    machine_org_invite.t.finish_declined,
    machine_org_invite.t.finish_cancelled,
    machine_org_invite.t.finish_expired,
  ],
  invokes: [],
  emits: [],
  calls: [integration_indexer.c.factsOf],
  chain: [],
  idempotency:
    "One process per invitation (`org-invite:<orgId>:<invitationId>`); every transition is guarded by the phase it moves " +
    "from, so a replayed step changes nothing.",
  // Real time bounding one run's work between its waits (time.real-elapsed); the offer's life is its timers on the one clock.
  timeoutMs: 10 * 60_000,
  retries: { max: 5, backoff: "exponential" },
  budget: budget("background"),
});

export const workflow_organizations_members_end_agent_seats = defineWorkflow({
  id: "organizations.members.end-agent-seats",
  title: "End the Seats of an agent the chain removed",
  about:
    "Triggered by AgentOwner's AgentRemoved, from Ponder. Every active Seat whose Safe is the removed agent's moves to " +
    "removed, in one transaction. A removed agent holds no Safe Capxul can act from, so its Seats cannot stay current. " +
    "It never touches a person's Seat.",
  was: [`${O}/members/writes/grants.ts:254`],
  concept: concept_organizations,
  priority: "normal",
  trigger: { chainEvent: contract_agent_owner.e.AgentRemoved },
  steps: [{ name: "remove-seats", about: "Find the active Seats by the agent's Safe and remove each." }],
  reads: [table_org_members],
  writes: [table_org_members],
  drives: [machine_org_member.t.remove],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  idempotency: "The AgentRemoved log's transaction hash and log index; a Seat already removed is skipped.",
  timeoutMs: 60_000,
  retries: { max: 5, backoff: "exponential" },
  budget: budget("background"),
});

export const workflow_organizations_heads_watch = defineWorkflow({
  id: "organizations.heads.watch",
  title: "One head connection's life: check the site, install wanted apps, follow it",
  about:
    "The one durable process of a head connection, started by its `connect`: it waits on the site for days at a time and " +
    "must survive a crash. It reads the site (`readSite`) and confirms the connection when the Capxul app is there at a " +
    "version Capxul speaks, with its Custom Fields, the fundamental apps (ERPNext, Frappe HR, Frappe CRM), the " +
    "Organization's time zone and a Company in its currency; anything else stalls it with the reason (a head in another " +
    "time zone would date every document a day wrong, and one in another currency would value every amount wrong). Connected, a Frappe Cloud head's host is asked to install each wanted app (`installApp`, " +
    "with the team's token); a self-hosted head's is not, since its owner installs it with bench; either way it marks " +
    "the app installed once readSite lists it. It checks the site again once a day by its " +
    "own timer, at once when an app is wanted, and on a ring while failing; a check that fails past its retries stalls " +
    "it, and the next good one recovers it. It ends when a Director disconnects the head. It syncs no app's records: " +
    "each app concept's own process does, from `confirm` (organizations.head-ownership). It pushes the members' " +
    "Users, with their hats' roles, at `confirm`, on a Seat's change and daily (organizations.head-users). On a devnet its daily timer is a stop, " +
    "and the stand-in head follows the clock (organizations.head-clock).",
  concept: concept_organizations,
  priority: "normal",
  trigger: { transition: machine_org_head.t.connect },
  instance: { per: table_org_heads },
  signals: [rpc_organizations_heads_ring],
  waits: [
    { name: "daily-check", for: "timer", timeoutMs: DAY, about: "Read the site again a day after the last check." },
    {
      name: "app-wanted",
      for: "signal",
      key: [{ on: [event_org_app_transitioned], props: ["org_id"] }],
      about: "An app became wanted: ask the head's host to install it now.",
    },
    {
      name: "seat-changed",
      for: "signal",
      key: [{ on: [event_org_member_transitioned], props: ["org_id"] }],
      about: "A Seat of the Organization was born or ended: push the members' Users now.",
    },
    {
      name: "ring",
      for: "signal",
      key: [{ on: [rpc_organizations_heads_ring], props: ["headId"] }],
      about: "The head rang while the connection is failing: the site is up again, so check it now.",
    },
    {
      name: "disconnected",
      for: "signal",
      key: [{ on: [event_org_head_transitioned], props: ["org_id", "head_id"] }],
      about: "A Director disconnected it: end.",
    },
  ],
  steps: [
    {
      name: "check",
      about:
        "readSite; confirm, stall or recover; record Frappe's and the Capxul app's versions and the time zone, and each " +
        "of the Organization's apps' version as the site lists it (org-apps.version, the fundamental apps' included).",
    },
    { name: "install-wanted", about: "Connected: on a Frappe Cloud head, installApp for each wanted app not yet asked for, then readSite again; on any head, install each wanted app readSite lists." },
    {
      name: "users",
      about:
        "Connected: upsertDocs a User for each person holding a current Seat, with the roles its hats give now, and disable the User of a Seat that ended.",
    },
    { name: "await", about: "Wait for the timer, a wanted app, a Seat's change, a ring or the disconnect." },
  ],
  reads: [
    table_org_heads, table_org_apps, table_organizations, table_org_members, table_principals, table_parties,
    table_org_deployments, table_hat_wearers,
  ],
  writes: [table_org_heads, table_org_apps],
  drives: [machine_org_head.t.confirm, machine_org_head.t.stall, machine_org_head.t.recover, machine_org_app.t.install],
  invokes: [],
  emits: [],
  calls: [integration_frappe_head.c.readSite, integration_frappe_head.c.installApp, integration_frappe_head.c.upsertDocs],
  chain: [],
  idempotency:
    "One process per head connection (`org-head:<orgId>:<headId>`); each transition is guarded by the state it moves " +
    "from, an app already asked for is not asked for again, and a User is written by the member's `capxul_id` with its " +
    "version, so a repeated push changes nothing.",
  // Real time bounding one run's work between its waits (time.real-elapsed): a push or a read of the site with retries.
  timeoutMs: 10 * 60_000,
  retries: { max: 5, backoff: "exponential" },
  budget: budget("background"),
});

export const workflow_organizations_fde_host = defineWorkflow({
  id: "organizations.fde.host",
  title: "One hosted FDE's life on Capxul's host: start, fall due, pause, resume",
  about:
    "The one durable process of an Organization's hosted Forward Deployed Engineer (aaron.fde-hosted, " +
    "organizations.fde-hosting), started by its `provision`: it waits on the setup for days, then on the hosting's dates " +
    "for months, and must survive a crash. When the setup completes (the install created the FDE on chain and seated " +
    "it) it asks the FDE host to start the agent (the `fde-host` integration's `start`, with the Organization's handle, " +
    "the FDE's handle and Safe, and Capxul's FDE persona and Frappe skills) and starts the hosting: its start-up month " +
    "runs to one calendar month after the setup was ready, in the Organization's time zone, when the deployment sets " +
    "FDE_HOSTING_PRICE; with none, hosting is not charged and `paid_through` stays null until a daily check finds a " +
    "price, which starts the start-up month then. A failed setup retires it on the host. Running, its own timers make " +
    "it due seven days before `paid_through` (notices reminds the Directors) and pause it when `paid_through` passes " +
    "unpaid (the host's `pause`: the agent takes no turn, its sandbox stops, and the host keeps its key, conversation " +
    "and workspace; nothing on chain changes, so its Safe, its hats and its Seat stay). A settled hosting payment " +
    "extends it, or wakes a paused one, which it resumes on the host (`resume`); a reorg that returns a payment makes " +
    "it re-read `paid_through` and fall due or pause at once if that says so. It retires the hosting for good (`retire` " +
    "on the host) when AgentRemoved names the FDE's Safe, or AgentSignerSwapped names a key the host did not make, so " +
    "its key has left the host. A paused FDE is never deleted for being unpaid: it waits, paused, until it is paid or " +
    "the Board removes it.",
  concept: concept_organizations,
  priority: "normal",
  trigger: { transition: machine_org_fde.t.provision },
  instance: { per: table_org_fdes },
  waits: [
    {
      name: "setup-ended",
      for: "signal",
      key: [{ on: [event_org_setup_transitioned], props: ["org_id"] }],
      about: "The setup completed (the install landed at finality) or failed; any other transition keeps the wait.",
    },
    { name: "fall-due", for: "timer", about: "Until seven days before `paid_through`, on the one clock." },
    { name: "lapse", for: "timer", about: "Until `paid_through`, on the one clock." },
    { name: "daily-price", for: "timer", timeoutMs: DAY, about: "While hosting is not charged: check once a day whether the deployment set FDE_HOSTING_PRICE." },
    {
      name: "paid",
      for: "signal",
      key: [{ on: [event_org_fde_transitioned], props: ["org_id"] }],
      about: "A settled hosting payment extended the hosting or woke a paused one (the door's `extend` or `wake`).",
    },
    {
      name: "returned",
      for: "signal",
      key: [{ on: [event_fde_payment_transitioned], props: ["org_id"] }],
      about: "A reorg took a hosting payment back: re-read `paid_through` and re-arm the timers.",
    },
    {
      name: "agent-gone",
      for: "indexer",
      events: [contract_agent_owner.e.AgentRemoved, contract_agent_owner.e.AgentSignerSwapped],
      key: [
        { on: [contract_agent_owner.e.AgentRemoved], props: ["chain_id", "safe"] },
        { on: [contract_agent_owner.e.AgentSignerSwapped], props: ["chain_id", "safe"] },
      ],
      about: "At finality: the Board removed the FDE, or swapped its key; a swap to the key the host holds keeps the wait.",
    },
  ],
  steps: [
    { name: "await-setup", about: "Wait for the setup's complete or fail; fail retires the hosting on the host." },
    { name: "start", about: "Ask the host to start the FDE; start, with the start-up month's `paid_through` when a price is set." },
    { name: "await", about: "Wait for the timers, a payment, a returned payment or the agent's removal or re-key." },
    { name: "fall-due", about: "Seven days before `paid_through`: fall_due." },
    { name: "pause", about: "At `paid_through`, unpaid: ask the host to pause the FDE; pause." },
    { name: "resume", about: "Woken by a payment: ask the host to resume the FDE; resume." },
    { name: "retire", about: "Setup failed, agent removed or key moved: ask the host to retire the FDE's runtime; retire." },
  ],
  reads: [table_org_fdes, table_org_setups, table_organizations, table_org_fde_payments],
  writes: [table_org_fdes],
  drives: [
    machine_org_fde.t.start,
    machine_org_fde.t.fall_due,
    machine_org_fde.t.pause,
    machine_org_fde.t.resume,
    machine_org_fde.t.retire,
  ],
  invokes: [],
  emits: [],
  calls: [integration_fde_host.c.start, integration_fde_host.c.pause, integration_fde_host.c.resume, integration_fde_host.c.retire],
  chain: [],
  idempotency:
    "One process per hosted FDE (`org-fde:<orgId>`); each transition is guarded by the state it moves from, and the " +
    "host's start, pause, resume and retire are keyed by its agent id, so a replayed step changes nothing.",
  // Real time bounding one run's work between its waits (time.real-elapsed): a host call or two with their retries.
  // The hosting's life has no bound in the story; its dates are the timer waits on the one clock.
  timeoutMs: 10 * 60_000,
  retries: { max: 5, backoff: "exponential" },
  budget: budget("background"),
});
