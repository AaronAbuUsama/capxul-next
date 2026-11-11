// Devnet's Core SDK flows: the methods of the Core SDK's Node-only devnet entry (`connectDevnet()`)
// that compose more than one rpc, or that reach the devnet supervisor instead of the backend (A4).
//
// Two kinds. The clock and the saved worlds are the supervisor's (decisions
// devnet.supervisor-owns-time-and-worlds and devnet.time-protocol): those flows call `devnet-control`,
// the supervisor's public control protocol, and no backend rpc. The schema's local step kinds have no
// "outside call", so each supervisor call is a `cache` step (this machine's devnet state), or a `poll`
// step for an event stream, and the flow's `calls` names it (decision devnet.supervisor-steps). Three
// clock flows implement the frozen `dev time` commands, and one the new `dev time set`, which sets the
// rate a running clock runs at (decision devnet.clock-rate, for aaron.world-clock); six more are the
// protocol's other verbs, for people building on Capxul (surface `sdk`; the supervisor's
// `capxul-devnet time` commands are thin clients of the same protocol). In a shared world the same
// flows speak to the world's supervisor over HTTPS with the caller's world grant (decision
// devnet.season-players). Eleven more are the seasons a shared world runs in (decision devnet.seasons, for
// aaron.seasons): the `dev season` commands, each one request to the supervisor, which keeps the seasons
// on the world's host outside its snapshots. The other three flows compose backend rpcs: `dev approve` signs in as
// the person it plays and signs as the approval page would; `dev gates set` and `dev prices set`
// script a value and run the one sync that makes it apply. `dev jobs run` and the three mail commands
// are one rpc each, so they have no flow.

import { Schema } from "effect";
import { budget, defineFlow } from "../../../packages/book/src/index.ts";
import { component_core_sdk } from "../shared/foundation.ts";
import { integration_devnet_control } from "../shared/external.ts";
import {
  error_CANCELLED,
  error_CLI_USAGE,
  error_INVALID_INPUT,
  error_WRONG_ENVIRONMENT,
  error_WRONG_STATE,
} from "../shared/vocabulary.ts";
import { rpc_access_sign_in_send_code, rpc_access_sign_in_verify_code } from "../access/sign-in.ts";
import { ApprovalView, rpc_approvals_signing_get, rpc_approvals_signing_sign } from "../approvals/signing.ts";
import { rpc_organizations_workspaces_list } from "../organizations/workspaces.ts";
import { Ceiling, rpc_devnet_gates_read, rpc_devnet_gates_script } from "./gates.ts";
import { JobOutcome, rpc_devnet_jobs_run } from "./jobs.ts";
import { rpc_devnet_mail_list } from "./mail.ts";
import { rpc_devnet_prices_script } from "./prices.ts";

const SDK = "packages/sdk/src/devnet/index.ts";
const WORLD = "packages/devnet/src/modules/world/service.ts";
const CONTROL = "packages/protocol/src/devnet/control.ts";

const S = Schema.String;
const N = Schema.Number;
const B = Schema.Boolean;
const Instant = Schema.DateTimeUtc;
const control = integration_devnet_control.c;

// ── shapes the supervisor answers ───────────────────────────────────────────────────────────

/** Whether now runs on at the clock's rate from where it was set, or stands still until it is moved. */
export const ClockMode = Schema.Literals(["running", "frozen"]);
/** Seconds of world time in each real second while the clock runs: a whole number from 1 to 60 (decision devnet.clock-rate). */
export const ClockRate = Schema.Int;
/** The one clock, as the time authority holds it (decision devnet.supervisor-owns-time-and-worlds). */
export const Clock = Schema.Struct({
  /** `capxul.devnet/1.<minor>`: the protocol version that answered. */
  protocol: S,
  now: Instant,
  /** The authority's real time when now held that value: running, now is `now` plus `rate` times the real time since `realAt`, up to `stopAt`. */
  realAt: Instant,
  mode: ClockMode,
  /** World seconds per real second while running; a frozen clock keeps it for when it runs (decision devnet.clock-rate). */
  rate: ClockRate,
  /** Running: the next stop, the instant now stands at until the next event (decision devnet.running-stops); null when nothing is due. */
  stopAt: Schema.NullOr(Instant),
  /** The authority's real time as it answered, from which a follower on another machine measures its offset (decision devnet.follow-at-a-rate). */
  realNow: Instant,
  /** Increases with every change of the clock; a follower acknowledges it. */
  version: Schema.Int,
  /** The world's epoch: a new one at `up` and at every restore, so a subscriber tells a restore from a move. */
  world: S,
  /** Whether a warp, step or start-at has moved this world's clock: start-at needs a world that has not begun. */
  moved: B,
  /** The season running in this world epoch, or null between seasons and on a world that runs none (decision devnet.seasons). */
  season: Schema.NullOr(S),
});
/** The chain's head: its block and the instant it was mined at. */
export const ChainHead = Schema.Struct({ block: N, at: Instant });
/** How far Ponder has indexed, and whether it has reached the chain's head. */
export const IndexerPosition = Schema.Struct({ block: Schema.NullOr(N), caughtUp: B });
/**
 * A follower of the clock (decision devnet.followers): the backend, Ponder, the stand-ins, or an outside program.
 * `stateful`: it keeps world state outside the world's chain and Postgres (a real Frappe bench, the world's FDE
 * namespace), which it saves and restores with every saved world (decision devnet.stateful-followers).
 */
export const Follower = Schema.Struct({ name: S, version: Schema.Int, idle: B, nextDue: Schema.NullOr(Instant), stateful: B });
/** One event of the clock, as `watch` and `follow` deliver it. */
export const ClockEvent = Schema.Struct({
  version: Schema.Int,
  now: Instant,
  realAt: Instant,
  mode: ClockMode,
  rate: ClockRate,
  stopAt: Schema.NullOr(Instant),
  world: S,
  /** The season running in this world epoch, or null (decision devnet.seasons). */
  season: Schema.NullOr(S),
  /**
   * `rate`: the rate changed; `run`: a running clock runs on from a stop (with the followers a cut-short stop left busy);
   * `due`: an earlier due instant became the next stop (decisions devnet.clock-rate and devnet.running-stops); `save`:
   * a world is being saved, and a stateful follower saves its own state under `snapshot` before it acknowledges;
   * `restore`: a world is being restored, the clock frozen at its now, and a stateful follower restores its own state
   * from `snapshot` before it acknowledges (decision devnet.stateful-followers). A season's start and its reset are
   * restores (decision devnet.season-reset).
   */
  reason: Schema.Literals(["warp", "stop", "step", "tick", "settle", "freeze", "resume", "rate", "run", "due", "start-at", "save", "restore", "up"]),
  /** On a `save` or a `restore`: the saved world's name; else null. */
  snapshot: Schema.NullOr(S),
  /** On a `run` after a stop its limit cut short: the followers still busy; else empty. */
  unsettled: Schema.Array(S),
});
/** What a move of the clock did: where it went, the stops on the way, what fell due and ran, and where everything stands. */
const Moved = Schema.Struct({
  from: Instant,
  to: Instant,
  moved: S,
  stops: Schema.Int,
  chain: ChainHead,
  backend: Schema.Struct({ now: Instant, jobs: Schema.Array(JobOutcome), timersFired: Schema.Int }),
  indexer: IndexerPosition,
  clock: Clock,
});
/**
 * A saved world, as `dev snapshot list` and `save` print it. `followers`: the stateful followers whose own state was
 * saved with it (decision devnet.stateful-followers); `season`: the season whose end saved it as its last state, else
 * null (decision devnet.season-reset).
 */
