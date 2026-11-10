// Devnet's own judgments, one decision record each. The architecture's judgments about devnet are
// in ../shared/decisions.ts (concepts.devnet, components.devnet, environments.devnet,
// operations.dev-mail-notices-in-devnet, responsibilities.operator-proof-tools,
// dependencies.of-devnet).

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

const BY = "Claude, devnet concept design, 8 November 2026";
const by = (evidence: string) => `${BY}; evidence: ${evidence}`;

const HEAD_TABLES = [table_head_sites, table_head_documents, table_head_changes];
const WHATSAPP_TABLES: never[] = [];
const TABLES = [
  table_mail_messages, table_mail_faults, table_scripted_gates, table_scripted_prices, ...HEAD_TABLES, ...WHATSAPP_TABLES,
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
const TIME_OPS = [ops.operation_dev_time, ops.operation_dev_time_warp, ops.operation_dev_time_start_at, ops.operation_dev_time_set];
/** The time design's own evidence (docs/design/time.md). */
const TIME = (evidence: string) => `Claude, time design, 8 November 2026; evidence: ${evidence}`;
const OLD_WORLD = "/home/user/factory packages/devnet/src/modules/world";
const BENCH = "/home/user/factory packages/vending-bench/src";
const OPERATIONS = [
  ops.operation_dev_time, ops.operation_dev_time_warp, ops.operation_dev_time_start_at, ops.operation_dev_snapshot_save,
  ops.operation_dev_snapshot_list, ops.operation_dev_snapshot_restore, ops.operation_dev_prices_set, ops.operation_dev_gates_set,
  ops.operation_dev_approve, ops.operation_dev_jobs_run, ops.operation_dev_mail_list, ops.operation_dev_mail_fail,
  ops.operation_dev_mail_notices, ops.operation_dev_time_set,
];

// ── data ────────────────────────────────────────────────────────────────────────────────────

export const decision_devnet_own_schema = defineDecision({
  id: "devnet.own-schema",
  title: "Devnet's tables live in a `devnet` schema only a devnet migrates",
  question: "Old operator kept its devnet mail, mail faults and test holds in the one production schema, empty everywhere but a devnet. Where do devnet's tables live now?",
  options: [
    { label: "devnet-schema", text: "In Postgres' own `devnet` schema, which only the devnet build of the backend migrates; staging and production never create it." },
    { label: "app-schema", text: "In the `app` schema with every concept's tables, empty off a devnet, as the old schema had them." },
    { label: "supervisor-files", text: "Outside Postgres, in the supervisor's state directory." },
  ],
  chosen: "devnet-schema",
  why:
    "Devnet-only data must never be in the production schema (concepts.devnet, P8's move of test tables). A separate " +
    "schema in the same server keeps it out of every staging migration while one snapshot of the server still carries it " +
    "with the world, so a restored world brings back its mail (the invitation links and codes evals read), its armed " +
    "faults and its scripted gates and rates. Files outside Postgres would need their own save and restore beside the " +
    "database and could drift from it.",
  source: by("docs/as-is/archive/operator/data.ts:1-9 (devnet tables in the production schema); concepts.devnet; environments.devnet"),
  affects: [...TABLES, concept_devnet, environment_devnet],
});

export const decision_devnet_no_machines = defineDecision({
  id: "devnet.no-machines",
  title: "No state machine, so no event",
  question: "Does any devnet table carry a lifecycle that needs a machine and its `<machine>_transitioned` event (P7)?",
  options: [
    {
      label: "none",
      text:
        "None: a message is kept once, a fault is armed and spent, a gate or rate is a value that is replaced, and a " +
        "stand-in head's document keeps Frappe's own docstatus, which Capxul reads through the head's API, never as an event.",
    },
    { label: "fault-machine", text: "A machine on mail faults (armed, spent, cleared) with its event." },
  ],
  chosen: "none",
  why:
    "No row moves through states a reader follows: the sink is append-only, a fault is a counter deleted at zero, and a " +
    "scripted gate's on or off is a setting, not a status. A machine only to send an event would be telemetry booked as " +
    "behaviour (P7's emit-only review), and nothing downstream follows these rows.",
  source: by("docs/decisions/policy-pack.md#p7; docs/as-is/archive/operator/data.ts (only noticeDeliveries had a status, now notices')"),
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
  source: by("books/target/access/decisions.ts (access.gates); apps/docs/factory/operations/dev.gates.set.yaml; docs/as-is/archive/operations/devnet.ts:679-730"),
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
  source: by("apps/docs/factory/operations/dev.prices.set.yaml (notes); books/target/books/processes.ts (books.prices.sync); books/target/books/decisions.ts"),
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
    "so it re-armed past its own instant; on a quiet running devnet nothing mined at all, so it re-armed for ever.",
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
    "(environment_devnet names it).",
  source: TIME("books/target/payments/decisions.ts (payments.reorg: confirm at twice the depth); books/target/indexing/decisions.ts (indexing.reorgs-are-ponders); books/target/books/processes.ts:49"),
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
    "A warp moved the clocks, mined one block at the target and then ran every cron once and shifted the scheduler, so " +
    "a dated payment due on day 10 of a 28-day warp ran on day 28, and the caller polled until things looked done. What " +
    "does a warp promise when it returns?",
  options: [
    {
      label: "stepped-barrier",
      text:
        "A warp from now to T moves through stops, each a whole second (T rounded up), in order. The next stop is " +
        "chosen after each stop settles, as the earliest of every follower's next due instant (the backend's is its " +
        "earliest unfired timer or next hourly-or-slower cron run) and T, so a timer that one stop's work sets for before " +
        "T is a stop too. At each stop the clock stands at that instant: the backend fires what is due and runs it, the " +
        "minute-scale syncs that are due run once, the supervisor mines what is pending at that second and ends with the " +
        "head there (devnet.only-miner, devnet.mine-to-depth), and the authority runs settle rounds. A round is a " +
        "`settle` event (a new version, now unchanged); the stop has settled when, in one round, every follower " +
        "acknowledged it idle, Anvil holds no pending transaction, Ponder has indexed the head (or the block an armed " +
        "indexer hold keeps it at), and nothing was mined and no follower reported busy since the round began; else " +
        "another round runs. A warp returns when the head is at T, the backend reads T, every timer due by T has fired " +
        "once, every calendar cron run due by T has run once and Ponder has indexed the head. `jobs` false skips the " +
        "crons and moves each skipped cron's next run past T, so none runs late; timers still fire. A stop that does not " +
        "settle within its limit (60 s of real time by default) fails the warp WORK_DIED, naming the stop and the busy " +
        "followers, and the clock stays at the last settled stop. One move at a time: a warp, step, settle, start-at, " +
        "freeze, resume or rate change while another runs is WRONG_STATE; reads and watches always answer. A warp whose caller goes " +
        "away stops at its next settled stop. On a running clock the warp holds now at each stop and lets it run on from " +
        "T at its rate; between moves a running clock stops at the same due instants (devnet.running-stops). Step is one " +
        "stop; settle is a stop at now.",
    },
    { label: "jump", text: "Jump to T, mine one block there, then run everything that fell due at T, as before." },
  ],
  chosen: "stepped-barrier",
  why:
    "A warp should leave the world that time passing would have left: a payment dated day 10 settles in a block dated " +
    "day 10 and its book fact is dated day 10, a month's budget period closes at the month's end, and a notice is sent " +
    "the day it is due. The jump made states production can never reach. The barrier also ends the caller's polling: " +
    "when the call returns, its consequences have happened. The minute-scale syncs read an outside system's current " +
    "state, so one run per stop is the same as one per minute; stopping at each of them would make a year 525,600 " +
    "stops. Two calendar crons a day make a year about 730 stops, minutes of work, not seconds, which the barrier " +
    "budget covers for the warps evals use (a day to a month). A list of stops built when the warp starts would miss " +
    "what the work on the way schedules (a dated payment's day-ahead timer, set at the stop that created it), and " +
    "'wait until nothing changes' needs a test that cannot pass in the gap between Ponder indexing a fact and the wake " +
    "it causes: a round whose acknowledgements all postdate its start, with nothing mined meanwhile, is that test. A " +
    "cron skipped but left due would run on the pump's next poll, right after the warp, which is not skipping it. Two " +
    "moves at once would interleave their stops, and a follower that called settle from its own handler would wait on " +
    "itself. Revised by the time review, 8 November 2026.",
  source: TIME(`${OLD_WORLD}/service.ts:465-535; ${BENCH}/devnet-world.ts:123-140 (waitUntil); node_modules/effect/src/testing/TestClock.ts (sleeps woken earliest first)`),
  affects: [flow_devnet_time_warp, flow_devnet_time_step, flow_devnet_time_settle, ops.operation_dev_time_warp, rpc_devnet_jobs_run, integration_devnet_control, component_devnet],
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
      label: "ack",
      text:
        "A follower joins under a name, takes every clock event, and acknowledges each version with whether it is idle " +
        "and its own next due instant (later than now, or none). The built-in followers are the backend (its devnet Now " +
        "layer: at each event it takes the new now and runs its timer and cron pump; it is idle when no due timer is " +
        "unfired; no workflow run or step is executing; the engine's message storage holds nothing deliverable that " +
        "has not been processed (a resume, a deferred's completion, a new execution, a run's retry); its outbox is " +
        "delivered; and its wake router has consumed every row up to the block Ponder has indexed), Ponder (through " +
        "the supervisor: idle when its indexed block is the head), the bundler stand-in (idle when its mempool is empty " +
        "and no bundle is in flight), the paymaster stand-in, the Bridge stand-in (its scheduled answers are its next " +
        "due), each stand-in Frappe head (idle when no ring it sent is unanswered, with no next due: " +
        "devnet.head-stand-in) and the stand-in WhatsApp (idle once every webhook it posted is answered, its earliest " +
        "redelivery its next due: devnet.whatsapp-stand-in). An armed fault switch's held state counts as idle (a held receipt, an indexer hold). An outside program " +
        "joins the same way, so a simulation's own happenings become stops. Running, a follower computes now from the " +
        "event's now, realAt, rate and next stop (devnet.follow-at-a-rate). A follower that misses an " +
        "acknowledgement fails the barrier and is dropped. The backend's follower channel is the runtime's, not an rpc. " +
        "A follower that keeps world state outside the chain and Postgres (a real bench, the world's FDE namespace) joins " +
        "stateful, and saves and restores that state with every world (devnet.stateful-followers).",
    },
    { label: "poll", text: "Each component reads the supervisor's clock on every use, and the warp polls each one's state." },
  ],
  chosen: "ack",
  why:
    "A barrier needs to know that each part has taken the new time and finished what fell due, which only the part can " +
    "say; next due lets the warp stop where something happens instead of at every second. Reading the supervisor on " +
    "every use puts a round trip in every rpc. The backend's follower is runtime plumbing like the outbox relay " +
    "(rules.outbox): booking it as an rpc only the supervisor calls would be unreached (P2). Using the public protocol " +
    "for the built-in followers keeps one path, proven by Capxul's own use. 'No step running and the outbox delivered' " +
    "alone is idle in the gap after a timer's deferred is completed, or an outbox event starts a workflow, and before " +
    "the run begins (Effect's cluster persists the message and only then reads it), and in the gap after Ponder " +
    "indexes a block and before the wake router routes its rows; the barrier would return there with work still to " +
    "come. A follower that timed now from its own receipt of an event would trail the authority by the event's " +
    "delivery, so a block mined at the authority's second could be later than the backend's now. Revised by the time " +
    "review, 8 November 2026.",
  source: TIME(`${BENCH}/bridge.ts:99-107 (warps to each engine minute); ${OLD_WORLD}/../stand-ins/time.ts (DevnetTime); docs/decisions shared rules.outbox`),
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
  source: TIME("books/target/devnet/worlds.ts (people-with-keys' clock hold, the warps); books/target/shared/foundation.ts (devnet: Anvil forking at a pinned block)"),
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
  source: TIME("books/target/access/data.ts (sessions: a person, 30 days; an agent, 24 hours); books/target/devnet/worlds.ts (warp 31d, warp 400d)"),
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
  affects: [flow_devnet_time_start_at, ops.operation_dev_time_start_at, integration_devnet_control, component_devnet],
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
  source: by("packages/book/src/records/behaviour.ts (Step kinds); docs/as-is/archive/operations/devnet.ts:212 (snapshot list as a cache step)"),
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
  source: by("docs/as-is/archive/operations/devnet.ts:606-676; books/target/access/sign-in.ts; books/target/approvals/signing.ts"),
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
        "vendor for approve and gates set; chain-read for prices set. A season's: write for create, change and its warps " +
        "and players; background for start and end, each a restore; read for show and list.",
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
  source: by("packages/book/src/budgets.ts; shared external.ts (devnet-control p95s)"),
  affects: [...OPERATIONS, ...RPCS, ...SUPERVISOR_FLOWS, flow_devnet_approve, flow_devnet_gates_set, flow_devnet_prices_set, ...ops.SEASON_OPERATIONS],
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
  source: by("books/target/accounts/decisions.ts (accounts.worlds reuses names); budgets.worlds; payments.worlds"),
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
  source: by("books/target/budgets/operations.ts:69 (W_FROZEN); books/target/payroll/decisions.ts (payroll.worlds); payments.worlds; requests.worlds"),
  affects: [concept_devnet],
});

