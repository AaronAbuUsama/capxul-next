// The time design's records: its decisions (defineDecision) and invariants (defineInvariant). One
// writer: the time designer. Explained in docs/design/time.md.
//
// One clock (decision time.one-clock): every product decision reads one `now`, and on a devnet that
// same instant is the chain's block time. The devnet's records that carry it out (the supervisor's
// time authority, its protocol, the warp barrier, the followers) are in ../devnet/; these are the
// rules every concept, component and client follows, and the invariants whose evals check them.
// Shared records link only to shared records, so the devnet records are named here in prose.
//
// Each world is self-contained (aaron.world-clock): a devnet, a shared world and staging each have one
// clock that everything in it follows, a devnet's and a shared world's controlled and possibly running
// at a rate, and every outside channel belongs to its world (time.worlds, time.world-channels).

import { defineDecision, defineInvariant } from "../../../packages/book/src/index.ts";
import * as f from "./foundation.ts";
import * as x from "./external.ts";
import * as d from "./decisions.ts";

const BY = "Claude, time design, 8 November 2026";
export const by = (evidence: string) => `${BY}; evidence: ${evidence}`;

const ADR = "/home/user/factory docs/adr/0041-business-chain-and-wall-time.md";
const CLIENTS = [f.component_core_sdk, f.component_cli, f.component_mcp_server, f.component_react_sdk];

// ── the model ───────────────────────────────────────────────────────────────────────────────

export const decision_time_one_clock = defineDecision({
  id: "time.one-clock",
  title: "One clock: the same now for block time and everything else",
  question:
    "The old system named three times (business, chain and wall) with one owner, retrofitted over 317 direct reads " +
    "(ADR-0041): on a devnet the backend's time was the wall plus an offset set through an admin API, Anvil's clock ran " +
    "on with the wall between blocks, the two were said to agree within two seconds, and the scheduler fired on the wall " +
    "and was shifted after every warp. People building on Capxul (vending-bench runs a simulated year of a business on it) " +
    "drove that time from outside through an SDK-internal socket and worked around the drift. What is time in the rebuild?",
  options: [
    {
      label: "one-clock",
      text:
        "One clock, built in from the start. Its reading, now, is the instant every product decision is made at: a row's " +
        "time, an expiry, a lapse, a window, a due date, a month's close, an email's date, a durable timer and a cron's run. " +
        "On a devnet one time authority (the supervisor) holds now, every block is mined at it, so the chain's block time " +
        "is the same instant, and the backend, the workflow engine, Ponder's rows, the stand-ins and the clients follow it. " +
        "Setting the time once sets it for all of them. On staging and production now is the host's clock, and the chain's " +
        "time is read from blocks. The devnet's clock is a documented, versioned protocol that people building on Capxul " +
        "drive from outside.",
    },
    {
      label: "three-times",
      text: "Keep ADR-0041: business, chain and wall time as three named times with one owner, and a devnet offset over the wall.",
    },
    {
      label: "chain-everywhere",
      text: "Read the chain head's timestamp as now on every environment, so block time is now even on staging.",
    },
  ],
  chosen: "one-clock",
  why:
    "When the time is set somewhere it must be the same for block time and for everything else, and it must be reachable " +
    "on the devnet as part of the protocol, because others build on Capxul and need to drive its time from outside. Three " +
    "times let a product decision pick the wrong one (a paymaster's validUntil compared with the wall), and an offset over " +
    "a moving wall cannot be equal to the chain's time, only close to it. Reading the chain head everywhere would make " +
    "staging's clock lag and jump with each block and stop when a node does. One authority on the devnet makes the chain's " +
    "time equal to now by construction; on staging the chain's time is a fact read from blocks and watched for drift " +
    "(time.drift-watch). What still runs on real elapsed time never becomes a product time (time.real-elapsed).",
  source: "Aaron, 8 November 2026, in the build-preparation conversation; designed in docs/design/time.md",
  affects: [
    f.system_capxul, f.component_chain, f.component_backend, f.component_ponder, f.component_bundler_paymaster, f.component_devnet,
    ...CLIENTS, f.environment_devnet, f.environment_staging, f.environment_shared_world, x.integration_devnet_control,
    x.integration_chain_rpc,
  ],
});

