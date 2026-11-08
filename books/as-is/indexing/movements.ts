// The as-is book of the old indexing concept: the movements area.
//
// Every operation registered at `indexing/movements:*` (packages/backend/convex/indexing/movements.ts).
// `scan` and `scanAdded` are cron-driven internal actions (packages/backend/src/platform/jobs.ts:125,
// :139), so they are workflows; `loadCheckpoint` and `applyWindow` are the internal query and mutation
// they run through `ctx.runQuery` and `ctx.runMutation`, so they are rpcs.
//
// Indexing owns none of the rows a scan writes. The Movement projection, its attributions, its checkpoint
// and the Deposit Payments it births are payments' tables, written through payments' door
// (`readMovementCheckpointInTx`, `applyMovementWindowInTx`), so the rpcs invoke those procedures and list
// no table of their own. A workflow lists what the rpcs it runs reach.

import { Schema } from "effect";
import { defineRpc, defineWorkflow } from "../../../packages/book/src/index.ts";

import { concept_indexing } from "../shared/foundation.ts";
import { integration_chain_evidence } from "../shared/external.ts";
import {
  error_INVALID_INPUT,
  error_NOT_IMPLEMENTED,
  error_UNKNOWN,
  event_movement_scan_checkpoint,
  event_movement_scan_incident,
  event_movement_scan_window,
} from "../shared/vocabulary.ts";
import { table_movement_scan_checkpoints } from "../payments/data.ts";
import {
  procedure_payments_apply_movement_window_in_tx,
  procedure_payments_read_movement_checkpoint_in_tx,
} from "../payments/procedures.ts";

const BACKEND = "packages/backend";
const SRC = `${BACKEND}/src`;
const CONVEX = `${BACKEND}/convex/indexing/movements.ts`;
const MV = `${SRC}/indexing/movements`;
const OPS = `${MV}/operations`;
const JOBS = `${SRC}/platform/jobs.ts`;

/** `assetValidator` (payments/movements/rules/movements.ts): the scanner reads Base Sepolia only. */
const ScannedAsset = Schema.Struct({
  chainId: Schema.Literal(84532),
  tokenAddress: Schema.String,
  deploymentStartBlock: Schema.Number,
});

/** `MovementScanCheckpoint` (payments/movements/rules/movements.ts). */
const Checkpoint = Schema.Struct({
  chainId: Schema.Literal(84532),
  tokenAddress: Schema.String,
  nextBlock: Schema.Number,
  anchorBlockNumber: Schema.Number,
  anchorBlockHash: Schema.String,
});

const Counts = Schema.Struct({
  movementsInserted: Schema.Number,
  movementsReplayed: Schema.Number,
  movementsRemoved: Schema.Number,
  attributionsInserted: Schema.Number,
  settlementsSuppressed: Schema.Number,
  depositsMaterialized: Schema.Number,
  depositsRolledBack: Schema.Number,
});

/** commitScan (movements/writes.ts:97): probe, plan, read ten windows at a time, commit each in order. */
const SCAN_WAS = [
  `${MV}/writes.ts:97`,
  `${MV}/writes.ts:102`,
  `${MV}/writes.ts:119`,
  `${MV}/writes.ts:124`,
  `${MV}/writes.ts:136`,
  `${MV}/writes.ts:145`,
  `${MV}/writes.ts:171`,
  `${MV}/writes.ts:182`,
  `${MV}/external.ts:32`,
  `${MV}/external.ts:47`,
  `${MV}/errors.ts:13`,
  `${MV}/rules.ts:22`,
  `${MV}/rules.ts:24`,
  `${MV}/rules.ts:117`,
  `${MV}/events.ts:12`,
  `${MV}/events.ts:22`,
  `${MV}/events.ts:46`,
  `${MV}/events.ts:59`,
  `${MV}/reads.ts:29`,
  `${SRC}/indexing/external.ts:11`,
];

