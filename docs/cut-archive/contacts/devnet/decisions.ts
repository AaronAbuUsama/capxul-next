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
  concept_payroll,
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
  table_head_changes,
  table_head_documents,
  table_head_sites,
  table_mail_faults,
  table_mail_messages,
  table_scripted_gates,
  table_scripted_prices,
  table_whatsapp_messages,
  table_whatsapp_numbers,
} from "./data.ts";
import { NEW_OPERATIONS as ORG_NEW_OPERATIONS, operation_org_create, operation_org_seats_show } from "../organizations/operations.ts";
import { concept_organizations } from "../shared/foundation.ts";
import { rpc_organizations_heads_ring } from "../organizations/heads.ts";
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

export const decision_devnet_stand_ins_follow = defineDecision({
  id: "devnet.stand-ins-follow",
  title: "Every stand-in reads the devnet's now, and dates its payloads with it",
  question:
    "Old stand-ins compared due times with the wall or with Anvil's pending block, the mock paymaster signed from the " +
    "later of the chain's clock and the wall, and alto checked windows against its own wall clock. How does each " +
    "stand-in meet the one clock?",
  options: [
    {
      label: "follow",
      text:
        "Each takes now from the authority: the mock paymaster signs validAfter and validUntil from now; the bundler " +
        "stand-in checks a window and simulates at the chain's next block time, which is now, so alto runs only if it " +
        "can be given that time, else a Capxul bundler stand-in does (B3 records which); the Bridge stand-in dates every " +
        "event and object at now, schedules its own answers at instants (its next due) and signs its webhooks with the " +
        "real time; the mail sink, the Chainlink and PostHog fakes are backend layers and read Now; chain-rpc reads at " +
        "`latest` as on staging, which on a frozen devnet is a block at now (devnet.only-miner); the stand-in WhatsApp " +
        "dates every message and webhook at now (devnet.whatsapp-stand-in); a head and the FDE host follow as their own " +
        "decisions say (devnet.head-follows-world, devnet.fde-host-follows-world).",
    },
    { label: "max-of-both", text: "Sign from the later of the chain's time and the wall, as the old mock paymaster did." },
  ],
  chosen: "follow",
  why:
    "A window signed from the wall is already closed on a story set a year back, and one signed from a moving pending " +
    "block lapses at the wall's pace; with one clock the window opens at now and lapses when now passes it, as on " +
    "staging. A webhook's signature is an envelope the backend checks against real time (time.real-elapsed), while the " +
    "deposit it reports happened at now.",
  source: TIME(`${OLD_WORLD}/README.md (the mock paymaster signs from the later of the chain's clock and the wall; alto checks its wall clock); ${OLD_WORLD}/../stand-ins/time.ts`),
  affects: [
    integration_bundler, integration_bridge, integration_mail, integration_chainlink, integration_posthog, integration_chain_rpc,
    integration_indexer, component_devnet, environment_devnet, environment_shared_world, table_whatsapp_messages,
  ],
});

