// The votes area: shareholder votes on reserved matters, run by the company Governor (`org vote
// create|execute|list|show|wait`, `vote cast`, `vote list`). A shareholder proposes from their own Safe;
// each shareholder casts their own ballot; anyone may execute a passed vote. A vote's process
// (processes.ts) decides its propose, ballot and execute writes. Where a vote stands, its tally and its
// quorum are the Governor's, read live.

import { budget, defineRpc } from "../../../packages/book/src/index.ts";
import { concept_equity } from "../shared/foundation.ts";
import { contract_captable, contract_exits, contract_governor, contract_rounds } from "../shared/external.ts";
import {
  error_BELOW_THRESHOLD,
  error_INVALID_INPUT,
  error_NOT_AUTHENTICATED,
  error_NOT_IMPLEMENTED,
  error_RESERVED_MATTER,
  error_ROLE_PERMISSION_DENIED,
} from "../shared/vocabulary.ts";
import { table_chain_logs, table_equity_instruments, table_equity_positions } from "../indexing/data.ts";
import { table_principals } from "../access/data.ts";
import { table_org_members, table_organizations } from "../organizations/data.ts";
import { procedure_approvals_open } from "../approvals/procedures.ts";
import { machine_equity_write, machine_vote, table_equity_writes, table_votes } from "./data.ts";
import { APPROVE_ABOUT, CHAIN_READ_ERRORS, HOLDER, HOLDER_ERRORS, MEMBER, OLD, READS_CHAIN } from "./guards.ts";
import { procedure_documents_store } from "./links.ts";
import { CastInput, MyVotesReturns, Prepared, VoteCreateInput, VoteRef, VoteReturns, VotesReturns } from "./shapes.ts";
import { Schema } from "effect";

const OPS = `${OLD}/votes/operations`;

/** A vote of the caller's companies, in words. */
const YOUR_VOTE =
  "The vote must be one of the caller's companies (one they hold shares in or hold a Seat in), by its `vt_` id " +
  "(INVALID_INPUT: no vote of your companies has this ID), with the company's `equity` gate on (FEATURE_NOT_AVAILABLE).";

const VOTE_WRITE = {
  reads: [...HOLDER, table_votes, table_equity_positions, table_equity_writes],
  writes: [table_equity_writes],
  drives: [machine_equity_write.t.open],
  invokes: [procedure_approvals_open],
  emits: [],
  calls: [...READS_CHAIN],
  spans: [],
} as const;

/** How a vote reads, in words. */
const VOTE_READ =
  "A vote still `proposing` reads `awaiting_approval`, or `lapsed` once its proposer's approval ended unsigned; " +
  "`failed` when its proposal reverted. A proposed vote reads as the Governor holds it (`state`: pending, active, " +
  "defeated, succeeded, executed, canceled, expired) with its tally for, against and abstaining (`proposalVotes`) and, " +
  "once voting has opened, the quorum at its snapshot (`quorum`): quorum is reached when the votes for and abstaining " +
  "reach it, and unknown before voting opens.";

