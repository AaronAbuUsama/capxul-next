// Devnet's Core SDK flows: the methods of the Core SDK's Node-only devnet entry (`connectDevnet()`)
// that compose more than one rpc, or that reach the devnet supervisor instead of the backend (A4).
//
// Two kinds. The clocks and the saved worlds are the supervisor's (decision
// devnet.supervisor-owns-time-and-worlds): those flows call `devnet-control` over the supervisor's
// owner-only socket and no backend rpc. The schema's local step kinds have no "outside call", so each
// supervisor call is a `cache` step (this machine's devnet state) and the flow's `calls` names it
// (decision devnet.supervisor-steps). The other three flows compose backend rpcs: `dev approve`
// signs in as the person it plays and signs as the approval page would; `dev gates set` and `dev
// prices set` script a value and run the one sync that makes it apply. `dev jobs run` and the three
// mail commands are one rpc each, so they have no flow.

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

/** The chain's head: its time and block. */
export const ChainClock = Schema.Struct({ at: Instant, timestamp: N, block: N });
/** The backend's clock: the time it reads and how far it is from the machine's wall clock. */
export const BackendClock = Schema.Struct({ at: Instant, offsetMs: N });
/** How far Ponder has indexed, and whether it has caught up with the chain's head. */
export const IndexerPosition = Schema.Struct({ block: Schema.NullOr(N), caughtUp: B });
/** A saved world, as `dev snapshot list` and `save` print it. */
export const Snapshot = Schema.Struct({ name: S, at: Instant, savedAt: Instant, code: S });

const SUPERVISOR_ERRORS = "The supervisor's own refusals are the `devnet-control` call's failures.";

// ── the clocks ──────────────────────────────────────────────────────────────────────────────

export const flow_devnet_time_show = defineFlow({
  id: "devnet.time.show",
  title: "Read both devnet clocks and how far Ponder has indexed",
  about:
    "`dev time`. One supervisor read: the chain's head (time and block), the backend's clock and Ponder's progress, read " +
    "together, and whether the two clocks agree (within two seconds). With no devnet on this machine, the call is refused " +
    "WRONG_ENVIRONMENT before anything reaches the network. " + SUPERVISOR_ERRORS,
  was: [`${SDK}:260`, `${WORLD}:367`, `${CONTROL}:107`],
  component: component_core_sdk,
  sdk: "devnet.time.show",
  input: Schema.Struct({}),
  output: Schema.Struct({ chain: ChainClock, backend: BackendClock, indexer: IndexerPosition, agree: B }),
  steps: [{ name: "clocks", local: "cache", about: "devnet-control clockShow: the chain head, the backend's clock and Ponder's position." }],
  errors: [],
  calls: [control.clockShow],
  spans: [],
  budget: budget("read"),
});

export const flow_devnet_time_warp = defineFlow({
  id: "devnet.time.warp",
  title: "Move both devnet clocks forward, then run what fell due",
  about:
    "`dev time warp`. The SDK turns a duration (`6h`, `28d`) or a date (`--to`; a date alone is 09:00 UTC) into one " +
    "target: both or neither is INVALID_INPUT before any call. The supervisor refuses a target not later than the " +
    "chain's time, mines a block at it, moves the backend's clock to match, then, unless `jobs` is false, runs " +
    "devnet.jobs.run (the crons once and every durable timer now due) and waits for Ponder to reach the new block. A " +
    "failed job does not undo the warp: the answer names it. " + SUPERVISOR_ERRORS,
  was: [`${SDK}:261`, `${SDK}:267`, `${WORLD}:465`, `${WORLD}:518`, `${CONTROL}:134`],
  component: component_core_sdk,
  sdk: "devnet.time.warp",
  input: Schema.Struct({ by: Schema.optionalKey(S), to: Schema.optionalKey(S), jobs: B }),
  output: Schema.Struct({
    from: Instant,
    to: Instant,
    moved: S,
    chain: ChainClock,
    backend: Schema.Struct({ at: Instant, offsetMs: N, jobs: Schema.Array(JobOutcome), scheduledRun: Schema.Int }),
    indexer: IndexerPosition,
  }),
  steps: [
    { name: "target", local: "build", about: "One target time from the duration or the date; both or neither is INVALID_INPUT." },
    { name: "warp", local: "cache", about: "devnet-control clockWarp: mine at the target, move the backend's clock, run what fell due, wait for Ponder." },
  ],
  errors: [error_INVALID_INPUT],
  calls: [control.clockWarp],
  spans: [],
  budget: budget("background"),
});

export const flow_devnet_time_start_at = defineFlow({
  id: "devnet.time.start-at",
  title: "Set a fresh devnet's story in the past",
  about:
    "`dev time start-at`. The SDK reads the date (a date alone is 09:00 UTC). The supervisor refuses a date not earlier " +
    "than the chain's time (INVALID_INPUT) and a world whose clocks already moved (WRONG_STATE), then sets the chain's " +
    "time back, mines a block at that moment, moves the backend's clock to match and waits for Ponder. From then on the " +
    "story only moves forward. " + SUPERVISOR_ERRORS,
  was: [`${SDK}:272`, `${WORLD}:417`, `${WORLD}:447`],
  component: component_core_sdk,
  sdk: "devnet.time.startAt",
  input: Schema.Struct({ date: S }),
  output: Schema.Struct({ from: Instant, to: Instant, chain: ChainClock, backend: BackendClock }),
  steps: [
    { name: "date", local: "build", about: "The start date; a date alone is 09:00 UTC that day, an unreadable one INVALID_INPUT." },
    { name: "start", local: "cache", about: "devnet-control clockStartAt: both clocks back to the date, one block mined there." },
  ],
  errors: [error_INVALID_INPUT],
  calls: [control.clockStartAt],
  spans: [],
  budget: budget("chain-settle"),
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
    "checkpoint, the world's clocks and its armed fault switches, and the eval machine's CLI home, together, with the " +
    "backend code it runs. The devnet itself is unchanged. " + SUPERVISOR_ERRORS,
  was: [`${SDK}:281`, `${WORLD}:580`, `${WORLD}:614`, `${CONTROL}:150`],
  component: component_core_sdk,
  sdk: "devnet.snapshots.save",
  input: Schema.Struct({ name: S, replace: B }),
  output: Snapshot,
  steps: [
    { name: "name", local: "build", about: `The name must be ${NAME_RULE}.` },
    { name: "save", local: "cache", about: "devnet-control snapshotSave: chain, Postgres, Ponder, clocks, faults and CLI home, together." },
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
    "checkpoint with the world's, sets both clocks to the world's time, re-arms its fault switches, restores the CLI home, " +
    "and starts them again; the durable processes resume from their stored state, each timer at its business due time. " +
    "It answers the world's time and how long it took. " + SUPERVISOR_ERRORS,
  was: [`${SDK}:285`, `${WORLD}:677`, `${WORLD}:767`, `${CONTROL}:169`],
  component: component_core_sdk,
  sdk: "devnet.snapshots.restore",
  input: Schema.Struct({ name: S }),
  output: Schema.Struct({
    name: S,
    at: Instant,
    chain: Schema.Struct({ at: Instant, block: N }),
    backend: Schema.Struct({ at: Instant }),
    tookMs: N,
  }),
  steps: [
    { name: "name", local: "build", about: `The name must be ${NAME_RULE}.` },
    { name: "restore", local: "cache", about: "devnet-control snapshotRestore: the world's chain, Postgres, Ponder, clocks, faults and CLI home." },
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
