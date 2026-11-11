// The old book's DevNet area, as it is: one operation record for each of the 15 operations that
// apps/docs/factory/areas/devnet.yaml lists, read from /home/user/factory (branch integration/factory).
// The text (title, about, who, changes, notes, mistakes, acceptance and each refusal's `when`) is the
// frozen book's, spread from ../../frozen, never retyped. The page is cited as `<id>.yaml:1` in `was`.
//
// implementedBy. The `capxul dev` commands (apps/cli/src/commands/dev/) reach the backend three ways:
// (1) `dev fund` (own Safe), `dev gates set` and `dev prices set` restore the CLI session and call one
//     `client._internal.*` SDK method that forwards one protocol row: implementedBy is that rpc, by its
//     conventional name, from the owning concept's area file.
// (2) `dev key` calls no SDK method: it POSTs to the backend's HTTP route `/v1/client/mint-quickstart-key`
//     itself, which is applications.quickstarts.mint.
// (3) Every other command (time, warp, start-at, snapshots, jobs, mail, approve, fund --org) goes through
//     `@capxul/sdk/devnet` (packages/sdk/src/devnet/): connectDevnet() checks the owner-only control root
//     and probes the world with `time`, then the method sends ONE world request over the standing
//     guardian's control socket. The guardian (packages/devnet, the world module) does the work: it
//     drives the chain over Anvil RPC, sets the backend clock's env var and exports or imports the
//     backend's data through the deployment's admin API and the Convex CLI, and runs the operator
//     concept's internal functions over the deployment's HTTP API (as `convex run` does). No SDK
//     transport reaches a row. implementedBy is the operator rpc the command's own work runs there.
//     Judgments, recorded:
//     - dev.time.start-at and dev.snapshot.save reach the backend only through operator.clocks.read
//       (the clock they check and record); the change itself (env var, chain, export) is the devnet
//       package's and has no row. implementedBy is operator.clocks.read; their comments say so.
//     - dev.snapshot.list's own work reaches no backend row: the guardian reads snapshot files on this
//       machine. Only connectDevnet's probe reaches operator.clocks.read. As ./accounts.ts does for
//       CLI-local commands, this file books the SDK method as a flow (devnet.snapshots.list, no concept
//       owns packages/sdk/src/devnet) whose about says so, and the operation names it.
//     - dev.approve's SDK method (devnet.approve) signs in as `--as` and composes the accounts flow
//       client.approvals.approve, which does the signing and the approve row: implementedBy is that flow.
//     - dev.fund and dev.gates.set each have two paths; implementedBy is the page's main one, and the
//       comment names the other.
//
// returns: what the CLI prints as `data` with `--json`, typed from the protocol shapes it prints
// (packages/protocol/src/devnet/control.ts for the world answers; the row's output schema otherwise).
// Each field's comment is the page's meaning; a page field the CLI does not print, or a printed field
// the page does not name, is said in the operation's comment.
//
// errors: the codes the CLI constructs itself (CliFailure). Every command here has a `test` or
// `devnet` scope (dev/internal/metadata.ts:37), so the command configuration refuses any other
// environment with WRONG_ENVIRONMENT before any network call (runtime/command-config.ts:29,
// environment-refusal.ts:83): it is listed on every record. Each command's own CLI_USAGE, CLI_STORAGE,
// NETWORK_ERROR and PROVIDER_ERROR are listed where it constructs them. As ../payments/operations.ts
// does, the parser's generic CLI_USAGE (runtime/errors.ts:256) and the shared session restore's
// NOT_AUTHENTICATED (auth/first-party.ts:173) are left out, and a refusal the CLI only rewords keeps
// its code and is not listed: the world wrapper re-wraps INVALID_INPUT and WRONG_STATE with the
// devnet's own sentence (dev/world.ts:62), and `dev key` re-states RATE_LIMITED (key.ts:96). The
// WRONG_ENVIRONMENT of connectDevnet (no local devnet runs here) and of devnet.approve (no browser
// handoff) are the SDK's, not the CLI's.
//
// refusals: each page refusal on its error record. `given` names the saved devnet world from which a
// runs-today scenario step's command reaches it: S28 (s28-one-terminal-plays-every-part.scenario.ts)
// restores `after-s1` first (s28.1, :67), and s1.21 runs after s1.20 saves `after-s1` (s1:185). S27
// is a root story that needs a fresh devnet (s27:59), which no saved world names. `?` elsewhere. No
// budget: nothing measured these commands. priority is `normal`: the old book has none.

import { Schema } from "effect";
import { defineFlow, defineOperation } from "../../../packages/book/src/index.ts";
import { frozenClaims, frozenRefusals, frozenText, type FrozenId } from "../../frozen/index.ts";
import { component_core_sdk } from "../shared/foundation.ts";
import {
  error_CLI_STORAGE,
  error_CLI_USAGE,
  error_FEATURE_NOT_AVAILABLE,
  error_INVALID_INPUT,
  error_NETWORK_ERROR,
  error_NOT_AUTHENTICATED,
  error_PROVIDER_ERROR,
  error_RATE_LIMITED,
  error_WORK_DIED,
  error_WRONG_ENVIRONMENT,
  error_WRONG_STATE,
} from "../shared/vocabulary.ts";
import { rpc_operator_clocks_read } from "../operator/clocks.ts";
import { rpc_operator_jobs_run } from "../operator/jobs.ts";
import { rpc_operator_notices_list } from "../operator/notices.ts";
import { rpc_operator_outboxes_fail, rpc_operator_outboxes_list } from "../operator/outboxes.ts";
import { rpc_applications_quickstarts_mint } from "../applications/quickstarts.ts";
import { rpc_accounts_grants_faucet_mint } from "../accounts/grants.ts";
import { flow_client_approvals_approve } from "../accounts/flows.ts";
import { rpc_access_features_set } from "../access/features.ts";
import { rpc_books_facts_set_price } from "../books/facts.ts";

