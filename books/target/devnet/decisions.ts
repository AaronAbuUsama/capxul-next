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
} from "../shared/foundation.ts";
import {
  integration_bridge,
  integration_bundler,
  integration_chain_rpc,
  integration_chainlink,
  integration_devnet_control,
  integration_frappe_head,
  integration_indexer,
  integration_mail,
  integration_posthog,
} from "../shared/external.ts";
import {
  table_head_changes,
  table_head_documents,
  table_head_sites,
  table_mail_faults,
  table_mail_messages,
  table_scripted_gates,
  table_scripted_prices,
} from "./data.ts";
import { operation_org_create } from "../organizations/operations.ts";
import { rpc_organizations_heads_ring } from "../organizations/heads.ts";
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
const TABLES = [table_mail_messages, table_mail_faults, table_scripted_gates, table_scripted_prices, ...HEAD_TABLES];
const RPCS = [
  rpc_devnet_mail_list, rpc_devnet_mail_fail, rpc_devnet_mail_list_notices, rpc_devnet_gates_script, rpc_devnet_gates_read,
  rpc_devnet_prices_script, rpc_devnet_jobs_run,
];
const TIME_FLOWS = [
  flow_devnet_time_show, flow_devnet_time_warp, flow_devnet_time_start_at, flow_devnet_time_freeze, flow_devnet_time_resume,
  flow_devnet_time_step, flow_devnet_time_settle, flow_devnet_time_watch, flow_devnet_time_follow,
];
const SUPERVISOR_FLOWS = [...TIME_FLOWS, flow_devnet_snapshots_list, flow_devnet_snapshots_save, flow_devnet_snapshots_restore];
const TIME_OPS = [ops.operation_dev_time, ops.operation_dev_time_warp, ops.operation_dev_time_start_at];
/** The time design's own evidence (docs/design/time.md). */
const TIME = (evidence: string) => `Claude, time design, 8 November 2026; evidence: ${evidence}`;
const OLD_WORLD = "/home/user/factory packages/devnet/src/modules/world";
const BENCH = "/home/user/factory packages/vending-bench/src";
const OPERATIONS = [
  ops.operation_dev_time, ops.operation_dev_time_warp, ops.operation_dev_time_start_at, ops.operation_dev_snapshot_save,
  ops.operation_dev_snapshot_list, ops.operation_dev_snapshot_restore, ops.operation_dev_prices_set, ops.operation_dev_gates_set,
  ops.operation_dev_approve, ops.operation_dev_jobs_run, ops.operation_dev_mail_list, ops.operation_dev_mail_fail,
  ops.operation_dev_mail_notices,
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
        "fault fails the send as Resend unavailable (PROVIDER_ERROR), which a notice's workflow retries.",
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
    "idempotency key, as Resend does.",
  source: by("docs/as-is/archive/operator/outboxes.ts:25-58 (record); packages/backend/src/integrations/mail/service.ts:171; shared external.ts (mail fake)"),
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
        "The devnet concept's rpcs are in the RpcGroup only of the devnet build, whose backend listens on loopback; each " +
        "`who` begins `devnet only:`. WRONG_ENVIRONMENT comes from the CLI's devnet scope (before any network call) and " +
        "from the supervisor's socket being absent.",
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
        "The supervisor's time authority holds the devnet's one clock: now, its mode (running or frozen), a version that " +
        "rises with every change, the world's epoch and whether the story has begun. Its now is the chain's block time: " +
        "the supervisor is the chain's only miner and mines every block at now (devnet.only-miner). Everything else " +
        "follows it through the time protocol (devnet.time-protocol) as a follower (devnet.followers): the backend's " +
        "devnet Now layer, and with it the workflow engine's timers and crons, the mail sink and the fakes; Ponder, whose " +
        "rows carry the blocks' times; the bundler, paymaster and Bridge stand-ins; and any outside program. The " +
        "supervisor also saves and restores worlds, with their clock, on this machine's disk. The SDK's devnet flows call " +
        "devnet-control only.",
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
        "environment, with no devnet branch. A stop's cascade (a timer's transaction, then the one its indexed fact " +
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
    "by the time review, 8 November 2026.",
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
        "Both, as the clock's mode. Running: now runs on at the real rate from where it was last set, which `capxul-devnet " +
        "up` starts with for a person at the keyboard (a code expires, a timer fires on its own). Frozen: now moves only " +
        "by a warp, a step, a start-at, a restore or a tick, which the eval devnet, the world builder and any simulation " +
        "use. freeze and resume switch modes without moving now back. A warp keeps the mode.",
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
        "freeze or resume while another runs is WRONG_STATE; reads and watches always answer. A warp whose caller goes " +
        "away stops at its next settled stop. On a running clock the warp holds now at each stop and lets it run on from " +
        "T. Step is one stop; settle is a stop at now.",
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
        "/freeze and /resume; GET /v1/time/events (server-sent events); POST /v1/followers with its events and acks. " +
        "It answers only a loopback Host and no cross-origin request, so a web page on the same machine cannot drive it. " +
        "Every clock it answers carries `realAt`, this machine's real time when now held that value, so a running " +
        "clock's now is now + (real time - realAt) for every reader. One move runs at a time (devnet.warp-barrier). " +
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
        "due), and each stand-in Frappe head (idle when no ring it sent is unanswered, with no next due: " +
        "devnet.head-stand-in). An armed fault switch's held state counts as idle (a held receipt, an indexer hold). An outside program " +
        "joins the same way, so a simulation's own happenings become stops. Running, a follower computes now as the " +
        "event's now plus the real time since its `realAt` (one machine, one real clock). A follower that misses an " +
        "acknowledgement fails the barrier and is dropped. The backend's follower channel is the runtime's, not an rpc.",
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
        "`latest` as on staging, which on a frozen devnet is a block at now (devnet.only-miner).",
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
  affects: [integration_bundler, integration_bridge, integration_mail, integration_chainlink, integration_posthog, integration_chain_rpc, integration_indexer, component_devnet, environment_devnet],
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
        "read for the clock, list and mail reads; write for the scripts, the fail switch, freeze and resume; background " +
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
  source: by("packages/book/src/budgets.ts; shared external.ts (devnet-control p95s)"),
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
        "row: devnet.head-stand-in).",
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
        "None new. WRONG_ENVIRONMENT: cli-on-beta-environment. Time, snapshots and mail: empty-devnet; start-at's " +
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
        "through payroll's SDK methods (its CLI commands are not booked yet).",
    },
    { label: "olga", text: "Make Olga, already paid and under a salary agreement there, the Employee." },
  ],
  chosen: "kai",
  why:
    "A new person keeps each of the world's readers to the one role its claims give them: Olga is the payee of a note, " +
    "an Invoice and an agreement, Lee the member who joined after, Max the stranger, Nia the person with no Party. Kai " +
    "has a Safe and a display name, so the rendered payslip names the employee by name, as the claim needs. The steps " +
    "are Core SDK methods of a surface with no command yet (payroll.hr-surface), which a builder step may run. The run " +
    "is submitted, not paid: the payslip is stored at submit.",
  source: WORLD_GROUP("documents.acceptance-rewrites; documents.payslip-kind; books/target/payroll/flows.ts (client.org.payroll.*)"),
  affects: [concept_devnet, concept_documents, concept_payroll],
});
