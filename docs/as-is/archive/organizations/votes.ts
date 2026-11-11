// The as-is book of the old organizations concept: the votes area (a v4 company's shareholder votes).
//
// Every operation registered at `organizations/votes:*` (packages/backend/convex/organizations/votes.ts).
// Eight are public actions that implement a row of `votes` (packages/protocol/src/organizations/
// vote-operations.ts and personal-vote-operations.ts); the rest are internal. follow, followBallot and
// followExecution are scheduled by the outcome mutations, so they are workflows; emitTransitioned is
// telemetry plumbing. Each vote, ballot and execution is the caller's own sponsored UserOperation to the
// company Governor; Capxul stores its part until the Governor holds it, then reads the Governor.
//
// Touches follow proposals.ts: a public action lists what this concept's internal rpcs it runs touch;
// Accounts' accounts.approvals.openForVote, which create, cast and execute run to open the approval, is
// named in `about` and booked by Accounts.

import { Schema } from "effect";
import { defineRpc, defineWorkflow, type FunctionRef } from "../../../packages/book/src/index.ts";

import { concept_organizations } from "../shared/foundation.ts";
import {
  error_BELOW_THRESHOLD,
  error_ENV_MISSING,
  error_FEATURE_NOT_AVAILABLE,
  error_INSUFFICIENT_BALANCE,
  error_INVALID_INPUT,
  error_NOT_AUTHENTICATED,
  error_PROVIDER_ERROR,
  error_PROVIDER_RESPONSE_INVALID,
  error_ROLE_PERMISSION_DENIED,
  error_SMART_ACCOUNT_MISSING,
  error_UNKNOWN,
  error_WRONG_STATE,
  event_vote_transitioned,
} from "../shared/vocabulary.ts";
import {
  contract_captable,
  contract_governor,
  contract_safe_4337_module,
  integration_chain_rpc,
} from "../shared/external.ts";
import {
  machine_org_vote,
  machine_org_vote_ballot,
  machine_org_vote_execution,
  table_org_equities,
  table_org_safe_proposals,
  table_org_vote_ballots,
  table_org_vote_executions,
  table_org_votes,
} from "./data.ts";
import { procedure_access_require_feature_from_action } from "../access/procedures.ts";
import { procedure_accounts_read_workspace_setup_signer_in_tx } from "../accounts/procedures.ts";
import {
  Approval,
  PROPOSALS_PARTICIPANT_READS,
  PROPOSALS_PARTICIPANT_WAS,
  SPONSORED_BUILD,
  SPONSORED_BUILD_WAS,
  spanUnion,
  union,
} from "./proposals.ts";

const BACKEND = "packages/backend";
const CONVEX = `${BACKEND}/convex/organizations/votes.ts`;
const ORG = `${BACKEND}/src/organizations`;
const SRC = `${ORG}/votes`;
const OPS = `${SRC}/operations`;
const ROWS = "packages/protocol/src/organizations/vote-operations.ts";
const MINE_ROWS = "packages/protocol/src/organizations/personal-vote-operations.ts";
const SCHEMA = "packages/protocol/src/organizations/vote-schema.ts";
const EVM = "packages/protocol/src/evm";

// ── errors ─────────────────────────────────────────────────────────────────────────────────

const DEFECT = [error_UNKNOWN];

/** CALL, DEFECTS, PARTICIPANT, CHAIN, ENV_MISSING: get, list, ballot, execution (vote-operations.ts:82-95). */
const READ_ROW_ERRORS = [
  error_NOT_AUTHENTICATED,
  error_INVALID_INPUT,
  error_UNKNOWN,
  error_ENV_MISSING,
  error_ROLE_PERMISSION_DENIED,
  error_PROVIDER_ERROR,
];

/** create, execute, cast: CALL, DEFECTS, PARTICIPANT, STATE, CHAIN and the gate, Safe, sponsorship and answer codes. */
const WRITE_ROW_ERRORS = [
  ...READ_ROW_ERRORS,
  error_WRONG_STATE,
  error_FEATURE_NOT_AVAILABLE,
  error_SMART_ACCOUNT_MISSING,
  error_INSUFFICIENT_BALANCE,
  error_PROVIDER_RESPONSE_INVALID,
];

// ── shared touches ─────────────────────────────────────────────────────────────────────────

/**
 * `voteContextInTx` (reads.ts:204): the vote an id names, the participant check (the input's Organization or the
 * vote's), the Organization, the caller's personal Safe and signer, and the company's equity once the setup's
 * Board proposal executed (`installedEquityInTx`: `orgEquities` and that proposal's status).
 */
const LOAD = {
  reads: union(PROPOSALS_PARTICIPANT_READS, [table_org_votes, table_org_equities, table_org_safe_proposals]),
  invokes: [procedure_accounts_read_workspace_setup_signer_in_tx],
};
const LOAD_WAS = [
  `${SRC}/reads.ts:42`,
  `${SRC}/reads.ts:117`,
  `${SRC}/reads.ts:204`,
  `${SRC}/reads.ts:208`,
  `${SRC}/reads.ts:211`,
  `${SRC}/reads.ts:226`,
  `${SRC}/reads.ts:232`,
  `${SRC}/reads.ts:248`,
  `${ORG}/equity/reads.ts:46`,
  `${ORG}/equity/reads.ts:59`,
  `${BACKEND}/src/accounts/reads/workspaces.ts:76`,
  ...PROPOSALS_PARTICIPANT_WAS,
];

/** The Governor's read of one proposal (external.ts:85): state, snapshot, deadline, tally, clock, and quorum once the snapshot passed. */
const PROPOSAL_READS = [
  contract_governor.f.state,
  contract_governor.f.proposalSnapshot,
  contract_governor.f.proposalDeadline,
  contract_governor.f.proposalVotes,
  contract_governor.f.clock,
  contract_governor.f.quorum,
];

/**
 * `settleVote` (external.ts:250): a proposed vote reads the Governor; a `sent` one reads its receipt, and past its
 * sponsorship with no receipt asks the Governor whether it holds the proposal (snapshot > 0). Failed or landed is
 * written through organizations.votes.record-outcome (landed as `proposed` with opensAt and closesAt).
 */
const SETTLE_VOTE = {
  reads: [table_org_votes],
  writes: [table_org_votes],
  drives: [machine_org_vote.t.to_proposed, machine_org_vote.t.to_failed],
  emits: [event_vote_transitioned],
  calls: [integration_chain_rpc.c.fetchUserOperationReceipt, integration_chain_rpc.c.fetchEthCall],
  chain: PROPOSAL_READS,
  spans: ["convex.mutation", "chain.read eth_getUserOperationReceipt", "chain.read eth_call", "chain.attempt <upstream>"],
};
const SETTLE_VOTE_WAS = [
  `${SRC}/external.ts:85`,
  `${SRC}/external.ts:125`,
  `${SRC}/external.ts:140`,
  `${SRC}/external.ts:250`,
  `${SRC}/rules.ts:64`,
  `${SRC}/writes.ts:65`,
];

/** `recordVoteOutcome` (writes.ts:65). */
const VOTE_OUTCOME_WAS = [`${SRC}/writes.ts:65`, `${SRC}/writes.ts:70`, `${SRC}/writes.ts:74`, `${SRC}/writes.ts:78`, `${SRC}/writes.ts:87`, `${SRC}/writes.ts:97`, `${SRC}/events.ts:37`];

/** `settleBallot` (external/ballots.ts:120): receipt, and past its sponsorship the voter's other ballots and `hasVoted`. */
const SETTLE_BALLOT = {
  reads: [table_org_vote_ballots],
  writes: [table_org_vote_ballots],
  drives: [machine_org_vote_ballot.t.to_cast, machine_org_vote_ballot.t.to_failed],
  emits: [event_vote_transitioned],
  calls: [integration_chain_rpc.c.fetchUserOperationReceipt, integration_chain_rpc.c.fetchEthCall],
  chain: [contract_governor.f.hasVoted],
  spans: ["convex.query", "convex.mutation", "chain.read eth_getUserOperationReceipt", "chain.read eth_call", "chain.attempt <upstream>"],
};
const SETTLE_BALLOT_WAS = [`${SRC}/external/ballots.ts:81`, `${SRC}/external/ballots.ts:97`, `${SRC}/external/ballots.ts:120`, `${SRC}/writes/ballots.ts:54`];