const DEV = "apps/cli/src/commands/dev";
const RT = "apps/cli/src/runtime";
const DEVNET_SDK = "packages/sdk/src/devnet/index.ts";
const CONTROL_SDK = "packages/sdk/src/devnet/control.ts";
const CONTROL = "packages/protocol/src/devnet/control.ts";
const WORLD = "packages/devnet/src/modules/world/service.ts";
const DEVNET_BACKEND = "packages/devnet/src/modules/backend/service.ts";
const SCN = "packages/scenarios/src/acme";
const S1 = `${SCN}/s1-acme-is-founded.scenario.ts`;
const S27 = `${SCN}/s27-the-story-starts-in-the-past.scenario.ts`;
const S28 = `${SCN}/s28-one-terminal-plays-every-part.scenario.ts`;
const page = (id: FrozenId) => `apps/docs/factory/operations/${id}.yaml:1`;

/** The world S28 restores first (s28.1) and that s1.21 runs in, after s1.20 saved it. */
const AFTER_S1 = "after-s1";

// ── refusals: the page's codes, mapped to error records ─────────────────────────────────────

const ERRORS = {
  CLI_STORAGE: error_CLI_STORAGE,
  CLI_USAGE: error_CLI_USAGE,
  FEATURE_NOT_AVAILABLE: error_FEATURE_NOT_AVAILABLE,
  INVALID_INPUT: error_INVALID_INPUT,
  NOT_AUTHENTICATED: error_NOT_AUTHENTICATED,
  RATE_LIMITED: error_RATE_LIMITED,
  WRONG_ENVIRONMENT: error_WRONG_ENVIRONMENT,
  WRONG_STATE: error_WRONG_STATE,
} as const;
type Code = keyof typeof ERRORS;

/** The page's refusals, in its order and words, each on its error record and the world that reaches it. */
const refusals = (id: FrozenId, given: Partial<Record<Code, string>> = {}) =>
  frozenRefusals(id).map(({ code, when }) => {
    if (!(code in ERRORS)) throw new Error(`${id}: the refusal code ${code} has no error record here`);
    return { error: ERRORS[code as Code], given: given[code as Code] ?? "?", when };
  });

// ── evidence shared by the world commands ────────────────────────────────────────────────────

/** The CLI's devnet leaf, its scope refusal, connectDevnet and its probe, the socket and the guardian's dispatch. */
const WORLD_PATH = [
  `${DEV}/internal/metadata.ts:37`,
  `${DEV}/internal/metadata.ts:58`,
  `${RT}/command-config.ts:29`,
  `${RT}/environment-refusal.ts:83`,
  `${RT}/environment.ts:243`,
  `${DEV}/world.ts:17`,
  `${DEV}/world.ts:62`,
  `${DEV}/world.ts:85`,
  `${DEVNET_SDK}:226`,
  `${DEVNET_SDK}:234`,
  `${DEVNET_SDK}:243`,
  `${DEVNET_SDK}:395`,
  `${CONTROL_SDK}:25`,
  `${CONTROL_SDK}:39`,
  `${CONTROL_SDK}:93`,
  `${CONTROL}:30`,
  `${WORLD}:167`,
  `${WORLD}:972`,
  `${DEVNET_BACKEND}:761`,
];

/** The guardian's read of the backend clock: operator.clocks.read over the deployment's HTTP API. */
const CLOCK_READ = [`${WORLD}:274`, `${WORLD}:275`];

/** The WRONG_ENVIRONMENT step shape S28 and s1.21 share: `--env staging`, refused before any network call. */
const ON_STAGING = `${SCN}/platform.ts:26`;

// ── shapes the CLI prints, transcribed from the protocol ─────────────────────────────────────

const S = Schema.String;
const N = Schema.Number;
const B = Schema.Boolean;

/** IndexerPosition (devnet/control.ts:100). */
const IndexerPosition = Schema.Struct({ running: B, caughtUpTo: Schema.NullOr(N), caughtUp: B });

/** TimeWarp (devnet/control.ts:134): what a warp and start-at answer. Times are ISO strings to the second. */
const TimeWarp = Schema.Struct({
  from: S, // The time before the move.
  to: S, // The time after it.
  moved: S, // How far the chain moved, in words: `+26d 16h`.
  chain: Schema.Struct({ timestamp: N, block: N }), // The chain's new time and block.
  backend: Schema.Struct({
    now: S,
    offset: S,
    offsetMs: N,
    jobsRun: Schema.Array(S),
    scheduledRun: N,
  }), // The backend's new clock, the jobs that ran and the due scheduled functions.
  indexer: IndexerPosition, // Whether the indexer caught up.
});

/** Snapshot (devnet/control.ts:150). */
const Snapshot = Schema.Struct({
  name: S,
  at: S,
  savedAt: S,
  chain: Schema.Struct({ block: N, timestamp: N }),
  backend: Schema.Struct({ at: S, documents: N, offsetMs: Schema.optionalKey(N) }),
  indexer: Schema.NullOr(Schema.Struct({ block: N })),
  code: S,
  sizeBytes: N,
});

/** MailFaults (devnet/control.ts:239): what a clear removed, and the faults still armed (`to` null is any address). */
const MailFaults = Schema.Struct({
  cleared: N, // The page: whether `--clear` disarmed the faults. As is, how many it disarmed (0 unless --clear).
  faults: Schema.Array(Schema.Struct({ to: Schema.NullOr(S), remaining: N })), // Each armed fault and its writes left.
});

/** FEATURE_KEYS (protocol features/catalog.ts:284), the entries of FEATURE_CATALOG in order. */
const FeatureKey = Schema.Literals([
  "payment-departments",
  "payment-agreements",
  "payroll-runs",
  "owner-safe-proposals",
  "equity",
  "bank-payouts",
  "scheduled-payments",
  "payslip-preview",
  "books",
  "beta-access",
  "production-access",
]);
const Ceiling = Schema.Literals(["on", "off"]);

// ── the one flow this file books ────────────────────────────────────────────────────────────