export const decision_devnet_whatsapp_stand_in = defineDecision({
  id: "devnet.whatsapp-stand-in",
  title: "The stand-in WhatsApp: Meta's Cloud API on devnet's tables, on the world's clock",
  question:
    "aaron.world-clock sends a world's WhatsApp to a stand-in, and the CRM tracks every WhatsApp conversation (Aaron's " +
    "evening answer). Capxul and Frappe's WhatsApp app both speak Meta's WhatsApp Cloud API. What is the stand-in, where " +
    "is its state, and how does it follow the clock?",
  options: [
    {
      label: "cloud-api-stand-in",
      text:
        "For aaron.world-clock: a supervisor-run imitation of the Cloud API at the deployment's WHATSAPP_API_URL, which a " +
        "head's WA Settings take as `whatsapp_api_url`, so neither side forks. It serves every route Capxul and Frappe's " +
        "WhatsApp app call: messages and media sent, an inbound one marked read; the account's templates listed, made, " +
        "read, changed and deleted; the app's subscription to the account (`subscribed_apps`, which Capxul's connect " +
        "makes); and the number read (display number, verified name, quality rating). Its state is devnet's " +
        "whatsapp-numbers and whatsapp-messages. `capxul-devnet whatsapp number add <org> [--webhook <url>]` makes a " +
        "number, the next from +447700900100 up, and writes `<org>-whatsapp.json` (number id, business id, token, app " +
        "secret, verify token) in the working directory; `whatsapp number webhook <number> <url>` points it at a route " +
        "after the GET handshake, as Meta checks a callback; `whatsapp number remove <number>` deletes it. Each account " +
        "holds Meta's sample template `hello_world` (en_US, approved) and every template made through it, approved at " +
        "once. A send is answered with its wamid and followed at once by its `sent` and `delivered` webhooks. It judges " +
        "Meta's rules on the world's now: a free-form message to a number that has not written in 24 hours is refused " +
        "131047, an unknown template 132001. `whatsapp receive <number> --from <E.164> [--name <profile name>] <text>` " +
        "posts an inbound message and `whatsapp read <wamid>` a `read` status, signed with the app secret as Meta signs. " +
        "A webhook not answered 200 is redelivered on the world's clock after 1, 5 and 30 minutes, then every 6 hours " +
        "for 7 days. Nothing reaches a real phone. `capxul-devnet fault whatsapp down|refuse|clear` arms its switch. It " +
        "follows the clock: idle once every webhook it posted is answered, whatever the answer; its earliest " +
        "redelivery is its next due.",
    },
    { label: "meta-test-number", text: "Use Meta's own test business number and its registered recipients on a devnet." },
    { label: "backend-layer", text: "A WhatsApp devnet layer inside the backend, as the mail fake is." },
  ],
  chosen: "cloud-api-stand-in",
  why:
    "Meta's test number sends real messages to real phones on Meta's clock, which a world at a rate or a frozen eval " +
    "cannot follow. Served over HTTP in Meta's shape, the stand-in exercises Capxul's real WhatsApp client and lets a " +
    "real head's WhatsApp app use the same stand-in by one setting, as the stand-in head and FDE host do " +
    "(devnet.head-stand-in, devnet.fde-host-stand-in); a backend layer would skip the client and leave a head no way " +
    "in. Judging the 24-hour window itself, on the world's now, lets an eval see Meta's own refusal mapped " +
    "(contacts.whatsapp-window) without arming a fault, and a warp past the window close it at once. In the devnet schema, a world's snapshot carries its conversations with the CRM's rows that point at them " +
    "(devnet.own-schema). Both statuses at once keep a frozen eval free of a stop it would wait for; `read` is a " +
    "person's act, so it is a control, and an inbound message is the outside party acting, which no Capxul surface " +
    "makes (devnet.fault-switches). The routes are the ones both clients call (frappe/whatsapp api/whatsapp.py: " +
    "messages, media, message_templates, a template by id, subscribed_apps) and the integration's readNumber, so " +
    "neither connect fails on a devnet. `hello_world` is what a Meta test number holds, so a first template send needs " +
    "no template made first. The number, the key file's name and the webhook control are fixed because the CRM's " +
    "claims read them (contacts.conversation-worlds: +447700900100, `acme-whatsapp.json`) and its connect prints the " +
    "route only after the number exists. Redelivery is the integration's promise (Meta redelivers for 7 days); on the " +
    "world's clock with its next due, a refused route (a disconnected account) never holds a stop, as an unanswered " +
    "webhook counted busy would, and a warp of a week sees every retry. Its tables' writer is the stand-in, outside " +
    "the book's records, so each shows the unwritten-table gap. For the CRM's owner: the WhatsApp integration's `fake` " +
    "names this stand-in.",
  source: WORLD_CLOCK("aaron.world-clock; frappe/whatsapp wa_settings (whatsapp_api_url), api/whatsapp.py:89-126, webhook.py:117-146 (profile name); shared external.ts (whatsapp: readNumber, subscribeApp, fake)"),
  affects: [...WHATSAPP_TABLES, component_devnet, environment_devnet, environment_shared_world, component_frappe_app],
});
