// Devnet's Core SDK flows: the methods of the Core SDK's Node-only devnet entry (`connectDevnet()`)
// that compose more than one rpc, or that reach the devnet supervisor instead of the backend (A4).
//
// Two kinds. The clock and the saved worlds are the supervisor's (decisions
// devnet.supervisor-owns-time-and-worlds and devnet.time-protocol): those flows call `devnet-control`,
// the supervisor's public control protocol, and no backend rpc. The schema's local step kinds have no
// "outside call", so each supervisor call is a `cache` step (this machine's devnet state), or a `poll`
// step for an event stream, and the flow's `calls` names it (decision devnet.supervisor-steps). Three
// clock flows implement the frozen `dev time` commands; six more are the protocol's other verbs, for
// people building on Capxul (surface `sdk`; the supervisor's `capxul-devnet time` commands are thin
// clients of the same protocol). The other three flows compose backend rpcs: `dev approve` signs in as
// the person it plays and signs as the approval page would; `dev gates set` and `dev prices set`
// script a value and run the one sync that makes it apply. `dev jobs run` and the three mail commands
// are one rpc each, so they have no flow.

import { Schema } from "effect";
import { budget, defineFlow } from "../../../packages/book/src/index.ts";
import { component_core_sdk } from "../shared/foundation.ts";
import { integration_devnet_control } from "../shared/external.ts";
import { error_CLI_USAGE, error_INVALID_INPUT, error_WRONG_ENVIRONMENT, error_WRONG_STATE } from "../shared/vocabulary.ts";
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

/** Whether now runs on at the real rate from where it was set, or stands still until it is moved. */
export const ClockMode = Schema.Literals(["running", "frozen"]);
/** The one clock, as the time authority holds it (decision devnet.supervisor-owns-time-and-worlds). */
export const Clock = Schema.Struct({
  /** `capxul.devnet/1.<minor>`: the protocol version that answered. */
  protocol: S,
  now: Instant,
  mode: ClockMode,
  /** Increases with every change of the clock; a follower acknowledges it. */
  version: Schema.Int,
  /** The world's epoch: a new one at `up` and at every restore, so a subscriber tells a restore from a move. */
  world: S,
  /** Whether a warp, step or start-at has moved this world's clock: start-at needs a world that has not begun. */
  moved: B,
});
/** The chain's head: its block and the instant it was mined at. */
export const ChainHead = Schema.Struct({ block: N, at: Instant });
/** How far Ponder has indexed, and whether it has reached the chain's head. */
export const IndexerPosition = Schema.Struct({ block: Schema.NullOr(N), caughtUp: B });
/** A follower of the clock (decision devnet.followers): the backend, Ponder, the stand-ins, or an outside program. */
export const Follower = Schema.Struct({ name: S, version: Schema.Int, idle: B, nextDue: Schema.NullOr(Instant) });
/** One event of the clock, as `watch` and `follow` deliver it. */
export const ClockEvent = Schema.Struct({
  version: Schema.Int,
  now: Instant,
  mode: ClockMode,
  world: S,
  reason: Schema.Literals(["warp", "stop", "step", "tick", "settle", "freeze", "resume", "start-at", "restore", "up"]),
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
/** A saved world, as `dev snapshot list` and `save` print it. */
export const Snapshot = Schema.Struct({ name: S, at: Instant, mode: ClockMode, savedAt: Instant, code: S });

const SUPERVISOR_ERRORS = "The supervisor's own refusals are the `devnet-control` call's failures.";
const BARRIER =
  "It is a barrier (decision devnet.warp-barrier): the clock stops at every due instant on the way, in order, and at " +
  "each the chain gets its block, the backend's timers and crons due by then run once, and every follower settles.";

// ── the clock: the frozen `dev time` commands ───────────────────────────────────────────────

export const flow_devnet_time_show = defineFlow({
  id: "devnet.time.show",
  title: "Read the devnet's one clock, the chain head and how far Ponder has indexed",
  about:
    "`dev time`. One read of the time authority: the clock (now, running or frozen, its version and world), the chain " +
    "head's block and time, the backend's now, Ponder's position, each follower, and whether they agree: every follower " +
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
    "skips the crons that fell due; every durable timer due still fires, because it is due. A cron that fails does not " +
    "undo the warp: the answer names it. The clock keeps its mode: a frozen clock stays frozen at the target. " +
    SUPERVISOR_ERRORS,
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

// ── the clock: the protocol's other verbs, for people building on Capxul ────────────────────

const SDK_ONLY =
  "No CLI command: the Core SDK's devnet entry serves it to programs built on Capxul, and `capxul-devnet time` is the " +
  "supervisor's own thin client of the same request (decision devnet.time-protocol).";

export const flow_devnet_time_freeze = defineFlow({
  id: "devnet.time.freeze",
  title: "Hold the devnet's clock still until it is moved",
  about:
    "Holds now at the next whole second (never back), for every follower, until a warp, step or resume moves it, so a " +
    "program's own steps happen at instants it chooses (decision devnet.clock-modes). Freezing a frozen clock changes " +
    "nothing. " + SDK_ONLY,
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
  title: "Let the devnet's clock run on at the real rate",
  about: "Lets now run on from where it stands, at the real rate, for every follower. Resuming a running clock changes nothing. " + SDK_ONLY,
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
    "transaction is mined at now, Ponder has indexed the head and every follower is idle. A program calls it after each " +
    "of its own actions, so the next one starts from a settled world. " + SDK_ONLY,
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
    "A stream of the clock's events: each warp, stop, step, tick, freeze, resume, start-at and restore, with its version, " +
    "now, mode and world. It only reads: the barrier does not wait for a watcher (follow for that). " + SDK_ONLY,
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
    "a stand-in's scheduled answer), and returns whether it is idle and its own next due instant; the SDK acknowledges " +
    "it, and the warp stops at that instant too. A follower that does not acknowledge in time fails the barrier " +
    "(WORK_DIED, naming it) and is dropped (decision devnet.followers). " + SDK_ONLY,
  was: [`${WORLD}:292`, "/home/user/factory packages/vending-bench/src/bridge.ts:99"],
  component: component_core_sdk,
  sdk: "devnet.time.follow",
  input: Schema.Struct({ name: S, ackTimeoutMs: Schema.optionalKey(Schema.Int) }),
  output: ClockEvent,
  steps: [
    { name: "join", local: "cache", about: "devnet-control timeFollow: join under the name." },
    { name: "events", local: "poll", about: "The follower's clock events, one per stop and change." },
    { name: "ack", local: "cache", about: "After the handler: the version taken, idle or busy, and the next due instant." },
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
    "builds and any a developer saved), each with its name, its world time, when it was saved and the backend code it was " +
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
    "checkpoint, the world's clock (its now and mode) and its armed fault switches, and the eval machine's CLI home, together, with the " +
    "backend code it runs. The devnet itself is unchanged. " + SUPERVISOR_ERRORS,
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
    "a name it has not saved (INVALID_INPUT, listing the worlds) and a world saved with other backend code (WRONG_STATE: " +
    "replay its builder instead), then stops the backend and Ponder, replaces the chain's state, Postgres and Ponder's " +
    "checkpoint with the world's, sets the clock to the world's now (frozen while it works, then the world's mode, under " +
    "a new world epoch), re-arms its fault switches, restores the CLI home, and starts them again; the durable processes " +
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
