// The as-is book of the old accounts concept: the lanes area (CAP-1097: the Companies House
// service key's sender lane, one send in flight).
//
// Every operation registered at `accounts/lanes:*` (packages/backend/convex/accounts/lanes.ts).
// Both are internal mutations an action runs through ctx.runMutation inside `withServiceLane`
// (lanes/external.ts:21, booked as procedures.ts' accounts.with-service-lane); neither is
// scheduled, so both are rpcs. Paths in `was` are relative to the old repository root.

import { Schema } from "effect";
import { defineRpc } from "../../../packages/book/src/index.ts";

import { concept_accounts } from "../shared/foundation.ts";
import { error_INVALID_INPUT } from "../shared/vocabulary.ts";
import { table_service_lanes } from "./data.ts";

const BACKEND = "packages/backend";
const CONVEX = `${BACKEND}/convex/accounts/lanes.ts`;
const LANES = `${BACKEND}/src/accounts/lanes`;

const LaneKey = Schema.Struct({ chainId: Schema.Number, sender: Schema.String, holder: Schema.String });

const RUN_BY_LANE =
  "internal: run through ctx.runMutation by `withServiceLane` in the caller's action: accounts.claims.claim and " +
  "Organizations' setup deploys and equity sends.";

const noChain = { drives: [], invokes: [], emits: [], calls: [], chain: [], spans: [] } as const;

export const rpc_accounts_lanes_reserve = defineRpc({
  id: "accounts.lanes.reserve",
  title: "Take the service key's lane for one send, or answer busy",
  about:
    "Internal mutation. The chain id must be a safe integer, the sender 0x+40 hex once lowercased, and the holder " +
    "non-empty (INVALID_INPUT `lane`). With no row it inserts one held until now + 180 s and answers `reserved`; a row held " +
    "by another holder until a later time answers `busy`; otherwise (its own hold, or a lapsed one) it takes the row until " +
    "now + 180 s. Time is the wall clock, so a devnet warp cannot move a hold.",
  was: [`${CONVEX}:4`, `${LANES}/operations/reserve.ts:9`, `${LANES}/writes.ts:31`, `${LANES}/writes.ts:65`, `${LANES}/errors.ts:14`],
  concept: concept_accounts,
  kind: "mutation",
  who: RUN_BY_LANE,
  input: LaneKey,
  output: Schema.Struct({ status: Schema.Literals(["reserved", "busy"]) }),
  errors: [error_INVALID_INPUT],
  reads: [table_service_lanes],
  writes: [table_service_lanes],
  ...noChain,
});

export const rpc_accounts_lanes_release = defineRpc({
  id: "accounts.lanes.release",
  title: "Free the service key's lane; only its holder can",
  about:
    "Internal mutation. A sender that is not an address does nothing. When the row's holder is this holder it sets " +
    "`until` to 0; a lapsed holder's release never frees a newer hold. Answers null. `withServiceLane` ignores its failure.",
  was: [`${CONVEX}:3`, `${LANES}/operations/release.ts:10`, `${LANES}/writes.ts:53`, `${LANES}/writes.ts:74`],
  concept: concept_accounts,
  kind: "mutation",
  who: RUN_BY_LANE,
  input: LaneKey,
  output: Schema.Null,
  errors: [],
  reads: [table_service_lanes],
  writes: [table_service_lanes],
  ...noChain,
});
