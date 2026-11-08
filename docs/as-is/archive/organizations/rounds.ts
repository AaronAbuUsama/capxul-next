// The as-is book of the old organizations concept: the rounds area (a v4 company's priced rounds).
//
// Every operation registered at `organizations/rounds:*` (packages/backend/convex/organizations/rounds.ts):
// the public action `create` (row `organizations.rounds.create`, packages/protocol/src/organizations/
// round-operations.ts), its internal mutation `recordCreate`, and the telemetry plumbing
// `emitRoundTransitioned`. The proposal settlement notes a priced round open (`recordRoundsLandedInTx`,
// booked on organizations.proposals.settle); the landed-equity note opens SAFE rounds (equity.ts).

import { Schema } from "effect";
import { defineRpc } from "../../../packages/book/src/index.ts";

import { concept_organizations } from "../shared/foundation.ts";
import {
  error_AUTHORISED_EXCEEDED,
  error_ENV_MISSING,
  error_FEATURE_NOT_AVAILABLE,
  error_INVALID_INPUT,
  error_NOT_AUTHENTICATED,
  error_PROVIDER_ERROR,
  error_ROLE_PERMISSION_DENIED,
  error_SMART_ACCOUNT_MISSING,
  error_UNKNOWN,
  error_WRONG_STATE,
  event_fundraise_round_transitioned,
} from "../shared/vocabulary.ts";
import { contract_captable, contract_options, contract_share_class } from "../shared/external.ts";
import { table_org_rounds, table_org_safe_proposals } from "./data.ts";
import { procedure_access_require_feature_from_action } from "../access/procedures.ts";
import {
  PROPOSALS_LOAD_WAS,
  PROPOSALS_RECORD_OWNER,
  PROPOSALS_RECORD_OWNER_WAS,
  PROPOSALS_REFRESH,
  PROPOSALS_REFRESH_WAS,
  PROPOSALS_SAFE_OWNER,
  PROPOSALS_SAFE_OWNER_WAS,
  PROPOSALS_SETTLE,
  SafeProposal,
  union,
} from "./proposals.ts";
import { EQUITY_FACTS, EQUITY_FACTS_WAS, EQUITY_HEADROOM_READS, EQUITY_LANDED, EQUITY_LANDED_WAS } from "./equity.ts";

const BACKEND = "packages/backend";
const CONVEX = `${BACKEND}/convex/organizations/rounds.ts`;
const ORG = `${BACKEND}/src/organizations`;
const SRC = `${ORG}/rounds`;
const OPS = `${SRC}/operations`;
const ROWS = "packages/protocol/src/organizations/round-operations.ts";
const SCHEMA = "packages/protocol/src/organizations/round-schema.ts";

const DEFECT = [error_UNKNOWN];

const Owner = Schema.Struct({
  orgId: Schema.String,
  chainId: Schema.Number,
  safeAddress: Schema.String,
  chainNonce: Schema.Number,
  threshold: Schema.Number,
  proposer: Schema.String,
});
const Call = Schema.Struct({ to: Schema.String, value: Schema.String, data: Schema.String });

/** `recordCreateInTx` (writes.ts:46): a waiting round of the same call answers; else the proposal and the round together. */
const RECORD = {
  reads: [table_org_rounds, table_org_safe_proposals],
  writes: [table_org_rounds, ...PROPOSALS_RECORD_OWNER.writes],
};
const RECORD_WAS = [`${SRC}/writes.ts:22`, `${SRC}/writes.ts:46`, `${SRC}/writes.ts:59`, `${SRC}/writes.ts:71`, `${SRC}/writes.ts:75`, `${SRC}/writes.ts:86`, `${SRC}/writes.ts:99`, ...PROPOSALS_RECORD_OWNER_WAS];