export const decision_devnet_fault_switches = defineDecision({
  id: "devnet.fault-switches",
  title: "Fault switches and chain actions are supervisor controls, saved with the world",
  question: "Several worlds hold a failing dependency (Bridge down, a node down, Ponder behind) or a chain fact no Capxul surface makes. How are they made and kept?",
  options: [
    {
      label: "supervisor",
      text:
        "`capxul-devnet fault <switch> <mode>` arms the devnet layers' switches (chain-rpc node-down and garbage-answers, " +
        "bridge fail-all, indexer hold <n>, service-signer refuse-send and hold-receipt, bundler hold-receipt, documents " +
        "tamper) and " +
        "`capxul-devnet chain` and `bridge` make what no Capxul surface makes (a Safe transaction or a Hats ruling " +
        "outside Capxul, an outside transfer, a token, Bridge deposits, a payout's return); a still clock is the clock's " +
        "frozen mode (devnet.clock-modes), not a switch. The armed switches " +
        "are in the world's manifest and re-armed on restore. The mail switch is `dev mail fail`, in Postgres, and so " +
        "is the stand-in Frappe head's (`fault frappe-head down|key-refused|conflict|refuse|replay|clear`, on its site " +
        "row: devnet.head-stand-in), and the stand-in WhatsApp's (`fault whatsapp down|refuse|clear`, on its number's " +
        "row: devnet.whatsapp-stand-in).",
    },
    { label: "devnet-rpcs", text: "A devnet rpc per switch." },
  ],
  chosen: "supervisor",
  why:
    "The switches belong to integration layers and processes the supervisor runs, and outside facts are by definition not " +
    "made by Capxul's operations; rpcs for them would be reached by no operation (P2) and would put eval controls in the " +
    "backend. Saving them with the world makes a world like bridge-unreachable one restore. The old receipt hold is the " +
    "bundler switch (responsibilities.operator-proof-tools). `documents tamper` is the one control that changes stored " +
    "bytes, as disk corruption would, for documents' org-with-tampered-note; it is a fault, never a way to build state.",
  source: by("responsibilities.operator-proof-tools; shared external.ts (fakes and fault switches); the banking, books, budgets, requests, board, documents and applications worlds"),
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
  source: ASSEMBLY("books/target/equity/operations.ts (WORLDS); equity.worlds; worldGaps(records) over the assembled book"),
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
  source: ASSEMBLY("books/target/accounts/decisions.ts (accounts.worlds); devnet.scripted-gates; dev.gates.set.yaml (refusal CLI_USAGE)"),
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
  source: BUILDER("books/target/books/decisions.ts (books.straddling-row); org.books.accounts.reclassify.yaml #3; books/target/banking/processes.ts (banking.payouts.follow)"),
  affects: [concept_devnet, environment_devnet, integration_devnet_control],
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
    concept_devnet, ops.operation_dev_time, ops.operation_dev_time_warp, ops.operation_dev_time_start_at, ops.operation_dev_snapshot_save,
    ops.operation_dev_snapshot_list, ops.operation_dev_prices_set, ops.operation_dev_gates_set, ops.operation_dev_approve,
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
  source: `Claude, handoff to the build, 8 November 2026; evidence: books/target/access/flows.ts (client.use.env); /home/user/factory/apps/cli/src/runtime/config.ts:199-218`,
  affects: [concept_devnet, environment_devnet],
});

// ── the Frappe redesign's devnet asks (assembly, 8 November 2026) ──────────────────────────

const WORLD_GROUP = (evidence: string) => `Claude, assembly (world group), 8 November 2026; evidence: ${evidence}`;

export const decision_devnet_head_stand_in = defineDecision({
  id: "devnet.head-stand-in",
  title: "The stand-in Frappe head serves HTTP from devnet's tables and follows the clock",
  question:
    "Every app concept syncs with a connected head through `frappe-head` (aaron.frappe-head). Evals need a head that " +
    "keeps documents, makes its own users' edits, rings the doorbell, fails on demand and survives a world's save and " +
    "restore, without booting Frappe. What is it, and where is its state?",
  options: [
    {
      label: "supervisor-http-tables",
      text:
        "A supervisor-run site per Organization (`capxul-devnet head up <org>`) speaking the Capxul app's whitelisted " +
        "methods over HTTP on loopback, so the backend's real `FrappeHead` client calls it. Its state is devnet's " +
        "head-sites, head-documents (by DocType and capxul_id) and head-changes (its scripted user's edits, as " +
        "listChanges rows). `capxul-devnet head edit` writes a document and its change, then rings " +
        "`organizations.heads.ring` signed with the site's ring secret. `capxul-devnet fault frappe-head " +
        "down|key-refused|conflict|refuse|replay|clear` arms its switch, kept on its site row. It joins the clock as a " +
        "follower: idle when no ring is in flight, with no next due.",
    },
    { label: "backend-layer", text: "A `FrappeHead` devnet layer inside the backend over the same tables, as the mail fake is." },
    { label: "in-memory", text: "An in-memory double the supervisor serves, its state saved in the world's manifest." },
  ],
  chosen: "supervisor-http-tables",
  why:
    "Served over HTTP, the stand-in exercises the backend's real head client, its timeouts, retries and error mapping " +
    "(PROVIDER_ERROR, ROLE_PERMISSION_DENIED, RATE_LIMITED), where a backend layer would skip them; and a head's ring " +
    "must arrive from outside, through the doorbell route a real Capxul app posts to. In Postgres' devnet schema, a " +
    "world's snapshot carries the head with the concepts' tables, so a restored world's head holds the very documents " +
    "its sync cursors point at (devnet.own-schema); in memory, the manifest and the database could disagree. The fault " +
    "switch sits on the site's row, as the mail switch does, for the same reason. An edit is a supervisor control, not " +
    "a Capxul command: it is the head's own user acting, which no Capxul surface makes (devnet.fault-switches), and a " +
    "devnet rpc for it would be reached by no operation (P2). `conflict`, `refuse` and `replay` exist because the " +
    "syncs' conflict, push-back and skip-what-was-applied paths are their hardest; a real bench with the Capxul app " +
    "still serves an eval that needs Frappe's own validations. Its rows' writer is that stand-in, outside the book's " +
    "records, so each table shows the build's unwritten-table gap, as the mail sink does. For the shared owner: " +
    "frappe-head's `fake` text still says 'in-memory'.",
  source: WORLD_GROUP("books/target/shared/external.ts (frappe-head fake); docs/design/frappe/projects-and-startup.md (section 4); devnet.fault-switches"),
  affects: [...HEAD_TABLES, integration_frappe_head, rpc_organizations_heads_ring, component_devnet, component_frappe_app],
});

