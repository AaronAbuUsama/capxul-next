// The SAFE rounds area: post-money SAFE rounds (`org safe create|invite|close|show`). The Board opens
// and invites by proposal; a round that has raised its full amount is closed by a Director's own call,
// any other by proposal. The round's process (processes.ts) decides each write.

import { budget, defineRpc } from "../../../packages/book/src/index.ts";
import { concept_equity } from "../shared/foundation.ts";
import { contract_captable, contract_rounds } from "../shared/external.ts";
import { error_ROUND_CLOSED } from "../shared/vocabulary.ts";
import { table_equity_positions } from "../indexing/data.ts";
import { procedure_approvals_open } from "../approvals/procedures.ts";
import {
  machine_equity_write,
  machine_fundraise_investment,
  machine_fundraise_round,
  table_equity_writes,
  table_fundraise_investments,
  table_fundraise_rounds,
} from "./data.ts";
import { BOARD_ABOUT, BOARD_ERRORS, DIRECTOR, GUARD_WAS, MEMBER, MEMBER_READ_ERRORS, OLD, PROPOSE_ABOUT, READS_CHAIN, RESOLVE } from "./guards.ts";
import { procedure_board_propose } from "../board/procedures.ts";
import { procedure_documents_store } from "../documents/procedures.ts";
import { InviteInput, Prepared, RoundRef, SafeCreateInput, SafeShowReturns } from "./shapes.ts";

const DESIGNED = "books/frozen/operations.ts (org.safe.create, designed)";

const SAFE_MATTER_READS = [...DIRECTOR, table_fundraise_rounds, table_fundraise_investments, table_equity_writes] as const;

export const rpc_equity_safes_create = defineRpc({
  id: "equity.safes.create",
  title: "Propose a post-money SAFE round to the Board",
  about:
    BOARD_ABOUT +
    " The terms: post-money, a valuation cap, an optional discount, what it means to raise, an optional minimum ticket " +
    "and the last day to sign, which must not have passed (INVALID_INPUT, as `InvalidRound(\"close date passed\")` would " +
    "revert; nothing is proposed). The SAFE form is stored through `documents.store`. In one transaction the round is " +
    "born `proposed` (fundraise-round.propose), which starts its process, with its write. " +
    PROPOSE_ABOUT +
    " The one call is `Rounds.createSafeRound(token, valuationCap, discountBps, closesAt, termsHash)` in USDC.",
  was: [`${OLD}/equity/operations/create-safe-round.ts`, `${OLD}/equity/writes/safe-rounds.ts`, DESIGNED, ...GUARD_WAS],
  concept: concept_equity,
  kind: "action",
  who: "A Director of the company.",
  input: SafeCreateInput,
  output: Prepared,
  errors: [...BOARD_ERRORS],
  reads: [...SAFE_MATTER_READS],
  writes: [table_fundraise_rounds, table_equity_writes],
  drives: [machine_fundraise_round.t.propose, machine_equity_write.t.open],
  invokes: [procedure_documents_store, procedure_board_propose],
  emits: [],
  calls: [...READS_CHAIN],
  chain: [contract_captable.f.closedForExit, contract_rounds.f.createSafeRound],
  spans: [],
  budget: budget("chain-read"),
});

export const rpc_equity_safes_invite = defineRpc({
  id: "equity.safes.invite",
  title: "Propose investors' invitations to a SAFE round",
  about:
    BOARD_ABOUT +
    " The round must be the company's SAFE round and open, its last day to sign not passed (ROUND_CLOSED). Each " +
    "investor resolves to a Party and its Safe (INVALID_INPUT), with the most they may sign for. In one transaction each " +
    "new investor's SAFE is born `proposed` (fundraise-investment.propose) with the round's one write. " +
    PROPOSE_ABOUT +
    " The proposal holds one `Rounds.inviteSafe(roundId, investor, maxAmount)` per investor.",
  was: ["books/frozen/operations.ts (org.safe.invite)", DESIGNED],
  concept: concept_equity,
  kind: "action",
  who: "A Director of the company.",
  input: InviteInput,
  output: Prepared,
  errors: [...BOARD_ERRORS, error_ROUND_CLOSED],
  reads: [...SAFE_MATTER_READS, ...RESOLVE],
  writes: [table_equity_writes, table_fundraise_investments],
  drives: [machine_equity_write.t.open, machine_fundraise_investment.t.propose],
  invokes: [procedure_board_propose],
  emits: [],
  calls: [...READS_CHAIN],
  chain: [contract_rounds.f.safeRound, contract_rounds.f.inviteSafe],
  spans: [],
  budget: budget("chain-read"),
});

export const rpc_equity_safes_close = defineRpc({
  id: "equity.safes.close",
  title: "Close a SAFE round: at once when full, else by Board proposal",
  about:
    BOARD_ABOUT +
    " The round must be open (ROUND_CLOSED: it has already closed). When its signed SAFEs reach its raise " +
    "(`Rounds.safeRound`), the caller's own Safe closes it: the write is born with `approvals.open` of one " +
    "`Rounds.closeSafeRound(roundId)` call. Otherwise the same call is a Board proposal (`board.propose`). Either way the " +
    "write is born `awaiting` (equity-write.open) in the same transaction, and the round's process closes the round, " +
    "and lapses its unsigned invitations, when it lands. It answers what the signed SAFEs raised.",
  was: ["books/frozen/operations.ts (org.safe.close)", DESIGNED],
  concept: concept_equity,
  kind: "action",
  who: "A Director of the company.",
  input: RoundRef,
  output: Prepared,
  errors: [...BOARD_ERRORS, error_ROUND_CLOSED],
  reads: [...SAFE_MATTER_READS, table_equity_positions],
  writes: [table_equity_writes],
  drives: [machine_equity_write.t.open],
  invokes: [procedure_approvals_open, procedure_board_propose],
  emits: [],
  calls: [...READS_CHAIN],
  chain: [contract_rounds.f.safeRound, contract_rounds.f.closeSafeRound],
  spans: [],
  budget: budget("chain-read"),
});

export const rpc_equity_safes_show = defineRpc({
  id: "equity.safes.show",
  title: "Read one SAFE round and the SAFEs signed in it",
  about:
    "A member of the company, with its `equity` gate on (FEATURE_NOT_AVAILABLE), reads one SAFE round by its `sr_` id " +
    "(INVALID_INPUT: no SAFE round has that id): its kind, cap, discount and raise, each SAFE signed with its investor " +
    "and amount (its investments and indexing's SAFE notes), and whether it is open or closed.",
  was: ["books/frozen/operations.ts (org.safe.show)", DESIGNED],
  concept: concept_equity,
  kind: "query",
  who: "A member of the company.",
  input: RoundRef,
  output: SafeShowReturns,
  errors: [...MEMBER_READ_ERRORS],
  reads: [...MEMBER, table_fundraise_rounds, table_fundraise_investments, table_equity_positions],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("read"),
});