export const Snapshot = Schema.Struct({
  name: S,
  at: Instant,
  mode: ClockMode,
  rate: ClockRate,
  savedAt: Instant,
  code: S,
  followers: Schema.Array(S),
  season: Schema.NullOr(S),
});

const SUPERVISOR_ERRORS = "The supervisor's own refusals are the `devnet-control` call's failures.";
const BARRIER =
  "It is a barrier (decision devnet.warp-barrier): the clock stops at every due second on the way, in order, each " +
  "next stop chosen after the last settled, and at each the backend's timers and crons due by then run once, the " +
  "chain's head reaches that second and every follower settles.";

// ── the clock: the frozen `dev time` commands ───────────────────────────────────────────────

export const flow_devnet_time_show = defineFlow({
  id: "devnet.time.show",
  title: "Read the devnet's one clock, the chain head and how far Ponder has indexed",
  about:
    "`dev time`. One read of the time authority: the clock (now, running or frozen, its rate and next stop, its version, " +
    "world and season), the chain head's block and time, the backend's now, Ponder's position, each follower, and whether they " +
    "agree: every follower " +
    "has taken the clock's current version and no block is later than now. With no devnet on this machine, the call is " +
    "refused WRONG_ENVIRONMENT before anything reaches the network. " + SUPERVISOR_ERRORS,
  was: [`${SDK}:260`, `${WORLD}:367`, `${CONTROL}:107`],
  component: component_core_sdk,
  sdk: "devnet.time.show",
  input: Schema.Struct({}),
  output: Schema.Struct({
    clock: Clock,
    chain: ChainHead,
    backend: Schema.Struct({ now: Instant }),
    indexer: IndexerPosition,
    followers: Schema.Array(Follower),
    agree: B,
  }),
  steps: [{ name: "read", local: "cache", about: "devnet-control timeRead: the clock, the chain head, the backend's now, Ponder and the followers." }],
  errors: [],
  calls: [control.timeRead],
  spans: [],
  budget: budget("read"),
});

export const flow_devnet_time_warp = defineFlow({
  id: "devnet.time.warp",
  title: "Move the devnet's clock forward, running what falls due on the way",
  about:
    "`dev time warp`. The SDK turns a duration (`6h`, `28d`) or a date (`--to`; a date alone is 09:00 UTC) into one " +
    "request: both or neither is INVALID_INPUT before any call, and a duration is sent as a span for the supervisor to " +
    "resolve against its now. The supervisor refuses a target not later than now (INVALID_INPUT). " + BARRIER + " It " +
    "returns when the chain has a block at the target, the backend reads it and Ponder has indexed it. `jobs` false " +
    "skips the crons that fell due, and they stay skipped (their next runs move past the target); every durable timer " +
    "due still fires, because it is due. A cron that fails does not undo the warp: the answer names it. The clock " +
    "keeps its mode and its rate: a frozen clock stays frozen at the target, and a running one runs on from it at its " +
    "rate. " + SUPERVISOR_ERRORS,
  was: [`${SDK}:261`, `${SDK}:267`, `${WORLD}:465`, `${WORLD}:518`, `${CONTROL}:134`],
  component: component_core_sdk,
  sdk: "devnet.time.warp",
  input: Schema.Struct({ by: Schema.optionalKey(S), to: Schema.optionalKey(S), jobs: B }),
  output: Moved,
  steps: [
    { name: "target", local: "build", about: "One request from the duration or the date; both or neither is INVALID_INPUT." },
    { name: "warp", local: "cache", about: "devnet-control timeWarp: stop at each due instant, mine there, run what fell due, settle." },
  ],
  errors: [error_INVALID_INPUT],
  calls: [control.timeWarp],
  spans: [],
  budget: budget("background"),
});

export const flow_devnet_time_start_at = defineFlow({
  id: "devnet.time.start-at",
  title: "Set a fresh devnet's story in the past",
  about:
    "`dev time start-at`. The SDK reads the date (a date alone is 09:00 UTC). The supervisor refuses a date not earlier " +
    "than now (INVALID_INPUT) and a world whose clock a warp, step or start-at already moved (WRONG_STATE), then sets " +
    "now back to the date for every follower, mines a block at that moment and settles. It is the one move back in a " +
    "world's life (decision devnet.start-at); from then on the story only moves forward. " + SUPERVISOR_ERRORS,
  was: [`${SDK}:272`, `${WORLD}:417`, `${WORLD}:447`],
  component: component_core_sdk,
  sdk: "devnet.time.startAt",
  input: Schema.Struct({ date: S }),
  output: Schema.Struct({ from: Instant, to: Instant, chain: ChainHead, backend: Schema.Struct({ now: Instant }), clock: Clock }),
  steps: [
    { name: "date", local: "build", about: "The start date; a date alone is 09:00 UTC that day, an unreadable one INVALID_INPUT." },
    { name: "start", local: "cache", about: "devnet-control timeStartAt: now back to the date everywhere, one block mined there." },
  ],
  errors: [error_INVALID_INPUT],
  calls: [control.timeStartAt],
  spans: [],
  budget: budget("chain-settle"),
});

// ── the clock's rate: the new `dev time set` (aaron.world-clock) ────────────────────────────

const RATE_RULE = "a whole number from 1 to 60";

