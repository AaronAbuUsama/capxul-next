// Moved out of the built book by the cut, 10 November 2026, from books/target/devnet/decisions.ts. The records are intact;
// the imports below are as the file had them, so they point at the folder the file was written in (as docs/as-is/archive does).
// What each record became is in docs/cut-archive/INDEX.md.

import { defineDecision } from "../../../packages/book/src/index.ts";
import {
  component_devnet,
  component_frappe_app,
  concept_accounts,
  concept_devnet,
  concept_documents,
  concept_notices,
  environment_devnet,
  environment_shared_world,
} from "../shared/foundation.ts";
import {
  integration_bridge,
  integration_bundler,
  integration_chain_rpc,
  integration_chainlink,
  integration_devnet_control,
  integration_fde_host,
  integration_frappe_head,
  integration_indexer,
  integration_mail,
  integration_posthog,
} from "../shared/external.ts";
import {
  table_fde_host_agents,
  table_mail_faults,
  table_mail_messages,
  table_scripted_gates,
  table_scripted_prices,
} from "./data.ts";
import { NEW_OPERATIONS as ORG_NEW_OPERATIONS, operation_org_create, operation_org_seats_show } from "../organizations/operations.ts";
import { concept_organizations } from "../shared/foundation.ts";
import { rpc_devnet_mail_fail, rpc_devnet_mail_list, rpc_devnet_mail_list_notices } from "./mail.ts";
import { rpc_devnet_gates_read, rpc_devnet_gates_script } from "./gates.ts";
import { rpc_devnet_prices_script } from "./prices.ts";
import { rpc_devnet_jobs_run } from "./jobs.ts";
import {
  flow_devnet_approve,
  flow_devnet_gates_set,
  flow_devnet_prices_set,
  flow_devnet_seasons_cancel,
  flow_devnet_seasons_change,
  flow_devnet_seasons_create,
  flow_devnet_seasons_end,
  flow_devnet_seasons_list,
  flow_devnet_seasons_players_add,
  flow_devnet_seasons_players_remove,
  flow_devnet_seasons_show,
  flow_devnet_seasons_start,
  flow_devnet_seasons_warps_add,
  flow_devnet_seasons_warps_remove,
  flow_devnet_snapshots_list,
  flow_devnet_snapshots_restore,
  flow_devnet_snapshots_save,
  flow_devnet_time_follow,
  flow_devnet_time_freeze,
  flow_devnet_time_resume,
  flow_devnet_time_set,
  flow_devnet_time_settle,
  flow_devnet_time_show,
  flow_devnet_time_start_at,
  flow_devnet_time_step,
  flow_devnet_time_warp,
  flow_devnet_time_watch,
} from "./flows.ts";
import * as ops from "./operations.ts";
import { concept_contacts, concept_payments } from "../shared/foundation.ts";