/**
 * `settleExecution` (external/executions.ts:78): the receipt; past its sponsorship with its nonce and send block noted,
 * the EntryPoint event that consumed the nonce and its transaction's receipt; then the settling block's time.
 */
const SETTLE_EXECUTION = {
  reads: [table_org_vote_executions],
  writes: [table_org_vote_executions],
  drives: [machine_org_vote_execution.t.to_executed, machine_org_vote_execution.t.to_failed],
  emits: [event_vote_transitioned],
  calls: [
    integration_chain_rpc.c.fetchUserOperationReceipt,
    integration_chain_rpc.c.fetchEntryPointUserOperationEvent,
    integration_chain_rpc.c.fetchBoundedTransactionReceipt,
    integration_chain_rpc.c.fetchBlockTimestamp,
  ],
  chain: [] as FunctionRef[],
  spans: [
    "convex.mutation",
    "chain.read eth_getUserOperationReceipt",
    "chain.read eth_getLogs",
    "chain.read eth_getTransactionReceipt",
    "chain.read eth_getBlockByNumber",
    "chain.attempt <upstream>",
  ],
};
const SETTLE_EXECUTION_WAS = [`${SRC}/external/executions.ts:29`, `${SRC}/external/executions.ts:59`, `${SRC}/external/executions.ts:78`, `${SRC}/writes/executions.ts:73`];

/** The open-and-store of create, cast and execute: the sponsored build, Accounts' openForVote, then the internal record. */
const OPEN_WAS = [`${SRC}/writes.ts:108`, `${SRC}/external.ts:148`, `${SRC}/external.ts:156`, `${SRC}/external.ts:162`, `${SRC}/guards.ts:11`, `${SRC}/guards.ts:17`, ...SPONSORED_BUILD_WAS];

/** The send of a signed vote, ballot or execution: admit, note, then eth_sendUserOperation (external.ts:187, :219). */
const SEND_WAS = [`${SRC}/external.ts:187`, `${SRC}/external.ts:219`, `${BACKEND}/src/accounts/approvals/operations/send-approved.ts:166`];

const ACTION_SPANS = ["convex.query", "convex.mutation", "chain.attempt <upstream>"];

const Call = Schema.Struct({ to: Schema.String, value: Schema.String, data: Schema.String });
const Tally = Schema.Struct({ for: Schema.Number, against: Schema.Number, abstain: Schema.Number });
const Support = Schema.Literals(["for", "against", "abstain"]);

/** `VoteSchema` (vote-schema.ts:82): Capxul's part, then the Governor's state. */
const Vote = Schema.Struct({
  voteId: Schema.String,
  orgId: Schema.String,
  chainId: Schema.Number,
  governor: Schema.String,
  proposalId: Schema.String,
  matter: Schema.Literal("authorise"),
  title: Schema.String,
  description: Schema.String,
  status: Schema.Literals([
    "awaiting_approval",
    "sent",
    "pending",
    "active",
    "canceled",
    "defeated",
    "succeeded",
    "queued",
    "expired",
    "executed",
    "failed",
    "lapsed",
  ]),
  proposer: Schema.String,
  calls: Schema.Array(Call),
  opensAt: Schema.NullOr(Schema.Number),
  closesAt: Schema.NullOr(Schema.Number),
  quorum: Schema.Number,
  tally: Schema.NullOr(Tally),
  quorumReached: Schema.NullOr(Schema.Boolean),
  approvalId: Schema.String,
  userOpHash: Schema.NullOr(Schema.String),
  createdAt: Schema.Number,
});

/** `BallotSchema` (vote-schema.ts:177). */
const Ballot = Schema.Struct({
  ballotId: Schema.String,
  voteId: Schema.String,
  orgId: Schema.String,
  org: Schema.String,
  title: Schema.String,
  governor: Schema.String,
  proposalId: Schema.String,
  voter: Schema.String,
  support: Support,
  reason: Schema.String,
  weight: Schema.Number,
  status: Schema.Literals(["awaiting_approval", "sent", "cast", "failed", "lapsed"]),
  approvalId: Schema.String,
  userOpHash: Schema.NullOr(Schema.String),
  createdAt: Schema.Number,
});

/** `ExecutionSchema` (vote-schema.ts:241). */
const Execution = Schema.Struct({
  executionId: Schema.String,
  voteId: Schema.String,
  orgId: Schema.String,
  title: Schema.String,
  governor: Schema.String,
  proposalId: Schema.String,
  executor: Schema.String,
  tally: Tally,
  status: Schema.Literals(["awaiting_approval", "sent", "executed", "failed", "lapsed"]),
  approvalId: Schema.String,
  userOpHash: Schema.NullOr(Schema.String),
  createdAt: Schema.Number,
  executedAt: Schema.NullOr(Schema.Number),
});

/** A stored `orgVotes` row without its Convex fields (rules.ts `VoteRow`). */
const VoteRow = Schema.Unknown;
const BallotRow = Schema.Unknown;
const ExecutionRow = Schema.Unknown;

const PARTICIPANT = "A signed-in current Seat of the company.";

// ── public actions ─────────────────────────────────────────────────────────────────────────

export const rpc_organizations_votes_create = defineRpc({
  id: "organizations.votes.create",
  title: "Propose a shareholder vote to the company Governor",
  about:
    "Row `organizations.votes.create`, registered as the public action `organizations/votes:create` (CAP-1202). Signed in. " +
    "The `equity` gate first, then organizations.votes.load; equity not installed is WRONG_STATE, no personal Safe " +
    "SMART_ACCOUNT_MISSING. `planMatter`: the only matter is `authorise`, whose class must be one of the template's " +
    "(INVALID_INPUT) and whose call is `Captable.setAuthorised`. `readProposerChain` reads the Governor's proposal " +
    "threshold, the caller's votes on the Captable and the quorum numerator; fewer votes than the threshold is " +
    "BELOW_THRESHOLD. The description carries the vote id, so the Governor's proposal id is computed here. `openVote` " +
    "builds the caller's sponsored `Governor.propose` on the vote's own lane, has Accounts open the approval " +
    "(accounts.approvals.openForVote) and stores the vote with organizations.votes.record. Nothing changes until it is " +
    "signed; voting opens a day after it lands and stays open seven.",
  was: [
    `${CONVEX}:5`,
    `${OPS}/create.ts:32`,
    `${OPS}/create.ts:35`,
    `${OPS}/create.ts:36`,
    `${OPS}/create.ts:37`,
    `${OPS}/create.ts:39`,
    `${OPS}/create.ts:41`,
    `${OPS}/create.ts:46`,
    `${OPS}/create.ts:60`,
    `${ROWS}:36`,
    `${SCHEMA}:27`,
    `${SCHEMA}:141`,
    `${SRC}/external.ts:59`,
    `${SRC}/rules.ts:90`,
    `${SRC}/rules.ts:114`,
    `${SRC}/writes.ts:148`,
    `${SRC}/writes.ts:25`,
    `${EVM}/company-votes.ts:26`,
    `${EVM}/company-votes.ts:57`,
    ...LOAD_WAS,
    ...OPEN_WAS,
  ],
  concept: concept_organizations,
  kind: "action",
  who: "A signed-in current Seat of a company with equity installed, whose personal Safe holds at least the Governor's proposal threshold.",
  input: Schema.Struct({
    orgId: Schema.String,
    matter: Schema.Literal("authorise"),
    class: Schema.String,
    authorised: Schema.Number,
    note: Schema.optionalKey(Schema.String),
  }),
  output: Schema.Struct({ ...Vote.fields, approval: Approval }),
  errors: [...WRITE_ROW_ERRORS, error_BELOW_THRESHOLD],
  reads: LOAD.reads,
  writes: [table_org_votes],
  drives: [],
  invokes: union([procedure_access_require_feature_from_action], LOAD.invokes),
  emits: [],
  calls: union([integration_chain_rpc.c.fetchEthCall], SPONSORED_BUILD.calls),
  chain: union(
    [contract_governor.f.proposalThreshold, contract_captable.f.getVotes, contract_governor.f.quorumNumerator],
    SPONSORED_BUILD.chain,
  ),
  spans: spanUnion(ACTION_SPANS, ["chain.read eth_call"], SPONSORED_BUILD.spans),
});