export const flow_devnet_time_set = defineFlow({
  id: "devnet.time.set",
  title: "Set how fast the devnet's clock runs: world seconds per real second",
  about:
    `\`dev time set --rate <n>\`. The SDK refuses a missing \`--rate\`, or one that is not ${RATE_RULE}, ` +
    "INVALID_INPUT before any call (a `set` that gives nothing, the new commands' grammar's G6). The supervisor reads now at the change " +
    "and sends every follower a `rate` event, so all of them run on at the new rate from the same instant: four is " +
    "up to four hours of world time each real hour, less the moments the clock stands at stops. A running clock speeds up or slows down from now, through the same " +
    "running stops (decision devnet.running-stops); a frozen clock stays frozen, keeps the rate and runs at it when " +
    "it resumes. Nothing moves back and nothing is mined. It answers the clock. A move of the clock already running " +
    "is WRONG_STATE; in a shared world only its owner sets the rate (decision devnet.clock-rate). " + SUPERVISOR_ERRORS,
  component: component_core_sdk,
  sdk: "devnet.time.set",
  input: Schema.Struct({ rate: Schema.optionalKey(ClockRate) }),
  output: Clock,
  steps: [
    { name: "rate", local: "build", about: `The rate, ${RATE_RULE}; missing or outside the range is INVALID_INPUT.` },
    { name: "set", local: "cache", about: "devnet-control timeRate: the new rate from now, for every follower." },
  ],
  errors: [error_INVALID_INPUT],
  calls: [control.timeRate],
  spans: [],
  budget: budget("write"),
});

// ── the clock: the protocol's other verbs, for people building on Capxul ────────────────────

const SDK_ONLY =
  "No CLI command: the Core SDK's devnet entry serves it to programs built on Capxul, and `capxul-devnet time` is the " +
  "supervisor's own thin client of the same request (decision devnet.time-protocol).";

export const flow_devnet_time_freeze = defineFlow({
  id: "devnet.time.freeze",
  title: "Hold the devnet's clock still until it is moved",
  about:
    "Holds now at the next whole second (never back), for every follower, until a warp, step or resume moves it, so a " +
    "program's own steps happen at instants it chooses (decision devnet.clock-modes). The rate is kept for the next " +
    "resume. Freezing a frozen clock changes nothing. " + SDK_ONLY,
  was: [`${WORLD}:240`],
  component: component_core_sdk,
  sdk: "devnet.time.freeze",
  input: Schema.Struct({}),
  output: Clock,
  steps: [{ name: "freeze", local: "cache", about: "devnet-control timeFreeze." }],
  errors: [],
  calls: [control.timeFreeze],
  spans: [],
  surfaces: ["sdk"],
  budget: budget("write"),
});

export const flow_devnet_time_resume = defineFlow({
  id: "devnet.time.resume",
  title: "Let the devnet's clock run on at its rate",
  about:
    "Lets now run on from where it stands, at the clock's rate (one by default; `dev time set --rate`), for every " +
    "follower, stopping at each due instant on the way (decision devnet.running-stops). Resuming a running clock " +
    "changes nothing. " + SDK_ONLY,
  was: [`${WORLD}:240`],
  component: component_core_sdk,
  sdk: "devnet.time.resume",
  input: Schema.Struct({}),
  output: Clock,
  steps: [{ name: "resume", local: "cache", about: "devnet-control timeResume." }],
  errors: [],
  calls: [control.timeResume],
  spans: [],
  surfaces: ["sdk"],
  budget: budget("write"),
});

export const flow_devnet_time_step = defineFlow({
  id: "devnet.time.step",
  title: "Move the devnet's clock to the next instant anything is due",
  about:
    "Moves now to the earliest instant anything is due (a durable timer, a cron run, a follower's own next due), or to " +
    "`limit` when nothing is due before it, and settles there, as one stop of a warp. With nothing due and no limit, " +
    "now stays and the answer says so. A limit not later than now is INVALID_INPUT. A discrete-event simulation drives " +
    "the story this way, one happening at a time. " + SDK_ONLY,
  was: [`${WORLD}:465`],
  component: component_core_sdk,
  sdk: "devnet.time.step",
  input: Schema.Struct({ limit: Schema.optionalKey(S) }),
  output: Moved,
  steps: [{ name: "step", local: "cache", about: "devnet-control timeStep: to the next due instant, not past the limit, then settle." }],
  errors: [],
  calls: [control.timeStep],
  spans: [],
  surfaces: ["sdk"],
  budget: budget("background"),
});

export const flow_devnet_time_settle = defineFlow({
  id: "devnet.time.settle",
  title: "Wait until everything due at now has run, without moving the clock",
  about:
    "Waits until the backend's due timers and crons have run, its outbox is delivered and its waits woken, every pending " +
    "transaction is mined at now (with the empty blocks its depth waits need), Ponder has indexed the head and every " +
    "follower is idle, all in one settle round with nothing changing during it. A program calls it after each of its " +
    "own actions, so the next one starts from a settled world; a follower never calls it from its own handler, where " +
    "it would wait on itself (it acknowledges busy instead). " + SDK_ONLY,
  was: [`${WORLD}:292`],
  component: component_core_sdk,
  sdk: "devnet.time.settle",
  input: Schema.Struct({}),
  output: Schema.Struct({ clock: Clock, rounds: Schema.Int, timersFired: Schema.Int, jobs: Schema.Array(JobOutcome), indexer: IndexerPosition }),
  steps: [{ name: "settle", local: "cache", about: "devnet-control timeSettle." }],
  errors: [],
  calls: [control.timeSettle],
  spans: [],
  surfaces: ["sdk"],
  budget: budget("background"),
});

export const flow_devnet_time_watch = defineFlow({
  id: "devnet.time.watch",
  title: "Follow the devnet clock's changes as they happen",
  about:
    "A stream of the clock's events: each warp, stop, step, tick, freeze, resume, rate change, run, due, start-at, save " +
    "and restore, with its version, now, realAt, mode, rate, next stop, world and season. It only reads: the barrier does not wait " +
    "for a watcher (follow for that), and in a shared world any grant may watch. " + SDK_ONLY,
  was: [`${CONTROL}:107`],
  component: component_core_sdk,
  sdk: "devnet.time.watch",
  input: Schema.Struct({ after: Schema.optionalKey(Schema.Int) }),
  output: ClockEvent,
  steps: [{ name: "events", local: "poll", about: "devnet-control timeWatch: the clock's server-sent events, from `after`'s version on." }],
  errors: [],
  calls: [control.timeWatch],
  spans: [],
  surfaces: ["sdk"],
  budget: budget("live-read"),
});

