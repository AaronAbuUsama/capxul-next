// The as-is book of the old operator concept: the clocks area.
//
// The one operation registered at `operator/clocks:*` (packages/backend/convex/operator/clocks.ts): an
// internal action run with `convex run` (`capxul dev time`, through the devnet guardian). Not scheduled,
// so an rpc.

import { Schema } from "effect";
import { defineRpc } from "../../../packages/book/src/index.ts";

import { concept_operator } from "../shared/foundation.ts";
import { error_UNKNOWN } from "../shared/vocabulary.ts";

const BACKEND = "packages/backend";

export const rpc_operator_clocks_read = defineRpc({
  id: "operator.clocks.read",
  title: "Business time, wall time and the devnet offset",
  about:
    "The internal action `operator/clocks:read` (G8). The business clock's now, the wall time (now minus the offset), " +
    "the offset and the derived tier. Every deployment but the devnet reads offset 0; there is no gate, so any " +
    "deployment answers. An action, not a query: Convex caches a query's answer and the time it read. It duplicates the " +
    "public operator.diagnostics.clock with two more fields.",
  was: [
    `${BACKEND}/convex/operator/clocks.ts:4`,
    `${BACKEND}/src/operator/clocks/operations/read.ts:15`,
    `${BACKEND}/src/operator/clocks/operations/read.ts:21`,
    `${BACKEND}/src/platform/clock.ts:54`,
    `${BACKEND}/src/platform/clock.ts:119`,
  ],
  concept: concept_operator,
  kind: "action",
  who: "internal: an operator with `convex run` (`capxul dev time` through the devnet guardian); no caller check.",
  input: Schema.Struct({}),
  output: Schema.Struct({
    nowMs: Schema.Number,
    wallMs: Schema.Number,
    offsetMs: Schema.Number,
    tier: Schema.Literals(["development", "staging", "beta", "production", "unknown", "local"]),
  }),
  errors: [error_UNKNOWN],
  reads: [],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});