export const decision_time_real_elapsed = defineDecision({
  id: "time.real-elapsed",
  title: "Real elapsed time measures and protects; it never decides",
  question: "Which waits and measurements must still run on real elapsed time, and how is that kept out of every product decision?",
  options: [
    {
      label: "measure-and-protect",
      text:
        "Real elapsed time is a duration or a deadline for waiting, never an instant a row keeps or a product rule compares. " +
        "It covers: a call's per-attempt timeout and its retries' backoff (the integrations' timeoutMs and retries); a " +
        "workflow run's own timeoutMs and retries; a `chain` or `indexer` wait's timeoutMs (how long Capxul's own node or " +
        "Ponder may lag); span timestamps and durations, and so every budget; the workflow engine's leases, heartbeats and " +
        "poll intervals, the outbox relay's and Ponder's polling; a client's patience (how long a `wait` step polls before " +
        "it gives up); an infrastructure rate limit (requests a second from one address); and a vendor's envelope: a " +
        "webhook signature's freshness, a vendor-issued token's expiry, a certificate. The rule for an envelope is envelope " +
        "in real time, payload on now: the Bridge stand-in signs its webhook with the real time and dates the deposit at " +
        "now. Everything a person is promised in time is on now, Capxul's own expiries included: a session, a sign-in code " +
        "and its resend cooldown, an assistant grant, a key's grace window, a `person`, `signal` or `timer` wait. A " +
        "workflow's own timeoutMs bounds one run's work between its waits (waits never count, as for budgets), so it is " +
        "real; a bound on how long an object may live in the story (an approval ends within 370 days) is not a run " +
        "timeout but a `timer` wait on now. A vendor envelope's instant (a webhook's signed timestamp checked for " +
        "freshness, a timestamp Capxul signs into a vendor's request) is read from `RealTime`, beside Now in " +
        "packages/runtime/src/time/: only integration layers call it, and its value is never stored in a row or compared " +
        "with a product time.",
    },
    {
      label: "wall-for-auth",
      text: "As ADR-0041: sessions, sign-in codes, JWTs and id prefixes on wall time, which no warp moves.",
    },
  ],
  chosen: "measure-and-protect",
  why:
    "A duration measures the system or protects it from a slow or failing part, so it must be real: a warp cannot make " +
    "a node answer sooner, and a budget measured on a frozen clock would read zero. A vendor checks its own envelope " +
    "against its own clock, so Capxul cannot move it. Capxul's own expiries are product rules, swept and transitioned by " +
    "processes that run on now (access's daily sweep expires sessions past expires_at), so keeping them on the wall " +
    "would mix two times in one rule, which is the defect ADR-0041 retrofitted. A month warped past a 30-day session " +
    "ends it, as a month would. Effect's own Clock stays the real clock for exactly these uses (time.read-once). The " +
    "book's workflows size timeoutMs both ways today: payroll's years-long agreement process has 2 minutes (one run), " +
    "while access (91 days), approvals (370), payments (400 and 1), requests (400), organizations (30 and 365), banking " +
    "(90, 90 and 2) and applications (31) size it as the object's life in the story; read as real time those would never " +
    "bound anything a warp compresses, so their owners turn each into a timer wait. An envelope check needs a real " +
    "instant, not a duration, and without a named reader it would be a direct read the lint forbids. Revised by the " +
    "time review, 8 November 2026.",
  source: by(`${ADR} (D1 wall time); packages/backend/src/platform/clock.ts (wallTime for vendors); node_modules/effect/src/internal/effect.ts (ClockImpl, spans)`),
  affects: [
    f.component_backend, ...CLIENTS, x.integration_chain_rpc, x.integration_bundler, x.integration_indexer, x.integration_bridge,
    x.integration_mail, x.integration_openfort, x.integration_posthog, f.concept_access,
  ],
});

// ── the runtime ─────────────────────────────────────────────────────────────────────────────

