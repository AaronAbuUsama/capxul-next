// The grants area: option grants from the pool and founders' vesting grants. The Board grants and
// ends them (`org options grant`, `org options end`); the grantee accepts and exercises them from their
// own Safe (`shares accept`, `shares exercise`); anyone in the company reads them (`org options show`).
// Each grant's process (processes.ts) decides its writes and moves its status.

import { budget, defineRpc } from "../../../packages/book/src/index.ts";
import { concept_equity } from "../shared/foundation.ts";
import { contract_captable, contract_erc20, contract_options, contract_vesting } from "../shared/external.ts";
import {
  error_INSUFFICIENT_FUNDS,
  error_NOT_VESTED,
  error_POOL_EXCEEDED,
  error_TOKEN_NOT_SUPPORTED,
} from "../shared/vocabulary.ts";
import { table_equity_positions } from "../indexing/data.ts";
import { procedure_approvals_open } from "../approvals/procedures.ts";
import { machine_equity_grant, machine_equity_write, table_equity_grants, table_equity_writes } from "./data.ts";
import {
  APPROVE_ABOUT,
  BOARD_ABOUT,
  BOARD_ERRORS,
  CHAIN_READ_ERRORS,
  DIRECTOR,
  GUARD_WAS,
  HOLDER,
  HOLDER_ERRORS,
  MEMBER,
  MEMBER_READ_ERRORS,
  OLD,
  PROPOSE_ABOUT,
  READS_CHAIN,
  RESOLVE,
} from "./guards.ts";
import { procedure_board_propose } from "../board/procedures.ts";
import { procedure_documents_store } from "../documents/procedures.ts";
import { EndGrantInput, ExerciseInput, GrantInput, GrantRef, GrantShowInput, GrantShowReturns, Prepared } from "./shapes.ts";

const OPS = `${OLD}/equity/operations`;

/** A grantee's checks, in words. */
const GRANTEE_ABOUT =
  "The caller must be signed in with a claimed personal Safe (SMART_ACCOUNT_MISSING), the grant one Capxul holds " +
  "(INVALID_INPUT), and the caller's Safe its grantee (ROLE_PERMISSION_DENIED: not the grantee). The company's `equity` " +
  "gate must be on (FEATURE_NOT_AVAILABLE).";

// ── the Board ───────────────────────────────────────────────────────────────────────────────

export const rpc_equity_grants_propose = defineRpc({
  id: "equity.grants.propose",
  title: "Propose option grants from the pool to the Board",
  about:
    BOARD_ABOUT +
    " Each grant (one, or each line of a CSV) names a member with a personal Safe (INVALID_INPUT), whole options, a " +
    "strike that is an amount in a token the chain admits (INVALID_INPUT; another token is TOKEN_NOT_SUPPORTED), and " +
    "vesting of 1 to 119 calendar months with a cliff no longer than it (INVALID_INPUT). The schedule starts today, " +
    "the offer lapses 30 days on and the options expire ten years after the start; the exercise window after leaving " +
    "defaults to 90 days. Together they must fit the pool's unallocated options (`Options.pool` less `allocated`), else " +
    "POOL_EXCEEDED and nothing is proposed. Each grant's agreement is stored through `documents.store` (the company and " +
    "the grantee may read it) and its hash is what the grantee accepts. In one transaction each grant is born " +
    "`proposed` (equity-grant.propose), which starts its process, with its own write. " +
    PROPOSE_ABOUT +
    " The proposal holds one `Options.grant` per grant. It answers the grants with the pool's size and what it has " +
    "left once they land.",
  was: [`${OPS}/grant-options.ts`, `${OLD}/equity/writes/grants.ts`, `${OLD}/equity/rules/grants.ts`, ...GUARD_WAS],
  concept: concept_equity,
  kind: "action",
  who: "A Director of the company.",
  input: GrantInput,
  output: Prepared,
  errors: [...BOARD_ERRORS, error_POOL_EXCEEDED, error_TOKEN_NOT_SUPPORTED],
  reads: [...DIRECTOR, ...RESOLVE, table_equity_grants, table_equity_writes],
  writes: [table_equity_grants, table_equity_writes],
  drives: [machine_equity_grant.t.propose, machine_equity_write.t.open],
  invokes: [procedure_documents_store, procedure_board_propose],
  emits: [],
  calls: [...READS_CHAIN],
  chain: [contract_options.f.pool, contract_options.f.allocated, contract_captable.f.closedForExit, contract_options.f.grant],
  spans: [],
  budget: budget("chain-read"),
});