export const rpc_organizations_votes_cast = defineRpc({
  id: "organizations.votes.cast",
  title: "Cast the caller's ballot on an open vote",
  about:
    "Row `organizations.votes.cast`, registered as `organizations/votes:cast` (CAP-1219). Signed in. organizations.votes." +
    "load by the vote id; a vote of a company the caller is not in reads as no vote (INVALID_INPUT `voteNotFound`). The " +
    "`equity` gate, installed equity, the caller's Safe. `settleVote` (which may write the vote's outcome); a vote not " +
    "`proposed` is WRONG_STATE. `readVoterStanding` reads the Governor's state, snapshot, deadline and clock and the " +
    "caller's votes at the snapshot and `hasVoted`; organizations.votes.voter-ballots reads the caller's earlier ballots. " +
    "`castRefusal`: already voted (with how), not open, a ballot on its way, or no votes at the snapshot, all WRONG_STATE. " +
    "`openBallot` builds the sponsored `castVoteWithReason`, has Accounts open the approval (accounts.approvals.openForVote) " +
    "and stores the ballot with organizations.votes.record-ballot.",
  was: [
    `${CONVEX}:4`,
    `${OPS}/cast.ts:31`,
    `${OPS}/cast.ts:35`,
    `${OPS}/cast.ts:43`,
    `${OPS}/cast.ts:47`,
    `${OPS}/cast.ts:49`,
    `${OPS}/cast.ts:61`,
    `${OPS}/cast.ts:65`,
    `${MINE_ROWS}:53`,
    `${SCHEMA}:154`,
    `${SCHEMA}:205`,
    `${SRC}/external/ballots.ts:38`,
    `${SRC}/reads/ballots.ts:73`,
    `${SRC}/rules.ts:193`,
    `${SRC}/writes/ballots.ts:107`,
    `${SRC}/writes/ballots.ts:25`,
    ...LOAD_WAS,
    ...SETTLE_VOTE_WAS,
    ...OPEN_WAS,
  ],
  concept: concept_organizations,
  kind: "action",
  who: "A signed-in current Seat of the vote's company whose personal Safe held votes at the vote's snapshot.",
  input: Schema.Struct({ voteId: Schema.String, support: Support, reason: Schema.optionalKey(Schema.String) }),
  output: Schema.Struct({ ...Ballot.fields, approval: Approval }),
  errors: WRITE_ROW_ERRORS,
  reads: union(LOAD.reads, SETTLE_VOTE.reads, [table_org_vote_ballots]),
  writes: union(SETTLE_VOTE.writes, [table_org_vote_ballots]),
  drives: SETTLE_VOTE.drives,
  invokes: union([procedure_access_require_feature_from_action], LOAD.invokes),
  emits: SETTLE_VOTE.emits,
  calls: union(SETTLE_VOTE.calls, SPONSORED_BUILD.calls),
  chain: union(SETTLE_VOTE.chain, [contract_governor.f.getVotes, contract_governor.f.hasVoted], SPONSORED_BUILD.chain),
  spans: spanUnion(ACTION_SPANS, SETTLE_VOTE.spans, SPONSORED_BUILD.spans),
});

export const rpc_organizations_votes_execute = defineRpc({
  id: "organizations.votes.execute",
  title: "Execute a passed vote's calls through the Governor",
  about:
    "Row `organizations.votes.execute`, registered as `organizations/votes:execute` (CAP-1203). Signed in; anyone in the " +
    "company may. Load by the vote id (another company's vote, or one whose Organization is not the input's, is " +
    "INVALID_INPUT), the `equity` gate, installed equity, the caller's Safe. `settleVote`; a vote not `proposed` is " +
    "WRONG_STATE. organizations.votes.vote-executions reads its executions. `executeRefusal`: still open, already executed, " +
    "did not pass, or another execution on its way, all WRONG_STATE. `openExecution` builds the sponsored " +
    "`Governor.execute` of the vote's calls with its description's hash, has Accounts open the approval " +
    "(accounts.approvals.openForVote), and stores the execution with the tally it passed with through " +
    "organizations.votes.record-execution, which refuses a second one under way.",
  was: [
    `${CONVEX}:7`,
    `${OPS}/execute.ts:31`,
    `${OPS}/execute.ts:35`,
    `${OPS}/execute.ts:42`,
    `${OPS}/execute.ts:43`,
    `${OPS}/execute.ts:47`,
    `${OPS}/execute.ts:50`,
    `${OPS}/execute.ts:51`,
    `${OPS}/execute.ts:58`,
    `${ROWS}:64`,
    `${SCHEMA}:213`,
    `${SCHEMA}:266`,
    `${SRC}/reads/executions.ts:73`,
    `${SRC}/rules/executions.ts:53`,
    `${SRC}/rules/executions.ts:92`,
    `${SRC}/writes/executions.ts:29`,
    `${SRC}/writes/executions.ts:130`,
    ...LOAD_WAS,
    ...SETTLE_VOTE_WAS,
    ...OPEN_WAS,
  ],
  concept: concept_organizations,
  kind: "action",
  who: PARTICIPANT,
  input: Schema.Struct({ orgId: Schema.String, voteId: Schema.String }),
  output: Schema.Struct({ ...Execution.fields, approval: Approval }),
  errors: WRITE_ROW_ERRORS,
  reads: union(LOAD.reads, SETTLE_VOTE.reads, [table_org_vote_executions]),
  writes: union(SETTLE_VOTE.writes, [table_org_vote_executions]),
  drives: SETTLE_VOTE.drives,
  invokes: union([procedure_access_require_feature_from_action], LOAD.invokes),
  emits: SETTLE_VOTE.emits,
  calls: union(SETTLE_VOTE.calls, SPONSORED_BUILD.calls),
  chain: union(SETTLE_VOTE.chain, SPONSORED_BUILD.chain),
  spans: spanUnion(ACTION_SPANS, SETTLE_VOTE.spans, SPONSORED_BUILD.spans),
});

export const rpc_organizations_votes_get = defineRpc({
  id: "organizations.votes.get",
  title: "One vote, its status read from the company Governor",
  about:
    "Row `organizations.votes.get`, registered as `organizations/votes:get`. Signed in; any participant. Load by Organization " +
    "and vote id; an unknown vote is INVALID_INPUT. `settleVote` settles a `sent` vote (writing its outcome) and reads the " +
    "Governor for a proposed one; the view's status is the Governor's state once proposed, `lapsed` for an unsigned one " +
    "past its sponsorship. No gate is checked.",
  was: [`${CONVEX}:15`, `${OPS}/get.ts:20`, `${OPS}/get.ts:23`, `${OPS}/get.ts:25`, `${OPS}/get.ts:27`, `${ROWS}:88`, `${SCHEMA}:40`, `${SCHEMA}:82`, `${SRC}/rules.ts:76`, `${SRC}/views.ts:1`, ...LOAD_WAS, ...SETTLE_VOTE_WAS, ...VOTE_OUTCOME_WAS],
  concept: concept_organizations,
  kind: "action",
  who: PARTICIPANT,
  input: Schema.Struct({ orgId: Schema.String, voteId: Schema.String }),
  output: Vote,
  errors: READ_ROW_ERRORS,
  reads: LOAD.reads,
  writes: SETTLE_VOTE.writes,
  drives: SETTLE_VOTE.drives,
  invokes: LOAD.invokes,
  emits: SETTLE_VOTE.emits,
  calls: SETTLE_VOTE.calls,
  chain: SETTLE_VOTE.chain,
  spans: spanUnion(ACTION_SPANS, SETTLE_VOTE.spans),
});

export const rpc_organizations_votes_list = defineRpc({
  id: "organizations.votes.list",
  title: "The company's newest 50 votes, each read as get reads it",
  about:
    "Row `organizations.votes.list`, registered as `organizations/votes:list` (CAP-1204). Signed in; any participant. Load " +
    "for the participant check, then organizations.votes.list-rows (newest 50 by creation) and `settleVote` for each, four " +
    "at a time, so a list can write sent votes' outcomes. No gate is checked.",
  was: [`${CONVEX}:16`, `${OPS}/list.ts:18`, `${OPS}/list.ts:21`, `${OPS}/list.ts:22`, `${OPS}/list.ts:24`, `${ROWS}:95`, `${SRC}/reads.ts:61`, `${SRC}/reads.ts:85`, ...LOAD_WAS, ...SETTLE_VOTE_WAS],
  concept: concept_organizations,
  kind: "action",
  who: PARTICIPANT,
  input: Schema.Struct({ orgId: Schema.String }),
  output: Schema.Array(Vote),
  errors: READ_ROW_ERRORS,
  reads: LOAD.reads,
  writes: SETTLE_VOTE.writes,
  drives: SETTLE_VOTE.drives,
  invokes: LOAD.invokes,
  emits: SETTLE_VOTE.emits,
  calls: SETTLE_VOTE.calls,
  chain: SETTLE_VOTE.chain,
  spans: spanUnion(ACTION_SPANS, SETTLE_VOTE.spans),
});

