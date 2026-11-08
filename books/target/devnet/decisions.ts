// Devnet's own judgments, one decision record each. The architecture's judgments about devnet are
// in ../shared/decisions.ts (concepts.devnet, components.devnet, environments.devnet,
// operations.dev-mail-notices-in-devnet, responsibilities.operator-proof-tools,
// dependencies.of-devnet).

import { defineDecision } from "../../../packages/book/src/index.ts";
import { component_devnet, concept_devnet, environment_devnet } from "../shared/foundation.ts";
import { integration_chainlink, integration_devnet_control, integration_mail, integration_posthog } from "../shared/external.ts";
import { table_mail_faults, table_mail_messages, table_scripted_gates, table_scripted_prices } from "./data.ts";
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
  flow_devnet_time_show,
  flow_devnet_time_start_at,
  flow_devnet_time_warp,
} from "./flows.ts";
import * as ops from "./operations.ts";

const BY = "Claude, devnet concept design, 8 November 2026";
const by = (evidence: string) => `${BY}; evidence: ${evidence}`;

const TABLES = [table_mail_messages, table_mail_faults, table_scripted_gates, table_scripted_prices];
const RPCS = [
  rpc_devnet_mail_list, rpc_devnet_mail_fail, rpc_devnet_mail_list_notices, rpc_devnet_gates_script, rpc_devnet_gates_read,
  rpc_devnet_prices_script, rpc_devnet_jobs_run,
];
const SUPERVISOR_FLOWS = [
  flow_devnet_time_show, flow_devnet_time_warp, flow_devnet_time_start_at, flow_devnet_snapshots_list, flow_devnet_snapshots_save,
  flow_devnet_snapshots_restore,
];
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
  source: by("books/as-is/operator/data.ts:1-9 (devnet tables in the production schema); concepts.devnet; environments.devnet"),
  affects: [...TABLES, concept_devnet, environment_devnet],
});

export const decision_devnet_no_machines = defineDecision({
  id: "devnet.no-machines",
  title: "No state machine, so no event",
  question: "Does any devnet table carry a lifecycle that needs a machine and its `<machine>_transitioned` event (P7)?",
  options: [
    { label: "none", text: "None: a message is kept once, a fault is armed and spent, a gate or rate is a value that is replaced." },
    { label: "fault-machine", text: "A machine on mail faults (armed, spent, cleared) with its event." },
  ],
  chosen: "none",
  why:
    "No row moves through states a reader follows: the sink is append-only, a fault is a counter deleted at zero, and a " +
    "scripted gate's on or off is a setting, not a status. A machine only to send an event would be telemetry booked as " +
    "behaviour (P7's emit-only review), and nothing downstream follows these rows.",
  source: by("docs/decisions/policy-pack.md#p7; books/as-is/operator/data.ts (only noticeDeliveries had a status, now notices')"),
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
  source: by("books/as-is/operator/outboxes.ts:25-58 (record); packages/backend/src/integrations/mail/service.ts:171; shared external.ts (mail fake)"),
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
  source: by("operations.dev-mail-notices-in-devnet; books/as-is/operator/notices.ts:57-91"),
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
  source: by("books/target/access/decisions.ts (access.gates); apps/docs/factory/operations/dev.gates.set.yaml; books/as-is/operations/devnet.ts:679-730"),
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
    "is not those defaults, so the chainlink fake's text in shared/external.ts now says so.",
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
        "The crons P3 keeps (each another concept's singleton workflow) and every durable timer due at the backend clock; " +
        "one rpc asks the engine for one run of each, waits for them and reports each by name.",
    },
    { label: "as-is", text: "Port old operator.jobs.run and shift, which moved Convex's scheduled functions by the warp." },
  ],
  chosen: "engine",
  why:
    "P3 leaves six crons (Bridge catch-up, prices, flags, the client-grant sweep, the daily agreement notices, the " +
    "added-token scan) and gives every other wait to a process's own timer, which the engine keeps in Postgres in backend " +
    "time; on a devnet that clock is the supervisor's, so after a warp the due timers are due, and nothing needs shifting " +
    "(old shift goes). The rpc names the workflows by id because the schema has no link from an rpc to a workflow; it " +
    "writes no table of theirs. `only` serves the gates and prices flows. A failed job is WORK_DIED naming it, as the " +
    "frozen mistake says, after the others finish.",
  source: by("books/as-is/operator/jobs.ts; docs/decisions/policy-pack.md#p3; apps/docs/factory/operations/dev.jobs.run.yaml"),
  affects: [rpc_devnet_jobs_run, ops.operation_dev_jobs_run, flow_devnet_gates_set, flow_devnet_prices_set],
});

