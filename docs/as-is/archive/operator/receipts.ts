// The as-is book of the old operator concept: the receipts area.
//
// Every operation registered at `operator/receipts:*` (packages/backend/convex/operator/receipts.ts):
// the three public rows of `receipts` (packages/protocol/src/operator/operations.ts:103). Public because
// the acceptance run's browser driver calls them; each refuses unless the reserved e2e auth gate is
// enabled for this deployment's SITE_URL. Nothing here is scheduled, so every one is an rpc.

import { Schema } from "effect";
import { defineRpc } from "../../../packages/book/src/index.ts";

import { concept_operator } from "../shared/foundation.ts";
import { error_ENV_MISSING, error_INVALID_INPUT, error_NOT_AUTHENTICATED, error_UNKNOWN } from "../shared/vocabulary.ts";
import { table_e2e_receipt_holds } from "./data.ts";

const BACKEND = "packages/backend";
const CONVEX = `${BACKEND}/convex/operator/receipts.ts`;
const R = `${BACKEND}/src/operator/receipts`;
const ROWS = "packages/protocol/src/operator/operations.ts";

/** INPUT, GATED, DEFECTS (operations.ts:17, :23). */
const ROW_ERRORS = [error_INVALID_INPUT, error_NOT_AUTHENTICATED, error_UNKNOWN, error_ENV_MISSING];

/** requireE2EControls (receipts/guards.ts:12): Access's e2e auth verdict for SITE_URL must be `enabled`. */
const GATE_WAS = [`${R}/guards.ts:12`, `${R}/errors.ts:6`, `${BACKEND}/src/access/sessions/rules.ts:126`];

const WHO =
  "Anyone who can reach a deployment whose reserved e2e auth gate is enabled (a loopback deployment, or the isolated " +
  "candidate or staging site with the test key classes); no session. Elsewhere every call is NOT_AUTHENTICATED.";

const UserOperation = Schema.Struct({ userOpHash: Schema.String });

export const rpc_operator_receipts_hold = defineRpc({
  id: "operator.receipts.hold",
  title: "Withhold one user operation's receipt from every backend observer",
  about:
    "Row `operator.receipts.hold`, registered as the public mutation `operator/receipts:hold` (A06, #1976). The gate, " +
    "then a hold row for the hash unless one exists. Idempotent; the hash is not checked for shape.",
  was: [`${CONVEX}:5`, `${R}/operations/hold.ts:10`, `${R}/reads.ts:7`, `${R}/writes.ts:9`, `${ROWS}:105`, ...GATE_WAS],
  concept: concept_operator,
  kind: "mutation",
  who: WHO,
  input: UserOperation,
  output: Schema.Struct({ held: Schema.Literal(true) }),
  errors: ROW_ERRORS,
  reads: [table_e2e_receipt_holds],
  writes: [table_e2e_receipt_holds],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_operator_receipts_release = defineRpc({
  id: "operator.receipts.release",
  title: "Hand a held receipt back",
  about:
    "Row `operator.receipts.release`, registered as the public mutation `operator/receipts:release`. The gate, then the " +
    "hash's hold row is deleted; `released: false` when nothing was held.",
  was: [`${CONVEX}:7`, `${R}/operations/release.ts:10`, `${R}/reads.ts:7`, `${R}/writes.ts:17`, `${ROWS}:112`, ...GATE_WAS],
  concept: concept_operator,
  kind: "mutation",
  who: WHO,
  input: UserOperation,
  output: Schema.Struct({ released: Schema.Boolean }),
  errors: ROW_ERRORS,
  reads: [table_e2e_receipt_holds],
  writes: [table_e2e_receipt_holds],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_operator_receipts_is_held = defineRpc({
  id: "operator.receipts.is-held",
  title: "Whether a user operation's receipt is held",
  about:
    "Row `operator.receipts.isHeld`, registered as the public query `operator/receipts:isHeld`. The gate, then whether " +
    "the hash has a hold row. The backend's own chain seam asks it before returning any receipt, over " +
    "CONVEX_CLOUD_URL's HTTP query API rather than in-process; that seam fails open: a hold it cannot read returns the " +
    "real receipt and records an errored `e2e.receipt_hold` span.",
  was: [
    `${CONVEX}:6`,
    `${R}/operations/is-held.ts:10`,
    `${R}/reads.ts:7`,
    `${ROWS}:119`,
    `${BACKEND}/src/platform/proof-controls/receipt-policy.ts:56`,
    `${BACKEND}/src/operator/README.md:241`,
    ...GATE_WAS,
  ],
  concept: concept_operator,
  kind: "query",
  who: `${WHO} Its main caller is the backend's chain seam (platform/proof-controls/receipt-policy.ts:71).`,
  input: UserOperation,
  output: Schema.Boolean,
  errors: ROW_ERRORS,
  reads: [table_e2e_receipt_holds],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});
