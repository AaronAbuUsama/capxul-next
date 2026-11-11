// The sales area: a secondary sale of shares (`shares sell`, `org equity transfer approve`). Following
// the contract, the seller starts the sale on chain from their own Safe; the Board approves it by
// proposal; the buyer then pays and receives the shares in one call (`invest pay tr_…`). The sale's
// process (processes.ts) decides each write.

import { budget, defineRpc } from "../../../packages/book/src/index.ts";
import { concept_equity } from "../shared/foundation.ts";
import { contract_captable, contract_exits, contract_share_class, contract_vesting } from "../shared/external.ts";
import { error_SHARES_LOCKED } from "../shared/vocabulary.ts";
import { table_equity_instruments, table_equity_positions } from "../indexing/data.ts";
import { table_org_members } from "../organizations/data.ts";
import { procedure_approvals_open } from "../approvals/procedures.ts";
import { machine_equity_write, machine_share_sale, table_equity_writes, table_share_sales } from "./data.ts";
import { APPROVE_ABOUT, BOARD_ABOUT, BOARD_ERRORS, DIRECTOR, GUARD_WAS, HOLDER, HOLDER_ERRORS, OLD, PROPOSE_ABOUT, READS_CHAIN } from "./guards.ts";
import { procedure_board_propose } from "../board/procedures.ts";
import { procedure_documents_store } from "../documents/procedures.ts";
import { Prepared, SaleRef, SellInput } from "./shapes.ts";

const OPS = `${OLD}/equity/operations`;

export const rpc_equity_sales_offer = defineRpc({
  id: "equity.sales.offer",
  title: "Prepare a holder's offer of shares to a buyer",
  about:
    "The caller must be signed in, a member of the company (ROLE_PERMISSION_DENIED) with a claimed personal Safe to " +
    "sell from (SMART_ACCOUNT_MISSING); the company's `equity` gate on (FEATURE_NOT_AVAILABLE) and equity installed " +
    "(WRONG_STATE). The class must be the company's (by default its founders' class), the seller must hold the shares " +
    "(`balanceOf`), the buyer must be a member with a personal Safe who is not the seller, and the price a USDC amount " +
    "above zero (INVALID_INPUT); shares vesting still locks are SHARES_LOCKED (`Vesting.lockedOf`), and nothing is signed. " +
    "The sale agreement (`--agreement`, or the sale's own terms) is stored through `documents.store` (the company, the " +
    "seller and the buyer may read it) and its hash stamps the consent and the offer. In one transaction the sale is " +
    "born `requested` (share-sale.request), which starts its process, with its write. " +
    APPROVE_ABOUT +
    " The calls are `Captable.consentToTransfer(classId, buyer, shares, hash)` then `Exits.offerTransfer(classId, buyer, " +
    "shares, price, token, hash)`, for exactly these terms; the offer expires in 30 days. It answers the sale's `tr_` id.",
  was: [`${OPS}/sell.ts`, `${OLD}/equity/writes/transfers.ts`, `${OLD}/equity/external/transfers.ts:82`],
  concept: concept_equity,
  kind: "action",
  who: "A shareholder of the company with a personal Safe.",
  input: SellInput,
  output: Prepared,
  errors: [...HOLDER_ERRORS, error_SHARES_LOCKED],
  reads: [...HOLDER, table_org_members, table_equity_instruments, table_equity_positions, table_share_sales, table_equity_writes],
  writes: [table_share_sales, table_equity_writes],
  drives: [machine_share_sale.t.request, machine_equity_write.t.open],
  invokes: [procedure_documents_store, procedure_approvals_open],
  emits: [],
  calls: [...READS_CHAIN],
  chain: [contract_share_class.f.balanceOf, contract_vesting.f.lockedOf, contract_captable.f.consentToTransfer, contract_exits.f.offerTransfer],
  spans: [],
  budget: budget("chain-read"),
});

export const rpc_equity_sales_approve = defineRpc({
  id: "equity.sales.approve",
  title: "Propose the Board's approval of a share sale",
  about:
    BOARD_ABOUT +
    " The `tr_` id must name a sale of this company (INVALID_INPUT), which Exits holds and has not approved: a sale " +
    "still `requested`, or already approved, is WRONG_STATE (`Exits.transfer`). " +
    PROPOSE_ABOUT +
    " The one call is `Exits.approveTransfer(offerId)`. No shares or money move until the buyer pays.",
  was: [`${OPS}/approve-transfer.ts`, `${OLD}/equity/writes/transfer-approvals.ts`, ...GUARD_WAS],
  concept: concept_equity,
  kind: "action",
  who: "A Director of the company.",
  input: SaleRef,
  output: Prepared,
  errors: [...BOARD_ERRORS],
  reads: [...DIRECTOR, table_share_sales, table_equity_writes],
  writes: [table_equity_writes],
  drives: [machine_equity_write.t.open],
  invokes: [procedure_board_propose],
  emits: [],
  calls: [...READS_CHAIN],
  chain: [contract_exits.f.transfer, contract_exits.f.approveTransfer],
  spans: [],
  budget: budget("chain-read"),
});