export const rpc_equity_votes_propose = defineRpc({
  id: "equity.votes.propose",
  title: "Prepare a shareholder's proposal of a vote on a reserved matter",
  about:
    "Signed in with a claimed personal Safe (SMART_ACCOUNT_MISSING), in a company whose `equity` gate is on " +
    "(FEATURE_NOT_AVAILABLE) and installed (WRONG_STATE). The calls are built from the matter and its flags: " +
    "`create-class` (`Captable.createClass`), `authorise` (`Captable.setAuthorised` on the class its name finds; a class " +
    "the company does not have is INVALID_INPUT naming the ones it has), `transfer-rule` (`setTransferRule`), " +
    "`freeze-class` (`freeze`), `approve-round` (`Rounds.consent`, on the class's Governor) and `approve-sale` " +
    "(`Exits.approveSale`). The Board-seat matters (`board-settings`, `elect`, `remove`) are NOT_IMPLEMENTED until the " +
    "Elections clone is recorded (equity.vote-matters). Every target must be on the Governor's allowed list " +
    "(`isAllowedTarget`, RESERVED_MATTER: the matter is the Board's). The caller's votes now (`getVotes`) must reach " +
    "the proposal threshold (`proposalThreshold`), else BELOW_THRESHOLD before anything is signed. The terms document, " +
    "when given, is stored through `documents.store`. The description names the vote, and the proposal id is " +
    "OpenZeppelin's hashProposal of the calls and the description's hash. In one transaction the vote is born " +
    "`proposing` (vote.propose), which starts its process, with its write. " +
    APPROVE_ABOUT +
    " The one call is `Governor.propose(targets, values, calldatas, description)`.",
  was: [`${OPS}/create.ts`, `${OLD}/votes/rules.ts:1`, `${OLD}/votes/writes.ts`],
  concept: concept_equity,
  kind: "action",
  who: "A shareholder above the proposal threshold, from their own Safe.",
  input: VoteCreateInput,
  output: Prepared,
  errors: [...HOLDER_ERRORS, error_BELOW_THRESHOLD, error_RESERVED_MATTER, error_NOT_IMPLEMENTED],
  reads: [...HOLDER, table_equity_instruments, table_votes, table_equity_writes],
  writes: [table_votes, table_equity_writes],
  drives: [machine_vote.t.propose, machine_equity_write.t.open],
  invokes: [procedure_documents_store, procedure_approvals_open],
  emits: [],
  calls: [...READS_CHAIN],
  chain: [
    contract_governor.f.getVotes,
    contract_governor.f.proposalThreshold,
    contract_governor.f.isAllowedTarget,
    contract_captable.f.getClass,
    contract_captable.f.createClass,
    contract_captable.f.setAuthorised,
    contract_captable.f.setTransferRule,
    contract_captable.f.freeze,
    contract_rounds.f.consent,
    contract_exits.f.approveSale,
    contract_governor.f.propose,
  ],
  spans: [],
  budget: budget("chain-read"),
});

export const rpc_equity_votes_cast = defineRpc({
  id: "equity.votes.cast",
  title: "Prepare a shareholder's ballot",
  about:
    "Signed in with a claimed personal Safe (SMART_ACCOUNT_MISSING). " +
    YOUR_VOTE +
    " The vote must be open (`Governor.state` active; one not yet open is WRONG_STATE saying when it opens); a Safe that " +
    "already voted (`hasVoted`) is WRONG_STATE naming how (indexing's VoteCast), one that held no votes at the snapshot " +
    "(`getVotes` at voteStart) is WRONG_STATE, and so is one with a ballot of its own on its way: all before anything is " +
    "signed. " +
    APPROVE_ABOUT +
    " The one call is `Governor.castVoteWithReason(proposalId, support, reason)`, with OpenZeppelin's support (0 against, " +
    "1 for, 2 abstain). It answers the ballot (its write) and its weight at the snapshot.",
  was: [`${OPS}/cast.ts`, `${OLD}/votes/writes/ballots.ts`, `${OLD}/votes/external/ballots.ts`],
  concept: concept_equity,
  kind: "action",
  who: "A shareholder of the vote's company, from their own Safe.",
  input: CastInput,
  output: Prepared,
  errors: [...HOLDER_ERRORS],
  ...VOTE_WRITE,
  reads: [...VOTE_WRITE.reads, table_chain_logs],
  chain: [contract_governor.f.state, contract_governor.f.hasVoted, contract_governor.f.getVotes, contract_governor.f.castVoteWithReason],
  budget: budget("chain-read"),
});