export const flow_devnet_time_follow = defineFlow({
  id: "devnet.time.follow",
  title: "Join the devnet's clock as a follower its barrier waits for",
  about:
    "Joins the time authority under a name (one at a time per name: WRONG_STATE). At every stop the follower's handler " +
    "gets the clock event with now standing still, does its own work at that instant (a simulated customer's deposit, " +
    "a stand-in's scheduled answer), and returns whether it is idle and its own next due instant (later than now, or " +
    "none); the SDK acknowledges it, and the warp stops at that instant too. The handler may call Capxul (the CLI, the " +
    "SDK, its own transactions, which the supervisor mines at now) but not move the clock: one move runs at a time. " +
    "Between events it reports a new earlier due instant at once, so a running clock stops there too, and it computes " +
    "now as min(stopAt, now + rate × real time since realAt) (decision devnet.follow-at-a-rate). A follower that does " +
    "not acknowledge in time fails the barrier (WORK_DIED, naming it) and is dropped (decision devnet.followers). A " +
    "follower that keeps world state outside the chain and Postgres (a real Frappe bench, the world's FDE namespace) joins " +
    "`stateful`: at a `save` event it saves that state under the event's world name and at a `restore` it restores it, " +
    "each before it acknowledges, and on joining it is told the world it must hold, which it restores first (decision " +
    "devnet.stateful-followers). In a shared world only the owner's or a follower grant may follow. " + SDK_ONLY,
  was: [`${WORLD}:292`, "/home/user/factory packages/vending-bench/src/bridge.ts:99"],
  component: component_core_sdk,
  sdk: "devnet.time.follow",
  input: Schema.Struct({ name: S, ackTimeoutMs: Schema.optionalKey(Schema.Int), stateful: Schema.optionalKey(B) }),
  output: ClockEvent,
  steps: [
    { name: "join", local: "cache", about: "devnet-control timeFollow: join under the name, `stateful` or not; a stateful follower first takes the world it must hold." },
    { name: "events", local: "poll", about: "The follower's clock events, one per stop and change." },
    { name: "state", local: "cache", about: "A stateful follower, at a `save` or `restore` event: its own state saved under, or restored from, the event's world name." },
    { name: "ack", local: "cache", about: "After the handler: the version taken, idle or busy, and the next due instant." },
    { name: "due", local: "cache", about: "Between events: a new earlier due instant, reported at once." },
  ],
  errors: [],
  calls: [control.timeFollow],
  spans: [],
  surfaces: ["sdk"],
  budget: budget("live-read"),
});

// ── saved worlds ────────────────────────────────────────────────────────────────────────────

const NAME_RULE = "lowercase letters, digits and hyphens, up to 40 characters";

export const flow_devnet_snapshots_list = defineFlow({
  id: "devnet.snapshots.list",
  title: "List the worlds saved on this machine, by world time",
  about:
    "`dev snapshot list`. The supervisor lists the worlds in its store on this machine (the eval worlds the catalog " +
    "builds and any a developer saved), each with its name, its world time and clock mode, when it was saved and the backend code it was " +
    "saved with; the SDK orders them by world time, then name. It reads no backend data. " + SUPERVISOR_ERRORS,
  was: [`${SDK}:291`, `${WORLD}:560`, "docs/as-is/archive/operations/devnet.ts:212"],
  component: component_core_sdk,
  sdk: "devnet.snapshots.list",
  input: Schema.Struct({}),
  output: Schema.Struct({ snapshots: Schema.Array(Snapshot) }),
  steps: [
    { name: "list", local: "cache", about: "devnet-control snapshotList: the saved worlds and their manifests." },
    { name: "order", local: "build", about: "By world time, then name." },
  ],
  errors: [],
  calls: [control.snapshotList],
  spans: [],
  budget: budget("read"),
});

export const flow_devnet_snapshots_save = defineFlow({
  id: "devnet.snapshots.save",
  title: "Save the whole devnet world under a name",
  about:
    `\`dev snapshot save\`. The SDK refuses a name that is not ${NAME_RULE} (INVALID_INPUT) before any call. The ` +
    "supervisor refuses a name already saved unless `replace` (WRONG_STATE), then saves the chain's state, Postgres (the " +
    "concepts' `app` schema, Ponder's `ponder` schema and devnet's own, with the durable workflows' state), Ponder's " +
    "checkpoint, the world's clock (its now, mode and rate) and its armed fault switches, and the eval machine's CLI home, together, with the " +
    "backend code it runs, and asks every stateful follower joined (a real Frappe bench, the world's FDE namespace) to save " +
    "its own state under the name, listing them in the world's manifest (decision devnet.stateful-followers). The devnet " +
    "itself is unchanged. " + SUPERVISOR_ERRORS,
  was: [`${SDK}:281`, `${WORLD}:580`, `${WORLD}:614`, `${CONTROL}:150`],
  component: component_core_sdk,
  sdk: "devnet.snapshots.save",
  input: Schema.Struct({ name: S, replace: B }),
  output: Snapshot,
  steps: [
    { name: "name", local: "build", about: `The name must be ${NAME_RULE}.` },
    { name: "save", local: "cache", about: "devnet-control snapshotSave: chain, Postgres, Ponder, clock, faults and CLI home, together." },
  ],
  errors: [error_INVALID_INPUT],
  calls: [control.snapshotSave],
  spans: [],
  budget: budget("background"),
});

export const flow_devnet_snapshots_restore = defineFlow({
  id: "devnet.snapshots.restore",
  title: "Put the devnet back to a saved world",
  about:
    `\`dev snapshot restore\`. The SDK refuses a name that is not ${NAME_RULE} (INVALID_INPUT). The supervisor refuses ` +
    "a name it has not saved (INVALID_INPUT, listing the worlds), a world saved with other backend code (WRONG_STATE: " +
    "replay its builder instead), a world whose manifest lacks a stateful follower joined now (WRONG_STATE, naming it) " +
    "and, in a world that runs seasons, a restore while a season runs (WRONG_STATE: end the season first; decision " +
    "devnet.season-reset), then stops the backend and Ponder, replaces the chain's state, Postgres and Ponder's " +
    "checkpoint with the world's, sets the clock to the world's now (frozen while it works, then the world's mode and " +
    "rate, under a new world epoch), asks each stateful follower to restore its own state from the world and waits for " +
    "them, re-arms its fault switches, restores the CLI home, and starts them again; the durable processes " +
    "resume from their stored state, each timer due at the instant it was stored with, so none needs moving. " +
    "It answers the world's time and how long it took. " + SUPERVISOR_ERRORS,
  was: [`${SDK}:285`, `${WORLD}:677`, `${WORLD}:767`, `${CONTROL}:169`],
  component: component_core_sdk,
  sdk: "devnet.snapshots.restore",
  input: Schema.Struct({ name: S }),
  output: Schema.Struct({
    name: S,
    at: Instant,
    chain: Schema.Struct({ at: Instant, block: N }),
    backend: Schema.Struct({ now: Instant }),
    clock: Clock,
    tookMs: N,
  }),
  steps: [
    { name: "name", local: "build", about: `The name must be ${NAME_RULE}.` },
    { name: "restore", local: "cache", about: "devnet-control snapshotRestore: the world's chain, Postgres, Ponder, clock, faults and CLI home." },
  ],
  errors: [error_INVALID_INPUT],
  calls: [control.snapshotRestore],
  spans: [],
  budget: budget("background"),
});