export const decision_devnet_fde_host_stand_in = defineDecision({
  id: "devnet.fde-host-stand-in",
  title: "The stand-in FDE host: devnet keys, scripted replies, on the one clock",
  question:
    "Every Organization's FDE now runs on Capxul's FDE host (organizations.fde-host), which makes and keeps its key. " +
    "Evals need a host that provisions an FDE with a key a world can rebuild, answers a message with a fixed reply, " +
    "pauses and resumes on the one clock, fails on demand, and lets an eval run a command as the FDE. What is it?",
  options: [
    {
      label: "supervisor-http-table",
      text:
        "For aaron.fde-hosted: a supervisor-run stand-in speaking the `fde-host` integration's calls over HTTP on " +
        "loopback, so the backend's real `FdeHost` client calls it. Its state is devnet's `fde-host-agents`: per agent " +
        "a devnet key derived from the agent id (so a rebuilt world makes the same one), its state and its turns, each " +
        "ended with a scripted reply as it is posted. `capxul-devnet fde run <org> -- <command>` runs a Capxul " +
        "command as the FDE with that key, as the hosted FDE's own tool would. `capxul-devnet fault fde-host " +
        "down|hold|clear` arms its switch (`hold` keeps new turns working). It joins the clock as a follower with no " +
        "next due, always idle.",
    },
    { label: "real-swarmd", text: "Run a local swarmD with a real model behind each FDE." },
    { label: "backend-layer", text: "An `FdeHost` devnet layer inside the backend over the same table." },
  ],
  chosen: "supervisor-http-table",
  why:
    "Served over HTTP, the stand-in exercises the backend's real host client, its timeouts and its error mapping, as the " +
    "stand-in head does (devnet.head-stand-in). A real model would make every reply, and so every eval of `org fde " +
    "ask`, differ from run to run; a scripted reply is what a black-box eval can compare. It ends a turn as it is " +
    "posted because evals run on a frozen clock: a reply kept for the next stop would come only if something moved the " +
    "clock during the command, so `org fde ask` would reach its deadline instead of the reply; `hold` is how an eval " +
    "reaches the deadline on purpose. A key derived from the agent " +
    "id keeps worlds deterministic (devnet.deterministic-worlds), and keeping it in devnet's schema lets a world's " +
    "snapshot carry it with the chain that knows its address. `fde run` is a supervisor control, not a Capxul command: " +
    "it is the hosted agent acting, which no Capxul surface makes (devnet.fault-switches). Its table's writer is the " +
    "stand-in, outside the book's records, so it shows the unwritten-table gap as the head's tables do. For the shared " +
    "owner: the `fde-host` integration's `fake` names this stand-in.",
  source: COMMANDS("organizations.fde-host; devnet.head-stand-in; devnet.fault-switches; aaron.fde-hosted"),
  affects: [table_fde_host_agents, component_devnet, environment_devnet, concept_devnet],
});

export const decision_devnet_fde_host_follows_world = defineDecision({
  id: "devnet.fde-host-follows-world",
  title: "A world's hosted FDEs run on its clock: their timers are its instants",
  question:
    "aaron.world-clock: the FDE follows the world's clock. A hosted FDE (organizations.fde-host) is a durable agent on " +
    "swarmD whose runtime keeps timers of its own (a follow-up it promised, a wake-up, a turn's deadline) on " +
    "Cloudflare's real clock. On a devnet the stand-in host keeps none. In a shared world, how do a world's FDEs keep " +
    "their times on its clock?",
  options: [
    {
      label: "world-namespace",
      text:
        "A world that hosts real FDEs (a shared world; a devnet's evals keep the stand-in) has its own namespace on the " +
        "FDE host, which FDE_HOST_URL names, and that namespace joins the world's clock as one follower, `fde-host`, " +
        "over the protocol with a follower grant. Each agent's timer is kept as an instant on the world's now; the " +
        "namespace reports the earliest as its next due, and at a stop fires each one due by starting its turn, then " +
        "acknowledges idle once those turns are taken (an actor's acknowledgement, devnet.follow-at-a-rate). A turn runs " +
        "in real time: what the FDE does through Capxul is dated by Capxul's now when it lands " +
        "(time.clients-take-server-now), and its sandbox's and model calls' timeouts stay real (time.real-elapsed). The " +
        "stand-in host stays as it is: no timer, always idle, a reply as each turn is posted. Staging's and production's " +
        "FDEs run on the host's real clock.",
    },
    { label: "shared-namespace", text: "One FDE namespace for every world, each agent converting its own timers." },
  ],
  chosen: "world-namespace",
  why:
    "A durable agent's timers are its promises in the story: 'I will check the invoice in three days' must fire three " +
    "world days later, which at rate 4 is 18 real hours, not 72. A namespace per world gives its agents one clock and " +
    "one follower that reports their earliest instant, as the backend reports its timers; a shared namespace would mix " +
    "clocks in one runtime. Acknowledging once the turns are taken keeps a model's thinking out of the world's barrier, " +
    "since the FDE is not on the critical path (aaron.fde-anyone). For the FDE host's owners (organizations.fde-host " +
    "and the swarm design): swarmD's agent timers must take an instant on an outside clock and a follower that fires " +
    "them, a requirement on swarmD.",
  source: WORLD_CLOCK("organizations.fde-host; books/target/shared/external.ts (fde-host); devnet.fde-host-stand-in; aaron.fde-anyone"),
  affects: [integration_fde_host, table_fde_host_agents, component_devnet, environment_shared_world],
});
