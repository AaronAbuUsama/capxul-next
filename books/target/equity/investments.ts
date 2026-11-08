// The investments area: an invited investor's side of a round (`invest`, `invest show`, `invest
// commit`, `invest pay`, `invest sign`). Every write is the investor's own approval from their claimed
// personal Safe. `invest pay` also buys an approved secondary sale (`tr_…`), as `org equity transfer
// approve` tells the buyer to (equity.invest-pay-buys). The round's or the sale's process decides each
// write.

import { budget, defineRpc } from "../../../packages/book/src/index.ts";
import { concept_equity } from "../shared/foundation.ts";
import { contract_erc20, contract_exits, contract_rounds } from "../shared/external.ts";
import { error_INSUFFICIENT_FUNDS, error_ROLE_PERMISSION_DENIED, error_ROUND_CLOSED } from "../shared/vocabulary.ts";
import { error_NOT_AUTHENTICATED } from "../shared/vocabulary.ts";
import { table_equity_instruments, table_equity_positions } from "../indexing/data.ts";
import { procedure_approvals_open } from "../approvals/procedures.ts";
import { table_principals } from "../access/data.ts";
import { table_organizations } from "../organizations/data.ts";
import {
  machine_equity_write,
  table_equity_writes,
  table_fundraise_investments,
  table_fundraise_rounds,
  table_share_sales,
} from "./data.ts";
import { APPROVE_ABOUT, HOLDER, HOLDER_ERRORS, READS_CHAIN } from "./guards.ts";
import { CommitInput, InvestOffer, InvestShowInput, InvestShowReturns, PayInput, Prepared, SignInput } from "./shapes.ts";
import { Schema } from "effect";

const DESIGNED = (id: string) => `books/frozen/operations.ts (${id}, designed)`;

const INVESTOR_ABOUT =
  "The caller must be signed in with a claimed personal Safe (SMART_ACCOUNT_MISSING): an investor's Safe must be " +
  "theirs on chain before money leaves it. The round must be one the caller's Safe is invited to (ROLE_PERMISSION_DENIED: " +
  "not invited), and the company's `equity` gate on (FEATURE_NOT_AVAILABLE).";

const INVESTOR_WRITE = {
  reads: [...HOLDER, table_fundraise_rounds, table_fundraise_investments, table_equity_writes],
  writes: [table_equity_writes],
  drives: [machine_equity_write.t.open],
  invokes: [procedure_approvals_open],
  emits: [],
  calls: [...READS_CHAIN],
  spans: [],
} as const;

/** Whether the documents' hashes match the chain, in words. */
const MATCH =
  "`documentsMatch` is true when the hash Capxul stored with the round's terms (from `documents.store`) is the " +
  "document hash the chain holds for the round (indexing's instruments).";

export const rpc_equity_investments_list = defineRpc({
  id: "equity.investments.list",
  title: "The rounds and SAFE rounds your Safe is invited to",
  about:
    "Signed in (NOT_AUTHENTICATED), the caller's own Safe's invitations across companies (`by_investor_safe`), each " +
    "with its round's price or cap, what they were invited for, where their place stands, and whether its documents " +
    "match the chain. " +
    MATCH +
    " A Safe invited nowhere is ROLE_PERMISSION_DENIED (not invited).",
  was: [DESIGNED("invest")],
  concept: concept_equity,
  kind: "query",
  who: "An invited investor, about themselves.",
  input: Schema.Struct({}),
  output: Schema.Array(InvestOffer),
  errors: [error_NOT_AUTHENTICATED, error_ROLE_PERMISSION_DENIED],
  reads: [table_principals, table_organizations, table_fundraise_investments, table_fundraise_rounds, table_equity_instruments],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("read"),
});

export const rpc_equity_investments_get = defineRpc({
  id: "equity.investments.get",
  title: "One round you are invited to, with its terms and documents",
  about:
    "Signed in, one priced round (`rd_`) or SAFE round (`sr_`) the caller's own Safe is invited to " +
    "(ROLE_PERMISSION_DENIED: not invited to the round): its price or cap, the class terms (preference, conversion, " +
    "anti-dilution, from indexing's class instrument), the raise and the documents with their hashes. " +
    MATCH,
  was: [DESIGNED("invest"), "books/frozen/operations.ts (invest.show)"],
  concept: concept_equity,
  kind: "query",
  who: "An invited investor, about themselves.",
  input: InvestShowInput,
  output: InvestShowReturns,
  errors: [error_NOT_AUTHENTICATED, error_ROLE_PERMISSION_DENIED],
  reads: [table_principals, table_organizations, table_fundraise_investments, table_fundraise_rounds, table_equity_instruments],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("read"),
});