// ── seasons: the `dev season` commands (aaron.seasons; decision devnet.seasons) ─────────────────

/**
 * Where a season is in its life (decision devnet.seasons): made and waiting (`planned`), running in the world, over
 * after it ran, its last world kept (`ended`), or taken back before it ran, by `dev season cancel` or by its real end
 * coming first (`cancelled`), which touches nothing in the world.
 */
export const SeasonState = Schema.Literals(["planned", "running", "ended", "cancelled"]);
/**
 * Where one of a season's scheduled warps is: due at its real instant, running, done, cut short at a settled stop by
 * the season's end, failed at a stop that did not settle, skipped (its target was not later than now when it came due,
 * the season ended or was cancelled before it came due, or the season's end was overdue too) or removed before it ran (decision
 * devnet.season-jumps).
 */
export const SeasonWarpState = Schema.Literals(["scheduled", "running", "done", "cut", "failed", "skipped", "removed"]);
/** One warp of a season's schedule: a warp of the world's clock that the supervisor runs at a real instant. */
export const SeasonWarp = Schema.Struct({
  /** `w1`, `w2`, … in the order they were added to the season. */
  id: S,
  /** The real instant it comes due. */
  at: Instant,
  /** How far it warps, as `dev time warp` takes it (`30d`), or null when it warps to `to`. */
  by: Schema.NullOr(S),
  /** The world instant it warps to, or null when it warps by `by`. */
  to: Schema.NullOr(Instant),
  state: SeasonWarpState,
  /** The real instant it began, or null while scheduled or removed. */
  ranAt: Schema.NullOr(Instant),
  /** The world's now when it began and where it stood when it ended, or null until it runs. */
  from: Schema.NullOr(Instant),
  reached: Schema.NullOr(Instant),
  /** The stops it made, or null until it runs. */
  stops: Schema.NullOr(Schema.Int),
  /** For a cut, failed or skipped warp: why, with the stop and the busy followers; else null. */
  note: Schema.NullOr(S),
});
/**
 * A season, as the supervisor keeps it on the world's host outside the world's snapshots, beside the grants (decision
 * devnet.seasons). Its start, end and warps are real instants; the world's own times are its clock's.
 */
export const Season = Schema.Struct({
  /** Lowercase letters, digits and hyphens, up to 36 characters, so that `<name>-end` is a world's name. Never reused. */
  name: S,
  state: SeasonState,
  /** The saved world it starts from. */
  from: S,
  /** The saved world its end restores: its own `from` unless it was given another. */
  reset: S,
  /** The world seconds per real second its clock runs at from its start (decision devnet.clock-rate). */
  rate: ClockRate,
  /** The real instant it starts itself, or null when its owner starts it with `dev season start`. */
  startAt: Schema.NullOr(Instant),
  /** The real instant it ends itself. */
  endAt: Instant,
  /** The real instants it started and ended (or was cancelled), or null until they happen. */
  startedAt: Schema.NullOr(Instant),
  endedAt: Schema.NullOr(Instant),
  /** The world epoch its start began (the clock's `world`), or null until it starts. */
  world: Schema.NullOr(S),
  /** The emails of the people who play it, each holding a world grant (decision devnet.season-players). */
  players: Schema.Array(S),
  warps: Schema.Array(SeasonWarp),
  /** The saved world that keeps its last state, `<name>-end`, once a running season ended; else null. */
  final: Schema.NullOr(S),
  /** A scheduled start that could not happen, and why (the season stays planned, or is cancelled when its end came first); else null. */
  note: Schema.NullOr(S),
});

const SEASON_RULE = "lowercase letters, digits and hyphens, up to 36 characters";
const WHEN =
  "A real time is an ISO 8601 instant with its zone, or `+<span>` (`+2h`, `+28d`), which the supervisor resolves against " +
  "its own real clock as it answers.";
/*
 * Each season flow calls its request of the `devnet-control` integration (decision devnet.season-protocol); the
 * supervisor's answers (INVALID_INPUT, WRONG_STATE, ROLE_PERMISSION_DENIED) are those calls' failures, and a flow's own
 * errors are only what the SDK refuses before any call.
 */
const OWNER_ONLY =
  "Only the world's owner may: on a local devnet anyone on the machine, in a shared world the holder of its owner grant; " +
  "a joiner's grant is ROLE_PERMISSION_DENIED (decision devnet.season-players).";

export const flow_devnet_seasons_create = defineFlow({
  id: "devnet.seasons.create",
  title: "Plan a season: its starting world, rate, end, warps and players",
  about:
    "`dev season create <name> --snapshot <world> --end <when> [--start <when>] [--rate <n>] [--reset <world>] [--player " +
    `<email>]… [--warp <when>=<span|date>]…\`. The SDK refuses a name that is not ${SEASON_RULE}, a rate that is not ` +
    `${RATE_RULE}, an unreadable time and a \`--warp\` without both parts (INVALID_INPUT) before any call. ${WHEN} The ` +
    "supervisor refuses a `--snapshot` or `--reset` that names no world saved here (INVALID_INPUT, listing them), an end " +
    "not later than the start (or now), a start not later than now, a warp outside the season's window, a window that " +
    "overlaps another planned or running season (naming it) and a player who holds no world grant here (a local devnet " +
    "has none) (INVALID_INPUT); a name any season has had, or one whose `<name>-end` is a saved world (WRONG_STATE). " +
    "Then it keeps the season, planned: nothing in the world moves. Its reset is its own `from` unless `--reset` names " +
    "another world, the next season's start. " + OWNER_ONLY,
  component: component_core_sdk,
  sdk: "devnet.seasons.create",
  input: Schema.Struct({
    name: S,
    from: S,
    end: S,
    start: Schema.optionalKey(S),
    rate: Schema.optionalKey(ClockRate),
    reset: Schema.optionalKey(S),
    players: Schema.Array(S),
    warps: Schema.Array(Schema.Struct({ at: S, by: Schema.optionalKey(S), to: Schema.optionalKey(S) })),
  }),
  output: Season,
  steps: [
    { name: "season", local: "build", about: `The name (${SEASON_RULE}), the rate (${RATE_RULE}), the times and each \`--warp\` split into its real instant and its span or date.` },
    { name: "create", local: "cache", about: "The supervisor's season create (POST /v1/seasons): checks the worlds, the window and the players, then keeps the season, planned." },
  ],
  errors: [error_INVALID_INPUT],
  calls: [control.seasonCreate],
  spans: [],
  budget: budget("write"),
});

