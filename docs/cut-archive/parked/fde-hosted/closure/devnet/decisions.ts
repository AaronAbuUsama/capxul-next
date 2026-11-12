import * as worldOps from "./world-ops.ts";
// Devnet's own judgments, one decision record each. The architecture's judgments about devnet are
// in ../shared/decisions.ts (concepts.devnet, components.devnet, environments.devnet,
// operations.dev-mail-notices-in-devnet, responsibilities.operator-proof-tools,
// dependencies.of-devnet).

import { defineDecision } from "../../packages/blueprint-engine/src/index.ts";
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
  integration_indexer,
  integration_mail,
  integration_posthog,
} from "../shared/external.ts";
import {
  table_mail_faults,
  table_mail_messages,
  table_scripted_gates,
  table_scripted_prices,
} from "./data.ts";
import { operation_org_create, operation_org_seats_show } from "../organizations/operations.ts";
import { concept_organizations } from "../shared/foundation.ts";
import { rpc_devnet_mail_fail, rpc_devnet_mail_list, rpc_devnet_mail_list_notices } from "./mail.ts";
import { rpc_devnet_gates_read, rpc_devnet_gates_script } from "./gates.ts";
import { rpc_devnet_prices_script } from "./prices.ts";
import { rpc_devnet_jobs_run } from "./jobs.ts";
import {
  flow_devnet_approve,
  flow_devnet_gates_set,
  flow_devnet_prices_set,
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

const BY = "Claude, devnet concept design, 8 November 2026";
const by = (evidence: string) => `${BY}; evidence: ${evidence}`;

const WHATSAPP_TABLES: never[] = [];
const TABLES = [
  table_mail_messages, table_mail_faults, table_scripted_gates, table_scripted_prices, ...WHATSAPP_TABLES,
];
const RPCS = [
  rpc_devnet_mail_list, rpc_devnet_mail_fail, rpc_devnet_mail_list_notices, rpc_devnet_gates_script, rpc_devnet_gates_read,
  rpc_devnet_prices_script, rpc_devnet_jobs_run,
];
const TIME_FLOWS = [
  flow_devnet_time_show, flow_devnet_time_warp, flow_devnet_time_start_at, flow_devnet_time_set, flow_devnet_time_freeze,
  flow_devnet_time_resume, flow_devnet_time_step, flow_devnet_time_settle, flow_devnet_time_watch, flow_devnet_time_follow,
];
const SUPERVISOR_FLOWS = [...TIME_FLOWS, flow_devnet_snapshots_list, flow_devnet_snapshots_save, flow_devnet_snapshots_restore];
const TIME_OPS = [worldOps.operation_world_show, worldOps.operation_world_clock_warp, worldOps.operation_world_create, worldOps.operation_world_clock_set];
/** The time design's own evidence (docs/design/time.md). */
const TIME = (evidence: string) => `Claude, time design, 8 November 2026; evidence: ${evidence}`;
const OLD_WORLD = "/home/user/factory packages/devnet/src/modules/world";
const BENCH = "/home/user/factory packages/vending-bench/src";
const OPERATIONS = [
  worldOps.operation_world_show, worldOps.operation_world_clock_warp, worldOps.operation_world_create, worldOps.operation_world_snapshot_save,
  worldOps.operation_world_snapshot_list, worldOps.operation_world_snapshot_restore, ops.operation_dev_prices_set, ops.operation_dev_gates_set,
  ops.operation_dev_approve, ops.operation_dev_jobs_run, ops.operation_dev_mail_list, ops.operation_dev_mail_fail,
  ops.operation_dev_mail_notices, worldOps.operation_world_clock_set,
];

// ── data ────────────────────────────────────────────────────────────────────────────────────

export const decision_devnet_own_schema = defineDecision({
  id: "devnet.own-schema",
  title: "Devnet's tables live in a `devnet` schema only a devnet migrates",
  question: "Old operator kept its devnet mail, mail faults and test holds in the one production schema, empty everywhere but a devnet. Where do devnet's tables live now?",
  options: [
  {
    "label": "current-scope",
    "text": "Devnet-only faults, mail and world metadata must not be production business data. Worlds keep this state in their own database's devnet tables (aaron.postgres-and-ponder: one Postgres database per world). Staging/production never migrate test controls."
  },
  {
    "label": "historical",
    "text": "The former answer to devnet.own-schema is preserved in docs/cut-archive/decision-review-history.json as historical evidence, not implementation authority."
  }
],
  chosen: "current-scope",
  why:
    "Review, 11 November 2026: Devnet-only faults, mail and world metadata must not be production business data. Worlds keep this state in their own database's devnet tables (aaron.postgres-and-ponder: one Postgres database per world). Staging/production never migrate test controls. Authority: devnet.lean-world; devnet.site-follows-world; devnet.snapshot-of-a-world.",
  source: "The coordinator, round 2, m1-old-decisions; devnet.lean-world; devnet.site-follows-world; devnet.snapshot-of-a-world",
  affects: [...TABLES, concept_devnet, environment_devnet],
});

export const decision_devnet_no_machines = defineDecision({
  id: "devnet.no-machines",
  title: "No state machine, so no event",
  question: "Does any devnet table carry a lifecycle that needs a machine and its `<machine>_transitioned` event (P7)?",
  options: [
  {
    "label": "current-scope",
    "text": "Devnet mail, faults, clock rate and test controls are infrastructure values, not business lifecycles needing product transition events. Real site document docstatus belongs to Frappe and is saved in site backups, not a stand-in head document table. This does not remove machines from retained Core money/authority concepts."
  },
  {
    "label": "historical",
    "text": "The former answer to devnet.no-machines is preserved in docs/cut-archive/decision-review-history.json as historical evidence, not implementation authority."
  }
],
  chosen: "current-scope",
  why:
    "Review, 11 November 2026: Devnet mail, faults, clock rate and test controls are infrastructure values, not business lifecycles needing product transition events. Real site document docstatus belongs to Frappe and is saved in site backups, not a stand-in head document table. This does not remove machines from retained Core money/authority concepts. Authority: devnet.lean-world; devnet.site-follows-world; devnet.snapshot-of-a-world.",
  source: "The coordinator, round 2, m1-old-decisions; devnet.lean-world; devnet.site-follows-world; devnet.snapshot-of-a-world",
  affects: TABLES,
});

export const decision_devnet_mail_sink = defineDecision({
  id: "devnet.mail-sink",
  title: "The mail fake keeps the sink and spends the faults",
  question: "Who writes the mail sink and the fail switch, and what does an armed fault look like to the sender?",
  options: [
    {
      label: "fake-layer",
      text:
        "The `mail` integration's devnet layer writes `mail-messages` and spends `mail-faults` inside its `send`; a spent " +
        "fault fails the send as Resend unavailable (PROVIDER_ERROR), which a notice's workflow retries. The sink keeps " +
        "both directions, as the integration's fake says: each message with its sender's name, its Reply-To and its " +
        "threading headers (Message-ID, In-Reply-To, References), as a CRM mailbox sends them. `capxul-devnet mail " +
        "receive --to <mailbox> [--cc <mailbox>]… [--bcc <mailbox>]… --from <address|\"Name <address>\"> --subject " +
        "<subject> [--in-reply-to <Message-ID>] [--references <Message-ID>]… <text>` keeps an inbound email at the " +
        "world's now, with a Message-ID of its own, and posts its signed `email.received` event, its `received_for` " +
        "naming each CRM mailbox it was sent to, a BCC'd one included, to the CRM's mail route as Resend does (signed with the devnet's RESEND_WEBHOOK_SECRET, " +
        "its envelope on real time); `getReceived` reads it back from the sink. `dev mail list` and `dev approve` read " +
        "only the mail sent.",
    },
    { label: "record-rpc", text: "Keep old operator's record mutation as a devnet rpc the transport calls." },
  ],
  chosen: "fake-layer",
  why:
    "Every send (notices' workflows, access' sign-in code) goes through Mail.send; on a devnet its layer is the fake, so " +
    "the fake is where a message is kept and a fault is spent. A record rpc would be reached by no operation, flow or " +
    "workflow (P2's unreached-rpc) and would put a network hop inside every send. The schema has no link from an " +
    "integration's fake to a table, so the build shows `mail-messages` as unwritten: an expected gap. PROVIDER_ERROR is " +
    "retryable, so `dev mail fail` shows a notice retry, which is its purpose; a send keeps the first message per " +
    "idempotency key, as Resend does. The CRM's mail, which stays in its world (time.world-channels), needs both " +
    "directions on a devnet: its claims read a sent message's From name, Reply-To and Message-ID in the sink and make " +
    "a reply by `mail receive` (contacts.conversation-worlds), which is the outside party acting, so it is a supervisor " +
    "control (devnet.fault-switches). The frozen `dev mail list` reads sent mail, so it keeps reading only that.",
  source: by("docs/as-is/archive/operator/outboxes.ts:25-58 (record); packages/backend/src/integrations/mail/service.ts:171; shared external.ts (mail fake); contacts/operations.ts (CRM email claims)"),
  affects: [table_mail_messages, table_mail_faults, rpc_devnet_mail_list, rpc_devnet_mail_fail, integration_mail, ops.operation_dev_mail_fail],
});

export const decision_devnet_notices_read = defineDecision({
  id: "devnet.notices-read",
  title: "`dev mail notices` reads notices' delivery records in place",
  question: "Notices owns the delivery records and no operation. How does devnet's `dev mail notices` read them?",
  options: [
    { label: "read", text: "A devnet query that lists notices' delivery-record table in its reads, by its conventional export name." },
    { label: "copy", text: "Notices copies each record into a devnet table through the outbox." },
  ],
  chosen: "read",
  why:
    "Devnet depends on notices (dependencies.of-devnet), so a read needs nothing more, and a copy would be a second store " +
    "of one answer. The filters by recipient and template run inside the query, so a filtered list never misses older " +
    "records, as the old 200-then-filter did. The table is notices' `notices`, its mailbox-tenanted delivery records, which notices gave " +
    "cross-tenant indexes for this read; the fields printed (state, attempts, last error) are the frozen ones.",
  source: by("operations.dev-mail-notices-in-devnet; docs/as-is/archive/operator/notices.ts:57-91"),
  affects: [rpc_devnet_mail_list_notices, ops.operation_dev_mail_notices],
});

// ── behaviour ───────────────────────────────────────────────────────────────────────────────

export const decision_devnet_devnet_only_rpcs = defineDecision({
  id: "devnet.devnet-only-rpcs",
  title: "Devnet's rpcs are mounted only by the devnet build, which serves only loopback",
  question: "How are devnet-only rpcs kept off staging, and what does \"anyone on the machine that runs the local devnet\" mean for them?",
  options: [
    {
      label: "devnet-build",
      text:
        "The devnet concept's rpcs are in the RpcGroup only of the devnet build, whose backend listens on loopback, or, " +
        "in a shared world, only behind the world's gateway, which admits a request only with a world grant, admits a " +
        "joiner only while a season they play runs and the world is not moving, refuses a " +
        "joiner's call to any devnet rpc but the two mail reads with ROLE_PERMISSION_DENIED before the backend, and " +
        "hands those reads the grant's mailboxes (devnet.season-players); each `who` begins `devnet only:`. WRONG_ENVIRONMENT comes from the " +
        "CLI's devnet scope (before any network call) and from the supervisor's socket being absent.",
    },
    { label: "runtime-gate", text: "Mount them everywhere and refuse WRONG_ENVIRONMENT in each rpc off a devnet." },
  ],
  chosen: "devnet-build",
  why:
    "A gate in every rpc leaves devnet code reachable on staging, which P2's devnet-in-production rule exists to refuse; " +
    "an rpc that is not mounted cannot be reached at all. The devnet backend serves only 127.0.0.1, so the machine is " +
    "the boundary the frozen `who` names; commands a signed-in person runs (`dev gates set`, `dev prices set`) still " +
    "need a session. Every devnet command keeps WRONG_ENVIRONMENT in its operation's `errors`, as the CLI produces it.",
  source: by("CONVENTIONS.md rule 7; environment_devnet (devnet-only rpcs answer only here); apps/cli/src/commands/dev/internal/metadata.ts:37"),
  affects: [...RPCS, ...OPERATIONS],
});

export const decision_devnet_scripted_gates = defineDecision({
  id: "devnet.scripted-gates",
  title: "Gates are scripted per Organization and reach access through one sync",
  question: "How does `dev gates set` change a gate without a second production path, and report the value that applies now?",
  options: [
    {
      label: "fake-then-sync",
      text:
        "Devnet's `scripted-gates` feeds the PostHog fake; the flow scripts the row, runs access.gates.sync once through " +
        "devnet.jobs.run, then reads access' evaluator for the effective value.",
    },
    { label: "write-flags", text: "Write access' feature flags directly from a devnet rpc." },
    { label: "wait", text: "Script the row and let the minute sync pick it up." },
  ],
  chosen: "fake-then-sync",
  why:
    "Writing access' table from devnet is a write-boundary violation and no money fact (P4); access chose one flags table " +
    "fed through the PostHog fake (access.gates). Waiting a minute would make the frozen `effective` (the value that " +
    "applies now) false for a minute. Running the one sync keeps the production path the only path. The table is " +
    "Organization-tenanted (P8) with a cross-tenant index for the fake's flag list. Only Organization gates: the frozen " +
    "command refuses a missing `--org` with CLI_USAGE, so a person gate (beta-access) is not scriptable by it.",
  source: by("blueprint/access/decisions.ts (access.gates); apps/docs/factory/operations/dev.gates.set.yaml; docs/as-is/archive/operations/devnet.ts:679-730"),
  affects: [table_scripted_gates, rpc_devnet_gates_script, rpc_devnet_gates_read, flow_devnet_gates_set, ops.operation_dev_gates_set, integration_posthog],
});

export const decision_devnet_scripted_prices = defineDecision({
  id: "devnet.scripted-prices",
  title: "Scripted rates feed the Chainlink fake, dated when they take effect",
  question: "How does a scripted rate reach the books' one price writer, and what does a pair read before any script?",
  options: [
    {
      label: "fake-dated",
      text:
        "The Chainlink fake answers the scripted row in force at the backend's now, dated the later of its start and when " +
        "it was set; with none, the frozen defaults. The flow runs books.prices.sync once.",
    },
    { label: "forked-feed", text: "As the shared fake said: with no script, the forked feed at the pinned block." },
  ],
  chosen: "fake-dated",
  why:
    "The frozen notes are the surface (P10): every asset has a default rate until set (USDC and USDT 1.00, EURC 1.08, " +
    "WETH 3,000, WBTC 60,000), and a set rate is used for money facts written after it, while written facts keep theirs. " +
    "Books keeps a round keyed by its update time and skips a kept one; dating a scripted round by when it took effect " +
    "makes a replaced rate a new round and never back-dates one before facts already written. A forked Base Sepolia feed " +
    "is not those defaults, so the chainlink fake's text in shared/external.ts now says so. On a frozen clock a rate " +
    "replaced at the instant it was set takes effect at that same instant, so its round's time equals the replaced " +
    "round's: the fake gives it the next round id, and books' price history (keyed by pair and time today) must keep " +
    "the later round for an equal time rather than skip it (time.read-once: no key rests on an instant alone).",
  source: by("apps/docs/factory/operations/dev.prices.set.yaml (notes); blueprint/books/processes.ts (books.prices.sync); blueprint/books/decisions.ts"),
  affects: [table_scripted_prices, rpc_devnet_prices_script, flow_devnet_prices_set, ops.operation_dev_prices_set, integration_chainlink],
});

export const decision_devnet_jobs = defineDecision({
  id: "devnet.jobs",
  title: "`dev jobs run` runs P3's crons once and wakes the due timers",
  question: "What are the backend's jobs in the target, and how does a devnet run them now?",
  options: [
    {
      label: "engine",
      text:
        "The crons P3 keeps (each another concept's singleton workflow) and every durable timer due at now; one rpc asks " +
        "the engine for one run of each, waits for them and reports each by name.",
    },
    { label: "as-is", text: "Port old operator.jobs.run and shift, which moved Convex's scheduled functions by the warp." },
  ],
  chosen: "engine",
  why:
    "P3 leaves six crons (Bridge catch-up, prices, flags, the client-grant sweep, the daily agreement notices, the " +
    "added-token scan) and gives every other wait to a process's own timer, which the runtime keeps as an instant on the " +
    "one clock (time.durable-timers); on a devnet that clock is the supervisor's, so after a warp the due timers are due, " +
    "and nothing needs shifting (old shift goes). A warp no longer calls it: the warp's barrier runs the crons and " +
    "timers that fell due, each at its own instant (devnet.warp-barrier), so `dev jobs run` is the explicit 'every cron " +
    "now'. The rpc names the workflows by id because the schema has no link from an rpc to a workflow; it writes no " +
    "table of theirs. `only` serves the gates and prices flows. A failed job is WORK_DIED naming it, as the frozen " +
    "mistake says, after the others finish. Each manual run has its own execution id (`cron/<name>/manual/<request " +
    "id>`, time.durable-timers): keyed by the instant alone, a second `dev prices set` at one frozen instant would " +
    "find the first one's run and sync nothing. Revised by the time design, 8 November 2026.",
  source: by("docs/as-is/archive/operator/jobs.ts; docs/decisions/policy-pack.md#p3; apps/docs/factory/operations/dev.jobs.run.yaml"),
  affects: [rpc_devnet_jobs_run, ops.operation_dev_jobs_run, flow_devnet_gates_set, flow_devnet_prices_set],
});

export const decision_devnet_supervisor_owns_time_and_worlds = defineDecision({
  id: "devnet.supervisor-owns-time-and-worlds",
  title: "The supervisor is the devnet's one time authority, and it keeps the worlds",
  question:
    "Old warps set an offset over the wall through the deployment's admin API, Anvil's clock ran on with the wall, and " +
    "worlds were imported with the Convex CLI. Who holds the devnet's now, how does everything else follow it, and who " +
    "keeps the worlds?",
  options: [
    {
      label: "authority",
      text:
        "The supervisor's time authority holds the devnet's one clock: now, its mode (running or frozen), its rate and " +
        "next stop (devnet.clock-rate, devnet.running-stops), a version that " +
        "rises with every change, the world's epoch and whether the story has begun. Its now is the chain's block time: " +
        "the supervisor is the chain's only miner and mines every block at now (devnet.only-miner). Everything else " +
        "follows it through the time protocol (devnet.time-protocol) as a follower (devnet.followers): the backend's " +
        "devnet Now layer, and with it the workflow engine's timers and crons, the mail sink and the fakes; Ponder, whose " +
        "rows carry the blocks' times; the bundler, paymaster and Bridge stand-ins; and any outside program. The " +
        "supervisor also saves and restores worlds, with their clock, on this machine's disk, and keeps a shared world's " +
        "seasons beside its grants, outside the snapshots, running each on its real clock (devnet.seasons). The SDK's " +
        "devnet flows call devnet-control only.",
    },
    { label: "offset", text: "Keep a backend clock offset over the wall that the supervisor sets beside the chain, as the old devnet did." },
    { label: "backend-rows", text: "A devnet clock table and snapshot rpcs on the backend, which the flows call." },
  ],
  chosen: "authority",
  why:
    "One instant set in one place is the same for the chain and for everything else only if nothing else runs its own " +
    "clock: an offset over a moving wall is close to the chain's time, never equal, which is why the old devnet needed " +
    "'agree within two seconds' and vending-bench took the earlier of two clocks. The supervisor runs every component, " +
    "so it is the one place that can move them together, stop at each due instant, and stop and restore them for a world. " +
    "A world is the whole of Postgres, so its catalog cannot live inside it. Clock rpcs only the supervisor called would " +
    "be unreached (P2). Old operator.clocks.read and jobs.shift are not ported: timeRead reads the clock, and timers kept " +
    "as instants need no shift. Revised in place by the time design on 8 November 2026 (time.one-clock): the two clocks " +
    "and the backend's offset became one authority.",
  source: TIME(`${OLD_WORLD}/README.md (invariants); docs/as-is/archive/operations/devnet.ts:1-40, :295-430; ${BENCH}/devnet-world.ts:542`),
  affects: [...SUPERVISOR_FLOWS, ...TIME_OPS, component_devnet, environment_devnet, integration_devnet_control, concept_devnet],
});

export const decision_devnet_only_miner = defineDecision({
  id: "devnet.only-miner",
  title: "The supervisor is the chain's only miner, and every block is mined at now",
  question: "Anvil keeps its own clock, which runs with the wall between blocks and mines a block per transaction. How is a block's time made the devnet's now?",
  options: [
    {
      label: "only-miner",
      text:
        "Anvil runs with automine off. The supervisor watches its pending transactions and mines each batch at once with " +
        "evm_mine at now (to the second), and pins Anvil's own time to now at every clock change, so an eth_call or a gas " +
        "estimate at `pending` sees now as block.timestamp. On a frozen clock every move ends with the head at now: a " +
        "stop of a warp or step, a start-at, a freeze that moved now and a restore each end by mining an empty block at " +
        "now when nothing else was mined at that second, so `latest` reads now and chain-rpc reads at `latest` on every " +
        "environment, with no devnet branch. A stop opens with the head at its second: when the head is earlier, the " +
        "authority mines an empty block at the stop's instant before it sends the stop event, so a timer for a deadline " +
        "the chain enforces finds the head at its due second (time.chain-judged-deadlines) and waits inside the stop only " +
        "for Ponder; a running clock's stops do the same (devnet.running-stops). A stop's cascade (a timer's transaction, then the one its indexed fact " +
        "wakes, then the empty blocks of devnet.mine-to-depth) mines several blocks in one second, which the pinned " +
        "Anvil must accept (B0 measures it). If it does not, the authority ticks now forward one second before such a " +
        "block (a `tick` event to every follower), which keeps time forward but carries a stop's later work past its " +
        "instant: the warp's due instants (time.due-fires-once) and a frozen story's repeatability " +
        "(time.frozen-deterministic) then hold only for stops that mine once, and B3 records how mining is made " +
        "deterministic before anything relies on them.",
    },
    { label: "automine", text: "Keep automine and set Anvil's time before each warp, letting it run with the wall in between." },
  ],
  chosen: "only-miner",
  why:
    "With automine, every transaction's block takes Anvil's own clock, which moves with the wall: on a frozen devnet a " +
    "day-old story would mine at today's time, and a payment's block time would disagree with the backend's row. Mining " +
    "on demand costs a millisecond or two over automine and batches concurrent transactions as a real chain does. A " +
    "head left behind now after a stop that mined nothing would make every contract view that computes from " +
    "block.timestamp read the past at `latest` (Agreements' released pay, Budgets' period, Governor.state), and reading " +
    "at `pending` only on a devnet is a branch staging never runs. The tick cannot be the quiet fallback it looked: how " +
    "many ticks a stop takes depends on how its transactions happen to batch, which is timing, not the story. Revised " +
    "by the time review, 8 November 2026. Revised again by the world-clock pass, 8 November 2026: a stop that mined its " +
    "head block only at its end left a chain-judged timer, which fires as the stop opens, a block short of its second, " +
    "so it re-armed past its own instant; on a quiet running devnet nothing mined at all, so it re-armed for ever." + " Review, 11 November 2026: The surviving rule (The supervisor is the chain's only miner, and every block is mined at now) still applies. Removed subjects in its historical evidence are not restored; devnet.lean-world; devnet.site-follows-world; devnet.snapshot-of-a-world governs their replacement.",
  source: TIME(`${OLD_WORLD}/README.md (Anvil's clock moves with the wall); ${OLD_WORLD}/service.ts:240-270, :493`),
  affects: [component_devnet, environment_devnet, integration_chain_rpc, flow_devnet_time_warp, flow_devnet_time_start_at, flow_devnet_time_step],
});

export const decision_devnet_mine_to_depth = defineDecision({
  id: "devnet.mine-to-depth",
  title: "A stop mines empty blocks until its last transaction is twice the finality depth",
  question:
    "The supervisor mines only when something is pending, so no block follows a quiet one. Readers that wait for a fact " +
    "to be k blocks deep (payments settle at the deployment's finality depth and confirm at twice it, approvals land at " +
    "it, books' added-token scan stops k below the head) would wait forever on a frozen devnet, and the warp's barrier " +
    "would settle with those payments unsettled. How do depth waits end on a devnet?",
  options: [
    {
      label: "mine-to-depth",
      text:
        "Whatever depth k the devnet's deployment sets, each stop (and each settle) ends by mining empty blocks at now " +
        "until the newest block that carries a transaction is 2k deep, the depth of payments' confirm read; with k = 0 " +
        "it mines none. The blocks are part of the stop's settle rounds, so every depth wait ends inside the stop that " +
        "mined its fact. A scripted reorg (`capxul-devnet chain`) replaces blocks within that depth, as on staging.",
    },
    { label: "zero", text: "Set the devnet's finality depth to 0, so a fact is final in the block that mined it." },
    { label: "interval", text: "Mine an empty block every second of now, as a real chain does." },
  ],
  chosen: "mine-to-depth",
  why:
    "A depth of 0 would make payments' confirm read at twice the depth happen at once, so K12 (a reorg reverses what it " +
    "removed) could never be shown on a devnet. An empty block a second would mine 31.5 million blocks for a simulated " +
    "year, each one Ponder must index. Mining to depth inside the stop costs 2k empty blocks per stop that carried a " +
    "transaction, keeps whatever depth staging's code reads, and leaves the depth itself to the deployment's config " +
    "(environment_devnet names it)." + " Review, 11 November 2026: The surviving rule (A stop mines empty blocks until its last transaction is twice the finality depth) still applies. Removed subjects in its historical evidence are not restored; devnet.lean-world; devnet.site-follows-world; devnet.snapshot-of-a-world governs their replacement.",
  source: TIME("blueprint/payments/decisions.ts (payments.reorg: confirm at twice the depth); blueprint/indexing/decisions.ts (indexing.reorgs-are-ponders); blueprint/books/processes.ts:49"),
  affects: [component_devnet, environment_devnet, integration_indexer, flow_devnet_time_warp, flow_devnet_time_step, flow_devnet_time_settle],
});

export const decision_devnet_clock_modes = defineDecision({
  id: "devnet.clock-modes",
  title: "The clock runs or stands still; evals, worlds and simulations stand it still",
  question: "Should the devnet's now run on with real time between moves, or move only when someone moves it?",
  options: [
    {
      label: "both",
      text:
        "Both, as the clock's mode. Running: now runs on at the clock's rate (one by default, devnet.clock-rate) from " +
        "where it was last set, standing at each due instant on the way (devnet.running-stops), which `capxul-devnet " +
        "up` starts with for a person at the keyboard (a code expires, a timer fires on its own). Frozen: now moves only " +
        "by a warp, a step, a start-at, a restore or a tick, which the eval devnet, the world builder and any simulation " +
        "use. freeze and resume switch modes without moving now back. A warp keeps the mode and the rate.",
    },
    { label: "running-only", text: "Always running, with warps on top, as the old devnet was." },
    { label: "frozen-only", text: "Always frozen: time moves only by calls." },
  ],
  chosen: "both",
  why:
    "A running clock is what a developer expects; a frozen one is what makes a story repeatable: with it, the same calls " +
    "give the same instants, so worlds, eval outputs and a simulated year can be compared run to run " +
    "(time.frozen-deterministic). Vending-bench's bridge had to skip a warp when the running chain had already passed " +
    "the engine's minute; frozen, the minute is exactly where it was left. Frozen-only would make a person warp to see a " +
    "sign-in code expire.",
  source: TIME(`${BENCH}/devnet-world.ts:542-548 (the chain's clock runs with the wall); ${BENCH}/clock.ts; worlds.ts (people-with-keys)`),
  affects: [...TIME_FLOWS, component_devnet, environment_devnet],
});

export const decision_devnet_warp_barrier = defineDecision({
  id: "devnet.warp-barrier",
  title: "A warp is a barrier that stops at every due instant on the way",
  question:
    "A warp moved the clocks, mined one block at the target and then ran every cron once and shifted the scheduler, so a dated payment due on day 10 of a 28-day warp ran on day 28, and the caller polled until things looked done. What does a warp promise when it returns?",
  options: [
  {
    "label": "current-scope",
    "text": "Warp visits each due instant through target T in order and waits for timers, scheduled real-site jobs, outbox delivery, pending chain transactions, configured finality and reader wake routing to settle. jobs=false skips scheduled jobs without skipping timers. Serialize moves, fail a nonsettling stop visibly and preserve the last settled time; folded-in readers and real sites replace Ponder sidecars and stand-in heads without weakening the barrier."
  },
  {
    "label": "historical",
    "text": "The former answer to devnet.warp-barrier is preserved in docs/cut-archive/decision-review-history.json as historical evidence, not implementation authority."
  }
],
  chosen: "current-scope",
  why:
    "Review, 11 November 2026: Warp visits each due instant through target T in order and waits for timers, scheduled real-site jobs, outbox delivery, pending chain transactions, configured finality and reader wake routing to settle. jobs=false skips scheduled jobs without skipping timers. Serialize moves, fail a nonsettling stop visibly and preserve the last settled time; folded-in readers and real sites replace Ponder sidecars and stand-in heads without weakening the barrier. Authority: devnet.lean-world; devnet.site-follows-world; devnet.snapshot-of-a-world.",
  source: "The coordinator, round 2, m1-old-decisions; devnet.lean-world; devnet.site-follows-world; devnet.snapshot-of-a-world",
  affects: [flow_devnet_time_warp, flow_devnet_time_step, flow_devnet_time_settle, worldOps.operation_world_clock_warp, rpc_devnet_jobs_run, integration_devnet_control, component_devnet],
});

export const decision_devnet_time_protocol = defineDecision({
  id: "devnet.time-protocol",
  title: "The devnet's clock is a versioned HTTP protocol with a typed SDK client",
  question: "People build on Capxul and drive its time from outside, from TypeScript, Python or a shell. What interface do they get, and what may change under them?",
  options: [
    {
      label: "http-v1",
      text:
        "`capxul.devnet/1`, HTTP JSON served by the supervisor on loopback with the bearer token from its owner-only " +
        "handoff file, and on its owner-only Unix socket: GET /v1/time; POST /v1/time/warp, /step, /settle, /start-at, " +
        "/freeze, /resume and /rate (devnet.clock-rate); GET /v1/time/events (server-sent events); POST /v1/followers " +
        "with its events, acks and due reports. " +
        "It answers only a loopback Host and no cross-origin request, so a web page on the same machine cannot drive it. " +
        "A shared world serves the same requests over HTTPS at its own address, a world grant as the bearer token, each " +
        "answered by the grant's role (devnet.season-players), and the seasons' requests under /v1/seasons " +
        "(devnet.season-protocol). Every clock it answers carries `realAt`, the authority's " +
        "real time when now held that value, `rate` and `stopAt`, so a running clock's now is min(stopAt, now + rate × " +
        "(real time - realAt)) for every reader, and `realNow`, from which a reader on another machine measures its " +
        "offset (devnet.follow-at-a-rate). One move runs at a time (devnet.warp-barrier). " +
        "Errors are the target's codes in one JSON shape. Every answer names the protocol and its version. There is no " +
        "support window and no parallel version: a change to the protocol fixes every client in the same change and cuts " +
        "everyone over at once (Aaron, 8 November 2026). The Core SDK's devnet entry is the typed client, its types generated from the protocol's " +
        "schema in packages/devnet; `capxul dev time …` and `capxul-devnet time …` are thin clients of it.",
    },
    { label: "sdk-only", text: "Keep the socket's wire contract internal and expose the clock only through the SDK's devnet entry, as the old one did." },
    { label: "json-rpc", text: "Add `capxul_*` methods to the chain's JSON-RPC endpoint." },
  ],
  chosen: "http-v1",
  why:
    "HTTP JSON is reachable from any language with no Capxul code, which vending-bench's Python engine and outside " +
    "builders need, and server-sent events give a subscription with no extra dependency. An SDK-only interface ties " +
    "every builder to TypeScript and to the SDK's release; the chain's endpoint belongs to Anvil and cannot reach the " +
    "backend or the followers. The version in the path and the answer tells a client which protocol it speaks; " +
    "Aaron ruled on 8 November 2026 that there is no support window: every client is fixed and cut over together.",
  source: TIME(`/home/user/factory packages/protocol/src/devnet/control.ts; packages/sdk/src/devnet/index.ts:114-280; ${BENCH}/../README.md`),
  affects: [integration_devnet_control, ...TIME_FLOWS, ...TIME_OPS, component_devnet],
});

export const decision_devnet_followers = defineDecision({
  id: "devnet.followers",
  title: "Followers take the clock, report idle and their next due, and the barrier waits",
  question: "How does each component, and an outside program, follow the clock closely enough that a warp can wait for it?",
  options: [
  {
    "label": "current-scope",
    "text": "Each active follower reports its clock version, idle state and next due instant; the barrier waits for due work, pending chain transactions, chain-reader progress, outbox delivery and wake routing. Lean worlds fold backend and reader into one service; real company sites report scheduled jobs and delivery work. Remove optional-head and hosted-FDE follower requirements. A deliberately held fault counts as idle only for the held work, never for unrelated pending work."
  },
  {
    "label": "historical",
    "text": "The former answer to devnet.followers is preserved in docs/cut-archive/decision-review-history.json as historical evidence, not implementation authority."
  }
],
  chosen: "current-scope",
  why:
    "Review, 11 November 2026: Each active follower reports its clock version, idle state and next due instant; the barrier waits for due work, pending chain transactions, chain-reader progress, outbox delivery and wake routing. Lean worlds fold backend and reader into one service; real company sites report scheduled jobs and delivery work. Remove optional-head and hosted-FDE follower requirements. A deliberately held fault counts as idle only for the held work, never for unrelated pending work. Authority: devnet.lean-world; devnet.site-follows-world; devnet.snapshot-of-a-world.",
  source: "The coordinator, round 2, m1-old-decisions; devnet.lean-world; devnet.site-follows-world; devnet.snapshot-of-a-world",
  affects: [flow_devnet_time_follow, flow_devnet_time_settle, integration_devnet_control, component_devnet, environment_devnet],
});

export const decision_devnet_deterministic_worlds = defineDecision({
  id: "devnet.deterministic-worlds",
  title: "Eval worlds are built at a fixed epoch on a frozen clock",
  question: "A world saved at whatever time its build happened to run gives different dates every rebuild. How are the eval worlds' times fixed?",
  options: [
    {
      label: "epoch-frozen",
      text:
        "The eval devnet boots with `capxul-devnet up --start-at <eval epoch> --frozen`: the epoch is 09:00 UTC on the " +
        "first Monday after the pinned fork block's time, so it is never before a block the fork already has. The world " +
        "builder warps one second before each step and settles after it, and a world's warps are barriers. A world's " +
        "manifest keeps its now and mode, and the harness restores a world frozen. A step that waits on a timer warps " +
        "past it; nothing waits on real time to move the story.",
    },
    { label: "wall", text: "Build at the wall's time, as the old devnet did, and compare times only relative to each other." },
  ],
  chosen: "epoch-frozen",
  why:
    "With a fixed epoch and a frozen clock every time in a world is a function of its steps, so a rebuilt world gives the " +
    "same dates, eval outputs can be compared, and a refusal that depends on a deadline is reached the same way every " +
    "time. One second per step keeps the steps' rows in order by time without depending on how fast the machine is. " +
    "The epoch after the fork block keeps every block's time at or after the fork's.",
  source: TIME("blueprint/devnet/worlds.ts (people-with-keys' clock hold, the warps); blueprint/shared/foundation.ts (devnet: Anvil forking at a pinned block)"),
  affects: [component_devnet, environment_devnet, concept_devnet],
});

export const decision_devnet_sessions_across_warps = defineDecision({
  id: "devnet.sessions-across-warps",
  title: "After a warp past their sessions' end, a world's people sign in again",
  question:
    "Sessions are on now (time.real-elapsed): a person's lasts 30 days. Worlds warp 31 days (org-with-agreements) and " +
    "400 days (org-with-option-active, org-with-sale-offered), then the same people act, and every world built from " +
    "them is used by evals that act as those people. With sessions on the wall the warps signed nobody out; now they " +
    "do. How do a world's people stay signed in?",
  options: [
    {
      label: "sign-in-again",
      text:
        "The world builder signs in again, by the mail sink's code, every person whose CLI-home session a warp step " +
        "ended, right after that step and in the order they first signed in; the person who was current stays current. " +
        "Their old sessions stay ended, as a month would leave them, and the new sign-in mails are part of the world. " +
        "The worlds that warp past 30 days say so in their step. The eval harness does the same after a warp an eval " +
        "itself makes, and an agent's SDK signs its challenge again on the refusal (time.clients-take-server-now).",
    },
    { label: "long-sessions", text: "Give the devnet's sessions a lifetime longer than any world's warps." },
    { label: "wall-sessions", text: "Keep sessions on the wall, as ADR-0041 did, so no warp ends one." },
  ],
  chosen: "sign-in-again",
  why:
    "A longer devnet lifetime would make the devnet's sessions differ from staging's, so the 30-day expiry could not be " +
    "shown, and sessions on the wall are the two clocks the one-clock ruling removes. Signing in again is what a person " +
    "does after a month away, so the world stays one that time passing could leave, and it is deterministic: the code " +
    "comes from the sink at the frozen instant after the warp. Without it, the step after each long warp would be " +
    "refused NOT_AUTHENTICATED and the world would not build.",
  source: TIME("blueprint/access/data.ts (sessions: a person, 30 days; an agent, 24 hours); blueprint/devnet/worlds.ts (warp 31d, warp 400d)"),
  affects: [component_devnet, concept_devnet],
});

export const decision_devnet_start_at = defineDecision({
  id: "devnet.start-at",
  title: "Start-at is a fresh world's one move back; `up --start-at` is its first form",
  question: "Start-at sets the story in the past, the one move back in time. When is a world fresh enough for it, and how does it meet the blocks already mined?",
  options: [
    {
      label: "fresh-once",
      text:
        "A world is fresh until a warp, step or start-at moves its clock (the clock's `moved`, saved with a world, so a " +
        "world saved before the story began can start-at again). `dev time start-at` on a fresh world sets now back for " +
        "every follower, mines a block there and settles: the blocks mined before it (the v4 deployment) keep their later " +
        "times, the one place a devnet's block times go back, before any product row. `capxul-devnet up --start-at` boots " +
        "the stack at the date instead, so nothing is ever mined later than the story; the eval devnet boots that way.",
    },
    { label: "any-time", text: "Allow start-at whenever, moving every row's time back with it." },
  ],
  chosen: "fresh-once",
  why:
    "The frozen page says it runs once, on a fresh devnet, before any warp, and refuses WRONG_STATE once the clock moved. " +
    "Moving back after the story began would put rows later than now, which every expiry and order by time would read " +
    "wrongly. Booting at the date removes even the deployment's later blocks. `dev time start-at` on a running world " +
    "mines a block dated before blocks Ponder has already indexed, and Ponder orders its checkpoints by block time " +
    "first, so B0 checks on the pinned Ponder that every event of such later-mined, earlier-dated blocks is indexed; if " +
    "it is not, start-at is only `up --start-at` (decision record). Added by the time review, 8 November 2026.",
  source: TIME(`${OLD_WORLD}/README.md (start-at); ${OLD_WORLD}/service.ts:417-460; apps/docs/factory/operations/dev.time.start-at.yaml`),
  affects: [flow_devnet_time_start_at, worldOps.operation_world_create, integration_devnet_control, component_devnet],
});

export const decision_devnet_control_refusals = defineDecision({
  id: "devnet.control-refusals",
  title: "The supervisor's refusals follow the frozen pages",
  question: "devnet-control's calls named only INVALID_INPUT beyond the socket's failures, and refused a start-at after a move as INVALID_INPUT. Which codes does the supervisor answer?",
  options: [
    {
      label: "frozen",
      text:
        "snapshotSave: WRONG_STATE for a saved name without replace, INVALID_INPUT for a bad name; snapshotRestore: " +
        "WRONG_STATE for other backend code; timeStartAt (once clockStartAt): INVALID_INPUT for a date not earlier, " +
        "WRONG_STATE once the clock moved. Changed in shared/external.ts.",
    },
    { label: "flow-checks", text: "Keep the calls and make each flow check first (list, compare, then act)." },
  ],
  chosen: "frozen",
  why:
    "The frozen refusals are the surface (P10): save's WRONG_STATE, restore's WRONG_STATE and start-at's WRONG_STATE are " +
    "decided where the state is, in the supervisor, and a check in the SDK before the call would race the call. A refusal " +
    "must be an error the implementation produces (refusal-not-produced), so the integration's failures carry them. Only " +
    "devnet uses devnet-control, so the change touches no other concept. The SDK still refuses a malformed name or date " +
    "before any call, as the old SDK did.",
  source: by("apps/docs/factory/operations/dev.snapshot.save.yaml, dev.snapshot.restore.yaml, dev.time.start-at.yaml (refusals); CONVENTIONS rule 9"),
  affects: [integration_devnet_control, ...SUPERVISOR_FLOWS],
});

export const decision_devnet_supervisor_steps = defineDecision({
  id: "devnet.supervisor-steps",
  title: "A supervisor call is a flow's `cache` step, with the call in `calls`",
  question: "A flow's steps are rpcs or local work of a fixed kind (sign, build, encrypt, wait, poll, prompt, cache). How is a call to the supervisor booked?",
  options: [
    {
      label: "cache",
      text:
        "As a `cache` step (this machine's devnet state), its about naming the devnet-control call, which the flow's " +
        "`calls` lists; the clock's event streams (watch, and a follower's events) are a `poll` step.",
    },
    { label: "wait", text: "As a `wait` step." },
  ],
  chosen: "cache",
  why:
    "`wait` is a person or the chain and is never system time, but a save, a restore and a warp are the developer's " +
    "system time and must count against the budget. The supervisor is local state on this machine behind an owner-only " +
    "handoff, which `cache` describes best, and the flow's `calls` gives the call its span and its failures, so its " +
    "refusals are produced (refusal-not-produced reads `calls`). An event stream is read as it arrives, which `poll` " +
    "names. The time design added the clock's six protocol flows on 8 November 2026.",
  source: by("packages/blueprint-engine/src/records/behaviour.ts (Step kinds); docs/as-is/archive/operations/devnet.ts:212 (snapshot list as a cache step)"),
  affects: SUPERVISOR_FLOWS,
});

export const decision_devnet_approve_as = defineDecision({
  id: "devnet.approve-as",
  title: "`dev approve` signs in by the sink's code and signs with a dev signer",
  question: "The old command signed in with a fixed e2e code and a shared seed. How does the target play another person?",
  options: [
    {
      label: "sink-and-seed",
      text:
        "Reuse a kept session for `--as`, else send a code and read it from the mail sink; read the approval; sign its " +
        "digest with the dev signer derived from the supervisor's handoff seed and the email; give the signature.",
    },
    { label: "fixed-code", text: "Keep a fixed sign-in code that the devnet accepts for anyone." },
  ],
  chosen: "sink-and-seed",
  why:
    "A fixed code is a sign-in bypass in access, which no production concept may carry; the sink already holds every " +
    "code on a devnet (access sends codes there), so the ordinary sign-in works. The approval page's own rpcs (get, then " +
    "sign) do the rest, so the approval's process sends it as for anyone. Without the handoff the dev signers are unknown " +
    "here (a browser run without it signs with a real Openfort test signer): WRONG_ENVIRONMENT, as the frozen mistake says. " +
    "The kept session is not made current, so the eval's current person is unchanged.",
  source: by("docs/as-is/archive/operations/devnet.ts:606-676; blueprint/access/sign-in.ts; blueprint/approvals/signing.ts"),
  affects: [flow_devnet_approve, ops.operation_dev_approve],
});

export const decision_devnet_no_procedures_no_processes = defineDecision({
  id: "devnet.no-procedures-no-processes",
  title: "Devnet has no procedure and no workflow",
  question: "Does devnet's door offer a procedure, and does it own durable work?",
  options: [
    { label: "none", text: "Neither: nothing depends on devnet, it owns no long-lived object and no P3 cron, and the supervisor holds the waiting work." },
    { label: "record-procedures", text: "Procedures for the fakes to record mail and spend faults, and a workflow for warps." },
  ],
  chosen: "none",
  why:
    "A procedure is for another concept's transaction, and no concept may depend on devnet (its tables serve the fakes, " +
    "concepts.devnet). The fakes are layers of the devnet build, not concepts. A warp, a save and a restore are waited on " +
    "by the developer and run in the supervisor; `dev jobs run` runs other concepts' workflows. procedures.ts and " +
    "processes.ts are empty modules that say so.",
  source: by("rules.procedures; rules.durable-processes; concepts.devnet"),
  affects: [concept_devnet],
});

export const decision_devnet_dropped = defineDecision({
  id: "devnet.dropped",
  title: "What of old operator's devnet tools is not ported",
  question: "Which old operator rows land in devnet, and which go?",
  options: [
    {
      label: "lean",
      text:
        "Kept as devnet rpcs: the sink's list and fail switch, the notices read, jobs run. Gone: clocks.read (the " +
        "supervisor's timeRead), jobs.shift (timers kept as instants), outboxes.record (the mail fake), notices.record " +
        "(notices' own), the receipt hold (the bundler's fault switch), and the gates and price rows of access and books.",
    },
    { label: "port-all", text: "Port every operator internal function as a devnet rpc." },
  ],
  chosen: "lean",
  why:
    "Each kept rpc is reached by a frozen operation or a devnet flow (P2). The rest had no caller in the target: the " +
    "supervisor or the fakes now do their work, or another concept owns it. Old proof identities, fixtures and probes are " +
    "dropped by the architecture (responsibilities.operator-proof-tools, concepts.devnet).",
  source: by("docs/as-is/archive/operator/*.ts; shared landings.ts (operator/clocks, jobs, outboxes, notices, receipts)"),
  affects: [concept_devnet, ...RPCS],
});

export const decision_devnet_added_refusals = defineDecision({
  id: "devnet.added-refusals",
  title: "Four refusals the frozen pages do not list",
  question: "Some failures a devnet command can give are not on its page. Which are booked as refusals with a world?",
  options: [
    {
      label: "four",
      text:
        "NOT_AUTHENTICATED for `dev gates set` and `dev prices set` (their `who` is a signed-in person); INVALID_INPUT for " +
        "`dev prices set` on an asset Capxul does not price; WORK_DIED for `dev jobs run` when a job fails (the page's " +
        "mistake).",
    },
    { label: "frozen-only", text: "Only the page's refusals." },
  ],
  chosen: "four",
  why:
    "Each is reachable from a catalogued world and is what the command answers, so an eval should pin it; the frozen " +
    "refusals stay first and word for word. WORK_DIED is reached from bridge-unreachable, where the Bridge catch-up fails.",
  source: by("apps/docs/factory/operations/dev.jobs.run.yaml (mistakes); dev.gates.set.yaml and dev.prices.set.yaml (who)"),
  affects: [ops.operation_dev_gates_set, ops.operation_dev_prices_set, ops.operation_dev_jobs_run],
});

export const decision_devnet_budgets = defineDecision({
  id: "devnet.budgets",
  title: "Class defaults for every devnet record; waits on the supervisor are background",
  question: "Which budget class fits each devnet command?",
  options: [
    {
      label: "defaults",
      text:
        "read for the clock, list and mail reads; write for the scripts, the fail switch, freeze, resume and `dev time " +
        "set`; background " +
        "for jobs run, warp, step, settle, save and restore; live-read for watch and follow; chain-settle for start-at; " +
        "vendor for approve and gates set; chain-read for prices set.",
    },
    { label: "local", text: "A tighter local budget for every supervisor call, as access did for local commands." },
  ],
  chosen: "defaults",
  why:
    "Save, restore and a warp move a whole world or run the crons and wait for them, which the background class (15 s " +
    "p95) covers; start-at mines one block and waits for Ponder, like a settlement. `dev approve` may send a code (Mail) " +
    "and `dev gates set` runs a sync that reads PostHog's fake, so neither can take read or write (budget-class-fit); " +
    "`dev prices set` runs the price sync's feed reads (chain-read). No number leaves its class, so no override needs a " +
    "why.",
  source: by("packages/blueprint-engine/src/budgets.ts; shared external.ts (devnet-control p95s)"),
  affects: [...OPERATIONS, ...RPCS, ...SUPERVISOR_FLOWS, flow_devnet_approve, flow_devnet_gates_set, flow_devnet_prices_set],
});

// ── worlds ──────────────────────────────────────────────────────────────────────────────────

export const decision_devnet_worlds = defineDecision({
  id: "devnet.worlds",
  title: "One catalog of eval worlds, each built by a script of black-box steps",
  question: "The designed concepts' refusals name 78 worlds and their claims and worlds decisions 10 more. How is each built and saved, and where is that written?",
  options: [
    {
      label: "catalog",
      text:
        "devnet/worlds.ts: each world's name, what it holds, the world it starts from (or a fresh devnet), its steps (CLI " +
        "commands, Core SDK methods of surfaces with no command, supervisor controls) and who names it. The supervisor's " +
        "`capxul-devnet world build` restores `from`, runs the steps, saves with `--replace`, in dependency order.",
    },
    { label: "per-eval", text: "Each eval builds its own state from a fresh devnet before it runs." },
    { label: "seed-rows", text: "Seed each world's rows directly in Postgres." },
  ],
  chosen: "catalog",
  why:
    "A world made by running operations is the black-box baseline spec 30 asks for, and restoring it takes seconds where " +
    "rebuilding takes minutes of chain and Bridge time; seeding rows writes other concepts' tables from outside, which " +
    "old operator's fixtures did and no target rule allows. Chaining worlds (`from`) builds each prefix once. A step " +
    "never writes a table: codes come from the mail sink, signatures from `dev approve`. Worlds are rebuilt when the " +
    "backend code changes, since a world saved with other code refuses to restore. `worldGaps` checks every refusal's " +
    "`given` against the catalog; catalogProblems checks its own links. Worlds named only by concepts not yet designed " +
    "join the catalog as they land.",
  source: by("docs/spec/30-capxul-evals.md (worlds); responsibilities.operator-proof-tools; every concept's <concept>.worlds decision"),
  affects: [concept_devnet, component_devnet, environment_devnet, ...OPERATIONS],
});

export const decision_devnet_world_aliases = defineDecision({
  id: "devnet.world-aliases",
  title: "Four names are second names of one snapshot",
  question: "Some concepts named the same state differently. Are those separate snapshots?",
  options: [
    {
      label: "same-as",
      text:
        "No: `signed-out` and budgets' `cli-signed-out` are empty-devnet's state, payments' `person-without-account` is " +
        "person-signed-in's and board's `org-with-setup-awaiting-install` is org-awaiting-founder's; each is saved once " +
        "and listed under both names (`sameAs`).",
    },
    { label: "rename", text: "Ask the owners to rename their refusals' worlds." },
  ],
  chosen: "same-as",
  why:
    "A NOT_AUTHENTICATED refusal needs only no session here, which empty-devnet has; `person-without-account` is a person " +
    "signed in with no admitted account or Safe, which person-signed-in is. Two names for one state cost one link, not a " +
    "build, and leave the owners' records untouched. Budgets may still prefer `signed-out` for one name everywhere.",
  source: by("blueprint/accounts/decisions.ts (accounts.worlds reuses names); budgets.worlds; payments.worlds"),
  affects: [concept_devnet],
});

export const decision_devnet_world_collisions = defineDecision({
  id: "devnet.world-collisions",
  title: "One `org-with-frozen-ceiling`; the Organization money worlds share one tree",
  question: "Budgets and payroll each named `org-with-frozen-ceiling` for a different state, and payments, payroll and requests each invented an Organization with budgets. One name, one snapshot: which?",
  options: [
    {
      label: "one-tree",
      text:
        "Build payroll's org-with-department, payments' org-with-budgets and requests' org-with-requests on budgets' " +
        "org-with-budget-tree, and `org-with-frozen-ceiling` on payroll's org-with-agreements (itself on the tree), frozen " +
        "by a Capxul freeze leaving 10,000, less than the released pay.",
    },
    { label: "split", text: "Two worlds, asking payroll to rename its own to `org-with-agreements-frozen-ceiling`." },
  ],
  chosen: "one-tree",
  why:
    "Every refusal both owners attach to the name is reached from the merged world: budgets' (a token already frozen, a " +
    "non-Director unfreezing, the tree's ceiling reading frozen) need any Capxul freeze, and payroll's (a collection over " +
    "what the ceiling left) needs released pay above what is left. Building payroll's department on the tree also gives " +
    "it EURC with no budget and DAI not admitted, which its TOKEN_NOT_BUDGETED and TOKEN_NOT_SUPPORTED refusals need. One " +
    "cast and tree for the Organization money worlds means one long build instead of four. Contacts', banking's and " +
    "books' Organizations keep their own casts, which their claims name.",
  source: by("blueprint/budgets/operations.ts:69 (W_FROZEN); blueprint/payroll/decisions.ts (payroll.worlds); payments.worlds; requests.worlds"),
  affects: [concept_devnet],
});

export const decision_devnet_fault_switches = defineDecision({
  id: "devnet.fault-switches",
  title: "Fault switches and chain actions are supervisor controls, saved with the world",
  question: "Several worlds hold a failing dependency (Bridge down, a node down, Ponder behind) or a chain fact no Capxul surface makes. How are they made and kept?",
  options: [
  {
    "label": "current-scope",
    "text": "Faults and supervisor actions remain explicit, saved world controls: node errors, indexer lag, Bridge failure, signer/bundler receipt holds, tampered documents and external chain facts. Site failure/replay tests target the real hosted site and plugs delivery, not a stand-in optional head. Mail stays in the world sink and snapshots restore armed faults."
  },
  {
    "label": "historical",
    "text": "The former answer to devnet.fault-switches is preserved in docs/cut-archive/decision-review-history.json as historical evidence, not implementation authority."
  }
],
  chosen: "current-scope",
  why:
    "Review, 11 November 2026: Faults and supervisor actions remain explicit, saved world controls: node errors, indexer lag, Bridge failure, signer/bundler receipt holds, tampered documents and external chain facts. Site failure/replay tests target the real hosted site and plugs delivery, not a stand-in optional head. Mail stays in the world sink and snapshots restore armed faults. Authority: devnet.lean-world; devnet.site-follows-world; devnet.snapshot-of-a-world.",
  source: "The coordinator, round 2, m1-old-decisions; devnet.lean-world; devnet.site-follows-world; devnet.snapshot-of-a-world",
  affects: [component_devnet, environment_devnet, concept_devnet],
});

export const decision_devnet_own_refusal_worlds = defineDecision({
  id: "devnet.own-refusal-worlds",
  title: "Devnet's own refusals reuse catalogued worlds",
  question: "Which worlds do devnet's refusals start from, and does devnet introduce any?",
  options: [
    {
      label: "reuse",
      text:
        "One new, for the shared world: `dev time set`'s ROLE_PERMISSION_DENIED starts from shared-world-joiner " +
        "(devnet.season-players), as every season command's does; the seasons' own refusals start from the season worlds " +
        "(devnet.season-worlds). WRONG_ENVIRONMENT: cli-on-beta-environment. Time, snapshots and mail: empty-devnet; start-at's " +
        "WRONG_STATE: org-with-expired-invitation (built with a warp). Gates: org-ready. Prices: person-signed-in. Approve: " +
        "person-with-payment-history (its expired approval). Jobs' WORK_DIED: bridge-unreachable. Not signed in: signed-out.",
    },
    { label: "own", text: "A devnet world per refusal." },
  ],
  chosen: "reuse",
  why:
    "Each refusal needs a state another concept already builds. Two are a step after the restore, as access' unreadable " +
    "state file is: `dev approve`'s WRONG_ENVIRONMENT removes the devnet's signer handoff, and restore's WRONG_STATE " +
    "rewrites a saved world's manifest to name other backend code (the harness owns the supervisor's store, as it owns " +
    "the CLI home). Save's WRONG_STATE saves under `empty-devnet`, a name that exists.",
  source: by("access.worlds (a step after the restore); every devnet operation's refusals"),
  affects: OPERATIONS,
});

// ── assembly (8 November 2026) ──────────────────────────────────────────────────────────────

const ASSEMBLY = (evidence: string) => `Claude, target assembly (rails-and-reads), 8 November 2026; evidence: ${evidence}`;

export const decision_devnet_equity_worlds = defineDecision({
  id: "devnet.equity-worlds",
  title: "Equity's twelve worlds join the catalog on their own company, Initech",
  question:
    "Equity landed after the catalog: `worldGaps` named eleven worlds its refusals start from, and equity.worlds names a " +
    "twelfth (the held deployment). Which cast are they built on, and how is a held deployment made?",
  options: [
    {
      label: "own-company",
      text:
        "A fresh Initech (founders Nia and Omar, 2 of 2; Ray a member who is no Director; outsider Olga; investors Ivan " +
        "and Jo), then each step of equity's life as a chain of worlds from org-without-equity. The held deployment arms " +
        "a new `service-signer hold-receipt` switch before `org equity setup`.",
    },
    { label: "acme", text: "Build them on Acme's org-with-two-directors." },
  ],
  chosen: "own-company",
  why:
    "equity.worlds asks for two founders who are both Directors, a member who is not one and an outsider, all with ready " +
    "Safes; Acme's two-Director world has a member who never finished signing up, and its budget tree would make every " +
    "equity build pay for the money worlds. Investors need funded Safes of their own for commitments and SAFEs. " +
    "`deployEquity` is sent by Capxul's service key, not the bundler, so its receipt hold is the service signer's " +
    "switch (devnet.fault-switches). Every refusal's `given` now names a catalogued world (`worldGaps` is empty).",
  source: ASSEMBLY("blueprint/equity/operations.ts (WORLDS); equity.worlds; worldGaps(records) over the assembled book"),
  affects: [concept_devnet, component_devnet],
});

export const decision_devnet_open_beta_world = defineDecision({
  id: "devnet.open-beta-world",
  title: "The open beta is a world the supervisor seeds, not a `dev gates set` step",
  question:
    "accounts' `waitlist status` #1 starts from person-on-waitlist-open-beta (the `beta-access` gate on for everyone), " +
    "which the catalog lacked, and `dev gates set` scripts only Organization gates. How is it built?",
  options: [
    {
      label: "supervisor-seed",
      text:
        "From person-on-waitlist: the supervisor seeds the PostHog fake's person gate `beta-access` at rollout 100, then " +
        "`dev jobs run` syncs it into access' flags through the one production path.",
    },
    { label: "widen-command", text: "Let `dev gates set` take a person gate without `--org`." },
  ],
  chosen: "supervisor-seed",
  why:
    "The frozen `dev gates set` refuses a missing `--org` with CLI_USAGE, so widening it would change a frozen refusal " +
    "(P10 rung 1). A supervisor control seeds what no Capxul surface makes, as the fault switches and chain actions do, " +
    "and the sync job keeps access' flags written only by access.",
  source: ASSEMBLY("blueprint/accounts/decisions.ts (accounts.worlds); devnet.scripted-gates; dev.gates.set.yaml (refusal CLI_USAGE)"),
  affects: [concept_devnet, table_scripted_gates, ops.operation_dev_gates_set],
});

// ── target assembly (builder) ───────────────────────────────────────────────────────────────

const BUILDER = (evidence: string) => `Claude, target assembly (builder), 8 November 2026; evidence: ${evidence}`;

export const decision_devnet_straddling_payout_world = defineDecision({
  id: "devnet.straddling-payout-world",
  title: "Reclassify's straddling row is its own world, built on org-with-chart",
  question:
    "Books' reclassify #3 needs a row with money facts on both sides of a period: a bank payout settled on a month's " +
    "last day and returned in the next (books.straddling-row). Books asked for it in org-with-chart. Where is it built?",
  options: [
    { label: "own-world", text: "A new world, org-with-straddling-payout, from org-with-chart: Acme's KYB, a GBP account, a `payouts` budget, a payout on the month's last day, a warp, then the Bridge stand-in's return." },
    { label: "in-org-with-chart", text: "Add the payout and its return to org-with-chart itself." },
  ],
  chosen: "own-world",
  why:
    "Reclassify #1 lists every waiting row of the period and books' list and report lines count org-with-chart's rows, " +
    "so a payout in it would change what those lines see, and its two dependents (the added token, the node down) would " +
    "carry it too. A world of its own adds only what #3 needs. The return is a supervisor control, `capxul-devnet bridge " +
    "return <payout>`, beside `bridge deposits`: the stand-in posts Bridge's return events and sends the refund to the " +
    "Safe, which no Capxul surface makes (devnet.fault-switches).",
  source: BUILDER("blueprint/books/decisions.ts (books.straddling-row); org.books.accounts.reclassify.yaml #3; blueprint/banking/processes.ts (banking.payouts.follow)"),
  affects: [concept_devnet, environment_devnet, integration_devnet_control],
});

import { operation_dev_fund as surface_operation_dev_fund } from "../accounts/operations.ts";

export const decision_devnet_surface_gap_disposition = defineDecision({
  id: "devnet.surface-gap-disposition",
  title: "Record why six tooling operations keep empty frozen acceptance lists",
  question: "May this gap repair invent acceptance lines where the frozen operations have none?",
  options: [{ label: "retain-with-reason", text: "Keep the frozen empty lists and explicitly retain their no-acceptance gaps with reasons." }],
  chosen: "retain-with-reason",
  why:
    "dev.fund, dev.approve, dev.gates.set, dev.jobs.run, dev.mail.list and dev.prices.set each have zero frozen acceptance lines. " +
    "The frozen checker requires equal list lengths, so adding claims here would breach the freeze; neither baseline nor checker is changed. " +
    "These six no-acceptance gaps are intentionally retained, not claimed as tested: fund mints test tokens; approve plays a dev signer; gates scripts a gate; " +
    "jobs runs due work; mail lists the sink; prices scripts a rate. Their returns and refusals remain specified. " +
    "This is the recorded reason allowed by m1-gaps-surface and g2, not a waiver of an eval. It confirms devnet.no-acceptance and accounts.no-acceptance " +
    "without claiming the worlds harness proves an acceptance claim that does not exist. A future acceptance design must first settle how new lines are booked against the freeze.",
  source: "m1-gaps-surface audit, 10 November 2026; blueprint/baseline/operations.ts; packages/blueprint-engine/scripts/check-frozen.ts (acceptance length); devnet.no-acceptance; accounts.no-acceptance",
  affects: [ops.operation_dev_approve, ops.operation_dev_gates_set, ops.operation_dev_jobs_run, ops.operation_dev_mail_list, ops.operation_dev_prices_set, surface_operation_dev_fund],
  stands: [
    { record: "operation:dev.fund", rule: "no-acceptance", why: "Mints test tokens to fund a devnet Safe. Its frozen acceptance list is empty and equal list lengths are required; keep its returns and refusals specified without inventing a funding acceptance claim." },
    { record: "operation:dev.approve", rule: "no-acceptance", why: "Plays another person through the mail sink's sign-in code and a dev signer to sign an approval. Its frozen list has no acceptance claims; preserve that length, not a claim that the worlds harness proves an acceptance eval." },
    { record: "operation:dev.gates.set", rule: "no-acceptance", why: "Scripts an Organization gate through the PostHog fake, syncs once and reads the effective value. The freeze requires keeping its empty acceptance list; its specified returns and refusals do not create a new gate acceptance claim." },
    { record: "operation:dev.jobs.run", rule: "no-acceptance", why: "Explicitly runs crons now and wakes due timers, reporting jobs by name. Its frozen acceptance list is empty and must retain its length; running due work in world setup is not evidence for a nonexistent acceptance claim." },
    { record: "operation:dev.mail.list", rule: "no-acceptance", why: "Reads sent messages from the devnet mail sink, not inbound CRM mail. Keep its frozen empty acceptance list as required by the freeze; the specified return shape and off-devnet refusal remain distinct from acceptance claims." },
    { record: "operation:dev.prices.set", rule: "no-acceptance", why: "Scripts a dated rate in the Chainlink fake and runs the books price sync once. The freeze requires retaining its empty acceptance list; its returns and refusals remain specified without adding a new rate acceptance claim." },
  ],
});

export const decision_devnet_no_acceptance = defineDecision({
  id: "devnet.no-acceptance",
  title: "The dev commands without acceptance lines get none from the design",
  question:
    "Ten devnet commands (dev time, warp, start-at, snapshot save and list, prices set, gates set, approve, jobs run, mail list) " +
    "had no acceptance lines in the old book, so each shows a no-acceptance gap. Should the design write lines for them?",
  options: [
    { label: "none-yet", text: "Write none. Their returns, refusals and spans are still evals, and the harness exercises every one of them when it builds the worlds; new lines need Aaron, as for equity." },
    { label: "write-them", text: "Write acceptance lines for them now, from what the supervisor controls do." },
  ],
  chosen: "none-yet",
  why:
    "An acceptance line is frozen surface (P1), and the frozen book has none here, so a line the design wrote would be a new " +
    "claim on the public surface, which is Aaron's to accept (equity.acceptance makes the same call). Nothing is unchecked " +
    "meanwhile: every eval world is built through these commands (B2), so a broken one fails the harness before any operation's " +
    "eval runs.",
  source: `Claude, handoff to the build, 8 November 2026; evidence: the 35 no-acceptance gaps of the built target book; equity.acceptance`,
  affects: [
    concept_devnet, worldOps.operation_world_show, worldOps.operation_world_clock_warp, worldOps.operation_world_create, worldOps.operation_world_snapshot_save,
    worldOps.operation_world_snapshot_list, ops.operation_dev_prices_set, ops.operation_dev_gates_set, ops.operation_dev_approve,
    ops.operation_dev_jobs_run, ops.operation_dev_mail_list,
  ],
});

export const decision_devnet_beta_world_by_variable = defineDecision({
  id: "devnet.beta-world-by-variable",
  title: "The beta world selects beta by CAPXUL_ENV, not by `use env`",
  question:
    "cli-on-beta-environment was built with `capxul use env beta`, but access's client.use.env refuses CAPABILITY_UNAVAILABLE " +
    "before it saves an environment this machine has no deployment for, so the world cannot be built as written. How does the " +
    "world reach the CAPABILITY_UNAVAILABLE refusals that name it?",
  options: [
    { label: "variable", text: "The world sets CAPXUL_ENV=beta for every command an eval runs in it (a World's env), the way the old CLI resolves a deployment: --env, then CAPXUL_ENV, then the saved choice." },
    { label: "flag", text: "Each refusal's eval passes --env beta itself." },
    { label: "save-anyway", text: "Let `use env` save an environment it has no deployment for." },
  ],
  chosen: "variable",
  why:
    "The old CLI's config (apps/cli/src/runtime/config.ts) reads --env, then CAPXUL_ENV, so a variable is the surface's own " +
    "way to point one invocation at beta without saving anything. A flag in each eval would put the world's state into every " +
    "refusal, and saving an unusable environment would break use env's frozen CAPABILITY_UNAVAILABLE refusal. Found by the " +
    "budgets refusal review.",
  source: `Claude, handoff to the build, 8 November 2026; evidence: blueprint/access/flows.ts (client.use.env); /home/user/factory/apps/cli/src/runtime/config.ts:199-218`,
  affects: [concept_devnet, environment_devnet],
});

// ── the Frappe redesign's devnet asks (assembly, 8 November 2026) ──────────────────────────

const WORLD_GROUP = (evidence: string) => `Claude, assembly (world group), 8 November 2026; evidence: ${evidence}`;

export const decision_devnet_head_warp_stops = defineDecision({
  id: "devnet.head-warp-stops",
  title: "A head's daily-or-slower Frappe jobs are warp stops; faster ones run at stops",
  question:
    "Frappe runs scheduled jobs by a Scheduled Job Type's frequency (All, Hourly, Hourly Long, Hourly Maintenance, Daily, Daily Long, Daily Maintenance, Weekly, Weekly Long, Monthly, Monthly Long, Yearly, Annual, Cron). On a devnet a head follows the one clock (organizations.head-clock). Which of its jobs are stops a warp must halt at, and which merely run?",
  options: [
  {
    "label": "current-scope",
    "text": "A real company site follows its world: daily-or-slower Frappe jobs report next due in site time zone; hourly/faster jobs run at stops rather than making every minute a stop. There is no optional stand-in head reporting no jobs. Barriers must await site job completion."
  },
  {
    "label": "historical",
    "text": "The former answer to devnet.head-warp-stops is preserved in docs/cut-archive/decision-review-history.json as historical evidence, not implementation authority."
  }
],
  chosen: "current-scope",
  why:
    "Review, 11 November 2026: A real company site follows its world: daily-or-slower Frappe jobs report next due in site time zone; hourly/faster jobs run at stops rather than making every minute a stop. There is no optional stand-in head reporting no jobs. Barriers must await site job completion. Authority: devnet.lean-world; devnet.site-follows-world; devnet.snapshot-of-a-world.",
  source: "The coordinator, round 2, m1-old-decisions; devnet.lean-world; devnet.site-follows-world; devnet.snapshot-of-a-world",
  affects: [integration_devnet_control, component_frappe_app, component_devnet],
});

export const decision_devnet_fde_worlds = defineDecision({
  id: "devnet.fde-worlds",
  title: "Every catalogued Organization starts with `--no-fde`; org-with-fde has its FDE",
  question:
    "Since aaron.fde-agent an Organization starts with its Forward Deployed Engineer unless the founder passes " +
    "`--no-fde` (organizations.fde-at-start-up). The catalogued worlds were saved before it. What do their `org " +
    "create` steps run, and which world holds an FDE?",
  options: [
    {
      label: "no-fde-and-one-world",
      text:
        "Every existing `org create` step, the `found` helper's included, passes `--no-fde`, so each world holds what " +
        "it says (no agent of Acme's own, no extra Seat); a new world, org-with-fde, from person-ready, founds Acme " +
        "with its FDE (@acme-fde) by the founder's one install signature.",
    },
    { label: "rewrite", text: "Rebuild every Organization world around its FDE and rewrite the claims that count Seats or agents." },
  ],
  chosen: "no-fde-and-one-world",
  why:
    "organizations.startup-worlds asks exactly this: the worlds are evidence for frozen claims and refusals, such as " +
    "org-with-proposals-gate-off holding no agent of Acme's own so `agent create --org` is refused. org-with-agent " +
    "still makes @acme-bot with `agent create --org`, which by the ruling is Acme's own agent. org-with-fde is built " +
    "from person-ready rather than org-ready, because an FDE is born only by the install batch, never added to a " +
    "finished setup; it serves the FDE's own claims and notices' `fde-ready`.",
  source: WORLD_GROUP("organizations.startup-worlds; organizations.fde-at-start-up; blueprint/devnet/worlds.ts (found)"),
  affects: [operation_org_create, concept_devnet, concept_notices],
});

export const decision_devnet_money_waiting_world = defineDecision({
  id: "devnet.money-waiting-world",
  title: "person-with-money-waiting: a mailbox the money admitted, signed in",
  question:
    "Money waiting in a claim escrow admits its recipient to the beta (aaron.money-waiting-reminders, " +
    "accounts.money-waiting-admits), and notices reminds them on the one clock. Which world proves both?",
  options: [
    {
      label: "new-world",
      text:
        "person-with-money-waiting, from person-with-funded-safe: Dana sends nobody@outside.test 5 USDC and signs it, " +
        "the escrow is indexed (the Payment escrowed, the mailbox admitted `escrow:<payment>`), then " +
        "nobody@outside.test signs in. The gate stays closed and the mailbox never joins the waitlist.",
    },
    { label: "steps-in-the-eval", text: "Each eval sends the payment and signs in itself, from person-with-funded-safe." },
  ],
  chosen: "new-world",
  why:
    "A world is shared by the claims that start from it: `waitlist status` #2 reads `admitted` there, and notices' " +
    "reminders are seen by warping it 3, 10 and 30 days. The builder settles after each step, so the escrow, the " +
    "admission and the money-waiting email have all happened before the sign-in. Never joining the waitlist shows " +
    "the admission is the money's alone (`admit_unlisted`), and a closed gate shows it is not the open beta's.",
  source: WORLD_GROUP("accounts.money-waiting-admits; notices.money-waiting-reminders; blueprint/devnet/worlds.ts (person-with-funded-safe)"),
  affects: [concept_devnet, concept_accounts, concept_notices],
});

export const decision_devnet_payslip_world = defineDecision({
  id: "devnet.payslip-world",
  title: "Archived: org-with-documents also holds a submitted run's payslip, for Kai",
  question:
    "Payroll's runs are Frappe HR's again and every submitted slip stores a payslip (documents.payslip-kind), so documents keeps `document render` #1 word for word, reached in org-with-documents. What does the builder add?",
  options: [
  {
    "label": "current-scope",
    "text": "Archive the Core payroll-command recipe for Kai's Salary Slip. Salary-slip fixtures are created in Frappe HR on the world's real site and saved in its site backup; Core stores only associated chain payment/document evidence."
  },
  {
    "label": "historical",
    "text": "The former answer to devnet.payslip-world is preserved in docs/cut-archive/decision-review-history.json as historical evidence, not implementation authority."
  }
],
  chosen: "current-scope",
  why:
    "Review, 11 November 2026: Archive the Core payroll-command recipe for Kai's Salary Slip. Salary-slip fixtures are created in Frappe HR on the world's real site and saved in its site backup; Core stores only associated chain payment/document evidence. Authority: devnet.lean-world; devnet.site-follows-world; devnet.snapshot-of-a-world.",
  source: "The coordinator, round 2, m1-old-decisions; devnet.lean-world; devnet.site-follows-world; devnet.snapshot-of-a-world",
  affects: [concept_devnet, concept_documents],
});

// ── the commands pass (8 November 2026): the head's and the hosted FDE's worlds ─────────────

const COMMANDS = (evidence: string) => `Claude, organizations commands pass, 8 November 2026; evidence: ${evidence}`;

export const decision_devnet_command_worlds = defineDecision({
  id: "devnet.command-worlds",
  title: "Archived: Six new worlds and a rebuilt org-with-fde for the head and the hosted ",
  question:
    "organizations.command-worlds asks for the worlds its nine new commands start from. Which does the catalogue add, and what changes in org-with-fde now that the FDE is hosted?",
  options: [
  {
    "label": "current-scope",
    "text": "Archive org-with-head/FDE hosting/allowance command fixtures. Every full world uses real hosted company sites on the bench; site-down is a delivery-failure case. Parked hosted FDE billing or payment fixtures are not prerequisites for current world commands."
  },
  {
    "label": "historical",
    "text": "The former answer to devnet.command-worlds is preserved in docs/cut-archive/decision-review-history.json as historical evidence, not implementation authority."
  }
],
  chosen: "current-scope",
  why:
    "Review, 11 November 2026: Archive org-with-head/FDE hosting/allowance command fixtures. Every full world uses real hosted company sites on the bench; site-down is a delivery-failure case. Parked hosted FDE billing or payment fixtures are not prerequisites for current world commands. Authority: devnet.lean-world; devnet.site-follows-world; devnet.snapshot-of-a-world.",
  source: "The coordinator, round 2, m1-old-decisions; devnet.lean-world; devnet.site-follows-world; devnet.snapshot-of-a-world",
  affects: [operation_org_seats_show, concept_devnet, concept_organizations],
});

// ── the worlds the commands pass's last bookings start from (8 November 2026, build pass) ─────────

const BUILD_PASS = (evidence: string) => `Claude, commands pass build, 8 November 2026; evidence: ${evidence}`;

export const decision_devnet_commands_pass_worlds = defineDecision({
  id: "devnet.commands-pass-worlds",
  title: "Nine worlds the new commands named, and three worlds rebuilt to build on v4",
  question:
    "The packs booked refusals and claims from worlds the catalogue did not hold (projects, `account collect`, now " +
    "`payment claim`, `org seats " +
    "buy`, `org fde pay`, the department escrow invariant), and three catalogued worlds could not be built on v4 " +
    "(org-with-allowance and org-with-uncapped-allowance named a per-payment cap and a parent with no room; " +
    "org-with-documents made a People-hat wearer a department's holder). What does the catalogue add and change?",
  options: [
    {
      label: "add-and-rebuild",
      text:
        "Add org-with-projects and org-with-projects-chain-unreachable as projects.worlds lists them (with the cancelled " +
        "task Old); person-ready-money-waiting (person-with-money-waiting after the mailbox's person set up and declined " +
        "the collection at setup); org-with-fde-allowance-paused (org-with-fde-allowance warped 32 days); " +
        "org-with-prices-unset (a new supervisor control, `capxul-devnet setting <NAME> --unset`, restarts the backend " +
        "without SEAT_PRICE and FDE_HOSTING_PRICE); org-with-closed-running-costs and org-with-short-company-safe, as " +
        "payments.seat-worlds asks; and org-with-department-escrow-swapped (a `salaries` claim escrow, then its office " +
        "moved from Lead to Plat). Rebuild org-with-allowance as org-with-fde-allowance is built (a Board top budget " +
        "`running-costs` with room, the allowance under it, the payout ceiling, no cap), make org-with-uncapped-allowance " +
        "its second name, and give org-with-documents' `people` a holder of its own, Hana.",
    },
    { label: "gaps", text: "Leave the uncatalogued names as world gaps until a devnet pass designs them." },
  ],
  chosen: "add-and-rebuild",
  why:
    "A refusal or claim is an eval only once a world reaches it, and every one of these names a state built by commands " +
    "alone. The allowance worlds failed the same way the first org-with-fde-allowance did: Budgets.createChildBudget " +
    "refuses a child of a budget with no room, a per-payment cap has no v4 form, and Budgets pays out only within the " +
    "payout ceiling. On v4 no allowance has a cap, so the uncapped world is the same snapshot. ROLE_CONFLICT keeps a " +
    "People-hat wearer from any office, so Dana, who wears it from setup, cannot hold `people`; Dana keeps her payroll " +
    "steps, which need the People hat. A deployment setting is not a CLI variable, so unsetting a price needs the " +
    "supervisor to restart the backend; one world unsets both prices, because both purchases refuse the same way.",
  source: BUILD_PASS(
    "projects.worlds; accounts.collect-any-time; payments.seat-worlds; payments.fde-hosting-purchase; payments.escrow-department-now; budgets.role-conflict-people-hat; Budgets.sol (createChildBudget, _requireRoom)",
  ),
  affects: [concept_devnet, concept_organizations],
});

// ── the world clock (aaron.world-clock, 8 November 2026) ────────────────────────────────────

const WORLD_CLOCK = (evidence: string) => `Claude, world-clock design, 8 November 2026; evidence: ${evidence}`;

export const decision_devnet_clock_rate = defineDecision({
  id: "devnet.clock-rate",
  title: "A running clock has a rate, world seconds per real second, set by `dev time set`",
  question:
    "aaron.world-clock: a shared world may run faster than real time (every real hour moves its clock four), so the clock gains a rate beside frozen and running. How is the rate set and changed, what bounds it, and what keeps it?",
  options: [
  {
    "label": "current-scope",
    "text": "Keep rate as world seconds per real second (1 to 60), preserved by freeze, warp and snapshots; it never changes transport/session elapsed time. Clock moves serialize and shared-world rate changes require the owner. Seasons are parked; lean service and real site jobs, not optional heads, consume rate events."
  },
  {
    "label": "historical",
    "text": "The former answer to devnet.clock-rate is preserved in docs/cut-archive/decision-review-history.json as historical evidence, not implementation authority."
  }
],
  chosen: "current-scope",
  why:
    "Review, 11 November 2026: Keep rate as world seconds per real second (1 to 60), preserved by freeze, warp and snapshots; it never changes transport/session elapsed time. Clock moves serialize and shared-world rate changes require the owner. Seasons are parked; lean service and real site jobs, not optional heads, consume rate events. Authority: devnet.lean-world; devnet.site-follows-world; devnet.snapshot-of-a-world.",
  source: "The coordinator, round 2, m1-old-decisions; devnet.lean-world; devnet.site-follows-world; devnet.snapshot-of-a-world",
  affects: [
    flow_devnet_time_set, worldOps.operation_world_clock_set, flow_devnet_time_show, flow_devnet_time_resume, flow_devnet_time_freeze,
    flow_devnet_snapshots_save, flow_devnet_snapshots_restore, integration_devnet_control, component_devnet, environment_devnet,
    environment_shared_world,
  ],
});

export const decision_devnet_running_stops = defineDecision({
  id: "devnet.running-stops",
  title: "A running clock stops at every due instant it knows, at its rate's pace",
  question:
    "On a running devnet nothing is mined while nothing is pending, so the head trails now, and a timer for a deadline the chain enforces re-arms until the head reaches its second (time.chain-judged-deadlines), which on a quiet running devnet never happens. A timer fires on the pump's next poll with its step reading a now past its due instant, later the faster the clock runs, and a follower computing now between events can run past an instant the authority is about to stop at. How does a running clock, at any rate, keep due work on its instants?",
  options: [
  {
    "label": "current-scope",
    "text": "A running clock caps at the earliest reported due instant, settles the service, chain reader and real site jobs, then resumes at its configured rate. Newly earlier due work lowers the cap; stop limits are real elapsed time and busy followers remain visible. Minute transport polling is not a business-time stop and optional head/FDE syncs do not run."
  },
  {
    "label": "historical",
    "text": "The former answer to devnet.running-stops is preserved in docs/cut-archive/decision-review-history.json as historical evidence, not implementation authority."
  }
],
  chosen: "current-scope",
  why:
    "Review, 11 November 2026: A running clock caps at the earliest reported due instant, settles the service, chain reader and real site jobs, then resumes at its configured rate. Newly earlier due work lowers the cap; stop limits are real elapsed time and busy followers remain visible. Minute transport polling is not a business-time stop and optional head/FDE syncs do not run. Authority: devnet.lean-world; devnet.site-follows-world; devnet.snapshot-of-a-world.",
  source: "The coordinator, round 2, m1-old-decisions; devnet.lean-world; devnet.site-follows-world; devnet.snapshot-of-a-world",
  affects: [
    flow_devnet_time_resume, flow_devnet_time_set, flow_devnet_time_follow, flow_devnet_time_watch, integration_devnet_control,
    integration_chain_rpc, component_devnet, environment_devnet, environment_shared_world,
  ],
});

export const decision_devnet_follow_at_a_rate = defineDecision({
  id: "devnet.follow-at-a-rate",
  title: "At a rate, a follower computes now from the event, capped at the next stop",
  question:
    "With a rate, a follower's now between events is the event's now plus the rate times the real time since. A follower may also be on another machine (a shared world's real head, its FDE host), whose real clock is not the authority's, and some followers are actors that think for real seconds. How does every follower compute one now, never past a stop and never backward, and when does it acknowledge?",
  options: [
  {
    "label": "current-scope",
    "text": "Followers compute running now as min(stopAt, now + rate times elapsed since realAt), frozen now unchanged, never moving backward. Remote followers measure clock offset and report earlier due work immediately. Real sites and the lean service acknowledge due work before the barrier advances; parked hosted-FDE turns and optional stand-in heads are not followers."
  },
  {
    "label": "historical",
    "text": "The former answer to devnet.follow-at-a-rate is preserved in docs/cut-archive/decision-review-history.json as historical evidence, not implementation authority."
  }
],
  chosen: "current-scope",
  why:
    "Review, 11 November 2026: Followers compute running now as min(stopAt, now + rate times elapsed since realAt), frozen now unchanged, never moving backward. Remote followers measure clock offset and report earlier due work immediately. Real sites and the lean service acknowledge due work before the barrier advances; parked hosted-FDE turns and optional stand-in heads are not followers. Authority: devnet.lean-world; devnet.site-follows-world; devnet.snapshot-of-a-world.",
  source: "The coordinator, round 2, m1-old-decisions; devnet.lean-world; devnet.site-follows-world; devnet.snapshot-of-a-world",
  affects: [flow_devnet_time_follow, flow_devnet_time_watch, integration_devnet_control, component_devnet, component_frappe_app, integration_fde_host],
});

export const decision_devnet_site_follows_world = defineDecision({
  id: "devnet.site-follows-world",
  title: "A site follows its world's clock: the app replaces the framework's now",
  question:
    "aaron.world-clock: every company's hosted Frappe site follows its world's clock (a world is one chain with every company on it and one clock). " +
    "How does the Capxul app make a site's now, its jobs and its mail the world's, without forking Frappe by default? On 10 November 2026 the coordinator put the " +
    "options of docs/design/time-deep-dive.md to Aaron: A, the product's own app replaces Frappe's now at runtime, with guard rails; B, a patch to Frappe carried as " +
    "a fork; C, a clock beneath everything, one bench per world; D, no faked time. The coordinator recommended A. Measured there: 629 reads of time through the framework, " +
    "53 direct reads of the machine's clock and 32 reads of the database's clock, in non-test code of Frappe, ERPNext, Frappe HR and Frappe CRM.",
  options: [
    {
      label: "app-replaces-now",
      text:
        "A (study section 7). The Capxul app replaces the framework's now function for every site of a world, keyed by the site's world (`capxul_world` in its config; " +
        "the world's offset is one entry on the bench, so two worlds run at different times on one bench). (1) A scan fails the build when an upgrade of a pinned app adds a " +
        "direct read of the machine's clock; every direct read carries a label: rebound, real on purpose, or world. (2) The direct reads that decide something a person or the " +
        "books would see are pointed at the world's clock: ERPNext's stock freeze by days (stock_ledger_entry.py:475), the service-level agreement's time, the bulk-transaction " +
        "log dates; Frappe HR's interview reminder; the CRM's deal status log; Frappe's unreplied-email window (email_account.py:972, 978). (3) Database reads of the current " +
        "time that compare with stored world dates (held invoices released by `release_date <= CURRENT_DATE`, issue and opportunity auto-close) are replaced by the world's " +
        "time. (4) Log clean-up jobs are off inside worlds (a world is recorded elsewhere). (5) Sessions, caches, locks, tokens and the job queue's own timestamps stay on real " +
        "time on purpose. (6) An advance stops at every midnight, because some jobs fire only on an exact date (Auto Repeat tests equality). (7) A world cannot pass a year end until " +
        "the next fiscal year exists, so creating it is part of advancing. (8) The seam is proposed to Frappe upstream; a fork is carried only if they take it or the scan fails on " +
        "most releases. (9) A bench per world with a clock beneath it (libfaketime or a time namespace) stays available for a world that must be exact. The follower, the mail " +
        "sink and the rate are as the earlier design had them (docs/cut-archive/organizations/rewritten).",
    },
    { label: "fork", text: "B. Patch frappe/utils/data.py in a Capxul fork of Frappe that tracks upstream. Alone it cannot fix ERPNext, Frappe HR or the CRM (separate GPL and AGPL code bases), so it means four forks." },
    { label: "bench-per-world-clock", text: "C. A clock beneath every process (libfaketime or a time namespace), one bench with its own database and Redis per world. The only option that makes everything agree; the heaviest. Kept as the fallback in A (9)." },
    { label: "no-fake-time", text: "D. No faked time: dates are set by the caller. Rejected by the study: it fails aaron.world-clock (everything follows the clock)." },
  ],
  chosen: "app-replaces-now",
  why:
    "Aaron, 10 November 2026, asked to choose between the options, dictated: 'I'm inclined to just go with your recommendation ... I still don't understand what the issue is or I don't really understand the options to be honest. But yeah, I agree with the rest of your recommendations though. I agree with them. Let's just rock with it.' " +
    "He accepted the coordinator's recommendation without claiming to follow the options; the call stays the coordinator's design to defend, and it is open to him to change. " +
    "The study (docs/design/time-deep-dive.md; commit 691a0c6) found the mechanism sound for what people and the books see (dates, postings, periods, accruals, what is due) and not complete: about 20 of the 85 direct reads decide something. " +
    "Frappe ships about weekly, and new direct reads are the main risk, hence the scan. What the clock still cannot do right without a fork or a fake clock beneath Python is time in the database and in libraries (SQL NOW(), Redis expiry, the queue's timestamps, token libraries). " +
    "Tests that make it right: devnet.time-is-right. Evidence in the spike: spikes/skeleton/FINDINGS.md, The door, the recorder and the clock, The clock.",
  source: "Aaron, 10 November 2026, in conversation with the coordinator: accepted the coordinator's recommendation (option A of docs/design/time-deep-dive.md, section 7); evidence: spikes/skeleton/FINDINGS.md, The clock; docs/design/time-deep-dive.md",
  affects: [component_frappe_app, integration_mail, table_mail_messages, component_devnet, environment_devnet, environment_shared_world],
});

export const decision_devnet_time_is_right = defineDecision({
  id: "devnet.time-is-right",
  title: "'Time is right' means six tests, each an eval or a named gap",
  question: "devnet.site-follows-world is settled for option A. What proves that time is right, and which of those proofs exist?",
  options: [
    {
      label: "six-tests",
      text:
        "(1) THE SCAN: no pinned app reads the machine's clock unlabelled; a committed list of every direct read, each labelled rebound, real on purpose or world, equals the scan's " +
        "output per pinned app. GAP: does not exist (the study's T1; its first step, about a day). " +
        "(2) MONTH END: a world from 1 to 31 March with documents posted each day and the month closed; every ledger date equals the world's date and no creation is off by more than a day. " +
        "EXISTS in the spike (Behaviour 7: ledger dates and the chain's block time); passed in its script's 119 of 119 on two new companies on 10 November after a harness fix; the coordinator is re-running it. " +
        "(3) A JUMP ACROSS A FISCAL YEAR with the next year made first; Auto Repeat, accrual and period close happen once per due period. GAP: does not exist (the spike cannot pass 31 December). " +
        "(4) A RESTORE TO AN EARLIER SNAPSHOT: jobs neither lost nor doubled; naming series continue. PARTLY in the spike (Behaviour 9 restores in place: documents, ledger, balance and clock equal; no job counts); the counts are a GAP. " +
        "(5) TWO WORLDS AT DIFFERENT TIMES ON ONE BENCH: the same request to each answers its own date. EXISTS in the spike (Behaviour 9: w2 at 1 June and main at host time); under load from one worker is a GAP. " +
        "(6) A PERSON'S SESSION ACROSS AN ADVANCE: the rule is that a one-day step must not end a signed-in session and a step beyond the session's lifetime (10 days) ends it cleanly with a message; " +
        "agents hold no session (a fresh assertion per call). GAP: the spike saw a session not survive a move and tested nothing else. " +
        "Also gaps: past-world log retention (rows remain), every scheduled job once per period across a 60-day jump, an upgrade rehearsal of tests 1 to 3 before a pin moves. Planned as m1-time-proof.",
    },
  ],
  chosen: "six-tests",
  why:
    "docs/design/time-deep-dive.md, section 6 (T1 to T10). A mistake in a clock shows up as a document dated by the machine while its neighbours are dated by the world, often unnoticed " +
    "until a month end, so each proof is a run, not a review. Tests 2 and 5 are the only ones the spike already answers; the rest are written as gaps so none is mistaken for done.",
  source: "The coordinator, 10 November 2026, on Aaron's delegation of the book; evidence: docs/design/time-deep-dive.md section 6; spikes/skeleton/FINDINGS.md, The clock",
  affects: [component_frappe_app, component_devnet, environment_devnet, environment_shared_world, decision_devnet_site_follows_world],
});

export const decision_devnet_shared_world = defineDecision({
  id: "devnet.shared-world",
  title: "A shared world: a hosted devnet its owner's grantees join, on one clock",
  question:
    "aaron.world-clock names a shared world beside a devnet and staging: self-contained, its clock controlled, possibly " +
    "at a rate. Who may join one, what is shared, and how is it reached?",
  options: [
    {
      label: "owner-grants",
      text:
        "A shared world is a devnet's whole stack on a host the owner chooses, behind the world's gateway at its own " +
        "HTTPS address (environment shared-world). Its owner, who started it (`capxul-devnet up --shared <name>`), holds the owner grant: they move " +
        "the clock and set its rate, save and restore the world, arm faults, script gates and prices, play people (`dev " +
        "approve`) and admit followers. Anyone else joins only by a grant the owner makes for their email " +
        "(`capxul-devnet world grant <email>`): a file the owner hands over outside the world, never by the world's " +
        "mail. It names its holder's mailboxes and carries their dev signers' keys, never the seed, so a joiner signs as " +
        "themselves only (`dev approve --as` anyone else finds no signer: WRONG_ENVIRONMENT, as with no handoff), reads " +
        "only their own mail and notices in the sink, may watch the clock but not follow or move it " +
        "(ROLE_PERMISSION_DENIED), and otherwise uses Capxul as on staging. A follower grant (`world grant --follower " +
        "<name>`, for a real bench or the world's FDE namespace) follows the clock under that name and never moves it. " +
        "`world revoke <email|name>` ends a grant at the gateway. The grants and WORLD_GRANT_KEY stay on the host outside " +
        "the snapshots, so a restore changes no one's access. The gateway refuses a joiner's owner-only devnet call " +
        "(devnet.devnet-only-rpcs), as the supervisor does its own. Shared: one chain, backend, clock and " +
        "rate, mail sink and stand-in WhatsApp, the heads and the FDE namespace. Nothing leaves it: no real email, " +
        "message or Base Sepolia transaction, and Bridge runs only as its local stand-in. A joiner's CLI reaches it by " +
        "CAPXUL_BOOTSTRAP_URL, with CAPXUL_WORLD_GRANT naming its grant file, which the SDK sends with every request; " +
        "the CLI's devnet scope admits a shared world as the devnet build it is (staging and production stay refused). " +
        "Its CLI home stays on its own machine, outside the snapshots: after a restore a joiner signs in again.",
    },
    { label: "open", text: "Anyone with the world's address may join and sign in." },
    { label: "second-staging", text: "Run the shared world as a second staging on Base Sepolia, with the real clock." },
  ],
  chosen: "owner-grants",
  why:
    "A world whose clock one person controls is shared by trust: its people see time jump when the owner warps, and a " +
    "joiner who could follow it could hold every stop for everyone, so moving and following are the owner's. Grants " +
    "by email keep the world closed, as the beta is, and let its people read their sign-in codes from the sink while " +
    "no mail leaves it. Handing each joiner only their own derived keys keeps `dev approve` the owner's. Grants kept " +
    "outside the snapshots keep a restore from re-admitting a revoked joiner, and the gateway's refusal keeps the " +
    "devnet-only rpcs as they are, each `who` naming the owner's grant. The world's people sign with the keys their " +
    "grant carries, and their authority in Capxul is their hats', as anywhere (docs/design/authority.md). An open world " +
    "would let anyone read the sink; Base Sepolia's clock is no one's to control, so a shared world needs its own " +
    "chain. Superseded by aaron.seasons (Aaron, 9 November 2026): a shared world runs in seasons and a joiner plays " +
    "only the seasons its owner names (devnet.seasons, devnet.season-players), which keep this record's owner, grants, " +
    "keys and what is shared.",
  source: WORLD_CLOCK("aaron.world-clock; devnet.approve-as (dev signers from the seed and the email); blueprint/access/flows.ts (CAPXUL_BOOTSTRAP_URL); devnet.devnet-only-rpcs"),
  affects: [
    environment_shared_world, component_devnet, integration_devnet_control, concept_devnet, rpc_devnet_mail_list,
    rpc_devnet_mail_list_notices, flow_devnet_approve, flow_devnet_time_set, flow_devnet_time_follow, worldOps.operation_world_clock_set,
  ],
});

// ── the world pass's build (9 November 2026): its worlds and what the stand-ins serve for them ─────

import { concept_contacts, concept_payments } from "../shared/foundation.ts";

const WORLD_PASS = (evidence: string) => `Claude, world pass build, 9 November 2026; evidence: ${evidence}`;

export const decision_devnet_world_pass_worlds = defineDecision({
  id: "devnet.world-pass-worlds",
  title: "Archived: Twelve worlds for the world pass, and what the stand-ins serve for the",
  question:
    "The world pass booked claims and refusals from twelve worlds the catalogue did not hold (organizations.doc-worlds, contacts.conversation-worlds, payroll.hr-worlds); its document family reaches a head the stand-in did not serve; its FDE acts only under an ask's act-for token; and `payment claim`'s world held one escrow, so one approval collecting several could not be told from one per escrow. What does devnet add?",
  options: [
  {
    "label": "current-scope",
    "text": "Archive the stand-in head document engine and hosted-FDE turn fixtures. Door/HR/Projects behavior is exercised on real Frappe sites backed up with the world; mail stays isolated in the world sink and Bridge/chain faults remain explicit controls. Do not simulate ledger hooks or DocType permissions in a second Core document store."
  },
  {
    "label": "historical",
    "text": "The former answer to devnet.world-pass-worlds is preserved in docs/cut-archive/decision-review-history.json as historical evidence, not implementation authority."
  }
],
  chosen: "current-scope",
  why:
    "Review, 11 November 2026: Archive the stand-in head document engine and hosted-FDE turn fixtures. Door/HR/Projects behavior is exercised on real Frappe sites backed up with the world; mail stays isolated in the world sink and Bridge/chain faults remain explicit controls. Do not simulate ledger hooks or DocType permissions in a second Core document store. Authority: devnet.lean-world; devnet.site-follows-world; devnet.snapshot-of-a-world.",
  source: "The coordinator, round 2, m1-old-decisions; devnet.lean-world; devnet.site-follows-world; devnet.snapshot-of-a-world",
  affects: [
    concept_devnet, concept_organizations, concept_contacts, concept_payments, 
    table_mail_messages, 
    integration_fde_host, component_devnet,
  ],
});

// ── what the dropped seasons left (aaron.seasons-dropped, cut.seasons): a kept decision cites their design's helper ──────────

const SEASONS = (evidence: string) => `Claude, seasons design, 9 November 2026; evidence: ${evidence}`;

export const decision_devnet_stateful_followers = defineDecision({
  id: "devnet.stateful-followers",
  title: "A follower that keeps world state saves and restores it with every world",
  question:
    "A world's snapshot holds the chain, Postgres (every schema, the stand-ins' tables included), Ponder's checkpoint and the clock. A real Frappe bench following the world keeps its site's database on its own host, and the world's FDE namespace keeps its agents' conversations, memory and timers on the FDE host. A restore, and so each season's start and reset, would leave them in another world's state. How do they save and restore with the world?",
  options: [
  {
    "label": "current-scope",
    "text": "A snapshot saves chain, the world's Postgres database (both schemas; aaron.postgres-and-ponder) and every company site backup with files as one world lineage. Restore freezes the clock and restores every manifest component before following resumes, including into another world. Missing required component state refuses before partial restore. Hosted FDE namespaces are parked."
  },
  {
    "label": "historical",
    "text": "The former answer to devnet.stateful-followers is preserved in docs/cut-archive/decision-review-history.json as historical evidence, not implementation authority."
  }
],
  chosen: "current-scope",
  why:
    "Review, 11 November 2026: A snapshot saves chain, the world's Postgres database (both schemas; aaron.postgres-and-ponder) and every company site backup with files as one world lineage. Restore freezes the clock and restores every manifest component before following resumes, including into another world. Missing required component state refuses before partial restore. Hosted FDE namespaces are parked. Authority: devnet.lean-world; devnet.site-follows-world; devnet.snapshot-of-a-world.",
  source: "The coordinator, round 2, m1-old-decisions; devnet.lean-world; devnet.site-follows-world; devnet.snapshot-of-a-world",
  affects: [
    flow_devnet_time_follow, flow_devnet_snapshots_save, flow_devnet_snapshots_restore, worldOps.operation_world_snapshot_save,
    worldOps.operation_world_snapshot_restore, integration_devnet_control, integration_fde_host,
    component_frappe_app, component_devnet,
  ],
});