export const rpc_equity_investments_commit = defineRpc({
  id: "equity.investments.commit",
  title: "Prepare an investor's commitment to a priced round",
  about:
    INVESTOR_ABOUT +
    " The round must be open and before its pay-by day (ROUND_CLOSED: after the pay-by date or the close), and the " +
    "amount at most what the investor was invited for (`Rounds.position`, INVALID_INPUT: more than invited). No money " +
    "moves. " +
    APPROVE_ABOUT +
    " The one call is `Rounds.commit(roundId, amount, termsHash)`. It answers the commitment's `cm_` id and the shares " +
    "the amount buys at the round's price.",
  was: [DESIGNED("invest.commit")],
  concept: concept_equity,
  kind: "action",
  who: "An invited investor, from their own Safe.",
  input: CommitInput,
  output: Prepared,
  errors: [...HOLDER_ERRORS, error_ROUND_CLOSED],
  ...INVESTOR_WRITE,
  chain: [contract_rounds.f.position, contract_rounds.f.commit],
  budget: budget("chain-read"),
});

export const rpc_equity_investments_pay = defineRpc({
  id: "equity.investments.pay",
  title: "Prepare a payment for allocated shares, or for an approved secondary sale",
  about:
    "For a round (`rd_`): " +
    INVESTOR_ABOUT +
    " The caller's place must be allocated and unpaid (WRONG_STATE: already paid, or not allocated) before the pay-by " +
    "day (ROUND_CLOSED). The calls: the token's `approve` of Rounds for exactly the allocation and `Rounds.pay(roundId)`, " +
    "which pays the company Safe through Payments (kind 5) and issues the shares in the same transaction. For a sale " +
    "(`tr_`): the caller's Safe must be the sale's buyer (ROLE_PERMISSION_DENIED), and the sale approved by the Board and " +
    "not yet bought (WRONG_STATE); the calls are the token's `approve` of Exits for the total and `Exits.buy(transferId)`, " +
    "which pays the seller (kind 5) and moves the shares. Either way the Safe must hold the amount (`balanceOf`, " +
    "INSUFFICIENT_FUNDS). " +
    APPROVE_ABOUT,
  was: [DESIGNED("invest.pay"), DESIGNED("org.equity.transfer.approve")],
  concept: concept_equity,
  kind: "action",
  who: "An allocated investor, or a sale's buyer, from their own Safe.",
  input: PayInput,
  output: Prepared,
  errors: [...HOLDER_ERRORS, error_ROUND_CLOSED, error_INSUFFICIENT_FUNDS],
  ...INVESTOR_WRITE,
  reads: [...INVESTOR_WRITE.reads, table_share_sales],
  chain: [contract_rounds.f.position, contract_exits.f.transfer, contract_erc20.f.balanceOf, contract_erc20.f.approve, contract_rounds.f.pay, contract_exits.f.buy],
  budget: budget("chain-read"),
});

export const rpc_equity_investments_sign = defineRpc({
  id: "equity.investments.sign",
  title: "Prepare an investor's SAFE, signed and paid in one step",
  about:
    INVESTOR_ABOUT +
    " The SAFE round must be open and before its last day to sign (ROUND_CLOSED: the round has closed), and the amount " +
    "within the invitation and at least the minimum ticket (INVALID_INPUT: more than invited); the Safe must hold it " +
    "(INSUFFICIENT_FUNDS). " +
    APPROVE_ABOUT +
    " The calls are USDC's `approve` of Rounds for exactly the amount and `Rounds.signSafe(roundId, amount, termsHash)`, " +
    "which pays the company Safe through Payments (kind 6) and records the note. It answers the SAFE with its cap and " +
    "the ownership it buys at the cap.",
  was: [DESIGNED("invest.sign")],
  concept: concept_equity,
  kind: "action",
  who: "An invited investor, from their own Safe.",
  input: SignInput,
  output: Prepared,
  errors: [...HOLDER_ERRORS, error_ROUND_CLOSED, error_INSUFFICIENT_FUNDS],
  ...INVESTOR_WRITE,
  reads: [...INVESTOR_WRITE.reads, table_equity_positions],
  chain: [contract_rounds.f.safeRound, contract_erc20.f.balanceOf, contract_erc20.f.approve, contract_rounds.f.signSafe],
  budget: budget("chain-read"),
});