export const decision_time_read_once = defineDecision({
  id: "time.read-once",
  title: "One Now service, read once per rpc and per step, and passed down",
  question: "How does product code get now, so that one rpc or one workflow step decides everything at one instant, and a replay decides it again the same way?",
  options: [
    {
      label: "request-and-step-time",
      text:
        "packages/runtime/src/time/ owns the `Now` service, the only code that reads a clock, with three layers: live (the " +
        "host's clock), devnet (the supervisor's follower) and test (an instant a test sets or that follows Effect's " +
        "TestClock). The generated router reads Now once when an rpc's transaction begins and gives the handler that " +
        "instant as RequestTime; the procedures it invokes take the same instant, so one transaction has one now. The " +
        "generated workflow step wrapper reads Now once when a step begins and gives it as StepTime; a step's result is " +
        "journaled, so a replay sees the same instant. A workflow body never reads Now: it takes instants from its trigger " +
        "(a transition's `at`, a chain event's block time, a cron run's scheduled instant) and from its steps' results. A " +
        "transition's outbox event carries the instant of the transaction that made it. Capxul's ids that carry a time " +
        "(ULIDs) take it from the request's or the step's instant. Every rpc answer carries the backend's now. Effect's " +
        "Clock is left as the real clock everywhere: spans, logs, timeouts, Schedule and sleeps keep real time. On a " +
        "frozen clock many requests share one instant, so no key or uniqueness rests on an instant alone: it also " +
        "carries an id or a sequence (a ULID, which increments within one instant, so rows made at one instant keep the " +
        "order they were made in; a round id; a request id), and every order by time has a tie-break.",
    },
    {
      label: "effect-clock",
      text: "Replace Effect's default Clock with the driven clock in every layer, so DateTime.now is now.",
    },
    { label: "read-anywhere", text: "Let any code read Now when it needs it, as ADR-0041's backendNow() shim did." },
  ],
  chosen: "request-and-step-time",
  why:
    "One read per rpc means one transaction cannot see two instants (an expiry checked at one and the row stamped at " +
    "another), and one read per step is what Effect Workflow's replay needs: a body that read the clock directly would " +
    "branch differently when it resumed. In Effect 4.1.2 the tracer stamps every span's start and end with the Clock's " +
    "currentTimeNanos and loggers stamp with currentTimeMillis, so a driven Clock in every layer would date spans in the " +
    "story's time and, frozen, measure every span as zero: budgets could not be measured. Reading anywhere is what took " +
    "317 sites to undo. A frozen story is a run of shared instants (one world step, one eval, a stop's whole cascade), " +
    "so a key made of an instant collides there where production would never collide: a cron's manual run, two price " +
    "rounds scripted at one instant.",
  source: by("node_modules/effect/src/internal/effect.ts:6368 (ClockRef, ClockImpl), :6086 (span clock), :6723 (log clock); src/DateTime.ts:908; src/workflow/Workflow.ts"),
  affects: [f.component_backend, ...CLIENTS, f.system_capxul, d.decision_rules_outbox],
});

export const decision_time_durable_timers = defineDecision({
  id: "time.durable-timers",
  title: "Durable timers and crons are due at instants on the one clock",
  question:
    "Effect's DurableClock.sleep takes a duration: up to 60 s it is an in-memory Effect.sleep on the real clock, and " +
    "longer it stores a wake-up at DateTime.now plus the duration, which the message storage delivers when deliver_at " +
    "is not after the Clock it captured when its layer was built. ClusterCron schedules from DateTime.now and skips a run " +
    "delivered more than a day late. How do the book's timer waits and P3's crons fire on now, so that a warp needs no shift?",
  options: [
    {
      label: "router-timers",
      text:
        "Through the wake router (rules.process-wakeups). A `timer` wait is `Timers.until(name, at)`: a step stores the " +
        "timer (the instance, the wait's name, its due instant) in the runtime's timers table and the body awaits its " +
        "durable deferred; one pump fires every timer whose due instant is not after now, completing its deferred through " +
        "the engine (a second completion is a no-op), and runs again whenever the clock changes. A cron is a row of the " +
        "runtime's cron table (its expression, its next run as an instant) on the same pump; each run starts the cron's " +
        "workflow with the execution id `cron/<name>/<instant>` and is given that scheduled instant. A run missed while " +
        "the clock jumped runs once, then the next is computed from now. A manual run (`dev jobs run`) has its own id, " +
        "`cron/<name>/manual/<request id>`, so a second manual run at one frozen instant still runs. Every due instant " +
        "is a whole second, rounded up (a timer's `at`, a cron's run), so a warp's stops are whole seconds. A timer " +
        "whose wait another wake ended first (a signal that cut it short) is cancelled in the step that saw the winner, " +
        "so it neither fires nor becomes a stop. A wait's timeoutMs is on now for `person`, " +
        "`signal` and `timer` waits (a product deadline, raced as a timer) and real for `chain` and `indexer` waits " +
        "(time.real-elapsed). DurableClock.sleep, ClusterCron and Effect.sleep are not used in workflow bodies.",
    },
    {
      label: "engine-clock",
      text:
        "Engine-native: give the message storage layer and every scheduling call a Clock whose current time is now (its " +
        "sleep and monotonic time real), set inMemoryThreshold to 0 and skipIfOlderThan to forever, read deliver_at from " +
        "the engine's message table for the warp's stops, and poll storage on every clock change.",
    },
  ],
  chosen: "router-timers",
  why:
    "The router already maps a waking key to a durable deferred, and a due instant is one more key, so every wait ends " +
    "through one code path the runtime owns and the B0 spike already proves. The pump compares a stored instant with " +
    "now, so a timer stored once never needs moving: old jobs.shift and businessDueMs go. The warp's next stop is a query " +
    "of Capxul's own table, not of an unstable module's storage. The engine-native path needs five seams in Effect's " +
    "unstable cluster code, any of which an upgrade can move, and a cron skipped after a long warp. Read in 4.1.2, an " +
    "engine-native sleeper does not wake when an injected clock jumps: its message is read again only on the storage " +
    "poll (10 s) or an explicit pollStorage, and a sleep of 60 s or less is a real in-memory sleep a warp never reaches. " +
    "A pump's deferredDone, by contrast, persists the completion and opens the local storage latch, so the instance " +
    "resumes at once. A manual cron run keyed like a scheduled one would be swallowed by the scheduled run's id on a " +
    "frozen clock. Whole seconds keep two stops out of one second, where both would mine at that second. B0 may " +
    "overturn the choice with measurements (decision record), keeping the rule that a due time is an instant on the " +
    "one clock.",
  source: by("node_modules/effect (4.1.2) src/workflow/DurableClock.ts; src/cluster/ClusterWorkflowEngine.ts:896; src/cluster/MessageStorage.ts:700,785; src/cluster/ClusterCron.ts; old platform/schedule.ts"),
  affects: [f.component_backend, f.component_postgres, d.decision_rules_process_wakeups, d.decision_rules_durable_processes],
});