export const decision_devnet_supervisor_owns_time_and_worlds = defineDecision({
  id: "devnet.supervisor-owns-time-and-worlds",
  title: "The clocks and the saved worlds are the supervisor's",
  question: "Old warps set an env var through the deployment's admin API and imported data with the Convex CLI. Who owns the clocks and the worlds now?",
  options: [
    {
      label: "supervisor",
      text:
        "The supervisor: it runs Anvil, Postgres, Ponder and the backend, so it moves Anvil's time, holds the backend's " +
        "clock offset (the devnet build's Clock layer reads it from the supervisor), saves and restores worlds on this " +
        "machine's disk, and calls devnet.jobs.run after a warp. The SDK's devnet flows call devnet-control only.",
    },
    { label: "backend-rows", text: "A devnet clock table and snapshot rpcs on the backend, which the flows call." },
  ],
  chosen: "supervisor",
  why:
    "A world is the whole of Postgres, so its catalog cannot live inside it, and only the process that runs every " +
    "component can stop them, swap their state and start them again. The backend's clock must agree with the chain's, " +
    "and the supervisor is the one place that moves both together (devnet-control's clockWarp). Clock rpcs only the " +
    "supervisor called would be unreached (P2). Old operator.clocks.read and jobs.shift are not ported: clockShow reads " +
    "both clocks, and timers stored in backend time need no shift. The durable processes resume from their stored state " +
    "after a restore.",
  source: by("books/as-is/operations/devnet.ts:1-40, :295-430; components.devnet; shared external.ts (devnet-control)"),
  affects: [...SUPERVISOR_FLOWS, component_devnet, integration_devnet_control, concept_devnet],
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
        "WRONG_STATE for other backend code; clockStartAt: INVALID_INPUT for a date not earlier, WRONG_STATE once the " +
        "clocks moved. Changed in shared/external.ts.",
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
    { label: "cache", text: "As a `cache` step (this machine's devnet state), its about naming the devnet-control call, which the flow's `calls` lists." },
    { label: "wait", text: "As a `wait` step." },
  ],
  chosen: "cache",
  why:
    "`wait` is a person or the chain and is never system time, but a save, a restore and a warp are the developer's " +
    "system time and must count against the budget. The supervisor is local state on this machine behind an owner-only " +
    "socket, which `cache` describes best, and the flow's `calls` gives the call its span and its failures, so its " +
    "refusals are produced (refusal-not-produced reads `calls`).",
  source: by("packages/book/src/records/behaviour.ts (Step kinds); books/as-is/operations/devnet.ts:212 (snapshot list as a cache step)"),
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
  source: by("books/as-is/operations/devnet.ts:606-676; books/target/access/sign-in.ts; books/target/approvals/signing.ts"),
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
        "supervisor's clockShow), jobs.shift (timers in backend time), outboxes.record (the mail fake), notices.record " +
        "(notices' own), the receipt hold (the bundler's fault switch), and the gates and price rows of access and books.",
    },
    { label: "port-all", text: "Port every operator internal function as a devnet rpc." },
  ],
  chosen: "lean",
  why:
    "Each kept rpc is reached by a frozen operation or a devnet flow (P2). The rest had no caller in the target: the " +
    "supervisor or the fakes now do their work, or another concept owns it. Old proof identities, fixtures and probes are " +
    "dropped by the architecture (responsibilities.operator-proof-tools, concepts.devnet).",
  source: by("books/as-is/operator/*.ts; shared landings.ts (operator/clocks, jobs, outboxes, notices, receipts)"),
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
        "read for the clock, list and mail reads; write for the scripts and the fail switch; background for jobs run, warp, " +
        "save and restore; chain-settle for start-at; vendor for approve and gates set; chain-read for prices set.",
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
        "`capxul-devnet clock hold`, `chain` and `bridge` make what no Capxul surface makes (a still backend clock, a Safe " +
        "transaction or a Hats ruling outside Capxul, an outside transfer, a token, Bridge deposits). The armed switches " +
        "are in the world's manifest and re-armed on restore. The mail switch is `dev mail fail`, in Postgres.",
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