export const flow_devnet_snapshots_list = defineFlow({
  id: "devnet.snapshots.list",
  title: "List the devnet's saved snapshots: the devnet package only, no backend row",
  about:
    "The `@capxul/sdk/devnet` method `snapshots.list()` on the Devnet that connectDevnet() returns. No concept owns " +
    "packages/sdk/src/devnet, so the operation file books it. It sends one world request, `snapshot-list`, over the " +
    "standing guardian's owner-only control socket (one JSON line each way, nonce from the control root, 15-minute " +
    "timeout) and unwraps `snapshots`. The guardian (packages/devnet) answers it by reading every snapshot.json under " +
    "~/.cache/capxul-devnet/snapshots on this machine whose folder is a snapshot name, sorted by world time then name; an " +
    "unreadable folder is an empty list and an unreadable file is skipped. It reaches only the devnet package and no " +
    "backend row: the CLI's connectDevnet() probe before it (world `time`) is the only backend read, " +
    "operator.clocks.read, and it is not this method's. The socket client's failures (no answer, a broken or missing " +
    "line, an unreadable nonce) are NETWORK_ERROR; a thrown guardian error is WORK_DIED.",
  was: [
    `${DEVNET_SDK}:127`,
    `${DEVNET_SDK}:290`,
    `${DEVNET_SDK}:291`,
    `${DEVNET_SDK}:395`,
    `${CONTROL_SDK}:20`,
    `${CONTROL_SDK}:39`,
    `${CONTROL_SDK}:93`,
    `${CONTROL}:49`,
    `${CONTROL}:251`,
    `${WORLD}:74`,
    `${WORLD}:551`,
    `${WORLD}:560`,
    `${WORLD}:985`,
    `${WORLD}:1019`,
  ],
  component: component_core_sdk,
  sdk: "devnet.snapshots.list",
  input: Schema.Struct({}),
  output: Schema.Array(Snapshot),
  steps: [
    {
      name: "list",
      local: "cache",
      about:
        "World `snapshot-list` over the control socket: the guardian lists ~/.cache/capxul-devnet/snapshots and reads each " +
        "snapshot.json (name, world time, saved time, chain block, backend documents, indexer block, code, size).",
    },
  ],
  errors: [error_NETWORK_ERROR, error_WORK_DIED],
  calls: [],
  spans: [],
});

// ── dev time ────────────────────────────────────────────────────────────────────────────────

// timeCommand (command.ts:118) runs world.time (world.ts:97): connectDevnet, then devnet.time.now (index.ts:260), one
// world `time`. The guardian reads the latest and pending chain blocks and the chain's offset from the wall, and
// operator.clocks.read for the backend clock, together (service.ts:367); then the indexer's block. `agree` is the two
// offsets within 2 s. The CLI prints the DevnetClock as it came. s1.21 (s1:1973, :766) reaches WRONG_ENVIRONMENT
// with `--env staging` from after-s1.
export const operation_dev_time = defineOperation({
  ...frozenText("dev.time"),
  was: [
    page("dev.time"),
    `${DEV}/command.ts:118`,
    `${DEV}/world.ts:97`,
    ...WORLD_PATH,
    `${DEVNET_SDK}:260`,
    `${WORLD}:367`,
    `${WORLD}:256`,
    ...CLOCK_READ,
    `${CONTROL}:107`,
    `${S1}:766`,
    `${S1}:1973`,
    ON_STAGING,
  ],
  priority: "normal",
  implementedBy: rpc_operator_clocks_read,
  acceptance: frozenClaims("dev.time"),
  returns: Schema.Struct({
    chain: Schema.Struct({ at: S, timestamp: N, block: N }), // The chain's time and block.
    backend: Schema.Struct({ at: S, offset: S, offsetMs: N, wall: S }), // The backend's clock.
    indexer: IndexerPosition, // Whether the indexer has caught up with the chain.
    agree: B, // Whether the two clocks agree.
  }),
  errors: [error_WRONG_ENVIRONMENT],
  refusals: refusals("dev.time", { WRONG_ENVIRONMENT: AFTER_S1 }),
});

// ── dev time warp ───────────────────────────────────────────────────────────────────────────

// warpCommand (command.ts:74) runs world.warp (world.ts:112): with `--to` alone, devnet.time.warpTo (index.ts:267,
// parseWarpTarget, INVALID_INPUT in the SDK); otherwise the CLI turns the duration into seconds with parseDuration
// (world.ts:124) and calls devnet.time.warp (index.ts:261), which refuses a non-positive or unparsed duration
// INVALID_INPUT before the socket, so both and neither are refused by the SDK, not the guardian. The guardian
// (service.ts:465) refuses a target not later than the chain's, sets the next block's timestamp and mines it, sets the
// backend clock's env var CAPXUL_DEVNET_CLOCK_OFFSET_MS through the deployment's admin API (service.ts:318,
// backend/service.ts:657), then runs operator.jobs.run with the shift (or, with --no-jobs, the shift alone,
// `crons: false`), waits up to 60 s for the indexer, refuses WORK_DIED for a failed job and for clocks that disagree,
// and reads operator.clocks.read before and after. The warp is not undone when a job fails.
export const operation_dev_time_warp = defineOperation({
  ...frozenText("dev.time.warp"),
  was: [
    page("dev.time.warp"),
    `${DEV}/command.ts:74`,
    `${DEV}/world.ts:112`,
    `${DEV}/world.ts:121`,
    `${DEV}/world.ts:124`,
    `${DEV}/world.ts:127`,
    ...WORLD_PATH,
    `${DEVNET_SDK}:261`,
    `${DEVNET_SDK}:264`,
    `${DEVNET_SDK}:267`,
    `${CONTROL}:361`,
    `${CONTROL}:374`,
    `${WORLD}:465`,
    `${WORLD}:484`,
    `${WORLD}:493`,
    `${WORLD}:502`,
    `${WORLD}:508`,
    `${WORLD}:514`,
    `${WORLD}:518`,
    `${WORLD}:318`,
    `${WORLD}:333`,
    `${WORLD}:337`,
    `${WORLD}:357`,
    ...CLOCK_READ,
    `${DEVNET_BACKEND}:644`,
    `${DEVNET_BACKEND}:657`,
    `${CONTROL}:134`,
  ],
  priority: "normal",
  implementedBy: rpc_operator_jobs_run,
  acceptance: frozenClaims("dev.time.warp"),
  returns: TimeWarp,
  errors: [error_WRONG_ENVIRONMENT],
  refusals: refusals("dev.time.warp"),
});