export const decision_time_clients_take_server_now = defineDecision({
  id: "time.clients-take-server-now",
  title: "Clients take now from the backend's answers, never from their own clock",
  question: "The Core SDK, the CLI, the MCP server and the React SDK run on people's machines. Where do they get now?",
  options: [
    {
      label: "answer-now",
      text:
        "From the backend: every rpc answer carries the now its transaction read, the Core SDK keeps the latest as " +
        "`client.now()`, and a client renders a relative time (\"expires in 2 h\") against the answer's own now. No client " +
        "makes a product decision on time: the backend decides expiry, lateness and windows. A client sends a relative " +
        "span to whoever owns now (a warp's `6h` to the supervisor) rather than resolving it itself. On a devnet the " +
        "SDK's devnet entry also reads the time protocol. A client's own deadlines for waiting are real time. " +
        "`client.now()` is the latest answer's now plus the real time since that answer, so it is stale after a warp " +
        "the client did not see: a client renews a session or refreshes a token when the backend refuses it, never " +
        "only on its own reading (an agent's 24-hour session after a two-day warp, an assistant's access token).",
    },
    { label: "offset", text: "Read the devnet's offset from the backend and add it to the client's wall clock, as ADR-0041 did." },
  ],
  chosen: "answer-now",
  why:
    "A client's clock is not Capxul's, and on a devnet the story's time can be a year from the machine's, so the CLI " +
    "would show the wrong expiry and an agent would sign a window it thinks open. The answer already crosses the wire, so " +
    "carrying now costs one field, and a frozen devnet shows its frozen time with no offset to keep in step.",
  source: by(`${ADR} (consequences: clients read the devnet offset); /home/user/factory packages/vending-bench/src/devnet-world.ts:542`),
  affects: CLIENTS,
});

// ── staging and production ──────────────────────────────────────────────────────────────────

export const decision_time_chain_judged_deadlines = defineDecision({
  id: "time.chain-judged-deadlines",
  title: "Chain time is a block's fact; the chain's head judges a deadline it enforces",
  question:
    "On staging the chain is Base Sepolia, whose blocks carry the sequencer's time. Payroll's, equity's and approvals' " +
    "timers act on deadlines a contract or the EntryPoint enforces with block.timestamp. How do they meet the one clock?",
  options: [
    {
      label: "head-judges",
      text:
        "Chain time is read, never computed: a fact's time is its block's timestamp (indexing's rows, chain-rpc.getBlock). " +
        "A time that reaches the chain (a validUntil, a cliff, a period's start, a vote's end, a close) is a whole second. " +
        "A timer for a deadline the chain enforces is due at the first second at which the chain's own rule gives the new " +
        "answer, read off the contract: v4 Agreements' offer expiry and Budgets' payAt change at the deadline second " +
        "itself (`>=`), while OpenZeppelin's Governor keeps a vote Active through its deadline second, so a vote's end is " +
        "due at voteEnd + 1; the EntryPoint's validAfter bound is read off the pinned EntryPoint the same way. When the " +
        "timer fires it checks the head: while the head has not reached the due second (on staging it trails now), it " +
        "re-arms for the shortfall instead of acting or failing, and it acts once Ponder has indexed that head, so a fact " +
        "mined before the deadline (an accept in the deadline's last second) is seen before a lapse is decided. A span of " +
        "chain-dated facts (a month's books, a budget period) is half-open, [start, end), as the v4 Calendar's periods " +
        "are, and a process that closes one waits the same way until the head and Ponder are past its end. On a devnet " +
        "the head is at now at every settled stop (devnet.only-miner), so with due seconds set by this rule the re-arm " +
        "never happens there.",
    },
    { label: "trust-now", text: "Act at now and treat an early revert as a failure." },
  ],
  chosen: "head-judges",
  why:
    "On staging now and the head's time are close but not equal: the head trails by up to a block and a host's clock can " +
    "run ahead of the sequencer's. The chain's judgment is final, so the decision that depends on it defers to it; a " +
    "failure for a second's difference would be a defect the devnet could never show. The re-arm alone is not enough: " +
    "a lapse needs no chain call, so nothing reverts to say it is early, and a payee's accept can land in a block dated " +
    "before the expiry after the backend has lapsed the offer. And the devnet's equality of head and now hides an " +
    "off-by-one, not removes it: a timer due at voteEnd fires at a stop whose block is at voteEnd, where Governor.state " +
    "still answers Active. Revised by the time review, 8 November 2026.",
  source: by("v4 src/money/Agreements.sol:198 (>= offerExpiresAt), Budgets.sol:288 (< payAt); OZ GovernorUpgradeable.state; books/target/equity/processes.ts:403"),
  affects: [
    f.component_backend, f.component_chain, x.integration_chain_rpc, x.integration_indexer, f.concept_payroll, f.concept_equity,
    f.concept_approvals, f.concept_books, f.concept_budgets,
  ],
});

