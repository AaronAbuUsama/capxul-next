// Requests' deposits area: matching a credited bank deposit to the request it paid (`bank match`),
// or marking it as no request. The deposit is banking's and is marked through `banking.match-deposit`
// in the same transaction as the request's `match`: a deposit and the request it paid are one money
// fact (decision concepts.requests). No Payment is born: the deposit's own book fact records the money.

import { Schema } from "effect";
import { budget, defineRpc } from "../../../packages/book/src/index.ts";
import { concept_requests } from "../shared/foundation.ts";
import {
  error_INVALID_INPUT,
  error_NOT_AUTHENTICATED,
  error_ROLE_PERMISSION_DENIED,
  error_WRONG_STATE,
} from "../shared/vocabulary.ts";
import { machine_request, table_requests } from "./data.ts";
import { Amount, Org } from "./shapes.ts";
import { GUARD_WAS, WRITER } from "./guards.ts";
import { procedure_banking_match_deposit } from "../banking/procedures.ts";
import { table_bank_deposits } from "../banking/data.ts";

const B = "packages/backend/src/banking/deposits";
const ASIS = "books/as-is/requests/procedures.ts";

const S = Schema.String;
const N = Schema.Number;
const NullOr = Schema.NullOr;

const Match = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("request"), requestId: S, reference: S }),
  Schema.Struct({ kind: Schema.Literal("not_request") }),
]);

const DepositStatus = Schema.Literals(["processing", "arriving", "credited", "below_minimum", "returned"]);

export const rpc_requests_deposits_candidates = defineRpc({
  id: "requests.deposits.candidates",
  title: "A deposit and the requests it could have paid",
  about:
    "The owner's deposit (null for an id the owner has no deposit under, which the CLI shows as CLI_USAGE with the " +
    "requests it could pay) with its status, its net tokens and its current match, and the owner's open requests in its " +
    "token for at most its net amount (`by_owner_open_token`), newest first: the live choices `bank match` offers at a " +
    "terminal and lists to an agent. It writes nothing.",
  was: [`${B}/operations/candidates.ts:1`, "packages/backend/src/requests/reads/deposits.ts:51", `${ASIS}:287`, ...GUARD_WAS],
  concept: concept_requests,
  kind: "query",
  who: "A signed-in person for their own deposits; with `org`, a member whose Safe wears the Organization's Invoicing hat.",
  input: Schema.Struct({ org: Org, bank_deposit_id: S }),
  output: NullOr(
    Schema.Struct({
      bankDepositId: S,
      status: DepositStatus,
      net: NullOr(Amount),
      match: NullOr(Match),
      candidates: Schema.Array(Schema.Struct({ requestId: S, reference: S, amount: Amount, createdAt: N })),
    }),
  ),
  errors: [error_NOT_AUTHENTICATED, error_ROLE_PERMISSION_DENIED],
  reads: [table_bank_deposits, table_requests, ...WRITER],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("read"),
});

export const rpc_requests_deposits_match = defineRpc({
  id: "requests.deposits.match",
  title: "Match a credited deposit to the request it paid, or to none",
  about:
    "With a request: the owner's open request (INVALID_INPUT when it does not exist or is not the owner's, and the deposit " +
    "stays unmatched), in the deposit's token for at most its net amount, with no Payment in flight (WRONG_STATE " +
    "otherwise), is moved through `match` with the deposit's id, and `banking.match-deposit` marks the deposit matched in " +
    "the same transaction (it refuses a deposit that is another owner's, INVALID_INPUT, or not credited, or matched to " +
    "something else, WRONG_STATE). With `none`: only the deposit is marked, and no request is touched. The same match " +
    "again (`changed` false) drives nothing and sends no second event. It creates no Payment.",
  was: [`${B}/operations/match.ts:12`, `${B}/writes/matching.ts:45`, "packages/backend/src/requests/writes/deposits.ts:20", `${ASIS}:331`, ...GUARD_WAS],
  concept: concept_requests,
  kind: "mutation",
  who: "A signed-in person for their own deposits; with `org`, a member whose Safe wears the Organization's Invoicing hat.",
  input: Schema.Struct({ org: Org, bank_deposit_id: S, request_id: NullOr(S) }),
  output: Schema.Struct({ bankDepositId: S, match: Match, status: DepositStatus }),
  errors: [error_NOT_AUTHENTICATED, error_INVALID_INPUT, error_WRONG_STATE, error_ROLE_PERMISSION_DENIED],
  reads: [table_requests, table_bank_deposits, ...WRITER],
  writes: [table_requests],
  drives: [machine_request.t.match],
  invokes: [procedure_banking_match_deposit],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("write"),
});
