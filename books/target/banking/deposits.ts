// Banking's deposits area: money paid in by bank, as `bank deposits` lists it. A deposit is born
// and moved by Bridge's events (./inbox.ts), credited by its own process once the indexer shows
// its Transfer (./processes.ts), and matched to a request by requests (`banking.match-deposit`).

import { Schema } from "effect";
import { budget, defineRpc } from "../../../packages/book/src/index.ts";
import { concept_banking } from "../shared/foundation.ts";
import { error_INVALID_INPUT, error_NOT_AUTHENTICATED, error_ROLE_PERMISSION_DENIED } from "../shared/vocabulary.ts";
import { Currency, Rail, table_bank_deposits, Token } from "./data.ts";
import { table_parties } from "../parties/data.ts";
import { table_org_members } from "../organizations/data.ts";

const D = "packages/backend/src/banking/deposits";
const S = Schema.String;

/** One deposit as `bank deposits` shows it. */
export const BankDepositView = Schema.Struct({
  bankDepositId: S,
  currency: Currency,
  rail: Rail,
  amount: S,
  status: Schema.Literals(["processing", "arriving", "credited", "below_minimum", "returned"]),
  receivedAt: Schema.Number,
  sender: Schema.NullOr(S),
  credit: Schema.NullOr(Schema.Struct({ token: Token, amount: S, txHash: S, safe: S })),
  match: Schema.NullOr(
    Schema.Union([
      Schema.Struct({ kind: Schema.Literal("request"), requestId: S, reference: S }),
      Schema.Struct({ kind: Schema.Literal("not_request") }),
    ]),
  ),
});

export const rpc_banking_deposits_list = defineRpc({
  id: "banking.deposits.list",
  title: "List the owner's bank deposits, newest first",
  about:
    "One page of 20 of the owner's deposits, newest first, each with the status it reached, who sent it (decrypted for " +
    "the owner only), its credit (token, amount and transaction) and its match; `--unmatched` keeps only credited " +
    "deposits with no match. The cursor is opaque and bound to the owner and the filter: one this list did not give is " +
    "INVALID_INPUT, as is a person with no Party. With the page it counts the credited deposits still unmatched, for the " +
    "CLI's `Needs you` line and its `bank match` command. For an Organization it lists the Organization's deposits, not " +
    "the member's own. It writes nothing.",
  concept: concept_banking,
  kind: "query",
  who: "A signed-in person, for their own deposits, or any current member of the Organization they name with `--org`.",
  input: Schema.Struct({ org_id: Schema.NullOr(S), unmatched: Schema.Boolean, cursor: Schema.NullOr(S) }),
  output: Schema.Struct({
    items: Schema.Array(BankDepositView),
    nextCursor: Schema.NullOr(S),
    unmatchedCount: Schema.Number,
    firstUnmatched: Schema.NullOr(S),
  }),
  errors: [error_NOT_AUTHENTICATED, error_INVALID_INPUT, error_ROLE_PERMISSION_DENIED],
  reads: [table_bank_deposits, table_parties, table_org_members],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("read"),
  was: [`${D}/operations/list.ts:1`, `${D}/reads.ts:40`, "docs/as-is/archive/banking/deposits.ts:130"],
});