export const decision_time_drift_watch = defineDecision({
  id: "time.drift-watch",
  title: "Staging watches the chain's lag behind now and each host's skew",
  question: "On staging and production nothing makes the chain's time and the backend's now equal. How is drift seen before it becomes a defect?",
  options: [
    {
      label: "two-signals",
      text:
        "Every read of the chain head (chain-rpc.getBlock, the indexer's head) records `time.chain_lag_ms`, now minus the " +
        "head's timestamp, on its span; each transaction records `time.db_skew_ms`, the backend's now minus Postgres' " +
        "clock_timestamp(), read in the round trip that sets the tenant. B5 adds live evals and alerts: chain lag outside " +
        "-2 s to +60 s for five minutes, and a host's skew beyond one second.",
    },
    { label: "none", text: "Trust NTP and the sequencer." },
  ],
  chosen: "two-signals",
  why:
    "A negative lag means the backend's clock is behind the chain's, so a deadline the chain enforces can pass before " +
    "Capxul acts; a large positive one means a stale node or a stalled head. Several backend instances share one " +
    "Postgres, so its clock is the reference that shows one host's skew, which would reorder rows and fire timers early " +
    "or late. Both ride on reads already made, so the watch costs no new call.",
  source: by("books/target/shared/external.ts (chain-rpc.getBlock, indexer.head); books/target/shared/foundation.ts (staging: two or more backend instances)"),
  affects: [f.environment_staging, f.component_backend, f.component_postgres, x.integration_chain_rpc, x.integration_indexer],
});

// ── the code ────────────────────────────────────────────────────────────────────────────────

export const decision_time_no_direct_reads = defineDecision({
  id: "time.no-direct-reads",
  title: "No direct clock read outside the clock module, checked from the first commit",
  question: "ADR-0041 counted direct reads per folder and lowered the counts. What keeps the one clock whole in a codebase built from the book?",
  options: [
    {
      label: "lint-zero",
      text:
        "T0's lint, at zero from the first commit, in every package: no Date.now(), new Date() without an argument, " +
        "performance.now(), process.hrtime, Clock.currentTimeMillis or currentTimeNanos, DateTime.now, nowAsDate or " +
        "nowUnsafe outside packages/runtime/src/time/; no Now read in an rpc handler (RequestTime only) or a workflow body " +
        "(StepTime and Timers.until only); no Effect.sleep, DurableClock.sleep, ClusterCron or Effect.timeout in a workflow " +
        "body; no Postgres now(), current_timestamp, clock_timestamp() or transaction_timestamp() in product SQL, a " +
        "predicate or a column default; in Ponder handlers only the event's block timestamp; in clients only " +
        "client.now(); RealTime only in an integration layer's envelope code. Measuring real elapsed time " +
        "(Effect.timed, timeouts and Schedule in a step or a call) stays allowed, and so does the drift watch's one " +
        "clock_timestamp() read, which lives in packages/runtime/src/time/.",
    },
    { label: "counts", text: "Per-folder counts that only fall, as ADR-0041 D4." },
  ],
  chosen: "lint-zero",
  why:
    "Nothing has been written yet, so the count starts at zero and any read is new. A Postgres default of now() is a " +
    "second clock hidden in a migration: on a devnet it would stamp the wall's time beside the story's. The checks are " +
    "the static invariant time.no-direct-reads, so a breach fails CI rather than a review.",
  source: by(`${ADR} (D4 ambient-time); node_modules/effect/src/Clock.ts, src/DateTime.ts, src/workflow/DurableClock.ts`),
  affects: [f.system_capxul, f.component_backend, f.component_ponder, f.component_postgres, ...CLIENTS, f.component_devnet],
});