export const flow_devnet_seasons_change = defineFlow({
  id: "devnet.seasons.change",
  title: "Change a season's start, end, rate or reset",
  about:
    "`dev season change <name> [--start <when>] [--end <when>] [--rate <n>] [--reset <world>]`. A change that gives " +
    "nothing, an unreadable time or a rate that is not " + RATE_RULE + " is INVALID_INPUT before any call (G6). " + WHEN +
    " The supervisor refuses a name no season has, an end not later than now (or the start), a window that overlaps " +
    "another season's and a `--reset` that names no saved world (INVALID_INPUT); an ended or cancelled season, and " +
    "`--start` or `--rate` once it runs (WRONG_STATE: a running season's clock takes its rate from `dev time set`). Moving the end " +
    "of a running season moves when it ends and resets; a scheduled warp left after the new end is skipped when the " +
    "season ends. It answers the season. " + OWNER_ONLY,
  component: component_core_sdk,
  sdk: "devnet.seasons.change",
  input: Schema.Struct({
    name: S,
    start: Schema.optionalKey(S),
    end: Schema.optionalKey(S),
    rate: Schema.optionalKey(ClockRate),
    reset: Schema.optionalKey(S),
  }),
  output: Season,
  steps: [
    { name: "fields", local: "build", about: "At least one field, each readable; nothing given is INVALID_INPUT." },
    { name: "change", local: "cache", about: "The supervisor's season change (POST /v1/seasons/<name>/change)." },
  ],
  errors: [error_INVALID_INPUT],
  calls: [control.seasonChange],
  spans: [],
  budget: budget("write"),
});

const PREVIEW =
  "It previews what it will do and asks, since nothing undoes it (G5): a person who answers no ends it CANCELLED with " +
  "nothing changed, and a script passes `--confirm`, without which it is CLI_USAGE (vocabulary.declined-preview-cancelled).";

export const flow_devnet_seasons_start = defineFlow({
  id: "devnet.seasons.start",
  title: "Start a season now: its starting world, running at its rate",
  about:
    "`dev season start <name> [--confirm]`. The supervisor first checks the start without making it (a name no season " +
    "has is INVALID_INPUT; a season running, ended or cancelled, another season running, its end already past, or its starting world " +
    "saved with other backend code or without a stateful follower joined now is WRONG_STATE, naming which) and answers " +
    "what it will do: replace the world with `from`, at that world's now, run at the season's rate until its end, with " +
    "its warps and players. " + PREVIEW + " Then it starts the season as it would at a scheduled start: it restores " +
    "`from` (the clock frozen at its now while it works, every stateful follower restoring its own state, a new world " +
    "epoch), sets the clock's rate to the season's, lets it run, arms the season's warps and end on its real clock, and " +
    "has the world's gateway admit the season's players (decision devnet.season-reset). It answers the season and the " +
    "clock, which names the season. " + OWNER_ONLY,
  component: component_core_sdk,
  sdk: "devnet.seasons.start",
  input: Schema.Struct({ name: S, confirm: B }),
  output: Schema.Struct({ season: Season, clock: Clock, tookMs: N }),
  steps: [
    { name: "check", local: "cache", about: "The supervisor's season start with `check` (POST /v1/seasons/<name>/start): refusals first, then what it would do; nothing changes." },
    { name: "preview", local: "prompt", about: "What starting replaces and runs; no is CANCELLED, a script without `--confirm` CLI_USAGE." },
    { name: "start", local: "cache", about: "The supervisor's season start: restore `from`, set the rate, run, arm the warps and the end, admit the players." },
  ],
  errors: [error_CANCELLED],
  calls: [control.seasonStart],
  spans: [],
  budget: budget("background"),
});

export const flow_devnet_seasons_end = defineFlow({
  id: "devnet.seasons.end",
  title: "End a season now: keep its last state, then reset the world",
  about:
    "`dev season end <name> [--confirm]`. The supervisor first checks the end without making it (a name no season has " +
    "is INVALID_INPUT; a season that is not running is WRONG_STATE, and a planned one's refusal names `dev season " +
    "cancel`, so `end` always resets the world) and answers what it will do. " + PREVIEW + " The end does what the " +
    "season's scheduled end does (decision " +
    "devnet.season-reset): the world's gateway stops admitting its players; a warp in progress stops at its next settled " +
    "stop (`cut`) and the warps still scheduled are skipped; the clock freezes; the world is saved as `<name>-end`, its " +
    "last state, every stateful follower saving its own; then the season's reset world is restored, frozen at its now " +
    "under a new world epoch, every stateful follower restoring its own state, and stays so until the next season " +
    "starts. It answers the season, its last world and the clock. " + OWNER_ONLY,
  component: component_core_sdk,
  sdk: "devnet.seasons.end",
  input: Schema.Struct({ name: S, confirm: B }),
  output: Schema.Struct({ season: Season, final: Snapshot, clock: Clock, tookMs: N }),
  steps: [
    { name: "check", local: "cache", about: "The supervisor's season end with `check` (POST /v1/seasons/<name>/end): refusals first, then what it would do; nothing changes." },
    { name: "preview", local: "prompt", about: "What ending saves and resets; no is CANCELLED, a script without `--confirm` CLI_USAGE." },
    { name: "end", local: "cache", about: "The supervisor's season end: close the gateway to its players, stop its warps, freeze, save `<name>-end`, restore the reset world." },
  ],
  errors: [error_CANCELLED],
  calls: [control.seasonEnd],
  spans: [],
  budget: budget("background"),
});

export const flow_devnet_seasons_cancel = defineFlow({
  id: "devnet.seasons.cancel",
  title: "Cancel a planned season before it runs",
  about:
    "`dev season cancel <name>`. The supervisor refuses a name no season has (INVALID_INPUT) and a season that is not " +
    "planned (WRONG_STATE): a running one's refusal names `dev season end`, which ends and resets, so a script that " +
    "meant to drop a planned season that has since started is refused rather than resetting the world. It cancels the " +
    "season: its start and its warps never run (its warps `skipped`), its name is never used again, and nothing in the " +
    "world changes, so, as `payment cancel` takes back a scheduled payment, it does not preview. A planned season " +
    "whose real end comes before it starts is cancelled the same way, its `note` saying so (decision devnet.seasons). " +
    "It answers the season. " + OWNER_ONLY,
  component: component_core_sdk,
  sdk: "devnet.seasons.cancel",
  input: Schema.Struct({ name: S }),
  output: Season,
  steps: [{ name: "cancel", local: "cache", about: "The supervisor's season cancel (POST /v1/seasons/<name>/cancel)." }],
  errors: [],
  calls: [control.seasonCancel],
  spans: [],
  budget: budget("write"),
});