export const decision_devnet_head_warp_stops = defineDecision({
  id: "devnet.head-warp-stops",
  title: "A head's daily-or-slower Frappe jobs are warp stops; faster ones run at stops",
  question:
    "Frappe runs scheduled jobs by a Scheduled Job Type's frequency (All, Hourly, Hourly Long, Hourly Maintenance, " +
    "Daily, Daily Long, Daily Maintenance, Weekly, Weekly Long, Monthly, Monthly Long, Yearly, Annual, Cron). On a " +
    "devnet a head follows the one clock (organizations.head-clock). Which of its jobs are stops a warp must halt at, " +
    "and which merely run?",
  options: [
    {
      label: "daily-or-slower",
      text:
        "A followed bench reports as its next due only the next run of a job whose period is a day or more: Daily, " +
        "Daily Long, Daily Maintenance (at the site's own minute offset, as Frappe schedules it), Weekly, Weekly Long, " +
        "Monthly, Monthly Long, Yearly, Annual, or a cron entry of a day or more, at the site's time zone; All, Hourly, " +
        "Hourly Long, Hourly Maintenance and faster crons run once at each stop it reaches, never making one. The " +
        "stand-in runs no Frappe job and reports no next due.",
    },
    { label: "hourly-or-slower", text: "As the backend's own crons: every hourly-or-slower job is a stop too." },
    { label: "none", text: "No head job is a stop; every due job runs at whatever stop comes next." },
  ],
  chosen: "daily-or-slower",
  why:
    "A head's daily jobs are calendar work a simulation must see on the right day: ERPNext's `set_tasks_as_overdue` " +
    "(Daily Maintenance) is Capxul's own timer now (projects.overdue-timer), but a head's other apps (Frappe's " +
    "auto-repeat and ERPNext's subscriptions and asset postings, Daily Maintenance; Frappe HR's earned leave, Daily " +
    "Long) date documents by the day, so a warp past one must stop at it, the Maintenance kind included. Frappe's hourly " +
    "and faster jobs are sweeps (email queues, project status reminders, reposts) whose result at a stop is the same " +
    "whether they ran once or twenty-four times; as stops they would add 8,760 per simulated year per head, against " +
    "the barrier's minutes for a year (devnet.warp-barrier), and the backend's hourly crons are its own few, not a " +
    "whole ERP's. None would leave a dated job to run late, on whatever day the next stop fell. The stand-in has " +
    "nothing scheduled, so a world with a stand-in head stops exactly where it would without one.",
  source: WORLD_GROUP("organizations.head-clock; devnet.warp-barrier; frappe core/doctype/scheduled_job_type (frequency, CRON_MAP); hooks.py scheduler_events (frappe, erpnext, hrms)"),
  affects: [integration_frappe_head, integration_devnet_control, component_frappe_app, component_devnet],
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
  source: WORLD_GROUP("organizations.startup-worlds; organizations.fde-at-start-up; books/target/devnet/worlds.ts (found)"),
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
  source: WORLD_GROUP("accounts.money-waiting-admits; notices.money-waiting-reminders; books/target/devnet/worlds.ts (person-with-funded-safe)"),
  affects: [concept_devnet, concept_accounts, concept_notices],
});

export const decision_devnet_payslip_world = defineDecision({
  id: "devnet.payslip-world",
  title: "org-with-documents also holds a submitted run's payslip, for Kai",
  question:
    "Payroll's runs are Frappe HR's again and every submitted slip stores a payslip (documents.payslip-kind), so " +
    "documents keeps `document render` #1 word for word, reached in org-with-documents. What does the builder add?",
  options: [
    {
      label: "kai",
      text:
        "Kai (kai@acme.test, ready) as an Employee of the `people` department; a Basic earning, a monthly Standard " +
        "structure, an assignment to Kai on a 3,000 base from `people`; a run for this month, created and submitted, " +
        "with payroll's commands (`org hr employee add`, `org payroll component add`, `org payroll structure " +
        "create|assign`, `org payroll run create|submit`).",
    },
    { label: "olga", text: "Make Olga, already paid and under a salary agreement there, the Employee." },
  ],
  chosen: "kai",
  why:
    "A new person keeps each of the world's readers to the one role its claims give them: Olga is the payee of a note, " +
    "an Invoice and an agreement, Lee the member who joined after, Max the stranger, Nia the person with no Party. Kai " +
    "has a Safe and a display name, so the rendered payslip names the employee by name, as the claim needs. The steps " +
    "were first Core SDK methods of a surface with no command; payroll.hr-surface has since booked the commands, so " +
    "they are those commands. The run is submitted, not paid: the payslip is stored at submit.",
  source: WORLD_GROUP("documents.acceptance-rewrites; documents.payslip-kind; books/target/payroll/operations.ts (payroll.hr-surface's commands)"),
  affects: [concept_devnet, concept_documents, concept_payroll],
});

// ── the commands pass (8 November 2026): the head's and the hosted FDE's worlds ─────────────

const COMMANDS = (evidence: string) => `Claude, organizations commands pass, 8 November 2026; evidence: ${evidence}`;

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

export const decision_devnet_command_worlds = defineDecision({
  id: "devnet.command-worlds",
  title: "Six new worlds and a rebuilt org-with-fde for the head and the hosted FDE",
  question:
    "organizations.command-worlds asks for the worlds its nine new commands start from. Which does the catalogue add, " +
    "and what changes in org-with-fde now that the FDE is hosted?",
  options: [
    {
      label: "six-and-rebuild",
      text:
        "org-with-head-site (from org-with-member: `capxul-devnet head up acme --frappe-cloud`, a site hosted as on " +
        "Frappe Cloud, with its key file and team token file), org-with-head (Dana connects it, `--host frappe-cloud`, " +
        "with `--confirm`), org-with-head-site-down (the site's `down` switch), org-with-fde-paused (org-with-fde warped 32 " +
        "days, past its start-up month, then the sessions the warp ended signed in again), org-with-fde-host-down " +
        "(the stand-in host's `down` switch) and org-with-fde-allowance (funded, with a Board top budget " +
        "`running-costs` of 1,000 USDC a month, an allowance `capxul` under it that Dana wears beside the People hat, and " +
        "the payout ceiling set, for `org fde pay` and `org seats buy`). org-with-fde keeps its steps, but its FDE's key is the stand-in host's " +
        "(aaron.fde-hosted), none is on the eval machine, and its hosting runs in its start-up month.",
    },
    { label: "steps-in-evals", text: "No new worlds: each eval connects a site or warps the FDE itself." },
  ],
  chosen: "six-and-rebuild",
  why:
    "Each world is a state several claims and refusals share: a site to connect, a live head, a site that is down, a " +
    "paused FDE, a host that is down, a budget a People-hat wearer may spend. The head is a Frappe Cloud one because only " +
    "a Frappe Cloud host installs an app for Capxul; a self-hosted bench answers `installApp` WRONG_STATE, so `org head app " +
    "add` could never show an app installed there. The head worlds come from org-with-member so Sam (no hat) and Olga (outside) are " +
    "in each. The paused world is reached by the one clock, as org-with-expired-invitation is, so it proves the lapse " +
    "as the hosting's own timers make it; 32 days is past any calendar month. The allowance needs a parent with room in " +
    "its period (the install's company top budget is 0, and Budgets.createChildBudget refuses ChildrenExceedParent) and " +
    "Budgets pays out only within the payout ceiling (the Roles allowance), so the world sets both, as " +
    "org-with-budget-tree does; a per-payment cap has no v4 form. org-with-fde's steps did not change, " +
    "because the founder's command did not: only where its key is made.",
  source: COMMANDS("organizations.command-worlds; organizations.fde-hosting; devnet.sessions-across-warps; books/target/devnet/worlds.ts"),
  affects: [...ORG_NEW_OPERATIONS, operation_org_seats_show, concept_devnet, concept_organizations],
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
    "aaron.world-clock: a shared world may run faster than real time (every real hour moves its clock four), so the " +
    "clock gains a rate beside frozen and running. How is the rate set and changed, what bounds it, and what keeps it?",
  options: [
    {
      label: "rate",
      text:
        "The clock carries `rate`, the seconds of world time that pass in each real second while it runs: a whole number " +
        "from 1 to 60, 1 at `up` unless `capxul-devnet up --rate <n>`. The protocol sets it with `POST /v1/time/rate " +
        "{rate}` (devnet-control's timeRate); its CLI command is `dev time set --rate <n>` (operation dev.time.set, SDK " +
        "method devnet.time.set) and the supervisor's own client, which mirrors `dev time`'s verbs, is `capxul-devnet " +
        "time set --rate <n>`. A change takes effect " +
        "at once: the authority reads now at the change and sends a `rate` event (a new version, now, realAt and the " +
        "rate), so every follower runs on at the new rate from the same instant; nothing moves back and nothing is mined. " +
        "A real hour at rate r moves the world at most r hours, less the moments it stands at stops " +
        "(devnet.running-stops). It is a move: while a warp, step, settle, start-at, freeze or resume runs it is WRONG_STATE, " +
        "a race no saved world holds, so it is not a booked refusal, as the frozen `dev time` commands' is not. A frozen clock " +
        "keeps its rate for when it runs again; freeze, resume and every warp keep it; a saved world keeps its rate with " +
        "its now and mode, and a restore sets it; a season sets it when it starts (devnet.seasons). `dev time` shows it. " +
        "In a shared world only its owner sets it: a joiner's call is ROLE_PERMISSION_DENIED (world shared-world-joiner). A rate " +
        "never changes a warp: a warp moves as far as it is told, at the barrier's pace.",
    },
    { label: "fast-mode", text: "A third mode, `fast`, beside frozen and running, at a fixed multiple." },
    { label: "timed-warps", text: "No standing rate: a program warps an hour every quarter of an hour." },
  ],
  chosen: "rate",
  why:
    "Aaron's ruling aaron.world-clock asks for a world whose clock moves four hours each real hour, beside the frozen " +
    "and running modes. A rate is the one number a running clock lacked: running at rate 1 is the running clock as it " +
    "was, so the modes stay two and every reader computes now one way. A fixed fast mode could not be four for one " +
    "world and ten for another; timed warps would jump, which is what the barrier replaced, and leave the head behind " +
    "between them. The bound protects what still runs on real time (time.real-elapsed): at 60 a Ponder poll of 100 ms " +
    "is six world seconds and a vendor's 2 s p95 two world minutes; past it the story stops reading as time passing, " +
    "and a faster story is a warp, which is a barrier. A rate also shortens in real time everything a person is " +
    "promised on now: at rate 4 a sign-in code's five minutes last 75 real seconds, so a world whose people sign in by " +
    "emailed codes runs at 5 or less. That is its owner's choice, not a refusal. For Aaron: the command (`dev time set " +
    "--rate <n>`, one operation beyond the 215 under rules.new-operations) and the bound of 60. The recommendation " +
    "stands until he answers.",
  source: WORLD_CLOCK("books/target/shared/rulings.ts (aaron.world-clock); books/target/access/decisions.ts (a code lasts five minutes); docs/design/new-commands.md (G3 `set`)"),
  affects: [
    flow_devnet_time_set, ops.operation_dev_time_set, flow_devnet_time_show, flow_devnet_time_resume, flow_devnet_time_freeze,
    flow_devnet_snapshots_save, flow_devnet_snapshots_restore, integration_devnet_control, component_devnet, environment_devnet,
    environment_shared_world,
  ],
});