// ── dev time start-at ───────────────────────────────────────────────────────────────────────

// startAtCommand (command.ts:103) runs world.startAt (world.ts:141): devnet.time.startAt (index.ts:272) parses the date
// (INVALID_INPUT in the SDK) and sends world `start-at`. The guardian (service.ts:417) refuses a date not earlier than
// the chain's (INVALID_INPUT) and a backend offset that is not 0 (WRONG_STATE, read with operator.clocks.read), sets the
// chain's time back and mines a block, sets the backend clock's env var through the admin API, waits for the indexer
// and checks the clocks agree. Its backend work is the env var, which no row writes: the only row it reaches is
// operator.clocks.read (before, after and in the agreement check), so that is implementedBy. The CLI prints the
// TimeWarp, `moved` and `indexer` beside the page's fields. s27.2 (s27:80, :44) reaches WRONG_STATE in the root story
// S27, on a fresh devnet no saved world names.
export const operation_dev_time_start_at = defineOperation({
  ...frozenText("dev.time.start-at"),
  was: [
    page("dev.time.start-at"),
    `${DEV}/command.ts:103`,
    `${DEV}/world.ts:141`,
    ...WORLD_PATH,
    `${DEVNET_SDK}:272`,
    `${WORLD}:417`,
    `${WORLD}:425`,
    `${WORLD}:433`,
    `${WORLD}:438`,
    `${WORLD}:441`,
    `${WORLD}:445`,
    `${WORLD}:447`,
    `${WORLD}:399`,
    ...CLOCK_READ,
    `${DEVNET_BACKEND}:657`,
    `${CONTROL}:46`,
    `${CONTROL}:134`,
    `${S27}:44`,
    `${S27}:59`,
    `${S27}:80`,
  ],
  priority: "normal",
  implementedBy: rpc_operator_clocks_read,
  acceptance: frozenClaims("dev.time.start-at"),
  returns: TimeWarp,
  errors: [error_WRONG_ENVIRONMENT],
  refusals: refusals("dev.time.start-at"),
});

// ── dev snapshot save ───────────────────────────────────────────────────────────────────────

// snapshot save (command.ts:143) runs world.snapshotSave (world.ts:176): devnet.snapshot(name).save (index.ts:281)
// refuses a bad name INVALID_INPUT in the SDK, then sends world `snapshot-save`. The guardian (service.ts:580) refuses
// an existing name without --replace (WRONG_STATE), reads operator.clocks.read and the chain head, dumps the chain
// state, writes the devnet Bridge's state when it runs, runs `convex export` of the backend data (backend/service.ts:782),
// swaps the indexer to save its database when one answers, writes snapshot.json with the deployed code version, renames
// the staging folder into ~/.cache/capxul-devnet/snapshots and marks the chain with evm_snapshot. The save itself is
// the devnet package's and the Convex CLI's: the only row it reaches is operator.clocks.read, so that is implementedBy.
// The CLI prints the whole Snapshot, more than the page's four fields.
export const operation_dev_snapshot_save = defineOperation({
  ...frozenText("dev.snapshot.save"),
  was: [
    page("dev.snapshot.save"),
    `${DEV}/command.ts:143`,
    `${DEV}/world.ts:176`,
    ...WORLD_PATH,
    `${DEVNET_SDK}:281`,
    `${DEVNET_SDK}:284`,
    `${CONTROL}:27`,
    `${WORLD}:580`,
    `${WORLD}:585`,
    `${WORLD}:598`,
    `${WORLD}:608`,
    `${WORLD}:614`,
    `${WORLD}:575`,
    `${WORLD}:74`,
    ...CLOCK_READ,
    `${DEVNET_BACKEND}:782`,
    `${DEVNET_BACKEND}:846`,
    `${CONTROL}:150`,
  ],
  priority: "normal",
  implementedBy: rpc_operator_clocks_read,
  acceptance: frozenClaims("dev.snapshot.save"),
  returns: Snapshot, // name, at (world time), savedAt and code are the page's; chain, backend, indexer and sizeBytes are not.
  errors: [error_WRONG_ENVIRONMENT],
  refusals: refusals("dev.snapshot.save"),
});

// ── dev snapshot list ───────────────────────────────────────────────────────────────────────

// snapshot list (command.ts:158) runs world.snapshotList (world.ts:191): connectDevnet, whose probe is the only
// backend read (operator.clocks.read), then devnet.snapshots.list, booked above: the guardian reads snapshot files
// on this machine and reaches no backend row. The CLI wraps the list as `{ snapshots }`. s28.3 (s28:338, :85)
// reaches WRONG_ENVIRONMENT with `--env staging` from after-s1.
export const operation_dev_snapshot_list = defineOperation({
  ...frozenText("dev.snapshot.list"),
  was: [
    page("dev.snapshot.list"),
    `${DEV}/command.ts:158`,
    `${DEV}/world.ts:191`,
    `${DEV}/world.ts:197`,
    ...WORLD_PATH,
    `${DEVNET_SDK}:291`,
    `${WORLD}:560`,
    `${S28}:85`,
    `${S28}:338`,
    ON_STAGING,
  ],
  priority: "normal",
  implementedBy: flow_devnet_snapshots_list,
  acceptance: frozenClaims("dev.snapshot.list"),
  returns: Schema.Struct({
    snapshots: Schema.Array(Snapshot), // Each snapshot with its name, world time, when it was saved and its backend code, by world time.
  }),
  errors: [error_WRONG_ENVIRONMENT],
  refusals: refusals("dev.snapshot.list", { WRONG_ENVIRONMENT: AFTER_S1 }),
});

// ── dev snapshot restore ────────────────────────────────────────────────────────────────────