export const flow_devnet_seasons_show = defineFlow({
  id: "devnet.seasons.show",
  title: "Show the world's current season, its next warp and whether you play it",
  about:
    "`dev season show`. The current season is the one running, else the next planned (by its start; one its owner " +
    "starts by hand after any with a start), else the last ended, else none; a cancelled season never ran, so it is never " +
    "current. It answers that season, whether the " +
    "caller plays it (a joiner's grant names an email among its players; the owner and anyone on a local devnet play " +
    "every season), its next scheduled warp and the clock. Any grant may read it, between seasons too, so a player " +
    "can see when the next season starts and the world will jump (decision devnet.season-players). It changes nothing.",
  component: component_core_sdk,
  sdk: "devnet.seasons.show",
  input: Schema.Struct({}),
  output: Schema.Struct({ season: Schema.NullOr(Season), playing: B, next: Schema.NullOr(SeasonWarp), clock: Clock }),
  steps: [{ name: "read", local: "cache", about: "The supervisor's current season (GET /v1/seasons/current), with the clock." }],
  errors: [],
  calls: [control.seasonCurrent],
  spans: [],
  budget: budget("read"),
});

export const flow_devnet_seasons_list = defineFlow({
  id: "devnet.seasons.list",
  title: "List every season of this world: running, planned, ended",
  about:
    "`dev season list [--after <cursor>] [--limit <n>]`. Every season this world has had, the running one first, then " +
    "the planned by start (those its owner starts by hand last), then the ended and cancelled, newest first by when they " +
    "ended; each with its starting and reset worlds, rate, window, players, warps (each with its outcome) and last " +
    "world. It is paged as every list is (G5, G9): `--limit` from 1 to 100, 20 unless given, and `--after` the cursor " +
    "a page gave; a limit out of range is INVALID_INPUT before any call, and a cursor the list did not give is the " +
    "supervisor's INVALID_INPUT. Any grant may read it, and it changes nothing.",
  component: component_core_sdk,
  sdk: "devnet.seasons.list",
  input: Schema.Struct({ after: Schema.optionalKey(S), limit: Schema.optionalKey(Schema.Int) }),
  output: Schema.Struct({ seasons: Schema.Array(Season), nextCursor: Schema.NullOr(S) }),
  steps: [
    { name: "page", local: "build", about: "`--limit` from 1 to 100 (20 unless given); out of range is INVALID_INPUT." },
    { name: "list", local: "cache", about: "The supervisor's seasons (GET /v1/seasons?after=&limit=), a page and the next cursor." },
  ],
  errors: [error_INVALID_INPUT],
  calls: [control.seasonList],
  spans: [],
  budget: budget("read"),
});

export const flow_devnet_seasons_warps_add = defineFlow({
  id: "devnet.seasons.warps.add",
  title: "Schedule a warp in a season: at a real time, by a span or to a world date",
  about:
    "`dev season warp add <season> (<span> | --to <date>) --at <when> [--every <span>]`, the span or date as `dev time " +
    "warp` takes them. Both or neither of a span and `--to`, an unreadable time or span, and `--every` under one real minute are INVALID_INPUT before any call. " +
    WHEN + " The supervisor refuses a season no one has made and an `--at` not later than now or outside the season's " +
    "window (INVALID_INPUT); an ended or cancelled season (WRONG_STATE). It adds the warp, `w<n>`, or with `--every` one warp at " +
    "`--at` and one each `--every` of real time after it until the season's end, at most 500. At its real instant the " +
    "supervisor warps the world as `dev time warp` does: a barrier through every due instant on the way, the clock " +
    "keeping its mode and rate (decision devnet.season-jumps). It answers the season. " + OWNER_ONLY,
  component: component_core_sdk,
  sdk: "devnet.seasons.warps.add",
  input: Schema.Struct({ season: S, at: S, by: Schema.optionalKey(S), to: Schema.optionalKey(S), every: Schema.optionalKey(S) }),
  output: Season,
  steps: [
    { name: "warp", local: "build", about: "The real instant, one of the span and the date, and the repeat; both or neither of a span and `--to` is INVALID_INPUT." },
    { name: "add", local: "cache", about: "The supervisor's warp add (POST /v1/seasons/<season>/warps)." },
  ],
  errors: [error_INVALID_INPUT],
  calls: [control.seasonWarpAdd],
  spans: [],
  budget: budget("write"),
});

export const flow_devnet_seasons_warps_remove = defineFlow({
  id: "devnet.seasons.warps.remove",
  title: "Take a scheduled warp out of a season before it runs",
  about:
    "`dev season warp remove <season> <warp>`. The supervisor refuses a season or warp that does not exist " +
    "(INVALID_INPUT), and a warp that has already run, failed, been skipped or removed, or a season that has ended or was cancelled " +
    "(WRONG_STATE). The warp stays in the season's schedule as `removed` and never runs. It answers the season. " +
    OWNER_ONLY,
  component: component_core_sdk,
  sdk: "devnet.seasons.warps.remove",
  input: Schema.Struct({ season: S, warp: S }),
  output: Season,
  steps: [{ name: "remove", local: "cache", about: "The supervisor's warp remove (POST /v1/seasons/<season>/warps/<warp>/remove)." }],
  errors: [],
  calls: [control.seasonWarpRemove],
  spans: [],
  budget: budget("write"),
});

export const flow_devnet_seasons_players_add = defineFlow({
  id: "devnet.seasons.players.add",
  title: "Let a person play a season",
  about:
    "`dev season player add <season> <email>`. The supervisor refuses a season no one has made, and an email that holds " +
    "no world grant here (INVALID_INPUT, naming `capxul-devnet world grant`, which makes one; a local devnet has none); " +
    "an ended or cancelled season (WRONG_STATE). Adding a player who already plays changes nothing. While the season runs, the " +
    "world's gateway admits the player's grant at once (decision devnet.season-players). It answers the season. " +
    OWNER_ONLY,
  component: component_core_sdk,
  sdk: "devnet.seasons.players.add",
  input: Schema.Struct({ season: S, email: S }),
  output: Season,
  steps: [{ name: "add", local: "cache", about: "The supervisor's player add (POST /v1/seasons/<season>/players)." }],
  errors: [],
  calls: [control.seasonPlayerAdd],
  spans: [],
  budget: budget("write"),
});