const SCAN_STEPS = [
  { name: "checkpoint", about: "Runs indexing.movements.load-checkpoint: the asset's saved checkpoint, or null before its first window." },
  {
    name: "probe",
    about: "Reads the one-block window at the anchor (or the deployment block); a provider failure ends the scan as an incident window and incident.",
  },
  {
    name: "resume",
    about: "Plans the resume from the checkpoint and the probed anchor hash; a changed hash is an `anchor_hash_change` incident and a reorganization.",
  },
  {
    name: "read",
    about: "Plans 10,000-block windows to the chain head and reads ten at a time; a size refusal splits a window in half, any other failure ends the scan.",
  },
  {
    name: "commit",
    about: "Runs indexing.movements.apply-window for each window in source order, fenced by the checkpoint it expects.",
  },
  {
    name: "report",
    about: "A window that changed something posts `movement_scan_window` and `movement_scan_checkpoint`; a quiet one posts nothing.",
  },
];

export const rpc_indexing_movements_load_checkpoint = defineRpc({
  id: "indexing.movements.load-checkpoint",
  title: "The scan's saved checkpoint for one asset",
  about:
    "The internal query `indexing/movements:loadCheckpoint`. Payments reads the asset's checkpoint (next block and " +
    "anchor), or null before its first window; any refusal Payments throws is admitted with no codes and becomes UNKNOWN.",
  was: [`${CONVEX}:4`, `${OPS}/load-checkpoint.ts:9`, `${MV}/reads.ts:22`, `${SRC}/payments/movements/reads/movements.ts:153`],
  concept: concept_indexing,
  kind: "query",
  who: "internal: run by the movement scans (`savedCheckpoint`, movements/reads.ts:29).",
  input: Schema.Struct({ asset: ScannedAsset }),
  output: Schema.NullOr(Checkpoint),
  errors: [error_UNKNOWN],
  reads: [],
  writes: [],
  drives: [],
  invokes: [procedure_payments_read_movement_checkpoint_in_tx],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_indexing_movements_apply_window = defineRpc({
  id: "indexing.movements.apply-window",
  title: "One window's Movements and its checkpoint, in one transaction",
  about:
    "The internal mutation `indexing/movements:applyWindow`. Hands the window to Payments' `applyMovementWindowInTx` at " +
    "the business clock's now, admitting NOT_IMPLEMENTED (scanner off) and INVALID_INPUT (the checkpoint or range " +
    "moved); the checkpoint the scan expects fences it, so two scans never both advance. A replayed window after a " +
    "saved checkpoint that changed nothing is a no-op tick: no wide event (CAP-655, ADR-0020 B1).",
  was: [`${CONVEX}:3`, `${OPS}/apply-window.ts:17`, `${OPS}/apply-window.ts:23`, `${MV}/writes.ts:59`, `${MV}/writes.ts:47`, `${MV}/rules.ts:126`],
  concept: concept_indexing,
  kind: "mutation",
  who: "internal: run by the movement scans for each window they read (movements/writes.ts:76).",
  input: Schema.Struct({
    asset: ScannedAsset,
    range: Schema.Struct({ fromBlock: Schema.Number, toBlock: Schema.Number }),
    chainHead: Schema.Struct({ chainId: Schema.Number, blockNumber: Schema.Number, blockHash: Schema.String }),
    anchor: Schema.Struct({ chainId: Schema.Number, blockNumber: Schema.Number, blockHash: Schema.String }),
    /** `TransferEvidence` rows: too deep to transcribe. */
    transfers: Schema.Array(Schema.Unknown),
    expectedCheckpoint: Schema.NullOr(Checkpoint),
    mode: Schema.Literals(["initial", "overlap", "reorganization", "continuation"]),
  }),
  output: Schema.Struct({ checkpoint: Checkpoint, counts: Counts }),
  errors: [error_NOT_IMPLEMENTED, error_INVALID_INPUT, error_UNKNOWN],
  reads: [],
  writes: [],
  drives: [],
  invokes: [procedure_payments_apply_movement_window_in_tx],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const workflow_indexing_movements_scan = defineWorkflow({
  id: "indexing.movements.scan",
  title: "Scan one asset's ERC-20 Transfers into Movements",
  about:
    "The internal action `indexing/movements:scan`, one cron job per scanned money asset (`scan Movement " +
    "<chainId>:<token>`, every minute, `crons.interval`), run as the system job `movement_scanner`. The jobs are " +
    "registered only while `CAPXUL_MOVEMENT_SCANNER_ENABLED` is on, and it is compiled off (protocol evm/assets.ts:84), " +
    "so no scan cron runs: Ponder observes Capxul's own assets (CAP-979, ADR-0042 D12). Run by hand it refuses " +
    "NOT_IMPLEMENTED. When on, it commits every window from the checkpoint to the chain head; a provider failure ends " +
    "the scan as an incident without applying later windows; any other read failure is UNKNOWN (`windowUnreadable`). " +
    "Returns the asset, the outcome (committed, partial after a split, or incident), the checkpoint, every window and " +
    "the counts. A tick whose every window changed nothing is a no-op: no wide event. Timeout is Convex's action limit; " +
    "the code sets none.",
  was: [
    `${CONVEX}:5`,
    `${OPS}/scan.ts:26`,
    `${OPS}/scan.ts:32`,
    `${OPS}/scan.ts:33`,
    `${OPS}/scan.ts:37`,
    `${MV}/guards.ts:7`,
    `${JOBS}:125`,
    "packages/protocol/src/evm/assets.ts:84",
    `${SRC}/indexing/README.md:155`,
    ...SCAN_WAS,
  ],
  concept: concept_indexing,
  priority: "normal",
  trigger: { cron: "* * * * *" },
  instance: { per: table_movement_scan_checkpoints },
  steps: [
    { name: "attribute", about: "Records the run as the system job `movement_scanner`." },
    { name: "gate", about: "Refuses NOT_IMPLEMENTED while the Movement scanner is compiled off, which it is." },
    ...SCAN_STEPS,
  ],
  reads: [],
  writes: [],
  drives: [],
  invokes: [procedure_payments_read_movement_checkpoint_in_tx, procedure_payments_apply_movement_window_in_tx],
  emits: [event_movement_scan_window, event_movement_scan_checkpoint, event_movement_scan_incident],
  calls: [integration_chain_evidence.c.readTransferWindow],
  chain: [],
  idempotency:
    "Each window's mutation is fenced by the checkpoint it expects, and a replayed Transfer is replayed, not inserted again.",
  timeoutMs: 600000,
  retries: { max: 0, backoff: "none" },
});

export const workflow_indexing_movements_scan_added = defineWorkflow({
  id: "indexing.movements.scan-added",
  title: "Scan the tokens Organizations added to their books",
  about:
    "The internal action `indexing/movements:scanAdded`, the cron job `scan added tokens` (every minute, registered " +
    "unconditionally), run as `movement_scanner`. It reads Books' added tokens (the internal query " +
    "`books/assets:tokens`), keeps the Base Sepolia ones and scans each one after another from its own checkpoint, as a " +
    "Capxul asset's cron would, with the scanner compiled off: an added token has no indexer source, so the scanner is " +
    "its observer (CAP-979). One token's failure leaves the others' scans standing and is counted. Returns how many " +
    "scanned and how many failed. A run whose every scan was quiet is a no-op tick. The schema has no link from a " +
    "workflow to the Books rpc it runs; it is named here. Timeout is Convex's action limit; the code sets none.",
  was: [
    `${CONVEX}:6`,
    `${OPS}/scan-added.ts:32`,
    `${OPS}/scan-added.ts:18`,
    `${OPS}/scan-added.ts:22`,
    `${OPS}/scan-added.ts:42`,
    `${OPS}/scan-added.ts:45`,
    `${OPS}/scan-added.ts:49`,
    `${JOBS}:139`,
    `${SRC}/books/assets/operations/tokens.ts:10`,
    `${SRC}/indexing/README.md:82`,
    ...SCAN_WAS,
  ],
  concept: concept_indexing,
  priority: "normal",
  trigger: { cron: "* * * * *" },
  instance: "singleton",
  steps: [
    { name: "attribute", about: "Records the run as the system job `movement_scanner`." },
    { name: "tokens", about: "Runs Books' internal query `books/assets:tokens` and keeps the tokens on chain 84532." },
    { name: "per-token", about: "Scans each token in turn, as the per-asset scan does, each failure caught and counted." },
    ...SCAN_STEPS,
  ],
  reads: [],
  writes: [],
  drives: [],
  invokes: [procedure_payments_read_movement_checkpoint_in_tx, procedure_payments_apply_movement_window_in_tx],
  emits: [event_movement_scan_window, event_movement_scan_checkpoint, event_movement_scan_incident],
  calls: [integration_chain_evidence.c.readTransferWindow],
  chain: [],
  idempotency:
    "Each token's windows are fenced by its checkpoint; a token scanned again from the same checkpoint replays its Transfers.",
  timeoutMs: 600000,
  retries: { max: 0, backoff: "none" },
});