// snapshot restore (command.ts:162) runs world.snapshotRestore (world.ts:211): devnet.snapshot(name).restore
// (index.ts:285) refuses a bad name INVALID_INPUT in the SDK, then world `snapshot-restore`. The guardian
// (service.ts:677) refuses an unknown name (INVALID_INPUT, listing the names) and other backend code (WRONG_STATE),
// reverts the chain to its evm_snapshot mark or resets it and loads the dump, clears or restarts the bundler, runs
// `convex import` of the backend data (backend/service.ts:798), imports the devnet Bridge's state, sets the chain's time
// and the backend clock's env var, runs operator.jobs.run with `anchor` and no crons so each pending scheduled function
// goes back to its business due time, then swaps the indexer back and waits for it. The one row that does restore
// work is operator.jobs.run, so that is implementedBy; it also reads operator.clocks.read. snapshot-history
// .integration.test.ts:26 is the page's acceptance test.
export const operation_dev_snapshot_restore = defineOperation({
  ...frozenText("dev.snapshot.restore"),
  was: [
    page("dev.snapshot.restore"),
    `${DEV}/command.ts:162`,
    `${DEV}/world.ts:211`,
    ...WORLD_PATH,
    `${DEVNET_SDK}:285`,
    `${WORLD}:677`,
    `${WORLD}:685`,
    `${WORLD}:699`,
    `${WORLD}:721`,
    `${WORLD}:724`,
    `${WORLD}:736`,
    `${WORLD}:751`,
    `${WORLD}:752`,
    `${WORLD}:756`,
    `${WORLD}:767`,
    ...CLOCK_READ,
    `${DEVNET_BACKEND}:798`,
    `${CONTROL}:169`,
    "packages/devnet/src/modules/world/snapshot-history.integration.test.ts:26",
  ],
  priority: "normal",
  implementedBy: rpc_operator_jobs_run,
  acceptance: frozenClaims("dev.snapshot.restore"),
  returns: Schema.Struct({
    name: S, // The snapshot restored.
    at: S, // Its world time, now the devnet's.
    chain: Schema.Struct({ block: N, timestamp: N }), // The chain after the restore.
    backend: Schema.Struct({ at: S, offset: S, documents: N }), // The backend after the restore.
    indexer: Schema.NullOr(Schema.Struct({ block: N, caughtUp: B })), // Not on the page: null when no indexer ran.
    tookMs: N, // How long it took.
  }),
  errors: [error_WRONG_ENVIRONMENT],
  refusals: refusals("dev.snapshot.restore"),
});

// ── dev prices set ──────────────────────────────────────────────────────────────────────────

// prices.ts: refuses a pair that is not ASSET/USD, a rate that is not USD per unit and an unreadable --from with
// CLI_USAGE (:30, :36, :42), restores the session (:45), then `client._internal.prices.set` (:48), which forwards one
// row, books.facts.setPrice (sdk books/prices.ts:30). The row itself refuses any tier but `local` (INVALID_INPUT,
// price.ts:26) and needs a session. It does not go through @capxul/sdk/devnet. s28.14 (s28:462, :234) reaches CLI_USAGE
// from after-s1.
export const operation_dev_prices_set = defineOperation({
  ...frozenText("dev.prices.set"),
  was: [
    page("dev.prices.set"),
    `${DEV}/command.ts:219`,
    `${DEV}/prices.ts:14`,
    `${DEV}/prices.ts:30`,
    `${DEV}/prices.ts:36`,
    `${DEV}/prices.ts:42`,
    `${DEV}/prices.ts:45`,
    `${DEV}/prices.ts:48`,
    `${DEV}/prices.ts:53`,
    `${DEV}/internal/metadata.ts:37`,
    `${RT}/command-config.ts:29`,
    `${RT}/environment-refusal.ts:83`,
    "apps/cli/src/auth/input.ts:11",
    "packages/sdk/src/books/prices.ts:30",
    "packages/protocol/src/books/operations.ts:164",
    "packages/protocol/src/books/fact-schema.ts:88",
    "packages/backend/src/books/facts/operations/price.ts:23",
    "packages/backend/src/books/facts/operations/price.ts:26",
    `${S28}:234`,
    `${S28}:462`,
  ],
  priority: "normal",
  implementedBy: rpc_books_facts_set_price,
  acceptance: frozenClaims("dev.prices.set"),
  returns: Schema.Struct({
    pair: S, // The pair set, such as `EURC/USD`.
    rate: S, // Its USD rate, to eight decimals: `1.08500000`.
    from: N, // When the rate starts, or `0` for the base rate when no `--from` is given.
    source: S, // Where the rate came from: `devnet:EURC/USD`.
  }),
  errors: [error_CLI_USAGE, error_WRONG_ENVIRONMENT],
  refusals: refusals("dev.prices.set", { CLI_USAGE: AFTER_S1 }),
});

// ── dev fund ────────────────────────────────────────────────────────────────────────────────