export const flow_devnet_seasons_players_remove = defineFlow({
  id: "devnet.seasons.players.remove",
  title: "Stop a person playing a season",
  about:
    "`dev season player remove <season> <email>`. The supervisor refuses a season no one has made and an email that " +
    "does not play it (INVALID_INPUT); an ended or cancelled season (WRONG_STATE). While the season runs, the world's gateway refuses " +
    "the person's next call (ROLE_PERMISSION_DENIED); what they made in the world stays in it. Their world grant stays, " +
    "for the seasons they still play. It answers the season. " + OWNER_ONLY,
  component: component_core_sdk,
  sdk: "devnet.seasons.players.remove",
  input: Schema.Struct({ season: S, email: S }),
  output: Season,
  steps: [{ name: "remove", local: "cache", about: "The supervisor's player remove (POST /v1/seasons/<season>/players/<email>/remove)." }],
  errors: [],
  calls: [control.seasonPlayerRemove],
  spans: [],
  budget: budget("write"),
});

// ── playing another person ──────────────────────────────────────────────────────────────────

export const flow_devnet_approve = defineFlow({
  id: "devnet.approve",
  title: "Sign an open approval as another person, as the approval page would",
  about:
    "`dev approve --as <email> <approvalId>`. On a devnet every person's signer is a dev signer derived from the devnet's " +
    "seed and their email; the supervisor writes that seed, owner-only, as the browser handoff when it is started with a " +
    "browser origin, so the local browser app and this command derive the same keys. No handoff, or no devnet, is " +
    "WRONG_ENVIRONMENT. It signs in as the person the way anyone does on a devnet: a session kept on this machine for " +
    "that email if the backend still accepts it, else a code sent to the email and read back from the mail sink. Then it " +
    "reads the approval as that person: one no longer pending is WRONG_STATE and nothing is signed. The dev signer signs " +
    "the approval's digest, and the signature is given to the approval, whose process sends it. It answers the approval " +
    "as it stands after this signature. It leaves this machine's current person as it was.",
  was: [`${SDK}:379`, `${SDK}:447`, `${SDK}:463`, `${SDK}:476`, `${SDK}:484`, "packages/sdk/src/accounts/approvals.ts:154"],
  component: component_core_sdk,
  sdk: "devnet.approve",
  input: Schema.Struct({ approvalId: S, as: S }),
  output: Schema.Struct({ approvalId: S, signer: S, status: ApprovalView.fields.state, approval: ApprovalView }),
  steps: [
    { name: "handoff", local: "cache", about: "The devnet's dev-signer handoff on this machine; none is WRONG_ENVIRONMENT." },
    { name: "session", local: "cache", about: "A session kept here for `--as` that the backend still accepts; with one, the next three steps are skipped." },
    { name: "send-code", rpc: rpc_access_sign_in_send_code, about: "A sign-in code for `--as`, which lands in the mail sink." },
    { name: "read-code", rpc: rpc_devnet_mail_list, about: "The newest sign-in-code message to `--as`." },
    { name: "verify", rpc: rpc_access_sign_in_verify_code, about: "Signs in as `--as`; the session is kept for that email, not made current." },
    { name: "read", rpc: rpc_approvals_signing_get, about: "The approval as its signer sees it; not pending is WRONG_STATE, nothing signed." },
    { name: "sign", local: "sign", about: "The person's dev signer signs the approval's digest, with no message prefix." },
    { name: "give", rpc: rpc_approvals_signing_sign, about: "The signature, which resumes the approval's process." },
  ],
  errors: [error_WRONG_ENVIRONMENT, error_WRONG_STATE],
  calls: [],
  spans: [],
  budget: budget("vendor"),
});

// ── scripted values that must apply now ─────────────────────────────────────────────────────

export const flow_devnet_gates_set = defineFlow({
  id: "devnet.gates.set",
  title: "Turn a feature gate on or off for an Organization, now",
  about:
    "`dev gates set <key> on|off --org <org>`. It finds the Organization among the caller's own by handle or id, as `use " +
    "org` does (none is CLI_USAGE); scripts the gate for it; runs access' flag sync once, so the PostHog fake's answer " +
    "reaches access' feature flags; and reads what now applies. The answer is the gate, the Organization by handle and " +
    "id, the value set, the devnet ceiling and the effective value every gated concept sees.",
  was: ["apps/cli/src/commands/dev/gates.ts:24", "apps/cli/src/commands/dev/gates.ts:56", "packages/sdk/src/access/features.ts:76"],
  component: component_core_sdk,
  sdk: "devnet.gates.set",
  input: Schema.Struct({ org: S, key: S, on: B }),
  output: Schema.Struct({
    key: S,
    org: Schema.Struct({ handle: S, orgId: S }),
    on: B,
    ceiling: Ceiling,
    effective: B,
  }),
  steps: [
    { name: "org", rpc: rpc_organizations_workspaces_list, about: "The caller's Organizations, until `--org` matches; no match is CLI_USAGE." },
    { name: "script", rpc: rpc_devnet_gates_script, about: "The gate's value for the Organization." },
    { name: "sync", rpc: rpc_devnet_jobs_run, about: "Only access.gates.sync, once." },
    { name: "read", rpc: rpc_devnet_gates_read, about: "The value, the ceiling and what applies now." },
  ],
  errors: [error_CLI_USAGE],
  calls: [],
  spans: [],
  budget: budget("vendor"),
});

export const flow_devnet_prices_set = defineFlow({
  id: "devnet.prices.set",
  title: "Script a pair's USD rate, and have the books take it",
  about:
    "`dev prices set <ASSET/USD> <rate> [--from <date>]`. It scripts the rate, then runs books' price sync once, so the " +
    "Chainlink fake's answer is a kept rate before the command returns: money facts written after it take it, facts " +
    "already written keep theirs.",
  was: ["apps/cli/src/commands/dev/prices.ts:30", "apps/cli/src/commands/dev/prices.ts:48", "packages/sdk/src/books/prices.ts:30"],
  component: component_core_sdk,
  sdk: "devnet.prices.set",
  input: Schema.Struct({ pair: S, rate: S, from: Schema.optionalKey(Instant) }),
  output: Schema.Struct({ pair: S, rate: S, from: N, source: S }),
  steps: [
    { name: "script", rpc: rpc_devnet_prices_script, about: "The rate for the pair from `from`, or its base rate." },
    { name: "sync", rpc: rpc_devnet_jobs_run, about: "Only books.prices.sync, once." },
  ],
  errors: [],
  calls: [],
  spans: [],
  budget: budget("chain-read"),
});