export const decision_devnet_running_stops = defineDecision({
  id: "devnet.running-stops",
  title: "A running clock stops at every due instant it knows, at its rate's pace",
  question:
    "On a running devnet nothing is mined while nothing is pending, so the head trails now, and a timer for a deadline " +
    "the chain enforces re-arms until the head reaches its second (time.chain-judged-deadlines), which on a quiet " +
    "running devnet never happens. A timer fires on the pump's next poll with its step reading a now past its due " +
    "instant, later the faster the clock runs, and a follower computing now between events can run past an instant the " +
    "authority is about to stop at. How does a running clock, at any rate, keep due work on its instants?",
  options: [
    {
      label: "paced-stops",
      text:
        "A running clock moves through the same stops a warp does, at its rate's pace. Every clock event carries " +
        "`stopAt`, the next stop: the earliest next due any follower reported (the backend's earliest unfired timer or " +
        "next calendar cron run, a head's next daily job, a simulation's next happening), and every follower caps now at " +
        "it (devnet.follow-at-a-rate). When now reaches stopAt the clock stands there (a `stop` event): the head is mined " +
        "to that second, the backend fires what is due, pending transactions and the depth blocks are mined there, and " +
        "settle rounds run, for at most the running stop's limit (5 s of real time by default). Then the clock runs on " +
        "from that instant at its rate (a `run` event naming the next stopAt and, if the limit cut the stop short, the " +
        "followers still busy). A follower that learns of an earlier due between stops reports it at once (`POST " +
        "/v1/followers/<id>/due`) and the authority lowers stopAt with a `due` event. An instant less than one real " +
        "second of running ahead (rate world seconds) is too close to announce before a follower's now could pass it, " +
        "so the authority stops one real second of running ahead instead: the backend's pump fires that timer when now " +
        "reaches it, and the stop brings the head past its second, so a chain-judged timer that re-armed acts there. " +
        "The rate is so a ceiling: now never runs faster, and loses each stop's settle time. The minute-scale syncs run " +
        "on their own schedule on now and are never stops.",
    },
    { label: "free-running", text: "Let a running clock run free at its rate: timers fire on the pump's poll and the head trails, as on staging." },
    { label: "interval-blocks", text: "Mine an empty block every few seconds of world time so the head keeps up." },
  ],
  chosen: "paced-stops",
  why:
    "A world at a rate is a story people and simulations rely on as on a frozen one: a dated payment due at 09:00 " +
    "should settle in a block dated 09:00 with its book fact dated then, whether a warp or the rate brought the clock " +
    "there. Free running makes the lateness grow with the rate (a 250 ms poll is a world second at rate 4) and leaves " +
    "the chain-judged re-arm waiting on a head that never moves, a defect the running devnet had at rate 1 too. " +
    "Interval blocks would mine 43,200 blocks a world day at one every two seconds, each one Ponder indexes and every " +
    "snapshot carries, and still would not put the head at a due second. stopAt in every event lets a follower compute " +
    "now without overrunning a stop, so none ever reads back (time.monotonic), provided a lowered stopAt reaches it " +
    "before its now does: a lead of one world second is 17 ms of real time at rate 60, less than an event's delivery " +
    "to a remote follower, so the lead is a real second of running, whatever the rate. The limit keeps a busy world moving: in " +
    "a shared world people act while the clock stands, and a stop that waited for a quiet round could hold for good; a " +
    "running world is not deterministic anyway (time.frozen-deterministic is the frozen clock's). A cut-short stop is " +
    "reported, never a failure, because no caller waits on it.",
  source: WORLD_CLOCK("books/target/shared/time.ts (time.chain-judged-deadlines: the re-arm); devnet.only-miner (automine off); devnet.warp-barrier"),
  affects: [
    flow_devnet_time_resume, flow_devnet_time_set, flow_devnet_time_follow, flow_devnet_time_watch, integration_devnet_control,
    integration_chain_rpc, component_devnet, environment_devnet, environment_shared_world,
  ],
});

export const decision_devnet_follow_at_a_rate = defineDecision({
  id: "devnet.follow-at-a-rate",
  title: "At a rate, a follower computes now from the event, capped at the next stop",
  question:
    "With a rate, a follower's now between events is the event's now plus the rate times the real time since. A " +
    "follower may also be on another machine (a shared world's real head, its FDE host), whose real clock is not the " +
    "authority's, and some followers are actors that think for real seconds. How does every follower compute one now, " +
    "never past a stop and never backward, and when does it acknowledge?",
  options: [
    {
      label: "capped-formula",
      text:
        "Every clock event and answer carries now, realAt, mode, rate and stopAt. Frozen, now is `now`. Running, now is " +
        "min(stopAt, now + rate × (t − realAt)), t being the follower's real time on the authority's real clock; a stop's " +
        "event has stopAt equal to now, so the clock stands. A follower on the authority's machine reads that clock. One " +
        "elsewhere measures its offset: every answer carries `realNow`, the authority's real time as it answered, and the " +
        "follower takes the offset from a `GET /v1/time` round trip at join and every minute, as NTP does; it never reads " +
        "a now earlier than one it read, holding at the last until the computed now passes it. A follower reports a due " +
        "instant earlier than its last as soon as it learns of it (`POST /v1/followers/<id>/due`), not only in an " +
        "acknowledgement. Machinery (the backend, Ponder, a head's jobs, the stand-ins) acknowledges a stop idle when its " +
        "work is done; an actor (a hosted FDE, a simulation's agent) acknowledges once it has taken the stop's work, not " +
        "when its thinking ends. A simulation that needs its agent's whole turn at one instant runs the clock frozen and " +
        "steps it, as vending-bench does.",
    },
    { label: "receipt", text: "Each follower times now from its own receipt of each event." },
  ],
  chosen: "capped-formula",
  why:
    "One function of one real clock is what makes every reader agree without a round trip per read; with a rate the " +
    "function needs the rate, and with running stops it needs the cap, else a follower would compute a now past the " +
    "instant the authority is about to stand at and then read an earlier one there (time.monotonic). Timing from " +
    "receipt makes a remote follower trail by the delivery time times the rate: 100 ms is 0.4 world seconds at rate 4, " +
    "enough for a head's document to be dated before the block whose fact it records. A measured offset's error is " +
    "half a round trip times the rate: 0.2 world seconds at rate 4 over a 100 ms round trip, but 3 at rate 60. The " +
    "cap keeps it from carrying a follower past a stop and the hold from reading back; between stops a remote " +
    "follower's dates differ from the authority's by it, so a world with a remote follower runs at a rate that keeps " +
    "it under a world second (20 or less at a 100 ms round trip), its owner's choice, as with sign-in codes. A world that waited for every " +
    "FDE's turn would hold everyone's clock for a model's minutes; the FDE is not on the critical path (aaron.fde-anyone).",
  source: WORLD_CLOCK("devnet.followers; devnet.time-protocol (realAt); books/target/shared/rulings.ts (aaron.fde-anyone); /home/user/factory packages/vending-bench/src/bridge.ts:99"),
  affects: [flow_devnet_time_follow, flow_devnet_time_watch, integration_devnet_control, component_devnet, component_frappe_app, integration_fde_host],
});