export const rpc_equity_grants_end = defineRpc({
  id: "equity.grants.end",
  title: "Propose the end of a grant from a last day",
  about:
    BOARD_ABOUT +
    " The grant must be the company's (INVALID_INPUT) and offered or active (WRONG_STATE: already ended). The last day " +
    "is today or later, never earlier (INVALID_INPUT). It reads what has vested by then (`Options.vestedOf`, or for a " +
    "founder's shares `Vesting.lockedOf`): vested options stay exercisable for the grant's window after the last day, " +
    "the rest return to the pool. " +
    PROPOSE_ABOUT +
    " The call is `Options.end(id, lastDay)`, or for a founder's vesting grant `Vesting.revoke(id, lastDay)` then " +
    "`settleRevocation(id)`. It answers what vests, what returns to the pool and the last day to exercise.",
  was: [`${OPS}/grant-options.ts`, "books/frozen/operations.ts (org.options.end, designed)"],
  concept: concept_equity,
  kind: "action",
  who: "A Director of the company.",
  input: EndGrantInput,
  output: Prepared,
  errors: [...BOARD_ERRORS],
  reads: [...DIRECTOR, table_equity_grants, table_equity_writes],
  writes: [table_equity_writes],
  drives: [machine_equity_write.t.open],
  invokes: [procedure_board_propose],
  emits: [],
  calls: [...READS_CHAIN],
  chain: [contract_options.f.vestedOf, contract_vesting.f.lockedOf, contract_options.f.end, contract_vesting.f.revoke, contract_vesting.f.settleRevocation],
  spans: [],
  budget: budget("chain-read"),
});

// ── the grantee ─────────────────────────────────────────────────────────────────────────────

export const rpc_equity_grants_accept = defineRpc({
  id: "equity.grants.accept",
  title: "Prepare a grantee's acceptance of a grant's exact terms",
  about:
    GRANTEE_ABOUT +
    " The grant must be offered and its offer not lapsed (WRONG_STATE: the offer expired), and the agreement hash the " +
    "chain holds for it (indexing's position) must still be the one Capxul stored (INVALID_INPUT: the terms changed). " +
    APPROVE_ABOUT +
    " The call is `Options.accept(id, agreementHash)`. It answers what has vested so far (`Options.vestedOf`, from the " +
    "start date) and the next vesting date.",
  was: ["books/frozen/operations.ts (shares.accept, designed)", `${OLD}/equity/rules/grants.ts`],
  concept: concept_equity,
  kind: "action",
  who: "The grantee, from their own Safe.",
  input: GrantRef,
  output: Prepared,
  errors: [...HOLDER_ERRORS],
  reads: [...HOLDER, table_equity_grants, table_equity_positions, table_equity_writes],
  writes: [table_equity_writes],
  drives: [machine_equity_write.t.open],
  invokes: [procedure_approvals_open],
  emits: [],
  calls: [...READS_CHAIN],
  chain: [contract_options.f.vestedOf, contract_options.f.accept],
  spans: [],
  budget: budget("chain-read"),
});

export const rpc_equity_grants_exercise = defineRpc({
  id: "equity.grants.exercise",
  title: "Prepare an exercise of vested options",
  about:
    GRANTEE_ABOUT +
    " The grant must be active or ended. The shares must be at most what has vested and not been exercised " +
    "(`Options.vestedOf` less the exercises indexed, NOT_VESTED); past the expiry or the window after the last day is " +
    "WRONG_STATE; the grantee's Safe must hold the strike times the shares in the strike token (`balanceOf`, " +
    "INSUFFICIENT_FUNDS). " +
    APPROVE_ABOUT +
    " The calls are the strike token's `approve` of Options for exactly the strike and `Options.exercise(id, shares)`, " +
    "which pays the company through Payments (kind 7) and issues the shares in the same transaction.",
  was: ["books/frozen/operations.ts (shares.exercise, designed)"],
  concept: concept_equity,
  kind: "action",
  who: "The grantee, from their own Safe.",
  input: ExerciseInput,
  output: Prepared,
  errors: [...HOLDER_ERRORS, error_NOT_VESTED, error_INSUFFICIENT_FUNDS],
  reads: [...HOLDER, table_equity_grants, table_equity_positions, table_equity_writes],
  writes: [table_equity_writes],
  drives: [machine_equity_write.t.open],
  invokes: [procedure_approvals_open],
  emits: [],
  calls: [...READS_CHAIN],
  chain: [contract_options.f.vestedOf, contract_erc20.f.balanceOf, contract_erc20.f.approve, contract_options.f.exercise],
  spans: [],
  budget: budget("chain-read"),
});

// ── anyone in the company ───────────────────────────────────────────────────────────────────

export const rpc_equity_grants_show = defineRpc({
  id: "equity.grants.show",
  title: "Read a company's grants, or one grant",
  about:
    "A member of the company, with its `equity` gate on (FEATURE_NOT_AVAILABLE), reads one grant by its `og_` or `vg_` " +
    "id (INVALID_INPUT: no grant has that id), or all of them: who holds it, the options or shares with the strike and " +
    "the expiry, what has vested so far (`Options.vestedOf`, or a founder's grant less `Vesting.lockedOf`) and its status.",
  was: ["books/frozen/operations.ts (org.options.show)", `${OLD}/equity/views.ts`],
  concept: concept_equity,
  kind: "action",
  who: "A member of the company.",
  input: GrantShowInput,
  output: GrantShowReturns,
  errors: [...MEMBER_READ_ERRORS, ...CHAIN_READ_ERRORS],
  reads: [...MEMBER, table_equity_grants],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [...READS_CHAIN],
  chain: [contract_options.f.vestedOf, contract_vesting.f.lockedOf],
  spans: [],
  budget: budget("chain-read"),
});