// Two paths (command.ts:55). Without --org, fund.ts restores the session (:20), reads `client.accounts.read` (:22,
// accounts.balances.read) to find the asset, checks the amount against it with CLI_USAGE (:27, payment/internal/
// send-target.ts:72), then `client._internal.accounts.fund` (:29), which emits faucet_requested and forwards one row,
// accounts.grants.faucetMint (sdk accounts/balance-adapter.ts:106): that is implementedBy. It prints the parsed amount
// and the hash. With --org, the command refuses any environment but a devnet with WRONG_ENVIRONMENT (command.ts:60)
// and, with no sign-in at all, runs world.fundOrg (world.ts:231): world `fund-org`, which the guardian (service.ts:802)
// serves with operator.faucets.resolveRecipient and operator.faucets.fundOrganization in faucet-sized mints, run with
// the deployment's admin key, renaming the faucet's `handle` refusal to INVALID_INPUT on `org`. It prints the Funded
// report. As is, `--org` funds any Organization by handle for anyone on the machine, while the page's `who` says a
// signed-in person. s1.6 (s1:1443) reaches INVALID_INPUT for an amount over the faucet's maximum, which the page's
// `when` does not describe.
export const operation_dev_fund = defineOperation({
  ...frozenText("dev.fund"),
  was: [
    page("dev.fund"),
    `${DEV}/command.ts:36`,
    `${DEV}/command.ts:55`,
    `${DEV}/command.ts:60`,
    `${DEV}/fund.ts:20`,
    `${DEV}/fund.ts:22`,
    `${DEV}/fund.ts:27`,
    `${DEV}/fund.ts:29`,
    `${DEV}/fund.ts:35`,
    "apps/cli/src/commands/payment/internal/send-target.ts:72",
    `${DEV}/internal/metadata.ts:37`,
    `${RT}/environment-refusal.ts:83`,
    `${RT}/environment.ts:243`,
    "packages/sdk/src/accounts/balances.ts:72",
    "packages/sdk/src/accounts/balance-programs.ts:50",
    "packages/sdk/src/accounts/balance-adapter.ts:106",
    "packages/protocol/src/accounts/operations.ts:133",
    `${DEV}/world.ts:231`,
    `${DEVNET_SDK}:341`,
    `${WORLD}:802`,
    `${WORLD}:825`,
    `${WORLD}:837`,
    `${WORLD}:843`,
    `${WORLD}:849`,
    "packages/devnet/src/modules/world/fund.ts:16",
    `${CONTROL}:178`,
    `${S1}:1443`,
  ],
  priority: "normal",
  implementedBy: rpc_accounts_grants_faucet_mint,
  acceptance: frozenClaims("dev.fund"),
  returns: Schema.Union([
    Schema.Struct({
      amount: Schema.Struct({ asset: S, value: S }), // The test money minted, as the parsed asset amount.
      txHash: S, // The mint transaction.
    }),
    // --org: the Funded report (devnet/control.ts:178); `amount` is display text, and the rest is not on the page.
    Schema.Struct({
      org: S,
      safe: S,
      amount: S, // The test money minted: `150000.00`.
      txHash: S, // The last mint's transaction.
      mints: N,
      asset: S,
      balance: S,
    }),
  ]),
  errors: [error_CLI_USAGE, error_WRONG_ENVIRONMENT],
  refusals: refusals("dev.fund"),
});

// ── dev approve ─────────────────────────────────────────────────────────────────────────────

// approveCommand (command.ts:171) runs world.approve (world.ts:251): connectDevnet, then devnet.approve (index.ts:379),
// which runs in the CLI's process and not the guardian. It signs in as the `--as` email (signInAs, :476): it reads the
// standing browser handoff (no file is WRONG_ENVIRONMENT, :484; a missing value INVALID_INPUT, :505), makes a client
// with that person's dev signer from the shared seed, reuses a kept session or signs in with the devnet's fixed e2e
// sign-in code. So anyone on the machine signs as any email. Then approveWith (:447) reads client.approvals.get, refuses
// WRONG_STATE when the approval is not pending, and calls client.approvals.approve (:463): the accounts flow that reviews,
// signs the digest with the signer and approves (sdk accounts/approvals.ts:154). That flow is implementedBy. The CLI
// prints `state` (the approval's state) in place of the page's `approval`. s28.16 (s28:488, :268) reaches WRONG_STATE
// from after-s1, once s28.15 signed the approval.
export const operation_dev_approve = defineOperation({
  ...frozenText("dev.approve"),
  was: [
    page("dev.approve"),
    `${DEV}/command.ts:171`,
    `${DEV}/world.ts:251`,
    `${DEV}/world.ts:256`,
    ...WORLD_PATH,
    `${DEVNET_SDK}:379`,
    `${DEVNET_SDK}:447`,
    `${DEVNET_SDK}:452`,
    `${DEVNET_SDK}:454`,
    `${DEVNET_SDK}:463`,
    `${DEVNET_SDK}:476`,
    `${DEVNET_SDK}:484`,
    `${DEVNET_SDK}:505`,
    `${DEVNET_SDK}:513`,
    `${DEVNET_SDK}:524`,
    `${DEVNET_SDK}:530`,
    `${DEVNET_SDK}:532`,
    "packages/sdk/src/accounts/approvals.ts:61",
    "packages/sdk/src/accounts/approvals.ts:154",
    "packages/protocol/src/accounts/approval-schema.ts:67",
    `${S28}:268`,
    `${S28}:488`,
  ],
  priority: "normal",
  implementedBy: flow_client_approvals_approve,
  acceptance: frozenClaims("dev.approve"),
  returns: Schema.Struct({
    approvalId: S, // The approval signed.
    signer: S, // Who signed it: the `--as` email.
    status: Schema.Literal("signed"), // The approval's status after this signature.
    state: Schema.Literals(["pending", "approved", "rejected", "consumed", "expired"]), // The approval's state.
  }),
  errors: [error_WRONG_ENVIRONMENT],
  refusals: refusals("dev.approve", { WRONG_STATE: AFTER_S1 }),
});

// ── dev gates set ───────────────────────────────────────────────────────────────────────────