export const decision_devnet_head_follows_world = defineDecision({
  id: "devnet.head-follows-world",
  title: "A head follows its world's clock through the Capxul app's hooks, no fork",
  question:
    "aaron.world-clock: a connected Frappe head follows the world's clock. Frappe, ERPNext, Frappe HR and Frappe CRM " +
    "read time through Frappe's now_datetime (about 700 calls outside tests, with Frappe's now, nowdate, today, " +
    "getdate() and get_datetime(), which call it); 88 modules of those apps and the WhatsApp app import that function " +
    "by name (develop, 8 November 2026); Frappe's scheduler enqueues a Scheduled Job Type once its next execution is " +
    "not after now_datetime(); its Email Queue sends every head email over the site's own SMTP account; and a few " +
    "modules read the host's clock directly. How does the Capxul app make a head's now, its jobs and its mail the " +
    "world's, on a devnet and across a network, without forking Frappe?",
  options: [
    {
      label: "code-hook",
      text:
        "When its site config names a world (`capxul_world`: the protocol's address and a follower grant, or a devnet's " +
        "handoff file), the Capxul app does five things (docs/design/time.md 7.5). (1) It replaces the code of " +
        "frappe.utils.data.now_datetime, so every module that imported it reads the world's now in the site's zone, by " +
        "the protocol's formula from the clock event cached in Redis (read once per request or job, else at a " +
        "context's first read; with none cached a request answers 503). The module making the replacement is imported " +
        "in every process through the app's before_request, before_job and override_doctype_class (Scheduled Job Type) " +
        "hooks, since Frappe outside developer mode reads hooks from its cache and never imports hooks.py itself. (2) " +
        "The modules whose own host-clock reads decide something (the CRM's deal status log, ERPNext's stock freeze by " +
        "days, its service-level agreement's user time and bulk-transaction log, Frappe HR's interview reminder, " +
        "Frappe's unreplied-email notice and session end) get their datetime and date names rebound to world-clock " +
        "stand-ins; reads that protect or measure stay real; B3 scans the pinned apps so each direct read is rebound " +
        "or named real. (3) `bench --site <site> capxul follow` joins as `head:<site>`, writes each event to the cache, " +
        "enqueues the Scheduled Job Types due at each stop and waits for them, acknowledging with its next " +
        "daily-or-slower job as its next due (devnet.head-warp-stops), and between stops enqueues the due ones every " +
        "world minute, since Frappe's scheduler wakes every 240 real seconds; is_event_due and the job's id keep each " +
        "run to one. (4) Its override_email_send hook hands every email the Email Queue sends to the supervisor " +
        "(`POST /v1/mail`, on the follower grant), which keeps it in the mail sink at the world's now; nothing reaches " +
        "SMTP. (5) Off a world the clock part is not installed; on staging the mail hook sends only to " +
        "MAIL_ALLOWED_RECIPIENTS and raises for any other address.",
    },
    { label: "freezegun", text: "Start freezegun's freeze_time at the world's now around every request and job." },
    { label: "fork", text: "Patch frappe/utils/data.py in a Capxul fork of Frappe." },
  ],
  chosen: "code-hook",
  why:
    "Replacing one function's code reaches every binding of it, the imports by name included, so one seam moves most " +
    "of the head's dates, and aaron.erp-on-capxul asks for no fork. Rebinding the module attribute alone would miss " +
    "every module that imported the name first. Frappe's own tests move time with freezegun " +
    "(frappe/tests/classes/context_managers.py), but freezegun scans every loaded module on each start and freezes " +
    "time.time and the monotonic clock, which Frappe's Redis locks, RQ and its scheduler heartbeat need real, and it " +
    "has no rate; the rebinding in (2) is freezegun's technique kept to the few modules that decide on the host's " +
    "clock. A patch applied only in hooks.py would leave a worker or the scheduler on the host's clock, because Frappe " +
    "reads app hooks from its cache (frappe/__init__.py get_hooks) and imports a hook's own module only when it calls " +
    "it. One cache read per request or job is the head's RequestTime: no network call per date. Waiting for the due " +
    "jobs at a stop lets a warp see a head's daily work on its day, and the follower's world-minute enqueue keeps a " +
    "head's faster jobs on their cadence at any rate. A head's own email (ERPNext's and Frappe HR's notifications, " +
    "its auto email reports) would otherwise leave the world over SMTP, dated at the world's now; the CRM's own " +
    "conversations never go through the head (contacts.conversations-head-sync). A real bench in a shared world " +
    "follows over HTTPS with a follower grant, its offset measured as any remote follower's. The stand-in head " +
    "already follows (devnet.head-stand-in). For component frappe-app's owner: its text should say this.",
  source: WORLD_CLOCK(
    "frappe@1a7ea577 utils/data.py:373, scheduler.py:44, __init__.py:1050, model/document.py:170, email_queue.py:248; direct reads listed in docs/design/time.md 7.5",
  ),
  affects: [component_frappe_app, integration_frappe_head, integration_mail, table_mail_messages, component_devnet, environment_devnet, environment_shared_world],
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
  source: WORLD_CLOCK("aaron.world-clock; devnet.approve-as (dev signers from the seed and the email); books/target/access/flows.ts (CAPXUL_BOOTSTRAP_URL); devnet.devnet-only-rpcs"),
  affects: [
    environment_shared_world, component_devnet, integration_devnet_control, concept_devnet, rpc_devnet_mail_list,
    rpc_devnet_mail_list_notices, flow_devnet_approve, flow_devnet_time_set, flow_devnet_time_follow, ops.operation_dev_time_set,
  ],
});

// ── the world pass's build (9 November 2026): its worlds and what the stand-ins serve for them ─────

import { concept_contacts, concept_payments } from "../shared/foundation.ts";

const WORLD_PASS = (evidence: string) => `Claude, world pass build, 9 November 2026; evidence: ${evidence}`;

export const decision_devnet_world_pass_worlds = defineDecision({
  id: "devnet.world-pass-worlds",
  title: "Twelve worlds for the world pass, and what the stand-ins serve for them",
  question:
    "The world pass booked claims and refusals from twelve worlds the catalogue did not hold (organizations.doc-worlds, " +
    "contacts.conversation-worlds, payroll.hr-worlds); its document family reaches a head the stand-in did not serve; " +
    "its FDE acts only under an ask's act-for token; and `payment claim`'s world held one escrow, so one approval " +
    "collecting several could not be told from one per escrow. What does devnet add?",
  options: [
    {
      label: "catalogue-and-stand-ins",
      text:
        "Twelve worlds, each built with booked commands and supervisor controls: org-with-head-docs, org-with-head-down, " +
        "org-with-fde-member, org-with-fde-guest and org-with-fde-head-docs (organizations); org-with-conversations " +
        "(contacts); org-with-leave, org-with-attendance, org-with-expenses and its budget-used, short-safe and " +
        "chain-unreachable variants (payroll). person-ready-money-waiting gains Sam's 3 USDC escrow before the setup. The " +
        "stand-in head serves `docRead` and `docWrite` over head-documents: Frappe's docstatus rules (submit a draft, " +
        "cancel a submitted one, amend a cancelled one as Frappe names it, `<name>-1` and an amendment's amendment " +
        "`<name>-2`, never delete a submitted one), fixture metas for the DocTypes the claims name (Designation, Job " +
        "Opening, Job Applicant, Training Event and its child Training Event Employee, Leave Application, Expense Claim, " +
        "Employee, Project in ERPNext's projects module, Stock Entry), their role permissions and mandatory fields as the pinned apps' JSON " +
        "gives them, an active Workflow's transitions and roles, ERPNext's ledger hooks, and its applied call ids " +
        "(head-sites.applied_calls, a world day), with a `drop-answer` fault; `head edit` addresses a head-born " +
        "document by its head name. The stand-in host keeps each turn's ask and act-for token, and `capxul-devnet fde " +
        "run <org> [--ask <askId>] -- <command>` sends that token with `--ask`, none without. `mail receive` takes " +
        "`--cc`, `--bcc` and `--references`, its event's `received_for` naming each CRM mailbox among them.",
    },
    { label: "in-eval", text: "Each eval builds its state from the nearest catalogued world." },
  ],
  chosen: "catalogue-and-stand-ins",
  why:
    "Each concept's world decision says what its claims need, and a refusal whose world nobody builds cannot be run: " +
    "worldGaps listed 238 refusals in these twelve. Built with the commands and the stand-ins' controls, each world " +
    "stays a black box (devnet.deterministic-worlds): a head document, an inbound email or message, a check-in at a " +
    "time, is someone acting outside Capxul's commands, so it is a supervisor control or the person's own command. The " +
    "stand-in head answers the family as Frappe would for its fixtures only, so a claim that needs Frappe's own " +
    "validations boots a real bench (devnet.head-stand-in). The host keeps a turn's token after the turn ends so an eval " +
    "sees Capxul's `ended_at`, not the host, end what an ask allows; without `--ask` the FDE acts as itself, which every " +
    "guard refuses, as `org fde pay`'s claim needs. Sam's second escrow makes `payment claim`'s one approval and its " +
    "take-back claim discriminating. org-with-leave warps to the third working day of a month or later, January to " +
    "November, since the eval epoch fixes no month, so its claims' next-month days stay in the year their holidays " +
    "and allocations cover.",
  source: WORLD_PASS("organizations.doc-worlds; contacts.conversation-worlds; payroll.hr-worlds; payments.claim-command; devnet.head-stand-in; devnet.fde-host-stand-in; devnet.mail-sink"),
  affects: [
    concept_devnet, concept_organizations, concept_contacts, concept_payroll, concept_payments, table_head_sites,
    table_head_documents, table_head_changes, table_fde_host_agents, table_mail_messages, integration_frappe_head,
    integration_fde_host, component_devnet,
  ],
});