export const rpc_organizations_votes_ballot = defineRpc({
  id: "organizations.votes.ballot",
  title: "One of the caller's ballots, settled from the chain",
  about:
    "Row `organizations.votes.ballot`, registered as `organizations/votes:ballot` (CAP-1219). Signed in; only its voter " +
    "reads it. organizations.votes.find-ballot reads the row (another person's or none: INVALID_INPUT), then load by its " +
    "vote (a company the caller left reads as no ballot). `settleBallot` settles a `sent` ballot: `cast` once its operation " +
    "landed, `failed` when reverted, or past its sponsorship `cast` only when the Governor counted the voter and no other " +
    "ballot of theirs was cast.",
  was: [`${CONVEX}:3`, `${OPS}/ballot.ts:20`, `${OPS}/ballot.ts:23`, `${OPS}/ballot.ts:26`, `${OPS}/ballot.ts:33`, `${MINE_ROWS}:35`, `${SCHEMA}:164`, `${SCHEMA}:177`, `${SRC}/reads/ballots.ts:59`, ...LOAD_WAS, ...SETTLE_BALLOT_WAS],
  concept: concept_organizations,
  kind: "action",
  who: "The signed-in voter of the ballot, still a current Seat of its company.",
  input: Schema.Struct({ ballotId: Schema.String }),
  output: Ballot,
  errors: READ_ROW_ERRORS,
  reads: union(LOAD.reads, SETTLE_BALLOT.reads),
  writes: SETTLE_BALLOT.writes,
  drives: SETTLE_BALLOT.drives,
  invokes: LOAD.invokes,
  emits: SETTLE_BALLOT.emits,
  calls: SETTLE_BALLOT.calls,
  chain: SETTLE_BALLOT.chain,
  spans: spanUnion(ACTION_SPANS, SETTLE_BALLOT.spans),
});

export const rpc_organizations_votes_execution = defineRpc({
  id: "organizations.votes.execution",
  title: "One of the caller's executions, settled from the chain",
  about:
    "Row `organizations.votes.execution`, registered as `organizations/votes:execution` (CAP-1203). Signed in; only its " +
    "executor reads it. organizations.votes.find-execution reads the row (another person's, another Organization's or none: " +
    "INVALID_INPUT), then load by its vote. `settleExecution` settles a `sent` one from its receipt or, past its " +
    "sponsorship, from the EntryPoint event that consumed its nonce, at the settling block's time.",
  was: [`${CONVEX}:8`, `${OPS}/execution.ts:21`, `${OPS}/execution.ts:26`, `${OPS}/execution.ts:29`, `${OPS}/execution.ts:36`, `${ROWS}:82`, `${SCHEMA}:219`, `${SCHEMA}:241`, `${SRC}/reads/executions.ts:59`, ...LOAD_WAS, ...SETTLE_EXECUTION_WAS],
  concept: concept_organizations,
  kind: "action",
  who: "The signed-in executor of the execution, still a current Seat of its company.",
  input: Schema.Struct({ orgId: Schema.String, executionId: Schema.String }),
  output: Execution,
  errors: READ_ROW_ERRORS,
  reads: union(LOAD.reads, SETTLE_EXECUTION.reads),
  writes: SETTLE_EXECUTION.writes,
  drives: SETTLE_EXECUTION.drives,
  invokes: LOAD.invokes,
  emits: SETTLE_EXECUTION.emits,
  calls: SETTLE_EXECUTION.calls,
  chain: SETTLE_EXECUTION.chain,
  spans: spanUnion(ACTION_SPANS, SETTLE_EXECUTION.spans),
});

export const rpc_organizations_votes_mine = defineRpc({
  id: "organizations.votes.mine",
  title: "The caller's open votes across their companies",
  about:
    "Row `organizations.votes.mine`, registered as `organizations/votes:mine` (CAP-1221), behind `client.me.votes.list`. " +
    "Signed in; no Organization is named, so no participant row error. organizations.votes.mine-rows reads, for each " +
    "current Seat with installed equity, that company's newest 20 votes that may be open, with the caller's personal Safe " +
    "there. A `sent` vote is settled first (four at a time). For each proposed vote the Governor's state and snapshot are " +
    "read; while `pending` the caller's weight is their Captable votes now, while `active` their Governor votes at the " +
    "snapshot and `hasVoted`; a caller with no Safe holds none. Only pending and active votes are answered, soonest " +
    "closing first.",
  was: [`${CONVEX}:19`, `${OPS}/mine.ts:36`, `${OPS}/mine.ts:80`, `${OPS}/mine.ts:83`, `${OPS}/mine.ts:86`, `${OPS}/mine.ts:95`, `${OPS}/mine.ts:123`, `${MINE_ROWS}:28`, `${SCHEMA}:125`, `${SRC}/reads.ts:149`, `${SRC}/reads.ts:196`, `${SRC}/rules.ts:138`, `${SRC}/rules.ts:142`, ...SETTLE_VOTE_WAS],
  concept: concept_organizations,
  kind: "action",
  who: "Any signed-in person.",
  input: Schema.Struct({}),
  output: Schema.Array(
    Schema.Struct({
      voteId: Schema.String,
      orgId: Schema.String,
      org: Schema.String,
      title: Schema.String,
      status: Schema.Literals(["pending", "active"]),
      opensAt: Schema.NullOr(Schema.Number),
      closesAt: Schema.NullOr(Schema.Number),
      weight: Schema.Number,
      voted: Schema.Boolean,
    }),
  ),
  errors: [error_NOT_AUTHENTICATED, error_INVALID_INPUT, error_UNKNOWN, error_ENV_MISSING, error_PROVIDER_ERROR],
  reads: union(PROPOSALS_PARTICIPANT_READS, [table_org_votes, table_org_equities, table_org_safe_proposals]),
  writes: SETTLE_VOTE.writes,
  drives: SETTLE_VOTE.drives,
  invokes: [procedure_accounts_read_workspace_setup_signer_in_tx],
  emits: SETTLE_VOTE.emits,
  calls: SETTLE_VOTE.calls,
  chain: union(SETTLE_VOTE.chain, [contract_captable.f.getVotes, contract_governor.f.getVotes, contract_governor.f.hasVoted]),
  spans: spanUnion(ACTION_SPANS, SETTLE_VOTE.spans),
});

// ── internal: sends ────────────────────────────────────────────────────────────────────────

/** Common to the three sends: the gate, the caller's Safe, the vote context. */
const SEND_ERRORS = [
  error_ROLE_PERMISSION_DENIED,
  error_INVALID_INPUT,
  error_WRONG_STATE,
  error_SMART_ACCOUNT_MISSING,
  error_FEATURE_NOT_AVAILABLE,
  error_PROVIDER_ERROR,
  error_ENV_MISSING,
  ...DEFECT,
];

