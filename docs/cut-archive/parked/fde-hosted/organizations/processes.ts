// Moved out of the built book by the cut, 10 November 2026, from books/target/organizations/processes.ts. The records are intact;
// the imports below are as the file had them, so they point at the folder the file was written in (as docs/as-is/archive does).
// What each record became is in docs/cut-archive/INDEX.md.

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
  event_org_member_transitioned,
  machine_org_app,
  table_org_apps,
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
import { table_principals } from "../access/data.ts";
import { table_parties } from "../parties/data.ts";

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