export const decision_devnet_head_claims_stand_in = defineDecision({
  id: "devnet.head-claims-stand-in",
  title: "What the stand-in head serves for the head group's thicker claims",
  question:
    "The surface pass gave `org head show`, `org head doc submit`, `org head doc amend` and `org head doctype list` new " +
    "claims (organizations.head-claims, organizations.head-fit). They submit and amend Training Events, read a Job " +
    "Opening, list Leave Application and Expense Claim, and read the head while its daily check fails. What must the " +
    "stand-in head and org-with-head-docs give them?",
  options: [
    {
      label: "as-frappe",
      text:
        "As the pinned apps do. The Training Events in org-with-head-docs carry hrms@8816102's mandatory fields " +
        "(event_status, type, location, start_time before end_time, introduction), so a submit or amend through the " +
        "family passes the stand-in's mandatory check. An amendment is named as frappe@1a7ea57's `_set_amended_name` " +
        "does: `Old induction` amends to `Old induction-1`, and an amendment of `Old induction-1` to `Old induction-2`, " +
        "never `Old induction-1-1`. The fixture metas add Training Event Employee (istable, the field `employees`), " +
        "Leave Application and Expense Claim (each submittable, module HR), and keep Job Opening not submittable. While " +
        "`fault frappe-head down` is set, every call fails as an unreachable host, the daily check included, and after " +
        "`clear` the next check succeeds. `drop-answer` covers every family write, submit and amend included, and every " +
        "`capxul-devnet head edit` rings, as booked.",
    },
    { label: "relax", text: "Let the stand-in skip mandatory fields and keep its own amend naming; the claims hold only on the stand-in." },
  ],
  chosen: "as-frappe",
  why:
    "A claim the stand-in passes and a real bench refuses would prove nothing (devnet.head-stand-in): hrms requires " +
    "those six fields on a Training Event and checks the times, so without them the family's submit and amend claims " +
    "would be refused, the earlier submit claim included. Frappe's own naming gives `-2`, which is what the amend claim " +
    "reads. The metas are the DocTypes `org head doctype list`'s claims name. The fault and the ring were already " +
    "booked, so only the record says so.",
  source:
    "Claude, surface pass build, 9 November 2026; evidence: organizations.head-claims; hrms@8816102 training_event.json, " +
    "leave_application.json, expense_claim.json, job_opening.json; frappe@1a7ea57 naming.py `_set_amended_name`",
  affects: [concept_devnet, table_head_documents, table_head_sites, integration_frappe_head, component_devnet],
});

// ── seasons (aaron.seasons, 9 November 2026): a shared world's time runs in seasons, like a game ──────────

const SEASONS = (evidence: string) => `Claude, seasons design, 9 November 2026; evidence: ${evidence}`;
const SEASON_OPS = ops.SEASON_OPERATIONS;
const SEASON_FLOWS = [
  flow_devnet_seasons_create, flow_devnet_seasons_change, flow_devnet_seasons_start, flow_devnet_seasons_end,
  flow_devnet_seasons_cancel, flow_devnet_seasons_show, flow_devnet_seasons_list, flow_devnet_seasons_warps_add, flow_devnet_seasons_warps_remove,
  flow_devnet_seasons_players_add, flow_devnet_seasons_players_remove,
];

export const decision_devnet_seasons = defineDecision({
  id: "devnet.seasons",
  title: "A shared world runs in seasons, each a record the supervisor runs on real time",
  question:
    "aaron.seasons: a shared world runs in seasons, like a game. A season starts from a known world, runs its clock at a " +
    "rate, jumps time on a schedule and ends in a reset, after which the next starts; players join a season. It " +
    "supersedes devnet.shared-world, where a shared world ran open-ended and only its owner moved its clock. What is a " +
    "season, who keeps it, what are its commands, and how does it sit beside the clock's own controls?",
  options: [
    {
      label: "supervisor-record",
      text:
        "A season is a record the world's supervisor keeps on the world's host, outside the world's snapshots, beside " +
        "the grants, so no restore changes it: a name, never reused; `from`, the saved world it starts from; `reset`, the " +
        "saved world its end restores (its own `from` unless another is named, typically the next season's); a rate; a " +
        "real end and an optional real start; a schedule of warps, each by a span or to a world date at a real instant " +
        "(devnet.season-jumps); and its players, emails that hold world grants (devnet.season-players). Its life is " +
        "planned, then running and ended, or cancelled before it runs (`dev season cancel`, or by its real end coming " +
        "before it starts), which touches nothing in the world. Its start (`dev season start`, or at its real start) restores `from` under a new world " +
        "epoch and runs the clock at its rate; its end (`dev season end`, or at its real end) keeps the world as " +
        "`<name>-end` and restores `reset`, frozen, until the next season starts (devnet.season-reset). One season runs " +
        "at a time and planned windows never overlap; the clock names the season it runs (`season`). Its commands, under " +
        "`dev season`: create, change, start, end, cancel, show (the current season), list (paged), warp add|remove and player " +
        "add|remove. The owner's clock controls stay for an unscheduled move (`dev time warp`, `dev time set`, the SDK's " +
        "freeze and resume); a restore or a start-at during a season is refused. A local devnet may run seasons too, " +
        "with no players: everyone on its machine is its owner.",
    },
    { label: "owner-script", text: "No season record: the owner scripts restores, rates and warps with the clock's own commands and a cron on their machine." },
    { label: "season-mode", text: "A third clock mode, `season`, beside frozen and running, with the schedule held in the clock." },
  ],
  chosen: "supervisor-record",
  why:
    "A season's schedule must run when no one is connected: the supervisor runs every component and already holds the " +
    "clock and the worlds, so it is the one place that can jump the world at a real time and reset it at the end; an " +
    "owner's cron dies with their laptop and cannot refuse a restore in the middle of a season. Kept outside the " +
    "snapshots, as the grants are, a season survives the restores that start and end it. Its schedule is on real time " +
    "because players plan their days around it: it relates world time to real time as the rate does, and no product " +
    "decision reads it (time.seasons). A mode would put the real-time schedule into every clock event. A season's jump " +
    "is a warp, the same barrier, so the grammar's verb (G3 has no `jump`) reads it as `dev time warp` scheduled; start, " +
    "end and cancel are the lifecycle's verbs, as in `verify start`, `org payroll agreement end` and `payment cancel`. " +
    "A planned season is cancelled, not ended, as the 215 withdraw an offered agreement rather than end it and cancel " +
    "a scheduled payment: G3 gives each verb one meaning, so `end` always keeps the season's world and resets, and a " +
    "script that meant to drop a planned season that has since started is refused instead of resetting the world. A " +
    "planned season whose real end comes before it starts is cancelled by the supervisor, since it never ran. The list " +
    "is paged as every list is (G5, G9), since a world that runs a season a week gathers dozens a year. Its flags keep G5: the " +
    "starting world is `--snapshot`, the CLI's word for a saved world, since `--from` names only a budget; and a " +
    "scheduled warp takes its span or `--to <date>` as `dev time warp` does, since `--by` is a review date. For Aaron: the season's " +
    "eleven commands (operations beyond the 215, rules.new-operations), that its start, end and jumps are real times, that " +
    "seasons never overlap, and that only the people its owner names play one (devnet.season-players). The " +
    "recommendation stands until he answers.",
  source: SEASONS("aaron.seasons; devnet.shared-world; devnet.supervisor-owns-time-and-worlds; new-commands.md G2, G3; command-surface.md section 9"),
  affects: [...SEASON_OPS, ...SEASON_FLOWS, environment_shared_world, component_devnet, integration_devnet_control, concept_devnet],
});

