// Banking's door: the procedures other concepts invoke inside their own transaction. There is one,
// named by the architecture (rules.procedures): requests marks a credited deposit matched in the
// transaction that marks its request paid. Every other concept that needs banking reads its tables
// (requests, notices) or reacts to its transitions; none writes them.

import { Schema } from "effect";
import { defineProcedure } from "../../../packages/book/src/index.ts";
import { concept_banking } from "../shared/foundation.ts";
import { error_INVALID_INPUT, error_WRONG_STATE } from "../shared/vocabulary.ts";
import { machine_bank_deposit_match, OwnerKind, table_bank_deposits } from "./data.ts";

const B = "packages/backend/src/banking";

export const procedure_banking_match_deposit = defineProcedure({
  id: "banking.match-deposit",
  title: "Mark a credited deposit as paying a request, or as no request",
  about:
    "Money fact: a bank deposit and the request it paid are one fact (what the money was for), so the deposit's match " +
    "and the request's paid state commit together or not at all. Requests invokes it from `bank match` and from its own " +
    "match by reference, in the transaction that marks the request paid; with `none` it marks the deposit as paying no " +
    "request and requests writes nothing else. The deposit must be the owner's (another owner's id reads as unknown: " +
    "INVALID_INPUT) and credited (WRONG_STATE otherwise). The same match again returns the deposit unchanged and drives " +
    "nothing; a deposit matched once never moves to another request or to `none`, nor the reverse (WRONG_STATE). It " +
    "creates no Payment. Replaces old requests' `matchBankDepositInTx` called from banking, which is now the other way " +
    "round.",
  concept: concept_banking,
  input: Schema.Struct({
    owner_kind: OwnerKind,
    owner_id: Schema.String,
    bank_deposit_id: Schema.String,
    match: Schema.Union([
      Schema.Struct({
        kind: Schema.Literal("request"),
        request_id: Schema.String,
        reference: Schema.String,
        how: Schema.Literals(["reference", "manual"]),
      }),
      Schema.Struct({ kind: Schema.Literal("not_request") }),
    ]),
  }),
  output: Schema.Struct({
    bank_deposit_id: Schema.String,
    status: Schema.Literals(["processing", "arriving", "credited", "below_minimum", "returned"]),
    match: Schema.Union([
      Schema.Struct({ kind: Schema.Literal("request"), request_id: Schema.String, reference: Schema.String }),
      Schema.Struct({ kind: Schema.Literal("not_request") }),
    ]),
    changed: Schema.Boolean,
  }),
  errors: [error_INVALID_INPUT, error_WRONG_STATE],
  reads: [table_bank_deposits],
  writes: [table_bank_deposits],
  drives: [machine_bank_deposit_match.t.match_request, machine_bank_deposit_match.t.mark_not_request],
  invokes: [],
  emits: [],
  was: [`${B}/deposits/operations/match.ts:1`, `${B}/deposits/writes/matching.ts:1`, "books/as-is/banking/deposits.ts:213"],
});