// gates.ts: refuses a key that is not a gate (listing them) and a value that is not on or off with CLI_USAGE (:24, :29),
// selects the actor (:33: --org, else the Organization `use org` saved; a handle you are not a member of is CLI_USAGE,
// auth/actor.ts:59) and restores the session (:34). With an Organization it calls `client._internal.gates.set` (:56),
// which forwards one row, access.features.set (sdk access/features.ts:76): implementedBy. With no Organization, a gate
// that targets a person (bank-payouts, scheduled-payments, beta-access, production-access: protocol features/
// catalog.ts:169, :183, :250, :270) is set for you with access.features.setMine (:41) and any other is CLI_USAGE "Name
// the Organization with --org" (:38), so as is a missing --org is refused only for an Organization-only gate. Both rows refuse
// any deployment but a local devnet and a gate whose devnet ceiling is off (FEATURE_NOT_AVAILABLE). It prints `org`
// as the handle, or the id when there is none, and `orgId` and `source` beside the page's fields (the page's `on`
// field reads as `true` in the frozen text: YAML took the key `on` for a boolean). It drops the row's `name`.
export const operation_dev_gates_set = defineOperation({
  ...frozenText("dev.gates.set"),
  was: [
    page("dev.gates.set"),
    `${DEV}/command.ts:187`,
    `${DEV}/gates.ts:24`,
    `${DEV}/gates.ts:29`,
    `${DEV}/gates.ts:33`,
    `${DEV}/gates.ts:34`,
    `${DEV}/gates.ts:37`,
    `${DEV}/gates.ts:41`,
    `${DEV}/gates.ts:56`,
    `${DEV}/gates.ts:62`,
    "apps/cli/src/auth/actor.ts:40",
    "apps/cli/src/auth/actor.ts:87",
    "apps/cli/src/auth/input.ts:11",
    `${DEV}/internal/metadata.ts:37`,
    `${RT}/environment-refusal.ts:83`,
    "packages/sdk/src/access/features.ts:76",
    "packages/sdk/src/access/features.ts:89",
    "packages/protocol/src/access/operations.ts:39",
    "packages/protocol/src/access/operations.ts:53",
    "packages/protocol/src/access/operations.ts:77",
    "packages/protocol/src/access/operations.ts:88",
    "packages/backend/src/access/features/operations/set.ts:26",
    "packages/backend/src/access/features/operations/set-mine.ts:24",
  ],
  priority: "normal",
  implementedBy: rpc_access_features_set,
  acceptance: frozenClaims("dev.gates.set"),
  returns: Schema.Union([
    Schema.Struct({
      key: FeatureKey, // The gate.
      org: S, // The Organization, by handle (its id when it has none).
      orgId: S, // The Organization's id.
      on: B, // The value set.
      ceiling: Ceiling, // The gate's ceiling on devnet.
      effective: B, // The value that applies now.
      source: Schema.Literal("devnet"),
    }),
    // A person gate with no Organization: the setMine row's answer as it came (FeatureGateSetMineSchema).
    Schema.Struct({ key: FeatureKey, on: B, ceiling: Ceiling, effective: B, source: Schema.Literal("devnet") }),
  ]),
  errors: [error_CLI_USAGE, error_WRONG_ENVIRONMENT],
  refusals: refusals("dev.gates.set"),
});

// ── dev jobs run ────────────────────────────────────────────────────────────────────────────

// jobs run (command.ts:128) runs world.jobsRun (world.ts:157): devnet.jobs.run (index.ts:278), world `jobs`. The
// guardian (service.ts:536) runs operator.jobs.run with no shift and refuses WORK_DIED naming the first failed job
// (service.ts:357). The CLI prints the JobsRun. s28.5 (s28:356, :107) reaches WRONG_ENVIRONMENT with `--env staging`
// from after-s1.
export const operation_dev_jobs_run = defineOperation({
  ...frozenText("dev.jobs.run"),
  was: [
    page("dev.jobs.run"),
    `${DEV}/command.ts:124`,
    `${DEV}/command.ts:128`,
    `${DEV}/world.ts:157`,
    ...WORLD_PATH,
    `${DEVNET_SDK}:278`,
    `${WORLD}:536`,
    `${WORLD}:333`,
    `${WORLD}:337`,
    `${WORLD}:357`,
    `${CONTROL}:127`,
    `${S28}:107`,
    `${S28}:356`,
    ON_STAGING,
  ],
  priority: "normal",
  implementedBy: rpc_operator_jobs_run,
  acceptance: frozenClaims("dev.jobs.run"),
  returns: Schema.Struct({
    at: S, // When the jobs ran.
    jobs: Schema.Array(
      Schema.Struct({
        name: S,
        outcome: Schema.Literals(["succeeded", "failed"]),
        detail: Schema.optionalKey(S),
      }),
    ), // Each job and whether it succeeded.
    scheduledRun: N, // How many due scheduled functions ran.
  }),
  errors: [error_WRONG_ENVIRONMENT],
  refusals: refusals("dev.jobs.run", { WRONG_ENVIRONMENT: AFTER_S1 }),
});

// ── dev key ─────────────────────────────────────────────────────────────────────────────────

// key.ts calls no SDK method. It checks the origin is a local http(s) one with CLI_USAGE (:50, :59), checks .env.local
// can be read and written before it mints (:189, CLI_STORAGE :109), then POSTs `{ origin }` to the deployment's
// `/v1/client/mint-quickstart-key` itself (:65), applications.quickstarts.mint: implementedBy. No answer is
// NETWORK_ERROR (:85); the RATE_LIMITED refusal is re-stated with the wait in minutes (:96); any other refusal or
// answer becomes PROVIDER_ERROR naming the HTTP status (:246), so the route's INVALID_INPUT, ENV_MISSING and WRONG_STATE
// do not reach the person. It writes the two values through a temporary file renamed over the target (:211). The page's
// WRONG_ENVIRONMENT is the `test` scope, which admits a devnet, a local origin, staging and beta. s28.12 (s28:434,
// :207) reaches CLI_USAGE from after-s1.
export const operation_dev_key = defineOperation({
  ...frozenText("dev.key"),
  was: [
    page("dev.key"),
    `${DEV}/command.ts:15`,
    `${DEV}/key.ts:50`,
    `${DEV}/key.ts:59`,
    `${DEV}/key.ts:65`,
    `${DEV}/key.ts:85`,
    `${DEV}/key.ts:96`,
    `${DEV}/key.ts:109`,
    `${DEV}/key.ts:189`,
    `${DEV}/key.ts:211`,
    `${DEV}/key.ts:237`,
    `${DEV}/key.ts:243`,
    `${DEV}/key.ts:246`,
    `${DEV}/key.ts:263`,
    `${DEV}/internal/metadata.ts:37`,
    `${RT}/environment-refusal.ts:83`,
    `${RT}/environment.ts:243`,
    `${DEV}/tests/key.test.ts:167`,
    `${DEV}/tests/key.test.ts:191`,
    `${DEV}/tests/key.test.ts:201`,
    `${DEV}/tests/key.test.ts:341`,
    "packages/backend/convex/http.ts:122",
    `${S28}:207`,
    `${S28}:434`,
  ],
  priority: "normal",
  implementedBy: rpc_applications_quickstarts_mint,
  acceptance: frozenClaims("dev.key"),
  returns: Schema.Struct({
    publishableKey: S, // The test key.
    convexSiteUrl: S, // The site URL written as `CAPXUL_SITE_URL`.
    authBaseUrl: S, // The authentication URL returned by the test key service.
    allowedOrigins: Schema.Array(S), // The origins the key works from.
    origin: S, // The local app origin used to mint the key.
    envFile: Schema.NullOr(S), // The `.env.local` written, or null with `--print`.
  }),
  errors: [error_CLI_USAGE, error_CLI_STORAGE, error_NETWORK_ERROR, error_PROVIDER_ERROR, error_WRONG_ENVIRONMENT],
  refusals: refusals("dev.key", { CLI_USAGE: AFTER_S1 }),
});