export const decision_devnet_season_players = defineDecision({
  id: "devnet.season-players",
  title: "A season's players are grantees its owner names, admitted only while it runs",
  question:
    "devnet.shared-world let anyone its owner granted use the world at any time. Now a shared world runs in seasons, and " +
    "players join a season. Who may play, how is a player admitted, and what may a joiner do between seasons or in a " +
    "season they do not play?",
  options: [
    {
      label: "season-admission",
      text:
        "The grants stay as devnet.shared-world made them: the owner grant (moves the clock, saves and restores worlds, " +
        "runs the seasons, arms faults, scripts gates and prices, plays people with `dev approve`); a joiner's grant made " +
        "for an email (`capxul-devnet world grant <email>`), a file handed over outside the world that names its holder's " +
        "mailboxes and carries their dev signers' keys, never the seed; and a follower grant (`world grant --follower " +
        "<name>`) for a real bench or the world's FDE namespace. All stay on the host outside the snapshots, and `world " +
        "revoke` ends one at the gateway. A player is a joiner whose email the owner adds to a season (`--player`, `dev " +
        "season player add`). The gateway admits a joiner's call to the backend, and to the two mail reads scoped to its " +
        "mailboxes, only while a season they play runs and the world is not moving (devnet.season-jumps): between seasons " +
        "it refuses WRONG_STATE, naming the next season and its start; in a season they do not play, " +
        "ROLE_PERMISSION_DENIED. The supervisor's reads (`dev time`, the clock's watch, `dev season show` and `list`) " +
        "answer every grant at any time. A joiner may not move, follow, save or restore the clock, nor run a season " +
        "command but show and list (ROLE_PERMISSION_DENIED). Removing a player closes the gateway to them at once; what " +
        "they made stays in the world. In the world a player signs only as themselves, and their authority is their " +
        "hats', as anywhere. Shared, as before: one chain, backend, clock and rate, mail sink, stand-in WhatsApp, the " +
        "heads and the FDE namespace, and nothing leaves the world. A local devnet has no grants and so no players.",
    },
    { label: "any-grantee", text: "Any grantee plays every season, as devnet.shared-world had it." },
  ],
  chosen: "season-admission",
  why:
    "A game's players are its season's: someone who played the last season need not be in the next, and a season with " +
    "a known cast is one its owner can reason about. Admitting by season at the gateway keeps each grant one file, made " +
    "once, and lets the owner change a season's cast without handing out files again. Between seasons the world is the " +
    "reset world waiting for the next start, which restores its starting world anyway, so a joiner's writes there would " +
    "be lost; refusing them, while every grant can still read the season and the clock, tells a player when to come " +
    "back. The owner and follower grants, the keys and what is shared are devnet.shared-world's, which seasons do not " +
    "change. Who may play is part of devnet.seasons' question.",
  source: SEASONS("aaron.seasons; devnet.shared-world; devnet.devnet-only-rpcs; devnet.approve-as"),
  affects: [
    environment_shared_world, ops.operation_dev_season_player_add, ops.operation_dev_season_player_remove,
    ops.operation_dev_season_show, ops.operation_dev_season_list, flow_devnet_seasons_players_add,
    flow_devnet_seasons_players_remove, rpc_devnet_mail_list, rpc_devnet_mail_list_notices, integration_devnet_control, component_devnet,
  ],
});

export const decision_devnet_season_jumps = defineDecision({
  id: "devnet.season-jumps",
  title: "A season's jumps are warps the supervisor runs at real times, each a barrier",
  question:
    "A season jumps time on a schedule. What is a jump, when does it run, what happens to one that fails " +
    "or falls due while something else moves, and what do the people acting in the world see while it runs?",
  options: [
    {
      label: "scheduled-warps",
      text:
        "A jump is a warp (devnet.warp-barrier) scheduled at a real instant, by a span or to a world date: given with the " +
        "season or by `dev season warp add` (`--every` repeats it each real interval until the season's end, at most " +
        "500), and taken out before it runs by `dev season warp remove`. At its instant, if the season runs, the " +
        "supervisor warps: a barrier through every due instant on the way, so a month's dated payments settle, its " +
        "notices are sent and its periods close on their own days; the clock keeps its mode and rate. One move at a " +
        "time: a jump due while another move runs (the owner's warp; a running stop is not a move) runs when it ends, its " +
        "`ranAt` saying when. A target not later than now is `skipped`. A stop that does not settle within its limit " +
        "fails the jump as it fails a warp (`failed`, naming the stop and the busy followers): the clock stays at the " +
        "last settled stop and the season runs on. The season's end cuts a running jump at its next settled stop " +
        "(`cut`) and skips the rest. While the world moves (a jump, the owner's warp, a season's start or end), the " +
        "gateway refuses a joiner's backend call WRONG_STATE naming the move, and the supervisor's reads answer. A " +
        "supervisor that was down when jumps fell due runs each once, late and in order, when it returns, unless the " +
        "season's end has come too: then they are skipped and the season ends. A jump ends sessions as any warp does " +
        "(devnet.sessions-across-warps): one of 30 days or more ends every person's, so a player signs in again by the " +
        "code the sink holds, and one of a day or more every agent's, which its SDK renews by signing again.",
    },
    { label: "jump-verb", text: "A new verb, `jump`, for a season's scheduled move, apart from `dev time warp`." },
    { label: "hold-calls", text: "Hold a joiner's call at the gateway until the jump ends, instead of refusing it." },
  ],
  chosen: "scheduled-warps",
  why:
    "A season's jump must leave the world that time passing would have left, which the warp barrier promises and a " +
    "jump that moved the clock and caught up after would not. Being a warp, it is spelt as one: the grammar has no " +
    "`jump` (G3), and two words for one move would differ only in who started it. People acting during a barrier keep " +
    "it from settling (a round settles only when nothing was mined and no follower was busy), so a busy shared world " +
    "would fail its own jumps; refusing their calls for the seconds a month takes, with a code that says why, keeps the " +
    "barrier sound and tells the player. Holding the calls would leave a client waiting minutes for a year's jump, past " +
    "its timeout. Running missed jumps on return keeps the world where its schedule says, unless its end has come, after " +
    "which they would move a world about to be reset.",
  source: SEASONS("aaron.seasons; devnet.warp-barrier; devnet.running-stops (people act while the clock stands); new-commands.md G3"),
  affects: [
    ops.operation_dev_season_warp_add, ops.operation_dev_season_warp_remove, flow_devnet_seasons_warps_add,
    flow_devnet_seasons_warps_remove, flow_devnet_time_warp, integration_devnet_control, component_devnet, environment_shared_world,
  ],
});

export const decision_devnet_season_reset = defineDecision({
  id: "devnet.season-reset",
  title: "A season ends by keeping its last world and restoring its reset world",
  question:
    "A season ends in a reset before the next: its starting world again, or a new one for the next " +
    "season. What does the end keep, what does the reset restore, and what does a player find afterwards: their " +
    "sessions, their mail, their money?",
  options: [
    {
      label: "keep-then-restore",
      text:
        "At the end (`dev season end`, or at its real end) the supervisor closes the gateway to the season's players, " +
        "cuts a running jump and skips the rest, freezes the clock, saves the world as `<name>-end` (its last state, each " +
        "stateful follower saving its own: devnet.stateful-followers), then restores the season's reset world, frozen at " +
        "its now under a new world epoch, each stateful follower restoring its own, and leaves it so until the next " +
        "season starts. A planned season is not ended but cancelled (`dev season cancel`), which touches nothing. A start " +
        "restores the season's `from` the same way, then " +
        "runs. While a season runs, a restore or a start-at is WRONG_STATE: end the season first. Everything in the world " +
        "becomes the reset world's, so a player finds: their sessions gone, the world holding only those it was saved " +
        "with, so the CLI home on their own machine holds a token the world does not know, and once a season they play " +
        "runs their first command is NOT_AUTHENTICATED and they sign in again by the code the sink holds for them (an " +
        "agent signs its challenge again, if the world holds it); their mail the reset world's sink, the season's mail " +
        "kept only in `<name>-end`, which only the owner restores; their money the reset world's (every balance, Safe, " +
        "payment, escrow, budget and deposit: the chain, Postgres, Ponder and the stand-ins' tables come back together, " +
        "and nothing real ever moved, on the world's own Anvil with Bridge's stand-in); and their Organizations, " +
        "contacts, CRM, HR and head documents the reset world's too. Their grant and their CLI home stay; a saved `use " +
        "org` naming an Organization the new world lacks is refused until they choose again.",
    },
    { label: "carry-over", text: "Carry each player's account and money from one season into the next." },
    { label: "no-final", text: "Reset without keeping the season's last state." },
  ],
  chosen: "keep-then-restore",
  why:
    "A reset is a game's: everyone starts the next season from the same known world, so what a season earned cannot " +
    "carry, and carrying a player's money would be a second, invented ledger beside the chain's. Keeping the last state " +
    "as a world costs one save and lets the owner look back later, while the reset still happens on time. Closing the " +
    "gateway first means no one acts into a world that is being saved. Sessions, mail and money all follow from one " +
    "rule, that the reset world comes back whole, so a player can predict them; signing in again is what " +
    "devnet.sessions-across-warps already has a world's people do after a long warp. A restore in the middle of a season " +
    "would replace its world under its players, so the season's end is the one way out.",
  source: SEASONS("aaron.seasons; devnet.sessions-across-warps; devnet.own-schema (the devnet tables are in every snapshot); access sessions"),
  affects: [
    ops.operation_dev_season_end, ops.operation_dev_season_cancel, ops.operation_dev_season_start, flow_devnet_seasons_end,
    flow_devnet_seasons_cancel, flow_devnet_seasons_start,
    flow_devnet_snapshots_save, flow_devnet_snapshots_restore, ops.operation_dev_snapshot_restore, ops.operation_dev_time_start_at,
    table_mail_messages, table_head_documents, table_fde_host_agents, integration_devnet_control,
    environment_shared_world,
  ],
});