// ── worlds (aaron.world-clock) ─────────────────────────────────────────────────────────────

const WORLD = (evidence: string) => `Claude, world-clock design, 8 November 2026; evidence: ${evidence}`;

export const decision_time_worlds = defineDecision({
  id: "time.worlds",
  title: "Every world is self-contained with one clock: a devnet, a shared world, staging",
  question:
    "aaron.world-clock: a devnet, a staging network or a shared world is a self-contained world whose clock is " +
    "controlled, and everything in it follows that clock; a shared world may run faster than real time. Which worlds " +
    "does Capxul have, whose clock does each run on, and what may control it?",
  options: [
    {
      label: "three-worlds",
      text:
        "Three worlds besides production, each with one clock that everything in it follows, and each holding its " +
        "outside channels inside it (time.world-channels). A devnet: one machine, its clock the supervisor's, frozen or " +
        "running at a rate of 1 to 60 world seconds a real second, moved by warps and steps (the devnet's decisions " +
        "devnet.clock-rate and devnet.running-stops). A shared world: a devnet's stack hosted for several people, its " +
        "clock controlled the same way by its owner alone (devnet.shared-world). Staging: Base Sepolia, whose blocks " +
        "carry the sequencer's time, so its now is its hosts' clock (NTP), running at rate 1 and never moved; it is " +
        "self-contained by its channels and its parties, not by its clock. Production is the real world: real channels " +
        "and the hosts' clock. A world that must be both controlled and shared runs as a shared world, not as staging.",
    },
    {
      label: "controlled-staging",
      text: "Give staging a chain of its own (a hosted Anvil) so its clock can be controlled and run at a rate too.",
    },
  ],
  chosen: "three-worlds",
  why:
    "A clock is controlled only where Capxul mines the chain: one clock makes block time now (time.one-clock), and on " +
    "Base Sepolia neither the sequencer's time nor its pace is Capxul's, so a warp or a rate there would put now away " +
    "from the chain's time, the two clocks the one-clock design removed. Staging exists to run the real integrations on " +
    "a public testnet, measured by the live evals; a staging on its own chain would be a shared world with real vendors " +
    "and would no longer test the testnet. For Aaron: the ruling lists a staging network among the worlds whose clock " +
    "is controlled. The recommendation is that staging keeps Base Sepolia and the real clock, self-contained by its " +
    "channels, and that a controlled world others share is a shared world; it stands until he answers.",
  source: WORLD("books/target/shared/rulings.ts (aaron.world-clock); books/target/shared/foundation.ts (environments); docs/design/time.md section 7"),
  affects: [f.system_capxul, f.environment_devnet, f.environment_staging, f.environment_shared_world, f.component_devnet],
});