export const rpc_organizations_rounds_create = defineRpc({
  id: "organizations.rounds.create",
  title: "Open a priced round as one Board proposal",
  about:
    "Row `organizations.rounds.create`, registered as the public action `organizations/rounds:create` (CAP-1193). Signed in. " +
    "The `equity` gate and `requireSafeOwner` (proposals load and refresh, the caller a Director now). A pay-by day already " +
    "past is INVALID_INPUT. organizations.equity.record `landed` notes earlier Board proposals; equity not installed is " +
    "WRONG_STATE. organizations.equity.load reads the company; an unknown class is INVALID_INPUT. The fully diluted count " +
    "is every class's issued shares (the Captable's classes and each class token's supply) plus the option pool; " +
    "`priceRound` prices the pre-money over it (too low a price, or a raise that buys no whole share, INVALID_INPUT). The " +
    "class's headroom is read: a Captable closed for an exit is WRONG_STATE, over the authorised amount " +
    "AUTHORISED_EXCEEDED. organizations.rounds.record-create stores the round and its Board proposal of " +
    "`Rounds.createPricedRound` in the company's USDC (the synthetic test asset's address, hard-coded) with the terms " +
    "hash; the same round again while it waits answers its proposal.",
  was: [
    `${CONVEX}:3`,
    `${OPS}/create.ts:34`,
    `${OPS}/create.ts:46`,
    `${OPS}/create.ts:50`,
    `${OPS}/create.ts:51`,
    `${OPS}/create.ts:54`,
    `${OPS}/create.ts:57`,
    `${OPS}/create.ts:65`,
    `${OPS}/create.ts:68`,
    `${OPS}/create.ts:75`,
    `${OPS}/create.ts:80`,
    `${OPS}/create.ts:88`,
    `${OPS}/create.ts:93`,
    `${OPS}/create.ts:94`,
    `${OPS}/create.ts:103`,
    `${OPS}/create.ts:113`,
    `${ROWS}:18`,
    `${SCHEMA}:32`,
    `${SCHEMA}:51`,
    `${SRC}/external.ts:25`,
    "packages/protocol/src/organizations/round-pricing.ts:16",
    ...PROPOSALS_SAFE_OWNER_WAS,
    ...PROPOSALS_LOAD_WAS,
    ...PROPOSALS_REFRESH_WAS,
    ...EQUITY_FACTS_WAS,
    ...EQUITY_LANDED_WAS,
    ...RECORD_WAS,
  ],
  concept: concept_organizations,
  kind: "action",
  who: "A signed-in current Seat whose claimed personal Safe is a live Director of the company Safe (and, behind the Signer Gate, wears the Director hat).",
  input: Schema.Struct({
    orgId: Schema.String,
    className: Schema.String,
    preMoney: Schema.Number,
    raise: Schema.Number,
    payBy: Schema.String,
    termsHash: Schema.String,
    note: Schema.optionalKey(Schema.String),
  }),
  output: Schema.Struct({
    status: Schema.Literals(["awaiting_approvals", "opened"]),
    round: Schema.Struct({
      classId: Schema.Number,
      className: Schema.String,
      token: Schema.String,
      preMoney: Schema.Number,
      raise: Schema.Number,
      fullyDiluted: Schema.Number,
      price: Schema.String,
      priceUnits: Schema.String,
      maxShares: Schema.Number,
      payBy: Schema.Number,
      termsHash: Schema.String,
    }),
    proposal: SafeProposal,
  }),
  errors: [
    error_NOT_AUTHENTICATED,
    error_INVALID_INPUT,
    error_UNKNOWN,
    error_ENV_MISSING,
    error_ROLE_PERMISSION_DENIED,
    error_SMART_ACCOUNT_MISSING,
    error_WRONG_STATE,
    error_PROVIDER_ERROR,
    error_FEATURE_NOT_AVAILABLE,
    error_AUTHORISED_EXCEEDED,
  ],
  reads: union(PROPOSALS_SAFE_OWNER.reads, EQUITY_LANDED.reads, EQUITY_FACTS.reads, RECORD.reads),
  writes: union(PROPOSALS_SETTLE.writes, EQUITY_LANDED.writes, RECORD.writes),
  drives: PROPOSALS_SETTLE.drives,
  invokes: union([procedure_access_require_feature_from_action], PROPOSALS_SAFE_OWNER.invokes, EQUITY_FACTS.invokes),
  emits: union(PROPOSALS_SETTLE.emits, EQUITY_LANDED.emits),
  calls: PROPOSALS_REFRESH.calls,
  chain: union(
    PROPOSALS_REFRESH.chain,
    [contract_captable.f.numberOfClasses, contract_options.f.pool, contract_captable.f.getClass, contract_share_class.f.totalSupply],
    EQUITY_HEADROOM_READS,
  ),
  spans: PROPOSALS_REFRESH.spans,
});

