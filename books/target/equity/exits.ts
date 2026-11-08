// The exits area: the sale of the company (`org exit preview`, `org exit pay`). Shareholders approve a
// sale by vote (`org vote create approve-sale`, which calls `Exits.approveSale` through the Governor);
// the buyer pays the proceeds to the company Safe; then the Board pays every holder in one batch and
// settles: every share burned, every option ended, the Captable closed. The payout is a write with no
// long-lived object of its own, so equity.writes.follow decides it.

import { budget, defineRpc } from "../../../packages/book/src/index.ts";
import { concept_equity } from "../shared/foundation.ts";
import { contract_captable, contract_erc20, contract_exits, contract_payments } from "../shared/external.ts";
import { table_chain_logs, table_equity_instruments, table_equity_positions } from "../indexing/data.ts";
import { machine_equity_write, table_equity_grants, table_equity_writes, table_votes } from "./data.ts";
import { BOARD_ABOUT, BOARD_ERRORS, CHAIN_READ_ERRORS, DIRECTOR, MEMBER, MEMBER_READ_ERRORS, PROPOSE_ABOUT, READS_CHAIN, RESOLVE } from "./guards.ts";
import { procedure_board_propose } from "./links.ts";
import { ExitPayInput, ExitPreviewInput, ExitPreviewReturns, Prepared } from "./shapes.ts";

const DESIGNED = (id: string) => `books/frozen/operations.ts (${id}, designed)`;

/** The waterfall, in words: what Exits computes, given the holdings. */
const WATERFALL =
  "The holdings are every holder's shares of every class and every option grant (indexing's positions, the grants), " +
  "with each class's preference and conversion terms (`Captable.getClass`): each preferred class takes the larger of " +
  "its preference and what it gets as converted, and the rest goes to Common per share.";

export const rpc_equity_exits_preview = defineRpc({
  id: "equity.exits.preview",
  title: "Preview the waterfall of a sale at a price",
  about:
    "A member of the company, with its `equity` gate on (FEATURE_NOT_AVAILABLE) and equity installed (WRONG_STATE), " +
    "names the proceeds. " +
    WATERFALL +
    " With an approved sale on chain it is `Exits.preview(saleId, holdings)` itself; before one, the same rules are " +
    "applied here. It answers what each Common share is worth, what each class chooses and is paid, what each holder " +
    "receives, and `check`, the proceeds less what is paid out (0 when it balances). Nothing is signed.",
  was: [DESIGNED("org.exit.preview")],
  concept: concept_equity,
  kind: "action",
  who: "A member of the company.",
  input: ExitPreviewInput,
  output: ExitPreviewReturns,
  errors: [...MEMBER_READ_ERRORS, ...CHAIN_READ_ERRORS],
  reads: [...MEMBER, ...RESOLVE, table_equity_instruments, table_equity_positions, table_equity_grants],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [...READS_CHAIN],
  chain: [contract_captable.f.getClass, contract_exits.f.preview],
  spans: [],
  budget: budget("chain-read"),
});

export const rpc_equity_exits_pay = defineRpc({
  id: "equity.exits.pay",
  title: "Propose an exit's payout to every holder, and its settlement",
  about:
    BOARD_ABOUT +
    " `--vote` must name the company's executed `approve-sale` vote (INVALID_INPUT otherwise), whose sale Exits holds " +
    "approved (`Exits.sale`) with the buyer's proceeds already in the company Safe (`balanceOf`); else WRONG_STATE (the " +
    "sale is not approved, or the buyer has not paid). " +
    WATERFALL +
    " The holdings must cover every class and every grant (INVALID_INPUT: the holdings miss a class or a grant). " +
    PROPOSE_ABOUT +
    " The batch is `Payments.sendBatch(items)`, one kind-8 item per holder from `Exits.preview`, then `Exits.settle(saleId, " +
    "holdings, claimIndexes)`. It answers how many holders are paid and the total.",
  was: [DESIGNED("org.exit.pay")],
  concept: concept_equity,
  kind: "action",
  who: "A Director of the company.",
  input: ExitPayInput,
  output: Prepared,
  errors: [...BOARD_ERRORS],
  reads: [...DIRECTOR, ...RESOLVE, table_votes, table_chain_logs, table_equity_instruments, table_equity_positions, table_equity_grants, table_equity_writes],
  writes: [table_equity_writes],
  drives: [machine_equity_write.t.open],
  invokes: [procedure_board_propose],
  emits: [],
  calls: [...READS_CHAIN],
  chain: [contract_exits.f.sale, contract_erc20.f.balanceOf, contract_captable.f.getClass, contract_exits.f.preview, contract_payments.f.sendBatch, contract_exits.f.settle],
  spans: [],
  budget: budget("chain-read"),
});