export const decision_time_world_channels = defineDecision({
  id: "time.world-channels",
  title: "Every outside channel belongs to its world and follows its clock",
  question:
    "aaron.world-clock: emails, WhatsApp, the Frappe head and the FDE follow the world's clock, and a world's outside " +
    "channels are its own (a devnet's mail goes to its sink, WhatsApp to a stand-in, a connected head follows the " +
    "clock). Which channels does each world hold, and how does each stay inside it?",
  options: [
    {
      label: "world-owns-channels",
      text:
        "A channel is a stand-in inside the world that follows its clock, or, on staging, the real service held to the " +
        "world's own parties. Mail: on a devnet and a shared world the sink, so none leaves, a shared world's joiner " +
        "reading only its own mailboxes; on staging Resend, but only to the mailboxes MAIL_ALLOWED_RECIPIENTS lists " +
        "(domains and addresses), a send to any other address refused before Resend as Resend refuses a recipient " +
        "(INVALID_INPUT), so the notice records the failure. A head's own email (ERPNext's and Frappe HR's notifications) " +
        "goes the same way: to the sink on a devnet and a shared world, and on staging only to those mailboxes, " +
        "through the Capxul app's mail hook. WhatsApp: a stand-in of Meta's Cloud API on a devnet and a shared world; " +
        "on staging only a Meta test number, which sends only to the recipients registered with it, so staging's " +
        "connect admits no other number. The Frappe head: a follower of the world's clock on a devnet and a shared " +
        "world, through the Capxul app's hooks; on staging a site on its host's clock. The FDE host: the stand-in on a devnet, the world's own namespace following " +
        "its clock in a shared world, the host's clock on staging. Bridge, the bundler and paymaster, Chainlink and " +
        "PostHog: the stand-ins and fakes already follow; Bridge's sandbox, which a banking eval may use on a devnet, " +
        "does not, so such an eval never relies on Bridge's own times, and a shared world uses only the stand-in. Every message is dated at the world's now; a vendor's envelope " +
        "stays real (time.real-elapsed). Production's channels are the real ones. The devnet's decisions say how: " +
        "devnet.shared-world, devnet.whatsapp-stand-in, devnet.head-follows-world, devnet.fde-host-follows-world and " +
        "devnet.stand-ins-follow.",
    },
    { label: "real-channels", text: "Send a world's mail and messages through the real services, dated by the world's clock." },
  ],
  chosen: "world-owns-channels",
  why:
    "A world's story is one story only if what it says to people happens inside it: an email dated next March from a " +
    "world at rate 4, sent to a real inbox, is a false message in the real world, and a code that went to a real inbox " +
    "could not be read by the eval that needs it. Holding each channel in its world keeps every date in it on one clock " +
    "and every party one of its own. Staging cannot keep Resend or Meta in a sink without ceasing to test them, so it " +
    "holds their recipients instead; Meta's own test number already sends only to registered recipients. For the owners " +
    "of the mail, frappe-head and fde-host integrations, and of the WhatsApp integration the CRM books: each one's text " +
    "says how it stays in its world.",
  source: WORLD("aaron.world-clock; docs/decisions/open-for-aaron.md (the CRM tracks every conversation); books/target/shared/external.ts (mail, frappe-head, fde-host)"),
  affects: [
    x.integration_mail, x.integration_frappe_head, x.integration_fde_host, x.integration_bridge, x.integration_bundler,
    x.integration_chainlink, x.integration_posthog, f.environment_devnet, f.environment_staging, f.environment_shared_world,
    f.component_frappe_app,
  ],
});

// ── invariants: each is an eval (inv:<id>) ──────────────────────────────────────────────────

export const invariant_time_one_now = defineInvariant({
  id: "time.one-now",
  title: "On a devnet, a settled clock is one instant everywhere",
  about:
    "What time.one-clock promises, checked after every call of the devnet time protocol that returns: warp, step, " +
    "settle, start-at, freeze, resume and a snapshot restore. The harness reads the authority, the chain head (by " +
    "eth_getBlockByNumber), the backend's now (from an rpc answer), Ponder's indexed block and every follower's " +
    "acknowledged clock, and compares them. On a frozen clock every move ends with a block at now (devnet.only-miner), " +
    "so the head's time is now. On a running clock the readings agree as one function of the authority's real clock " +
    "(the clock's now plus its rate times the real time since its `realAt`, never past its next stop), and between " +
    "stops the head may trail now, as on staging.",
  statement:
    "After a time call returns on a frozen devnet, the backend's now and every follower's acknowledged now equal the " +
    "authority's now, the chain head's time is that second, and Ponder has indexed the head.",
  over: [],
  check: "property",
});

export const invariant_time_blocks_at_now = defineInvariant({
  id: "time.blocks-at-now",
  title: "Every devnet block is mined at now",
  about:
    "The supervisor is the chain's only miner (decision devnet.only-miner), so a fact's block time is the instant it " +
    "happened. Checked over every block of an eval run: its timestamp against the authority's clock events.",
  statement:
    "Every block mined on a devnet has as its timestamp the authority's now, to the second, when it was mined; no block " +
    "is later than now, except the blocks mined before a start-at.",
  over: [],
  check: "property",
});

export const invariant_time_monotonic = defineInvariant({
  id: "time.monotonic",
  title: "Within a world, now never goes back",
  about:
    "A fuzz over random interleavings of warps, steps, freezes, resumes, product commands and settles: every now any " +
    "component reads, and every row time it writes, is not earlier than one read before, with rate changes, running " +
    "stops and followers on other machines in the mix (each follower caps now at the next stop and never reads back). " +
    "A start-at on a fresh world and a restore (which replaces the world and changes its epoch) are the only exceptions.",
  statement: "Within one world epoch, no component reads a now earlier than any now read before it.",
  over: [],
  check: "fuzz",
});