export const rpc_organizations_votes_send_signed = defineRpc({
  id: "organizations.votes.send-signed",
  title: "Send a proposer's signed vote to the Governor",
  about:
    "Registered as the internal action `organizations/votes:sendSigned`. Accounts' accounts.approvals.sendApproved runs it " +
    "for an approved vote approval. It decodes the stored operation and loads the vote's context. A send asked again after " +
    "the proposal landed or its sponsorship ended answers with the noted hash and sends nothing. Otherwise the vote must be " +
    "the caller's, `awaiting_approval` (or `sent`, a resend) and unexpired (WRONG_STATE `staleVote`); the `equity` gate " +
    "must still be on; the caller's Safe must be the proposer. The operation must be exactly its `Governor.propose` from " +
    "that Safe and signed by the caller's signer (INVALID_INPUT otherwise). A first send notes the hash through " +
    "organizations.votes.record-outcome (`sent`, which schedules the follow) before eth_sendUserOperation." +
    " The send admits only PROVIDER_ERROR and ENV_MISSING: a bundler answer that does not parse, or a hash other than the one noted (PROVIDER_RESPONSE_INVALID), dies as a defect and reaches the caller as UNKNOWN.",
  was: [`${CONVEX}:27`, `${OPS}/send-signed.ts:49`, `${OPS}/send-signed.ts:63`, `${OPS}/send-signed.ts:64`, `${OPS}/send-signed.ts:67`, `${OPS}/send-signed.ts:79`, `${OPS}/send-signed.ts:94`, `${OPS}/send-signed.ts:106`, `${OPS}/send-signed.ts:112`, `${SRC}/rules.ts:127`, ...SEND_WAS, ...LOAD_WAS, ...VOTE_OUTCOME_WAS],
  concept: concept_organizations,
  kind: "action",
  who: "internal: run by Accounts' accounts.approvals.sendApproved once the proposer's approval is recorded.",
  input: Schema.Struct({ authUserId: Schema.String, voteId: Schema.String, unsignedUserOpJson: Schema.String, signature: Schema.String }),
  output: Schema.Struct({ userOpHash: Schema.String }),
  errors: SEND_ERRORS,
  reads: LOAD.reads,
  writes: [table_org_votes],
  drives: [machine_org_vote.t.to_sent],
  invokes: union([procedure_access_require_feature_from_action], LOAD.invokes),
  emits: [],
  calls: [integration_chain_rpc.c.sendUserOperation],
  chain: [contract_safe_4337_module.f.executeUserOpWithErrorString, contract_governor.f.propose],
  spans: spanUnion(ACTION_SPANS, ["chain.read eth_sendUserOperation"]),
});

export const rpc_organizations_votes_send_signed_ballot = defineRpc({
  id: "organizations.votes.send-signed-ballot",
  title: "Send a voter's signed ballot to the Governor",
  about:
    "Registered as the internal action `organizations/votes:sendSignedBallot`. Accounts' accounts.approvals.sendApproved " +
    "runs it for an approved ballot approval. organizations.votes.find-ballot reads the ballot; one already counted or past " +
    "its sponsorship answers with the noted hash. Otherwise it must be the caller's, waiting (or `sent`, a resend) and " +
    "unexpired (WRONG_STATE `staleBallot`); load by its vote, the `equity` gate, the caller's Safe must be the voter. The " +
    "operation must be exactly its `castVoteWithReason`. A first send notes the hash through organizations.votes." +
    "record-ballot-outcome (`sent`, which schedules the ballot's follow) before eth_sendUserOperation." +
    " The send admits only PROVIDER_ERROR and ENV_MISSING: a bundler answer that does not parse, or a hash other than the one noted (PROVIDER_RESPONSE_INVALID), dies as a defect and reaches the caller as UNKNOWN.",
  was: [`${CONVEX}:28`, `${OPS}/send-signed-ballot.ts:48`, `${OPS}/send-signed-ballot.ts:63`, `${OPS}/send-signed-ballot.ts:65`, `${OPS}/send-signed-ballot.ts:76`, `${OPS}/send-signed-ballot.ts:78`, `${OPS}/send-signed-ballot.ts:90`, `${OPS}/send-signed-ballot.ts:103`, `${OPS}/send-signed-ballot.ts:109`, `${SRC}/rules.ts:217`, ...SEND_WAS, ...LOAD_WAS, `${SRC}/writes/ballots.ts:54`],
  concept: concept_organizations,
  kind: "action",
  who: "internal: run by Accounts' accounts.approvals.sendApproved once the voter's approval is recorded.",
  input: Schema.Struct({ authUserId: Schema.String, ballotId: Schema.String, unsignedUserOpJson: Schema.String, signature: Schema.String }),
  output: Schema.Struct({ userOpHash: Schema.String }),
  errors: SEND_ERRORS,
  reads: union(LOAD.reads, [table_org_vote_ballots]),
  writes: [table_org_vote_ballots],
  drives: [machine_org_vote_ballot.t.to_sent],
  invokes: union([procedure_access_require_feature_from_action], LOAD.invokes),
  emits: [],
  calls: [integration_chain_rpc.c.sendUserOperation],
  chain: [contract_safe_4337_module.f.executeUserOpWithErrorString, contract_governor.f.castVoteWithReason],
  spans: spanUnion(ACTION_SPANS, ["chain.read eth_sendUserOperation"]),
});

export const rpc_organizations_votes_send_signed_execution = defineRpc({
  id: "organizations.votes.send-signed-execution",
  title: "Send an executor's signed execution to the Governor",
  about:
    "Registered as the internal action `organizations/votes:sendSignedExecution`. Accounts' accounts.approvals.sendApproved " +
    "runs it for an approved execution approval. organizations.votes.find-execution reads it; one that ran or is past its " +
    "sponsorship answers with the noted hash. Otherwise it must be the caller's, waiting (or `sent`) and unexpired " +
    "(WRONG_STATE `staleExecution`); load by its vote, the `equity` gate, the caller's Safe must be the executor and the " +
    "vote must exist. The operation must be exactly the vote's `Governor.execute`. A first send reads the latest block and " +
    "notes the hash, the operation's EntryPoint nonce and that block through organizations.votes.record-execution-outcome " +
    "before eth_sendUserOperation, so a lapsed send can be found by the event that consumed its nonce." +
    " The send admits only PROVIDER_ERROR and ENV_MISSING: a bundler answer that does not parse, or a hash other than the one noted (PROVIDER_RESPONSE_INVALID), dies as a defect and reaches the caller as UNKNOWN.",
  was: [`${CONVEX}:29`, `${OPS}/send-signed-execution.ts:49`, `${OPS}/send-signed-execution.ts:64`, `${OPS}/send-signed-execution.ts:66`, `${OPS}/send-signed-execution.ts:77`, `${OPS}/send-signed-execution.ts:79`, `${OPS}/send-signed-execution.ts:92`, `${OPS}/send-signed-execution.ts:106`, `${OPS}/send-signed-execution.ts:109`, `${OPS}/send-signed-execution.ts:121`, `${SRC}/rules/executions.ts:75`, ...SEND_WAS, ...LOAD_WAS, `${SRC}/writes/executions.ts:73`],
  concept: concept_organizations,
  kind: "action",
  who: "internal: run by Accounts' accounts.approvals.sendApproved once the executor's approval is recorded.",
  input: Schema.Struct({ authUserId: Schema.String, executionId: Schema.String, unsignedUserOpJson: Schema.String, signature: Schema.String }),
  output: Schema.Struct({ userOpHash: Schema.String }),
  errors: SEND_ERRORS,
  reads: union(LOAD.reads, [table_org_vote_executions]),
  writes: [table_org_vote_executions],
  drives: [machine_org_vote_execution.t.to_sent],
  invokes: union([procedure_access_require_feature_from_action], LOAD.invokes),
  emits: [],
  calls: [integration_chain_rpc.c.fetchLatestBlockNumber, integration_chain_rpc.c.sendUserOperation],
  chain: [contract_safe_4337_module.f.executeUserOpWithErrorString, contract_governor.f.execute, contract_captable.f.setAuthorised],
  spans: spanUnion(ACTION_SPANS, ["chain.read eth_blockNumber", "chain.read eth_sendUserOperation"]),
});

// ── internal: reads ────────────────────────────────────────────────────────────────────────