export const decision_devnet_stateful_followers = defineDecision({
  id: "devnet.stateful-followers",
  title: "A follower that keeps world state saves and restores it with every world",
  question:
    "A world's snapshot holds the chain, Postgres (every schema, the stand-ins' tables included), Ponder's checkpoint " +
    "and the clock. A real Frappe bench following the world keeps its site's database on its own host, and the world's " +
    "FDE namespace keeps its agents' conversations, memory and timers on the FDE host. A restore, and so each season's " +
    "start and reset, would leave them in another world's state. How do they save and restore with the world?",
  options: [
    {
      label: "stateful-follower",
      text:
        "A follower that keeps world state joins `stateful` (devnet.followers). When a world is saved, the authority " +
        "sends a `save` event naming it, and each stateful follower saves its own state under that name before it " +
        "acknowledges: a bench with `bench --site <site> backup --with-files`, which the Capxul app keeps under the " +
        "world's name; the FDE namespace with swarmD's own save of its agents. The world's manifest lists them. When a " +
        "world is restored, the clock frozen at its now, a `restore` event names it, and each restores its own state from " +
        "that name before it acknowledges; the backend and Ponder start only after. A restore while a stateful follower " +
        "is joined that the world's manifest lacks is WRONG_STATE before anything changes, naming it, so a world never " +
        "comes back half restored. A stateful follower that joins later is told the world it must hold and restores it " +
        "before it follows. The stand-ins need none of this: their state is in devnet's tables.",
    },
    { label: "ignore", text: "Leave outside state as it is across restores, and let each follower cope." },
    { label: "forbid", text: "Allow only the stand-ins in a world that restores: no real bench, no hosted FDE." },
  ],
  chosen: "stateful-follower",
  why:
    "The world clock puts a real head and the hosted FDE inside the world, and a season's end resets it: a bench left " +
    "holding last season's documents beside a reset Capxul would answer the document family with records the world no " +
    "longer has, and an FDE would remember conversations that never happened. Refusing a restore that would leave a " +
    "follower behind keeps the world one world. Frappe's own backup and restore hold a site's whole state, so the " +
    "Capxul app needs no fork. For the FDE host's owners and the swarm design: swarmD must save and restore a " +
    "namespace's agents under a name, beside its timers on an outside clock (devnet.fde-host-follows-world).",
  source: SEASONS("devnet.head-follows-world; devnet.fde-host-follows-world; devnet.own-schema; Frappe's bench backup and restore"),
  affects: [
    flow_devnet_time_follow, flow_devnet_snapshots_save, flow_devnet_snapshots_restore, ops.operation_dev_snapshot_save,
    ops.operation_dev_snapshot_restore, integration_devnet_control, integration_frappe_head, integration_fde_host,
    component_frappe_app, component_devnet,
  ],
});

export const decision_devnet_season_protocol = defineDecision({
  id: "devnet.season-protocol",
  title: "The seasons are requests of the devnet protocol, and devnet-control's calls",
  question:
    "The seasons are the supervisor's, so the `dev season` commands reach it through capxul.devnet/1, as `dev time` and " +
    "`dev snapshot` do. Which requests carry them, and how are they booked while the `devnet-control` integration, in " +
    "a shared file, does not list them yet?",
  options: [
    {
      label: "protocol",
      text:
        "Eleven requests of capxul.devnet/1: GET /v1/seasons (seasonList, paged by `after` and `limit`) and " +
        "/v1/seasons/current (seasonCurrent), which answer every grant; POST /v1/seasons (seasonCreate), " +
        "/v1/seasons/<name>/change (seasonChange), /start and /end (seasonStart and seasonEnd, each taking `check` to " +
        "answer what it would do and change nothing), /cancel (seasonCancel), /warps and " +
        "/warps/<id>/remove (seasonWarpAdd, seasonWarpRemove), and /players and /players/<email>/remove (seasonPlayerAdd, " +
        "seasonPlayerRemove), which answer only the owner's grant. Their failures are INVALID_INPUT, WRONG_STATE and " +
        "ROLE_PERMISSION_DENIED as each season flow says, beside the protocol's own (WRONG_ENVIRONMENT, PROVIDER_ERROR). " +
        "The clock read and each clock event carry `season`; the events gain `save`, and `snapshot` names the world on " +
        "a `save` or `restore`. Start and end are barriers the size of a restore (p95 10 s); the rest are clock calls. " +
        "devnet-control lists them as its calls, each season flow names its call, and the supervisor's answers are the " +
        "calls' failures; a flow's own errors are only what the SDK refuses before any call.",
    },
    { label: "rpcs", text: "Backend rpcs over a devnet table of seasons." },
  ],
  chosen: "protocol",
  why:
    "A season lives outside the world's Postgres, which every restore replaces, and its schedule is the supervisor's to " +
    "run, so backend rpcs could neither keep it nor jump the world; the protocol is also how people building on Capxul " +
    "already drive the clock, so a program can run seasons as the CLI does. A check mode lets a preview say exactly what " +
    "will happen, its refusals included, before anyone answers yes. While shared/external.ts did not yet list the calls, " +
    "each season flow kept `calls` empty and listed the supervisor's answers in its own errors, so every refusal stayed " +
    "an eval; the surface pass's build added the eleven calls on 9 November 2026, and the flows now name them.",
  source: SEASONS("devnet.time-protocol; devnet.supervisor-steps; books/target/shared/external.ts (devnet-control); CONVENTIONS.md rule 9"),
  affects: [...SEASON_FLOWS, integration_devnet_control, component_devnet],
});

export const decision_devnet_season_worlds = defineDecision({
  id: "devnet.season-worlds",
  title: "Four worlds for seasons, built by their steps each time they are used",
  question:
    "The season commands' claims and refusals need a shared world with an owner, players and a season in each state. " +
    "Grants and seasons live on the host outside the snapshots, and a running season runs on real time. How are these " +
    "worlds built?",
  options: [
    {
      label: "built-each-time",
      text:
        "shared-world-owner (shared-world-joiner run as the owner, with Dana granted too), season-planned (s1 from " +
        "person-with-funded-safe at rate 4, ending two real hours on, w1 a 30-day warp an hour on, Dana its player), " +
        "season-running (s1 started; Dana signed in from her own CLI home and paid Sam 5 USDC) and season-ended (s1 " +
        "ended: s1-end saved, the world reset). Each is built by its steps on a fresh shared world on the eval machine " +
        "every time an eval uses it, since a restore brings back neither its grants nor its seasons, and a season's real " +
        "times are right only just after they are made. The shared world runs with the eval machine's seed, so each " +
        "person's dev signer is the one their catalogued Safe was set up with, and serves a copy of the eval machine's " +
        "store, made fresh with the world and thrown away with it, so person-with-funded-safe and every catalogued world " +
        "is saved in it and nothing a season saves there reaches another eval (an `s1-end` left in the store would refuse " +
        "the next `dev season create s1`, WRONG_STATE). A player's command runs from that player's " +
        "own CLI home, which the harness keeps outside the snapshots as their machine would be; the owner's from the eval " +
        "machine's. These are the catalog's only worlds whose clock runs, so their claims say 'about' where real seconds " +
        "count.",
    },
    { label: "frozen-only", text: "Build the season worlds frozen and have every season command run on a frozen clock in the evals." },
  ],
  chosen: "built-each-time",
  why:
    "devnet.deterministic-worlds' frozen epoch makes each time in a world a function of its steps; a season is the " +
    "clock running on a real schedule, so its worlds cannot be frozen without testing something else. Building them " +
    "each time keeps them true: a season planned in a saved world would have its real times in the past by the time an " +
    "eval restored it. Player homes outside the snapshots are what make a reset's NOT_AUTHENTICATED observable: a home " +
    "restored with the world would hold a session the reset world knows.",
  source: SEASONS("devnet.deterministic-worlds; devnet.shared-world (shared-world-joiner); books/target/devnet/worlds.ts"),
  affects: [concept_devnet, ...SEASON_OPS],
});

export const decision_devnet_season_claims = defineDecision({
  id: "devnet.season-claims",
  title: "Every season command proves more than one behaviour",
  question:
    "After the seasons design and its reviews, five season commands had one acceptance claim each: `dev season cancel`, " +
    "`show`, `warp remove`, `player add` and `player remove`. Every other new command of the surface pass has two or " +
    "more. Which behaviours the records already book do they also prove?",
  options: [
    {
      label: "booked-behaviours",
      text:
        "One more claim each, read off its flow and devnet.seasons, from a catalogued season world: a planned season " +
        "whose real end passes before it starts is cancelled by the supervisor, its note saying so; between seasons the " +
        "last ended season is current and a cancelled one never is; removing a planned season's only warp leaves `next` " +
        "null; adding a player who already plays changes nothing; and a player taken out of a planned season is not " +
        "admitted when it starts, while their grant still reads `dev season show`.",
    },
    { label: "leave", text: "Leave them at one claim; their refusals are evals already." },
  ],
  chosen: "booked-behaviours",
  why:
    "A command with one claim proves one path: each of these has a second that its flow already books and an eval " +
    "would otherwise miss, the supervisor's own cancel above all, which no command triggers. Each claim starts from a " +
    "season world built just before it is used (devnet.season-worlds), so its real times hold, and none adds a flag, " +
    "an answer or a refusal.",
  source:
    "Claude, surface pass build, 9 November 2026; evidence: books/target/devnet/flows.ts (the season flows' abouts); " +
    "devnet.seasons; devnet.season-players; devnet.season-worlds",
  affects: [
    ops.operation_dev_season_cancel, ops.operation_dev_season_show, ops.operation_dev_season_warp_remove,
    ops.operation_dev_season_player_add, ops.operation_dev_season_player_remove,
  ],
});