export const invariant_time_due_fires_once = defineInvariant({
  id: "time.due-fires-once",
  title: "A warp fires each due timer once, at its own instant",
  about:
    "The warp barrier (decision devnet.warp-barrier): the authority stops at each due instant in order, so a dated " +
    "payment due on day 10 of a 28-day warp runs on day 10, its transaction in a block dated day 10. Checked with " +
    "timers and crons placed at random instants across a warp, including timers that the work at one stop sets for a " +
    "later instant before T, and with `jobs` false, after which no skipped cron run is run late.",
  statement:
    "When a warp or step to T returns, every durable timer due by T fired once with its step reading its due instant, " +
    "and, unless `jobs` was false, every hourly-or-slower cron run due by T ran once at its scheduled instant.",
  over: [],
  check: "property",
});

export const invariant_time_replay_same_time = defineInvariant({
  id: "time.replay-same-time",
  title: "A resumed process decides at the same instants",
  about:
    "Effect Workflow replays a body when its instance resumes. Killing an instance at random points (inside a step, " +
    "between steps, while a timer waits) and resuming it must give the run an uninterrupted instance gives.",
  statement: "A workflow killed at any point and resumed reads the same instants and drives the same transitions as one never killed.",
  over: [],
  check: "fuzz",
});

export const invariant_time_no_direct_reads = defineInvariant({
  id: "time.no-direct-reads",
  title: "Only the clock module reads a clock",
  about: "The lint of decision time.no-direct-reads, run over every package, migration and SQL fragment in CI.",
  statement: "No product code, SQL or migration reads the time except through packages/runtime/src/time/.",
  over: [],
  check: "static",
});

export const invariant_time_frozen_deterministic = defineInvariant({
  id: "time.frozen-deterministic",
  title: "A frozen devnet replays a story at the same instants",
  about:
    "What a builder on top relies on for a deterministic simulated year (decision devnet.clock-modes): run the same " +
    "script twice from the same world, frozen, with a settle after each action, and compare the block timestamps, the " +
    "rows' times and the timers' firings. It rests on two things the run does not control: the pinned Anvil mines " +
    "several blocks in one second, so no tick is ever needed (B0 measures it; a tick depends on how transactions " +
    "batch, which is timing); and the script stays below the infrastructure rate limits, which run on real time.",
  statement:
    "On a frozen devnet, the same protocol calls and commands from the same world, each followed by a settle, give the " +
    "same block timestamps, row times and timer firings.",
  over: [],
  check: "property",
});

export const invariant_time_rate_ceiling = defineInvariant({
  id: "time.rate-ceiling",
  title: "A running clock never runs faster than its rate",
  about:
    "What a rate promises (devnet.clock-rate): reading the authority and every follower at random real moments on a " +
    "running devnet at rate r, with rate changes and outside followers' due reports in the mix, between two readings Δ " +
    "real seconds apart with no move between them now advanced by at most r·Δ, rounded to the second, and by exactly " +
    "r·(Δ − s), s being the real seconds the clock stood at stops in between.",
  statement: "On a running devnet at rate r, now advances by at most r seconds a real second, and stands still only at a stop.",
  over: [],
  check: "property",
});

export const invariant_time_running_stops = defineInvariant({
  id: "time.running-stops",
  title: "A running clock stops at every due instant it knew of",
  about:
    "The running stops (devnet.running-stops), at rates 1, 4 and 60: timers, crons and followers' next dues placed at " +
    "random instants a few world seconds to minutes ahead. A due instant reported at least one real second of running " +
    "(r world seconds) before now reached it is a stop: a block is dated that second before the backend fires what is " +
    "due, and, at a stop that settles within its limit, each timer's step reads its due instant. One reported later " +
    "makes a stop one real second of running after the report, at which the head is past it. No follower reads a now " +
    "later than a stop's instant before that stop.",
  statement:
    "On a running devnet, every due instant known at least one real second of running ahead is a stop at which the " +
    "chain head reaches that second and, when the stop settles within its limit, every durable timer due then fires " +
    "once, its step reading its due instant.",
  over: [],
  check: "property",
});

export const invariant_time_world_channels = defineInvariant({
  id: "time.world-channels",
  title: "Nothing a world sends leaves it",
  about:
    "time.world-channels, checked over every eval run and, on staging, over the mail integration's spans: every email " +
    "and WhatsApp message a devnet or shared world sends, a connected head's own email included, is in its mail sink " +
    "or its stand-in WhatsApp, dated at the world's now, and no call reached Resend, Meta or SMTP; on staging no email " +
    "went to an address outside MAIL_ALLOWED_RECIPIENTS.",
  statement:
    "On a devnet or a shared world every email and WhatsApp message sent is in its sink or stand-in at the world's now; " +
    "on staging no email goes to an address outside the deployment's mailboxes.",
  over: [],
  check: "property",
});