export const rpc_organizations_votes_load = defineRpc({
  id: "organizations.votes.load",
  title: "The vote actions' context: participant, Safe, equity, the vote",
  about:
    "Registered as the internal query `organizations/votes:load`; the vote actions run it through `readContext`. " +
    "`voteContextInTx`: neither an Organization nor a known vote is INVALID_INPUT; the participant check " +
    "(ROLE_PERMISSION_DENIED); a vanished Organization row is UNKNOWN; equity counts as installed when `installedAt` is " +
    "set or the setup proposal's status reads executed. Marks the Organization verified.",
  was: [`${CONVEX}:18`, `${OPS}/load.ts:11`, `${OPS}/load.ts:20`, ...LOAD_WAS],
  concept: concept_organizations,
  kind: "query",
  who: "internal: run by the vote actions for the signed-in caller.",
  input: Schema.Struct({ authUserId: Schema.String, orgId: Schema.optionalKey(Schema.String), voteId: Schema.optionalKey(Schema.String) }),
  output: Schema.Struct({
    orgId: Schema.String,
    name: Schema.String,
    chainId: Schema.Number,
    caller: Schema.NullOr(Schema.Struct({ personalSafe: Schema.String, signer: Schema.String })),
    equity: Schema.NullOr(Schema.Struct({ governor: Schema.String, captable: Schema.String, template: Schema.String })),
    vote: Schema.NullOr(VoteRow),
  }),
  errors: [error_ROLE_PERMISSION_DENIED, error_INVALID_INPUT, ...DEFECT],
  reads: LOAD.reads,
  writes: [],
  drives: [],
  invokes: LOAD.invokes,
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_organizations_votes_find = defineRpc({
  id: "organizations.votes.find",
  title: "A vote by its id, with no caller to check",
  about:
    "Registered as the internal query `organizations/votes:find`, run by the follow workflow (`readVote`): a sent vote " +
    "settles even after its proposer loses their Seat. Reads the row by `by_vote`; null when none.",
  was: [`${CONVEX}:9`, `${OPS}/find.ts:9`, `${SRC}/reads.ts:42`, `${SRC}/reads.ts:53`, `${SRC}/reads.ts:103`],
  concept: concept_organizations,
  kind: "query",
  who: "internal: run by the organizations.votes.follow workflow.",
  input: Schema.Struct({ voteId: Schema.String }),
  output: Schema.NullOr(VoteRow),
  errors: DEFECT,
  reads: [table_org_votes],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_organizations_votes_find_ballot = defineRpc({
  id: "organizations.votes.find-ballot",
  title: "A ballot by its id",
  about:
    "Registered as the internal query `organizations/votes:findBallot`, run by ballot, send-signed-ballot and the ballot " +
    "follow. Reads the row by `by_ballot`; the caller who asks checks it is theirs. No participant check.",
  was: [`${CONVEX}:10`, `${OPS}/find-ballot.ts:9`, `${SRC}/reads/ballots.ts:20`, `${SRC}/reads/ballots.ts:31`, `${SRC}/reads/ballots.ts:59`],
  concept: concept_organizations,
  kind: "query",
  who: "internal: run by organizations.votes.ballot, organizations.votes.send-signed-ballot and the ballot follow.",
  input: Schema.Struct({ ballotId: Schema.String }),
  output: Schema.NullOr(BallotRow),
  errors: DEFECT,
  reads: [table_org_vote_ballots],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_organizations_votes_find_execution = defineRpc({
  id: "organizations.votes.find-execution",
  title: "An execution by its id",
  about:
    "Registered as the internal query `organizations/votes:findExecution`, run by execution, send-signed-execution and the " +
    "execution follow. Reads the row by `by_execution`; the caller who asks checks it is theirs. No participant check.",
  was: [`${CONVEX}:11`, `${OPS}/find-execution.ts:9`, `${SRC}/reads/executions.ts:20`, `${SRC}/reads/executions.ts:31`, `${SRC}/reads/executions.ts:59`],
  concept: concept_organizations,
  kind: "query",
  who: "internal: run by organizations.votes.execution, organizations.votes.send-signed-execution and the execution follow.",
  input: Schema.Struct({ executionId: Schema.String }),
  output: Schema.NullOr(ExecutionRow),
  errors: DEFECT,
  reads: [table_org_vote_executions],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_organizations_votes_list_rows = defineRpc({
  id: "organizations.votes.list-rows",
  title: "The company's newest 50 vote rows",
  about:
    "Registered as the internal query `organizations/votes:listRows`, run by organizations.votes.list after its own " +
    "participant check. No check of its own: it answers any Organization's rows (`by_org`, newest first, 50).",
  was: [`${CONVEX}:17`, `${OPS}/list-rows.ts:9`, `${SRC}/reads.ts:61`, `${SRC}/reads.ts:64`],
  concept: concept_organizations,
  kind: "query",
  who: "internal: run by organizations.votes.list once the caller is a participant.",
  input: Schema.Struct({ orgId: Schema.String }),
  output: Schema.Array(VoteRow),
  errors: DEFECT,
  reads: [table_org_votes],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_organizations_votes_mine_rows = defineRpc({
  id: "organizations.votes.mine-rows",
  title: "The sent and proposed votes of each company the caller sits in",
  about:
    "Registered as the internal query `organizations/votes:mineRows`, run by organizations.votes.mine. For each of the " +
    "caller's active memberships that is a current Seat, with the Organization and installed equity: that company's " +
    "newest 20 votes still `sent` or `proposed`, its name and Captable, and the caller's personal Safe on its chain.",
  was: [`${CONVEX}:20`, `${OPS}/mine-rows.ts:11`, `${SRC}/reads.ts:149`, `${SRC}/reads.ts:153`, `${SRC}/reads.ts:161`, `${SRC}/reads.ts:163`, `${SRC}/reads.ts:170`, ...PROPOSALS_PARTICIPANT_WAS],
  concept: concept_organizations,
  kind: "query",
  who: "internal: run by organizations.votes.mine for the signed-in caller.",
  input: Schema.Struct({ authUserId: Schema.String }),
  output: Schema.Array(
    Schema.Struct({ vote: VoteRow, org: Schema.String, captable: Schema.String, personalSafe: Schema.NullOr(Schema.String) }),
  ),
  errors: DEFECT,
  reads: union(PROPOSALS_PARTICIPANT_READS, [table_org_votes, table_org_equities, table_org_safe_proposals]),
  writes: [],
  drives: [],
  invokes: [procedure_accounts_read_workspace_setup_signer_in_tx],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_organizations_votes_voter_ballots = defineRpc({
  id: "organizations.votes.voter-ballots",
  title: "A voter's ballots on a vote",
  about:
    "Registered as the internal query `organizations/votes:voterBallots`, run by cast and by `settleBallot`, so a second " +
    "ballot is refused with how the voter voted. Reads `by_vote_voter`.",
  was: [`${CONVEX}:31`, `${OPS}/voter-ballots.ts:9`, `${SRC}/reads/ballots.ts:39`, `${SRC}/reads/ballots.ts:73`],
  concept: concept_organizations,
  kind: "query",
  who: "internal: run by organizations.votes.cast and ballot settlement.",
  input: Schema.Struct({ voteId: Schema.String, voter: Schema.String }),
  output: Schema.Array(BallotRow),
  errors: DEFECT,
  reads: [table_org_vote_ballots],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_organizations_votes_vote_executions = defineRpc({
  id: "organizations.votes.vote-executions",
  title: "A vote's executions",
  about:
    "Registered as the internal query `organizations/votes:voteExecutions`, run by execute so a second execution waits " +
    "for the first. Reads `by_vote`.",
  was: [`${CONVEX}:30`, `${OPS}/vote-executions.ts:9`, `${SRC}/reads/executions.ts:39`, `${SRC}/reads/executions.ts:73`],
  concept: concept_organizations,
  kind: "query",
  who: "internal: run by organizations.votes.execute.",
  input: Schema.Struct({ voteId: Schema.String }),
  output: Schema.Array(ExecutionRow),
  errors: DEFECT,
  reads: [table_org_vote_executions],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

// ── internal: writes ───────────────────────────────────────────────────────────────────────

export const rpc_organizations_votes_record = defineRpc({
  id: "organizations.votes.record",
  title: "Store a vote with the approval its proposer signs",
  about:
    "Registered as the internal mutation `organizations/votes:record`, run by `openVote` after the approval opened. Inserts " +
    "the vote born `awaiting_approval` (its id is new, so it is never stored twice; a birth has no transition).",
  was: [`${CONVEX}:21`, `${OPS}/record.ts:10`, `${OPS}/record.ts:28`, `${SRC}/writes.ts:25`, `${SRC}/writes.ts:209`],
  concept: concept_organizations,
  kind: "mutation",
  who: "internal: run by organizations.votes.create.",
  input: Schema.Struct({
    voteId: Schema.String,
    orgId: Schema.String,
    chainId: Schema.Number,
    governor: Schema.String,
    proposalId: Schema.String,
    authUserId: Schema.String,
    matter: Schema.String,
    title: Schema.String,
    description: Schema.String,
    proposer: Schema.String,
    calls: Schema.Array(Call),
    quorumBps: Schema.Number,
    approvalId: Schema.String,
    expiresAt: Schema.Number,
    createdAt: Schema.Number,
  }),
  output: Schema.Void,
  errors: DEFECT,
  reads: [],
  writes: [table_org_votes],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_organizations_votes_record_ballot = defineRpc({
  id: "organizations.votes.record-ballot",
  title: "Store a ballot with the approval its voter signs",
  about:
    "Registered as the internal mutation `organizations/votes:recordBallot`, run by `openBallot`. Inserts the ballot born " +
    "`awaiting_approval`.",
  was: [`${CONVEX}:22`, `${OPS}/record-ballot.ts:11`, `${OPS}/record-ballot.ts:31`, `${SRC}/writes/ballots.ts:25`, `${SRC}/writes/ballots.ts:107`],
  concept: concept_organizations,
  kind: "mutation",
  who: "internal: run by organizations.votes.cast.",
  input: Schema.Struct({
    ballotId: Schema.String,
    voteId: Schema.String,
    orgId: Schema.String,
    chainId: Schema.Number,
    governor: Schema.String,
    proposalId: Schema.String,
    authUserId: Schema.String,
    voter: Schema.String,
    support: Support,
    reason: Schema.String,
    weight: Schema.String,
    approvalId: Schema.String,
    expiresAt: Schema.Number,
    createdAt: Schema.Number,
  }),
  output: Schema.Void,
  errors: DEFECT,
  reads: [],
  writes: [table_org_vote_ballots],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_organizations_votes_record_execution = defineRpc({
  id: "organizations.votes.record-execution",
  title: "Store an execution, unless another of the vote is under way",
  about:
    "Registered as the internal mutation `organizations/votes:recordExecution`, run by `openExecution`. In the writing " +
    "transaction a waiting or sent, unexpired execution of the same vote refuses it (WRONG_STATE `executionOnItsWay`), so " +
    "two asks at once store one; the loser's approval sends nothing. Born `awaiting_approval`.",
  was: [`${CONVEX}:24`, `${OPS}/record-execution.ts:10`, `${OPS}/record-execution.ts:28`, `${SRC}/writes/executions.ts:29`, `${SRC}/writes/executions.ts:42`, `${SRC}/rules/executions.ts:38`],
  concept: concept_organizations,
  kind: "mutation",
  who: "internal: run by organizations.votes.execute.",
  input: Schema.Struct({
    executionId: Schema.String,
    voteId: Schema.String,
    orgId: Schema.String,
    chainId: Schema.Number,
    governor: Schema.String,
    proposalId: Schema.String,
    authUserId: Schema.String,
    executor: Schema.String,
    tally: Schema.Struct({ for: Schema.String, against: Schema.String, abstain: Schema.String }),
    approvalId: Schema.String,
    expiresAt: Schema.Number,
    createdAt: Schema.Number,
  }),
  output: Schema.Void,
  errors: [error_WRONG_STATE, ...DEFECT],
  reads: [table_org_vote_executions],
  writes: [table_org_vote_executions],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_organizations_votes_record_outcome = defineRpc({
  id: "organizations.votes.record-outcome",
  title: "Note a vote's send, then what the chain answered",
  about:
    "Registered as the internal mutation `organizations/votes:recordOutcome`, run by send-signed and by `settleVote`. An " +
    "unknown vote is INVALID_INPUT; a proposed or failed one is left as it is. `sent` is noted once and schedules " +
    "organizations.votes.follow after 15 s of business time. `proposed` stores when voting opens and closes and schedules " +
    "organizations.votes.emit-transitioned (`opened`); `failed` reports nothing.",
  was: [`${CONVEX}:26`, `${OPS}/record-outcome.ts:9`, `${OPS}/record-outcome.ts:26`, ...VOTE_OUTCOME_WAS],
  concept: concept_organizations,
  kind: "mutation",
  who: "internal: run by organizations.votes.send-signed and vote settlement.",
  input: Schema.Struct({
    voteId: Schema.String,
    outcome: Schema.Union([
      Schema.Struct({ kind: Schema.Literal("sent"), userOpHash: Schema.String }),
      Schema.Struct({ kind: Schema.Literal("failed"), at: Schema.Number }),
      Schema.Struct({ kind: Schema.Literal("proposed"), at: Schema.Number, opensAt: Schema.Number, closesAt: Schema.Number }),
    ]),
  }),
  output: Schema.Void,
  errors: [error_INVALID_INPUT, ...DEFECT],
  reads: [table_org_votes],
  writes: [table_org_votes],
  drives: [machine_org_vote.t.to_sent, machine_org_vote.t.to_proposed, machine_org_vote.t.to_failed],
  invokes: [],
  emits: [event_vote_transitioned],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_organizations_votes_record_ballot_outcome = defineRpc({
  id: "organizations.votes.record-ballot-outcome",
  title: "Note a ballot's send, then what the chain answered",
  about:
    "Registered as the internal mutation `organizations/votes:recordBallotOutcome`, run by send-signed-ballot and by " +
    "`settleBallot`. `sent` is noted once and schedules organizations.votes.follow-ballot after 15 s; `cast` schedules " +
    "organizations.votes.emit-transitioned (`cast`, with the support); `failed` reports nothing. An unknown ballot is " +
    "INVALID_INPUT.",
  was: [`${CONVEX}:23`, `${OPS}/record-ballot-outcome.ts:9`, `${OPS}/record-ballot-outcome.ts:21`, `${SRC}/writes/ballots.ts:54`, `${SRC}/writes/ballots.ts:63`, `${SRC}/writes/ballots.ts:67`, `${SRC}/writes/ballots.ts:76`, `${SRC}/writes/ballots.ts:81`],
  concept: concept_organizations,
  kind: "mutation",
  who: "internal: run by organizations.votes.send-signed-ballot and ballot settlement.",
  input: Schema.Struct({
    ballotId: Schema.String,
    outcome: Schema.Union([
      Schema.Struct({ kind: Schema.Literal("sent"), userOpHash: Schema.String }),
      Schema.Struct({ kind: Schema.Literals(["failed", "cast"]), at: Schema.Number }),
    ]),
  }),
  output: Schema.Void,
  errors: [error_INVALID_INPUT, ...DEFECT],
  reads: [table_org_vote_ballots],
  writes: [table_org_vote_ballots],
  drives: [machine_org_vote_ballot.t.to_sent, machine_org_vote_ballot.t.to_cast, machine_org_vote_ballot.t.to_failed],
  invokes: [],
  emits: [event_vote_transitioned],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_organizations_votes_record_execution_outcome = defineRpc({
  id: "organizations.votes.record-execution-outcome",
  title: "Note an execution's send, then what the chain answered",
  about:
    "Registered as the internal mutation `organizations/votes:recordExecutionOutcome`, run by send-signed-execution " +
    "(`sent` with the EntryPoint nonce and send block) and by `settleExecution`. `sent` is noted once and schedules " +
    "organizations.votes.follow-execution after 15 s; `executed` schedules organizations.votes.emit-transitioned " +
    "(`executed`); `failed` reports nothing. An unknown execution is INVALID_INPUT.",
  was: [`${CONVEX}:25`, `${OPS}/record-execution-outcome.ts:9`, `${OPS}/record-execution-outcome.ts:26`, `${SRC}/writes/executions.ts:73`, `${SRC}/writes/executions.ts:82`, `${SRC}/writes/executions.ts:91`, `${SRC}/writes/executions.ts:100`, `${SRC}/writes/executions.ts:105`],
  concept: concept_organizations,
  kind: "mutation",
  who: "internal: run by organizations.votes.send-signed-execution and execution settlement.",
  input: Schema.Struct({
    executionId: Schema.String,
    outcome: Schema.Union([
      Schema.Struct({ kind: Schema.Literal("sent"), userOpHash: Schema.String, nonce: Schema.String, sentBlock: Schema.Number }),
      Schema.Struct({ kind: Schema.Literals(["failed", "executed"]), at: Schema.Number }),
    ]),
  }),
  output: Schema.Void,
  errors: [error_INVALID_INPUT, ...DEFECT],
  reads: [table_org_vote_executions],
  writes: [table_org_vote_executions],
  drives: [machine_org_vote_execution.t.to_sent, machine_org_vote_execution.t.to_executed, machine_org_vote_execution.t.to_failed],
  invokes: [],
  emits: [event_vote_transitioned],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_organizations_votes_emit_transitioned = defineRpc({
  id: "organizations.votes.emit-transitioned",
  title: "Deliver one vote_transitioned event",
  about:
    "Telemetry plumbing: registered as the internal action `organizations/votes:emitTransitioned`. The vote, ballot and " +
    "execution outcome mutations schedule it (`scheduleTelemetryEmit`) for `opened`, `cast` (with the support) and " +
    "`executed`. It posts `vote_transitioned` as the row's author in its Organization. It reads and writes no table.",
  was: [`${CONVEX}:6`, `${OPS}/emit-transitioned.ts:10`, `${SRC}/events.ts:37`, `${SRC}/events.ts:45`],
  concept: concept_organizations,
  kind: "action",
  who: "internal: scheduled by the vote, ballot and execution outcome mutations.",
  input: Schema.Struct({
    transition: Schema.Literals(["opened", "cast", "executed"]),
    support: Schema.optionalKey(Support),
    organizationId: Schema.String,
    authUserId: Schema.String,
    voteId: Schema.String,
    occurredAt: Schema.Number,
  }),
  output: Schema.Void,
  errors: [],
  reads: [],
  writes: [],
  drives: [],
  invokes: [],
  emits: [event_vote_transitioned],
  calls: [],
  chain: [],
  spans: [],
});

// ── workflows ──────────────────────────────────────────────────────────────────────────────

const FOLLOW_TIMEOUT = 600_000;

export const workflow_organizations_votes_follow = defineWorkflow({
  id: "organizations.votes.follow",
  title: "Follow a sent vote until the Governor holds it or it fails",
  about:
    "Registered as the internal action `organizations/votes:follow`, recorded as the system job `vote_follow`. " +
    "organizations.votes.record-outcome schedules it 15 s of business time after it notes `sent`. Each run reads the vote " +
    "with organizations.votes.find (no participant check: a proposer who lost their Seat still has the vote settled) and, " +
    "while `sent`, `settleVote`; a PROVIDER_ERROR leaves it `sent`, another failure ends the run. Still `sent`: schedules " +
    "itself in 15 s with attempt + 1, with no cap. Timeout is Convex's action limit; the code sets none.",
  was: [`${CONVEX}:12`, `${OPS}/follow.ts:36`, `${OPS}/follow.ts:42`, `${OPS}/follow.ts:45`, `${OPS}/follow.ts:52`, `${SRC}/writes.ts:43`, `${SRC}/writes.ts:78`, ...SETTLE_VOTE_WAS],
  concept: concept_organizations,
  priority: "normal",
  trigger: { after: rpc_organizations_votes_record_outcome },
  instance: { per: table_org_votes },
  waits: [{ name: "receipt", for: "chain", about: "Re-reads the receipt every 15 s of business time until the vote settles." }],
  steps: [
    { name: "attribute", about: "Records the run as the system job `vote_follow`." },
    { name: "find", about: "Runs organizations.votes.find; a vote not `sent` ends the run." },
    { name: "settle", about: "`settleVote`, writing `proposed` or `failed` through organizations.votes.record-outcome." },
    { name: "again", about: "Still `sent` (or a provider error): schedules itself in 15 s with attempt + 1." },
  ],
  reads: SETTLE_VOTE.reads,
  writes: SETTLE_VOTE.writes,
  drives: SETTLE_VOTE.drives,
  invokes: [],
  emits: SETTLE_VOTE.emits,
  calls: SETTLE_VOTE.calls,
  chain: SETTLE_VOTE.chain,
  idempotency: "A vote no longer `sent` ends the run; record-outcome leaves a proposed or failed vote as it is.",
  timeoutMs: FOLLOW_TIMEOUT,
  retries: { max: 0, backoff: "fixed" },
});

export const workflow_organizations_votes_follow_ballot = defineWorkflow({
  id: "organizations.votes.follow-ballot",
  title: "Follow a sent ballot until the Governor counts it or it fails",
  about:
    "Registered as the internal action `organizations/votes:followBallot`, recorded as the system job `ballot_follow`. " +
    "organizations.votes.record-ballot-outcome schedules it 15 s after it notes `sent`. Each run reads the ballot with " +
    "organizations.votes.find-ballot and, while `sent`, `settleBallot`; a PROVIDER_ERROR leaves it `sent`. Still `sent`: " +
    "schedules itself in 15 s with attempt + 1, with no cap. Timeout is Convex's action limit; the code sets none.",
  was: [`${CONVEX}:13`, `${OPS}/follow-ballot.ts:36`, `${OPS}/follow-ballot.ts:44`, `${OPS}/follow-ballot.ts:46`, `${OPS}/follow-ballot.ts:53`, ...SETTLE_BALLOT_WAS],
  concept: concept_organizations,
  priority: "normal",
  trigger: { after: rpc_organizations_votes_record_ballot_outcome },
  instance: { per: table_org_vote_ballots },
  waits: [{ name: "receipt", for: "chain", about: "Re-reads the receipt every 15 s of business time until the ballot settles." }],
  steps: [
    { name: "attribute", about: "Records the run as the system job `ballot_follow`." },
    { name: "find", about: "Runs organizations.votes.find-ballot; a ballot not `sent` ends the run." },
    { name: "settle", about: "`settleBallot`, writing `cast` or `failed` through organizations.votes.record-ballot-outcome." },
    { name: "again", about: "Still `sent` (or a provider error): schedules itself in 15 s with attempt + 1." },
  ],
  reads: SETTLE_BALLOT.reads,
  writes: SETTLE_BALLOT.writes,
  drives: SETTLE_BALLOT.drives,
  invokes: [],
  emits: SETTLE_BALLOT.emits,
  calls: SETTLE_BALLOT.calls,
  chain: SETTLE_BALLOT.chain,
  idempotency: "A ballot no longer `sent` ends the run; the outcome mutation leaves a settled ballot as it is.",
  timeoutMs: FOLLOW_TIMEOUT,
  retries: { max: 0, backoff: "fixed" },
});

export const workflow_organizations_votes_follow_execution = defineWorkflow({
  id: "organizations.votes.follow-execution",
  title: "Follow a sent execution until the Governor ran it or it fails",
  about:
    "Registered as the internal action `organizations/votes:followExecution`, recorded as the system job " +
    "`execution_follow`. organizations.votes.record-execution-outcome schedules it 15 s after it notes `sent`. Each run " +
    "reads the execution with organizations.votes.find-execution and, while `sent`, `settleExecution`; a PROVIDER_ERROR " +
    "leaves it `sent`. Still `sent`: schedules itself in 15 s with attempt + 1, with no cap. Timeout is Convex's action " +
    "limit; the code sets none.",
  was: [`${CONVEX}:14`, `${OPS}/follow-execution.ts:36`, `${OPS}/follow-execution.ts:44`, `${OPS}/follow-execution.ts:46`, `${OPS}/follow-execution.ts:53`, ...SETTLE_EXECUTION_WAS],
  concept: concept_organizations,
  priority: "normal",
  trigger: { after: rpc_organizations_votes_record_execution_outcome },
  instance: { per: table_org_vote_executions },
  waits: [{ name: "receipt", for: "chain", about: "Re-reads the receipt (or the EntryPoint event past the sponsorship) every 15 s of business time." }],
  steps: [
    { name: "attribute", about: "Records the run as the system job `execution_follow`." },
    { name: "find", about: "Runs organizations.votes.find-execution; an execution not `sent` ends the run." },
    { name: "settle", about: "`settleExecution`, writing `executed` or `failed` through organizations.votes.record-execution-outcome." },
    { name: "again", about: "Still `sent` (or a provider error): schedules itself in 15 s with attempt + 1." },
  ],
  reads: SETTLE_EXECUTION.reads,
  writes: SETTLE_EXECUTION.writes,
  drives: SETTLE_EXECUTION.drives,
  invokes: [],
  emits: SETTLE_EXECUTION.emits,
  calls: SETTLE_EXECUTION.calls,
  chain: SETTLE_EXECUTION.chain,
  idempotency: "An execution no longer `sent` ends the run; the outcome mutation leaves a settled execution as it is.",
  timeoutMs: FOLLOW_TIMEOUT,
  retries: { max: 0, backoff: "fixed" },
});
