// The old indexing concept's one table, as the old code has it (factory, branch integration/factory).
// Evidence, not the target design.
//
// packages/backend/src/indexing/tables.ts, composed into the one schema at
// packages/backend/convex/schema.ts:77. The Movement tables the scan fills (`movements`,
// `movementAttributions`, `movementScanCheckpoints`, `depositMaterializations`) are owned by payments
// (packages/backend/src/payments/tables/movements.ts) and booked in ../payments/data.ts. The drift
// cycle's lease has no status column (held when `leaseToken` is set), so no machine is booked.

import { Schema } from "effect";
import { defineTable } from "../../../packages/book/src/index.ts";
import { concept_indexing } from "../shared/foundation.ts";

const I = "packages/backend/src/indexing";

const opt = Schema.optionalKey;

export const table_drift_cycles = defineTable({
  id: "drift-cycles",
  title: "Drift cycles: the drift reconciler's lease and what it last compared",
  about:
    "One row, read with `.first()` and no index. A cycle holds `leaseToken` until `leaseUntil` (now plus ten minutes, " +
    "the Convex action limit), so two runs never compare at once; a run that dies blocks the next ones at most that " +
    "long. A completed cycle releases the lease and records what it compared: the indexer head, the canonical block hash " +
    "at that head when it read one, and the mark (SHA-256 of every Convex snapshot in native order); a skipped or failed " +
    "cycle releases the lease and records nothing. A run that finds all three unchanged skips. Nothing enforces one " +
    "row: a second insert would be read or not depending on `.first()`. The table comment says the V3 cut (CAP-352) " +
    "deletes it with the reconciler.",
  was: [`${I}/tables.ts:16`, `${I}/tables.ts:1`, `${I}/drifts/reads.ts:222`, `${I}/drifts/writes/leases.ts:21`, `${I}/drifts/writes/leases.ts:37`, `${I}/drifts/writes/leases.ts:54`, "packages/backend/convex/schema.ts:77"],
  concept: concept_indexing,
  tenancy: "global",
  scope: "One row for the deployment; no tenant.",
  fields: Schema.Struct({
    leaseToken: opt(Schema.String),
    leaseUntil: opt(Schema.Number),
    comparedHead: opt(Schema.Number),
    comparedBlockHash: opt(Schema.String),
    comparedMark: opt(Schema.String),
    comparedAt: opt(Schema.Number),
    updatedAt: Schema.Number,
  }),
  key: [],
  indexes: [],
  retention: "One row, patched in place by every claim and close; never deleted.",
});