export const rpc_organizations_rounds_record_create = defineRpc({
  id: "organizations.rounds.record-create",
  title: "Store a priced round and the Board proposal that opens it",
  about:
    "Registered as the internal mutation `organizations/rounds:recordCreate`, run by create. The rounds with the same call " +
    "digest are read; one whose proposal still waits answers it. Else `recordOwnerProposalInTx` stores the proposal " +
    "(`round_create`, keyed `<orgId>:<digest>:<count>`) and the round is inserted with it, unnumbered until the settlement " +
    "that sees its proposal execute gives it the Rounds clone's next number. Refusals from the proposal store " +
    "(INVALID_INPUT, WRONG_STATE).",
  was: [`${CONVEX}:4`, `${OPS}/record-create.ts:9`, `${OPS}/record-create.ts:36`, ...RECORD_WAS, `${SRC}/writes.ts:117`],
  concept: concept_organizations,
  kind: "mutation",
  who: "internal: run by organizations.rounds.create.",
  input: Schema.Struct({
    orgId: Schema.String,
    authUserId: Schema.String,
    owner: Owner,
    callDigest: Schema.String,
    call: Call,
    note: Schema.String,
    classId: Schema.Number,
    className: Schema.String,
    preMoney: Schema.Number,
    raise: Schema.Number,
    priceUnits: Schema.String,
    maxShares: Schema.Number,
    payBy: Schema.Number,
    termsHash: Schema.String,
  }),
  output: SafeProposal,
  errors: [error_INVALID_INPUT, error_WRONG_STATE, ...DEFECT],
  reads: RECORD.reads,
  writes: RECORD.writes,
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_organizations_rounds_emit_round_transitioned = defineRpc({
  id: "organizations.rounds.emit-round-transitioned",
  title: "Deliver one fundraise_round_transitioned event",
  about:
    "Telemetry plumbing: registered as the internal action `organizations/rounds:emitRoundTransitioned`. Scheduled " +
    "(`scheduleTelemetryEmit`) when a priced round's proposal settles executed (the proposal settlement) or a SAFE round " +
    "opens (the landed-equity note), with the round's number on the Rounds clone. Posts `fundraise_round_transitioned` " +
    "(`opened`, priced or safe) as the proposing Director in their Organization. It reads and writes no table.",
  was: [`${CONVEX}:5`, `${OPS}/emit-round-transitioned.ts:11`, `${OPS}/emit-round-transitioned.ts:25`, `${SRC}/events.ts:21`, `${SRC}/events.ts:41`, `${SRC}/events.ts:49`],
  concept: concept_organizations,
  kind: "action",
  who: "internal: scheduled by the proposal settlement and the landed-equity note.",
  input: Schema.Struct({
    transition: Schema.Literal("opened"),
    roundKind: Schema.Literals(["priced", "safe"]),
    organizationId: Schema.String,
    authUserId: Schema.String,
    roundId: Schema.Number,
    proposalId: Schema.String,
    occurredAt: Schema.Number,
  }),
  output: Schema.Void,
  errors: [],
  reads: [],
  writes: [],
  drives: [],
  invokes: [],
  emits: [event_fundraise_round_transitioned],
  calls: [],
  chain: [],
  spans: [],
});