export const rpc_equity_votes_execute = defineRpc({
  id: "equity.votes.execute",
  title: "Prepare the execution of a passed vote",
  about:
    "Signed in with a claimed personal Safe (SMART_ACCOUNT_MISSING): anyone may execute. " +
    YOUR_VOTE +
    " The Governor must hold it as succeeded: an open vote is WRONG_STATE naming when it closes, an executed one when it " +
    "ran, any other by its state. A vote whose execution is already on its way (any executor's) is WRONG_STATE, also " +
    "inside the writing transaction (one awaiting execution per vote). " +
    APPROVE_ABOUT +
    " The one call is `Governor.execute(targets, values, calldatas, descriptionHash)` with the vote's own calls and the " +
    "hash of its description. It answers the execution (its write) and the tally it passed with.",
  was: [`${OPS}/execute.ts`, `${OLD}/votes/writes/executions.ts`, `${OLD}/votes/rules/executions.ts`],
  concept: concept_equity,
  kind: "action",
  who: "Anyone with a claimed personal Safe, for a vote of a company they hold in or sit in.",
  input: VoteRef,
  output: Prepared,
  errors: [...HOLDER_ERRORS],
  ...VOTE_WRITE,
  chain: [contract_governor.f.state, contract_governor.f.proposalVotes, contract_governor.f.execute],
  budget: budget("chain-read"),
});

export const rpc_equity_votes_list = defineRpc({
  id: "equity.votes.list",
  title: "A company's votes, newest first",
  about:
    "A member of the company (ROLE_PERMISSION_DENIED: you hold no Seat in the company) reads its own votes, newest " +
    "first and only its newest 50, each as `org vote show` gives one. " +
    VOTE_READ,
  was: [`${OPS}/list.ts`, `${OPS}/list-rows.ts`],
  concept: concept_equity,
  kind: "action",
  who: "A member of the company.",
  input: Schema.Struct({ orgId: Schema.String }),
  output: VotesReturns,
  errors: [error_NOT_AUTHENTICATED, error_ROLE_PERMISSION_DENIED, ...CHAIN_READ_ERRORS],
  reads: [...MEMBER, table_votes],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [...READS_CHAIN],
  chain: [contract_governor.f.state, contract_governor.f.proposalVotes, contract_governor.f.quorum],
  spans: [],
  budget: budget("chain-read"),
});

export const rpc_equity_votes_get = defineRpc({
  id: "equity.votes.get",
  title: "One vote, live: its matter, standing, tally and quorum",
  about:
    "Signed in, a vote of the caller's companies by its `vt_` id (INVALID_INPUT: no such vote, a cut-short id or another " +
    "company's). " +
    VOTE_READ +
    " A live query: it pushes again on each indexed VoteCast or ProposalExecuted for the vote and when voting opens or " +
    "closes by the Governor's clock, so `org vote wait` subscribes to it.",
  was: [`${OPS}/get.ts`, `${OPS}/follow.ts`],
  concept: concept_equity,
  kind: "live",
  who: "A member or shareholder of the vote's company.",
  input: VoteRef,
  output: VoteReturns,
  errors: [error_NOT_AUTHENTICATED, error_INVALID_INPUT, ...CHAIN_READ_ERRORS],
  reads: [table_principals, table_organizations, table_org_members, table_equity_positions, table_votes, table_chain_logs],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [...READS_CHAIN],
  chain: [contract_governor.f.state, contract_governor.f.proposalVotes, contract_governor.f.quorum],
  spans: [],
  budget: budget("chain-read"),
});

export const rpc_equity_votes_mine = defineRpc({
  id: "equity.votes.mine",
  title: "Your open votes, across your companies, soonest closing first",
  about:
    "Signed in (NOT_AUTHENTICATED), each open vote (pending or active) of every company the caller holds shares in or " +
    "sits in, soonest closing first and one whose close is not yet known last: the company, the matter, when it opens " +
    "and closes, the caller's votes (`getVotes` at the snapshot once voting opened, what they hold now before then) and " +
    "whether they have voted (`hasVoted`).",
  was: [`${OPS}/mine.ts`, `${OPS}/mine-rows.ts`],
  concept: concept_equity,
  kind: "action",
  who: "A shareholder, about themselves.",
  input: Schema.Struct({}),
  output: MyVotesReturns,
  errors: [error_NOT_AUTHENTICATED, ...CHAIN_READ_ERRORS],
  reads: [table_principals, table_organizations, table_org_members, table_equity_positions, table_votes],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [...READS_CHAIN],
  chain: [contract_governor.f.state, contract_governor.f.getVotes, contract_governor.f.hasVoted],
  spans: [],
  budget: budget("chain-read"),
});
