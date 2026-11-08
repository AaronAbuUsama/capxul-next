// The issues area: a one-off issue of shares in a class, within what the class may still issue, by
// Board proposal (`org equity issue`). The issue is a write with no long-lived object of its own:
// equity.writes.follow decides it (processes.ts).

import { budget, defineRpc } from "../../../packages/book/src/index.ts";
import { concept_equity } from "../shared/foundation.ts";
import { contract_captable } from "../shared/external.ts";
import { error_AUTHORISED_EXCEEDED } from "../shared/vocabulary.ts";
import { table_equity_positions } from "../indexing/data.ts";
import { machine_equity_write, table_equity_writes } from "./data.ts";
import { BOARD_ABOUT, BOARD_ERRORS, DIRECTOR, GUARD_WAS, OLD, PROPOSE_ABOUT, READS_CHAIN, RESOLVE } from "./guards.ts";
import { procedure_board_propose, procedure_documents_store } from "./links.ts";
import { IssueInput, Prepared } from "./shapes.ts";

export const rpc_equity_issues_propose = defineRpc({
  id: "equity.issues.propose",
  title: "Propose a one-off issue of shares to the Board",
  about:
    BOARD_ABOUT +
    " The class must be one of the company's, by name (INVALID_INPUT), and `--to` a member with a personal Safe, or an " +
    "address (INVALID_INPUT). The shares must fit what the class may still issue: its authorised amount " +
    "(`Captable.getClass`) less what is issued (indexing's positions) and reserved for conversions " +
    "(`convertibleReserved`), else AUTHORISED_EXCEEDED and nothing is proposed. The reason, a file or text, is stored " +
    "through `documents.store` (the company and the recipient may read it) and its hash stamps the issue. " +
    PROPOSE_ABOUT +
    " The one call is `Captable.issue(classId, to, shares, reasonHash)`. It answers the issue with what the class " +
    "authorises and has left to issue once it lands.",
  was: [`${OLD}/equity/operations/issue.ts`, `${OLD}/equity/writes/issues.ts`, `${OLD}/equity/external/classes.ts:23`, ...GUARD_WAS],
  concept: concept_equity,
  kind: "action",
  who: "A Director of the company.",
  input: IssueInput,
  output: Prepared,
  errors: [...BOARD_ERRORS, error_AUTHORISED_EXCEEDED],
  reads: [...DIRECTOR, ...RESOLVE, table_equity_positions, table_equity_writes],
  writes: [table_equity_writes],
  drives: [machine_equity_write.t.open],
  invokes: [procedure_documents_store, procedure_board_propose],
  emits: [],
  calls: [...READS_CHAIN],
  chain: [contract_captable.f.getClass, contract_captable.f.convertibleReserved, contract_captable.f.closedForExit, contract_captable.f.issue],
  spans: [],
  budget: budget("chain-read"),
});