// ── dev mail list ───────────────────────────────────────────────────────────────────────────

// listCommand (mail.ts:125) runs mailList (mail.ts:13): devnet.mail.list (index.ts:297), world `mail-list`. The guardian
// (service.ts:876) runs operator.outboxes.list with the address in lower case and maps each row. The CLI prints the
// list under its own `to`.
export const operation_dev_mail_list = defineOperation({
  ...frozenText("dev.mail.list"),
  was: [
    page("dev.mail.list"),
    `${DEV}/mail.ts:125`,
    `${DEV}/mail.ts:13`,
    `${DEV}/mail.ts:19`,
    ...WORLD_PATH,
    `${DEVNET_SDK}:297`,
    `${WORLD}:876`,
    `${WORLD}:879`,
    `${CONTROL}:192`,
  ],
  priority: "normal",
  implementedBy: rpc_operator_outboxes_list,
  acceptance: frozenClaims("dev.mail.list"),
  returns: Schema.Struct({
    to: Schema.NullOr(S), // The address filtered on, or `null`.
    mail: Schema.Array(
      Schema.Struct({
        mailId: S,
        to: S,
        from: S,
        subject: S,
        template: S,
        sentAt: S,
        text: S,
        links: Schema.Array(S),
      }),
    ), // The mail Capxul sent on the devnet, newest first.
  }),
  errors: [error_WRONG_ENVIRONMENT],
  refusals: refusals("dev.mail.list"),
});

// ── dev mail notices ────────────────────────────────────────────────────────────────────────

// noticesCommand (mail.ts:139) runs mailNotices (mail.ts:31): devnet.mail.notices (index.ts:308), world `mail-notices`.
// The guardian (service.ts:900) runs operator.notices.list and maps each row; a status other than sent or failed reads
// as retrying. The CLI prints the list under its own `to` and `template`. s28.7 (s28:372, :138) reaches
// WRONG_ENVIRONMENT with `--env staging` from after-s1.
export const operation_dev_mail_notices = defineOperation({
  ...frozenText("dev.mail.notices"),
  was: [
    page("dev.mail.notices"),
    `${DEV}/mail.ts:139`,
    `${DEV}/mail.ts:31`,
    `${DEV}/mail.ts:44`,
    ...WORLD_PATH,
    `${DEVNET_SDK}:308`,
    `${WORLD}:900`,
    `${CONTROL}:210`,
    `${DEV}/tests/mail.test.ts:104`,
    `${S28}:138`,
    `${S28}:372`,
    ON_STAGING,
  ],
  priority: "normal",
  implementedBy: rpc_operator_notices_list,
  acceptance: frozenClaims("dev.mail.notices"),
  returns: Schema.Struct({
    to: Schema.NullOr(S), // The address filtered on.
    template: Schema.NullOr(S), // The template filtered on.
    notices: Schema.Array(
      Schema.Struct({
        noticeId: S,
        template: S,
        operation: S,
        to: S,
        status: Schema.Literals(["sent", "retrying", "failed"]),
        attempts: N,
        lastError: Schema.NullOr(Schema.Struct({ code: S, message: S })),
        mailId: Schema.NullOr(S),
        createdAt: S,
        updatedAt: S,
      }),
    ), // Each notice's delivery record, with its state, attempts and last error, most recently changed first.
  }),
  errors: [error_WRONG_ENVIRONMENT],
  refusals: refusals("dev.mail.notices", { WRONG_ENVIRONMENT: AFTER_S1 }),
});

// ── dev mail fail ───────────────────────────────────────────────────────────────────────────

// failCommand (mail.ts:160) runs mailFail (mail.ts:62): `--list` with any other option and `--clear` with --next or
// --to are CLI_USAGE (:71, :92). `--list` is devnet.mail.failures (world `mail-fail-list`), `--clear` is
// clearFailures (`mail-fail-clear`) and arming is devnet.mail.fail (`mail-fail`), which refuses a count outside 1 to 100
// INVALID_INPUT in the SDK (index.ts:323); a missing --next is sent as 0 (mail.ts:109) to reach that refusal. The
// guardian runs operator.outboxes.fail for all three (service.ts:937, :1001, :1007). s28.9 (s28:389, :158) reaches
// CLI_USAGE from after-s1.
export const operation_dev_mail_fail = defineOperation({
  ...frozenText("dev.mail.fail"),
  was: [
    page("dev.mail.fail"),
    `${DEV}/mail.ts:160`,
    `${DEV}/mail.ts:62`,
    `${DEV}/mail.ts:71`,
    `${DEV}/mail.ts:79`,
    `${DEV}/mail.ts:92`,
    `${DEV}/mail.ts:101`,
    `${DEV}/mail.ts:109`,
    `${DEV}/mail.ts:111`,
    ...WORLD_PATH,
    `${DEVNET_SDK}:316`,
    `${DEVNET_SDK}:323`,
    `${DEVNET_SDK}:324`,
    `${DEVNET_SDK}:325`,
    `${WORLD}:935`,
    `${WORLD}:937`,
    `${WORLD}:1001`,
    `${WORLD}:1007`,
    `${CONTROL}:239`,
    `${DEV}/tests/mail.test.ts:134`,
    `${DEV}/tests/mail.test.ts:149`,
    `${DEV}/tests/mail.test.ts:162`,
    `${S28}:158`,
    `${S28}:389`,
  ],
  priority: "normal",
  implementedBy: rpc_operator_outboxes_fail,
  acceptance: frozenClaims("dev.mail.fail"),
  returns: MailFaults,
  errors: [error_CLI_USAGE, error_WRONG_ENVIRONMENT],
  refusals: refusals("dev.mail.fail", { CLI_USAGE: AFTER_S1 }),
});
